import { describe, expect, test } from "bun:test";
import type { SessionIndex, Sharing } from "../src/api";
import { patternFor, pendingSessions, sharingReason, sharingShort, unknownRemote } from "../src/sharingWords";

const remote = (name: string, id: string, cls: Sharing["remotes"][number]["class"]) => ({ name, url: `https://${id}`, id, class: cls, by: "gh" as const });
const sharing = (over: Partial<Sharing>): Sharing => ({ environment: "restricted", answered: true, remotes: [], class: "none", default: "undecided", prompt: true, ...over });
const session = (id: string, ts: string, visibility?: "shared" | "private" | "undecided", decided = false) => ({ id, agent: "claude-code", label: id, ts_first: ts, ts_last: ts, events: 1, visibility, decided });

describe("sharing words", () => {
  test("the reason names the remote that decided", () => {
    const pub = sharing({ class: "open", decidedBy: "origin", default: "private", remotes: [remote("origin", "github.com/a/b", "open")] });
    expect(sharingReason(pub)).toBe("origin (github.com/a/b) is a public repository, and this environment is restricted");
    expect(sharingShort(pub)).toBe("Sessions private");
    expect(sharingReason(sharing({}))).toContain("no remote yet");
    expect(sharingReason(sharing({ environment: "open", class: "open", default: "shared" }))).toContain("environment is open");
  });

  test("pending sessions: not shared by default and not decided, newest first", () => {
    const index = {
      version: 1,
      project: "p",
      sharing: sharing({ default: "private", class: "open" }),
      sessions: [session("old", "2026-01-01", "private"), session("mine", "2026-03-01", "private", true), session("new", "2026-02-01", "undecided"), session("team", "2026-04-01", "shared", true)],
    } as SessionIndex;
    expect(pendingSessions(index).map((s) => s.id)).toEqual(["new", "old"]);
    expect(pendingSessions({ ...index, sharing: undefined })).toEqual([]);
  });

  test("a one-click pattern for an unknown remote", () => {
    const sh = sharing({ class: "unknown", decidedBy: "corp", remotes: [remote("corp", "git.acme.example/team/app", "unknown")] });
    expect(unknownRemote(sh)?.name).toBe("corp");
    expect(patternFor("git.acme.example/team/app")).toBe("git.acme.example");
    expect(patternFor("github.com/acme/app")).toBe("github.com/acme/*");
  });
});
