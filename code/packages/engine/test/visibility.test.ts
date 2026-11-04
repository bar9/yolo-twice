import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Store } from "@yolo-twice/core";
import { AutoCommitter } from "../src/autocommit.js";
import { writeSettings } from "../src/state.js";
import { VisibilityIndex } from "../src/visibility.js";

const base = fs.mkdtempSync(path.join(os.tmpdir(), "yt-visibility-"));
process.env.YOLO_TWICE_HOME = path.join(base, "home");
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

let n = 0;
/** A fresh repo with one committed file and a store; sessions are added with `session()`. */
function repo() {
  const root = path.join(base, `r${++n}`);
  fs.mkdirSync(root);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  fs.writeFileSync(path.join(root, "app.ts"), "1\n");
  git("add", "app.ts");
  git("commit", "-q", "-m", "init");
  const store = new Store(root);
  store.ensure();
  const session = (id: string) => {
    fs.mkdirSync(store.sessionDir(id), { recursive: true });
    fs.writeFileSync(path.join(store.sessionDir(id), "events.ndjson"), "{}\n");
  };
  const events: [string, unknown][] = [];
  const gh = async (id: string) => (id === "github.com/bar9/public" ? "PUBLIC" : id === "github.com/acme/app" ? "INTERNAL" : undefined);
  const vis = new VisibilityIndex(store, root, (e, d) => events.push([e, d]), () => {}, gh);
  const untracked = () => git("status", "--porcelain", "--untracked-files=all");
  return { root, git, store, session, vis, events, untracked };
}

beforeEach(() => writeSettings({ environment: "restricted", restricted_remotes: [] }));

describe("session visibility", () => {
  test("restricted environment, public remote: a new session is private and git add -A cannot take it", async () => {
    const r = repo();
    r.git("remote", "add", "origin", "https://github.com/bar9/public.git");
    r.session("s1");
    r.vis.guard(["s1"]);
    // excluded before any refresh ran
    r.git("add", "-A");
    expect(r.git("diff", "--cached", "--name-only")).not.toContain("sessions/s1");
    const sharing = await r.vis.refresh();
    expect(sharing).toMatchObject({ environment: "restricted", class: "open", decidedBy: "origin", default: "private", prompt: true });
    expect(r.vis.of("s1")).toEqual({ visibility: "private", decided: false });
    expect(r.events.some(([e]) => e === "sharing")).toBe(true);
  });

  test("restricted remotes only: sessions are shared and auto-commit takes them", async () => {
    const r = repo();
    r.git("remote", "add", "origin", "git@github.com:acme/app.git");
    r.session("s1");
    r.vis.guard(["s1"]);
    expect(await r.vis.refresh()).toMatchObject({ class: "restricted", default: "shared", prompt: false });
    expect(r.vis.of("s1")?.visibility).toBe("shared");
    expect(r.untracked()).toContain("sessions/s1/events.ndjson");
  });

  test("auto-commit leaves undecided sessions out and commits a shared one", async () => {
    const r = repo();
    r.session("keep");
    r.session("share");
    r.vis.guard(["keep", "share"]);
    expect((await r.vis.refresh())?.class).toBe("none");
    expect(r.vis.of("keep")).toEqual({ visibility: "undecided", decided: false });
    await r.vis.decide("share", "shared");
    const ac = new AutoCommitter(r.root, r.store.dir, () => {}, () => {}, 60_000, async () => {
      await r.vis.refresh();
      return r.vis.excludedPaths();
    });
    ac.set(true);
    await ac.tick();
    for (let i = 0; i < 50 && !ac.get().lastCommit; i++) await new Promise((res) => setTimeout(res, 50));
    ac.stop();
    const files = r.git("show", "--name-only", "--format=", "HEAD");
    expect(files).toContain("sessions/share/events.ndjson");
    expect(files).not.toContain("sessions/keep");
    // the exclude block names the undecided session, never the shared one
    const exclude = fs.readFileSync(path.join(r.root, ".git", "info", "exclude"), "utf8");
    expect(exclude).toContain("/.yolo-twice/sessions/keep/");
    expect(exclude).not.toContain("sessions/share/");
  });

  test("an already committed session counts as shared; made private it leaves the index but stays on disk", async () => {
    const r = repo();
    r.git("remote", "add", "origin", "https://github.com/bar9/public.git");
    r.session("old");
    r.git("add", "-A");
    r.git("commit", "-q", "-m", "sessions");
    await r.vis.refresh();
    expect(r.vis.of("old")).toEqual({ visibility: "shared", decided: true });
    const res = await r.vis.decide("old", "private");
    expect(res.visibility).toBe("private");
    expect(res.warning).toContain("Earlier commits still contain this session");
    expect(r.git("ls-files", "--", ".yolo-twice/sessions/old")).toBe("");
    expect(fs.existsSync(path.join(r.store.sessionDir("old"), "events.ndjson"))).toBe(true);
    expect(r.store.readDecisions()).toEqual({ old: "private" });
    // the removal is not excluded from auto-commit: it is what stops sharing from here on
    expect(r.vis.excludedPaths()).toEqual([]);
  });

  test("adding a public remote later makes undecided sharing stricter and says so once", async () => {
    const r = repo();
    r.git("remote", "add", "origin", "git@github.com:acme/app.git");
    r.session("s1");
    await r.vis.refresh();
    expect(r.vis.of("s1")?.visibility).toBe("shared");
    r.git("remote", "add", "public", "https://github.com/bar9/public.git");
    await r.vis.refresh();
    expect(r.vis.of("s1")?.visibility).toBe("private");
    const alerts = r.events.filter(([e, d]) => e === "sharing" && (d as { alert: boolean }).alert);
    expect(alerts.length).toBe(1);
    await r.vis.refresh();
    expect(r.events.filter(([e, d]) => e === "sharing" && (d as { alert: boolean }).alert).length).toBe(1);
  });

  test("an open environment shares with any remote, and restricted_remotes patterns count as restricted", async () => {
    const r = repo();
    r.git("remote", "add", "origin", "https://gitlab.com/someone/thing.git");
    r.session("s1");
    expect((await r.vis.refresh())?.default).toBe("undecided");
    writeSettings({ restricted_remotes: ["gitlab.com/someone/*"] });
    expect(await r.vis.refresh()).toMatchObject({ class: "restricted", default: "shared" });
    writeSettings({ environment: "open", restricted_remotes: [] });
    expect(await r.vis.refresh()).toMatchObject({ environment: "open", class: "unknown", default: "shared", prompt: false });
  });

  test("outside a git repository there is nothing to decide", async () => {
    const root = path.join(base, "plain");
    fs.mkdirSync(root);
    const store = new Store(root);
    store.ensure();
    const vis = new VisibilityIndex(store, root, () => {}, () => {}, async () => undefined);
    vis.guard(["x"]);
    expect(await vis.refresh()).toBeUndefined();
    expect(vis.of("x")).toBeUndefined();
  });
});
