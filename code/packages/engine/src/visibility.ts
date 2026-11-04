import path from "node:path";
import type { SessionDecision, Store } from "@yolo-twice/core";
import { git, gitSync } from "./git.js";
import {
  classifyRemotes,
  defaultVisibility,
  ghVisibility,
  parseRemotes,
  projectClass,
  writeExcludeBlock,
  type GhLookup,
  type Sharing,
  type Visibility,
} from "./sharing.js";
import { readSettings } from "./state.js";

export interface SessionVisibility {
  visibility: Visibility;
  /** the user decided, or the session was already in git: no question to ask */
  decided: boolean;
}

export interface DecideResult extends SessionVisibility {
  sharing?: Sharing;
  /** set when a private session had been committed before */
  warning?: string;
}

/**
 * Which of a project's sessions reach git.
 *
 * A session's state is the user's decision when there is one (local.json), else shared when it is
 * already tracked in git (sessions committed before this existed stay shared, nothing is
 * untracked on upgrade), else the project's default (defaultVisibility in sharing.ts). Only
 * explicit decisions are stored, so the rest follow a changed default: adding a public remote
 * turns them private at once.
 *
 * Private and undecided sessions are listed in a managed block of the clone's own exclude file
 * (never committed), so neither auto-commit nor `git add -A` picks them up. Auto-commit adds
 * :(exclude) pathspecs as a second guard. Re-evaluated when .git/config changes (a remote can be
 * added at any time), on ingest and on every auto-commit tick. The engine never pushes.
 * Outside a git repository nothing is committed, so there is nothing to decide.
 */
export class VisibilityIndex {
  private sharing: Sharing | undefined;
  private states = new Map<string, SessionVisibility>();
  private top: string | undefined;
  private rel = "";
  private excludeFile: string | undefined;
  private excluded = new Set<string>();
  private inHead = new Set<string>();
  private located = false;
  private chain: Promise<unknown> = Promise.resolve();
  private queued: Promise<Sharing | undefined> | undefined;

  constructor(
    private readonly store: Store,
    private readonly root: string,
    private readonly broadcast: (event: string, data: unknown) => void,
    private readonly log: (msg: string) => void,
    private readonly lookup: GhLookup = ghVisibility,
  ) {}

  /** undefined outside a git repository: then nothing is ever committed and there is nothing to decide. */
  get(): Sharing | undefined {
    return this.sharing;
  }

  of(session: string): SessionVisibility | undefined {
    return this.sharing ? this.states.get(session) : undefined;
  }

  /** The git config file, to watch for added or changed remotes. */
  gitConfigFile(): string | undefined {
    const p = gitSync(this.root, ["rev-parse", "--git-path", "config"])?.trim();
    return p ? path.resolve(this.root, p) : undefined;
  }

  private locate(): boolean {
    if (!this.located) {
      this.located = true;
      this.top = gitSync(this.root, ["rev-parse", "--show-toplevel"])?.trim() || undefined;
      const ex = gitSync(this.root, ["rev-parse", "--git-path", "info/exclude"])?.trim();
      this.excludeFile = ex ? path.resolve(this.root, ex) : undefined;
      if (this.top) this.rel = path.relative(this.top, this.store.dir).split(path.sep).join("/") || ".";
    }
    return !!(this.top && this.excludeFile);
  }

  private sessionPath(id: string): string {
    return `${this.rel}/sessions/${id}`;
  }

  private writeExclude(): void {
    if (!this.excludeFile) return;
    try {
      writeExcludeBlock(this.excludeFile, [...this.excluded].map((id) => `/${this.sessionPath(id)}/`));
    } catch (e) {
      this.log(`could not write ${this.excludeFile}: ${(e as Error).message}`);
    }
  }

  /**
   * Synchronous, right after ingest: a session seen for the first time is kept out of git before
   * anything can commit it. refresh() then gives it the project's default.
   */
  guard(sessions: string[]): void {
    if (!this.locate()) return;
    const decisions = this.store.readDecisions();
    let added = false;
    for (const id of sessions) {
      if (this.states.has(id) || decisions[id] === "shared" || this.excluded.has(id)) continue;
      this.excluded.add(id);
      added = true;
    }
    if (added) this.writeExclude();
  }

