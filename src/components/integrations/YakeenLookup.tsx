import * as React from "react";
import { Fingerprint } from "lucide-react";
import { Segmented } from "@/components/emr/entry-ui";
import { Badge, Button, Field, Input, cn } from "@/components/ui/primitives";
import { fmtDate } from "@/lib/format";
import { ID_TYPE_LABEL, fullName, yakeenLookup, type IdType, type YakeenIdentity } from "@/lib/integrations/yakeen";

/**
 * Check a person with Yakeen: ID type, number and date of birth, then the identity that came back.
 * `onUse` adds a "Use These Details" button, for a registration form that wants to fill itself from the result.
 */

const TYPE_OPTIONS = (Object.keys(ID_TYPE_LABEL) as IdType[]).map((v) => ({ value: v, label: ID_TYPE_LABEL[v] }));

export function YakeenLookup({ onUse, initial, className }: {
  onUse?: (person: YakeenIdentity) => void;
  initial?: { idType?: IdType; idNumber?: string; dob?: string };
  className?: string;
}) {
  const [idType, setIdType] = React.useState<IdType>(initial?.idType ?? "national-id");
  const [idNumber, setIdNumber] = React.useState(initial?.idNumber ?? "");
  const [dob, setDob] = React.useState(initial?.dob ?? "");
  const [errors, setErrors] = React.useState<string[]>([]);
  const [person, setPerson] = React.useState<YakeenIdentity | null>(null);

  function verify(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation(); // this form may sit inside the registration form
    const res = yakeenLookup({ idType, idNumber, dob });
    setPerson(res.ok ? res.value : null);
    setErrors(res.ok ? [] : res.errors);
  }
  const edit = <T,>(set: (v: T) => void) => (v: T) => { set(v); setErrors([]); setPerson(null); };

  return (
    <div className={cn("space-y-4", className)}>
      <form onSubmit={verify} className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_auto]">
        <Field label="ID Type" group>
          <Segmented label="ID type" value={idType} options={TYPE_OPTIONS} onChange={edit(setIdType)} />
        </Field>
        <Field label={`${ID_TYPE_LABEL[idType]} Number`} required hint={idType === "national-id" ? "10 digits, starts with 1." : "10 digits, starts with 2."}>
          <Input inputMode="numeric" autoComplete="off" maxLength={10} value={idNumber} onChange={(e) => edit(setIdNumber)(e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Field label="Date Of Birth" required hint="Gregorian calendar.">
          <Input type="date" value={dob} max={new Date().toISOString().slice(0, 10)} onChange={(e) => edit(setDob)(e.target.value)} />
        </Field>
        {/* The labels above the other fields are 1.25rem plus the gap: keep the button level with the boxes. */}
        <Button type="submit" variant="primary" className="h-10 sm:mt-[1.625rem]"><Fingerprint className="size-4" aria-hidden="true" /> Verify</Button>
      </form>

      {errors.length > 0 && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/8 px-3 py-2 text-sm text-destructive">
          {errors.map((m) => <p key={m}>{m}</p>)}
        </div>
      )}

      {person && (
        <section aria-label="Yakeen result" className="glass-row rounded-xl p-4">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
            <div className="min-w-0">
              <p className="text-base font-semibold">{fullName(person.nameEn)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{ID_TYPE_LABEL[person.idType]} {person.idNumber}</p>
            </div>
            <p lang="ar" dir="rtl" className="text-lg font-semibold leading-snug">{fullName(person.nameAr)}</p>
          </div>
          <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Sex">{person.sex === "M" ? "Male" : "Female"}</Fact>
            <Fact label="Date Of Birth" sub={person.dobHijri}>{fmtDate(person.dob)}</Fact>
            <Fact label="Nationality">{person.nationalityLabel}</Fact>
            <Fact label="ID Expiry" sub={person.idExpiryHijri}>{fmtDate(person.idExpiry)}</Fact>
            <Fact label="National Address" className="sm:col-span-2 lg:col-span-4" sub={`Short address ${person.address.shortAddress}, from Saudi Post`}>
              {person.address.buildingNumber} {person.address.street}, {person.address.district}, {person.address.city} {person.address.postalCode}, additional number {person.address.additionalNumber}
            </Fact>
          </dl>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-3">
            <Badge tone="ok">Verified By Yakeen</Badge>
            {onUse && <Button variant="primary" onClick={() => onUse(person)}>Use These Details</Button>}
          </div>
        </section>
      )}
    </div>
  );
}

function Fact({ label, sub, className, children }: { label: string; sub?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
      {sub && <dd className="text-xs text-muted-foreground">{sub}</dd>}
    </div>
  );
}
