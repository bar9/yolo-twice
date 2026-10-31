import { useMemo } from "react";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { ExternalLink, FileText, Scissors } from "lucide-react";
import type { Event } from "./api";
import { richText } from "./kinds";
import { langForPath, parseInput, prettyJson, splitFences, splitGutter, splitHeredocs, type Lang } from "./toolview";

for (const [name, lang] of Object.entries({ bash, css, diff, javascript, json, markdown, python, typescript, xml, yaml })) hljs.registerLanguage(name, lang);

/** Highlighting a huge blob would stall the page; past this it stays plain. */
const MAX_HIGHLIGHT = 60_000;

/** A code block in one language, with an optional line-number gutter and a caption. */
export function Code({ text, lang, start, caption }: { text: string; lang: Lang; start?: number; caption?: string }) {
  const html = useMemo(() => {
    if (lang === "plaintext" || text.length > MAX_HIGHLIGHT) return undefined;
    try {
      return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
    } catch {
      return undefined;
    }
  }, [text, lang]);
  const lines = start !== undefined ? text.split("\n").length : 0;
  return (
    <figure className={`code ${lang === "plaintext" && start === undefined ? "wrap" : ""}`}>
      {caption && <figcaption>{caption}</figcaption>}
      <div className="code-body">
        {start !== undefined && (
          <pre className="gutter" aria-hidden>
            {Array.from({ length: lines }, (_, i) => start + i).join("\n")}
          </pre>
        )}
        {html !== undefined ? <pre className="hljs" dangerouslySetInnerHTML={{ __html: html }} /> : <pre>{text}</pre>}
      </div>
    </figure>
  );
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

/** A recorded tool call, laid out for its tool: shell as shell, files with their path, prompts as prose. */
export function ToolCallView({ event }: { event: Event }) {
  const name = event.tool?.name ?? "";
  const { fields, truncated } = useMemo(() => parseInput(event.text), [event.text]);
  const cut = truncated ? (
    <p className="tool-cut">
      <Scissors size={12} aria-hidden /> The input was cut off at the stored limit; this is its beginning.
    </p>
  ) : null;

  switch (name) {
    case "Bash": {
      const command = str(fields.command) ?? "";
      const facts = [fields.timeout ? `timeout ${Math.round(Number(fields.timeout) / 1000)} s` : "", fields.run_in_background ? "in the background" : ""].filter(Boolean);
      return (
        <div className="tool-call">
          {str(fields.description) && <p className="tool-title">{fields.description as string}</p>}
          {splitHeredocs(command).map((s, i) => (
            <Code key={i} text={s.text} lang={s.lang} caption={s.kind === "heredoc" ? `${s.lang === "plaintext" ? "Here-document" : s.lang[0]!.toUpperCase() + s.lang.slice(1)}${s.target ? `, fed to ${s.target}` : ""}` : undefined} />
          ))}
          {facts.length > 0 && <p className="tool-facts">{facts.join(", ")}</p>}
          {cut}
        </div>
      );
    }
    case "Read":
    case "Write":
    case "Edit":
    case "NotebookEdit": {
      const path = str(fields.file_path) ?? str(fields.notebook_path) ?? "";
      const range = name === "Read" && (fields.offset || fields.limit) ? ` lines ${Number(fields.offset ?? 1)}${fields.limit ? `–${Number(fields.offset ?? 1) + Number(fields.limit) - 1}` : "+"}` : "";
      const lang = langForPath(path);
      return (
        <div className="tool-call">
          <p className="tool-path">
            <FileText size={13} aria-hidden />
            <code>{path}</code>
            {range && <span className="tool-facts">{range}</span>}
          </p>
          {name === "Write" && str(fields.content) !== undefined && <Code text={fields.content as string} lang={lang} />}
          {name === "Edit" && (
            <Code
              lang="diff"
              text={[...(str(fields.old_string) ?? "").split("\n").map((l) => `- ${l}`), ...(str(fields.new_string) ?? "").split("\n").map((l) => `+ ${l}`)].join("\n")}
              caption={fields.replace_all ? "Replace every occurrence" : undefined}
            />
          )}
          {cut}
        </div>
      );
    }
    case "WebFetch":
    case "WebSearch": {
      const url = str(fields.url);
      return (
        <div className="tool-call">
          {url ? (
            <p className="tool-path">
              <ExternalLink size={13} aria-hidden />
              <a href={url} target="_blank" rel="noreferrer">
                {url}
              </a>
            </p>
          ) : (
            <p className="tool-title">“{str(fields.query)}”</p>
          )}
          {str(fields.prompt) && <p className="event-prose">{richText(fields.prompt as string)}</p>}
          {cut}
        </div>
      );
    }
    case "Agent":
    case "Task":
      return (
        <div className="tool-call">
          <p className="tool-title">
            {str(fields.description)}
            {str(fields.subagent_type) && <span className="tool-facts"> ({fields.subagent_type as string})</span>}
          </p>
          {str(fields.prompt) && <p className="event-prose">{richText(fields.prompt as string)}</p>}
          {cut}
        </div>
      );
    case "ExitPlanMode":
      return (
        <div className="tool-call">
          <p className="event-prose">{richText(str(fields.plan) ?? "")}</p>
          {cut}
        </div>
      );
    case "AskUserQuestion": {
      const qs = Array.isArray(fields.questions) ? (fields.questions as { question?: string; options?: { label?: string; description?: string }[] }[]) : [];
      return (
        <div className="tool-call">
          {qs.map((q, i) => (
            <div key={i} className="tool-question">
              <p className="tool-title">{q.question}</p>
              <ul>
                {(q.options ?? []).map((o, j) => (
                  <li key={j}>
                    <strong>{o.label}</strong>
                    {o.description && <span> {o.description}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {cut}
        </div>
      );
    }
    default:
      return <Fields fields={fields} cut={cut} />;
  }
}

/** Any other tool: one row per field; long or structured values as code. */
function Fields({ fields, cut }: { fields: Record<string, unknown>; cut: React.ReactNode }) {
  const entries = Object.entries(fields);
  return (
    <div className="tool-call">
      <dl className="tool-fields">
        {entries.map(([k, v]) => {
          const s = typeof v === "string" ? v : JSON.stringify(v, null, 2);
          const block = typeof v !== "string" ? (s?.length ?? 0) > 60 : s.includes("\n") || s.length > 120;
          return (
            <div key={k} className={block ? "block" : ""}>
              <dt>{k}</dt>
              <dd>{block ? <Code text={s} lang={typeof v === "string" ? (k === "function" || k === "code" ? "javascript" : "plaintext") : "json"} /> : <code>{s}</code>}</dd>
            </div>
          );
        })}
      </dl>
      {cut}
    </div>
  );
}

/** A tool result, shaped by what it is: file contents with their gutter, JSON pretty, markdown with fenced code. */
export function ToolResultView({ event, call }: { event: Event; call?: Event }) {
  const text = event.text || "";
  const parts = useMemo((): { kind: "text" | "code"; text: string; lang: Lang; start?: number }[] => {
    const name = call?.tool?.name;
    if (name === "Read") {
      const g = splitGutter(text);
      if (g) return [{ kind: "code" as const, text: g.code, lang: langForPath(str(parseInput(call!.text).fields.file_path)), start: g.start }];
    }
    const pretty = prettyJson(text);
    if (pretty) return [{ kind: "code" as const, text: pretty, lang: "json" as Lang, start: undefined }];
    if (text.includes("```")) return splitFences(text).map((p) => ({ ...p, start: undefined }));
    return [{ kind: "code" as const, text, lang: "plaintext" as Lang, start: undefined }];
  }, [text, call]);
  return (
    <div className={`tool-result ${event.data?.is_error ? "error" : ""}`}>
      {parts.map((p, i) => (p.kind === "code" ? <Code key={i} text={p.text} lang={p.lang} start={p.start} /> : <p key={i} className="tool-text">{p.text.trim()}</p>))}
    </div>
  );
}
