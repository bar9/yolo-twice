import { useEffect, useMemo, useRef } from "react";
import { mount, register } from "pele/core";
import flowchart from "pele/diagrams/flowchart";

register(flowchart); // only the flowchart renderer: keeps the bundle small
import { walk, type StructureNode } from "./api";

/**
 * Renders the engine's mermaid text with pele. The emitter sanitizes structure ids
 * (`t1.s4` -> `t1_s4`); pele keeps them as `data-id` on each node group, so we map back.
 */
export function Graph(props: { mermaid: string; root?: StructureNode; selected?: string; onSelect: (id: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const idMap = useMemo(() => {
    const m = new Map<string, string>();
    if (props.root) for (const n of walk(props.root)) m.set(n.id.replace(/[^A-Za-z0-9_]/g, "_"), n.id);
    return m;
  }, [props.root]);

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

  // highlight the selected node
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    for (const g of el.querySelectorAll<SVGGElement>(".pele-node, .pele-cluster")) {
      const id = idMap.get(g.dataset.id ?? "");
      g.classList.toggle("is-selected", id !== undefined && id === props.selected);
      g.style.cursor = id ? "pointer" : "";
    }
  }, [props.selected, idMap, props.mermaid]);

  const onClick = (e: React.MouseEvent) => {
    const g = (e.target as Element).closest<SVGGElement>(".pele-node, .pele-cluster");
    if (!g) return;
    const id = idMap.get(g.dataset.id ?? "");
    if (id) return props.onSelect(id);
    // fallback: match the label text against structure labels
    const label = g.querySelector(".pele-label, .pele-cluster-label")?.textContent?.trim();
    if (label && props.root) for (const n of walk(props.root)) if (n.label.startsWith(label.replace(/…$/, ""))) return props.onSelect(n.id);
  };

  return <div className="graph pele" ref={host} onClick={onClick} />;
}
