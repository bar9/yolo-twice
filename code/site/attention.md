# Attention slider: micro management to yolo

Not every layer costs the same. Ingestion, redaction, the structural tree and the search index
are cheap and incremental, so they always run near realtime and the data is always complete.
Semantic analysis through `claude -p` is the expensive layer: seconds to minutes per call,
thousands of tokens, and it competes with your own session for the same subscription rate
limit. Re-summarizing an open phase after every turn is quadratic in tokens.

The slider therefore controls semantic triggers and UI attention, never ingestion. Four
detents, not a continuous value:

| Detent | Semantic trigger | Default zoom | UI behaviour |
|---|---|---|---|
| Micro management | every turn: incremental fold summary of the open phase, small model | L3 steps | live ticker, graph re-layout batched to 1 s |
| Attentive | turn label on each Stop hook, phase summary when the phase closes | L2 turns | live, no interim phase summaries |
| Balanced (default) | phase close only: compaction, idle gap, topic change | L1 phases | updates on phase boundaries |
| Yolo | nothing automatic; summaries computed lazily for nodes the UI shows, or on SessionEnd | L0 digest | "catch me up": digest of everything since you last looked |

Design rules:

- The UI viewport is the demand signal. The UI requests summaries for visible nodes; the
  slider only sets how far ahead the engine prefetches.
- Idempotency survives the slider. A closed phase has the same input hash in every mode, so
  its artifact is identical whether computed eagerly or lazily. Interim summaries of open
  phases live in the gitignored cache, never in the committed `sessions/` folder.
- The cost is shown next to the slider: estimated tokens per hour and update lag.
- The setting is `attention` in `.yolo-twice/config.json`, changeable live from the UI or
  with `/yolo-twice mode <micro|attentive|balanced|yolo>`.
- "Catch me up" uses a last-viewed cursor per session, so the digest covers exactly what you
  have not seen.
