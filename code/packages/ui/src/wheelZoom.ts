import { useEffect, useRef, type RefObject } from "react";

/**
 * Ctrl (or ⌘) + wheel zooms through the levels, like → and ←: up goes into a part, down widens.
 * It replaces the browser's page zoom over the reader and the timeline (the map keeps its own
 * pixel zoom). One step per gesture: a flick or a trackpad pinch sends many small events, so they
 * add up to a step and the next step waits until the gesture has settled.
 */
export function useCtrlWheel(ref: RefObject<HTMLElement | SVGSVGElement | null>, step: (dir: 1 | -1, target: Element | null) => void, deps: unknown[] = []): void {
  const fn = useRef(step);
  fn.current = step;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let sum = 0;
    let quietUntil = 0;
    let reset: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault(); // no page zoom here
      clearTimeout(reset);
      reset = setTimeout(() => (sum = 0), 250);
      const now = performance.now();
      if (now < quietUntil) return void (quietUntil = now + 250); // still the same gesture
      sum += e.deltaY;
      if (Math.abs(sum) < 40) return;
      fn.current(sum < 0 ? 1 : -1, e.target as Element | null);
      sum = 0;
      quietUntil = now + 300;
    };
    el.addEventListener("wheel", onWheel as EventListener, { passive: false });
    return () => (el.removeEventListener("wheel", onWheel as EventListener), clearTimeout(reset));
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}
