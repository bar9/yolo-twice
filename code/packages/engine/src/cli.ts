#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findProjectRoot, ingestProject, Store, Attention } from "@yolo-twice/core";
import { deriveProject, deriveSession } from "@yolo-twice/analyzers";
import { Engine } from "./server.js";
import { lastActiveSession, prepareResume } from "./resume.js";
import { clearEngineState, DEFAULT_HOST, DEFAULT_PORT, health, homeDir, isExposed, localUrl, logFile, pidAlive, reachableAt, readEngineState, readSettings, VERSION, writeEngineState } from "./state.js";

const args = process.argv.slice(2);
const cmd = args[0] ?? "help";
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string) => args.includes(`--${name}`);
const cwd = path.resolve(flag("cwd") ?? process.cwd());
const port = Number(flag("port") ?? process.env.YOLO_TWICE_PORT ?? DEFAULT_PORT);
// the interface to listen on: given at start it wins and the UI cannot change it; otherwise the UI's choice, else this machine only
const hostLock = flag("host") ? "--host" : process.env.YOLO_TWICE_HOST ? "YOLO_TWICE_HOST" : undefined;
const pinnedHost = flag("host") ?? process.env.YOLO_TWICE_HOST;

async function liveEngine(): Promise<{ port: number; pid: number; host: string } | undefined> {
  const st = readEngineState();
  if (!st) return undefined;
  if (!pidAlive(st.pid)) {
    clearEngineState();
    return undefined;
  }
  const h = await health(st.port, 800, st.host);
  return h ? { port: st.port, pid: st.pid, host: st.host ?? DEFAULT_HOST } : undefined;
}

async function ensureEngine(): Promise<number> {
  const live = await liveEngine();
  if (live && pinnedHost && pinnedHost !== live.host) console.error(`yolo-twice: the engine already runs on ${live.host}; stop it first to listen on ${pinnedHost}`);
  if (live) return live.port;
  fs.mkdirSync(homeDir(), { recursive: true });
  const out = fs.openSync(logFile(), "a");
  const self = fileURLToPath(import.meta.url);
  const runner = self.endsWith(".ts") ? ["bun", ["run", self]] as const : [process.execPath, [self]] as const;
  const child = spawn(runner[0], [...runner[1], "start", "--foreground", "--port", String(port), ...(flag("host") ? ["--host", flag("host")!] : []), "--cwd", cwd], { detached: true, stdio: ["ignore", out, out] });
  child.unref();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await health(port)) return port;
  }
  throw new Error(`engine did not come up on port ${port}; see ${logFile()}`);
}

