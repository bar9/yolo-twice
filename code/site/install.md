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
of the text, because no filter catches everything. Instead, it decides with you which sessions
reach git at all, and shows that decision everywhere.

Two facts decide it:

- **The environment** (machine, VM or container) is *restricted* when it holds data that must
  not be published, and *open* when nothing in it must stay private. You answer once per
  environment; until then it counts as restricted. yolo-twice pre-selects a guess from your git
  email, a proxy and your `gh` accounts.
- **The remotes** of the repository are *restricted* (internal or private), *public*, or
  *unknown*. GitHub repositories are checked with `gh`, quietly; anything else counts when it
  matches a pattern you add, such as `git.acme.example` or `github.com/acme/*`.

The rule: **a restricted environment shares sessions only with restricted remotes.**

| Environment | Remotes | A new session starts | Asked? |
|---|---|---|---|
| open | any | shared | no |
| restricted | all restricted | shared | no |
| restricted | any public | private | yes |
| restricted | any unknown | undecided | yes |
| any | none yet | undecided | yes |

- **Shared** sessions are committed with the project (by auto-commit, or your next commit).
- **Private** sessions never leave your machine: they are listed in the clone's own
  `.git/info/exclude`, so even `git add -A` leaves them out. The UI marks them with a mask.
- **Undecided** sessions are kept out of git like private ones until you choose.

In the UI, the button next to the settings shows where new sessions go and why, and holds the
environment and the restricted remotes. The menu beside a session's pin shares it or keeps it
private. A banner asks only when a decision is needed. A remote can be added at any time: when
one makes sharing stricter, yolo-twice says so and counts the committed sessions you have not
pushed yet.

Making a committed session private removes it from git from then on (the files stay on disk),
but earlier commits, and every copy already pushed, still contain it. Sessions committed before
this feature existed count as shared.

The environment and the restricted remotes are stored in `~/.yolo-twice/settings.json`; your
per-session choices in `.yolo-twice/local.json`. Neither is ever committed.

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
