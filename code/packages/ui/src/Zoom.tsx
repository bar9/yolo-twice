import { useEffect, useState } from "react";
import { ancestors, api, fmtTime, fmtTokens, type Event, type Granularity, type StructureNode } from "./api";

const ORDER: Granularity[] = ["title", "abstract", "summary", "full"];

/**
 * Stretchtext tree. Every node shows its label; an expanded node shows text at the current
 * granularity (or its own override) and its children. Missing granularities are requested lazily.
 */
export function Zoom(props: {
  session: string;
  root: StructureNode;
  granularity: Granularity;
  events?: Map<string, Event>;
  /** Follow mode: the selected (newest) node is expanded too, not only its ancestors. */
  follow?: boolean;
  selected?: string;
  hover?: string;
  dim: Set<string>;
  hits: Map<string, number>;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
  onHover: (id: string | undefined) => void;
}) {
  // expansion state keyed by node id survives structure refetches
  const [open, setOpen] = useState<Record<string, boolean>>({ [props.root.id]: true });
  const [override, setOverride] = useState<Record<string, Granularity>>({});
  const [fetched, setFetched] = useState<Record<string, string>>({}); // `${node}.${gran}` -> text
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const request = async (node: StructureNode, g: Granularity) => {
    const key = `${node.id}.${g}`;
    if (fetched[key] || pending[key] || g === "full") return;
    setPending((p) => ({ ...p, [key]: true }));
    try {
      const a = await api.text(props.session, node.id, g);
      setFetched((f) => ({ ...f, [key]: a.text }));
    } catch {
      /* keep fallback */
    } finally {
      setPending((p) => ({ ...p, [key]: false }));
    }
  };

  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));

  // a selection made elsewhere (graph, timeline, search) opens the path to the node and scrolls to it
  useEffect(() => {
    if (!props.selected) return;
    const path = ancestors(props.root, props.selected);
    if (props.follow) path.push(props.selected);
    if (path.length) setOpen((o) => ({ ...o, ...Object.fromEntries(path.map((id) => [id, true])) }));
    // following: keep the tail at the bottom of the pane, like tail -f; otherwise center the selection
    const t = setTimeout(() => document.getElementById(`node-${props.selected}`)?.scrollIntoView({ block: props.follow ? "end" : "center", behavior: props.follow ? "auto" : "smooth" }), 50);
    return () => clearTimeout(t);
  }, [props.selected, props.root, props.follow]);

  const render = (node: StructureNode, depth: number, prevBoundary?: string) => {
    const isOpen = open[node.id] ?? depth < 1;
    const g = override[node.id] ?? props.granularity;
    const gi = ORDER.indexOf(g);
    const key = `${node.id}.${g}`;
    const text = g === "full" ? undefined : node.text?.[g] ?? fetched[key];
    if (isOpen && g !== "full" && text === undefined && !pending[key]) void request(node, g);
    const zoomOut = () => setOverride((o) => ({ ...o, [node.id]: ORDER[Math.max(0, gi - 1)]! }));
    const zoomIn = () => setOverride((o) => ({ ...o, [node.id]: ORDER[Math.min(ORDER.length - 1, gi + 1)]! }));
    const cls = ["node", `level-${node.level}`, node.kind, props.selected === node.id ? "selected" : "", props.hover === node.id ? "hover" : "", props.dim.has(node.id) ? "dim" : ""].join(" ");
    const hitCount = props.hits.get(node.id);

    return (
      <div key={node.id} id={`node-${node.id}`} className={cls} style={{ marginLeft: depth ? 14 : 0 }}>
        {node.meta?.boundary && node.meta.boundary !== prevBoundary && <div className="boundary">— {node.meta.boundary} —</div>}
        <div
          className="row"
          onClick={() => (props.onSelect(node.id), toggle(node.id))}
          onDoubleClick={(e) => (e.stopPropagation(), props.onFocus(node.id))}
          onMouseEnter={() => props.onHover(node.id)}
          onMouseLeave={() => props.onHover(undefined)}
          title="click selects and expands · double click focuses"
        >
          <span className="caret">{node.children.length || node.event_ids?.length ? (isOpen ? "▾" : "▸") : "·"}</span>
          <span className="label">{node.label}</span>
          {node.meta?.branch && <span className="badge branch" title={`rewind from ${node.meta.branch_from}`}>rewind</span>}
          {node.meta?.step_kind === "subagent" && <span className="badge agent">{node.meta.agent_type ?? "agent"}</span>}
          {node.meta?.step_kind === "tool-error" && <span className="badge error">error</span>}
          {hitCount ? <span className="badge hit">{hitCount}</span> : null}
          <span className="stats">
            {node.stats.events}ev · {node.stats.tool_calls}🔧 · {fmtTokens(node.stats.input_tokens + node.stats.output_tokens)}tok
            {node.stats.cost_usd !== undefined && ` · $${node.stats.cost_usd.toFixed(2)}`}
          </span>
          <span className="time">{fmtTime(node.span.ts_first)}</span>
        </div>
        {isOpen && (
          <div className="body">
            <div className="zoom-controls">
              <button disabled={gi === 0} onClick={zoomOut} title="zoom out: shorter text">−</button>
              <span className="gran">{g}</span>
              <button disabled={gi === ORDER.length - 1} onClick={zoomIn} title="zoom in: longer text">+</button>
              {pending[key] && <span className="spin" />}
            </div>
            {g === "full" ? (
              node.level >= 3 ? <Events node={node} events={props.events} /> : <p className="muted">Expand the children below to read the full text.</p>
            ) : (
              <p className={`text ${text === undefined ? "muted" : ""}`}>{text ?? structuralFallback(node, g)}</p>
            )}
            {node.children.map((c, i) => render(c, depth + 1, i === 0 ? undefined : node.children[i - 1]!.meta?.boundary))}
          </div>
        )}
      </div>
    );
  };

  return <div className="zoom">{render(props.root, 0)}</div>;
}

