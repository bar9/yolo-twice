import { describe, expect, test } from "bun:test";
import { ingestProject, Store } from "@yolo-twice/core";
import { buildStructure } from "@yolo-twice/analyzers/structure";
import { SearchIndex } from "@yolo-twice/analyzers/search";
import { EMPTY, isNavigation, parseUrl, resolveId, shortId, toUrl, type ViewState } from "../src/state";
import { computeScope, followTarget, latestLeaf, snapWindow } from "../src/scope";
import { FIXTURE_CWD, FIXTURE_SESSION, tempFixture } from "../../../fixtures/helper";

describe("URL state", () => {
  test("round trips every field and omits defaults", () => {
    const s: ViewState = { project: "yolo-twice", session: "34b27c", pinned: true, focus: "t1.s5", window: [120, 480], sel: "t2.s3", q: "salt & pepper", k: ["u", "t:Bash", "e"], z: "summary", follow: true };
    const url = toUrl(s);
    expect(url).toBe("/yolo-twice/34b27c/t1.s5?t=120-480&x=t2.s3&q=salt%20%26%20pepper&k=u,t:Bash,e&z=s&f");
    const [path, search] = url.split("?");
    expect(parseUrl(path!, `?${search}`)).toEqual(s);
    expect(toUrl(EMPTY)).toBe("/");
    expect(toUrl({ ...EMPTY, project: "p" })).toBe("/p");
    expect(toUrl({ ...EMPTY, project: "p", session: "abc123", pinned: false })).toBe("/p/~abc123");
    expect(parseUrl("/p/~abc123", "")).toMatchObject({ session: "abc123", pinned: false });
  });

  test("ignores garbage, reads legacy links", () => {
    const s = parseUrl("/p/s1", "?t=9-3&k=zz,u,,t:&z=nope");
    expect(s.window).toBeUndefined();
    expect(s.k).toEqual(["u"]);
    expect(s.z).toBe("abstract");
    expect(parseUrl("/", "?project=%2Fhome%2Fx%2Fyolo-twice&session=abc")).toMatchObject({ project: "yolo-twice", session: "abc" });
  });

  test("short ids, resolution, navigation vs tweak", () => {
    const ids = ["34b27ceb-1", "34b27cff-2", "99aa0011-3"];
    expect(shortId("34b27ceb-1", ids)).toBe("34b27ce");
    expect(shortId("99aa0011-3", ids)).toBe("99aa00");
    expect(resolveId("34b27ce", ids)).toBe("34b27ceb-1");
    expect(resolveId("34b27c", ids)).toBeUndefined();
    expect(isNavigation({ ...EMPTY, focus: "p1" }, { ...EMPTY, focus: "p2" })).toBe(true);
    expect(isNavigation({ ...EMPTY, q: "a" }, { ...EMPTY, q: "ab" })).toBe(false);
  });
});

function fixture() {
  const fx = tempFixture("ui");
  const store = new Store(fx.projectRoot);
  ingestProject({ cwd: FIXTURE_CWD, store, originDir: fx.originDir });
  const events = store.readEvents(FIXTURE_SESSION);
  const index = new SearchIndex();
  index.add(events);
  return { fx, root: buildStructure(FIXTURE_SESSION, events).session, index };
}

describe("scope", () => {
  test("focus re-roots graph and path; leaf focus draws its parent", () => {
    const { fx, root, index } = fixture();
    try {
      const s = computeScope(root, index, { focus: "p1", q: "", k: [] });
      expect(s.path.map((n) => n.id)).toEqual([root.id, "p1"]);
      expect(s.graphRoot.id).toBe("p1");
      expect(s.units.map((u) => u.node.id)).toEqual(["t1", "t2", "t3"]);
      const leaf = computeScope(root, index, { focus: "t1.s7", q: "", k: [] });
      expect(leaf.graphRoot.id).toBe("t1");
      expect(computeScope(root, index, { focus: "nope", q: "", k: [] }).focus.id).toBe(root.id);
    } finally {
      fx.cleanup();
    }
  });

  test("filters highlight inside the focus and count hits up the tree", () => {
    const { fx, root, index } = fixture();
    try {
      const errors = computeScope(root, index, { q: "", k: ["e"] });
      expect([...errors.matches]).toEqual(["u6"]);
      expect(errors.hits.get("t1")).toBe(1);
      expect(errors.hits.get(root.id)).toBe(1);
      expect(errors.dim.has("t2")).toBe(true);
      expect(errors.dim.has("t1")).toBe(false);
      const prompts = computeScope(root, index, { q: "", k: ["u"] });
      expect(prompts.matches.size).toBe(4);
      const inP2 = computeScope(root, index, { focus: "p2", q: "", k: ["u"] });
      expect([...inP2.matches]).toEqual(["u12"]);
      const rewinds = computeScope(root, index, { q: "", k: ["r"] });
      expect(rewinds.hits.has("t3")).toBe(true);
      expect(rewinds.hits.has("t1")).toBe(false);
      const none = computeScope(root, index, { q: "", k: [] });
      expect(none.active).toBe(false);
      expect(none.dim.size).toBe(0);
    } finally {
      fx.cleanup();
    }
  });

  test("window snaps to whole units and narrows matches", () => {
    const { fx, root, index } = fixture();
    try {
      const all = computeScope(root, index, { focus: "p1", q: "", k: ["u"] });
      // a window that touches only the middle of t1 snaps to all of t1
      const s = computeScope(root, index, { focus: "p1", window: [30, 40], q: "", k: ["u"] });
      expect([...s.inWindow]).toEqual(["t1"]);
      expect(s.window![0]).toBe(0);
      expect(s.window![1]).toBeGreaterThanOrEqual(115);
      expect([...s.matches]).toEqual(["u1"]);
      expect(s.dim.has("t2")).toBe(true);
      expect(all.matches.size).toBe(3);
      // a window covering everything is no window
      expect(snapWindow(all.units, all.focusStart, [0, 99999]).window).toBeUndefined();
    } finally {
      fx.cleanup();
    }
  });
});

describe("follow", () => {
  test("targets the newest leaf and keeps the focus level", () => {
    const { fx, root } = fixture();
    try {
      expect(latestLeaf(root).id).toBe("t4.s3");
      expect(followTarget(root, undefined)).toEqual({ sel: "t4.s3" });
      expect(followTarget(root, root)).toEqual({ sel: "t4.s3" });
      const t1 = root.children[0]!.children[0]!;
      expect(followTarget(root, t1)).toEqual({ sel: "t4.s3", focus: "t4" });
      expect(followTarget(root, root.children[0]!)).toEqual({ sel: "t4.s3", focus: "p2" });
      expect(parseUrl("/p/s", "?f").follow).toBe(true);
      expect(parseUrl("/p/s", "").follow).toBe(false);
    } finally {
      fx.cleanup();
    }
  });
});
