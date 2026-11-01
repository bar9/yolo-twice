---
theme: default
title: yolo-twice
info: Long AI coding sessions are hard to look at afterwards. yolo-twice keeps them with the code so a team can find, share and review them. BaselHack 2026.
colorSchema: dark
fonts:
  sans: Inter
  serif: Nunito
  mono: JetBrains Mono
  weights: "400,500,600,700,800,900"
highlighter: shiki
drawings:
  persist: false
transition: fade
mdc: true
---

<img src="./assets/wordmark.png" class="cover-bg" alt="yolo-twice wordmark: YOLO, with the last O struck through by an orange brush-stroke T" />

<div class="cover-band">
  <p class="cover-tag">Give our AI conversations the attention they deserve.</p>
  <p class="cover-team">BaselHack 2026 · Matthias Cullmann · Roland Brand · Jan Babin · Thomas Schöller</p>
</div>

<!--
Hi, we are yolo-twice. The name: YOLO, "you only live once", is also the nickname for letting an agent run without asking for approval. Such a session happens once and is then gone. We record it with the code, so it can be looked at a second time. We want to talk about a question every team that works with AI coding agents runs into: what did the AI actually do, and why?
-->

---

<div class="kicker">The scene</div>

# Did we just leak everything?

<div class="pr">
  <div class="pr-head">
    <span class="pr-state merged">Merged</span>
    <span class="pr-title">DO NOT MERGE <span class="dim">#37</span></span>
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
We built yolo-twice for 24 hours with an AI agent, and committed every session. The PR says DO NOT MERGE, but it is already merged. The reviewer: are our API keys in here? The author: Claude dealt with that. Somewhere.

[click] And then the tech lead calls: "Are you crazy? You have been pushing your whole internal development context for the last 24 hours?" (The ringtone plays in the audience window only.)
-->

---

<div class="kicker">Scrolling back</div>

# The transcript

<div class="term wall">
  <div class="term-bar"><span></span><span></span><span></span><em>Claude Code</em></div>
  <div class="scroll-hint">↑ 9,870 more lines</div>
<pre>
<b class="u">&gt;</b> .yolo-twice contains my home folder ~ as absolute path. can we replace it with the tilde version?
  goals: better portability to the team, no disclosure of user names and FS layout, less tokens
<b class="dot">●</b> This is a new task, so I'll start the plan fresh. First I'll measure where absolute paths occur.
<b class="dot">●</b> <b>Bash</b>(Count absolute paths, slugs and usernames across .yolo-twice files)
  <span class="dim">└  296 project paths · 65 home paths · 120 slugs · 78 bare user names</span>
