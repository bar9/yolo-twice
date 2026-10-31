# yolo-twice: design and hackathon plan

Status: draft, 31 Oct 2026, decided together in the kickoff Q&A. Edit freely.

## 1. Context

Long Claude Code sessions are black boxes: a single session JSONL grows to megabytes, spawns
subagent transcripts, branches on rewind and gets compacted. Existing viewers render this as a
flat chat list. yolo-twice makes a running session navigable at several levels of abstraction,
live, and stores what it learns next to the project so it can be committed or ignored.

Built at BaselHack 2026 (30 Oct to 1 Nov) by four people working AI-driven in parallel.
Demo on 1 Nov is a vertical slice; the architecture is designed for the full vision.

### Decisions taken

| Topic | Decision |
|---|---|
| Deadline | Demo slice on 1 Nov, continue afterwards |
| Pitch features | Semantic zoom, live flow graph, shareable project history. Cross-agent later |
| Event source | Claude Code hooks trigger ingestion; the session JSONL is the source of truth; file watcher as fallback |
| Stack | Node/TypeScript monorepo (pnpm workspaces) |
| Primary user | Developer reviewing their own sessions; team sharing is a later layer on the same data |
| `.yolo-twice` content | Redacted raw events plus derived data, so it is safe to commit |
| LLM analysis | Headless `claude -p` through the user's subscription, hash-cached, never blocking the UI |
| Pitch | Markdown deck on GitHub Pages, reusing the site's mermaid diagrams |
| Update cadence | Attention slider with four detents (micro, attentive, balanced, yolo); ingestion always live, semantic work and UI attention follow the slider |

### What exists and what we add

