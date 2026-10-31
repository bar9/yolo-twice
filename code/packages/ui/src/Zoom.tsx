import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ToolCallView, ToolResultView } from "./ToolCall";
import { Bot, ChevronRight, Coins, Focus, Image, Minus, Plus, RotateCcw, Search, TriangleAlert, Undo2, Wrench } from "lucide-react";
import { ancestors, api, fmtDuration, fmtTime, fmtTokens, walk, type Event, type Granularity, type ImageRef, type StructureNode } from "./api";
import { DETAIL_LABEL, DETAIL_ORDER, eventKind, KIND, KindIcon, kindStyle, nodeKind, richText } from "./kinds";

const ORDER = DETAIL_ORDER;

/**
 * The reader: the focus as a story. Every node shows its label; an open node shows its text at the
 * current length (or its own override) and its children, which hang off a thread from its icon.
 * Missing summaries are requested lazily.
 */
export const Zoom = memo(function Zoom(props: {
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
  /** Highlighted in the text. */
  query?: string;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
  onHover: (id: string | undefined) => void;
  /** The focus's own −/+ is the page-wide detail. */
  onGranularity: (g: Granularity) => void;
  /** Parts set to their own detail, so the page switch can show them. */
  onOverrides: (o: Record<string, Granularity>) => void;
}) {
  // expansion state keyed by node id survives structure refetches
  const [open, setOpen] = useState<Record<string, boolean>>({ [props.root.id]: true });
  // per-part detail; the page-wide level resets them all, so the two controls never disagree
  const [override, setOverride] = useState<Record<string, Granularity>>({});
  useEffect(() => setOverride({}), [props.granularity]);
  useEffect(() => props.onOverrides(override), [override]); // eslint-disable-line react-hooks/exhaustive-deps
  const [fetched, setFetched] = useState<Record<string, string>>({}); // `${node}.${gran}` -> text
  const [pending, setPending] = useState<Record<string, boolean>>({});
  // tool results name their call only by id; one lookup for the whole session
  const calls = useMemo(() => {
    const m = new Map<string, Event>();
    for (const e of props.events?.values() ?? []) if (e.kind === "tool.call" && e.tool?.call_id) m.set(e.tool.call_id, e);
    return m;
  }, [props.events]);

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

  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !(o[id] ?? id === props.root.id) }));

  // a selection made elsewhere (graph, timeline, search) opens the path to the node and scrolls to it;
  // switching follow off (the user scrolled up) must not scroll back
  const lastSel = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!props.selected) return;
    const same = lastSel.current === props.selected;
    lastSel.current = props.selected;
    if (same && !props.follow) return;
    const path = ancestors(props.root, props.selected);
    if (props.follow) path.push(props.selected);
    if (path.length) setOpen((o) => ({ ...o, ...Object.fromEntries(path.map((id) => [id, true])) }));
    // following: keep the tail in the middle of the pane, like tail -f; otherwise center the selection
    const t = setTimeout(() => document.getElementById(`node-${props.selected}`)?.scrollIntoView({ block: "center", behavior: props.follow ? "auto" : "smooth" }), 50);
    return () => clearTimeout(t);
  }, [props.selected, props.root, props.follow]);

  const render = (node: StructureNode, depth: number, prev?: StructureNode, parent?: StructureNode) => {
    const isRoot = depth === 0;
    const isOpen = open[node.id] ?? isRoot;
    const g = override[node.id] ?? props.granularity;
    const gi = ORDER.indexOf(g);
    const key = `${node.id}.${g}`;
    const text = g === "full" ? undefined : node.text?.[g] ?? fetched[key];
    if (isOpen && g !== "full" && text === undefined && !pending[key]) void request(node, g);
    const setHere = (to: Granularity) =>
      isRoot ? props.onGranularity(to) : setOverride((o) => {
        const { [node.id]: _, ...rest } = o;
        return to === props.granularity ? rest : { ...rest, [node.id]: to };
      });
    const less = () => setHere(ORDER[Math.max(0, gi - 1)]!);
    const more = () => setHere(ORDER[Math.min(ORDER.length - 1, gi + 1)]!);
    const own = g !== props.granularity;
    const kind = nodeKind(node);
    const expandable = node.children.length > 0 || (node.event_ids?.length ?? 0) > 0;
    const cls = ["node", `level-${node.level}`, node.kind, isRoot ? "root" : "", isOpen ? "open" : "", props.selected === node.id ? "selected" : "", props.hover === node.id ? "hover" : "", props.dim.has(node.id) ? "dim" : ""].join(" ");
    const hitCount = props.hits.get(node.id);
    const images = imageCount(node, props.events);
    const tokens = node.stats.input_tokens + node.stats.output_tokens;
    const boundary = node.meta?.boundary && node.meta.boundary !== prev?.meta?.boundary ? boundaryText(node, prev) : undefined;
    const showText = g !== "full" && !(text !== undefined && sameText(text, node.label));

    return (
      <div key={node.id} id={`node-${node.id}`} className={cls} style={kindStyle(kind)}>
        {boundary && (
          <div className="boundary">
            <KindIcon kind={node.meta?.boundary === "gap" ? "phase" : "compaction"} />
            {boundary}
          </div>
        )}
        <div
          className="row"
          onClick={() => (props.onSelect(node.id), expandable && toggle(node.id))}
          onMouseEnter={() => props.onHover(node.id)}
          onMouseLeave={() => props.onHover(undefined)}
        >
          <span className="kicon" title={KIND[kind].label}>
            <KindIcon kind={kind} size={isRoot ? 16 : 14} />
          </span>
          <span className="main">
            <Label node={node} kind={kind} />
            <span className="badges">
              {node.meta?.branch && (
                <span className="badge branch" title={`Rewound from ${node.meta.branch_from}`}>
                  <Undo2 aria-hidden />
                  Rewind
                </span>
              )}
              {node.meta?.step_kind === "subagent" && (
                <span className="badge agent">
                  <Bot aria-hidden />
                  {node.meta.agent_type ?? "Agent"}
                </span>
              )}
              {node.meta?.step_kind === "tool-error" && (
                <span className="badge error">
                  <TriangleAlert aria-hidden />
                  Failed
                </span>
              )}
              {hitCount ? (
                <span className="badge hit" title={`${hitCount} matches`}>
                  <Search aria-hidden />
                  {hitCount}
                </span>
              ) : null}
              {images > 0 && (
                <span className="badge image" title="Pasted images">
                  <Image aria-hidden />
                  {images}
                </span>
              )}
            </span>
          </span>
          <span className="meta">
            {node.stats.tool_calls > 0 && (
              <span className="stat" title="Tool calls">
                <Wrench size={12} aria-hidden />
                {node.stats.tool_calls}
              </span>
            )}
            {tokens > 0 && (
              <span className="stat" title="Tokens">
                <Coins size={12} aria-hidden />
                {fmtTokens(tokens)}
                {node.stats.cost_usd !== undefined && `, $${node.stats.cost_usd.toFixed(2)}`}
              </span>
            )}
            <span title={fmtTime(node.span.ts_first)}>{when(node, parent, isRoot)}</span>
          </span>
          {expandable && !isRoot ? (
            <span className="caret" aria-hidden>
              <ChevronRight size={15} />
            </span>
          ) : (
            <span className="caret" />
          )}
          {!isRoot && (
            <button className="zoom-in" onClick={(e) => (e.stopPropagation(), props.onFocus(node.id))} title="Zoom in: make this the focus of every view" aria-label="Zoom in">
              <Focus size={14} />
            </button>
          )}
        </div>
        {isOpen && (
          <div className="body">
            {(g === "full" || showText || ownImages(node, props.events).length > 0 || isRoot) && (
            <div className="text-block">
              {g === "full" ? (
                node.level >= 3 ? <Events node={node} events={props.events} calls={calls} query={props.query} /> : <p className="prose muted">The full text is in the steps below.</p>
              ) : showText ? (
                <p className={`prose ${text === undefined ? "muted" : ""}`}>{richText(text ?? structuralFallback(node, g), props.query)}</p>
              ) : null}
              {g !== "full" && node.level >= 3 && <Images session={props.session} refs={ownImages(node, props.events)} />}
              <div className={`lens ${own ? "own" : ""}`} role="group" aria-label="Detail of this part">
                <button disabled={gi === 0} onClick={less} title="Less detail for this part" aria-label="Less detail">
                  <Minus size={13} />
                </button>
                <span className="gran">Detail {DETAIL_LABEL[g].toLowerCase()}</span>
                <button disabled={gi === ORDER.length - 1} onClick={more} title="More detail for this part" aria-label="More detail">
                  <Plus size={13} />
                </button>
                {own && (
                  <button className="reset-here" onClick={() => setHere(props.granularity)} title={`Back to the page setting: ${DETAIL_LABEL[props.granularity].toLowerCase()}`}>
                    <RotateCcw size={12} />
                    only here
                  </button>
                )}
                {pending[key] && <span className="spin" aria-label="Summarizing" />}
              </div>
            </div>
            )}
            {node.children.map((c, i) => render(c, depth + 1, i === 0 ? undefined : node.children[i - 1], node))}
          </div>
        )}
      </div>
    );
  };

  return <div className="zoom">{render(props.root, 0)}</div>;
});

