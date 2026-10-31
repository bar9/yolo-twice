---
description: Open the yolo-twice insights UI for this project (starts the engine if needed). Use `stop`, `status`, `mode <micro|attentive|balanced|yolo>`, or `resume [session]` to rebuild a committed session for `claude --resume`.
argument-hint: "[stop|status|mode <detent>|resume [session]]"
allowed-tools: Bash(*/bin/yolo-twice *)
---

yolo-twice result:

!`"${CLAUDE_PLUGIN_ROOT}"/bin/yolo-twice $ARGUMENTS 2>&1 || true`

Relay the result above to the user in one line. If it contains a URL, show it as the place to open. If it contains a `claude --resume` command, tell the user to run it in a terminal. Do not run anything else.
