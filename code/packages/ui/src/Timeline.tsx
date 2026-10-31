import { memo, useRef, useState } from "react";
import { X } from "lucide-react";
import { fmtDuration, fmtTime, walk, type StructureNode } from "./api";
import { KIND, nodeKind } from "./kinds";
import { useCtrlWheel } from "./wheelZoom";
import { clock, crossesDay, dayLabel, timeMarks, weekday } from "./timeAxis";
import type { HoverInfo } from "./Graph";

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

/** A block has its own kind's colour; an edge on top says a failure or a subagent happened inside it. */
function barLook(b: Bar): { fill: string; edge?: string } {
  const n = b.node;
  if (!n) return { fill: "var(--ink-3)" }; // a whole session on the project tape
  const fill = KIND[nodeKind(n)].color;
  if (n.kind === "step") return { fill };
  const kinds = new Set([...walk(n)].map((x) => x.meta?.step_kind));
  if (kinds.has("tool-error")) return { fill, edge: KIND.error.color };
  if (kinds.has("subagent")) return { fill, edge: KIND.agent.color };
  return { fill };
}

/**
 * The tape: the focus laid out in time. Blocks are its parts (sessions, turns or steps), the
 * waveform underneath is how busy the agent was, marker ticks are search hits, the orange line is
 * the playhead (the selection, or the live tail while following). Drag to set a time window, which
 * snaps to whole blocks; click a block to zoom into it; click empty space to clear the window.
 */
