import { describe, expect, test } from "bun:test";
import MarkdownIt from "markdown-it";
import { peleMarkdown, renderMermaid } from "../src/index.js";

describe("pele-markdown", () => {
  test("renders a mermaid fence to inline svg", () => {
    const md = new MarkdownIt().use(peleMarkdown);
    const html = md.render("# hi\n\n```mermaid\nflowchart LR\n  A[Start] --> B[End]\n```\n\n```js\nconst x = 1\n```\n");
    expect(html).toContain('<div class="pele" style="--pele-w:199px"><svg');
    expect(html).toContain("Start");
    expect(html).toContain("language-js");
  });
  test("never throws on bad input", () => {
    const out = renderMermaid("this is not a diagram at all {{{");
    expect(out.startsWith("<pre class=\"pele-error\">") || out.includes("<svg")).toBe(true);
  });
});
