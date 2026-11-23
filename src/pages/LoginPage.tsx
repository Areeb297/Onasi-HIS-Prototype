import * as React from "react";
import { Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { Button, Field, Input } from "@/components/ui/primitives";
import { signIn, userForEmail } from "@/lib/session";

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
    reset: "Ask your system administrator to reset your password.",
    submit: "Sign In",
    needEmail: "Enter your email",
    needPassword: "Enter your password",
    wrong: "Incorrect email or password",
    locked: "Too many attempts. Try again in 1 minute, or ask your system administrator.",
    caps: "Caps Lock is on",
    signingIn: "Signing In",
    restricted: "For authorized hospital staff only. Sign-ins and record access are logged.",
    demo: "Demo accounts use a staff name, for example khalid@onasi.care, with any password.",
    powered: "Powered by",
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
    reset: "تواصل مع مسؤول النظام لإعادة تعيين كلمة المرور.",
    submit: "تسجيل الدخول",
    needEmail: "أدخل البريد الإلكتروني",
    needPassword: "أدخل كلمة المرور",
    wrong: "البريد الإلكتروني أو كلمة المرور غير صحيحة",
    locked: "محاولات كثيرة. حاول مرة أخرى بعد دقيقة، أو تواصل مع مسؤول النظام.",
    caps: "مفتاح الأحرف الكبيرة مفعّل",
    signingIn: "جارٍ تسجيل الدخول",
    restricted: "للموظفين المصرّح لهم فقط. يُسجَّل الدخول والاطلاع على السجلات.",
    demo: "حسابات العرض تستخدم اسم الموظف، مثل khalid@onasi.care، مع أي كلمة مرور.",
    powered: "بدعم من",
  },
} as const;

type Lang = keyof typeof TEXT;

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
  const [forgot, setForgot] = React.useState(false);
  const [errors, setErrors] = React.useState<{ email?: string; password?: string }>({});
  const [failed, setFailed] = React.useState(false);
  const [caps, setCaps] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  // Account lockout after repeated failures (NCA ECC, OWASP ASVS). shortcut: kept in this page only; the real HIS locks on the server.
  const tries = React.useRef(0);
  const [lockedUntil, setLockedUntil] = React.useState(0);
  const locked = lockedUntil > now.getTime();
  React.useEffect(() => {
    if (!lockedUntil) return;
    const id = window.setTimeout(() => { setLockedUntil(0); tries.current = 0; }, Math.max(0, lockedUntil - Date.now()));
    return () => window.clearTimeout(id);
  }, [lockedUntil]);

  const switchLang = () => {
    const next: Lang = rtl ? "en" : "ar";
    setLang(next);
    setErrors({});
    setFailed(false);
    try { localStorage.setItem("login.lang", next); } catch { /* private mode */ }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || lockedUntil > Date.now()) return;
    const next = { email: !email.trim() ? t.needEmail : undefined, password: !password ? t.needPassword : undefined };
    setErrors(next);
    setFailed(false);
    if (next.email || next.password) return;
    setBusy(true);
    window.setTimeout(() => {
      setBusy(false);
      const user = userForEmail(email.trim());
      if (user) return signIn(user.id);
      // One message for a wrong email or a wrong password, so the page never tells anyone which accounts exist.
      setFailed(true);
      setPassword("");
      tries.current += 1;
      if (tries.current >= 5) setLockedUntil(Date.now() + 60_000);
    }, 450);
  };
  const capsCheck = (e: React.KeyboardEvent) => setCaps(e.getModifierState?.("CapsLock") ?? false);

  return (
    <div dir={rtl ? "rtl" : "ltr"} lang={lang} className="flex min-h-full flex-col bg-background text-foreground lg:h-full lg:flex-row">
      {/* The hospital scene with the headline on its calm upper part */}
      <section className="relative shrink-0 p-3 sm:h-[380px] lg:h-full lg:w-[56%] lg:p-4">
        {/* On a phone the scene is its own strip under the text; from tablet width it fills the panel behind the text. */}
        <div className="relative flex h-full flex-col overflow-hidden rounded-[20px] bg-[#032c26]">
          <React.Suspense fallback={<div className="h-[168px] sm:hidden" />}>
            <HospitalScene rtl={rtl} className="relative order-last h-[168px] sm:absolute sm:inset-0 sm:h-auto" />
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
            </p>
          </div>
        </div>
      </section>

      {/* Sign in */}
      <section className="flex min-h-0 flex-1 flex-col px-6 pt-4 pb-6 sm:px-10 lg:pt-6">
        <div className="flex justify-end">
          <Button onClick={switchLang} className="h-10 px-4" lang={rtl ? "en" : "ar"} aria-label={rtl ? "Switch to English" : "التبديل إلى العربية"}>{t.other}</Button>
        </div>

        <div className="flex flex-1 items-center justify-center py-10">
          <form onSubmit={submit} noValidate className="w-full max-w-[380px]">
            <h2 className="text-[28px] leading-9 font-medium">{t.title}</h2>
            <p className="mt-2 text-[15px] text-muted-foreground">{t.lead}</p>

            <div className="mt-8 flex flex-col gap-5 [--field-h:2.75rem]">
              <Field label={t.email} error={errors.email} name="email">
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
              <Field label={t.password} error={errors.password} name="password">
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
              <button type="button" onClick={() => setForgot((f) => !f)} aria-expanded={forgot} className="rounded text-sm font-medium text-[#035d53] underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none dark:text-[#39edd5]">
                {t.forgot}
              </button>
            </div>
            {forgot && <p role="status" className="mt-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">{t.reset}</p>}

            {(failed || locked) && (
              <p role="alert" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {locked ? t.locked : t.wrong}
              </p>
            )}
            <Button type="submit" variant="primary" disabled={busy || locked} aria-busy={busy} className="mt-6 h-11 w-full text-[15px]">
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {busy ? t.signingIn : t.submit}
            </Button>
            <p className="mt-5 flex gap-2 text-xs leading-5 text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{t.restricted}</span>
            </p>
            <p className="mt-2 ps-6 text-xs leading-5 text-muted-foreground/80">{t.demo}</p>
          </form>
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
