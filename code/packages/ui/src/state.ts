/**
 * Addressability: the whole viewer state lives in the URL, as short as possible.
 *
 *   /<project>/<session>/<focus>?t=120-480&x=t2.s3&q=salt&k=t,e&z=s
 *
 * - project  short project key from the engine (`name`, or `name~abcd` on a clash); omitted = engine default
 * - session  session id prefix; a leading `~` means focused but not pinned (Esc can leave it)
 * - focus    structure node id inside the session (`p2`, `t7`, `t1.s5`); omitted = the session itself
 * - t        time window in seconds from the focus start, snapped to whole units by the scope
 * - x        selected node
 * - q        text query
 * - k        filter codes, comma separated (see analyzers/search.ts)
 * - z        default text granularity: t(itle) a(bstract, default) s(ummary) f(ull)
 * - f        follow: keep the view on the newest events as they arrive (like `tail -f`)
 *
 * Defaults are omitted. Pure functions here; the React hook lives at the bottom.
 */
import { useCallback, useEffect, useState } from "react";
import type { FilterCode } from "@yolo-twice/analyzers/search";
import type { Granularity } from "@yolo-twice/core";

export interface ViewState {
  project: string;
  session?: string;
  pinned: boolean;
  focus?: string;
  window?: [number, number];
  sel?: string;
  q: string;
  k: FilterCode[];
  z: Granularity;
  follow: boolean;
}

export const EMPTY: ViewState = { project: "", pinned: true, q: "", k: [], z: "abstract", follow: false };

const Z_CODE: Record<Granularity, string> = { title: "t", abstract: "a", summary: "s", full: "f" };
const Z_FROM: Record<string, Granularity> = { t: "title", a: "abstract", s: "summary", f: "full" };

const VALID_CODE = /^(u|a|h|t|e|s|c|r|t:[^,]+)$/;

/** Query values keep `,` and `:` readable; everything else is percent-encoded. */
function enc(v: string): string {
  return encodeURIComponent(v).replace(/%2C/gi, ",").replace(/%3A/gi, ":");
}

export function parseUrl(pathname: string, search: string): ViewState {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const p = new URLSearchParams(search);
  const state: ViewState = { ...EMPTY, k: [] };
  // legacy links from the first UI: ?project=<root>&session=<id>
  const legacyProject = p.get("project");
  if (legacyProject) state.project = legacyProject.split("/").filter(Boolean).pop() ?? "";
  if (p.get("session")) state.session = p.get("session")!;
  if (parts[0]) state.project = parts[0];
  if (parts[1]) {
    state.pinned = !parts[1].startsWith("~");
    state.session = parts[1].replace(/^~/, "");
  }
  if (parts[2]) state.focus = parts[2];
  const t = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(p.get("t") ?? "");
  if (t) {
    const a = Number(t[1]);
    const b = Number(t[2]);
    if (b > a) state.window = [a, b];
  }
  if (p.get("x")) state.sel = p.get("x")!;
  state.q = p.get("q") ?? "";
  state.k = (p.get("k") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is FilterCode => VALID_CODE.test(s));
  state.z = Z_FROM[p.get("z") ?? ""] ?? "abstract";
  state.follow = p.has("f");
  return state;
}

export function toUrl(s: ViewState): string {
  const segs: string[] = [];
  if (s.project || s.session) segs.push(s.project || "-");
  if (s.session) {
    segs.push((s.pinned ? "" : "~") + s.session);
    if (s.focus) segs.push(s.focus);
  }
  const path = "/" + segs.map((x) => encodeURIComponent(x)).join("/");
  const q: string[] = [];
  if (s.window) q.push(`t=${round(s.window[0])}-${round(s.window[1])}`);
  if (s.sel) q.push(`x=${enc(s.sel)}`);
  if (s.q) q.push(`q=${enc(s.q)}`);
  if (s.k.length) q.push(`k=${s.k.map(enc).join(",")}`);
  if (s.z !== "abstract") q.push(`z=${Z_CODE[s.z]}`);
  if (s.follow) q.push("f");
  return path + (q.length ? `?${q.join("&")}` : "");
}

function round(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Shortest prefix of `id` (at least `min` chars) that no other id shares. */
export function shortId(id: string, ids: string[], min = 6): string {
  for (let n = min; n < id.length; n++) {
    const pre = id.slice(0, n);
    if (!ids.some((o) => o !== id && o.startsWith(pre))) return pre;
  }
  return id;
}

/** Full session id for a URL prefix, if exactly one matches. */
export function resolveId(prefix: string | undefined, ids: string[]): string | undefined {
  if (!prefix) return undefined;
  if (ids.includes(prefix)) return prefix;
  const hits = ids.filter((i) => i.startsWith(prefix));
  return hits.length === 1 ? hits[0] : undefined;
}

/** Changes that move the user somewhere new get a history entry; tweaks replace the current one. */
export function isNavigation(a: ViewState, b: ViewState): boolean {
  return a.project !== b.project || a.session !== b.session || a.pinned !== b.pinned || a.focus !== b.focus;
}

/* ---------- React binding ---------- */

export type SetView = (patch: Partial<ViewState> | ((s: ViewState) => Partial<ViewState>), opts?: { push?: boolean }) => void;

export function useViewState(): [ViewState, SetView] {
  const [state, setState] = useState<ViewState>(() => parseUrl(location.pathname, location.search));

  useEffect(() => {
    const onPop = () => setState(parseUrl(location.pathname, location.search));
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  const set: SetView = useCallback((patch, opts) => {
    setState((cur) => {
      const next = { ...cur, ...(typeof patch === "function" ? patch(cur) : patch) };
      const url = toUrl(next);
      if (url !== location.pathname + location.search) {
        const push = opts?.push ?? isNavigation(cur, next);
        if (push) history.pushState(null, "", url);
        else history.replaceState(null, "", url);
      }
      return next;
    });
  }, []);

  return [state, set];
}
