import { ATTENTION, ATTENTION_LABEL, fmtDuration, type Attention, type Config, type StructureNode } from "./api";

/** Rough cost table per detent: summarization calls per turn, and how far the view lags the session. */
const COST: Record<Attention, { callsPerTurn: number; lag: string }> = {
  micro: { callsPerTurn: 3, lag: "≈ seconds" },
  attentive: { callsPerTurn: 1, lag: "≈ one turn" },
  balanced: { callsPerTurn: 0.25, lag: "≈ one phase" },
  yolo: { callsPerTurn: 0, lag: "on demand" },
};

export interface Crumb {
  id: string;
  label: string;
}

/**
 * Brand, breadcrumb (project ▸ session ▸ focus path), session pin, reset, live state,
 * attention slider and "catch me up". The breadcrumb mirrors the URL path.
 */
export function Header(props: {
  project: string;
  session?: { id: string; label: string; pinned: boolean };
  path: Crumb[]; // focus path inside the session, excluding the session itself
  canReset: boolean;
  onProject: () => void;
  onSessionRoot: () => void;
  onCrumb: (id: string) => void;
  onPin: (pinned: boolean) => void;
  onReset: () => void;
  live: "connecting" | "live" | "offline";
  config?: Config;
  structure?: StructureNode;
  onAttention: (a: Attention) => void;
  onCatchMeUp: () => void;
}) {
  const attention = props.config?.attention ?? "balanced";
  const idx = ATTENTION.indexOf(attention);
  const turns = props.structure ? props.structure.children.reduce((n, p) => n + p.children.length, 0) : 0;
  const durationMs = props.structure ? Date.parse(props.structure.span.ts_last) - Date.parse(props.structure.span.ts_first) : 0;
  const hours = Math.max(durationMs / 3_600_000, 1 / 60);
  const callsPerHour = Math.round((turns * COST[attention].callsPerTurn) / hours);
  const pinned = props.session?.pinned;

  return (
    <header className="header">
      <span className="brand">yolo-twice</span>
      <nav className="crumbs" aria-label="focus">
        {pinned ? (
          <span className="crumb muted" title="the session is pinned; unpin to browse the project">
            {props.project}
          </span>
        ) : (
          <button className="crumb" onClick={props.onProject} title="project: all sessions">
            {props.project || "project"}
          </button>
        )}
        {props.session && (
          <>
            <span className="sep">▸</span>
            <button className="crumb" onClick={props.onSessionRoot} title={props.session.id}>
              {props.session.label}
            </button>
            <button className={`pin ${pinned ? "on" : ""}`} onClick={() => props.onPin(!pinned)} title={pinned ? "pinned: Esc and reset stay inside this session. Click to unpin" : "go into this session: pin it as the root"} aria-pressed={pinned}>
              {pinned ? "📌" : "go into"}
            </button>
          </>
        )}
        {props.path.map((c) => (
          <span key={c.id} className="crumb-wrap">
            <span className="sep">▸</span>
            <button className="crumb" onClick={() => props.onCrumb(c.id)} title={c.label}>
              {c.label.length > 28 ? c.label.slice(0, 27) + "…" : c.label}
            </button>
          </span>
        ))}
        {props.canReset && (
          <button className="reset" onClick={props.onReset} title="reset focus and window to the root (Esc goes up one level)">
            ⤒ reset
          </button>
        )}
      </nav>
      <span className={`live ${props.live}`} title={`stream: ${props.live}`}>
        ● {props.live}
      </span>
      <span className="spacer" />
      <label className="slider">
        <span className="slider-label">micro management</span>
        <input type="range" min={0} max={3} step={1} value={idx < 0 ? 2 : idx} onChange={(e) => props.onAttention(ATTENTION[Number(e.target.value)]!)} aria-label="attention" />
        <span className="slider-label">yolo</span>
      </label>
      <span className="readout" title="estimated summarization calls per hour at this detent, and how far the view lags the live session">
        <strong>{ATTENTION_LABEL[attention]}</strong> · ≈ {callsPerHour} calls/h · lag {COST[attention].lag}
        {durationMs > 0 && <span className="muted"> · {fmtDuration(durationMs)}</span>}
      </span>
      <button className="primary" onClick={props.onCatchMeUp} disabled={!props.session}>
        Catch me up
      </button>
    </header>
  );
}
