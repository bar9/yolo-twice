import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronUp, FoldVertical, Search, UnfoldVertical, X } from "lucide-react";
import type { FilterCode } from "@yolo-twice/analyzers/search";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { KIND, kindStyle, type Kind } from "./kinds";
import { Tip } from "./Tip";
import { hint } from "./keys";

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
  /** Whether parts without matches are folded away in the text. */
  folded: boolean;
  onFolded: (folded: boolean) => void;
  /** Enter in the search box. */
  onSubmit: () => void;
  /** When nothing matches: search one level wider, e.g. "Search the phase". */
  widen?: { label: string; run: () => void };
  /** Stepping through the matches: which one is shown (1-based), and the step. */
  position?: number;
  onStep?: (dir: 1 | -1) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(props.q);
  // what this box last wrote to the URL: only a different value (back button, a link) may replace
  // the text, otherwise a late echo of what you typed would swallow the keys typed since
  const sent = useRef(props.q);
  useEffect(() => {
    if (props.q !== sent.current) setDraft((sent.current = props.q));
  }, [props.q]);
  const send = (q: string) => props.onQuery((sent.current = q));
  // typing is debounced into the URL so history is not spammed and the views stay calm
  useEffect(() => {
    if (draft === sent.current) return;
    const t = setTimeout(() => send(draft), 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const toggle = (code: FilterCode) => props.onCodes(props.k.includes(code) ? props.k.filter((c) => c !== code) : [...props.k, code]);
  const toolCodes = props.k.filter((c) => c.startsWith("t:"));
  const active = Boolean(props.q) || props.k.length > 0;
  const ToolIcon = KIND.tool.icon;

  return (
    <div className="filterbar" data-tour="filters">
      <div className="search">
        <Search size={15} aria-hidden />
        <input
          ref={input}
          className="query"
          placeholder={`Search ${props.scopeLabel}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              // search now and jump to the first match
              send(draft);
              (e.target as HTMLInputElement).blur();
              props.onSubmit();
              return;
            }
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
            <Tip key={c.code} label={`${c.title} (${CHIPS.indexOf(c) + 1})`}>
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
      <span className="match-nav">
      <span className={`match-count ${active && props.matches === 0 ? "none" : ""}`} aria-live="polite">
        {!active ? "" : props.matches === 0 ? `Nothing matches in ${props.scopeLabel}` : props.position ? `${props.position} of ${props.matches} in ${props.scopeLabel}` : `${props.matches} match${props.matches === 1 ? "" : "es"} in ${props.scopeLabel}`}
      </span>
      {active && props.matches > 0 && props.onStep && (
        <span className="match-step" role="group" aria-label="Step through the matches">
          <Tip label={`Previous match${hint("prev-match")}`}>
            <button onClick={() => props.onStep!(-1)} aria-label="Previous match">
              <ChevronUp aria-hidden />
            </button>
          </Tip>
          <Tip label={`Next match${hint("next-match")}`}>
            <button onClick={() => props.onStep!(1)} aria-label="Next match">
              <ChevronDown aria-hidden />
            </button>
          </Tip>
        </span>
      )}
      </span>
      {active && props.matches === 0 && props.widen && (
        <button className="chip widen" onClick={props.widen.run} title="Widen the scope one level (←)">
          <ArrowLeft aria-hidden />
          {props.widen.label}
        </button>
      )}
      {active && props.matches > 0 && (
        <Tip label={props.folded ? `Show the parts without matches again, in the text and the graph${hint("fold")}.` : `Fold the parts without matches into one line each, in the text and the graph${hint("fold")}.`}>
          <button className="chip fold-toggle" onClick={() => props.onFolded(!props.folded)}>
            {props.folded ? <UnfoldVertical aria-hidden /> : <FoldVertical aria-hidden />}
            {props.folded ? "Show filtered" : "Hide filtered"}
          </button>
        </Tip>
      )}
      {active && (
        <button className="chip" onClick={() => (setDraft(""), send(""), props.onCodes([]))}>
          <X aria-hidden />
          Clear
        </button>
      )}
    </div>
  );
}