export const Timeline = memo(function Timeline(props: {
  bars: Bar[];
  ticks: Tick[];
  /** Event counts in equal time buckets across the span. */
  wave: number[];
  start: number;
  end: number;
  window?: [number, number]; // seconds from start, already snapped
  playhead?: number;
  selected?: string;
  hover?: string;
  dim: Set<string>;
  hits: Map<string, number>;
  onFocus: (id: string) => void;
  /** Ctrl + wheel down: widen the scope one level. */
  onWiden: () => void;
  onWindow: (w: [number, number] | undefined) => void;
  onHover: (h: HoverInfo | undefined) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ a: number; b: number } | undefined>();
  // where the pointer is on the tape (0..W): a line and a readout right under the tape, without waiting
  const [cursor, setCursor] = useState<number | undefined>();
  const dragged = useRef(false); // a real drag suppresses the click that follows it
  const W = 1000;
  const LANE = 30;
  const WAVE = 22;
  const H = LANE + WAVE + 4;
  const span = Math.max(props.end - props.start, 1000);
  const x = (t: number) => ((t - props.start) / span) * W;
  const sec = (px: number) => (px / W) * (span / 1000);

  // Ctrl + wheel: up zooms into the block under the pointer (or the selected one), down widens
  useCtrlWheel(svg, (dir, target) => {
    if (dir < 0) return props.onWiden();
    const id = target?.closest(".tl-bar")?.getAttribute("data-id") ?? props.bars.find((b) => props.selected && (b.id === props.selected || props.selected.startsWith(`${b.id}.`)))?.id;
    if (id) props.onFocus(id);
  });

  const toX = (e: React.MouseEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return Math.min(W, Math.max(0, ((e.clientX - r.left) / r.width) * W));
  };

  // brushing may start anywhere, on a block too; a short movement stays a click
  const onDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const px = toX(e);
    dragged.current = false;
    setDrag({ a: px, b: px });
  };
  const onMove = (e: React.MouseEvent) => {
    const px = toX(e);
    setCursor(px);
    if (drag) setDrag({ ...drag, b: px });
  };
  const onUp = (e?: React.MouseEvent) => {
    if (!drag) return;
    const [a, b] = [Math.min(drag.a, drag.b), Math.max(drag.a, drag.b)];
    setDrag(undefined);
    if (b - a < 4) {
      // a click: on a block it zooms in (the block's own handler), on empty space it clears the window
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
  const peak = Math.max(1, ...props.wave);
  const bw = W / Math.max(props.wave.length, 1);
  const wx = (s: number) => x(props.start + s * 1000);
  const marks = timeMarks(props.start, props.end);
  const days = crossesDay(props.start, props.end);
  // the readout names the date whenever the tape spans more than one day
  const whenFull = (t: number, seconds = false) => (days ? `${dayLabel(t)} · ${clock(t, seconds)}` : clock(t, seconds));
  // the readout under the pointer: its time, and how busy that slice of the tape was
  const readout = (() => {
    if (cursor === undefined || drag) return undefined;
    const t = props.start + (cursor / W) * span;
    const i = Math.min(props.wave.length - 1, Math.floor(cursor / bw));
    const n = props.wave[i] ?? 0;
    return { left: (cursor / W) * 100, text: `${whenFull(t, span < 6 * 3_600_000)} · ${n ? `${n} event${n === 1 ? "" : "s"}` : "quiet"}` };
  })();

  return (
    <div className="timeline" data-tour="timeline">
      <div className="tl-track">
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        width="100%"
        height={H}
        role="img"
        aria-label="Timeline of the focus. Drag to set a time window."
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={() => (drag && onUp(), setCursor(undefined), props.onHover(undefined))}
        onClickCapture={(e) => {
          if (dragged.current) {
            dragged.current = false;
            e.stopPropagation();
          }
        }}
      >
        <rect x={0} y={0} width={W} height={H} className="tl-bg" />
        {props.wave.map((n, i) => {
          if (!n) return null;
          const h = Math.sqrt(n / peak) * (WAVE - 2);
          // the full slice height is the hover target, so even a short bar is easy to point at
          return (
            <g key={i} className={`tl-wave-slot ${cursor !== undefined && Math.floor(cursor / bw) === i ? "on" : ""}`}>
              <rect x={i * bw} y={LANE} width={bw} height={WAVE + 4} fill="transparent" />
              <rect x={i * bw + bw * 0.15} y={H - 2 - h} width={bw * 0.7} height={h} className="tl-wave" />
            </g>
          );
        })}
        {marks.map((m) => (
          <line key={m.t} x1={x(m.t)} x2={x(m.t)} y1={m.day ? 0 : LANE} y2={H} className={m.day ? "tl-day" : "tl-mark"} />
        ))}
        {props.window && <rect x={wx(props.window[0])} y={0} width={wx(props.window[1]) - wx(props.window[0])} height={H} className="tl-window" />}
        {groups.map((g) => (
          <line key={g.id} x1={g.x - 1} x2={g.x - 1} y1={2} y2={H - 2} className="tl-group" />
        ))}
        {props.bars.map((b) => {
          const bx = x(b.start);
          const w = Math.max(x(b.end) - bx, 2);
          // a block is selected when the selection is the block or lies inside it (ids nest: t5 > t5.s2)
          const isSel = !!props.selected && (b.id === props.selected || props.selected.startsWith(`${b.id}.`));
          const cls = ["tl-bar", isSel ? "selected" : "", b.id === props.hover ? "hover" : "", props.dim.has(b.id) ? "dim" : "", props.hits.has(b.id) ? "hit" : ""].join(" ");
          const look = barLook(b);
          return (
            <g key={b.id}>
            <rect
              data-id={b.id}
              x={bx}
              y={5}
              width={w}
              height={LANE - 8}
              rx={3}
              fill={look.fill}
              fillOpacity={isSel ? 0.95 : 0.62}
              className={cls}
              onClick={() => props.onFocus(b.id)}
              onMouseEnter={(e) => props.onHover({ id: b.id, x: e.clientX, y: e.clientY })}
              onMouseMove={(e) => props.onHover({ id: b.id, x: e.clientX, y: e.clientY })}
              onMouseLeave={() => props.onHover(undefined)}
            />
            {look.edge && <rect x={bx} y={3} width={w} height={3} fill={look.edge} className={`tl-edge ${props.dim.has(b.id) ? "dim" : ""}`} />}
            </g>
          );
        })}
        {props.ticks.map((t) => (
          <rect key={t.id} x={x(t.ts) - 1} y={LANE} width={2} height={WAVE + 2} className="tl-tick" />
        ))}
        {drag && <rect x={Math.min(drag.a, drag.b)} y={0} width={Math.abs(drag.b - drag.a)} height={H} className="tl-brush" />}
      </svg>
      {/* the playhead sits over the tape, not in it: the stretched SVG would bend a marker, and clip it at the edges */}
      {readout && <span className="tl-cursor" style={{ left: `${readout.left}%` }} aria-hidden />}
      {props.playhead !== undefined && props.playhead >= props.start && (
        <span className="tl-head" style={{ left: `clamp(1px, ${(x(props.playhead) / W) * 100}%, calc(100% - 1px))` }} aria-hidden>
          <span className="tl-head-mark" />
        </span>
      )}
      </div>
      <div className="tl-axis">
        {/* time marks under the tape; day borders carry the date. They make way for the edges and the readout */}
        {marks.map((m) => {
          const left = (x(m.t) / W) * 100;
          if (left < 9 || left > 88 || (readout && Math.abs(left - readout.left) < 9)) return null;
          return (
            <span key={m.t} className={`tl-mark-label ${m.day ? "day" : ""}`} style={{ left: `${left}%` }}>
              {m.day ? dayLabel(m.t) : clock(m.t)}
            </span>
          );
        })}
        {readout && (
          <span className="tl-readout" style={{ left: `clamp(70px, ${readout.left}%, calc(100% - 70px))` }}>
            {readout.text}
          </span>
        )}
        <span>
          {days ? `${weekday(props.start)} ` : ""}
          {fmtTime(new Date(props.start).toISOString())}
          <span className="tl-legend" title="Grey bars: how many events (prompts, answers, tool calls) happened in each slice of time. Point at the tape for the count.">
            <i aria-hidden />
            activity
          </span>
        </span>
        {props.window && (
          <span className="tl-window-label">
            Window {fmtTime(new Date(props.start + props.window[0] * 1000).toISOString())} to {fmtTime(new Date(props.start + props.window[1] * 1000).toISOString())}
            <button onClick={() => props.onWindow(undefined)} title="Clear the time window" aria-label="Clear the time window">
              <X size={13} />
            </button>
          </span>
        )}
        <span>
          {days ? `${weekday(props.end)} ` : ""}
          {fmtTime(new Date(props.end).toISOString())}, {fmtDuration(props.end - props.start)}
        </span>
      </div>
    </div>
  );
});
