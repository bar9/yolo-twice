import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const FIXTURE_SESSION = "11111111-1111-4111-8111-111111111111";
export const FIXTURE_AGENT = "deadbeef01234567";
export const FIXTURE_CWD = "/tmp/yolo-demo";
const RAW = path.join(import.meta.dirname, "raw", "projects", "-tmp-yolo-demo");

/** Copy the raw fixture into a fresh temp dir and return paths for one isolated test run. */
export function tempFixture(name = "yt"): { originDir: string; projectRoot: string; cleanup: () => void } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  const originDir = path.join(base, "claude", "projects", "-tmp-yolo-demo");
  const projectRoot = path.join(base, "project");
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.cpSync(RAW, originDir, { recursive: true });
  return { originDir, projectRoot, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

export function mainFile(originDir: string): string {
  return path.join(originDir, `${FIXTURE_SESSION}.jsonl`);
}
