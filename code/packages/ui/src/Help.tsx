import { Tabs } from "radix-ui";
import { ArrowUpRight, BookOpenText, Focus, GitBranch, GitCommitHorizontal, GitPullRequest, Globe, MessageSquarePlus, Network, Radio, Scale, Search, SlidersVertical, Sparkles, VenetianMask, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { BrandMark } from "./Header";
import { BINDINGS, GROUPS } from "./keys";
import { BUILD, LINKS } from "./product";

export type HelpTab = "guide" | "keys" | "about";

/** The manual: what a newcomer needs, in the order they will need it. */
const GUIDE: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: SlidersVertical,
    title: "Read at the detail you need",
    text: "Low is one line per part, Medium a short abstract, High a summary with the tool calls, Raw every event. − and + change the page; the lens on a part changes only that part.",
  },
  {
    icon: Focus,
    title: "Zoom in, step back",
    text: "Click a part to focus on it: the text, the map and the timeline then show only that part. The path at the top, or ←, steps back out. The address bar always holds the exact view, so a copied link opens it for a teammate.",
  },
  {
    icon: Search,
    title: "Find things",
    text: "Search, or filter by kind: your prompts, Claude's answers, tools, errors, subagents. Drag across the timeline to keep a time window. Parts without matches fold away; Show filtered brings them back. Nothing here? Search the phase widens the search.",
  },
  {
    icon: Network,
    title: "Read, Split or Map",
    text: "Read shows the text, Map the session as boxes and arrows, Split both side by side. They stay in step: point at a part in one and it lights up in the other.",
  },
  {
    icon: Radio,
    title: "Watch it live",
    text: "While Claude works, Follow keeps the newest step in view. Scroll up to read in peace; the new-events button brings you back.",
  },
  {
    icon: BookOpenText,
    title: "Catch me up",
    text: "A short account of what happened since you last looked.",
  },
  {
    icon: GitBranch,
    title: "It lives with your code",
    text: "Sessions are saved in the project's .yolo-twice folder. Commit it, or turn on auto-commit in the settings, and the team can open, review and continue them.",
  },
  {
    icon: VenetianMask,
    title: "Private sessions",
    text: "A session can hold things that must not be published: internal names, accounts, customer data. Say once whether this environment is restricted (it holds such data) or open. One rule decides, for every session alike: a restricted environment shares sessions only when every remote of the repository is restricted. Otherwise what you write here stays on this machine, in the gitignored .yolo-twice/private folder, marked with the mask. That includes a committed session you continue here: the committed part stays as it was, the additions stay here (Private additions). The Sessions button in the header says why and holds the settings. When the project may share again, the private sessions move back and are committed.",
  },
];

function Out({ href, children, className = "" }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <a className={`help-link ${className}`} href={href} target="_blank" rel="noreferrer">
      {children}
      <ArrowUpRight className="size-3.5" aria-hidden />
    </a>
  );
}

