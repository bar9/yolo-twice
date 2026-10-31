import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { focusFlow, projectFlow, type FlowGraph } from "@yolo-twice/analyzers/graph";
import { SearchIndex, type FilterCode } from "@yolo-twice/analyzers/search";
import { useDefaultLayout } from "react-resizable-panels";
import { ArrowDown, ArrowUp, BookOpenText, Clock, Coins, ListTree, TriangleAlert, Wrench } from "lucide-react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api, fmtDuration, fmtTime, fmtTokens, setProject, storage, store, type Attention, type AutoCommit, type Config, type Event, type Granularity, type ProjectIndex, type SearchHit, type StructureNode } from "./api";
import { Header } from "./Header";
import { FilterBar } from "./FilterBar";
import { Timeline, type Bar, type Tick } from "./Timeline";
import { Graph, type GraphApi, type HoverInfo } from "./Graph";
import { Results, Zoom, type ZoomApi } from "./Zoom";
import { CHIPS } from "./FilterBar";
import { Help, type HelpTab } from "./Help";
import { TourInvite } from "./TourInvite";
import { useKeyboard } from "./useKeyboard";
import type { KeyActions } from "./keys";
import { DemoBar, DemoPointer, useDemo } from "./DemoPlayer";
import { useCtrlWheel } from "./wheelZoom";
import { matchOrder, stepIn } from "./nav";
import { useStream } from "./useStream";
import { resolveId, shortId, useViewState, type Layout, type SetView, type ViewState } from "./state";
import { computeScope, foldTree, followTarget, indexTree, walk } from "./scope";
import { DETAIL, DETAIL_ORDER, KIND, KindIcon, kindStyle, nodeKind, richText, type Kind } from "./kinds";

// the tour pulls in react-joyride; it is only fetched when a tour starts
const Tour = lazy(() => import("./Tour"));

type Index = ProjectIndex & { current?: string };
const sessionNode = (id: string) => `s:${id}`;
const WAVE_BUCKETS = 160;

/** Per-viewer pane sizes; storage can be unavailable (private mode, previews), then sizes just reset. */
const safeStorage = {
  getItem: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* not persisted */
    }
  },
};

