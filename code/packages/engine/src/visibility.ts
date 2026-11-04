import fs from "node:fs";
import path from "node:path";
import type { SessionPlace, Store } from "@yolo-twice/core";
import { git, gitSync } from "./git.js";
import { classifyRemotes, ghVisibility, parseRemotes, projectClass, sharesWith, writeExcludeBlock, type GhLookup, type Sharing } from "./sharing.js";
import { readSettings } from "./state.js";

/**
 * Keeps a project's session folders in line with the sharing rule (sharesWith in sharing.ts).
 *
 * The folder decides, not git tricks: sessions/<id>/ is committed, private/sessions/<id>/ is
 * gitignored. The Store sends new content to the right one (writableDir); this class tells it
 * whether the project shares and moves what is already there when the answer changes:
 *
 * - not sharing: a session folder in sessions/ that is not in HEAD moves to private/. A committed
 *   one with uncommitted changes is copied to private/ and restored to HEAD, so the committed copy
 *   stays exactly as pulled (a pull never stops on it) and new content stays here.
 * - sharing: every private copy moves back to sessions/ (replacing the frozen committed copy) and
 *   is committed like any other change. Sessions in `keep_private` (made private in 0.1.5) never
 *   move back.
 *
 * Re-evaluated when .git/config changes (a remote can be added at any time), on ingest and before
 * every auto-commit. Until the first answer the Store does not share (fail-safe). Outside a git
 * repository nothing is committed, so the folders do not matter and nothing is moved.
 * The engine never pushes; `unpushed` counts what an earlier push would publish.
 */
export class SharingIndex {
  private sharing: Sharing | undefined;
  private top: string | undefined;
  private rel = "";
  private excludeFile: string | undefined;
  private migrated: Sharing["migrated"];
  private checkedLegacy = false;
  private chain: Promise<unknown> = Promise.resolve();
  private queued: Promise<Sharing | undefined> | undefined;

  constructor(
    private readonly store: Store,
    private readonly root: string,
    private readonly broadcast: (event: string, data: unknown) => void,
    private readonly log: (msg: string) => void,
    private readonly lookup: GhLookup = ghVisibility,
  ) {}

  /** undefined outside a git repository: then nothing is ever committed. */
  get(): Sharing | undefined {
    return this.sharing;
  }

  /** Where a session's content is (kept: made private in 0.1.5, stays private for good); undefined outside a git repository. */
  of(session: string): { visibility: SessionPlace; kept?: true } | undefined {
    if (!this.sharing) return undefined;
    return this.store.keptPrivate().has(session) ? { visibility: this.store.place(session), kept: true } : { visibility: this.store.place(session) };
  }

  /** The git config file, to watch for added or changed remotes. */
  gitConfigFile(): string | undefined {
    const p = gitSync(this.root, ["rev-parse", "--git-path", "config"])?.trim();
    return p ? path.resolve(this.root, p) : undefined;
  }

  /** Found once; a folder that is not a repository yet is checked again (git init happens). */
  private locate(): boolean {
    if (!this.top) {
      this.top = gitSync(this.root, ["rev-parse", "--show-toplevel"])?.trim() || undefined;
      const ex = this.top ? gitSync(this.root, ["rev-parse", "--git-path", "info/exclude"])?.trim() : undefined;
      this.excludeFile = ex ? path.resolve(this.root, ex) : undefined;
      if (this.top) this.rel = path.relative(this.top, this.store.dir).split(path.sep).join("/") || ".";
    }
    return !!this.top;
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
      this.store.setSharing(true);
      this.sharing = undefined;
      return undefined;
    }
    const top = this.top!;
    const settings = readSettings();
    const environment = settings.environment ?? "restricted";
    const remotes = await classifyRemotes(parseRemotes(await git(top, ["remote", "-v"]).catch(() => "")), settings.restricted_remotes ?? [], this.lookup);
    const { class: cls, decidedBy } = projectClass(remotes);
    const shares = sharesWith(environment, cls);
    // first: from here on, every write goes the right way
    this.store.setSharing(shares);

