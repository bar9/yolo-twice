import { memo, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ToolCallView, ToolResultView } from "./ToolCall";
import { JsonView } from "./Json";
import { prettyJson } from "./toolview";
import { Bot, ChevronRight, Ellipsis, Coins, Focus, Image, Minus, Plus, RotateCcw, Search, TriangleAlert, Undo2, Wrench } from "lucide-react";
import { ancestors, api, fmtDuration, fmtTime, fmtTokens, walk, type Event, type Granularity, type ImageRef, type StructureNode } from "./api";
import { DETAIL_LABEL, DETAIL_ORDER, eventKind, KIND, KindIcon, kindStyle, nodeKind, richText } from "./kinds";

const ORDER = DETAIL_ORDER;

export interface ZoomApi {
  toggle(id: string): void;
  detail(id: string, dir: 1 | -1): void;
}
/** How many matching steps a search opens at Raw; more would bury the page. */
const AUTO_MAX = 30;

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
  /** A search or filter is active, and these events match it. */
  active?: boolean;
  matches?: Set<string>;
  /** Fold runs of dimmed (non-matching) parts into one line each. */
  collapseDim?: boolean;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
  onHover: (id: string | undefined) => void;
  /** The focus's own −/+ is the page-wide detail. */
  onGranularity: (g: Granularity) => void;
  /** Parts set to their own detail, so the page switch can show them. */
  onOverrides: (o: Record<string, Granularity>) => void;
  /** For the keyboard: open or close a part, step its own detail. */
  api?: React.Ref<ZoomApi>;
  /** Following a session Claude's hooks say is active: working (dots animate) or waiting for you; with the time of its last event. */
  working?: { state: "working" | "waiting"; lastEvent: string };
}) {
  // expansion state keyed by node id survives structure refetches
  const [open, setOpen] = useState<Record<string, boolean>>({ [props.root.id]: true });
  // per-part detail; the page-wide level resets them all, so the two controls never disagree
  const [override, setOverride] = useState<Record<string, Granularity>>({});
  useEffect(() => setOverride({}), [props.granularity]);
  useEffect(() => props.onOverrides(override), [override]); // eslint-disable-line react-hooks/exhaustive-deps

  // search opens to the passage: the steps holding matches open at Raw, their parents open too;
  // clearing the search closes exactly what it opened
  const hitSteps = useMemo(() => {
    if (!props.active) return [];
    const out: string[] = [];
    for (const n of walk(props.root)) if (n.kind === "step" && props.hits.get(n.id) && !n.children.some((c) => props.hits.get(c.id))) out.push(n.id);
    return out;
  }, [props.active, props.hits, props.root]);
  const autoOpen = useRef<Set<string>>(new Set());
  const autoRaw = useRef<Set<string>>(new Set());
  const hitKey = hitSteps.slice(0, AUTO_MAX).join(",");
  useEffect(() => {
    const shown = hitKey ? hitKey.split(",") : [];
    setOpen((o) => {
      const n = { ...o };
      for (const id of autoOpen.current) delete n[id];
      const opened = new Set<string>();
      for (const id of shown)
        for (const a of [...ancestors(props.root, id), id])
          if (!n[a]) {
            n[a] = true;
            opened.add(a);
          }
      autoOpen.current = opened;
      return n;
    });
    setOverride((o) => {
      const n = { ...o };
      for (const id of autoRaw.current) delete n[id];
      for (const id of shown) if (props.granularity !== "full") n[id] = "full";
      autoRaw.current = new Set(shown);
      return n;
    });
    if (!shown.length || props.follow) return;
    const t = setTimeout(() => document.querySelector(".zoom .event.match")?.scrollIntoView({ block: "center", behavior: "smooth" }), 150);
    return () => clearTimeout(t);
  }, [hitKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // the words themselves, in prose and in highlighted code alike, without touching the DOM
  const zoomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const reg = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights;
    const HighlightCtor = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    if (!reg || !HighlightCtor) return;
    const terms = (props.query ?? "").toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
    const root = zoomRef.current;
    if (!terms.length || !root) return void reg.delete("yt-search");
    const frame = requestAnimationFrame(() => {
      const ranges: Range[] = [];
      for (const box of root.querySelectorAll(".events")) {
        const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node && ranges.length < 2000; node = walker.nextNode()) {
          if (node.parentElement?.closest("mark, .gutter")) continue;
          const text = node.textContent?.toLowerCase() ?? "";
          for (const t of terms)
            for (let i = text.indexOf(t); i >= 0; i = text.indexOf(t, i + t.length)) {
              const r = document.createRange();
              r.setStart(node, i);
              r.setEnd(node, i + t.length);
              ranges.push(r);
            }
        }
      }
      reg.set("yt-search", new HighlightCtor(...ranges));
    });
    return () => cancelAnimationFrame(frame);
  });
  useEffect(() => () => void (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights?.delete("yt-search"), []);
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
  useImperativeHandle(
    props.api,
    () => ({
      toggle,
      detail(id: string, dir: 1 | -1) {
        const step = (g: Granularity) => ORDER[Math.min(ORDER.length - 1, Math.max(0, ORDER.indexOf(g) + dir))]!;
        if (id === props.root.id) return props.onGranularity(step(props.granularity));
        setOverride((o) => {
          const { [id]: cur, ...rest } = o;
          const next = step(cur ?? props.granularity);
          return next === props.granularity ? rest : { ...rest, [id]: next };
        });
        setOpen((o) => ({ ...o, [id]: true }));
      },
    }),
    [props.root.id, props.granularity, props.onGranularity],
  );

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
    // following: show the end of the newest part, like tail -f (the first jump is instant, later ones glide);
    // otherwise center the selection
    const first = !same && lastTailed.current === undefined;
    const t = setTimeout(() => {
      if (props.follow) tail(first ? "jump" : "glide");
      else document.getElementById(`node-${props.selected}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 50);
    return () => clearTimeout(t);
  }, [props.selected, props.root, props.follow]); // eslint-disable-line react-hooks/exhaustive-deps

  // while following, the end of the newest part (and the working row under it) sits a quarter above the
  // bottom of the pane, and stays there as content grows (a summary arrives, a tool result lands)
  //
  // New content must move the page once, not twice: the scroll is corrected in the same frame as the
  // layout change (a ResizeObserver runs before paint), so nothing is ever drawn pushed down; then the
  // text is shifted back by what the scroll moved and slides into place (FLIP), one calm movement up.
  const lastTailed = useRef<string | undefined>(undefined);
  const tail = (mode: "jump" | "glide") => {
    const zoom = zoomRef.current;
    const pane = zoom?.closest<HTMLElement>(".pane-body");
    const node = props.selected ? document.getElementById(`node-${props.selected}`) : null;
    if (!zoom || !pane || !node) return;
    lastTailed.current = props.selected;
    // measured where things will rest: without the slide still under way
    const sliding = new DOMMatrixReadOnly(getComputedStyle(zoom).transform === "none" ? undefined : getComputedStyle(zoom).transform).m42;
    const end = Math.max(node.getBoundingClientRect().bottom, zoom.querySelector(".working")?.getBoundingClientRect().bottom ?? 0) - sliding;
    const delta = end - (pane.getBoundingClientRect().top + pane.clientHeight * 0.75);
    if (Math.abs(delta) <= 2) return;
    const before = pane.scrollTop;
    pane.scrollTop = before + delta;
    const moved = pane.scrollTop - before;
    // a burst (more than a screen) lands at once; so does everything for people who prefer less motion
    if (mode === "jump" || Math.abs(moved) > pane.clientHeight || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      zoom.style.transition = zoom.style.transform = "";
      return;
    }
    zoom.style.transition = "none";
    zoom.style.transform = `translateY(${sliding + moved}px)`;
    void zoom.offsetHeight; // commit the start position before the transition
    zoom.style.transition = "transform .38s cubic-bezier(.4, 0, .2, 1)";
    zoom.style.transform = "translateY(0)";
  };
  const tailRef = useRef(tail);
  tailRef.current = tail;
  useEffect(() => {
    const el = zoomRef.current;
    if (!props.follow || !el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => tailRef.current("glide"));
    ro.observe(el);
    const done = () => void (el.style.transition = el.style.transform = "");
    const ended = (e: TransitionEvent) => e.target === el && e.propertyName === "transform" && done();
    el.addEventListener("transitionend", ended);
    return () => {
      ro.disconnect();
      el.removeEventListener("transitionend", ended);
      done();
    };
  }, [props.follow]);
  useEffect(() => {
    if (!props.follow) lastTailed.current = undefined;
  }, [props.follow]);

  // parts that arrive while you watch fade in; what was there when the page opened just shows
  const bornAt = useRef(Date.now() - 1000);

  // runs of non-matching parts fold into one line; a click opens that run, a new search folds again
  const [openRuns, setOpenRuns] = useState<Set<string>>(new Set());
  useEffect(() => setOpenRuns(new Set()), [props.query, props.matches]);
  const keep = (id: string) => !!props.selected && (props.selected === id || props.selected.startsWith(`${id}.`));
  const children = (node: StructureNode, depth: number) => {
    const out: React.ReactNode[] = [];
    let run: number[] = [];
    const flush = () => {
      if (!run.length) return;
      const first = node.children[run[0]!]!;
      if (openRuns.has(first.id) || run.length === 1 && !first.children.length) out.push(...run.map((i) => render(node.children[i]!, depth + 1, node.children[i - 1], node)));
      else
        out.push(
          <button key={`run-${first.id}`} className="dim-run" onClick={() => setOpenRuns((s) => new Set(s).add(first.id))} title="Show these filtered parts">
            <Ellipsis size={14} aria-hidden />
            {run.length} filtered
          </button>,
        );
      run = [];
    };
    node.children.forEach((c, i) => {
      if (props.collapseDim && props.dim.has(c.id) && !keep(c.id)) run.push(i);
      else {
        flush();
        out.push(render(c, depth + 1, i === 0 ? undefined : node.children[i - 1], node));
      }
    });
    flush();
    return out;
  };

  const render = (node: StructureNode, depth: number, prev?: StructureNode, parent?: StructureNode): React.ReactNode => {
    const isRoot = depth === 0;
    const isOpen = open[node.id] ?? isRoot;
    const g = override[node.id] ?? props.granularity;
    const gi = ORDER.indexOf(g);
    const key = `${node.id}.${g}`;
    // a tool step is its call: from Medium up it shows the call rendered (and from High its result),
    // a prose summary of one command would only be worse than the command itself
    const toolStep = node.kind === "step" && (node.meta?.step_kind === "tool" || node.meta?.step_kind === "tool-error");
    const asCall = toolStep && g !== "title";
    const text = g === "full" || asCall ? undefined : node.text?.[g] ?? fetched[key];
    if (isOpen && g !== "full" && !asCall && text === undefined && !pending[key]) void request(node, g);
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
    const cls = ["node", `level-${node.level}`, node.kind, isRoot ? "root" : "", Date.parse(node.span.ts_first) > bornAt.current ? "fresh" : "", isOpen ? "open" : "", props.selected === node.id ? "selected" : "", props.hover === node.id ? "hover" : "", props.dim.has(node.id) ? "dim" : ""].join(" ");
    const hitCount = props.hits.get(node.id);
    const images = imageCount(node, props.events);
    const tokens = node.stats.input_tokens + node.stats.output_tokens;
    const boundary = node.meta?.boundary && node.meta.boundary !== prev?.meta?.boundary ? boundaryText(node, prev) : undefined;
    const showText = asCall || (g !== "full" && !(text !== undefined && sameText(text, node.label)));

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
              {asCall && g !== "full" ? (
                <Events node={node} events={props.events} calls={calls} query={props.query} matches={props.matches} only={g === "abstract" ? "calls" : "bare"} />
              ) : g === "full" ? (
                node.level >= 3 ? <Events node={node} events={props.events} calls={calls} query={props.query} matches={props.matches} /> : <p className="prose muted">The full text is in the steps below.</p>
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
            {children(node, depth)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="zoom" ref={zoomRef}>
      {hitSteps.length > AUTO_MAX && (
        <p className="search-note">
          Opened the first {AUTO_MAX} of {hitSteps.length} matching steps. Narrow the search, or zoom into a part, to open the rest.
        </p>
      )}
      {render(props.root, 0)}
      {props.working && <Working state={props.working.state} since={props.working.lastEvent} />}
    </div>
  );
});

/** The tail of a live session: Claude is at it and more will come in below, or it waits for you (a permission, a question). */
function Working({ state, since }: { state: "working" | "waiting"; since: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.round((Date.now() - Date.parse(since)) / 1000));
  return (
    <div className={`working ${state}`} role="status">
      <span className="dots" aria-hidden>
        <i />
        <i />
        <i />
      </span>
      {state === "working" ? "Claude is working" : "Claude is waiting for you"}
      <span className="num text-ink-3" aria-hidden>
        · last event {s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`} ago
      </span>
    </div>
  );
}

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

/** Any other record: JSON rendered as a document, everything else as it was written. */
function RawText({ text }: { text: string }) {
  const pretty = useMemo(() => prettyJson(text), [text]);
  return pretty ? <JsonView value={JSON.parse(pretty)} source={pretty} /> : <pre>{text}</pre>;
}

const PROSE = new Set(["user.prompt", "assistant.text", "compaction"]);

/** Raw events of a step (L3) in append order: words as prose, tool input and output as code. */
function Events({
  node,
  events,
  calls,
  query,
  matches,
  only,
}: {
  node: StructureNode;
  events?: Map<string, Event>;
  calls: Map<string, Event>;
  query?: string;
  matches?: Set<string>;
  /** "calls": only the tool calls, without headers; "bare": calls and results without headers. */
  only?: "calls" | "bare";
}) {
  if (!events) return <p className="prose muted">Loading events…</p>;
  const ids = node.event_ids ?? [];
  return (
    <div className={`events ${only ? "bare" : ""}`}>
      {ids.map((id) => {
        const e = events.get(id);
        if (!e) return null;
        if (only === "calls" && e.kind !== "tool.call") return null;
        if (only === "bare" && (e.kind !== "tool.call" && e.kind !== "tool.result" || (e.kind === "tool.result" && !e.text.trim()))) return null;
        const k = eventKind(e);
        const text = e.text || (e.data?.hidden ? "Hidden by Claude Code" : "");
        return (
          <div key={id} className={`event ${e.kind.replace(".", "-")} ${matches?.has(id) ? "match" : ""}`} style={kindStyle(k)}>
            {!only && <div className="event-head">
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
            </div>}
            {PROSE.has(e.kind) ? (
              <p className="event-prose">{richText(text, query)}</p>
            ) : e.kind === "tool.call" ? (
              <ToolCallView event={e} />
            ) : e.kind === "tool.result" ? (
              <ToolResultView event={e} call={e.tool?.call_id ? calls.get(e.tool.call_id) : undefined} />
            ) : (
              <RawText text={text} />
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
