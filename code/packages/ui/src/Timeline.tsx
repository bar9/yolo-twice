import { useRef, useState } from "react";
import { fmtDuration, fmtTime, walk, type StructureNode } from "./api";

export interface Bar {
  id: string;
  label: string;
  start: number; // ms epoch
  end: number;
  node?: StructureNode;
  /** Phase id, to draw boundaries between groups of turns. */
  group?: string;
}

export interface Tick {
  id: string;
  ts: number;
  kind: string;
}

const KIND_COLOUR: Record<string, string> = {
  "user.prompt": "var(--turn)",
  "user.command": "var(--turn)",
  "assistant.text": "var(--fg)",
  "assistant.thinking": "var(--muted)",
  "tool.call": "var(--tool)",
  "tool.result": "var(--tool)",
  compaction: "var(--branch)",
};

function barColour(b: Bar): string {
  const n = b.node;
  if (!n) return "var(--turn)";
  if (n.meta?.branch) return "var(--branch)";
  if (n.meta?.step_kind === "tool-error") return "var(--error)";
  if (n.meta?.step_kind === "subagent") return "var(--agent)";
  const kinds = [...walk(n)].map((x) => x.meta?.step_kind);
  if (kinds.includes("tool-error")) return "var(--error)";
  if (kinds.includes("subagent")) return "var(--agent)";
  return "var(--turn)";
}

/**
 * The scrubber: one strip of bars (sessions, turns or steps, whatever the focus contains) on an
 * axis spanning the focus, hit ticks underneath, and a brush. Drag to set a window, which snaps to
 * whole bars; click a bar to select it, double click to focus it; click empty space to clear.
 */
export function Timeline(props: {
  bars: Bar[];
  ticks: Tick[];
  start: number;
  end: number;
  window?: [number, number]; // seconds from start, already snapped
  selected?: string;
  hover?: string;
  dim: Set<string>;
  hits: Map<string, number>;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
  onWindow: (w: [number, number] | undefined) => void;
  onHover: (id: string | undefined) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ a: number; b: number } | undefined>();
  const dragged = useRef(false); // a real drag suppresses the click that follows it
  const [tip, setTip] = useState<{ bar: Bar; x: number; y: number } | undefined>();
  const W = 1000;
  const LANE = 26;
  const TICKS = 10;
  const H = LANE + TICKS;
  const span = Math.max(props.end - props.start, 1000);
  const x = (t: number) => ((t - props.start) / span) * W;
  const sec = (px: number) => (px / W) * (span / 1000);

  const toX = (e: React.MouseEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return Math.min(W, Math.max(0, ((e.clientX - r.left) / r.width) * W));
  };

  // brushing may start anywhere, on a bar too; a short movement stays a click
  const onDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const px = toX(e);
    dragged.current = false;
    setDrag({ a: px, b: px });
  };
  const onMove = (e: React.MouseEvent) => drag && setDrag({ ...drag, b: toX(e) });
  const onUp = (e?: React.MouseEvent) => {
    if (!drag) return;
    const [a, b] = [Math.min(drag.a, drag.b), Math.max(drag.a, drag.b)];
    setDrag(undefined);
    if (b - a < 4) {
      // a click: on a bar it selects (the bar's own handler), on empty space it clears the window
      if (!e || !(e.target as Element).closest(".tl-bar")) props.onWindow(undefined);
      return;
    }
    dragged.current = true;
    props.onWindow([Math.floor(sec(a)), Math.ceil(sec(b))]);
  };

  const groups: { id: string; x: number }[] = [];
  props.bars.forEach((b, i) => {
    if (i > 0 && b.group && b.group !== props.bars[i - 1]!.group) groups.push({ id: b.group, x: x(b.start) });
  });

  return (
    <div className="timeline">
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        width="100%"
        height={H}
        role="img"
        aria-label="timeline of the focus; drag to set a window"
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={() => (drag && onUp(), setTip(undefined))}
        onClickCapture={(e) => {
          if (dragged.current) {
            dragged.current = false;
            e.stopPropagation();
          }
        }}
      >
        <rect x={0} y={0} width={W} height={LANE + TICKS} className="tl-bg" />
        {props.window && <rect x={x(props.start + props.window[0] * 1000)} y={0} width={x(props.start + props.window[1] * 1000) - x(props.start + props.window[0] * 1000)} height={LANE + TICKS} className="tl-window" />}
        {groups.map((g) => (
          <line key={g.id} x1={g.x - 1} x2={g.x - 1} y1={0} y2={LANE} className="tl-group" />
        ))}
        {props.bars.map((b) => {
          const bx = x(b.start);
          const bw = Math.max(x(b.end) - bx, 2);
          // a bar is selected when the selection is the bar or lies inside it (ids nest: t5 > t5.s2)
          const isSel = !!props.selected && (b.id === props.selected || props.selected.startsWith(`${b.id}.`));
          const cls = ["tl-bar", isSel ? "selected" : "", b.id === props.hover ? "hover" : "", props.dim.has(b.id) ? "dim" : "", props.hits.has(b.id) ? "hit" : ""].join(" ");
          return (
            <rect
              key={b.id}
              data-id={b.id}
              x={bx}
              y={4}
              width={bw}
              height={LANE - 8}
              rx={2}
              fill={barColour(b)}
              className={cls}
              onClick={() => props.onSelect(b.id)}
              onDoubleClick={() => props.onFocus(b.id)}
              onMouseEnter={(e) => (props.onHover(b.id), setTip({ bar: b, x: e.clientX, y: e.clientY }))}
              onMouseLeave={() => (props.onHover(undefined), setTip(undefined))}
            />
          );
        })}
        {props.ticks.map((t) => (
          <rect key={t.id} x={x(t.ts) - 0.75} y={LANE} width={1.5} height={TICKS} fill={KIND_COLOUR[t.kind] ?? "var(--accent)"} className="tl-tick" />
        ))}
        {drag && <rect x={Math.min(drag.a, drag.b)} y={0} width={Math.abs(drag.b - drag.a)} height={LANE + TICKS} className="tl-brush" />}
      </svg>
      <div className="tl-axis">
        <span>{fmtTime(new Date(props.start).toISOString())}</span>
        {props.window && (
          <span className="tl-window-label">
            window {fmtTime(new Date(props.start + props.window[0] * 1000).toISOString())}–{fmtTime(new Date(props.start + props.window[1] * 1000).toISOString())}{" "}
            <button onClick={() => props.onWindow(undefined)} title="clear the time window">✕</button>
          </span>
        )}
        <span>
          {fmtTime(new Date(props.end).toISOString())} · {fmtDuration(props.end - props.start)}
        </span>
      </div>
      {tip && (
        <div className="tooltip" style={{ left: tip.x + 12, top: tip.y + 12 }}>
          <strong>{tip.bar.label}</strong>
          <div className="muted">
            {fmtTime(new Date(tip.bar.start).toISOString())} · {fmtDuration(tip.bar.end - tip.bar.start)}
            {tip.bar.node && ` · ${tip.bar.node.stats.tool_calls} tool calls`}
            {props.hits.get(tip.bar.id) ? ` · ${props.hits.get(tip.bar.id)} hits` : ""}
            {tip.bar.node?.meta?.branch && " · rewind"}
          </div>
          <div className="muted">click selects · double click focuses</div>
        </div>
      )}
    </div>
  );
}
