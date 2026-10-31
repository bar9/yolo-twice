import type { Event, NodeStats, StructureNode } from "@yolo-twice/core";

export interface StructureOptions {
  /** Idle gap between turns that starts a new phase. */
  gapMs?: number;
}

const DEFAULTS: Required<StructureOptions> = { gapMs: 30 * 60 * 1000 };

export function firstLine(text: string, max = 80): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? line.slice(0, max - 1) + "…" : line;
}

/** A prompt label without the context Claude Code injects: IDE blocks, command wrappers, pasted-content tags. */
export function promptLabel(text: string, max = 80): string {
  const stripped = text
    .replace(/<(ide_[a-z_]+|system-reminder)>[\s\S]*?<\/\1>/g, " ")
    .replace(/<\/?[a-z_-]+(?:\s[^>]*)?>/g, " ");
  const label = firstLine(stripped, max);
  return label || firstLine(text, max);
}

function emptyStats(): NodeStats {
  return { events: 0, tool_calls: 0, input_tokens: 0, output_tokens: 0 };
}

function addStats(into: NodeStats, ev: Event): void {
  into.events++;
  if (ev.kind === "tool.call") into.tool_calls++;
  if (ev.usage) {
    into.input_tokens += (ev.usage.input_tokens ?? 0) + (ev.usage.cache_read_tokens ?? 0) + (ev.usage.cache_write_tokens ?? 0);
    into.output_tokens += ev.usage.output_tokens ?? 0;
  }
}

function mergeStats(into: NodeStats, from: NodeStats): void {
  into.events += from.events;
  into.tool_calls += from.tool_calls;
  into.input_tokens += from.input_tokens;
  into.output_tokens += from.output_tokens;
}

function node(id: string, level: number, kind: StructureNode["kind"], label: string, first: Event, last: Event): StructureNode {
  return {
    id,
    level,
    kind,
    label,
    span: { first: first.id, last: last.id, ts_first: first.ts, ts_last: last.ts },
    children: [],
    stats: emptyStats(),
  };
}

function finishSpan(n: StructureNode): void {
  if (n.children.length === 0) return;
  const first = n.children[0]!;
  const last = n.children[n.children.length - 1]!;
  n.span.first = first.span.first;
  n.span.ts_first = first.span.ts_first;
  n.span.last = last.span.last;
  n.span.ts_last = last.span.ts_last;
}

function toolLabel(call: Event): string {
  const name = call.tool?.name ?? "tool";
  const desc = typeof call.data?.description === "string" ? call.data.description : "";
  if (desc) return `${name}: ${firstLine(desc, 70)}`;
  try {
    const input = JSON.parse(call.text) as Record<string, unknown>;
    const hint = input.command ?? input.file_path ?? input.pattern ?? input.query ?? input.url ?? input.description ?? input.prompt;
    if (typeof hint === "string") return `${name}: ${firstLine(hint, 70)}`;
  } catch {
    /* not json */
  }
  return name;
}

