import { memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Edge,
  type Node,
  type NodeProps,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { graphlib, layout } from "@dagrejs/dagre";
import { Coins, Ellipsis, Maximize, Minus, Plus, Timer, Type, Wrench } from "lucide-react";
import type { FlowClass, FlowGraph, FlowNode } from "@yolo-twice/analyzers/graph";
import { fmtDuration, fmtTokens } from "./api";
import type { Handover } from "./authors";
import { Avatars, Takeover } from "./Avatar";
import { KIND, KindIcon, kindStyle, nodeKind, type Kind } from "./kinds";
import { BaseHandle, BaseNode, BaseNodeContent, BaseNodeFooter, BaseNodeHeader, BaseNodeHeaderTitle, LabeledGroupNode } from "./components/flow/base-node";
import { cn } from "./lib/utils";

const MIN = 0.2;
const MAX = 2.5;
/** Text stays readable on first sight: fit the width, but never shrink below this or blow up past 1:1. */
const READABLE = 0.72;
const PAD = 28;

const W = 236;
const H = 96;
const H_SESSION = 60;
/** Room inside a group frame: sides/bottom, and the top for its label tab. */
const GP = 16;
const GHEAD = 34;

/** What the reader needs from the map to scroll along with it (Split view). */
export interface GraphApi {
  /** Pan so the box holding this part sits at the reading line; does nothing when it already does. */
  reveal(id: string): void;
}

export interface HoverInfo {
  id: string;
  x: number;
  y: number;
}

/* ---------- layout: dagre ranks the boxes, groups are framed around their children ---------- */

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Laid {
  rects: Map<string, Rect>;
  bounds: Rect;
}

const sizeOf = (n: FlowNode) => ({ w: W, h: n.cls === "session" ? H_SESSION : H });

function lay(flow: FlowGraph): Laid {
  const g = new graphlib.Graph({ compound: true, multigraph: false });
  g.setGraph({ rankdir: "TB", nodesep: 34, ranksep: 54, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  const hasKids = new Set(flow.nodes.flatMap((n) => (n.parent ? [n.parent] : [])));
  for (const n of flow.nodes) {
    if (n.group && hasKids.has(n.id)) g.setNode(n.id, {});
    else g.setNode(n.id, { width: sizeOf(n).w, height: sizeOf(n).h });
  }
  for (const n of flow.nodes) if (n.parent) g.setParent(n.id, n.parent);
  for (const e of flow.edges) g.setEdge(e.source, e.target, { weight: e.kind === "seq" || e.kind === "order" ? 2 : 1 });
  layout(g);

  const rects = new Map<string, Rect>();
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const depth = (n: FlowNode): number => (n.parent ? 1 + depth(byId.get(n.parent)!) : 0);
  for (const n of flow.nodes) {
    if (n.group && hasKids.has(n.id)) continue;
    const p = g.node(n.id);
    const { w, h } = sizeOf(n);
    rects.set(n.id, { x: p.x - w / 2, y: p.y - h / 2, w, h });
  }
  // frame groups around their children, innermost first, so a nested frame is inside its parent's
  const groups = flow.nodes.filter((n) => n.group && hasKids.has(n.id)).sort((a, b) => depth(b) - depth(a));
  for (const grp of groups) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of flow.nodes) {
      if (c.parent !== grp.id) continue;
      const r = rects.get(c.id);
      if (!r) continue;
      x0 = Math.min(x0, r.x);
      y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.w);
      y1 = Math.max(y1, r.y + r.h);
    }
    rects.set(grp.id, { x: x0 - GP, y: y0 - GHEAD, w: x1 - x0 + GP * 2, h: y1 - y0 + GHEAD + GP });
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects.values()) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { rects, bounds: rects.size ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: 1, h: 1 } };
}

/* ---------- node blocks ---------- */

interface BoxData extends Record<string, unknown> {
  flow: FlowNode;
  kind: Kind;
  state: string;
  /** Another author takes over here, or partway through. */
  who?: Handover;
}

