import type { CSSProperties } from "react";
import { Archive, Bot, Brain, Disc3, FolderGit2, Layers, MessageSquareText, Reply, SquareSlash, TriangleAlert, Undo2, User, Wrench, type LucideIcon } from "lucide-react";
import type { Event, Granularity, StructureNode } from "./api";

/**
 * One icon, one colour and one name per kind of thing in a session. The reader, the tape, the
 * graph legend and the filter chips all draw from here, so a tool call looks the same everywhere.
 */
export type Kind = "project" | "session" | "phase" | "you" | "command" | "text" | "think" | "tool" | "error" | "agent" | "compaction" | "rewind" | "result";

export const KIND: Record<Kind, { icon: LucideIcon; label: string; color: string }> = {
  project: { icon: FolderGit2, label: "Project", color: "var(--ink-2)" },
  session: { icon: Disc3, label: "Session", color: "var(--ink)" },
  phase: { icon: Layers, label: "Phase", color: "var(--ink-2)" },
  you: { icon: User, label: "You", color: "var(--k-you)" },
  command: { icon: SquareSlash, label: "Command", color: "var(--k-system)" },
  text: { icon: MessageSquareText, label: "Claude", color: "var(--k-text)" },
  think: { icon: Brain, label: "Thinking", color: "var(--k-think)" },
  tool: { icon: Wrench, label: "Tool", color: "var(--k-tool)" },
  error: { icon: TriangleAlert, label: "Error", color: "var(--k-error)" },
  agent: { icon: Bot, label: "Subagent", color: "var(--k-agent)" },
  compaction: { icon: Archive, label: "Compaction", color: "var(--k-system)" },
  rewind: { icon: Undo2, label: "Rewind", color: "var(--k-rewind)" },
  result: { icon: Reply, label: "Result", color: "var(--k-text)" },
};

const STEP: Record<string, Kind> = {
  prompt: "you",
  queued: "you",
  command: "command",
  text: "text",
  thinking: "think",
  tool: "tool",
  "tool-error": "error",
  subagent: "agent",
  compaction: "compaction",
  result: "result",
};

export function nodeKind(n: StructureNode): Kind {
  if (n.kind === "session") return "session";
  if (n.kind === "phase") return "phase";
  if (n.meta?.branch) return "rewind";
  if (n.kind === "turn") return n.meta?.step_kind === "command" ? "command" : "you";
  return STEP[n.meta?.step_kind ?? ""] ?? "text";
}

export function eventKind(e: Event): Kind {
  switch (e.kind) {
    case "user.prompt":
      return "you";
    case "user.command":
      return "command";
    case "assistant.thinking":
      return "think";
    case "tool.call":
      return "tool";
    case "tool.result":
      return e.data?.is_error ? "error" : "tool";
    case "subagent.start":
    case "subagent.stop":
      return "agent";
    case "compaction":
      return "compaction";
    default:
      return "text";
  }
}

/** Sets `--k` for CSS that tints icons, badges and graph nodes by kind. */
export function kindStyle(k: Kind): CSSProperties {
  return { "--k": KIND[k].color } as CSSProperties;
}

export function KindIcon({ kind, size = 14, className }: { kind: Kind; size?: number; className?: string }) {
  const Icon = KIND[kind].icon;
  return <Icon size={size} strokeWidth={2} className={className} aria-hidden />;
}

/** Inline `code` in summaries and prompts, rendered as code; everything else stays text. */
export function richText(text: string, mark?: string): (string | React.ReactElement)[] {
  const parts = text.split(/(`[^`\n]+`)/g);
  const out: (string | React.ReactElement)[] = [];
  parts.forEach((p, i) => {
    if (p.startsWith("`") && p.endsWith("`") && p.length > 2) out.push(<code key={i}>{p.slice(1, -1)}</code>);
    else if (p) out.push(...linkify(p, mark, i));
  });
  return out;
}

/** http(s) URLs; punctuation that ends a sentence or closes a bracket stays outside the link. */
const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/g;

/** Text with its URLs as links: links into this app stay in the tab (they are deep links), others open a new one. */
export function linkify(text: string, mark?: string, key: number | string = 0): (string | React.ReactElement)[] {
  const out: (string | React.ReactElement)[] = [];
  let at = 0;
  for (const m of text.matchAll(URL_RE)) {
    let url = m[0];
    const trail = /[.,;:!?)\]}]+$/.exec(url);
    // keep a closing bracket that belongs to the URL, e.g. https://en.wikipedia.org/wiki/X_(y)
    if (trail && !(trail[0].startsWith(")") && url.includes("("))) url = url.slice(0, -trail[0].length);
    const start = m.index!;
    if (start > at) out.push(...highlight(text.slice(at, start), mark, `${key}.${at}`));
    let local = false;
    try {
      local = new URL(url).origin === location.origin;
    } catch {
      /* not a URL after all */
    }
    out.push(
      <a key={`${key}.u${start}`} href={url} className="link" {...(local ? {} : { target: "_blank", rel: "noreferrer" })} onClick={(e) => e.stopPropagation()}>
        {url}
      </a>,
    );
    at = start + url.length;
  }
  if (at < text.length) out.push(...highlight(text.slice(at), mark, `${key}.${at}`));
  return out;
}

function highlight(text: string, mark: string | undefined, key: number | string): (string | React.ReactElement)[] {
  const term = mark?.trim();
  if (!term || term.length < 2) return [text];
  const re = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  return text.split(re).map((p, i) => (i % 2 ? <mark key={`${key}.${i}`}>{p}</mark> : p));
}

/**
 * How much text a part shows, from a one-line headline to everything that was said and done.
 * The page-wide switch and the −/+ on each part use these same words.
 */
export const DETAIL: { g: Granularity; label: string; hint: string }[] = [
  { g: "title", label: "Low", hint: "One line per part" },
  { g: "abstract", label: "Medium", hint: "A few sentences per part" },
  { g: "summary", label: "High", hint: "A paragraph per part" },
  { g: "full", label: "Raw", hint: "Everything that was said and done, unsummarized" },
];
export const DETAIL_ORDER: Granularity[] = DETAIL.map((d) => d.g);
export const DETAIL_LABEL = Object.fromEntries(DETAIL.map((d) => [d.g, d.label])) as Record<Granularity, string>;
