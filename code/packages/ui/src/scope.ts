/**
 * Coordinated views: every view reads one Scope, derived purely from the session structure,
 * its events, a search index and the URL state.
 *
 * - focus narrows: the reader, graph and timeline show only the focus node (and, inside it, a window)
 * - filter and query only highlight and dim inside the focus; they never hide context
 */
import type { SearchIndex } from "@yolo-twice/analyzers/search";
import type { FilterCode } from "@yolo-twice/analyzers/search";
import type { StructureNode } from "@yolo-twice/core";
import type { ViewState } from "./state";

export interface Unit {
  /** A bar on the timeline: a session, a turn or a step depending on the focus. */
  node: StructureNode;
  start: number; // ms epoch
  end: number;
}

export interface Scope {
  root: StructureNode;
  focus: StructureNode;
  /** The node the graph is drawn for: the focus, or its parent when the focus is a leaf. */
  graphRoot: StructureNode;
  /** Path from the root to the focus, inclusive: the breadcrumb. */
  path: StructureNode[];
  units: Unit[];
  /** Snapped window in seconds from the focus start, and the units inside it. */
  window?: [number, number];
  inWindow: Set<string>;
  /** Events matching filter and query inside focus and window. Empty set when nothing is active. */
  matches: Set<string>;
  active: boolean;
  /** Hits per node id (every ancestor of a matching event counts it). */
  hits: Map<string, number>;
  /** Node ids that contain no hit while a filter is active (to dim). */
  dim: Set<string>;
  parent: Map<string, string>;
  /** Event id -> deepest node that lists it. */
  owner: Map<string, string>;
  focusStart: number;
}

export function* walk(n: StructureNode): Generator<StructureNode> {
  yield n;
  for (const c of n.children) yield* walk(c);
}

