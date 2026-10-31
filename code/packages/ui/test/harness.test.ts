import { describe, expect, test } from "bun:test";
import { hasHarnessTags, promptPlain, promptSegments } from "../src/harness";

describe("prompt tags from Claude Code and its IDE extensions", () => {
  test("a paste becomes its own part, without the blank lines around it", () => {
    const raw = '\n\n<pasted_content id="bba5">\n.yolo-twice contains my home folder\ngoals\n - less tokens\n</pasted_content id="bba5">';
    // the VS Code extension repeats the id on the closing tag
    expect(promptSegments(raw)).toEqual([{ kind: "pasted", text: ".yolo-twice contains my home folder\ngoals\n - less tokens" }]);
  });

  test("IDE context: the open file and a selection, then what you typed", () => {
    const raw =
      "<ide_opened_file>The user opened the file $PROJECT/README.md in the IDE. This may or may not be related to the current task.</ide_opened_file>" +
      "<ide_selection>The user selected the lines 8 to 13 from $PROJECT/CONTRIBUTING.md:\nPrerequisites\n| Tool |</ide_selection>\nfix the license";
    expect(promptSegments(raw)).toEqual([
      { kind: "opened", file: "$PROJECT/README.md" },
      { kind: "selection", from: 8, to: 13, file: "$PROJECT/CONTRIBUTING.md", text: "Prerequisites\n| Tool |" },
      { kind: "text", text: "fix the license" },
    ]);
  });

  test("a slash command, a shell command and their output; boilerplate goes", () => {
    expect(promptSegments("<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>fable</command-args>")).toEqual([{ kind: "command", name: "/model", args: "fable" }]);
    expect(promptSegments("<local-command-caveat>The command below was run directly…</local-command-caveat>")).toEqual([]);
    expect(promptSegments("<bash-input>ls</bash-input><bash-stdout>a\nb</bash-stdout><bash-stderr></bash-stderr>")).toEqual([
      { kind: "shell", text: "ls" },
      { kind: "output", text: "a\nb", error: false },
    ]);
    expect(promptSegments("<system-reminder>\nnote\n</system-reminder>")).toEqual([{ kind: "reminder", text: "note" }]);
  });

  test("tags a prompt quotes on purpose stay as written", () => {
    const raw = "the URL /<project>/<session> and an <img> tag";
    expect(promptSegments(raw)).toEqual([{ kind: "text", text: raw }]);
    expect(hasHarnessTags(raw)).toBe(false);
  });

  test("snippets keep your words and pastes, not the IDE context", () => {
    expect(promptPlain("<ide_opened_file>The user opened the file x.ts in the IDE.</ide_opened_file>\nfix it\n<pasted_content>log</pasted_content>")).toBe("fix it log");
  });
});
