import { Monitor, Moon, Sun, BookOpen, BookOpenText, ChevronRight, Columns2, GitCommitHorizontal, ListRestart, Network, Pin, PinOff, Radio, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ATTENTION, ATTENTION_LABEL, fmtDuration, fmtTime, type Attention, type AutoCommit, type Config, type StructureNode } from "./api";
import { KIND } from "./kinds";
import type { Layout } from "./state";
import { Tip } from "./Tip";
import { useTheme, type ThemeChoice } from "./theme";

const THEMES: { c: ThemeChoice; label: string; Icon: typeof Sun }[] = [
  { c: "system", label: "System", Icon: Monitor },
  { c: "light", label: "Light", Icon: Sun },
  { c: "dark", label: "Dark", Icon: Moon },
];

/** Rough cost table per detent: summarization calls per turn, and how far the view lags the session. */
const COST: Record<Attention, { callsPerTurn: number; lag: string }> = {
  micro: { callsPerTurn: 3, lag: "seconds" },
  attentive: { callsPerTurn: 1, lag: "about one turn" },
  balanced: { callsPerTurn: 0.25, lag: "about one phase" },
  yolo: { callsPerTurn: 0, lag: "only on demand" },
};

export interface Crumb {
  id: string;
  label: string;
}

/** Two reels: a recorder for agent sessions. */
function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 22 22" aria-hidden>
      <rect x="0.5" y="2.5" width="21" height="17" rx="4.5" fill="var(--ink)" />
      <circle cx="7" cy="11" r="3.2" fill="none" stroke="var(--paper)" strokeWidth="1.6" />
      <circle cx="15" cy="11" r="3.2" fill="none" stroke="var(--paper)" strokeWidth="1.6" />
      <circle cx="15" cy="11" r="1.1" fill="var(--rec)" />
    </svg>
  );
}

