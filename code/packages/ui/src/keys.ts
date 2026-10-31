/**
 * The keymap: one table drives both the handling and the cheat sheet, so they cannot drift apart.
 *
 * Four axes, one key family each:
 *   scope (focus)  ← →        the breadcrumb runs left to right
 *   selection      ↑ ↓ Space  a list, top to bottom
 *   detail         − + , .    the page, or only the selected part
 *   filters, views letters and digits, named on the controls
 *
 * Single keys work while focus is not in a text field, menu or dialog. Ctrl, ⌘ and Alt
 * combinations are left to the browser. The graph canvas keeps its own arrows and − + 0 while
 * it has focus.
 */

export interface KeyActions {
  move(dir: 1 | -1): void;
  first(): void;
  zoomIn(): void;
  widen(): void;
  widenToTop(): void;
  togglePart(): void;
  newest(): void;
  search(): void;
  nextMatch(dir: 1 | -1): void;
  toggleKind(index: number): void;
  toggleFold(): void;
  clearAll(): void;
  detail(dir: 1 | -1): void;
  partDetail(dir: 1 | -1): void;
  cycleLayout(): void;
  toggleFollow(): void;
  togglePin(): void;
  catchMeUp(): void;
  shortcuts(): void;
}

export type KeyGroup = "Navigate" | "Search and filter" | "Detail" | "Views and live";

export interface Binding {
  id: string;
  group: KeyGroup;
  /** Key names as produced by keyName(). */
  keys: string[];
  /** How the keys are shown to people. */
  show: string[];
  label: string;
  run: (a: KeyActions, key: string) => void;
}

const digits = ["1", "2", "3", "4", "5", "6", "7", "8"];

export const BINDINGS: Binding[] = [
  { id: "next", group: "Navigate", keys: ["ArrowDown", "j"], show: ["↓", "j"], label: "Next part", run: (a) => a.move(1) },
  { id: "prev", group: "Navigate", keys: ["ArrowUp", "k"], show: ["↑", "k"], label: "Previous part", run: (a) => a.move(-1) },
  { id: "in", group: "Navigate", keys: ["ArrowRight", "Enter"], show: ["→", "Enter"], label: "Zoom into the selected part", run: (a) => a.zoomIn() },
  { id: "out", group: "Navigate", keys: ["ArrowLeft", "Escape"], show: ["←", "Esc"], label: "Widen the scope one level (clears a time window first)", run: (a) => a.widen() },
  { id: "top", group: "Navigate", keys: ["Shift+ArrowLeft"], show: ["⇧ ←"], label: "Widen to the top", run: (a) => a.widenToTop() },
  { id: "toggle", group: "Navigate", keys: ["Space"], show: ["Space"], label: "Open or close the selected part", run: (a) => a.togglePart() },
  { id: "first", group: "Navigate", keys: ["Home"], show: ["Home"], label: "First part", run: (a) => a.first() },
  { id: "newest", group: "Navigate", keys: ["End"], show: ["End"], label: "Newest part, and follow", run: (a) => a.newest() },

  { id: "search", group: "Search and filter", keys: ["/"], show: ["/"], label: "Search; Enter jumps to the first match", run: (a) => a.search() },
  { id: "next-match", group: "Search and filter", keys: ["n"], show: ["n"], label: "Next match", run: (a) => a.nextMatch(1) },
  { id: "prev-match", group: "Search and filter", keys: ["Shift+n"], show: ["⇧ N"], label: "Previous match", run: (a) => a.nextMatch(-1) },
  { id: "kinds", group: "Search and filter", keys: digits, show: ["1", "…", "8"], label: "Toggle a kind: You, Claude, Thinking, Tools, Errors, Subagents, Compactions, Rewinds", run: (a, k) => a.toggleKind(Number(k) - 1) },
  { id: "fold", group: "Search and filter", keys: ["h"], show: ["h"], label: "Hide or show filtered parts", run: (a) => a.toggleFold() },
  { id: "clear", group: "Search and filter", keys: ["x"], show: ["x"], label: "Clear search, filters and time window", run: (a) => a.clearAll() },

  { id: "less", group: "Detail", keys: ["-"], show: ["−"], label: "Less detail, whole page", run: (a) => a.detail(-1) },
  { id: "more", group: "Detail", keys: ["+", "="], show: ["+"], label: "More detail, whole page", run: (a) => a.detail(1) },
  { id: "part-less", group: "Detail", keys: [","], show: [","], label: "Less detail, selected part only", run: (a) => a.partDetail(-1) },
  { id: "part-more", group: "Detail", keys: ["."], show: ["."], label: "More detail, selected part only", run: (a) => a.partDetail(1) },

  { id: "layout", group: "Views and live", keys: ["v"], show: ["v"], label: "Cycle the views: Read, Split, Map", run: (a) => a.cycleLayout() },
  { id: "follow", group: "Views and live", keys: ["f"], show: ["f"], label: "Follow the newest events on or off", run: (a) => a.toggleFollow() },
  { id: "pin", group: "Views and live", keys: ["p"], show: ["p"], label: "Pin or unpin the session", run: (a) => a.togglePin() },
  { id: "catch", group: "Views and live", keys: ["c"], show: ["c"], label: "Catch me up", run: (a) => a.catchMeUp() },
  { id: "help", group: "Views and live", keys: ["?"], show: ["?"], label: "Help: keyboard shortcuts, guide and about", run: (a) => a.shortcuts() },
];

export const GROUPS: KeyGroup[] = ["Navigate", "Search and filter", "Detail", "Views and live"];

/** The key as the table names it; undefined for Ctrl, ⌘ and Alt combinations (those belong to the browser). */
export function keyName(e: { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): string | undefined {
  if (e.ctrlKey || e.metaKey || e.altKey) return undefined;
  const k = e.key === " " ? "Space" : e.key;
  if (k.length === 1) return /[a-z]/i.test(k) ? (e.shiftKey ? "Shift+" : "") + k.toLowerCase() : k; // symbols already carry Shift
  return (e.shiftKey ? "Shift+" : "") + k;
}

const byKey = new Map(BINDINGS.flatMap((b) => b.keys.map((k) => [k, b] as const)));

export function bindingFor(name: string | undefined): Binding | undefined {
  return name ? byKey.get(name) : undefined;
}

/** " (f)" for a tooltip, from the table. */
export function hint(id: string): string {
  const b = BINDINGS.find((x) => x.id === id);
  return b ? ` (${b.show.join(" or ")})` : "";
}
