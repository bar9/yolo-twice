import { useEffect, useState } from "react";
import { Check, GitCommitHorizontal, Plus, ShieldQuestionMark, TriangleAlert, VenetianMask, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api, type Environment, type EnvironmentInfo, type SessionIndex, type Sharing, type Visibility } from "./api";
import { ENVIRONMENT_MEANS, patternFor, pendingSessions, remoteClassLabel, sharingReason, sharingShort, sharingTip, unknownRemote, VISIBILITY_LABEL, VISIBILITY_MEANS } from "./sharingWords";
import { Tip } from "./Tip";

/**
 * Private sessions, like private browsing: a session from a restricted environment never reaches a
 * repository it should not. The engine decides the default; these controls show it and let you
 * decide. The rules: packages/engine/src/sharing.ts; wording: sharingWords.ts.
 */

const ICON = { private: VenetianMask, undecided: ShieldQuestionMark, shared: GitCommitHorizontal } as const;

/** In the session list and the crumb: nothing for shared (the normal case stays clean), a mask for private. */
export function VisibilityBadge({ visibility, decided, sharing }: { visibility?: Visibility; decided?: boolean; sharing?: Sharing }) {
  if (!visibility || visibility === "shared") return null;
  const Icon = ICON[visibility];
  const why = !decided && sharing ? ` ${visibility === "private" ? "Private" : "Undecided"} by default: ${sharingReason(sharing)}.` : "";
  return (
    <Tip label={`${VISIBILITY_MEANS[visibility]}${why}`}>
      <span className={`badge ${visibility} ml-2`} onClick={(e) => e.stopPropagation()}>
        <Icon aria-hidden />
        {VISIBILITY_LABEL[visibility]}
      </span>
    </Tip>
  );
}

/** Beside the pin: what happens to this session, and the choice. */
export function VisibilityMenu(props: { visibility?: Visibility; decided?: boolean; sharing?: Sharing; onChange: (v: "shared" | "private") => void }) {
  const v = props.visibility;
  if (!v || !props.sharing) return null;
  const Icon = ICON[v];
  const tip = v === "shared" ? `Shared: ${VISIBILITY_MEANS.shared} Click to keep it private instead.` : `${VISIBILITY_LABEL[v]}: ${VISIBILITY_MEANS[v]} Click to choose.`;
  return (
    <DropdownMenu>
      <Tip label={tip}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" className={`visibility ${v} size-7`} aria-label={`Session visibility: ${VISIBILITY_LABEL[v]}`}>
            <Icon className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-[12.5px] font-normal leading-snug text-ink-2">
          {props.decided ? "Your choice for this session." : `By default: ${sharingReason(props.sharing)}.`}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => props.onChange("shared")} className="items-start">
          <GitCommitHorizontal className="mt-0.5" />
          <span>
            <span className="block font-medium">Share with the project</span>
            <span className="block text-[12px] text-ink-2">Committed by auto-commit or your next commit; pushing publishes it to the remotes.</span>
          </span>
          {v === "shared" && <Check className="ml-auto mt-0.5" />}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => props.onChange("private")} className="items-start">
          <VenetianMask className="mt-0.5" />
          <span>
            <span className="block font-medium">Keep private</span>
            <span className="block text-[12px] text-ink-2">Never leaves this machine. If it was committed before, it is removed from git; earlier commits keep it.</span>
          </span>
          {v === "private" && <Check className="ml-auto mt-0.5" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
  const Icon = ICON[sharing.default];
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
          <Button variant="outline" size="sm" className={`sharing ${sharing.default}`} aria-label={sharingShort(sharing)}>
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
            A restricted environment shares sessions only with restricted remotes. New sessions here start <b>{sharing.default}</b>: {sharingReason(sharing)}. Each session can still be changed from its menu beside the pin.
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
          {sharing.remotes.length === 0 && <p className="text-ink-2">None yet. Sessions wait for your decision until a remote is added; yolo-twice notices when one is.</p>}
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
            {sharing.unpushed} committed session{sharing.unpushed === 1 ? " is" : "s are"} not pushed yet. Pushing publishes {sharing.unpushed === 1 ? "it" : "them"}; make {sharing.unpushed === 1 ? "it" : "them"} private first if that is not intended.
          </p>
        )}
        {error && <p className="text-destructive">{error}</p>}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Below the header, only when a decision is needed: the environment question (once per machine),
 * a stricter state after a remote change (once), or a new session that is not shared by default.
 */
