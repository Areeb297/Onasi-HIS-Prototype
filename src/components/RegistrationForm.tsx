import * as React from "react";
import { CreditCard, IdCard, Search } from "lucide-react";
import { Badge, Button, Card, Field, Input, RequiredNote, Select, cn } from "@/components/ui/primitives";
import { quickCreate } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { useDevMode } from "@/lib/devmode";
import type { EdData, PatientExtra } from "@/lib/model";
import { ARRIVAL_MODES, startEd } from "@/lib/ed";
import { ADDRESS_PATTERN, COMPLAINT_SAMPLES, DOCTORS, MARITAL, NATIONALITIES, SERVICES, countryCode as nationalityCode, countryLabel } from "@/lib/reference-data";
import { hijri, isExpired, lookupById, retrieveIdCard, retrieveInsurance, REGISTRY, type IdCard as IdCardData, type InsuranceCard } from "@/lib/registry";
import { navigate } from "@/lib/router";
import { nextHealthId, nowLocal, registerPatient, getState } from "@/lib/store";
import { pushToast } from "@/lib/toast";
import { ErQuickRegistration } from "@/components/ErQuickRegistration";

type Lang = "en" | "ar";

const RELIGIONS = ["Islam", "Christianity", "Hinduism", "Buddhism", "Other"];
const BLOOD = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const SOCIAL = ["Employee", "Student", "Retired", "Dependent", "Unemployed"];
const ID_TYPES = ["National ID", "Iqama", "Passport", "GCC ID"];
const ISSUERS = ["Ministry of Interior", "Passports Directorate", "Other"];
const ADDRESS_TYPES = ["Home", "Work", "Temporary"];
const FILE_STATUS = ["Regular File", "VIP File", "Temporary File"];

