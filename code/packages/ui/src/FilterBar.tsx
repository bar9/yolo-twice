import { useEffect, useRef, useState } from "react";
import type { FilterCode } from "@yolo-twice/analyzers/search";

/** Chip codes in display order. Codes are OR'd; tool chips live in the tools menu. */
export const CHIPS: { code: FilterCode; label: string; title: string }[] = [
  { code: "u", label: "user", title: "your prompts (subagent briefs excluded)" },
  { code: "a", label: "assistant", title: "assistant text" },
  { code: "h", label: "thinking", title: "thinking blocks" },
  { code: "t", label: "tools", title: "every tool call and result" },
  { code: "e", label: "errors", title: "tool calls that failed" },
  { code: "s", label: "subagents", title: "everything subagents did" },
  { code: "c", label: "compactions", title: "compactions and slash commands" },
  { code: "r", label: "rewinds", title: "turns on a rewound branch" },
];

/**
 * Query and filters. They never narrow the view: matches are highlighted in every view and the
 * rest is dimmed. An empty query with a filter lists every match, e.g. all your prompts.
 */
export function FilterBar(props: {
  q: string;
  k: FilterCode[];
  tools: string[];
  matches: number;
  scopeLabel: string;
  onQuery: (q: string) => void;
  onCodes: (k: FilterCode[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(props.q);
  useEffect(() => setDraft(props.q), [props.q]);
  // typing is debounced into the URL so history is not spammed and the views stay calm
  useEffect(() => {
    if (draft === props.q) return;
    const t = setTimeout(() => props.onQuery(draft), 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  // "/" focuses the query box from anywhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !/input|textarea|select/i.test(t.tagName)) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  const toggle = (code: FilterCode) => props.onCodes(props.k.includes(code) ? props.k.filter((c) => c !== code) : [...props.k, code]);
  const toolCodes = props.k.filter((c) => c.startsWith("t:"));
  const active = Boolean(props.q) || props.k.length > 0;

  return (
    <div className="filterbar">
      <input
        ref={input}
        className="query"
        placeholder={`search ${props.scopeLabel}…  (press /)`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            if (draft) setDraft("");
            (e.target as HTMLInputElement).blur();
            e.stopPropagation();
          }
        }}
        aria-label="search"
      />
      <div className="chips" role="group" aria-label="filters">
        {CHIPS.map((c) => (
          <button key={c.code} className={`chip ${props.k.includes(c.code) ? "on" : ""}`} title={c.title} onClick={() => toggle(c.code)} aria-pressed={props.k.includes(c.code)}>
            {c.label}
          </button>
        ))}
        {props.tools.length > 0 && (
          <details className="tools-menu">
            <summary className={`chip ${toolCodes.length ? "on" : ""}`}>{toolCodes.length ? toolCodes.map((c) => c.slice(2)).join(", ") : "tool ▾"}</summary>
            <div className="menu">
              {props.tools.map((t) => {
                const code = `t:${t}` as FilterCode;
                return (
                  <label key={t}>
                    <input type="checkbox" checked={props.k.includes(code)} onChange={() => toggle(code)} /> {t}
                  </label>
                );
              })}
            </div>
          </details>
        )}
      </div>
      <span className="match-count" aria-live="polite">
        {active ? `${props.matches} match${props.matches === 1 ? "" : "es"} in ${props.scopeLabel}` : ""}
      </span>
      {active && (
        <button className="clear" onClick={() => (setDraft(""), props.onQuery(""), props.onCodes([]))} title="clear query and filters">
          clear
        </button>
      )}
    </div>
  );
}
