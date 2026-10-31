import { render } from "pele";
import type MarkdownIt from "markdown-it";
import type { RenderRule } from "markdown-it/lib/renderer.mjs";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Render mermaid text to an SVG wrapped in <div class="pele">. Never throws: errors become a <pre class="pele-error">. */
export function renderMermaid(text: string): string {
  try {
    const { svg } = render(text);
    // Pass the natural width on, so CSS can keep wide diagrams readable (scroll instead of shrink).
    const width = /^<svg[^>]*\swidth="([\d.]+)"/.exec(svg)?.[1];
    const style = width ? ` style="--pele-w:${width}px"` : "";
    return `<div class="pele"${style}>${svg}</div>`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `<pre class="pele-error">mermaid render error: ${escapeHtml(msg)}\n\n${escapeHtml(text)}</pre>`;
  }
}

/** markdown-it plugin: ```mermaid fences become build-time pele SVG. Other fences are untouched. */
export function peleMarkdown(md: MarkdownIt): void {
  const fence = md.renderer.rules.fence;
  const rule: RenderRule = (tokens, idx, options, env, self) => {
    const token = tokens[idx]!;
    const lang = token.info.trim().split(/\s+/)[0] ?? "";
    if (lang === "mermaid") return renderMermaid(token.content);
    return fence ? fence(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
  };
  md.renderer.rules.fence = rule;
}

export default peleMarkdown;
