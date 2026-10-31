import { describe, expect, test } from "bun:test";
import { langForPath, parseInput, prettyJson, splitFences, splitGutter, splitHeredocs } from "../src/toolview";

describe("tool call input", () => {
  test("valid JSON parses as is", () => {
    expect(parseInput('{"command":"ls -la","timeout":5}')).toEqual({ fields: { command: "ls -la", timeout: 5 }, truncated: false });
  });

  test("input cut off by redaction keeps the readable leading fields", () => {
    const cut = '{"file_path":"$PROJECT/a.py","content":"import os\\nprint(os.getcwd())\\npri';
    const r = parseInput(cut);
    expect(r.truncated).toBe(true);
    expect(r.fields.file_path).toBe("$PROJECT/a.py");
    expect(r.fields.content).toBe("import os\nprint(os.getcwd())\npri");
    // a cut inside an escape does not throw
    expect(parseInput('{"command":"echo \\').fields.command).toBe("echo ");
  });
});

describe("heredocs", () => {
  test("python fed by a heredoc is split out and named", () => {
    const cmd = "S=/tmp/x; python3 - <<'EOF'\nimport json\nprint(json.dumps({}))\nEOF\necho done";
    const segs = splitHeredocs(cmd);
    expect(segs.map((s) => [s.kind, s.lang])).toEqual([
      ["shell", "bash"],
      ["heredoc", "python"],
      ["shell", "bash"],
    ]);
    expect(segs[1]!.text).toBe("import json\nprint(json.dumps({}))");
    expect(segs[1]!.target).toBe("python3");
    expect(segs[2]!.text).toBe("EOF\necho done");
  });

  test("a heredoc written to a file takes the file's language; unterminated stays shell", () => {
    const segs = splitHeredocs("cat > $S/pw/t.mjs <<'EOF'\nconst a = 1;\nEOF");
    expect(segs[1]).toMatchObject({ kind: "heredoc", lang: "javascript", target: "$S/pw/t.mjs" });
    expect(splitHeredocs("python3 - <<EOF\nprint(1)").map((s) => s.kind)).toEqual(["shell"]);
    expect(splitHeredocs("ls -la")).toEqual([{ kind: "shell", text: "ls -la", lang: "bash" }]);
  });
});

describe("results", () => {
  test("Read output loses its line-number gutter", () => {
    expect(splitGutter("    12\tconst a = 1;\n    13\t\n    14\texport { a };\n")).toEqual({ start: 12, code: "const a = 1;\n\nexport { a };" });
    expect(splitGutter("total 32\ndrwx")).toBeUndefined();
  });

  test("fenced code, JSON and languages", () => {
    expect(splitFences("### Ran\n```js\nawait x();\n```\nok").map((p) => [p.kind, p.lang])).toEqual([
      ["text", "plaintext"],
      ["code", "javascript"],
      ["text", "plaintext"],
    ]);
    expect(prettyJson('{"a":[1,2]}')).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');
    expect(prettyJson("total 32")).toBeUndefined();
    expect(langForPath("$PROJECT/code/x.tsx")).toBe("typescript");
    expect(langForPath("README")).toBe("plaintext");
  });
});