    const sessionsDir = `${this.rel}/sessions/`;
    const ids = (out: string, porcelain = false) =>
      new Set(
        out
          .split("\n")
          // porcelain lines are "XY path"
          .map((l) => (porcelain ? l.slice(3) : l))
          .filter((l) => l.startsWith(sessionsDir))
          .map((l) => l.slice(sessionsDir.length).split("/")[0]!),
      );
    const inHead = ids(await git(top, ["ls-tree", "-r", "--name-only", "HEAD", "--", sessionsDir]).catch(() => ""));
    const dirty = shares ? new Set<string>() : ids(await git(top, ["status", "--porcelain", "--untracked-files=all", "--no-renames", "--", sessionsDir]).catch(() => ""), true);
    let unpushed: number | undefined;
    if (!shares && (cls === "open" || cls === "unknown")) {
      const out = await git(top, ["diff", "--name-only", "@{u}..HEAD", "--", sessionsDir]).catch(() => undefined);
      if (out !== undefined) unpushed = ids(out).size;
    }

    // no await below: the folders move in one go, ingest cannot interleave
    const moved = this.align(shares, inHead, dirty);

    const prev = this.sharing;
    const priv = this.store.listSessions().filter((id) => this.store.place(id) !== "shared").length;
    const next: Sharing = { environment, answered: !!settings.environment, remotes, class: cls, decidedBy, shares, private: priv, unpushed, migrated: this.migrated };
    this.sharing = next;
    if (JSON.stringify(prev) !== JSON.stringify(next) || moved) {
      // stricter than before (a public remote was added, say): the UI says so once
      const alert = !!prev && prev.shares && !shares;
      if (alert) this.log(`sessions stay on this machine from now on: ${cls} remote ${decidedBy ?? ""}`.trim());
      this.broadcast("sharing", { ...next, alert });
    }
    return next;
  }

  /** Move session folders to where the rule wants them. Returns how many moved. */
  private align(shares: boolean, inHead: Set<string>, dirty: Set<string>): number {
    // 0.1.5 decided per session: its private decisions are kept for good, the rest follows the rule
    let legacy = false;
    if (!this.checkedLegacy) {
      this.checkedLegacy = true;
      legacy = Object.keys(this.store.takeLegacyDecisions()).length > 0;
    }
    const keep = this.store.keptPrivate();
    const { shared, private: priv } = this.store.listPlaced();
    let toPrivate = 0;
    let toShared = 0;
    for (const id of shared) {
      if (keep.has(id) || (!shares && !inHead.has(id))) {
        this.store.demote(id);
        toPrivate++;
      } else if (!shares && dirty.has(id)) {
        // committed, with changes made before the project stopped sharing: they go private, the committed copy back to HEAD
        this.store.writableDir(id);
        const p = `${this.rel}/sessions/${id}`;
        gitSync(this.top!, ["checkout", "-q", "HEAD", "--", p]);
        gitSync(this.top!, ["clean", "-fdq", "--", p]);
        toPrivate++;
      }
    }
    // 0.1.5's exclude block goes only after its sessions left sessions/, so git never sees them in between
    if (this.excludeFile && fs.existsSync(this.excludeFile)) {
      try {
        legacy = writeExcludeBlock(this.excludeFile, []) || legacy;
      } catch (e) {
        this.log(`could not update ${this.excludeFile}: ${(e as Error).message}`);
      }
    }
    if (shares) {
      for (const id of priv) {
        if (keep.has(id)) continue;
        this.store.promote(id);
        toShared++;
      }
    }
    if (legacy) {
      this.migrated = { private: toPrivate, kept: keep.size };
      this.log(`converted 0.1.5 sharing state: ${toPrivate} sessions moved to private/, ${keep.size} kept private`);
    } else if (toPrivate || toShared) this.log(`sessions moved: ${toPrivate} to private/, ${toShared} to sessions/`);
    return toPrivate + toShared;
  }
}
