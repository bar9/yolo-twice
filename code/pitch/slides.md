---
theme: default
title: yolo-twice
info: Long AI coding sessions are a black box. yolo-twice makes them something a team can find, share and review. BaselHack 2026.
colorSchema: dark
fonts:
  sans: Inter
  mono: JetBrains Mono
  weights: '400,500,600,700'
highlighter: shiki
drawings:
  persist: false
transition: fade
mdc: true
---

<img src="./assets/cover-yolo.jpg" class="cover-bg" alt="A zombie developer with a laptop in a moonlit graveyard, behind stone letters spelling YOLO" />

<div class="cover-band">
  <h1>yolo-twice</h1>
  <p class="cover-tag">What did the AI do, and why?</p>
  <p class="cover-team">BaselHack 2026 · Matthias Cullmann · Roland Brand · Jan Babin · Thomas Schöller</p>
</div>

<!--
0:00–0:10. Hi, we are yolo-twice. We want to talk about a question every team that works with AI coding agents runs into: what did the AI actually do, and why?
-->

---

<div class="kicker">01 · The scene</div>

# Three hours of AI work. One fair question.

<div class="pr">
  <div class="pr-head">
    <span class="pr-state">Open</span>
    <span class="pr-title">Add a login to the API <span class="dim">#142</span></span>
    <span class="pr-meta"><span>written with an AI agent · 3h 12m</span><span class="add">+2,431</span><span class="del">−187</span></span>
  </div>
  <div v-click class="comment">
    <div class="who"><span class="avatar">MR</span> Reviewer</div>
    <p>Why this kind of encryption? And who decided to drop the protection against password guessing?</p>
  </div>
  <div v-click class="comment reply">
    <div class="who"><span class="avatar">YOU</span> Author</div>
    <p>Good question. The AI did that at some point this afternoon. Let me scroll back…</p>
  </div>
</div>

<!--
0:10–0:35. A scene everyone recognises. A developer works with an AI agent all afternoon; the result is a big change. A reviewer asks a perfectly reasonable question. (For developers: RS256 and rate limiting.) The author was there, sort of: approved things, went for coffee, came back. The answer exists. Finding it is the problem.
-->

---

<div class="split">
<div class="split-text">

<div class="kicker">02 · Scrolling back</div>

# The record exists. It just isn't usable.

Claude Code keeps a readable transcript of every session. But three hours of work is hundreds of screens like this one.

<ul class="plain">
  <li><b>No overview.</b> You read it in order, start to finish.</li>
  <li><b>No way to point at a decision.</b> You scroll and hope.</li>
  <li><b>Stuck on one laptop.</b> Nobody else on the team can see it.</li>
</ul>

</div>
<div class="term tall">
  <div class="term-bar"><span></span><span></span><span></span><em>Claude Code</em></div>
  <div class="scroll-hint">↑ 187 more turns</div>
<pre>
<b class="u">&gt;</b> Add a /login endpoint to the API
<i></i>
<b class="dot">●</b> I'll start by looking at the existing routes.
<i></i>
<b class="dot">●</b> <b>Read</b>(src/routes/auth.ts)
  <span class="dim">└  Read 42 lines</span>
<i></i>
<b class="dot">●</b> <b>Task</b>(Research JWT best practices)
  <span class="dim">└  Done (6 tool uses · 18.2k tokens · 41s)</span>
<i></i>
<b class="dot">●</b> <b>Update</b>(src/routes/auth.ts)
  <span class="dim">└  Updated with 38 additions and 4 removals</span>
<i></i>
<b class="dot">●</b> <b>Bash</b>(npm test)
  <span class="dim">└</span>  <span class="err">✗ login returns 401 for valid user</span>
     <span class="dim">29 passed, 1 failed</span>
<i></i>
<b class="dot">●</b> One test fails: the hash comparison uses
  the wrong salt. Fixing it.
<i></i>
<b class="u">&gt;</b> Also add rate limiting to the login endpoint
<i></i>
<b class="u">&gt;</b> Actually, skip rate limiting; just fix the
  failing login test
