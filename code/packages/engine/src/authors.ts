import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Fork } from "./forks.js";
import { git } from "./git.js";

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


export function emailHash(email: string): string {
  return crypto.createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

/** The author of one line of an events file. */
export interface BlameLine {
  id: string;
  author: Author;
  uncommitted?: boolean;
}

/** Parse `git blame --line-porcelain` of an events file. `local` stands in for uncommitted lines. */
export function parseBlame(porcelain: string, local: Author): BlameLine[] {
  const out: BlameLine[] = [];
  let sha = "";
  let name = "";
  let mail = "";
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("\t")) {
      const id = lineId(line.slice(1));
      if (id === undefined) continue;
      const uncommitted = UNCOMMITTED.test(sha);
      out.push({ id, author: uncommitted ? local : { name, email_sha256: emailHash(mail) }, ...(uncommitted ? { uncommitted } : {}) });
    } else if (line.startsWith("author ")) name = line.slice("author ".length);
    else if (line.startsWith("author-mail ")) mail = line.slice("author-mail ".length).replace(/^<|>$/g, "");
    else if (/^[0-9a-f]{40} /.test(line)) sha = line.slice(0, 40);
  }
  return out;
}

/** Consecutive lines by one person become one run: committing your own lines is not a takeover. */
export function toRuns(lines: BlameLine[]): AuthorRun[] {
  const runs: AuthorRun[] = [];
  for (const { id, author, uncommitted } of lines) {
    const prev = runs[runs.length - 1];
    if (prev && prev.email_sha256 === author.email_sha256) {
      prev.last = id;
      if (!uncommitted) delete prev.uncommitted;
    } else runs.push({ ...author, first: id, last: id, ...(uncommitted ? { uncommitted: true } : {}) });
  }
  return runs;
}

function lineId(line: string): string | undefined {
  try {
    const id = (JSON.parse(line) as { id?: unknown }).id;
    return typeof id === "string" ? id : undefined;
  } catch {
    return undefined;
  }
}

/** The distinct authors of a session, in order of first appearance. */
export function authorsOf(runs: AuthorRun[]): Author[] {
  const out = new Map<string, Author>();
  for (const r of runs) if (!out.has(r.email_sha256)) out.set(r.email_sha256, { name: r.name, email_sha256: r.email_sha256 });
  return [...out.values()];
}

function untracked(file: string, local: Author): BlameLine[] {
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .flatMap((l) => {
      const id = lineId(l);
      return id === undefined ? [] : [{ id, author: local, uncommitted: true }];
    });
}

/**
 * Blame per session, cached until HEAD or the events file changes. Not a git repo: no runs.
 * A fork's copied history is credited to whoever wrote it in the original session, not to the
 * person who resumed it (who committed those lines).
 */
export class AuthorIndex {
  private cache = new Map<string, { key: string; lines: Promise<BlameLine[]> }>();
  private local: Promise<Author> | undefined;

  constructor(
    private readonly dir: string,
    private readonly forks: () => Map<string, Fork> = () => new Map(),
  ) {}

  private eventsFile(session: string): string {
    return path.join(this.dir, "sessions", session, "events.ndjson");
  }

  /** A session continued or kept on this machine (gitignored): its own lines are the local user's. */
  private privateFile(session: string): string {
    return path.join(this.dir, "private", "sessions", session, "events.ndjson");
  }

  private localAuthor(): Promise<Author> {
    this.local ??= Promise.all([git(this.dir, ["config", "user.name"]).catch(() => ""), git(this.dir, ["config", "user.email"]).catch(() => "")]).then(([n, e]) => ({
      name: n.trim() || "you",
      email_sha256: emailHash(e),
    }));
    return this.local;
  }

  async runs(session: string): Promise<AuthorRun[]> {
    return toRuns(await this.attributed(session, new Set()));
  }

  private async attributed(session: string, seen: Set<string>): Promise<BlameLine[]> {
    const lines = await this.lines(session);
    const fork = this.forks().get(session);
    if (!fork || seen.has(fork.from)) return lines;
    seen.add(session);
    const theirs = new Map((await this.attributed(fork.from, seen)).map((l) => [l.id, l]));
    const copied = (l: BlameLine) => (fork.shared.has(l.id) ? theirs.get(l.id) : undefined);
    // the resume title above the copied history is not a takeover: it goes with the first copied line
    const head = lines.map(copied).find(Boolean);
    let before = true;
    return lines.map((l) => {
      const c = copied(l);
      if (c) before = false;
      return c ?? (before && head ? { ...head, id: l.id } : l);
    });
  }

  private async lines(session: string): Promise<BlameLine[]> {
    const file = this.eventsFile(session);
    const priv = this.privateFile(session);
    const stat = fs.statSync(file, { throwIfNoEntry: false });
    const pstat = fs.statSync(priv, { throwIfNoEntry: false });
    if (!stat && !pstat) return [];
    // a repo without commits has no HEAD yet, but its sessions are still the local user's
    const head = await git(this.dir, ["rev-parse", "--git-dir", "HEAD"]).catch((e: Error) => (/unknown revision|ambiguous argument/.test(e.message) ? "unborn" : ""));
    if (!head) return [];
    const key = `${head.trim()}:${stat?.size}:${stat?.mtimeMs}:${pstat?.size}:${pstat?.mtimeMs}`;
    const hit = this.cache.get(session);
    if (hit?.key === key) return hit.lines;
    const lines = this.localAuthor().then(async (local) => {
      const committed = stat
        ? await git(this.dir, ["blame", "--line-porcelain", "--", file], 256 * 1024 * 1024).then(
            (out) => parseBlame(out, local),
            () => untracked(file, local), // a session nobody committed yet is the local user's
          )
        : [];
      if (!pstat) return committed;
      // the private copy starts with the committed lines: those keep their authors, the rest is ours
      const known = new Map(committed.map((l) => [l.id, l]));
      return untracked(priv, local).map((l) => known.get(l.id) ?? l);
    });
    this.cache.set(session, { key, lines });
    return lines;
  }

  async authors(session: string): Promise<Author[]> {
    return authorsOf(await this.runs(session));
  }
}
