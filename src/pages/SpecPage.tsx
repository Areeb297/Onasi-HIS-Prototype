import { EventBadge, ReqChip } from "@/components/badges";
import { Badge, Button, Card, CardHeader, PageHeader, Table, Td, Th } from "@/components/ui/primitives";
import { navigate } from "@/lib/router";
import { EVENTS, OPEN_QUESTIONS, STANDARD_SEGMENTS, eventLabel } from "@/lib/spec";

export function SpecPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Segment Table"
        subtitle="What NPHIES expects in each ADT message. HL7 v2.5.1 ADT messages, sent on the standard event triggers. PV1 is required in every message. Patient demographics are not processed or stored by NPHIES."
      />

      <Card>
        <CardHeader title="Segments by Event" subtitle="R is required, O is optional, - means the segment must not be present, I means nphies ignores it." />
        <Table>
          <thead>
            <tr>
              <Th>Event</Th>
              <Th>Name</Th>
              {STANDARD_SEGMENTS.map((s) => <Th key={s} className="text-center">{s}</Th>)}
              <Th />
            </tr>
          </thead>
          <tbody>
            {EVENTS.map((e) => (
              <tr key={e.id} className="hover:bg-muted/40">
                <Td><EventBadge id={e.id} /></Td>
                <Td>
                  <div className="font-medium">{e.name}</div>
                  {e.pdfName && <div className="text-xs text-muted-foreground">PDF: {e.pdfName}</div>}
                </Td>
                {STANDARD_SEGMENTS.map((s) => (
                  <Td key={s} className="text-center">
                    <ReqChip req={e.segments[s]} />
                  </Td>
                ))}
                <Td className="text-right">
                  <Button size="sm" onClick={() => navigate(`/event/${e.id}`)}>Open</Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="px-4 py-3 text-xs text-muted-foreground">
          A45 and A50 have a MERGE_INFO group: MRG, then PV1, in that order. A04 and A08 require PV1. The A08 CNHI variant adds the Z-segments ZPV1, ZDG1 and ZPR1.
        </p>
      </Card>

      <Card>
        <CardHeader title="Scenarios" subtitle="Use case, workflow in the HIS and purpose for each event (from the PDF)." />
        <Table>
          <thead>
            <tr><Th>Event</Th><Th>Use Case</Th><Th>Workflow in the HIS</Th><Th>Purpose</Th></tr>
          </thead>
          <tbody>
            {EVENTS.map((e) => (
              <tr key={e.id}>
                <Td><EventBadge id={e.id} /></Td>
                <Td className="font-medium">{e.useCase}</Td>
                <Td className="text-muted-foreground">{e.workflow}</Td>
                <Td className="text-muted-foreground">{e.purpose}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card>
        <CardHeader title="Open Questions" subtitle="Things in the brief that still need a decision. The app uses the choice shown." />
        <ul className="list-disc space-y-2 px-8 py-4 text-sm">
          {OPEN_QUESTIONS.map((q) => <li key={q}>{q}</li>)}
        </ul>
      </Card>
    </div>
  );
}
