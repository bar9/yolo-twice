import MiniSearch from "minisearch";
import type { Event } from "@yolo-twice/core";

/**
 * Filter codes, shared by the engine, the UI and the URL (`k=u,t:Bash,e`).
 * Codes are OR'd: `u,e` means user prompts or tool errors.
 *   u  user prompts (the human; subagent briefs excluded)   a  assistant text   h  thinking
 *   t  tool calls and results t:Name  one tool          e  tool errors
 *   s  subagent activity      c  compactions and commands
 *   r  rewound turns (structural; resolved by the UI from the structure, ignored here)
 */
export type FilterCode = "u" | "a" | "h" | "t" | "e" | "s" | "c" | "r" | `t:${string}`;

export interface EventFilter {
  codes?: FilterCode[];
  /** ISO timestamps, inclusive. */
  from?: string;
  to?: string;
  session?: string;
}

export interface SearchDoc {
  id: string;
  session: string;
  kind: string;
  tool: string;
  agent: string; // "" for the main agent
  error: boolean;
  ts: string;
  text: string;
  order: number;
}

export interface SearchHit {
  id: string;
  session: string;
  kind: string;
  tool: string;
  ts: string;
  score: number;
  snippet: string;
}

export function parseCodes(raw: string | undefined | null): FilterCode[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is FilterCode => /^(u|a|h|t|e|s|c|r)$/.test(s) || /^t:.+/.test(s));
}

/** Predicate over a document. Empty filter matches everything. */
export function docMatcher(filter: EventFilter): (d: Pick<SearchDoc, "session" | "kind" | "tool" | "agent" | "error" | "ts">) => boolean {
  const codes = (filter.codes ?? []).filter((c) => c !== "r");
  const tools = new Set(codes.filter((c) => c.startsWith("t:")).map((c) => c.slice(2)));
  const has = new Set(codes.filter((c) => !c.startsWith("t:")));
  return (d) => {
    if (filter.session && d.session !== filter.session) return false;
    if (filter.from && d.ts < filter.from) return false;
    if (filter.to && d.ts > filter.to) return false;
    if (codes.length === 0) return true;
    if (has.has("u") && d.kind === "user.prompt" && d.agent === "") return true; // the human, not a subagent brief
    if (has.has("a") && d.kind === "assistant.text") return true;
    if (has.has("h") && d.kind === "assistant.thinking") return true;
    if (has.has("t") && (d.kind === "tool.call" || d.kind === "tool.result")) return true;
    if (has.has("e") && d.error) return true;
    if (has.has("s") && (d.agent !== "" || d.kind.startsWith("subagent."))) return true;
    if (has.has("c") && (d.kind === "compaction" || d.kind === "user.command")) return true;
    if (tools.size && (d.kind === "tool.call" || d.kind === "tool.result") && tools.has(d.tool)) return true;
    return false;
  };
}

/** Turn events into search documents. Tool results inherit the tool name of their call. */
export function toDocs(events: Event[], toolByCall = new Map<string, string>(), startOrder = 0): SearchDoc[] {
  const docs: SearchDoc[] = [];
  let order = startOrder;
  for (const e of events) {
    if (e.kind === "tool.call" && e.tool?.call_id) toolByCall.set(e.tool.call_id, e.tool.name);
    if (e.kind === "meta" || e.kind === "cost" || e.kind === "title" || e.kind === "system") continue;
    const tool = e.tool?.name || (e.tool?.call_id ? toolByCall.get(e.tool.call_id) ?? "" : "");
    docs.push({
      id: e.id,
      session: e.session,
      kind: e.kind,
      tool,
      agent: e.agent_id ?? "",
      error: e.data?.is_error === true,
      ts: e.ts,
      text: e.text,
      order: order++,
    });
  }
  return docs;
}

/** Filter events without a text query, in event order. Pure: used by the UI as well. */
export function filterEvents(events: Event[], filter: EventFilter): string[] {
  const match = docMatcher(filter);
  return toDocs(events).filter(match).map((d) => d.id);
}

/** In-memory full-text index over events. Rebuilt from events.ndjson, so nothing to persist. */
export class SearchIndex {
  private ms = new MiniSearch<SearchDoc>({
    fields: ["text", "tool", "kind"],
    storeFields: ["session", "kind", "tool", "agent", "error", "ts", "text", "order"],
    searchOptions: { prefix: true, fuzzy: 0.15, boost: { tool: 2 } },
  });
  private docs: SearchDoc[] = [];
  private seen = new Set<string>();
  private toolByCall = new Map<string, string>();

  add(events: Event[]): number {
    const fresh: Event[] = [];
    for (const e of events) {
      if (this.seen.has(e.id)) continue; // also drops repeats inside one batch
      this.seen.add(e.id);
      fresh.push(e);
    }
    const docs = toDocs(fresh, this.toolByCall, this.docs.length);
    this.docs.push(...docs);
    this.ms.addAll(docs.filter((d) => d.text));
    return docs.length;
  }

  /** Ranked text search; with an empty query, all matching events in order. */
  search(query: string, opts: EventFilter & { limit?: number } = {}): SearchHit[] {
    const limit = opts.limit ?? 50;
    const match = docMatcher(opts);
    if (!query.trim()) {
      return this.docs
        .filter(match)
        .slice(0, limit)
        .map((d) => ({ id: d.id, session: d.session, kind: d.kind, tool: d.tool, ts: d.ts, score: 0, snippet: snippet(d.text, "") }));
    }
    const hits = this.ms.search(query, { filter: (r) => match(r as unknown as SearchDoc) });
    return hits.slice(0, limit).map((h) => ({
      id: h.id as string,
      session: h.session as string,
      kind: h.kind as string,
      tool: h.tool as string,
      ts: h.ts as string,
      score: h.score,
      snippet: snippet(String(h.text ?? ""), query),
    }));
  }

  /** Ids of every event matching query and filter, unranked and unlimited (for highlighting). */
  matchIds(query: string, filter: EventFilter = {}): Set<string> {
    const match = docMatcher(filter);
    if (!query.trim()) return new Set(this.docs.filter(match).map((d) => d.id));
    return new Set(this.ms.search(query, { filter: (r) => match(r as unknown as SearchDoc) }).map((h) => h.id as string));
  }

  /** Tool names seen, most used first. */
  tools(): string[] {
    const n = new Map<string, number>();
    for (const d of this.docs) if (d.kind === "tool.call" && d.tool) n.set(d.tool, (n.get(d.tool) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
  }

  get size(): number {
    return this.seen.size;
  }
}

export function snippet(text: string, query: string, width = 160): string {
  const term = query.split(/\s+/).find((t) => t.length > 1) ?? query;
  const i = term ? text.toLowerCase().indexOf(term.toLowerCase()) : 0;
  const start = Math.max(0, (i < 0 ? 0 : i) - Math.floor(width / 3));
  const s = text.slice(start, start + width).replace(/\s+/g, " ");
  return (start > 0 ? "…" : "") + s + (start + width < text.length ? "…" : "");
}
