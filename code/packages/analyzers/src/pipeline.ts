import { Store, type ProjectIndex } from "@yolo-twice/core";
import { toMermaid } from "./graph.js";
import { decorate, TextCache } from "./semantic.js";
import { buildStructure } from "./structure.js";

/** Rebuild the structural artifacts of one session from its events. No LLM. Deterministic. */
export function deriveSession(store: Store, session: string): ReturnType<typeof buildStructure> {
  const events = store.readEvents(session);
  const built = buildStructure(session, events);
  decorate(built.session, new TextCache(store.textDir(session), store.openTextDir(session)));
  store.writeStructure(session, built.session);
  store.writeGraph(session, toMermaid(built.session, { level: 2 }), 2);
  store.writeGraph(session, toMermaid(built.session, { level: 1 }), 1);
  const s = built.session;
  store.writeSessionMeta({ id: session, agent: "claude-code", label: s.label, ts_first: s.span.ts_first, ts_last: s.span.ts_last, events: s.stats.events, cost_usd: s.stats.cost_usd });
  return built;
}

/** Rebuild the local project list (L-1) from every session's meta.json. Never committed. */
export function deriveProject(store: Store, projectName: string): ProjectIndex {
  const index: ProjectIndex = store.buildProjectIndex(projectName) ?? { version: 1, project: projectName, sessions: [] };
  store.writeProjectIndex(index);
  return index;
}
