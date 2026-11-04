import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Store, type Event } from "@yolo-twice/core";
import { AutoCommitter } from "../src/autocommit.js";
import { writeSettings } from "../src/state.js";
import { SharingIndex } from "../src/visibility.js";

const base = fs.mkdtempSync(path.join(os.tmpdir(), "yt-sharing-"));
process.env.YOLO_TWICE_HOME = path.join(base, "home");
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

const PUBLIC = "https://github.com/bar9/public.git";
const INTERNAL = "git@github.com:acme/app.git";
const gh = async (id: string) => (id === "github.com/bar9/public" ? "PUBLIC" : id === "github.com/acme/app" ? "INTERNAL" : undefined);

function ev(session: string, id: string): Event {
  return { id, ts: "2026-11-04T10:00:00.000Z", session, agent: "claude-code", agent_id: null, parent: null, kind: "user.prompt", text: `prompt ${id}` };
}

let n = 0;
/** A fresh repo whose .yolo-twice scaffolding is committed, so `git status` shows only session changes. */
function repo(name = `r${++n}`) {
  const root = path.join(base, name);
  fs.mkdirSync(root);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  fs.writeFileSync(path.join(root, "app.ts"), "1\n");
  const store = new Store(root);
  store.ensure();
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  const events: [string, unknown][] = [];
  const sharing = new SharingIndex(store, root, (e, d) => events.push([e, d]), () => {}, gh);
  const add = (session: string, ...ids: string[]) => store.appendEvents(session, ids.map((id) => ev(session, id)));
  const status = () => git("status", "--porcelain", "--untracked-files=all");
  const commitAll = (msg = "sessions") => {
    git("add", "-A");
    git("commit", "-q", "-m", msg);
  };
  const shared = (id: string) => path.join(store.dir, "sessions", id, "events.ndjson");
  const priv = (id: string) => path.join(store.dir, "private", "sessions", id, "events.ndjson");
  return { root, git, store, sharing, events, add, status, commitAll, shared, priv };
}

async function autoCommit(r: ReturnType<typeof repo>): Promise<string> {
  const ac = new AutoCommitter(r.root, r.store.dir, () => {}, () => {}, 60_000, async () => {
    await r.sharing.refresh();
  });
  ac.set(true);
  await ac.tick();
  for (let i = 0; i < 50 && ac.get().lastCheck === undefined; i++) await new Promise((res) => setTimeout(res, 50));
  ac.stop();
  return r.git("show", "--name-only", "--format=", "HEAD");
}

beforeEach(() => writeSettings({ environment: "restricted", restricted_remotes: [] }));

