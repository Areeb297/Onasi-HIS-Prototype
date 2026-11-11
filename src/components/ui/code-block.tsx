import * as React from "react";
import { Check, Copy, Download } from "lucide-react";
import { Button, cn } from "./primitives";

/** Download text as a file in the browser. */
export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

function HighlightLine({ line }: { line: string }) {
  const bar = line.indexOf("|");
  if (bar < 0) return <>{line}</>;
  const id = line.slice(0, bar);
  const rest = line.slice(bar);
  const parts = rest.split(/(\||\^|~)/);
  return (
    <>
      <span className={cn("font-semibold", id.startsWith("Z") ? "text-chart-3" : "text-primary")} style={id.startsWith("Z") ? { color: "#b18cfe" } : undefined}>
        {id}
      </span>
      {parts.map((p, i) =>
        p === "|" || p === "^" || p === "~" ? (
          <span key={i} className="text-muted-foreground/60">
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

/**
 * Code block with a file name header, line numbers and a copy button.
 * Styled after the 21st.dev "Code Block" pattern.
 */
export function CodeBlock({
  filename,
  code,
  className,
  maxHeight,
  allowDownload = true,
}: {
  filename: string;
  /** Segments separated by a line break. */
  code: string;
  className?: string;
  maxHeight?: number | string;
  allowDownload?: boolean;
}) {
  const [copied, setCopied] = React.useState(false);
  const lines = code.split("\n");
  // Only .hl7 text is highlighted as HL7. A .json or .xml file name turns that off.
  const hl7 = !/\.(json|xml|txt|csv)$/i.test(filename);

  async function onCopy() {
    // HL7 v2 messages are shared with CR separators. JSON and XML keep normal line breaks.
    const ok = await copyText(lines.join(hl7 ? "\r" : "\n"));
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  }

  return (
    <figure className={cn("overflow-hidden rounded-lg border border-border bg-card", className)}>
      <figcaption className="flex items-center justify-between gap-2 border-b border-border bg-muted/60 px-3 py-1.5">
        <span className="truncate font-mono text-xs text-muted-foreground">{filename}</span>
        <span className="flex items-center gap-1">
          {allowDownload && (
            <Button size="sm" variant="ghost" onClick={() => downloadText(filename, lines.join(hl7 ? "\r" : "\n"))} aria-label="Download file">
              <Download className="size-3.5" />
              Download
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onCopy} aria-label="Copy message">
            {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </span>
      </figcaption>
      <pre className="overflow-auto py-2 font-mono text-sm leading-[1.7]" style={{ maxHeight }}>
        <code className="block min-w-max">
          {lines.map((line, i) => (
            <div key={i} className="flex hover:bg-muted/50">
              <span className="w-9 shrink-0 select-none pr-2 text-right text-muted-foreground/60">{i + 1}</span>
              <span className="whitespace-pre pr-4">
                {hl7 ? <HighlightLine line={line} /> : line}
              </span>
            </div>
          ))}
        </code>
      </pre>
    </figure>
  );
}