</pre>
  <div class="scroll-hint bottom">↓ 24 more turns</div>
</div>
</div>

<!--
0:35–0:55. Be fair to Claude Code: the transcript is good, and both answers are on this very screen (the research task, and "skip rate limiting" at the bottom). But this is one screen of hundreds, in order, and only on the author's laptop.
-->

---

<div class="split">
<div class="split-text">

<div class="kicker">03 · The gap</div>

# For the team, AI work is a black box.

<div class="rows">
  <div class="row"><span class="tag t-find">find</span><div><b>"Where is last Tuesday's session?"</b><span>Not in the project. It leaves with the laptop.</span></div></div>
  <div class="row"><span class="tag t-share">share</span><div><b>"Look at the moment it chose this."</b><span>There is no link to send.</span></div></div>
  <div class="row"><span class="tag t-review">review</span><div><b>"Why does the code look like this?"</b><span>Reviews see the result, never the reasoning.</span></div></div>
</div>

<p class="punch">More and more decisions are made in these conversations. None of them are reviewed.</p>

</div>
<div class="term">
  <div class="term-bar"><span></span><span></span><span></span><em>terminal</em></div>
<pre>
<span class="tag t-find">find</span>
<span class="prompt">&#36;</span> git log -- ~/.claude/projects
<span class="err">fatal: '~/.claude/projects' is outside repository</span>
<i></i>
<span class="tag t-share">share</span>
<span class="prompt">&#36;</span> claude --resume 7f825bc9
<span class="err">› opens the whole session, at the end,</span>
<span class="err">  on the machine where it ran</span>
<i></i>
<span class="tag t-review">review</span>
<span class="prompt">&#36;</span> gh pr diff 142 --name-only
src/routes/auth.ts
src/routes/auth.test.ts
<span class="dim">… 36 more files of code</span>
<span class="err">› 0 files of conversation</span>
</pre>
</div>
</div>