function kindOf(n: FlowNode): Kind {
  if (n.node) return n.cls === "subagent" ? "agent" : nodeKind(n.node);
  const map: Record<FlowClass, Kind> = { session: "session", phase: "phase", turn: "you", branch: "rewind", subagent: "agent", tool: "tool", error: "error", text: "text", prompt: "you", thinking: "think" };
  return map[n.cls];
}

/** What a box is, in its header: the kind, and the tool or agent type when there is one. */
function caption(n: FlowNode, k: Kind): { title: string; badge?: string } {
  const m = n.node?.meta;
  if (n.cls === "turn" || n.cls === "branch") return { title: n.cls === "branch" ? "Rewind" : n.node?.meta?.step_kind === "command" ? "Command" : "Turn", badge: n.node?.id };
  if (m?.tool) return { title: KIND[k].label, badge: m.tool };
  if (m?.agent_type) return { title: KIND[k].label, badge: m.agent_type };
  return { title: KIND[k].label };
}

function Stats({ n }: { n: FlowNode }) {
  const s = n.node?.stats;
  const span = n.node?.span;
  if (!s || !span) return null;
  const ms = Date.parse(span.ts_last) - Date.parse(span.ts_first);
  const tokens = s.input_tokens + s.output_tokens;
  return (
    <BaseNodeFooter>
      {ms > 999 && (
        <span className="inline-flex items-center gap-1" title="Duration">
          <Timer size={11} aria-hidden />
          {fmtDuration(ms)}
        </span>
      )}
      {s.tool_calls > 0 && (
        <span className="inline-flex items-center gap-1" title="Tool calls">
          <Wrench size={11} aria-hidden />
          {s.tool_calls}
        </span>
      )}
      {tokens > 0 && (
        <span className="inline-flex items-center gap-1" title="Tokens in and out">
          <Coins size={11} aria-hidden />
          {fmtTokens(tokens)}
        </span>
      )}
      <span className="ml-auto">{s.events} ev</span>
    </BaseNodeFooter>
  );
}

/** A "⋯ N filtered" placeholder from "Hide filtered" (scope.ts foldTree). */
const isFold = (n: FlowNode) => n.ref.includes(".fold");

const FoldNode = memo(function FoldNode({ data }: NodeProps<Node<BoxData>>) {
  return (
    <BaseNode className={cn("flow-box is-fold", data.state)} style={{ width: W, height: H }} title="Show the filtered parts">
      <BaseHandle type="target" position={Position.Top} isConnectable={false} />
      <BaseNodeContent className="flex h-full flex-row items-center gap-2">
        <Ellipsis size={14} aria-hidden />
        <p>{data.flow.label.replace(/^⋯\s*/, "")}</p>
      </BaseNodeContent>
      <BaseHandle type="source" position={Position.Bottom} isConnectable={false} />
    </BaseNode>
  );
});

const StepNode = memo(function StepNode(props: NodeProps<Node<BoxData>>) {
  const { data } = props;
  const n = data.flow;
  if (isFold(n)) return <FoldNode {...props} />;
  const { title, badge } = caption(n, data.kind);
  return (
    <BaseNode className={cn("flow-box", `cls-${n.cls}`, data.state)} style={{ ...kindStyle(data.kind), width: W, height: H }}>
      <BaseHandle type="target" position={Position.Top} isConnectable={false} />
      <BaseNodeHeader>
        <span className="flow-icon">
          <KindIcon kind={data.kind} size={12} />
        </span>
        <BaseNodeHeaderTitle className="flow-title">{title}</BaseNodeHeaderTitle>
        {badge && <span className="flow-badge">{badge}</span>}
        {data.who && !data.who.here && <Avatars authors={data.who.authors} size={14} />}
      </BaseNodeHeader>
      {data.who?.here && <Takeover authors={data.who.authors} size={12} />}
      <BaseNodeContent>
        <p className="line-clamp-2 break-words" title={n.label}>
          {n.label}
        </p>
      </BaseNodeContent>
      <Stats n={n} />
      <BaseHandle type="source" position={Position.Bottom} isConnectable={false} />
    </BaseNode>
  );
});

