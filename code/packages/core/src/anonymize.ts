import { projectSlug } from "./paths.js";

/**
 * Portable, anonymous paths for everything written to `.yolo-twice/`.
 *
 *   /home/alice/git/repo/code/x      ->  $PROJECT/code/x      (project root, any clone location)
 *   /home/alice/.claude/settings.json ->  ~/.claude/settings.json
 *   ~/.claude/projects/-home-alice-git-repo/  ->  ~/.claude/projects/<project-slug>/
 *   /tmp/claude-1000/-home-alice-git-other/   ->  /tmp/claude-1000/-~-git-other/
 *   alice (as a whole word)          ->  <user>
 *   /home/bob/, /Users/bob/, C:\Users\bob\  ->  ~/  (other machines' homes)
 *
 * Only `$PROJECT` and `~` are expanded again (see expandPaths): Claude's tools need absolute
 * paths when a session is resumed. The other replacements are one-way by design.
 */

export const PROJECT_MARK = "$PROJECT";
export const SLUG_MARK = "<project-slug>";
export const USER_MARK = "<user>";

export interface PathContext {
  /** Absolute project root on this machine. */
  root: string;
  /** Absolute home directory on this machine. */
  home: string;
  /** Login name on this machine. */
  user?: string;
}

/** Login names that are also ordinary words: replacing them would mangle normal text. */
const COMMON_WORDS = new Set(
  "user root admin test home main data code work team dev demo guest info mail node next none open pass play read root save self ship sync tool true unix void wild yolo".split(" "),
);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Strip trailing separators so `/home/a/` and `/home/a` behave alike. */
function trimSep(p: string): string {
  return p.length > 1 ? p.replace(/[/\\]+$/, "") : p;
}

/** A path prefix that only matches on a boundary: `/home/a` matches `/home/a/x` and `/home/a"`, not `/home/ab`. */
function prefixRe(prefix: string): RegExp {
  return new RegExp(`${escapeRe(prefix)}(?=[/\\\\]|$|[^\\w.-])`, "g");
}

export function anonymizePaths(text: string, ctx: PathContext): string {
  if (!text) return text;
  const root = trimSep(ctx.root);
  const home = trimSep(ctx.home);
  let out = text;

  // 1. project root (before home: it usually lives inside home)
  if (root && root !== "/" && root !== home) out = out.replace(prefixRe(root), PROJECT_MARK);

  // 2. the project's Claude Code folder name, e.g. -home-alice-git-repo
  const slug = projectSlug(root);
  if (slug.length > 1) out = out.replace(new RegExp(`${escapeRe(slug)}(?![\\w])`, "g"), SLUG_MARK);

  // 3. home
  if (home && home !== "/") out = out.replace(prefixRe(home), "~");

  // 4. home slug prefix inside other Claude folder names, e.g. -home-alice-git-other -> -~-git-other
  const homeSlug = projectSlug(home);
  if (homeSlug.length > 1) out = out.replace(new RegExp(`${escapeRe(homeSlug)}-`, "g"), "-~-");

  // 5. other machines' homes, with or without a path after them, and their Claude folder names
  out = out
    .replace(/\/home\/[A-Za-z0-9._-]+(?![\w.-])/g, "~")
    .replace(/\/Users\/[A-Za-z0-9._-]+(?![\w.-])/g, "~")
    .replace(/[A-Za-z]:\\Users\\[^\\\s"']+(?=\\)/g, "~")
    .replace(/-(?:home|Users)-[A-Za-z0-9._]+-/g, "-~-");

  // 6. the bare login name, whole word, when it is distinctive enough not to hit normal words
  const user = ctx.user;
  if (user && user.length >= 4 && !COMMON_WORDS.has(user.toLowerCase())) {
    // whole word only: not part of a longer name, a dotted name (alice.cooper) or an email address
    out = out.replace(new RegExp(`(?<![\\w.@-])${escapeRe(user)}(?![\\w-]|\\.\\w|@)`, "g"), USER_MARK);
  }
  return out;
}

/** Undo rules 1 and 3 for the person resuming a session: tools need real absolute paths. */
export function expandPaths(text: string, ctx: Pick<PathContext, "root" | "home">): string {
  if (!text) return text;
  const root = trimSep(ctx.root);
  const home = trimSep(ctx.home);
  return text
    .replace(new RegExp(`${escapeRe(PROJECT_MARK)}(?![\\w])`, "g"), root)
    .replace(new RegExp(`${escapeRe(SLUG_MARK)}`, "g"), projectSlug(root))
    .replace(/(^|[\s"'`=(:,[])~(?=\/)/g, (_m, pre: string) => `${pre}${home}`);
}

/** Apply a string transform to every string inside a JSON-like value. */
export function mapStrings<T>(value: T, fn: (s: string) => string): T {
  if (typeof value === "string") return fn(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = mapStrings(v, fn);
    return out as T;
  }
  return value;
}
