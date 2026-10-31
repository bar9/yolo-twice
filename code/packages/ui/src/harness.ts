/**
 * Tags Claude Code and its IDE extensions put into a prompt around (or next to) what you typed.
 * There is no published list; these are the ones found in real transcripts:
 *
 *   <pasted_content id="…">…</pasted_content id="…">  text you pasted (VS Code extension)
 *   <ide_opened_file>The user opened the file X …     the file open in the editor
 *   <ide_selection>The user selected the lines a to b from X: …   the selected lines
 *   <system-reminder>…                               context Claude Code adds for the model
 *   <command-name>/x</command-name><command-message>x</command-message><command-args>…</command-args>
 *   <local-command-stdout>… / <local-command-caveat>…  a local command's output, and its boilerplate
 *   <bash-input>… <bash-stdout>… <bash-stderr>…       a ! shell command and its output
 *
 * The stored events keep them verbatim (resume rebuilds the transcript from them); they are only
 * parsed for display. Any other tag is left as written: prompts often quote <tags> on purpose.
 */

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "pasted"; text: string }
  | { kind: "opened"; file: string }
  | { kind: "selection"; file?: string; from?: number; to?: number; text: string }
  | { kind: "reminder"; text: string }
  | { kind: "command"; name: string; args: string }
  | { kind: "shell"; text: string }
  | { kind: "output"; text: string; error?: boolean };

const TAGS = ["pasted_content", "ide_opened_file", "ide_selection", "system-reminder", "command-name", "command-message", "command-args", "local-command-stdout", "local-command-caveat", "bash-input", "bash-stdout", "bash-stderr"];
// the VS Code extension repeats the attributes on the closing tag: </pasted_content id="bba5">
const BLOCK = new RegExp(`<(${TAGS.join("|")})(?:\\s[^>]*)?>([\\s\\S]*?)</\\1(?:\\s[^>]*)?>`, "g");

/** A prompt's parts in order: what you wrote, what you pasted, and what the harness added. */
export function promptSegments(raw: string): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  let command: { name: string; args: string } | undefined;
  const text = (t: string) => {
    if (t.trim()) out.push({ kind: "text", text: t.replace(/^\s*\n|\n\s*$/g, "") });
  };
  for (const m of raw.matchAll(BLOCK)) {
    text(raw.slice(at, m.index));
    at = m.index! + m[0].length;
    const [, tag, body = ""] = m;
    const inner = body.replace(/^\n|\n$/g, "");
    switch (tag) {
      case "pasted_content":
        out.push({ kind: "pasted", text: inner });
        break;
      case "ide_opened_file": {
        const file = /opened the file (.+?) in the IDE/.exec(inner)?.[1];
        if (file) out.push({ kind: "opened", file });
        break;
      }
      case "ide_selection": {
        const head = /^The user selected the lines (\d+) to (\d+) from (.+?):\n?/.exec(inner);
        out.push(head ? { kind: "selection", from: Number(head[1]), to: Number(head[2]), file: head[3], text: inner.slice(head[0].length) } : { kind: "selection", text: inner });
        break;
      }
      case "system-reminder":
        out.push({ kind: "reminder", text: inner.trim() });
        break;
      case "command-name":
        command = { name: inner.trim(), args: "" };
        out.push({ kind: "command", ...command });
        break;
      case "command-args": {
        const last = out.at(-1);
        if (last?.kind === "command") last.args = inner.trim();
        break;
      }
      case "bash-input":
        out.push({ kind: "shell", text: inner });
        break;
      case "local-command-stdout":
      case "bash-stdout":
      case "bash-stderr":
        if (inner.trim()) out.push({ kind: "output", text: inner, error: tag === "bash-stderr" });
        break;
      // command-message repeats the command name; the caveat is boilerplate for the model
    }
  }
  text(raw.slice(at));
  return out;
}

/** The prompt as one line of plain text, for snippets: your words and pastes, no harness context. */
export function promptPlain(raw: string): string {
  return promptSegments(raw)
    .map((s) => (s.kind === "text" || s.kind === "pasted" ? s.text : s.kind === "command" ? `${s.name} ${s.args}`.trim() : s.kind === "shell" ? `! ${s.text}` : ""))
    .filter(Boolean)
    .join(" ");
}

/** Whether a text has any harness tag worth parsing. */
export function hasHarnessTags(raw: string): boolean {
  return new RegExp(`<(${TAGS.join("|")})[\\s>]`).test(raw);
}