const SessionNode = memo(function SessionNode({ data }: NodeProps<Node<BoxData>>) {
  const n = data.flow;
  return (
    <BaseNode className={cn("flow-box flow-session", data.state)} style={{ width: W, height: H_SESSION }}>
      <BaseHandle type="target" position={Position.Top} isConnectable={false} />
      <BaseNodeHeader>
        <KindIcon kind="session" size={12} />
        <BaseNodeHeaderTitle>Session</BaseNodeHeaderTitle>
        {data.who && (
          <span className="ml-auto inline-flex min-w-0 items-center gap-1 text-[11px] opacity-80">
            <Avatars authors={data.who.authors} size={14} />
            <span className="truncate">{data.who.authors.map((a) => a.name).join(", ")}</span>
          </span>
        )}
      </BaseNodeHeader>
      <BaseNodeContent>
        <p className="truncate font-semibold" title={n.label}>
          {n.label}
        </p>
      </BaseNodeContent>
      <BaseHandle type="source" position={Position.Bottom} isConnectable={false} />
    </BaseNode>
  );
});

const GroupNode = memo(function GroupNode({ data }: NodeProps<Node<BoxData>>) {
  return <LabeledGroupNode className={cn("flow-group", `cls-${data.flow.cls}`, isFold(data.flow) && "is-fold", data.state)} style={isFold(data.flow) ? undefined : kindStyle(data.kind)} label={data.flow.label} icon={<KindIcon kind={data.kind} size={12} />} after={data.who && (data.who.here ? <Takeover authors={data.who.authors} size={12} /> : <Avatars authors={data.who.authors} size={14} />)} />;
});

const nodeTypes = { step: StepNode, session: SessionNode, group: GroupNode };

/* ---------- the map ---------- */

interface Props {
  flow: FlowGraph;
  /** Parts where another author takes over (git blame), by structure id. */
  handover?: Map<string, Handover>;
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
  /** Left side of the graph's bar: where you are and what the boxes are. */
  head?: React.ReactNode;
  /** The user panned the map: the part now at its reading line, for the reader to scroll to. */
  onView?: (id: string) => void;
  api?: React.Ref<GraphApi>;
  /** Following a session that is being written: the newest box pulses softly. */
  working?: boolean;
}

/** Where a part is read in either pane: 40% down the map, a third down the reader. */
const READ_LINE = 0.4;

/**
 * The map: the focused part of the session as React Flow node blocks on a pannable, zoomable canvas.
 * Scroll or drag to move, ctrl/⌘ + scroll or pinch to zoom, a click zooms into a node (semantic zoom:
 * the graph is redrawn for it). Text is never scaled above 1:1 on first sight.
 */
export const Graph = memo(function Graph(props: Props) {
  return (
    <ReactFlowProvider>
      <FlowMap {...props} />
    </ReactFlowProvider>
  );
});

