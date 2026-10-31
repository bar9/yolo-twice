import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { BINDINGS, GROUPS } from "./keys";

/** The cheat sheet, generated from the keymap that also handles the keys. */
export function Shortcuts({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>← → move the scope, ↑ ↓ the selection, − + the detail. Keys work while you are not typing; the graph keeps its own arrows and zoom while it has focus.</DialogDescription>
        </DialogHeader>
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
      </DialogContent>
    </Dialog>
  );
}
