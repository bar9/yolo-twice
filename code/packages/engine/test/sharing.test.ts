import { afterAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { classifyRemotes, defaultVisibility, matchRemote, parseRemotes, projectClass, remoteId, writeExcludeBlock } from "../src/sharing.js";

describe("remote ids and patterns", () => {
  test("normalizes ssh, https and local remotes", () => {
    expect(remoteId("git@github.com:bar9/yolo-twice.git")).toEqual({ id: "github.com/bar9/yolo-twice", local: false });
    expect(remoteId("https://user@GitHub.com/bar9/yolo-twice")).toEqual({ id: "github.com/bar9/yolo-twice", local: false });
    expect(remoteId("ssh://git@git.acme.example:2222/team/app.git")).toEqual({ id: "git.acme.example/team/app", local: false });
    expect(remoteId("/srv/git/app.git").local).toBe(true);
    expect(remoteId("../app").local).toBe(true);
  });

  test("a host, an owner prefix or a full repository", () => {
    expect(matchRemote("git.acme.example", "git.acme.example/team/app")).toBe(true);
    expect(matchRemote("github.com/acme-*", "github.com/acme-core/app")).toBe(true);
    expect(matchRemote("github.com/acme-*", "github.com/bar9/yolo-twice")).toBe(false);
    expect(matchRemote("github.com/acme/*", "github.com/acme/app")).toBe(true);
    expect(matchRemote("https://github.com/acme/app.git", "github.com/acme/app")).toBe(true);
    expect(matchRemote("github.com", "gitlab.com/acme/app")).toBe(false);
    expect(matchRemote("git.acme.example", "git.acme.example.evil.com/x/y")).toBe(false);
  });

  test("the push URL wins over the fetch URL", () => {
    const out = "origin\thttps://github.com/a/b (fetch)\norigin\tgit@git.acme.example:a/b (push)\nup\t/srv/up (fetch)\nup\t/srv/up (push)\n";
    expect(parseRemotes(out)).toEqual([
      { name: "origin", url: "git@git.acme.example:a/b" },
      { name: "up", url: "/srv/up" },
    ]);
  });
});

describe("classification", () => {
  const gh = async (id: string) => ({ "github.com/bar9/yolo-twice": "PUBLIC", "github.com/acme/app": "INTERNAL" })[id];

  test("patterns first, then gh, else unknown; the riskiest remote decides", async () => {
    const remotes = await classifyRemotes(
      [
        { name: "origin", url: "git@github.com:acme/app.git" },
        { name: "corp", url: "https://git.acme.example/x/y" },
        { name: "pub", url: "https://github.com/bar9/yolo-twice" },
        { name: "other", url: "https://gitlab.com/x/y" },
      ],
      ["git.acme.example"],
      gh,
    );
    expect(remotes.map((r) => [r.name, r.class, r.by])).toEqual([
      ["origin", "restricted", "gh"],
      ["corp", "restricted", "pattern"],
      ["pub", "open", "gh"],
      ["other", "unknown", "none"],
    ]);
    expect(projectClass(remotes)).toEqual({ class: "open", decidedBy: "pub" });
    expect(projectClass(remotes.filter((r) => r.name !== "pub"))).toEqual({ class: "unknown", decidedBy: "other" });
    expect(projectClass([])).toEqual({ class: "none", decidedBy: undefined });
  });

  test("a failing gh lookup is unknown, not an error", async () => {
    const [r] = await classifyRemotes([{ name: "o", url: "https://github.com/a/b" }], [], async () => {
      throw new Error("offline");
    });
    expect(r!.class).toBe("unknown");
  });

  test("the default table", () => {
    expect(defaultVisibility("open", "open")).toBe("shared");
    expect(defaultVisibility("open", "unknown")).toBe("shared");
    expect(defaultVisibility("restricted", "restricted")).toBe("shared");
    expect(defaultVisibility("restricted", "open")).toBe("private");
    expect(defaultVisibility("restricted", "unknown")).toBe("undecided");
    expect(defaultVisibility("open", "none")).toBe("undecided");
    expect(defaultVisibility("restricted", "none")).toBe("undecided");
  });
});

describe("exclude block", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yt-exclude-"));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "info", "exclude");

  test("keeps the user's own lines and replaces only its block", () => {
    fs.mkdirSync(path.dirname(file));
    fs.writeFileSync(file, "# git ls-files --others --exclude-from=.git/info/exclude\n*.log\n");
    expect(writeExcludeBlock(file, ["/.yolo-twice/sessions/b/", "/.yolo-twice/sessions/a/"])).toBe(true);
    const once = fs.readFileSync(file, "utf8");
    expect(once).toContain("*.log\n");
    expect(once.indexOf("sessions/a/")).toBeLessThan(once.indexOf("sessions/b/"));
    expect(writeExcludeBlock(file, ["/.yolo-twice/sessions/a/", "/.yolo-twice/sessions/b/"])).toBe(false);
    writeExcludeBlock(file, ["/.yolo-twice/sessions/c/"]);
    const twice = fs.readFileSync(file, "utf8");
    expect(twice).not.toContain("sessions/a/");
    expect(twice.match(/yolo-twice: end/g)?.length).toBe(1);
    writeExcludeBlock(file, []);
    expect(fs.readFileSync(file, "utf8")).toBe("# git ls-files --others --exclude-from=.git/info/exclude\n*.log\n");
  });
});
