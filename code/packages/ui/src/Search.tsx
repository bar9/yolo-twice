import { useEffect, useState } from "react";
import { api, fmtTime, type SearchHit } from "./api";

export function Search(props: { session: string; onPick: (eventId: string) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!q.trim()) return setHits([]);
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        setHits((await api.search(q, props.session)).hits);
      } catch {
        setHits([]);
      } finally {
        setBusy(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q, props.session]);

  return (
    <div className="search">
      <input autoFocus placeholder="search this session…" value={q} onChange={(e) => setQ(e.target.value)} />
      {busy && <span className="spin" />}
      <ul>
        {hits.map((h) => (
          <li key={h.id} onClick={() => props.onPick(h.id)}>
            <span className="kind">{h.kind}</span> {h.tool && <span className="tool">{h.tool}</span>} <span className="time">{fmtTime(h.ts)}</span>
            <div className="snippet">{h.snippet}</div>
          </li>
        ))}
        {!busy && q && hits.length === 0 && <li className="muted">no hits</li>}
      </ul>
    </div>
  );
}
