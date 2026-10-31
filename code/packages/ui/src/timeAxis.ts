/** Time marks for a tape: a round step that gives at most `max` marks, and which of them are midnights. */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
// every step below a day divides a day, so the midnights are always among the marks
const STEPS = [MIN, 2 * MIN, 5 * MIN, 10 * MIN, 15 * MIN, 30 * MIN, HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY];

export interface Mark {
  t: number;
  /** A day border (local midnight). */
  day: boolean;
}

export function timeMarks(start: number, end: number, max = 8): Mark[] {
  if (!(end > start)) return [];
  const step = STEPS.find((s) => (end - start) / s <= max) ?? 7 * DAY;
  const midnight = new Date(start);
  midnight.setHours(0, 0, 0, 0);
  const out: Mark[] = [];
  if (step >= DAY) {
    // whole days: walk the calendar, so a daylight-saving day still lands on midnight
    const d = new Date(midnight);
    const days = step / DAY;
    while (d.getTime() <= start) d.setDate(d.getDate() + 1);
    for (; d.getTime() < end; d.setDate(d.getDate() + days)) out.push({ t: d.getTime(), day: true });
    return out;
  }
  for (let t = midnight.getTime() + Math.ceil((start - midnight.getTime()) / step) * step; t < end; t += step) {
    if (t <= start) continue;
    const d = new Date(t);
    out.push({ t, day: d.getHours() === 0 && d.getMinutes() === 0 });
  }
  return out;
}

/** Whether a span crosses midnight: then times need their day. */
export function crossesDay(start: number, end: number): boolean {
  return new Date(start).toDateString() !== new Date(end).toDateString();
}

export const clock = (t: number, seconds = false) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}) });
export const dayLabel = (t: number) => new Date(t).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
export const weekday = (t: number) => new Date(t).toLocaleDateString([], { weekday: "short" });
