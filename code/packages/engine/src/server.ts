import { parseCodes } from "@yolo-twice/analyzers";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono, type Context, type Next } from "hono";
import { streamSSE } from "hono/streaming";
import { serve, type ServerType } from "@hono/node-server";
import { sha256, Attention, findProjectRoot, isSafeSessionId, projectSlug } from "@yolo-twice/core";
import { activityFrom, type Activity, type HookPayload } from "./activity.js";
import { ProjectRuntime, type ProjectOptions } from "./project.js";
import { DEFAULT_HOST, isExposed, reachableAt, readProjects, VERSION, writeProjects, writeSettings } from "./state.js";

export interface EngineOptions {
  port?: number;
  hostname?: string;
  log?: (msg: string) => void;
  project?: ProjectOptions; // applied to every project (tests)
  persist?: boolean; // persist registered projects to ~/.yolo-twice/projects.json
  /** The address was given at start (--host or YOLO_TWICE_HOST): the UI shows it and cannot change it. */
  hostLock?: string;
  /** Called whenever the engine (re)starts listening, e.g. to record the address in engine.json. */
  onListen?: (host: string, port: number) => void;
}

export interface NetworkInfo {
  host: string;
  port: number;
  /** Other machines can reach it (any address but loopback). */
  exposed: boolean;
  /** The URLs to use from elsewhere. */
  urls: string[];
  /** Set at start by this switch; the UI is read-only then. */
  lockedBy?: string;
  /** Inside a container the addresses above are the container's own: reach it through the port published on the host. */
  container?: boolean;
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
  /** Per project, per session: what the hooks last said Claude is doing (sent to every page that connects). */
  private activity = new Map<string, Map<string, { session_id: string; activity: Activity; ts: string }>>();
  private server: ServerType | undefined;
  private lastRegistered: string | undefined;
  private uiWatcher: fs.FSWatcher | undefined;
  private uiTimer: NodeJS.Timeout | undefined;
  /** Published package ships the UI at <pkg>/ui; the monorepo has it at packages/ui/dist. */
  readonly uiDir: string;
  readonly log: (msg: string) => void;

