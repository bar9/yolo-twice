---
theme: default
title: yolo-twice
info: Long AI coding sessions are hard to look at afterwards. yolo-twice keeps them with the code so a team can find, share and review them. BaselHack 2026.
colorSchema: dark
fonts:
  sans: Inter
  serif: Nunito
  mono: JetBrains Mono
  weights: '400,500,600,700,800,900'
highlighter: shiki
drawings:
  persist: false
transition: fade
mdc: true
---

<img src="./assets/wordmark.png" class="cover-bg" alt="yolo-twice wordmark: YOLO, with the last O struck through by an orange brush-stroke T" />

<div class="cover-band">
  <p class="cover-tag">Give your AI conversations the attention they deserve.</p>
  <p class="cover-team">BaselHack 2026 · Matthias Cullmann · Roland Brand · Jan Babin · Thomas Schöller</p>
</div>

<!--
Hi, we are yolo-twice. The name: YOLO, "you only live once", is also the nickname for letting an agent run without asking for approval. Such a session happens once and is then gone. We record it with the code, so it can be looked at a second time. We want to talk about a question every team that works with AI coding agents runs into: what did the AI actually do, and why?
-->

---

<div class="kicker">01 · The scene</div>

# Did we just leak everything?

<div class="pr">
  <div class="pr-head">
    <span class="pr-state">Open</span>
    <span class="pr-title">Commit the AI sessions <span class="dim">#37</span></span>
    <span class="pr-meta"><span>24 hours of AI work</span><span class="add">+37 files</span></span>
  </div>
  <div v-click class="comment">
    <div class="who"><span class="avatar">MR</span> Reviewer</div>
    <p>Wait. Are our API keys in here?</p>
  </div>
  <div v-click class="comment reply">
    <div class="who"><span class="avatar">YOU</span> Author</div>
    <p>Uh… Claude dealt with that. Somewhere. Let me scroll.</p>
  </div>
</div>

<div v-click />
<IncomingCall :active="$clicks >= 3" :sound="$renderContext === 'slide'" avatar="./assets/silo-avatar.png" />

<!--
We built yolo-twice for 24 hours with an AI agent, and committed every session. The reviewer: are our API keys in here? The author: Claude dealt with that. Somewhere.

[click] And then the tech lead calls: "Are you crazy? You have been pushing your whole internal development context for the last 24 hours?" (The ringtone plays in the audience window only.)
-->

---

<div class="kicker">02 · Scrolling back</div>

# The transcript
<div class="term wall">
  <div class="term-bar"><span></span><span></span><span></span><em>Claude Code</em></div>
  <div class="scroll-hint">↑ 1,240 more lines</div>
<pre>
<b class="u">&gt;</b> Add a newsletter sign-up to the website. Before building it, have a helper agent find out what the
  rules and good practice are for collecting email addresses in Switzerland and the EU, then decide
  how to do it and explain why.
<b class="dot">●</b> I'll look at the current site first, then send a helper agent to research the rules.
<b class="dot">●</b> <b>Read</b>(index.html)
  <span class="dim">└  Read 64 lines</span>
<b class="dot">●</b> <b>Read</b>(training.html)
  <span class="dim">└  Read 48 lines</span>
<b class="dot">●</b> <b>Read</b>(server.js)
  <span class="dim">└  Read 37 lines</span>
<b class="dot">●</b> <b>Read</b>(style.css)
  <span class="dim">└  Read 122 lines</span>
<b class="dot">●</b> <b>Agent</b>(Research rules for newsletter sign-ups in CH and EU)
  <span class="dim">└  Done (11 tool uses · 27.3k tokens · 58s)</span>
<b class="dot">●</b> Summary of the research: the Swiss data protection act (revDSG) and the EU GDPR both expect clear,
  freely given consent that you can prove later. Good practice is double opt-in: people confirm by
  clicking a link in an email, which proves the address is theirs and keeps a record of consent.
<b class="dot">●</b> I will use double opt-in, store the date of consent, and add an unsubscribe link to every email.
<b class="dot">●</b> <b>Write</b>(signup.html)
  <span class="dim">└  Wrote 41 lines</span>
<b class="dot">●</b> <b>Update</b>(index.html)
  <span class="dim">└  Updated with 12 additions</span>
<b class="dot">●</b> <b>Write</b>(confirm.html)
  <span class="dim">└  Wrote 26 lines</span>
<b class="dot">●</b> <b>Update</b>(server.js)
  <span class="dim">└  Updated with 58 additions and 3 removals</span>
