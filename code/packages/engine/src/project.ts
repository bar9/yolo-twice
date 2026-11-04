import fs from "node:fs";
import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { claudeProjectDir, ingestProject, Store, type Config, type Event, type StructureNode } from "@yolo-twice/core";
import { isOpenNode,
  ClaudeCliSummarizer,
  decorate,
  deriveProject,
  deriveSession,
  findNode,
  nodeFullText,
  planJobs,
  SearchIndex,
  StructuralSummarizer,
  summarizeNode,
  TextCache,
  type SemanticJob,
  type Summarizer,
  type TextArtifact,
} from "@yolo-twice/analyzers";
import { AuthorIndex } from "./authors.js";
import { ForkIndex } from "./forks.js";
import { AutoCommitter } from "./autocommit.js";
import { SharingIndex } from "./visibility.js";
import { lastActiveSession } from "./resume.js";

export type Broadcast = (event: string, data: unknown) => void;

export interface ProjectOptions {
  originDir?: string; // test override for the Claude Code project folder
  watch?: boolean;
  autoCommitMs?: number; // test override for the auto-commit interval
  log?: (msg: string) => void;
}

function hasClaudeCli(): boolean {
  const dirs = (process.env.PATH ?? "").split(path.delimiter);
  return dirs.some((d) => d && fs.existsSync(path.join(d, "claude")));
}

/** Runtime for one registered project: store, ingest debounce, watcher, search index and semantic queue. */
export class ProjectRuntime {
  readonly store: Store;
  readonly originDir: string;
  readonly name: string;
  search = new SearchIndex();
  private timer: NodeJS.Timeout | undefined;
  private watcher: FSWatcher | undefined;
  private queue: SemanticJob[] = [];
  private running = false;
  private indexedCount = new Map<string, number>();
  private summarizer: Summarizer;
  private readonly structural = new StructuralSummarizer();
  readonly autoCommit: AutoCommitter;
  readonly authors: AuthorIndex;
  readonly forks: ForkIndex;
  readonly sharing: SharingIndex;
  private gitWatcher: FSWatcher | undefined;

  constructor(
    readonly root: string,
    private readonly broadcast: Broadcast,
    private readonly opts: ProjectOptions = {},
  ) {
    this.store = new Store(root);
    this.store.ensure();
    this.originDir = opts.originDir ?? claudeProjectDir(root);
    this.name = path.basename(root);
    const cfg = this.store.readConfig();
    this.summarizer = hasClaudeCli() && cfg.analyzers.semantic && !process.env.YOLO_TWICE_NO_LLM ? new ClaudeCliSummarizer({ model: cfg.analyzers.model }) : this.structural;
    this.forks = new ForkIndex(this.store);
    this.authors = new AuthorIndex(this.store.dir, () => this.forks.get());
    this.sharing = new SharingIndex(this.store, root, broadcast, (m) => this.log(m));
    // the folders must match the rule before anything is committed
    this.autoCommit = new AutoCommitter(root, this.store.dir, (st) => broadcast("autocommit", st), (m) => this.log(m), opts.autoCommitMs, async () => {
      await this.sharing.refresh();
    });
    // warm the search index from what is already on disk
    for (const id of this.store.listSessions()) this.indexSession(id);
  }

  private log(msg: string): void {
    this.opts.log?.(`[${this.name}] ${msg}`);
  }

  private indexSession(id: string): Event[] {
    const events = this.store.readEvents(id);
    const seen = this.indexedCount.get(id) ?? 0;
    if (events.length > seen) {
      this.search.add(events.slice(seen));
      this.indexedCount.set(id, events.length);
    }
    return events;
  }

