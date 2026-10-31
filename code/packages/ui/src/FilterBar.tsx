import { useEffect, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import type { FilterCode } from "@yolo-twice/analyzers/search";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { KIND, kindStyle, type Kind } from "./kinds";
import { Tip } from "./Tip";

/** Chip codes in display order. Codes are OR'd; tool chips live in the tools menu. */
export const CHIPS: { code: FilterCode; kind: Kind; label: string; title: string }[] = [
  { code: "u", kind: "you", label: "You", title: "Your prompts (subagent briefs excluded)" },
  { code: "a", kind: "text", label: "Claude", title: "What Claude wrote" },
  { code: "h", kind: "think", label: "Thinking", title: "Thinking blocks" },
  { code: "t", kind: "tool", label: "Tools", title: "Every tool call and result" },
  { code: "e", kind: "error", label: "Errors", title: "Tool calls that failed" },
  { code: "s", kind: "agent", label: "Subagents", title: "Everything subagents did" },
  { code: "c", kind: "compaction", label: "Compactions", title: "Compactions and slash commands" },
  { code: "r", kind: "rewind", label: "Rewinds", title: "Turns on a rewound branch" },
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
  const ToolIcon = KIND.tool.icon;

  return (
    <div className="filterbar">
      <div className="search">
        <Search size={15} aria-hidden />
        <input
          ref={input}
          className="query"
          placeholder={`Search ${props.scopeLabel}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              if (draft) setDraft("");
              (e.target as HTMLInputElement).blur();
              e.stopPropagation();
            }
          }}
          aria-label="Search"
        />
        {!draft && <Kbd>/</Kbd>}
      </div>
      <div className="chips" role="group" aria-label="Filters">
        {CHIPS.map((c) => {
          const Icon = KIND[c.kind].icon;
          const on = props.k.includes(c.code);
          return (
            <Tip key={c.code} label={c.title}>
              <button className={`chip ${on ? "on" : ""}`} style={kindStyle(c.kind)} onClick={() => toggle(c.code)} aria-pressed={on}>
                <Icon aria-hidden />
                {c.label}
              </button>
            </Tip>
          );
        })}
        {props.tools.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className={`chip ${toolCodes.length ? "on" : ""}`} style={kindStyle("tool")}>
                <ToolIcon aria-hidden />
                {toolCodes.length ? toolCodes.map((c) => c.slice(2)).join(", ") : "Tool"}
                <ChevronDown aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-80 min-w-48">
              <DropdownMenuLabel>Only these tools</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {props.tools.map((t) => {
                const code = `t:${t}` as FilterCode;
                return (
                  <DropdownMenuCheckboxItem key={t} checked={props.k.includes(code)} onCheckedChange={() => toggle(code)} onSelect={(e) => e.preventDefault()} className="font-mono text-[13px]">
                    {t}
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <span className={`match-count ${active && props.matches === 0 ? "none" : ""}`} aria-live="polite">
        {!active ? "" : props.matches === 0 ? `Nothing matches in ${props.scopeLabel}` : `${props.matches} match${props.matches === 1 ? "" : "es"} in ${props.scopeLabel}`}
      </span>
      {active && (
        <button className="chip" onClick={() => (setDraft(""), props.onQuery(""), props.onCodes([]))}>
          <X aria-hidden />
          Clear
        </button>
      )}
    </div>
  );
}
