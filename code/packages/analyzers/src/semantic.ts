import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { readJson, sha256, writeJsonAtomic, type Attention, type Event, type Granularity, type StructureNode } from "@yolo-twice/core";
import { walk } from "./structure.js";

export const ANALYZER_VERSION = "1";

export interface SummarizeInput {
  granularity: Exclude<Granularity, "full">;
  /** The text to shorten: the node's full text, or its next-longer granularity. */
  text: string;
  /** What kind of thing this is, for the prompt. */
  kind: StructureNode["kind"];
  label?: string;
}

export interface Summarizer {
  readonly name: string;
  summarize(input: SummarizeInput): Promise<string>;
}

const TARGETS: Record<Exclude<Granularity, "full">, string> = {
  title: "one line of at most 12 words, no trailing period",
  abstract: "at most three sentences: what was done, why, and the outcome",
  summary: "one paragraph or a short bullet list of the main steps and decisions, at most 120 words",
};

/** No-LLM fallback: deterministic head/tail extraction. Always available. */
export class StructuralSummarizer implements Summarizer {
  readonly name = "structural";
  async summarize(input: SummarizeInput): Promise<string> {
    const flat = input.text.replace(/\s+/g, " ").trim();
    switch (input.granularity) {
      case "title":
        return input.label ?? cut(flat, 80);
      case "abstract":
        return cut(flat, 300);
      case "summary":
        return cut(flat, 800);
    }
  }
}

