import { useState } from "react";
import type { Author } from "./api";

/** A face from Gravatar; initials on a colour of their own when there is none (or no network). */
export function Avatar({ author, size = 18 }: { author: Author; size?: number }) {
  const [failed, setFailed] = useState(false);
  const initials = author.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  const hue = parseInt(author.email_sha256.slice(0, 4), 16) % 360;
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.45, background: `hsl(${hue} 45% 45%)` }} title={author.name} aria-label={author.name}>
      {failed ? initials : <img src={`https://gravatar.com/avatar/${author.email_sha256}?s=${size * 2}&d=404`} alt="" width={size} height={size} onError={() => setFailed(true)} />}
    </span>
  );
}

/** One or more faces, overlapping a little. */
export function Avatars({ authors, size }: { authors: Author[]; size?: number }) {
  return (
    <span className="avatars">
      {authors.map((a) => (
        <Avatar key={a.email_sha256} author={a} size={size} />
      ))}
    </span>
  );
}

/** "Bob takes over": where the author changes, the same words in the reader and on the map. */
export function Takeover({ authors, size = 14 }: { authors: Author[]; size?: number }) {
  return (
    <span className="takeover">
      <Avatars authors={authors} size={size} />
      <span className="truncate">{authors.map((a) => a.name).join(", ")} takes over</span>
    </span>
  );
}