<!--
0:55–1:20. Find, share, review: three things every team does with code, every day. Try them on the AI session and you get nothing (the terminal on the right is the developer's version of the same story). The point to land: more and more engineering decisions are made in that conversation, and it is the one part of the work nobody reviews.
-->

---

<div class="split">
<div class="split-text">

<div class="kicker">04 · The idea</div>

# Keep the conversation with the code.

We treat an AI session like source code: saved in the project, versioned, shared with the team, and reviewed in the same pull request.

<p class="new">Existing tools show you a transcript. We make it part of the project, readable at any level of detail.</p>

<div class="chips">
  <span>saved with the project</span><span>versioned</span><span>shareable</span><span>reviewable</span><span>resumable</span>
</div>

</div>
<div>
<div class="term">
  <div class="term-bar"><span></span><span></span><span></span><em>terminal</em></div>
<pre>
<span class="prompt">&#36;</span> git show --stat HEAD
<span class="hash">commit 63a2b55</span>
    Add a login to the API
<i></i>
 src/routes/auth.ts               |  42 <span class="add">++++</span><span class="del">-</span>
 src/routes/auth.test.ts          |  31 <span class="add">+++</span>
<span class="hl"> .yolo-twice/sessions/7f825bc9/
   meta.json                      |   9 <span class="add">+</span>
   events.ndjson                  | 412 <span class="add">++++++++</span>
   structure.json                 |  96 <span class="add">++</span>
   graph.mmd                      |  18 <span class="add">+</span></span>
</pre>
</div>
<p class="caption">One change, one commit: the code, and the conversation that produced it.</p>
</div>
</div>

<!--
1:20–1:35. We already know how to make work transparent to a team: put it in version control. So we do exactly that with the AI session. Same change, same review. That is what is new: transcript viewers exist and we learned from them, but they show a list on one machine. We make the session part of the project.
-->

---

<div class="kicker">05 · How it works: record</div>

# Recorded automatically. Private by default.

<div class="grid grid-cols-2 gap-10 pt-2 items-center">
<div>

<Pele text="flowchart TB
  CC[AI coding session] --> ENG[yolo-twice, on your machine]
  ENG --> R[secrets removed]
  R --> STORE[(saved in the project)]" />

</div>
<div class="facts">

<p><b>Nothing to do.</b> It records while you work, in the background.</p>
<p><b>Private.</b> Passwords, keys and personal folder names are removed before anything is saved.</p>
<p><b>Open.</b> Plain text files that any tool can read. No lock-in.</p>
<p><b>Made for teams.</b> Everyone's sessions sit side by side without getting in each other's way.</p>

</div>
</div>

<!--
1:35–1:55. For developers: a Claude Code plugin with hooks, plus a small local engine. Redaction happens before anything touches disk, paths become $PROJECT and ~, one folder per session so there are no merge conflicts. You decide whether to commit it.
-->

---

<div class="kicker">06 · How it works: read</div>

# From one sentence to every detail.

<div class="grid grid-cols-2 gap-8 pt-2">
<div class="zoom">

<div class="z z1"><span class="lvl">in one line</span>Added a login and fixed the tests</div>
<div class="z z2"><span class="lvl">in three sentences</span>Added a login with secure tokens, following a research step by a helper agent. Password-guessing protection was requested, then dropped by the developer. Fixed a bug that failed one test.</div>
<div class="z z3"><span class="lvl">chapters</span>3 chapters · 7 exchanges · 1 helper · 1 change of plan</div>
<div class="z z4"><span class="lvl">one exchange</span>"Actually, skip rate limiting; just fix the failing login test"</div>
<div class="z z5"><span class="lvl">raw log</span>{"type":"user","message":{"role":"user",…</div>

</div>
<div>

<Pele text="flowchart TB
  t1[Add a login]
  a1[[Helper: research tokens]]
  t2[Also protect against guessing]
  t3[Skip that, fix the test]
  t4[Write the changelog]
  t1 -.-> a1
  t1 --> t2
  t1 -. new plan .-> t3
  t3 --> t4
  classDef branch fill:#3a2e10,stroke:#e3b341,color:#f6d27a;
  classDef subagent fill:#2a1f45,stroke:#bc8cff,color:#d2b8ff;
  class t3 branch; class a1 subagent;" />

<p class="caption center">Every detour stays visible. The yellow branch answers the reviewer.</p>

</div>
</div>

<!--
1:55–2:15. Left: the same session at five levels of detail. Managers read the top line; developers go all the way down. The structure needs no AI at all; the short summaries are written by Claude itself, cached, and only as often as you allow. Right: the session as a map, not a list. The yellow branch is exactly where rate limiting was dropped.
-->

---

<div class="kicker">07 · Under the hood</div>

# Small, careful engineering.

<div class="hood">
  <div class="card"><b>Incremental and repeatable</b><p>Reads only what is new since last time. Run it twice: identical output, byte for byte.</p></div>
  <div class="card"><b>Secrets removed on the way in</b><p>Redaction runs before anything is written. Paths become <code>$PROJECT</code> and <code>~</code>, so no personal details reach the repo.</p></div>
  <div class="card"><b>Structure without AI</b><p>Chapters, exchanges, tool calls, helper agents and changes of plan come straight from the transcript. No model call, no cost.</p></div>
  <div class="card"><b>Summaries only when wanted</b><p>Written by Claude itself, cached by content, and only as often as the attention setting allows. The cost is shown.</p></div>
  <div class="card"><b>Live</b><p>Claude Code hooks notify a local engine; the browser updates over Server-Sent Events while the agent works.</p></div>
  <div class="card"><b>Portable sessions</b><p><code>resume</code> rebuilds a working Claude Code transcript from the saved events, on any teammate's machine.</p></div>
</div>

<p class="stack">TypeScript · Bun and Node · React · Claude Code plugin · 50 tests, 343 assertions · open source (MIT)</p>

<!--
2:15–2:30. For the technical judges, in one breath: incremental and idempotent ingestion, redaction before write, structural analysis with no model at all, lazy cached summaries under a cost budget, live updates, and resume across machines. Managers can skip this slide; the next one is what it means for them.
-->

---

<div class="split">
<div class="split-text">

<div class="kicker">08 · What changes</div>

# Same questions. Now they have answers.

<div class="rows">
  <div class="row"><span class="tag t-find">find</span><div><b>Nothing gets lost.</b><span>Sessions stay with the project, even when people move on.</span></div></div>
  <div class="row"><span class="tag t-share">share</span><div><b>Discuss the exact moment.</b><span>A link opens the decision, for anyone on the team.</span></div></div>
  <div class="row"><span class="tag t-review">review</span><div><b>Reviews cover the reasoning.</b><span>Not just the result.</span></div></div>
  <div class="row"><span class="tag t-continue">continue</span><div><b>Anyone can pick up the work.</b><span>A colleague continues the session on their own machine.</span></div></div>
</div>

<p class="punch">As AI writes more of our software, knowing <em>why</em> it was written that way becomes part of quality, trust and accountability.</p>

</div>
<div class="term">
  <div class="term-bar"><span></span><span></span><span></span><em>terminal</em></div>
<pre>
<span class="tag t-find">find</span>
<span class="prompt">&#36;</span> git log --oneline -- .yolo-twice/sessions
<span class="hash">63a2b55</span> Add a login to the API
<i></i>
<span class="tag t-share">share</span>
<span class="ok">→ localhost:9656/api/7f825b/t4</span>
<span class="dim">  same view for anyone with the repo</span>
<i></i>
<span class="tag t-review">review</span>
<span class="prompt">&#36;</span> gh pr diff 142 --name-only | grep yolo
<span class="ok">.yolo-twice/sessions/7f825bc9/events.ndjson</span>
<i></i>
<span class="tag t-continue">continue</span>
<span class="prompt">&#36;</span> yolo-twice resume 7f825bc9
<span class="ok">✓ transcript rebuilt for this machine</span>
<span class="ok">✓ claude --resume … --fork-session</span>
</pre>
</div>
</div>

<!--
2:30–2:45. The mirror of the black-box slide: the same three questions, plus one. Back to Friday: the reviewer opens the link, lands on the exact exchange, and has the answer. And the bigger picture: as agents write more of our software, the reasoning behind it is part of quality, trust and accountability. That is the transparency we are after, built on tools teams already use.
-->

---
layout: center
class: text-center
---

<div class="kicker">09 · Proof</div>

# We built yolo-twice with yolo-twice.

<p class="lead">This project keeps the AI sessions that built it, right next to its code. Let's open one.</p>

<div class="term narrow">
  <div class="term-bar"><span></span><span></span><span></span><em>Claude Code</em></div>
<pre>
<span class="prompt">&#36;</span> claude plugin install yolo-twice --marketplace bar9/yolo-twice
<b class="u">&gt;</b> /yolo-twice:yolo-twice
</pre>
</div>

<div class="pt-6 text-xl demo">→ live demo</div>

<!--
2:45–2:55. We used it on ourselves all weekend. Switch to the demo: open the committed build session, start from the one-line summary, open a chapter, then one decision, and show the map.
-->

---

<div class="kicker">10 · Thanks</div>

# Thank you.

<div class="facts wide">

<p>We learned from the viewers that came first:
<a href="https://github.com/vladar107/claudescope">Claudescope</a>,
<a href="https://github.com/jhlee0409/claude-code-history-viewer">claude-code-history-viewer</a>,
<a href="https://github.com/tim-hua-01/cc_transcript_viewer">cc_transcript_viewer</a>.
Every diagram in this deck is rendered with <a href="https://github.com/obsidianmd/pele">pele</a>.</p>

<p><b>Next:</b> support for AI agents beyond Claude Code, comments on saved sessions, and letting the AI search its own history.</p>

</div>

<div class="team">
  <p>Matthias Cullmann · Roland Brand · Jan Babin · Thomas Schöller</p>
  <p class="dim">Open source (MIT) · <a href="https://github.com/bar9/yolo-twice">github.com/bar9/yolo-twice</a> · <a href="https://bar9.github.io/yolo-twice/">bar9.github.io/yolo-twice</a></p>
</div>

<!--
2:55–3:00. Credit to the projects before us. Thank you.
-->
