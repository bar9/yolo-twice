import { afterAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { AutoCommitter, type AutoCommitStatus } from "../src/autocommit.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "yt-autocommit-"));
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const dir = path.join(root, ".yolo-twice");
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("auto-commit", () => {
  test("commits only .yolo-twice and leaves the user's index alone", async () => {
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "t");
    fs.writeFileSync(path.join(root, "app.ts"), "1\n");
    git("add", "app.ts");
    git("commit", "-q", "-m", "init");

    fs.mkdirSync(path.join(dir, "sessions", "s1"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".gitignore"), "cache/\n");
    fs.writeFileSync(path.join(dir, "sessions", "s1", "events.ndjson"), "{}\n");
    fs.mkdirSync(path.join(dir, "cache"));
    fs.writeFileSync(path.join(dir, "cache", "x"), "ignored");
    // the user's own work in progress: one staged, one unstaged change
    fs.writeFileSync(path.join(root, "app.ts"), "2\n");
    git("add", "app.ts");
    fs.writeFileSync(path.join(root, "other.ts"), "wip\n");

    const seen: AutoCommitStatus[] = [];
    const ac = new AutoCommitter(root, dir, (s) => seen.push(s), () => {}, 60_000);
    expect(ac.get().enabled).toBe(false);
    ac.set(true);
    await ac.tick(); // the immediate tick from set() may still be running; this one waits for nothing or commits nothing
    for (let i = 0; i < 50 && !ac.get().lastCommit; i++) await new Promise((r) => setTimeout(r, 50));
    ac.stop();

    const st = ac.get();
    expect(st.enabled).toBe(true);
    expect(Date.parse(st.next!) - Date.now()).toBeGreaterThan(55_000);
    expect(st.lastCommit?.files).toBe(2);
    expect(git("show", "--name-only", "--format=", "HEAD").split("\n").sort()).toEqual([".yolo-twice/.gitignore", ".yolo-twice/sessions/s1/events.ndjson"]);
    expect(git("diff", "--cached", "--name-only")).toBe("app.ts");
    expect(git("status", "--porcelain", "--", ".yolo-twice")).toBe("");
    expect(seen.at(-1)?.lastCommit?.sha).toBe(git("rev-parse", "--short", "HEAD"));

    // nothing changed: no new commit
    const head = git("rev-parse", "HEAD");
    await ac.tick();
    expect(git("rev-parse", "HEAD")).toBe(head);
    const off = ac.set(false);
    expect(off.enabled).toBe(false);
    expect(off.next).toBeUndefined();
  });

  test("skips outside a git repository", async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "yt-nogit-"));
    const ac = new AutoCommitter(plain, path.join(plain, ".yolo-twice"), () => {}, () => {}, 60_000);
    ac.set(true);
    for (let i = 0; i < 50 && !ac.get().lastCheck; i++) await new Promise((r) => setTimeout(r, 50));
    ac.stop();
    expect(ac.get().skipped).toBe("not a git repository");
    fs.rmSync(plain, { recursive: true, force: true });
  });
});
