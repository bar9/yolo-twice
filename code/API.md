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
| GET | `/api/sessions` | `project` | `ProjectIndex & { current?: string, sharing?: Sharing }` where `current` is the session with the latest activity. In a git repository each session also carries `visibility` (`shared \| private \| private-additions`: committed, only on this machine, or committed and continued here) and `kept` (made private in 0.1.5, stays private), and `sharing` is `{ environment, answered, remotes: [{ name, url, id, class, by }], class, decidedBy?, shares, private, unpushed?, migrated? }`; the rule is in `packages/engine/src/sharing.ts`, the folders in `visibility.ts`, the user guide in [site/install.md](site/install.md#private-sessions) |
| GET | `/api/sessions/:id` | `project` | `{ structure: StructureNode, graph: string, events: number, config: Config }` |
| GET | `/api/sessions/:id/structure` | `project` | `StructureNode`, decorated with cached `text` granularities |
| GET | `/api/sessions/:id/graph` | `project`, `level=1\|2\|3` | `text/plain` mermaid |
| GET | `/api/sessions/:id/images/:file` | `project` | the pasted image (`data.images[].file` of a `user.prompt` event), immutable cache |
| GET | `/api/sessions/:id/events` | `project`, `after=<event id>`, `limit` (default 500) | `{ events: Event[], next?: string }` in append order |
| POST | `/api/sessions/:id/text` | `{ project, node, granularity }` | `TextArtifact` (lazy summarization; computed on demand, cached by hash; may take seconds; falls back to the structural summarizer when the CLI is unavailable, with `analyzer: "structural"`) |
| GET | `/api/sessions/:id/digest` | `project`, `since=<event id>` | `{ since, until, events, text }` "catch me up": summary of everything after `since` |
| GET | `/api/search` | `project`, `q`, `session?`, `k?`, `from?`, `to?`, `limit?` (default 50) | `{ hits: SearchHit[], tools: string[] }`. `k` is a comma list of filter codes (`u` user prompts, `a` assistant text, `h` thinking, `t` tool calls, `t:Name` one tool, `e` tool errors, `s` subagents, `c` compactions and commands; codes are OR'd). `from`/`to` are ISO timestamps. Without `session` the whole project is searched. An empty `q` with a filter lists matching events in order; an empty `q` without a filter returns no hits. `tools` lists tool names seen, most used first |
| GET | `/api/config` | `project` | `Config` |
| PUT | `/api/config` | `{ project, attention }` | `Config` (persisted to `.yolo-twice/config.json`, broadcast on the stream) |
| GET | `/api/autocommit` | `project` | `{ enabled, intervalMs, lastCommit?: { ts, sha, files }, lastCheck?, next?, skipped? }` (`next`: when the next check runs, while enabled) |
| GET | `/api/environment` | `project?` | `{ environment?, restricted_remotes, guess, signals, candidates }`: whether this environment holds data that must not be published (machine-wide, `~/.yolo-twice/settings.json`, unanswered counts as restricted), the patterns of remotes that count as restricted, a guess from local signals, and patterns offered from the project's remotes |
| PUT | `/api/environment` | `{ project?, environment?: restricted \| open, restricted_remotes?: string[] }` | same shape; every registered project re-evaluates its sharing |
| GET | `/api/network` | | `{ host, port, exposed, urls, lockedBy?, container? }`: the interface the engine listens on; `lockedBy` (`--host` or `YOLO_TWICE_HOST`) when set at start, `container` inside Docker. See [documentation/network.md](../documentation/network.md) |
| PUT | `/api/network` | `{ host }` | same shape. Re-binds on the same port without a restart and remembers the choice; 400 for an address that is not this machine's, 409 when locked at start |
| PUT | `/api/autocommit` | `{ project, enabled }` | same shape. Opt-in: commits only `.yolo-twice` (`git commit --only`, staged work stays staged) right away and every 10 min when it changed; skips during merges, rebases and on a detached HEAD. Private sessions live in the gitignored `.yolo-twice/private/` and stay out. Engine memory only, off after every engine restart. Broadcast as `autocommit` |
| GET | `/api/stream` | `project` | Server-Sent Events, see below |
| POST | `/hook` | Claude Code hook JSON (`session_id`, `transcript_path`, `cwd`, `hook_event_name`, …) | `{}` within 50 ms; ingestion is scheduled, never awaited |
| GET | `/` and `/assets/*` | | the built UI from `packages/ui/dist` when present |

## SSE stream

`GET /api/stream?project=` sends `event: <type>` / `data: <json>` frames:

| event | data | when |
|---|---|---|
| `hello` | `{ project, version, build }` | on connect. `build` identifies the engine run and the UI bundle; a client that sees a different `build` than on its first connect reloads |
| `build` | `{ build }` | the served UI bundle was rebuilt (sent to every client); clients reload |
| `hook` | `{ hook_event_name, session_id }` | every hook received for this project |
| `ingest` | `{ session, appended }` | new events were appended |
| `structure` | `{ session }` | structure.json and graph.mmd were rewritten; clients refetch |
| `semantic` | `{ session, node, granularity, interim }` | a text artifact was written |
| `config` | `Config` | attention changed |
| `autocommit` | auto-commit status (see `/api/autocommit`) | toggled, or a commit attempt finished |
| `sharing` | `Sharing & { alert }` | the remotes or the environment changed, or sessions moved between `sessions/` and `private/`; `alert` when the project stopped sharing (a public remote was added, say) |
| `activity` | `{ session_id, activity: working \| waiting \| idle, ts }` | a hook changed what Claude is doing (also sent for every session on connect) |
| `ping` | `{}` | every 25 s keep-alive |

## Engine CLI (`yolo-twice`)

```
yolo-twice start [--cwd <dir>] [--port 9656] [--host <address>] [--foreground]
                                                               start (or reuse) the daemon, register the project, print the UI URL;
                                                               --host (or YOLO_TWICE_HOST): the interface to listen on, default 127.0.0.1,
                                                               0.0.0.0 for every interface (Docker); see documentation/network.md
yolo-twice open  [--cwd <dir>]                                 start if needed and open the browser on the current session
yolo-twice stop                                                stop the daemon
yolo-twice status [--cwd <dir>] [--json]                       engine and project state
yolo-twice index [--cwd <dir>]                                 one-shot ingest + derive, no daemon
yolo-twice mode <micro|attentive|balanced|yolo> [--cwd <dir>]  set the attention mode
yolo-twice autocommit [on|off] [--cwd <dir>]     commit only .yolo-twice every 10 min, until the engine stops; private sessions stay out
yolo-twice environment [restricted|open]          whether this environment holds data that must not be published; restricted shares sessions only with restricted remotes
yolo-twice resume [session] [--cwd <dir>] [--print]  rebuild a committed session from .yolo-twice into .yolo-twice/cache/resume/<id>.jsonl, with $PROJECT and ~ expanded to this machine's paths, and run `claude --resume <that file> --fork-session` (a new session id, so the committed session never gets a second writer)
yolo-twice hook                                                read a Claude Code hook JSON from stdin and forward it (used by the plugin)
```

`--cwd` defaults to the current directory; the project root is the nearest git root above it.
