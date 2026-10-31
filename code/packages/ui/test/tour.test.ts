import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { STOPS } from "../src/Tour";

describe("tour", () => {
  test("every stop points at a data-tour hook that exists in the UI", () => {
    const src = path.join(import.meta.dir, "..", "src");
    const code = fs
      .readdirSync(src)
      .filter((f) => f.endsWith(".tsx"))
      .map((f) => fs.readFileSync(path.join(src, f), "utf8"))
      .join("\n");
    for (const s of STOPS) {
      if (s.target === "body") continue;
      const hook = /^\[data-tour=([\w-]+)\]$/.exec(s.target)?.[1];
      expect(hook, s.target).toBeDefined();
      expect(code.includes(`data-tour="${hook}"`), `data-tour="${hook}"`).toBe(true);
    }
  });
});
