import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { ingestProject, Store } from "@yolo-twice/core";
import { buildStructure, deriveProject, deriveSession, findNode, isOpenNode, summarizeNode, TextCache, type Summarizer } from "../src/index.js";
import { FIXTURE_CWD, FIXTURE_SESSION, tempFixture } from "../../../fixtures/helper.js";

/** Every committed file below .yolo-twice, relative, excluding what .gitignore keeps out. */
function committed(store: Store): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const rel = path.relative(store.dir, p);
      if (["cache", "engine.json", "local.json"].includes(rel.split(path.sep)[0]!)) continue;
      if (e.isDirectory()) walk(p);
      else out.push(rel);
    }
  };
  walk(store.dir);
  return out.sort();
}

describe("one writer per committed file", () => {
  test("only per-session files and team config are committed; aggregates and machine state are local", () => {
    const fx = tempFixture("lay");
    try {
      const store = new Store(fx.projectRoot);
      ingestProject({ cwd: FIXTURE_CWD, store, originDir: fx.originDir });
      deriveSession(store, FIXTURE_SESSION);
      deriveProject(store, "demo");
      const files = committed(store);
      expect(files).toEqual([".gitignore", "config.json", ...["events.ndjson", "graph.L1.mmd", "graph.mmd", "meta.json", "structure.json"].map((f) => path.join("sessions", FIXTURE_SESSION, f))]);
      expect(fs.readFileSync(path.join(store.dir, ".gitignore"), "utf8")).toContain("local.json");
      expect(fs.existsSync(store.sourceFile(FIXTURE_SESSION))).toBe(true);
      expect(fs.existsSync(store.projectIndexFile)).toBe(true);
      const meta = JSON.parse(fs.readFileSync(path.join(store.sessionDir(FIXTURE_SESSION), "meta.json"), "utf8"));
      expect(meta).toMatchObject({ id: FIXTURE_SESSION, label: "Add login endpoint and fix tests", cost_usd: 1.2345 });
    } finally {
      fx.cleanup();
    }
  });

  test("a fresh clone without cache still lists its sessions", () => {
    const fx = tempFixture("lay2");
    try {
      const store = new Store(fx.projectRoot);
      ingestProject({ cwd: FIXTURE_CWD, store, originDir: fx.originDir });
      deriveSession(store, FIXTURE_SESSION);
      fs.rmSync(path.join(store.dir, "cache"), { recursive: true });
      expect(new Store(fx.projectRoot).readProjectIndex()?.sessions.map((s) => s.id)).toEqual([FIXTURE_SESSION]);
    } finally {
      fx.cleanup();
    }
  });

  test("the first layout migrates: project.json removed, source.json moved, gitignore extended", () => {
    const fx = tempFixture("lay3");
    try {
      const store = new Store(fx.projectRoot);
      ingestProject({ cwd: FIXTURE_CWD, store, originDir: fx.originDir });
      // recreate the old layout
      const src = fs.readFileSync(store.sourceFile(FIXTURE_SESSION), "utf8");
      fs.rmSync(store.sourceFile(FIXTURE_SESSION));
      fs.writeFileSync(path.join(store.sessionDir(FIXTURE_SESSION), "source.json"), src);
      fs.writeFileSync(path.join(store.dir, "project.json"), "{}");
      fs.writeFileSync(path.join(store.dir, ".gitignore"), "# old\ncache/\nengine.json\n");
      const again = new Store(fx.projectRoot);
      again.ensure();
      expect(fs.existsSync(path.join(store.dir, "project.json"))).toBe(false);
      expect(fs.existsSync(path.join(store.sessionDir(FIXTURE_SESSION), "source.json"))).toBe(false);
      expect(fs.readFileSync(again.sourceFile(FIXTURE_SESSION), "utf8")).toBe(src);
      expect(fs.readFileSync(path.join(store.dir, ".gitignore"), "utf8")).toBe("# old\ncache/\nengine.json\nlocal.json\n");
      // and the cursor still works: nothing new to ingest
      expect(ingestProject({ cwd: FIXTURE_CWD, store: again, originDir: fx.originDir }).changed).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("the attention slider is personal: local.json overrides config.json, which stays untouched", () => {
    const fx = tempFixture("lay4");
    try {
      const store = new Store(fx.projectRoot);
      store.ensure();
      const team = fs.readFileSync(store.configFile, "utf8");
      store.writeLocalConfig({ attention: "yolo" });
      expect(store.readConfig().attention).toBe("yolo");
      expect(fs.readFileSync(store.configFile, "utf8")).toBe(team);
      expect(new Store(fx.projectRoot).readConfig().redaction.paths).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("summaries of live-tail nodes stay local; finished nodes are committed", async () => {
    const fx = tempFixture("lay5");
    try {
      const store = new Store(fx.projectRoot);
      ingestProject({ cwd: FIXTURE_CWD, store, originDir: fx.originDir });
      const events = store.readEvents(FIXTURE_SESSION);
      const root = buildStructure(FIXTURE_SESSION, events).session;
      const byId = new Map(events.map((e) => [e.id, e]));
      const cache = new TextCache(store.textDir(FIXTURE_SESSION), store.openTextDir(FIXTURE_SESSION));
      const fake: Summarizer = { name: "fake", summarize: async (i) => `${i.kind}:${i.granularity}` };
      const justAfter = Date.parse(root.span.ts_last) + 60_000;
      const t1 = findNode(root, "t1")!;
      const t4 = findNode(root, "t4")!;
      expect(isOpenNode(t1, root, justAfter)).toBe(false);
      expect(isOpenNode(t4, root, justAfter)).toBe(true);
      expect(isOpenNode(root, root, justAfter)).toBe(true);
      expect(isOpenNode(t4, root, justAfter + 31 * 60_000)).toBe(false); // idle: the tail counts as finished
      await summarizeNode({ node: t1, granularity: "title", interim: false, open: isOpenNode(t1, root, justAfter) }, byId, cache, fake);
      await summarizeNode({ node: t4, granularity: "title", interim: false, open: isOpenNode(t4, root, justAfter) }, byId, cache, fake);
      expect(fs.readdirSync(store.textDir(FIXTURE_SESSION))).toEqual([expect.stringMatching(/^t1\.title\./)]);
      expect(fs.readdirSync(store.openTextDir(FIXTURE_SESSION))).toEqual([expect.stringMatching(/^t4\.title\./)]);
      // both are visible to readers
      expect(cache.latest("t4").title?.text).toBe("turn:title");
      // a reset clears the local copies too
      store.resetSession(FIXTURE_SESSION);
      expect(fs.existsSync(store.openTextDir(FIXTURE_SESSION))).toBe(false);
    } finally {
      fx.cleanup();
    }
  });
});
