/**
 * Scripted demos: the real product, stepped like slides.
 *
 * A demo is a list of keyframes. Each step names the whole view as a URL (see state.ts), so going
 * back, skipping ahead or clicking around in between always lands on the same screen. `do` adds
 * what a URL cannot hold: pointing at a part, opening it, typing a search, any key of the keymap.
 *
 * Scripts live with the project in .yolo-twice/demos/<name>.json and play with ?demo=<name>.
 * A page that embeds the UI (the pitch deck) steps it with postMessage instead:
 *   in   { yt: "demo", name, step }     load the project's script (once) and show that step
 *        { yt: "demo", script, step }   the same with a script the page keeps itself
 *   out  { yt: "ready" }                the UI is up and listening
 *        { yt: "step", step, steps, caption }  a step was shown (the deck can show the caption)
 *        { yt: "nav", dir }             PageDown / PageUp pressed inside the frame: the deck decides
 */
import { parseUrl, type ViewState } from "./state";

export type Target = "text" | "map" | "timeline";

export type Command =
  /** Glide the pointer to a part and light it up in every view; null hides the pointer. */
  | { point: string | null; on?: Target }
  | { open: string }
  | { close: string }
  /** Bring one event's passage to the middle of the text (its id from events.ndjson), opening its part. */
  | { reveal: string }
  /** Type into the search box, a character at a time (`ms` per character, default 160). */
  | { type: string; ms?: number }
  /** A key of the keymap, named as keys.ts names it: "n", "Shift+n", "c", "3", "ArrowDown". */
  | { key: string }
  | { tab: "story" | "results" }
  | { wait: number };

export interface Step {
  /** The view, as a URL. Without a leading slash it is relative to the current project: "~34b27c/p3?z=t". */
  view: string;
  do?: Command[];
  /** Shown in the demo bar. */
  caption?: string;
  /** Go on by itself after this many ms; a clicker can still step sooner. */
  wait?: number;
}

export interface Demo {
  title?: string;
  steps: Step[];
  /** After the last step, start over (a booth loop); otherwise the demo stays on its last step. */
  loop?: boolean;
}

const COMMANDS = ["point", "open", "close", "reveal", "type", "key", "tab", "wait"];

/** A demo from untrusted JSON: throws with a message that names the bad step. */
export function parseDemo(raw: unknown): Demo {
  const d = raw as Partial<Demo> | null;
  if (!d || !Array.isArray(d.steps) || d.steps.length === 0) throw new Error("a demo needs a non-empty steps list");
  d.steps.forEach((s, i) => {
    if (typeof s?.view !== "string") throw new Error(`step ${i + 1} needs a view (a URL)`);
    if (s.do !== undefined && !Array.isArray(s.do)) throw new Error(`step ${i + 1}: do must be a list`);
    for (const c of s.do ?? []) {
      const k = c && typeof c === "object" ? Object.keys(c).find((x) => COMMANDS.includes(x)) : undefined;
      if (!k) throw new Error(`step ${i + 1}: unknown command ${JSON.stringify(c)}`);
    }
  });
  return { title: typeof d.title === "string" ? d.title : undefined, steps: d.steps, loop: d.loop === true };
}

/** The complete view a step names: whatever its URL leaves out is reset, not kept from before. */
export function stepView(view: string, project: string): ViewState {
  const url = new URL(view.startsWith("/") ? view : `/${encodeURIComponent(project)}/${view}`, "http://demo");
  return { session: undefined, focus: undefined, window: undefined, sel: undefined, ...parseUrl(url.pathname, url.search) };
}

/** Where the arrows of the demo bar (and a clicker's PageDown/PageUp) take you: clamped, never wrapping. */
export function clampStep(n: number, steps: number): number {
  return Math.max(0, Math.min(steps - 1, n));
}

/** Messages from these pages may step the demo: the deck on this machine, and the published one. */
export function trustedOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) || u.origin === "https://bar9.github.io" || u.origin === globalThis.location?.origin;
  } catch {
    return false;
  }
}
