import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import { ingestProject, Store, type ImageRef } from "@yolo-twice/core";
import { reconstructTranscript } from "../src/resume.js";
import { FIXTURE_CWD, FIXTURE_SESSION, mainFile, tempFixture } from "../../../fixtures/helper.js";

// a 1x1 PNG
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function pasteImage(originDir: string): void {
  const file = mainFile(originDir);
  const last = fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.uuid).at(-1);
  const rec = {
    type: "user",
    uuid: "img-prompt-1",
    parentUuid: last.uuid,
    sessionId: FIXTURE_SESSION,
    timestamp: new Date(Date.parse(last.timestamp) + 1000).toISOString(),
    message: { role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: PNG } }, { type: "text", text: "see screenshot" }] },
  };
  fs.appendFileSync(file, JSON.stringify(rec) + "\n");
}

describe("pasted images", () => {
  test("are stored once as files, referenced from the prompt, and put back on resume", () => {
    const fx = tempFixture("img");
    try {
      pasteImage(fx.originDir);
      const store = new Store(fx.projectRoot);
      ingestProject({ cwd: FIXTURE_CWD, store, originDir: fx.originDir });
      const ev = store.readEvents(FIXTURE_SESSION).find((e) => e.id === "img-prompt-1")!;
      expect(ev).toMatchObject({ kind: "user.prompt", text: "see screenshot" });
      const [ref] = ev.data!.images as ImageRef[];
      expect(ref!.file).toMatch(/^[0-9a-f]{16}\.png$/);
      expect(fs.readFileSync(store.imageFile(FIXTURE_SESSION, ref!.file!)!).toString("base64")).toBe(PNG);
      // the base64 never lands in the events file
      expect(fs.readFileSync(store.eventsFile(FIXTURE_SESSION), "utf8")).not.toContain(PNG.slice(0, 40));
      // names outside our own scheme are refused
      expect(store.imageFile(FIXTURE_SESSION, "../events.ndjson")).toBeUndefined();

      const { lines } = reconstructTranscript(FIXTURE_SESSION, store.readEvents(FIXTURE_SESSION), fx.projectRoot, "t", undefined, (f) => store.imageFile(FIXTURE_SESSION, f));
      const rec = lines.map((l) => JSON.parse(l)).find((r) => r.uuid === "img-prompt-1");
      expect(rec.message.content).toEqual([{ type: "image", source: { type: "base64", media_type: "image/png", data: PNG } }, { type: "text", text: "see screenshot" }]);
    } finally {
      fx.cleanup();
    }
  });

  test("a team can switch images off", () => {
    const fx = tempFixture("img");
    try {
      pasteImage(fx.originDir);
      const store = new Store(fx.projectRoot);
      store.writeConfig({ ...store.readConfig(), images: { keep: false, max_bytes: 5_000_000 } });
      ingestProject({ cwd: FIXTURE_CWD, store, originDir: fx.originDir });
      const ev = store.readEvents(FIXTURE_SESSION).find((e) => e.id === "img-prompt-1")!;
      expect(ev.data!.images).toEqual([{ media_type: "image/png", bytes: 70, omitted: "disabled" }]);
      expect(fs.existsSync(store.imagesDir(FIXTURE_SESSION))).toBe(false);
    } finally {
      fx.cleanup();
    }
  });
});
