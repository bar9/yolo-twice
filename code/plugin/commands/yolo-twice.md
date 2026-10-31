---
description: Open the yolo-twice insights UI for this project (starts the engine if needed). Use `stop`, `status`, or `mode <micro|attentive|balanced|yolo>`.
argument-hint: "[stop|status|mode <detent>]"
allowed-tools: Bash(*/bin/yolo-twice *)
---

yolo-twice result:

!`"${CLAUDE_PLUGIN_ROOT}"/bin/yolo-twice $ARGUMENTS 2>&1 || true`

Relay the result above to the user in one line. If it contains a URL, show it as the place to open. Do not run anything else.
