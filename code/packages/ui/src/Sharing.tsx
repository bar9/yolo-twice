import { useEffect, useState } from "react";
import { GitCommitHorizontal, Plus, ShieldQuestionMark, TriangleAlert, VenetianMask, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api, type Environment, type EnvironmentInfo, type SessionIndex, type Sharing, type Visibility } from "./api";
import { ENVIRONMENT_MEANS, KEPT_PRIVATE, patternFor, remoteClassLabel, sharingReason, sharingShort, sharingTip, unknownRemote, VISIBILITY_LABEL, VISIBILITY_MEANS } from "./sharingWords";
import { Tip } from "./Tip";

/**
 * Private sessions, like private browsing: content from a restricted environment never reaches a
 * repository it should not. One rule per project decides (packages/engine/src/sharing.ts); these
 * controls show it, and the header popover holds the two facts behind it. Wording: sharingWords.ts.
 */

/** In the session list and the crumb: nothing for shared (the normal case stays clean), a mask otherwise. */
export function VisibilityBadge({ visibility, kept }: { visibility?: Visibility; kept?: boolean }) {
  if (!visibility || visibility === "shared") return null;
  return (
    <Tip label={kept ? KEPT_PRIVATE : VISIBILITY_MEANS[visibility]}>
      <span className="badge private ml-2" onClick={(e) => e.stopPropagation()}>
        <VenetianMask aria-hidden />
        {VISIBILITY_LABEL[visibility]}
      </span>
    </Tip>
  );
}

