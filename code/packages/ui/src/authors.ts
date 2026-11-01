/**
 * Who wrote what, from the engine's git blame of events.ndjson (GET /api/sessions/:id/authors).
 * Shown only where the author changes, so a single-author project shows nothing at all.
 */
import type { Event, StructureNode } from "@yolo-twice/core";
import type { Author, AuthorRun } from "./api";

export const sameAuthors = (a: Author[] = [], b: Author[] = []) => a.map((x) => x.email_sha256).join() === b.map((x) => x.email_sha256).join();

/** Distinct authors over every session of the project. */
export function authorCount(sessions: { authors?: Author[] }[]): number {
  return new Set(sessions.flatMap((s) => (s.authors ?? []).map((a) => a.email_sha256))).size;
}

/** Position of every event in the session file: blame is per line, so file order is the order that counts. */
export function eventOrder(events: Map<string, Event> | undefined): Map<string, number> {
  const m = new Map<string, number>();
  let i = 0;
  for (const id of events?.keys() ?? []) m.set(id, i++);
  return m;
}

function contains(node: StructureNode, at: number, order: Map<string, number>): boolean {
  const a = order.get(node.span.first);
  const b = order.get(node.span.last);
  return a !== undefined && b !== undefined && a <= at && at <= b;
}

/** The author of the run a node starts in. */
export function authorAt(node: StructureNode, runs: AuthorRun[], order: Map<string, number>): Author | undefined {
  const at = order.get(node.span.first);
  if (at === undefined) return undefined;
  return runs.find((r) => (order.get(r.first) ?? Infinity) <= at && at <= (order.get(r.last) ?? -Infinity));
}

/** A change of author at a part: it starts there (`here`), or the part holds one partway through. */
export interface Handover {
  authors: Author[];
  here: boolean;
}

/**
 * Where someone takes over, below `root`: the part that starts with each change of author. The parts
 * around it hold a change partway through and show both faces. Reader and graph mark the same
 * parts, so a split view shows the takeover in the same place.
 */
export function takeovers(root: StructureNode, runs: AuthorRun[], order: Map<string, number>): Map<string, Handover> {
  const out = new Map<string, Handover>();
  runs.forEach((run, i) => {
    const at = order.get(run.first);
    if (i === 0 || at === undefined) return;
    for (let node = root; ; ) {
      const part = node.children.find((c) => contains(c, at, order));
      // no smaller part holds it: the change is inside this one's own events
      if (!part) return node !== root && out.set(node.id, { authors: [run], here: true });
      if (order.get(part.span.first) === at) return out.set(part.id, { authors: [run], here: true });
      const prev = out.get(part.id)?.authors ?? [runs[i - 1]!];
      out.set(part.id, { authors: prev.some((a) => a.email_sha256 === run.email_sha256) ? prev : [...prev, run], here: false });
      node = part;
    }
  });
  return out;
}
