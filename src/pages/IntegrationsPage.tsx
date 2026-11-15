import * as React from "react";
import { Activity, Banknote, CalendarHeart, Fingerprint, PackageSearch, PlugZap, ReceiptText, ShieldCheck } from "lucide-react";
import { IntegrationCard } from "@/components/integrations/IntegrationCard";
import { MessageLog } from "@/components/integrations/MessageLog";
import { YakeenLookup } from "@/components/integrations/YakeenLookup";
import { GlassBackdrop } from "@/components/ui/glass";
import { Button, Card, CardHeader, Empty, PageHeader, Select, Table, Td, Th } from "@/components/ui/primitives";
import {
  MODES, MODE_LABEL, callsOf, environmentOf, modeOf, setMode, statsOf, testConnection, useCallLog, visibleIntegrations, type IntegrationId, type Mode,
} from "@/lib/integrations";
import { ID_TYPE_LABEL, YAKEEN_PEOPLE, fullName } from "@/lib/integrations/yakeen";
import { can, useSession } from "@/lib/session";
import { pushToast } from "@/lib/toast";

/** The hub of the national integrations: one card each, and the message log of the one that is open. */

const ICON: Record<IntegrationId, React.ReactNode> = {
  "nphies-financial": <Banknote />, "nphies-clinical": <Activity />, raqeeb: <ShieldCheck />, yakeen: <Fingerprint />,
  rsd: <PackageSearch />, seha: <CalendarHeart />, zatca: <ReceiptText />,
};

export function IntegrationsPage() {
  useSession(); // what is shown depends on who is signed in
  useCallLog(); // new calls and status changes redraw the page
  const items = visibleIntegrations();
  const [openId, setOpenId] = React.useState<IntegrationId | null>(null);
  const admin = can("admin");

  if (items.length === 0) {
    return (
      <>
        <PageHeader title="Integrations" />
        <Card><Empty>Only the System Administrator and billing officers can open the integrations.</Empty></Card>
      </>
    );
  }
  const open = items.find((i) => i.id === openId) ?? items[0];
  const calls = callsOf(open.id);

  function runTest() {
    const res = testConnection(open.id);
    if (res) pushToast({ tone: res.ok ? "ok" : "warn", text: res.ok ? `${open.name} answered` : `${open.name} is switched off` });
  }

  return (
    <GlassBackdrop>
      <PageHeader
        title="Integrations"
        subtitle={admin ? "The national services this hospital connects to. Calls are simulated: nothing leaves this browser." : "The financial services this hospital connects to, and their message logs."}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((i) => (
          <IntegrationCard key={i.id} item={i} icon={ICON[i.id]} stats={statsOf(callsOf(i.id))} selected={i.id === open.id} onSelect={() => setOpenId(i.id)} />
        ))}
      </div>

      <Card className="mt-4">
        <CardHeader
          title={`${open.name} Message Log`}
          subtitle={`${open.owner}. ${environmentOf(open.id)}. ${calls.length} ${calls.length === 1 ? "call" : "calls"} on record.`}
          right={admin ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Select aria-label={`Status of ${open.name}`} className="w-36" value={modeOf(open.id)} onChange={(e) => setMode(open.id, e.target.value as Mode)}>
                {MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
              </Select>
              <Button onClick={runTest}><PlugZap className="size-4" aria-hidden="true" /> Test Connection</Button>
            </div>
          ) : undefined}
        />
        {open.id === "yakeen" && (
          <div className="space-y-4 border-b border-border px-4 py-4">
            <YakeenLookup />
            <details className="text-sm">
              <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">Sample Identities For Testing</summary>
              <Table className="mt-2 rounded-lg border border-border">
                <thead><tr><Th>ID Type</Th><Th>Number</Th><Th>Date Of Birth</Th><Th>Name</Th><Th>Nationality</Th></tr></thead>
                <tbody>
                  {YAKEEN_PEOPLE.map((p) => (
                    <tr key={p.idNumber}>
                      <Td>{ID_TYPE_LABEL[p.idType]}</Td><Td className="font-mono text-xs">{p.idNumber}</Td><Td className="tabular-nums">{p.dob}</Td>
                      <Td>{fullName(p.nameEn)}</Td><Td>{p.nationalityLabel}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </details>
          </div>
        )}
        {open.id === "seha" && (
          <p className="border-b border-border px-4 py-3 text-sm text-muted-foreground">A doctor issues a sick leave from the Sick Leave section of the patient chart.</p>
        )}
        <MessageLog key={open.id} calls={calls} />
      </Card>
    </GlassBackdrop>
  );
}
