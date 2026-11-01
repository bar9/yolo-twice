import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileExtraRules, isSafeSessionId, redact, Store } from "../src/index.js";

describe("redaction", () => {
  test("extra rules redact every match, even when given flags without g", () => {
    const rules = compileExtraRules([{ name: "corp", pattern: "corp-[a-z0-9]{8}", flags: "i" }]);
    const out = redact("a CORP-abcd1234 b corp-efgh5678 c corp-ijkl9012", rules);
    expect(out.text).not.toMatch(/corp-[a-z0-9]{8}/i);
  });
});

describe("session ids", () => {
  test("only a single path segment is accepted", () => {
    expect(isSafeSessionId("b3c59ce4-eaac-4449-bcc5-6124bb050c3d")).toBe(true);
    for (const bad of ["..", ".", "../x", "a/b", "a\\b", ""]) expect(isSafeSessionId(bad)).toBe(false);
  });

  test("a session folder with an unusable name is skipped, not listed", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "yt-ids-"));
    try {
      const store = new Store(root);
      for (const name of ["good-id", "my session (copy)"]) {
        fs.mkdirSync(path.join(store.dir, "sessions", name), { recursive: true });
        fs.writeFileSync(path.join(store.dir, "sessions", name, "events.ndjson"), "");
      }
      expect(store.listSessions()).toEqual(["good-id"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