/** What to show before a summary exists: the label, deterministic, never blank. */
function structuralFallback(node: StructureNode, g: Granularity): string {
  if (g === "title") return node.label;
  const kids = node.children.map((c) => c.label).slice(0, g === "abstract" ? 3 : 12);
  return kids.length ? `${node.label}. ${kids.join(" · ")}` : node.label;
}

/** Raw events of a step (L3) in append order. */
function Events({ node, events }: { node: StructureNode; events?: Map<string, Event> }) {
  if (!events) return <p className="muted">Loading events…</p>;
  const ids = node.event_ids ?? [];
  return (
    <div className="events">
      {ids.map((id) => {
        const e = events.get(id);
        if (!e) return <div key={id} className="muted">{id} (not loaded)</div>;
        return (
          <div key={id} className={`event ${e.kind.replace(".", "-")}`}>
            <div className="event-head">
              <span className="kind">{e.kind}</span>
              {e.tool?.name && <span className="tool">{e.tool.name}</span>}
              {e.model && <span className="muted">{e.model}</span>}
              {e.redacted && <span className="badge redacted" title={e.redacted.rules.join(", ")}>redacted ×{e.redacted.count}</span>}
              <span className="time">{fmtTime(e.ts)}</span>
            </div>
            <pre>{e.text || (e.data?.hidden ? "(hidden)" : "")}</pre>
          </div>
        );
      })}
    </div>
  );
}

/** Matches as a flat list in event order; clicking one selects its step everywhere. */
export function Results(props: {
  ids: string[];
  events?: Map<string, Event>;
  owner: Map<string, string>;
  selected?: string;
  query: string;
  onSelect: (nodeId: string) => void;
}) {
  if (!props.events) return <p className="muted">Loading events…</p>;
  if (props.ids.length === 0) return <p className="muted pad">No matches in this focus.</p>;
  const term = props.query.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return (
    <ul className="results">
      {props.ids.map((id) => {
        const e = props.events!.get(id);
        if (!e) return null;
        const node = props.owner.get(id);
        const at = term ? e.text.toLowerCase().indexOf(term) : -1;
        const from = Math.max(0, at - 50);
        const text = e.text.slice(from, from + 180).replace(/\s+/g, " ");
        return (
          <li key={id} className={node && node === props.selected ? "selected" : ""} onClick={() => node && props.onSelect(node)}>
            <span className="kind">{e.kind}</span> {e.tool?.name && <span className="tool">{e.tool.name}</span>} {e.agent_id && <span className="badge agent">subagent</span>}
            <span className="time">{fmtTime(e.ts)}</span>
            <div className="snippet">{from > 0 ? "…" : ""}{text}</div>
          </li>
        );
      })}
    </ul>
  );
}
