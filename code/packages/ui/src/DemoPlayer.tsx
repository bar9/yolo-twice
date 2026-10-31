import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, X } from "lucide-react";
import { api } from "./api";
import { clampStep, parseDemo, stepView, trustedOrigin, type Command, type Demo, type Target } from "./demo";
import { bindingFor, type KeyActions } from "./keys";
import type { SetView } from "./state";

/** What the player needs from the app: the view, the keymap's actions, and the state a URL does not hold. */
export interface DemoHost {
  project: string;
  setView: SetView;
  keys: KeyActions;
  /** Back to a plain screen: close dialogs, close opened parts, clear hover, scroll to the top. */
  settle(): void;
  hover(id: string | undefined): void;
  open(id: string, open: boolean): void;
  reveal(event: string): void;
  tab(t: "story" | "results"): void;
  revealMap(id: string): void;
}

export type DemoState = ReturnType<typeof useDemo>;

/** A script in play: its name, and what it came from (a name, or the JSON a deck sent), to tell a new one apart. */
type Loaded = { name: string; source: string; script: Demo };

const framed = typeof window !== "undefined" && window.parent !== window;
const asked = new URLSearchParams(location.search);
// presenting: no timer; the clicker and ← → step like slides; past the last step it hands back to the deck at `back`
const presenting = asked.has("present");
const back = (() => {
  const b = asked.get("back");
  try {
    return b && trustedOrigin(new URL(b).origin) ? b : undefined;
  } catch {
    return undefined;
  }
})();
const SAVED = "yt.demo";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** The pace inside a step, slow enough to talk over: the views settle first, then one action every GAP ms. */
const SETTLE = 900;
const GAP = 900;

/** The step survives the reloads the UI does by itself (a rebuilt UI, a restarted engine). */
function remembered(): { name: string; step: number } | undefined {
  try {
    return JSON.parse(sessionStorage.getItem(SAVED) ?? "null") ?? undefined;
  } catch {
    return undefined;
  }
}
function remember(v: { name: string; step: number } | undefined): void {
  try {
    if (v) sessionStorage.setItem(SAVED, JSON.stringify(v));
    else sessionStorage.removeItem(SAVED);
  } catch {
    /* not kept */
  }
}

/** The element a part is drawn as: its row in the text, its box on the map, its block on the timeline. */
export function targetOf(id: string, on?: Target): Element | null {
  const esc = CSS.escape(id);
  const text = () => document.querySelector(`#node-${esc} > .row`) ?? document.getElementById(`node-${id}`);
  const map = () => document.querySelector(`.react-flow__node[data-id="${esc}"]`);
  const timeline = () => document.querySelector(`.tl-bar[data-id="${esc}"]`);
  return on === "map" ? map() : on === "timeline" ? timeline() : (text() ?? map() ?? timeline());
}

function inView(el: Element): boolean {
  const r = el.getBoundingClientRect();
  const box = el.closest(".pane-body")?.getBoundingClientRect() ?? { top: 0, bottom: innerHeight };
  return r.top >= box.top && r.bottom <= box.bottom;
}

/**
 * Plays a demo (demo.ts): from ?demo=<name>, or stepped by the page that embeds the UI.
 * Each step applies its whole view, then runs its commands; a newer step stops an older one's.
 */
