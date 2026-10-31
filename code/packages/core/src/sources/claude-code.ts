import fs from "node:fs";
import path from "node:path";
import { sha256 } from "../json.js";
import type { Event, EventKind, Usage } from "../schema.js";

export interface SessionFile {
  session: string;
  file: string; // absolute
  rel: string; // relative to origin dir, used as cursor key
  role: "main" | "subagent";
  agentId?: string;
  metaFile?: string;
}

export interface SubagentMeta {
  agentType?: string;
  description?: string;
  toolUseId?: string;
  finished?: boolean;
  spawnDepth?: number;
}

/**
 * Bump when normalization changes the events produced from the same input, so existing
 * .yolo-twice indexes rebuild once instead of mixing old and new event shapes.
 *   2: mid-turn messages (queued_command attachments) become user prompts;
 *      background task notifications become system events instead of user prompts
 */
export const NORMALIZER_VERSION = 2;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Find main session files and their subagent transcripts in a Claude Code project folder. */
export function discoverSessionFiles(originDir: string): SessionFile[] {
  if (!fs.existsSync(originDir)) return [];
  const out: SessionFile[] = [];
  for (const entry of fs.readdirSync(originDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const session = entry.name.slice(0, -".jsonl".length);
    if (!UUID_RE.test(session)) continue;
    out.push({ session, file: path.join(originDir, entry.name), rel: entry.name, role: "main" });
    const subDir = path.join(originDir, session, "subagents");
    if (fs.existsSync(subDir)) {
      for (const sub of fs.readdirSync(subDir)) {
        if (!sub.endsWith(".jsonl")) continue;
        const agentId = sub.replace(/^agent-/, "").replace(/\.jsonl$/, "");
        const metaFile = path.join(subDir, sub.replace(/\.jsonl$/, ".meta.json"));
        out.push({
          session,
          file: path.join(subDir, sub),
          rel: path.join(session, "subagents", sub),
          role: "subagent",
          agentId,
          metaFile: fs.existsSync(metaFile) ? metaFile : undefined,
        });
      }
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

export function readSubagentMeta(file: string | undefined): SubagentMeta {
  if (!file) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as SubagentMeta;
  } catch {
    return {};
  }
}

export interface LineChunk {
  lines: { text: string; line: number }[];
  bytes: number; // new cursor byte offset (only complete lines consumed)
}

/** Read complete lines starting at a byte offset. A trailing partial line is left for the next call. */
export function readNewLines(file: string, fromByte: number, fromLine: number): LineChunk {
  const size = fs.statSync(file).size;
  if (size <= fromByte) return { lines: [], bytes: fromByte };
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(size - fromByte);
    fs.readSync(fd, buf, 0, buf.length, fromByte);
    const lastNl = buf.lastIndexOf(0x0a);
    if (lastNl < 0) return { lines: [], bytes: fromByte };
    const complete = buf.subarray(0, lastNl + 1).toString("utf8");
    const lines: { text: string; line: number }[] = [];
    let n = fromLine;
    for (const raw of complete.split("\n")) {
      if (raw === "") continue;
      n++;
      lines.push({ text: raw, line: n });
    }
    return { lines, bytes: fromByte + lastNl + 1 };
  } finally {
    fs.closeSync(fd);
  }
}

export function headHash(file: string): string {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(1024);
    const n = fs.readSync(fd, buf, 0, 1024, 0);
    return sha256(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
}

/* ---------- normalization ---------- */

const SKIP_TYPES = new Set([
  "mode",
  "permission-mode",
  "file-history-snapshot",
  "file-history-delta",
  "api-request",
  "api-request-blob",
  "api-request-shape",
  "atis-latch",
  "last-prompt",
  "queue-operation",
  "tools-used",
  "attachment",
]);

export interface NormalizeContext {
  session: string;
  file: string; // relative path for src
  line: number;
  agentId: string | null;
  lastTs: string; // carried forward when a record has no timestamp
  maxTextChars: number;
}

type Raw = Record<string, any>;

function blockText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (typeof b === "string" ? b : b?.type === "text" ? String(b.text ?? "") : b?.type === "image" ? "[image]" : ""))
      .filter(Boolean)
      .join("\n");
  }
  if (content == null) return "";
  return JSON.stringify(content);
}

