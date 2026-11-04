import type { SessionIndex, Sharing, Visibility } from "./api";

/** The words for the sharing state, in one place: badges, tooltips, banners and the settings use them. */

export const VISIBILITY_LABEL: Record<Visibility, string> = { shared: "Shared", private: "Private", undecided: "Undecided" };

/** What a state means, in a sentence. */
export const VISIBILITY_MEANS: Record<Visibility, string> = {
  shared: "Committed with the project: everyone who can read the repository can read this session.",
  private: "Stays on this machine: listed in this clone's .git/info/exclude, so neither auto-commit nor git add picks it up.",
  undecided: "Kept out of git until you choose: Share commits it with the project, Keep private keeps it on this machine.",
};

export const ENVIRONMENT_MEANS = {
  restricted: "It holds data that must not be published, such as customer data, internal code or company accounts. Sessions are shared only with restricted remotes.",
  open: "Nothing in it must stay private. Sessions are shared with any remote.",
} as const;

const CLASS_LABEL = { restricted: "Restricted", open: "Public", unknown: "Unknown" } as const;
const BY_LABEL = { pattern: "matches your restricted remotes", gh: "as GitHub reports it", local: "a folder on this machine", none: "GitHub could not tell" } as const;

export function remoteClassLabel(r: Sharing["remotes"][number]): { label: string; why: string } {
  return { label: CLASS_LABEL[r.class], why: BY_LABEL[r.by] };
}

/** Why new sessions start the way they do, as the end of a sentence. */
export function sharingReason(sh: Sharing): string {
  const r = sh.remotes.find((x) => x.name === sh.decidedBy);
  const remote = r ? `${r.name} (${r.id})` : "a remote";
  if (sh.class === "none") return "the repository has no remote yet, so nothing tells where sessions would go";
  if (sh.environment === "open") return "this environment is open: nothing in it must stay private";
  if (sh.class === "restricted") return "every remote is restricted, so sessions stay inside the organisation";
  if (sh.class === "open") return `${remote} is a public repository, and this environment is restricted`;
  return `yolo-twice cannot tell whether ${remote} is internal or public, and this environment is restricted`;
}

/** The short project-level label for the header. */
export function sharingShort(sh: Sharing): string {
  return sh.default === "shared" ? "Sessions shared" : sh.default === "private" ? "Sessions private" : "Sessions: you decide";
}

/** One sentence for the header tooltip. */
export function sharingTip(sh: Sharing): string {
  const env = sh.answered ? `This environment is ${sh.environment}.` : "This environment's kind is not answered yet, so it counts as restricted.";
  return `New sessions start ${sh.default}: ${sharingReason(sh)}. ${env} Click for the details and to change them.`;
}

/** Sessions to ask about, newest first: started private or undecided by default, never decided by the user. */
export function pendingSessions(index: SessionIndex | undefined): SessionIndex["sessions"] {
  if (!index?.sharing) return [];
  return index.sessions.filter((s) => s.visibility && s.visibility !== "shared" && !s.decided).sort((a, b) => b.ts_last.localeCompare(a.ts_last));
}

/** The remote a single click could mark restricted: the unknown one that decided the class. */
export function unknownRemote(sh: Sharing): Sharing["remotes"][number] | undefined {
  return sh.class === "unknown" ? sh.remotes.find((r) => r.name === sh.decidedBy) : undefined;
}

/** A restricted_remotes pattern for one remote: the owner on a shared host, else the whole host. */
export function patternFor(id: string): string {
  const [host, owner] = id.split("/");
  return host && owner && /^(github\.com|gitlab\.com|bitbucket\.org|codeberg\.org)$/.test(host) ? `${host}/${owner}/*` : (host ?? id);
}
