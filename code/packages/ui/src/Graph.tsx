import { useEffect, useMemo, useRef } from "react";
import { mount, register } from "pele/core";
import flowchart from "pele/diagrams/flowchart";

register(flowchart); // only the flowchart renderer: keeps the bundle small

const safe = (id: string) => id.replace(/[^A-Za-z0-9_]/g, "_");

/**
 * Renders mermaid text with pele and links it to the shared scope. The emitter sanitizes structure
 * ids (`t1.s4` -> `t1_s4`); pele keeps them as `data-id` on each node and cluster, so we map back.
 * A click zooms in (semantic zoom: the graph is redrawn for that node); hover links the other views.
 */
export function Graph(props: {
  mermaid: string;
  /** Every structure id that may appear in the graph. */
  ids: string[];
  selected?: string;
  /** Follow mode: keep the selected (newest) node in view, like the reader does. */
  follow?: boolean;
  hover?: string;
  dim: Set<string>;
  hits: Map<string, number>;
  onFocus: (id: string) => void;
  onHover: (id: string | undefined) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const idMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const id of props.ids) {
      m.set(safe(id), id);
      m.set(`${safe(id)}_box`, id); // subagent clusters
    }
    return m;
  }, [props.ids]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    if (!props.mermaid) {
      el.innerHTML = "";
      return;
    }
    try {
      mount(el, props.mermaid);
    } catch (e) {
      el.innerHTML = `<pre class="muted">graph render failed: ${String(e)}</pre>`;
    }
  }, [props.mermaid]);

  // project the scope onto the rendered SVG
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    for (const g of el.querySelectorAll<SVGGElement>(".pele-node, .pele-cluster")) {
      const id = idMap.get(g.dataset.id ?? "");
      // the node holding the selection is marked too when the selection itself is not drawn (ids nest: t5 > t5.s2)
      g.classList.toggle("is-selected", id !== undefined && !!props.selected && (id === props.selected || props.selected.startsWith(`${id}.`)));
      g.classList.toggle("is-hover", id !== undefined && id === props.hover);
      g.classList.toggle("is-dim", id !== undefined && props.dim.has(id));
      const n = id ? props.hits.get(id) : undefined;
      g.classList.toggle("has-hit", Boolean(n));
      g.style.cursor = id ? "pointer" : "";
      let title = g.querySelector(":scope > title");
      if (n) {
        if (!title) {
          title = document.createElementNS("http://www.w3.org/2000/svg", "title");
          g.prepend(title);
        }
        title.textContent = `${n} match${n === 1 ? "" : "es"}`;
      } else title?.remove();
    }
  }, [props.selected, props.hover, props.dim, props.hits, idMap, props.mermaid]);

  // follow: after every re-render or new selection, bring the newest node into view.
  // Prefer the exact node; otherwise the drawn node that contains it (t5 for t5.s2).
  useEffect(() => {
    const el = host.current;
    if (!el || !props.follow || !props.selected) return;
    const sel = props.selected;
    let target: Element | undefined;
    let best = -1;
    for (const g of el.querySelectorAll<SVGGElement>(".pele-node, .pele-cluster")) {
      const id = idMap.get(g.dataset.id ?? "");
      if (!id || !(id === sel || sel.startsWith(`${id}.`))) continue;
      if (id.length > best) {
        best = id.length;
        target = g;
      }
    }
    // after pele has laid out the SVG
    const t = setTimeout(() => target?.scrollIntoView({ block: "center", inline: "center", behavior: "auto" }), 30);
    return () => clearTimeout(t);
  }, [props.follow, props.selected, props.mermaid, idMap]);

  const idAt = (e: React.MouseEvent) => {
    const g = (e.target as Element).closest<SVGGElement>(".pele-node, .pele-cluster");
    return g ? idMap.get(g.dataset.id ?? "") : undefined;
  };

  return (
    <div
      className="graph pele"
      ref={host}
      onClick={(e) => {
        const id = idAt(e);
        if (id) props.onFocus(id);
      }}
      onMouseOver={(e) => props.onHover(idAt(e))}
      onMouseLeave={() => props.onHover(undefined)}
    />
  );
}
