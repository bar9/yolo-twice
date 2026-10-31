import { useEffect, useMemo } from "react";
import { EVENTS, Joyride, STATUS, type Step, type TooltipRenderProps } from "react-joyride";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { markSeen } from "./TourInvite";

/**
 * The guided tour: one stop per part of the screen, in the order you meet them. Stops whose target
 * is not on screen (the map in the Read view, the detail switch on the project page) are left out.
 */
export const STOPS: (Step & { target: string })[] = [
  {
    target: "body",
    placement: "center",
    title: "Welcome to yolo-twice",
    content: "A Claude Code session, readable at any level of detail. This tour shows the screen stop by stop; Esc ends it any time.",
  },
  { target: "[data-tour=crumbs]", title: "Where you are", content: "The project, the session, and the part you zoomed into. Click a step of the path, or press ←, to step back out." },
  {
    target: "[data-tour=timeline]",
    title: "The timeline",
    content: "Every turn as a block; the bars below show how busy Claude was. Click a block to jump to it, or drag across to keep only a time window.",
  },
  {
    target: "[data-tour=filters]",
    title: "Search and filter",
    content: "Type to search. The chips keep only your prompts, Claude's answers, tools, errors and more. Parts without matches fold away.",
  },
  { target: "[data-tour=detail]", title: "Detail", content: "From Low, one line per part, to Raw, every event. − and + do the same; the lens on a single part changes only that part." },
  { target: "[data-tour=reader]", placement: "auto", title: "The story", content: "Click a part to open it, its focus button to zoom into it. The Results tab lists every match of a search." },
  { target: "[data-tour=map]", placement: "auto", title: "The map", content: "The same parts as boxes and arrows. Point at one and it lights up in the text and on the timeline; click it to zoom in." },
  { target: "[data-tour=views]", title: "Read, Split or Map", content: "Show the text, the map, or both side by side." },
  { target: "[data-tour=follow]", title: "Watch it live", content: "While Claude works, Follow keeps the newest step in view. Scroll up to read in peace; Follow picks up again at the bottom." },
  { target: "[data-tour=catch]", title: "Catch me up", content: "A short account of what happened since you last looked." },
  { target: "[data-tour=help]", title: "Help is here", content: "The guide, this tour, every keyboard shortcut (press ?) and how to reach the team." },
];

const visible = (selector: string) => {
  const el = document.querySelector(selector);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

function TourTip({ step, index, size, isLastStep, backProps, primaryProps, skipProps, tooltipProps, controls }: TooltipRenderProps) {
  // the tour has the keyboard while it runs: → Enter next, ← back, Esc ends it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const act = { Escape: () => controls.skip("button_close"), ArrowRight: () => controls.next(), Enter: () => controls.next(), ArrowLeft: () => index > 0 && controls.prev() }[e.key];
      if (!act) return;
      e.preventDefault();
      e.stopPropagation();
      act();
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [controls, index]);
  return (
    <div {...tooltipProps} className="tour-tip">
      <header>
        <span className="tour-count num">
          {index + 1} of {size}
        </span>
        <button {...skipProps} className="tour-skip" aria-label="End the tour" title="End the tour (Esc)">
          <X className="size-4" />
        </button>
      </header>
      {step.title && <h3>{step.title}</h3>}
      <div className="tour-body">{step.content}</div>
      <footer>
        {index > 0 && (
          <Button variant="ghost" size="sm" {...backProps}>
            Back
          </Button>
        )}
        <Button size="sm" className="cta" {...primaryProps}>
          {isLastStep ? "Done" : "Next"}
        </Button>
      </footer>
    </div>
  );
}

/** Loaded on demand (App lazy-imports it), so react-joyride is only fetched when a tour starts. */
export default function Tour({ run, onEnd }: { run: boolean; onEnd: () => void }) {
  // the stops are picked when the tour starts, from what is on screen then
  const steps = useMemo(() => (run ? STOPS.filter((s) => s.target === "body" || visible(s.target)) : []), [run]);
  if (!run) return null;
  return (
    <Joyride
      run
      continuous
      steps={steps}
      tooltipComponent={TourTip}
      options={{
        skipBeacon: true,
        showProgress: true,
        overlayClickAction: false,
        dismissKeyAction: false,
        closeButtonAction: "skip",
        blockTargetInteraction: true,
        overlayColor: "rgb(7 10 42 / 0.55)",
        spotlightRadius: 10,
        spotlightPadding: 6,
        scrollDuration: 250,
        arrowColor: "var(--sheet)",
        backgroundColor: "var(--sheet)",
        textColor: "var(--ink)",
        primaryColor: "#fd5f02",
        zIndex: 100,
      }}
      onEvent={(data) => {
        if (data.type === EVENTS.TOUR_END || data.status === STATUS.FINISHED || data.status === STATUS.SKIPPED) {
          markSeen();
          onEnd();
        }
      }}
    />
  );
}
