/**
 * What Claude is doing in a session, told by Claude Code's hooks (forwarded to POST /hook):
 * working between a prompt and the end of the turn, waiting while it asks you for something.
 * Without hooks there is no activity, and the UI says nothing rather than guessing.
 */

export type Activity = "working" | "waiting" | "idle";

export interface HookPayload {
  hook_event_name?: string;
  /** Notification: permission_prompt, idle_prompt, elicitation_dialog, auth_success… */
  notification_type?: string;
  /** PreCompact / PostCompact: manual (/compact) or auto (mid-turn). */
  trigger?: string;
}

/** The activity a hook implies, or undefined when it says nothing about it. */
export function activityFrom(hook: HookPayload): Activity | undefined {
  switch (hook.hook_event_name) {
    case "UserPromptSubmit":
    case "PreToolUse":
    case "PostToolUse":
    case "SubagentStart":
    case "SubagentStop":
      return "working";
    case "PreCompact":
      return "working";
    case "PostCompact":
      // a /compact you ran ends idle; an automatic one happens mid-turn and the turn goes on
      return hook.trigger === "manual" ? "idle" : "working";
    case "Notification":
      // "idle_prompt" is the reminder that Claude is done and waiting for your next prompt
      return hook.notification_type === "idle_prompt" || hook.notification_type === "auth_success" ? "idle" : "waiting";
    case "Stop":
    case "SessionStart":
    case "SessionEnd":
      return "idle";
    default:
      return undefined;
  }
}
