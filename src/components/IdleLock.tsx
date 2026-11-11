import * as React from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { lockScreen, unlockScreen, useSession } from "@/lib/session";

/**
 * Locks the screen after a period of inactivity and hides everything behind a cover.
 * Supports the "automatic logoff" theme of HIPAA 164.312(a)(2)(iii) and NCA session management.
 */
export function IdleLock() {
  const { idleMinutes, locked, user } = useSession();
  const timer = React.useRef<number | undefined>(undefined);

  React.useEffect(() => {
    if (!idleMinutes || locked) return;
    const reset = () => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(lockScreen, idleMinutes * 60_000);
    };
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      window.clearTimeout(timer.current);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [idleMinutes, locked]);

  if (!locked) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur-md" role="alertdialog" aria-label="Screen locked">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 text-center shadow-xl">
        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-move/15 text-move">
          <Lock className="size-6" />
        </div>
        <h2 className="text-lg font-semibold">Screen locked</h2>
        <p className="mt-1 text-sm text-muted-foreground">The screen locked after {idleMinutes} minutes without activity. Patient information is hidden.</p>
        <p className="mt-3 text-sm">Signed in as <strong>{user.name}</strong></p>
        <Button variant="primary" className="mt-4 w-full" onClick={unlockScreen}>Unlock</Button>
        <p className="mt-2 text-xs text-muted-foreground">Demo only. A real system asks for your password or single sign-on.</p>
      </div>
    </div>
  );
}