<b class="dot">●</b> <b>WebFetch</b>(https://code.claude.com/docs/en/cli-reference)
  <span class="dim">└  Output too large (50.6KB). Full output saved to a file</span>
<b class="dot">●</b> <b>Bash</b>(Read full --resume entry and local fork-session help)
  <span class="dim">└  --resume, -r  Resume a conversation by session ID …</span>
<b class="dot">●</b> <b>AskUserQuestion</b>(How should resume treat the paths?)
<b class="dot">●</b> <b>Write</b>(~/.claude/plans/pasted-content-id-bba5-we-are-transient-nautilus.md)
<b class="u">&gt;</b> resume
<b class="dot">●</b> Resuming the approved plan. First I'll check where the repo stands.
<b class="dot">●</b> <b>Bash</b>(Verify regenerated project.json and conclude the merge)
<b class="dot">●</b> <b>Bash</b>(Install, test, typecheck and build after the merge)
  <span class="dim">└  39 pass · 0 fail</span>
<b class="dot">●</b> <b>Write</b>($PROJECT/code/packages/core/src/anonymize.ts)
  <span class="dim">└  File created successfully</span>
<b class="dot">●</b> Now wiring it into ingest: path anonymization runs after secret redaction.
<b class="dot">●</b> <b>Bash</b>(Add anonymizer and ingest tests, run them)
  <span class="err">└  5 pass · 1 fail: Received "alicesmith and &lt;user&gt;.cooper and &lt;user&gt;@example.com"</span>
<b class="dot">●</b> <b>Bash</b>(Fix username boundary after the name, rerun all tests)
  <span class="dim">└  Ran 45 tests across 9 files · 0 fail</span>
<b class="dot">●</b> <b>Bash</b>(Expand paths on resume, write to cache, fork the session; update CLI)
<b class="dot">●</b> <b>Bash</b>(Rebuild fixture session in a scratch project and resume it as a fork)
  <span class="err">└  Exit code 1</span>
<b class="dot">●</b> <b>Bash</b>(Resume the rebuilt transcript as a fork with login, hooks off)
<b class="dot">●</b> <b>Bash</b>(Scan before, restart engine to rebuild with v3, scan after)
  <span class="dim">└  before: ~ 435 · &lt;user&gt; 88 · after: ~ 3 · &lt;user&gt; 0</span>
<b class="dot">●</b> <b>Bash</b>(Widen the other-homes rule, bump normalizer to 4, run tests)
<b class="dot">●</b> The secret scan matched something in the session's events, and my command committed anyway.
<b class="dot">●</b> <b>Bash</b>(Show what the secret scan matched)
  <span class="dim">└  grep -lE 'sk-ant-api|ghp_[A-Za-z0-9]{30}' …   (the scan's own command)</span>
<b class="dot">●</b> .yolo-twice/ is now portable and anonymous.
<b class="u">&gt;</b> implement the project.json split
<b class="dot">●</b> <b>Bash</b>(Move cursor, project index and open summaries to the cache)
<b class="dot">●</b> <b>Bash</b>(Run all tests after the layout change)
  <span class="err">└  44 pass · 1 fail: ENOENT .yolo-twice/project.json</span>
<b class="dot">●</b> <b>Bash</b>(Replace --bare with disableAllHooks in the summarizer)
<b class="u">&gt;</b> build in ~/Downloads/Yolo/1793441711665.jpg to the title slide
<b class="dot">●</b> <b>Bash</b>(Copy the image into the deck and make it the title slide background)
<b class="dot">●</b> <b>Bash</b>(Build the deck, serve it under its Pages base path, screenshot slide 1)
<b class="u">&gt;</b> commit and push changes
<b class="dot">●</b> <b>Bash</b>(Stage .yolo-twice and scan the staged additions for real secrets and home paths)
  <span class="dim">└  secret hits: 0 · home paths: 0 · 37 files changed</span>
<b class="dot">●</b> <b>Bash</b>(Commit the index refresh and push main)
</pre>
  <div class="scroll-hint bottom">↓ 180 more lines</div>
</div>

<!--
The answer is on this screen. Three times: the leak count, a false alarm, the scan before the push. Nobody finds it by scrolling. And this is one screen of 24 hours.
-->

---

layout: center
class: text-center

---

<div class="kicker">Demo</div>

# Live demo

<div class="term narrow">
  <div class="term-bar"><span></span><span></span><span></span><em>Claude Code</em></div>
<pre>
<span class="prompt">&#36;</span> claude plugin install yolo --marketplace bar9/yolo-twice
<b class="u">&gt;</b> /yolo:twice
</pre>
</div>

<!--
One command installs it. Next slide: the real product, live. We click through it.
-->

---

## layout: full

<HandOver ui="http://localhost:9656/yolo-twice" script="privacy" />

<!--
The deck hands over to the real product (.yolo-twice/demos/privacy.json). Page Down steps; after step 6 it comes back to the next slide, and Page Up from step 1 returns to the slide before. Needs the engine: /yolo:twice.
1. Yes. 24 hours of AI work, in the repo.
2. [Page Down] We asked first. One word finds it: "disclosure", our own prompt.
3. [Page Down] The agent counted every leak. Then masked them: $PROJECT, ~.
4. [Page Down] A scan alarm. False: it caught its own pattern.
5. [Page Down] Before the push: 0 secrets, 0 home paths.
6. [Page Down] The whole fix. One map.
-->

---

<div class="kicker">Share &amp; resume</div>

<h1 class="handoff-title">Pick up where someone else left off.</h1>

<div class="handoff-flow">
  <div class="handoff-card handoff-before">
    <img class="handoff-avatar" src="./assets/handoff-author.jpg" alt="Original session author" />
    <div class="handoff-agent">AI agent <span>✦</span></div>
    <div class="handoff-rows">
      <div class="handoff-row"><span class="handoff-glyph">▤</span><span>Messages &amp; goals</span></div>
      <div class="handoff-row"><span class="handoff-glyph">⌘</span><span>Tool calls</span></div>
      <div class="handoff-row"><span class="handoff-glyph">&lt;/&gt;</span><span>Code &amp; diffs</span></div>
      <div class="handoff-row"><span class="handoff-glyph">✧</span><span>Visible decisions</span></div>
    </div>
    <div class="handoff-status">Original session</div>
  </div>

  <div class="handoff-arrow" aria-hidden="true">→</div>

  <div class="handoff-store">
    <div class="handoff-file"><img class="handoff-file-mark" src="./assets/mark.png" alt="" /><span class="handoff-file-name">.yolo-twice/</span></div>
    <strong>Save the full context</strong>
    <span>with the code, in git</span>
  </div>

  <div class="handoff-arrow" aria-hidden="true">→</div>

  <div class="handoff-card handoff-after">
    <img class="handoff-avatar" src="./assets/handoff-teammate.jpg" alt="Teammate continuing the session" />
    <div class="handoff-agent">AI agent <span>✦</span></div>
    <div class="handoff-rows">
      <div class="handoff-row"><span class="handoff-glyph">▤</span><span>Messages &amp; goals</span><b>✓</b></div>
      <div class="handoff-row"><span class="handoff-glyph">⌘</span><span>Tool calls</span><b>✓</b></div>
      <div class="handoff-row"><span class="handoff-glyph">&lt;/&gt;</span><span>Code &amp; diffs</span><b>✓</b></div>
      <div class="handoff-row"><span class="handoff-glyph">✧</span><span>Visible decisions</span><b>✓</b></div>
    </div>
    <div class="handoff-status">Resumed &amp; continued</div>
  </div>
</div>

<div class="handoff-footer"><span>✦</span> Resume it yourself or hand it to a teammate</div>

<!--
The demo showed how to find the answer inside a session. This is the other part: the whole recorded context lives with the code. Commit the session, then you or a teammate can clone the repo and resume it as a new Claude Code session. Prompts, tool calls, code changes and visible decisions are there to continue from; private hidden reasoning is not claimed. The resumed session is a fork, so the original stays intact.
-->

---

<div class="kicker">Outlook</div>

# Outlook

<div class="growth">
  <svg class="growth-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="grow" x1="0" x2="1"><stop offset="0" stop-color="#f25c05" stop-opacity=".12" /><stop offset="1" stop-color="#f25c05" /></linearGradient></defs>
    <path d="M 0 74 C 6 71, 12 68.5, 16.7 66.7 S 40 55, 50 48.9 S 76 22, 83.3 9.1 S 96 -8, 99 -14" fill="none" stroke="url(#grow)" stroke-width="3" stroke-linecap="round" vector-effect="non-scaling-stroke" />
  </svg>
  <div class="step s1"><i class="node"></i><div class="label"><b>Agent agnostic</b><ul><li>Use and promote open formats</li><li>Agent interop</li><li>Integrate <a href="https://github.com/bar9/yolo-twice/issues/4">OpenCode</a></li></ul></div></div>
  <div class="step s2"><i class="node"></i><div class="label"><b>Team work</b><ul><li>Build a joint knowledge base</li><li>Discuss</li><li>Automated insights</li></ul></div></div>
  <div class="step s3"><i class="node"></i><div class="label"><b>Global community</b><ul><li>Coders become agentic engineers</li><li>Open data on prompting, for future research</li></ul></div><img class="sketch" src="./assets/global-community.svg" alt="Sketch: 1980 a lone developer at a computer; 2000 people connected to the world; 2027 people and an AI agent, with /yolo:twice, connected to the world" /></div>
</div>

<!--
Where we would take it. Agent agnostic: open formats instead of one vendor's, sessions that work across agents, and OpenCode support next (issue #4). Team work: a joint knowledge base built from sessions, discussion on the exact step, and insights generated automatically. Global community: coders are becoming agentic engineers, and open data on how people prompt can enable future research.
-->

---

<div class="kicker">Your turn</div>

# Try it yourselves

<p class="try-intro">Install the Claude Code plugin, then open your own session.</p>

<div class="try-grid">
  <div class="term try-term">
    <div class="term-bar"><span></span><span></span><span></span><em>terminal</em></div>
<pre><span class="term-comment"># Install</span>
<span class="prompt">&#36;</span> claude plugin install yolo \
    --marketplace bar9/yolo-twice
<span class="term-comment"># In Claude Code, inside your project</span>
<b class="u">&gt;</b> /yolo:twice</pre>
  </div>
  <div class="try-qr">
    <div class="try-qr-card">
      <svg class="try-pumpkin" viewBox="0 0 64 48" role="img" aria-label="Pumpkin">
        <path d="M30 10c-2-7 1-10 7-10-1 4-2 7-2 10" fill="#4ac26b"/>
        <path d="M32 10C19 1 7 11 7 26c0 14 10 22 25 22s25-8 25-22C57 11 45 1 32 10Z" fill="#fd5f02"/>
        <path d="M18 17c-3 5-4 13-2 20M46 17c3 5 4 13 2 20" fill="none" stroke="#d74800" stroke-width="2" opacity=".7"/>
        <path d="m19 25 7-5 2 8-9-3Zm26 0-7-5-2 8 9-3ZM20 34c7 9 17 9 24 0l-5 1-3-4-4 4-4-4-3 4-5-1Z" fill="#11163f"/>
      </svg>
      <a href="https://bar9.github.io/yolo-twice/" aria-label="Open the yolo-twice website"><img src="./assets/try-qr.svg" alt="QR code for bar9.github.io/yolo-twice" /></a>
    </div>
    <a class="try-url" href="https://bar9.github.io/yolo-twice/">bar9.github.io/yolo-twice/</a>
  </div>
</div>

<!--
Here is how to try it: install the Claude Code plugin, then use the slash command in a project. The QR code opens the site, which has the installation guide. Leave this slide up for the audience to scan.
-->
