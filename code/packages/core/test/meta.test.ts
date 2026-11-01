import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.js";

describe("session meta", () => {
  test("meta written before tokens were counted gets them from the structure", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "yt-meta-"));
    try {
      const store = new Store(root);
      store.ensure();
      const span = { first: "e1", last: "e2", ts_first: "2026-01-01T00:00:00Z", ts_last: "2026-01-01T00:01:00Z" };
      store.writeStructure("s1", { id: "s1", level: 0, kind: "session", label: "S", span, children: [], stats: { events: 2, tool_calls: 0, input_tokens: 1200, output_tokens: 34 } });
      fs.writeFileSync(store.eventsFile("s1"), "");
      store.writeSessionMeta({ id: "s1", agent: "claude-code", label: "S", ts_first: span.ts_first, ts_last: span.ts_last, events: 2, cost_usd: 0.5 });
      expect(store.readSessionMeta("s1")?.tokens).toBe(1234);
      expect(store.buildProjectIndex("p")?.sessions[0]?.tokens).toBe(1234);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