export function SharingBanner(props: { index?: SessionIndex; alert?: Sharing; warning?: string; onDismissAlert: () => void; onDismissWarning: () => void; onVisibility: (id: string, v: "shared" | "private") => void; onChanged: () => void }) {
  const sh = props.index?.sharing;
  const [later, setLater] = useState(false);
  const [env, setEnv] = useState<EnvironmentInfo | undefined>();
  useEffect(() => {
    if (sh) api.environment().then(setEnv).catch(() => undefined);
  }, [sh]);
  if (!sh) return null;
  const answer = async (patch: { environment?: Environment; restricted_remotes?: string[] }) => {
    await api.setEnvironment(patch).catch(() => undefined);
    props.onChanged();
  };

  if (props.warning)
    return (
      <div className="banner ask" role="status">
        <VenetianMask size={15} aria-hidden />
        <span className="flex-1">{props.warning}</span>
        <Button variant="ghost" size="xs" onClick={props.onDismissWarning} aria-label="Dismiss">
          <X />
        </Button>
      </div>
    );

  if (!sh.answered && !later)
    return (
      <div className="banner ask" role="status">
        <ShieldQuestionMark size={15} aria-hidden />
        <span className="flex-1">
          <b>Does this environment hold data that must not be published?</b> It decides which new sessions may reach git. Until you answer, it counts as restricted.
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

  if (props.alert)
    return (
      <div className="banner ask" role="status">
        <TriangleAlert size={15} aria-hidden />
        <span className="flex-1">
          Sessions are no longer shared by default: {sharingReason(props.alert)}. New sessions now start {props.alert.default}.
          {props.alert.unpushed ? ` ${props.alert.unpushed} committed session${props.alert.unpushed === 1 ? " is" : "s are"} not pushed yet; pushing publishes ${props.alert.unpushed === 1 ? "it" : "them"}.` : ""}
        </span>
        <Button variant="ghost" size="xs" onClick={props.onDismissAlert} aria-label="Dismiss">
          <X />
        </Button>
      </div>
    );

  const pending = pendingSessions(props.index);
  const s = pending[0];
  if (!s || !sh.prompt) return null;
  const unknown = unknownRemote(sh);
  return (
    <div className="banner ask" role="status">
      {s.visibility === "private" ? <VenetianMask size={15} aria-hidden /> : <ShieldQuestionMark size={15} aria-hidden />}
      <span className="flex-1">
        <b>{s.label || s.id.slice(0, 8)}</b> {s.visibility === "private" ? "is kept private" : "stays out of git until you choose"}: {sharingReason(sh)}.
        {pending.length > 1 && ` ${pending.length - 1} more session${pending.length > 2 ? "s" : ""} wait${pending.length > 2 ? "" : "s"} too.`}
      </span>
      {unknown && (
        <Tip label={`Count ${patternFor(unknown.id)} as an internal repository on this machine. Sessions are then shared with it by default.`}>
          <Button variant="outline" size="xs" onClick={() => void answer({ restricted_remotes: [...new Set([...(env?.restricted_remotes ?? []), patternFor(unknown.id)])] })}>
            {unknown.id.split("/")[0]} is internal
          </Button>
        </Tip>
      )}
      <Tip label={VISIBILITY_MEANS.private}>
        <Button variant={s.visibility === "private" ? "default" : "outline"} size="xs" onClick={() => props.onVisibility(s.id, "private")}>
          <VenetianMask /> Keep private
        </Button>
      </Tip>
      <Tip label={`${VISIBILITY_MEANS.shared} Pushing publishes it to the remotes.`}>
        <Button variant="outline" size="xs" onClick={() => props.onVisibility(s.id, "shared")}>
          <GitCommitHorizontal /> Share
        </Button>
      </Tip>
    </div>
  );
}
