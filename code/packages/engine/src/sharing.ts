import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { gitSync } from "./git.js";

/**
 * Which sessions may reach git. A session records prompts, tool output and command results; in a
 * public repository that can publish what must stay inside an organisation (internal names,
 * company accounts, customer data). Filtering the text was rejected: a blacklist of company terms
 * is costly to keep, never complete, and lets people stop paying attention.
 *
 * Instead one rule, from two facts: the environment (does this machine, VM or container hold data
 * that must not be published? what matters is the data, not who owns the machine) and where the
 * repository can be pushed. A restricted environment shares sessions only when every remote is
 * restricted (sharesWith). It is not decided per session: content written here is restricted
 * whichever session it belongs to, also when it continues a session committed elsewhere.
 *
 * The environment and `restricted_remotes` live in ~/.yolo-twice/settings.json, machine-wide and
 * never committed; unanswered counts as restricted. Where the content goes: the Store keeps a
 * session in sessions/ (committed) or private/sessions/ (gitignored); SharingIndex in
 * visibility.ts keeps the folders in line with the rule. User guide: code/site/install.md.
 */

/** restricted: this environment holds data that must not be published. open: it does not. */
export type Environment = "restricted" | "open";
/** restricted: an internal or private repository. open: public. unknown: could not tell. */
export type RemoteClass = "restricted" | "open" | "unknown";
/** The riskiest class of the project's remotes, or none without a remote. */
export type ProjectClass = RemoteClass | "none";

export interface Remote {
  name: string;
  url: string;
  /** host/owner/repo, or the path of a local remote */
  id: string;
  class: RemoteClass;
  /** what decided the class */
  by: "pattern" | "gh" | "local" | "none";
}

export interface Sharing {
  environment: Environment;
  /** false while the environment question is unanswered: it counts as restricted until then */
  answered: boolean;
  remotes: Remote[];
  class: ProjectClass;
  /** the remote that decided the class */
  decidedBy?: string;
  /** new content goes to sessions/ and is committed; otherwise it stays in private/ */
  shares: boolean;
  /** sessions with content that stays on this machine */
  private: number;
  /** sessions committed but not pushed yet, counted when the project is not safe to push to */
  unpushed?: number;
  /** set once when 0.1.5's per-session state was converted: sessions moved to private/, and those kept private for good */
  migrated?: { private: number; kept: number };
}

const RANK: Record<ProjectClass, number> = { none: 0, restricted: 1, unknown: 2, open: 3 };

