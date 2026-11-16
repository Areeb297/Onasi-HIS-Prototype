import * as React from "react";
import { Baby, BedDouble, CircleAlert, CircleCheck, CreditCard, Fingerprint, IdCard, Printer, Search, ShieldAlert, Siren, Stethoscope, TriangleAlert, Upload, UserPlus } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { ErQuickRegistration } from "@/components/ErQuickRegistration";
import { PatientFlagBadges, PatientNameAr } from "@/components/PatientBanner";
import { WristbandDialog } from "@/components/Wristband";
import { Badge, Button, Card, Field, Input, RequiredNote, Select, Switch, cn } from "@/components/ui/primitives";
import {
  AttentionLink, CheckRow, ChoiceSelect, ErrorSummary, FormActions, FormGrid, FormSection, ReasonButton, SegmentedControl, Stepper, focusField, isDirty, useFormErrors, useUnsavedChangesGuard,
  type Errors,
} from "@/components/forms";
import { fmtDate } from "@/lib/format";
import { YakeenLookup } from "@/components/integrations/YakeenLookup";
import type { YakeenIdentity } from "@/lib/integrations/yakeen";
import { quickCreate, type Outcome } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { useDevMode } from "@/lib/devmode";
import { ARRIVAL_MODES, CTAS, ctasInfo, defaultArea, saveTriage, startEd } from "@/lib/ed";
import type { CtasLevel, EdData, PatientExtra } from "@/lib/model";
import { canSetTriage, currentUser } from "@/lib/session";
import { COMPLAINT_SAMPLES, DOCTORS, MARITAL, NATIONALITIES, SERVICES, countryCode as nationalityCode, countryLabel } from "@/lib/reference-data";
import {
  ACTIVITY_LEVELS, ADMISSION_SPECIALTIES, ADMISSION_TYPES, DUPLICATE_REASON_LABEL, INTERPRETER_LANGUAGES, PATIENT_CONDITIONS, SAUDI_REGIONS, TITLES, UNKNOWN_NAME,
  ageLabel, buildFlags, coverageOutcome, defaultTitle, fetchHealthId, findDuplicates, listName, validateRegistration,
  type CoverageOutcome, type DuplicateMatch, type RegField, type VisitChoice,
} from "@/lib/registration";
import { registrationCard } from "@/lib/coverage";
import { dobFromAge } from "@/lib/er-register";
import { hijri, isExpired, lookupById, retrieveIdCard, REGISTRY, type IdCard as IdCardData, type InsuranceCard } from "@/lib/registry";
import { navigate } from "@/lib/router";
import { bedLabel, freeBeds, nextHealthId, nowLocal, patientName, registerPatient, updateEncounter, useHis } from "@/lib/store";
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

