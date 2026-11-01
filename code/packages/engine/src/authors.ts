import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";

/**
 * Who wrote which part of a session, straight from git: every line of events.ndjson was committed
 * by the engine of the person who ingested it, so `git blame` on that file is the authorship.
 * Nothing is stored; lines not committed yet belong to the local git user.
 */
export interface Author {
  name: string;
  /** sha256 of the lowercased address: enough for Gravatar, the address itself never leaves the engine. */
  email_sha256: string;
}

/** Consecutive events by one author, inclusive. */
export interface AuthorRun extends Author {
  first: string;
  last: string;
  uncommitted?: boolean;
}

const UNCOMMITTED = /^0{40}$/;

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile("git", args, { cwd, timeout: 30_000, maxBuffer: 256 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout),
    ),
  );
}

export function emailHash(email: string): string {
  return crypto.createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

/** Parse `git blame --line-porcelain` of an events file into author runs. `local` stands in for uncommitted lines. */
export function parseBlame(porcelain: string, local: Author): AuthorRun[] {
  const runs: AuthorRun[] = [];
  let sha = "";
  let name = "";
  let mail = "";
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("\t")) {
      let id: unknown;
      try {
        id = (JSON.parse(line.slice(1)) as { id?: unknown }).id;
      } catch {
        continue;
      }
      if (typeof id !== "string") continue;
      const uncommitted = UNCOMMITTED.test(sha);
      const who: Author = uncommitted ? local : { name, email_sha256: emailHash(mail) };
      const prev = runs[runs.length - 1];
      // a run changes with the person only: committing your own lines is not a takeover
      if (prev && prev.email_sha256 === who.email_sha256) {
        prev.last = id;
        if (!uncommitted) delete prev.uncommitted;
      } else runs.push({ ...who, first: id, last: id, ...(uncommitted ? { uncommitted: true } : {}) });
    } else if (line.startsWith("author ")) name = line.slice("author ".length);
    else if (line.startsWith("author-mail ")) mail = line.slice("author-mail ".length).replace(/^<|>$/g, "");
    else if (/^[0-9a-f]{40} /.test(line)) sha = line.slice(0, 40);
  }
  return runs;
}

/** The distinct authors of a session, in order of first appearance. */
export function authorsOf(runs: AuthorRun[]): Author[] {
  const out = new Map<string, Author>();
  for (const r of runs) if (!out.has(r.email_sha256)) out.set(r.email_sha256, { name: r.name, email_sha256: r.email_sha256 });
  return [...out.values()];
}

function untracked(file: string, local: Author): AuthorRun[] {
  const ids = fs
    .readFileSync(file, "utf8")
    .split("\n")
    .flatMap((l) => {
      try {
        const id = (JSON.parse(l) as { id?: unknown }).id;
        return typeof id === "string" ? [id] : [];
      } catch {
        return [];
      }
    });
  return ids.length ? [{ ...local, first: ids[0]!, last: ids[ids.length - 1]!, uncommitted: true }] : [];
}

/** Blame per session, cached until HEAD or the events file changes. Not a git repo: no runs. */
export class AuthorIndex {
  private cache = new Map<string, { key: string; runs: Promise<AuthorRun[]> }>();
  private local: Promise<Author> | undefined;

  constructor(private readonly dir: string) {}

  private eventsFile(session: string): string {
    return path.join(this.dir, "sessions", session, "events.ndjson");
  }

  private localAuthor(): Promise<Author> {
    this.local ??= Promise.all([git(this.dir, ["config", "user.name"]).catch(() => ""), git(this.dir, ["config", "user.email"]).catch(() => "")]).then(([n, e]) => ({
      name: n.trim() || "you",
      email_sha256: emailHash(e),
    }));
    return this.local;
  }

  async runs(session: string): Promise<AuthorRun[]> {
    const file = this.eventsFile(session);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      return [];
    }
    // a repo without commits has no HEAD yet, but its sessions are still the local user's
    const head = await git(this.dir, ["rev-parse", "--git-dir", "HEAD"]).catch((e: Error) => (/unknown revision|ambiguous argument/.test(e.message) ? "unborn" : ""));
    if (!head) return [];
    const key = `${head.trim()}:${stat.size}:${stat.mtimeMs}`;
    const hit = this.cache.get(session);
    if (hit?.key === key) return hit.runs;
    const runs = this.localAuthor().then((local) =>
      git(this.dir, ["blame", "--line-porcelain", "--", file]).then(
        (out) => parseBlame(out, local),
        () => untracked(file, local), // a session nobody committed yet is the local user's
      ),
    );
    this.cache.set(session, { key, runs });
    return runs;
  }

  async authors(session: string): Promise<Author[]> {
    return authorsOf(await this.runs(session));
  }
}
