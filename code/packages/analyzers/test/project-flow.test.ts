import { describe, expect, test } from "bun:test";
import { projectFlow } from "../src/graph.js";

describe("project flow", () => {
  test("sessions stack in time order without drawn arrows; a fork hangs off its original", () => {
    const flow = projectFlow([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "f", label: "B (resumed via yolo-twice)", forked_from: "b" },
      { id: "c", label: "C" },
      { id: "x", label: "orphan fork", forked_from: "gone" },
    ]);
    expect(flow.nodes.map((n) => n.id)).toEqual(["s:a", "s:b", "s:f", "s:c", "s:x"]);
    expect(flow.edges.map((e) => [e.source, e.target, e.kind])).toEqual([
      ["s:a", "s:b", "order"],
      ["s:b", "s:f", "fork"],
      ["s:b", "s:c", "order"],
      ["s:c", "s:x", "order"],
    ]);
  });
});
