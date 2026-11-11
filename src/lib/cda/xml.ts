import type { Block } from "./types";

/** Small XML helpers. No dependencies, so they also run in tests. */

export const esc = (s: string | number | undefined): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const attrs = (a: Record<string, string | number | undefined>): string =>
  Object.entries(a)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => ` ${k}="${esc(v)}"`)
    .join("");

/** Self-closing element with attributes. */
export const tag = (name: string, a: Record<string, string | number | undefined> = {}): string => `<${name}${attrs(a)}/>`;

/** Element with child elements. Each child is a complete element; lines are indented by two spaces. */
export function el(name: string, a: Record<string, string | number | undefined> = {}, children: (string | undefined | false | null)[] = []): string {
  const kids = children.filter((c): c is string => !!c);
  if (!kids.length) return `<${name}${attrs(a)}/>`;
  const inner = kids.map((c) => c.split("\n").map((l) => "  " + l).join("\n")).join("\n");
  return `<${name}${attrs(a)}>\n${inner}\n</${name}>`;
}

/** Element with escaped text content. */
export const txt = (name: string, a: Record<string, string | number | undefined>, text: string): string => `<${name}${attrs(a)}>${esc(text)}</${name}>`;

const p2 = (n: number) => String(n).padStart(2, "0");

/** Local date-time string "YYYY-MM-DDTHH:mm" (or a Date) to HL7 TS with time zone: YYYYMMDDhhmmss+0300 (Riyadh). */
export function hl7Time(local: string | Date | undefined): string {
  if (!local) return "";
  if (local instanceof Date) {
    const t = new Date(local.getTime() + 3 * 3600_000);
    return `${t.getUTCFullYear()}${p2(t.getUTCMonth() + 1)}${p2(t.getUTCDate())}${p2(t.getUTCHours())}${p2(t.getUTCMinutes())}${p2(t.getUTCSeconds())}+0300`;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(local);
  if (!m) return "";
  return `${m[1]}${m[2]}${m[3]}${m[4] ?? "00"}${m[5] ?? "00"}00+0300`;
}

/** Same instant in UTC as YYYYMMDDhhmmss. Local strings are read as Riyadh time (UTC+3). */
export function utcTime(local: string | Date): string {
  const s = typeof local === "string" ? (local.length === 10 ? `${local}T00:00` : local) : "";
  const d = local instanceof Date ? local : new Date(`${s}:00+03:00`);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}`;
}

export const hl7Date = (iso: string): string => iso.replace(/-/g, "").slice(0, 8);

/** Render narrative blocks as CDA <text>. */
export function narrative(blocks: Block[]): string {
  const parts = blocks.map((b) => {
    if (b.kind === "p") return `<paragraph>${esc(b.text)}</paragraph>`;
    if (b.kind === "list") {
      return `<list>${b.items.map((i) => `<item>${i.id ? `<content ID="${esc(i.id)}">${esc(i.text)}</content>` : esc(i.text)}</item>`).join("")}</list>`;
    }
    const head = `<thead><tr>${b.head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>`;
    const body = `<tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>`;
    return `<table>${head}${body}</table>`;
  });
  return `<text>${parts.join("")}</text>`;
}

/**
 * A light well-formedness check: tags balance, attributes are quoted, no stray ampersands.
 * Not a schema validator. Returns an error text or null.
 */
export function wellFormed(xml: string): string | null {
  const stack: string[] = [];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>|<|&(?!(?:amp|lt|gt|quot|apos|#\d+);)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const raw = m[0];
    if (raw === "<") return `Stray "<" at position ${m.index}`;
    if (raw.startsWith("&")) return `Unescaped "&" at position ${m.index}`;
    if (raw.startsWith("<!--") || raw.startsWith("<?")) continue;
    const [, close, name, , selfClose] = m;
    if (selfClose) continue;
    if (close) {
      const top = stack.pop();
      if (top !== name) return `Closing </${name}> does not match <${top ?? "nothing"}>`;
    } else stack.push(name);
  }
  return stack.length ? `Element <${stack[stack.length - 1]}> is not closed` : null;
}

/* ---------- SHA-1 (the ITI-41 hash attribute is SHA-1 of the document) ---------- */

export function sha1(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const words: number[] = [];
  for (let i = 0; i < bytes.length; i++) words[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
  words[bytes.length >> 2] |= 0x80 << (24 - (bytes.length % 4) * 8);
  const total = (((bytes.length + 8) >> 6) + 1) << 4;
  for (let i = 0; i < total; i++) words[i] = words[i] | 0;
  words[total - 1] = bytes.length * 8;
  const rol = (n: number, s: number) => (n << s) | (n >>> (32 - s));
  let h0 = 0x67452301, h1 = 0xefcdab89 | 0, h2 = 0x98badcfe | 0, h3 = 0x10325476, h4 = 0xc3d2e1f0 | 0;
  const w = new Array<number>(80);
  for (let i = 0; i < total; i += 16) {
    for (let t = 0; t < 80; t++) w[t] = t < 16 ? words[i + t] | 0 : rol(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let t = 0; t < 80; t++) {
      const f = t < 20 ? (b & c) | (~b & d) : t < 40 ? b ^ c ^ d : t < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
      const k = t < 20 ? 0x5a827999 : t < 40 ? 0x6ed9eba1 : t < 60 ? 0x8f1bbcdc | 0 : 0xca62c1d6 | 0;
      const tmp = (rol(a, 5) + f + e + k + w[t]) | 0;
      e = d; d = c; c = rol(b, 30); b = a; a = tmp;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
  }
  return [h0, h1, h2, h3, h4].map((n) => (n >>> 0).toString(16).padStart(8, "0")).join("");
}

/** A stable UUID-shaped id from a seed. Same seed gives the same id. */
export function guid(seed: string): string {
  const s = (sha1(seed) + sha1(seed + "x")).slice(0, 32).split("");
  s[12] = "4";
  s[16] = "89ab"[parseInt(s[16], 16) % 4];
  const j = s.join("");
  return `${j.slice(0, 8)}-${j.slice(8, 12)}-${j.slice(12, 16)}-${j.slice(16, 20)}-${j.slice(20, 32)}`;
}
