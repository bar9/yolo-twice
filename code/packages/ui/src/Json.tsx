import { useMemo, useState } from "react";
import { Braces, ChevronRight, Code2 } from "lucide-react";
import { linkify } from "./kinds";
import { Code } from "./ToolCall";
import { splitFences } from "./toolview";

/**
 * JSON as a document instead of source: objects as labelled rows, lists of like records as tables,
 * long strings as text blocks, JSON inside strings unpacked. Nothing is left out; every branch can
 * fold, and the source is one click away.
 */
export function JsonView({ value, source, depth = 0 }: { value: unknown; source?: string; depth?: number }) {
  const [raw, setRaw] = useState(false);
  const text = useMemo(() => (raw ? (source ?? JSON.stringify(value, null, 2)) : ""), [raw, source, value]);
  return (
    <div className="json-view">
      <button className="json-toggle" onClick={() => setRaw((r) => !r)} title={raw ? "Show it rendered" : "Show the JSON source"} aria-pressed={raw}>
        {raw ? <Braces size={12} aria-hidden /> : <Code2 size={12} aria-hidden />}
        {raw ? "Rendered" : "JSON"}
      </button>
      {raw ? <Code text={text} lang="json" /> : <Value v={value} depth={depth} />}
    </div>
  );
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isScalar = (v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v);

/** JSON hidden in a string (MCP results often carry it), parsed when it is a whole object or array. */
function innerJson(s: string): unknown {
  const t = s.trim();
  if (t.length < 2 || !/^[[{]/.test(t)) return undefined;
  try {
    const v = JSON.parse(t);
    return typeof v === "object" && v !== null ? v : undefined;
  } catch {
    return undefined;
  }
}

function summary(v: unknown): string {
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? "" : "s"}`;
  if (isObj(v)) {
    const keys = Object.keys(v);
    return keys.length <= 3 ? keys.join(", ") : `${keys.slice(0, 3).join(", ")} +${keys.length - 3}`;
  }
  return "";
}

/** A list of objects sharing their keys, all with scalar values: a table. */
function tableOf(a: unknown[]): string[] | undefined {
  if (a.length < 2 || !a.every(isObj)) return undefined;
  const cols: string[] = [];
  for (const r of a as Record<string, unknown>[]) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  if (cols.length > 8) return undefined;
  if (!(a as Record<string, unknown>[]).every((r) => Object.values(r).every((x) => isScalar(x) && !(typeof x === "string" && (x.length > 160 || x.includes("\n")))))) return undefined;
  return cols;
}

function Scalar({ v }: { v: unknown }) {
  if (v === null) return <span className="json-null">null</span>;
  if (typeof v === "boolean") return <span className={`json-bool ${v ? "yes" : "no"}`}>{String(v)}</span>;
  if (typeof v === "number") return <span className="json-num">{v.toLocaleString()}</span>;
  const s = String(v);
  if (s === "") return <span className="json-null">empty</span>;
  if (/^(\/|~\/|\.\.?\/)[^\s]*$/.test(s) || /^[\w.-]+\.\w{1,5}$/.test(s)) return <code className="json-path">{s}</code>;
  return <span className="json-str">{linkify(s)}</span>;
}

/** A long or multi-line string: prose with its fenced code as code. */
function TextBlock({ s }: { s: string }) {
  const parts = useMemo(() => splitFences(s), [s]);
  return (
    <div className="json-text">
      {parts.map((p, i) => (p.kind === "code" ? <Code key={i} text={p.text} lang={p.lang} /> : <p key={i}>{linkify(p.text.replace(/^\n+|\n+$/g, ""))}</p>))}
    </div>
  );
}

function Value({ v, depth }: { v: unknown; depth: number }) {
  if (typeof v === "string") {
    const inner = innerJson(v);
    if (inner !== undefined) return <Value v={inner} depth={depth} />;
    return v.includes("\n") || v.length > 160 ? <TextBlock s={v} /> : <Scalar v={v} />;
  }
  if (isScalar(v)) return <Scalar v={v} />;
  if (Array.isArray(v)) {
    if (v.length === 0) return <span className="json-null">no items</span>;
    const cols = tableOf(v);
    if (cols)
      return (
        <div className="json-table-wrap">
          <table className="json-table">
            <thead>
              <tr>
                <th>#</th>
                {cols.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(v as Record<string, unknown>[]).map((r, i) => (
                <tr key={i}>
                  <td className="json-idx">{i + 1}</td>
                  {cols.map((c) => (
                    <td key={c}>{c in r ? <Scalar v={r[c]} /> : null}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    if (v.every((x) => isScalar(x) && !(typeof x === "string" && (x.length > 60 || x.includes("\n")))))
      return (
        <ul className="json-chips">
          {v.map((x, i) => (
            <li key={i}>
              <Scalar v={x} />
            </li>
          ))}
        </ul>
      );
    return (
      <div className="json-list">
        {v.map((x, i) => (
          <Row key={i} k={String(i + 1)} v={x} depth={depth + 1} index />
        ))}
      </div>
    );
  }
  if (isObj(v)) {
    const entries = Object.entries(v);
    if (entries.length === 0) return <span className="json-null">empty</span>;
    // content blocks ({type: "text", text}) read as their text
    if (entries.length === 2 && v.type === "text" && typeof v.text === "string") return <Value v={v.text} depth={depth} />;
    return (
      <div className="json-obj">
        {entries.map(([k, x]) => (
          <Row key={k} k={k} v={x} depth={depth + 1} />
        ))}
      </div>
    );
  }
  return <span className="json-str">{String(v)}</span>;
}

/** One key and its value: inline when short, otherwise a foldable block. */
function Row({ k, v, depth, index }: { k: string; v: unknown; depth: number; index?: boolean }) {
  const inner = typeof v === "string" ? innerJson(v) : undefined;
  const nested = inner !== undefined || (!isScalar(v) && !(Array.isArray(v) && v.length === 0) && !(isObj(v) && Object.keys(v).length === 0));
  const longText = typeof v === "string" && inner === undefined && (v.includes("\n") || v.length > 160);
  const [open, setOpen] = useState(depth < 4);
  const Tag = "div";
  if (!nested && !longText)
    return (
      <Tag className="json-row">
        <div className={index ? "json-key json-idx" : "json-key"}>{k}</div>
        <div className="json-val">
          <Value v={v} depth={depth} />
        </div>
      </Tag>
    );
  return (
    <Tag className={`json-row block ${open ? "open" : ""}`}>
      <div className="json-key">
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <ChevronRight size={12} aria-hidden className="json-caret" />
          <span className={index ? "json-idx" : undefined}>{k}</span>
          {!open && <span className="json-sum">{longText ? `${(v as string).length.toLocaleString()} chars` : summary(inner ?? v)}</span>}
        </button>
      </div>
      {open && (
        <div className="json-val">
          <Value v={inner ?? v} depth={depth} />
        </div>
      )}
    </Tag>
  );
}
