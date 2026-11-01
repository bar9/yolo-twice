# yolo-twice

**Transparent agentic development superpowers.** See what your coding agent did, at the
zoom level you choose, while it is still running.

## The problem

A long Claude Code session leaves behind megabytes of JSONL: hundreds of turns, tool calls,
subagent transcripts, rewinds and compactions. Reading it as a chat list does not scale, and
the existing viewers, good as they are, show exactly that list. You either micro-manage every
tool call or you go full yolo and lose track of what happened.

## What yolo-twice does

- **Semantic zoom.** Read a session as one line, three sentences, a paragraph of phases, the
  turns, or the raw records. Any text, including the top summary and a long tool result, can be
  zoomed out one more step or expanded in place.
- **Live flow graph.** The conversation as a graph: turns, tool calls, subagents and rewind
  branches, updated while the session runs, merging into phases as you zoom out.
- **Attention slider.** From "micro management" (every turn summarized live) to "yolo"
  (nothing until you ask, then "catch me up"). You choose how many tokens and how much
  attention to spend; the cost is shown next to the slider.
- **Linked views, shareable links.** Filter bar, timeline, reader and graph react to each
  other: drag a time window, click to zoom into a phase or turn, filter to your prompts
  or tool errors, and every view follows. The URL captures the whole view, so a link opens
  exactly what you saw.
- **Project-local history.** Everything derived lands in `.yolo-twice/` in your repo,
  redacted, plain JSON and mermaid, so you can commit it or gitignore it.
- **Incremental and idempotent.** Stop the engine, resume later, run it twice: same bytes.

## Install

One command, in a terminal where Claude Code is installed (version 2.1.275 or newer, Node 22
or newer):

```
claude plugin install yolo --marketplace bar9/yolo-twice
```

Installed it before it was called `yolo`? Switch once:
`claude plugin uninstall yolo-twice && claude plugin install yolo --marketplace bar9/yolo-twice`.

## Use

Inside any Claude Code session (plugin commands are namespaced, so the command is `/yolo:twice`):

```
/yolo:twice                  start the engine for this project and open the UI
/yolo:twice stop             stop the engine
/yolo:twice status           show engine, session and index state
/yolo:twice mode yolo        set the attention slider: micro | attentive | balanced | yolo
/yolo:twice resume [id]      rebuild a committed session's transcript and print the claude --resume command
```

New to the UI? Help (the ? button in the header) has a short guide and a one-minute guided tour.
Press `?` for the keyboard shortcuts: ← → move between levels, ↑ ↓ through parts, − + change the
detail, `/` searches.

The same commands work from a terminal via the engine CLI, for example `yolo-twice status` or
`yolo-twice index` for a one-shot index without the daemon.

### On a network, or in Docker

The engine listens on `127.0.0.1` by default, so only your own computer can open the UI. To reach it
from elsewhere, for example when it runs in a Docker container, start it on every interface:

```
yolo-twice start --host 0.0.0.0          # or YOLO_TWICE_HOST=0.0.0.0
```

A ready Docker image is in `code/Dockerfile`; [documentation/network.md](documentation/network.md)
has the tested `docker build` and `docker run` commands and why each mount is there.

The settings menu shows the address and, when it was set this way, cannot change it. Without
`--host` the same menu switches between "This computer" and "All networks" on the fly, and the
choice is remembered. There is no login: anyone who can reach the port can read your sessions, so
only open it on a network you trust.

## How it works

```mermaid
flowchart LR
  CC[Claude Code session] -- "hooks" --> ENG[Engine]
  CC -- writes --> JSONL[(session JSONL<br/>+ subagents)]
  JSONL -- "incremental read" --> ENG
  ENG --> NORM[normalize + redact]
  NORM --> STORE[(.yolo-twice/)]
  STORE --> AN[analyzers<br/>structure, search, claude -p]
  AN --> STORE
  ENG -- "HTTP + SSE" --> UI[web UI<br/>zoom, graph, timeline, search]
```

Claude Code hooks tell the engine that something happened. The engine reads the new lines of
the session transcript from its cursor, normalizes them into one event per line, redacts
secrets, and appends them to `.yolo-twice/`. Structural levels (session, phases, turns, steps)
are derived without any model call. Summaries and labels are produced by the Claude Code CLI
itself in headless mode, cached by content hash, and only as eagerly as the attention slider
allows. The UI is updated over Server-Sent Events.