Over a dozen Claude Code transcript viewers exist. The strongest are
[Claudescope](https://github.com/vladar107/claudescope) (8 agents, DuckDB search, MCP server, plugin),
[claude-code-history-viewer](https://github.com/jhlee0409/claude-code-history-viewer) (31 agents, file watch, SSE) and
[cc_transcript_viewer](https://github.com/tim-hua-01/cc_transcript_viewer) (zero dependencies, live tail).
None of them offer abstraction levels, a conversation flow graph, or project-local committable state.
We reuse their parsing knowledge and build the three missing things.

## 2. Architecture

```mermaid
flowchart LR
  CC[Claude Code session] -- "hooks (HTTP POST)" --> ENG
  CC -- writes --> JSONL[(~/.claude/projects/&lt;slug&gt;/*.jsonl<br/>+ subagents/*.jsonl)]
  JSONL -- "incremental read from cursor" --> ENG[Engine daemon]
  WATCH[File watcher fallback] --> ENG
  ENG --> NORM[Normalize + redact]
  NORM --> STORE[(.yolo-twice/<br/>events.ndjson, structure.json, semantic/)]
  STORE --> AN[Analyzers<br/>structural, search, semantic via claude -p]
  AN --> STORE
  ENG -- "HTTP + SSE" --> UI[Web UI<br/>zoom, flow graph, timeline, search]
  PLUGIN[Claude plugin<br/>/yolo-twice, /yolo-twice stop] --> ENG
```

### Packages (monorepo under `code/`)

| Package | Responsibility | Owner |
|---|---|---|
| `packages/core` | Event schema, source adapters (claude-code now, opencode later), redaction, cursor-based incremental reader, `.yolo-twice` store | A |
| `packages/engine` | Daemon: HTTP API, SSE stream, `/hook` endpoint, watcher fallback, analyzer queue, pid/port lifecycle, CLI (`yolo-twice start|stop|status|index`) | A |
| `packages/analyzers` | Structural tree (L0 to L4), full-text search, semantic phase summaries and cluster labels via `claude -p`, cost rollups | B |
| `packages/ui` | Vite + React web app: zoom view (stretchtext on two axes), flow graph rendered from mermaid text with pele, timeline, search, live updates over SSE | C |
| `plugin/` | Claude Code plugin: `plugin.json`, `commands/yolo-twice.md`, `hooks/hooks.json`, `bin/yolo-twice` | D |
| `site/` and `assets/pitch/` | VitePress site and Slidev deck, mermaid blocks rendered with pele at build time, deployed to GitHub Pages by one Actions workflow | D |
| `README.md` | Getting started, single-command install, a humble comparison with existing tools and credits | D |
| `fixtures/` | Two or three real sessions, redacted, so B and C can develop without the engine running | D |

## 3. Live pipeline

```mermaid
sequenceDiagram
  participant CC as Claude Code
  participant H as hook (HTTP)
  participant E as Engine
  participant S as .yolo-twice
  participant UI as Web UI
  CC->>H: UserPromptSubmit / PostToolUse / SubagentStop / PostCompact / Stop
  H->>E: POST /hook {session_id, transcript_path, agent_id, hook_event_name}
  E->>E: debounce 300 ms per transcript
  E->>S: read new lines from cursor, normalize, redact, append events.ndjson
  E->>S: update structure.json (structural levels, no LLM)
  E-->>UI: SSE: events, structure
  E->>E: enqueue semantic jobs for changed phases (hash-keyed)
  E->>S: write semantic/<hash>.json when claude -p returns
  E-->>UI: SSE: semantic
```

The transcript file lags the live conversation, so every hook triggers a re-read from the
cursor and the next hook or watcher event picks up anything missed. Hooks of type `http` post
straight to the engine; if the engine is not running the hook fails silently and the watcher
catches up when `/yolo-twice` starts it.

## 4. Data model

### Normalized event (one JSON line in `events.ndjson`)

Field names follow OpenTelemetry GenAI conventions where they exist (`gen_ai.*` equivalents noted in the schema file).

```json
{
  "id": "record uuid, or sha256 of the line for records without one",
  "ts": "2026-10-31T08:12:03.702Z",
  "session": "34b27ceb-...",
  "agent": "claude-code",
  "agent_id": null,
  "parent": "parentUuid or null",
  "kind": "user.prompt | assistant.text | assistant.thinking | tool.call | tool.result | subagent.start | subagent.stop | compaction | cost | title | system | meta",
  "tool": { "name": "Bash", "call_id": "toolu_..." },
  "text": "redacted content",
  "model": "claude-fable-5-1",
  "usage": { "input_tokens": 0, "output_tokens": 0, "cache_read_tokens": 0 },
  "redacted": { "count": 2, "rules": ["api-key", "env-value"] },
  "src": { "file": "relative path under ~/.claude", "line": 123 }
}
```

Mapping from Claude Code records observed in version 2.1.31x:
`user`/`assistant` records with `message.content` blocks (`text`, `thinking`, `tool_use`, `tool_result`),
`parentUuid` links, `isSidechain` and `agentId` for subagents (files in `<session>/subagents/agent-*.jsonl`
with a `.meta.json` giving agent type and spawning `toolUseId`), compaction `summary` records,
`ai-title` / `custom-title` / `agent-name`, `cost-state` (total cost and per-model usage),
`system` with subtype `turn_duration`, `file-history-snapshot`, `api-request*` (dropped, internal).
Unknown record types become `kind: meta` and never crash the reader.

### Semantic zoom: two axes

Zoom is not a fixed ladder of five levels. It has two independent axes, and both apply at every
node, including the top.

**Structural axis** (what unit is shown):

| Level | Unit | Source | LLM needed |
|---|---|---|---|
| L-1 | Project: all sessions of this project | session list | no (digest: yes) |
| L0 | Session: title, duration, cost, outcome | title and cost records | no |
| L1 | Phases: "setting up auth", "debugging tests" | semantic analyzer; structural fallback splits on compaction, long gaps and topic-changing prompts | yes (fallback no) |
| L2 | Turns: user prompt to final assistant text, subagent runs collapsed into one node | parent chain | no |
| L3 | Steps: tool calls with results, thinking, subagent internals | content blocks | no |
| L4 | Raw record | JSONL line | no |

**Text axis** (how much text a node shows), in the stretchtext sense: any text can be
collapsed in place to a shorter form and expanded back.

| Granularity | Target | Example at L0 |
|---|---|---|
| `title` | one line | "Migrated auth to OIDC, tests green" |
| `abstract` | up to three sentences | what, why, outcome |
| `summary` | a paragraph or short list | the phases and the decisions in each |
| `full` | the complete text | all turns |

The two axes combine: zooming out at the top collapses the session summary to a title, and
one step further shows the project as a list of session titles, which can itself be
summarized into a project digest. Zooming in on a long tool result or a long assistant
message collapses it to an abstract first, then expands to full text. A long paragraph is
therefore never the end of the road: it can always be zoomed out one more step.

Every (node, granularity) pair is a derived artifact under
`sessions/<id>/text/<node-id>.<granularity>.<hash>.json`, keyed by the hash of the node's
input text plus the analyzer version, produced lazily (see the attention slider) or by a
structural fallback (head and tail plus counts) when no LLM result exists yet. Shorter
granularities are built from the next longer one, so the cost is a fold, not a re-read.

Each structure node has `id`, `level`, `children`, `span` (first and last event id) and the
available granularities. The UI expands any node in place, so the user can read the whole
session at one granularity and dive where needed.

### Flow graph

The engine emits the graph as mermaid text in `sessions/<id>/graph.mmd`, one file per
structural level requested. Nodes are L2 turns by default, expandable to L3. Edges: `parent`
(sequence), `tool.call` to `tool.result`, `subagent.start` to its transcript, and branch
edges where one parent has several children (a rewind). Zooming out merges turns into phase
nodes, like map tiles. The UI renders the text with [pele](https://pele.run/) (MIT, from the
Obsidian team), the same renderer the site and the deck use, and attaches click handlers to
the SVG node ids to zoom. Mermaid text is readable, diffable and committable, and renders on
GitHub as-is. If interactivity outgrows SVG, `@xyflow/react` is the fallback.

## 5. `.yolo-twice` layout and idempotency

```
.yolo-twice/
  config.json                    # schema version, sources, redaction rules, enabled analyzers
  engine.json                    # pid, port, started at   (gitignored)
  cache/                         # search index, temp      (gitignored)
  sessions/<session-id>/
    source.json                  # origin path, agent, cursor {bytes, lines, size, mtime, head hash}
    events.ndjson                # redacted normalized events, append-only
    structure.json               # L0 to L3 tree with available granularities per node
    graph.mmd                    # flow graph as mermaid text, rendered with pele everywhere
    text/<node>.<gran>.<hash>.json   # title / abstract / summary per node, keyed by input hash + analyzer version
    semantic/<input-hash>.json   # phase labels and cluster results
  project.json                   # L-1: session list and project digest
  annotations/                   # user notes, later
  .gitignore                     # engine.json, cache/
```

Rules that make stop, resume and re-run safe:

1. Event identity is the record uuid. Re-ingesting the same line is a no-op.
2. Each source file has a cursor. On start the engine resumes from it; if the file shrank or
   the head hash changed, it re-reads from zero and rewrites that session's files.
3. Every derived artifact is keyed by sha256 of its input event ids plus content plus analyzer
   name and version. Existing key means skip. This is what makes `claude -p` affordable.
4. Files are written atomically (temp file then rename) with sorted keys and stable
   formatting, so git diffs are small and merges are sane.
5. `/yolo-twice` is idempotent: it checks `engine.json`, probes the port, and reuses a healthy
   engine instead of starting a second one.
6. Redaction runs before anything is written: API keys, tokens, JWTs, private keys, env
   values and configurable patterns are replaced with `[redacted:<rule>]`; tool results above a
   size limit keep head and tail plus a hash. The original stays in `~/.claude` untouched.

## 6. Attention slider: micro management to yolo

Not every layer costs the same. Ingestion, redaction, the structural tree and the search index
are cheap and incremental, so they always run near realtime and the data is always complete.
Semantic analysis through `claude -p` is the expensive layer: seconds to minutes per call,
thousands of tokens, and it competes with the user's own session for the same subscription
rate limit. Re-summarizing an open phase after every turn is quadratic in tokens and every
interim result is a cache miss by design.

The slider therefore controls semantic triggers and UI attention, never ingestion. Four
detents, not a continuous value, so each mode is testable:

| Detent | Semantic trigger | Default zoom | UI behaviour |
|---|---|---|---|
| Micro management | every turn: incremental fold summary of the open phase, small model | L3 steps | live ticker, graph re-layout batched to 1 s |
| Attentive | turn label on each Stop hook, phase summary when the phase closes | L2 turns | live, no interim phase summaries |
| Balanced (default) | phase close only: compaction, idle gap, topic change | L1 phases | updates on phase boundaries |
| Yolo | nothing automatic; summaries computed lazily for nodes the UI shows, or on SessionEnd | L0 digest | "catch me up": digest of everything since the user last looked |

Design rules:

- The UI viewport is the demand signal. The UI requests summaries for visible nodes; the
  slider only sets how far ahead the engine prefetches. One code path, different policy.
- Idempotency survives the slider. A closed phase has the same input hash in every mode, so
  its artifact is identical whether computed eagerly or lazily. Interim summaries of open
  phases carry `interim: true` and live in `cache/`, never in the committed `sessions/`.
- Show the cost. Next to the slider the UI displays estimated tokens per hour and update lag
  for the current setting.
- The setting is `attention` in `.yolo-twice/config.json`, overridable per user in
  `~/.config/yolo-twice/config.json`, changeable live from the UI header or
  `/yolo-twice mode <micro|attentive|balanced|yolo>`. The engine reloads it without restart.
- "Catch me up" uses a last-viewed cursor per session stored in the per-user config, so the
  digest covers exactly what the user has not seen.
- `claude -p` jobs run with concurrency one and a per-hour token budget derived from the
  detent; when the budget is exhausted the engine degrades to the next lazier mode and says so
  in the UI.

## 7. Plugin and install

```
plugin/
  .claude-plugin/plugin.json
  commands/yolo-twice.md       # runs !`${CLAUDE_PLUGIN_ROOT}/bin/yolo-twice $ARGUMENTS` and prints the URL
  hooks/hooks.json             # SessionStart, UserPromptSubmit, PostToolUse, SubagentStart, SubagentStop,
                               # PreCompact, PostCompact, Stop, SessionEnd -> http://127.0.0.1:<port>/hook
  bin/yolo-twice               # thin wrapper: npx -y yolo-twice@<pinned> "$@"
```

The slash command uses the command file's inline shell execution, so `/yolo-twice` starts the
engine for the current project (`cwd` to project slug), opens the browser on the current
session, and `/yolo-twice stop` and `/yolo-twice status` work without any model turn.

A `.claude-plugin/marketplace.json` at the repo root lets the README promise one command
(the `--marketplace` option adds the marketplace if it is not known yet, verified against
Claude Code 2.1.316):

```
claude plugin install yolo-twice --marketplace bar9/yolo-twice
```

Requires Node 22 or newer. A standalone binary (Node SEA or `bun build --compile`) is a
post-hackathon item.

## 8. Interfaces to freeze in hour one

- `packages/core/schema/event.schema.json` and `structure.schema.json` (zod, exported types)
- `.yolo-twice` layout above
- HTTP API: `GET /api/sessions`, `GET /api/sessions/:id/events?after=<id>`,
  `GET /api/sessions/:id/structure`, `GET /api/sessions/:id/semantic`,
  `GET /api/search?q=&session=`, `GET /api/stream` (SSE: `events`, `structure`, `semantic`),
  `GET|PUT /api/config` (attention detent), `POST /api/sessions/:id/semantic/request` (lazy summary for visible nodes),
  `GET /api/sessions/:id/digest?since=<event-id>` (catch me up),
  `POST /hook`, `GET /health`
- Fixtures in `code/fixtures/<session>/` in exactly the `.yolo-twice/sessions/<id>/` shape

With these frozen, the four tracks run in parallel against fixtures and meet at integration.

## 9. Hackathon timeline

| Hours | A: core + engine | B: analyzers | C: UI | D: plugin, site, pitch |
|---|---|---|---|---|
| 0 to 1 | Scaffold monorepo, freeze schemas and API | Review fixtures | UI shell, routing, SSE client | Export and redact 3 fixtures, plugin skeleton |
| 1 to 5 | Reader, normalizer, redaction, cursor, ndjson store, CLI `index` | Structural tree L0 to L3 from fixtures, mermaid graph emitter | Zoom view from fixture structure.json, pele graph rendering | hooks.json, command, README with install line and credits, pele markdown plugin, Actions to Pages |
| 5 to 10 | Engine: HTTP, SSE, `/hook`, watcher, lifecycle | Search index, `claude -p` text granularities and phase summaries with hash cache | Text-axis zoom, timeline, search, live patches, attention slider | VitePress site, Slidev deck, demo script |
| 10 to 16 | Integration on a live session | Cluster labels, cost rollups | Polish, empty states, error states | Record fallback demo video, rehearse pitch |

Post-hackathon roadmap: opencode adapter (SQLite reader, ACP `session/load` as the generic
path), MCP server exposing search and summaries back to Claude, annotations and team sharing,
embedding-based clustering, OpenTelemetry export, standalone binary.

## 10. Site, pitch and README

Mermaid is the single diagram source everywhere. The README renders it through GitHub's own
renderer. The VitePress site and the Slidev deck render ```mermaid blocks at build time with
[pele](https://pele.run/) (`npm i pele`, MIT, synchronous `render(text)` returning SVG,
themed with `--pele-*` CSS variables), through one small shared markdown-it plugin in
`packages/pele-markdown`. The UI uses the same package for the flow graph. Dark and light
themes come from the CSS variables, no re-render needed.

Repository: `bar9/yolo-twice` on GitHub, public. GitHub Pages serves `site/` at the root and
the deck under `/pitch`. Use `gh` for releases, Pages settings and issues.

The README is the getting-started page. Beyond install and usage it has a short "standing on
shoulders" section that names the projects we learned from, says what each does well, and
states plainly where yolo-twice differs. Tone: humble, specific, with links and credit:

| Project | What it does well | How yolo-twice differs |
|---|---|---|
| [Claudescope](https://github.com/vladar107/claudescope) (vladar107) | 8 agents, full-text search, cost analytics, MCP server and plugin | we add abstraction levels, a flow graph and project-local committed history |
| [claude-code-history-viewer](https://github.com/jhlee0409/claude-code-history-viewer) (jhlee0409) | 31 agents, desktop app, live updates, session board | we focus on one running session and on zooming, not breadth |
| [cc_transcript_viewer](https://github.com/tim-hua-01/cc_transcript_viewer) (tim-hua-01) | zero dependencies, live tail, five agents | we borrow the live-tail idea and add semantics on top |
| [claude-code-transcripts](https://github.com/simonw/claude-code-transcripts) (simonw) | publishing paginated HTML transcripts, Gist upload | we target live navigation, not publishing |
| [ccusage](https://github.com/ryoppippi/ccusage) (ryoppippi) | token and cost reporting across agents | we show cost per phase in context; use ccusage for accounting |
| [pele](https://github.com/obsidianmd/pele) (Obsidian) | fast themeable mermaid rendering | we use it as-is, with thanks |

Pitch arc, three minutes: a multi-megabyte session JSONL on screen as the problem; one
sentence on why existing viewers do not solve it, with credit; live demo zooming out to
phases, in to a tool call, and the flow graph showing a rewind branch and subagents; the
attention slider; the architecture diagram; the one-line install; roadmap.

## 11. Verification

- Unit: normalizer against fixtures; idempotency test runs `index` twice and asserts identical bytes; resume test truncates the cursor and asserts identical output.
- Slider test: index a fixture in micro mode and in yolo mode with a mocked `claude -p`; assert the committed `sessions/` output is byte-identical and only `cache/` differs.
- Redaction test seeds fake keys and tokens into a fixture and asserts none reach `events.ndjson`.
- Engine e2e: start on a copy of a fixture, append lines to the JSONL, assert the SSE event arrives within one second and the UI renders it.
- Live: `claude --plugin-dir ./code/plugin`, run `/yolo-twice`, send a prompt, see the UI update; `/yolo-twice stop` leaves no process.
- Clean install: follow the README on a machine without the repo.

## 12. Risks

- Transcript lag behind hooks: mitigated by debounce plus re-read on every subsequent event.
- `claude -p` latency and cost: cache by hash, queue in background, structural levels never wait for it.
- Format drift between Claude Code versions: pin to the record `version` field, tolerate unknown types.
- Privacy: redaction is mandatory before write; cache and engine state are gitignored by default.
- Scope: cross-agent support stays out of the demo.
