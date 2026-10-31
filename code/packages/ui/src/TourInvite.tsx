import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

const SEEN = "yt.tour";
export const markSeen = () => {
  try {
    localStorage.setItem(SEEN, "seen");
  } catch {}
};

/** On a first visit, a quiet offer under the Help button; it shows once. */
export function TourInvite({ onStart }: { onStart: () => void }) {
  const [show, setShow] = useState(() => {
    try {
      return !localStorage.getItem(SEEN);
    } catch {
      return false;
    }
  });
  const later = () => (markSeen(), setShow(false));
  useEffect(() => {
    if (!show) return;
    // any click elsewhere means "not now"; the click still goes where it was meant
    const away = (e: PointerEvent) => !(e.target as HTMLElement).closest?.(".tour-invite") && later();
    addEventListener("pointerdown", away, true);
    return () => removeEventListener("pointerdown", away, true);
  }, [show]);
  if (!show) return null;
  return (
    <div className="tour-invite" role="status">
      <Sparkles className="size-4 shrink-0 text-rec" aria-hidden />
      <div className="min-w-0">
        <p className="font-semibold">New to yolo-twice?</p>
        <p className="text-ink-2">A one-minute tour shows each part of the screen. Help (?) has it any time.</p>
        <div className="mt-2 flex gap-2">
          <Button size="xs" className="cta" onClick={() => (markSeen(), setShow(false), onStart())}>
            Take the tour
          </Button>
          <Button size="xs" variant="ghost" onClick={later}>
            Not now
          </Button>
        </div>
      </div>
    </div>
  );
}