describe("sharing follows (environment, remotes)", () => {
  test("restricted environment, public remote: a new session lands in private/ and git never sees it", async () => {
    const r = repo();
    r.git("remote", "add", "origin", PUBLIC);
    expect(await r.sharing.refresh()).toMatchObject({ environment: "restricted", class: "open", decidedBy: "origin", shares: false });
    r.add("s1", "a");
    expect(fs.existsSync(r.priv("s1"))).toBe(true);
    expect(fs.existsSync(r.shared("s1"))).toBe(false);
    r.git("add", "-A");
    expect(r.status()).toBe("");
    expect(r.sharing.of("s1")).toEqual({ visibility: "private" });
    expect(r.events.some(([e]) => e === "sharing")).toBe(true);
  });

  test("before the first answer nothing is shared (fail-safe)", () => {
    const r = repo();
    r.git("remote", "add", "origin", INTERNAL);
    expect(r.store.sharing).toBe(false);
    r.add("s1", "a");
    expect(fs.existsSync(r.priv("s1"))).toBe(true);
  });

  test("restricted remotes only: sessions go to sessions/ and auto-commit takes them", async () => {
    const r = repo();
    r.git("remote", "add", "origin", INTERNAL);
    expect(await r.sharing.refresh()).toMatchObject({ class: "restricted", shares: true });
    r.add("s1", "a");
    expect(fs.existsSync(r.shared("s1"))).toBe(true);
    expect(await autoCommit(r)).toContain(".yolo-twice/sessions/s1/events.ndjson");
    // a new Store (a CLI run) follows the engine's last answer
    expect(new Store(r.root).sharing).toBe(true);
  });

  test("a committed session continued here: the committed copy stays as pulled, the additions stay here", async () => {
    // upstream shares a session; this clone also has a public remote, so here it does not share
    const up = repo();
    up.store.setSharing(true);
    up.add("s1", "a", "b");
    up.add("s2", "x");
    up.commitAll();
    const bare = path.join(base, "bare.git");
    execFileSync("git", ["clone", "-q", "--bare", up.root, bare]);
    up.git("remote", "add", "origin", bare);
    up.git("fetch", "-q", "origin");
    up.git("branch", "-q", "--set-upstream-to=origin/main");
    const r = repo("clone");
    r.git("remote", "add", "origin", bare);
    r.git("remote", "add", "public", PUBLIC);
    r.git("fetch", "-q", "origin");
    r.git("reset", "-q", "--hard", "origin/main");
    r.git("branch", "-q", "--set-upstream-to=origin/main");
    expect(await r.sharing.refresh()).toMatchObject({ class: "open", decidedBy: "public", shares: false });
    const before = fs.readFileSync(r.shared("s1"), "utf8");

    r.add("s1", "c");
    expect(fs.readFileSync(r.shared("s1"), "utf8")).toBe(before);
    expect(r.store.readEvents("s1").map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(r.store.place("s1")).toBe("private-additions");
    expect(r.store.place("s2")).toBe("shared");
    expect(r.status()).toBe("");

    // upstream continues the same session and another one: the pull applies cleanly
    up.add("s1", "d");
    up.add("s2", "y");
    up.commitAll("more");
    up.git("push", "-q", "origin", "main");
    r.git("pull", "-q", "--ff-only");
    expect(r.store.readEvents("s2").map((e) => e.id)).toEqual(["x", "y"]);
    // the continuation here wins locally (the known limit: same session continued in two places)
    expect(r.store.readEvents("s1").map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(r.status()).toBe("");
  });

  test("when the project stops sharing, uncommitted sessions move out and committed ones go back to HEAD", async () => {
    const r = repo();
    r.git("remote", "add", "origin", INTERNAL);
    await r.sharing.refresh();
    r.add("old", "a");
    r.commitAll();
    r.add("old", "b"); // not committed yet
    r.add("new", "x");
    expect(r.status()).toContain("sessions/new/events.ndjson");

    r.git("remote", "add", "public", PUBLIC);
    expect(await r.sharing.refresh()).toMatchObject({ shares: false, private: 2 });
    expect(r.status()).toBe("");
    expect(r.store.place("new")).toBe("private");
    expect(r.store.place("old")).toBe("private-additions");
    expect(r.store.readEvents("old").map((e) => e.id)).toEqual(["a", "b"]);
    expect(fs.readFileSync(r.shared("old"), "utf8").trim().split("\n").length).toBe(1);
    // said once
    const alerts = () => r.events.filter(([e, d]) => e === "sharing" && (d as { alert: boolean }).alert).length;
    expect(alerts()).toBe(1);
    await r.sharing.refresh();
    expect(alerts()).toBe(1);
  });

  test("when the project shares again, private copies move back and auto-commit takes them", async () => {
    const r = repo();
    r.git("remote", "add", "origin", "https://git.acme.example/team/app.git");
    expect(await r.sharing.refresh()).toMatchObject({ class: "unknown", shares: false });
    r.add("s1", "a");
    expect(fs.existsSync(r.priv("s1"))).toBe(true);
    writeSettings({ restricted_remotes: ["git.acme.example"] });
    expect(await r.sharing.refresh()).toMatchObject({ class: "restricted", shares: true, private: 0 });
    expect(fs.existsSync(r.priv("s1"))).toBe(false);
    expect(r.store.place("s1")).toBe("shared");
    expect(await autoCommit(r)).toContain(".yolo-twice/sessions/s1/events.ndjson");
  });

  test("an open environment shares with any remote", async () => {
    const r = repo();
    r.git("remote", "add", "origin", PUBLIC);
    writeSettings({ environment: "open" });
    expect(await r.sharing.refresh()).toMatchObject({ environment: "open", answered: true, class: "open", shares: true });
  });

  test("outside a git repository nothing is committed, so nothing moves", async () => {
    const root = path.join(base, "plain");
    fs.mkdirSync(root);
    const store = new Store(root);
    store.ensure();
    const sharing = new SharingIndex(store, root, () => {}, () => {}, async () => undefined);
    expect(await sharing.refresh()).toBeUndefined();
    expect(sharing.of("x")).toBeUndefined();
    expect(store.sharing).toBe(true);
  });
});

describe("migration from 0.1.5", () => {
  test("private decisions are kept for good, the rest follows the rule, the exclude block goes", async () => {
    const r = repo();
    r.git("remote", "add", "origin", PUBLIC);
    // 0.1.5 state: decisions in local.json, an exclude block, sessions in sessions/
    r.store.setSharing(true);
    r.add("committed", "a");
    r.commitAll();
    r.add("mine", "m");
    r.add("pending", "p");
    r.add("chosen", "c");
    const exclude = path.join(r.root, ".git", "info", "exclude");
    fs.appendFileSync(
      exclude,
      "\n# yolo-twice: private and undecided sessions stay on this machine (managed, edits are overwritten)\n/.yolo-twice/sessions/mine/\n/.yolo-twice/sessions/pending/\n# yolo-twice: end\n",
    );
    fs.writeFileSync(path.join(r.store.dir, "local.json"), JSON.stringify({ attention: "balanced", visibility: { mine: "private", chosen: "shared", committed: "shared" } }));
    const s = new Store(r.root);
    const sharing = new SharingIndex(s, r.root, () => {}, () => {}, gh);

    expect(await sharing.refresh()).toMatchObject({ shares: false, migrated: { private: 3, kept: 1 } });
    expect(r.status()).toBe("");
    expect(fs.readFileSync(exclude, "utf8")).not.toContain("yolo-twice");
    expect(JSON.parse(fs.readFileSync(path.join(r.store.dir, "local.json"), "utf8"))).toEqual({ attention: "balanced", keep_private: ["mine"] });
    expect(["mine", "pending", "chosen", "committed"].map((id) => s.place(id))).toEqual(["private", "private", "private", "shared"]);

    // the project shares later: everything moves back except what was made private by choice
    writeSettings({ environment: "open" });
    expect(await sharing.refresh()).toMatchObject({ shares: true, private: 1 });
    expect(s.place("mine")).toBe("private");
    expect(s.place("pending")).toBe("shared");
    expect(r.status()).not.toContain("sessions/mine");
    expect(r.status()).toContain("sessions/pending/events.ndjson");
    // and a new event of the kept session stays private too
    s.appendEvents("mine", [ev("mine", "m2")]);
    expect(fs.existsSync(r.shared("mine"))).toBe(false);
  });
});
