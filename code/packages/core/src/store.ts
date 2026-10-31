import fs from "node:fs";
import path from "node:path";
import { readJson, stableStringify, writeFileAtomic, writeJsonAtomic } from "./json.js";
import { yoloDir } from "./paths.js";
import { Config, DEFAULT_CONFIG, type Event, type ProjectIndex, type SourceState, type StructureNode } from "./schema.js";

const GITIGNORE = "# runtime state, never commit\ncache/\nengine.json\n";

/** The project-local .yolo-twice folder. All writes are atomic and deterministic. */
export class Store {
  readonly dir: string;
  private idCache = new Map<string, Set<string>>();

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

  readEvents(session: string): Event[] {
    const file = this.eventsFile(session);
    if (!fs.existsSync(file)) return [];
    const out: Event[] = [];
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (!line) continue;
      try {
        out.push(JSON.parse(line) as Event);
      } catch {
        /* skip corrupt line */
      }
    }
    return out;
  }

  private knownIds(session: string): Set<string> {
    let set = this.idCache.get(session);
    if (!set) {
      set = new Set(this.readEvents(session).map((e) => e.id));
      this.idCache.set(session, set);
    }
    return set;
  }

  /** Append events whose id is not yet present. Returns the number written. */
  appendEvents(session: string, events: Event[]): number {
    const known = this.knownIds(session);
    const fresh = events.filter((e) => !known.has(e.id));
    if (fresh.length === 0) return 0;
    fs.mkdirSync(this.sessionDir(session), { recursive: true });
    const payload = fresh.map((e) => stableStringify(e, false)).join("\n") + "\n";
    fs.appendFileSync(this.eventsFile(session), payload);
    for (const e of fresh) known.add(e.id);
    return fresh.length;
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