  start(): void {
    if (this.opts.watch === false || this.watcher) return;
    // a remote can be added at any time: re-classify when git's config changes
    const gitConfig = this.sharing.gitConfigFile();
    if (gitConfig) {
      this.gitWatcher = chokidar.watch(gitConfig, { ignoreInitial: true });
      this.gitWatcher.on("all", () => void this.sharing.refresh().catch((e: Error) => this.log(`sharing check failed: ${e.message}`)));
    }
    if (!fs.existsSync(this.originDir)) fs.mkdirSync(this.originDir, { recursive: true });
    this.watcher = chokidar.watch(this.originDir, { ignoreInitial: true, depth: 3, awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 } });
    this.watcher.on("all", (ev, file) => {
      if (file.endsWith(".jsonl") || file.endsWith(".meta.json")) this.schedule(`watch:${ev}`);
    });
    this.schedule("start");
  }

  async stop(): Promise<void> {
    clearTimeout(this.timer);
    this.autoCommit.stop();
    await this.watcher?.close();
    await this.gitWatcher?.close();
    this.watcher = undefined;
    this.gitWatcher = undefined;
  }

  /** Debounced ingest. Safe to call from hooks and watcher at any rate. */
  schedule(reason: string, session?: string): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      try {
        this.ingest(session);
      } catch (e) {
        this.log(`ingest failed (${reason}): ${(e as Error).message}`);
      }
    }, 300);
  }

  /** Synchronous ingest + derive. Returns changed session ids. */
  ingest(session?: string): string[] {
    const res = ingestProject({ cwd: this.root, store: this.store, originDir: this.originDir, session });
    const changed = [...new Set([...res.changed, ...res.reset])];
    if (res.reset.length) {
      // a rebuilt session reuses its event ids with new content: the search index must start over
      this.search = new SearchIndex();
      this.indexedCount.clear();
      for (const id of this.store.listSessions()) if (!changed.includes(id)) this.indexSession(id);
    }
    for (const id of changed) {
      this.broadcast("ingest", { session: id, appended: res.appended[id] ?? 0 });
      if (res.reset.includes(id)) this.indexedCount.delete(id);
      this.indexSession(id);
      const built = deriveSession(this.store, id);
      this.broadcast("structure", { session: id });
      this.enqueue(built.session, id);
    }
    if (changed.length) deriveProject(this.store, this.name);
    else if (!this.store.readProjectIndex()) deriveProject(this.store, this.name);
    if (changed.length || !this.sharing.get()) void this.sharing.refresh().catch((e: Error) => this.log(`sharing check failed: ${e.message}`));
    return changed;
  }

  config(): Config {
    return this.store.readConfig();
  }

  setAttention(attention: Config["attention"]): Config {
    // the slider is personal: it goes to the gitignored local.json, the team config stays untouched
    this.store.writeLocalConfig({ attention });
    const cfg = this.store.readConfig();
    this.broadcast("config", cfg);
    return cfg;
  }

  /** Session with the latest activity (by the time of its last event). */
  currentSession(): string | undefined {
    return lastActiveSession(this.store);
  }

  /* ---------- semantic ---------- */

  private enqueue(structure: StructureNode, session: string): void {
    const cfg = this.store.readConfig();
    if (!cfg.analyzers.semantic) return;
    const lastPhase = structure.children.at(-1);
    const openTurn = lastPhase?.children.at(-1)?.id;
    const jobs = planJobs(structure, cfg.attention, openTurn).map((j) => ({ ...j, session }));
    for (const j of jobs) {
      if (!this.queue.some((q) => q.node.id === j.node.id && q.granularity === j.granularity && (q as { session?: string }).session === session)) this.queue.push(j as SemanticJob);
    }
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const job = this.queue.shift()! as SemanticJob & { session: string };
        try {
          await this.summarize(job.session, job);
        } catch (e) {
          this.log(`semantic job failed: ${(e as Error).message}`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async summarize(session: string, job: SemanticJob): Promise<TextArtifact> {
    const events = this.store.readEvents(session);
    const byId = new Map(events.map((e) => [e.id, e]));
    const cache = new TextCache(() => this.store.textDir(session), this.store.openTextDir(session), () => this.store.writableTextDir(session));
    const root = this.store.readStructure(session);
    if (root) job = { ...job, open: isOpenNode(job.node, root) };
    let artifact: TextArtifact;
    try {
      artifact = await summarizeNode(job, byId, cache, this.summarizer);
    } catch (e) {
      this.log(`summarizer ${this.summarizer.name} failed, using structural: ${(e as Error).message}`);
      artifact = await summarizeNode(job, byId, cache, this.structural);
    }
    // keep structure.json decorated
    const s = this.store.readStructure(session);
    if (s) this.store.writeStructure(session, decorate(s, cache));
    this.broadcast("semantic", { session, node: job.node.id, granularity: job.granularity, interim: !!job.interim, analyzer: artifact.analyzer });
    return artifact;
  }

  /** On-demand text for one node. */
  async text(session: string, nodeId: string, granularity: "title" | "abstract" | "summary"): Promise<TextArtifact | undefined> {
    const s = this.store.readStructure(session);
    const node = s && findNode(s, nodeId);
    if (!node) return undefined;
    return this.summarize(session, { node, granularity, interim: false });
  }

  /** Catch me up: summarize events after `since`. */
  async digest(session: string, since?: string): Promise<{ since: string | null; until: string | null; events: number; text: string }> {
    const events = this.store.readEvents(session);
    const idx = since ? events.findIndex((e) => e.id === since) : -1;
    const slice = events.slice(idx + 1).filter((e) => e.kind !== "meta" && e.kind !== "cost");
    if (slice.length === 0) return { since: since ?? null, until: null, events: 0, text: "Nothing happened since then." };
    const fake: StructureNode = {
      id: `digest:${since ?? "start"}`,
      level: 1,
      kind: "phase",
      label: "digest",
      span: { first: slice[0]!.id, last: slice.at(-1)!.id, ts_first: slice[0]!.ts, ts_last: slice.at(-1)!.ts },
      event_ids: slice.map((e) => e.id),
      children: [],
      stats: { events: slice.length, tool_calls: 0, input_tokens: 0, output_tokens: 0 },
    };
    const byId = new Map(events.map((e) => [e.id, e]));
    const text = nodeFullText(fake, byId);
    let out: string;
    try {
      out = await this.summarizer.summarize({ granularity: "summary", text, kind: "phase", label: "what happened since you last looked" });
    } catch {
      out = await this.structural.summarize({ granularity: "summary", text, kind: "phase" });
    }
    return { since: since ?? null, until: slice.at(-1)!.id, events: slice.length, text: out };
  }
}
