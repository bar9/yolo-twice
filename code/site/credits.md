# Standing on shoulders

yolo-twice did not invent transcript viewing. These projects came first, and we learned from
each of them. If one of them fits your need better, use it.

| Project | What it does well | Where yolo-twice differs |
|---|---|---|
| [Claudescope](https://github.com/vladar107/claudescope) by vladar107 | Browses eight agents, full-text search, cost analytics, MCP server and plugin | Abstraction levels, flow graph, committed project history |
| [claude-code-history-viewer](https://github.com/jhlee0409/claude-code-history-viewer) by jhlee0409 | Desktop app for over thirty agents, live updates, session board | One running session, deeply zoomable, instead of breadth |
| [cc_transcript_viewer](https://github.com/tim-hua-01/cc_transcript_viewer) by tim-hua-01 | Zero dependencies, live tail, five agents | We borrowed the live-tail idea and add semantics on top |
| [claude-code-transcripts](https://github.com/simonw/claude-code-transcripts) by simonw | Publishing paginated HTML transcripts, Gist upload | Live navigation rather than publishing |
| [ccusage](https://github.com/ryoppippi/ccusage) by ryoppippi | Token and cost reporting across agents | Cost shown per phase in context; use ccusage for accounting |
| [pele](https://github.com/obsidianmd/pele) by the Obsidian team | Fast, themeable mermaid rendering | We use it as-is for every diagram, with thanks |

Mermaid is the only diagram format we use, on GitHub, on this website, in the pitch deck and
in the UI, so the same text renders everywhere.
