/**
 * Print a small HTML document from the browser. A hidden frame is used so no pop-up is opened and nothing is stored.
 * Every value put into the HTML must go through esc().
 */

import type { Patient } from "./model";
import { hasGlass } from "./session";
import { patientName } from "./store";

/** The name to put on a printed page. A confidential patient stays masked until someone breaks the glass. The MRN still identifies the page. */
export function printableName(p: Patient | undefined): string {
  if (p?.confidential && !hasGlass(p.id)) return "Confidential patient";
  return patientName(p);
}

export const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

export interface PrintOptions {
  title: string;
  /** Page rules, for example "@page { size: A4; margin: 10mm }". */
  css?: string;
  body: string;
}

export const printHtml = (o: PrintOptions): string =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${esc(o.title)}</title><style>` +
  `*{box-sizing:border-box}body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#0f172a;font-size:12px}${o.css ?? ""}` +
  `</style></head><body>${o.body}</body></html>`;

/** Opens the print dialog. Returns false when the browser cannot print (for example in a test). */
export function printDocument(o: PrintOptions): boolean {
  if (typeof document === "undefined") return false;
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    frame.remove();
    return false;
  }
  doc.open();
  doc.write(printHtml(o));
  doc.close();
  const run = () => {
    try {
      win.focus();
      win.print();
    } finally {
      window.setTimeout(() => frame.remove(), 1000);
    }
  };
  // Give the frame a moment to lay out the SVG before the print dialog reads it.
  window.setTimeout(run, 150);
  return true;
}
