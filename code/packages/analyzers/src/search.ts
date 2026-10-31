import MiniSearch from "minisearch";
import type { Event } from "@yolo-twice/core";

export interface SearchDoc {
  id: string;
  session: string;
  kind: string;
  tool: string;
  ts: string;
  text: string;
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

/** In-memory full-text index over events. Rebuilt from events.ndjson, so nothing to persist. */
export class SearchIndex {
  private ms = new MiniSearch<SearchDoc>({
    fields: ["text", "tool", "kind"],
    storeFields: ["session", "kind", "tool", "ts", "text"],
    searchOptions: { prefix: true, fuzzy: 0.15, boost: { tool: 2 } },
  });
  private seen = new Set<string>();

  add(events: Event[]): number {
    const docs: SearchDoc[] = [];
    for (const e of events) {
      if (this.seen.has(e.id)) continue;
      if (!e.text || e.kind === "meta" || e.kind === "cost") continue;
      this.seen.add(e.id);
      docs.push({ id: e.id, session: e.session, kind: e.kind, tool: e.tool?.name ?? "", ts: e.ts, text: e.text });
    }
    this.ms.addAll(docs);
    return docs.length;
  }

  search(query: string, opts: { session?: string; limit?: number } = {}): SearchHit[] {
    const limit = opts.limit ?? 50;
    const hits = this.ms.search(query, { filter: opts.session ? (d) => d.session === opts.session : undefined });
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

  get size(): number {
    return this.seen.size;
  }
}

export function snippet(text: string, query: string, width = 160): string {
  const term = query.split(/\s+/).find((t) => t.length > 1) ?? query;
  const i = text.toLowerCase().indexOf(term.toLowerCase());
  const start = Math.max(0, (i < 0 ? 0 : i) - Math.floor(width / 3));
  const s = text.slice(start, start + width).replace(/\s+/g, " ");
  return (start > 0 ? "…" : "") + s + (start + width < text.length ? "…" : "");
}
