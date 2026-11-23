import * as React from "react";
import { ArrowLeft, CheckCircle2, Clock, Eye, EyeOff, Globe, Loader2, MapPin } from "lucide-react";
import { Button, Field, Input, textareaBase } from "@/components/ui/primitives";

/**
 * The public pages around sign-in, matching CT-HIS (CT-CoreApp dev.2.0): /forgot-password, /signup and /contact.
 * Field names and wording follow the HIS pages and public/i18n/en.json and ar.json. Nothing is sent: the demo shows the
 * confirmation the real page shows.
 */
export type PublicView = "forgot" | "signup" | "contact";
type Lang = "en" | "ar";

const TEXT = {
  en: {
    back: "Back to Sign In",
    required: "Required",
    sending: "Sending...",
    // /forgot-password
    forgotTitle: "Forgot Password?",
    forgotLead: "Enter your email address and we'll send you a link to reset your password.",
    emailAddress: "Email Address",
    emailPlaceholder: "Enter your email address",
    badEmail: "Please enter a valid email address",
    sendLink: "Send Reset Link",
    checkTitle: "Check Your Email",
    checkLead: (e: string) => `We sent a password reset link to ${e}.`,
    checkHint: "Didn't receive the email? Check your spam folder or try again.",
    needHelp: "Need help?",
    contactUs: "Contact Us",
    // /signup
    signupTitle: "Create Account",
    signupLead: "Register as a patient to book appointments and see your records",
    haveAccount: "Already have an account?",
    signIn: "Sign In",
    firstName: "First Name",
    lastName: "Last Name",
    dob: "Date of Birth",
    email: "Email",
    password: "Password",
    passwordPlaceholder: "Create a password",
    show: "Show password",
    hide: "Hide password",
    terms: "I agree to the Terms of Use and the Privacy Policy",
    termsNeeded: "Accept the terms to continue",
    create: "Create Account",
    created: "Account created. Sign in to continue.",
    // /contact
    contactTitle: "Contact Us",
    contactLead: "Reach out to our team for any questions or support you may need.",
    formTitle: "Send a Message",
    formLead: "Fill out the form below and we'll respond as soon as possible.",
    phone: "Phone Number",
    message: "Your Message",
    messagePlaceholder: "How can we assist you today?",
    send: "Send Message",
    sentTitle: "Message Sent",
    sentLead: (e: string) => `Thank you. Our support team will reply to ${e}.`,
    hours: "Support Hours",
    hoursValue: "Sunday to Thursday, 8 am to 8 pm",
    visit: "Visit Us",
    address: "8132 Prince Musaad Bin Abdulaziz St., As Sulimaniyah, Riyadh 12232",
    website: "Website",
  },
  ar: {
    back: "العودة إلى تسجيل الدخول",
    required: "مطلوب",
    sending: "جاري الإرسال...",
    forgotTitle: "نسيت كلمة المرور؟",
    forgotLead: "أدخل بريدك الإلكتروني وسنرسل لك رابطًا لإعادة تعيين كلمة المرور.",
    emailAddress: "البريد الإلكتروني",
    emailPlaceholder: "أدخل بريدك الإلكتروني",
    badEmail: "أدخل بريدًا إلكترونيًا صحيحًا",
    sendLink: "إرسال رابط إعادة التعيين",
    checkTitle: "تحقق من بريدك الإلكتروني",
    checkLead: (e: string) => `أرسلنا رابط إعادة تعيين كلمة المرور إلى ${e}.`,
    checkHint: "لم يصلك البريد؟ تحقق من مجلد الرسائل غير المرغوب فيها أو حاول مرة أخرى.",
    needHelp: "تحتاج مساعدة؟",
    contactUs: "اتصل بنا",
    signupTitle: "إنشاء حساب",
    signupLead: "سجّل كمريض لحجز المواعيد والاطلاع على سجلاتك",
    haveAccount: "لديك حساب؟",
    signIn: "تسجيل الدخول",
    firstName: "الاسم الأول",
    lastName: "اسم العائلة",
    dob: "تاريخ الميلاد",
    email: "البريد الإلكتروني",
    password: "كلمة المرور",
    passwordPlaceholder: "أنشئ كلمة مرور",
    show: "إظهار كلمة المرور",
    hide: "إخفاء كلمة المرور",
    terms: "أوافق على شروط الاستخدام وسياسة الخصوصية",
    termsNeeded: "وافق على الشروط للمتابعة",
    create: "إنشاء حساب",
    created: "تم إنشاء الحساب. سجّل الدخول للمتابعة.",
    contactTitle: "اتصل بنا",
    contactLead: "تواصل مع فريقنا لأي أسئلة أو دعم قد تحتاجه.",
    formTitle: "أرسل رسالة",
    formLead: "املأ النموذج أدناه وسنرد عليك في أقرب وقت ممكن.",
    phone: "رقم الهاتف",
    message: "رسالتك",
    messagePlaceholder: "كيف يمكننا مساعدتك اليوم؟",
    send: "إرسال الرسالة",
    sentTitle: "تم إرسال الرسالة",
    sentLead: (e: string) => `شكرًا لك. سيرد فريق الدعم على ${e}.`,
    hours: "ساعات الدعم",
    hoursValue: "من الأحد إلى الخميس، 8 صباحًا إلى 8 مساءً",
    visit: "زرنا",
    address: "8132 شارع الأمير مساعد بن عبدالعزيز، السليمانية، الرياض 12232",
    website: "الموقع الإلكتروني",
  },
} as const;

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const link = "rounded font-medium text-[#035d53] underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none dark:text-[#39edd5]";

