import { FileText, SquareSlash, TextSelect } from "lucide-react";
import { promptSegments } from "./harness";
import { richText } from "./kinds";

const base = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** A prompt with the harness's tags shown as what they are: a paste, the open file, a selection, a command. */
export function PromptText({ text, query }: { text: string; query?: string }) {
  return (
    <div className="event-prose prompt-text">
      {promptSegments(text).map((s, i) => {
        switch (s.kind) {
          case "text":
            return <p key={i}>{richText(s.text, query)}</p>;
          case "pasted":
            return (
              <blockquote key={i} className="seg-pasted">
                <span className="seg-label">Pasted</span>
                {richText(s.text, query)}
              </blockquote>
            );
          case "opened":
            return (
              <span key={i} className="seg-chip" title={s.file}>
                <FileText aria-hidden /> Opened {base(s.file)}
              </span>
            );
          case "selection":
            return (
              <div key={i} className="seg-selection">
                <span className="seg-chip" title={s.file}>
                  <TextSelect aria-hidden /> {s.file ? `Selected lines ${s.from}–${s.to} of ${base(s.file)}` : "Selection"}
                </span>
                <pre className="seg-code">{s.text}</pre>
              </div>
            );
          case "reminder":
            return (
              <details key={i} className="seg-reminder">
                <summary>System reminder</summary>
                <pre className="seg-code">{s.text}</pre>
              </details>
            );
          case "command":
            return (
              <span key={i} className="seg-chip seg-command">
                <SquareSlash aria-hidden />
                <code>{`${s.name} ${s.args}`.trim()}</code>
              </span>
            );
          case "shell":
            return (
              <pre key={i} className="seg-code">
                <span className="seg-prompt">$ </span>
                {s.text}
              </pre>
            );
          case "output":
            return (
              <pre key={i} className={`seg-code seg-output ${s.error ? "error" : ""}`}>
                {s.text}
              </pre>
            );
        }
      })}
    </div>
  );
}
