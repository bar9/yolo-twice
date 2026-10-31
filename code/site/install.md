# Install and use

<div class="status-banner">Under construction at BaselHack 2026. The install command below is the target for the first release and does not work yet.</div>

## Install

One command, in a terminal where Claude Code is installed (version 2.1.275 or newer, Node 22
or newer):

```
claude plugin install yolo-twice --marketplace bar9/yolo-twice
```

## Use

Inside any Claude Code session:

```
/yolo-twice             start the engine for this project and open the UI
/yolo-twice stop        stop the engine
/yolo-twice status      show engine, session and index state
/yolo-twice mode yolo   set the attention slider: micro | attentive | balanced | yolo
```

## What lands in your repo

```
.yolo-twice/
  config.json                  attention level, redaction rules, enabled analyzers
  project.json                 session list and project digest
  sessions/<id>/
    events.ndjson              redacted, normalized events
    structure.json             the zoom tree
    graph.mmd                  the flow graph as mermaid
    text/                      titles, abstracts and summaries per node
  cache/, engine.json          gitignored
```

Commit it to share the history with your team, or add `.yolo-twice/` to `.gitignore`.

## Privacy

Raw transcripts stay in `~/.claude`. Only redacted events and derived data are written to
`.yolo-twice/`. Built-in rules cover API keys, tokens, JWTs, private keys and credential
assignments; long tool results are truncated to head and tail with a hash. Add your own
patterns in `config.json`.
