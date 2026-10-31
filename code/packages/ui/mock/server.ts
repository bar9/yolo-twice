/**
 * Mock engine for UI development: ingests the fixture session into a temp dir and serves
 * the API.md endpoints on 9656. Run with `bun run mock`. Replaced by @yolo-twice/engine.
 */
import fs from "node:fs";
import path from "node:path";
import { ingestProject, Store, type Attention, type Granularity } from "@yolo-twice/core";
import { parseCodes, deriveProject, deriveSession, findNode, nodeFullText, SearchIndex, StructuralSummarizer, TextCache, toMermaid, inputHash } from "@yolo-twice/analyzers";
import { FIXTURE_CWD, FIXTURE_SESSION, tempFixture } from "../../../fixtures/helper";

const fx = tempFixture("ui-mock");
const store = new Store(fx.projectRoot);
ingestProject({ cwd: FIXTURE_CWD, store, originDir: fx.originDir });
deriveSession(store, FIXTURE_SESSION);
deriveProject(store, "yolo-demo");
const search = new SearchIndex();
search.add(store.readEvents(FIXTURE_SESSION));
const summarizer = new StructuralSummarizer();
const listeners = new Set<(type: string, data: unknown) => void>();
const DIST = path.join(import.meta.dirname, "..", "dist");

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const broadcast = (type: string, data: unknown) => listeners.forEach((l) => l(type, data));
setInterval(() => broadcast("structure", { session: FIXTURE_SESSION }), 10_000);

Bun.serve({
  port: 9656,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    const p = url.pathname;
    const m = /^\/api\/sessions\/([^/]+)(?:\/(\w+))?$/.exec(p);

    if (p === "/health") return json({ ok: true, version: "mock", pid: process.pid, started: new Date().toISOString(), projects: [fx.projectRoot] });
    if (p === "/api/projects") return json([{ root: fx.projectRoot, slug: "-tmp-yolo-demo", name: "yolo-demo", sessions: 1 }]);
    if (p === "/api/sessions") return json({ ...store.readProjectIndex(), current: FIXTURE_SESSION });
    if (p === "/api/config" && req.method === "GET") return json(store.readConfig());
    if (p === "/api/config" && req.method === "PUT") {
      const body = (await req.json()) as { attention: Attention };
      const cfg = { ...store.readConfig(), attention: body.attention };
      store.writeConfig(cfg);
      broadcast("config", cfg);
      return json(cfg);
    }
    if (p === "/api/search") {
      // same semantics as the engine: empty query lists matches when a filter narrows it
      const q = url.searchParams.get("q") ?? "";
      const codes = parseCodes(url.searchParams.get("k"));
      if (!q.trim() && codes.length === 0) return json({ hits: [] });
      const sp = (k: string) => url.searchParams.get(k) || undefined;
      return json({ hits: search.search(q, { session: sp("session"), codes, from: sp("from"), to: sp("to"), limit: Number(sp("limit") ?? 50) }), tools: search.tools() });
    }
    if (p === "/api/stream") {
      const stream = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          const send = (type: string, data: unknown) => controller.enqueue(enc.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
          send("hello", { project: fx.projectRoot, version: "mock" });
          const l = (t: string, d: unknown) => send(t, d);
          listeners.add(l);
          const ping = setInterval(() => send("ping", {}), 25_000);
          req.signal.addEventListener("abort", () => {
            listeners.delete(l);
            clearInterval(ping);
            controller.close();
          });
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
    }
    if (p === "/hook" && req.method === "POST") return json({});
    if (m) {
      const [, id, sub] = m;
      if (id !== FIXTURE_SESSION) return json({ error: "unknown session" }, 404);
      const structure = store.readStructure(id)!;
      if (!sub) return json({ structure, graph: store.readGraph(id), events: store.readEvents(id).length, config: store.readConfig() });
      if (sub === "structure") return json(structure);
      if (sub === "graph") {
        const level = Number(url.searchParams.get("level") ?? 2) as 1 | 2 | 3;
        return new Response(toMermaid(structure, { level }), { headers: { "content-type": "text/plain" } });
      }
      if (sub === "events") {
        const all = store.readEvents(id);
        const after = url.searchParams.get("after");
        const start = after ? all.findIndex((e) => e.id === after) + 1 : 0;
        const limit = Number(url.searchParams.get("limit") ?? 500);
        const page = all.slice(start, start + limit);
        return json({ events: page, next: start + limit < all.length ? page.at(-1)?.id : undefined });
      }
      if (sub === "text" && req.method === "POST") {
        const body = (await req.json()) as { node: string; granularity: Exclude<Granularity, "full"> };
        const node = findNode(structure, body.node);
        if (!node) return json({ error: "unknown node" }, 404);
        const byId = new Map(store.readEvents(id).map((e) => [e.id, e]));
        const full = nodeFullText(node, byId);
        const text = await summarizer.summarize({ granularity: body.granularity, text: full, kind: node.kind, label: node.label });
        const artifact = { node: node.id, granularity: body.granularity, hash: inputHash(full, body.granularity, summarizer.name), analyzer: summarizer.name, version: "1", text, created: new Date().toISOString() };
        new TextCache(store.textDir(id)).put(artifact);
        setTimeout(() => broadcast("semantic", { session: id, node: node.id, granularity: body.granularity }), 50);
        return json(artifact);
      }
      if (sub === "digest") {
        const all = store.readEvents(id);
        const since = url.searchParams.get("since");
        const idx = since ? all.findIndex((e) => e.id === since) + 1 : 0;
        const fresh = all.slice(idx);
        const text = fresh.length ? `Since you last looked: ${fresh.length} events. ` + fresh.filter((e) => e.kind === "assistant.text").map((e) => e.text).join(" ").slice(0, 600) : "";
        return json({ since: since ?? undefined, until: all.at(-1)?.id ?? "", events: fresh.length, text });
      }
    }
    // static UI build
    if (fs.existsSync(DIST)) {
      const file = path.join(DIST, p === "/" ? "index.html" : p);
      if (fs.existsSync(file) && fs.statSync(file).isFile()) return new Response(Bun.file(file));
      return new Response(Bun.file(path.join(DIST, "index.html")));
    }
    return json({ error: "not found" }, 404);
  },
});
console.log(`mock engine on http://127.0.0.1:9656 (project ${fx.projectRoot})`);
