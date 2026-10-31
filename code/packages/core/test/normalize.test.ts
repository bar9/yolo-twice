import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import { ingestProject, NORMALIZER_VERSION, normalizeRecord, Store } from "../src/index.js";
import { FIXTURE_CWD, FIXTURE_SESSION, tempFixture } from "../../../fixtures/helper.js";

const ctx = { session: "s", file: "f.jsonl", line: 1, agentId: null, lastTs: "2026-10-31T08:00:00.000Z", maxTextChars: 8000 };

describe("normalizer v2", () => {
  test("a message typed mid-turn (queued_command attachment) becomes a queued user prompt", () => {
    const rec = { type: "attachment", uuid: "q1", parentUuid: "a9", timestamp: "2026-10-31T08:05:00.000Z", attachment: { type: "queued_command", prompt: [{ type: "text", text: "commit regularly" }] } };
    const [ev] = normalizeRecord(JSON.stringify(rec), ctx);
    expect(ev).toMatchObject({ id: "q1", parent: "a9", kind: "user.prompt", text: "commit regularly", data: { queued: true } });
    const plain = { ...rec, uuid: "q2", attachment: { type: "queued_command", prompt: "gh pages is active" } };
    expect(normalizeRecord(JSON.stringify(plain), ctx)[0]?.text).toBe("gh pages is active");
    // other attachments stay skipped
    expect(normalizeRecord(JSON.stringify({ type: "attachment", attachment: { type: "environment" } }), ctx)).toEqual([]);
  });

  test("background task notifications are system events, not human prompts", () => {
    const text = "<task-notification>\n<task-id>abc</task-id>\n<status>completed</status>\n<summary>Agent finished</summary>\n</task-notification>";
    const asString = normalizeRecord(JSON.stringify({ type: "user", uuid: "n1", message: { role: "user", content: text } }), ctx)[0]!;
    expect(asString.kind).toBe("system");
    expect(asString.data).toMatchObject({ subtype: "task-notification", status: "completed", summary: "Agent finished" });
    const asBlocks = normalizeRecord(JSON.stringify({ type: "user", uuid: "n2", message: { role: "user", content: [{ type: "text", text }] } }), ctx)[0]!;
    expect(asBlocks.kind).toBe("system");
  });

  test("an index written by an older normalizer rebuilds once", () => {
    const fx = tempFixture("nv");
    try {
      const store = new Store(fx.projectRoot);
      ingestProject({ cwd: FIXTURE_CWD, store, originDir: fx.originDir });
      expect(store.readSourceState(FIXTURE_SESSION)?.normalizer).toBe(NORMALIZER_VERSION);
      const before = fs.readFileSync(store.eventsFile(FIXTURE_SESSION), "utf8");
      // pretend the index came from version 1
      const st = store.readSourceState(FIXTURE_SESSION)!;
      store.writeSourceState(FIXTURE_SESSION, { ...st, normalizer: 1 });
      const r = ingestProject({ cwd: FIXTURE_CWD, store: new Store(fx.projectRoot), originDir: fx.originDir });
      expect(r.reset).toEqual([FIXTURE_SESSION]);
      expect(fs.readFileSync(store.eventsFile(FIXTURE_SESSION), "utf8")).toBe(before);
      // and only once
      expect(ingestProject({ cwd: FIXTURE_CWD, store: new Store(fx.projectRoot), originDir: fx.originDir }).reset).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

describe("concurrent writers", () => {
  test("two stores on the same project never duplicate events, and a damaged file reads clean", () => {
    const fx = tempFixture("cw");
    try {
      const a = new Store(fx.projectRoot);
      const b = new Store(fx.projectRoot);
      ingestProject({ cwd: FIXTURE_CWD, store: a, originDir: fx.originDir });
      const n = a.readEvents(FIXTURE_SESSION).length;
      // b has a stale view: it re-ingests from an empty cursor as a second engine would
      b.writeSourceState(FIXTURE_SESSION, { ...b.readSourceState(FIXTURE_SESSION)!, files: {} });
      ingestProject({ cwd: FIXTURE_CWD, store: b, originDir: fx.originDir });
      ingestProject({ cwd: FIXTURE_CWD, store: a, originDir: fx.originDir });
      const raw = fs.readFileSync(a.eventsFile(FIXTURE_SESSION), "utf8").trim().split("\n");
      expect(new Set(raw.map((l) => JSON.parse(l).id)).size).toBe(raw.length);
      expect(raw.length).toBe(n);
      // a file damaged by an older version heals on read
      fs.appendFileSync(a.eventsFile(FIXTURE_SESSION), raw.slice(0, 3).join("\n") + "\n");
      expect(new Store(fx.projectRoot).readEvents(FIXTURE_SESSION).length).toBe(n);
      // the lock is released and a stale one is taken over
      expect(fs.existsSync(`${a.cacheDir()}/${FIXTURE_SESSION}.lock`)).toBe(false);
      fs.writeFileSync(`${a.cacheDir()}/${FIXTURE_SESSION}.lock`, "");
      fs.utimesSync(`${a.cacheDir()}/${FIXTURE_SESSION}.lock`, new Date(0), new Date(0));
      expect(a.withSessionLock(FIXTURE_SESSION, () => 42)).toBe(42);
      // a live lock makes a second writer wait and then fail loudly instead of corrupting
      fs.writeFileSync(`${a.cacheDir()}/${FIXTURE_SESSION}.lock`, "");
      expect(() => b.withSessionLock(FIXTURE_SESSION, () => 1, 30_000, 100)).toThrow(/locked/);
    } finally {
      fx.cleanup();
    }
  });
});
