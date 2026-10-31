import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { serve, type ServerType } from "@hono/node-server";
import { Attention, findProjectRoot, projectSlug } from "@yolo-twice/core";
import { ProjectRuntime, type ProjectOptions } from "./project.js";
import { readProjects, VERSION, writeProjects } from "./state.js";

export interface EngineOptions {
  port?: number;
  hostname?: string;
  log?: (msg: string) => void;
  project?: ProjectOptions; // applied to every project (tests)
  persist?: boolean; // persist registered projects to ~/.yolo-twice/projects.json
}

interface Client {
  project: string;
  send: (event: string, data: unknown) => void;
  end: () => void;
}

export class Engine {
  readonly app = new Hono();
  readonly projects = new Map<string, ProjectRuntime>();
  readonly started = new Date().toISOString();
  private clients = new Set<Client>();
  private server: ServerType | undefined;
  private lastRegistered: string | undefined;
  readonly log: (msg: string) => void;

  constructor(private readonly opts: EngineOptions = {}) {
    this.log = opts.log ?? ((m) => console.error(`[yolo-twice] ${m}`));
    this.routes();
  }

  /* ---------- projects ---------- */

  register(cwd: string): ProjectRuntime {
    const root = findProjectRoot(cwd);
    let rt = this.projects.get(root);
    if (!rt) {
      rt = new ProjectRuntime(root, (event, data) => this.broadcast(root, event, data), { ...this.opts.project, log: this.log });
      this.projects.set(root, rt);
      rt.start();
      if (this.opts.persist !== false) writeProjects([...readProjects(), root]);
      this.log(`registered project ${root}`);
    }
    this.lastRegistered = root;
    return rt;
  }

  private resolve(project: string | undefined): ProjectRuntime | undefined {
    if (project) return this.projects.get(path.resolve(project)) ?? this.projects.get(findProjectRoot(project));
    const root = this.lastRegistered ?? [...this.projects.keys()].at(-1);
    return root ? this.projects.get(root) : undefined;
  }

  private broadcast(project: string, event: string, data: unknown): void {
    for (const c of this.clients) if (c.project === project) c.send(event, data);
  }

  /* ---------- routes ---------- */

  private routes(): void {
    const app = this.app;
    const info = (rt: ProjectRuntime) => ({ root: rt.root, slug: projectSlug(rt.root), name: rt.name, sessions: rt.store.listSessions().length });
    const need = (project: string | undefined) => {
      const rt = this.resolve(project);
      if (!rt) throw new NotFound("project not registered");
      return rt;
    };

    app.onError((err, c) => {
      if (err instanceof NotFound) return c.json({ error: err.message }, 404);
      this.log(`error ${c.req.method} ${c.req.path}: ${err.message}`);
      return c.json({ error: err.message }, 500);
    });

    app.get("/health", (c) => c.json({ ok: true, version: VERSION, pid: process.pid, started: this.started, projects: [...this.projects.keys()] }));

    app.get("/api/projects", (c) => c.json([...this.projects.values()].map(info)));
    app.post("/api/projects", async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as { cwd?: string };
      if (!body.cwd) return c.json({ error: "cwd required" }, 400);
      const rt = this.register(body.cwd);
      rt.ingest();
      return c.json(info(rt));
    });

    app.get("/api/sessions", (c) => {
      const rt = need(c.req.query("project"));
      const index = rt.store.readProjectIndex() ?? { version: 1 as const, project: rt.name, sessions: [] };
      return c.json({ ...index, current: rt.currentSession() });
    });

    app.get("/api/sessions/:id", (c) => {
      const rt = need(c.req.query("project"));
      const id = c.req.param("id");
      const structure = rt.store.readStructure(id);
      if (!structure) throw new NotFound("session not found");
      return c.json({ structure, graph: rt.store.readGraph(id, 2) ?? "", events: rt.store.readEvents(id).length, config: rt.config() });
    });

    app.get("/api/sessions/:id/structure", (c) => {
      const rt = need(c.req.query("project"));
      const s = rt.store.readStructure(c.req.param("id"));
      if (!s) throw new NotFound("session not found");
      return c.json(s);
    });

    app.get("/api/sessions/:id/graph", (c) => {
      const rt = need(c.req.query("project"));
      const level = Number(c.req.query("level") ?? 2);
      const g = rt.store.readGraph(c.req.param("id"), level === 2 ? 2 : level);
      if (g === undefined) throw new NotFound("graph not found");
      return c.text(g);
    });

    app.get("/api/sessions/:id/events", (c) => {
      const rt = need(c.req.query("project"));
      const all = rt.store.readEvents(c.req.param("id"));
      const after = c.req.query("after");
      const limit = Math.max(1, Number(c.req.query("limit") ?? 500));
      const start = after ? all.findIndex((e) => e.id === after) + 1 : 0;
      const events = all.slice(start, start + limit);
      const next = start + limit < all.length ? events.at(-1)?.id : undefined;
      return c.json({ events, next });
    });

