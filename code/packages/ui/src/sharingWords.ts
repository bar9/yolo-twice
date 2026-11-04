import type { Sharing, Visibility } from "./api";

/** The words for the sharing state, in one place: badges, tooltips, banners and the settings use them. */

export const VISIBILITY_LABEL: Record<Visibility, string> = { shared: "Shared", private: "Private", "private-additions": "Private additions" };

/** What a state means, in a sentence. */
export const VISIBILITY_MEANS: Record<Visibility, string> = {
  shared: "Committed with the project: everyone who can read the repository can read this session.",
  private: "Stays on this machine, in the gitignored .yolo-twice/private folder: neither auto-commit nor git add picks it up.",
  "private-additions": "Committed earlier and continued on this machine: the committed part is unchanged, what was added here stays here.",
};

/** The badge tooltip for a session made private in 0.1.5. */
export const KEPT_PRIVATE = "Kept private by your choice in an earlier version: it stays on this machine even when the project shares.";

export const ENVIRONMENT_MEANS = {
  restricted: "It holds data that must not be published, such as customer data, internal code or company accounts. Sessions are shared only when every remote is restricted.",
  open: "Nothing in it must stay private. Sessions are shared with any remote.",
} as const;

const CLASS_LABEL = { restricted: "Restricted", open: "Public", unknown: "Unknown" } as const;
const BY_LABEL = { pattern: "matches your restricted remotes", gh: "as GitHub reports it", local: "a folder on this machine", none: "GitHub could not tell" } as const;

export function remoteClassLabel(r: Sharing["remotes"][number]): { label: string; why: string } {
  return { label: CLASS_LABEL[r.class], why: BY_LABEL[r.by] };
}

/** Why sessions are shared or stay here, as the end of a sentence. */
export function sharingReason(sh: Sharing): string {
  const r = sh.remotes.find((x) => x.name === sh.decidedBy);
  const remote = r ? `${r.name} (${r.id})` : "a remote";
  if (sh.environment === "open") return "this environment is open: nothing in it must stay private";
  if (sh.class === "none") return "this environment is restricted and the repository has no remote yet, so nothing says where sessions would go";
  if (sh.class === "restricted") return "every remote is restricted, so sessions stay inside the organisation";
  if (sh.class === "open") return `${remote} is a public repository, and this environment is restricted`;
  return `yolo-twice cannot tell whether ${remote} is internal or public, and this environment is restricted`;
}

/** The short project-level label for the header. */
export function sharingShort(sh: Sharing): string {
  return sh.shares ? "Sessions shared" : "Sessions stay here";
}

/** One sentence for the header tooltip. */
export function sharingTip(sh: Sharing): string {
  const env = sh.answered ? "" : " This environment's kind is not answered yet, so it counts as restricted.";
  const what = sh.shares ? "Sessions are committed with the project" : "What you do here stays on this machine";
  return `${what}: ${sharingReason(sh)}.${env} Click for the details and to change them.`;
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
