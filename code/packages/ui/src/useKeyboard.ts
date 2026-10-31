import { useEffect, useRef } from "react";
import { bindingFor, keyName, type KeyActions } from "./keys";

/** Whether a keystroke belongs to something else: a text field, an open menu or dialog, or a focused button's own Enter and Space. */
function busy(e: KeyboardEvent, name: string): boolean {
  const t = e.target as HTMLElement | null;
  if (t && (/^(input|textarea|select)$/i.test(t.tagName) || t.isContentEditable)) return true;
  if (document.querySelector("[role=dialog], [role=menu], [role=listbox]")) return true;
  if ((name === "Enter" || name === "Space") && t?.closest("button, a, [role=button], [role=radio], [role=tab]")) return true;
  return false;
}

/** One listener for the whole page, dispatching through the keymap table (keys.ts). */
export function useKeyboard(actions: KeyActions): void {
  const ref = useRef(actions);
  ref.current = actions;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const name = keyName(e);
      const b = bindingFor(name);
      if (!b || busy(e, name!)) return;
      e.preventDefault();
      b.run(ref.current, name!);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
}
