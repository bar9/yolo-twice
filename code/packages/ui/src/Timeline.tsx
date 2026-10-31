import { useState } from "react";
import { fmtDuration, fmtTime, walk, type StructureNode } from "./api";

/** One row per phase, turns as bars on a shared time axis. */
export function Timeline(props: { root: StructureNode; selected?: string; onSelect: (id: string) => void }) {
  const [hover, setHover] = useState<{ node: StructureNode; x: number; y: number } | undefined>();
  const t0 = Date.parse(props.root.span.ts_first);
  const t1 = Date.parse(props.root.span.ts_last);
  const span = Math.max(t1 - t0, 1000);
  const W = 800;
  const ROW = 28;
  const LABEL = 180;
  const phases = props.root.children;
  const H = phases.length * ROW + 24;

  const colour = (t: StructureNode) => {
    if (t.meta?.branch) return "var(--branch)";
    const kinds = [...walk(t)].map((n) => n.meta?.step_kind);
    if (kinds.includes("tool-error")) return "var(--error)";
    if (kinds.includes("subagent")) return "var(--agent)";
    return "var(--turn)";
  };

  return (
    <div className="timeline">
      <svg viewBox={`0 0 ${W + LABEL} ${H}`} width="100%" role="img" aria-label="session timeline">
        {phases.map((p, i) => (
          <g key={p.id} transform={`translate(0,${i * ROW + 4})`}>
            <text x={4} y={ROW / 2 + 4} className="tl-label" onClick={() => props.onSelect(p.id)}>
              {p.label.length > 26 ? p.label.slice(0, 25) + "…" : p.label}
            </text>
            <line x1={LABEL} x2={LABEL + W} y1={ROW / 2} y2={ROW / 2} className="tl-axis" />
            {p.children.map((t) => {
              const a = (Date.parse(t.span.ts_first) - t0) / span;
              const b = (Date.parse(t.span.ts_last) - t0) / span;
              const x = LABEL + a * W;
              const w = Math.max((b - a) * W, 3);
              return (
                <rect
                  key={t.id}
                  x={x}
                  y={6}
                  width={w}
                  height={ROW - 12}
                  rx={3}
                  fill={colour(t)}
                  className={t.id === props.selected ? "tl-bar selected" : "tl-bar"}
                  onClick={() => props.onSelect(t.id)}
                  onMouseEnter={(e) => setHover({ node: t, x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setHover(undefined)}
                />
              );
            })}
          </g>
        ))}
        <text x={LABEL} y={H - 4} className="tl-tick">{fmtTime(props.root.span.ts_first)}</text>
        <text x={LABEL + W} y={H - 4} className="tl-tick" textAnchor="end">{fmtTime(props.root.span.ts_last)}</text>
      </svg>
      {hover && (
        <div className="tooltip" style={{ left: hover.x + 12, top: hover.y + 12 }}>
          <strong>{hover.node.label}</strong>
          <div className="muted">
            {fmtTime(hover.node.span.ts_first)} · {fmtDuration(Date.parse(hover.node.span.ts_last) - Date.parse(hover.node.span.ts_first))} · {hover.node.stats.tool_calls} tool calls
            {hover.node.meta?.branch && " · rewind"}
          </div>
        </div>
      )}
      <div className="legend">
        <i style={{ background: "var(--turn)" }} /> turn <i style={{ background: "var(--branch)" }} /> rewind <i style={{ background: "var(--agent)" }} /> subagent <i style={{ background: "var(--error)" }} /> tool error
      </div>
    </div>
  );
}
