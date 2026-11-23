import * as React from "react";
import { Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { Button, Field, Input } from "@/components/ui/primitives";
import { ContactForm, ForgotPasswordForm, SignupForm } from "@/components/login/PublicForms";
import { navigate, useRoute } from "@/lib/router";
import { currentUser, signIn, userForEmail } from "@/lib/session";

// The 3D scene loads only here, so three.js stays out of the main app bundle.
const HospitalScene = React.lazy(() => import("@/components/login/HospitalScene"));

const TEXT = {
  en: {
    other: "العربية",
    headline: "Your hospital workspace",
    sub: "Appointments, patient records and care workflows",
    shifts: ["Morning shift", "Evening shift", "Night shift"],
    title: "Sign In to Onasi HIS",
    lead: "Use your hospital account to continue",
    email: "Provider Email",
    password: "Password",
    show: "Show password",
    hide: "Hide password",
    forgot: "Forgot Password?",
    submit: "Sign In",
    caps: "Caps Lock is on",
    signingIn: "Signing In",
    restricted: "For authorized hospital staff only. Sign-ins and record access are logged.",
    demo: "Demo: any email and password sign in. A staff name, for example khalid@onasi.care, opens that person's account.",
    powered: "Powered by",
    newPatient: "New patient?",
    createAccount: "Create Account",
    needHelp: "Need help?",
    contactUs: "Contact Us",
    created: "Account created. Sign in to continue.",
    sceneLabel: "3D hospital. Drag or use the arrow keys to turn it.",
    drag: "Drag to turn",
  },
  ar: {
    other: "English",
    headline: "مساحة عمل مستشفاك",
    sub: "المواعيد والسجلات الطبية وإجراءات الرعاية",
    shifts: ["المناوبة الصباحية", "المناوبة المسائية", "المناوبة الليلية"],
    title: "تسجيل الدخول إلى Onasi HIS",
    lead: "استخدم حساب المستشفى للمتابعة",
    email: "البريد الإلكتروني",
    password: "كلمة المرور",
    show: "إظهار كلمة المرور",
    hide: "إخفاء كلمة المرور",
    forgot: "نسيت كلمة المرور؟",
    submit: "تسجيل الدخول",
    caps: "مفتاح الأحرف الكبيرة مفعّل",
    signingIn: "جارٍ تسجيل الدخول",
    restricted: "للموظفين المصرّح لهم فقط. يُسجَّل الدخول والاطلاع على السجلات.",
    demo: "للعرض: أي بريد إلكتروني وكلمة مرور يسجّلان الدخول. اسم الموظف، مثل khalid@onasi.care، يفتح حسابه.",
    powered: "بدعم من",
    newPatient: "مريض جديد؟",
    createAccount: "إنشاء حساب",
    needHelp: "تحتاج مساعدة؟",
    contactUs: "اتصل بنا",
    created: "تم إنشاء الحساب. سجّل الدخول للمتابعة.",
    sceneLabel: "مستشفى ثلاثي الأبعاد. اسحب أو استخدم مفاتيح الأسهم لتدويره.",
    drag: "اسحب للتدوير",
  },
} as const;

type Lang = keyof typeof TEXT;

/** The public pages keep the HIS routes, so a link such as #/contact opens that form directly. */
const PUBLIC = { "/forgot-password": "forgot", "/signup": "signup", "/contact": "contact" } as const;
type View = (typeof PUBLIC)[keyof typeof PUBLIC] | "signin";
const PATH: Record<View, string> = { signin: "/login", forgot: "/forgot-password", signup: "/signup", contact: "/contact" };

/** Morning 07 to 15, evening 15 to 23, night 23 to 07, the common 8-hour hospital shifts. */
const shiftOf = (h: number) => (h >= 7 && h < 15 ? 0 : h >= 15 && h < 23 ? 1 : 2);

function useClock() {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export function LoginPage() {
  const [lang, setLang] = React.useState<Lang>(() => {
    try { return localStorage.getItem("login.lang") === "ar" ? "ar" : "en"; } catch { return "en"; }
  });
  const t = TEXT[lang];
  const rtl = lang === "ar";
  const now = useClock();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [reveal, setReveal] = React.useState(false);
  const route = useRoute();
  const view: View = (PUBLIC as Record<string, View | undefined>)[route.path] ?? "signin";
  const go = (v: View) => navigate(PATH[v]);
  const [notice, setNotice] = React.useState("");
  const [caps, setCaps] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const switchLang = () => {
    const next: Lang = rtl ? "en" : "ar";
    setLang(next);
    try { localStorage.setItem("login.lang", next); } catch { /* private mode */ }
  };

  // Demo: Sign In always works. A staff name in the email opens that account; anything else keeps the last account used.
  // shortcut: no credential check at all; the real HIS checks the password and locks the account on the server.
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    window.setTimeout(() => {
      if (route.path === "/login") navigate("/patients"); // the sign-in address is not a page inside the HIS
      signIn((userForEmail(email.trim()) ?? currentUser()).id);
    }, 300);
  };
  const capsCheck = (e: React.KeyboardEvent) => setCaps(e.getModifierState?.("CapsLock") ?? false);

  return (
    <div dir={rtl ? "rtl" : "ltr"} lang={lang} className="flex h-full flex-col overflow-y-auto bg-background text-foreground lg:flex-row lg:overflow-hidden">
      {/* The hospital scene with the headline on its calm upper part */}
      <section className="relative shrink-0 p-3 sm:h-[380px] lg:h-full lg:w-[56%] lg:p-4">
        {/* On a phone the scene is its own strip under the text; from tablet width it fills the panel behind the text. */}
        <div className="relative flex h-full flex-col overflow-hidden rounded-[20px] bg-[#032c26]">
          <React.Suspense fallback={<div className="h-[168px] sm:hidden" />}>
            <HospitalScene rtl={rtl} label={t.sceneLabel} className="relative order-last h-[168px] outline-none focus-visible:ring-2 focus-visible:ring-[#39edd5] focus-visible:ring-inset sm:absolute sm:inset-0 sm:h-auto" />
          </React.Suspense>
          <div className="pointer-events-none relative flex flex-col p-6 pb-0 sm:h-full sm:p-10">
            <img src="/brand/onasi-wordmark-mint.png" alt="Onasi" className="h-7 w-auto self-start sm:h-8" />
            <h1 className="mt-8 max-w-[14ch] text-[32px] leading-[1.1] font-medium tracking-[-0.01em] text-[#f4fbf7] sm:mt-14 sm:text-[48px] lg:text-[56px]">{t.headline}</h1>
            <p className="mt-3 max-w-[36ch] text-[15px] leading-6 text-[#daf0e4]/75 sm:text-[17px]">{t.sub}</p>
            <p className="mt-auto hidden items-center gap-2 font-mono text-xs text-[#daf0e4]/70 tabular-nums sm:flex">
              <span className="size-2 rounded-[2px] bg-[#e4f7ec]" aria-hidden="true" />
              <span>{t.shifts[shiftOf(now.getHours())]}</span>
              <span aria-hidden="true">·</span>
              <bdi>{now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</bdi>
              <span aria-hidden="true">·</span>
              <span>{t.drag}</span>
            </p>
          </div>
        </div>
      </section>

      {/* Sign in */}
      <section className="flex flex-1 flex-col px-6 pt-4 pb-6 sm:px-10 lg:min-h-0 lg:overflow-y-auto lg:pt-6">
        <div className="flex justify-end">
          <Button onClick={switchLang} className="h-10 px-4" lang={rtl ? "en" : "ar"} aria-label={rtl ? "Switch to English" : "التبديل إلى العربية"}>{t.other}</Button>
        </div>

        <div className="flex flex-1 items-center justify-center py-10">
          {view === "forgot" && <div className="w-full max-w-[400px]"><ForgotPasswordForm lang={lang} onBack={() => go("signin")} onContact={() => go("contact")} /></div>}
          {view === "signup" && (
            <div className="w-full max-w-[440px]">
              <SignupForm lang={lang} onBack={() => go("signin")} onCreated={(e) => { setEmail(e); setNotice(t.created); go("signin"); }} />
            </div>
          )}
          {view === "contact" && <div className="w-full max-w-[440px]"><ContactForm lang={lang} onBack={() => go("signin")} /></div>}
          {view === "signin" && <form onSubmit={submit} noValidate className="w-full max-w-[380px]">
            {notice && <p role="status" className="mb-6 rounded-lg border border-[#016d48]/25 bg-[#016d48]/5 px-3 py-2 text-sm text-[#016d48] dark:text-[#39edd5]">{notice}</p>}
            <h2 className="text-[28px] leading-9 font-medium">{t.title}</h2>
            <p className="mt-2 text-[15px] text-muted-foreground">{t.lead}</p>

            <div className="mt-8 flex flex-col gap-5 [--field-h:2.75rem]">
              <Field label={t.email} name="email">
                <Input
                  id="email"
                  type="email"
                  dir="ltr"
                  autoComplete="username"
                  placeholder="name@hospital.sa"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus
                />
              </Field>
              <Field label={t.password} name="password">
                <Input
                  id="password"
                  type={reveal ? "text" : "password"}
                  dir="ltr"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyUp={capsCheck}
                  onKeyDown={capsCheck}
                  suffix={
                    <button
                      type="button"
                      onClick={() => setReveal((r) => !r)}
                      aria-label={reveal ? t.hide : t.show}
                      aria-pressed={reveal}
                      className="-me-1.5 flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  }
                />
              </Field>
              {caps && <p className="-mt-3 text-xs font-medium text-[#8a5a00] dark:text-amber-300">{t.caps}</p>}
            </div>

            <div className="mt-3 flex justify-end">
              <button type="button" onClick={() => go("forgot")} className="rounded text-sm font-medium text-[#035d53] underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none dark:text-[#39edd5]">
                {t.forgot}
              </button>
            </div>

            <Button type="submit" variant="primary" disabled={busy} aria-busy={busy} className="mt-6 h-11 w-full text-[15px]">
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {busy ? t.signingIn : t.submit}
            </Button>
            <p className="mt-5 flex gap-2 text-xs leading-5 text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{t.restricted}</span>
            </p>
            <p className="mt-2 ps-6 text-xs leading-5 text-muted-foreground/80">{t.demo}</p>
            <div className="mt-6 flex flex-wrap justify-between gap-x-4 gap-y-2 border-t border-border pt-5 text-sm text-muted-foreground">
              <p>{t.newPatient} <button type="button" onClick={() => go("signup")} className="rounded font-medium text-[#035d53] underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none dark:text-[#39edd5]">{t.createAccount}</button></p>
              <p>{t.needHelp} <button type="button" onClick={() => go("contact")} className="rounded font-medium text-[#035d53] underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none dark:text-[#39edd5]">{t.contactUs}</button></p>
            </div>
          </form>}
        </div>

        {/* Ebttikar logo: primary colours on white, original proportions, clear space around it (brand guidelines 05, 08, 10) */}
        <div className="flex items-center justify-center gap-4">
          <span className="text-xs text-muted-foreground">{t.powered}</span>
          <img src="/brand/ebttikar-logo-primary.png" alt="Ebttikar" width={61} height={72} className="h-[72px] w-auto dark:rounded-md dark:bg-white dark:p-1" />
        </div>
      </section>
    </div>
  );
}