/** Turns and phases say the time of day; steps say how far into their turn they happened. */
function when(node: StructureNode, parent: StructureNode | undefined, isRoot: boolean): string {
  const t = new Date(node.span.ts_first);
  if (Number.isNaN(t.getTime())) return "";
  if (isRoot) return t.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
  if (node.kind !== "step" || !parent) return t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const off = t.getTime() - Date.parse(parent.span.ts_first);
  return off >= 1000 ? `+${fmtDuration(off)}` : "start";
}

/** A tool step reads as the tool's name in code, then what it did. */
function Label({ node, kind }: { node: StructureNode; kind: string }) {
  const tool = node.meta?.tool as string | undefined;
  if ((kind === "tool" || kind === "error") && tool && node.label.startsWith(`${tool}:`)) {
    return (
      <span className="label">
        <span className="tool-name">{tool}</span>
        {node.label.slice(tool.length + 1).trim()}
      </span>
    );
  }
  return <span className="label">{node.label}</span>;
}

/** What separates this phase from the one before, in words. */
function boundaryText(node: StructureNode, prev?: StructureNode): string {
  switch (node.meta?.boundary) {
    case "gap": {
      const pause = prev ? Date.parse(node.span.ts_first) - Date.parse(prev.span.ts_last) : NaN;
      return Number.isFinite(pause) && pause > 0 ? `Paused for ${fmtDuration(pause)}` : "Paused";
    }
    case "compaction":
      return "Context compacted";
    case "command":
      return "Started over";
    default:
      return String(node.meta?.boundary);
  }
}

