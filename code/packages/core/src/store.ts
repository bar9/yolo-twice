import fs from "node:fs";
import path from "node:path";
import { readJson, stableStringify, writeFileAtomic, writeJsonAtomic } from "./json.js";
import { yoloDir } from "./paths.js";
import { Config, DEFAULT_CONFIG, type Event, type ProjectIndex, type SourceState, type StructureNode } from "./schema.js";

const GITIGNORE = "# runtime state, never commit\ncache/\nengine.json\n";

/** The project-local .yolo-twice folder. All writes are atomic and deterministic. */
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
    if (!fs.existsSync(this.configFile)) this.writeConfig(DEFAULT_CONFIG);
  }

  get configFile(): string {
    return path.join(this.dir, "config.json");
  }

  readConfig(): Config {
    const raw = readJson<unknown>(this.configFile);
    const parsed = Config.safeParse(raw);
    return parsed.success ? parsed.data : DEFAULT_CONFIG;
  }

  writeConfig(config: Config): void {
    writeJsonAtomic(this.configFile, config);
  }

  sessionDir(session: string): string {
    return path.join(this.dir, "sessions", session);
  }

  listSessions(): string[] {
    const dir = path.join(this.dir, "sessions");
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, "events.ndjson")))
      .map((d) => d.name)
      .sort();
  }

  /* ---- source cursor ---- */
  readSourceState(session: string): SourceState | undefined {
    return readJson<SourceState>(path.join(this.sessionDir(session), "source.json"));
  }

  writeSourceState(session: string, state: SourceState): void {
    writeJsonAtomic(path.join(this.sessionDir(session), "source.json"), state);
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

  textDir(session: string): string {
    return path.join(this.sessionDir(session), "text");
  }

  writeProjectIndex(index: ProjectIndex): void {
    writeJsonAtomic(path.join(this.dir, "project.json"), index);
  }

  readProjectIndex(): ProjectIndex | undefined {
    return readJson<ProjectIndex>(path.join(this.dir, "project.json"));
  }

  cacheDir(): string {
    return path.join(this.dir, "cache");
  }
}