function useNarrow(): boolean {
  const q = "(max-width: 860px)";
  const [narrow, setNarrow] = useState(() => typeof matchMedia !== "undefined" && matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return narrow;
}

/**
 * Coordinated views. The URL is the single source of truth (see state.ts); every view is a
 * projection of the same scope: focus narrows, filter and query highlight, selection and hover link.
 */
export function App() {
  const [view, setView] = useViewState();
  const [index, setIndex] = useState<Index | undefined>();
  const [structure, setStructure] = useState<StructureNode | undefined>();
  const [events, setEvents] = useState<Map<string, Event> | undefined>();
  const [config, setConfig] = useState<Config | undefined>();
  const [autoCommit, setAutoCommit] = useState<AutoCommit | undefined>();
  const [digest, setDigest] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [hover, setHover] = useState<string | undefined>();
  const [card, setCard] = useState<HoverInfo | undefined>();
  // what the hooks say Claude is doing, per session
  const [activity, setActivity] = useState<Record<string, { activity: "working" | "waiting" | "idle"; ts: string }>>({});
  const [reader, setReader] = useState<"outline" | "results">("outline");
  const [overrides, setOverrides] = useState<Record<string, Granularity>>({});
  // while filtering, parts without matches fold away by default; the filter bar toggles it
  const [foldRest, setFoldRest] = useState(true);
  const [projectHits, setProjectHits] = useState<SearchHit[]>([]);
  const [projectTools, setProjectTools] = useState<string[]>([]);
  const narrow = useNarrow();
  const panes = useDefaultLayout({ id: "yt.panes", storage: safeStorage });

  setProject(view.project);
  const ids = useMemo(() => (index?.sessions ?? []).map((s) => s.id), [index]);
  const sessionId = resolveId(view.session, ids);
  const sessionMeta = index?.sessions.find((s) => s.id === sessionId);

  /* ---------- loading ---------- */

  const loadIndex = useCallback(async () => {
    try {
      setIndex(await api.sessions());
      setError(undefined);
    } catch (e) {
      setError(String(e));
    }
  }, []);
  const loadStructure = useCallback(async (id: string) => {
    try {
      setStructure(await api.structure(id));
    } catch (e) {
      setError(String(e));
    }
  }, []);
  const loadEvents = useCallback(async (id: string) => {
    try {
      setEvents(new Map((await api.events(id)).map((e) => [e.id, e])));
    } catch {
      /* the reader shows "loading" */
    }
  }, []);

  // give a bare "/" a shareable project key
  useEffect(() => {
    if (view.project) return;
    api
      .projects()
      .then((ps) => ps.length && setView({ project: ps.at(-1)!.key }, { push: false }))
      .catch(() => undefined);
  }, [view.project, setView]);

  useEffect(() => {
    void loadIndex();
    api.config().then(setConfig).catch(() => undefined);
    api.autoCommit().then(setAutoCommit).catch(() => undefined);
  }, [loadIndex, view.project]);

  useEffect(() => {
    setStructure(undefined);
    setEvents(undefined);
    setDigest(undefined);
    if (!sessionId) return;
    void loadStructure(sessionId);
    void loadEvents(sessionId);
  }, [sessionId, loadStructure, loadEvents]);

  // shorten a full or legacy session id in the URL
  useEffect(() => {
    if (sessionId && view.session !== shortId(sessionId, ids)) setView({ session: shortId(sessionId, ids) }, { push: false });
  }, [sessionId, ids, view.session, setView]);

  useEffect(() => {
    if (sessionId && structure?.span.last) store(`yt.seen.${sessionId}`, structure.span.last);
  }, [sessionId, structure]);

  const live = useStream((ev) => {
    switch (ev.type) {
      case "structure":
      case "semantic":
        if (ev.data.session === sessionId) void loadStructure(sessionId);
        void loadIndex();
        break;
      case "ingest":
        if (ev.data.session === sessionId) void loadEvents(sessionId);
        break;
      case "config":
        api.config().then(setConfig).catch(() => undefined);
        break;
      case "autocommit":
        setAutoCommit(ev.data);
        break;
      case "activity":
        setActivity((a) => ({ ...a, [ev.data.session_id]: ev.data }));
        break;
    }
  });

  /* ---------- session scope ---------- */

  const searchIndex = useMemo(() => {
    if (!events) return undefined;
    const idx = new SearchIndex();
    idx.add([...events.values()]);
    return idx;
  }, [events]);
  const tree = useMemo(() => (structure ? indexTree(structure) : undefined), [structure]);
  // typing stays responsive: search, dimming and the views catch up at low priority, interruptibly
  const dq = useDeferredValue(view.q);
  const dk = useDeferredValue(view.k);
  const scope = useMemo(
    () => (structure && tree ? computeScope(structure, searchIndex, { focus: view.focus, window: view.window, q: dq, k: dk }, tree) : undefined),
    [structure, tree, searchIndex, view.focus, view.window, dq, dk],
  );

  // the URL keeps the raw brush; the snap to whole units is recomputed from it, so it is deterministic

  /* ---------- follow (tail -f) ---------- */

  // anything the user does to move the view takes it off the tail, like scrolling up in a CI log
  const act: SetView = useCallback(
    (patch, opts) => setView((s) => ({ ...(typeof patch === "function" ? patch(s) : patch), follow: false }), opts),
    [setView],
  );

  useEffect(() => {
    if (!view.follow) return;
    if (sessionId && structure && tree) {
      const t = followTarget(structure, view.focus ? tree.byId.get(view.focus) : undefined);
      const patch: Partial<ViewState> = {};
      if (t.sel !== view.sel) patch.sel = t.sel;
      if (t.focus !== view.focus) patch.focus = t.focus;
      if (view.window) patch.window = undefined;
      if (Object.keys(patch).length) setView(patch, { push: false });
    } else if (!sessionId && index?.current) {
      // at the project root, follow means: open the session that is active right now
      setView({ session: shortId(index.current, ids), pinned: false, focus: undefined, window: undefined }, { push: false });
    }
  }, [view.follow, view.focus, view.sel, view.window, sessionId, structure, tree, index, ids, setView]);

  // events that arrived while not following: shown as "N new", a click jumps to the tail
  const [seen, setSeen] = useState(0);
  const total = events?.size ?? 0;
  useEffect(() => {
    if (view.follow) setSeen(total);
  }, [view.follow, total]);
  useEffect(() => setSeen(0), [sessionId]);
  const unseen = !view.follow && seen > 0 ? Math.max(0, total - seen) : 0;

  /* ---------- scroll lock, like a terminal: up locks, down to the newest follows again ---------- */

  // only scrolling right after the user's own input counts; the panes' own follow scrolling never does
  const userInput = useRef(0);
  const quietUntil = useRef(0);
  const lastTop = useRef(0);
  const [locked, setLocked] = useState(false);
  const markUser = useCallback(() => (userInput.current = Date.now()), []);
  useEffect(() => {
    if (view.follow) setLocked(false);
  }, [view.follow]);
  useEffect(() => setLocked(false), [sessionId]);
  const scrollLock = useCallback(() => {
    if (!view.follow) return;
    setView({ follow: false }, { push: false });
    setLocked(true);
  }, [view.follow, setView]);
  const scrollTail = useCallback(() => {
    if (view.follow || !sessionId || Date.now() < quietUntil.current) return;
    quietUntil.current = Date.now() + 900; // the jump to the newest node is not the user scrolling
    setView({ follow: true }, { push: false });
  }, [view.follow, sessionId, setView]);
  const onReaderScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const prev = lastTop.current;
    lastTop.current = el.scrollTop;
    if (Date.now() - userInput.current > 700 || Date.now() < quietUntil.current) return;
    syncMapToReader(el);
    // the reader keeps 45vh of room below the last node; inside that room counts as the bottom
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= innerHeight * 0.45 + 32;
    if (el.scrollTop < prev - 2) scrollLock();
    else if (el.scrollTop > prev && atBottom) scrollTail();
  };

  /* ---------- scroll sync (Split view): both panes show the part at their reading line ---------- */
  // only the pane the user moves leads; the other follows by program, which its own handler ignores
  const graphApi = useRef<GraphApi>(null);
  const readerBody = useRef<HTMLDivElement>(null);
  const synced = useRef<string | undefined>(undefined);
  const syncFrame = useRef(0);
  const syncMapToReader = (el: HTMLElement) => {
    if (layout !== "split" || !sessionId) return;
    cancelAnimationFrame(syncFrame.current);
    syncFrame.current = requestAnimationFrame(() => {
      // the last row that starts above the reader's reading line, a third of the way down
      const line = el.getBoundingClientRect().top + el.clientHeight / 3;
      let id: string | undefined;
      for (const row of el.querySelectorAll<HTMLElement>(".zoom .node:not(.root) > .row")) {
        if (row.getBoundingClientRect().top > line) break;
        id = row.parentElement!.id.slice("node-".length);
      }
      if (!id || id === synced.current) return;
      synced.current = id;
      graphApi.current?.reveal(id);
    });
  };
  const syncReaderToMap = useRef((_id: string) => {});
  syncReaderToMap.current = (id: string) => {
    const el = readerBody.current;
    if (layout !== "split" || !sessionId || !el || id === synced.current) return;
    synced.current = id;
    // the part's row, or its closest ancestor the reader shows (a closed phase, a folded run)
    let at: string | undefined = id;
    let node: HTMLElement | null = null;
    while (at && !(node = document.getElementById(`node-${at}`))) at = scope?.parent.get(at);
    const row = node?.querySelector<HTMLElement>(":scope > .row") ?? node;
    if (!row) return;
    // a little above the line, so the reader counts it as the part being read
    el.scrollTop += row.getBoundingClientRect().top - el.getBoundingClientRect().top - el.clientHeight / 3 + 8;
  };
  const onGraphView = useCallback((id: string) => syncReaderToMap.current(id), []);

  // what Claude is doing, as Claude Code's hooks tell it: working through a turn, or waiting for you.
  // An interrupt (Esc) ends the turn without a Stop hook; the transcript records it, so that counts too.
  // No hooks, no claim.
  const interruptedAt = useMemo(() => {
    let last: Event | undefined;
    for (const e of events?.values() ?? []) last = e;
    return last?.kind === "user.prompt" && last.text?.startsWith("[Request interrupted") ? last.ts : undefined;
  }, [events]);
  const told = sessionId ? activity[sessionId] : undefined;
  // a claim needs news: an event or a hook within the last 10 minutes; a hook that never came (a lost Stop)
  // must not keep "working" up through an hour of silence
  const [now, setNow] = useState(() => Date.now());
  const claimed = !!told && told.activity !== "idle";
  useEffect(() => {
    if (!claimed) return;
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [claimed]);
  const news = Math.max(told ? Date.parse(told.ts) : 0, structure ? Date.parse(structure.span.ts_last) : 0);
  const claude = live === "live" && told && told.activity !== "idle" && !(interruptedAt && interruptedAt > told.ts) && Math.max(now, Date.now()) - news < 10 * 60_000 ? told.activity : undefined;
  const working = view.follow && claude && structure ? { state: claude, lastEvent: structure.span.ts_last } : undefined;
  const onGraphMove = useCallback((down: boolean, atTail: boolean) => (down ? atTail && scrollTail() : scrollLock()), [scrollLock, scrollTail]);

  /* ---------- project scope (no session in focus) ---------- */

  useEffect(() => {
    if (sessionId || !(view.q.trim() || view.k.length)) return setProjectHits([]);
    const t = setTimeout(() => {
      api
        .search(view.q, { k: view.k.join(","), limit: 500 })
        .then((r) => (setProjectHits(r.hits), setProjectTools(r.tools ?? [])))
        .catch(() => setProjectHits([]));
    }, 150);
    return () => clearTimeout(t);
  }, [sessionId, view.q, view.k]);
  useEffect(() => {
    if (sessionId) return;
    api
      .search("", { k: "t", limit: 1 })
      .then((r) => setProjectTools(r.tools ?? []))
      .catch(() => undefined);
  }, [sessionId, view.project]);

  /* ---------- actions ---------- */

  const rootId = structure ? structure.id : undefined;
  // session nodes are written to the URL with the short id, like the path
  const select = useCallback(
    (id: string | undefined) => act({ sel: id?.startsWith("s:") ? `s:${shortId(id.slice(2), ids)}` : id }, { push: false }),
    [act, ids],
  );
  const sel = view.sel?.startsWith("s:") ? sessionNode(resolveId(view.sel.slice(2), ids) ?? view.sel.slice(2)) : view.sel;

  const focusOn = useCallback(
    (id: string) => {
      setCard(undefined);
      if (id.startsWith("s:")) {
        const sid = id.slice(2);
        if (sid === sessionId) return act({ focus: undefined, window: undefined });
        return act({ session: shortId(sid, ids), pinned: false, focus: undefined, window: undefined, sel: undefined });
      }
      act({ focus: id === rootId ? undefined : id, window: undefined, sel: undefined });
    },
    [act, sessionId, ids, rootId],
  );

  // a folded "⋯ N filtered" box in the graph shows the filtered parts and selects the first of its run
  const graphFocus = useCallback(
    (id: string) => {
      const fold = id.indexOf(".fold");
      if (fold < 0) return focusOn(id);
      setFoldRest(false);
      act({ sel: id.slice(0, fold) }, { push: false });
    },
    [focusOn, act],
  );

  const leaveSession = useCallback(() => {
    act({ session: undefined, pinned: true, focus: undefined, window: undefined, sel: sessionId ? `s:${shortId(sessionId, ids)}` : undefined });
  }, [act, sessionId, ids]);

  const up = useCallback(() => {
    if (view.window) return act({ window: undefined });
    if (scope && view.focus) {
      const parent = scope.parent.get(scope.focus.id);
      return act({ focus: !parent || parent === rootId ? undefined : parent, sel: scope.focus.id });
    }
    if (sessionId && !view.pinned) leaveSession();
  }, [view.window, view.focus, view.pinned, scope, rootId, sessionId, act, leaveSession]);

  const reset = useCallback(() => {
    if (sessionId && !view.pinned && !view.focus && !view.window) return leaveSession();
    act({ focus: undefined, window: undefined });
  }, [sessionId, view.pinned, view.focus, view.window, act, leaveSession]);

  const setAttention = async (a: Attention) => {
    setConfig((c) => (c ? { ...c, attention: a } : c));
    try {
      setConfig(await api.setAttention(a));
    } catch (e) {
      setError(String(e));
    }
  };

  const toggleAutoCommit = async (enabled: boolean) => {
    try {
      setAutoCommit(await api.setAutoCommit(enabled));
    } catch (e) {
      setError(String(e));
    }
  };

  const catchMeUp = async () => {
    if (!sessionId) return;
    setDigest("");
    try {
      const d = await api.digest(sessionId, storage<string | undefined>(`yt.seen.${sessionId}`, undefined));
      setDigest(d.text || "Nothing new since you last looked.");
    } catch (e) {
      setDigest(`The digest is unavailable: ${String(e)}`);
    }
  };

  /* ---------- per-mode view models ---------- */

  const sessions = useMemo(() => index?.sessions ?? [], [index]);
  // derived once per change of its inputs, so the memoized views below get the same props back
  const vm = useMemo(() => {
    let bars: Bar[] = [];
    let ticks: Tick[] = [];
    let tlStart = 0;
    let tlEnd = 0;
    let flow: FlowGraph = { root: "", nodes: [], edges: [] };
    let dim = new Set<string>();
    let hits = new Map<string, number>();
    let matchCount = 0;
    let tools: string[] = projectTools;
    let scopeLabel = "the project";
    let projectWindow: [number, number] | undefined;

    if (scope && events) {
      tlStart = Date.parse(scope.focus.span.ts_first);
      tlEnd = Math.max(Date.parse(scope.focus.span.ts_last), tlStart + 1000);
      // steps are near-instant records; a step's bar runs until the next step starts (time spent on it).
      // turns keep their own span so the user's idle time between turns stays visible as a gap
      const steps = scope.focus.level >= 2;
      bars = scope.units.map((u, i) => {
        const next = scope.units[i + 1];
        const end = steps ? Math.max(u.end, next ? next.start : Math.max(u.end, tlEnd)) : u.end;
        return { id: u.node.id, label: u.node.label, start: u.start, end, node: u.node, group: scope.parent.get(u.node.id) };
      });
      ticks = [...scope.matches].flatMap((id) => {
        const e = events.get(id);
        return e ? [{ id, ts: Date.parse(e.ts), kind: e.kind }] : [];
      });
      // "Hide filtered" folds the graph too: runs without matches become one dashed box each
      flow = focusFlow(foldRest && scope.active && scope.matches.size > 0 ? foldTree(scope.graphRoot, scope.dim) : scope.graphRoot);
      dim = scope.dim;
      hits = scope.hits;
      matchCount = scope.matches.size;
      tools = searchIndex?.tools() ?? [];
      scopeLabel = scope.focus.kind === "session" ? "this session" : `this ${scope.focus.kind}`;
    } else if (!sessionId && sessions.length) {
      const ordered = [...sessions].sort((a, b) => a.ts_first.localeCompare(b.ts_first));
      tlStart = Date.parse(ordered[0]!.ts_first);
      tlEnd = Math.max(...ordered.map((s) => Date.parse(s.ts_last)), tlStart + 1000);
      bars = ordered.map((s) => ({ id: sessionNode(s.id), label: s.label || s.id, start: Date.parse(s.ts_first), end: Date.parse(s.ts_last) }));
      projectWindow = view.window;
      const inWindow = (t: number) => !projectWindow || (t >= tlStart + projectWindow[0] * 1000 && t <= tlStart + projectWindow[1] * 1000);
      const visibleHits = projectHits.filter((h) => inWindow(Date.parse(h.ts)));
      ticks = visibleHits.map((h) => ({ id: h.id, ts: Date.parse(h.ts), kind: h.kind }));
      for (const h of visibleHits) hits.set(sessionNode(h.session), (hits.get(sessionNode(h.session)) ?? 0) + 1);
      const active = Boolean(dq.trim()) || dk.length > 0;
      for (const b of bars) if ((active && visibleHits.length > 0 && !hits.has(b.id)) || (projectWindow && (b.end < tlStart + projectWindow[0] * 1000 || b.start > tlStart + projectWindow[1] * 1000))) dim.add(b.id);
      flow = projectFlow(ordered.map((s) => ({ id: s.id, label: s.label })));
      matchCount = visibleHits.length;
    }
    // the boxes the map shows, in its order (↑ ↓ in the Map view)
    const graphIds = [...new Set(flow.nodes.map((n) => n.ref))]; // a subagent's frame and its first box are one part
    return { bars, ticks, tlStart, tlEnd, flow, graphIds, dim, hits, matchCount, tools, scopeLabel, projectWindow };
  }, [scope, events, tree, searchIndex, sessionId, sessions, projectHits, projectTools, view.window, dq, dk, foldRest]);
  const { bars, ticks, tlStart, tlEnd, flow, graphIds, dim, hits, matchCount, tools, scopeLabel, projectWindow } = vm;

  // how busy the agent was across the tape: events per time bucket
  const wave = useMemo(() => {
    const out = new Array<number>(WAVE_BUCKETS).fill(0);
    if (!scope || !events || tlEnd <= tlStart) return out;
    const span = tlEnd - tlStart;
    for (const n of walk(scope.focus))
      for (const id of n.event_ids ?? []) {
        const e = events.get(id);
        if (!e) continue;
        const i = Math.floor(((Date.parse(e.ts) - tlStart) / span) * WAVE_BUCKETS);
        if (i >= 0 && i < WAVE_BUCKETS) out[i]!++;
        else if (i === WAVE_BUCKETS) out[WAVE_BUCKETS - 1]!++;
      }
    return out;
  }, [scope, events, tlStart, tlEnd]);

  const selectedNode = sel && tree ? tree.byId.get(sel) : undefined;
  const playhead = view.follow ? tlEnd : selectedNode ? Date.parse(selectedNode.span.ts_first) : sel?.startsWith("s:") ? Date.parse(sessions.find((s) => sessionNode(s.id) === sel)?.ts_first ?? "") : undefined;

  const resultIds = useMemo(() => (scope && events ? [...events.keys()].filter((id) => scope.matches.has(id)) : []), [scope, events]);
  // stepping through the matches one by one, like a browser's find bar; a new search starts over
  const [matchAt, setMatchAt] = useState<number | undefined>();
  useEffect(() => setMatchAt(undefined), [dq, dk, view.focus, view.window]);
  const stepMatch = (dir: 1 | -1) => {
    const n = resultIds.length;
    if (!n || !scope) return;
    goToMatch(matchAt === undefined || matchAt >= n ? (dir > 0 ? 0 : n - 1) : (matchAt + dir + n) % n);
  };
  const goToMatch = (i: number) => {
    const ev = resultIds[i];
    const part = ev && scope?.owner.get(ev);
    if (!part) return;
    setMatchAt(i);
    select(part);
    zoomApi.current?.reveal(part, ev);
  };

  /* ---------- keyboard (the keymap lives in keys.ts) ---------- */

  // what ↑ ↓ walk through: the view you are looking at, top to bottom
  const order = (): string[] => {
    if (!sessionId) return [...sessions].reverse().map((s) => sessionNode(s.id));
    if (reader === "results" && layout !== "map" && scope) return matchOrder(resultIds, scope.owner);
    if (layout === "map") return graphIds.filter((id) => !id.includes(".fold"));
    // the focus itself heads the reader; ↓ starts inside it
    return [...document.querySelectorAll<HTMLElement>(".zoom .node:not(.root)")].map((el) => el.id.slice("node-".length));
  };
  // after Enter in the search box, or widening a search that found nothing: land on the first match
  const pendingFirst = useRef(false);
  const [submitted, setSubmitted] = useState(0);
  useEffect(() => {
    // wait until the views have caught up with the query, or a stale match would be picked
    if (!pendingFirst.current || dq !== view.q || !scope?.active || scope.matches.size === 0) return;
    pendingFirst.current = false;
    goToMatch(0);
  }, [scope, resultIds, select, submitted, dq, view.q]); // eslint-disable-line react-hooks/exhaustive-deps
  const widenLabel = !scope
    ? undefined
    : view.window
      ? `Search the whole ${scope.focus.kind}`
      : view.focus
        ? (() => {
            const p = scope.parent.get(scope.focus.id);
            const pn = p ? tree?.byId.get(p) : undefined;
            return pn ? `Search the ${pn.kind}` : undefined;
          })()
        : sessionId && !view.pinned
          ? "Search the project"
          : undefined;
  const widen = useCallback(() => {
    if (scope?.active && scope.matches.size === 0) pendingFirst.current = true;
    up();
  }, [scope, up]);
  const zoomApi = useRef<ZoomApi>(null);
  const [help, setHelp] = useState<{ open: boolean; tab: HelpTab }>({ open: false, tab: "guide" });
  const [touring, setTouring] = useState(false);
  const LAYOUTS: Layout[] = ["read", "split", "map"];
  const keys: KeyActions = {
    move: (dir) => {
      const next = stepIn(order(), sel, dir);
      if (next) select(next);
    },
    first: () => {
      const o = order();
      if (o[0]) select(o[0]);
    },
    zoomIn: () => sel && sel !== scope?.focus.id && focusOn(sel),
    widen,
    widenToTop: () => (view.focus || view.window ? act({ focus: undefined, window: undefined }) : sessionId && !view.pinned ? leaveSession() : undefined),
    togglePart: () => sel && zoomApi.current?.toggle(sel),
    newest: () => setView({ follow: true }, { push: false }),
    search: () => document.querySelector<HTMLInputElement>(".filterbar .query")?.focus(),
    nextMatch: (dir) => {
      if (sessionId && scope) return stepMatch(dir);
      const o = sessionId && scope ? matchOrder(resultIds, scope.owner) : projectHits.map((h) => sessionNode(h.session)).filter((id, i, a) => a.indexOf(id) === i);
      const next = stepIn(o, sel && o.includes(sel) ? sel : undefined, dir);
      if (next) select(next);
    },
    toggleKind: (i) => {
      const code = CHIPS[i]?.code;
      if (code) setView({ k: view.k.includes(code) ? view.k.filter((c) => c !== code) : [...view.k, code] });
    },
    toggleFold: () => setFoldRest((f) => !f),
    clearAll: () => setView({ q: "", k: [], window: undefined }),
    detail: (dir) => setView({ z: DETAIL_ORDER[Math.min(DETAIL_ORDER.length - 1, Math.max(0, DETAIL_ORDER.indexOf(view.z) + dir))]! }),
    partDetail: (dir) => (sel && zoomApi.current ? zoomApi.current.detail(sel, dir) : setView({ z: DETAIL_ORDER[Math.min(DETAIL_ORDER.length - 1, Math.max(0, DETAIL_ORDER.indexOf(view.z) + dir))]! })),
    cycleLayout: () => setView({ layout: LAYOUTS[(LAYOUTS.indexOf(view.layout) + 1) % LAYOUTS.length]! }, { push: false }),
    toggleFollow: () => setView((s) => ({ follow: !s.follow }), { push: false }),
    togglePin: () => sessionId && setView({ pinned: !view.pinned }),
    catchMeUp: () => void catchMeUp(),
    shortcuts: () => setHelp({ open: true, tab: "keys" }),
  };
  useKeyboard(keys);
  const path = scope ? scope.path.slice(1).map((n) => ({ id: n.id, label: n.label })) : [];
  const timelineWindow = scope ? scope.window : projectWindow;
  const layout: Layout = narrow && view.layout === "split" ? "read" : view.layout;
  // Ctrl + wheel over the reader zooms like → and ←: up into the part under the pointer (or the selection), down widens
  useCtrlWheel(
    readerBody,
    (dir, target) => {
      if (dir < 0) return widen();
      const node = target?.closest(".zoom .node:not(.root)");
      const id = node?.id.slice("node-".length) ?? (sel && sel !== scope?.focus.id ? sel : undefined);
      if (id) focusOn(id);
    },
    [layout],
  );
  // scripted demos (Demo.tsx): each step is a whole view plus a few actions; this is what they reach
  const demo = useDemo({
    project: view.project,
    setView,
    keys,
    settle: () => {
      setHelp((h) => ({ ...h, open: false }));
      setTouring(false);
      setDigest(undefined);
      setReader("outline");
      setFoldRest(true);
      setHover(undefined);
      setCard(undefined);
      setMatchAt(undefined);
      zoomApi.current?.reset();
      readerBody.current?.scrollTo({ top: 0 });
    },
    hover: setHover,
    open: (id, open) => zoomApi.current?.open(id, open),
    tab: (t) => setReader(t === "results" ? "results" : "outline"),
    revealMap: (id) => graphApi.current?.reveal(id),
  });
  const hoverAt = useCallback((h: HoverInfo | undefined) => (setHover(h?.id), setCard(h)), []);
  const setDetail = useCallback((z: Granularity) => setView({ z }), [setView]);
  const setWindow = useCallback((w: [number, number] | undefined) => act({ window: w }), [act]);

  /* ---------- render ---------- */

  const readerPane = (
    <section className="pane left" data-tour="reader">
      <div className="pane-head">
        <div className="seg" role="tablist" aria-label="Reader">
          <button className={reader === "outline" ? "on" : ""} onClick={() => setReader("outline")} role="tab" aria-selected={reader === "outline"}>
            {sessionId ? "Story" : "Sessions"}
          </button>
          <button className={reader === "results" ? "on" : ""} onClick={() => setReader("results")} role="tab" aria-selected={reader === "results"}>
            Results <span className="num text-ink-3">{matchCount}</span>
          </button>
        </div>
        {sessionId && reader === "outline" && <LengthSwitch value={view.z} overrides={overrides} onChange={(z) => setView({ z })} />}
      </div>
      <div
        ref={readerBody}
        className={`pane-body ${layout === "read" ? "reading" : ""}`}
        onScroll={onReaderScroll}
        onWheel={(e) => (markUser(), e.deltaY < 0 && scrollLock())}
        onTouchMove={markUser}
        onPointerDown={markUser}
        onKeyDown={markUser}
      >
        {sessionId ? (
          !scope ? (
            <p className="empty">Loading the session…</p>
          ) : reader === "outline" ? (
            <Zoom session={sessionId} root={scope.focus} granularity={view.z} events={events} follow={view.follow} selected={sel} hover={hover} dim={dim} hits={hits} query={dq} active={scope.active} matches={scope.matches} collapseDim={foldRest && scope.active && scope.matches.size > 0} onSelect={select} onFocus={focusOn} onHover={setHover} onGranularity={setDetail} onOverrides={setOverrides} api={zoomApi} working={working} current={matchAt !== undefined ? resultIds[matchAt] : undefined} />
          ) : (
            <Results ids={resultIds} events={events} owner={scope.owner} selected={sel} query={view.q} onSelect={select} />
          )
        ) : reader === "outline" ? (
          <SessionList index={index} selected={sel} hover={hover} hits={hits} dim={dim} onOpen={focusOn} onHover={setHover} />
        ) : (
          <ProjectResults hits={projectHits} sessions={sessions} query={view.q} onOpen={(sid) => focusOn(sessionNode(sid))} />
        )}
      </div>
    </section>
  );

  // the graph's bar: a way up, and what the boxes are (the filter chips already serve as the legend)
  const upTarget = scope && view.focus ? scope.parent.get(scope.focus.id) : undefined;
  const upLabel = upTarget ? (upTarget === rootId ? sessionMeta?.label || "the session" : tree?.byId.get(upTarget)?.label) : sessionId && !view.pinned ? view.project : undefined;
  const graphHead = (
    <>
      {upLabel && (
        <button className="graph-up" onClick={up} title="Zoom out one level (Esc)">
          <ArrowUp size={14} aria-hidden />
          <span>{upLabel}</span>
        </button>
      )}
      <span className="graph-what">{graphContents(scope?.graphRoot, sessions.length)}</span>
    </>
  );
  const graphPane = (
    <section className="pane right" data-tour="map">
      <Graph flow={flow} selected={sel} follow={view.follow} hover={hover} dim={dim} hits={hits} onFocus={graphFocus} onHover={hoverAt} onUserMove={onGraphMove} onView={onGraphView} api={graphApi} working={working?.state === "working"} head={graphHead} />
    </section>
  );

  return (
    <div className="app">
      <Header
        project={view.project}
        session={sessionId ? { id: sessionId, label: sessionMeta?.label || sessionId.slice(0, 8), pinned: view.pinned } : undefined}
        path={path}
        canReset={Boolean(view.focus || view.window || (sessionId && !view.pinned))}
        onProject={leaveSession}
        onSessionRoot={() => act({ focus: undefined, window: undefined })}
        onCrumb={(id) => act({ focus: id, window: undefined })}
        follow={view.follow}
        onFollow={(follow) => setView({ follow }, { push: false })}
        layout={view.layout}
        onLayout={(l) => setView({ layout: l }, { push: false })}
        onPin={(pinned) => setView({ pinned })}
        onReset={reset}
        live={live}
        config={config}
        structure={structure}
        onAttention={setAttention}
        autoCommit={autoCommit}
        onAutoCommit={toggleAutoCommit}
        onCatchMeUp={catchMeUp}
        onHelp={() => setHelp({ open: true, tab: "guide" })}
      />
      {error && (
        <div className="banner error" role="alert">
          <TriangleAlert size={15} aria-hidden />
          Lost contact with the engine: {error}. Run /yolo-twice:yolo-twice to start it again.
        </div>
      )}
      <FilterBar q={view.q} k={view.k} tools={tools} matches={matchCount} scopeLabel={scopeLabel} onQuery={(q) => setView({ q })} onCodes={(k: FilterCode[]) => setView({ k })} folded={foldRest} onFolded={setFoldRest} position={sessionId && matchAt !== undefined ? matchAt + 1 : undefined} onStep={sessionId && resultIds.length ? stepMatch : undefined} onSubmit={() => ((pendingFirst.current = true), setSubmitted((n) => n + 1))} widen={widenLabel ? { label: widenLabel, run: widen } : undefined} />
      {bars.length > 0 && (
        <Timeline
          bars={bars}
          ticks={ticks}
          wave={wave}
          start={tlStart}
          end={tlEnd}
          window={timelineWindow}
          playhead={Number.isFinite(playhead) ? playhead : undefined}
          selected={sel}
          hover={hover}
          dim={dim}
          hits={hits}
          onFocus={focusOn}
          onWiden={widen}
          onWindow={setWindow}
          onHover={hoverAt}
        />
      )}
      <div className="panes">
        {layout === "split" ? (
          <ResizablePanelGroup orientation="horizontal" defaultLayout={panes.defaultLayout} onLayoutChanged={panes.onLayoutChanged}>
            <ResizablePanel id="reader" defaultSize="56" minSize="28">
              {readerPane}
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel id="map" defaultSize="44" minSize="24">
              {graphPane}
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : layout === "read" ? (
          <div className="flex-1 min-w-0">{readerPane}</div>
        ) : (
          <div className="flex-1 min-w-0">{graphPane}</div>
        )}
        {sessionId && !view.follow && (locked || unseen > 0) && (
          <button className="unseen jump" onClick={() => setView({ follow: true }, { push: false })} title="Jump to the newest events and keep following (End)">
            <ArrowDown size={15} aria-hidden />
            {unseen > 0 ? `${unseen} new` : "Latest"}
          </button>
        )}
      </div>
      <Help open={help.open} tab={help.tab} onTab={(tab) => setHelp({ open: true, tab })} onOpenChange={(open) => setHelp((h) => ({ ...h, open }))} onTour={() => (setHelp((h) => ({ ...h, open: false })), setTouring(true))} />
      {touring && (
        <Suspense>
          <Tour run onEnd={() => setTouring(false)} />
        </Suspense>
      )}
      {!touring && !demo.active && !demo.framed && <TourInvite onStart={() => setTouring(true)} />}
      <DemoBar demo={demo} />
      <DemoPointer at={demo.point} />
      {card && <HoverCard info={card} tree={tree} sessions={sessions} hits={hits} />}
      <Sheet open={digest !== undefined} onOpenChange={(o) => !o && setDigest(undefined)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <BookOpenText className="size-4" />
              Catch me up
            </SheetTitle>
            <SheetDescription>What happened in {sessionMeta?.label || "this session"} since you last looked.</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6">{digest ? <p className="digest">{richText(digest)}</p> : <p className="digest text-ink-3">Reading the new events…</p>}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** What the boxes of the graph are, in words: "23 turns in 3 phases", "42 steps". */
function graphContents(root: StructureNode | undefined, sessions: number): string {
  const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  if (!root) return n(sessions, "session");
  if (root.kind === "session") {
    const turns = root.children.reduce((t, p) => t + p.children.length, 0);
    return `${n(turns, "turn")} in ${n(root.children.length, "phase")}`;
  }
  if (root.kind === "phase") return n(root.children.length, "turn");
  const agents = root.children.filter((c) => c.meta?.step_kind === "subagent").length;
  return n(root.children.length, "step") + (agents ? `, ${n(agents, "subagent")}` : "");
}

/** Detail for every open part. A part can differ with its own −/+; choosing here resets those. */
function LengthSwitch({ value, overrides, onChange }: { value: Granularity; overrides: Record<string, Granularity>; onChange: (g: Granularity) => void }) {
  const parts = new Map<Granularity, number>();
  for (const g of Object.values(overrides)) parts.set(g, (parts.get(g) ?? 0) + 1);
  return (
    <div className="flex items-center gap-2" data-tour="detail">
      <span className="text-[13px] text-ink-2 hide-narrow">Detail</span>
      <div className="seg" role="radiogroup" aria-label="Detail">
        {DETAIL.map((l) => (
          <button
            key={l.g}
            className={`${l.g === value ? "on" : ""} ${parts.has(l.g) ? "has-parts" : ""}`}
            onClick={() => onChange(l.g)}
            title={parts.has(l.g) ? `${l.hint}. ${parts.get(l.g)} part${parts.get(l.g) === 1 ? " is" : "s are"} set to ${l.label.toLowerCase()} on its own; choosing a level resets them.` : l.hint}
            role="radio"
            aria-checked={l.g === value}
          >
            {l.label}
            {parts.has(l.g) && <span className="parts-count">{parts.get(l.g)}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

/** What a block or node is, under the pointer: label, kind, when, how much, and the abstract when there is one. */
function HoverCard({ info, tree, sessions, hits }: { info: HoverInfo; tree?: ReturnType<typeof indexTree>; sessions: ProjectIndex["sessions"]; hits: Map<string, number> }) {
  const node = tree?.byId.get(info.id);
  const session = info.id.startsWith("s:") ? sessions.find((s) => `s:${s.id}` === info.id) : undefined;
  if (!node && !session) return null;
  const kind: Kind = node ? nodeKind(node) : "session";
  const start = node ? node.span.ts_first : session!.ts_first;
  const end = node ? node.span.ts_last : session!.ts_last;
  const n = hits.get(info.id);
  const left = Math.min(info.x + 14, innerWidth - 360);
  const top = info.y + 16 + 160 > innerHeight ? info.y - 150 : info.y + 16;
  const abstract = node?.text?.abstract;
  return (
    <div className="hovercard" style={{ left, top, ...kindStyle(kind) }}>
      <strong className="flex items-start gap-2">
        <span className="mt-0.5" style={{ color: KIND[kind].color }}>
          <KindIcon kind={kind} />
        </span>
        <span>{node ? node.label : session!.label || session!.id}</span>
      </strong>
      {abstract && <p className="mb-2 font-serif text-[14.5px] leading-snug text-ink-2 line-clamp-4">{abstract}</p>}
      <div className="facts">
        <span>
          <Clock size={12} aria-hidden />
          {fmtTime(start)}, {fmtDuration(Date.parse(end) - Date.parse(start))}
        </span>
        {node && node.stats.tool_calls > 0 && (
          <span>
            <Wrench size={12} aria-hidden />
            {node.stats.tool_calls} tool calls
          </span>
        )}
        {node && node.stats.input_tokens + node.stats.output_tokens > 0 && (
          <span>
            <Coins size={12} aria-hidden />
            {fmtTokens(node.stats.input_tokens + node.stats.output_tokens)} tokens
          </span>
        )}
        {session && <span>{session.events} events</span>}
        {n ? <span className="text-ink">{n} matches</span> : null}
      </div>
      <div className="hint">Click to zoom in</div>
    </div>
  );
}

/** Project root: sessions as rows, linked to the graph and timeline like any other node. */
function SessionList(props: {
  index?: Index;
  selected?: string;
  hover?: string;
  hits: Map<string, number>;
  dim: Set<string>;
  onOpen: (id: string) => void;
  onHover: (id: string | undefined) => void;
}) {
  const { index } = props;
  if (!index) return <p className="empty">Loading the project…</p>;
  if (index.sessions.length === 0)
    return (
      <div className="empty">
        <ListTree size={22} />
        No sessions recorded yet. Start a Claude Code session in this project, or run yolo-twice index.
      </div>
    );
  const day = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="project-view">
      {index.text?.abstract && <p className="project-digest">{richText(index.text.abstract)}</p>}
      <table className="sessions">
        <thead>
          <tr>
            <th>Session</th>
            <th>When</th>
            <th>Length</th>
            <th className="right">Events</th>
            <th className="right">Cost</th>
          </tr>
        </thead>
        <tbody>
          {[...index.sessions].reverse().map((s) => {
            const id = sessionNode(s.id);
            const n = props.hits.get(id);
            const current = index.current === s.id;
            const cls = [id === props.selected ? "selected" : "", id === props.hover ? "hover" : "", props.dim.has(id) ? "dim" : ""].join(" ");
            return (
              <tr key={s.id} className={cls} onClick={() => props.onOpen(id)} onMouseEnter={() => props.onHover(id)} onMouseLeave={() => props.onHover(undefined)} title="Open this session">
                <td className="title">
                  {current && <span className="live-dot live" title="Active now" />}
                  {s.label || s.id}
                  {n ? <span className="badge hit ml-2">{n}</span> : null}
                  <small>{s.id.slice(0, 8)}</small>
                </td>
                <td>
                  {day(s.ts_first)}
                  <small className="block text-ink-3">
                    {clock(s.ts_first)} to {clock(s.ts_last)}
                  </small>
                </td>
                <td>{fmtDuration(Date.parse(s.ts_last) - Date.parse(s.ts_first))}</td>
                <td className="right">{s.events}</td>
                <td className="right">{s.cost_usd !== undefined ? `$${s.cost_usd.toFixed(2)}` : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Project-wide matches from the engine; opening one focuses its session with the same filters. */
function ProjectResults(props: { hits: SearchHit[]; sessions: ProjectIndex["sessions"]; query: string; onOpen: (session: string) => void }) {
  if (props.hits.length === 0)
    return (
      <div className="empty">
        <ListTree size={22} />
        No matches yet. Search above, or pick a filter to list things across all sessions.
      </div>
    );
  const label = new Map(props.sessions.map((s) => [s.id, s.label || s.id]));
  return (
    <ul className="results">
      {props.hits.map((h) => (
        <li key={`${h.session}:${h.id}`} onClick={() => props.onOpen(h.session)}>
          <span className="kicon">
            <KindIcon kind={h.kind === "user.prompt" ? "you" : h.kind.startsWith("tool") ? "tool" : "text"} />
          </span>
          <span className="what">
            {label.get(h.session)}
            {h.tool && <span className="tool-name">{h.tool}</span>}
          </span>
          <span className="time">{new Date(h.ts).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
          <div className="snippet">{richText(h.snippet, props.query)}</div>
        </li>
      ))}
    </ul>
  );
}