function usageOf(u: Raw | undefined): Usage | undefined {
  if (!u) return undefined;
  const out: Usage = {};
  if (typeof u.input_tokens === "number") out.input_tokens = u.input_tokens;
  if (typeof u.output_tokens === "number") out.output_tokens = u.output_tokens;
  if (typeof u.cache_read_input_tokens === "number") out.cache_read_tokens = u.cache_read_input_tokens;
  if (typeof u.cache_creation_input_tokens === "number") out.cache_write_tokens = u.cache_creation_input_tokens;
  return Object.keys(out).length ? out : undefined;
}

function base(ctx: NormalizeContext, rec: Raw, id: string, parent: string | null, kind: EventKind, text: string, ts: string): Event {
  return {
    id,
    ts,
    session: ctx.session,
    agent: "claude-code",
    agent_id: (rec.agentId as string | undefined) ?? ctx.agentId,
    parent,
    kind,
    text,
    src: { file: ctx.file, line: ctx.line },
  };
}

/** Normalize one raw Claude Code JSONL record into zero or more events. Text is NOT yet redacted. */
export function normalizeRecord(rawLine: string, ctx: NormalizeContext): Event[] {
  let rec: Raw;
  try {
    rec = JSON.parse(rawLine);
  } catch {
    return [];
  }
  const type = String(rec.type ?? "");
  // a message the user typed while the agent was working is stored as a queued_command attachment
  if (type === "attachment" && rec.attachment?.type === "queued_command") {
    const text = blockText(rec.attachment.prompt).trim();
    if (!text) return [];
    const ts0: string = typeof rec.timestamp === "string" ? rec.timestamp : ctx.lastTs;
    const ev = base(ctx, rec, typeof rec.uuid === "string" ? rec.uuid : `h:${sha256(rawLine).slice(0, 16)}`, typeof rec.parentUuid === "string" ? rec.parentUuid : null, "user.prompt", text, ts0);
    ev.data = { queued: true };
    return [ev];
  }
  if (SKIP_TYPES.has(type)) return [];
  const ts: string = typeof rec.timestamp === "string" ? rec.timestamp : ctx.lastTs;
  const id: string = typeof rec.uuid === "string" ? rec.uuid : `h:${sha256(rawLine).slice(0, 16)}`;
  const parent: string | null = typeof rec.parentUuid === "string" ? rec.parentUuid : null;

  switch (type) {
    case "user": {
      const content = rec.message?.content;
      if (rec.isCompactSummary) return [base(ctx, rec, id, parent, "compaction", blockText(content), ts)];
      if (typeof content === "string") {
        if (rec.isMeta) return [];
        const t = content.trim();
        if (t.startsWith("<local-command-caveat>") || t.startsWith("<local-command-stdout>")) return [];
        if (t.startsWith("<command-name>")) {
          const name = /<command-name>([^<]*)<\/command-name>/.exec(t)?.[1]?.trim() ?? "";
          const args = /<command-args>([^<]*)<\/command-args>/.exec(t)?.[1]?.trim() ?? "";
          return [base(ctx, rec, id, parent, "user.command", `${name} ${args}`.trim(), ts)];
        }
        if (isTaskNotification(t)) return [taskNotification(ctx, rec, id, parent, t, ts)];
        return [base(ctx, rec, id, parent, "user.prompt", content, ts)];
      }
      if (!Array.isArray(content)) return [];
      const events: Event[] = [];
      let prev = parent;
      // A typed prompt arrives as several text blocks (IDE context, pasted content, the prompt itself).
      // They are one user turn, so merge them into a single user.prompt event with the record's uuid.
      const textBlocks = rec.isMeta
        ? []
        : content.filter((b: Raw) => b?.type === "text" && !String(b.text ?? "").trim().startsWith("<system-reminder>"));
      if (textBlocks.length > 0) {
        const merged = textBlocks.map((b: Raw) => String(b.text ?? "")).join("\n\n");
        const ev = isTaskNotification(merged.trim()) ? taskNotification(ctx, rec, id, prev, merged.trim(), ts) : base(ctx, rec, id, prev, "user.prompt", merged, ts);
        events.push(ev);
        prev = id;
      }
      content.forEach((block: Raw, i: number) => {
        const bid = i === 0 && events.length === 0 ? id : `${id}#${i}`;
        if (block?.type === "tool_result") {
          let text = blockText(block.content);
          if (!text && rec.toolUseResult != null) {
            text = typeof rec.toolUseResult === "string" ? rec.toolUseResult : JSON.stringify(rec.toolUseResult);
          }
          const ev = base(ctx, rec, bid, prev, "tool.result", text, ts);
          ev.tool = { name: "", call_id: String(block.tool_use_id ?? "") };
          if (block.is_error) ev.data = { is_error: true };
          events.push(ev);
          prev = bid;
        } else if (block?.type === "text") {
          return; // merged above
        } else if (block?.type === "image") {
          events.push(base(ctx, rec, bid, prev, "user.prompt", "[image]", ts));
          prev = bid;
        }
      });
      return events;
    }
    case "assistant": {
      const content = rec.message?.content;
      const blocks: Raw[] = Array.isArray(content) ? content : typeof content === "string" ? [{ type: "text", text: content }] : [];
      const events: Event[] = [];
      let prev = parent;
      const model: string | undefined = rec.message?.model;
      const usage = usageOf(rec.message?.usage);
      blocks.forEach((block, i) => {
        const bid = i === 0 ? id : `${id}#${i}`;
        let ev: Event | undefined;
        if (block.type === "text") {
          ev = base(ctx, rec, bid, prev, "assistant.text", String(block.text ?? ""), ts);
        } else if (block.type === "thinking" || block.type === "redacted_thinking") {
          const t = String(block.thinking ?? "");
          ev = base(ctx, rec, bid, prev, "assistant.thinking", t, ts);
          if (!t) ev.data = { hidden: true };
        } else if (block.type === "tool_use") {
          const input = block.input ?? {};
          const desc = typeof input.description === "string" ? input.description : undefined;
          ev = base(ctx, rec, bid, prev, "tool.call", JSON.stringify(input), ts);
          ev.tool = { name: String(block.name ?? ""), call_id: String(block.id ?? "") };
          if (desc) ev.data = { description: desc };
        }
        if (!ev) return;
        if (model) ev.model = model;
        if (usage && events.length === 0) ev.usage = usage;
        events.push(ev);
        prev = bid;
      });
      return events;
    }
    case "summary": {
      const ev = base(ctx, rec, id, parent, "compaction", String(rec.summary ?? ""), ts);
      if (typeof rec.leafUuid === "string") ev.data = { leaf: rec.leafUuid };
      return [ev];
    }
    case "system": {
      const sub = String(rec.subtype ?? "");
      const ev = base(ctx, rec, id, parent, "system", typeof rec.content === "string" ? rec.content : sub, ts);
      const data: Record<string, unknown> = { subtype: sub };
      if (typeof rec.durationMs === "number") data.duration_ms = rec.durationMs;
      if (typeof rec.messageCount === "number") data.message_count = rec.messageCount;
      ev.data = data;
      return [ev];
    }
    case "cost-state": {
      const ev = base(ctx, rec, id, parent, "cost", "", ts);
      ev.data = {
        total_cost_usd: rec.totalCostUSD,
        total_duration_ms: rec.totalDuration,
        api_duration_ms: rec.totalAPIDuration,
        lines_added: rec.totalLinesAdded,
        lines_removed: rec.totalLinesRemoved,
        model_usage: rec.modelUsage,
      };
      return [ev];
    }
    case "ai-title":
    case "custom-title":
    case "agent-name": {
      const text = String(rec.aiTitle ?? rec.customTitle ?? rec.agentName ?? "");
      const ev = base(ctx, rec, id, parent, "title", text, ts);
      ev.data = { source: type };
      return [ev];
    }
    default: {
      const ev = base(ctx, rec, id, parent, "meta", "", ts);
      ev.data = { type };
      return [ev];
    }
  }
}

/** Background task completions arrive in the user role but were not written by the human. */
function isTaskNotification(t: string): boolean {
  return t.startsWith("<task-notification>");
}

function taskNotification(ctx: NormalizeContext, rec: Raw, id: string, parent: string | null, text: string, ts: string): Event {
  const ev = base(ctx, rec, id, parent, "system", text, ts);
  const status = /<status>([^<]*)<\/status>/.exec(text)?.[1];
  const summary = /<summary>([^<]*)<\/summary>/.exec(text)?.[1];
  ev.data = { subtype: "task-notification", ...(status ? { status } : {}), ...(summary ? { summary } : {}) };
  return ev;
}
