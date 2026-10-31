import { describe, expect, test } from "bun:test";
import { activityFrom } from "../src/activity";

describe("activity from hooks", () => {
  test("a turn runs from the prompt to Stop", () => {
    expect(activityFrom({ hook_event_name: "UserPromptSubmit" })).toBe("working");
    expect(activityFrom({ hook_event_name: "PostToolUse" })).toBe("working");
    expect(activityFrom({ hook_event_name: "SubagentStop" })).toBe("working");
    expect(activityFrom({ hook_event_name: "Stop" })).toBe("idle");
    expect(activityFrom({ hook_event_name: "SessionEnd" })).toBe("idle");
  });

  test("a permission prompt waits for you; the idle reminder means done", () => {
    expect(activityFrom({ hook_event_name: "Notification", notification_type: "permission_prompt" })).toBe("waiting");
    expect(activityFrom({ hook_event_name: "Notification", notification_type: "elicitation_dialog" })).toBe("waiting");
    expect(activityFrom({ hook_event_name: "Notification", notification_type: "idle_prompt" })).toBe("idle");
  });

  test("a manual /compact ends idle, an automatic one is part of the turn", () => {
    expect(activityFrom({ hook_event_name: "PostCompact", trigger: "manual" })).toBe("idle");
    expect(activityFrom({ hook_event_name: "PostCompact", trigger: "auto" })).toBe("working");
    expect(activityFrom({ hook_event_name: "SomethingNew" })).toBeUndefined();
  });
});
