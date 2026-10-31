import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import { Engine } from "../src/server.js";
import { FIXTURE_SESSION, mainFile, tempFixture } from "../../../fixtures/helper.js";

const fx = tempFixture("engine");
process.env.YOLO_TWICE_HOME = fx.projectRoot + "/.home";
process.env.YOLO_TWICE_NO_LLM = "1";
let engine: Engine;
let base = "";
const project = fx.projectRoot;
const q = `project=${encodeURIComponent(project)}`;

beforeAll(async () => {
  engine = new Engine({ port: 0, persist: false, log: () => {}, project: { originDir: fx.originDir } });
  const port = await engine.listen();
  base = `http://127.0.0.1:${port}`;
});
afterAll(async () => {
  await engine.close();
  fx.cleanup();
});

describe("engine", () => {
  test("hook registers the project and ingests the fixture", async () => {
    const res = await fetch(`${base}/hook`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session_id: FIXTURE_SESSION, cwd: project, hook_event_name: "Stop", transcript_path: mainFile(fx.originDir) }) });
    expect(res.status).toBe(200);
    // debounce 300 ms
    await new Promise((r) => setTimeout(r, 700));
    const sessions = (await (await fetch(`${base}/api/sessions?${q}`)).json()) as { sessions: { id: string }[]; current?: string };
    expect(sessions.sessions.map((s) => s.id)).toEqual([FIXTURE_SESSION]);
    expect(sessions.current).toBe(FIXTURE_SESSION);
    const health = (await (await fetch(`${base}/health`)).json()) as { ok: boolean; projects: string[] };
    expect(health.ok).toBe(true);
    expect(health.projects).toEqual([project]);
  });

  test("graph, structure, events, search, config", async () => {
    const graph = await (await fetch(`${base}/api/sessions/${FIXTURE_SESSION}/graph?${q}&level=2`)).text();
    expect(graph.startsWith("flowchart")).toBe(true);
    expect(graph).toContain("rewind");
    const s = (await (await fetch(`${base}/api/sessions/${FIXTURE_SESSION}?${q}`)).json()) as { structure: { label: string }; events: number; graph: string };
    expect(s.structure.label).toBe("Add login endpoint and fix tests");
    expect(s.events).toBeGreaterThan(30);
    const ev = (await (await fetch(`${base}/api/sessions/${FIXTURE_SESSION}/events?${q}&limit=5`)).json()) as { events: { id: string }[]; next?: string };
    expect(ev.events.length).toBe(5);
    expect(ev.next).toBe(ev.events[4]!.id);
    const page2 = (await (await fetch(`${base}/api/sessions/${FIXTURE_SESSION}/events?${q}&limit=5&after=${ev.next}`)).json()) as { events: { id: string }[] };
    expect(page2.events[0]!.id).not.toBe(ev.events[0]!.id);
    const hits = (await (await fetch(`${base}/api/search?${q}&q=salt`)).json()) as { hits: { id: string }[] };
    expect(hits.hits.map((h) => h.id)).toContain("a7");
    // filters: listing without a query, kinds OR'd, tool codes, time window, project-wide
    const get = async (qs: string) => (await (await fetch(`${base}/api/search?${q}&${qs}`)).json()) as { hits: { id: string; kind: string }[]; tools: string[] };
    expect((await get("k=u")).hits.map((h) => h.id)).toEqual(["u1", "u7", "u9", "u12"]);
    expect((await get("k=e")).hits.map((h) => h.id)).toEqual(["u6"]);
    expect((await get("q=test&k=u")).hits.every((h) => h.kind === "user.prompt")).toBe(true);
    expect((await get("k=t:Bash")).tools[0]).toBe("Bash");
    expect((await get("k=u&to=2026-10-31T08:01:00.000Z")).hits.map((h) => h.id)).toEqual(["u1"]);
    expect((await get("q=")).hits).toEqual([]);
    // addressability: a project is reachable by its short key
    const projects = (await (await fetch(`${base}/api/projects`)).json()) as { key: string; root: string }[];
    expect(projects[0]!.key).toBe(projects[0]!.root.split("/").pop());
    const byKey = (await (await fetch(`${base}/api/sessions?project=${projects[0]!.key}`)).json()) as { sessions: unknown[] };
    expect(byKey.sessions.length).toBe(1);
    expect((await fetch(`${base}/api/sessions?project=nope`)).status).toBe(404);
    const cfg = (await (await fetch(`${base}/api/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ project, attention: "yolo" }) })).json()) as { attention: string };
    expect(cfg.attention).toBe("yolo");
    expect(((await (await fetch(`${base}/api/config?${q}`)).json()) as { attention: string }).attention).toBe("yolo");
    const bad = await fetch(`${base}/api/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ project, attention: "nope" }) });
    expect(bad.status).toBe(400);
  });

  test("on-demand text and digest", async () => {
    const art = (await (await fetch(`${base}/api/sessions/${FIXTURE_SESSION}/text`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project, node: "t1", granularity: "title" }) })).json()) as { node: string; analyzer: string; text: string };
    expect(art.node).toBe("t1");
    expect(art.analyzer).toBe("structural");
    expect(art.text.length).toBeGreaterThan(0);
    const d = (await (await fetch(`${base}/api/sessions/${FIXTURE_SESSION}/digest?${q}&since=a12`)).json()) as { events: number; text: string; until: string };
    expect(d.events).toBeGreaterThan(2);
    expect(d.text).toContain("changelog");
  });

  test("SSE receives structure after the transcript grows", async () => {
    const ctrl = new AbortController();
    const res = await fetch(`${base}/api/stream?${q}`, { signal: ctrl.signal });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const waitFor = (event: string, ms: number) =>
      new Promise<boolean>((resolve) => {
        const t = setTimeout(() => resolve(false), ms);
        const pump = (): void => {
          void reader.read().then(({ value, done }) => {
            if (done) return resolve(false);
            buf += dec.decode(value);
            if (buf.includes(`event: ${event}`)) {
              clearTimeout(t);
              return resolve(true);
            }
            pump();
          });
        };
        pump();
      });
    expect(await waitFor("hello", 1000)).toBe(true);
    const line = JSON.stringify({ parentUuid: "a14", isSidechain: false, type: "user", message: { role: "user", content: "One more thing: bump the version" }, uuid: "u99", timestamp: "2026-10-31T09:30:00.000Z", sessionId: FIXTURE_SESSION, cwd: "/tmp/yolo-demo", version: "2.1.316" });
    fs.appendFileSync(mainFile(fx.originDir), line + "\n");
    const start = Date.now();
    expect((await waitFor("structure", 2000)) || buf.includes("event: structure")).toBe(true);
    expect(Date.now() - start).toBeLessThan(2000);
    ctrl.abort();
    const ev = (await (await fetch(`${base}/api/sessions/${FIXTURE_SESSION}/events?${q}&after=u13&limit=100`)).json()) as { events: { id: string }[] };
    expect(ev.events.some((e) => e.id === "u99")).toBe(true);
  });
  test("serves the project's demo scripts by name, and nothing outside them", async () => {
    const dir = `${project}/.yolo-twice/demos`;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(`${dir}/pitch.json`, JSON.stringify({ steps: [{ view: "?v=m" }] }));
    const res = await fetch(`${base}/api/demos/pitch?${q}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ steps: [{ view: "?v=m" }] });
    expect((await fetch(`${base}/api/demos/missing?${q}`)).status).toBe(404);
    expect((await fetch(`${base}/api/demos/..%2Fconfig?${q}`)).status).toBe(400);
  });
  test("a rebuilt session gets a fresh search index (same ids, new content)", async () => {
    const q = `project=${encodeURIComponent(project)}`;
    const file = mainFile(fx.originDir);
    // rewrite the first prompt: the head hash changes, so the session is rebuilt from scratch
    const text = fs.readFileSync(file, "utf8").replace("Add a /login endpoint to the API", "Add a /signup endpoint to the API");
    fs.writeFileSync(file, text);
    await fetch(`${base}/hook`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session_id: FIXTURE_SESSION, cwd: project, hook_event_name: "Stop" }) });
    const deadline = Date.now() + 3000;
    let hits: { id: string }[] = [];
    while (Date.now() < deadline) {
      hits = ((await (await fetch(`${base}/api/search?${q}&q=signup&k=u`)).json()) as { hits: { id: string }[] }).hits;
      if (hits.length) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(hits.map((h) => h.id)).toEqual(["u1"]);
    const old = ((await (await fetch(`${base}/api/search?${q}&q=login&k=u`)).json()) as { hits: { id: string }[] }).hits;
    expect(old.map((h) => h.id)).not.toContain("u1");
  });
});
