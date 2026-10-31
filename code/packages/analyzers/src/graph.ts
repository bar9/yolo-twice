import type { StructureNode } from "@yolo-twice/core";

function esc(label: string, max = 60): string {
  const t = label.replace(/\s+/g, " ").trim();
  const cut = t.length > max ? t.slice(0, max - 1) + "…" : t;
  return cut.replace(/"/g, "#quot;").replace(/[[\]{}()<>|]/g, " ");
}

function safeId(id: string): string {
  return id.replace(/[^A-Za-z0-9_]/g, "_");
}

export interface GraphOptions {
  /** 1 = phases only, 2 = turns inside phase subgraphs (default), 3 = turns with their steps. */
  level?: 1 | 2 | 3;
  direction?: "TD" | "LR";
}

/**
 * Emit the session as mermaid text. Nodes carry the structure ids so a renderer can map clicks back.
 * Sequence edges follow turn order; rewinds get a dotted "rewind" edge; subagents hang off their turn.
 */
export function toMermaid(session: StructureNode, options: GraphOptions = {}): string {
  const level = options.level ?? 2;
  const dir = options.direction ?? "TD";
  const lines: string[] = [`flowchart ${dir}`];
  const classes: string[] = [];
  const edges: string[] = [];
  let prevTurn: string | undefined;

  const sid = safeId(session.id);
  lines.push(`  ${sid}(["${esc(session.label, 50)}"])`);
  classes.push(`  class ${sid} session;`);

  for (const phase of session.children) {
    const pid = safeId(phase.id);
    if (level === 1) {
      lines.push(`  ${pid}["${esc(phase.label)}"]`);
      classes.push(`  class ${pid} phase;`);
      edges.push(prevTurn ? `  ${prevTurn} --> ${pid}` : `  ${sid} --> ${pid}`);
      prevTurn = pid;
      continue;
    }
    lines.push(`  subgraph ${pid} ["${esc(phase.label, 50)}"]`);
    lines.push(`    direction ${dir}`);
    for (const turn of phase.children) {
      const tid = safeId(turn.id);
      const shape = turn.meta?.step_kind === "command" ? `>"${esc(turn.label)}"]` : `["${esc(turn.label)}"]`;
      lines.push(`    ${tid}${shape}`);
      classes.push(`  class ${tid} ${turn.meta?.branch ? "branch" : "turn"};`);
      if (turn.meta?.branch) {
        edges.push(`  ${prevTurn ?? sid} -. rewind .-> ${tid}`);
      } else {
        edges.push(prevTurn ? `  ${prevTurn} --> ${tid}` : `  ${sid} --> ${tid}`);
      }
      prevTurn = tid;
      if (level >= 3) {
        let prevStep: string | undefined;
        for (const step of turn.children) {
          const stid = safeId(step.id);
          const kind = step.meta?.step_kind ?? "step";
          const label = esc(step.label, 40);
          const shape = kind === "tool" || kind === "tool-error" ? `[/"${label}"/]` : kind === "subagent" ? `[["${label}"]]` : `("${label}")`;
          lines.push(`    ${stid}${shape}`);
          classes.push(`  class ${stid} ${kind === "tool-error" ? "error" : kind};`);
          edges.push(`  ${prevStep ?? tid} --> ${stid}`);
          prevStep = stid;
        }
      } else {
        for (const step of turn.children) {
          if (step.meta?.step_kind !== "subagent") continue;
          const aid = safeId(step.id);
          lines.push(`    ${aid}[["${esc(step.label, 40)}"]]`);
          classes.push(`  class ${aid} subagent;`);
          edges.push(`  ${tid} -.-> ${aid}`);
        }
      }
    }
    lines.push("  end");
  }

  lines.push(...edges);
  lines.push(
    "  classDef session fill:#1f2937,color:#fff,stroke:#111;",
    "  classDef phase fill:#e5e7eb,stroke:#9ca3af;",
    "  classDef turn fill:#dbeafe,stroke:#60a5fa;",
    "  classDef branch fill:#fde68a,stroke:#d97706;",
    "  classDef subagent fill:#ede9fe,stroke:#8b5cf6;",
    "  classDef tool fill:#dcfce7,stroke:#22c55e;",
    "  classDef error fill:#fee2e2,stroke:#ef4444;",
    "  classDef text fill:#f3f4f6,stroke:#9ca3af;",
    "  classDef thinking fill:#f3f4f6,stroke:#d1d5db,stroke-dasharray: 3 3;",
  );
  lines.push(...classes);
  return lines.join("\n") + "\n";
}
