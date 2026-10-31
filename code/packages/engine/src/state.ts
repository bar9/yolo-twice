import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, writeJsonAtomic } from "@yolo-twice/core";

export const DEFAULT_PORT = 9656;
// src/state.ts and the bundled dist/cli.js both sit one level below package.json.
export const VERSION: string = JSON.parse(
  fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"),
).version;

export function homeDir(): string {
  return process.env.YOLO_TWICE_HOME || path.join(os.homedir(), ".yolo-twice");
}
export function engineFile(): string {
  return path.join(homeDir(), "engine.json");
}
export function logFile(): string {
  return path.join(homeDir(), "engine.log");
}
export function projectsFile(): string {
  return path.join(homeDir(), "projects.json");
}

export interface EngineState {
  pid: number;
  port: number;
  /** The address it listens on (absent: 127.0.0.1). */
  host?: string;
  started: string;
  version: string;
}

export function readEngineState(): EngineState | undefined {
  return readJson<EngineState>(engineFile());
}
export function writeEngineState(s: EngineState): void {
  fs.mkdirSync(homeDir(), { recursive: true });
  writeJsonAtomic(engineFile(), s);
}
export function clearEngineState(): void {
  fs.rmSync(engineFile(), { force: true });
}

export function readProjects(): string[] {
  return readJson<string[]>(projectsFile()) ?? [];
}
export function writeProjects(roots: string[]): void {
  fs.mkdirSync(homeDir(), { recursive: true });
  writeJsonAtomic(projectsFile(), [...new Set(roots)]);
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function health(port: number, timeoutMs = 800, host?: string): Promise<Record<string, unknown> | undefined> {
  try {
    const res = await fetch(`${localUrl(port, host)}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return undefined;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/* ---------- network: which interface the engine listens on ---------- */

export const DEFAULT_HOST = "127.0.0.1";

/** Settings chosen in the UI that outlive the engine (the network address). */
export interface Settings {
  host?: string;
}
export function settingsFile(): string {
  return path.join(homeDir(), "settings.json");
}
export function readSettings(): Settings {
  return readJson<Settings>(settingsFile()) ?? {};
}
export function writeSettings(s: Settings): void {
  fs.mkdirSync(homeDir(), { recursive: true });
  writeJsonAtomic(settingsFile(), s);
}

/** Bound to every interface (0.0.0.0, ::), or to one that is not this machine's loopback. */
export function isExposed(host: string): boolean {
  return !/^(127\.|::1$|localhost$)/.test(host);
}

/** How to reach an engine bound to `host` from this machine: the wildcard addresses answer on loopback. */
export function localUrl(port: number, host: string = readEngineState()?.host ?? DEFAULT_HOST): string {
  const h = host === "0.0.0.0" || host === "" ? "127.0.0.1" : host === "::" ? "[::1]" : host.includes(":") ? `[${host}]` : host;
  return `http://${h}:${port}`;
}

/** The addresses other machines can use, for an engine bound to `host`. */
export function reachableAt(port: number, host: string): string[] {
  if (!isExposed(host)) return [];
  if (host !== "0.0.0.0" && host !== "::") return [localUrl(port, host)];
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list ?? []) if (!a.internal && (a.family === "IPv4" || host === "::")) out.push(localUrl(port, a.address));
  return out;
}
