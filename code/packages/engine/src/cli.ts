#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findProjectRoot, Store, Attention } from "@yolo-twice/core";
import { deriveProject, deriveSession } from "@yolo-twice/analyzers";
import { ingestProject } from "@yolo-twice/core";
import { Engine } from "./server.js";
import { prepareResume } from "./resume.js";
import { clearEngineState, DEFAULT_PORT, health, homeDir, logFile, pidAlive, readEngineState, VERSION, writeEngineState } from "./state.js";

const args = process.argv.slice(2);
const cmd = args[0] ?? "help";
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string) => args.includes(`--${name}`);
const cwd = path.resolve(flag("cwd") ?? process.cwd());
const port = Number(flag("port") ?? process.env.YOLO_TWICE_PORT ?? DEFAULT_PORT);

async function liveEngine(): Promise<{ port: number; pid: number } | undefined> {
  const st = readEngineState();
  if (!st) return undefined;
  if (!pidAlive(st.pid)) {
    clearEngineState();
    return undefined;
  }
  const h = await health(st.port);
  return h ? { port: st.port, pid: st.pid } : undefined;
}

async function ensureEngine(): Promise<number> {
  const live = await liveEngine();
  if (live) return live.port;
  fs.mkdirSync(homeDir(), { recursive: true });
  const out = fs.openSync(logFile(), "a");
  const self = fileURLToPath(import.meta.url);
  const runner = self.endsWith(".ts") ? ["bun", ["run", self]] as const : [process.execPath, [self]] as const;
  const child = spawn(runner[0], [...runner[1], "start", "--foreground", "--port", String(port), "--cwd", cwd], { detached: true, stdio: ["ignore", out, out] });
  child.unref();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await health(port)) return port;
  }
  throw new Error(`engine did not come up on port ${port}; see ${logFile()}`);
}

async function register(p: number): Promise<{ root: string; sessions: number }> {
  const res = await fetch(`http://127.0.0.1:${p}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd }) });
  return (await res.json()) as { root: string; sessions: number };
}

async function currentUrl(p: number, root: string): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${p}/api/sessions?project=${encodeURIComponent(root)}`);
  const j = (await res.json()) as { current?: string; sessions?: { id: string }[] };
  // addressable, short: /<project key>/<session id prefix>
  const projects = (await (await fetch(`http://127.0.0.1:${p}/api/projects`)).json()) as { root: string; key: string }[];
  const key = projects.find((x) => x.root === root)?.key ?? path.basename(root);
  const ids = (j.sessions ?? []).map((s) => s.id);
  const sid = j.current ? shortId(j.current, ids) : "";
  return `http://127.0.0.1:${p}/${encodeURIComponent(key)}${sid ? `/${sid}` : ""}`;
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
        const engine = new Engine({ port, log: (m) => console.error(`${new Date().toISOString()} ${m}`) });
        const actual = await engine.listen();
        writeEngineState({ pid: process.pid, port: actual, started: engine.started, version: VERSION });
        engine.register(cwd);
        console.error(`yolo-twice engine ${VERSION} listening on http://127.0.0.1:${actual}`);
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
      const status = { engine: live ? { running: true, ...live, url: `http://127.0.0.1:${live.port}/` } : { running: false }, project: root, attention: store.readConfig().attention, sessions: sessions.length, current: sessions.length ? store.readProjectIndex()?.sessions.at(-1)?.id : undefined };
      if (has("json")) console.log(JSON.stringify(status, null, 2));
      else {
        console.log(live ? `engine: running (pid ${live.pid}, http://127.0.0.1:${live.port}/)` : "engine: not running");
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
      if (live) {
        await fetch(`http://127.0.0.1:${live.port}/api/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ project: root, attention: parsed.data }) });
      } else {
        const store = new Store(root);
        store.ensure();
        store.writeLocalConfig({ attention: parsed.data });
      }
      console.log(`attention: ${parsed.data}`);
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
        await fetch(`http://127.0.0.1:${port}/hook`, { method: "POST", headers: { "content-type": "application/json" }, body: Buffer.concat(chunks).toString(), signal: AbortSignal.timeout(2000) });
      } catch {
        /* engine down: silent */
      }
      return;
    }
    default:
      console.log(`yolo-twice ${VERSION}
  start [--cwd <dir>] [--port ${DEFAULT_PORT}] [--foreground]   start (or reuse) the daemon, register the project, print the UI URL
  open  [--cwd <dir>]                            start if needed and open the browser
  stop                                           stop the daemon
  status [--cwd <dir>] [--json]                  engine and project state
  index [--cwd <dir>]                            one-shot ingest + derive, no daemon
  mode <micro|attentive|balanced|yolo>           set the attention detent
  resume [session] [--cwd <dir>] [--print]       rebuild a session from .yolo-twice and continue it as a fork (claude --resume <file> --fork-session)
  hook                                           forward a Claude Code hook JSON from stdin`);
  }
}

main().catch((e) => {
  console.error(`yolo-twice: ${(e as Error).message}`);
  process.exit(cmd === "hook" ? 0 : 1);
});