/** Section card with a title, an optional one-line help, and the fields. `name` lets a jump land on the section. */
function Sec({ title, help, children, name, filled, total, attention }: { title: string; help?: string; children: React.ReactNode; name?: string; filled?: number; total?: number; attention?: number }) {
  return (
    <div data-field={name} className="min-w-0">
      <FormSection title={title} help={help} filled={filled} total={total} attention={attention}>{children}</FormSection>
    </div>
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

const Grid = ({ children, cols = 3 }: { children: React.ReactNode; cols?: 2 | 3 | 4 }) => <FormGrid cols={cols}>{children}</FormGrid>;

/** A form field that shows its problem in place of the help text. `name` lets the error summary jump to it. */
function FF({ name, error, ...field }: { name?: RegField; error?: string } & React.ComponentProps<typeof Field>) {
  return <Field name={name} error={error} {...field} />;
}

type StepId = "identity" | "contact" | "coverage" | "visit";

/** Which step each checked field is on, so a problem can take the clerk to the right step. */
const STEP_OF: Partial<Record<RegField, StepId>> = {
  idNumber: "identity", healthId: "identity", first: "identity", family: "identity", dob: "identity", title: "identity", nickName: "identity", parentId: "identity",
  mobile: "contact", email: "contact", shortCode: "contact", addressLine1: "contact",
  consent: "visit", bedId: "visit", admissionType: "visit", patientCondition: "visit", expectedStay: "visit", dnrDoctor: "visit", dnrDate: "visit", language: "visit",
};
const stepOf = (f: string): StepId => STEP_OF[f as RegField] ?? "identity";

/** A header option such as Confidential Patient: a checkbox shown as a pill. */
function Toggle({ checked, onChange, icon, label, hint, tone }: { checked: boolean; onChange: (v: boolean) => void; icon: React.ReactNode; label: string; hint?: string; tone: "warn" | "info" }) {
  return (
    <label className={cn(
      "flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors focus-within:ring-2 focus-within:ring-ring",
      checked ? (tone === "warn" ? "border-warn/60 bg-warn/12" : "border-move/50 bg-move/10") : "border-border bg-card hover:bg-muted",
    )}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-[var(--primary)]" />
      <span className={cn("shrink-0", checked ? (tone === "warn" ? "text-warn" : "text-move") : "text-muted-foreground")}>{icon}</span>
      <span>{label}{hint && <span className="ms-1.5 text-xs font-normal text-muted-foreground">{hint}</span>}</span>
    </label>
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
function CoverageBox({ outcome, ar, children, large }: { outcome: CoverageOutcome; ar: boolean; children?: React.ReactNode; large?: boolean }) {
  const tone = outcome.blocking ? "text-destructive" : outcome.warning ? "text-warn" : "text-ok";
  return (
    <div
      role="status"
      className={cn(
        "rounded-xl border border-l-4 bg-card text-sm",
        large ? "px-4 py-3.5" : "mt-3 max-w-xl px-3 py-2.5",
        outcome.blocking ? "border-destructive/40 border-l-destructive" : outcome.warning ? "border-warn/40 border-l-warn" : "border-ok/40 border-l-ok",
      )}
    >
      <div className={cn("flex items-center gap-2 font-semibold", large && "text-base", tone)}>
        {outcome.blocking || outcome.warning ? <TriangleAlert className={cn("shrink-0", large ? "size-5" : "size-4")} aria-hidden="true" /> : <CircleCheck className={cn("shrink-0", large ? "size-5" : "size-4")} aria-hidden="true" />}
        {ar ? outcome.titleAr : outcome.title}
      </div>
      <p className="mt-1 text-foreground">{ar ? outcome.textAr : outcome.text}</p>
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
  const [ctas, setCtas] = React.useState<CtasLevel | undefined>(undefined);
  const [bedId, setBedId] = React.useState("");
  // Inpatient admission details
  const [admissionType, setAdmissionType] = React.useState("");
  const [patientCondition, setPatientCondition] = React.useState("");
  const [expectedStay, setExpectedStay] = React.useState("");
  const [activityLevel, setActivityLevel] = React.useState("");
  const [admissionSpecialty, setAdmissionSpecialty] = React.useState("");
  // Profile options in the header: confidential, newborn, unknown or unconscious
  const [confidential, setConfidential] = React.useState(false);
  const [nickName, setNickName] = React.useState("");
  const [newborn, setNewborn] = React.useState(false);
  const [parentId, setParentId] = React.useState("");
  const [unknown, setUnknown] = React.useState(false);
  const [approxAge, setApproxAge] = React.useState("");
  /** The title the clerk picked. Until then it follows the sex and marital status. */
  const [titleChoice, setTitleChoice] = React.useState<string | null>(null);
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
  const [region, setRegion] = React.useState("");
  const [city, setCity] = React.useState("");
  const [address1, setAddress1] = React.useState("");
  const [address2, setAddress2] = React.useState("");
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
  const [healthIdNote, setHealthIdNote] = React.useState<{ ok: boolean; text: string } | null>(null);
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
  const [step, setStep] = React.useState<StepId>("identity");
  const [yakeenOpen, setYakeenOpen] = React.useState(false);
  const [yakeenAt, setYakeenAt] = React.useState<string | null>(null);
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

  const beds = freeBeds(state);
  const title = titleChoice ?? defaultTitle(sex, marital, newborn);
  /** Unknown or unconscious applies to an emergency visit only, as in the HIS. */
  const isUnknown = unknown && visit === "E";
  const parents = state.patients.filter((x) => !x.mergedInto);
  const outcome = checked ? coverageOutcome(ins, today) : null;
  /** A "no insurance" answer matters only when the clerk asked for an insurance visit. */
  const stops = (o: CoverageOutcome | null, pay: string) => !!o && o.blocking && (o.kind !== "no-insurance" || pay === "Insurance");
  const needsChoice = visit !== "none" && stops(outcome, payType) && !cashChosen;

  function chooseVisit(v: VisitChoice) {
    setVisit(v);
    if (v !== "E") setUnknown(false);
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
  function runCoverageCheck(patientId?: string): { card: InsuranceCard | null; outcome: CoverageOutcome } {
    // A patient who already has a file here is checked against the primary active coverage on that file.
    const card = registrationCard({ idNumber, patientId, healthId }, today, state.patients);
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

  function fetchHealthIdFromRegistry() {
    const a = fetchHealthId(idNumber, dob, today);
    if (a.ok) {
      setHealthId(a.healthId);
      setHealthIdNote({ ok: true, text: t("Health ID returned by the national registry.", "تم استلام رقم الهوية الصحية من السجل الوطني.") });
    } else {
      setHealthIdNote({ ok: false, text: a.message });
    }
    audit("view", "National registry Health ID lookup", { detail: `ID ${idNumber.slice(0, 3)}*******: ${a.ok ? "returned" : "not returned"}` });
  }

  function chooseUnknown(on: boolean) {
    if (on) chooseVisit("E");
    setUnknown(on);
    fe.reset();
  }

  /**
   * Fills the form from the national identity service (Yakeen): the English and Arabic names, the date of birth, the sex,
   * the nationality, the national address and the ID expiry. The clerk can still change any of them.
   */
  function applyYakeen(p: YakeenIdentity) {
    if (p.idNumber !== idNumber) { clearCoverage(); setIdCard(null); }
    setIdNumber(p.idNumber);
    setIdType(p.idType === "iqama" ? "Iqama" : "National ID");
    setFirst(p.nameEn[0]); setSecond(p.nameEn[1]); setThird(p.nameEn[2]); setFamily(p.nameEn[3]);
    setFirstAr(p.nameAr[0]); setSecondAr(p.nameAr[1]); setThirdAr(p.nameAr[2]); setFamilyAr(p.nameAr[3]);
    setDob(p.dob); setSex(p.sex); setNationality(p.nationality); setIdExpiry(p.idExpiry);
    const a = p.address;
    setShortCode(a.shortAddress.toUpperCase());
    setAddress1([`${a.buildingNumber} ${a.street}`.trim(), a.district].filter(Boolean).join(", "));
    setAddress2(`${a.postalCode}, additional number ${a.additionalNumber}`);
    const reg = SAUDI_REGIONS.find((r) => r.cities.includes(a.city));
    if (reg) { setRegion(reg.region); setCity(a.city); }
    setYakeenOpen(false);
    setYakeenAt(new Date().toISOString());
    audit("view", "Yakeen identity check at registration", { detail: `${p.idType === "iqama" ? "Iqama" : "National ID"} ${p.idNumber.slice(0, 3)}*******: details used` });
    pushToast({ tone: "ok", text: t("Details filled from Yakeen", "تم تعبئة البيانات من يقين"), detail: t("Check them with the patient before you save.", "راجعها مع المريض قبل الحفظ.") });
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
    addressLine1: address1, title, confidential, nickName, newborn, parentId, unknown: isUnknown, admissionType, patientCondition, expectedStay,
  });
  const allErrors: Errors = {};
  for (const p of problems) if (!allErrors[p.field]) allErrors[p.field] = ar ? p.messageAr : p.message;
  const order = problems.map((p) => p.field);
  // Errors show after the clerk changes a field and leaves it, or after Save. Save takes the clerk to the first one.
  const fe = useFormErrors(allErrors, order, { reveal: (k) => setStep(stepOf(k)) });
  const errs = fe.shown as Partial<Record<RegField, string>>;
  const shownCount = Object.keys(errs).length;
  const warnings: string[] = [];
  if (idExpiry && isExpired(idExpiry)) warnings.push(t("The ID has expired.", "الهوية منتهية."));

  function goTo(name: string) {
    if (name === "coverage") setStep("coverage");
    else setStep(stepOf(name));
    requestAnimationFrame(() => focusField(name));
  }

  // Unsaved changes: anything typed, picked or ticked since the form opened.
  const snapshot = {
    visit, attending, referring, service, reason, arrival, ctas, bedId, admissionType, patientCondition, expectedStay, activityLevel, admissionSpecialty,
    confidential, nickName, newborn, parentId, unknown, approxAge, titleChoice, first, second, third, family, firstAr, secondAr, thirdAr, familyAr,
    payType, nationality, sex, marital, religion, blood, social, dob, birthPlace, occupation, employeeNo, idType, idNumber, issuer, idIssue, idExpiry, copyNo,
    addressType, region, city, address1, address2, shortCode, homePhone, mobile, countryCode, areaCode, otherPhone, relName, relPhone, email,
    dnr, dnrDoctor, dnrDate, interpreter, language, fallRisk, isolation, healthId, consent, idFile: idFile?.name, insFile: insFile?.name,
  };
  const [startSnap] = React.useState(snapshot);
  const { dialog: leaveDialog } = useUnsavedChangesGuard(!saved && isDirty(startSnap, snapshot), { what: t("The registration is not saved.", "التسجيل غير محفوظ.") });

  /** The steps and how far each one is. The coverage step shows the payer's answer, so it stays in view on every step. */
  const stepFields = (s: StepId) => Object.keys(allErrors).filter((k) => stepOf(k) === s);
  const steps: { id: StepId; label: string; note?: React.ReactNode; attention: number; done: boolean }[] = [
    { id: "identity", label: t("Identity", "الهوية"), note: [first, family].filter(Boolean).join(" ") || (isUnknown ? t("Unknown patient", "مريض مجهول") : t("Name, ID, Health ID", "الاسم والهوية")), attention: countShown("identity"), done: stepFields("identity").length === 0 && !!(first || isUnknown) },
    { id: "contact", label: t("Contact And Address", "الاتصال والعنوان"), note: mobile || t("Mobile and address", "الجوال والعنوان"), attention: countShown("contact"), done: stepFields("contact").length === 0 && !!(mobile || isUnknown) },
    {
      id: "coverage", label: t("Coverage", "التغطية"),
      note: outcome ? <span className={cn("font-medium", outcome.blocking ? "text-destructive" : outcome.warning ? "text-warn" : "text-ok")}>{ar ? outcome.titleAr : outcome.title}</span> : payType === "Cash" ? t("Cash", "نقدي") : t("Not checked yet", "لم يتم التحقق"),
      attention: needsChoice && fe.submitted ? 1 : 0, done: payType === "Cash" ? !needsChoice : !!outcome && !outcome.blocking,
    },
    { id: "visit", label: t("Visit", "الزيارة"), note: visit === "none" ? t("No visit now", "بدون زيارة") : (ar ? VISITS.find((v) => v.id === visit)?.ar : VISITS.find((v) => v.id === visit)?.en), attention: countShown("visit"), done: stepFields("visit").length === 0 },
  ];
  function countShown(s: StepId) { return Object.keys(errs).filter((k) => stepOf(k) === s).length; }
  const stepIndex = steps.findIndex((s) => s.id === step);
  const goStep = (s: StepId) => { setStep(s); requestAnimationFrame(() => document.getElementById("reg-steps")?.scrollIntoView({ block: "start", behavior: "smooth" })); };

  function createVisit(patientId: string): Outcome {
    if (visit === "I") {
      const method = ADMISSION_TYPES.find((a) => a.label === admissionType)?.method;
      const out = quickCreate("A01", { patientId, attending, service, reason, referring, bedId, admitClass: "I", admissionMethod: method });
      if (out.entry) {
        const stay = expectedStay.trim() ? Number(expectedStay) : undefined;
        updateEncounter(out.entry.visitNumber, (e) => {
          e.admission = { admissionType, patientCondition, expectedStayDays: stay, activityLevel: activityLevel || undefined, specialty: admissionSpecialty || undefined };
        }, { touch: false });
      }
      return out;
    }
    const out = quickCreate("A04", { patientId, attending, service: visit === "E" ? "ER" : service, reason, referring, cls: visit === "E" ? "E" : "O" });
    if (visit === "E" && out.entry) {
      startEd(out.entry.visitNumber, arrival);
      if (isUnknown) updateEncounter(out.entry.visitNumber, (e) => { if (e.ed) e.ed = { ...e.ed, temporaryId: true }; }, { touch: false });
      if (ctas && canSetTriage()) saveTriage(out.entry.visitNumber, { ctas, ctasWhy: "Level chosen at registration", arrivalMode: arrival, complaint: reason.trim() || undefined, area: defaultArea(ctas), triageNurse: currentUser().name }, undefined, "Quick triage at registration");
    }
    return out;
  }

  /** Save in steps: form checks, then the duplicate check, then the coverage choice, then the patient file and the visit. */
  function trySave(p: Pending = {}, opts: { cash?: boolean } = {}) {
    if (!fe.attempt()) return;
    // Nothing is known about an unknown patient: no duplicate check, and emergency care does not wait for the payer.
    if (isUnknown) { commit(p, null, null); return; }

    if (!p.existingId && !p.dupReason) {
      const matches = findDuplicates({ idNumber, healthId, given: first, family, givenAr: firstAr, familyAr, dob, mobile }, state.patients.filter((x) => !x.mergedInto));
      if (matches.length) { setDupReason(""); setDups(matches); return; }
    }

    let card = ins;
    let o = outcome;
    // An insurance visit is never saved without asking the payer first.
    // A visit on a file that already exists is checked against the primary active coverage on that file.
    if (visit !== "none" && payType === "Insurance" && (!checked || (p.existingId && !opts.cash))) ({ card, outcome: o } = runCoverageCheck(p.existingId));
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
    const pay = o?.blocking || isUnknown ? "Cash" : payType;
    let patientId = p.existingId ?? "";
    if (!patientId) {
      const parent = newborn ? state.patients.find((x) => x.id === parentId) : undefined;
      const extra: PatientExtra = {
        secondName: second.trim(), thirdName: third.trim(),
        nameAr: { first: firstAr.trim(), second: secondAr.trim(), third: thirdAr.trim(), family: familyAr.trim() },
        religion, bloodGroup: blood, fileStatus, socialStatus: social, placeOfBirth: birthPlace, occupation, employeeNo,
        idType, idNumber, idIssuer: issuer, idIssueDate: idIssue, idExpiry, idCopyNo: copyNo, addressType,
        addressText: [address1.trim(), address2.trim(), city, region].filter(Boolean).join(", ") || undefined,
        homePhone, mobile, otherPhone, countryCode, areaCode, relationName: relName, relationPhone: relPhone, email,
        mainFileNo: `MF-${1000 + n}`, registrationNo: `REG-${today.slice(0, 4)}-${1000 + n}`, visitPayType: pay,
        insurance: card ?? undefined, archive, flags,
        coverageDecision: o?.blocking && visit !== "none" && stops(o, payType) ? `${o.title}. Continued as a cash patient.` : undefined,
        title: title || undefined, nickName: confidential ? nickName.trim() : undefined,
        newborn: newborn || undefined, parentId: parent?.id, unknown: isUnknown || undefined,
        region: region || undefined, city: city || undefined, addressLine1: address1.trim() || undefined, addressLine2: address2.trim() || undefined,
      };
      if (isUnknown) extra.fileStatus = "Temporary File";
      const ageYears = approxAge.trim() ? Number(approxAge) : NaN;
      const created = registerPatient({
        // An unknown patient gets a test Health ID, as at the quick emergency registration. The details are completed later.
        healthId: isUnknown && !healthId.trim() ? nextHealthId() : healthId.trim(),
        given: isUnknown ? first.trim() || UNKNOWN_NAME.given : first.trim(),
        family: isUnknown ? family.trim() || UNKNOWN_NAME.family : family.trim(),
        dob: dob || (isUnknown ? dobFromAge(Number.isFinite(ageYears) ? ageYears : undefined, undefined) : dob),
        sex, nationality: isUnknown && !idNumber ? "999" : nationality, maritalStatus: isUnknown ? "U" : marital,
        address: shortCode, shareData: consent, consentAt: consent ? new Date().toISOString() : undefined, extra,
        confidential: confidential || undefined,
      });
      patientId = created.id;
      const flagWords = [flags?.dnr && "Do Not Resuscitate", flags?.isolation && "Isolation", flags?.fallRisk && "Fall Risk", flags?.interpreter && "Needs Interpreter"].filter(Boolean).join(", ");
      const kind = [confidential && "Confidential", newborn && `Newborn of ${parent?.mrn ?? "a parent on file"}`, isUnknown && "Unknown or unconscious"].filter(Boolean).join(", ");
      audit("create", `Patient file ${created.mrn}`, { patient: listName(created), detail: `Registered.${kind ? ` ${kind}.` : ""} Payment: ${pay}.${flagWords ? ` Flags: ${flagWords}.` : ""}` });
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
    window.scrollTo({ top: 0 });
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

  const nationalityOpts = [
    ...(!NATIONALITIES.some((x) => x.code === nationality) ? [{ value: nationality, label: countryLabel(nationality) || nationality }] : []),
    ...NATIONALITIES.map((x) => ({ value: x.code, label: x.label })),
  ];
  const doctorOpts = DOCTORS.map((d) => ({ value: d.id, label: `Dr. ${d.given} ${d.family}` }));
  const nameFilled = [first, family, dob].filter(Boolean).length;
  const contactFilled = [mobile, address1, region, city, shortCode, email].filter(Boolean).length;

  return (
    <div dir={ar ? "rtl" : "ltr"} className="pb-2" {...fe.bind}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <RequiredNote />
        <div role="group" aria-label="Language" className="flex rounded-lg border border-border bg-card p-0.5 shadow-xs">
          {(["en", "ar"] as const).map((l) => (
            <button key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l} className={cn("rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", lang === l ? "bg-[#032C26] text-white dark:bg-[#39EDD5] dark:text-[#032C26]" : "text-muted-foreground hover:text-foreground")}>
              {l === "en" ? "English" : "العربية"}
            </button>
          ))}
        </div>
      </div>

      <div id="reg-steps" className="mt-3 scroll-mt-4 rounded-2xl border border-[color:var(--glass-border)] bg-[color:var(--glass-bg-strong)] px-4 pt-3 pb-2 shadow-[inset_0_1px_0_var(--glass-hi),var(--glass-shadow)]">
        <Stepper steps={steps} current={step} onSelect={(s) => setStep(s as StepId)} label={t("Registration steps", "خطوات التسجيل")} />
      </div>

      <ErrorSummary
        ref={summary}
        className="mt-4"
        items={order.filter((k, i) => errs[k] && order.indexOf(k) === i).map((k) => ({ key: k, text: errs[k]! }))}
        onJump={fe.go}
      />

      <div className="mt-4 space-y-4">
        {/* ---------- Step 1: Identity ---------- */}
        {step === "identity" && (
          <>
            <Sec title={t("Find The Patient", "البحث عن المريض")} help={t("Type the 10 digit ID. The national registry fills in what it knows.", "أدخل رقم الهوية المكون من 10 أرقام. يملأ السجل الوطني البيانات المعروفة.")}>
              <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                <FF name="idNumber" error={errs.idNumber} required={!isUnknown && !newborn} label={t("ID (Iqama) Number", "رقم الهوية")} hl7={tag("PID-3 via registry")} className="w-full sm:w-64">
                  <Input className="font-mono tracking-wider" value={idNumber} onChange={(e) => onIdChange(e.target.value)} placeholder={t("10 digits", "10 أرقام")} inputMode="numeric" dir="ltr" />
                </FF>
                <div className="flex flex-wrap items-center gap-2 sm:mt-[1.625rem]">
                  <Button className="h-10" onClick={() => lookup()} disabled={idNumber.length !== 10}><Search className="size-4" />{t("Look Up Patient", "بحث عن المريض")}</Button>
                  <Button className="h-10" onClick={() => setYakeenOpen(true)}><Fingerprint className="size-4" />{t("Verify With Yakeen", "التحقق عبر يقين")}</Button>
                  {yakeenAt && <Badge tone="ok" className="whitespace-normal leading-tight">{t("Verified by Yakeen", "تم التحقق عبر يقين")}</Badge>}
                  {found === "found" && <Badge tone="ok" className="whitespace-normal leading-tight">{t("Found in the national registry", "تم العثور عليه في السجل الوطني")}</Badge>}
                  {found === "none" && <Badge tone="warn" className="whitespace-normal leading-tight">{t("Not found. Enter the details by hand.", "غير موجود. أدخل البيانات يدويا")}</Badge>}
                </div>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {t("Test IDs: ", "أرقام للتجربة: ")}
                {REGISTRY.map((r) => (
                  <button key={r.idNumber} type="button" onClick={() => onIdChange(r.idNumber)} className="me-2 rounded font-mono text-move underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{r.idNumber}</button>
                ))}
              </p>
              {/* The coverage check sits beside the ID, so the payer's answer is known before anything else is typed. */}
              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-card px-3 py-2.5">
                <span className="text-sm font-medium">{t("Coverage", "التغطية")}</span>
                {outcome && (ins || payType === "Insurance") ? (
                  <span className={cn("inline-flex items-center gap-1.5 text-sm font-semibold", outcome.blocking ? "text-destructive" : outcome.warning ? "text-warn" : "text-ok")} role="status">
                    {outcome.blocking || outcome.warning ? <TriangleAlert className="size-4" aria-hidden="true" /> : <CircleCheck className="size-4" aria-hidden="true" />}
                    {ar ? outcome.titleAr : outcome.title}
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">{t("Not checked yet", "لم يتم التحقق")}</span>
                )}
                <span className="ms-auto flex flex-wrap gap-2">
                  <ReasonButton size="sm" onClick={retrieveInsuranceCard} reason={idNumber.length !== 10 ? t("Enter the 10 digit ID number first.", "أدخل رقم الهوية أولا.") : undefined}>
                    <CreditCard className="size-4" />{t("Retrieve Patient Insurance Card", "استعراض كارت تأمين المريض")}
                  </ReasonButton>
                  {outcome && <Button size="sm" variant="ghost" onClick={() => setStep("coverage")}>{t("See Coverage", "عرض التغطية")}</Button>}
                </span>
              </div>
              <div role="group" aria-label={t("Profile Options", "خيارات الملف")} className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
                <Toggle checked={isUnknown} onChange={chooseUnknown} icon={<CircleAlert className="size-4" />} tone="warn"
                  label={t("Unknown / Unconscious", "مجهول / فاقد الوعي")} hint={t("Emergency only", "للطوارئ فقط")} />
                <Toggle checked={confidential} onChange={(v) => setConfidential(v)} icon={<ShieldAlert className="size-4" />} tone="warn" label={t("Confidential Patient", "مريض سري")} />
                <Toggle checked={newborn} onChange={(v) => setNewborn(v)} icon={<Baby className="size-4" />} tone="info" label={t("Newborn", "مولود")} />
              </div>
              {isUnknown && (
                <div role="status" className="mt-3 rounded-xl border border-warn/50 bg-warn/10 px-4 py-3 text-sm">
                  <p className="font-semibold">{t("Unconscious Mode: only the title and the sex are required.", "وضع فاقد الوعي: اللقب والجنس فقط مطلوبان.")}</p>
                  <p className="mt-0.5">{t("The name is saved as Unknown Patient and a test Health ID is given. Complete the details when the patient can be identified.", "يحفظ الاسم كمريض مجهول ويعطى رقم هوية صحية تجريبي. أكمل البيانات عند التعرف على المريض.")}</p>
                  <Field className="mt-3 max-w-56" label={t("Approximate Age", "العمر التقريبي")} hint={t("Used for the date of birth when it is not known.", "يستخدم لتاريخ الميلاد عند عدم معرفته.")}>
                    <Input type="number" min={0} max={120} value={approxAge} onChange={(e) => setApproxAge(e.target.value)} suffix={t("years", "سنة")} />
                  </Field>
                </div>
              )}
              {newborn && (
                <div className="mt-4 max-w-md">
                  <FF name="parentId" error={errs.parentId} required={!isUnknown} label={t("Parent", "ولي الأمر")} hint={t("The mother or father, from the patients on file. A newborn may have no ID number yet.", "اختر الأم أو الأب من المرضى المسجلين. قد لا يكون للمولود رقم هوية بعد.")}>
                    <ChoiceSelect options={parents.map((x) => ({ value: x.id, label: `${listName(x)}, ${x.mrn}` }))} value={parentId} onChange={setParentId} placeholder={t("Select", "اختر")} label={t("Parent", "ولي الأمر")} />
                  </FF>
                </div>
              )}
            </Sec>

            <Sec title={t("Patient Name", "إسم المريض")} help={t("As written on the ID card.", "كما هو مكتوب في بطاقة الهوية.")}>
              <Grid>
                <FF name="title" error={errs.title} required={isUnknown} label={t("Title", "اللقب")} hl7={hisOnly} hint={titleChoice === null ? t("Filled from the sex and marital status.", "يملأ من الجنس والحالة الاجتماعية.") : undefined}>
                  <Select value={title} onChange={(e) => setTitleChoice(e.target.value)}>
                    <option value="">{t("Select", "اختر")}</option>
                    {TITLES.map((x) => <option key={x}>{x}</option>)}
                  </Select>
                </FF>
                {confidential && (
                  <FF name="nickName" error={errs.nickName} required label={t("Nick Name (Confidential ID)", "الاسم المستعار")} hl7={hisOnly} hint={t("Shown on lists instead of the name.", "يظهر في القوائم بدل الاسم.")}>
                    <Input value={nickName} onChange={(e) => setNickName(e.target.value)} placeholder={t("Pseudonym or alias", "اسم مستعار")} />
                  </FF>
                )}
              </Grid>
              {isUnknown && <p className="mt-3 text-sm text-muted-foreground">{t("Leave the name empty to save it as Unknown Patient.", "اترك الاسم فارغا ليحفظ كمريض مجهول.")}</p>}
              <Group title={t("Name (English)", "الإسم بالإنجليزية")} className="mt-5 border-t border-border pt-5">
                <Grid cols={4}>
                  <FF name="first" error={errs.first} required={!isUnknown} label={t("First", "الأول")} hl7={tag("PID-5.2")}><Input value={first} onChange={(e) => setFirst(e.target.value)} dir="ltr" autoComplete="off" /></FF>
                  <Field label={t("Father", "الأب")} hl7={tag("PID-5.3")}><Input value={second} onChange={(e) => setSecond(e.target.value)} dir="ltr" autoComplete="off" /></Field>
                  <Field label={t("Grandfather", "الجد")} hl7={tag("PID-5.3")}><Input value={third} onChange={(e) => setThird(e.target.value)} dir="ltr" autoComplete="off" /></Field>
                  <FF name="family" error={errs.family} required={!isUnknown} label={t("Family", "العائلة")} hl7={tag("PID-5.1")}><Input value={family} onChange={(e) => setFamily(e.target.value)} dir="ltr" autoComplete="off" /></FF>
                </Grid>
              </Group>
              <Group title={t("Name (Arabic)", "الإسم بالعربي")} className="mt-5 border-t border-border pt-5">
                <div dir="rtl">
                  <Grid cols={4}>
                    <Field label={t("First (Arabic)", "الأول")} hl7={hisOnly}><Input value={firstAr} onChange={(e) => setFirstAr(e.target.value)} dir="rtl" lang="ar" autoComplete="off" /></Field>
                    <Field label={t("Father (Arabic)", "الأب")} hl7={hisOnly}><Input value={secondAr} onChange={(e) => setSecondAr(e.target.value)} dir="rtl" lang="ar" autoComplete="off" /></Field>
                    <Field label={t("Grandfather (Arabic)", "الجد")} hl7={hisOnly}><Input value={thirdAr} onChange={(e) => setThirdAr(e.target.value)} dir="rtl" lang="ar" autoComplete="off" /></Field>
                    <Field label={t("Family (Arabic)", "لقب العائلة")} hl7={hisOnly}><Input value={familyAr} onChange={(e) => setFamilyAr(e.target.value)} dir="rtl" lang="ar" autoComplete="off" /></Field>
                  </Grid>
                </div>
                {dev && <p className="mt-3 text-xs text-muted-foreground">Assumption: the NPHIES ADT pages do not say how to send an Arabic name, so it stays in the HIS and PID-5 carries the English name.</p>}
              </Group>
            </Sec>

            <Sec title={t("Personal Details", "بيانات تفصيلية")} filled={nameFilled} total={3}>
              <Grid>
                <FF name="dob" error={errs.dob} required={!isUnknown} label={t("Date of Birth", "ت الميلاد")} hl7={tag("PID-7")} hint={dob ? `${hijri(dob)} ${t("Hijri", "هجري")}, ${ageLabel(dob)}` : undefined}>
                  <Input type="date" value={dob} max={today} onChange={(e) => setDob(e.target.value)} />
                </FF>
                <Field group label={t("Sex", "الجنس")} hl7={tag("PID-8")}>
                  <SegmentedControl options={[{ value: "M" as const, label: t("Male", "ذكر") }, { value: "F" as const, label: t("Female", "أنثى") }]} value={sex} onChange={setSex} label={t("Sex", "الجنس")} />
                </Field>
                <Field label={t("Nationality", "الجنسية")} hl7={tag("PID-28")}>
                  <ChoiceSelect options={nationalityOpts} value={nationality} onChange={(v) => v && setNationality(v)} label={t("Nationality", "الجنسية")} />
                </Field>
                <Field label={t("Marital Status", "الحالة الإجتماعية")} hl7={tag("PID-16")}>
                  <Select value={marital} onChange={(e) => setMarital(e.target.value)}>{MARITAL.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}</Select>
                </Field>
                <Field label={t("Religion", "الديانة")} hl7={tag("PID-17 ignored by nphies")}>
                  <Select value={religion} onChange={(e) => setReligion(e.target.value)}>{RELIGIONS.map((x) => <option key={x}>{x}</option>)}</Select>
                </Field>
                <Field label={t("Blood Group", "فصيلة الدم")} hl7={hisOnly}>
                  <Select value={blood} onChange={(e) => setBlood(e.target.value)}><option value="">{t("Not known", "غير معروف")}</option>{BLOOD.map((x) => <option key={x}>{x}</option>)}</Select>
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

            <Sec title={t("ID Card", "بطاقة الهوية")} help={t("Retrieve the card from the registry, or type the details from the card.", "استعرض البطاقة من السجل أو أدخل البيانات من البطاقة.")}>
              <div className="flex flex-wrap gap-2">
                <Button className="h-10" onClick={retrieveIdentityCard} disabled={idNumber.length !== 10}>
                  <IdCard className="size-4" />{t("Retrieve National ID (Iqama) Card", "استعراض بطاقة الهوية")}
                </Button>
                <Button className="h-10" disabled={!idCard} onClick={() => idCard && setArchive((a) => [...a, { kind: "ID card", at: new Date().toISOString(), summary: `${idCard.idType} ${idCard.idNumber}` }])}>
                  {t("Archive National ID (Iqama) Card", "أرشفة بطاقة الهوية")}
                </Button>
              </div>
              {idCard && <p className="mt-2 text-sm">{idCard.idType} <span className="font-mono">{idCard.idNumber}</span>, {idCard.issuer}, {idCard.issueDate} to {idCard.expiryDate}</p>}
              {archive.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{archive.map((a, i) => <Badge key={i} tone="update" className="whitespace-normal leading-tight">{t("Archived", "مؤرشف")}: {a.kind} {a.summary}</Badge>)}</div>}
              <div className="mt-5 border-t border-border pt-5">
                <Grid>
                  <Field label={t("ID Type", "نوع الهوية")} hl7={hisOnly}><Select value={idType} onChange={(e) => setIdType(e.target.value)}>{ID_TYPES.map((x) => <option key={x}>{x}</option>)}</Select></Field>
                  <Field label={t("Issuing Authority", "جهة الإصدار")} hl7={hisOnly}><Select value={issuer} onChange={(e) => setIssuer(e.target.value)}><option value="">{t("Select", "اختر")}</option>{ISSUERS.map((x) => <option key={x}>{x}</option>)}</Select></Field>
                  <Field label={t("Copy No.", "رقم النسخة")} hl7={hisOnly}><Input value={copyNo} onChange={(e) => setCopyNo(e.target.value)} /></Field>
                  <Field label={t("ID Issue Date", "تاريخ الإصدار")} hl7={hisOnly}><Input type="date" value={idIssue} onChange={(e) => setIdIssue(e.target.value)} /></Field>
                  <Field label={t("ID Expiry Date", "تاريخ الانتهاء")} hl7={hisOnly} error={idExpiry && isExpired(idExpiry) ? t("The ID has expired. Ask for a valid ID.", "الهوية منتهية. اطلب هوية سارية.") : undefined}>
                    <Input type="date" value={idExpiry} onChange={(e) => setIdExpiry(e.target.value)} />
                  </Field>
                </Grid>
              </div>
              <CardUpload title={t("ID Card Copy", "صورة بطاقة الهوية")} value={idFile} onChange={setIdFile} t={t} />
            </Sec>

            <Sec title={t("National Health Record", "السجل الصحي الوطني")}>
              <FF name="healthId" error={errs.healthId} required={!isUnknown} label={t("Health ID", "رقم الهوية الصحية")} hl7={tag("PID-3")} hint={healthIdNote ? <span className={cn("font-medium", healthIdNote.ok ? "text-ok" : "text-warn")} role="status">{healthIdNote.text}</span> : isUnknown ? t("Left empty, a test Health ID is given when you save.", "إذا ترك فارغا يعطى رقم تجريبي عند الحفظ.") : t("Issued by the national patient registry. Fetch it with the ID number and the date of birth.", "يصدر من السجل الوطني. استرجعه برقم الهوية وتاريخ الميلاد.")}>
                <div className="flex flex-wrap gap-2">
                  <Input className="min-w-0 flex-1 basis-48 font-mono" value={healthId} onChange={(e) => { setHealthId(e.target.value); setHealthIdNote(null); }} dir="ltr" />
                  <Button className="h-10" onClick={fetchHealthIdFromRegistry} disabled={idNumber.length !== 10 || !dob}><Search className="size-4" />{t("Fetch Health ID", "استرجاع الهوية الصحية")}</Button>
                  <Button className="h-10" onClick={() => { setHealthId(nextHealthId()); setHealthIdNote(null); }}>{t("New Test ID", "رقم تجريبي")}</Button>
                </div>
              </FF>
            </Sec>
          </>
        )}

        {/* ---------- Step 2: Contact and address ---------- */}
        {step === "contact" && (
          <>
            <Sec title={t("Contact Information", "بيانات للإتصال")} help={t("The mobile number gets appointment and result messages.", "يستقبل الجوال رسائل المواعيد والنتائج.")}>
              <Grid>
                <FF name="mobile" error={errs.mobile} required={!isUnknown} label={t("Mobile No.", "الجوال")} hl7={hisOnly}><Input value={mobile} onChange={(e) => setMobile(e.target.value)} dir="ltr" inputMode="tel" placeholder="05XXXXXXXX" /></FF>
                <Field label={t("Country Code", "رمز الدولة")} hl7={hisOnly}><Input value={countryCode} onChange={(e) => setCountryCode(e.target.value)} dir="ltr" /></Field>
                <Field label={t("Area Code", "رمز المنطقة")} hl7={hisOnly}><Input value={areaCode} onChange={(e) => setAreaCode(e.target.value)} dir="ltr" /></Field>
                <Field label={t("Home Phone", "هاتف المنزل")} hl7={hisOnly}><Input value={homePhone} onChange={(e) => setHomePhone(e.target.value)} dir="ltr" inputMode="tel" /></Field>
                <Field label={t("Other Phone", "هاتف آخر")} hl7={hisOnly}><Input value={otherPhone} onChange={(e) => setOtherPhone(e.target.value)} dir="ltr" inputMode="tel" /></Field>
                <FF name="email" error={errs.email} label={t("Email", "البريد الإلكتروني")} hl7={hisOnly}><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" /></FF>
                <Field label={t("Relative Name", "اسم قريب للمريض")} hl7={hisOnly}><Input value={relName} onChange={(e) => setRelName(e.target.value)} /></Field>
                <Field label={t("Relative Mobile", "جوال قريب المريض")} hl7={hisOnly}><Input value={relPhone} onChange={(e) => setRelPhone(e.target.value)} dir="ltr" inputMode="tel" /></Field>
              </Grid>
            </Sec>

            <Sec title={t("Address", "العنوان")} help={t("The national address short code is on the Saudi Post national address card.", "رمز العنوان الوطني المختصر موجود في بطاقة العنوان الوطني.")} filled={contactFilled} total={6}>
              <Grid>
                <Field label={t("Address Type", "نوع العنوان")} hl7={hisOnly}><Select value={addressType} onChange={(e) => setAddressType(e.target.value)}>{ADDRESS_TYPES.map((x) => <option key={x}>{x}</option>)}</Select></Field>
                <FF name="shortCode" error={errs.shortCode} label={t("National Address Short Code", "العنوان الوطني المختصر")} hl7={tag("PID-11")} hint={t("4 letters and 4 digits, for example RRRD2929.", "4 أحرف و4 أرقام، مثال RRRD2929.")}>
                  <Input className="font-mono tracking-wider" value={shortCode} onChange={(e) => setShortCode(e.target.value.toUpperCase())} maxLength={8} dir="ltr" />
                </FF>
                <Field label={t("Region", "المنطقة")} hl7={hisOnly}>
                  <ChoiceSelect options={SAUDI_REGIONS.map((r) => r.region)} value={region} onChange={(v) => { setRegion(v); setCity(""); }} placeholder={t("Select", "اختر")} label={t("Region", "المنطقة")} />
                </Field>
                <Field label={t("City", "المدينة")} hl7={hisOnly} hint={region ? undefined : t("Pick the region first.", "اختر المنطقة أولا.")}>
                  <ChoiceSelect options={SAUDI_REGIONS.find((r) => r.region === region)?.cities ?? []} value={city} onChange={setCity} placeholder={t("Select", "اختر")} label={t("City", "المدينة")} disabled={!region} />
                </Field>
                <FF name="addressLine1" error={errs.addressLine1} required={!isUnknown} label={t("Address Line 1", "سطر العنوان 1")} hl7={hisOnly}>
                  <Input value={address1} onChange={(e) => setAddress1(e.target.value)} placeholder={t("Street, building name", "الشارع، اسم المبنى")} />
                </FF>
                <Field label={t("Address Line 2", "سطر العنوان 2")} hl7={hisOnly}>
                  <Input value={address2} onChange={(e) => setAddress2(e.target.value)} placeholder={t("Unit, PO Box (optional)", "الوحدة، صندوق البريد (اختياري)")} />
                </Field>
              </Grid>
            </Sec>
          </>
        )}

        {/* ---------- Step 3: Coverage ---------- */}
        {step === "coverage" && (
          <>
            <Sec name="coverage" title={t("Insurance Coverage", "التغطية التأمينية")} help={t("The payer is asked before the visit opens. An insurance visit is never saved without asking.", "يتم سؤال شركة التأمين قبل فتح الزيارة.")}>
              {outcome && (ins || payType === "Insurance") ? (
                <CoverageBox outcome={outcome} ar={ar} large>
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
              ) : (
                <div className="flex items-start gap-3 rounded-xl border border-dashed border-input bg-card px-4 py-3 text-sm">
                  <CreditCard className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div>
                    <p className="font-semibold">{payType === "Cash" ? t("Cash patient. The payer is not asked.", "مريض نقدي. لا يتم سؤال شركة التأمين.") : t("Coverage not checked yet", "لم يتم التحقق من التغطية")}</p>
                    <p className="mt-0.5 text-muted-foreground">{t("Retrieve the insurance card to ask the payer. The answer shows here.", "استعرض كارت التأمين لسؤال شركة التأمين. تظهر الإجابة هنا.")}</p>
                  </div>
                </div>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button variant={ins ? "secondary" : "primary"} className="h-10" onClick={retrieveInsuranceCard} disabled={idNumber.length !== 10}>
                  <CreditCard className="size-4" />{ins ? t("Check Again", "تحقق مرة أخرى") : t("Retrieve Patient Insurance Card", "استعراض كارت تأمين المريض")}
                </Button>
                <Button className="h-10" disabled={!ins} onClick={() => ins && setArchive((a) => [...a, { kind: "Insurance card", at: new Date().toISOString(), summary: `${ins.payer} ${ins.memberId}` }])}>
                  {t("Archive Patient Insurance Card", "أرشفة كارت تأمين المريض")}
                </Button>
                {idNumber.length !== 10 && <button type="button" onClick={() => goTo("idNumber")} className="rounded text-xs text-move underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("Enter the ID number first.", "أدخل رقم الهوية أولا")}</button>}
              </div>
              {ins && (
                <div className="mt-4 max-w-xl rounded-xl border border-border bg-card p-4" aria-label="Insurance card">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-base font-semibold">{ins.payer}</div>
                    <Badge tone={ins.status === "Active" ? "ok" : "danger"}>{ins.status === "Active" ? t("Active", "ساري") : t("Expired", "منتهي")}</Badge>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
                    <div><dt className="text-xs text-muted-foreground">{t("Member ID", "الرقم التأميني")}</dt><dd className="font-mono">{ins.memberId}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">{t("Policy", "الوثيقة")}</dt><dd className="font-mono">{ins.policyNo}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">{t("Class", "الفئة")}</dt><dd>{ins.className}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">{t("Network", "الشبكة")}</dt><dd>{ins.network}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">{t("Valid", "الصلاحية")}</dt><dd>{fmtDate(ins.startDate)} to {fmtDate(ins.expiryDate)}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">{t("Co-pay", "نسبة التحمل")}</dt><dd>{ins.copayPercent}%</dd></div>
                  </dl>
                  {dev && <p className="mt-2 text-xs text-muted-foreground">Simulated eligibility response. A real HIS asks the payer through NPHIES financial services (eligibility), which is a different guide from the UHR pages used here.</p>}
                </div>
              )}
              <CardUpload title={t("Insurance Card Copy", "صورة كارت التأمين")} value={insFile} onChange={setInsFile} t={t} />
            </Sec>

            <Sec title={t("Payment And File", "الدفع والملف")}>
              <Grid>
                <Field group label={t("Payment Type", "طريقة الدفع")} hl7={tag("Financial")}>
                  <SegmentedControl options={[{ value: "Cash" as const, label: t("Cash", "نقدي") }, { value: "Insurance" as const, label: t("Insurance", "تأمين") }]} value={payType} onChange={changePayType} label={t("Payment Type", "طريقة الدفع")} />
                </Field>
                <Field label={t("Registration Date", "ت.التسجيل")} hl7={tag("PV1-44")} hint={`${hijri(regDate)} ${t("Hijri", "هجري")}`}><Input type="date" value={regDate} onChange={(e) => setRegDate(e.target.value)} /></Field>
                <Field label={t("File Number", "رقم الملف")} hl7={tag("PID-3 (MRN not sent)")} hint={t("Given when you save.", "يعطى عند الحفظ.")}><Input value={`MR-${String(new Date().getFullYear()).slice(2)}-${String(100 + n).padStart(6, "0")}`} disabled className="font-mono" /></Field>
                <Field label={t("Main File No.", "الملف الرئيسي")} hl7={hisOnly}><Input value={`MF-${1000 + n}`} disabled className="font-mono" /></Field>
                <Field label={t("Registration No.", "رقم التسجيل")} hl7={hisOnly}><Input value={`REG-${today.slice(0, 4)}-${1000 + n}`} disabled className="font-mono" /></Field>
              </Grid>
            </Sec>
          </>
        )}

        {/* ---------- Step 4: Visit, flags and consent ---------- */}
        {step === "visit" && (
          <>
            {needsChoice && (
              <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/40 border-l-4 border-l-destructive bg-card px-4 py-3 text-sm">
                <TriangleAlert className="size-4 shrink-0 text-destructive" aria-hidden="true" />
                <span className="min-w-0 flex-1"><strong>{outcome ? (ar ? outcome.titleAr : outcome.title) : ""}.</strong> {t("Decide on the coverage before you save the visit.", "قرر بشأن التغطية قبل حفظ الزيارة.")}</span>
                <Button size="sm" onClick={() => setStep("coverage")}>{t("Go To Coverage", "الذهاب إلى التغطية")}</Button>
              </div>
            )}
            <Sec title={t("Visit", "الزيارة")} help={t("What is the patient here for today?", "ما سبب حضور المريض اليوم؟")}>
              <div role="radiogroup" aria-label={t("What is the patient here for?", "ما سبب حضور المريض؟")}>
                <div className="grid gap-3 sm:grid-cols-3">
                  {VISITS.map((v) => (
                    <button key={v.id} type="button" role="radio" aria-checked={visit === v.id} onClick={() => chooseVisit(v.id)}
                      className={cn("flex min-h-20 items-start gap-3 rounded-xl border-2 bg-card p-4 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1", visit === v.id ? "border-[#032C26] dark:border-[#39EDD5]" : "border-border hover:border-foreground/30")}>
                      <span className={cn("mt-0.5 shrink-0", visit === v.id ? "text-[#035D53] dark:text-[#39EDD5]" : "text-muted-foreground")}>{v.icon}</span>
                      <span className="min-w-0">
                        <span className="block text-base font-semibold">{ar ? v.ar : v.en}</span>
                        <span className="block text-sm text-muted-foreground">{ar ? v.hintAr : v.hintEn}</span>
                      </span>
                    </button>
                  ))}
                </div>
                <button type="button" role="radio" aria-checked={visit === "none"} onClick={() => chooseVisit("none")}
                  className={cn("mt-3 flex w-full items-center gap-3 rounded-xl border-2 bg-card px-4 py-2.5 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1", visit === "none" ? "border-[#032C26] dark:border-[#39EDD5]" : "border-border hover:border-foreground/30")}>
                  <UserPlus className={cn("size-5 shrink-0", visit === "none" ? "text-[#035D53] dark:text-[#39EDD5]" : "text-muted-foreground")} />
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
                      <ChoiceSelect options={doctorOpts} value={attending} onChange={(v) => v && setAttending(v)} label={t("Doctor", "الطبيب")} />
                    </Field>
                    {visit !== "E" && (
                      <Field label={visit === "O" ? t("Clinic", "العيادة") : t("Department", "القسم")} hl7={tag("PV1-10")}>
                        <ChoiceSelect options={SERVICES.map((s) => ({ value: s.code, label: s.label }))} value={service} onChange={(v) => v && setService(v)} label={t("Department", "القسم")} />
                      </Field>
                    )}
                    {visit === "I" && (
                      <FF name="bedId" error={errs.bedId} required label={t("Bed", "السرير")} hl7={tag("PV1-3")} hint={beds.length ? undefined : t("No bed is free. Free a bed first.", "لا يوجد سرير شاغر.")}>
                        <ChoiceSelect options={beds.map((b) => ({ value: b.id, label: `${b.wardName}, ${bedLabel(b.id)}` }))} value={bedId} onChange={setBedId} placeholder={t("Select", "اختر")} label={t("Bed", "السرير")} />
                      </FF>
                    )}
                    {visit === "I" && (
                      <>
                        <FF name="admissionType" error={errs.admissionType} required label={t("Admission Type", "نوع التنويم")} hl7={tag("PV1-4")}>
                          <Select value={admissionType} onChange={(e) => setAdmissionType(e.target.value)}>
                            <option value="">{t("Select", "اختر")}</option>
                            {ADMISSION_TYPES.map((a) => <option key={a.label} value={a.label}>{a.label}</option>)}
                          </Select>
                        </FF>
                        <FF name="patientCondition" error={errs.patientCondition} required label={t("Patient Condition", "حالة المريض")} hl7={hisOnly}>
                          <Select value={patientCondition} onChange={(e) => setPatientCondition(e.target.value)}>
                            <option value="">{t("Select", "اختر")}</option>
                            {PATIENT_CONDITIONS.map((x) => <option key={x}>{x}</option>)}
                          </Select>
                        </FF>
                        <FF name="expectedStay" error={errs.expectedStay} label={t("Expected Stay", "مدة الإقامة المتوقعة")} hl7={hisOnly}>
                          <Input type="number" min={1} max={365} step={1} value={expectedStay} onChange={(e) => setExpectedStay(e.target.value)} placeholder="3" suffix={t("days", "أيام")} />
                        </FF>
                        <Field label={t("Activity Level", "مستوى النشاط")} hl7={hisOnly}>
                          <Select value={activityLevel} onChange={(e) => setActivityLevel(e.target.value)}><option value="">{t("Select", "اختر")}</option>{ACTIVITY_LEVELS.map((x) => <option key={x}>{x}</option>)}</Select>
                        </Field>
                        <Field label={t("Admission Specialty", "تخصص التنويم")} hl7={hisOnly}>
                          <ChoiceSelect options={ADMISSION_SPECIALTIES} value={admissionSpecialty} onChange={setAdmissionSpecialty} placeholder={t("Select", "اختر")} label={t("Admission Specialty", "تخصص التنويم")} />
                        </Field>
                      </>
                    )}
                    {visit === "E" && (
                      <Field label={t("Arrival Mode", "وسيلة الوصول")} hl7={tag("ZPV1-18")}>
                        <Select value={arrival} onChange={(e) => setArrival(e.target.value as EdData["arrivalMode"])}>{ARRIVAL_MODES.map((m) => <option key={m}>{m}</option>)}</Select>
                      </Field>
                    )}
                    {visit === "E" && !canSetTriage() && (
                      <Field label={t("Triage Level (CTAS)", "مستوى الفرز")}>
                        <p className="flex h-10 items-center rounded-lg border border-border bg-muted px-3 text-sm">{t("The triage nurse sets the level.", "يحدد ممرض الفرز المستوى.")}</p>
                      </Field>
                    )}
                    {visit === "E" && canSetTriage() && (
                      <Field label={t("Triage Level (CTAS)", "مستوى الفرز")} hl7={tag("ZPV1-22")} hint={ctas ? ctasInfo(ctas).description : t("Leave it for the triage nurse, or choose it now if it is clear.", "اتركه لممرض الفرز أو اختره الآن.")}>
                        <Select value={ctas ?? ""} onChange={(e) => setCtas(e.target.value ? (Number(e.target.value) as CtasLevel) : undefined)}>
                          <option value="">{t("Decide At Triage", "يحدد عند الفرز")}</option>
                          {CTAS.map((c) => <option key={c.level} value={c.level}>CTAS {c.level}, {c.label} ({c.targetMin === 0 ? "doctor now" : `doctor within ${c.targetMin} min`})</option>)}
                        </Select>
                      </Field>
                    )}
                    <Field label={t("Referring Doctor", "الطبيب المحول")} hl7={tag("PV1-8")}>
                      <ChoiceSelect options={doctorOpts} value={referring} onChange={setReferring} emptyLabel={t("None", "لا يوجد")} label={t("Referring Doctor", "الطبيب المحول")} />
                    </Field>
                    <Field label={visit === "I" ? t("Reason for Admission", "سبب التنويم") : t("Reason for Visit", "سبب الزيارة")} hl7={tag("PV2-12")} className="col-span-full">
                      <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("Type or tap one below", "اكتب أو اختر أدناه")} />
                    </Field>
                  </Grid>
                  <div className="mt-3 flex flex-wrap gap-1.5">{COMPLAINT_SAMPLES.map((c) => <button key={c.code} type="button" onClick={() => setReason(c.text)} className="rounded-full border border-border bg-card px-2.5 py-1 text-xs hover:border-foreground/45 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{c.text}</button>)}</div>
                  {dev && <p className="mt-3 text-xs text-muted-foreground">{visit === "I" ? "Saving sends ADT A01 with patient class I." : `Saving sends ADT A04 with patient class ${visit}.`} Registering with no visit sends nothing: NPHIES has no message for a patient file alone.</p>}
                </Group>
              )}
            </Sec>

            <Sec title={t("Patient Flags", "تنبيهات المريض")} help={t("Tick what applies. Flags show on the patient banner for every member of staff.", "اختر ما ينطبق. تظهر التنبيهات في شريط المريض لجميع الموظفين.")}>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="min-w-0">
                  <CheckRow checked={dnr} onChange={setDnr} tone="danger" hint={t("Only with a written order from a doctor.", "فقط بأمر مكتوب من الطبيب.")}>{t("Do Not Resuscitate", "عدم الإنعاش")}</CheckRow>
                  {dnr && (
                    <div className="mt-3 grid gap-x-4 gap-y-4 rounded-lg border border-border bg-card p-3 sm:grid-cols-2">
                      <FF name="dnrDoctor" error={errs.dnrDoctor} required label={t("Ordering Doctor", "الطبيب الآمر")}>
                        <ChoiceSelect options={doctorOpts} value={dnrDoctor} onChange={setDnrDoctor} placeholder={t("Select", "اختر")} label={t("Ordering Doctor", "الطبيب الآمر")} />
                      </FF>
                      <FF name="dnrDate" error={errs.dnrDate} required label={t("Order Date", "تاريخ الأمر")}>
                        <Input type="date" value={dnrDate} max={today} onChange={(e) => setDnrDate(e.target.value)} />
                      </FF>
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <CheckRow checked={interpreter} onChange={setInterpreter} hint={t("The patient does not speak Arabic well.", "المريض لا يتحدث العربية جيدا.")}>{t("Needs Interpreter", "يحتاج مترجم")}</CheckRow>
                  {interpreter && (
                    <div className="mt-3 rounded-lg border border-border bg-card p-3">
                      <FF name="language" error={errs.language} required label={t("Language", "اللغة")}>
                        <ChoiceSelect options={INTERPRETER_LANGUAGES} value={language} onChange={setLanguage} placeholder={t("Select", "اختر")} label={t("Language", "اللغة")} />
                      </FF>
                    </div>
                  )}
                </div>
                <CheckRow checked={fallRisk} onChange={setFallRisk} tone="warn" hint={t("Unsteady, uses a walking aid or fell before.", "غير متزن أو يستخدم وسيلة مساعدة أو سقط من قبل.")}>{t("Fall Risk", "خطر السقوط")}</CheckRow>
                <CheckRow checked={isolation} onChange={setIsolation} tone="warn" hint={t("Keep apart from other patients because of infection.", "يبقى بعيدا عن المرضى الآخرين بسبب العدوى.")}>{t("Isolation", "عزل")}</CheckRow>
              </div>
            </Sec>

            <Sec title={t("Consent", "الموافقة")}>
              {/* HIS Patients.ShareData. Optional: the patient may say no, and registration still goes ahead. */}
              <Field group name="consent" label={t("Data Sharing Consent", "الموافقة على مشاركة البيانات")} error={errs.consent} hint={isUnknown ? t("An unconscious patient cannot agree now. Ask when the patient is awake.", "لا يستطيع المريض فاقد الوعي الموافقة الآن. اسأله عندما يستيقظ.") : undefined}>
                <span className="flex items-start gap-3">
                  <Switch checked={consent} onChange={setConsent} label={t("Data Sharing Consent", "الموافقة على مشاركة البيانات")} />
                  <span className="text-sm">{t("The patient agrees to share their health information with the national health exchange (NPHIES) and the providers caring for them.", "يوافق المريض على مشاركة معلوماته الصحية مع المنصة الوطنية (نفيس) ومقدمي الرعاية له.")}</span>
                </span>
              </Field>
            </Sec>
          </>
        )}

        {/* Back and next between the steps */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {stepIndex > 0 ? <Button onClick={() => goStep(steps[stepIndex - 1].id)}>{ar ? "→" : "←"} {t("Back", "السابق")}: {steps[stepIndex - 1].label}</Button> : <span />}
          {stepIndex < steps.length - 1 && <Button onClick={() => goStep(steps[stepIndex + 1].id)}>{t("Next", "التالي")}: {steps[stepIndex + 1].label} {ar ? "←" : "→"}</Button>}
        </div>
      </div>

      {/* Save bar: stays at the bottom of the screen while the clerk scrolls. */}
      <FormActions
        sticky
        reserveEnd
        className="mt-6"
        status={
          shownCount > 0
            ? <AttentionLink count={shownCount} onClick={() => summary.current?.focus()} />
            : needsChoice
              ? <span>{t("The insurance does not cover this visit. You will be asked what to do.", "التأمين لا يغطي هذه الزيارة. سيطلب منك اختيار الإجراء.")}</span>
              : <span>{t(`Step ${stepIndex + 1} of ${steps.length}. You can save from any step.`, `الخطوة ${stepIndex + 1} من ${steps.length}. يمكنك الحفظ من أي خطوة.`)}</span>
        }
        onCancel={() => navigate(AFTER[visit].path)}
        cancelLabel={t("Cancel", "إلغاء")}
        onSave={() => trySave()}
        saveLabel={saveLabel}
      />
      {leaveDialog}

      {/* National identity check */}
      <Dialog
        open={yakeenOpen}
        onClose={() => setYakeenOpen(false)}
        wide
        title={t("Verify With Yakeen", "التحقق عبر يقين")}
        subtitle={t("Check the ID with the national identity service. Use the details to fill the form.", "تحقق من الهوية عبر خدمة الهوية الوطنية واستخدم البيانات لتعبئة النموذج.")}
      >
        {yakeenOpen && <YakeenLookup initial={{ idType: idNumber.startsWith("2") ? "iqama" : "national-id", idNumber, dob }} onUse={applyYakeen} />}
      </Dialog>

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
