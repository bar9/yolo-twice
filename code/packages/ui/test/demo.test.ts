import { describe, expect, test } from "bun:test";
import { clampStep, parseDemo, stepView, trustedOrigin } from "../src/demo";
import { bindingFor } from "../src/keys";
import { toUrl } from "../src/state";

describe("demo scripts", () => {
  test("a step's view is the whole view: what its URL leaves out is reset", () => {
    const v = stepView("~34b27c/p3?z=t&v=m", "yolo-twice");
    expect(v).toMatchObject({ project: "yolo-twice", session: "34b27c", pinned: false, focus: "p3", z: "title", layout: "map", q: "", k: [], follow: false });
    // the keys exist, set to undefined, so they replace a selection or window from the step before
    expect("sel" in v && v.sel === undefined && "window" in v && v.window === undefined).toBe(true);
    expect(toUrl(v)).toBe("/yolo-twice/~34b27c/p3?z=t&v=m");
  });

  test("relative views use the current project, absolute ones name their own", () => {
    expect(stepView("?q=docker", "yolo-twice")).toMatchObject({ project: "yolo-twice", q: "docker" });
    expect(stepView("/other/abc123", "yolo-twice")).toMatchObject({ project: "other", session: "abc123", pinned: true });
    expect(stepView("x", "my project").project).toBe("my project");
  });

  test("bad scripts are refused with the step that is wrong", () => {
    expect(() => parseDemo(null)).toThrow(/steps/);
    expect(() => parseDemo({ steps: [] })).toThrow(/steps/);
    expect(() => parseDemo({ steps: [{ view: "?v=m" }, { do: [] }] })).toThrow(/step 2 needs a view/);
    expect(() => parseDemo({ steps: [{ view: "", do: [{ click: "#x" }] }] })).toThrow(/step 1: unknown command/);
    const d = parseDemo({ title: "Pitch", steps: [{ view: "", do: [{ point: "t1" }, { type: "tilde", ms: 200 }, { key: "n" }, { wait: 300 }] }] });
    expect(d.steps).toHaveLength(1);
    expect(d.title).toBe("Pitch");
  });

  test("keys in scripts are named as the keymap names them", () => {
    for (const k of ["n", "Shift+n", "c", "3", "ArrowDown", "v", "+"]) expect(bindingFor(k)).toBeDefined();
  });

  test("stepping stops at the ends", () => {
    expect(clampStep(-1, 4)).toBe(0);
    expect(clampStep(9, 4)).toBe(3);
    expect(clampStep(2, 4)).toBe(2);
  });

  test("only the deck on this machine or the published site may step an embedded UI", () => {
    expect(trustedOrigin("http://localhost:3030")).toBe(true);
    expect(trustedOrigin("http://127.0.0.1:3030")).toBe(true);
    expect(trustedOrigin("https://bar9.github.io")).toBe(true);
    expect(trustedOrigin("https://evil.example")).toBe(false);
    expect(trustedOrigin("null")).toBe(false);
  });
});
