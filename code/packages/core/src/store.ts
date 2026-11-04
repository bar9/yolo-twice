import fs from "node:fs";
import path from "node:path";
import { readJson, sha256, stableStringify, writeFileAtomic, writeJsonAtomic } from "./json.js";
import { yoloDir } from "./paths.js";
import { Config, DEFAULT_CONFIG, type Event, type ImageRef, type ProjectIndex, type SourceState, type StructureNode } from "./schema.js";

/**
 * Layout rule: one writer per committed file. Everything committed belongs to exactly one session
 * (sessions/<id>/...) or is a team setting (config.json). Anything that combines sessions, any
 * machine state and any personal preference lives in gitignored files and is rebuilt locally.
 *
 * A session lives in one of two folders, and the folder decides whether it reaches git:
 * sessions/<id>/ is committed with the project, private/sessions/<id>/ is gitignored and never
 * leaves this machine. While the project does not share (see sharing.ts in the engine), nothing
 * under sessions/ is written: a committed session that gets new content here is copied to
 * private/ once and continued there, so the committed copy stays exactly as pulled.
 */
const GITIGNORE = "# machine state, personal settings and private sessions, never commit\ncache/\nengine.json\nlocal.json\nprivate/\n";
const GITIGNORE_LINES = ["cache/", "engine.json", "local.json", "private/"];

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

/**
 * Where a session's content is. shared: in sessions/, committed with the project. private: only on
 * this machine. private-additions: committed, and continued here with content that stays here.
 */
export type SessionPlace = "shared" | "private" | "private-additions";

/** Personal overrides of config.json, never committed. */
export type LocalConfig = Partial<Pick<Config, "attention">> & {
  /** sessions made private in 0.1.5: they stay in private/ even when the project shares */
  keep_private?: string[];
  /** 0.1.5's per-session decisions, read once by the migration and then removed */
  visibility?: Record<string, "shared" | "private">;
};

/** The project-local .yolo-twice folder. All writes are atomic and deterministic. */
const IMAGE_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

export class Store {
  readonly dir: string;
  /** Known event ids per session, with the file size they were read at (another writer changes it). */
  private idCache = new Map<string, { ids: Set<string>; size: number }>();
  /** Whether new content may go to sessions/. Set by the engine; until then it does not (fail-safe). */
  private shares: boolean;
  private keep: Set<string>;

  constructor(readonly projectRoot: string) {
    this.dir = yoloDir(projectRoot);
    // the engine's last answer, so a CLI run (yolo-twice index) follows the same rule
    this.shares = readJson<{ shares?: boolean }>(this.sharingFile)?.shares === true;
    this.keep = new Set(this.readKeepPrivate());
  }

  private get sharingFile(): string {
    return path.join(this.dir, "cache", "sharing.json");
  }

  get sharing(): boolean {
    return this.shares;
  }

