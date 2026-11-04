import { afterAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store, type Event } from "../src/index.js";

const base = fs.mkdtempSync(path.join(os.tmpdir(), "yt-store-"));
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

const ev = (session: string, id: string): Event => ({ id, ts: "2026-11-04T10:00:00.000Z", session, agent: "claude-code", agent_id: null, parent: null, kind: "user.prompt", text: id });

let n = 0;
/** A store whose session s1 is "committed": written while sharing. */
function store(): Store {
  const s = new Store(path.join(base, `p${++n}`));
  s.ensure();
  s.setSharing(true);
  s.appendEvents("s1", [ev("s1", "a")]);
  s.writeSessionMeta({ id: "s1", agent: "claude-code", label: "one", ts_first: "t", ts_last: "t", events: 1 });
  s.setSharing(false);
  return s;
}

describe("two session folders", () => {
  test("an unchanged derived file writes nothing, so a frozen session is not copied for it", () => {
    const s = store();
    s.writeSessionMeta({ id: "s1", agent: "claude-code", label: "one", ts_first: "t", ts_last: "t", events: 1 });
    expect(fs.existsSync(s.privateDir("s1"))).toBe(false);
    s.writeSessionMeta({ id: "s1", agent: "claude-code", label: "renamed", ts_first: "t", ts_last: "t", events: 1 });
    expect(fs.existsSync(s.privateDir("s1"))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(s.sharedDir("s1"), "meta.json"), "utf8")).label).toBe("one");
    expect(s.readSessionMeta("s1")?.label).toBe("renamed");
    // a copy with the same events is no addition
    expect(s.place("s1")).toBe("shared");
  });

  test("both folders are listed once; a reset while not sharing leaves the committed folder alone", () => {
    const s = store();
    s.appendEvents("s2", [ev("s2", "x")]);
    expect(s.listPlaced()).toEqual({ shared: ["s1"], private: ["s2"] });
    expect(s.listSessions()).toEqual(["s1", "s2"]);
    s.resetSession("s1");
    expect(fs.existsSync(path.join(s.sharedDir("s1"), "events.ndjson"))).toBe(true);
    expect(s.readEvents("s1")).toEqual([]);
    s.appendEvents("s1", [ev("s1", "a2")]);
    expect(s.readEvents("s1").map((e) => e.id)).toEqual(["a2"]);
    expect(s.place("s1")).toBe("private-additions");
  });

  test("promote and demote move a folder between the two places", () => {
    const s = store();
    s.appendEvents("s1", [ev("s1", "b")]);
    s.promote("s1");
    expect(fs.existsSync(s.privateDir("s1"))).toBe(false);
    expect(s.readEvents("s1").map((e) => e.id)).toEqual(["a", "b"]);
    s.demote("s1");
    expect(fs.existsSync(s.sharedDir("s1"))).toBe(false);
    expect(s.place("s1")).toBe("private");
  });
});
