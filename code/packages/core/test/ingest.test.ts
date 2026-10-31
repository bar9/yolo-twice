import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import { ingestProject, projectSlug, redact, Store, truncate } from "../src/index.js";
import { FIXTURE_CWD, FIXTURE_SESSION, mainFile, tempFixture } from "../../../fixtures/helper.js";

describe("paths", () => {
  test("project slug matches Claude Code's folder naming", () => {
    expect(projectSlug("/home/matthi/git/yolo-twice")).toBe("-home-matthi-git-yolo-twice");
    expect(projectSlug("/tmp/my_project.v2")).toBe("-tmp-my-project-v2");
  });
});

describe("redaction", () => {
  test("replaces known secret shapes and reports rules", () => {
    const r = redact("key sk-ant-api03-FAKEFAKEFAKEFAKEFAKEFAKE1234567890 and ghp_abcdefghijklmnopqrstuvwxyz0123456789 and password=hunter2hunter2");
    expect(r.text).not.toContain("sk-ant-");
    expect(r.text).not.toContain("ghp_");
    expect(r.text).not.toContain("hunter2");
    expect(r.rules).toEqual(expect.arrayContaining(["anthropic-key", "github-token", "secret-assignment"]));
    expect(r.count).toBe(3);
  });
  test("leaves ordinary text alone", () => {
    const r = redact("ls src/routes\nauth.ts users.ts");
    expect(r.count).toBe(0);
    expect(r.text).toBe("ls src/routes\nauth.ts users.ts");
  });
  test("truncates long text keeping head and tail", () => {
    const t = truncate("a".repeat(100) + "MIDDLE" + "b".repeat(100), 50);
    expect(t.startsWith("aaaa")).toBe(true);
    expect(t.endsWith("bbbb")).toBe(true);
    expect(t).toContain("truncated");
  });
});

describe("ingest", () => {
  test("normalizes, redacts and truncates the fixture session", () => {
    const fx = tempFixture();
    try {
      const store = new Store(fx.projectRoot);
      const res = ingestProject({ cwd: FIXTURE_CWD, store, originDir: fx.originDir });
      expect(res.changed).toEqual([FIXTURE_SESSION]);
      const events = store.readEvents(FIXTURE_SESSION);
      const kinds = new Set(events.map((e) => e.kind));
      for (const k of ["user.prompt", "assistant.text", "tool.call", "tool.result", "subagent.start", "subagent.stop", "compaction", "cost", "title", "system", "meta"]) {
        expect(kinds.has(k as never)).toBe(true);
      }
      const raw = fs.readFileSync(store.eventsFile(FIXTURE_SESSION), "utf8");
      expect(raw).not.toContain("sk-ant-");
      expect(raw).not.toContain("ghp_");
      const leaked = events.find((e) => e.redacted);
      expect(leaked?.redacted?.rules).toEqual(expect.arrayContaining(["anthropic-key", "github-token"]));
      const big = events.find((e) => e.text.includes("1 failing"));
      expect(big?.text).toContain("truncated");
      expect(big?.data?.is_error).toBe(true);
      const sub = events.filter((e) => e.agent_id === "deadbeef01234567");
      expect(sub.length).toBeGreaterThan(3);
      expect(sub[0]?.kind).toBe("subagent.start");
      expect(sub[0]?.tool?.call_id).toBe("toolu_02");
      expect(sub.at(-1)?.kind).toBe("subagent.stop");
      const usage = events.find((e) => e.id === "a1");
      expect(usage?.usage?.input_tokens).toBe(1200);
      expect(usage?.model).toBe("claude-fable-5-1");
      expect(events.find((e) => e.id === "u2")?.parent).toBe("a2");
      expect(events.find((e) => e.kind === "meta")?.data?.type).toBe("future-record-type");
      expect(store.readConfig().attention).toBe("balanced");
      expect(fs.readFileSync(`${store.dir}/.gitignore`, "utf8")).toContain("cache/");
    } finally {
      fx.cleanup();
    }
  });

  test("is idempotent: a second run appends nothing and changes no bytes", () => {
    const fx = tempFixture();
    try {
      const store = new Store(fx.projectRoot);
      ingestProject({ cwd: FIXTURE_CWD, store, originDir: fx.originDir });
      const before = fs.readFileSync(store.eventsFile(FIXTURE_SESSION));
      const res = ingestProject({ cwd: FIXTURE_CWD, store: new Store(fx.projectRoot), originDir: fx.originDir });
      expect(res.changed).toEqual([]);
      expect(fs.readFileSync(store.eventsFile(FIXTURE_SESSION)).equals(before)).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("resumes from the cursor and ends with the same event set as a one-shot run", () => {
    const whole = tempFixture("whole");
    const split = tempFixture("split");
    try {
      const oneShot = new Store(whole.projectRoot);
      ingestProject({ cwd: FIXTURE_CWD, store: oneShot, originDir: whole.originDir });

      const file = mainFile(split.originDir);
      const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
      const cut = 12;
      // first half, plus a partial trailing line that must not be consumed yet
      fs.writeFileSync(file, lines.slice(0, cut).join("\n") + "\n" + lines[cut]!.slice(0, 20));
      const store = new Store(split.projectRoot);
      const r1 = ingestProject({ cwd: FIXTURE_CWD, store, originDir: split.originDir });
      expect(r1.appended[FIXTURE_SESSION]).toBeGreaterThan(0);
      const cursor1 = store.readSourceState(FIXTURE_SESSION)!.files[`${FIXTURE_SESSION}.jsonl`]!;
      expect(cursor1.lines).toBe(cut);

      fs.writeFileSync(file, lines.join("\n") + "\n");
      const r2 = ingestProject({ cwd: FIXTURE_CWD, store: new Store(split.projectRoot), originDir: split.originDir });
      expect(r2.appended[FIXTURE_SESSION]).toBeGreaterThan(0);

      const a = oneShot.readEvents(FIXTURE_SESSION).map((e) => JSON.stringify(e)).sort();
      const b = new Store(split.projectRoot).readEvents(FIXTURE_SESSION).map((e) => JSON.stringify(e)).sort();
      expect(b).toEqual(a);
    } finally {
      whole.cleanup();
      split.cleanup();
    }
  });

  test("rebuilds a session when its source file was replaced", () => {
    const fx = tempFixture();
    try {
      const store = new Store(fx.projectRoot);
      ingestProject({ cwd: FIXTURE_CWD, store, originDir: fx.originDir });
      const file = mainFile(fx.originDir);
      const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
      // different first record -> head hash changes
      fs.writeFileSync(file, [JSON.stringify({ type: "ai-title", aiTitle: "Replaced", sessionId: FIXTURE_SESSION }), ...lines.slice(1)].join("\n") + "\n");
      const res = ingestProject({ cwd: FIXTURE_CWD, store: new Store(fx.projectRoot), originDir: fx.originDir });
      expect(res.reset).toEqual([FIXTURE_SESSION]);
      const titles = new Store(fx.projectRoot).readEvents(FIXTURE_SESSION).filter((e) => e.kind === "title");
      expect(titles.some((t) => t.text === "Replaced")).toBe(true);
    } finally {
      fx.cleanup();
    }
  });
});
