import { useEffect, useRef, useState } from "react";
import { api, type AutoCommit, type Sharing } from "./api";

export type StreamEvent =
  | { type: "hook"; data: { hook_event_name: string; session_id: string } }
  | { type: "ingest"; data: { session: string; appended: number } }
  | { type: "structure"; data: { session: string } }
  | { type: "semantic"; data: { session: string; node: string; granularity: string; interim?: boolean } }
  | { type: "config"; data: { attention: string } }
  | { type: "autocommit"; data: AutoCommit }
  /** The project's sharing state changed: remotes, environment, or sessions moved between the shared and the private folder. */
  | { type: "sharing"; data: Sharing }
  /** One session was made shared or private. */
  /** What Claude is doing in a session, from Claude Code's hooks (sent again on every connect). */
  | { type: "activity"; data: { session_id: string; activity: "working" | "waiting" | "idle"; ts: string } };

/** EventSource on /api/stream with reconnect backoff. `onEvent` is kept in a ref so it never re-subscribes. */
export function useStream(onEvent: (e: StreamEvent) => void): "connecting" | "live" | "offline" {
  const [state, setState] = useState<"connecting" | "live" | "offline">("connecting");
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    let es: EventSource | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = 1000;
    let closed = false;
    let build: string | undefined;

    const connect = () => {
      if (closed) return;
      setState("connecting");
      es = new EventSource(api.streamUrl());
      // a changed build id means the engine restarted or the UI was rebuilt: reload to pick up both
      const checkBuild = (ev: Event) => {
        try {
          const b = (JSON.parse((ev as MessageEvent).data) as { build?: string }).build;
          if (b && build && b !== build) location.reload();
          build ??= b;
        } catch {
          /* ignore malformed frame */
        }
      };
      es.addEventListener("hello", (ev) => {
        delay = 1000;
        setState("live");
        checkBuild(ev);
      });
      es.addEventListener("build", checkBuild);
      for (const type of ["hook", "ingest", "structure", "semantic", "config", "autocommit", "sharing", "activity"] as const) {
        es.addEventListener(type, (ev) => {
          try {
            handler.current({ type, data: JSON.parse((ev as MessageEvent).data) } as StreamEvent);
          } catch {
            /* ignore malformed frame */
          }
        });
      }
      es.onerror = () => {
        es?.close();
        setState("offline");
        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 30_000);
      };
    };
    connect();
    return () => {
      closed = true;
      es?.close();
      if (timer) clearTimeout(timer);
    };
  }, []);

  return state;
}