/**
 * One row: where you are (project ▸ session ▸ focus path, mirroring the URL), whether the session
 * is live and followed, which views are shown, and the quieter settings behind one button.
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
  follow: boolean;
  onFollow: (follow: boolean) => void;
  layout: Layout;
  onLayout: (l: Layout) => void;
  live: "connecting" | "live" | "offline";
  config?: Config;
  structure?: StructureNode;
  onAttention: (a: Attention) => void;
  autoCommit?: AutoCommit;
  onAutoCommit: (enabled: boolean) => void;
  onCatchMeUp: () => void;
}) {
  const [theme, setTheme] = useTheme();
  const attention = props.config?.attention ?? "balanced";
  const idx = ATTENTION.indexOf(attention);
  const turns = props.structure ? props.structure.children.reduce((n, p) => n + p.children.length, 0) : 0;
  const durationMs = props.structure ? Date.parse(props.structure.span.ts_last) - Date.parse(props.structure.span.ts_first) : 0;
  const hours = Math.max(durationMs / 3_600_000, 1 / 60);
  const callsPerHour = Math.round((turns * COST[attention].callsPerTurn) / hours);
  const pinned = props.session?.pinned;
  const ac = props.autoCommit;
  const ProjectIcon = KIND.project.icon;
  const SessionIcon = KIND.session.icon;
  const liveLabel = props.live === "live" ? "Live" : props.live === "offline" ? "Engine offline" : "Connecting";

  return (
    <header className="header">
      <span className="brand">
        <BrandMark />
        <span className="brand-name">yolo-twice</span>
      </span>
      <nav className="crumbs" aria-label="Focus">
        <ChevronRight size={14} className="crumb-sep" aria-hidden />
        {pinned ? (
          <Tip label="The session is pinned. Unpin it to browse the whole project.">
            <span className="crumb">
              <ProjectIcon size={15} aria-hidden />
              <span>{props.project}</span>
            </span>
          </Tip>
        ) : (
          <button className={`crumb ${props.session ? "" : "current"}`} onClick={props.onProject} title="All sessions of this project">
            <ProjectIcon size={15} aria-hidden />
            <span>{props.project || "Project"}</span>
          </button>
        )}
        {props.session && (
          <>
            <ChevronRight size={14} className="crumb-sep" aria-hidden />
            <span className="crumb-wrap">
              <button className={`crumb ${props.path.length ? "" : "current"}`} onClick={props.onSessionRoot} title={props.session.id}>
                <SessionIcon size={15} aria-hidden />
                <span>{props.session.label}</span>
              </button>
            </span>
            <Tip label={pinned ? "Pinned: Esc and reset stay inside this session. Click to unpin." : "Go into this session: pin it as the root."}>
              <Button variant="ghost" size="icon-sm" className={`pin ${pinned ? "on" : ""} size-7 text-ink-3`} onClick={() => props.onPin(!pinned)} aria-pressed={pinned} aria-label={pinned ? "Unpin the session" : "Pin the session"}>
                {pinned ? <Pin className="size-3.5" /> : <PinOff className="size-3.5" />}
              </Button>
            </Tip>
          </>
        )}
        {props.path.map((c, i) => (
          <span key={c.id} className="crumb-wrap">
            <ChevronRight size={14} className="crumb-sep" aria-hidden />
            <button className={`crumb ${i === props.path.length - 1 ? "current" : ""}`} onClick={() => props.onCrumb(c.id)} title={c.label}>
              <span>{c.label}</span>
            </button>
          </span>
        ))}
        {props.canReset && (
          <Tip label="Back to the top, and clear the time window. Esc goes up one level.">
            <Button variant="ghost" size="icon-sm" className="reset size-7 text-ink-3" onClick={props.onReset} aria-label="Reset focus">
              <ListRestart className="size-4" />
            </Button>
          </Tip>
        )}
      </nav>

      <Tip label={`Event stream: ${liveLabel.toLowerCase()}`}>
        <span className="flex items-center gap-2 text-[13px] text-ink-2 hide-narrow">
          <span className={`live-dot ${props.live}`} />
          {liveLabel}
        </span>
      </Tip>
      <Tip label={props.follow ? "Following the newest events (f). Scroll up or click anything to stop." : "Follow the newest events as they arrive, like tail -f (f or End)."}>
        <Button variant="outline" size="sm" className={`follow ${props.follow ? "on" : ""}`} onClick={() => props.onFollow(!props.follow)} aria-pressed={props.follow}>
          <Radio />
          {props.follow ? "Following" : "Follow"}
        </Button>
      </Tip>

      <ToggleGroup type="single" variant="outline" size="sm" value={props.layout} onValueChange={(v) => v && props.onLayout(v as Layout)} aria-label="Views" className="hide-narrow">
        <ToggleGroupItem value="read" aria-label="Text only" title="Text only">
          <BookOpen />
          <span className="hidden xl:inline">Read</span>
        </ToggleGroupItem>
        <ToggleGroupItem value="split" aria-label="Text and graph" title="Text and graph side by side">
          <Columns2 />
          <span className="hidden xl:inline">Split</span>
        </ToggleGroupItem>
        <ToggleGroupItem value="map" aria-label="Graph only" title="Graph only">
          <Network />
          <span className="hidden xl:inline">Map</span>
        </ToggleGroupItem>
      </ToggleGroup>

      <Popover>
        <Tip label="Appearance, summaries and auto-commit">
          <PopoverTrigger asChild>
            <Button variant="outline" size="icon-sm" aria-label="Settings" className="relative">
              <SlidersHorizontal />
              {ac?.enabled && <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-rec" />}
            </Button>
          </PopoverTrigger>
        </Tip>
        <PopoverContent align="end" className="w-80">
          <div className="space-y-3">
            <div className="space-y-2 border-b pb-3">
              <span className="block text-[13px] font-semibold">Appearance</span>
              <div className="seg fill" role="radiogroup" aria-label="Appearance">
                {THEMES.map(({ c, label, Icon }) => (
                  <button key={c} className={`inline-flex items-center justify-center gap-1.5 ${theme === c ? "on" : ""}`} onClick={() => setTheme(c)} role="radio" aria-checked={theme === c}>
                    <Icon className="size-3.5" aria-hidden />
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] font-semibold">Attention</span>
                <span className="text-[13px] text-ink-2">{ATTENTION_LABEL[attention]}</span>
              </div>
              <p className="mt-1 text-[12.5px] leading-snug text-ink-2">How eagerly Claude summarizes this session. More attention costs more calls.</p>
            </div>
            <Slider min={0} max={3} step={1} value={[idx < 0 ? 2 : idx]} onValueChange={([v]) => props.onAttention(ATTENTION[v ?? 2]!)} aria-label="Attention" />
            <div className="flex justify-between text-[12px] text-ink-3">
              <span>Micro management</span>
              <span>Yolo</span>
            </div>
            <p className="text-[12.5px] text-ink-2 num">
              About {callsPerHour} calls an hour, summaries lag {COST[attention].lag}
              {durationMs > 0 ? `. This session ran ${fmtDuration(durationMs)}.` : "."}
            </p>
            {ac && (
              <div className="border-t pt-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-[13px] font-semibold">
                    <GitCommitHorizontal className="size-4" />
                    Auto-commit
                  </span>
                  <Button variant={ac.enabled ? "default" : "outline"} size="xs" className={`autocommit ${ac.enabled ? "on" : ""}`} onClick={() => props.onAutoCommit(!ac.enabled)} aria-pressed={ac.enabled}>
                    {ac.enabled ? "On" : "Off"}
                  </Button>
                </div>
                <p className="mt-1 text-[12.5px] leading-snug text-ink-2">
                  {ac.enabled
                    ? [
                        `Commits only .yolo-twice every ${Math.round(ac.intervalMs / 60_000)} minutes while it changes.`,
                        ac.lastCommit ? `Last commit ${ac.lastCommit.sha} at ${fmtTime(ac.lastCommit.ts)}.` : "No commit yet.",
                        ac.next ? `Next check ${new Date(ac.next).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.` : "",
                        ac.skipped ? `Last check skipped: ${ac.skipped}.` : "",
                      ]
                        .filter(Boolean)
                        .join(" ")
                    : "Commit the .yolo-twice folder now and every 10 minutes, so it stops cluttering git status. Your staged work is left alone. Stays on until the engine restarts."}
                </p>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>

      <Button size="sm" onClick={props.onCatchMeUp} disabled={!props.session}>
        <BookOpenText />
        <span className="hide-narrow">Catch me up</span>
      </Button>
    </header>
  );
}
