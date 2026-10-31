import { describe, expect, test } from "bun:test";
import { render } from "pele";
import { ingestProject, Store } from "@yolo-twice/core";
import { buildStructure, findNode } from "../src/structure.js";
import { focusMermaid, projectToMermaid } from "../src/graph.js";
import { filterEvents, parseCodes, SearchIndex } from "../src/search.js";
import { FIXTURE_CWD, FIXTURE_SESSION, tempFixture } from "../../../fixtures/helper.js";

function loaded() {
  const fx = tempFixture("co");
  const store = new Store(fx.projectRoot);
  ingestProject({ cwd: FIXTURE_CWD, store, originDir: fx.originDir });
  const events = store.readEvents(FIXTURE_SESSION);
  return { fx, events, session: buildStructure(FIXTURE_SESSION, events).session };
}

describe("filters", () => {
  test("parseCodes keeps known codes and tool codes only", () => {
    expect(parseCodes("u,t:Bash,zz,e,,t:")).toEqual(["u", "t:Bash", "e"]);
    expect(parseCodes(undefined)).toEqual([]);
  });

  test("filterEvents by kind, tool, error and time window", () => {
    const { fx, events } = loaded();
    try {
      const prompts = filterEvents(events, { codes: ["u"] });
      expect(prompts).toEqual(["u1", "u7", "u9", "u12"]);
      // tool results inherit the tool name of their call, so t:Bash finds calls and results
      expect(filterEvents(events, { codes: ["t:Bash"] })).toEqual(["a2", "u2", "a6", "u6", "a11", "u10"]);
      expect(filterEvents(events, { codes: ["e"] })).toEqual(["u6"]);
      const sub = filterEvents(events, { codes: ["s"] });
      expect(sub.length).toBeGreaterThan(3);
      expect(sub.every((id) => id.startsWith("agent:") || id.startsWith("sa"))).toBe(true);
      expect(filterEvents(events, { codes: ["c"] })).toEqual(["u11"]);
      // codes are OR'd
      expect(filterEvents(events, { codes: ["u", "e"] })).toEqual(["u1", "u6", "u7", "u9", "u12"]);
      // window: only the first turn's prompt
      expect(filterEvents(events, { codes: ["u"], to: "2026-10-31T08:01:00.000Z" })).toEqual(["u1"]);
      // r is structural and ignored at event level
      expect(filterEvents(events, { codes: ["r"] }).length).toBe(filterEvents(events, {}).length);
    } finally {
      fx.cleanup();
    }
  });

  test("SearchIndex combines text query with filters, lists without a query, reports tools", () => {
    const { fx, events } = loaded();
    try {
      const idx = new SearchIndex();
      idx.add(events);
      expect(idx.search("test", { codes: ["u"] }).map((h) => h.id)).toEqual(expect.arrayContaining(["u1", "u9"]));
      expect(idx.search("test", { codes: ["u"] }).every((h) => h.kind === "user.prompt")).toBe(true);
      expect(idx.search("", { codes: ["e"] }).map((h) => h.id)).toEqual(["u6"]);
      expect(idx.search("", { codes: ["u"], limit: 2 }).map((h) => h.id)).toEqual(["u1", "u7"]);
      expect(idx.matchIds("salt").has("a7")).toBe(true);
      expect(idx.matchIds("salt", { from: "2026-10-31T09:00:00.000Z" }).has("a7")).toBe(false);
      expect(idx.tools()[0]).toBe("Bash");
      // project-wide: no session filter, wrong session filter
      expect(idx.search("salt").length).toBeGreaterThan(0);
      expect(idx.search("salt", { session: "other" })).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

describe("focus graphs", () => {
  test("re-root on phase, turn and subagent; project graph; all render with pele", () => {
    const { fx, session } = loaded();
    try {
      const phase = focusMermaid(findNode(session, "p1")!);
      expect(phase).toContain("t1[");
      expect(phase).toContain("rewind");
      expect(phase).not.toContain("subgraph p1");
      const turn = focusMermaid(findNode(session, "t1")!);
      expect(turn).toContain("t1_s1");
      expect(turn).toContain("subgraph t1_s5_box");
      expect(turn).toContain("class t1_s7 error;");
      const agent = findNode(session, "t1")!.children.find((s) => s.meta?.step_kind === "subagent")!;
      expect(focusMermaid(agent)).toContain(agent.children[0]!.id.replace(/[^A-Za-z0-9_]/g, "_"));
      const project = projectToMermaid([{ id: "a", label: "first" }, { id: "b", label: "second" }]);
      expect(project).toContain("s_a --> s_b");
      for (const m of [phase, turn, focusMermaid(session), focusMermaid(agent), project]) expect(render(m).svg).toContain("<svg");
    } finally {
      fx.cleanup();
    }
  });
});

describe("queued messages", () => {
  test("a message typed mid-turn stays inside the running turn", async () => {
    const { normalizeRecord } = await import("@yolo-twice/core");
    const ctx = { session: "s", file: "f", line: 1, agentId: null, lastTs: "2026-10-31T08:00:00.000Z", maxTextChars: 8000 };
    const lines = [
      { type: "user", uuid: "u1", parentUuid: null, timestamp: "2026-10-31T08:00:00.000Z", message: { role: "user", content: "build it" } },
      { type: "assistant", uuid: "a1", parentUuid: "u1", timestamp: "2026-10-31T08:00:05.000Z", message: { role: "assistant", content: [{ type: "text", text: "working" }] } },
      { type: "attachment", uuid: "q1", parentUuid: "a1", timestamp: "2026-10-31T08:00:06.000Z", attachment: { type: "queued_command", prompt: "also commit" } },
      { type: "assistant", uuid: "a2", parentUuid: "q1", timestamp: "2026-10-31T08:00:09.000Z", message: { role: "assistant", content: [{ type: "text", text: "done, committed" }] } },
      { type: "user", uuid: "u2", parentUuid: "a2", timestamp: "2026-10-31T08:01:00.000Z", message: { role: "user", content: "thanks" } },
    ];
    const events = lines.flatMap((l, i) => normalizeRecord(JSON.stringify(l), { ...ctx, line: i + 1 }));
    const { session } = buildStructure("s", events);
    const turns = session.children.flatMap((p) => p.children);
    expect(turns.map((t) => t.label)).toEqual(["build it", "thanks"]);
    expect(turns[0]!.children.map((s) => s.meta?.step_kind)).toEqual(["prompt", "text", "queued", "text"]);
    expect(filterEvents(events, { codes: ["u"] })).toEqual(["u1", "q1", "u2"]);
  });
});