async function register(p: number): Promise<{ root: string; sessions: number }> {
  const res = await fetch(`${localUrl(p)}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd }) });
  if (!res.ok) throw new Error(`engine could not register ${cwd}: ${res.status} ${await res.text()}`);
  return (await res.json()) as { root: string; sessions: number };
}

async function currentUrl(p: number, root: string): Promise<string> {
  const res = await fetch(`${localUrl(p)}/api/sessions?project=${encodeURIComponent(root)}`);
  const j = (await res.json()) as { current?: string; sessions?: { id: string }[] };
  // addressable, short: /<project key>/<session id prefix>
  const projects = (await (await fetch(`${localUrl(p)}/api/projects`)).json()) as { root: string; key: string }[];
  const key = projects.find((x) => x.root === root)?.key ?? path.basename(root);
  const ids = (j.sessions ?? []).map((s) => s.id);
  const sid = j.current ? shortId(j.current, ids) : "";
  return `${localUrl(p)}/${encodeURIComponent(key)}${sid ? `/${sid}` : ""}`;
}

/** Shortest prefix of `id` (at least 6 chars) that no other id shares. */
function shortId(id: string, ids: string[]): string {
  for (let n = 6; n < id.length; n++) {
    const pre = id.slice(0, n);
    if (!ids.some((o) => o !== id && o.startsWith(pre))) return pre;
  }
  return id;
}

function openBrowser(url: string): void {
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const a = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(opener, a, { detached: true, stdio: "ignore" }).unref();
  } catch {
    /* no opener */
  }
}

async function main(): Promise<void> {
  switch (cmd) {
    case "start": {
      if (has("foreground")) {
        const make = (host: string) =>
          new Engine({
            port,
            hostname: host,
            hostLock,
            log: (m) => console.error(`${new Date().toISOString()} ${m}`),
            onListen: (h, p) => writeEngineState({ pid: process.pid, port: p, host: h, started: engine.started, version: VERSION }),
          });
        const wanted = pinnedHost ?? readSettings().host ?? DEFAULT_HOST;
        let engine = make(wanted);
        let actual: number;
        try {
          actual = await engine.listen();
        } catch (e) {
          // a remembered address that is gone (another network): fall back to this machine; a given one is an error
          if (pinnedHost || wanted === DEFAULT_HOST) throw e;
          console.error(`yolo-twice: cannot listen on ${wanted} (${(e as Error).message}); using ${DEFAULT_HOST}`);
          engine = make(DEFAULT_HOST);
          actual = await engine.listen();
        }
        engine.register(cwd);
        const net = engine.network();
        console.error(`yolo-twice engine ${VERSION} listening on ${localUrl(actual, net.host)}`);
        if (net.exposed) console.error(`yolo-twice: reachable from other machines${net.container ? " through the port published for this container" : net.urls.length ? ` (${net.urls.join(", ")})` : ""}, without a login: anyone who can reach this port can read your sessions`);
        const shutdown = async () => {
          await engine.close();
          const st = readEngineState();
          if (st?.pid === process.pid) clearEngineState();
          process.exit(0);
        };
        process.on("SIGTERM", shutdown);
        process.on("SIGINT", shutdown);
        return;
      }
      const p = await ensureEngine();
      const { root } = await register(p);
      console.log(await currentUrl(p, root));
      return;
    }
    case "open": {
      const p = await ensureEngine();
      const { root } = await register(p);
      const url = await currentUrl(p, root);
      openBrowser(url);
      console.log(url);
      return;
    }
    case "stop": {
      const st = readEngineState();
      if (!st || !pidAlive(st.pid)) {
        clearEngineState();
        console.log("engine not running");
        return;
      }
      process.kill(st.pid, "SIGTERM");
      for (let i = 0; i < 20 && pidAlive(st.pid); i++) await new Promise((r) => setTimeout(r, 100));
      clearEngineState();
      console.log(`stopped engine (pid ${st.pid})`);
      return;
    }
    case "status": {
      const live = await liveEngine();
      const root = findProjectRoot(cwd);
      const store = new Store(root);
      const sessions = store.listSessions();
      const status = { engine: live ? { running: true, ...live, url: `${localUrl(live.port)}/` } : { running: false }, project: root, attention: store.readConfig().attention, sessions: sessions.length, current: lastActiveSession(store) };
      if (has("json")) console.log(JSON.stringify(status, null, 2));
      else {
        console.log(live ? `engine: running (pid ${live.pid}, ${localUrl(live.port, live.host)}/)${isExposed(live.host) ? `, listening on ${live.host}: reachable from other machines ${reachableAt(live.port, live.host).join(" ")}` : ""}` : "engine: not running");
        console.log(`project: ${root}`);
        console.log(`attention: ${status.attention}`);
        console.log(`sessions indexed: ${sessions.length}`);
      }
      return;
    }
    case "index": {
      const root = findProjectRoot(cwd);
      const store = new Store(root);
      const res = ingestProject({ cwd: root, store, originDir: process.env.YOLO_TWICE_ORIGIN_DIR });
      for (const id of store.listSessions()) deriveSession(store, id);
      const idx = deriveProject(store, path.basename(root));
      console.log(`project ${root}`);
      console.log(`sessions: ${idx.sessions.length}, new events: ${Object.values(res.appended).reduce((a, b) => a + b, 0)}, reset: ${res.reset.length}`);
      for (const s of idx.sessions) console.log(`  ${s.id}  ${s.events} events  ${s.label}`);
      return;
    }
    case "mode": {
      const parsed = Attention.safeParse(args[1]);
      if (!parsed.success) throw new Error("usage: yolo-twice mode <micro|attentive|balanced|yolo>");
      const root = findProjectRoot(cwd);
      const live = await liveEngine();
      // through the engine when it serves this project, so open UIs follow; otherwise straight to local.json
      const res = live ? await fetch(`${localUrl(live.port)}/api/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ project: root, attention: parsed.data }) }) : undefined;
      if (res && !res.ok && res.status !== 404) throw new Error(`engine refused the mode change: ${res.status} ${await res.text()}`);
      if (!res?.ok) {
        const store = new Store(root);
        store.ensure();
        store.writeLocalConfig({ attention: parsed.data });
      }
      console.log(`attention: ${parsed.data}`);
      return;
    }
    case "autocommit": {
      // engine memory only: needs a running engine and is off again after it restarts
      const on = args[1] === "on" ? true : args[1] === "off" ? false : undefined;
      const root = findProjectRoot(cwd);
      const p = await ensureEngine();
      await register(p);
      const init = on === undefined ? undefined : { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ project: root, enabled: on }) };
      const res = await fetch(`${localUrl(p)}/api/autocommit${init ? "" : `?project=${encodeURIComponent(root)}`}`, init);
      const st = (await res.json()) as { enabled: boolean; intervalMs: number };
      console.log(`auto-commit of .yolo-twice: ${st.enabled ? `on, every ${Math.round(st.intervalMs / 60_000)} min until the engine stops` : "off"}`);
      return;
    }
    case "resume": {
      // resume a session from the project-local .yolo-twice folder, e.g. one a teammate committed
      const root = findProjectRoot(cwd);
      const store = new Store(root);
      const session = args[1] && !args[1].startsWith("--") ? args[1] : undefined;
      const r = prepareResume(store, root, session);
      const where = `rebuilt ${r.records} records of session ${r.session.slice(0, 8)} into ${path.relative(root, r.transcript)}; resuming forks a new session`;
      if (has("print") || process.env.CLAUDE_PLUGIN_ROOT || !process.stdin.isTTY) {
        console.log(`${where}\nRun in a terminal inside ${root}:\n  ${r.command.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}`);
        break;
      }
      console.error(where);
      const child = spawn(r.command[0]!, r.command.slice(1), { cwd: root, stdio: "inherit" });
      await new Promise<void>((resolve) => child.on("exit", () => resolve()));
      break;
    }
    case "hook": {
      const chunks: Buffer[] = [];
      for await (const c of process.stdin) chunks.push(c as Buffer);
      try {
        // an explicit --port / YOLO_TWICE_PORT wins; else the port a live engine recorded at start; else the default
        const st = readEngineState();
        const live = st && pidAlive(st.pid) ? st : undefined;
        const explicit = flag("port") ?? process.env.YOLO_TWICE_PORT;
        await fetch(explicit || !live ? `${localUrl(port)}/hook` : `${localUrl(live.port, live.host)}/hook`, { method: "POST", headers: { "content-type": "application/json" }, body: Buffer.concat(chunks).toString(), signal: AbortSignal.timeout(2000) });
      } catch {
        /* engine down: silent */
      }
      return;
    }
    default:
      console.log(`yolo-twice ${VERSION}
  start [--cwd <dir>] [--port ${DEFAULT_PORT}] [--host <address>] [--foreground]
                                                 start (or reuse) the daemon, register the project, print the UI URL
                                                 --host: the interface to listen on (also YOLO_TWICE_HOST); default 127.0.0.1,
                                                 this machine only. 0.0.0.0 listens on every interface, e.g. in a Docker
                                                 container with the port published; the UI then shows it and cannot change it.
                                                 There is no login: only expose it on a network you trust. Prefer 0.0.0.0 to a
                                                 single interface address, which leaves out localhost and the Claude Code hooks.
  open  [--cwd <dir>]                            start if needed and open the browser
  stop                                           stop the daemon
  status [--cwd <dir>] [--json]                  engine and project state
  index [--cwd <dir>]                            one-shot ingest + derive, no daemon
  mode <micro|attentive|balanced|yolo>           set the attention mode
  autocommit [on|off] [--cwd <dir>]             commit only .yolo-twice every 10 min (this engine run only)
  resume [session] [--cwd <dir>] [--print]       rebuild a session from .yolo-twice and continue it as a fork (claude --resume <file> --fork-session)
  hook                                           forward a Claude Code hook JSON from stdin`);
  }
}

main().catch((e) => {
  console.error(`yolo-twice: ${(e as Error).message}`);
  process.exit(cmd === "hook" ? 0 : 1);
});
