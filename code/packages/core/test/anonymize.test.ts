import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import { anonymizePaths, expandPaths, ingestProject, mapStrings, Store } from "../src/index.js";
import { FIXTURE_CWD, FIXTURE_SESSION, tempFixture } from "../../../fixtures/helper.js";

const ctx = { root: "/home/alice/git/repo", home: "/home/alice", user: "alice" };

describe("anonymizePaths", () => {
  test("project root, home, slugs, other homes, login name", () => {
    const a = (s: string) => anonymizePaths(s, ctx);
    expect(a("/home/alice/git/repo/code/x.ts")).toBe("$PROJECT/code/x.ts");
    expect(a("cd /home/alice/git/repo && ls")).toBe("cd $PROJECT && ls");
    expect(a('{"file_path":"/home/alice/git/repo/README.md"}')).toBe('{"file_path":"$PROJECT/README.md"}');
    expect(a("/home/alice/.claude/settings.json")).toBe("~/.claude/settings.json");
    expect(a("/home/alice/.claude/projects/-home-alice-git-repo/abc.jsonl")).toBe("~/.claude/projects/<project-slug>/abc.jsonl");
    expect(a("/tmp/claude-1000/-home-alice-git-other/scratch")).toBe("/tmp/claude-1000/-~-git-other/scratch");
    expect(a("/home/bob/yolo/x and /Users/carol/src/y")).toBe("~/yolo/x and ~/src/y");
    expect(a("drwxr-x 2 alice alice 4096 x")).toBe("drwxr-x 2 <user> <user> 4096 x");
  });

  test("boundaries: lookalike paths and names stay untouched", () => {
    const a = (s: string) => anonymizePaths(s, ctx);
    expect(a("/home/alice/git/repo-old/x")).toBe("~/git/repo-old/x");
    expect(a("/home/alice2/x")).toBe("~/x"); // another user's home: generic rule, never alice's name
    expect(a("alicesmith and alice.cooper and alice@example.com")).toBe("alicesmith and alice.cooper and alice@example.com");
    expect(a("the user root ran it")).toBe("the user root ran it");
    // short or common login names are not replaced as bare words
    expect(anonymizePaths("dev server for dev", { root: "/home/dev/p", home: "/home/dev", user: "dev" })).toBe("dev server for dev");
    expect(anonymizePaths("yolo mode", { root: "/r", home: "/home/yolo", user: "yolo" })).toBe("yolo mode");
  });

  test("round trip for the resumer: $PROJECT and ~ expand to absolute paths", () => {
    const s = 'Read {"file_path":"/home/alice/git/repo/a.ts"} then cat /home/alice/.bashrc; see ~/notes';
    const anon = anonymizePaths(s, ctx);
    expect(anon).not.toContain("/home/alice");
    expect(expandPaths(anon, ctx)).toBe(s.replace("~/notes", "/home/alice/notes"));
    // a teammate's clone location
    expect(expandPaths(anon, { root: "/home/bob/repo", home: "/home/bob" })).toBe('Read {"file_path":"/home/bob/repo/a.ts"} then cat /home/bob/.bashrc; see /home/bob/notes');
    // tilde that is not a path stays
    expect(expandPaths("about ~5 minutes, ~~strike~~", ctx)).toBe("about ~5 minutes, ~~strike~~");
  });

  test("mapStrings reaches nested data", () => {
    expect(mapStrings({ a: "/home/alice/x", b: [1, "/home/alice/git/repo/y"] }, (s) => anonymizePaths(s, ctx))).toEqual({ a: "~/x", b: [1, "$PROJECT/y"] });
  });
});

describe("ingest writes portable paths", () => {
  test("fixture paths become $PROJECT, home and login vanish, origin_dir is portable", () => {
    const fx = tempFixture("an");
    try {
      const store = new Store(fx.projectRoot);
      const home = fx.originDir.replace(/\/claude\/projects\/.*$/, ""); // temp base plays the home folder
      ingestProject({ cwd: FIXTURE_CWD, store, originDir: fx.originDir, paths: { home, user: "yolouser" } });
      const raw = fs.readFileSync(store.eventsFile(FIXTURE_SESSION), "utf8");
      expect(raw).not.toContain("/tmp/yolo-demo");
      expect(raw).toContain("$PROJECT/src/routes/auth.ts");
      const src = store.readSourceState(FIXTURE_SESSION)!;
      expect(src.origin_dir.startsWith("~/claude/projects")).toBe(true);
      expect(src.normalizer).toBe(3);
      // data strings are processed too: a tool description with a path
      const desc = store.readEvents(FIXTURE_SESSION).find((e) => e.data?.description)!;
      expect(typeof desc.data!.description).toBe("string");
    } finally {
      fx.cleanup();
    }
  });

  test("redaction.paths=false keeps absolute paths", () => {
    const fx = tempFixture("an2");
    try {
      const store = new Store(fx.projectRoot);
      store.ensure();
      const cfg = store.readConfig();
      store.writeConfig({ ...cfg, redaction: { ...cfg.redaction, paths: false } });
      ingestProject({ cwd: FIXTURE_CWD, store, originDir: fx.originDir });
      expect(fs.readFileSync(store.eventsFile(FIXTURE_SESSION), "utf8")).toContain("/tmp/yolo-demo/src");
    } finally {
      fx.cleanup();
    }
  });
});