  /** Called by the engine whenever the project's sharing state is known (again). */
  setSharing(shares: boolean): void {
    if (shares !== this.shares || readJson<{ shares?: boolean }>(this.sharingFile)?.shares !== shares) writeJsonAtomic(this.sharingFile, { shares });
    this.shares = shares;
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

  private readKeepPrivate(): string[] {
    const k = readJson<LocalConfig>(this.localConfigFile)?.keep_private;
    return Array.isArray(k) ? k.filter((id) => typeof id === "string" && isSafeSessionId(id)) : [];
  }

  /** Sessions that stay in private/ even when the project shares. */
  keptPrivate(): Set<string> {
    return new Set(this.keep);
  }

  /**
   * 0.1.5 stored a decision per session. Read them once: the private ones are kept private for
   * good, the key is removed. Returns the decisions found (empty when there is nothing to migrate).
   */
  takeLegacyDecisions(): Record<string, "shared" | "private"> {
    const local = readJson<LocalConfig>(this.localConfigFile);
    if (!local?.visibility) return {};
    const found = Object.fromEntries(Object.entries(local.visibility).filter(([id, d]) => isSafeSessionId(id) && (d === "shared" || d === "private")));
    const keep = [...new Set([...this.readKeepPrivate(), ...Object.keys(found).filter((id) => found[id] === "private")])].sort();
    const { visibility: _old, ...rest } = local;
    writeJsonAtomic(this.localConfigFile, { ...rest, ...(keep.length ? { keep_private: keep } : {}) });
    this.keep = new Set(keep);
    return found;
  }

  writeConfig(config: Config): void {
    writeJsonAtomic(this.configFile, config);
  }

  /** The committed folder of a session, whether it exists or not. */
  sharedDir(session: string): string {
    return path.join(this.dir, "sessions", safeSessionId(session));
  }

  /** The gitignored folder of a session, whether it exists or not. */
  privateDir(session: string): string {
    return path.join(this.dir, "private", "sessions", safeSessionId(session));
  }

  /** Where a session is read from: its private copy when there is one. */
  sessionDir(session: string): string {
    const priv = this.privateDir(session);
    return fs.existsSync(priv) ? priv : this.sharedDir(session);
  }

  /**
   * Where new content of a session goes. A private copy always takes it. Otherwise sessions/ when
   * the project shares, else a private copy, made first from the committed folder when there is one.
   */
  writableDir(session: string): string {
    const priv = this.privateDir(session);
    if (fs.existsSync(priv)) return priv;
    const shared = this.sharedDir(session);
    if (this.shares && !this.keep.has(session)) {
      fs.mkdirSync(shared, { recursive: true });
      return shared;
    }
    fs.mkdirSync(path.dirname(priv), { recursive: true });
    if (fs.existsSync(shared)) {
      // copy, then rename: a half-made copy is never taken for the session
      const tmp = `${priv}.${process.pid}.tmp`;
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.cpSync(shared, tmp, { recursive: true });
      fs.renameSync(tmp, priv);
    } else fs.mkdirSync(priv, { recursive: true });
    this.idCache.delete(session);
    return priv;
  }

  /** shared, private, or private-additions (committed, with more events here than in the committed copy). */
  place(session: string): SessionPlace {
    const priv = path.join(this.privateDir(session), "events.ndjson");
    if (!fs.existsSync(priv)) return "shared";
    const shared = path.join(this.sharedDir(session), "events.ndjson");
    if (this.keep.has(session) || !fs.existsSync(shared)) return "private";
    return this.fileSize(priv) !== this.fileSize(shared) ? "private-additions" : "shared";
  }

  /** Sessions with a folder in sessions/, private/sessions/, or both. */
  listPlaced(): { shared: string[]; private: string[] } {
    return { shared: this.listIn(path.join(this.dir, "sessions")), private: this.listIn(path.join(this.dir, "private", "sessions")) };
  }

  /** Move a private copy over the committed folder: the project shares now. */
  promote(session: string): void {
    const priv = this.privateDir(session);
    if (!fs.existsSync(priv)) return;
    const shared = this.sharedDir(session);
    fs.mkdirSync(path.dirname(shared), { recursive: true });
    fs.rmSync(shared, { recursive: true, force: true });
    fs.renameSync(priv, shared);
    this.idCache.delete(session);
  }

  /**
   * Take a session's folder out of sessions/: moved when there is no private copy yet, else dropped
   * (the private copy started from it and has everything since).
   */
  demote(session: string): void {
    const shared = this.sharedDir(session);
    if (!fs.existsSync(shared)) return;
    const priv = this.privateDir(session);
    if (fs.existsSync(priv)) fs.rmSync(shared, { recursive: true, force: true });
    else {
      fs.mkdirSync(path.dirname(priv), { recursive: true });
      fs.renameSync(shared, priv);
    }
    this.idCache.delete(session);
  }

  /** Write a derived file; unchanged content writes nothing, so a frozen committed session is not copied for it. */
  private writeDerived(session: string, name: string, content: string): void {
    try {
      if (fs.readFileSync(path.join(this.sessionDir(session), name), "utf8") === content) return;
    } catch {
      /* not there yet */
    }
    writeFileAtomic(path.join(this.writableDir(session), name), content);
  }

  /** Pasted images of a session, named by content hash: the same image is stored once, rebuilds rewrite nothing. */
  imagesDir(session: string): string {
    return path.join(this.sessionDir(session), "images");
  }

  writeImage(session: string, media_type: string, base64: string): ImageRef {
    const buf = Buffer.from(base64, "base64");
    const file = `${sha256(buf).slice(0, 16)}.${IMAGE_EXT[media_type] ?? "bin"}`;
    if (!fs.existsSync(path.join(this.imagesDir(session), file))) {
      const dir = path.join(this.writableDir(session), "images");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, file), buf);
    }
    return { file, media_type, bytes: buf.length };
  }

  /** Absolute path of a stored image, or undefined when the name is not one we write. */
  imageFile(session: string, file: string): string | undefined {
    if (!/^[0-9a-f]{16}\.(png|jpg|gif|webp)$/.test(file)) return undefined;
    const p = path.join(this.imagesDir(session), file);
    return fs.existsSync(p) ? p : undefined;
  }

  /** Every session, committed or private. */
  listSessions(): string[] {
    const { shared, private: priv } = this.listPlaced();
    return [...new Set([...shared, ...priv])].sort();
  }

  private listIn(dir: string): string[] {
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
    const file = path.join(this.writableDir(session), "events.ndjson");
    const payload = fresh.map((e) => stableStringify(e, false)).join("\n") + "\n";
    fs.appendFileSync(file, payload);
    // writableDir may have made a private copy and dropped the cache: keep the ids just written
    this.idCache.set(session, { ids: known, size: this.fileSize(file) });
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
    fs.rmSync(this.privateDir(session), { recursive: true, force: true });
    const shared = this.sharedDir(session);
    // a committed folder is only replaced where it may be written; otherwise an empty private copy takes over
    if (this.shares && !this.keep.has(session)) fs.rmSync(shared, { recursive: true, force: true });
    else if (fs.existsSync(shared)) fs.mkdirSync(this.privateDir(session), { recursive: true });
    fs.rmSync(this.sourceFile(session), { force: true });
    fs.rmSync(this.openTextDir(session), { recursive: true, force: true });
    this.idCache.delete(session);
  }

  /* ---- derived ---- */
  writeStructure(session: string, node: StructureNode): void {
    this.writeDerived(session, "structure.json", stableStringify(node) + "\n");
  }

  readStructure(session: string): StructureNode | undefined {
    return readJson<StructureNode>(path.join(this.sessionDir(session), "structure.json"));
  }

  writeGraph(session: string, mermaid: string, level = 2): void {
    const name = level === 2 ? "graph.mmd" : `graph.L${level}.mmd`;
    this.writeDerived(session, name, mermaid.endsWith("\n") ? mermaid : mermaid + "\n");
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

  /** Where a new summary goes (see writableDir). */
  writableTextDir(session: string): string {
    return path.join(this.writableDir(session), "text");
  }

  /** Summaries of nodes still at the live tail: they change every turn, so they stay local. */
  openTextDir(session: string): string {
    return path.join(this.dir, "cache", "text", safeSessionId(session));
  }

  writeSessionMeta(meta: SessionMeta): void {
    this.writeDerived(meta.id, "meta.json", stableStringify(meta) + "\n");
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