function Keys() {
  return (
    <div className="shortcuts">
      {GROUPS.map((g) => (
        <section key={g}>
          <h3>{g}</h3>
          <dl>
            {BINDINGS.filter((b) => b.group === g).map((b) => (
              <div key={b.id}>
                <dt>
                  {b.show.map((k, i) => (
                    <span key={k}>
                      {i > 0 && <span className="or">{b.show[1] === "…" || k === "…" ? "" : "or"}</span>}
                      {k === "…" ? <span className="or">to</span> : <Kbd>{k}</Kbd>}
                    </span>
                  ))}
                </dt>
                <dd>{b.label}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

function About() {
  const short = BUILD.commit.slice(0, 7);
  const built = BUILD.date ? new Date(BUILD.date).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) : "";
  return (
    <div className="about">
      <section className="about-card">
        <MessageSquarePlus className="about-icon" aria-hidden />
        <div>
          <h3>Tell us what you think</h3>
          <p>Something confusing, broken or missing? An issue on GitHub reaches the team directly.</p>
          <div className="about-actions">
            <Button asChild size="sm" className="cta">
              <a href={LINKS.feedback} target="_blank" rel="noreferrer">
                Give feedback
                <ArrowUpRight aria-hidden />
              </a>
            </Button>
            <Out href={LINKS.issues}>Open issues</Out>
          </div>
        </div>
      </section>
      <section className="about-card">
        <GitPullRequest className="about-icon" aria-hidden />
        <div>
          <h3>Help build it</h3>
          <p>yolo-twice is open source. Pull requests are welcome; the contributing guide explains the setup.</p>
          <div className="about-actions">
            <Button asChild size="sm" variant="outline">
              <a href={LINKS.pulls} target="_blank" rel="noreferrer">
                Pull requests
                <ArrowUpRight aria-hidden />
              </a>
            </Button>
            <Out href={LINKS.contributing}>Contributing guide</Out>
          </div>
        </div>
      </section>
      <dl className="about-facts">
        <div>
          <dt>
            <GitCommitHorizontal aria-hidden /> Version
          </dt>
          <dd>
            {short ? <Out href={LINKS.commit(BUILD.commit)} className="num">{short}</Out> : <span>a build without git</span>}
            {BUILD.dirty && <span className="about-note">with local changes</span>}
            {built && <span className="about-note">built {built}</span>}
          </dd>
        </div>
        <div>
          <dt>
            <Scale aria-hidden /> License
          </dt>
          <dd>
            <Out href={LINKS.license}>MIT</Out>
          </dd>
        </div>
        <div>
          <dt>
            <Globe aria-hidden /> Website
          </dt>
          <dd>
            <Out href={LINKS.website}>bar9.github.io/yolo-twice</Out>
          </dd>
        </div>
        <div>
          <dt>
            <GitBranch aria-hidden /> Source
          </dt>
          <dd>
            <Out href={LINKS.repo}>github.com/bar9/yolo-twice</Out>
          </dd>
        </div>
      </dl>
      <p className="about-credits">Built at BaselHack 2026 by Matthias Cullmann, Roland Brand, Jan Babin and Thomas Schöller.</p>
    </div>
  );
}

/** Help: the manual and the tour, the keyboard shortcuts, and what yolo-twice is and where it lives. */
export function Help(props: { open: boolean; tab: HelpTab; onTab: (t: HelpTab) => void; onOpenChange: (open: boolean) => void; onTour: () => void }) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="help flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <header className="help-banner">
          <BrandMark className="help-mark" />
          <div className="min-w-0 flex-1">
            <DialogTitle className="help-name">yolo-twice</DialogTitle>
            <DialogDescription className="help-tagline">What did the AI do, and why? Claude Code sessions, kept with the code and readable at any level of detail.</DialogDescription>
          </div>
        </header>
        <Tabs.Root value={props.tab} onValueChange={(v) => props.onTab(v as HelpTab)} className="flex min-h-0 flex-1 flex-col">
          <Tabs.List className="help-tabs" aria-label="Help">
            <Tabs.Trigger value="guide">Guide</Tabs.Trigger>
            <Tabs.Trigger value="keys">Keyboard</Tabs.Trigger>
            <Tabs.Trigger value="about">About</Tabs.Trigger>
          </Tabs.List>
          <div className="help-body">
            <Tabs.Content value="guide">
              <div className="tour-cta">
                <Sparkles className="size-4 shrink-0 text-rec" aria-hidden />
                <p>New here? A one-minute tour points at each part of the screen.</p>
                <Button size="sm" className="cta" onClick={props.onTour}>
                  Take the tour
                </Button>
              </div>
              <ol className="guide">
                {GUIDE.map(({ icon: Icon, title, text }) => (
                  <li key={title}>
                    <Icon className="guide-icon" aria-hidden />
                    <div>
                      <h3>{title}</h3>
                      <p>{text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </Tabs.Content>
            <Tabs.Content value="keys">
              <p className="help-lead">
                ← → move the scope, ↑ ↓ the selection, − + the detail. Keys work while you are not typing; the map keeps its own arrows and zoom while it has focus. Ctrl (or ⌘) and the scroll wheel over the text or the timeline zoom like → and ←: up into the part under the pointer, down one level out. <Kbd>?</Kbd> opens this page.
              </p>
              <Keys />
            </Tabs.Content>
            <Tabs.Content value="about">
              <About />
            </Tabs.Content>
          </div>
        </Tabs.Root>
      </DialogContent>
    </Dialog>
  );
}
