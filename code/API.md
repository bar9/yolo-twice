# yolo-twice engine API (contract v1)

One engine daemon per machine, bound to `127.0.0.1:9656`, serving every registered project.
Runtime state lives in `~/.yolo-twice/engine.json` (`{pid, port, started, version}`) and
`~/.yolo-twice/engine.log`. Per-project data lives in `<project>/.yolo-twice/` (see design.md §5).
Every endpoint that touches a project takes `project=<absolute project root>`; when omitted the
most recently registered project is used. All JSON uses the types from `@yolo-twice/core`
(`Event`, `StructureNode`, `ProjectIndex`, `Config`) and `@yolo-twice/analyzers` (`TextArtifact`, `SearchHit`).

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/health` | | `{ ok, version, pid, started, projects: string[] }` |
| GET | `/api/projects` | | `[{ root, slug, name, sessions }]` |
| POST | `/api/projects` | `{ cwd }` | registers the project root of `cwd`, runs an ingest, returns `{ root, slug, name, sessions }` (idempotent) |
| GET | `/api/sessions` | `project` | `ProjectIndex & { current?: string }` where `current` is the session with the latest activity |
| GET | `/api/sessions/:id` | `project` | `{ structure: StructureNode, graph: string, events: number, config: Config }` |
| GET | `/api/sessions/:id/structure` | `project` | `StructureNode`, decorated with cached `text` granularities |
| GET | `/api/sessions/:id/graph` | `project`, `level=1\|2\|3` | `text/plain` mermaid |
| GET | `/api/sessions/:id/events` | `project`, `after=<event id>`, `limit` (default 500) | `{ events: Event[], next?: string }` in append order |
| POST | `/api/sessions/:id/text` | `{ project, node, granularity }` | `TextArtifact` (lazy summarization; computed on demand, cached by hash; may take seconds; falls back to the structural summarizer when the CLI is unavailable, with `analyzer: "structural"`) |
| GET | `/api/sessions/:id/digest` | `project`, `since=<event id>` | `{ since, until, events, text }` "catch me up": summary of everything after `since` |
| GET | `/api/search` | `project`, `q`, `session?`, `limit?` | `{ hits: SearchHit[] }` |
| GET | `/api/config` | `project` | `Config` |
| PUT | `/api/config` | `{ project, attention }` | `Config` (persisted to `.yolo-twice/config.json`, broadcast on the stream) |
| GET | `/api/stream` | `project` | Server-Sent Events, see below |
| POST | `/hook` | Claude Code hook JSON (`session_id`, `transcript_path`, `cwd`, `hook_event_name`, …) | `{}` within 50 ms; ingestion is scheduled, never awaited |
| GET | `/` and `/assets/*` | | the built UI from `packages/ui/dist` when present |

## SSE stream

`GET /api/stream?project=` sends `event: <type>` / `data: <json>` frames:

| event | data | when |
|---|---|---|
| `hello` | `{ project, version }` | on connect |
| `hook` | `{ hook_event_name, session_id }` | every hook received for this project |
| `ingest` | `{ session, appended }` | new events were appended |
| `structure` | `{ session }` | structure.json and graph.mmd were rewritten; clients refetch |
| `semantic` | `{ session, node, granularity, interim }` | a text artifact was written |
| `config` | `Config` | attention changed |
| `ping` | `{}` | every 25 s keep-alive |

## Engine CLI (`yolo-twice`)

```
yolo-twice start [--cwd <dir>] [--port 9656] [--foreground]   start (or reuse) the daemon, register the project, print the UI URL
yolo-twice open  [--cwd <dir>]                                 start if needed and open the browser on the current session
yolo-twice stop                                                stop the daemon
yolo-twice status [--cwd <dir>] [--json]                       engine and project state
yolo-twice index [--cwd <dir>]                                 one-shot ingest + derive, no daemon
yolo-twice mode <micro|attentive|balanced|yolo> [--cwd <dir>]  set the attention detent
yolo-twice resume [session] [--cwd <dir>] [--force] [--print]  rebuild the Claude Code transcript of a committed session under ~/.claude/projects/<slug>/ and run `claude --resume <id>` (--print only prints the command; existing transcripts are never overwritten without --force)
yolo-twice hook                                                read a Claude Code hook JSON from stdin and forward it (used by the plugin)
```

`--cwd` defaults to the current directory; the project root is the nearest git root above it.