<b class="dot">●</b> <b>Update</b>(style.css)
  <span class="dim">└  Updated with 34 additions</span>
<b class="dot">●</b> <b>Bash</b>(node server.js &amp; curl -s -X POST localhost:3000/signup -d email=test@example.ch)
  <span class="err">└  {"ok":false,"error":"mail transport not configured"}</span>
<b class="dot">●</b> Sending the confirmation email needs a mail setting. For local testing I will write emails to a file.
<b class="dot">●</b> <b>Update</b>(server.js)
  <span class="dim">└  Updated with 9 additions and 2 removals</span>
<b class="dot">●</b> <b>Bash</b>(curl -s -X POST localhost:3000/signup -d email=test@example.ch)
  <span class="dim">└  {"ok":true,"status":"confirmation sent"}</span>
<b class="dot">●</b> <b>Bash</b>(cat outbox/latest.txt)
  <span class="dim">└  To: test@example.ch · Subject: Please confirm your newsletter sign-up</span>
<b class="dot">●</b> Done: the form sends a confirmation email; only confirmed addresses get the newsletter.
<b class="u">&gt;</b> Also add a CAPTCHA to the sign-up form, so bots can't flood us with fake sign-ups.
<b class="dot">●</b> I will add a simple puzzle CAPTCHA that is checked on the server before saving an address.
<b class="dot">●</b> <b>Write</b>(captcha.js)
  <span class="dim">└  Wrote 44 lines</span>
<b class="dot">●</b> <b>Update</b>(signup.html)
  <span class="dim">└  Updated with 9 additions</span>
<b class="dot">●</b> <b>Update</b>(server.js)
  <span class="dim">└  Updated with 17 additions</span>
<b class="dot">●</b> <b>Bash</b>(curl -s -X POST localhost:3000/signup -d email=bot@spam.example)
  <span class="dim">└  {"ok":false,"error":"captcha missing"}</span>
<b class="u">&gt;</b> Actually, drop the CAPTCHA: our members find it annoying, and our mailing tool already filters out
  spam sign-ups. Remove it again.
<b class="dot">●</b> Understood. Removing the CAPTCHA from the form and the server.
<b class="dot">●</b> <b>Bash</b>(rm captcha.js)
  <span class="dim">└</span>
<b class="dot">●</b> <b>Update</b>(signup.html)
  <span class="dim">└  Updated with 9 removals</span>
<b class="dot">●</b> <b>Update</b>(server.js)
  <span class="dim">└  Updated with 17 removals</span>
<b class="dot">●</b> <b>Bash</b>(curl -s -X POST localhost:3000/signup -d email=test2@example.ch)
  <span class="dim">└  {"ok":true,"status":"confirmation sent"}</span>
<b class="u">&gt;</b> Add a short, friendly privacy note under the sign-up form.
<b class="dot">●</b> A short note in plain words: what we store, why, and how to unsubscribe.
<b class="dot">●</b> <b>Read</b>(signup.html)
  <span class="dim">└  Read 32 lines</span>
<b class="dot">●</b> <b>Read</b>(contact.html)
  <span class="dim">└  Read 39 lines</span>
<b class="dot">●</b> The contact page already names the club's privacy contact. I will link to it from the note.
<b class="dot">●</b> <b>Update</b>(signup.html)
  <span class="dim">└  Updated with 7 additions</span>
<b class="dot">●</b> <b>Update</b>(style.css)
  <span class="dim">└  Updated with 6 additions</span>
<b class="dot">●</b> <b>Bash</b>(node server.js &amp; curl -s localhost:3000/signup.html | grep -c privacy)
  <span class="dim">└  2</span>
<b class="dot">●</b> <b>Bash</b>(npx html-validate index.html signup.html confirm.html)
  <span class="dim">└  0 errors, 0 warnings</span>
<b class="dot">●</b> The note is in place and all pages validate.
<b class="u">&gt;</b> Commit this as "Add a newsletter sign-up".
<b class="dot">●</b> <b>Bash</b>(git status --short)
  <span class="dim">└  M index.html · M server.js · M style.css · ?? signup.html · ?? confirm.html</span>
<b class="dot">●</b> <b>Bash</b>(git add -A &amp;&amp; git commit -m "Add a newsletter sign-up")
  <span class="dim">└  [main 63a2b55] Add a newsletter sign-up · 6 files changed, 286 insertions(+), 9 deletions(-)</span>
</pre>
  <div class="scroll-hint bottom">↓ 180 more lines</div>
</div>