export function useDemo(host: DemoHost) {
  const h = useRef(host);
  h.current = host;
  const [demo, setDemo] = useState<Loaded | undefined>();
  const [step, setStep] = useState(0);
  const [point, setPoint] = useState<{ id: string; on?: Target } | undefined>();
  const [error, setError] = useState<string | undefined>();
  // steps with a wait go on by themselves until the presenter steps by hand; inside a deck, the deck steps
  const [playing, setPlaying] = useState(!framed && !presenting);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const current = useRef({ demo, step });
  current.current = { demo, step };
  const token = useRef(0);

  const perform = async (cmds: Command[], alive: () => boolean) => {
    await sleep(SETTLE); // the views catch up first: data, layout, the selection's own scroll
    for (const c of cmds) {
      if (!alive()) return false;
      if ("wait" in c) await sleep(c.wait);
      else if ("point" in c) {
        if (c.point === null) {
          setPoint(undefined);
          h.current.hover(undefined);
        } else {
          const id = c.point;
          // the map shows the same part, in Split as well as in Map
          if (c.on !== "timeline") h.current.revealMap(id);
          let el: Element | null = null;
          for (let i = 0; i < 20 && !(el = targetOf(id, c.on)); i++) await sleep(100);
          if (el && c.on !== "map" && !inView(el)) {
            el.scrollIntoView({ block: "center", behavior: "smooth" });
            await sleep(450);
          }
          setPoint({ id, on: c.on });
          h.current.hover(id);
        }
      } else if ("open" in c) h.current.open(c.open, true);
      else if ("close" in c) h.current.open(c.close, false);
      else if ("reveal" in c) h.current.reveal(c.reveal);
      else if ("type" in c) {
        for (let i = 1; i <= c.type.length && alive(); i++) {
          h.current.setView({ q: c.type.slice(0, i) });
          await sleep(c.ms ?? 160);
        }
      } else if ("key" in c) bindingFor(c.key)?.run(h.current.keys, c.key);
      else if ("tab" in c) h.current.tab(c.tab);
      await sleep(GAP);
    }
    return alive();
  };

  const go = useCallback((n: number, loaded?: Loaded) => {
    const d = loaded ?? current.current.demo;
    if (!d) return;
    const i = clampStep(n, d.script.steps.length);
    const s = d.script.steps[i]!;
    const mine = ++token.current;
    const alive = () => token.current === mine;
    setStep(i);
    setPoint(undefined);
    remember({ name: d.name, step: i });
    h.current.settle();
    h.current.setView(() => stepView(s.view, h.current.project), { push: false });
    if (framed) parent.postMessage({ yt: "step", step: i, steps: d.script.steps.length, caption: s.caption }, "*");
    void perform(s.do ?? [], alive).then(async (ok) => {
      const last = i === d.script.steps.length - 1;
      if (!ok || !s.wait || (last && !d.script.loop)) return;
      await sleep(s.wait);
      if (alive() && playingRef.current) go(last ? 0 : i + 1, d);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Plays the project's script `name`, or a script the embedding page sent along (a deck keeps its own). */
  const start = useCallback(
    async (name: string, at: number, inline?: unknown) => {
      try {
        let d = current.current.demo;
        const source = inline === undefined ? name : JSON.stringify(inline);
        if (d?.source !== source) {
          d = { name, source, script: parseDemo(inline === undefined ? await api.demo(name) : inline) };
          setDemo(d);
          setError(undefined);
        }
        go(at, d);
      } catch (e) {
        setError(`The demo "${name}" did not load: ${String(e)}`);
      }
    },
    [go],
  );

  /** The presenter steps by hand (arrows, clicker): from then on the timer waits for them. */
  const stepTo = useCallback(
    (n: number) => {
      setPlaying(false);
      go(n);
    },
    [go],
  );
  /** One step on; past the last one, back to the deck that handed over (if any). */
  const forward = useCallback(() => {
    const { demo: d, step: at } = current.current;
    if (back && d && at >= d.script.steps.length - 1) location.href = back;
    else stepTo(at + 1);
  }, [stepTo]);
  /** Play on from the next step, or from the start after the last one. */
  const play = useCallback(() => {
    const { demo: d, step: at } = current.current;
    if (!d) return;
    setPlaying(true);
    playingRef.current = true;
    go(at >= d.script.steps.length - 1 ? 0 : at + 1);
  }, [go]);
  const pause = useCallback(() => setPlaying(false), []);

  const stop = useCallback(() => {
    token.current++;
    setDemo(undefined);
    setPoint(undefined);
    h.current.hover(undefined);
    remember(undefined);
  }, []);

  // ?demo=<name>[&step=n] starts over; without it, a reload (the UI reloads itself after a rebuild) resumes
  // the demo this tab was playing, paused on its step. Once the project is known.
  const begun = useRef(false);
  useEffect(() => {
    if (begun.current || !host.project || framed) return;
    begun.current = true;
    const name = asked.get("demo");
    const kept = remembered();
    if (name) void start(name, Number(asked.get("step") ?? 1) - 1);
    else if (kept) {
      setPlaying(false);
      playingRef.current = false;
      void start(kept.name, kept.step);
    }
  }, [host.project, start]);

  // the embedding page steps the demo; it hears when the UI is ready and when a step was shown
  useEffect(() => {
    if (!framed) return;
    const onMessage = (e: MessageEvent) => {
      const m = e.data as { yt?: string; name?: string; script?: unknown; step?: number } | null;
      if (m?.yt !== "demo" || (typeof m.name !== "string" && m.script === undefined) || !trustedOrigin(e.origin)) return;
      void start(m.name ?? "from the deck", m.step ?? 0, m.script);
    };
    addEventListener("message", onMessage);
    parent.postMessage({ yt: "ready" }, "*");
    return () => removeEventListener("message", onMessage);
  }, [start]);

  // a presenter's clicker sends PageDown / PageUp; inside a deck, the deck decides what comes next
  useEffect(() => {
    if (!demo) return;
    const onKey = (e: KeyboardEvent) => {
      const next = e.key === "PageDown" || (presenting && e.key === "ArrowRight");
      const prev = e.key === "PageUp" || (presenting && e.key === "ArrowLeft");
      const dir = next ? 1 : prev ? -1 : 0;
      if (!dir || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
      if (framed) parent.postMessage({ yt: "nav", dir }, "*");
      else if (dir > 0) forward();
      else stepTo(current.current.step - 1);
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [demo, stepTo, forward]);

  const steps = demo?.script.steps ?? [];
  return { active: !!demo, framed, presenting, title: demo?.script.title, step, steps: steps.length, caption: steps[step]?.caption, timed: steps.some((s) => s.wait), playing, point, error, stepTo, forward, handsBack: !!back, play, pause, stop };
}

/** The presenter's strip: where you are in the demo, the caption, and the way through it. Hidden inside a deck. */
export function DemoBar({ demo }: { demo: DemoState }) {
  if (demo.framed || (!demo.active && !demo.error)) return null;
  if (!demo.active)
    return (
      <div className="demo-bar" role="alert">
        <p className="demo-caption">{demo.error}</p>
        <button className="demo-btn" onClick={demo.stop} aria-label="Dismiss">
          <X size={16} />
        </button>
      </div>
    );
  return (
    <div className="demo-bar" role="toolbar" aria-label="Demo">
      <span className="demo-title">{demo.title ?? "Demo"}</span>
      <button className="demo-btn" onClick={() => demo.stepTo(demo.step - 1)} disabled={demo.step === 0} aria-label="Previous step" title={demo.presenting ? "Previous step (← or Page Up)" : "Previous step (Page Up)"}>
        <ChevronLeft size={16} />
      </button>
      <span className="num demo-count">
        {demo.step + 1} / {demo.steps}
      </span>
      <button className="demo-btn" onClick={demo.forward} disabled={demo.step === demo.steps - 1 && !demo.handsBack} aria-label="Next step" title={demo.presenting ? "Next step (→ or Page Down)" : "Next step (Page Down)"}>
        <ChevronRight size={16} />
      </button>
      {demo.step === demo.steps - 1 ? (
        <button className="demo-btn" onClick={demo.play} aria-label="Play again" title="Play again from the start">
          <RotateCcw size={15} />
        </button>
      ) : demo.timed && !demo.presenting ? (
        <button className="demo-btn" onClick={demo.playing ? demo.pause : demo.play} aria-label={demo.playing ? "Pause" : "Play"} title={demo.playing ? "Pause: step by hand (Page Down)" : "Play on by itself"}>
          {demo.playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
      ) : null}
      {demo.caption && <p className="demo-caption">{demo.caption}</p>}
      <button className="demo-btn" onClick={demo.stop} aria-label="End the demo" title="End the demo">
        <X size={16} />
      </button>
    </div>
  );
}

/**
 * A pointer the audience can follow: it glides to the part a step points at and stays on it while
 * the views scroll. Under reduced motion it appears in place instead of gliding.
 */
export function DemoPointer({ at }: { at?: { id: string; on?: Target } }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dot = ref.current;
    if (!dot) return;
    const hide = () => {
      dot.classList.remove("on");
      delete dot.dataset.placed;
    };
    if (!at) return hide();
    let frame = 0;
    const tick = () => {
      const el = targetOf(at.id, at.on);
      if (el) {
        const r = el.getBoundingClientRect();
        const row = el.classList.contains("row");
        const x = row ? r.left + 22 : r.left + r.width / 2;
        const y = r.top + (row ? Math.min(r.height / 2, 18) : r.height / 2);
        dot.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
        // placed while hidden, shown a frame later: the first appearance does not glide in from a corner
        if (dot.dataset.placed) dot.classList.add("on");
        dot.dataset.placed = "1";
      } else hide();
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [at]);
  return <div ref={ref} className="demo-pointer" aria-hidden />;
}