  /** Re-evaluate everything. Calls are serialized; a call while one is waiting joins it. */
  refresh(): Promise<Sharing | undefined> {
    if (this.queued) return this.queued;
    const p = this.chain
      .catch(() => undefined)
      .then(() => {
        this.queued = undefined;
        return this.run();
      });
    this.queued = p;
    this.chain = p;
    return p;
  }

  private async run(): Promise<Sharing | undefined> {
    if (!this.locate()) {
      this.sharing = undefined;
      return undefined;
    }
    const top = this.top!;
    const settings = readSettings();
    const environment = settings.environment ?? "restricted";
    const remotes = await classifyRemotes(parseRemotes(await git(top, ["remote", "-v"]).catch(() => "")), settings.restricted_remotes ?? [], this.lookup);
    const { class: cls, decidedBy } = projectClass(remotes);
    const def = defaultVisibility(environment, cls);

    const sessionsDir = `${this.rel}/sessions/`;
    const ids = (out: string) => new Set(out.split("\n").filter((l) => l.startsWith(sessionsDir)).map((l) => l.slice(sessionsDir.length).split("/")[0]!));
    const tracked = ids(await git(top, ["ls-files", "--", sessionsDir]).catch(() => ""));
    this.inHead = ids(await git(top, ["ls-tree", "-r", "--name-only", "HEAD", "--", sessionsDir]).catch(() => ""));

    const decisions = this.store.readDecisions();
    const states = new Map<string, SessionVisibility>();
    for (const id of this.store.listSessions()) {
      const d: SessionDecision | undefined = decisions[id];
      states.set(id, d ? { visibility: d, decided: true } : tracked.has(id) ? { visibility: "shared", decided: true } : { visibility: def, decided: false });
    }
    this.excluded = new Set([...states].filter(([, s]) => s.visibility !== "shared").map(([id]) => id));
    this.writeExclude();

    let unpushed: number | undefined;
    if (environment === "restricted" && (cls === "open" || cls === "unknown")) {
      const out = await git(top, ["diff", "--name-only", "@{u}..HEAD", "--", sessionsDir]).catch(() => undefined);
      if (out !== undefined) unpushed = ids(out).size;
    }

    const prev = this.sharing;
    const next: Sharing = { environment, answered: !!settings.environment, remotes, class: cls, decidedBy, default: def, prompt: def !== "shared", unpushed };
    const changed = JSON.stringify(prev) !== JSON.stringify(next) || JSON.stringify([...this.states]) !== JSON.stringify([...states]);
    this.sharing = next;
    this.states = states;
    if (changed) {
      // stricter than before (a public remote was added, say): the UI says so once
      const alert = !!prev && prev.default === "shared" && def !== "shared";
      if (alert) this.log(`sessions are no longer shared by default: ${cls} remote ${decidedBy ?? ""}`.trim());
      this.broadcast("sharing", { ...next, alert });
    }
    return next;
  }

  /** Paths auto-commit must leave out: excluded sessions that were never committed. */
  excludedPaths(): string[] {
    // a session committed before and now private is removed from git's index; auto-commit commits that removal
    return [...this.excluded].filter((id) => !this.inHead.has(id)).map((id) => this.sessionPath(id));
  }

  async decide(session: string, decision: SessionDecision): Promise<DecideResult> {
    this.store.writeDecision(session, decision);
    let warning: string | undefined;
    if (decision === "private" && this.locate()) {
      const dir = this.sessionPath(session);
      const tracked = (await git(this.top!, ["ls-files", "--", dir]).catch(() => "")).trim();
      if (tracked) {
        await git(this.top!, ["rm", "-r", "--cached", "-q", "--", dir]);
        warning = "Removed from git; the files stay on this machine. Earlier commits still contain this session, and so does every copy that was already pushed.";
        this.log(`session ${session.slice(0, 8)} made private: removed from the git index`);
      }
    }
    const sharing = await this.refresh();
    const state = this.states.get(session) ?? { visibility: decision, decided: true };
    this.broadcast("visibility", { session, ...state });
    return { ...state, sharing, warning };
  }
}
