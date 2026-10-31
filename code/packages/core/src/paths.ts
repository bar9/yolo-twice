import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function claudeHome(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

/** Claude Code names the project folder after the cwd with every non-alphanumeric character replaced by "-". */
export function projectSlug(cwd: string): string {
  return path.resolve(cwd).replace(/[^a-zA-Z0-9]/g, "-");
}

export function claudeProjectDir(cwd: string, home = claudeHome()): string {
  return path.join(home, "projects", projectSlug(cwd));
}

export const YOLO_DIR = ".yolo-twice";

export function yoloDir(projectRoot: string): string {
  return path.join(projectRoot, YOLO_DIR);
}

/** Walk up from cwd to the nearest git root; fall back to cwd. */
export function findProjectRoot(cwd: string): string {
  let dir = path.resolve(cwd);
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(cwd);
    dir = parent;
  }
}
