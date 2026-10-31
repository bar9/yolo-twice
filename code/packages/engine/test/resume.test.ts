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

  test("prepareResume writes to the gitignored cache, expands paths for the resumer, and forks", () => {
    const fx = tempFixture("rp");
    const claudeHome = path.join(fx.projectRoot, "claude-home");
    const prev = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = claudeHome;
    try {
      const store = new Store(fx.projectRoot);
      ingestProject({ cwd: FIXTURE_CWD, store, originDir: fx.originDir });
      // stored portably
      expect(fs.readFileSync(store.eventsFile(FIXTURE_SESSION), "utf8")).toContain("$PROJECT/src/routes/auth.ts");
      // a teammate resumes in their own clone and home
      const r = prepareResume(store, "/home/bob/clone", FIXTURE_SESSION.slice(0, 8), "/home/bob");
      expect(r.session).toBe(FIXTURE_SESSION);
      expect(r.transcript).toBe(path.join(store.cacheDir(), "resume", `${FIXTURE_SESSION}.jsonl`));
      expect(r.command).toEqual(["claude", "--resume", r.transcript, "--fork-session"]);
      const text = fs.readFileSync(r.transcript, "utf8");
      expect(text).toContain("/home/bob/clone/src/routes/auth.ts");
      expect(text).not.toContain("$PROJECT");
      // tool inputs are objects with absolute paths again
      const read = text.split("\n").filter(Boolean).map((l) => JSON.parse(l)).flatMap((rec) => rec.message?.content ?? []).find((b: { type: string; name?: string }) => b.type === "tool_use" && b.name === "Read");
      expect(read.input.file_path).toBe("/home/bob/clone/src/routes/auth.ts");
      // nothing was written into Claude's own folder
      expect(fs.existsSync(path.join(claudeHome, "projects"))).toBe(false);
      // rebuilding is idempotent
      const again = prepareResume(store, "/home/bob/clone", FIXTURE_SESSION, "/home/bob");
      expect(fs.readFileSync(again.transcript, "utf8")).toBe(text);
      // a prefix that fits two sessions is refused, not resolved to the first
      const twin = path.join(store.dir, "sessions", `${FIXTURE_SESSION.slice(0, 4)}-twin`);
      fs.mkdirSync(twin, { recursive: true });
      fs.copyFileSync(store.eventsFile(FIXTURE_SESSION), path.join(twin, "events.ndjson"));
      expect(() => prepareResume(store, "/home/bob/clone", FIXTURE_SESSION.slice(0, 4), "/home/bob")).toThrow(/matches 2 sessions/);
      expect(prepareResume(store, "/home/bob/clone", FIXTURE_SESSION.slice(0, 8), "/home/bob").session).toBe(FIXTURE_SESSION);
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prev;
      fx.cleanup();
    }
  });
});
