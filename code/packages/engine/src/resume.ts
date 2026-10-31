import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expandPaths, mapStrings, type Event, type ImageRef, type Store } from "@yolo-twice/core";

/**
 * Rebuild a Claude Code transcript (JSONL) from the redacted events committed in .yolo-twice,
 * so a teammate can resume a session that never ran on their machine.
 *
 * Paths were stored portably ($PROJECT, ~); they are expanded to the resumer's own absolute
 * paths here, because Claude's file tools need absolute paths.
 *
 * Only the main conversation is rebuilt (subagent transcripts are not needed to resume).
 * Thinking blocks without text are dropped, every tool_use keeps its tool_result, and the
 * parent chain is re-linked over the records that survive.
 */
export interface Reconstructed {
  lines: string[];
  records: number;
  skipped: number;
}

type Block = Record<string, unknown>;

function baseId(id: string): string {
  return id.split("#")[0]!;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export function reconstructTranscript(
  sessionId: string,
  events: Event[],
  cwd: string,
  version = "yolo-twice",
  home = os.homedir(),
  /** Absolute path of a stored image (pasted images are put back into their prompt). */
  imageFile: (file: string) => string | undefined = () => undefined,
): Reconstructed {
  const expand = (t: string) => expandPaths(t, { root: cwd, home });
  const main = events.filter((e) => e.agent_id == null);
  // group block events back into their original records, in arrival order
  const order: string[] = [];
  const groups = new Map<string, Event[]>();
  for (const e of main) {
    const b = baseId(e.id);
    if (!groups.has(b)) {
      groups.set(b, []);
      order.push(b);
    }
    groups.get(b)!.push(e);
  }

  const lines: string[] = [];
  const written = new Set<string>();
  let skipped = 0;
  let title: string | undefined;
  let lastWritten: string | null = null;

  const resolveParent = (p: string | null): string | null => {
    // walk up the stored chain until we hit a record we actually wrote
    let cur = p ? baseId(p) : null;
    const seen = new Set<string>();
    while (cur && !written.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      const g = groups.get(cur);
      const first = g?.[0];
      cur = first?.parent ? baseId(first.parent) : null;
    }
    return cur && written.has(cur) ? cur : lastWritten;
  };

  for (const id of order) {
    const evs = groups.get(id)!;
    const first = evs[0]!;
    if (first.kind === "title") {
      title = first.text || title;
      continue;
    }
    let type: "user" | "assistant" | undefined;
    const blocks: Block[] = [];
    let compaction = false;
    for (const e of evs) {
      switch (e.kind) {
        case "user.prompt":
          type = "user";
          const before = blocks.length;
          for (const img of (e.data?.images ?? []) as ImageRef[]) {
            const f = img.file && imageFile(img.file);
            if (f) blocks.push({ type: "image", source: { type: "base64", media_type: img.media_type, data: fs.readFileSync(f).toString("base64") } });
          }
          if (e.text !== "[image]" || blocks.length === before) blocks.push({ type: "text", text: expand(e.text) });
          break;
        case "compaction":
          type = "user";
          compaction = true;
          blocks.push({ type: "text", text: expand(e.text) });
          break;
        case "tool.result":
          type = "user";
          blocks.push({ type: "tool_result", tool_use_id: e.tool?.call_id ?? "", content: expand(e.text), ...(e.data?.is_error ? { is_error: true } : {}) });
          break;
        case "assistant.text":
          type = "assistant";
          blocks.push({ type: "text", text: expand(e.text) });
          break;
        case "tool.call":
          type = "assistant";
          blocks.push({ type: "tool_use", id: e.tool?.call_id ?? "", name: e.tool?.name ?? "", input: mapStrings(safeJson(e.text), expand) });
          break;
        case "assistant.thinking":
          type = type ?? "assistant";
          if (e.text) blocks.push({ type: "thinking", thinking: expand(e.text) });
          break;
        default:
          break; // system, cost, meta, user.command, subagent.*: not part of the API conversation
      }
    }
    if (!type || blocks.length === 0) {
      skipped++;
      continue;
    }
    const rec: Record<string, unknown> = {
      parentUuid: resolveParent(first.parent),
      isSidechain: false,
      userType: "external",
      entrypoint: "cli",
      cwd,
      sessionId,
      version,
      type,
      message:
        type === "user"
          ? { role: "user", content: blocks }
          : { role: "assistant", model: first.model ?? "claude", content: blocks, ...(first.usage ? { usage: { input_tokens: first.usage.input_tokens ?? 0, output_tokens: first.usage.output_tokens ?? 0 } } : {}) },
      uuid: id,
      timestamp: first.ts,
    };
    if (compaction) rec.isCompactSummary = true;
    lines.push(JSON.stringify(rec));
    written.add(id);
    lastWritten = id;
  }
  if (title) lines.unshift(JSON.stringify({ type: "custom-title", customTitle: `${title} (resumed via yolo-twice)`, sessionId }));
  return { lines, records: written.size, skipped };
}

export interface ResumeResult {
  session: string;
  transcript: string;
  records: number;
  command: string[];
}

/**
 * Rebuild the transcript into the gitignored cache and return the command that continues it.
 * `--fork-session` gives the continuation a new session id: the committed session never gets a
 * second writer, so resuming a teammate's session cannot cause merge conflicts in .yolo-twice.
 * Nothing is written to ~/.claude: Claude Code resumes straight from the transcript path.
 */
export function prepareResume(store: Store, projectRoot: string, session?: string, home = os.homedir()): ResumeResult {
  const index = store.readProjectIndex();
  const ids = store.listSessions();
  const id = session ? (ids.find((s) => s === session) ?? ids.find((s) => s.startsWith(session))) : (index?.sessions.at(-1)?.id ?? ids.at(-1));
  if (!id) throw new Error(session ? `no session ${session} in .yolo-twice` : "no session in .yolo-twice to resume");
  const events = store.readEvents(id);
  if (events.length === 0) throw new Error(`session ${id} has no events in .yolo-twice`);
  const dir = path.join(store.cacheDir(), "resume");
  const transcript = path.join(dir, `${id}.jsonl`);
  const rebuilt = reconstructTranscript(id, events, projectRoot, "yolo-twice", home, (f) => store.imageFile(id, f));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(transcript, rebuilt.lines.join("\n") + "\n", { mode: 0o600 });
  return { session: id, transcript, records: rebuilt.records, command: ["claude", "--resume", transcript, "--fork-session"] };
}