<!--
Claude Code keeps a readable transcript of every session, and both answers are on this very screen: the helper agent's research on the rules, and "drop the CAPTCHA" with its reason in the middle. Nobody finds them by scrolling. A long session is many screens like this. There is no overview, no way to point at a decision, and it sits on the author's laptop where nobody else on the team can see it.
-->

---
layout: center
class: text-center
---

<div class="kicker">03 · Demo</div>

# Live demo

<div class="term narrow">
  <div class="term-bar"><span></span><span></span><span></span><em>Claude Code</em></div>
<pre>
<span class="prompt">&#36;</span> claude plugin install yolo-twice --marketplace bar9/yolo-twice
<b class="u">&gt;</b> /yolo-twice:yolo-twice
</pre>
</div>

<!--
One command installs it. Next slide: the real product, live. We click through it.
-->

---
layout: full
clicks: 5
---

<LiveDemo src="http://localhost:9656/yolo-twice" script="privacy" poster="./assets/ui-split.png" />

<!--
The live product, stepped by our clicks (.yolo-twice/demos/privacy.json). Needs the engine: /yolo-twice:yolo-twice.
1. Yes. 24 hours of AI work, in the repo.
2. [click] We asked first. One word finds it: "disclosure", our own prompt.
3. [click] The agent counted every leak. Then masked them: $PROJECT, ~.
4. [click] A scan alarm. False: it caught its own pattern.
5. [click] Before the push: 0 secrets, 0 home paths.
6. [click] The whole fix. One map.
-->

---

<div class="kicker">04 · Benefits</div>

# Find, share, review, continue

<div class="solo">
<div class="term">
  <div class="term-bar"><span></span><span></span><span></span><em>terminal</em></div>
<pre>
<span class="tag t-find">find</span>
<span class="prompt">&#36;</span> git log --oneline -- .yolo-twice/sessions
<span class="hash">63a2b55</span> Add a newsletter sign-up
<i></i>
<span class="tag t-share">share</span>
<span class="ok">→ localhost:9656/api/7f825b/t4</span>
<i></i>
<span class="tag t-review">review</span>
<span class="prompt">&#36;</span> gh pr diff 142 --name-only | grep yolo
<span class="ok">.yolo-twice/sessions/7f825bc9/events.ndjson</span>
<i></i>
<span class="tag t-continue">continue</span>
<span class="prompt">&#36;</span> yolo-twice resume 7f825bc9
<span class="ok">✓ claude --resume … --fork-session</span>
</pre>
</div>
</div>

<!--
The same three questions, plus one. Sessions can be found later: they stay with the project, also when people move on. A link opens a specific step for others on the team. Reviewers can see the reasoning in addition to the resulting code. And a colleague can resume the session on their own machine. Back to the reviewer: they open the link, land on the exchange, and have the answer. As more code is written with AI agents, it becomes more useful to know why it was written that way.
-->

---

<div class="kicker">05 · Values</div>

# What we care about

<div class="hood tiles values">
  <div class="card"><b>Transparency</b><span>The reasoning is reviewable, not only the result</span></div>
  <div class="card"><b>Privacy</b><span>Runs locally, secrets removed before saving</span></div>
  <div class="card"><b>Openness</b><span>Plain files in your repo, MIT licensed</span></div>
  <div class="card"><b>Economy</b><span>Structure without AI, summaries only when asked</span></div>
</div>

<!--
Transparency: as more code is written with AI agents, the reasoning behind it should be as reviewable as the code. Privacy: everything runs on your machine; passwords, keys and personal folder names are removed before anything is written, and you decide what to commit. Openness: plain JSON and text files that any tool can read, and the project is open source. Economy: chapters, exchanges and helper agents come straight from the transcript with no model call; short summaries are written by Claude only when wanted, cached, and the cost is shown.
-->

---

<div class="kicker">06 · Outlook</div>

# Outlook

<div class="road">
  <div class="card"><span class="when">next</span><b>More agents</b><span>Beyond Claude Code</span></div>
  <div class="card"><span class="when">next</span><b>Comments</b><span>Discuss a step where it happened</span></div>
  <div class="card"><span class="when">later</span><b>Agents that remember</b><span>The AI searches its own history</span></div>
</div>

<!--
Where we would take it. Support for other coding agents beyond Claude Code. Comments on saved sessions, so a review discussion can sit on the exact step it is about. And letting the AI search its own history, so the next session can build on what earlier ones decided and why.
-->

---

<div class="kicker">07 · Thanks</div>

# Thank you

<div class="team big">
  <p>Matthias Cullmann · Roland Brand · Jan Babin · Thomas Schöller</p>
  <p class="dim"><a href="https://github.com/bar9/yolo-twice">github.com/bar9/yolo-twice</a></p>
