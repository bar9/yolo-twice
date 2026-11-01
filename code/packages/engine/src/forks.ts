import fs from "node:fs";
import type { Event, Store } from "@yolo-twice/core";

/**
 * Sessions continued with `resume`: the rebuilt transcript keeps the original record ids, and its
 * title says "(resumed via yolo-twice)". So a fork is found from the events alone, nothing stored:
 * a session with that title whose first conversation event also lives in another session.
 */
export interface Fork {
  /** The session it was forked from. */
  from: string;
  /** Its events copied from there. */
  shared: Set<string>;
}

export const RESUMED = /\(resumed via yolo-twice\)\s*$/;

/** What fork detection needs of one session. */
export interface SessionIds {
  resumed: boolean;
  /** The first conversation event. */
  first?: string;
  ids: string[];
}

export function sessionIds(events: Event[]): SessionIds {
  return { resumed: RESUMED.test(events.find((e) => e.kind === "title")?.text ?? ""), first: events.find((e) => e.kind !== "title")?.id, ids: events.map((e) => e.id) };
}

export function findForks(sessions: Map<string, SessionIds>): Map<string, Fork> {
  const out = new Map<string, Fork>();
  const sets = new Map([...sessions].map(([s, x]) => [s, new Set(x.ids)]));
  for (const [s, x] of sessions) {
    if (!x.resumed || !x.first) continue;
    // the original over another fork of it; a fork of a fork when that is all there is
    const holders = [...sessions.keys()].filter((o) => o !== s && sets.get(o)!.has(x.first!));
    const from = holders.find((o) => !sessions.get(o)!.resumed) ?? holders[0];
    if (!from) continue;
    const theirs = sets.get(from)!;
    out.set(s, { from, shared: new Set(x.ids.filter((id) => theirs.has(id))) });
  }
  return out;
}

/** findForks over a store; each session is read again only when its events file changes. */
export class ForkIndex {
  private seen = new Map<string, { size: number; ids: SessionIds }>();
  private key = "";
  private forks = new Map<string, Fork>();

  constructor(private readonly store: Store) {}

  get(): Map<string, Fork> {
    const sessions = this.store.listSessions();
    let changed = sessions.join() !== this.key;
    for (const s of sessions) {
      const n = size(this.store.eventsFile(s));
      if (this.seen.get(s)?.size === n) continue;
      this.seen.set(s, { size: n, ids: sessionIds(this.store.readEvents(s)) });
      changed = true;
    }
    if (changed) {
      this.forks = findForks(new Map(sessions.flatMap((s) => (this.seen.has(s) ? [[s, this.seen.get(s)!.ids] as const] : []))));
      this.key = sessions.join();
    }
    return this.forks;
  }
}

function size(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return -1;
  }
}
