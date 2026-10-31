import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { render } from "pele";
import { ingestProject, Store, type StructureNode } from "@yolo-twice/core";
import { buildStructure, deriveProject, deriveSession, findNode, planJobs, SearchIndex, summarizeNode, TextCache, toMermaid, walk, type Summarizer } from "../src/index.js";
import { FIXTURE_AGENT, FIXTURE_CWD, FIXTURE_SESSION, tempFixture } from "../../../fixtures/helper.js";

function indexed() {
  const fx = tempFixture("an");
  const store = new Store(fx.projectRoot);
  ingestProject({ cwd: FIXTURE_CWD, store, originDir: fx.originDir });
  return { fx, store, events: store.readEvents(FIXTURE_SESSION) };
}

describe("structure", () => {
  test("builds phases, turns, steps, branch and subagent nesting", () => {
    const { fx, events } = indexed();
    try {
      const { session } = buildStructure(FIXTURE_SESSION, events);
      expect(session.label).toBe("Add login endpoint and fix tests");
      expect(session.stats.cost_usd).toBe(1.2345);
      expect(session.children.map((p) => p.children.map((t) => t.id))).toEqual([["t1", "t2", "t3"], ["t4"]]);
      expect(session.children[1]?.meta?.boundary).toBe("compaction");
      const t3 = findNode(session, "t3")!;
      expect(t3.meta?.branch).toBe(true);
      expect(t3.meta?.branch_from).toBe("a7");
      expect(findNode(session, "t2")!.meta?.branch).toBeUndefined();
      const t1 = findNode(session, "t1")!;
      expect(t1.children.map((s) => s.meta?.step_kind)).toEqual(["prompt", "text", "tool", "tool", "subagent", "tool", "tool-error", "text", "system"].filter((k) => k !== "system"));
      const agent = t1.children.find((s) => s.meta?.step_kind === "subagent")!;
      expect(agent.meta?.agent_id).toBe(FIXTURE_AGENT);
      expect(agent.meta?.agent_type).toBe("general-purpose");
      expect(agent.label).toContain("Agent: Research JWT");
      expect(agent.children.length).toBe(4);
      expect(t1.stats.tool_calls).toBe(6); // 5 own + 1 inside the subagent
      expect(t1.stats.duration_ms).toBe(115000);
      expect(session.stats.input_tokens).toBeGreaterThan(20000);
      for (const n of walk(session)) expect(n.span.ts_first <= n.span.ts_last).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("mermaid graph renders with pele and carries ids, rewind and subagent", () => {
    const { fx, events } = indexed();
    try {
      const { session } = buildStructure(FIXTURE_SESSION, events);
      const mmd = toMermaid(session, { level: 2 });
      expect(mmd).toContain("subgraph p1");
      expect(mmd).toContain("rewind");
      expect(mmd).toContain("class t3 branch");
      expect(mmd).toContain("subagent");
      const { svg } = render(mmd);
      expect(svg).toContain("<svg");
      const l3 = toMermaid(session, { level: 3 });
      expect(render(l3).svg).toContain("<svg");
      expect(render(toMermaid(session, { level: 1 })).svg).toContain("<svg");
    } finally {
      fx.cleanup();
    }
  });

  test("derive pipeline is deterministic and writes the committed files", () => {
    const { fx, store } = indexed();
    try {
      deriveSession(store, FIXTURE_SESSION);
      deriveProject(store, "demo");
      const dir = store.sessionDir(FIXTURE_SESSION);
      const snap = () => ["structure.json", "graph.mmd", "graph.L1.mmd"].map((f) => fs.readFileSync(path.join(dir, f), "utf8")).concat(fs.readFileSync(path.join(dir, "meta.json"), "utf8"), fs.readFileSync(store.projectIndexFile, "utf8"));
      const a = snap();
      deriveSession(store, FIXTURE_SESSION);
      deriveProject(store, "demo");
      expect(snap()).toEqual(a);
      expect(store.readProjectIndex()?.sessions[0]?.label).toBe("Add login endpoint and fix tests");
    } finally {
      fx.cleanup();
    }
  });
});

describe("search", () => {
  test("finds events by text and tool name", () => {
    const { fx, events } = indexed();
    try {
      const idx = new SearchIndex();
      idx.add(events);
      expect(idx.search("salt").map((h) => h.id)).toContain("a7");
      expect(idx.search("WebSearch")[0]?.tool).toBe("WebSearch");
      expect(idx.search("changelog", { session: "nope" })).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

describe("semantic cache", () => {
  test("summarizes once per input hash and never recomputes identical input", async () => {
    const { fx, store, events } = indexed();
    try {
      let calls = 0;
      const fake: Summarizer = { name: "fake", summarize: async (i) => (calls++, `${i.granularity}:${i.kind}:${i.text.length}`) };
      const { session } = buildStructure(FIXTURE_SESSION, events);
      const byId = new Map(events.map((e) => [e.id, e]));
      const cache = new TextCache(store.textDir(FIXTURE_SESSION));
      const t1 = findNode(session, "t1")!;
      const a1 = await summarizeNode({ node: t1, granularity: "title", interim: false }, byId, cache, fake);
      const a2 = await summarizeNode({ node: t1, granularity: "title", interim: false }, byId, cache, fake);
      expect(calls).toBe(1);
      expect(a1.text).toBe(a2.text);
      expect(a1.hash).toHaveLength(16);
      expect(fs.readdirSync(store.textDir(FIXTURE_SESSION)).length).toBe(1);
      // planner respects the slider
      expect(planJobs(session, "yolo")).toEqual([]);
      expect(planJobs(session, "balanced").length).toBe(2); // closed phase p1: title + abstract
      expect(planJobs(session, "micro").some((j) => j.interim)).toBe(true);
      const decorated: StructureNode = deriveSession(store, FIXTURE_SESSION).session;
      expect(findNode(decorated, "t1")?.text?.title).toBe(a1.text);
    } finally {
      fx.cleanup();
    }
  });
});

describe("labels", () => {
  test("prompt labels drop injected IDE and pasted-content tags", async () => {
    const { promptLabel } = await import("../src/structure.js");
    expect(promptLabel('<ide_opened_file>The user opened x</ide_opened_file>fix the license')).toBe("fix the license");
    expect(promptLabel('<pasted_content id="b">we are creating yolo-twice</pasted_content>')).toBe("we are creating yolo-twice");
    expect(promptLabel("plain prompt")).toBe("plain prompt");
  });
});
