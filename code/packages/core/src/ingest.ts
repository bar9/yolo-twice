import fs from "node:fs";
import os from "node:os";
import { anonymizePaths, mapStrings, type PathContext } from "./anonymize.js";
import { claudeProjectDir } from "./paths.js";
import { BUILTIN_RULES, compileExtraRules, redact, truncate, type RedactRule } from "./redact.js";
import type { Event, FileCursor, SourceState } from "./schema.js";
import { NORMALIZER_VERSION, discoverSessionFiles, headHash, normalizeRecord, readNewLines, readSubagentMeta, type SessionFile } from "./sources/claude-code.js";
import type { Store } from "./store.js";

export interface IngestOptions {
  /** The project working directory Claude Code was started in (decides the ~/.claude/projects slug). */
  cwd: string;
  store: Store;
  /** Override the Claude Code project folder (tests, fixtures). */
  originDir?: string;
  /** Only ingest this session. */
  session?: string;
  /** Override home and login name for path anonymization (tests). Root is always `cwd`. */
  paths?: Partial<Omit<PathContext, "root">>;
}

export interface IngestResult {
  changed: string[]; // session ids with new events
  appended: Record<string, number>;
  reset: string[];
}

/**
 * Everything user-written that reaches .yolo-twice passes here: secrets are redacted, then
 * machine paths are made portable and anonymous. `data` strings get the same treatment as
 * the text (tool descriptions, task summaries).
 */
function applyRedaction(ev: Event, rules: RedactRule[], maxChars: number, paths: PathContext | undefined): Event {
  let count = 0;
  const hit = new Set<string>();
  const clean = (s: string) => {
    const r = redact(s, rules);
    count += r.count;
    r.rules.forEach((x) => hit.add(x));
    return paths ? anonymizePaths(r.text, paths) : r.text;
  };
  const out: Event = { ...ev, text: truncate(clean(ev.text), maxChars) };
  if (ev.data) out.data = mapStrings(ev.data, clean);
  if (count > 0) out.redacted = { count, rules: [...hit] };
  return out;
}

function firstTimestamp(lines: { text: string }[]): string | undefined {
  for (const { text } of lines) {
    const m = /"timestamp"\s*:\s*"([^"]+)"/.exec(text);
    if (m) return m[1];
  }
  return undefined;
}

function emptyCursor(file: string): FileCursor {
  const st = fs.statSync(file);
  return { bytes: 0, lines: 0, size: st.size, mtime_ms: st.mtimeMs, head_hash: headHash(file) };
}