```mermaid
flowchart TB
  P[Project digest] --- S[Session title]
  S --- A[Abstract: 3 sentences]
  A --- PH[Phases]
  PH --- T[Turns]
  T --- ST[Steps: tool calls, thinking, subagents]
  ST --- R[Raw records]
```

## What lands in your repo

```
.yolo-twice/
  config.json                  team settings: redaction rules, analyzers, default attention
  sessions/<id>/
    meta.json                  label, time span, size and cost of the session
    events.ndjson              redacted, normalized events
    structure.json             the zoom tree
    graph.mmd                  the flow graph as mermaid
    text/                      titles, abstracts and summaries of finished parts
    images/                    images pasted into prompts, shown in the reader
  cache/, local.json           gitignored: project list, cursors, live summaries, your slider
```

Pasted images are committed as they are: redaction cannot see inside a screenshot. Set
`"images": { "keep": false }` in `config.json` for sensitive work, or lower `max_bytes`
(default 5 MB per image).

Every committed file belongs to exactly one session, so teammates indexing in parallel never
produce merge conflicts in this folder.

Raw transcripts stay in `~/.claude`. Only redacted events and derived data are written here.
Paths are written portably: the project root as `$PROJECT`, your home folder as `~`, your
login name as `<user>`. Nobody's username or folder layout ends up in the repo.

Because the redacted events are complete, a teammate who clones the repo can continue a
session that never ran on their machine: `yolo-twice resume` rebuilds the Claude Code
transcript from `events.ndjson` with paths expanded to their own machine and continues it
with `claude --resume <file> --fork-session`, as a new session of their own.

## Acknowledgments

yolo-twice did not invent transcript viewing. These projects came first, and we learned from
each of them. If one of them fits your need better, use it.

| Project                                                                                            | What it does well                                                             | Where yolo-twice differs                                    |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------- |
| [Claudescope](https://github.com/vladar107/claudescope) by vladar107                               | Browses eight agents, full-text search, cost analytics, MCP server and plugin | Abstraction levels, flow graph, committed project history   |
| [claude-code-history-viewer](https://github.com/jhlee0409/claude-code-history-viewer) by jhlee0409 | Desktop app for over thirty agents, live updates, session board               | One running session, deeply zoomable, instead of breadth    |
| [cc_transcript_viewer](https://github.com/tim-hua-01/cc_transcript_viewer) by tim-hua-01           | Zero dependencies, live tail, five agents                                     | We borrowed the live-tail idea and add semantics on top     |
| [claude-code-transcripts](https://github.com/simonw/claude-code-transcripts) by simonw             | Publishing paginated HTML transcripts, Gist upload                            | Live navigation rather than publishing                      |
| [ccusage](https://github.com/ryoppippi/ccusage) by ryoppippi                                       | Token and cost reporting across agents                                        | Cost shown per phase in context; use ccusage for accounting |
| [pele](https://github.com/obsidianmd/pele) by the Obsidian team                                    | Fast, themeable mermaid rendering                                             | We use it as-is for every diagram, with thanks              |

The web UI is built on [shadcn/ui](https://ui.shadcn.com/) with [Radix](https://www.radix-ui.com/)
and [Tailwind CSS](https://tailwindcss.com/), icons from [Lucide](https://lucide.dev/), split
panes from [react-resizable-panels](https://github.com/bvaughn/react-resizable-panels), the map
from [React Flow](https://reactflow.dev/) laid out by [dagre](https://github.com/dagrejs/dagre),
the guided tour from [React Joyride](https://react-joyride.com/), and the typefaces
[Instrument Sans](https://github.com/Instrument/instrument-sans),
[Nunito](https://github.com/googlefonts/nunito),
[Newsreader](https://github.com/productiontype/Newsreader) and
[JetBrains Mono](https://www.jetbrains.com/lp/mono/), all under open licenses and bundled through
[Fontsource](https://fontsource.org/).

Mermaid is the diagram format we use on GitHub, on the website and in the pitch deck, so the same
text renders everywhere; the UI's interactive map draws the same structure with React Flow.

## Contributing

The local development flow, from clone to a running engine, UI and plugin, is in
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT, see [license.txt](license.txt).
