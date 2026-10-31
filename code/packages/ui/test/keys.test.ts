import { describe, expect, test } from "bun:test";
import { BINDINGS, bindingFor, GROUPS, keyName } from "../src/keys";
import { matchOrder, stepIn } from "../src/nav";

const ev = (key: string, mods: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({ key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...mods });

describe("keymap", () => {
  test("every key is bound once, every binding is labelled and grouped", () => {
    const keys = BINDINGS.flatMap((b) => b.keys);
    expect(new Set(keys).size).toBe(keys.length);
    for (const b of BINDINGS) {
      expect(b.label.length).toBeGreaterThan(3);
      expect(GROUPS).toContain(b.group);
      expect(b.show.length).toBeGreaterThan(0);
    }
  });

  test("key names: letters with Shift, symbols as typed, browser combinations ignored", () => {
    expect(keyName(ev("n"))).toBe("n");
    expect(keyName(ev("N", { shiftKey: true }))).toBe("Shift+n");
    expect(keyName(ev("?", { shiftKey: true }))).toBe("?");
    expect(keyName(ev("+", { shiftKey: true }))).toBe("+");
    expect(keyName(ev(" "))).toBe("Space");
    expect(keyName(ev("ArrowLeft", { shiftKey: true }))).toBe("Shift+ArrowLeft");
    expect(keyName(ev("f", { ctrlKey: true }))).toBeUndefined();
    expect(keyName(ev("c", { metaKey: true }))).toBeUndefined();
    expect(bindingFor("5")?.id).toBe("kinds");
    expect(bindingFor("Escape")?.id).toBe("out");
  });
});

describe("selection order", () => {
  const order = ["t1", "t1.s1", "t1.s2", "t2", "t3"];
  test("steps and stops at the ends", () => {
    expect(stepIn(order, undefined, 1)).toBe("t1");
    expect(stepIn(order, undefined, -1)).toBe("t3");
    expect(stepIn(order, "t1.s2", 1)).toBe("t2");
    expect(stepIn(order, "t3", 1)).toBe("t3");
    expect(stepIn(order, "t1", -1)).toBe("t1");
    expect(stepIn([], "t1", 1)).toBeUndefined();
  });

  test("a hidden selection moves from its listed ancestor", () => {
    expect(stepIn(["t1", "t2", "t3"], "t2.s4", 1)).toBe("t3");
    expect(stepIn(["t1", "t2", "t3"], "t2.s4", -1)).toBe("t2");
    expect(stepIn(["t1", "t2"], "p9", 1)).toBe("t1");
  });

  test("matches step through their parts in event order, each once", () => {
    const owner = new Map([
      ["e1", "t1.s1"],
      ["e2", "t1.s1"],
      ["e3", "t2.s3"],
    ]);
    expect(matchOrder(["e1", "e2", "e3", "e9"], owner)).toEqual(["t1.s1", "t2.s3"]);
  });
});
