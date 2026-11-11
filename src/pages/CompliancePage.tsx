import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge, Button, Card, PageHeader, Table, Td, Th } from "@/components/ui/primitives";
import { FRAMEWORKS, summarize, type Status } from "@/lib/compliance-data";
import { navigate } from "@/lib/router";

const tone: Record<Status, "ok" | "warn" | "danger" | "neutral"> = {
  Applied: "ok",
  Partial: "warn",
  "Not applied": "danger",
  "Needs backend": "neutral",
};

export function CompliancePage() {
  return (
    <div>
      <PageHeader
        title="Compliance Map"
        subtitle="What each framework asks for, how the app addresses it, and an honest status. This is a design aid, not a certification and not legal advice."
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {FRAMEWORKS.map((f) => {
          const s = summarize(f);
          return (
            <Card key={f.id} className="p-4">
              <div className="text-sm font-semibold">{f.name}</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge tone="ok">{s.Applied} Applied</Badge>
                <Badge tone="warn">{s.Partial} Partial</Badge>
                <Badge tone="danger">{s["Not applied"]} Not applied</Badge>
                <Badge tone="neutral">{s["Needs backend"]} Needs backend</Badge>
              </div>
            </Card>
          );
        })}
      </div>

      <Accordion type="multiple" defaultValue={["nphies"]} className="space-y-3">
        {FRAMEWORKS.map((f) => (
          <AccordionItem key={f.id} value={f.id} className="rounded-xl border border-border bg-card px-4">
            <AccordionTrigger className="text-left text-sm font-semibold hover:no-underline">{f.name}</AccordionTrigger>
            <AccordionContent>
              <p className="text-sm text-muted-foreground">{f.scope}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                <strong>How sure am I:</strong> {f.confidence}
                {f.source ? ` Source: ${f.source}.` : ""}
              </p>
              <Table className="mt-3">
                <thead>
                  <tr>
                    <Th>Requirement</Th>
                    <Th>How the app addresses it</Th>
                    <Th>Status</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {f.controls.map((c) => (
                    <tr key={c.id}>
                      <Td className="max-w-[340px]">{c.requirement}</Td>
                      <Td className="max-w-[360px] text-muted-foreground">{c.how}</Td>
                      <Td><Badge tone={tone[c.status]}>{c.status}</Badge></Td>
                      <Td className="text-right">{c.where && <Button size="sm" onClick={() => navigate(c.where!)}>Open</Button>}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
