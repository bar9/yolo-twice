import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, findNode, store, storage, type Attention, type Config, type Event, type Granularity, type ProjectIndex, type StructureNode } from "./api";
import { Header } from "./Header";
import { Zoom } from "./Zoom";
import { Graph } from "./Graph";
import { Timeline } from "./Timeline";
import { Search } from "./Search";
import { useStream } from "./useStream";

type Tab = "graph" | "timeline" | "search";

export function App() {
  const url = new URLSearchParams(location.search);
  const [index, setIndex] = useState<(ProjectIndex & { current?: string }) | undefined>();
  const [session, setSession] = useState<string | undefined>(url.get("session") ?? undefined);
  const [structure, setStructure] = useState<StructureNode | undefined>();
  const [graph, setGraph] = useState<string>("");
  const [graphLevel, setGraphLevel] = useState<1 | 2 | 3>(2);
  const [events, setEvents] = useState<Map<string, Event> | undefined>();
  const [config, setConfig] = useState<Config | undefined>();
  const [granularity, setGranularity] = useState<Granularity>("abstract");
  const [selected, setSelected] = useState<string | undefined>();
  const [tab, setTab] = useState<Tab>("graph");
  const [digest, setDigest] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const loadIndex = useCallback(async () => {
    try {
      const idx = await api.sessions();
      setIndex(idx);
      setSession((s) => s ?? idx.current ?? undefined);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const loadSession = useCallback(async (id: string, level: 1 | 2 | 3) => {
    try {
      const [s, g] = await Promise.all([api.structure(id), api.graph(id, level)]);
      if (sessionRef.current !== id) return;
      setStructure(s);
      setGraph(g);
      setError(undefined);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void loadIndex();
    api.config().then(setConfig).catch(() => undefined);
  }, [loadIndex]);

  useEffect(() => {
    setStructure(undefined);
    setEvents(undefined);
    setSelected(undefined);
    setDigest(undefined);
    if (!session) return;
    void loadSession(session, graphLevel);
    api.events(session).then((evs) => setEvents(new Map(evs.map((e) => [e.id, e])))).catch(() => undefined);
    const p = new URLSearchParams(location.search);
    p.set("session", session);
    history.replaceState(null, "", `?${p}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  useEffect(() => {
    if (session) api.graph(session, graphLevel).then(setGraph).catch(() => undefined);
  }, [graphLevel, session]);

  // remember the last event seen per session for "catch me up"
  useEffect(() => {
    if (session && structure?.span.last) store(`yt.seen.${session}`, structure.span.last);
  }, [session, structure]);

  const live = useStream((ev) => {
    const cur = sessionRef.current;
    switch (ev.type) {
      case "structure":
      case "semantic":
        if (ev.data.session === cur) void loadSession(cur, graphLevel);
        void loadIndex();
        break;
      case "ingest":
        if (ev.data.session === cur) api.events(cur).then((evs) => setEvents(new Map(evs.map((e) => [e.id, e])))).catch(() => undefined);
        break;
      case "config":
        api.config().then(setConfig).catch(() => undefined);
        break;
    }
  });

  const setAttention = async (a: Attention) => {
    setConfig((c) => (c ? { ...c, attention: a } : c));
    try {
      setConfig(await api.setAttention(a));
    } catch (e) {
      setError(String(e));
    }
  };

  const catchMeUp = async () => {
    if (!session) return;
    const since = storage<string | undefined>(`yt.seen.${session}`, undefined);
    setDigest("…");
    try {
      const d = await api.digest(session, since);
      setDigest(d.text || "Nothing new since you last looked.");
    } catch (e) {
      setDigest(`Digest unavailable: ${String(e)}`);
    }
  };

  const select = useCallback((id: string) => {
    setSelected(id);
    requestAnimationFrame(() => document.getElementById(`node-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  }, []);

  const selectEvent = useCallback(
    (eventId: string) => {
      if (!structure) return;
      for (const n of walkAll(structure)) if (n.event_ids?.includes(eventId)) return select(n.id);
    },
    [structure, select],
  );

  const projectName = useMemo(() => index?.project ?? "", [index]);

  return (
    <div className="app">
      <Header
        project={projectName}
        sessions={index?.sessions ?? []}
        session={session}
        onSession={(id) => setSession(id || undefined)}
        live={live}
        config={config}
        structure={structure}
        onAttention={setAttention}
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
      {!session ? (
        <SessionList index={index} onPick={setSession} />
      ) : (
        <div className="panes">
          <section className="pane left">
            <div className="pane-head">
              <span>Zoom</span>
              <div className="seg">
                {(["title", "abstract", "summary", "full"] as Granularity[]).map((g) => (
                  <button key={g} className={g === granularity ? "on" : ""} onClick={() => setGranularity(g)}>
                    {g}
                  </button>
                ))}
              </div>
            </div>
            {structure ? (
              <Zoom session={session} root={structure} granularity={granularity} events={events} selected={selected} onSelect={setSelected} />
            ) : (
              <p className="muted">Loading structure…</p>
            )}
          </section>
          <section className="pane right">
            <div className="pane-head">
              <div className="seg">
                {(["graph", "timeline", "search"] as Tab[]).map((t) => (
                  <button key={t} className={t === tab ? "on" : ""} onClick={() => setTab(t)}>
                    {t}
                  </button>
                ))}
              </div>
              {tab === "graph" && (
                <div className="seg">
                  {([1, 2, 3] as const).map((l) => (
                    <button key={l} className={l === graphLevel ? "on" : ""} onClick={() => setGraphLevel(l)} title={`L${l}: ${l === 1 ? "phases" : l === 2 ? "turns" : "steps"}`}>
                      L{l}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {tab === "graph" && <Graph mermaid={graph} root={structure} selected={selected} onSelect={select} />}
            {tab === "timeline" && structure && <Timeline root={structure} selected={selected} onSelect={select} />}
            {tab === "search" && <Search session={session} onPick={selectEvent} />}
          </section>
        </div>
      )}
    </div>
  );
}

function* walkAll(n: StructureNode): Generator<StructureNode> {
  yield n;
  for (const c of n.children) yield* walkAll(c);
}

/** L-1: the project as a list of sessions. */
function SessionList({ index, onPick }: { index?: ProjectIndex & { current?: string }; onPick: (id: string) => void }) {
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
          {[...index.sessions].reverse().map((s) => (
            <tr key={s.id} onClick={() => onPick(s.id)} className={s.id === index.current ? "current" : ""}>
              <td>{s.label || s.id}</td>
              <td>{new Date(s.ts_first).toLocaleString()}</td>
              <td>{new Date(s.ts_last).toLocaleString()}</td>
              <td>{s.events}</td>
              <td>{s.cost_usd !== undefined ? `$${s.cost_usd.toFixed(2)}` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export { findNode };
