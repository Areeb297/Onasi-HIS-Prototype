import * as React from "react";
import { can, useSession } from "../session";
import { CHECK_EVERY_MS, checkNow } from "./agent-work";

/**
 * Keeps the agents checking while the app is open, on any page. One round at once, then one every minute.
 * It starts again when the signed-in user changes, because an agent works with that user's permissions.
 */
export function useAgentMonitor() {
  const { user } = useSession();
  React.useEffect(() => {
    if (!can("ai.use")) return;
    const first = window.setTimeout(() => checkNow(), 1200);
    const timer = window.setInterval(() => checkNow(), CHECK_EVERY_MS);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [user.id]);
}
