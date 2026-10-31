import { useCallback, useEffect, useMemo, useState } from "react";
import { focusMermaid, projectToMermaid } from "@yolo-twice/analyzers/graph";
import { SearchIndex, type FilterCode } from "@yolo-twice/analyzers/search";
import { api, setProject, storage, store, type Attention, type AutoCommit, type Config, type Event, type Granularity, type ProjectIndex, type SearchHit, type StructureNode } from "./api";
import { Header } from "./Header";
import { FilterBar } from "./FilterBar";
import { Timeline, type Bar, type Tick } from "./Timeline";
import { Graph } from "./Graph";
import { Results, Zoom } from "./Zoom";
import { useStream } from "./useStream";
import { resolveId, shortId, useViewState, type SetView, type ViewState } from "./state";
import { computeScope, followTarget, indexTree, walk } from "./scope";

type Index = ProjectIndex & { current?: string };
const GRANS: Granularity[] = ["title", "abstract", "summary", "full"];
const sessionNode = (id: string) => `s:${id}`;

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
  const [reader, setReader] = useState<"outline" | "results">("outline");
  const [projectHits, setProjectHits] = useState<SearchHit[]>([]);
  const [projectTools, setProjectTools] = useState<string[]>([]);

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
  const scope = useMemo(
    () => (structure && tree ? computeScope(structure, searchIndex, { focus: view.focus, window: view.window, q: view.q, k: view.k }, tree) : undefined),
    [structure, tree, searchIndex, view.focus, view.window, view.q, view.k],
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
      if (id.startsWith("s:")) {
        const sid = id.slice(2);
        if (sid === sessionId) return act({ focus: undefined, window: undefined });
        return act({ session: shortId(sid, ids), pinned: false, focus: undefined, window: undefined, sel: undefined });
      }
      act({ focus: id === rootId ? undefined : id, window: undefined, sel: undefined });
    },
    [act, sessionId, ids, rootId],
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

  // keyboard: Esc goes up one level, Enter focuses the selection
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/input|textarea|select/i.test((e.target as HTMLElement).tagName)) return;
      if (e.key === "Escape") up();
      if (e.key === "Enter" && sel) focusOn(sel);
      if (e.key === "f" && !e.ctrlKey && !e.metaKey && !e.altKey) setView((s) => ({ follow: !s.follow }), { push: false });
      if (e.key === "End") setView({ follow: true }, { push: false });
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [up, focusOn, sel, setView]);

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
    setDigest("…");
    try {
      const d = await api.digest(sessionId, storage<string | undefined>(`yt.seen.${sessionId}`, undefined));
      setDigest(d.text || "Nothing new since you last looked.");
    } catch (e) {
      setDigest(`Digest unavailable: ${String(e)}`);
    }
  };

  /* ---------- per-mode view models ---------- */

  const sessions = index?.sessions ?? [];
  let bars: Bar[] = [];
  let ticks: Tick[] = [];
  let tlStart = 0;
  let tlEnd = 0;
  let mermaid = "";
  let graphIds: string[] = [];
  let dim = new Set<string>();
  let hits = new Map<string, number>();
  let matchCount = 0;
  let tools: string[] = projectTools;
  let scopeLabel = "project";
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
    mermaid = focusMermaid(scope.graphRoot);
    graphIds = [...walk(scope.graphRoot)].map((n) => n.id);
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
    const active = Boolean(view.q.trim()) || view.k.length > 0;
    for (const b of bars) if ((active && !hits.has(b.id)) || (projectWindow && (b.end < tlStart + projectWindow[0] * 1000 || b.start > tlStart + projectWindow[1] * 1000))) dim.add(b.id);
    mermaid = projectToMermaid(ordered.map((s) => ({ id: s.id, label: s.label })));
    graphIds = bars.map((b) => b.id);
    matchCount = visibleHits.length;
  }

  const resultIds = useMemo(() => (scope && events ? [...events.keys()].filter((id) => scope.matches.has(id)) : []), [scope, events]);
  const path = scope ? scope.path.slice(1).map((n) => ({ id: n.id, label: n.label })) : [];
  const timelineWindow = scope ? scope.window : projectWindow;

  /* ---------- render ---------- */

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
        unseen={unseen}
        onFollow={(follow) => setView({ follow }, { push: false })}
        onPin={(pinned) => setView({ pinned })}
        onReset={reset}
        live={live}
        config={config}
        structure={structure}
        onAttention={setAttention}
        autoCommit={autoCommit}
        onAutoCommit={toggleAutoCommit}
        onCatchMeUp={catchMeUp}
      />
      {error && <div className="banner error">{error}</div>}
      {digest !== undefined && (
        <div className="drawer">
          <div className="drawer-head">
            <strong>Catch me up</strong>
            <button onClick={() => setDigest(undefined)}>close</button>
          </div>
          <p>{digest}</p>
        </div>
      )}
      <FilterBar q={view.q} k={view.k} tools={tools} matches={matchCount} scopeLabel={scopeLabel} onQuery={(q) => setView({ q })} onCodes={(k: FilterCode[]) => setView({ k })} />
      {bars.length > 0 && (
        <Timeline
          bars={bars}
          ticks={ticks}
          start={tlStart}
          end={tlEnd}
          window={timelineWindow}
          selected={sel}
          hover={hover}
          dim={dim}
          hits={hits}
          onSelect={select}
          onFocus={focusOn}
          onWindow={(w) => act({ window: w })}
          onHover={setHover}
        />
      )}
      <div className="panes">
        <section className="pane left" onWheel={(e) => e.deltaY < 0 && view.follow && setView({ follow: false }, { push: false })}>
          <div className="pane-head">
            <div className="seg">
              <button className={reader === "outline" ? "on" : ""} onClick={() => setReader("outline")}>
                outline
              </button>
              <button className={reader === "results" ? "on" : ""} onClick={() => setReader("results")}>
                results ({matchCount})
              </button>
            </div>
            {sessionId && reader === "outline" && (
              <div className="seg" title="default text length">
                {GRANS.map((g) => (
                  <button key={g} className={g === view.z ? "on" : ""} onClick={() => setView({ z: g })}>
                    {g}
                  </button>
                ))}
              </div>
            )}
          </div>
          {sessionId ? (
            !scope ? (
              <p className="muted pad">Loading structure…</p>
            ) : reader === "outline" ? (
              <Zoom session={sessionId} root={scope.focus} granularity={view.z} events={events} follow={view.follow} selected={sel} hover={hover} dim={dim} hits={hits} onSelect={select} onFocus={focusOn} onHover={setHover} />
            ) : (
              <Results ids={resultIds} events={events} owner={scope.owner} selected={sel} query={view.q} onSelect={select} />
            )
          ) : reader === "outline" ? (
            <SessionList index={index} selected={sel} hover={hover} hits={hits} dim={dim} onSelect={select} onOpen={focusOn} onHover={setHover} />
          ) : (
            <ProjectResults hits={projectHits} sessions={sessions} onOpen={(sid) => focusOn(sessionNode(sid))} />
          )}
        </section>
        <section className="pane right">
          <div className="pane-head">
            <span>graph of {scope ? (scope.graphRoot.kind === "session" ? "the session" : `${scope.graphRoot.kind} ${scope.graphRoot.label.slice(0, 40)}`) : "the project"}</span>
            <span className="muted">click selects · double click zooms in · Esc zooms out</span>
          </div>
          <Graph mermaid={mermaid} ids={graphIds} selected={sel} follow={view.follow} hover={hover} dim={dim} hits={hits} onSelect={select} onFocus={focusOn} onHover={setHover} />
        </section>
      </div>
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
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onHover: (id: string | undefined) => void;
}) {
  const { index } = props;
  if (!index) return <p className="muted pad">Loading project…</p>;
  if (index.sessions.length === 0) return <p className="muted pad">No sessions indexed yet. Run a Claude Code session in this project, or `yolo-twice index`.</p>;
  return (
    <div className="pad">
      {index.text?.abstract && <p className="project-digest">{index.text.abstract}</p>}
      <table className="sessions">
        <thead>
          <tr>
            <th>Session</th>
            <th>Started</th>
            <th>Last activity</th>
            <th>Events</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {[...index.sessions].reverse().map((s) => {
            const id = sessionNode(s.id);
            const n = props.hits.get(id);
            const cls = [id === props.selected ? "selected" : "", id === props.hover ? "hover" : "", props.dim.has(id) ? "dim" : ""].join(" ");
            return (
              <tr key={s.id} className={cls} onClick={() => props.onSelect(id)} onDoubleClick={() => props.onOpen(id)} onMouseEnter={() => props.onHover(id)} onMouseLeave={() => props.onHover(undefined)} title="click selects · double click opens">
                <td>
                  {s.label || s.id} {n ? <span className="badge hit">{n}</span> : null}
                </td>
                <td>{new Date(s.ts_first).toLocaleString()}</td>
                <td>{new Date(s.ts_last).toLocaleString()}</td>
                <td>{s.events}</td>
                <td>{s.cost_usd !== undefined ? `$${s.cost_usd.toFixed(2)}` : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Project-wide matches from the engine; opening one focuses its session with the same filters. */
function ProjectResults(props: { hits: SearchHit[]; sessions: ProjectIndex["sessions"]; onOpen: (session: string) => void }) {
  if (props.hits.length === 0) return <p className="muted pad">No matches. Type a query or pick a filter.</p>;
  const label = new Map(props.sessions.map((s) => [s.id, s.label || s.id]));
  return (
    <ul className="results">
      {props.hits.map((h) => (
        <li key={`${h.session}:${h.id}`} onClick={() => props.onOpen(h.session)}>
          <span className="kind">{h.kind}</span> {h.tool && <span className="tool">{h.tool}</span>} <span className="muted">{label.get(h.session)}</span>
          <span className="time">{new Date(h.ts).toLocaleString()}</span>
          <div className="snippet">{h.snippet}</div>
        </li>
      ))}
    </ul>
  );
}
