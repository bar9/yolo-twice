---
theme: default
title: yolo-twice
info: Transparent agentic development superpowers. BaselHack 2026.
class: text-center
highlighter: shiki
drawings:
  persist: false
transition: fade
mdc: true
---

# yolo-twice

## Transparent agentic development superpowers

See what your coding agent did, at the zoom level you choose, while it is still running.

<div class="pt-8 text-sm opacity-70">BaselHack 2026 · Matthias Cullmann · Roland Brand · Jan Babin · +1</div>

<!--
0:00–0:15. Hello, we are yolo-twice. One sentence: zoomable, live insight into long Claude Code sessions.
-->

---

# The problem: a session is a wall of text

<div class="wall">
{"parentUuid":"a2","isSidechain":false,"type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_01","type":"tool_result","content":"auth.ts\nusers.ts\n"}]},"uuid":"u2","timestamp":"2026-10-31T08:00:07.000Z"} {"parentUuid":"u2","type":"assistant","message":{"role":"assistant","model":"claude-fable-5-1","content":[{"type":"tool_use","id":"toolu_r1","name":"Read","input":{"file_path":"/tmp/yolo-demo/src/routes/auth.ts"}}]},"uuid":"a3"} {"parentUuid":"a3","type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_r1","type":"tool_result","content":"const API_KEY = '[redacted:anthropic-key]'\nexport function login() {}\n"}]},"uuid":"u3"} {"parentUuid":"u3","type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_02","name":"Agent","input":{"description":"Research JWT best practices"}}]},"uuid":"a4"} {"parentUuid":"a4","type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_02","type":"tool_result","content":"JWT research summary: use RS256, rotate keys, short expiry."}]},"uuid":"u4"} {"parentUuid":"u4","type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_e1","name":"Edit","input":{"file_path":"/tmp/yolo-demo/src/routes/auth.ts"}}]},"uuid":"a5"} {"parentUuid":"a5","type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_e1","type":"tool_result","content":"The file has been updated."}]},"uuid":"u5"} {"parentUuid":"u5","type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_03","name":"Bash","input":{"command":"npm test"}}]},"uuid":"a6"} {"parentUuid":"a6","type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_03","type":"tool_result","content":"✓ test case 1 passes ✓ test case 2 passes ✓ test case 3 passes ✓ test case 4 passes ✓ test case 5 passes ✓ test case 6 passes ✓ test case 7 passes ✓ test case 8 passes ✓ test case 9 passes ✓ test case 10 passes ✓ test case 11 passes ✓ test case 12 passes ✓ test case 13 passes ✓ test case 14 passes ✓ test case 15 passes ✓ test case 16 passes ✓ test case 17 passes ✓ test case 18 passes ✓ test case 19 passes ✓ test case 20 passes ✓ test case 21 passes ✓ test case 22 passes ✓ test case 23 passes ✓ test case 24 passes ✓ test case 25 passes ✓ test case 26 passes ✓ test case 27 passes ✓ test case 28 passes ✓ test case 29 passes ✓ test case 30 passes ✗ login returns 401 for valid user 1 failing","is_error":true}]},"uuid":"u6"} {"parentUuid":"u6","type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"One test fails: login returns 401 for a valid user. The password hash comparison uses the wrong salt. Fixing it."}]},"uuid":"a7"} {"type":"system","subtype":"turn_duration","durationMs":115000,"messageCount":14} {"parentUuid":"a7","type":"user","message":{"role":"user","content":"Also add rate limiting to the login endpoint"},"uuid":"u7"} {"parentUuid":"a7","type":"user","message":{"role":"user","content":"Actually, skip rate limiting; just fix the failing login test"},"uuid":"u9"} {"type":"cost-state","totalCostUSD":1.2345,"totalDuration":4000000}
</div>

**Megabytes of JSONL.** Hundreds of turns, tool calls, subagents, rewinds, compactions.
Either you micro-manage every tool call, or you go full yolo and lose track.

<!--
0:15–0:45. A long Claude Code session leaves this behind. You cannot read it as a chat list. Today you either babysit the agent or you walk away blind.
-->

---

# Viewers exist. They show the list.

| Project | What it does well |
|---|---|
| [Claudescope](https://github.com/vladar107/claudescope) | 8 agents, full-text search, cost analytics, MCP server |
| [claude-code-history-viewer](https://github.com/jhlee0409/claude-code-history-viewer) | 31 agents, desktop app, live updates |
| [cc_transcript_viewer](https://github.com/tim-hua-01/cc_transcript_viewer) | zero dependencies, live tail |

<div class="pt-6">

None of them offer **abstraction levels**, a **flow graph** of the conversation, or
**project-local, committable history**. That is what we build. With thanks to all three.

</div>

<!--
0:45–1:05. Credit where due: these are good tools and we learned from them. They all render the transcript as a flat list. We add the missing dimension: zoom.
-->

---

# Semantic zoom on two axes

<div class="grid grid-cols-2 gap-6">
<div>

**Structural axis**: project → session → phases → turns → steps → raw records.

**Text axis**: title → abstract → summary → full, at every node.

A long summary is never the end of the road: zoom out one more step. A long tool result collapses to an abstract first.

</div>
<div>
<Pele text="flowchart TB
  P[Project digest] --- S[Session title]
  S --- A[Abstract: 3 sentences]
  A --- PH[Phases]
  PH --- T[Turns]
  T --- ST[Steps: tools, thinking, subagents]
  ST --- R[Raw records]" />
</div>
</div>

<!--
1:05–1:35. Stretchtext: expand in place, collapse in place. Structural levels need no model at all; the text axis is produced lazily by the Claude CLI itself, cached by content hash.
-->

---

# Live flow graph

<Pele text="flowchart LR
  s([Add login endpoint and fix tests])
  subgraph p1 [Add a /login endpoint +2 turns]
    direction LR
    t1[Add a /login endpoint to the API]
    a1[[Agent: Research JWT best practices]]
    t2[Also add rate limiting]
    t3[Actually, skip rate limiting; fix the failing test]
  end
  subgraph p2 [Write the changelog]
    t4[Write the changelog entry]
  end
  s --> t1
  t1 -.-> a1
  t1 --> t2
  t1 -. rewind .-> t3
  t3 --> t4
  classDef session fill:#1f2937,color:#fff,stroke:#111;
  classDef turn fill:#dbeafe,stroke:#60a5fa;
  classDef branch fill:#fde68a,stroke:#d97706;
  classDef subagent fill:#ede9fe,stroke:#8b5cf6;
  class s session; class t1,t2,t4 turn; class t3 branch; class a1 subagent;" />

Turns, subagents, a rewind branch, compaction boundaries. Emitted as mermaid, rendered with pele, updated while the session runs.

<!--
1:35–2:00. The transcript is a tree, not a list: rewinds branch, subagents nest, compaction leaves markers. We get all of that for free, structurally. Same mermaid text renders in the UI, on the site, in this deck.
-->

---

# The attention slider

| | Semantic trigger | Default zoom |
|---|---|---|
| **Micro management** | every turn | steps |
| **Attentive** | each turn label, phase on close | turns |
| **Balanced** | phase close only | phases |
| **Yolo** | nothing until you ask, then "catch me up" | digest |

Ingestion is always live and nearly free. The slider only decides how many tokens and how much attention you spend. The cost is shown next to it.

<!--
2:00–2:20. You choose. Yolo mode: go for coffee, come back, press "catch me up" and read what happened since you last looked.
-->

---

# How it works

<Pele text="flowchart LR
  CC[Claude Code] -- hooks --> ENG[Engine]
  CC -- writes --> JSONL[(session JSONL)]
  JSONL -- incremental read --> ENG
  ENG --> NORM[normalize + redact]
  NORM --> STORE[(.yolo-twice/)]
  STORE --> AN[analyzers: structure, search, claude -p]
  AN --> STORE
  ENG -- HTTP + SSE --> UI[web UI]" />

Hooks trigger, the JSONL is the truth. Idempotent, incremental, redacted before anything is written. Derived data is plain JSON and mermaid in your repo: commit it or gitignore it.

<!--
2:20–2:40. Claude Code plugin with hooks, a small engine, a web UI. Stop it, resume it, run it twice: same bytes.
-->

---

# One command

```
claude plugin install yolo-twice --marketplace bar9/yolo-twice
```

Then, inside Claude Code:

```
/yolo-twice
```

<div class="pt-6 text-xl">→ live demo</div>

<!--
2:40–2:50. Install, then slash command. Switch to the live demo: a running session, zoom out to phases, zoom into a tool call, the graph with a rewind.
-->

---

# Roadmap and team

- opencode and other agents through a second source adapter
- MCP server so Claude can search its own history
- Annotations and team sharing on the committed history
- Standalone binary without a Node dependency

<div class="pt-8">

**Matthias Cullmann · Roland Brand · Jan Babin · +1**

MIT · [github.com/bar9/yolo-twice](https://github.com/bar9/yolo-twice) · [bar9.github.io/yolo-twice](https://bar9.github.io/yolo-twice/)

</div>

<!--
2:50–3:00. Thank you. Four of us, built in a weekend, AI-driven in parallel.
-->
