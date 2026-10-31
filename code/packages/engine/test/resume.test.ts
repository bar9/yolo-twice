import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { ingestProject, Store } from "@yolo-twice/core";
import { buildStructure } from "@yolo-twice/analyzers";
import { prepareResume, reconstructTranscript } from "../src/resume.js";
import { FIXTURE_CWD, FIXTURE_SESSION, tempFixture } from "../../../fixtures/helper.js";

describe("resume", () => {
  test("rebuilds a transcript that round-trips to the same turns and keeps tool pairs", () => {
    const fx = tempFixture("rs");
    try {
      const store = new Store(fx.projectRoot);
      ingestProject({ cwd: FIXTURE_CWD, store, originDir: fx.originDir });
      const events = store.readEvents(FIXTURE_SESSION);
      const { lines, records, skipped } = reconstructTranscript(FIXTURE_SESSION, events, fx.projectRoot);
      expect(records).toBeGreaterThan(20);
      expect(skipped).toBeGreaterThan(0); // system / cost / meta records are not conversation
      const recs = lines.map((l) => JSON.parse(l));
      const uses = new Set<string>();
      const results = new Set<string>();
      for (const r of recs) for (const b of r.message?.content ?? []) {
        if (b.type === "tool_use") uses.add(b.id);
        if (b.type === "tool_result") results.add(b.tool_use_id);
      }
      expect([...uses].every((u) => results.has(u))).toBe(true);
      const ids = new Set(recs.map((r) => r.uuid));
      for (const r of recs) if (r.parentUuid) expect(ids.has(r.parentUuid)).toBe(true);
      expect(recs.every((r) => r.cwd === fx.projectRoot || r.type === "custom-title")).toBe(true);
      expect(JSON.stringify(recs)).not.toContain("sk-ant-");

      // ingest the rebuilt transcript as if it were a real Claude Code session and compare the structure
      const originDir = path.join(fx.projectRoot, "fake-claude", "projects", "x");
      fs.mkdirSync(originDir, { recursive: true });
      fs.writeFileSync(path.join(originDir, `${FIXTURE_SESSION}.jsonl`), lines.join("\n") + "\n");
      const store2 = new Store(path.join(fx.projectRoot, "second"));
      ingestProject({ cwd: fx.projectRoot, store: store2, originDir });
      const a = buildStructure(FIXTURE_SESSION, events).session;
      const b = buildStructure(FIXTURE_SESSION, store2.readEvents(FIXTURE_SESSION)).session;
      expect(b.children.map((p) => p.children.map((t) => t.label))).toEqual(a.children.map((p) => p.children.map((t) => t.label)));
      expect(b.children[0]!.children[2]!.meta?.branch).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("prepareResume writes under the Claude project dir once and never overwrites silently", () => {
    const fx = tempFixture("rp");
    const home = path.join(fx.projectRoot, "home");
    const prev = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = home;
    try {
      const store = new Store(fx.projectRoot);
      ingestProject({ cwd: FIXTURE_CWD, store, originDir: fx.originDir });
      const r1 = prepareResume(store, fx.projectRoot);
      expect(r1.session).toBe(FIXTURE_SESSION);
      expect(r1.wrote).toBe(true);
      expect(r1.transcript.startsWith(path.join(home, "projects"))).toBe(true);
      expect(r1.command).toEqual(["claude", "--resume", FIXTURE_SESSION]);
      const r2 = prepareResume(store, fx.projectRoot);
      expect(r2.wrote).toBe(false);
      expect(prepareResume(store, fx.projectRoot, undefined, true).wrote).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prev;
      fx.cleanup();
    }
  });
});
