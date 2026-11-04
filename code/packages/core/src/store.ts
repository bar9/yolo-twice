import fs from "node:fs";
import path from "node:path";
import { readJson, sha256, stableStringify, writeFileAtomic, writeJsonAtomic } from "./json.js";
import { yoloDir } from "./paths.js";
import { Config, DEFAULT_CONFIG, type Event, type ImageRef, type ProjectIndex, type SourceState, type StructureNode } from "./schema.js";

/**
 * Layout rule: one writer per committed file. Everything committed belongs to exactly one session
 * (sessions/<id>/...) or is a team setting (config.json). Anything that combines sessions, any
 * machine state and any personal preference lives in gitignored files and is rebuilt locally.
 */
const GITIGNORE = "# machine state and personal settings, never commit\ncache/\nengine.json\nlocal.json\n";
const GITIGNORE_LINES = ["cache/", "engine.json", "local.json"];

/** Per-session summary used for the project list. Committed: one session, one writer. */
export interface SessionMeta {
  id: string;
  agent: string;
  label: string;
  ts_first: string;
  ts_last: string;
  events: number;
  /** Tokens in and out. */
  tokens?: number;
  cost_usd?: number;
}

/** A session's explicit sharing decision: shared is committed with the project, private never leaves this machine. */
export type SessionDecision = "shared" | "private";

/** Personal overrides of config.json and personal decisions, never committed. */
export type LocalConfig = Partial<Pick<Config, "attention">> & { visibility?: Record<string, SessionDecision> };

/** The project-local .yolo-twice folder. All writes are atomic and deterministic. */
const IMAGE_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

export class Store {
  readonly dir: string;
  /** Known event ids per session, with the file size they were read at (another writer changes it). */
  private idCache = new Map<string, { ids: Set<string>; size: number }>();

  constructor(readonly projectRoot: string) {
    this.dir = yoloDir(projectRoot);
  }

  ensure(): void {
    fs.mkdirSync(path.join(this.dir, "sessions"), { recursive: true });
    fs.mkdirSync(path.join(this.dir, "cache"), { recursive: true });
    const gi = path.join(this.dir, ".gitignore");
    if (!fs.existsSync(gi)) writeFileAtomic(gi, GITIGNORE);
    else {
      const cur = fs.readFileSync(gi, "utf8");
      const missing = GITIGNORE_LINES.filter((l) => !cur.split("\n").includes(l));
      if (missing.length) writeFileAtomic(gi, cur.replace(/\n?$/, "\n") + missing.join("\n") + "\n");
    }
    if (!fs.existsSync(this.configFile)) this.writeConfig(DEFAULT_CONFIG);
    this.migrateLayout();
  }

  /** Move files of the first layout out of the committed tree (idempotent). */
  private migrateLayout(): void {
    const legacyProject = path.join(this.dir, "project.json");
    if (fs.existsSync(legacyProject)) fs.rmSync(legacyProject);
    for (const id of this.listSessions()) {
      const legacy = path.join(this.sessionDir(id), "source.json");
      if (!fs.existsSync(legacy)) continue;
      if (!fs.existsSync(this.sourceFile(id))) {
        fs.mkdirSync(path.dirname(this.sourceFile(id)), { recursive: true });
        fs.renameSync(legacy, this.sourceFile(id));
      } else fs.rmSync(legacy);
    }
  }

  get configFile(): string {
    return path.join(this.dir, "config.json");
  }

  get localConfigFile(): string {
    return path.join(this.dir, "local.json");
  }

  /** Team config (committed) with this user's local overrides on top. */
  readConfig(): Config {
    const parsed = Config.safeParse(readJson<unknown>(this.configFile));
    const team = parsed.success ? parsed.data : DEFAULT_CONFIG;
    const local = readJson<LocalConfig>(this.localConfigFile) ?? {};
    const attention = Config.shape.attention.safeParse(local.attention);
    return attention.success ? { ...team, attention: attention.data } : team;
  }

  /** Personal settings such as the attention slider: never committed, never conflicting. */
  writeLocalConfig(patch: LocalConfig): void {
    writeJsonAtomic(this.localConfigFile, { ...(readJson<LocalConfig>(this.localConfigFile) ?? {}), ...patch });
  }

  /** The sessions the user decided on explicitly; the rest follow the project's default. */
  readDecisions(): Record<string, SessionDecision> {
    const v = readJson<LocalConfig>(this.localConfigFile)?.visibility ?? {};
    return Object.fromEntries(Object.entries(v).filter(([id, d]) => isSafeSessionId(id) && (d === "shared" || d === "private")));
  }

  writeDecision(session: string, decision: SessionDecision): void {
    this.writeLocalConfig({ visibility: { ...this.readDecisions(), [safeSessionId(session)]: decision } });
  }