/** Waits a moment like a real request, then calls back. */
function useSend() {
  const [busy, setBusy] = React.useState(false);
  const send = (done: () => void) => {
    setBusy(true);
    window.setTimeout(() => { setBusy(false); done(); }, 500);
  };
  return { busy, send };
}

function Header({ title, lead }: { title: string; lead: string }) {
  return (
    <>
      <h2 className="text-[28px] leading-9 font-medium">{title}</h2>
      <p className="mt-2 text-[15px] text-muted-foreground">{lead}</p>
    </>
  );
}

function BackLink({ t, onBack }: { t: (typeof TEXT)[Lang]; onBack: () => void }) {
  return (
    <button type="button" onClick={onBack} className={`${link} mb-6 inline-flex items-center gap-1.5 text-sm`}>
      <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden="true" />
      {t.back}
    </button>
  );
}

function Submit({ busy, label, sending }: { busy: boolean; label: string; sending: string }) {
  return (
    <Button type="submit" variant="primary" disabled={busy} aria-busy={busy} className="mt-6 h-11 w-full text-[15px]">
      {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
      {busy ? sending : label}
    </Button>
  );
}

function Done({ title, lead, hint, children }: { title: string; lead: string; hint?: string; children: React.ReactNode }) {
  return (
    <div role="status">
      <CheckCircle2 className="mb-4 size-10 text-[#016d48] dark:text-[#39edd5]" aria-hidden="true" />
      <Header title={title} lead={lead} />
      {hint && <p className="mt-3 text-sm text-muted-foreground">{hint}</p>}
      <div className="mt-8">{children}</div>
    </div>
  );
}

export function ForgotPasswordForm({ lang, onBack, onContact }: { lang: Lang; onBack: () => void; onContact: () => void }) {
  const t = TEXT[lang];
  const [email, setEmail] = React.useState("");
  const [error, setError] = React.useState("");
  const [sent, setSent] = React.useState(false);
  const { busy, send } = useSend();

  if (sent) {
    return (
      <Done title={t.checkTitle} lead={t.checkLead(email.trim())} hint={t.checkHint}>
        <Button variant="primary" className="h-11 w-full text-[15px]" onClick={onBack}>{t.back}</Button>
      </Done>
    );
  }
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!isEmail(email)) return setError(t.badEmail);
        setError("");
        send(() => setSent(true));
      }}
    >
      <BackLink t={t} onBack={onBack} />
      <Header title={t.forgotTitle} lead={t.forgotLead} />
      <div className="mt-8 [--field-h:2.75rem]">
        <Field label={t.emailAddress} error={error} name="forgot-email" required>
          <Input id="forgot-email" type="email" dir="ltr" autoComplete="email" placeholder={t.emailPlaceholder} value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </Field>
      </div>
      <Submit busy={busy} label={t.sendLink} sending={t.sending} />
      <p className="mt-6 text-sm text-muted-foreground">
        {t.needHelp}{" "}
        <button type="button" onClick={onContact} className={link}>{t.contactUs}</button>
      </p>
    </form>
  );
}