/** Steps (L3) for one agent's events in one turn. Tool calls absorb their results; Agent calls absorb the subagent run. */
function buildSteps(events: Event[], prefix: string, subagents: Map<string, Event[]>, subagentTypes: Map<string, string>): StructureNode[] {
  const steps: StructureNode[] = [];
  const resultByCall = new Map<string, Event>();
  for (const ev of events) if (ev.kind === "tool.result" && ev.tool?.call_id) resultByCall.set(ev.tool.call_id, ev);
  const callIds = new Set(events.filter((e) => e.kind === "tool.call" && e.tool?.call_id).map((e) => e.tool!.call_id!));
  const consumed = new Set<string>();
  let n = 0;
  for (const ev of events) {
    if (consumed.has(ev.id)) continue;
    if (ev.kind === "tool.result" && ev.tool?.call_id && callIds.has(ev.tool.call_id)) continue;
    n++;
    const id = `${prefix}.s${n}`;
    let step: StructureNode;
    switch (ev.kind) {
      case "tool.call": {
        const res = ev.tool?.call_id ? resultByCall.get(ev.tool.call_id) : undefined;
        step = node(id, 3, "step", toolLabel(ev), ev, res ?? ev);
        step.event_ids = res ? [ev.id, res.id] : [ev.id];
        step.meta = { step_kind: "tool", tool: ev.tool?.name };
        addStats(step.stats, ev);
        if (res) {
          consumed.add(res.id);
          addStats(step.stats, res);
          if (res.data?.is_error) step.meta.step_kind = "tool-error";
        }
        const agentId = ev.tool?.call_id ? [...subagents.entries()].find(([, evs]) => evs.some((s) => s.kind === "subagent.start" && s.tool?.call_id === ev.tool?.call_id))?.[0] : undefined;
        if (agentId) {
          const subEvents = subagents.get(agentId) ?? [];
          step.meta.step_kind = "subagent";
          step.meta.agent_id = agentId;
          step.meta.agent_type = subagentTypes.get(agentId);
          const inner = subEvents.filter((s) => s.kind !== "subagent.start" && s.kind !== "subagent.stop");
          step.children = buildSteps(inner, `${id}.a`, new Map(), new Map());
          for (const c of step.children) mergeStats(step.stats, c.stats);
          const started = subEvents.find((s) => s.kind === "subagent.start");
          if (started?.text) step.label = `Agent: ${firstLine(started.text, 70)}`;
        }
        break;
      }
      case "assistant.text":
        step = node(id, 3, "step", firstLine(ev.text) || "(empty)", ev, ev);
        step.event_ids = [ev.id];
        step.meta = { step_kind: "text" };
        addStats(step.stats, ev);
        break;
      case "assistant.thinking":
        step = node(id, 3, "step", ev.text ? `thinking: ${firstLine(ev.text, 60)}` : "thinking (hidden)", ev, ev);
        step.event_ids = [ev.id];
        step.meta = { step_kind: "thinking" };
        addStats(step.stats, ev);
        break;
      case "compaction":
        step = node(id, 3, "step", `compaction: ${firstLine(ev.text, 60)}`, ev, ev);
        step.event_ids = [ev.id];
        step.meta = { step_kind: "compaction" };
        addStats(step.stats, ev);
        break;
      case "user.prompt":
      case "user.command":
        step = node(id, 3, "step", promptLabel(ev.text), ev, ev);
        step.event_ids = [ev.id];
        step.meta = { step_kind: ev.kind === "user.command" ? "command" : ev.data?.queued ? "queued" : "prompt" };
        addStats(step.stats, ev);
        break;
      case "tool.result":
        step = node(id, 3, "step", `result: ${firstLine(ev.text, 60)}`, ev, ev);
        step.event_ids = [ev.id];
        step.meta = { step_kind: "result" };
        addStats(step.stats, ev);
        break;
      default:
        n--;
        continue;
    }
    steps.push(step);
  }
  return steps;
}

export interface BuiltStructure {
  session: StructureNode;
  title: string;
  cost_usd?: number;
}

