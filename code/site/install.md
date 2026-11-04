# Install and use

## Install

One command, in a terminal where Claude Code is installed (version 2.1.275 or newer, and Node 20
or newer or bun):

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
/yolo:twice environment restricted   this environment holds data that must not be published
/yolo:twice visibility       list which sessions are shared and which stay private
/yolo:twice visibility <id> private  keep one session on this machine
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
  cache/, local.json           gitignored: project list, cursors, live summaries, your slider and session choices
```

Commit it to share the history with your team, or add `.yolo-twice/` to `.gitignore`. Every
committed file belongs to exactly one session, so teammates indexing in parallel never get
merge conflicts in this folder. `autocommit on` commits only this folder, never your code.

## Continue a teammate's session

Because the redacted events are complete, a teammate who clones the repository can continue a
session that never ran on their machine. `resume` rebuilds the Claude Code transcript from
`events.ndjson`, with paths expanded for their machine, and prints the
`claude --resume <file> --fork-session` command that continues it as a new session of their own.

## Private sessions

A session records what you did: prompts, tool output, command results. In a public repository
that can publish things that must stay inside your organisation, such as internal project
names, your company account or customer data. yolo-twice does not try to filter those out
of the text, because no filter catches everything. Instead, one rule decides whether what you
do here may reach git at all, and the UI shows the outcome everywhere.

Two facts decide it:

- **The environment** (machine, VM or container) is *restricted* when it holds data that must
  not be published, and *open* when nothing in it must stay private. You answer once per
  environment; until then it counts as restricted. yolo-twice pre-selects a guess from your git
  email, a proxy and your `gh` accounts.
- **The remotes** of the repository are *restricted* (internal or private), *public*, or
  *unknown*. GitHub repositories are checked with `gh`, quietly; anything else counts when it
  matches a pattern you add, such as `git.acme.example` or `github.com/acme/*`.

The rule: **a restricted environment shares sessions only when every remote is restricted.**

| Environment | Remotes | Sessions |
|---|---|---|
| open | any, or none | committed with the project |
| restricted | all restricted | committed with the project |
| restricted | any public or unknown | stay on this machine |
| restricted | none yet | stay on this machine, until a restricted remote is added |

It applies to everything written here, whichever session it belongs to. There is no switch per
session: the content is restricted because of where it was written, also when you continue a
session that someone committed from an open environment.

Where a session is decides whether it reaches git:

- `.yolo-twice/sessions/<id>/` is committed with the project (by auto-commit, or your next
  commit).
- `.yolo-twice/private/sessions/<id>/` is gitignored and never leaves your machine. The UI marks
  these sessions with a mask: **Private**.
- A committed session you continue while the project does not share is copied to the private
  folder once and continued there: **Private additions**. The committed copy is never touched,
  so `git pull` keeps working, and what you added stays here.

In the UI, the button next to the settings shows whether sessions are shared here and why, and
holds the environment and the restricted remotes. An unknown remote gets a one-click "is
internal". A remote can be added at any time: when one makes sharing stricter, yolo-twice says so
and counts the committed sessions you have not pushed yet (yolo-twice never pushes). When the
project may share again, for example after you mark its remote as internal, the private sessions
move back and are committed.

To publish one private session anyway, commit it yourself with
`git add -f .yolo-twice/private/sessions/<id>`: a deliberate act, outside yolo-twice.

The environment and the restricted remotes are stored in `~/.yolo-twice/settings.json`, never
committed.

**From 0.1.5**, which decided per session: sessions you made private stay private for good
(listed as `keep_private` in `.yolo-twice/local.json`); every other session follows the rule.
Sessions 0.1.5 kept out of git move to the private folder, and its block in `.git/info/exclude`
is removed. The UI says once what was converted.

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
