/**
 * Pure helpers that turn recorded tool calls and results into readable parts. Claude Code keeps no
 * schema in the transcript, but each tool's input has a stable shape (Bash: command, description;
 * Read: file_path, offset, limit; Write: file_path, content; …). Inputs longer than the redaction
 * limit are cut off and are no longer valid JSON, so parsing is tolerant.
 */

export type Lang = "bash" | "python" | "typescript" | "javascript" | "json" | "css" | "xml" | "diff" | "markdown" | "yaml" | "plaintext";

export interface ParsedInput {
  fields: Record<string, unknown>;
  /** The input was cut off by redaction; only the leading fields could be read. */
  truncated: boolean;
}

/** Parse a tool call's JSON input; on truncated JSON, recover the complete leading fields and the start of the last string. */
export function parseInput(text: string): ParsedInput {
  try {
    const v = JSON.parse(text);
    if (v && typeof v === "object" && !Array.isArray(v)) return { fields: v as Record<string, unknown>, truncated: false };
    return { fields: { value: v }, truncated: false };
  } catch {
    /* fall through */
  }
  const fields: Record<string, unknown> = {};
  const re = /"([A-Za-z_][\w-]*)"\s*:\s*(?:"((?:[^"\\]|\\.)*)("?)|(-?\d+(?:\.\d+)?|true|false|null))/gs;
  for (let m; (m = re.exec(text)); ) {
    const [, key, str, closed, lit] = m;
    if (str !== undefined) {
      fields[key!] = decode(str);
      if (!closed) break; // the string ran to the cut
    } else if (lit !== undefined) fields[key!] = JSON.parse(lit);
  }
  return { fields, truncated: true };
}

function decode(raw: string): string {
  // a cut can land inside an escape: drop a dangling backslash or partial \uXXXX
  const safe = raw.replace(/\\u[0-9a-fA-F]{0,3}$/, "").replace(/(?<!\\)\\$/, "");
  try {
    return JSON.parse(`"${safe}"`) as string;
  } catch {
    return safe;
  }
}

const EXT: Record<string, Lang> = {
  py: "python",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  json: "json",
  css: "css",
  html: "xml",
  xml: "xml",
  svg: "xml",
  vue: "xml",
  md: "markdown",
  yml: "yaml",
  yaml: "yaml",
  sh: "bash",
  bash: "bash",
  diff: "diff",
  patch: "diff",
};

export function langForPath(path: string | undefined): Lang {
  const ext = path?.split(/[?#]/)[0]?.split(".").pop()?.toLowerCase() ?? "";
  return EXT[ext] ?? "plaintext";
}

export interface Segment {
  kind: "shell" | "heredoc";
  text: string;
  lang: Lang;
  /** For a heredoc: what it feeds, e.g. "python3" or "$S/x.mjs". */
  target?: string;
}

/** The language a heredoc is written in, from the command that reads it. */
function heredocLang(line: string): { lang: Lang; target?: string } {
  const interp = /\b(python3?|node|bun|deno|tsx|bash|sh|ruby|perl)\b(?:\s+-\w*)*\s*(?:-\s*)?<</.exec(line);
  if (interp) {
    const name = interp[1]!;
    const lang: Lang = name.startsWith("python") ? "python" : name === "bash" || name === "sh" ? "bash" : name === "ruby" || name === "perl" ? "plaintext" : "javascript";
    return { lang, target: name };
  }
  const file = /(?:cat|tee)\s+(?:-a\s+)?>{0,2}\s*["']?([^\s"'<>|;&]+)/.exec(line);
  if (file) return { lang: langForPath(file[1]), target: file[1] };
  return { lang: "plaintext" };
}

/** Split a shell command into shell text and heredoc bodies, each in its own language. */
export function splitHeredocs(command: string): Segment[] {
  const lines = command.split("\n");
  const out: Segment[] = [];
  let shell: string[] = [];
  const flush = () => {
    if (shell.length) out.push({ kind: "shell", text: shell.join("\n"), lang: "bash" });
    shell = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    shell.push(line);
    const m = /<<(-?)\s*(['"]?)([A-Za-z_][\w]*)\2/.exec(line);
    if (!m) continue;
    const [, dash, , delim] = m;
    const end = lines.findIndex((l, j) => j > i && (dash ? l.trim() : l) === delim);
    if (end < 0) continue; // unterminated: leave it as shell
    flush();
    const { lang, target } = heredocLang(line);
    out.push({ kind: "heredoc", text: lines.slice(i + 1, end).join("\n"), lang, target });
    // the closing delimiter and whatever follows stay shell
    shell = [lines[end]!];
    i = end;
  }
  flush();
  return out;
}

/** `cat -n` style output from Read: line numbers in a gutter, the code without them. */
export function splitGutter(text: string): { start: number; code: string } | undefined {
  const lines = text.replace(/\n$/, "").split("\n");
  const m = /^\s*(\d+)[\t→]/.exec(lines[0] ?? "");
  if (!m || lines.length < 1) return undefined;
  const numbered = lines.filter((l) => /^\s*\d+[\t→]/.test(l)).length;
  if (numbered < lines.length * 0.8) return undefined;
  return { start: Number(m[1]), code: lines.map((l) => l.replace(/^\s*\d+[\t→]/, "")).join("\n") };
}

/** Markdown-ish text with fenced code blocks, split into prose and code parts. */
export function splitFences(text: string): { kind: "text" | "code"; text: string; lang: Lang }[] {
  const parts: { kind: "text" | "code"; text: string; lang: Lang }[] = [];
  const re = /```([\w+-]*)\n([\s\S]*?)```/g;
  let at = 0;
  for (let m; (m = re.exec(text)); ) {
    if (m.index > at) parts.push({ kind: "text", text: text.slice(at, m.index), lang: "plaintext" });
    parts.push({ kind: "code", text: m[2]!.replace(/\n$/, ""), lang: langForPath(`x.${m[1] || "txt"}`) });
    at = m.index + m[0].length;
  }
  if (at < text.length) parts.push({ kind: "text", text: text.slice(at), lang: "plaintext" });
  return parts;
}

/** Pretty JSON when the text is JSON, else undefined. */
export function prettyJson(text: string): string | undefined {
  const t = text.trim();
  if (!/^[[{]/.test(t)) return undefined;
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return undefined;
  }
}
