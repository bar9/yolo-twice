import { useEffect, useMemo, useRef } from "react";
import { mount, register } from "pele/core";
import flowchart from "pele/diagrams/flowchart";

register(flowchart); // only the flowchart renderer: keeps the bundle small

const safe = (id: string) => id.replace(/[^A-Za-z0-9_]/g, "_");

/**
 * Renders mermaid text with pele and links it to the shared scope. The emitter sanitizes structure
 * ids (`t1.s4` -> `t1_s4`); pele keeps them as `data-id` on each node and cluster, so we map back.
 * Click selects, double click focuses (semantic zoom: the graph is redrawn for that node).
 */
export function Graph(props: {
  mermaid: string;
  /** Every structure id that may appear in the graph. */
  ids: string[];
  selected?: string;
  hover?: string;
  dim: Set<string>;
  hits: Map<string, number>;
  onSelect: (id: string) => void;
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
        if (id) props.onSelect(id);
      }}
      onDoubleClick={(e) => {
        const id = idAt(e);
        if (id) props.onFocus(id);
      }}
      onMouseOver={(e) => props.onHover(idAt(e))}
      onMouseLeave={() => props.onHover(undefined)}
    />
  );
}