/** A text that only repeats the heading (a one-line prompt is its own title) is not shown twice. */
function sameText(text: string, label: string): boolean {
  const norm = (s: string) => s.replace(/[\s.…]+/g, " ").trim().toLowerCase();
  const [t, l] = [norm(text), norm(label)];
  // the label may be a truncated prompt: a prefix match counts only while the rest is short
  return !t || t === l || (Math.abs(t.length - l.length) < 20 && (t.startsWith(l) || l.startsWith(t)));
}

/** What to show before a summary exists: the label, deterministic, never blank. */
function structuralFallback(node: StructureNode, g: Granularity): string {
  if (g === "title") return node.label;
  const kids = node.children.map((c) => c.label).slice(0, g === "abstract" ? 3 : 12);
  return kids.length ? `${node.label}. Then: ${kids.join("; ")}.` : node.label;
}

/** Images pasted into the prompts among a node's own events. */
function ownImages(node: StructureNode, events?: Map<string, Event>): ImageRef[] {
  if (!events) return [];
  return (node.event_ids ?? []).flatMap((id) => (events.get(id)?.data?.images ?? []) as ImageRef[]);
}

function imageCount(node: StructureNode, events?: Map<string, Event>): number {
  let n = 0;
  for (const c of walk(node)) n += ownImages(c, events).length;
  return n;
}