/** `git@github.com:acme/app.git`, `https://user@github.com/acme/app` -> `github.com/acme/app`. */
export function remoteId(url: string): { id: string; local: boolean } {
  const u = url.trim();
  if (/^(file:\/\/|\/|\.{1,2}\/|[A-Za-z]:[\\/])/.test(u)) return { id: u.replace(/^file:\/\//, ""), local: true };
  let host = "";
  let rest = "";
  const scheme = /^[a-z+]+:\/\/(?:[^@/]*@)?([^/:]+)(?::\d+)?(\/.*)?$/i.exec(u);
  const scp = /^(?:[^@/]+@)?([^:/]+):(.*)$/.exec(u);
  if (scheme) [host, rest] = [scheme[1]!, scheme[2] ?? ""];
  else if (scp) [host, rest] = [scp[1]!, scp[2]!];
  else return { id: u, local: true };
  const p = rest.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
  return { id: `${host.toLowerCase()}${p ? `/${p}` : ""}`, local: false };
}

/**
 * A pattern from `restricted_remotes`: `git.acme.example` (a whole host), `github.com/acme-*`
 * (owners by prefix) or `github.com/acme/app`. `*` stays within one path segment, `**` crosses them.
 */
export function matchRemote(pattern: string, id: string): boolean {
  const p = remoteId(pattern.includes("/") || pattern.includes(":") ? pattern : `https://${pattern}`).id.replace(/\/\*\*?$/, "");
  const re = p
    .split(/(\*\*|\*)/)
    .map((part) => (part === "**" ? ".*" : part === "*" ? "[^/]*" : part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(`^${re}(/.*)?$`, "i").test(id);
}

export function parseRemotes(out: string): { name: string; url: string }[] {
  const seen = new Map<string, string>();
  for (const line of out.split("\n")) {
    const m = /^(\S+)\s+(\S+)\s+\((fetch|push)\)/.exec(line);
    // the push URL is the one that matters: that is where commits go
    if (m && (m[3] === "push" || !seen.has(m[1]!))) seen.set(m[1]!, m[2]!);
  }
  return [...seen].map(([name, url]) => ({ name, url }));
}

export type GhLookup = (id: string) => Promise<string | undefined>;

const ghCache = new Map<string, { visibility: string | undefined; at: number }>();
const DAY = 24 * 3600_000;

/** PUBLIC, PRIVATE or INTERNAL from `gh`, cached a day (failures an hour); undefined on any failure, quietly: no gh, offline or no access just means unknown. */
export const ghVisibility: GhLookup = async (id) => {
  if (process.env.YOLO_TWICE_NO_GH || id.split("/").length < 3) return undefined;
  const hit = ghCache.get(id);
  // a failure is retried sooner than an answer
  if (hit && Date.now() - hit.at < (hit.visibility ? DAY : DAY / 24)) return hit.visibility;
  const visibility = await new Promise<string | undefined>((resolve) =>
    execFile("gh", ["repo", "view", id, "--json", "visibility", "-q", ".visibility"], { timeout: 8_000 }, (err, stdout) => {
      const v = String(stdout ?? "").trim().toUpperCase();
      resolve(!err && /^(PUBLIC|PRIVATE|INTERNAL)$/.test(v) ? v : undefined);
    }),
  );
  ghCache.set(id, { visibility, at: Date.now() });
  return visibility;
};

export async function classifyRemotes(remotes: { name: string; url: string }[], patterns: string[], lookup: GhLookup): Promise<Remote[]> {
  return Promise.all(
    remotes.map(async ({ name, url }): Promise<Remote> => {
      const { id, local } = remoteId(url);
      if (local) return { name, url, id, class: "restricted", by: "local" };
      if (patterns.some((p) => matchRemote(p, id))) return { name, url, id, class: "restricted", by: "pattern" };
      const v = await lookup(id).catch(() => undefined);
      if (v === "PUBLIC") return { name, url, id, class: "open", by: "gh" };
      if (v === "PRIVATE" || v === "INTERNAL") return { name, url, id, class: "restricted", by: "gh" };
      return { name, url, id, class: "unknown", by: "none" };
    }),
  );
}

/** The riskiest remote decides: one public remote makes the whole project public. */
export function projectClass(remotes: Remote[]): { class: ProjectClass; decidedBy?: string } {
  let cls: ProjectClass = "none";
  let by: string | undefined;
  for (const r of remotes) if (RANK[r.class] > RANK[cls]) [cls, by] = [r.class, r.name];
  return { class: cls, decidedBy: by };
}

export function riskier(a: ProjectClass, b: ProjectClass): boolean {
  return RANK[a] > RANK[b];
}

/**
 * The rule:
 *
 *   environment  remotes               sessions
 *   open         any, or none          shared
 *   restricted   all restricted        shared
 *   restricted   any public or unknown stay on this machine
 *   restricted   none                  stay on this machine (until a restricted remote is added)
 *
 * An unknown remote counts as public; one click in the UI adds it to restricted_remotes.
 */
export function sharesWith(env: Environment, cls: ProjectClass): boolean {
  return env === "open" || cls === "restricted";
}

/* ---------- the environment question ---------- */

const MAIL_PROVIDERS = /@(gmail|googlemail|outlook|hotmail|live|msn|yahoo|ymail|icloud|me|mac|proton|protonmail|pm|gmx|web|aol|mail|yandex|zoho|fastmail|hey|tutanota|posteo|mailbox|bluewin|users\.noreply\.github)\./i;

/** A pre-selected answer from cheap local signals. Never applied without the user's answer. */
export function guessEnvironment(): { guess: Environment; signals: string[] } {
  const signals: string[] = [];
  const email = gitSync(os.homedir(), ["config", "--global", "user.email"])?.trim();
  if (email?.includes("@") && !MAIL_PROVIDERS.test(email)) signals.push(`your git email uses an organisation's domain (${email.split("@")[1]})`);
  if (process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy) signals.push("an HTTP proxy is configured");
  for (const file of ghHostFiles()) {
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const host of text.match(/^[^\s#][^:]*(?=:\s*$)/gm) ?? []) if (host !== "github.com") signals.push(`gh is logged in to ${host}`);
    // enterprise managed GitHub accounts carry their company's short code: name_acme
    for (const user of text.match(/^ {8}([A-Za-z0-9-]+_[A-Za-z0-9]+)(?=:)/gm) ?? []) signals.push(`gh account ${user.trim()} looks enterprise managed`);
  }
  return { guess: signals.length ? "restricted" : "open", signals: [...new Set(signals)] };
}

function ghHostFiles(): string[] {
  const dirs = [process.env.GH_CONFIG_DIR, process.env.XDG_CONFIG_HOME && path.join(process.env.XDG_CONFIG_HOME, "gh"), path.join(os.homedir(), ".config", "gh")];
  // the snap package keeps its config per revision
  const snap = path.join(os.homedir(), "snap", "gh");
  try {
    for (const rev of fs.readdirSync(snap)) dirs.push(path.join(snap, rev, ".config", "gh"));
  } catch {
    /* no snap */
  }
  return [...new Set(dirs.filter((d): d is string => !!d).map((d) => path.join(d, "hosts.yml")))];
}

/** Patterns to offer for restricted_remotes, from the project's own remotes. */
export function candidatePatterns(remotes: Remote[]): string[] {
  const out = new Set<string>();
  for (const r of remotes) {
    // a local folder needs no rule, and a repository GitHub reports as public is never internal
    if (r.by === "local" || r.class === "open") continue;
    const [host, owner] = r.id.split("/");
    if (!host) continue;
    if (/^(github\.com|gitlab\.com|bitbucket\.org|codeberg\.org)$/.test(host)) {
      if (owner) out.add(`${host}/${owner}/*`);
    } else out.add(host);
  }
  return [...out];
}

/* ---------- .git/info/exclude ---------- */

/** 0.1.5 kept private sessions out with a block here; 0.1.6 only removes it (private/ is gitignored instead). */
const BEGIN = "# yolo-twice: private and undecided sessions stay on this machine (managed, edits are overwritten)";
const END = "# yolo-twice: end";

/** Replace yolo-twice's block in the exclude file; everything else in it is left alone. */
export function writeExcludeBlock(file: string, lines: string[]): boolean {
  let cur = "";
  try {
    cur = fs.readFileSync(file, "utf8");
  } catch {
    /* no file yet */
  }
  if (!lines.length && !cur.includes(BEGIN)) return false;
  const re = new RegExp(`\\n?${escape(BEGIN)}\\n[\\s\\S]*?${escape(END)}\\n?`);
  const rest = cur.replace(re, "\n").replace(/\n+$/, "");
  const block = lines.length ? `${BEGIN}\n${[...lines].sort().join("\n")}\n${END}\n` : "";
  const next = rest ? `${rest}\n${block ? `\n${block}` : ""}` : block;
  if (next === cur) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next);
  return true;
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
