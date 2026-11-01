import { afterAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { AuthorIndex, authorsOf, emailHash } from "../src/authors.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "yt-authors-"));
const dir = path.join(root, ".yolo-twice");
const file = path.join(dir, "sessions", "s1", "events.ndjson");
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const ev = (id: string) => JSON.stringify({ id, kind: "user.prompt", text: id }) + "\n";
const commitAs = (name: string, email: string) => git("-c", `user.name=${name}`, "-c", `user.email=${email}`, "commit", "-q", "-m", name, "--", ".yolo-twice");
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("authors", () => {
  test("no git repo: no runs", async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, ev("a1"));
    expect(await new AuthorIndex(dir).runs("s1")).toEqual([]);
  });

  test("blame gives one run per change of author, uncommitted lines are the local user's", async () => {
    git("init", "-q", "-b", "main");
    git("config", "user.name", "Local");
    git("config", "user.email", "Local@Example.com");
    const idx = new AuthorIndex(dir);

    // not committed at all yet: the whole session is the local user's
    expect(await idx.runs("s1")).toEqual([{ name: "Local", email_sha256: emailHash("local@example.com"), first: "a1", last: "a1", uncommitted: true }]);

    fs.writeFileSync(file, ev("a1") + ev("a2"));
    git("add", ".yolo-twice");
    commitAs("Ann", "ann@example.com");
    fs.appendFileSync(file, ev("b1") + ev("b2"));
    commitAs("Bob", "bob@example.com");
    fs.appendFileSync(file, ev("c1"));

    const runs = await idx.runs("s1");
    expect(runs).toEqual([
      { name: "Ann", email_sha256: emailHash("ann@example.com"), first: "a1", last: "a2" },
      { name: "Bob", email_sha256: emailHash("bob@example.com"), first: "b1", last: "b2" },
      { name: "Local", email_sha256: emailHash("local@example.com"), first: "c1", last: "c1", uncommitted: true },
    ]);
    expect(authorsOf(runs).map((a) => a.name)).toEqual(["Ann", "Bob", "Local"]);
    expect(await idx.runs("missing")).toEqual([]);
  });
});