export function SignupForm({ lang, onBack, onCreated }: { lang: Lang; onBack: () => void; onCreated: (email: string) => void }) {
  const t = TEXT[lang];
  const [f, setF] = React.useState({ firstName: "", lastName: "", dob: "", email: "", password: "", terms: false });
  const [errors, setErrors] = React.useState<Partial<Record<keyof typeof f, string>>>({});
  const [reveal, setReveal] = React.useState(false);
  const { busy, send } = useSend();
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const next: typeof errors = {
          firstName: f.firstName.trim() ? undefined : t.required,
          lastName: f.lastName.trim() ? undefined : t.required,
          dob: f.dob ? undefined : t.required,
          email: isEmail(f.email) ? undefined : t.badEmail,
          password: f.password ? undefined : t.required,
          terms: f.terms ? undefined : t.termsNeeded,
        };
        setErrors(next);
        if (Object.values(next).some(Boolean)) return;
        send(() => onCreated(f.email.trim()));
      }}
    >
      <BackLink t={t} onBack={onBack} />
      <Header title={t.signupTitle} lead={t.signupLead} />
      <div className="mt-8 flex flex-col gap-5 [--field-h:2.75rem]">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t.firstName} error={errors.firstName} name="su-first" required>
            <Input id="su-first" autoComplete="given-name" value={f.firstName} onChange={(e) => set("firstName", e.target.value)} autoFocus />
          </Field>
          <Field label={t.lastName} error={errors.lastName} name="su-last" required>
            <Input id="su-last" autoComplete="family-name" value={f.lastName} onChange={(e) => set("lastName", e.target.value)} />
          </Field>
        </div>
        <Field label={t.dob} error={errors.dob} name="su-dob" required>
          <Input id="su-dob" type="date" max={today} autoComplete="bday" value={f.dob} onChange={(e) => set("dob", e.target.value)} />
        </Field>
        <Field label={t.email} error={errors.email} name="su-email" required>
          <Input id="su-email" type="email" dir="ltr" autoComplete="email" placeholder="name@example.com" value={f.email} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field label={t.password} error={errors.password} name="su-password" required>
          <Input
            id="su-password"
            type={reveal ? "text" : "password"}
            dir="ltr"
            autoComplete="new-password"
            placeholder={t.passwordPlaceholder}
            value={f.password}
            onChange={(e) => set("password", e.target.value)}
            suffix={
              <button type="button" onClick={() => setReveal((r) => !r)} aria-label={reveal ? t.hide : t.show} aria-pressed={reveal} className="-me-1.5 flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            }
          />
        </Field>
        <div>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" checked={f.terms} onChange={(e) => set("terms", e.target.checked)} aria-invalid={!!errors.terms} aria-describedby={errors.terms ? "su-terms-error" : undefined} className="mt-0.5 size-5 shrink-0 accent-[#032c26]" />
            <span>{t.terms}</span>
          </label>
          {errors.terms && <p id="su-terms-error" className="mt-1.5 ps-8 text-xs text-destructive">{errors.terms}</p>}
        </div>
      </div>
      <Submit busy={busy} label={t.create} sending={t.sending} />
      <p className="mt-6 text-sm text-muted-foreground">
        {t.haveAccount}{" "}
        <button type="button" onClick={onBack} className={link}>{t.signIn}</button>
      </p>
    </form>
  );
}

export function ContactForm({ lang, onBack }: { lang: Lang; onBack: () => void }) {
  const t = TEXT[lang];
  const [f, setF] = React.useState({ firstName: "", lastName: "", email: "", phone: "", message: "" });
  const [errors, setErrors] = React.useState<Partial<Record<keyof typeof f, string>>>({});
  const [sent, setSent] = React.useState(false);
  const { busy, send } = useSend();
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  if (sent) {
    return (
      <Done title={t.sentTitle} lead={t.sentLead(f.email.trim())}>
        <Button variant="primary" className="h-11 w-full text-[15px]" onClick={onBack}>{t.back}</Button>
      </Done>
    );
  }
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const next: typeof errors = {
          firstName: f.firstName.trim() ? undefined : t.required,
          lastName: f.lastName.trim() ? undefined : t.required,
          email: isEmail(f.email) ? undefined : t.badEmail,
          phone: f.phone.trim() ? undefined : t.required,
          message: f.message.trim() ? undefined : t.required,
        };
        setErrors(next);
        if (Object.values(next).some(Boolean)) return;
        send(() => setSent(true));
      }}
    >
      <BackLink t={t} onBack={onBack} />
      <Header title={t.contactTitle} lead={t.contactLead} />

      {/* Who to reach: Ebttikar's office from its brand guidelines. */}
      <dl className="mt-6 grid gap-3 rounded-xl border border-border bg-card p-4 text-sm">
        {([
          [Clock, t.hours, t.hoursValue],
          [MapPin, t.visit, t.address],
          [Globe, t.website, "ebttikar.com"],
        ] as const).map(([Icon, label, value]) => (
          <div key={label} className="flex gap-3">
            <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-0.5">{value === "ebttikar.com" ? <a href="https://ebttikar.com/" target="_blank" rel="noreferrer" className={link} dir="ltr">ebttikar.com</a> : value}</dd>
            </div>
          </div>
        ))}
      </dl>

      <h3 className="mt-8 text-base font-medium">{t.formTitle}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{t.formLead}</p>
      <div className="mt-5 flex flex-col gap-5 [--field-h:2.75rem]">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t.firstName} error={errors.firstName} name="ct-first" required>
            <Input id="ct-first" autoComplete="given-name" value={f.firstName} onChange={(e) => set("firstName", e.target.value)} autoFocus />
          </Field>
          <Field label={t.lastName} error={errors.lastName} name="ct-last" required>
            <Input id="ct-last" autoComplete="family-name" value={f.lastName} onChange={(e) => set("lastName", e.target.value)} />
          </Field>
        </div>
        <Field label={t.emailAddress} error={errors.email} name="ct-email" required>
          <Input id="ct-email" type="email" dir="ltr" autoComplete="email" placeholder="name@example.com" value={f.email} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field label={t.phone} error={errors.phone} name="ct-phone" required>
          <Input id="ct-phone" type="tel" dir="ltr" autoComplete="tel" placeholder="05X XXX XXXX" value={f.phone} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label={t.message} error={errors.message} name="ct-message" required>
          <textarea id="ct-message" rows={4} placeholder={t.messagePlaceholder} value={f.message} onChange={(e) => set("message", e.target.value)} className={`${textareaBase} min-h-[112px] py-2.5`} />
        </Field>
      </div>
      <Submit busy={busy} label={t.send} sending={t.sending} />
    </form>
  );
}
