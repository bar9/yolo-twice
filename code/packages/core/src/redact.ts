import { sha256 } from "./json.js";

export interface RedactRule {
  name: string;
  re: RegExp;
  replace?: string;
}

/** Built-in rules. Order matters: specific tokens before generic key=value. */
export const BUILTIN_RULES: RedactRule[] = [
  { name: "private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: "anthropic-key", re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: "openai-key", re: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { name: "github-token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g },
  { name: "github-pat", re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { name: "aws-access-key", re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { name: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: "bearer", re: /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, replace: "$1[redacted:bearer]" },
  {
    name: "secret-assignment",
    re: /\b((?:api[_-]?key|secret|token|password|passwd|pwd)[A-Za-z0-9_]*\s*[:=]\s*["']?)([^\s"',;]{8,})/gi,
    replace: "$1[redacted:secret-assignment]",
  },
  { name: "url-credentials", re: /(\w+:\/\/)([^\s/:@]+):([^\s/@]+)@/g, replace: "$1[redacted:url-credentials]@" },
];

export function compileExtraRules(rules: { name: string; pattern: string; flags?: string }[]): RedactRule[] {
  // always global: without "g", String.replace redacts only the first match
  return rules.map((r) => {
    const flags = r.flags ?? "";
    return { name: r.name, re: new RegExp(r.pattern, flags.includes("g") ? flags : flags + "g") };
  });
}

export interface RedactResult {
  text: string;
  count: number;
  rules: string[];
}

export function redact(text: string, rules: RedactRule[] = BUILTIN_RULES): RedactResult {
  let out = text;
  let count = 0;
  const hit: string[] = [];
  for (const rule of rules) {
    rule.re.lastIndex = 0;
    const before = out;
    out = out.replace(rule.re, (...m) => {
      count++;
      if (rule.replace) {
        // expand $1.. manually
        return rule.replace.replace(/\$(\d)/g, (_, i) => String(m[Number(i)] ?? ""));
      }
      return `[redacted:${rule.name}]`;
    });
    if (before !== out) hit.push(rule.name);
  }
  return { text: out, count, rules: hit };
}

/** Keep head and tail of very long texts; the middle is replaced by a marker with length and hash. */
export function truncate(text: string, max: number, head = Math.floor(max * 0.75)): string {
  if (text.length <= max) return text;
  const tail = max - head;
  const middle = text.slice(head, text.length - tail);
  return `${text.slice(0, head)}\n[... truncated ${middle.length} chars, sha256 ${sha256(middle).slice(0, 16)} ...]\n${text.slice(text.length - tail)}`;
}
