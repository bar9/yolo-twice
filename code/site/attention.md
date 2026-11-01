# Attention slider: micro management to yolo

Not every layer costs the same. Ingestion, redaction, the structural tree and the search index
are cheap and incremental, so they always run near realtime and the data is always complete.
Semantic analysis through `claude -p` is the expensive layer: seconds per call, thousands of
tokens, and it competes with your own session for the same subscription rate limit.
Re-summarizing a part of the session that is still growing, after every turn, costs tokens
again and again.

The slider therefore decides only **which summaries the engine writes ahead of time**. It
never affects ingestion, and it never limits what you can read: any summary the slider skips
is written when you open that node in the reader.

## The four modes

A part of the session is *closed* once newer work follows it, or once the session has been
idle for 30 minutes. The newest turn and the newest phase are *open* while the session runs.

| Mode | Written ahead of time | Lag of the summaries | Rough cost |
|---|---|---|---|
| Micro management | Title and abstract of every turn and every phase, and of the session, including the open ones, refreshed as they grow | seconds | ≈ 3 calls per turn |
| Attentive | A title for every closed turn; title and abstract for every closed phase | about one turn | ≈ 1 call per turn |
| Balanced (default) | Title and abstract for every closed phase | about one phase | ≈ 1 call per 4 turns |
| Yolo | Nothing | on demand | only what you open |

Phases are split structurally, without a model: at compactions, after long idle gaps, and at
prompts that change the topic.

## Design rules

- **The reader is the demand signal.** Whatever the mode, opening a node that has no summary
  yet asks the engine for one. The slider only decides how much is ready before you look.
- **Short text is never summarized.** A one-line prompt or a single tool call is already as
  short as a title, so it is shown as it is, without a model call.
- **Same input, same summary.** Every summary is keyed by the hash of its input text, the
  granularity and the analyzer. A closed phase has the same input in every mode, so its summary
  is identical whether it was written eagerly or on demand, and it is only written once.
- **Open parts stay local.** Summaries of turns and phases that are still growing go to the
  gitignored `.yolo-twice/cache/`, never into the committed `sessions/` folder.
- **The cost is shown next to the slider**, as an estimate of summarization calls per hour for
  the current session, together with the expected lag.
- **The setting is personal.** The team default is `attention` in `.yolo-twice/config.json`
  (balanced). Your own choice lives in the gitignored `.yolo-twice/local.json` and can be
  changed live from the UI or with `/yolo:twice mode <micro|attentive|balanced|yolo>`.
- **The model is configurable.** All summaries use the model set in `analyzers.model` in
  `config.json` (default: haiku), whatever the mode.

## Catch me up

The "Catch me up" button summarizes everything that happened in the session since this
browser last showed it. It is most useful in yolo mode: let the agent work, come back, and
read one paragraph instead of the whole transcript. The position is remembered per session in
the browser, so each viewer gets their own "since you last looked".