function ms(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** Index parents and event owners once per structure. */
export function indexTree(root: StructureNode): { byId: Map<string, StructureNode>; parent: Map<string, string>; owner: Map<string, string> } {
  const byId = new Map<string, StructureNode>();
  const parent = new Map<string, string>();
  const owner = new Map<string, string>();
  const visit = (n: StructureNode) => {
    byId.set(n.id, n);
    for (const id of n.event_ids ?? []) owner.set(id, n.id);
    for (const c of n.children) {
      parent.set(c.id, n.id);
      visit(c);
    }
  };
  visit(root);
  return { byId, parent, owner };
}

/** Bars for the timeline at this focus: turns for a session or phase, steps for a turn or step. */
export function unitsFor(focus: StructureNode): StructureNode[] {
  if (focus.level <= 1) return [...walk(focus)].filter((n) => n.kind === "turn");
  if (focus.children.length) return focus.children;
  return [focus];
}

/** Snap a window (seconds from focus start) outward to whole units. */
export function snapWindow(units: Unit[], focusStart: number, w: [number, number]): { window?: [number, number]; ids: Set<string> } {
  const a = focusStart + w[0] * 1000;
  const b = focusStart + w[1] * 1000;
  const inside = units.filter((u) => u.end >= a && u.start <= b);
  if (inside.length === 0 || inside.length === units.length) return { ids: new Set(units.map((u) => u.node.id)) };
  const start = Math.min(...inside.map((u) => u.start));
  const end = Math.max(...inside.map((u) => u.end));
  return { window: [Math.floor((start - focusStart) / 1000), Math.ceil((end - focusStart) / 1000)], ids: new Set(inside.map((u) => u.node.id)) };
}

export function computeScope(root: StructureNode, index: SearchIndex | undefined, state: Pick<ViewState, "focus" | "window" | "q" | "k">, tree = indexTree(root)): Scope {
  const { byId, parent, owner } = tree;
  const focus = (state.focus && byId.get(state.focus)) || root;
  const graphRoot = focus.children.length ? focus : (parent.has(focus.id) && byId.get(parent.get(focus.id)!)) || focus;

  const path: StructureNode[] = [];
  for (let id: string | undefined = focus.id; id; id = parent.get(id)) path.unshift(byId.get(id)!);

  const focusStart = ms(focus.span.ts_first);
  const units: Unit[] = unitsFor(focus).map((node) => ({ node, start: ms(node.span.ts_first), end: Math.max(ms(node.span.ts_last), ms(node.span.ts_first)) }));
  const snapped = state.window ? snapWindow(units, focusStart, state.window) : { ids: new Set(units.map((u) => u.node.id)) };
  const inWindow = snapped.ids;

  // events in focus and window
  const allowed = new Set<string>();
  const windowed = snapped.window !== undefined;
  for (const u of units) {
    if (windowed && !inWindow.has(u.node.id)) continue;
    for (const n of walk(u.node)) for (const id of n.event_ids ?? []) allowed.add(id);
  }
  if (units.length === 0) for (const n of walk(focus)) for (const id of n.event_ids ?? []) allowed.add(id);

  const codes = state.k.filter((c) => c !== "r") as FilterCode[];
  const rewinds = state.k.includes("r");
  const active = Boolean(state.q.trim()) || state.k.length > 0;
  const matches = new Set<string>();
  if (active && index) {
    const eventLevel = Boolean(state.q.trim()) || codes.length > 0;
    if (eventLevel) for (const id of index.matchIds(state.q, { codes })) if (allowed.has(id)) matches.add(id);
    if (rewinds) {
      // rewound turns are structural: every event of a branch turn counts, intersected with the query if any
      for (const n of walk(focus)) {
        if (n.kind !== "turn" || !n.meta?.branch) continue;
        const qIds = state.q.trim() ? index.matchIds(state.q) : undefined;
        for (const s of walk(n)) for (const id of s.event_ids ?? []) if (allowed.has(id) && (!qIds || qIds.has(id))) matches.add(id);
      }
    }
  }

  const hits = new Map<string, number>();
  for (const id of matches) {
    for (let n: string | undefined = owner.get(id); n; n = parent.get(n)) hits.set(n, (hits.get(n) ?? 0) + 1);
  }
  const dim = new Set<string>();
  // with no match at all there is nothing to point at: dimming everything would only fog the page
  if (active && matches.size > 0) for (const n of walk(focus)) if (!hits.has(n.id)) dim.add(n.id);
  // the window dims what lies outside it, filter or not
  if (windowed) for (const u of units) if (!inWindow.has(u.node.id)) for (const n of walk(u.node)) dim.add(n.id);

  return { root, focus, graphRoot, path, units, window: snapped.window, inWindow, matches, active, hits, dim, parent, owner, focusStart };
}

/** The node to select for an event: its step, or the closest listed ancestor. */
export function nodeForEvent(scope: Scope, eventId: string): string | undefined {
  return scope.owner.get(eventId);
}

/** The newest node: descend into the last child until a leaf (inside a running subagent, too). */
export function latestLeaf(root: StructureNode): StructureNode {
  let n = root;
  while (n.children.length) n = n.children[n.children.length - 1]!;
  return n;
}

/** Path from the root to the newest leaf, inclusive. */
export function latestPath(root: StructureNode): StructureNode[] {
  const path = [root];
  let n = root;
  while (n.children.length) {
    n = n.children[n.children.length - 1]!;
    path.push(n);
  }
  return path;
}

/**
 * Where follow mode moves the view: selection on the newest leaf, and the focus on the newest
 * node of the same kind as the current focus (a focused turn becomes the newest turn).
 */
export function followTarget(root: StructureNode, focus: StructureNode | undefined): { sel: string; focus?: string } {
  const path = latestPath(root);
  const leaf = path[path.length - 1]!;
  if (!focus || focus.id === root.id) return { sel: leaf.id };
  const same = [...path].reverse().find((n) => n.kind === focus.kind && n.level === focus.level) ?? path.find((n) => n.level === focus.level);
  return { sel: leaf.id, focus: same && same.id !== root.id ? same.id : undefined };
}
