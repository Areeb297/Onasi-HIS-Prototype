import { navigate } from "@/lib/router";

/**
 * Opens the claim page of a visit at the section that needs fixing. The claim page gets `field` in the address
 * (diagnoses, lines, supporting-information, claim, review). Until it reads that itself, this scrolls to the section:
 * an element with data-claim-field or id claim-<field>, else the section heading with the same words.
 */
export function openClaimAt(visit: string, field: string, heading: string) {
  navigate("/claim", { visit, field });
  const started = Date.now();
  const find = (): HTMLElement | null => {
    const byAttr = document.querySelector<HTMLElement>(`[data-claim-field="${field}"], #claim-${field}`);
    if (byAttr) return byAttr;
    const words = heading.toLowerCase();
    return [...document.querySelectorAll<HTMLElement>("main h2, main h3")].find((h) => h.textContent?.trim().toLowerCase().startsWith(words)) ?? null;
  };
  const tick = () => {
    const el = find();
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      const focusable = el.closest("section")?.querySelector<HTMLElement>("input, select, textarea, button");
      focusable?.focus({ preventScroll: true });
      return;
    }
    if (Date.now() - started < 2500) window.setTimeout(tick, 120);
  };
  window.setTimeout(tick, 150);
}
