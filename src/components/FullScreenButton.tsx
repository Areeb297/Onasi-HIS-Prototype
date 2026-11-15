import * as React from "react";
import { Maximize, Minimize } from "lucide-react";
import { Button } from "@/components/ui/primitives";

/**
 * Top bar button that puts the whole app in the browser's full screen mode and takes it out again.
 * It is not shown where the browser has no full screen mode (for example Safari on an iPhone).
 */
export function FullScreenButton() {
  const supported = typeof document !== "undefined" && !!document.fullscreenEnabled && typeof document.documentElement.requestFullscreen === "function";
  const [on, setOn] = React.useState(() => typeof document !== "undefined" && !!document.fullscreenElement);

  React.useEffect(() => {
    if (!supported) return;
    const sync = () => setOn(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, [supported]);

  if (!supported) return null;
  const label = on ? "Exit Full Screen" : "Full Screen";
  const toggle = () => {
    // The browser may refuse (for example inside a frame that does not allow it). Then nothing changes.
    const done = on ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    done.catch(() => undefined);
  };
  return (
    <Button size="sm" onClick={toggle} title={label} aria-label={label} aria-pressed={on}>
      {on ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
      <span className="hidden lg:inline">{label}</span>
    </Button>
  );
}
