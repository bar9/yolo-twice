# Install and use

## Install

One command, in a terminal where Claude Code is installed (version 2.1.275 or newer, Node 22
or newer):

```
claude plugin install yolo --marketplace bar9/yolo-twice
```

## Use

Inside any Claude Code session. Plugin commands are namespaced, so the command is
`/yolo:twice`:

```
/yolo:twice                  start the engine for this project and open the UI
/yolo:twice stop             stop the engine
/yolo:twice status           show engine, session and index state
/yolo:twice mode yolo        set the attention slider: micro | attentive | balanced | yolo
/yolo:twice autocommit on    commit only .yolo-twice every 10 minutes, for this engine run
/yolo:twice resume [id]      continue a committed session on this machine, as a fork
```

The same commands work from a terminal through the engine CLI, for example
`npx yolo-twice status`, or `npx yolo-twice index` for a one-shot index without the daemon.

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

Commit it to share the history with your team, or add `.yolo-twice/` to `.gitignore`. Every
committed file belongs to exactly one session, so teammates indexing in parallel never get
merge conflicts in this folder. `autocommit on` commits only this folder, never your code.

## Continue a teammate's session

Because the redacted events are complete, a teammate who clones the repository can continue a
session that never ran on their machine. `resume` rebuilds the Claude Code transcript from
`events.ndjson`, with paths expanded for their machine, and prints the
`claude --resume <file> --fork-session` command that continues it as a new session of their own.

## Privacy

Raw transcripts stay in `~/.claude`. Only redacted events and derived data are written to
`.yolo-twice/`. Built-in rules cover API keys, tokens, JWTs, private keys and credential
assignments; long tool results are truncated to head and tail with a hash. Add your own
patterns in `config.json`.

Paths are written portably: the project root as `$PROJECT`, your home folder as `~`, your
login name as `<user>`. Nobody's username or folder layout ends up in the repo.

Pasted images are committed as they are, because redaction cannot see inside a screenshot.
Set `"images": { "keep": false }` in `config.json` for sensitive work, or lower `max_bytes`
(default 5 MB per image).
