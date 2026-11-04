import { describe, expect, test } from "bun:test";
import type { Sharing } from "../src/api";
import { patternFor, sharingReason, sharingShort, sharingTip, unknownRemote } from "../src/sharingWords";

const remote = (name: string, id: string, cls: Sharing["remotes"][number]["class"]) => ({ name, url: `https://${id}`, id, class: cls, by: "gh" as const });
const sharing = (over: Partial<Sharing>): Sharing => ({ environment: "restricted", answered: true, remotes: [], class: "none", shares: false, private: 0, ...over });

describe("sharing words", () => {
  test("the reason names the remote that decided", () => {
    const pub = sharing({ class: "open", decidedBy: "origin", remotes: [remote("origin", "github.com/a/b", "open")] });
    expect(sharingReason(pub)).toBe("origin (github.com/a/b) is a public repository, and this environment is restricted");
    expect(sharingShort(pub)).toBe("Sessions stay here");
    expect(sharingTip(pub)).toStartWith("What you do here stays on this machine: origin");
    expect(sharingReason(sharing({}))).toContain("no remote yet");
    const open = sharing({ environment: "open", class: "open", shares: true });
    expect(sharingReason(open)).toContain("environment is open");
    expect(sharingShort(open)).toBe("Sessions shared");
  });

  test("a one-click pattern for an unknown remote", () => {
    const sh = sharing({ class: "unknown", decidedBy: "corp", remotes: [remote("corp", "git.acme.example/team/app", "unknown")] });
    expect(unknownRemote(sh)?.name).toBe("corp");
    expect(patternFor("git.acme.example/team/app")).toBe("git.acme.example");
    expect(patternFor("github.com/acme/app")).toBe("github.com/acme/*");
  });
});