/** Section card: a heading row at the start of the card, a divider, then the fields. */
function Sec({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="mt-6 shadow-xs">
      <header className="flex items-center gap-2.5 border-b border-border px-5 py-3">
        <span aria-hidden="true" className="h-4 w-1 shrink-0 rounded-full bg-primary" />
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
      </header>
      <div className="px-5 py-5">{children}</div>
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

function FullRegistrationForm({ cls = "O" }: { cls?: "O" | "E" }) {
  const dev = useDevMode();
  const [lang, setLang] = React.useState<Lang>("en");
  const ar = lang === "ar";
  const t = (en: string, a: string) => (ar ? a : en);
  const today = nowLocal().slice(0, 10);
  const n = getState().counters.patient + 1;

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
  // Registry, cards
  const [healthId, setHealthId] = React.useState("");
  const [found, setFound] = React.useState<"" | "found" | "none">("");
  const [ins, setIns] = React.useState<InsuranceCard | null>(null);
  const [idCard, setIdCard] = React.useState<IdCardData | null>(null);
  const [archive, setArchive] = React.useState<NonNullable<PatientExtra["archive"]>>([]);
  // Visit
  const [attending, setAttending] = React.useState(DOCTORS[0].id);
  const [referring, setReferring] = React.useState("");
  const [service, setService] = React.useState(cls === "E" ? "ER" : "OPD");
  const [reason, setReason] = React.useState("");
  const [consent, setConsent] = React.useState(false);
  const [arrival, setArrival] = React.useState<EdData["arrivalMode"]>("Walk-in");

  function applyInsurance(c: InsuranceCard) {
    setIns(c);
    setPayType(c.status === "Active" ? "Insurance" : "Cash");
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
    setIdNumber(digits);
    setFound("");
    if (digits.length === 10) lookup(digits);
  }

  function retrieveInsuranceCard() {
    const c = retrieveInsurance(idNumber);
    if (!c) {
      pushToast({ tone: "warn", text: "No insurance found for this ID.", detail: "The visit type stays Cash." });
      return;
    }
    applyInsurance(c);
    audit("view", "Insurance eligibility check", { detail: `${c.payer} ${c.status}` });
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

  const addressOk = shortCode === "" || ADDRESS_PATTERN.test(shortCode);
  const problems: string[] = [];
  if (!idNumber) problems.push("Enter the ID number.");
  if (!healthId.trim()) problems.push("The Health ID is required.");
  if (!first.trim() || !family.trim()) problems.push("Enter the first and family names.");
  if (!dob) problems.push("Enter the date of birth.");
  if (!addressOk) problems.push("The national address short code is not valid.");
  if (!consent) problems.push("Confirm the patient consent.");
  const warnings: string[] = [];
  if (idExpiry && isExpired(idExpiry)) warnings.push("The ID has expired.");
  if (ins && ins.status === "Expired") warnings.push("The insurance card has expired. The visit type is Cash.");

  function submit() {
    const extra: PatientExtra = {
      secondName: second, thirdName: third, nameAr: { first: firstAr, second: secondAr, third: thirdAr, family: familyAr },
      religion, bloodGroup: blood, fileStatus, socialStatus: social, placeOfBirth: birthPlace, occupation, employeeNo,
      idType, idNumber, idIssuer: issuer, idIssueDate: idIssue, idExpiry, idCopyNo: copyNo, addressType, addressText,
      homePhone, mobile, otherPhone, countryCode, areaCode, relationName: relName, relationPhone: relPhone, email,
      mainFileNo: `MF-${1000 + n}`, registrationNo: `REG-${today.slice(0, 4)}-${1000 + n}`, visitPayType: payType,
      insurance: ins ?? undefined, archive,
    };
    const p = registerPatient({
      healthId: healthId.trim(), given: first.trim(), family: family.trim(), dob, sex, nationality, maritalStatus: marital,
      address: shortCode, consentAt: new Date().toISOString(), extra,
    });
    const out = quickCreate("A04", { patientId: p.id, attending, service, reason, referring, cls });
    if (cls === "E" && out.entry) startEd(out.entry.visitNumber, arrival);
    navigate(cls === "E" ? "/er" : "/opd");
  }

  const tag = (s: string) => (dev ? s : undefined);
  const hisOnly = tag("HIS only");

  return (
    <div dir={ar ? "rtl" : "ltr"} className="pb-6">
      {/* Language switch and ID lookup */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <Field required label={t("ID (Iqama) Number", "رقم الهوية")} hl7={tag("PID-3 via registry")}>
            <Input className="w-56 font-mono" value={idNumber} onChange={(e) => onIdChange(e.target.value)} placeholder="10 digits" inputMode="numeric" aria-label="ID number" />
          </Field>
          <Button className="h-10" onClick={() => lookup()} disabled={idNumber.length !== 10}><Search className="size-4" />{t("Look Up Patient", "بحث عن المريض")}</Button>
          {found === "found" && <Badge tone="ok">{t("Found in the national registry (simulated)", "تم العثور عليه في السجل الوطني (محاكاة)")}</Badge>}
          {found === "none" && <Badge tone="warn">{t("Not found. Enter the details by hand.", "غير موجود. أدخل البيانات يدويا")}</Badge>}
        </div>
        <div role="group" aria-label="Language" className="flex rounded-lg border border-border bg-muted p-0.5">
          {(["en", "ar"] as const).map((l) => (
            <button key={l} onClick={() => setLang(l)} aria-pressed={lang === l} className={cn("rounded-md px-3 py-1.5 text-sm font-medium", lang === l ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {l === "en" ? "English" : "العربية"}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {t("Try these test IDs: ", "جرب هذه الأرقام: ")}
        {REGISTRY.map((r) => (
          <button key={r.idNumber} onClick={() => onIdChange(r.idNumber)} className="me-2 font-mono text-move underline">{r.idNumber}</button>
        ))}
      </p>
      <RequiredNote className="mt-3" />

      <Sec title={t("Patient Name", "إسم المريض")}>
        <Group title={t("Name (English)", "الإسم بالإنجليزية")}>
          <Grid>
            <Field required label={t("First", "First")} hl7={tag("PID-5.2")}><Input value={first} onChange={(e) => setFirst(e.target.value)} dir="ltr" /></Field>
            <Field label={t("Second", "Second")} hl7={tag("PID-5.3")}><Input value={second} onChange={(e) => setSecond(e.target.value)} dir="ltr" /></Field>
            <Field label={t("Third", "Third")} hl7={tag("PID-5.3")}><Input value={third} onChange={(e) => setThird(e.target.value)} dir="ltr" /></Field>
            <Field required label={t("Family", "Family")} hl7={tag("PID-5.1")}><Input value={family} onChange={(e) => setFamily(e.target.value)} dir="ltr" /></Field>
          </Grid>
        </Group>
        <Group title={t("Name (Arabic)", "الإسم بالعربي")} className="mt-5 border-t border-border pt-5">
          <Grid>
            <Field label={t("First", "الأول")} hl7={hisOnly}><Input value={firstAr} onChange={(e) => setFirstAr(e.target.value)} dir="rtl" /></Field>
            <Field label={t("Second", "الثاني")} hl7={hisOnly}><Input value={secondAr} onChange={(e) => setSecondAr(e.target.value)} dir="rtl" /></Field>
            <Field label={t("Third", "الثالث")} hl7={hisOnly}><Input value={thirdAr} onChange={(e) => setThirdAr(e.target.value)} dir="rtl" /></Field>
            <Field label={t("Family", "لقب العائلة")} hl7={hisOnly}><Input value={familyAr} onChange={(e) => setFamilyAr(e.target.value)} dir="rtl" /></Field>
          </Grid>
          {dev && <p className="mt-3 text-xs text-muted-foreground">Assumption: the NPHIES ADT pages do not say how to send an Arabic name, so it stays in the HIS and PID-5 carries the English name.</p>}
        </Group>
      </Sec>

      <Sec title={t("File Information", "بيانات ملف")}>
        <Grid>
          <Field label={t("Main File No.", "الملف الرئيسي")} hl7={hisOnly}><Input value={`MF-${1000 + n}`} disabled /></Field>
          <Field label={t("File Number", "رقم الملف")} hl7={tag("PID-3 (MRN not sent)")}><Input value={`MRN${String(100 + n).padStart(7, "0")}`} disabled /></Field>
          <Field label={t("Registration No.", "رقم التسجيل")} hl7={hisOnly}><Input value={`REG-${today.slice(0, 4)}-${1000 + n}`} disabled /></Field>
          <Field label={t("Visit Type", "نوع المراجع")} hl7={tag("Financial")}>
            <Select value={payType} onChange={(e) => setPayType(e.target.value as "Cash" | "Insurance")}>
              <option value="Cash">{t("Cash", "نقدي")}</option>
              <option value="Insurance">{t("Insurance", "تأمين")}</option>
            </Select>
          </Field>
          <Field label={t("Registration Date", "ت.التسجيل")} hl7={tag("PV1-44")}><Input type="date" value={regDate} onChange={(e) => setRegDate(e.target.value)} /></Field>
          <Field label={t("Hijri Date", "التاريخ الهجري")}><Input value={hijri(regDate)} disabled dir="ltr" /></Field>
        </Grid>
      </Sec>

      <Sec title={t("Demographic Details", "بيانات تفصيلية")}>
        <Grid>
          <Field label={t("Nationality", "الجنسية")} hl7={tag("PID-28")}>
            <Select value={nationality} onChange={(e) => setNationality(e.target.value)}>{!NATIONALITIES.some((x) => x.code === nationality) && <option value={nationality}>{countryLabel(nationality) || nationality}</option>}{NATIONALITIES.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}</Select>
          </Field>
          <Field label={t("Gender", "النوع")} hl7={tag("PID-8")}>
            <Select value={sex} onChange={(e) => setSex(e.target.value as "M" | "F")}><option value="M">{t("Male", "ذكر")}</option><option value="F">{t("Female", "أنثى")}</option></Select>
          </Field>
          <Field label={t("Marital Status", "الحالة الإجتماعية")} hl7={tag("PID-16")}>
            <Select value={marital} onChange={(e) => setMarital(e.target.value)}>{MARITAL.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}</Select>
          </Field>
          <Field required label={t("Date of Birth", "ت الميلاد")} hl7={tag("PID-7")}><Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} /></Field>
          <Field label={t("Religion", "الديانة")} hl7={tag("PID-17 ignored by nphies")}>
            <Select value={religion} onChange={(e) => setReligion(e.target.value)}>{RELIGIONS.map((x) => <option key={x}>{x}</option>)}</Select>
          </Field>
          <Field label={t("Blood Group", "فصيلة الدم")} hl7={hisOnly}>
            <Select value={blood} onChange={(e) => setBlood(e.target.value)}><option value="">{t("Select", "اختر")}</option>{BLOOD.map((x) => <option key={x}>{x}</option>)}</Select>
          </Field>
          <Field label={t("File Status", "حالة الملف")} hl7={hisOnly}>
            <Select value={fileStatus} onChange={(e) => setFileStatus(e.target.value)}>{FILE_STATUS.map((x) => <option key={x}>{x}</option>)}</Select>
          </Field>
          <Field label={t("Social Status", "الحالة الإجتماعية")} hl7={hisOnly}>
            <Select value={social} onChange={(e) => setSocial(e.target.value)}><option value="">{t("Select", "اختر")}</option>{SOCIAL.map((x) => <option key={x}>{x}</option>)}</Select>
          </Field>
          <Field label={t("Place of Birth", "محل الميلاد")} hl7={hisOnly}><Input value={birthPlace} onChange={(e) => setBirthPlace(e.target.value)} /></Field>
          <Field label={t("Occupation", "الوظيفة")} hl7={hisOnly}><Input value={occupation} onChange={(e) => setOccupation(e.target.value)} /></Field>
          <Field label={t("Employee No.", "الرقم الوظيفي")} hl7={hisOnly}><Input value={employeeNo} onChange={(e) => setEmployeeNo(e.target.value)} /></Field>
          <Field label={t("Sponsor Company", "شركة المراجع")} hl7={tag("Financial")}><Input value={ins?.payer ?? ""} disabled placeholder={t("Filled by Retrieve Insurance Card", "يُملأ من استعراض كارت التأمين")} /></Field>
          <Field label={t("Sponsor ID No.", "الرقم التأميني")} hl7={tag("Financial")}><Input value={ins?.memberId ?? ""} disabled /></Field>
          <Field label={t("Treatment Start Date", "تاريخ بداية العلاج")} hl7={tag("Financial")}><Input value={ins?.startDate ?? ""} disabled /></Field>
          <Field label={t("Treatment End Date", "تاريخ إنتهاء العلاج")} hl7={tag("Financial")}><Input value={ins?.expiryDate ?? ""} disabled /></Field>
          <Field label={t("Insurance Expiry Date", "تاريخ إنتهاء البطاقة")} hl7={tag("Financial")}>
            <Input value={ins?.expiryDate ?? ""} disabled className={ins && ins.status === "Expired" ? "disabled:border-destructive disabled:text-destructive" : ""} />
          </Field>
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
          <Field label={t("National Address Short Code", "العنوان الوطني المختصر")} hl7={tag("PID-11")} hint={addressOk ? undefined : t("4 capital letters then 4 digits", "4 أحرف كبيرة ثم 4 أرقام")}>
            <Input className="font-mono" value={shortCode} onChange={(e) => setShortCode(e.target.value.toUpperCase())} maxLength={8} dir="ltr" aria-invalid={!addressOk} />
          </Field>
          <Field label={t("Address", "العنوان")} hl7={hisOnly}><Input value={addressText} onChange={(e) => setAddressText(e.target.value)} /></Field>
        </Grid>
      </Sec>

      <Sec title={t("Contact Information", "بيانات للإتصال")}>
        <Grid>
          <Field label={t("Mobile No.", "الجوال")} hl7={hisOnly}><Input value={mobile} onChange={(e) => setMobile(e.target.value)} dir="ltr" /></Field>
          <Field label={t("Country Code", "رمز الدولة")} hl7={hisOnly}><Input value={countryCode} onChange={(e) => setCountryCode(e.target.value)} dir="ltr" /></Field>
          <Field label={t("Area Code", "رمز المنطقة")} hl7={hisOnly}><Input value={areaCode} onChange={(e) => setAreaCode(e.target.value)} dir="ltr" /></Field>
          <Field label={t("Home Phone", "هاتف المنزل")} hl7={hisOnly}><Input value={homePhone} onChange={(e) => setHomePhone(e.target.value)} dir="ltr" /></Field>
          <Field label={t("Other Phone", "هاتف آخر")} hl7={hisOnly}><Input value={otherPhone} onChange={(e) => setOtherPhone(e.target.value)} dir="ltr" /></Field>
          <Field label={t("Relative Name", "اسم قريب للمريض")} hl7={hisOnly}><Input value={relName} onChange={(e) => setRelName(e.target.value)} /></Field>
          <Field label={t("Relative Mobile", "جوال قريب المريض")} hl7={hisOnly}><Input value={relPhone} onChange={(e) => setRelPhone(e.target.value)} dir="ltr" /></Field>
          <Field label={t("Email", "البريد الإلكتروني")} hl7={hisOnly}><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" /></Field>
        </Grid>
      </Sec>

      <Sec title={t("Insurance Card", "كارت التأمين")}>
        <div className="flex flex-wrap items-start gap-3">
          <Button className="h-10 border-2 border-update/60" onClick={retrieveInsuranceCard} disabled={idNumber.length !== 10}>
            <CreditCard className="size-4" />{t("Retrieve Patient Insurance Card", "استعراض كارت تأمين المريض")}
          </Button>
          <Button className="h-10" disabled={!ins} onClick={() => ins && setArchive((a) => [...a, { kind: "Insurance card", at: new Date().toISOString(), summary: `${ins.payer} ${ins.memberId}` }])}>
            {t("Archive Patient Insurance Card", "أرشفة كارت تأمين المريض")}
          </Button>
          {!idNumber && <span className="self-center text-xs text-muted-foreground">{t("Enter the ID number first.", "أدخل رقم الهوية أولا")}</span>}
        </div>
        {ins && (
          <div className="mt-3 max-w-xl rounded-xl border border-border bg-gradient-to-br from-move/10 to-admit/10 p-4" aria-label="Insurance card">
            <div className="flex items-center justify-between">
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
        {archive.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{archive.map((a, i) => <Badge key={i} tone="update">{t("Archived", "مؤرشف")}: {a.kind} {a.summary}</Badge>)}</div>}
      </Sec>

      <Sec title={t("National Health Record", "السجل الصحي الوطني")}>
        <Grid cols={2}>
          <Field required label={t("Health ID", "رقم الهوية الصحية")} hl7={tag("PID-3")} hint={t("Required. Issued by the NHIC Patient Registry. Test value.", "مطلوب. يصدر من السجل الوطني")}>
            <div className="flex gap-2"><Input className="font-mono" value={healthId} onChange={(e) => setHealthId(e.target.value)} dir="ltr" /><Button className="h-10" onClick={() => setHealthId(nextHealthId())}>{t("New Test ID", "رقم تجريبي")}</Button></div>
          </Field>
        </Grid>
      </Sec>

      <Sec title={cls === "E" ? t("Emergency Visit", "زيارة طوارئ") : t("First Visit", "الزيارة الأولى")}>
        <Grid>
          <Field label={t("Doctor", "الطبيب")} hl7={tag("PV1-7")}><Select value={attending} onChange={(e) => setAttending(e.target.value)}>{DOCTORS.map((d) => <option key={d.id} value={d.id}>Dr. {d.given} {d.family}</option>)}</Select></Field>
          <Field label={t("Department", "القسم")} hl7={tag("PV1-10")}><Select value={service} onChange={(e) => setService(e.target.value)}>{SERVICES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}</Select></Field>
          <Field label={t("Referring Doctor", "الطبيب المحول")} hl7={tag("PV1-8")}><Select value={referring} onChange={(e) => setReferring(e.target.value)}><option value="">{t("None", "لا يوجد")}</option>{DOCTORS.map((d) => <option key={d.id} value={d.id}>Dr. {d.given} {d.family}</option>)}</Select></Field>
          <Field label={t("Reason for Visit", "سبب الزيارة")} hl7={tag("PV2-12")}><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          {cls === "E" && (
            <Field label={t("Arrival Mode", "وسيلة الوصول")} hl7={tag("ZPV1-18")}>
              <Select value={arrival} onChange={(e) => setArrival(e.target.value as EdData["arrivalMode"])}>{ARRIVAL_MODES.map((m) => <option key={m}>{m}</option>)}</Select>
            </Field>
          )}
        </Grid>
        <div className="mt-4 flex flex-wrap gap-2">{COMPLAINT_SAMPLES.map((c) => <button key={c.code} type="button" onClick={() => setReason(c.text)} className="rounded-md border border-border bg-muted px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent">{c.text}</button>)}</div>
      </Sec>

      <label className="mt-6 flex items-start gap-2.5 text-sm">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-4 accent-[var(--primary)]" />
        <span>{t("The patient has been told how their health information is used and shared with the national exchange (NPHIES), and agrees.", "تم إبلاغ المريض بكيفية استخدام معلوماته الصحية ومشاركتها مع المنصة الوطنية (نفيس) ووافق على ذلك.")}</span>
      </label>

      {warnings.map((w) => <p key={w} className="mt-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm">{w}</p>)}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={problems.length > 0} onClick={submit}>{t("Register Patient And Visit", "تسجيل المريض والزيارة")}</Button>
        <Button onClick={() => navigate(cls === "E" ? "/er" : "/opd")}>{t("Cancel", "إلغاء")}</Button>
        {problems.length > 0 && <span className="text-sm text-muted-foreground">{problems[0]}</span>}
      </div>
    </div>
  );
}

/** Outpatient registration is the full form. Emergency registration starts with the quick form, and the full form is one tap away. */
export function RegistrationForm({ cls = "O" }: { cls?: "O" | "E" }) {
  const [full, setFull] = React.useState(false);
  if (cls !== "E") return <FullRegistrationForm cls={cls} />;
  return (
    <div>
      <div role="group" aria-label="Registration form" className="mb-4 flex w-fit rounded-md border border-border bg-muted p-0.5">
        {([false, true] as const).map((f) => (
          <button key={String(f)} type="button" onClick={() => setFull(f)} aria-pressed={full === f} className={cn("rounded px-3 py-1.5 text-xs font-medium", full === f ? "bg-card shadow-sm" : "text-muted-foreground")}>
            {f ? "Full Registration" : "Quick Emergency Registration"}
          </button>
        ))}
      </div>
      {full ? <FullRegistrationForm cls="E" /> : <ErQuickRegistration />}
    </div>
  );
}