function FlowMap(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const rf = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  const laid = useMemo(() => lay(props.flow), [props.flow]);
  const flowById = useMemo(() => new Map(props.flow.nodes.map((n) => [n.id, n])), [props.flow]);

  // the box that stands for a part: the part itself, or the deepest drawn node holding it (ids nest: t5 > t5.s2),
  // so a step selected or hovered in the reader lights up its turn on the map
  const boxOf = useCallback(
    (id: string | undefined) => {
      if (!id) return undefined;
      let best: FlowNode | undefined;
      for (const n of props.flow.nodes) {
        if (!(n.ref === id || id.startsWith(`${n.ref}.`))) continue;
        if (!best || n.ref.length > best.ref.length || (n.ref.length === best.ref.length && best.group && !n.group)) best = n;
      }
      return best;
    },
    [props.flow],
  );
  const selBox = useMemo(() => boxOf(props.selected)?.id, [boxOf, props.selected]);
  // boxes that arrive while you watch fade in
  const bornAt = useRef(Date.now() - 1000);
  const hoverBox = useMemo(() => boxOf(props.hover)?.id, [boxOf, props.hover]);

  const nodes = useMemo((): Node<BoxData>[] => {
    const depth = (n: FlowNode): number => (n.parent ? 1 + depth(flowById.get(n.parent)!) : 0);
    const ordered = [...props.flow.nodes].sort((a, b) => Number(!!b.group) - Number(!!a.group) || depth(a) - depth(b));
    return ordered.flatMap((n) => {
      const r = laid.rects.get(n.id);
      if (!r) return [];
      const p = n.parent ? laid.rects.get(n.parent) : undefined;
      const state = cn(
        n.id === selBox && "is-selected",
        n.id === selBox && props.follow && props.working && "is-working",
        n.node && Date.parse(n.node.span.ts_first) > bornAt.current && "is-fresh",
        n.id === hoverBox && "is-hover",
        props.dim.has(n.ref) && "is-dim",
        (props.hits.get(n.ref) ?? 0) > 0 && "has-hit",
      );
      return [
        {
          id: n.id,
          type: n.group ? "group" : n.cls === "session" ? "session" : "step",
          position: { x: r.x - (p?.x ?? 0), y: r.y - (p?.y ?? 0) },
          parentId: n.parent,
          // a subagent's frame and its first box share a ref: the frame carries the mark
          data: { flow: n, kind: kindOf(n), state, who: n.parent && flowById.get(n.parent)?.ref === n.ref ? undefined : props.handover?.get(n.ref) },
          width: r.w,
          height: r.h,
          style: { width: r.w, height: r.h },
          zIndex: n.group ? -1 : 1,
          draggable: false,
          selectable: false,
          connectable: false,
        },
      ];
    });
  }, [props.flow, laid, flowById, selBox, hoverBox, props.dim, props.hits, props.follow, props.working, props.handover]);

  const edges = useMemo(
    (): Edge[] =>
      props.flow.edges.filter((e) => e.kind !== "order").map((e) => {
        const color = e.kind === "rewind" ? "var(--k-rewind)" : e.kind === "spawn" ? "var(--k-agent)" : e.kind === "fork" ? "var(--k-you)" : "var(--rule-strong)";
        const dim = props.dim.has(flowById.get(e.target)?.ref ?? "");
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          type: "smoothstep",
          pathOptions: { borderRadius: 10 },
          label: e.kind === "rewind" ? "rewind" : e.kind === "fork" ? "forked" : undefined,
          className: cn("flow-edge", `edge-${e.kind}`, dim && "is-dim"),
          style: { stroke: color, strokeWidth: 1.5, strokeDasharray: e.kind === "seq" ? undefined : "5 4" },
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
          zIndex: 2,
          selectable: false,
          focusable: false,
        };
      }),
    [props.flow, props.dim, flowById],
  );

  const home = useCallback(() => {
    const el = host.current;
    if (!el) return;
    const b = laid.bounds;
    const fitW = (el.clientWidth - PAD * 2) / Math.max(b.w, 1);
    const z = Math.min(1, Math.max(READABLE, fitW));
    const gw = b.w * z;
    const x = gw < el.clientWidth ? (el.clientWidth - gw) / 2 - b.x * z : PAD - b.x * z;
    void rf.setViewport({ x, y: PAD - b.y * z, zoom: z });
  }, [laid, rf]);

  const fitAll = useCallback(() => void rf.fitView({ padding: 0.06, maxZoom: 1, minZoom: MIN, duration: 280 }), [rf]);
  const zoomBy = useCallback((f: number) => void (f > 1 ? rf.zoomIn({ duration: 200 }) : rf.zoomOut({ duration: 200 })), [rf]);
  const panBy = useCallback(
    (dx: number, dy: number) => {
      const v = rf.getViewport();
      void rf.setViewport({ ...v, x: v.x + dx, y: v.y + dy }, { duration: 160 });
    },
    [rf],
  );

  // a new root is a new view: start from the readable size at the top; a live update keeps where you are
  // (React Flow drops viewport changes until it has initialised, which a fresh mount, e.g. switching to Map, has not)
  const [ready, setReady] = useState(false);
  const lastRoot = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!ready || lastRoot.current === props.flow.root) return;
    lastRoot.current = props.flow.root;
    const t = requestAnimationFrame(home);
    return () => cancelAnimationFrame(t);
  }, [ready, props.flow.root, home]);

  // bring the selection into view: centred while following, otherwise only when it is off screen;
  // switching follow off (the user moved away) must not pull the view back
  const lastSel = useRef<string | undefined>(undefined);
  useEffect(() => {
    const el = host.current;
    if (!ready || !el || !selBox) return;
    const same = lastSel.current === selBox;
    lastSel.current = selBox;
    if (same && !props.follow) return;
    const t = setTimeout(() => {
      const r = laid.rects.get(selBox);
      if (!r) return;
      const v = rf.getViewport();
      const sx = r.x * v.zoom + v.x;
      const sy = r.y * v.zoom + v.y;
      const inside = sx >= 0 && sy >= 0 && sx + r.w * v.zoom <= el.clientWidth && sy + r.h * v.zoom <= el.clientHeight;
      if (inside && !props.follow) return;
      const x = el.clientWidth / 2 - (r.x + r.w / 2) * v.zoom;
      const y = el.clientHeight * 0.45 - (r.y + r.h / 2) * v.zoom;
      void rf.setViewport({ x, y, zoom: v.zoom }, { duration: props.follow ? 350 : 280 });
    }, 40);
    return () => clearTimeout(t);
  }, [ready, props.follow, selBox, laid, rf]);

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

  // scroll sync: the reader asks the map to show a part; the map reports the part at its reading line
  useImperativeHandle(
    props.api,
    () => ({
      reveal(id) {
        const box = boxOf(id);
        const el = host.current;
        const r = box && laid.rects.get(box.id);
        if (!ready || !el || !r) return;
        const v = rf.getViewport();
        // a group (a phase) lines up by its top, a box by its middle
        const anchor = box.group ? r.y : r.y + r.h / 2;
        const y = el.clientHeight * READ_LINE - anchor * v.zoom;
        const left = r.x * v.zoom + v.x;
        const x = left >= 0 && left + r.w * v.zoom <= el.clientWidth ? v.x : el.clientWidth / 2 - (r.x + r.w / 2) * v.zoom;
        if (Math.abs(y - v.y) < 2 && x === v.x) return;
        void rf.setViewport({ x, y, zoom: v.zoom }, { duration: 200 });
      },
    }),
    [boxOf, laid, ready, rf],
  );
  const atLine = useCallback(
    (v: Viewport) => {
      const el = host.current;
      if (!el) return undefined;
      const ly = (el.clientHeight * READ_LINE - v.y) / v.zoom;
      const lx = (el.clientWidth / 2 - v.x) / v.zoom;
      let best: FlowNode | undefined;
      let dist = Infinity;
      for (const n of props.flow.nodes) {
        const r = n.group ? undefined : laid.rects.get(n.id);
        if (!r) continue;
        const d = Math.max(0, Math.abs(r.y + r.h / 2 - ly) - r.h / 2) + 0.25 * Math.max(0, Math.abs(r.x + r.w / 2 - lx) - r.w / 2);
        if (d < dist) (best = n), (dist = d);
      }
      return best?.ref;
    },
    [props.flow, laid],
  );

  const prevY = useRef<number | undefined>(undefined);
  const viewFrame = useRef(0);
  const onMove = useCallback(
    (e: MouseEvent | TouchEvent | null, v: Viewport) => {
      const el = host.current;
      const before = prevY.current;
      prevY.current = v.y;
      if (!e || !el) return;
      if (props.onView) {
        cancelAnimationFrame(viewFrame.current);
        viewFrame.current = requestAnimationFrame(() => {
          const id = atLine(v);
          if (id) props.onView?.(id);
        });
      }
      if (before === undefined || !props.onUserMove || Math.abs(v.y - before) < 1) return;
      const b = laid.bounds;
      props.onUserMove(v.y < before, v.y + (b.y + b.h) * v.zoom <= el.clientHeight - 8);
    },
    [laid, props.onUserMove, props.onView, atLine],
  );

  const hoverNode = (e: React.MouseEvent, n: Node<BoxData>) => props.onHover({ id: n.data.flow.ref, x: e.clientX, y: e.clientY });

  return (
    <>
      <div className="pane-head graph-head">
        <div className="graph-where">{props.head}</div>
        <div className="graph-tools" role="toolbar" aria-label="Graph zoom">
          <button onClick={() => zoomBy(0.8)} title="Zoom out (−)" aria-label="Zoom out">
            <Minus size={15} />
          </button>
          <span className="zoom-level" aria-live="polite">
            {Math.round(zoom * 100)}%
          </span>
          <button onClick={() => zoomBy(1.25)} title="Zoom in (+)" aria-label="Zoom in">
            <Plus size={15} />
          </button>
          <span className="tools-sep" />
          <button onClick={home} title="Readable size, from the top (0)" aria-label="Readable size">
            <Type size={15} />
          </button>
          <button onClick={fitAll} title="Show the whole graph" aria-label="Show the whole graph">
            <Maximize size={15} />
          </button>
        </div>
      </div>
      <div
        className="graph-wrap flow"
        ref={host}
        tabIndex={0}
        aria-label="Flow graph. Scroll or drag to move, Ctrl or Command and scroll to zoom, click a node to zoom into it."
        onKeyDown={(e) => {
          const step = 60;
          const moves: Record<string, () => void> = {
            "+": () => zoomBy(1.25),
            "=": () => zoomBy(1.25),
            "-": () => zoomBy(0.8),
            "0": home,
            ArrowLeft: () => panBy(step, 0),
            ArrowRight: () => panBy(-step, 0),
            ArrowUp: () => panBy(0, step),
            ArrowDown: () => panBy(0, -step),
            // give the keys back to the page
            Escape: () => host.current?.blur(),
          };
          const fn = moves[e.key];
          if (fn) {
            e.preventDefault();
            e.stopPropagation();
            fn();
          }
        }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          minZoom={MIN}
          maxZoom={MAX}
          panOnScroll
          zoomOnScroll={false}
          zoomOnPinch
          zoomOnDoubleClick={false}
          // React Flow listens page-wide (Space pans, Backspace deletes, Shift box-selects) and would eat the page's keys
          panActivationKeyCode={null}
          deleteKeyCode={null}
          selectionKeyCode={null}
          multiSelectionKeyCode={null}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          onlyRenderVisibleElements={props.flow.nodes.length > 300}
          proOptions={{ hideAttribution: true }}
          onInit={() => setReady(true)}
          onMove={onMove}
          onNodeClick={(_, n) => props.onFocus((n as Node<BoxData>).data.flow.ref)}
          onNodeMouseEnter={hoverNode as never}
          onNodeMouseMove={hoverNode as never}
          onNodeMouseLeave={() => props.onHover(undefined)}
          onPaneMouseLeave={() => props.onHover(undefined)}
          // scroll-panning reports a gesture's first tick only as its start: count start and end as moves too
          onMoveStart={(e, v) => (props.onHover(undefined), onMove(e, v))}
          onMoveEnd={onMove}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--rule-strong)" />
          <MiniMap
            pannable
            zoomable
            ariaLabel="Overview of the graph"
            nodeBorderRadius={4}
            nodeColor={(n) => (n.type === "group" ? "transparent" : KIND[(n.data as BoxData).kind].color)}
            nodeStrokeColor={(n) => (n.type === "group" ? "var(--rule-strong)" : "transparent")}
            maskColor="color-mix(in srgb, var(--paper) 72%, transparent)"
          />
        </ReactFlow>
      </div>
    </>
  );
}
