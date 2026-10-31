/** Thin client for the engine API. Shapes follow code/API.md (contract v1). */
import type { Attention, Config, Event, Granularity, ImageRef, ProjectIndex, StructureNode } from "@yolo-twice/core";
import type { SearchHit, TextArtifact } from "@yolo-twice/analyzers";

export type { Attention, Config, Event, Granularity, ImageRef, ProjectIndex, StructureNode, SearchHit, TextArtifact };

export const ATTENTION: Attention[] = ["micro", "attentive", "balanced", "yolo"];
export const ATTENTION_LABEL: Record<Attention, string> = {
  micro: "micro management",
  attentive: "attentive",
  balanced: "balanced",
  yolo: "yolo",
};

/** Which network interface the engine listens on (GET/PUT /api/network). */
export interface NetworkInfo {
  host: string;
  port: number;
  exposed: boolean;
  urls: string[];
  /** Set at start (--host or YOLO_TWICE_HOST): shown, not changeable. */
  lockedBy?: string;
  /** Running in a container: reachable through the port published on the host. */
  container?: boolean;
}

/** Auto-commit of .yolo-twice. Lives in engine memory only: off after every engine restart. */
export interface AutoCommit {
  enabled: boolean;
  intervalMs: number;
  lastCommit?: { ts: string; sha: string; files: number };
  lastCheck?: string;
  next?: string;
  skipped?: string;
}

/** Project key (or root) passed on every call; empty means "engine default". Set from the URL by App. */
export let project = "";
export function setProject(key: string): void {
  project = key;
}

function qs(params: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  if (project) p.set("project", project);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${url} -> ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  /** A pasted image of a session (content-addressed, cacheable). */
  imageUrl: (id: string, file: string) => `/api/sessions/${id}/images/${file}${qs({})}`,
  sessions: () => json<ProjectIndex & { current?: string }>(`/api/sessions${qs({})}`),
  structure: (id: string) => json<StructureNode>(`/api/sessions/${id}/structure${qs({})}`),
  graph: async (id: string, level: 1 | 2 | 3) => {
    const res = await fetch(`/api/sessions/${id}/graph${qs({ level })}`);
    if (!res.ok) throw new Error(`graph ${res.status}`);
    return res.text();
  },
  /** All events of a session, following `next` cursors. */
  events: async (id: string): Promise<Event[]> => {
    const all: Event[] = [];
    let after: string | undefined;
    for (;;) {
      const page = await json<{ events: Event[]; next?: string }>(`/api/sessions/${id}/events${qs({ after, limit: 500 })}`);
      all.push(...page.events);
      if (!page.next || page.events.length === 0) break;
      after = page.next;
    }
    return all;
  },
  text: (id: string, node: string, granularity: Granularity) =>
    json<TextArtifact>(`/api/sessions/${id}/text`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project: project || undefined, node, granularity }),
    }),
  digest: (id: string, since: string | undefined) => json<{ since?: string; until: string; events: number; text: string }>(`/api/sessions/${id}/digest${qs({ since })}`),
  projects: () => json<{ root: string; key: string; name: string; sessions: number }[]>(`/api/projects`),
  /** A scripted demo kept with the project (.yolo-twice/demos/<name>.json); demo.ts checks its shape. */
  demo: (name: string) => json<unknown>(`/api/demos/${encodeURIComponent(name)}${qs({})}`),
  /** Filtered search; without `session` the whole project. `k` is the comma list of filter codes. */
  search: (q: string, opts: { session?: string; k?: string; limit?: number } = {}) =>
    json<{ hits: SearchHit[]; tools?: string[] }>(`/api/search${qs({ q, session: opts.session, k: opts.k, limit: opts.limit ?? 200 })}`),
  config: () => json<Config>(`/api/config${qs({})}`),
  setAttention: (attention: Attention) =>
    json<Config>(`/api/config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project: project || undefined, attention }),
    }),
  autoCommit: () => json<AutoCommit>(`/api/autocommit${qs({})}`),
  setAutoCommit: (enabled: boolean) =>
    json<AutoCommit>(`/api/autocommit`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project: project || undefined, enabled }),
    }),
  network: () => json<NetworkInfo>(`/api/network`),
  setNetwork: (host: string) => json<NetworkInfo>(`/api/network`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ host }) }),
  streamUrl: () => `/api/stream${qs({})}`,
};

/* ---- small helpers shared by views ---- */

export function* walk(n: StructureNode): Generator<StructureNode> {
  yield n;
  for (const c of n.children) yield* walk(c);
}

export function findNode(root: StructureNode | undefined, id: string): StructureNode | undefined {
  if (!root) return undefined;
  for (const n of walk(root)) if (n.id === id) return n;
  return undefined;
}

/** Path of ancestor ids from the root down to (excluding) `id`. */
export function ancestors(root: StructureNode, id: string): string[] {
  const path: string[] = [];
  const dfs = (n: StructureNode): boolean => {
    if (n.id === id) return true;
    path.push(n.id);
    for (const c of n.children) if (dfs(c)) return true;
    path.pop();
    return false;
  };
  return dfs(root) ? path : [];
}

export function fmtTokens(n: number): string {
  return n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function storage<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function store(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode */
  }
}