/** Thumbnails; a click opens the full image. Images that were not stored say why. */
function Images({ session, refs }: { session: string; refs: ImageRef[] }) {
  if (!refs.length) return null;
  return (
    <div className="images">
      {refs.map((r, i) =>
        r.file ? (
          <a key={r.file + i} href={api.imageUrl(session, r.file)} target="_blank" rel="noreferrer" title={`Open full size (${Math.round(r.bytes / 1024)} kB)`}>
            <img src={api.imageUrl(session, r.file)} alt="Pasted image" loading="lazy" />
          </a>
        ) : (
          <span key={i} className="image-omitted">
            Image not stored: {r.omitted === "too-large" ? `${Math.round(r.bytes / 1024)} kB is over the limit` : "images are switched off"}.
          </span>
        ),
      )}
    </div>
  );
}

const PROSE = new Set(["user.prompt", "assistant.text", "compaction"]);

/** Raw events of a step (L3) in append order: words as prose, tool input and output as code. */
function Events({ node, events, calls, query }: { node: StructureNode; events?: Map<string, Event>; calls: Map<string, Event>; query?: string }) {
  if (!events) return <p className="prose muted">Loading events…</p>;
  const ids = node.event_ids ?? [];
  return (
    <div className="events">
      {ids.map((id) => {
        const e = events.get(id);
        if (!e) return null;
        const k = eventKind(e);
        const text = e.text || (e.data?.hidden ? "Hidden by Claude Code" : "");
        return (
          <div key={id} className={`event ${e.kind.replace(".", "-")}`} style={kindStyle(k)}>
            <div className="event-head">
              <span className="kind">
                <KindIcon kind={k} size={13} />
                {e.kind === "tool.result" ? "Result" : KIND[k].label}
              </span>
              {(e.tool?.name || (e.tool?.call_id && calls.get(e.tool.call_id)?.tool?.name)) && <span className="tool-name">{e.tool?.name || calls.get(e.tool!.call_id!)?.tool?.name}</span>}
              {e.model && <span>{e.model}</span>}
              {e.redacted && (
                <span className="badge redacted" title={e.redacted.rules.join(", ")}>
                  {e.redacted.count} redacted
                </span>
              )}
              <span className="time">{fmtTime(e.ts)}</span>
            </div>
            {PROSE.has(e.kind) ? (
              <p className="event-prose">{richText(text, query)}</p>
            ) : e.kind === "tool.call" ? (
              <ToolCallView event={e} />
            ) : e.kind === "tool.result" ? (
              <ToolResultView event={e} call={e.tool?.call_id ? calls.get(e.tool.call_id) : undefined} />
            ) : (
              <pre>{text}</pre>
            )}
            <Images session={e.session} refs={(e.data?.images ?? []) as ImageRef[]} />
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
  if (!props.events) return <p className="empty">Loading events…</p>;
  if (props.ids.length === 0)
    return (
      <div className="empty">
        <Search size={22} />
        No matches here. Search above, or pick a filter such as You to list all your prompts.
      </div>
    );
  const term = props.query.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return (
    <ul className="results">
      {props.ids.map((id) => {
        const e = props.events!.get(id);
        if (!e) return null;
        const node = props.owner.get(id);
        const at = term ? e.text.toLowerCase().indexOf(term) : -1;
        const from = Math.max(0, at - 50);
        const text = e.text.slice(from, from + 220).replace(/\s+/g, " ");
        const k = eventKind(e);
        return (
          <li key={id} className={node && node === props.selected ? "selected" : ""} style={kindStyle(k)} onClick={() => node && props.onSelect(node)}>
            <span className="kicon">
              <KindIcon kind={k} />
            </span>
            <span className="what">
              {e.kind === "tool.result" ? "Result" : KIND[k].label}
              {e.tool?.name && <span className="tool-name">{e.tool.name}</span>}
              {e.agent_id && (
                <span className="badge agent">
                  <Bot aria-hidden />
                  Subagent
                </span>
              )}
            </span>
            <span className="time">{fmtTime(e.ts)}</span>
            <div className="snippet">
              {from > 0 ? "…" : ""}
              {richText(text, props.query)}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
