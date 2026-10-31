import { useState } from "react";
import { api, fmtTime, fmtTokens, type Event, type Granularity, type StructureNode } from "./api";

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
  selected?: string;
  onSelect: (id: string) => void;
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

  const render = (node: StructureNode, depth: number, prevBoundary?: string) => {
    const isOpen = open[node.id] ?? depth < 1;
    const g = override[node.id] ?? props.granularity;
    const gi = ORDER.indexOf(g);
    const key = `${node.id}.${g}`;
    const text = g === "full" ? undefined : node.text?.[g] ?? fetched[key];
    if (isOpen && g !== "full" && text === undefined && !pending[key]) void request(node, g);
    const zoomOut = () => setOverride((o) => ({ ...o, [node.id]: ORDER[Math.max(0, gi - 1)]! }));
    const zoomIn = () => setOverride((o) => ({ ...o, [node.id]: ORDER[Math.min(ORDER.length - 1, gi + 1)]! }));
    const cls = ["node", `level-${node.level}`, node.kind, props.selected === node.id ? "selected" : ""].join(" ");

    return (
      <div key={node.id} id={`node-${node.id}`} className={cls} style={{ marginLeft: depth ? 14 : 0 }}>
        {node.meta?.boundary && node.meta.boundary !== prevBoundary && <div className="boundary">— {node.meta.boundary} —</div>}
        <div className="row" onClick={() => (props.onSelect(node.id), toggle(node.id))}>
          <span className="caret">{node.children.length || node.event_ids?.length ? (isOpen ? "▾" : "▸") : "·"}</span>
          <span className="label">{node.label}</span>
          {node.meta?.branch && <span className="badge branch" title={`rewind from ${node.meta.branch_from}`}>rewind</span>}
          {node.meta?.step_kind === "subagent" && <span className="badge agent">{node.meta.agent_type ?? "agent"}</span>}
          {node.meta?.step_kind === "tool-error" && <span className="badge error">error</span>}
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
