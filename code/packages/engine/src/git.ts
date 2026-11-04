import { execFile, execFileSync } from "node:child_process";

/** Run git in `cwd`; rejects with git's own error text. */
export function git(cwd: string, args: string[], maxBuffer = 16 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile("git", args, { cwd, timeout: 30_000, maxBuffer }, (err, stdout, stderr) =>
      err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout),
    ),
  );
}

/** Synchronous variant for the few places that must not wait for the event loop; undefined on any error. */
export function gitSync(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", args, { cwd, timeout: 10_000, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return undefined;
  }
}