/** Header, project level: where sessions go by default, and the environment settings behind it. */
export function SharingButton({ sharing, onChanged }: { sharing?: Sharing; onChanged: () => void }) {
  const [env, setEnv] = useState<EnvironmentInfo | undefined>();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | undefined>();
  useEffect(() => {
    if (open) api.environment().then(setEnv).catch((e) => setError(String(e)));
  }, [open, sharing]);
  if (!sharing) return null;
  const Icon = sharing.shares ? GitCommitHorizontal : VenetianMask;
  const save = async (patch: { environment?: Environment; restricted_remotes?: string[] }) => {
    try {
      setEnv(await api.setEnvironment(patch));
      setError(undefined);
      onChanged();
    } catch (e) {
      setError(String(e));
    }
  };
  const patterns = env?.restricted_remotes ?? [];
  const offer = (env?.candidates ?? []).filter((c) => !patterns.includes(c));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tip label={sharingTip(sharing)}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className={`sharing ${sharing.shares ? "shared" : "private"}`} aria-label={sharingShort(sharing)}>
            <Icon />
            <span className="hidden lg:inline">{sharingShort(sharing)}</span>
            {!sharing.answered && <span className="size-1.5 rounded-full bg-ink-3" aria-hidden />}
          </Button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent align="end" className="w-96 space-y-3 text-[12.5px] leading-snug">
        <div>
          <span className="block text-[13px] font-semibold">Sharing sessions</span>
          <p className="mt-1 text-ink-2">
            A restricted environment shares sessions only when every remote is restricted. Here {sharing.shares ? <b>sessions are committed with the project</b> : <b>what you do stays on this machine</b>}: {sharingReason(sharing)}.
            {!sharing.shares && " Sessions committed earlier stay as they are; what you add to them stays here too."}
            {!!sharing.private && ` ${sharing.private} session${sharing.private === 1 ? " has" : "s have"} content in the gitignored .yolo-twice/private folder.`}
          </p>
        </div>

        <div className="space-y-2 border-t pt-3">
          <span className="block text-[13px] font-semibold">This environment</span>
          <div className="seg fill" role="radiogroup" aria-label="This environment">
            {(["restricted", "open"] as const).map((e) => (
              <button key={e} className={sharing.answered && sharing.environment === e ? "on" : ""} role="radio" aria-checked={sharing.answered && sharing.environment === e} onClick={() => void save({ environment: e })}>
                {e === "restricted" ? "Restricted" : "Open"}
              </button>
            ))}
          </div>
          <p className="text-ink-2">{ENVIRONMENT_MEANS[sharing.environment]}</p>
          {!sharing.answered && env && (
            <p className="text-ink-2">
              Not answered yet, so it counts as restricted. Likely <b>{env.guess}</b>
              {env.signals.length ? `: ${env.signals.join("; ")}.` : ": no sign of an organisation's machine was found."}
            </p>
          )}
          <p className="text-ink-3">Applies to every project on this machine, VM or container. Stored in ~/.yolo-twice/settings.json, never committed.</p>
        </div>

        <div className="space-y-1.5 border-t pt-3">
          <span className="block text-[13px] font-semibold">Remotes of this repository</span>
          {sharing.remotes.length === 0 && <p className="text-ink-2">None yet. {sharing.environment === "restricted" ? "Sessions stay on this machine until a restricted remote is added" : "Sessions are committed; nothing is pushed anywhere"}; yolo-twice notices when a remote is added.</p>}
          {sharing.remotes.map((r) => {
            const c = remoteClassLabel(r);
            return (
              <div key={r.name} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate" title={r.url}>
                  <b>{r.name}</b> <span className="text-ink-2">{r.id}</span>
                </span>
                <Tip label={c.why}>
                  <span className={`badge remote-${r.class}`}>{c.label}</span>
                </Tip>
                {r.class === "unknown" && (
                  <Tip label={`Count ${patternFor(r.id)} as restricted: an internal repository of your organisation`}>
                    <Button variant="ghost" size="xs" onClick={() => void save({ restricted_remotes: [...patterns, patternFor(r.id)] })}>
                      <Plus /> Restricted
                    </Button>
                  </Tip>
                )}
              </div>
            );
          })}
        </div>

        <div className="space-y-1.5 border-t pt-3">
          <span className="block text-[13px] font-semibold">Restricted remotes</span>
          <p className="text-ink-2">Repositories that count as internal on this machine: a host such as git.acme.example, or an owner such as github.com/acme/*.</p>
          <div className="flex flex-wrap gap-1.5">
            {patterns.map((p) => (
              <span key={p} className="badge remote-restricted">
                {p}
                <button aria-label={`Remove ${p}`} onClick={() => void save({ restricted_remotes: patterns.filter((x) => x !== p) })}>
                  <X aria-hidden />
                </button>
              </span>
            ))}
            {offer.map((p) => (
              <Tip key={p} label={`From this repository's remotes: count ${p} as restricted`}>
                <button className="badge suggest" onClick={() => void save({ restricted_remotes: [...patterns, p] })}>
                  <Plus aria-hidden />
                  {p}
                </button>
              </Tip>
            ))}
          </div>
          <form
            className="flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) void save({ restricted_remotes: [...patterns, draft.trim()] }).then(() => setDraft(""));
            }}
          >
            <input className="input min-w-0 flex-1" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="git.acme.example or github.com/acme/*" aria-label="Add a restricted remote" />
            <Button type="submit" variant="outline" size="xs" disabled={!draft.trim()}>
              Add
            </Button>
          </form>
        </div>

        {!!sharing.unpushed && (
          <p className="flex gap-2 border-t pt-3 text-destructive">
            <TriangleAlert className="size-4 flex-none" aria-hidden />
            {sharing.unpushed} committed session{sharing.unpushed === 1 ? " is" : "s are"} not pushed yet. Pushing publishes {sharing.unpushed === 1 ? "it" : "them"}; yolo-twice never pushes. Take {sharing.unpushed === 1 ? "it" : "them"} out of those commits before you push if that is not intended.
          </p>
        )}
        {error && <p className="text-destructive">{error}</p>}
      </PopoverContent>
    </Popover>
  );
}

const MIGRATED_SEEN = "yolo-twice.sharing-migrated-seen";

function seenMigration(): boolean {
  try {
    return localStorage.getItem(MIGRATED_SEEN) === "1";
  } catch {
    return false;
  }
}

/**
 * Below the header, only when something needs you: the environment question (once per machine),
 * the note after the upgrade from per-session decisions (once), a stricter state after a remote
 * change (once), or a remote yolo-twice cannot classify (one click marks it internal).
 */
export function SharingBanner(props: { index?: SessionIndex; alert?: Sharing; onDismissAlert: () => void; onChanged: () => void }) {
  const sh = props.index?.sharing;
  const [later, setLater] = useState(false);
  const [migrationSeen, setMigrationSeen] = useState(seenMigration);
  const [unknownLater, setUnknownLater] = useState(false);
  const [env, setEnv] = useState<EnvironmentInfo | undefined>();
  useEffect(() => {
    if (sh) api.environment().then(setEnv).catch(() => undefined);
  }, [sh]);
  if (!sh) return null;
  const answer = async (patch: { environment?: Environment; restricted_remotes?: string[] }) => {
    await api.setEnvironment(patch).catch(() => undefined);
    props.onChanged();
  };
  if (!sh.answered && !later)
    return (
      <div className="banner ask" role="status">
        <ShieldQuestionMark size={15} aria-hidden />
        <span className="flex-1">
          <b>Does this environment hold data that must not be published?</b> It decides whether sessions may reach git. Until you answer, it counts as restricted.
          {env?.signals.length ? ` Likely restricted: ${env.signals.slice(0, 2).join("; ")}${env.signals.length > 2 ? `, and ${env.signals.length - 2} more sign${env.signals.length > 3 ? "s" : ""}` : ""}.` : ""}
        </span>
        <Tip label={ENVIRONMENT_MEANS.restricted}>
          <Button variant={env?.guess === "open" ? "outline" : "default"} size="xs" onClick={() => void answer({ environment: "restricted" })}>
            Yes, restricted
          </Button>
        </Tip>
        <Tip label={ENVIRONMENT_MEANS.open}>
          <Button variant={env?.guess === "open" ? "default" : "outline"} size="xs" onClick={() => void answer({ environment: "open" })}>
            No, open
          </Button>
        </Tip>
        <Button variant="ghost" size="xs" onClick={() => setLater(true)}>
          Later
        </Button>
      </div>
    );

  if (sh.migrated && !migrationSeen)
    return (
      <div className="banner ask" role="status">
        <VenetianMask size={15} aria-hidden />
        <span className="flex-1">
          Sharing is no longer chosen per session: it follows this environment and the repository&apos;s remotes. {sh.shares ? "Sessions are committed here" : "Here they stay on this machine"}: {sharingReason(sh)}.
          {sh.migrated.private ? ` ${sh.migrated.private} session${sh.migrated.private === 1 ? " moved" : "s moved"} to the gitignored .yolo-twice/private folder.` : ""}
          {sh.migrated.kept ? ` ${sh.migrated.kept} you made private stay${sh.migrated.kept === 1 ? "s" : ""} private for good.` : ""}
        </span>
        <Button
          variant="ghost"
          size="xs"
          aria-label="Dismiss"
          onClick={() => {
            try {
              localStorage.setItem(MIGRATED_SEEN, "1");
            } catch {
              /* remembered for this page only */
            }
            setMigrationSeen(true);
          }}
        >
          <X />
        </Button>
      </div>
    );

  if (props.alert)
    return (
      <div className="banner ask" role="status">
        <TriangleAlert size={15} aria-hidden />
        <span className="flex-1">
          From now on what you do here stays on this machine: {sharingReason(props.alert)}. Sessions committed earlier stay as they are.
          {props.alert.unpushed ? ` ${props.alert.unpushed} committed session${props.alert.unpushed === 1 ? " is" : "s are"} not pushed yet; pushing publishes ${props.alert.unpushed === 1 ? "it" : "them"}.` : ""}
        </span>
        <Button variant="ghost" size="xs" onClick={props.onDismissAlert} aria-label="Dismiss">
          <X />
        </Button>
      </div>
    );

  const unknown = unknownRemote(sh);
  if (!unknown || sh.shares || unknownLater) return null;
  return (
    <div className="banner ask" role="status">
      <ShieldQuestionMark size={15} aria-hidden />
      <span className="flex-1">
        Sessions stay on this machine: {sharingReason(sh)}. If it is a repository of your organisation, say so and sessions are committed with the project.
      </span>
      <Tip label={`Count ${patternFor(unknown.id)} as an internal repository on this machine (restricted remotes in the Sessions settings).`}>
        <Button variant="outline" size="xs" onClick={() => void answer({ restricted_remotes: [...new Set([...(env?.restricted_remotes ?? []), patternFor(unknown.id)])] })}>
          {patternFor(unknown.id)} is internal
        </Button>
      </Tip>
      <Button variant="ghost" size="xs" onClick={() => setUnknownLater(true)} aria-label="Dismiss">
        <X />
      </Button>
    </div>
  );
}