  constructor(private readonly opts: EngineOptions = {}) {
    this.log = opts.log ?? ((m) => console.error(`[yolo-twice] ${m}`));
    const here = path.dirname(fileURLToPath(import.meta.url));
    this.uiDir = [path.resolve(here, "..", "ui"), path.resolve(here, "..", "..", "ui", "dist")].find((d) =>
      fs.existsSync(path.join(d, "index.html")),
    ) ?? path.resolve(here, "..", "..", "ui", "dist");
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

  /** Shortest URL key for a project: its folder name, or `name~abcd` when two projects share a name. */
  projectKey(root: string): string {
    const name = path.basename(root);
    const clash = [...this.projects.keys()].some((r) => r !== root && path.basename(r) === name);
    return clash ? `${name}~${sha256(root).slice(0, 4)}` : name;
  }

  private resolve(project: string | undefined): ProjectRuntime | undefined {
    if (project && !project.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(project)) {
      // a URL key: `name` or `name~hash`
      for (const root of this.projects.keys()) if (this.projectKey(root) === project || path.basename(root) === project) return this.projects.get(root);
      return undefined;
    }
    if (project) return this.projects.get(path.resolve(project)) ?? this.projects.get(findProjectRoot(project));
    const root = this.lastRegistered ?? [...this.projects.keys()].at(-1);
    return root ? this.projects.get(root) : undefined;
  }

  private broadcast(project: string, event: string, data: unknown): void {
    for (const c of this.clients) if (c.project === project) c.send(event, data);
  }

  /**
   * Identifies the running engine plus the UI bundle it serves. Clients reload when it changes:
   * after an engine restart (sent with `hello`) or a UI rebuild (sent as `build`).
   */
  build(): string {
    let ui = "none";
    try {
      ui = sha256(fs.readFileSync(path.join(this.uiDir, "index.html"), "utf8")).slice(0, 12);
    } catch {
      /* not built (yet) */
    }
    return `${this.started}/${ui}`;
  }

  /** Tell every client about a rebuilt UI. vite empties and rewrites dist, so wait until it settles. */
  private watchUi(): void {
    if (!fs.existsSync(this.uiDir)) return;
    let last = this.build();
    try {
      this.uiWatcher = fs.watch(this.uiDir, () => {
        clearTimeout(this.uiTimer);
        this.uiTimer = setTimeout(() => {
          const now = this.build();
          if (now === last || now.endsWith("/none")) return;
          last = now;
          for (const c of this.clients) c.send("build", { build: now });
        }, 500);
      });
    } catch {
      /* no fs.watch support: clients still reload after an engine restart */
    }
  }

  /* ---------- routes ---------- */

  private routes(): void {
    const app = this.app;
    const info = (rt: ProjectRuntime) => ({ root: rt.root, key: this.projectKey(rt.root), slug: projectSlug(rt.root), name: rt.name, sessions: rt.store.listSessions().length });
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

    app.get("/api/sessions", async (c) => {
      const rt = need(c.req.query("project"));
      const index = rt.store.readProjectIndex() ?? { version: 1 as const, project: rt.name, sessions: [] };
      const sessions = await Promise.all(index.sessions.map(async (s) => ({ ...s, authors: await rt.authors.authors(s.id) })));
      return c.json({ ...index, sessions, current: rt.currentSession() });
    });

    // the id becomes a path segment under .yolo-twice/sessions: refuse anything that could leave it
    const checkId = async (c: Context, next: Next) => {
      if (!isSafeSessionId(c.req.param("id") ?? "")) return c.json({ error: "invalid session id" }, 400);
      await next();
    };
    app.use("/api/sessions/:id", checkId);
    app.use("/api/sessions/:id/*", checkId);

    app.get("/api/sessions/:id", (c) => {
      const rt = need(c.req.query("project"));
      const id = c.req.param("id");
      const structure = rt.store.readStructure(id);
      if (!structure) throw new NotFound("session not found");
      return c.json({ structure, graph: rt.store.readGraph(id, 2) ?? "", events: rt.store.readEvents(id).length, config: rt.config() });
    });

    app.get("/api/sessions/:id/authors", async (c) => c.json(await need(c.req.query("project")).authors.runs(c.req.param("id"))));

    app.get("/api/sessions/:id/structure", (c) => {
      const rt = need(c.req.query("project"));
      const s = rt.store.readStructure(c.req.param("id"));
      if (!s) throw new NotFound("session not found");
      return c.json(s);
    });

    app.get("/api/sessions/:id/graph", (c) => {
      const rt = need(c.req.query("project"));
      const level = Number(c.req.query("level") ?? 2);
      if (!Number.isInteger(level)) return c.json({ error: "level must be an integer" }, 400);
      const g = rt.store.readGraph(c.req.param("id"), level);
      if (g === undefined) throw new NotFound("graph not found");
      return c.text(g);
    });

    app.get("/api/sessions/:id/images/:file", (c) => {
      const rt = need(c.req.query("project"));
      const file = rt.store.imageFile(c.req.param("id"), c.req.param("file"));
      if (!file) throw new NotFound("image not found");
      // content-addressed: the name changes when the bytes do
      return c.body(fs.readFileSync(file), 200, { "content-type": mime(file), "cache-control": "public, max-age=31536000, immutable" });
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
      let timer: NodeJS.Timeout | undefined;
      const result = await Promise.race([
        rt.text(c.req.param("id"), body.node, g),
        new Promise<never>((_, rej) => (timer = setTimeout(() => rej(new Error("summarization timed out")), 120_000))),
      ]).finally(() => clearTimeout(timer));
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
      const codes = parseCodes(c.req.query("k"));
      // an empty query lists matching events in order, but only when something narrows it
      if (!q.trim() && codes.length === 0) return c.json({ hits: [] });
      const filter = { session: c.req.query("session") || undefined, codes, from: c.req.query("from") || undefined, to: c.req.query("to") || undefined };
      return c.json({ hits: rt.search.search(q, { ...filter, limit: Number(c.req.query("limit") ?? 50) }), tools: rt.search.tools() });
    });

    // scripted demos live with the project's sessions: .yolo-twice/demos/<name>.json, played by the UI with ?demo=<name>
    app.get("/api/demos/:name", (c) => {
      const rt = need(c.req.query("project"));
      const name = c.req.param("name");
      if (!/^[\w-]+$/.test(name)) return c.json({ error: "a demo name is letters, digits, - and _" }, 400);
      const file = path.join(rt.store.dir, "demos", `${name}.json`);
      if (!fs.existsSync(file)) throw new NotFound("demo not found");
      return c.body(fs.readFileSync(file, "utf8"), 200, { "content-type": "application/json" });
    });

    // which interface the engine listens on; set at start (--host) it is shown, not changed
    app.get("/api/network", (c) => c.json(this.network()));
    app.put("/api/network", async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as { host?: string };
      if (this.opts.hostLock) return c.json({ error: `set by ${this.opts.hostLock} at start`, ...this.network() }, 409);
      const host = body.host?.trim();
      if (!host || !/^[\w.:-]+$/.test(host)) return c.json({ error: "host must be an address such as 127.0.0.1 or 0.0.0.0" }, 400);
      if (!localAddress(host)) return c.json({ error: `${host} is not an address of this machine; use 127.0.0.1, 0.0.0.0 or one of its interfaces`, ...this.network() }, 400);
      if (host === this.host) return c.json(this.network());
      // answer first: the change closes this very connection
      setTimeout(() => void this.rebind(host).catch(() => undefined), 50);
      return c.json({ ...this.network(), host, exposed: isExposed(host), urls: reachableAt(this.port, host) });
    });

    app.get("/api/config", (c) => c.json(need(c.req.query("project")).config()));
    app.put("/api/config", async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as { project?: string; attention?: string };
      const parsed = Attention.safeParse(body.attention);
      if (!parsed.success) return c.json({ error: "attention must be micro|attentive|balanced|yolo" }, 400);
      return c.json(need(body.project).setAttention(parsed.data));
    });