  writeConfig(config: Config): void {
    writeJsonAtomic(this.configFile, config);
  }

  sessionDir(session: string): string {
    return path.join(this.dir, "sessions", safeSessionId(session));
  }

  /** Pasted images of a session, named by content hash: the same image is stored once, rebuilds rewrite nothing. */
  imagesDir(session: string): string {
    return path.join(this.sessionDir(session), "images");
  }

  writeImage(session: string, media_type: string, base64: string): ImageRef {
    const buf = Buffer.from(base64, "base64");
    const file = `${sha256(buf).slice(0, 16)}.${IMAGE_EXT[media_type] ?? "bin"}`;
    const target = path.join(this.imagesDir(session), file);
    if (!fs.existsSync(target)) {
      fs.mkdirSync(this.imagesDir(session), { recursive: true });
      fs.writeFileSync(target, buf);
    }
    return { file, media_type, bytes: buf.length };
  }

  /** Absolute path of a stored image, or undefined when the name is not one we write. */
  imageFile(session: string, file: string): string | undefined {
    if (!/^[0-9a-f]{16}\.(png|jpg|gif|webp)$/.test(file)) return undefined;
    const p = path.join(this.imagesDir(session), file);
    return fs.existsSync(p) ? p : undefined;
  }

  listSessions(): string[] {
    const dir = path.join(this.dir, "sessions");
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir, { withFileTypes: true })
      // a folder whose name is not a usable id (e.g. a manual "x (copy)") is skipped, not a crash later
      .filter((d) => d.isDirectory() && isSafeSessionId(d.name) && fs.existsSync(path.join(dir, d.name, "events.ndjson")))
      .map((d) => d.name)
      .sort();
  }

  /* ---- source cursor ---- */
  /** The ingestion cursor is machine state: it lives in the cache, not in the session folder. */
  sourceFile(session: string): string {
    return path.join(this.dir, "cache", "sources", `${safeSessionId(session)}.json`);
  }

  readSourceState(session: string): SourceState | undefined {
    return readJson<SourceState>(this.sourceFile(session)) ?? readJson<SourceState>(path.join(this.sessionDir(session), "source.json"));
  }

  writeSourceState(session: string, state: SourceState): void {
    writeJsonAtomic(this.sourceFile(session), state);
  }

  /* ---- events ---- */
  eventsFile(session: string): string {
    return path.join(this.sessionDir(session), "events.ndjson");
  }

  /** Events in append order. A repeated id keeps its first occurrence, so a damaged file reads clean. */
  readEvents(session: string): Event[] {
    const file = this.eventsFile(session);
    if (!fs.existsSync(file)) return [];
    const out: Event[] = [];
    const seen = new Set<string>();
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (!line) continue;
      try {
        const e = JSON.parse(line) as Event;
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        out.push(e);
      } catch {
        /* skip corrupt line */
      }
    }
    return out;
  }

  private fileSize(file: string): number {
    try {
      return fs.statSync(file).size;
    } catch {
      return 0;
    }
  }

  private knownIds(session: string): Set<string> {
    const size = this.fileSize(this.eventsFile(session));
    let cached = this.idCache.get(session);
    if (!cached || cached.size !== size) {
      // first use, or someone else appended: reload from disk
      cached = { ids: new Set(this.readEvents(session).map((e) => e.id)), size };
      this.idCache.set(session, cached);
    }
    return cached.ids;
  }

  /** Append events whose id is not yet present (on disk or earlier in the batch). Returns the number written. */
  appendEvents(session: string, events: Event[]): number {
    const known = this.knownIds(session);
    const fresh: Event[] = [];
    for (const e of events) {
      if (known.has(e.id)) continue;
      known.add(e.id);
      fresh.push(e);
    }
    if (fresh.length === 0) return 0;
    fs.mkdirSync(this.sessionDir(session), { recursive: true });
    const payload = fresh.map((e) => stableStringify(e, false)).join("\n") + "\n";
    fs.appendFileSync(this.eventsFile(session), payload);
    this.idCache.get(session)!.size = this.fileSize(this.eventsFile(session));
    return fresh.length;
  }

  /**
   * Run `fn` holding an exclusive per-session lock, so two engines (or an engine and `yolo-twice index`)
   * never interleave cursor reads and appends. The lock lives in the gitignored cache and a lock older
   * than `staleMs` is taken over (its holder crashed).
   */
  withSessionLock<T>(session: string, fn: () => T, staleMs = 30_000, waitMs = 5_000): T {
    const dir = this.cacheDir();
    fs.mkdirSync(dir, { recursive: true });
    const lock = path.join(dir, `${session}.lock`);
    const deadline = Date.now() + waitMs;
    for (;;) {
      try {
        fs.closeSync(fs.openSync(lock, "wx"));
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        const age = Date.now() - (fs.statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? 0);
        if (age > staleMs) {
          fs.rmSync(lock, { force: true });
          continue;
        }
        if (Date.now() > deadline) throw new Error(`session ${session} is locked by another writer (${lock})`);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25); // sync sleep
      }
    }
    try {
      return fn();
    } finally {
      fs.rmSync(lock, { force: true });
    }
  }

  /** Drop a session's derived and event files (used when the source file was replaced). */
  resetSession(session: string): void {
    fs.rmSync(this.sessionDir(session), { recursive: true, force: true });
    fs.rmSync(this.sourceFile(session), { force: true });
    fs.rmSync(this.openTextDir(session), { recursive: true, force: true });
    this.idCache.delete(session);
  }

  /* ---- derived ---- */
  writeStructure(session: string, node: StructureNode): void {
    writeJsonAtomic(path.join(this.sessionDir(session), "structure.json"), node);
  }

  readStructure(session: string): StructureNode | undefined {
    return readJson<StructureNode>(path.join(this.sessionDir(session), "structure.json"));
  }

  writeGraph(session: string, mermaid: string, level = 2): void {
    const name = level === 2 ? "graph.mmd" : `graph.L${level}.mmd`;
    writeFileAtomic(path.join(this.sessionDir(session), name), mermaid.endsWith("\n") ? mermaid : mermaid + "\n");
  }

  readGraph(session: string, level = 2): string | undefined {
    const name = level === 2 ? "graph.mmd" : `graph.L${level}.mmd`;
    try {
      return fs.readFileSync(path.join(this.sessionDir(session), name), "utf8");
    } catch {
      return undefined;
    }
  }

  /** Summaries of finished nodes: committed, their input can no longer change. */
  textDir(session: string): string {
    return path.join(this.sessionDir(session), "text");
  }

  /** Summaries of nodes still at the live tail: they change every turn, so they stay local. */
  openTextDir(session: string): string {
    return path.join(this.dir, "cache", "text", safeSessionId(session));
  }

  writeSessionMeta(meta: SessionMeta): void {
    writeJsonAtomic(path.join(this.sessionDir(meta.id), "meta.json"), meta);
  }

  /** Session summary from meta.json, or from structure.json for folders written before meta existed. */
  readSessionMeta(session: string): SessionMeta | undefined {
    const meta = readJson<SessionMeta>(path.join(this.sessionDir(session), "meta.json"));
    // meta written before tokens were counted: the structure has them
    if (meta && meta.tokens !== undefined) return meta;
    const s = this.readStructure(session);
    if (!s) return meta;
    const tokens = s.stats.input_tokens + s.stats.output_tokens;
    return meta ? { ...meta, tokens } : { id: session, agent: "claude-code", label: s.label, ts_first: s.span.ts_first, ts_last: s.span.ts_last, events: s.stats.events, tokens, cost_usd: s.stats.cost_usd };
  }

  get projectIndexFile(): string {
    return path.join(this.dir, "cache", "project.json");
  }

  /** The project list combines every session, so it is local: rebuilt from the per-session meta files. */
  writeProjectIndex(index: ProjectIndex): void {
    writeJsonAtomic(this.projectIndexFile, index);
  }

  readProjectIndex(): ProjectIndex | undefined {
    const cached = readJson<ProjectIndex>(this.projectIndexFile);
    // a list cached before tokens were counted is rebuilt
    return cached?.sessions.every((s) => s.tokens !== undefined) ? cached : this.buildProjectIndex();
  }

  /** Project list straight from the session folders (a fresh clone has no cache yet). */
  buildProjectIndex(name = path.basename(this.projectRoot)): ProjectIndex | undefined {
    const sessions = this.listSessions()
      .map((id) => this.readSessionMeta(id))
      .filter((m): m is SessionMeta => Boolean(m))
      .sort((a, b) => a.ts_first.localeCompare(b.ts_first) || a.id.localeCompare(b.id));
    if (sessions.length === 0) return undefined;
    return { version: 1, project: name, sessions: sessions.map((m) => ({ id: m.id, agent: m.agent, label: m.label, ts_first: m.ts_first, ts_last: m.ts_last, events: m.events, tokens: m.tokens, cost_usd: m.cost_usd })) };
  }

  cacheDir(): string {
    return path.join(this.dir, "cache");
  }
}

/** A session id is one path segment: never a separator or `..`, so a request cannot leave the sessions folder. */
export function isSafeSessionId(id: string): boolean {
  return /^[\w.-]+$/.test(id) && id !== "." && id !== "..";
}
function safeSessionId(id: string): string {
  if (!isSafeSessionId(id)) throw new Error(`invalid session id: ${JSON.stringify(id)}`);
  return id;
}
