import { z } from "zod";

/** Event kinds. Names follow OpenTelemetry GenAI vocabulary where one exists. */
export const EventKind = z.enum([
  "user.prompt",
  "user.command",
  "assistant.text",
  "assistant.thinking",
  "tool.call",
  "tool.result",
  "subagent.start",
  "subagent.stop",
  "compaction",
  "cost",
  "title",
  "system",
  "meta",
]);
export type EventKind = z.infer<typeof EventKind>;

export const Usage = z
  .object({
    input_tokens: z.number(),
    output_tokens: z.number(),
    cache_read_tokens: z.number(),
    cache_write_tokens: z.number(),
  })
  .partial();
export type Usage = z.infer<typeof Usage>;

/** One normalized, redacted event. One line of events.ndjson. */
export const Event = z.object({
  id: z.string(),
  ts: z.string(),
  session: z.string(),
  agent: z.string(),
  agent_id: z.string().nullable(),
  parent: z.string().nullable(),
  kind: EventKind,
  tool: z.object({ name: z.string(), call_id: z.string().optional() }).optional(),
  text: z.string(),
  model: z.string().optional(),
  usage: Usage.optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  redacted: z.object({ count: z.number(), rules: z.array(z.string()) }).optional(),
  src: z.object({ file: z.string(), line: z.number() }),
});
export type Event = z.infer<typeof Event>;

export const Granularity = z.enum(["title", "abstract", "summary", "full"]);
export type Granularity = z.infer<typeof Granularity>;

export const NodeKind = z.enum(["project", "session", "phase", "turn", "step", "record"]);
export type NodeKind = z.infer<typeof NodeKind>;

export const NodeStats = z.object({
  events: z.number(),
  tool_calls: z.number(),
  input_tokens: z.number(),
  output_tokens: z.number(),
  cost_usd: z.number().optional(),
  duration_ms: z.number().optional(),
});
export type NodeStats = z.infer<typeof NodeStats>;

export interface StructureNode {
  id: string;
  level: number; // -1 project, 0 session, 1 phase, 2 turn, 3 step, 4 record
  kind: NodeKind;
  label: string;
  span: { first: string; last: string; ts_first: string; ts_last: string };
  event_ids?: string[];
  children: StructureNode[];
  stats: NodeStats;
  text?: Partial<Record<Granularity, string>>;
  meta?: {
    branch?: boolean;
    branch_from?: string;
    agent_id?: string;
    agent_type?: string;
    tool?: string;
    step_kind?: string;
    boundary?: "compaction" | "gap" | "command";
  };
}
export const StructureNode: z.ZodType<StructureNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    level: z.number().int().min(-1).max(4),
    kind: NodeKind,
    label: z.string(),
    span: z.object({ first: z.string(), last: z.string(), ts_first: z.string(), ts_last: z.string() }),
    event_ids: z.array(z.string()).optional(),
    children: z.array(StructureNode),
    stats: NodeStats,
    text: z.record(Granularity, z.string()).optional(),
    meta: z
      .object({
        branch: z.boolean().optional(),
        branch_from: z.string().optional(),
        agent_id: z.string().optional(),
        agent_type: z.string().optional(),
        tool: z.string().optional(),
        step_kind: z.string().optional(),
        boundary: z.enum(["compaction", "gap", "command"]).optional(),
      })
      .optional(),
  }),
);

export const Attention = z.enum(["micro", "attentive", "balanced", "yolo"]);
export type Attention = z.infer<typeof Attention>;

export const RedactionRule = z.object({ name: z.string(), pattern: z.string(), flags: z.string().optional() });

export const Config = z.object({
  version: z.literal(1),
  attention: Attention,
  sources: z.array(z.enum(["claude-code"])),
  redaction: z.object({
    extra_rules: z.array(RedactionRule),
    max_text_chars: z.number(),
  }),
  analyzers: z.object({
    semantic: z.boolean(),
    model: z.string(),
  }),
});
export type Config = z.infer<typeof Config>;

export const DEFAULT_CONFIG: Config = {
  version: 1,
  attention: "balanced",
  sources: ["claude-code"],
  redaction: { extra_rules: [], max_text_chars: 8000 },
  analyzers: { semantic: true, model: "haiku" },
};

/** Per-session ingestion cursor, stored in source.json. */
export const FileCursor = z.object({
  bytes: z.number(),
  lines: z.number(),
  size: z.number(),
  mtime_ms: z.number(),
  head_hash: z.string(),
  started_emitted: z.boolean().optional(),
  stop_emitted: z.boolean().optional(),
  last_ts: z.string().optional(),
});
export type FileCursor = z.infer<typeof FileCursor>;

export const SourceState = z.object({
  agent: z.string(),
  session: z.string(),
  origin_dir: z.string(),
  files: z.record(z.string(), FileCursor),
  /** Normalizer version that produced events.ndjson; a different version rebuilds the session. */
  normalizer: z.number().optional(),
});
export type SourceState = z.infer<typeof SourceState>;

export const ProjectIndex = z.object({
  version: z.literal(1),
  project: z.string(),
  sessions: z.array(
    z.object({
      id: z.string(),
      agent: z.string(),
      label: z.string(),
      ts_first: z.string(),
      ts_last: z.string(),
      events: z.number(),
      cost_usd: z.number().optional(),
    }),
  ),
  text: z.record(Granularity, z.string()).optional(),
});
export type ProjectIndex = z.infer<typeof ProjectIndex>;