    // auto-commit of .yolo-twice: opt-in, engine memory only, off after every engine restart
    app.get("/api/autocommit", (c) => c.json(need(c.req.query("project")).autoCommit.get()));
    app.put("/api/autocommit", async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as { project?: string; enabled?: unknown };
      if (typeof body.enabled !== "boolean") return c.json({ error: "enabled (boolean) required" }, 400);
      return c.json(need(body.project).autoCommit.set(body.enabled));
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
        client.send("hello", { project: rt.root, version: VERSION, build: this.build() });
        for (const a of this.activity.get(rt.root)?.values() ?? []) client.send("activity", a);
        const ping = setInterval(() => client.send("ping", {}), 25_000);
        stream.onAbort(() => done());
        await finished;
        clearInterval(ping);
        this.clients.delete(client);
      });
    });

    app.post("/hook", async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as HookPayload & { session_id?: string; cwd?: string; transcript_path?: string };
      const cwd = body.cwd;
      if (cwd) {
        const rt = this.register(cwd);
        this.broadcast(rt.root, "hook", { hook_event_name: body.hook_event_name, session_id: body.session_id });
        const activity = activityFrom(body);
        // the turn's milestones go to the log (tool calls are too many), so a wrong "working" can be traced
        if (!/ToolUse$/.test(body.hook_event_name ?? "")) this.log(`hook ${body.hook_event_name} ${body.session_id?.slice(0, 8) ?? "-"}${activity ? ` -> ${activity}` : ""}`);
        if (activity && body.session_id) {
          const a = { session_id: body.session_id, activity, ts: new Date().toISOString() };
          if (!this.activity.has(rt.root)) this.activity.set(rt.root, new Map());
          this.activity.get(rt.root)!.set(body.session_id, a);
          this.broadcast(rt.root, "activity", a);
        }
        rt.schedule(`hook:${body.hook_event_name}`, body.session_id);
      }
      return c.json({});
    });

    // UI
    const uiDir = this.uiDir;
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

  private host = DEFAULT_HOST;
  private port = 0;
  private bind(hostname: string, port: number): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      this.server = serve({ fetch: this.app.fetch, port, hostname }, (addr) => resolve(addr.port));
      this.server.on("error", reject);
    });
  }

  network(): NetworkInfo {
    const container = fs.existsSync("/.dockerenv") || fs.existsSync("/run/.containerenv");
    return { host: this.host, port: this.port, exposed: isExposed(this.host), urls: container ? [] : reachableAt(this.port, this.host), lockedBy: this.opts.hostLock, ...(container ? { container } : {}) };
  }

  /** Listen on another address, same port, without a restart. Open pages reconnect by themselves. */
  async rebind(host: string): Promise<void> {
    const old = this.server as (ServerType & { closeAllConnections?: () => void }) | undefined;
    for (const c of this.clients) c.end();
    old?.closeAllConnections?.();
    await new Promise<void>((resolve) => (old ? old.close(() => resolve()) : resolve()));
    try {
      await this.bind(host, this.port);
    } catch (e) {
      // the address is not ours (a typo, an interface that went away): stay reachable where we were
      this.log(`cannot listen on ${host}:${this.port} (${String(e)}); staying on ${this.host}`);
      await this.bind(this.host, this.port);
      throw e;
    }
    this.host = host;
    // remembered for the next start, now that it worked
    if (this.opts.persist !== false) writeSettings({ host });
    this.log(`listening on ${host}:${this.port}${isExposed(host) ? " — reachable from other machines, without a login" : ""}`);
    this.opts.onListen?.(host, this.port);
  }

  async listen(): Promise<number> {
    const port = this.opts.port ?? 9656;
    const hostname = this.opts.hostname ?? DEFAULT_HOST;
    const actual = await this.bind(hostname, port);
    this.host = hostname;
    this.port = actual;
    this.opts.onListen?.(hostname, actual);
    for (const root of this.opts.persist === false ? [] : readProjects()) if (fs.existsSync(root)) this.register(root);
    this.watchUi();
    return actual;
  }

  async close(): Promise<void> {
    clearTimeout(this.uiTimer);
    this.uiWatcher?.close();
    for (const rt of this.projects.values()) await rt.stop();
    for (const c of this.clients) c.end();
    this.clients.clear();
    const srv = this.server as (ServerType & { closeAllConnections?: () => void }) | undefined;
    srv?.closeAllConnections?.();
    await new Promise<void>((resolve) => (srv ? srv.close(() => resolve()) : resolve()));
  }
}

class NotFound extends Error {}

/** An address this machine can listen on: the wildcards, loopback, or one of its interfaces. */
function localAddress(host: string): boolean {
  if (["0.0.0.0", "::", "localhost", "::1"].includes(host) || host.startsWith("127.")) return true;
  return Object.values(os.networkInterfaces()).some((list) => list?.some((a) => a.address === host));
}

function mime(file: string): string {
  const ext = path.extname(file);
  return (
    { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2", ".map": "application/json" }[ext] ??
    "application/octet-stream"
  );
}
