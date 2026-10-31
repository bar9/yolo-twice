import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";

/**
 * Every 10 minutes: often enough that `git status` stays mostly clean, rare enough that the
 * history gets a handful of commits per hour, not one per turn. Ticks with no change commit nothing.
 */
export const AUTO_COMMIT_INTERVAL_MS = 10 * 60_000;

export interface AutoCommitStatus {
  enabled: boolean;
  intervalMs: number;
  lastCommit?: { ts: string; sha: string; files: number };
  lastCheck?: string;
  /** Why the last tick did not commit (no repo, merge in progress, git error). */
  skipped?: string;
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile("git", args, { cwd, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout),
    ),
  );
}

/**
 * Opt-in auto-commit of the project's .yolo-twice folder. Lives only in engine memory: it is off
 * whenever the engine starts. Commits with `--only`, so whatever the user has staged stays staged
 * and out of the commit.
 */
export class AutoCommitter {
  private timer: NodeJS.Timeout | undefined;
  private busy = false;
  private status: AutoCommitStatus = { enabled: false, intervalMs: AUTO_COMMIT_INTERVAL_MS };

  constructor(
    private readonly root: string,
    private readonly dir: string,
    private readonly onChange: (s: AutoCommitStatus) => void,
    private readonly log: (msg: string) => void,
    intervalMs = AUTO_COMMIT_INTERVAL_MS,
  ) {
    this.status.intervalMs = intervalMs;
  }

  get(): AutoCommitStatus {
    return { ...this.status };
  }

  /** Turning it on commits right away, then on every interval. */
  set(enabled: boolean): AutoCommitStatus {
    clearInterval(this.timer);
    this.timer = undefined;
    this.status = { ...this.status, enabled, skipped: undefined };
    if (enabled) {
      this.timer = setInterval(() => void this.tick(), this.status.intervalMs);
      this.timer.unref();
      void this.tick();
    }
    this.onChange(this.get());
    return this.get();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One commit attempt. Exposed for tests. */
  async tick(): Promise<void> {
    if (this.busy || !this.status.enabled) return;
    this.busy = true;
    try {
      const skipped = await this.commit();
      this.status = { ...this.status, lastCheck: new Date().toISOString(), skipped };
      if (skipped) this.log(`auto-commit skipped: ${skipped}`);
    } catch (e) {
      this.status = { ...this.status, lastCheck: new Date().toISOString(), skipped: (e as Error).message };
      this.log(`auto-commit failed: ${(e as Error).message}`);
    } finally {
      this.busy = false;
    }
    this.onChange(this.get());
  }

  /** Returns why nothing was committed, or undefined when it committed or there was nothing to do. */
  private async commit(): Promise<string | undefined> {
    const top = (await git(this.root, ["rev-parse", "--show-toplevel"]).catch(() => "")).trim();
    if (!top) return "not a git repository";
    // never interfere with a merge, rebase, cherry-pick or another git process
    for (const p of ["index.lock", "MERGE_HEAD", "REBASE_HEAD", "CHERRY_PICK_HEAD", "rebase-merge", "rebase-apply"]) {
      const abs = path.resolve(this.root, (await git(this.root, ["rev-parse", "--git-path", p])).trim());
      if (fs.existsSync(abs)) return `git busy (${p})`;
    }
    if (!(await git(this.root, ["symbolic-ref", "-q", "HEAD"]).catch(() => ""))) return "detached HEAD";
    const rel = path.relative(top, this.dir) || ".";
    const changed = (await git(top, ["status", "--porcelain", "--untracked-files=all", "--", rel])).split("\n").filter(Boolean);
    if (changed.length === 0) return undefined;
    await git(top, ["add", "-A", "--", rel]);
    // --only commits just this path from the work tree; the rest of the user's index is left as it was
    await git(top, ["commit", "--only", "--no-verify", "-q", "-m", `yolo-twice: auto-commit session data (${changed.length} files)`, "--", rel]);
    const sha = (await git(top, ["rev-parse", "--short", "HEAD"])).trim();
    this.status = { ...this.status, lastCommit: { ts: new Date().toISOString(), sha, files: changed.length } };
    this.log(`auto-commit ${sha}: ${changed.length} files`);
    return undefined;
  }
}
