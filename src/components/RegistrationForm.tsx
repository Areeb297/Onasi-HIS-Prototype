import * as React from "react";
import { BedDouble, CircleCheck, CreditCard, IdCard, Printer, Search, Siren, Stethoscope, TriangleAlert, Upload, UserPlus } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { ErQuickRegistration } from "@/components/ErQuickRegistration";
import { PatientFlagBadges, PatientNameAr } from "@/components/PatientBanner";
import { WristbandDialog } from "@/components/Wristband";
import { Badge, Button, Card, Field, Input, RequiredNote, Select, cn } from "@/components/ui/primitives";
import { quickCreate, type Outcome } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { useDevMode } from "@/lib/devmode";
import { ARRIVAL_MODES, startEd } from "@/lib/ed";
import type { EdData, PatientExtra } from "@/lib/model";
import { COMPLAINT_SAMPLES, DOCTORS, MARITAL, NATIONALITIES, SERVICES, countryCode as nationalityCode, countryLabel } from "@/lib/reference-data";
import {
  DUPLICATE_REASON_LABEL, INTERPRETER_LANGUAGES, ageLabel, buildFlags, coverageOutcome, findDuplicates, validateRegistration,
  type CoverageOutcome, type DuplicateMatch, type RegField, type VisitChoice,
} from "@/lib/registration";
import { hijri, isExpired, lookupById, retrieveIdCard, retrieveInsurance, REGISTRY, type IdCard as IdCardData, type InsuranceCard } from "@/lib/registry";
import { navigate } from "@/lib/router";
import { bedLabel, freeBeds, nextHealthId, nowLocal, patientName, registerPatient, useHis } from "@/lib/store";
import { pushToast } from "@/lib/toast";

type Lang = "en" | "ar";

const RELIGIONS = ["Islam", "Christianity", "Hinduism", "Buddhism", "Other"];
const BLOOD = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const SOCIAL = ["Employee", "Student", "Retired", "Dependent", "Unemployed"];
const ID_TYPES = ["National ID", "Iqama", "Passport", "GCC ID"];
const ISSUERS = ["Ministry of Interior", "Passports Directorate", "Other"];
const ADDRESS_TYPES = ["Home", "Work", "Temporary"];
const FILE_STATUS = ["Regular File", "VIP File", "Temporary File"];

const VISITS: { id: Exclude<VisitChoice, "none">; icon: React.ReactNode; en: string; ar: string; hintEn: string; hintAr: string }[] = [
  { id: "O", icon: <Stethoscope className="size-6" />, en: "Outpatient", ar: "عيادات خارجية", hintEn: "A clinic visit today.", hintAr: "زيارة عيادة اليوم." },
  { id: "I", icon: <BedDouble className="size-6" />, en: "Inpatient", ar: "تنويم", hintEn: "Admit the patient to a bed now.", hintAr: "تنويم المريض على سرير الآن." },
  { id: "E", icon: <Siren className="size-6" />, en: "Emergency", ar: "طوارئ", hintEn: "A visit to the emergency department.", hintAr: "زيارة لقسم الطوارئ." },
];

/** Where each visit type is worked on after registration. */
const AFTER: Record<VisitChoice, { path: string; en: string; ar: string }> = {
  O: { path: "/opd", en: "Go To Outpatient List", ar: "قائمة العيادات" },
  I: { path: "/ipd", en: "Go To Inpatient List", ar: "قائمة التنويم" },
  E: { path: "/er", en: "Go To Emergency Board", ar: "لوحة الطوارئ" },
  none: { path: "/patients", en: "Go To Patient List", ar: "قائمة المرضى" },
};

/** Section card: a heading row at the start of the card, a divider, then the fields. */
function Sec({ title, children, name }: { title: string; children: React.ReactNode; name?: string }) {
  return (
    <Card className="mt-6 shadow-xs">
      <header className="flex items-center gap-2.5 border-b border-border px-4 py-3 sm:px-5">
        <span aria-hidden="true" className="h-4 w-1 shrink-0 rounded-full bg-primary" />
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
      </header>
      <div data-field={name} className="px-4 py-5 sm:px-5">{children}</div>
    </Card>
  );
}

/** A named group of fields inside a section, such as the English name and the Arabic name. */
function Group({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div role="group" aria-label={title} className={cn("min-w-0", className)}>
      <div aria-hidden="true" className="mb-3 text-sm font-semibold text-foreground">{title}</div>
      {children}
    </div>
  );
}

const Grid = ({ children, cols = 4 }: { children: React.ReactNode; cols?: 2 | 3 | 4 }) => (
  <div className={cn("grid gap-x-4 gap-y-5", cols === 4 && "sm:grid-cols-2 lg:grid-cols-4", cols === 3 && "sm:grid-cols-3", cols === 2 && "sm:grid-cols-2")}>{children}</div>
);

/** A form field that can show its problem right under the input. `name` lets the summary at the top jump to it. */
function FF({ name, error, children, ...field }: { name?: RegField; error?: string } & React.ComponentProps<typeof Field>) {
  return (
    <div data-field={name} className="min-w-0">
      <Field {...field}>
        {children}
        {error && <span role="alert" className="text-xs font-medium leading-snug text-destructive">{error}</span>}
      </Field>
    </div>
  );
}

interface CardFile {
  name: string;
  /** Preview address for a picture. It lives in the memory of this browser tab only. */
  url?: string;
}

/** Upload or scan slot for a card. The file is not sent anywhere: only its name and a preview are kept while the form is open. */
function CardUpload({ title, value, onChange, t }: { title: string; value: CardFile | null; onChange: (f: CardFile | null) => void; t: (en: string, ar: string) => string }) {
  const input = React.useRef<HTMLInputElement>(null);
  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (value?.url) URL.revokeObjectURL(value.url);
    onChange({ name: f.name, url: f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined });
  }
  function remove() {
    if (value?.url) URL.revokeObjectURL(value.url);
    onChange(null);
  }
  return (
    <div className="mt-4 rounded-lg border border-dashed border-input p-3">
      <div className="text-sm font-medium">{title}</div>
      <p className="mt-0.5 text-xs text-muted-foreground">{t("A photo or a PDF. It stays on this computer and is not sent anywhere.", "صورة أو ملف PDF. يبقى على هذا الجهاز ولا يرسل إلى أي مكان.")}</p>
      {value && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {value.url
            ? <img src={value.url} alt={t("Preview of the uploaded card", "معاينة البطاقة المرفوعة")} className="h-20 w-32 rounded-md border border-border object-cover" />
            : <span className="flex h-20 w-32 items-center justify-center rounded-md border border-border bg-muted text-xs text-muted-foreground">{t("No preview", "لا توجد معاينة")}</span>}
          <span className="min-w-0 break-all text-sm" dir="ltr">{value.name}</span>
        </div>
      )}
      <input ref={input} type="file" accept="image/*,application/pdf" className="sr-only" tabIndex={-1} aria-label={title} onChange={pick} />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={() => input.current?.click()}><Upload className="size-4" />{value ? t("Replace File", "استبدال الملف") : t("Upload Or Scan", "رفع أو مسح ضوئي")}</Button>
        {value && <Button onClick={remove}>{t("Remove File", "حذف الملف")}</Button>}
      </div>
    </div>
  );
}

/** The payer answer in a box: green when covered, amber for a warning, red when the visit is not covered. */
function CoverageBox({ outcome, ar, children }: { outcome: CoverageOutcome; ar: boolean; children?: React.ReactNode }) {
  return (
    <div role="status" className={cn("mt-3 max-w-xl rounded-lg border px-3 py-2.5 text-sm", outcome.blocking ? "border-destructive/50 bg-destructive/10" : outcome.warning ? "border-warn/50 bg-warn/10" : "border-ok/40 bg-ok/10")}>
      <div className="flex items-center gap-2 font-semibold">
        {outcome.blocking || outcome.warning ? <TriangleAlert className="size-4 shrink-0" /> : <CircleCheck className="size-4 shrink-0" />}
        {ar ? outcome.titleAr : outcome.title}
      </div>
      <p className="mt-1">{ar ? outcome.textAr : outcome.text}</p>
      {children}
    </div>
  );
}