/** Build the L0..L3 tree for one session from its events. Deterministic for the same input. */
export function buildStructure(sessionId: string, events: Event[], options: StructureOptions = {}): BuiltStructure {
  const opt = { ...DEFAULTS, ...options };
  const main = events.filter((e) => e.agent_id == null);
  const subagents = new Map<string, Event[]>();
  const subagentTypes = new Map<string, string>();
  for (const e of events) {
    if (e.agent_id == null) continue;
    subagents.set(e.agent_id, [...(subagents.get(e.agent_id) ?? []), e]);
    if (e.kind === "subagent.start" && typeof e.data?.agent_type === "string") subagentTypes.set(e.agent_id, e.data.agent_type);
  }

  // titles and cost
  let title = "";
  let cost: number | undefined;
  for (const e of main) {
    if (e.kind === "title") {
      const src = e.data?.source;
      if (src === "custom-title" || !title || src === "ai-title") title = e.text || title;
    }
    if (e.kind === "cost" && typeof e.data?.total_cost_usd === "number") cost = e.data.total_cost_usd;
  }

  // children map for branch detection (rewinds create a second child under the same parent)
  // only conversation records take part; system, cost and title records also carry parent ids but are not turns
  const CONVERSATION = new Set(["user.prompt", "user.command", "assistant.text", "assistant.thinking", "tool.call", "tool.result", "compaction"]);
  const children = new Map<string, string[]>();
  for (const e of main) if (e.parent && CONVERSATION.has(e.kind)) children.set(e.parent, [...(children.get(e.parent) ?? []), e.id]);

  // turns: a turn starts at each user prompt or command
  const turnEvents: Event[][] = [];
  let current: Event[] = [];
  // a message typed while the agent was busy (queued) belongs to the running turn, it does not start one
  const isPrompt = (e: Event) => (e.kind === "user.prompt" || e.kind === "user.command") && !e.data?.queued;
  for (const e of main) {
    if (e.kind === "title" || e.kind === "cost" || e.kind === "meta") continue;
    // a turn starts at a prompt; preamble events without a prompt (resume summaries) join the first turn
    if (isPrompt(e) && current.some(isPrompt)) {
      turnEvents.push(current);
      current = [];
    }
    current.push(e);
  }
  if (current.length > 0) turnEvents.push(current);

  const turns: StructureNode[] = turnEvents.map((evs, i) => {
    const first = evs[0]!;
    const last = evs[evs.length - 1]!;
    const prompt = evs.find(isPrompt) ?? evs.find((e) => e.kind === "user.prompt" || e.kind === "user.command");
    const label = prompt ? promptLabel(prompt.text) : "Session start";
    const t = node(`t${i + 1}`, 2, "turn", label, first, last);
    t.children = buildSteps(evs, t.id, subagents, subagentTypes);
    for (const c of t.children) mergeStats(t.stats, c.stats);
    const durations = evs.filter((e) => e.kind === "system" && typeof e.data?.duration_ms === "number").map((e) => e.data!.duration_ms as number);
    if (durations.length) t.stats.duration_ms = durations.reduce((a, b) => a + b, 0);
    if (prompt?.parent && (children.get(prompt.parent)?.length ?? 0) > 1) {
      const siblings = children.get(prompt.parent)!;
      if (siblings.indexOf(prompt.id) > 0) t.meta = { branch: true, branch_from: prompt.parent };
    }
    if (prompt?.kind === "user.command") t.meta = { ...(t.meta ?? {}), step_kind: "command" };
    return t;
  });

  // phases: split on compaction, long idle gaps, and /clear-like commands
  const phases: StructureNode[] = [];
  let phaseTurns: StructureNode[] = [];
  let boundary: "compaction" | "gap" | "command" | undefined;
  const flush = () => {
    if (phaseTurns.length === 0) return;
    const first = phaseTurns[0]!;
    const p: StructureNode = {
      id: `p${phases.length + 1}`,
      level: 1,
      kind: "phase",
      label: phaseTurns.length > 1 ? `${first.label} (+${phaseTurns.length - 1} turns)` : first.label,
      span: { ...first.span },
      children: phaseTurns,
      stats: emptyStats(),
    };
    if (boundary) p.meta = { boundary };
    for (const t of phaseTurns) mergeStats(p.stats, t.stats);
    finishSpan(p);
    phases.push(p);
    phaseTurns = [];
    boundary = undefined;
  };
  let prevEnd: number | undefined;
  let pending: "compaction" | undefined; // a compaction at the end of a turn starts the next phase
  turns.forEach((t, i) => {
    const evs = turnEvents[i]!;
    const start = Date.parse(t.span.ts_first);
    const promptIdx = evs.findIndex(isPrompt);
    const compactionIdx = evs.findIndex((e) => e.kind === "compaction");
    const compactionBefore = compactionIdx >= 0 && compactionIdx < promptIdx;
    const compactionAfter = compactionIdx >= 0 && compactionIdx > promptIdx;
    const isClear = t.meta?.step_kind === "command" && /^\/?(clear|compact)\b/.test(t.label);
    if (phaseTurns.length > 0) {
      if (pending || compactionBefore) {
        flush();
        boundary = "compaction";
      } else if (isClear) {
        flush();
        boundary = "command";
      } else if (prevEnd !== undefined && !Number.isNaN(start) && start - prevEnd > opt.gapMs) {
        flush();
        boundary = "gap";
      }
    }
    pending = compactionAfter ? "compaction" : undefined;
    phaseTurns.push(t);
    const end = Date.parse(t.span.ts_last);
    prevEnd = Number.isNaN(end) ? prevEnd : end;
  });
  flush();

  const firstEv = main[0] ?? events[0];
  const lastEv = main[main.length - 1] ?? events[events.length - 1];
  const session: StructureNode = {
    id: `s:${sessionId}`,
    level: 0,
    kind: "session",
    label: title || turns[0]?.label || sessionId,
    span: firstEv && lastEv ? { first: firstEv.id, last: lastEv.id, ts_first: firstEv.ts, ts_last: lastEv.ts } : { first: "", last: "", ts_first: "", ts_last: "" },
    children: phases,
    stats: emptyStats(),
  };
  for (const p of phases) mergeStats(session.stats, p.stats);
  if (cost !== undefined) session.stats.cost_usd = cost;
  finishSpan(session);
  return { session, title: session.label, cost_usd: cost };
}

/** Depth-first iterator over a structure tree. */
export function* walk(n: StructureNode): Generator<StructureNode> {
  yield n;
  for (const c of n.children) yield* walk(c);
}

export function findNode(root: StructureNode, id: string): StructureNode | undefined {
  for (const n of walk(root)) if (n.id === id) return n;
  return undefined;
}
