/**
 * Moving the selection through an ordered list of part ids (what the active view shows, top to
 * bottom). Pure, so the order rules are testable; the order itself comes from the view.
 */

/** The next or previous id; stops at the ends. A selection that is not in the list moves from its closest listed ancestor. */
export function stepIn(order: string[], current: string | undefined, dir: 1 | -1): string | undefined {
  if (!order.length) return undefined;
  if (!current) return dir > 0 ? order[0] : order.at(-1);
  let i = order.indexOf(current);
  if (i < 0) {
    let len = -1;
    order.forEach((id, j) => {
      if (current.startsWith(`${id}.`) && id.length > len) {
        i = j;
        len = id.length;
      }
    });
    // hidden inside a listed part: going up lands on that part, going down passes it
    if (i >= 0 && dir < 0) return order[i];
    if (i < 0) return dir > 0 ? order[0] : order.at(-1);
  }
  const j = i + dir;
  return j < 0 || j >= order.length ? order[i] : order[j];
}

/** The parts that own the matching events, in event order, each once. */
export function matchOrder(eventIds: string[], owner: Map<string, string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of eventIds) {
    const n = owner.get(e);
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}
