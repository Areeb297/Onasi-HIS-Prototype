import * as React from "react";
import { CodeBlock } from "@/components/ui/code-block";
import { Badge, Empty, cn } from "@/components/ui/primitives";
import { fmtDateTime } from "@/lib/format";
import type { CallEntry } from "@/lib/integrations";

/** The message log of one integration: the calls on the left, the request and the response of the chosen call on the right. */

const SHOWN = 100;
const EXT: Record<CallEntry["format"], string> = { JSON: "json", "HL7 v2": "hl7", XML: "xml" };

/** JSON that was stored on one line is laid out for reading. Anything else is shown as it is. */
function body(text: string, format: CallEntry["format"]): string {
  if (format !== "JSON") return text;
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
}

export function MessageLog({ calls }: { calls: CallEntry[] }) {
  const [picked, setPicked] = React.useState<string | null>(null);
  if (calls.length === 0) return <Empty>No calls yet. Calls appear here as the hospital uses this service.</Empty>;
  const list = calls.slice(0, SHOWN);
  const call = list.find((c) => c.id === picked) ?? list[0];
  // Plain text answers (an ADT result line) are not HL7: a .txt name keeps the highlighter off.
  const responseExt = call.format === "HL7 v2" && !call.response.includes("|") ? "txt" : EXT[call.format];

  return (
    <div className="grid min-w-0 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="min-w-0 border-b border-border lg:border-b-0 lg:border-r">
        <ul aria-label="Calls" className="max-h-[32rem] divide-y divide-border/70 overflow-y-auto">
          {list.map((c) => (
            <li key={c.id}>
              <button
                type="button" aria-pressed={c.id === call.id} onClick={() => setPicked(c.id)}
                className={cn("block w-full px-4 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring", c.id === call.id && "bg-accent/60")}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{c.operation}</span>
                  <Badge tone={c.ok ? "ok" : "danger"}>{c.ok ? "Success" : "Failed"}</Badge>
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">{c.summary}</span>
                <span className="mt-0.5 block text-xs tabular-nums text-muted-foreground">{fmtDateTime(c.at)}{c.by ? `, ${c.by}` : ""}</span>
              </button>
            </li>
          ))}
        </ul>
        {calls.length > SHOWN && <p className="border-t border-border/70 px-4 py-2 text-xs text-muted-foreground">Showing the newest {SHOWN} of {calls.length} calls.</p>}
      </div>
      <div className="min-w-0 space-y-3 p-4">
        <p className="text-sm"><span className="font-semibold">{call.operation}</span><span className="text-muted-foreground">, {fmtDateTime(call.at)}. {call.summary}</span></p>
        {call.request && <CodeBlock filename={`request.${EXT[call.format]}`} code={body(call.request, call.format)} maxHeight="15rem" />}
        {call.response
          ? <CodeBlock filename={`response.${responseExt}`} code={body(call.response, call.format)} maxHeight="15rem" />
          : <p className="text-sm text-muted-foreground">No answer was recorded for this call.</p>}
      </div>
    </div>
  );
}