interface Saved {
  patientId: string;
  visitNumber?: string;
  visit: VisitChoice;
  /** The visit was added to a patient who already had a file. */
  existing: boolean;
  /** The patient was saved but the visit could not be started. */
  visitFailed: boolean;
}

/** How the save continues after a question to the clerk. */
interface Pending {
  /** Start the visit on this patient, who already has a file, and do not create a new file. */
  existingId?: string;
  /** Why the clerk registered a new file although a possible duplicate was shown. */
  dupReason?: string;
  /** File numbers of the possible duplicates that were shown, for the audit trail. */
  dupFiles?: string;
}

function FullRegistrationForm({ cls = "O", onAgain }: { cls?: "O" | "E"; onAgain: () => void }) {
  const dev = useDevMode();
  const state = useHis();
  const [lang, setLang] = React.useState<Lang>("en");
  const ar = lang === "ar";
  const t = (en: string, a: string) => (ar ? a : en);
  const today = nowLocal().slice(0, 10);
  const n = state.counters.patient + 1;

  // Visit
  const [visit, setVisit] = React.useState<VisitChoice>(cls === "E" ? "E" : "O");
  const [attending, setAttending] = React.useState(DOCTORS[0].id);
  const [referring, setReferring] = React.useState("");
  const [service, setService] = React.useState(cls === "E" ? "ER" : "OPD");
  const [reason, setReason] = React.useState("");
  const [arrival, setArrival] = React.useState<EdData["arrivalMode"]>("Walk-in");
  const [bedId, setBedId] = React.useState("");
  // Names
  const [first, setFirst] = React.useState("");
  const [second, setSecond] = React.useState("");
  const [third, setThird] = React.useState("");
  const [family, setFamily] = React.useState("");
  const [firstAr, setFirstAr] = React.useState("");
  const [secondAr, setSecondAr] = React.useState("");
  const [thirdAr, setThirdAr] = React.useState("");
  const [familyAr, setFamilyAr] = React.useState("");
  // File
  const [regDate, setRegDate] = React.useState(today);
  const [payType, setPayType] = React.useState<"Cash" | "Insurance">("Cash");
  // Demographics
  const [nationality, setNationality] = React.useState("SAU");
  const [sex, setSex] = React.useState<"M" | "F">("M");
  const [marital, setMarital] = React.useState("S");
  const [religion, setReligion] = React.useState("Islam");
  const [blood, setBlood] = React.useState("");
  const [fileStatus, setFileStatus] = React.useState(FILE_STATUS[0]);
  const [social, setSocial] = React.useState("");
  const [dob, setDob] = React.useState("");
  const [birthPlace, setBirthPlace] = React.useState("");
  const [occupation, setOccupation] = React.useState("");
  const [employeeNo, setEmployeeNo] = React.useState("");
  // ID and address
  const [idType, setIdType] = React.useState("National ID");
  const [idNumber, setIdNumber] = React.useState("");
  const [issuer, setIssuer] = React.useState("");
  const [idIssue, setIdIssue] = React.useState("");
  const [idExpiry, setIdExpiry] = React.useState("");
  const [copyNo, setCopyNo] = React.useState("");
  const [addressType, setAddressType] = React.useState("Home");
  const [addressText, setAddressText] = React.useState("");
  const [shortCode, setShortCode] = React.useState("");
  // Contact
  const [homePhone, setHomePhone] = React.useState("");
  const [mobile, setMobile] = React.useState("");
  const [countryCode, setCountryCode] = React.useState("+966");
  const [areaCode, setAreaCode] = React.useState("");
  const [otherPhone, setOtherPhone] = React.useState("");
  const [relName, setRelName] = React.useState("");
  const [relPhone, setRelPhone] = React.useState("");
  const [email, setEmail] = React.useState("");
  // Flags
  const [dnr, setDnr] = React.useState(false);
  const [dnrDoctor, setDnrDoctor] = React.useState("");
  const [dnrDate, setDnrDate] = React.useState("");
  const [interpreter, setInterpreter] = React.useState(false);
  const [language, setLanguage] = React.useState("");
  const [fallRisk, setFallRisk] = React.useState(false);
  const [isolation, setIsolation] = React.useState(false);
  // Registry, cards
  const [healthId, setHealthId] = React.useState("");
  const [found, setFound] = React.useState<"" | "found" | "none">("");
  const [ins, setIns] = React.useState<InsuranceCard | null>(null);
  /** The coverage check was run for this ID number. */
  const [checked, setChecked] = React.useState(false);
  /** The clerk chose to go on as a cash patient after a check that did not cover the visit. */
  const [cashChosen, setCashChosen] = React.useState(false);
  const [fixNote, setFixNote] = React.useState(false);
  const [idCard, setIdCard] = React.useState<IdCardData | null>(null);
  const [archive, setArchive] = React.useState<NonNullable<PatientExtra["archive"]>>([]);
  const [idFile, setIdFile] = React.useState<CardFile | null>(null);
  const [insFile, setInsFile] = React.useState<CardFile | null>(null);
  const [consent, setConsent] = React.useState(false);
  // Saving
  const [showErrors, setShowErrors] = React.useState(false);
  const [failedSaves, setFailedSaves] = React.useState(0);
  const [dups, setDups] = React.useState<DuplicateMatch[] | null>(null);
  const [dupReason, setDupReason] = React.useState("");
  const [coverageAsk, setCoverageAsk] = React.useState<CoverageOutcome | null>(null);
  const pending = React.useRef<Pending>({});
  const [saved, setSaved] = React.useState<Saved | null>(null);
  const [band, setBand] = React.useState(false);
  const summary = React.useRef<HTMLDivElement>(null);

  // The previews live in the memory of this tab. Let them go when the form closes.
  const files = React.useRef<(CardFile | null)[]>([]);
  files.current = [idFile, insFile];
  React.useEffect(() => () => { for (const f of files.current) if (f?.url) URL.revokeObjectURL(f.url); }, []);

  // After a save that found problems, bring the list of problems into view.
  React.useEffect(() => {
    if (!failedSaves) return;
    summary.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    summary.current?.focus({ preventScroll: true });
  }, [failedSaves]);

  const beds = freeBeds(state);
  const outcome = checked ? coverageOutcome(ins, today) : null;
  /** A "no insurance" answer matters only when the clerk asked for an insurance visit. */
  const stops = (o: CoverageOutcome | null, pay: string) => !!o && o.blocking && (o.kind !== "no-insurance" || pay === "Insurance");
  const needsChoice = visit !== "none" && stops(outcome, payType) && !cashChosen;

  function chooseVisit(v: VisitChoice) {
    setVisit(v);
    if (v === "O") setService("OPD");
    if (v === "E") setService("ER");
    if (v === "I") setService(DOCTORS.find((d) => d.id === attending)?.service ?? "MED");
  }

  function clearCoverage() {
    setIns(null); setChecked(false); setCashChosen(false); setFixNote(false);
  }

  function lookup(id = idNumber) {
    const p = lookupById(id);
    if (!p) {
      setFound("none");
      return;
    }
    setFound("found");
    setIdType(p.idType);
    setFirst(p.first); setSecond(p.second); setThird(p.third); setFamily(p.family);
    setFirstAr(p.firstAr); setSecondAr(p.secondAr); setThirdAr(p.thirdAr); setFamilyAr(p.familyAr);
    setDob(p.dob); setSex(p.sex); setNationality(nationalityCode(p.nationality) || "999"); setMarital(p.maritalStatus);
    setReligion(p.religion); setBlood(p.bloodGroup); setHealthId(p.healthId); setMobile(p.mobile);
    setShortCode(p.address); setOccupation(p.occupation); setBirthPlace(p.idCard.placeOfBirth);
    audit("view", "National registry lookup", { detail: `ID ${id.slice(0, 3)}*******` });
  }

  function onIdChange(v: string) {
    const digits = v.replace(/\D/g, "").slice(0, 10);
    if (digits !== idNumber) { clearCoverage(); setIdCard(null); }
    setIdNumber(digits);
    setFound("");
    if (digits.length === 10) lookup(digits);
  }

  /** The coverage check. The answer is shown in plain words, and a visit that is not covered waits for the clerk to choose. */
  function runCoverageCheck(): { card: InsuranceCard | null; outcome: CoverageOutcome } {
    const card = retrieveInsurance(idNumber) ?? null;
    const o = coverageOutcome(card, today);
    setIns(card); setChecked(true); setCashChosen(false); setFixNote(false);
    audit("view", "Insurance eligibility check", { detail: card ? `${card.payer}: ${o.title}` : o.title });
    return { card, outcome: o };
  }

  function retrieveInsuranceCard() {
    const { card, outcome: o } = runCoverageCheck();
    if (!card) {
      pushToast({ tone: "warn", text: "No insurance found for this ID.", detail: "The payment type stays Cash." });
      setPayType("Cash");
      return;
    }
    // Insurance is chosen for the clerk only when the payer covers the visit. Otherwise the clerk decides below.
    if (!o.blocking) setPayType("Insurance");
  }

  function changePayType(v: "Cash" | "Insurance") {
    setPayType(v);
    if (v === "Insurance") setCashChosen(false);
  }

  function recordChoice(o: CoverageOutcome, choice: "cash" | "fix") {
    audit("update", "Coverage decision at registration", {
      patient: `${first.trim()} ${family.trim()}`.trim() || undefined,
      detail: `${o.title}. ${choice === "cash" ? "Clerk chose Continue As Cash Patient." : "Clerk chose Fix Coverage. The visit was not saved."}`,
    });
  }

  function chooseCash(o: CoverageOutcome) {
    recordChoice(o, "cash");
    setCashChosen(true); setFixNote(false); setPayType("Cash");
  }

  function chooseFix(o: CoverageOutcome) {
    recordChoice(o, "fix");
    setFixNote(true); setCoverageAsk(null);
    goTo("coverage");
  }

  function retrieveIdentityCard() {
    const c = retrieveIdCard(idNumber);
    if (!c) {
      pushToast({ tone: "warn", text: "No ID card found for this number." });
      return;
    }
    setIdCard(c);
    setIdType(c.idType); setIssuer(c.issuer); setIdIssue(c.issueDate); setIdExpiry(c.expiryDate); setCopyNo(c.copyNo); setBirthPlace(c.placeOfBirth);
  }

  const problems = validateRegistration({
    idNumber, healthId, first, family, dob, mobile, email, shortCode, consent, visit, bedId, dnr, dnrDoctor, dnrDate, interpreter, language, today,
  });
  const errs: Partial<Record<RegField, string>> = {};
  for (const p of problems) {
    // The short address is checked while typing. The other fields wait for the first save.
    if ((showErrors || p.field === "shortCode") && !errs[p.field]) errs[p.field] = ar ? p.messageAr : p.message;
  }
  const warnings: string[] = [];
  if (idExpiry && isExpired(idExpiry)) warnings.push(t("The ID has expired.", "الهوية منتهية."));

  function goTo(name: string) {
    const el = document.querySelector<HTMLElement>(`[data-field="${name}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    el?.querySelector<HTMLElement>("input:not([type=file]), select, textarea, button")?.focus({ preventScroll: true });
  }

  function createVisit(patientId: string): Outcome {
    if (visit === "I") return quickCreate("A01", { patientId, attending, service, reason, referring, bedId, admitClass: "I" });
    const out = quickCreate("A04", { patientId, attending, service: visit === "E" ? "ER" : service, reason, referring, cls: visit === "E" ? "E" : "O" });
    if (visit === "E" && out.entry) startEd(out.entry.visitNumber, arrival);
    return out;
  }

  /** Save in steps: form checks, then the duplicate check, then the coverage choice, then the patient file and the visit. */
  function trySave(p: Pending = {}, opts: { cash?: boolean } = {}) {
    setShowErrors(true);
    if (problems.length) { setFailedSaves((x) => x + 1); return; }

    if (!p.existingId && !p.dupReason) {
      const matches = findDuplicates({ idNumber, healthId, given: first, family, givenAr: firstAr, familyAr, dob, mobile }, state.patients);
      if (matches.length) { setDupReason(""); setDups(matches); return; }
    }

    let card = ins;
    let o = outcome;
    // An insurance visit is never saved without asking the payer first.
    if (visit !== "none" && payType === "Insurance" && !checked) ({ card, outcome: o } = runCoverageCheck());
    const cash = opts.cash || (cashChosen && o === outcome);
    if (visit !== "none" && o && stops(o, payType) && !cash) {
      pending.current = p;
      setDups(null);
      setCoverageAsk(o);
      return;
    }
    commit(p, card, o);
  }

  function commit(p: Pending, card: InsuranceCard | null, o: CoverageOutcome | null) {
    const flags = buildFlags({
      dnr, dnrDoctor: DOCTORS.filter((d) => d.id === dnrDoctor).map((d) => `Dr. ${d.given} ${d.family}`)[0] ?? "", dnrDate, interpreter, language, fallRisk, isolation,
    });
    // A visit the payer does not cover is a cash visit. The clerk has already agreed to that above.
    const pay = o?.blocking ? "Cash" : payType;
    let patientId = p.existingId ?? "";
    if (!patientId) {
      const extra: PatientExtra = {
        secondName: second.trim(), thirdName: third.trim(),
        nameAr: { first: firstAr.trim(), second: secondAr.trim(), third: thirdAr.trim(), family: familyAr.trim() },
        religion, bloodGroup: blood, fileStatus, socialStatus: social, placeOfBirth: birthPlace, occupation, employeeNo,
        idType, idNumber, idIssuer: issuer, idIssueDate: idIssue, idExpiry, idCopyNo: copyNo, addressType, addressText,
        homePhone, mobile, otherPhone, countryCode, areaCode, relationName: relName, relationPhone: relPhone, email,
        mainFileNo: `MF-${1000 + n}`, registrationNo: `REG-${today.slice(0, 4)}-${1000 + n}`, visitPayType: pay,
        insurance: card ?? undefined, archive, flags,
        coverageDecision: o?.blocking && visit !== "none" && stops(o, payType) ? `${o.title}. Continued as a cash patient.` : undefined,
      };
      const created = registerPatient({
        healthId: healthId.trim(), given: first.trim(), family: family.trim(), dob, sex, nationality, maritalStatus: marital,
        address: shortCode, consentAt: new Date().toISOString(), extra,
      });
      patientId = created.id;
      const flagWords = [flags?.dnr && "Do Not Resuscitate", flags?.isolation && "Isolation", flags?.fallRisk && "Fall Risk", flags?.interpreter && "Needs Interpreter"].filter(Boolean).join(", ");
      audit("create", `Patient file ${created.mrn}`, { patient: patientName(created), detail: `Registered. Payment: ${pay}.${flagWords ? ` Flags: ${flagWords}.` : ""}` });
      if (p.dupReason) {
        audit("create", "Registered as new after duplicate warning", {
          patient: patientName(created),
          detail: `Reason: ${p.dupReason}. Possible matches: ${p.dupFiles || "not listed"}.`,
        });
      }
    }
    else {
      const onFile = state.patients.find((x) => x.id === patientId);
      audit("update", `Patient file ${onFile?.mrn ?? patientId}`, { patient: patientName(onFile), detail: "Duplicate check at registration: the visit was added to the file the patient already had." });
    }
    let visitNumber: string | undefined;
    let visitFailed = false;
    if (visit !== "none") {
      const out = createVisit(patientId);
      visitNumber = out.entry?.visitNumber;
      visitFailed = !out.ok;
    }
    setDups(null); setCoverageAsk(null);
    setSaved({ patientId, visitNumber, visit: visitFailed ? "none" : visit, existing: !!p.existingId, visitFailed });
  }

  const tag = (s: string) => (dev ? s : undefined);
  const hisOnly = tag("HIS only");
  const doctorOptions = DOCTORS.map((d) => <option key={d.id} value={d.id}>Dr. {d.given} {d.family}</option>);
  const saveLabel = visit === "none" ? t("Register Patient", "تسجيل المريض") : visit === "I" ? t("Register And Admit", "تسجيل وتنويم") : t("Register And Start Visit", "تسجيل وبدء الزيارة");

  /* ---------- after saving ---------- */

  if (saved) {
    const patient = state.patients.find((x) => x.id === saved.patientId);
    const after = AFTER[saved.visit];
    const visitWord = VISITS.find((v) => v.id === saved.visit);
    return (
      <div dir={ar ? "rtl" : "ltr"} className="pb-6">
        <Card className="max-w-2xl p-5">
          <div className="flex items-start gap-3">
            <CircleCheck className="mt-0.5 size-6 shrink-0 text-ok" />
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">
                {saved.existing ? t("Visit Started For An Existing Patient", "تم بدء زيارة لمريض مسجل") : saved.visit === "none" ? t("Patient Registered", "تم تسجيل المريض") : t("Patient Registered And Visit Started", "تم تسجيل المريض وبدء الزيارة")}
              </h2>
              {patient && (
                <>
                  <div className="mt-2 text-base font-semibold">{patientName(patient)}</div>
                  <PatientNameAr patient={patient} />
                  <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                    <div><dt className="text-xs text-muted-foreground">{t("File Number (MRN)", "رقم الملف")}</dt><dd className="font-mono font-semibold">{patient.mrn}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">{t("Date of Birth", "تاريخ الميلاد")}</dt><dd>{patient.dob}</dd></div>
                    <div>
                      <dt className="text-xs text-muted-foreground">{t("Visit", "الزيارة")}</dt>
                      <dd>{saved.visitNumber ? <><span className="font-mono">{saved.visitNumber}</span> {visitWord ? `(${ar ? visitWord.ar : visitWord.en})` : ""}</> : t("No visit started", "لم تبدأ زيارة")}</dd>
                    </div>
                  </dl>
                  <PatientFlagBadges patient={patient} detail className="mt-3" />
                </>
              )}
              {saved.visitFailed && (
                <p role="alert" className="mt-3 rounded-md border border-warn/50 bg-warn/10 px-3 py-2 text-sm">
                  {t("The patient file was saved, but the visit could not be started. Start the visit from the worklist.", "تم حفظ ملف المريض لكن تعذر بدء الزيارة. ابدأ الزيارة من قائمة العمل.")}
                </p>
              )}
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => setBand(true)}><Printer className="size-4" />{t("Print Wristband", "طباعة سوار المريض")}</Button>
            <Button onClick={() => navigate(after.path, saved.visit === "none" ? { patient: saved.patientId } : undefined)}>{ar ? after.ar : after.en}</Button>
            <Button onClick={onAgain}><UserPlus className="size-4" />{t("Register Another Patient", "تسجيل مريض آخر")}</Button>
          </div>
        </Card>
        <WristbandDialog patientId={band ? saved.patientId : null} onClose={() => setBand(false)} />
      </div>
    );
  }

  /* ---------- the form ---------- */

  return (
    <div dir={ar ? "rtl" : "ltr"} className="pb-2">
      {/* Language switch and ID lookup */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-start gap-2">
          <FF name="idNumber" error={errs.idNumber} required label={t("ID (Iqama) Number", "رقم الهوية")} hl7={tag("PID-3 via registry")}>
            <Input className="w-full font-mono sm:w-56" value={idNumber} onChange={(e) => onIdChange(e.target.value)} placeholder={t("10 digits", "10 أرقام")} inputMode="numeric" aria-label="ID number" aria-invalid={!!errs.idNumber} dir="ltr" />
          </FF>
          <Button className="mt-[1.625rem] h-10" onClick={() => lookup()} disabled={idNumber.length !== 10}><Search className="size-4" />{t("Look Up Patient", "بحث عن المريض")}</Button>
          <span className="mt-[1.625rem] flex min-h-10 items-center">
            {found === "found" && <Badge tone="ok" className="whitespace-normal leading-tight">{t("Found in the national registry (simulated)", "تم العثور عليه في السجل الوطني (محاكاة)")}</Badge>}
            {found === "none" && <Badge tone="warn" className="whitespace-normal leading-tight">{t("Not found. Enter the details by hand.", "غير موجود. أدخل البيانات يدويا")}</Badge>}
          </span>
        </div>
        <div role="group" aria-label="Language" className="flex rounded-lg border border-border bg-muted p-0.5">
          {(["en", "ar"] as const).map((l) => (
            <button key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l} className={cn("rounded-md px-3 py-1.5 text-sm font-medium", lang === l ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {l === "en" ? "English" : "العربية"}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        {t("Try these test IDs: ", "جرب هذه الأرقام: ")}
        {REGISTRY.map((r) => (
          <button key={r.idNumber} type="button" onClick={() => onIdChange(r.idNumber)} className="me-2 font-mono text-move underline">{r.idNumber}</button>
        ))}
      </p>
      <RequiredNote className="mt-3" />

      {showErrors && problems.length > 0 && (
        <div ref={summary} tabIndex={-1} role="alert" className="mt-4 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <p className="flex items-center gap-2 text-sm font-semibold"><TriangleAlert className="size-4 shrink-0" />{t(problems.length === 1 ? "Fix 1 thing before you save" : `Fix ${problems.length} things before you save`, `أكمل ${problems.length} من الحقول قبل الحفظ`)}</p>
          <ul className="mt-1.5 list-disc space-y-0.5 ps-6 text-sm">
            {problems.map((p) => (
              <li key={p.field}><button type="button" className="text-start underline" onClick={() => goTo(p.field)}>{ar ? p.messageAr : p.message}</button></li>
            ))}
          </ul>
        </div>
      )}

      <Sec title={t("Visit", "الزيارة")}>
        <div role="radiogroup" aria-label={t("What is the patient here for?", "ما سبب حضور المريض؟")}>
          <div className="mb-3 text-sm font-medium">{t("What is the patient here for?", "ما سبب حضور المريض؟")}</div>
          <div className="grid gap-3 sm:grid-cols-3">
            {VISITS.map((v) => (
              <button key={v.id} type="button" role="radio" aria-checked={visit === v.id} onClick={() => chooseVisit(v.id)}
                className={cn("flex min-h-24 items-start gap-3 rounded-xl border-2 p-4 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", visit === v.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/60")}>
                <span className={cn("mt-0.5 shrink-0", visit === v.id ? "text-primary" : "text-muted-foreground")}>{v.icon}</span>
                <span className="min-w-0">
                  <span className="block text-base font-semibold">{ar ? v.ar : v.en}</span>
                  <span className="block text-sm text-muted-foreground">{ar ? v.hintAr : v.hintEn}</span>
                </span>
              </button>
            ))}
          </div>
          <button type="button" role="radio" aria-checked={visit === "none"} onClick={() => chooseVisit("none")}
            className={cn("mt-3 flex w-full items-center gap-3 rounded-xl border-2 px-4 py-2.5 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", visit === "none" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/60")}>
            <UserPlus className={cn("size-5 shrink-0", visit === "none" ? "text-primary" : "text-muted-foreground")} />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{t("No Visit Now", "بدون زيارة الآن")}</span>
              <span className="block text-sm text-muted-foreground">{t("Register the patient only. Start a visit later.", "تسجيل المريض فقط. ابدأ الزيارة لاحقا.")}</span>
            </span>
          </button>
        </div>

        {visit !== "none" && (
          <Group title={visit === "O" ? t("Outpatient Visit", "زيارة العيادات الخارجية") : visit === "I" ? t("Inpatient Admission", "التنويم") : t("Emergency Visit", "زيارة طوارئ")} className="mt-5 border-t border-border pt-5">
            <Grid>
              <Field label={visit === "I" ? t("Admitting Doctor", "الطبيب المنوم") : t("Doctor", "الطبيب")} hl7={tag(visit === "I" ? "PV1-7, PV1-17" : "PV1-7")}>
                <Select value={attending} onChange={(e) => setAttending(e.target.value)}>{doctorOptions}</Select>
              </Field>
              {visit !== "E" && (
                <Field label={visit === "O" ? t("Clinic", "العيادة") : t("Department", "القسم")} hl7={tag("PV1-10")}>
                  <Select value={service} onChange={(e) => setService(e.target.value)}>{SERVICES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}</Select>
                </Field>
              )}
              {visit === "I" && (
                <FF name="bedId" error={errs.bedId} required label={t("Bed", "السرير")} hl7={tag("PV1-3")} hint={beds.length ? undefined : t("No bed is free. Free a bed first.", "لا يوجد سرير شاغر.")}>
                  <Select value={bedId} onChange={(e) => setBedId(e.target.value)} aria-invalid={!!errs.bedId}>
                    <option value="">{t("Select", "اختر")}</option>
                    {beds.map((b) => <option key={b.id} value={b.id}>{b.wardName}, {bedLabel(b.id)}</option>)}
                  </Select>
                </FF>
              )}
              {visit === "E" && (
                <Field label={t("Arrival Mode", "وسيلة الوصول")} hl7={tag("ZPV1-18")}>
                  <Select value={arrival} onChange={(e) => setArrival(e.target.value as EdData["arrivalMode"])}>{ARRIVAL_MODES.map((m) => <option key={m}>{m}</option>)}</Select>
                </Field>
              )}
              <Field label={t("Referring Doctor", "الطبيب المحول")} hl7={tag("PV1-8")}>
                <Select value={referring} onChange={(e) => setReferring(e.target.value)}><option value="">{t("None", "لا يوجد")}</option>{doctorOptions}</Select>
              </Field>
              <Field label={visit === "I" ? t("Reason for Admission", "سبب التنويم") : t("Reason for Visit", "سبب الزيارة")} hl7={tag("PV2-12")}><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            </Grid>
            <div className="mt-4 flex flex-wrap gap-2">{COMPLAINT_SAMPLES.map((c) => <button key={c.code} type="button" onClick={() => setReason(c.text)} className="rounded-md border border-border bg-muted px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent">{c.text}</button>)}</div>
            {dev && <p className="mt-3 text-xs text-muted-foreground">{visit === "I" ? "Saving sends ADT A01 with patient class I." : `Saving sends ADT A04 with patient class ${visit}.`} Registering with no visit sends nothing: NPHIES has no message for a patient file alone.</p>}
          </Group>
        )}
      </Sec>

      <Sec title={t("Patient Name", "إسم المريض")}>
        <Group title={t("Name (English)", "الإسم بالإنجليزية")}>
          <Grid>
            <FF name="first" error={errs.first} required label="First" hl7={tag("PID-5.2")}><Input value={first} onChange={(e) => setFirst(e.target.value)} dir="ltr" aria-invalid={!!errs.first} /></FF>
            <Field label="Father" hl7={tag("PID-5.3")}><Input value={second} onChange={(e) => setSecond(e.target.value)} dir="ltr" /></Field>
            <Field label="Grandfather" hl7={tag("PID-5.3")}><Input value={third} onChange={(e) => setThird(e.target.value)} dir="ltr" /></Field>
            <FF name="family" error={errs.family} required label="Family" hl7={tag("PID-5.1")}><Input value={family} onChange={(e) => setFamily(e.target.value)} dir="ltr" aria-invalid={!!errs.family} /></FF>
          </Grid>
        </Group>
        <Group title={t("Name (Arabic)", "الإسم بالعربي")} className="mt-5 border-t border-border pt-5">
          <div dir="rtl">
            <Grid>
              <Field label={t("First (Arabic)", "الأول")} hl7={hisOnly}><Input value={firstAr} onChange={(e) => setFirstAr(e.target.value)} dir="rtl" lang="ar" /></Field>
              <Field label={t("Father (Arabic)", "الأب")} hl7={hisOnly}><Input value={secondAr} onChange={(e) => setSecondAr(e.target.value)} dir="rtl" lang="ar" /></Field>
              <Field label={t("Grandfather (Arabic)", "الجد")} hl7={hisOnly}><Input value={thirdAr} onChange={(e) => setThirdAr(e.target.value)} dir="rtl" lang="ar" /></Field>
              <Field label={t("Family (Arabic)", "لقب العائلة")} hl7={hisOnly}><Input value={familyAr} onChange={(e) => setFamilyAr(e.target.value)} dir="rtl" lang="ar" /></Field>
            </Grid>
          </div>
          {dev && <p className="mt-3 text-xs text-muted-foreground">Assumption: the NPHIES ADT pages do not say how to send an Arabic name, so it stays in the HIS and PID-5 carries the English name.</p>}
        </Group>
      </Sec>

      <Sec title={t("File Information", "بيانات ملف")}>
        <Grid>
          <Field label={t("Main File No.", "الملف الرئيسي")} hl7={hisOnly}><Input value={`MF-${1000 + n}`} disabled /></Field>
          <Field label={t("File Number", "رقم الملف")} hl7={tag("PID-3 (MRN not sent)")}><Input value={`MRN${String(100 + n).padStart(7, "0")}`} disabled /></Field>
          <Field label={t("Registration No.", "رقم التسجيل")} hl7={hisOnly}><Input value={`REG-${today.slice(0, 4)}-${1000 + n}`} disabled /></Field>
          <Field label={t("Payment Type", "طريقة الدفع")} hl7={tag("Financial")}>
            <Select value={payType} onChange={(e) => changePayType(e.target.value as "Cash" | "Insurance")}>
              <option value="Cash">{t("Cash", "نقدي")}</option>
              <option value="Insurance">{t("Insurance", "تأمين")}</option>
            </Select>
          </Field>
          <Field label={t("Registration Date", "ت.التسجيل")} hl7={tag("PV1-44")}><Input type="date" value={regDate} onChange={(e) => setRegDate(e.target.value)} /></Field>
          <Field label={t("Registration Date (Hijri)", "التاريخ الهجري")}><Input value={hijri(regDate)} disabled dir="ltr" /></Field>
        </Grid>
      </Sec>

      <Sec title={t("Demographic Details", "بيانات تفصيلية")}>
        <Grid>
          <FF name="dob" error={errs.dob} required label={t("Date of Birth", "ت الميلاد")} hl7={tag("PID-7")}><Input type="date" value={dob} max={today} onChange={(e) => setDob(e.target.value)} aria-invalid={!!errs.dob} /></FF>
          <Field label={t("Date of Birth (Hijri)", "تاريخ الميلاد الهجري")} hint={t("Filled from the date of birth.", "يملأ من تاريخ الميلاد.")}><Input value={hijri(dob)} disabled dir="ltr" /></Field>
          <Field label={t("Age", "العمر")} hint={t("Worked out from the date of birth.", "يحسب من تاريخ الميلاد.")}><Input value={ageLabel(dob)} disabled /></Field>
          <Field label={t("Gender", "النوع")} hl7={tag("PID-8")}>
            <Select value={sex} onChange={(e) => setSex(e.target.value as "M" | "F")}><option value="M">{t("Male", "ذكر")}</option><option value="F">{t("Female", "أنثى")}</option></Select>
          </Field>
          <Field label={t("Nationality", "الجنسية")} hl7={tag("PID-28")}>
            <Select value={nationality} onChange={(e) => setNationality(e.target.value)}>{!NATIONALITIES.some((x) => x.code === nationality) && <option value={nationality}>{countryLabel(nationality) || nationality}</option>}{NATIONALITIES.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}</Select>
          </Field>
          <Field label={t("Marital Status", "الحالة الإجتماعية")} hl7={tag("PID-16")}>
            <Select value={marital} onChange={(e) => setMarital(e.target.value)}>{MARITAL.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}</Select>
          </Field>
          <Field label={t("Religion", "الديانة")} hl7={tag("PID-17 ignored by nphies")}>
            <Select value={religion} onChange={(e) => setReligion(e.target.value)}>{RELIGIONS.map((x) => <option key={x}>{x}</option>)}</Select>
          </Field>
          <Field label={t("Blood Group", "فصيلة الدم")} hl7={hisOnly}>
            <Select value={blood} onChange={(e) => setBlood(e.target.value)}><option value="">{t("Select", "اختر")}</option>{BLOOD.map((x) => <option key={x}>{x}</option>)}</Select>
          </Field>
          <Field label={t("File Status", "حالة الملف")} hl7={hisOnly}>
            <Select value={fileStatus} onChange={(e) => setFileStatus(e.target.value)}>{FILE_STATUS.map((x) => <option key={x}>{x}</option>)}</Select>
          </Field>
          <Field label={t("Social Status", "الحالة الوظيفية")} hl7={hisOnly}>
            <Select value={social} onChange={(e) => setSocial(e.target.value)}><option value="">{t("Select", "اختر")}</option>{SOCIAL.map((x) => <option key={x}>{x}</option>)}</Select>
          </Field>
          <Field label={t("Place of Birth", "محل الميلاد")} hl7={hisOnly}><Input value={birthPlace} onChange={(e) => setBirthPlace(e.target.value)} /></Field>
          <Field label={t("Occupation", "الوظيفة")} hl7={hisOnly}><Input value={occupation} onChange={(e) => setOccupation(e.target.value)} /></Field>
          <Field label={t("Employee No.", "الرقم الوظيفي")} hl7={hisOnly}><Input value={employeeNo} onChange={(e) => setEmployeeNo(e.target.value)} /></Field>
        </Grid>
      </Sec>

      <Sec title={t("ID and Address Details", "بيانات هوية")}>
        <Grid>
          <Field label={t("ID Type", "نوع الهوية")} hl7={hisOnly}><Select value={idType} onChange={(e) => setIdType(e.target.value)}>{ID_TYPES.map((x) => <option key={x}>{x}</option>)}</Select></Field>
          <Field label={t("Issuing Authority", "جهة الإصدار")} hl7={hisOnly}><Select value={issuer} onChange={(e) => setIssuer(e.target.value)}><option value="">{t("Select", "اختر")}</option>{ISSUERS.map((x) => <option key={x}>{x}</option>)}</Select></Field>
          <Field label={t("ID Issue Date", "تاريخ الإصدار")} hl7={hisOnly}><Input type="date" value={idIssue} onChange={(e) => setIdIssue(e.target.value)} /></Field>
          <Field label={t("ID Expiry Date", "تاريخ الانتهاء")} hl7={hisOnly}><Input type="date" value={idExpiry} onChange={(e) => setIdExpiry(e.target.value)} className={idExpiry && isExpired(idExpiry) ? "border-destructive" : ""} /></Field>
          <Field label={t("Copy No.", "رقم النسخة")} hl7={hisOnly}><Input value={copyNo} onChange={(e) => setCopyNo(e.target.value)} /></Field>
          <Field label={t("Address Type", "نوع العنوان")} hl7={hisOnly}><Select value={addressType} onChange={(e) => setAddressType(e.target.value)}>{ADDRESS_TYPES.map((x) => <option key={x}>{x}</option>)}</Select></Field>
          <FF name="shortCode" error={errs.shortCode} label={t("National Address Short Code", "العنوان الوطني المختصر")} hl7={tag("PID-11")}>
            <Input className="font-mono" value={shortCode} onChange={(e) => setShortCode(e.target.value.toUpperCase())} maxLength={8} dir="ltr" aria-invalid={!!errs.shortCode} />
          </FF>
          <Field label={t("Address", "العنوان")} hl7={hisOnly}><Input value={addressText} onChange={(e) => setAddressText(e.target.value)} /></Field>
        </Grid>
        {warnings.map((w) => <p key={w} className="mt-4 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm">{w}</p>)}
      </Sec>

      <Sec title={t("Contact Information", "بيانات للإتصال")}>
        <Grid>
          <FF name="mobile" error={errs.mobile} required label={t("Mobile No.", "الجوال")} hl7={hisOnly}><Input value={mobile} onChange={(e) => setMobile(e.target.value)} dir="ltr" inputMode="tel" aria-invalid={!!errs.mobile} /></FF>
          <Field label={t("Country Code", "رمز الدولة")} hl7={hisOnly}><Input value={countryCode} onChange={(e) => setCountryCode(e.target.value)} dir="ltr" /></Field>
          <Field label={t("Area Code", "رمز المنطقة")} hl7={hisOnly}><Input value={areaCode} onChange={(e) => setAreaCode(e.target.value)} dir="ltr" /></Field>
          <Field label={t("Home Phone", "هاتف المنزل")} hl7={hisOnly}><Input value={homePhone} onChange={(e) => setHomePhone(e.target.value)} dir="ltr" inputMode="tel" /></Field>
          <Field label={t("Other Phone", "هاتف آخر")} hl7={hisOnly}><Input value={otherPhone} onChange={(e) => setOtherPhone(e.target.value)} dir="ltr" inputMode="tel" /></Field>
          <Field label={t("Relative Name", "اسم قريب للمريض")} hl7={hisOnly}><Input value={relName} onChange={(e) => setRelName(e.target.value)} /></Field>
          <Field label={t("Relative Mobile", "جوال قريب المريض")} hl7={hisOnly}><Input value={relPhone} onChange={(e) => setRelPhone(e.target.value)} dir="ltr" inputMode="tel" /></Field>
          <FF name="email" error={errs.email} label={t("Email", "البريد الإلكتروني")} hl7={hisOnly}><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" aria-invalid={!!errs.email} /></FF>
        </Grid>
      </Sec>

      <Sec title={t("Patient Flags", "تنبيهات المريض")}>
        <p className="mb-4 text-sm text-muted-foreground">{t("Tick what applies. Flags show on the patient banner for every member of staff.", "اختر ما ينطبق. تظهر التنبيهات في شريط المريض لجميع الموظفين.")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className={cn("rounded-lg border p-3", dnr ? "border-destructive/50 bg-destructive/5" : "border-border")}>
            <label className="flex items-start gap-2.5 text-sm">
              <input type="checkbox" checked={dnr} onChange={(e) => setDnr(e.target.checked)} className="mt-0.5 size-4 accent-[var(--primary)]" />
              <span><span className="block font-medium">{t("Do Not Resuscitate", "عدم الإنعاش")}</span><span className="block text-xs text-muted-foreground">{t("Only with a written order from a doctor.", "فقط بأمر مكتوب من الطبيب.")}</span></span>
            </label>
            {dnr && (
              <div className="mt-3 grid gap-x-4 gap-y-4 sm:grid-cols-2">
                <FF name="dnrDoctor" error={errs.dnrDoctor} required label={t("Ordering Doctor", "الطبيب الآمر")}>
                  <Select value={dnrDoctor} onChange={(e) => setDnrDoctor(e.target.value)} aria-invalid={!!errs.dnrDoctor}><option value="">{t("Select", "اختر")}</option>{doctorOptions}</Select>
                </FF>
                <FF name="dnrDate" error={errs.dnrDate} required label={t("Order Date", "تاريخ الأمر")}>
                  <Input type="date" value={dnrDate} max={today} onChange={(e) => setDnrDate(e.target.value)} aria-invalid={!!errs.dnrDate} />
                </FF>
              </div>
            )}
          </div>
          <div className={cn("rounded-lg border p-3", interpreter ? "border-move/50 bg-move/5" : "border-border")}>
            <label className="flex items-start gap-2.5 text-sm">
              <input type="checkbox" checked={interpreter} onChange={(e) => setInterpreter(e.target.checked)} className="mt-0.5 size-4 accent-[var(--primary)]" />
              <span><span className="block font-medium">{t("Needs Interpreter", "يحتاج مترجم")}</span><span className="block text-xs text-muted-foreground">{t("The patient does not speak Arabic well.", "المريض لا يتحدث العربية جيدا.")}</span></span>
            </label>
            {interpreter && (
              <div className="mt-3">
                <FF name="language" error={errs.language} required label={t("Language", "اللغة")}>
                  <Select value={language} onChange={(e) => setLanguage(e.target.value)} aria-invalid={!!errs.language}><option value="">{t("Select", "اختر")}</option>{INTERPRETER_LANGUAGES.map((x) => <option key={x}>{x}</option>)}</Select>
                </FF>
              </div>
            )}
          </div>
          <label className={cn("flex items-start gap-2.5 rounded-lg border p-3 text-sm", fallRisk ? "border-warn/50 bg-warn/5" : "border-border")}>
            <input type="checkbox" checked={fallRisk} onChange={(e) => setFallRisk(e.target.checked)} className="mt-0.5 size-4 accent-[var(--primary)]" />
            <span><span className="block font-medium">{t("Fall Risk", "خطر السقوط")}</span><span className="block text-xs text-muted-foreground">{t("Unsteady, uses a walking aid or fell before.", "غير متزن أو يستخدم وسيلة مساعدة أو سقط من قبل.")}</span></span>
          </label>
          <label className={cn("flex items-start gap-2.5 rounded-lg border p-3 text-sm", isolation ? "border-warn/50 bg-warn/5" : "border-border")}>
            <input type="checkbox" checked={isolation} onChange={(e) => setIsolation(e.target.checked)} className="mt-0.5 size-4 accent-[var(--primary)]" />
            <span><span className="block font-medium">{t("Isolation", "عزل")}</span><span className="block text-xs text-muted-foreground">{t("Keep apart from other patients because of infection.", "يبقى بعيدا عن المرضى الآخرين بسبب العدوى.")}</span></span>
          </label>
        </div>
      </Sec>

      <Sec title={t("Insurance Card", "كارت التأمين")} name="coverage">
        <div className="flex flex-wrap items-start gap-3">
          <Button className="h-10 border-2 border-update/60" onClick={retrieveInsuranceCard} disabled={idNumber.length !== 10}>
            <CreditCard className="size-4" />{t("Retrieve Patient Insurance Card", "استعراض كارت تأمين المريض")}
          </Button>
          <Button className="h-10" disabled={!ins} onClick={() => ins && setArchive((a) => [...a, { kind: "Insurance card", at: new Date().toISOString(), summary: `${ins.payer} ${ins.memberId}` }])}>
            {t("Archive Patient Insurance Card", "أرشفة كارت تأمين المريض")}
          </Button>
          {idNumber.length !== 10 && <span className="self-center text-xs text-muted-foreground">{t("Enter the ID number first.", "أدخل رقم الهوية أولا")}</span>}
        </div>
        {ins && (
          <div className="mt-3 max-w-xl rounded-xl border border-border bg-gradient-to-br from-move/10 to-admit/10 p-4" aria-label="Insurance card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-base font-semibold">{ins.payer}</div>
              <Badge tone={ins.status === "Active" ? "ok" : "danger"}>{ins.status === "Active" ? t("Active", "ساري") : t("Expired", "منتهي")}</Badge>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
              <div><dt className="text-xs text-muted-foreground">{t("Member ID", "الرقم التأميني")}</dt><dd className="font-mono">{ins.memberId}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("Policy", "الوثيقة")}</dt><dd className="font-mono">{ins.policyNo}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("Class", "الفئة")}</dt><dd>{ins.className}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("Network", "الشبكة")}</dt><dd>{ins.network}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("Valid", "الصلاحية")}</dt><dd>{ins.startDate} to {ins.expiryDate}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("Co-pay", "نسبة التحمل")}</dt><dd>{ins.copayPercent}%</dd></div>
            </dl>
            {dev && <p className="mt-2 text-xs text-muted-foreground">Simulated eligibility response. A real HIS asks the payer through NPHIES financial services (eligibility), which is a different guide from the UHR pages used here.</p>}
          </div>
        )}
        {outcome && (ins || payType === "Insurance") && (
          <CoverageBox outcome={outcome} ar={ar}>
            {outcome.blocking && cashChosen && <p className="mt-2 font-medium">{t("You chose to continue as a cash patient. The patient pays for this visit.", "اخترت المتابعة كمريض نقدي. يدفع المريض تكلفة هذه الزيارة.")}</p>}
            {outcome.blocking && visit === "none" && <p className="mt-2">{t("No visit is being started, so there is nothing to decide now.", "لا توجد زيارة الآن، فلا يوجد قرار مطلوب.")}</p>}
            {needsChoice && (
              <>
                <p className="mt-2 font-medium">{t("Choose what to do before you save the visit.", "اختر الإجراء قبل حفظ الزيارة.")}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button variant="primary" onClick={() => chooseCash(outcome)}>{t("Continue As Cash Patient", "المتابعة كمريض نقدي")}</Button>
                  <Button onClick={() => chooseFix(outcome)}>{t("Fix Coverage", "تصحيح التغطية")}</Button>
                </div>
              </>
            )}
            {fixNote && !cashChosen && <p className="mt-2">{t("Ask the patient for a valid card or call the payer. Then retrieve the insurance card again.", "اطلب من المريض بطاقة سارية أو اتصل بشركة التأمين، ثم استعرض كارت التأمين مرة أخرى.")}</p>}
          </CoverageBox>
        )}
        <CardUpload title={t("Insurance Card Copy", "صورة كارت التأمين")} value={insFile} onChange={setInsFile} t={t} />
      </Sec>

      <Sec title={t("ID Card", "بطاقة الهوية")}>
        <div className="flex flex-wrap gap-3">
          <Button className="h-10 border-2 border-cancel/50" onClick={retrieveIdentityCard} disabled={idNumber.length !== 10}>
            <IdCard className="size-4" />{t("Retrieve National ID (Iqama) Card", "استعراض بطاقة الهوية")}
          </Button>
          <Button className="h-10" disabled={!idCard} onClick={() => idCard && setArchive((a) => [...a, { kind: "ID card", at: new Date().toISOString(), summary: `${idCard.idType} ${idCard.idNumber}` }])}>
            {t("Archive National ID (Iqama) Card", "أرشفة بطاقة الهوية")}
          </Button>
        </div>
        {idCard && <p className="mt-2 text-sm">{idCard.idType} <span className="font-mono">{idCard.idNumber}</span>, {idCard.issuer}, {idCard.issueDate} to {idCard.expiryDate}</p>}
        {archive.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{archive.map((a, i) => <Badge key={i} tone="update" className="whitespace-normal leading-tight">{t("Archived", "مؤرشف")}: {a.kind} {a.summary}</Badge>)}</div>}
        <CardUpload title={t("ID Card Copy", "صورة بطاقة الهوية")} value={idFile} onChange={setIdFile} t={t} />
      </Sec>

      <Sec title={t("National Health Record", "السجل الصحي الوطني")}>
        <Grid cols={2}>
          <FF name="healthId" error={errs.healthId} required label={t("Health ID", "رقم الهوية الصحية")} hl7={tag("PID-3")} hint={t("Issued by the NHIC Patient Registry. Test value.", "يصدر من السجل الوطني")}>
            <div className="flex flex-wrap gap-2"><Input className="min-w-0 flex-1 font-mono" value={healthId} onChange={(e) => setHealthId(e.target.value)} dir="ltr" aria-invalid={!!errs.healthId} /><Button className="h-10" onClick={() => setHealthId(nextHealthId())}>{t("New Test ID", "رقم تجريبي")}</Button></div>
          </FF>
        </Grid>
      </Sec>

      <div data-field="consent" className="mt-6">
        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} aria-invalid={!!errs.consent} className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" />
          <span>
            {t("The patient has been told how their health information is used and shared with the national exchange (NPHIES), and agrees.", "تم إبلاغ المريض بكيفية استخدام معلوماته الصحية ومشاركتها مع المنصة الوطنية (نفيس) ووافق على ذلك.")}
            <span aria-hidden="true" className="ms-0.5 font-semibold text-destructive">*</span><span className="sr-only"> (required)</span>
          </span>
        </label>
        {errs.consent && <p role="alert" className="mt-1 ps-6 text-xs font-medium text-destructive">{errs.consent}</p>}
      </div>

      {/* Save bar: stays at the bottom of the screen while the clerk scrolls. */}
      <div className="sticky bottom-0 z-20 mt-6 flex flex-wrap items-center gap-2 rounded-t-xl border border-border bg-card px-4 py-3 shadow-lg sm:pe-40">
        <Button variant="primary" onClick={() => trySave()}>{saveLabel}</Button>
        <Button onClick={() => navigate(AFTER[visit].path)}>{t("Cancel", "إلغاء")}</Button>
        {showErrors && problems.length > 0 && (
          <span className="text-sm font-medium text-destructive">{t(problems.length === 1 ? "1 thing to fix" : `${problems.length} things to fix`, `${problems.length} للتصحيح`)}</span>
        )}
        {needsChoice && !(showErrors && problems.length > 0) && <span className="text-sm text-muted-foreground">{t("The insurance does not cover this visit. You will be asked what to do.", "التأمين لا يغطي هذه الزيارة. سيطلب منك اختيار الإجراء.")}</span>}
      </div>

      {/* Duplicate check */}
      <Dialog
        open={!!dups}
        onClose={() => setDups(null)}
        wide
        title={t("This Patient May Already Have A File", "قد يكون لهذا المريض ملف مسبق")}
        subtitle={t("Nothing was saved. Check the patients below before you make a new file.", "لم يتم الحفظ. راجع المرضى أدناه قبل إنشاء ملف جديد.")}
      >
        <ul className="space-y-3">
          {(dups ?? []).map((m) => (
            <li key={m.patient.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{patientName(m.patient)}</div>
                  <PatientNameAr patient={m.patient} />
                  <div className="mt-0.5 text-xs text-muted-foreground"><span className="font-mono">{m.patient.mrn}</span> · {t("Born", "الميلاد")} {m.patient.dob} · {m.patient.sex === "M" ? t("Male", "ذكر") : t("Female", "أنثى")}</div>
                </div>
                <div className="flex flex-wrap gap-1.5">{m.reasons.map((r) => <Badge key={r} tone="warn" className="whitespace-normal leading-tight">{DUPLICATE_REASON_LABEL[r]}</Badge>)}</div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => navigate("/patients", { patient: m.patient.id })}>{t("Open This Patient", "فتح ملف هذا المريض")}</Button>
                <Button size="sm" variant="primary" disabled={visit === "none"} onClick={() => trySave({ existingId: m.patient.id })}>{t("Start A Visit For This Patient", "بدء زيارة لهذا المريض")}</Button>
              </div>
              {visit === "none" && <p className="mt-1.5 text-xs text-muted-foreground">{t("To start a visit, close this window and pick a visit type first.", "لبدء زيارة، أغلق هذه النافذة واختر نوع الزيارة أولا.")}</p>}
            </li>
          ))}
        </ul>
        <div className="mt-4 border-t border-border pt-4">
          <div className="text-sm font-semibold">{t("Not the same person?", "ليس نفس الشخص؟")}</div>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("You can make a new file, but you must say why. The reason is kept in the audit trail.", "يمكنك إنشاء ملف جديد مع ذكر السبب. يحفظ السبب في سجل التدقيق.")}</p>
          <Field className="mt-3" required label={t("Reason", "السبب")}>
            <Input value={dupReason} onChange={(e) => setDupReason(e.target.value)} placeholder={t("For example: twin brother, different person with the same name", "مثال: أخ توأم، شخص آخر بنفس الاسم")} />
          </Field>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="danger" disabled={dupReason.trim().length < 3} onClick={() => trySave({ dupReason: dupReason.trim(), dupFiles: (dups ?? []).map((m) => m.patient.mrn).join(", ") })}>{t("Register As New Anyway", "تسجيل كملف جديد")}</Button>
            <Button onClick={() => setDups(null)}>{t("Go Back To The Form", "العودة إلى النموذج")}</Button>
          </div>
        </div>
      </Dialog>

      {/* Coverage decision */}
      <Dialog
        open={!!coverageAsk}
        onClose={() => setCoverageAsk(null)}
        title={t("The Insurance Does Not Cover This Visit", "التأمين لا يغطي هذه الزيارة")}
        subtitle={t("Nothing was saved yet. Choose how to go on.", "لم يتم الحفظ بعد. اختر طريقة المتابعة.")}
        footer={coverageAsk && (
          <>
            <Button onClick={() => chooseFix(coverageAsk)}>{t("Fix Coverage", "تصحيح التغطية")}</Button>
            <Button variant="primary" onClick={() => { chooseCash(coverageAsk); trySave(pending.current, { cash: true }); }}>{t("Continue As Cash Patient", "المتابعة كمريض نقدي")}</Button>
          </>
        )}
      >
        {coverageAsk && (
          <>
            <CoverageBox outcome={coverageAsk} ar={ar} />
            <ul className="mt-4 list-disc space-y-1 ps-5 text-sm">
              <li>{t("Continue As Cash Patient: the visit is saved and the patient pays the bill.", "المتابعة كمريض نقدي: تحفظ الزيارة ويدفع المريض الفاتورة.")}</li>
              <li>{t("Fix Coverage: go back to the form. The visit is not saved until the coverage is sorted out.", "تصحيح التغطية: العودة إلى النموذج. لا تحفظ الزيارة حتى تحل مشكلة التغطية.")}</li>
            </ul>
          </>
        )}
      </Dialog>
    </div>
  );
}

/** Outpatient registration is the full form. Emergency registration starts with the quick form, and the full form is one tap away. */
export function RegistrationForm({ cls = "O" }: { cls?: "O" | "E" }) {
  const [full, setFull] = React.useState(false);
  // "Register Another Patient" starts the full form again with empty fields.
  const [round, setRound] = React.useState(0);
  const again = () => setRound((r) => r + 1);
  if (cls !== "E") return <FullRegistrationForm key={round} cls={cls} onAgain={again} />;
  return (
    <div>
      <div role="group" aria-label="Registration form" className="mb-4 flex w-fit max-w-full flex-wrap rounded-md border border-border bg-muted p-0.5">
        {([false, true] as const).map((f) => (
          <button key={String(f)} type="button" onClick={() => setFull(f)} aria-pressed={full === f} className={cn("rounded px-3 py-1.5 text-sm font-medium", full === f ? "bg-card shadow-sm" : "text-muted-foreground")}>
            {f ? "Full Registration" : "Quick Emergency Registration"}
          </button>
        ))}
      </div>
      {full ? <FullRegistrationForm key={round} cls="E" onAgain={again} /> : <ErQuickRegistration />}
    </div>
  );
}
