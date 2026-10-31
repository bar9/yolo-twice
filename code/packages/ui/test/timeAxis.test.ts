import { describe, expect, test } from "bun:test";
import { crossesDay, timeMarks } from "../src/timeAxis";

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

describe("time marks on the tape", () => {
  test("a 13-hour session gets round marks, at most 8", () => {
    const m = timeMarks(at(2026, 10, 31, 9, 19), at(2026, 10, 31, 22, 30));
    expect(m.length).toBeLessThanOrEqual(8);
    expect(m.map((x) => new Date(x.t).getHours())).toEqual([10, 12, 14, 16, 18, 20, 22]);
    expect(m.some((x) => x.day)).toBe(false);
  });

  test("a session past midnight marks the day border", () => {
    const m = timeMarks(at(2026, 10, 31, 9, 19), at(2026, 11, 1, 2, 0));
    const day = m.filter((x) => x.day);
    expect(day.map((x) => x.t)).toEqual([at(2026, 11, 1)]);
    expect(crossesDay(at(2026, 10, 31, 9), at(2026, 11, 1, 2))).toBe(true);
    expect(crossesDay(at(2026, 10, 31, 9), at(2026, 10, 31, 23))).toBe(false);
  });

  test("weeks of sessions: whole days, every mark a day border", () => {
    const m = timeMarks(at(2026, 10, 1, 10), at(2026, 10, 6, 10));
    expect(m.every((x) => x.day)).toBe(true);
    expect(m.map((x) => new Date(x.t).getDate())).toEqual([2, 3, 4, 5, 6]);
  });

  test("a short burst gets minutes", () => {
    const m = timeMarks(at(2026, 10, 31, 17, 13), at(2026, 10, 31, 17, 21));
    expect(m.map((x) => new Date(x.t).getMinutes())).toEqual([14, 15, 16, 17, 18, 19, 20]);
  });
});