/** Incrementally ingest every session of one project. Safe to call repeatedly and concurrently per project. */
export function ingestProject(opts: IngestOptions): IngestResult {
  const { store } = opts;
  store.ensure();
  const config = store.readConfig();
  const rules = [...BUILTIN_RULES, ...compileExtraRules(config.redaction.extra_rules)];
  const originDir = opts.originDir ?? claudeProjectDir(opts.cwd);
  const pathCtx: PathContext | undefined = config.redaction.paths
    ? { root: opts.cwd, home: opts.paths?.home ?? os.homedir(), user: opts.paths?.user ?? safeUser() }
    : undefined;
  // the cursor keeps where the source lives, written portably too
  const originStored = pathCtx ? anonymizePaths(originDir, pathCtx) : originDir;
  const files = discoverSessionFiles(originDir).filter((f) => !opts.session || f.session === opts.session);

  const result: IngestResult = { changed: [], appended: {}, reset: [] };
  const bySession = new Map<string, SessionFile[]>();
  for (const f of files) bySession.set(f.session, [...(bySession.get(f.session) ?? []), f]);

  // one writer per session at a time: cursor read, append and cursor write happen under the lock
  for (const [session, sessionFiles] of bySession) store.withSessionLock(session, () => {
    let state: SourceState = store.readSourceState(session) ?? { agent: "claude-code", session, origin_dir: originStored, files: {} };
    let appended = 0;

    // events written by an older normalizer -> rebuild that session from scratch
    if (Object.keys(state.files).length > 0 && state.normalizer !== NORMALIZER_VERSION) {
      store.resetSession(session);
      result.reset.push(session);
      state = { agent: "claude-code", session, origin_dir: originStored, files: {} };
    }

    // detect replaced or truncated source files -> rebuild that session from scratch
    const main = sessionFiles.find((f) => f.role === "main");
    if (main) {
      const cur = state.files[main.rel];
      if (cur) {
        const st = fs.statSync(main.file);
        const replaced = st.size < cur.bytes || (cur.bytes > 0 && headHash(main.file) !== cur.head_hash);
        if (replaced) {
          store.resetSession(session);
          result.reset.push(session);
          state = { agent: "claude-code", session, origin_dir: originStored, files: {} };
        }
      }
    }

    for (const sf of sessionFiles) {
      const cursor = state.files[sf.rel] ?? emptyCursor(sf.file);
      const st = fs.statSync(sf.file);
      if (sf.role === "subagent" && st.size < cursor.bytes) {
        // subagent file replaced: cannot un-append; start over for this file (ids dedupe anyway)
        cursor.bytes = 0;
        cursor.lines = 0;
      }
      const chunk = readNewLines(sf.file, cursor.bytes, cursor.lines);
      const events: Event[] = [];
      const meta = sf.role === "subagent" ? readSubagentMeta(sf.metaFile) : undefined;
      // Records before the first timestamped one (titles, mode) borrow the first timestamp in the file,
      // so the output is deterministic. Only a file with no timestamps at all falls back to its mtime.
      let lastTs = cursor.last_ts ?? firstTimestamp(chunk.lines) ?? new Date(st.mtimeMs).toISOString();

      for (const { text, line } of chunk.lines) {
        const evs = normalizeRecord(text, {
          session,
          file: sf.rel,
          line,
          agentId: sf.agentId ?? null,
          lastTs,
          maxTextChars: config.redaction.max_text_chars,
        });
        for (const ev of evs) {
          lastTs = ev.ts;
          events.push(applyRedaction(ev, rules, config.redaction.max_text_chars, pathCtx));
        }
      }

      if (sf.role === "subagent" && sf.agentId) {
        const firstTs = events[0]?.ts ?? lastTs;
        if (!cursor.started_emitted && (events.length > 0 || cursor.bytes > 0)) {
          const start: Event = {
            id: `agent:${sf.agentId}:start`,
            ts: firstTs,
            session,
            agent: "claude-code",
            agent_id: sf.agentId,
            parent: null,
            kind: "subagent.start",
            text: meta?.description ?? "",
            data: { agent_type: meta?.agentType, depth: meta?.spawnDepth },
            src: { file: sf.rel, line: 0 },
          };
          if (meta?.toolUseId) start.tool = { name: "Agent", call_id: meta.toolUseId };
          events.unshift(start);
          cursor.started_emitted = true;
        }
        if (meta?.finished && !cursor.stop_emitted) {
          const stop: Event = {
            id: `agent:${sf.agentId}:stop`,
            ts: lastTs,
            session,
            agent: "claude-code",
            agent_id: sf.agentId,
            parent: null,
            kind: "subagent.stop",
            text: "",
            src: { file: sf.rel, line: chunk.lines.at(-1)?.line ?? cursor.lines },
          };
          if (meta?.toolUseId) stop.tool = { name: "Agent", call_id: meta.toolUseId };
          events.push(stop);
          cursor.stop_emitted = true;
        }
      }

      if (events.length > 0) appended += store.appendEvents(session, events);
      cursor.bytes = chunk.bytes;
      cursor.lines = chunk.lines.at(-1)?.line ?? cursor.lines;
      cursor.size = st.size;
      cursor.mtime_ms = st.mtimeMs;
      cursor.last_ts = lastTs;
      if (cursor.bytes > 0 && !cursor.head_hash) cursor.head_hash = headHash(sf.file);
      state.files[sf.rel] = cursor;
    }

    state.normalizer = NORMALIZER_VERSION;
    store.writeSourceState(session, state);
    if (appended > 0) {
      result.changed.push(session);
      result.appended[session] = appended;
    }
  });
  return result;
}

export function sessionFilesFor(cwd: string, originDir?: string): SessionFile[] {
  return discoverSessionFiles(originDir ?? claudeProjectDir(cwd));
}

function safeUser(): string | undefined {
  try {
    return os.userInfo().username;
  } catch {
    return undefined;
  }
}