function cut(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export interface ClaudeCliOptions {
  model?: string;
  /** Path to the claude binary. */
  bin?: string;
  timeoutMs?: number;
}

/**
 * Summarize through the user's own Claude Code CLI in headless mode.
 * --bare skips hooks (so our own hooks never recurse), --no-session-persistence keeps ~/.claude clean,
 * --tools "" makes it a pure text call.
 */
export class ClaudeCliSummarizer implements Summarizer {
  readonly name: string;
  constructor(private readonly opts: ClaudeCliOptions = {}) {
    this.name = `claude-cli:${opts.model ?? "haiku"}`;
  }

  async summarize(input: SummarizeInput): Promise<string> {
    const prompt = [
      `You condense a coding-agent transcript ${input.kind} for a developer who wants to skim it.`,
      `Write a ${input.granularity}: ${TARGETS[input.granularity]}.`,
      "Be concrete: name files, commands, errors and decisions. No preamble, no markdown headings.",
      "",
      "<transcript>",
      input.text,
      "</transcript>",
    ].join("\n");
    const schema = JSON.stringify({ type: "object", properties: { text: { type: "string" } }, required: ["text"] });
    const args = [
      "-p",
      "--bare",
      "--no-session-persistence",
      "--tools",
      "",
      "--max-turns",
      "1",
      "--output-format",
      "json",
      "--json-schema",
      schema,
      "--model",
      this.opts.model ?? "haiku",
    ];
    const out = await run(this.opts.bin ?? "claude", args, prompt, this.opts.timeoutMs ?? 120_000);
    const parsed = JSON.parse(out) as { structured_output?: { text?: string }; result?: string; is_error?: boolean };
    const text = parsed.structured_output?.text ?? tryParseResult(parsed.result);
    if (!text) throw new Error(`claude -p returned no text: ${out.slice(0, 300)}`);
    return text.trim();
  }
}

function tryParseResult(result: string | undefined): string | undefined {
  if (!result) return undefined;
  try {
    const j = JSON.parse(result) as { text?: string };
    return j.text ?? result;
  } catch {
    return result;
  }
}

function run(bin: string, args: string[], stdin: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, CLAUDE_CODE_YOLO_TWICE: "1" } });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`claude -p timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`claude -p exited ${code}: ${err.slice(0, 500)}`));
    });
    child.stdin.end(stdin);
  });
}

/* ---------- cache: one file per (node, granularity, input hash) ---------- */

export interface TextArtifact {
  node: string;
  granularity: Granularity;
  hash: string;
  analyzer: string;
  version: string;
  text: string;
  created: string;
  interim?: boolean;
}

export function inputHash(text: string, granularity: string, analyzer: string): string {
  return sha256(`${ANALYZER_VERSION}\n${analyzer}\n${granularity}\n${text}`).slice(0, 16);
}

export function artifactPath(textDir: string, nodeId: string, granularity: Granularity, hash: string): string {
  return path.join(textDir, `${nodeId.replace(/[^A-Za-z0-9_.-]/g, "_")}.${granularity}.${hash}.json`);
}

/**
 * Summaries live in two places: finished nodes in the committed `text/` folder (their input can no
 * longer change), nodes still at the live tail in a local folder (they change every turn and would
 * only churn the repository).
 */
export class TextCache {
  constructor(
    readonly textDir: string,
    readonly openDir?: string,
  ) {}

  private dirs(): string[] {
    return this.openDir ? [this.textDir, this.openDir] : [this.textDir];
  }

  get(nodeId: string, granularity: Granularity, hash: string): TextArtifact | undefined {
    for (const d of this.dirs()) {
      const a = readJson<TextArtifact>(artifactPath(d, nodeId, granularity, hash));
      if (a) return a;
    }
    return undefined;
  }

  put(artifact: TextArtifact, open = false): void {
    const dir = open && this.openDir ? this.openDir : this.textDir;
    writeJsonAtomic(artifactPath(dir, artifact.node, artifact.granularity, artifact.hash), artifact);
  }

  /** Latest artifact per granularity for a node, regardless of hash (used for display when input moved on). */
  latest(nodeId: string): Partial<Record<Granularity, TextArtifact>> {
    const prefix = nodeId.replace(/[^A-Za-z0-9_.-]/g, "_") + ".";
    const out: Partial<Record<Granularity, TextArtifact>> = {};
    for (const dir of this.dirs()) {
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!f.startsWith(prefix) || !f.endsWith(".json")) continue;
        const a = readJson<TextArtifact>(path.join(dir, f));
        if (!a) continue;
        const cur = out[a.granularity];
        if (!cur || cur.created < a.created) out[a.granularity] = a;
      }
    }
    return out;
  }
}

/* ---------- node text and job planning ---------- */

/** The full text of a node: the concatenation of its events, in order, with role markers. */
export function nodeFullText(node: StructureNode, eventsById: Map<string, Event>): string {
  const parts: string[] = [];
  for (const n of walk(node)) {
    for (const id of n.event_ids ?? []) {
      const e = eventsById.get(id);
      if (!e) continue;
      const role = e.kind === "tool.call" ? `tool ${e.tool?.name ?? ""}` : e.kind;
      parts.push(`[${role}] ${e.text}`);
    }
  }
  return parts.join("\n");
}

export interface SemanticJob {
  node: StructureNode;
  granularity: Exclude<Granularity, "full">;
  interim: boolean;
  /** The node still grows (it ends at the live tail): its summary stays local. */
  open?: boolean;
}

/** Idle time after which the tail of a session counts as finished (same as a phase gap). */
export const OPEN_IDLE_MS = 30 * 60 * 1000;

/** A node is open while it ends at the session's newest event and the session was active recently. */
export function isOpenNode(node: StructureNode, root: StructureNode, now = Date.now(), idleMs = OPEN_IDLE_MS): boolean {
  if (node.span.last !== root.span.last) return false;
  const last = Date.parse(root.span.ts_last);
  return Number.isNaN(last) || now - last < idleMs;
}

/** Which (node, granularity) pairs the attention detent wants computed eagerly. */
export function planJobs(session: StructureNode, attention: Attention, openTurnId?: string): SemanticJob[] {
  const jobs: SemanticJob[] = [];
  const push = (node: StructureNode, g: SemanticJob["granularity"], interim = false) => jobs.push({ node, granularity: g, interim });
  switch (attention) {
    case "yolo":
      return jobs;
    case "balanced":
      for (const p of session.children.slice(0, -1)) push(p, "title"), push(p, "abstract");
      return jobs;
    case "attentive":
      for (const p of session.children) {
        for (const t of p.children) if (t.id !== openTurnId) push(t, "title");
        if (p !== session.children.at(-1)) push(p, "title"), push(p, "abstract");
      }
      return jobs;
    case "micro":
      for (const p of session.children) {
        for (const t of p.children) push(t, "title", t.id === openTurnId), push(t, "abstract", t.id === openTurnId);
        push(p, "title", p === session.children.at(-1)), push(p, "abstract", p === session.children.at(-1));
      }
      push(session, "title", true), push(session, "abstract", true);
      return jobs;
  }
}

/** Compute one artifact unless an identical one exists. Returns the artifact. */
export async function summarizeNode(
  job: SemanticJob,
  eventsById: Map<string, Event>,
  cache: TextCache,
  summarizer: Summarizer,
): Promise<TextArtifact> {
  const full = nodeFullText(job.node, eventsById);
  const hash = inputHash(full, job.granularity, summarizer.name);
  const hit = cache.get(job.node.id, job.granularity, hash);
  if (hit) return hit;
  const text = await summarizer.summarize({ granularity: job.granularity, text: full, kind: job.node.kind, label: job.node.label });
  const artifact: TextArtifact = {
    node: job.node.id,
    granularity: job.granularity,
    hash,
    analyzer: summarizer.name,
    version: ANALYZER_VERSION,
    text,
    created: new Date().toISOString(),
  };
  if (job.interim) artifact.interim = true;
  cache.put(artifact, job.interim || job.open === true);
  return artifact;
}

/** Attach the latest cached texts to every node (for serving). Mutates and returns the tree. */
export function decorate(session: StructureNode, cache: TextCache): StructureNode {
  for (const n of walk(session)) {
    const latest = cache.latest(n.id);
    const text: Partial<Record<Granularity, string>> = {};
    for (const g of ["title", "abstract", "summary"] as const) if (latest[g]) text[g] = latest[g]!.text;
    if (Object.keys(text).length) n.text = text;
  }
  return session;
}
