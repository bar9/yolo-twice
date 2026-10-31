import { useCallback, useEffect, useState } from "react";

/**
 * Light, dark or whatever the system says. A per-viewer preference, so it lives in this browser
 * (never in .yolo-twice). The resolved theme is written to <html data-theme>, which the CSS tokens
 * and the shadcn `dark:` variant read; index.html applies it before the first paint.
 */
export type ThemeChoice = "system" | "light" | "dark";

const KEY = "yt.theme";
const query = "(prefers-color-scheme: dark)";

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function apply(choice: ThemeChoice) {
  const dark = choice === "dark" || (choice === "system" && matchMedia(query).matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function useTheme(): [ThemeChoice, (c: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(read);
  useEffect(() => {
    apply(choice);
    if (choice !== "system") return;
    const m = matchMedia(query);
    const on = () => apply("system");
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [choice]);
  const set = useCallback((c: ThemeChoice) => {
    try {
      if (c === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, c);
    } catch {
      /* not remembered, still applied */
    }
    setChoice(c);
  }, []);
  return [choice, set];
}