</div>

<p class="credits">Built on ideas from Claudescope, claude-code-history-viewer and cc_transcript_viewer · diagrams by pele</p>

<!--
Thanks to the projects that came before us: Claudescope, claude-code-history-viewer, cc_transcript_viewer; every diagram is rendered with pele. The site is bar9.github.io/yolo-twice.
-->

---

<div class="kicker">Backup · The gap</div>

# Find, share, review: not for AI sessions

<div class="solo">
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
<span class="dim">… 6 files of code</span>
<span class="err">› 0 files of conversation</span>
</pre>
</div>
</div>

<!--
Find, share, review: three things every team does with code, every day. "Where is last Tuesday's session?" It is not in the project; it leaves with the laptop. "Look at the moment it chose this." There is no link to send. "Why does the code look like this?" Reviews see the result, not the reasoning. More design decisions are made in these conversations, and they are rarely part of a review.
-->

---

<div class="kicker">Backup · The idea</div>

# Keep the session with the code

<div class="solo">
<div class="term">
  <div class="term-bar"><span></span><span></span><span></span><em>terminal</em></div>
<pre>
<span class="prompt">&#36;</span> git show --stat HEAD
<span class="hash">commit 63a2b55</span>
    Add a newsletter sign-up
<i></i>
 index.html                       |  42 <span class="add">++++</span><span class="del">-</span>
 server.js                        |  31 <span class="add">+++</span>
<span class="hl"> .yolo-twice/sessions/7f825bc9/
   meta.json                      |   9 <span class="add">+</span>
   events.ndjson                  | 412 <span class="add">++++++++</span>
   structure.json                 |  96 <span class="add">++</span></span>
</pre>
</div>
</div>

<!--
We already know how to make work visible to a team: put it in version control. We store the AI session in the project, next to the code it produced, so it can be versioned, shared and looked at in the same pull request. Existing viewers show a transcript on one machine; we learned from them. The difference is that the session becomes part of the project, readable at several levels of detail.
-->

---

<div class="kicker">Backup · Record</div>

# Recorded in the background

<div class="diagram">

<Pele text="flowchart LR
  CC[AI coding session] --> ENG[yolo-twice, on your machine]
  ENG --> R[secrets removed]
  R --> STORE[(saved in the project)]" />

</div>

<!--
Nothing to do: it records while you work. Passwords, keys and personal folder names are removed before anything is saved. The files are plain JSON and text that other tools can read, and there is one folder per session, so sessions from several people do not conflict. For developers: a Claude Code plugin with hooks plus a small local engine. You decide whether to commit it.
-->

---

<div class="kicker">Backup · Read</div>

# From one line to every detail

<img src="./assets/ui-split.png" class="shot" alt="yolo-twice: a session summary on the left, its turns as a graph on the right" />

<!--
The session in yolo-twice: a timeline at the top, the story on the left, the map on the right. Detail goes from a one-line summary through chapters and single exchanges down to the raw log. Some readers only need the top line; others go down to the raw log. The structure needs no AI; the short summaries are written by Claude, cached, and only as often as you allow.
-->

---

<div class="kicker">Backup · Map</div>

# Every step, every helper agent

<img src="./assets/ui-map.png" class="shot" alt="yolo-twice map: three helper agents working in parallel, each in its own frame" />

<!--
One exchange as a map: here three helper agents were started in parallel, each in its own frame with its own steps. Changes of plan stay visible as their own branch; that is where the reviewer finds where the CAPTCHA was dropped.
-->

---

<div class="kicker">Backup · Under the hood</div>

# Implementation

<div class="hood tiles">
  <div class="card"><b>Incremental</b></div>
  <div class="card"><b>Redacted on the way in</b></div>
  <div class="card"><b>Structure without AI</b></div>
  <div class="card"><b>Cached summaries</b></div>
  <div class="card"><b>Live</b></div>
  <div class="card"><b>Resumable anywhere</b></div>
</div>

<p class="stack">TypeScript · Bun · React · Claude Code plugin · 63 tests · MIT</p>

<!--
For the technical audience, briefly. Incremental and repeatable: it reads only what is new, and running it twice gives identical output. Redaction runs before anything is written; paths become $PROJECT and ~. Chapters, exchanges, tool calls, helper agents and changes of plan come straight from the transcript, with no model call. Summaries are written by Claude, cached by content, and only as often as the attention setting allows; the cost is shown. Hooks notify a local engine and the browser updates live. resume rebuilds a working Claude Code transcript on any teammate's machine.
-->
