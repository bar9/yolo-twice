import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mount, register } from "pele/core";
import flowchart from "pele/diagrams/flowchart";
import { KIND, kindStyle, type Kind } from "./kinds";
import { Maximize, Minus, Plus, Type } from "lucide-react";

register(flowchart); // only the flowchart renderer: keeps the bundle small

const safe = (id: string) => id.replace(/[^A-Za-z0-9_]/g, "_");

/** The committed mermaid carries light-mode colours for other renderers; here CSS colours nodes by their class. */
const unstyled = (mermaid: string) =>
  mermaid
    .split("\n")
    .filter((l) => !/^\s*classDef\s/.test(l))
    .join("\n");

const MIN = 0.2;
const MAX = 2.5;
/** Text stays readable on first sight: fit the width, but never shrink below this or blow up past 1:1. */
const READABLE = 0.72;
const PAD = 28;

/** Which kinds the graph shows, with their icon and colour. */
export function Legend({ kinds }: { kinds: Kind[] }) {
  if (!kinds.length) return null;
  return (
    <div className="legend" aria-label="Legend">
      {kinds.map((k) => {
        const Icon = KIND[k].icon;
        return (
          <span key={k} style={kindStyle(k)}>
            <Icon aria-hidden />
            {KIND[k].label}
          </span>
        );
      })}
    </div>
  );
}

export interface HoverInfo {
  id: string;
  x: number;
  y: number;
}

/**
 * The map: mermaid text rendered by pele on a pannable, zoomable canvas. Drag or scroll to move,
 * ctrl/⌘ + scroll or pinch to zoom, a click zooms into a node (semantic zoom: the graph is redrawn
 * for it). Text is never scaled above 1:1, so a small graph does not shout and a large one stays legible.
 */