    app.post("/api/sessions/:id/text", async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as { project?: string; node?: string; granularity?: string };
      const rt = need(body.project);
      const g = body.granularity;
      if (!body.node || (g !== "title" && g !== "abstract" && g !== "summary")) return c.json({ error: "node and granularity (title|abstract|summary) required" }, 400);
      const result = await Promise.race([
        rt.text(c.req.param("id"), body.node, g),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("summarization timed out")), 120_000)),
      ]);
      if (!result) throw new NotFound("node not found");
      return c.json(result);
    });

    app.get("/api/sessions/:id/digest", async (c) => {
      const rt = need(c.req.query("project"));
      return c.json(await rt.digest(c.req.param("id"), c.req.query("since")));
    });

    app.get("/api/search", (c) => {
      const rt = need(c.req.query("project"));
      const q = c.req.query("q") ?? "";
      if (!q.trim()) return c.json({ hits: [] });
      return c.json({ hits: rt.search.search(q, { session: c.req.query("session"), limit: Number(c.req.query("limit") ?? 50) }) });
    });

    app.get("/api/config", (c) => c.json(need(c.req.query("project")).config()));
    app.put("/api/config", async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as { project?: string; attention?: string };
      const parsed = Attention.safeParse(body.attention);
      if (!parsed.success) return c.json({ error: "attention must be micro|attentive|balanced|yolo" }, 400);
      return c.json(need(body.project).setAttention(parsed.data));
    });

    app.get("/api/stream", (c) => {
      const rt = need(c.req.query("project"));
      return streamSSE(c, async (stream) => {
        let id = 0;
        let done!: () => void;
        const finished = new Promise<void>((resolve) => (done = resolve));
        const client: Client = {
          project: rt.root,
          send: (event, data) => void stream.writeSSE({ event, data: JSON.stringify(data), id: String(++id) }).catch(() => done()),
          end: () => done(),
        };
        this.clients.add(client);
        client.send("hello", { project: rt.root, version: VERSION });
        const ping = setInterval(() => client.send("ping", {}), 25_000);
        stream.onAbort(() => done());
        await finished;
        clearInterval(ping);
        this.clients.delete(client);
      });
    });

    app.post("/hook", async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as { session_id?: string; cwd?: string; hook_event_name?: string; transcript_path?: string };
      const cwd = body.cwd ?? (body.transcript_path ? undefined : undefined);
      if (cwd) {
        const rt = this.register(cwd);
        this.broadcast(rt.root, "hook", { hook_event_name: body.hook_event_name, session_id: body.session_id });
        rt.schedule(`hook:${body.hook_event_name}`, body.session_id);
      }
      return c.json({});
    });

    // UI
    const uiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "ui", "dist");
    const index = path.join(uiDir, "index.html");
    app.get("/*", (c) => {
      const p = c.req.path === "/" ? "/index.html" : c.req.path;
      const file = path.join(uiDir, path.normalize(p).replace(/^(\.\.[/\\])+/, ""));
      if (fs.existsSync(index)) {
        const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : index;
        return c.body(fs.readFileSync(target), 200, { "content-type": mime(target) });
      }
      const rt = this.resolve(undefined);
      const q = rt ? `?project=${encodeURIComponent(rt.root)}` : "";
      return c.html(
        `<!doctype html><title>yolo-twice</title><body style="font-family:system-ui;padding:2rem"><h1>yolo-twice engine</h1><p>The web UI is not built. Run <code>bun run --filter @yolo-twice/ui build</code>.</p><ul><li><a href="/health">/health</a></li><li><a href="/api/projects">/api/projects</a></li><li><a href="/api/sessions${q}">/api/sessions</a></li></ul></body>`,
      );
    });
  }

  /* ---------- lifecycle ---------- */

  async listen(): Promise<number> {
    const port = this.opts.port ?? 9656;
    const hostname = this.opts.hostname ?? "127.0.0.1";
    const actual = await new Promise<number>((resolve, reject) => {
      this.server = serve({ fetch: this.app.fetch, port, hostname }, (addr) => resolve(addr.port));
      this.server.on("error", reject);
    });
    for (const root of this.opts.persist === false ? [] : readProjects()) if (fs.existsSync(root)) this.register(root);
    return actual;
  }

  async close(): Promise<void> {
    for (const rt of this.projects.values()) await rt.stop();
    for (const c of this.clients) c.end();
    this.clients.clear();
    const srv = this.server as (ServerType & { closeAllConnections?: () => void }) | undefined;
    srv?.closeAllConnections?.();
    await new Promise<void>((resolve) => (srv ? srv.close(() => resolve()) : resolve()));
  }
}

class NotFound extends Error {}

function mime(file: string): string {
  const ext = path.extname(file);
  return (
    { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".map": "application/json" }[ext] ??
    "application/octet-stream"
  );
}
