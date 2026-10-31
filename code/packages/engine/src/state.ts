import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readJson, writeJsonAtomic } from "@yolo-twice/core";

export const DEFAULT_PORT = 9656;
export const VERSION = "0.1.0";

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

export async function health(port: number, timeoutMs = 800): Promise<Record<string, unknown> | undefined> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return undefined;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