export const Graph = memo(function Graph(props: {
  mermaid: string;
  /** Every structure id that may appear in the graph. */
  ids: string[];
  selected?: string;
  /** Follow mode: keep the selected (newest) node centred. */
  follow?: boolean;
  hover?: string;
  dim: Set<string>;
  hits: Map<string, number>;
  onFocus: (id: string) => void;
  onHover: (h: HoverInfo | undefined) => void;
  /** The user moved the view: further down (towards the newest) or up, and whether the bottom is now in view. */
  onUserMove?: (down: boolean, atTail: boolean) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef({ scale: 1, x: PAD, y: PAD, w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const drag = useRef<{ x: number; y: number; moved: number; id: number } | undefined>(undefined);
  const suppressClick = useRef(false);

  const idMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const id of props.ids) {
      m.set(safe(id), id);
      m.set(`${safe(id)}_box`, id); // subagent clusters
    }
    return m;
  }, [props.ids]);

  const svg = () => host.current?.querySelector<SVGSVGElement>(":scope > svg") ?? null;

  const apply = useCallback((animate = false) => {
    const el = host.current;
    const s = svg();
    if (!el || !s) return;
    const v = view.current;
    el.classList.toggle("animate", animate);
    s.style.width = `${v.w * v.scale}px`;
    s.style.height = `${v.h * v.scale}px`;
    s.style.transform = `translate(${v.x}px, ${v.y}px)`;
    setZoom(v.scale);
  }, []);

  /** Keep at least a corner of the graph on screen. */
  const clamp = () => {
    const el = host.current;
    if (!el) return;
    const v = view.current;
    const keep = 80;
    v.x = Math.min(el.clientWidth - keep, Math.max(keep - v.w * v.scale, v.x));
    v.y = Math.min(el.clientHeight - keep, Math.max(keep - v.h * v.scale, v.y));
  };

  const home = useCallback(() => {
    const el = host.current;
    if (!el) return;
    const v = view.current;
    const fitW = (el.clientWidth - PAD * 2) / Math.max(v.w, 1);
    v.scale = Math.min(1, Math.max(READABLE, fitW));
    const gw = v.w * v.scale;
    v.x = gw < el.clientWidth ? (el.clientWidth - gw) / 2 : PAD;
    v.y = PAD;
    apply(false);
  }, [apply]);

  const fitAll = useCallback(() => {
    const el = host.current;
    if (!el) return;
    const v = view.current;
    v.scale = Math.max(MIN, Math.min(1, (el.clientWidth - PAD * 2) / Math.max(v.w, 1), (el.clientHeight - PAD * 2) / Math.max(v.h, 1)));
    v.x = (el.clientWidth - v.w * v.scale) / 2;
    v.y = (el.clientHeight - v.h * v.scale) / 2;
    apply(true);
  }, [apply]);

  const zoomAt = useCallback(
    (factor: number, cx?: number, cy?: number, animate = false) => {
      const el = host.current;
      if (!el) return;
      const v = view.current;
      const ns = Math.min(MAX, Math.max(MIN, v.scale * factor));
      const px = cx ?? el.clientWidth / 2;
      const py = cy ?? el.clientHeight / 2;
      v.x = px - (px - v.x) * (ns / v.scale);
      v.y = py - (py - v.y) * (ns / v.scale);
      v.scale = ns;
      clamp();
      apply(animate);
    },
    [apply],
  );

  // render: pele lays out the diagram, we own the size and position of the svg
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    if (!props.mermaid) {
      el.querySelector(":scope > svg")?.remove();
      return;
    }
    const onRender = () => {
      const s = svg();
      if (!s) return;
      view.current.w = Number(s.getAttribute("width")) || s.viewBox.baseVal.width || 1;
      view.current.h = Number(s.getAttribute("height")) || s.viewBox.baseVal.height || 1;
      s.removeAttribute("width");
      s.removeAttribute("height");
      s.removeAttribute("tabindex"); // the canvas takes focus, not the drawing
      home();
    };
    try {
      const m = mount(el, unstyled(props.mermaid), { zoom: false, onRender });
      onRender();
      return () => m.destroy();
    } catch (e) {
      el.textContent = `graph render failed: ${String(e)}`;
    }
  }, [props.mermaid, home]);

  // project the scope onto the rendered SVG
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    for (const g of el.querySelectorAll<SVGGElement>(".pele-node, .pele-cluster")) {
      const id = idMap.get(g.dataset.id ?? "");
      // the node holding the selection is marked too when the selection itself is not drawn (ids nest: t5 > t5.s2)
      g.classList.toggle("is-selected", id !== undefined && !!props.selected && (id === props.selected || props.selected.startsWith(`${id}.`)));
      g.classList.toggle("is-hover", id !== undefined && id === props.hover);
      g.classList.toggle("is-dim", id !== undefined && props.dim.has(id));
      g.classList.toggle("has-hit", Boolean(id && props.hits.get(id)));
      g.style.cursor = id ? "pointer" : "";
    }
  }, [props.selected, props.hover, props.dim, props.hits, idMap, props.mermaid]);

  // bring the selection into view: centred while following, otherwise only when it is off screen;
  // switching follow off (the user moved away) must not pull the view back
  const lastSel = useRef<string | undefined>(undefined);
  useEffect(() => {
    const el = host.current;
    if (!el || !props.selected) return;
    const sel = props.selected;
    const same = lastSel.current === sel;
    lastSel.current = sel;
    if (same && !props.follow) return;
    const t = setTimeout(() => {
      let target: Element | undefined;
      let best = -1;
      for (const g of el.querySelectorAll<SVGGElement>(".pele-node, .pele-cluster")) {
        const id = idMap.get(g.dataset.id ?? "");
        if (!id || !(id === sel || sel.startsWith(`${id}.`))) continue;
        if (id.length > best) {
          best = id.length;
          target = g;
        }
      }
      if (!target) return;
      const r = target.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      const inside = r.left >= box.left && r.right <= box.right && r.top >= box.top && r.bottom <= box.bottom;
      if (inside && !props.follow) return;
      const v = view.current;
      v.x += box.left + box.width / 2 - (r.left + r.width / 2);
      v.y += box.top + box.height * 0.45 - (r.top + r.height / 2);
      apply(!props.follow);
    }, 40);
    return () => clearTimeout(t);
  }, [props.follow, props.selected, props.mermaid, idMap, apply]);

  // a pane resize (divider, window) starts over from the readable view
  useEffect(() => {
    const el = host.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let last = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (Math.abs(el.clientWidth - last) > 40) home();
      last = el.clientWidth;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [home]);

  const moved = (down: boolean) => {
    const el = host.current;
    if (!el || !props.onUserMove) return;
    const v = view.current;
    props.onUserMove(down, v.y + v.h * v.scale <= el.clientHeight - 8);
  };

  const idAt = (target: EventTarget) => {
    const g = (target as Element).closest?.<SVGGElement>(".pele-node, .pele-cluster");
    return g ? idMap.get(g.dataset.id ?? "") : undefined;
  };

  return (
    <div className="graph-wrap">
      <div
        className="graph pele"
        ref={host}
        tabIndex={0}
        aria-label="Flow graph. Drag to move, Ctrl or Command and scroll to zoom, click a node to zoom into it."
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) {
            const box = host.current!.getBoundingClientRect();
            zoomAt(2 ** (-Math.max(-30, Math.min(30, e.deltaY)) * 0.012), e.clientX - box.left, e.clientY - box.top);
          } else {
            const v = view.current;
            v.x -= e.shiftKey ? e.deltaY : e.deltaX;
            v.y -= e.shiftKey ? 0 : e.deltaY;
            clamp();
            apply();
            if (!e.shiftKey && e.deltaY) moved(e.deltaY > 0);
          }
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          drag.current = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId };
          suppressClick.current = false;
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) {
            const id = idAt(e.target);
            props.onHover(id ? { id, x: e.clientX, y: e.clientY } : undefined);
            return;
          }
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          d.moved += Math.abs(dx) + Math.abs(dy);
          d.x = e.clientX;
          d.y = e.clientY;
          if (d.moved > 4) {
            if (!host.current!.classList.contains("panning")) {
              host.current!.classList.add("panning");
              host.current!.setPointerCapture(d.id);
              props.onHover(undefined);
            }
            const v = view.current;
            v.x += dx;
            v.y += dy;
            clamp();
            apply();
            if (Math.abs(dy) > 1) moved(dy < 0);
          }
        }}
        onPointerUp={() => {
          if (drag.current && drag.current.moved > 4) suppressClick.current = true;
          drag.current = undefined;
          host.current?.classList.remove("panning");
        }}
        onPointerLeave={() => props.onHover(undefined)}
        onClick={(e) => {
          if (suppressClick.current) return void (suppressClick.current = false);
          const id = idAt(e.target);
          if (id) props.onFocus(id);
        }}
        onKeyDown={(e) => {
          const v = view.current;
          const step = 60;
          const moves: Record<string, () => void> = {
            "+": () => zoomAt(1.25, undefined, undefined, true),
            "=": () => zoomAt(1.25, undefined, undefined, true),
            "-": () => zoomAt(0.8, undefined, undefined, true),
            "0": home,
            ArrowLeft: () => ((v.x += step), apply(true)),
            ArrowRight: () => ((v.x -= step), apply(true)),
            ArrowUp: () => ((v.y += step), apply(true)),
            ArrowDown: () => ((v.y -= step), apply(true)),
          };
          const fn = moves[e.key];
          if (fn) {
            e.preventDefault();
            e.stopPropagation();
            fn();
          }
        }}
      />
      <div className="graph-tools" role="toolbar" aria-label="Graph zoom">
        <button onClick={() => zoomAt(1.25, undefined, undefined, true)} title="Zoom in (+)" aria-label="Zoom in">
          <Plus size={16} />
        </button>
        <div className="zoom-level" aria-live="polite">
          {Math.round(zoom * 100)}%
        </div>
        <button onClick={() => zoomAt(0.8, undefined, undefined, true)} title="Zoom out (−)" aria-label="Zoom out">
          <Minus size={16} />
        </button>
        <button onClick={home} title="Readable size, from the top (0)" aria-label="Readable size">
          <Type size={16} />
        </button>
        <button onClick={fitAll} title="Show the whole graph" aria-label="Show the whole graph">
          <Maximize size={16} />
        </button>
      </div>
    </div>
  );
});
