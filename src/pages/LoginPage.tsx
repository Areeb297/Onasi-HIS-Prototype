import * as React from "react";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { ForgotPasswordForm } from "@/components/login/ForgotPasswordForm";
import { SignInForm } from "@/components/login/SignInForm";
import { LINKS, LOGIN_TEXT, type Lang, type LoginText } from "@/components/login/text";
import { navigate, useRoute } from "@/lib/router";

// The 3D scene loads only here, so three.js stays out of the main app bundle.
const HospitalScene = React.lazy(() => import("@/components/login/HospitalScene"));

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

const external =
  "inline-flex min-h-10 items-center gap-1 rounded-md px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/** onasi.care and the portfolio: in the header on a tablet or desktop, under the form on a phone. */
function SiteLinks({ t }: { t: LoginText }) {
  return (
    <>
      <a href={LINKS.site} target="_blank" rel="noreferrer" className={external}>
        <bdi>{t.site}</bdi>
        <ArrowUpRight className="size-3.5 rtl:-scale-x-100" aria-hidden="true" />
        <span className="sr-only">({t.newTab})</span>
      </a>
      <a href={LINKS.portfolio} target="_blank" rel="noreferrer" className={external}>
        {t.portfolio}
        <ArrowUpRight className="size-3.5 rtl:-scale-x-100" aria-hidden="true" />
        <span className="sr-only">({t.newTab})</span>
      </a>
    </>
  );
}

/**
 * Staff sign-in: one screen with no page scroll from laptop width up. Contact and company information live on
 * onasi.care and portfolio.onasi.care. #/forgot-password swaps the form. On a phone the page scrolls, because the
 * scene and the form do not fit one small screen; fields use 16px text there so iOS does not zoom on focus.
 */
export function LoginPage() {
  const [lang, setLang] = React.useState<Lang>(() => {
    try { return localStorage.getItem("login.lang") === "ar" ? "ar" : "en"; } catch { return "en"; }
  });
  const t = LOGIN_TEXT[lang];
  const rtl = lang === "ar";
  const now = useClock();
  const route = useRoute();
  const forgot = route.path === "/forgot-password";

  const switchLang = () => {
    const next: Lang = rtl ? "en" : "ar";
    setLang(next);
    try { localStorage.setItem("login.lang", next); } catch { /* private mode */ }
  };

  return (
    <div dir={rtl ? "rtl" : "ltr"} lang={lang} className="flex h-full flex-col overflow-y-auto bg-background text-foreground lg:overflow-hidden">
      <header className="shrink-0 border-b border-border">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-1 px-4 sm:px-6">
          <span className="me-auto">
            <img src="/brand/onasi-wordmark.png" alt="Onasi" className="h-7 w-auto dark:hidden" />
            <img src="/brand/onasi-wordmark-mint.png" alt="Onasi" className="hidden h-7 w-auto dark:block" />
          </span>
          <nav className="hidden items-center sm:flex" aria-label="Onasi">
            <SiteLinks t={t} />
          </nav>
          <Button onClick={switchLang} className="ms-1 h-10 px-4" lang={rtl ? "en" : "ar"} aria-label={t.otherLabel}>{t.other}</Button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col lg:min-h-0 lg:flex-row">
        <div className="relative shrink-0 p-3 sm:h-[300px] lg:h-full lg:w-[56%] lg:p-4">
          {/* On a phone the scene is its own strip under the text; from tablet width it fills the panel behind the text. */}
          <div className="relative flex h-full flex-col overflow-hidden rounded-[20px] bg-[#032c26]">
            <React.Suspense fallback={<div className="h-[120px] sm:hidden" />}>
              <HospitalScene rtl={rtl} label={t.sceneLabel} className="relative order-last h-[120px] outline-none focus-visible:ring-2 focus-visible:ring-[#39edd5] focus-visible:ring-inset sm:absolute sm:inset-0 sm:h-auto" />
            </React.Suspense>
            <div className="pointer-events-none relative flex flex-col p-5 pb-0 sm:h-full sm:p-8 lg:p-10">
              <p className="max-w-[14ch] text-[28px] leading-[1.1] font-medium tracking-[-0.01em] text-[#f4fbf7] sm:text-[40px] lg:text-[56px]">{t.headline}</p>
              <p className="mt-2 max-w-[36ch] text-sm leading-6 text-[#daf0e4]/75 sm:mt-3 sm:text-[17px]">{t.sub}</p>
              <p className="mt-auto hidden items-center gap-2 font-mono text-xs text-[#daf0e4]/70 tabular-nums sm:flex">
                <span className="size-2 rounded-[2px] bg-[#e4f7ec]" aria-hidden="true" />
                <span>{t.shifts[shiftOf(now.getHours())]}</span>
                <span aria-hidden="true">·</span>
                <bdi>{now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</bdi>
                <span className="text-[#daf0e4]/45">· {t.drag}</span>
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-1 flex-col px-6 pt-6 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-10 lg:min-h-0 lg:overflow-y-auto lg:pt-4 [&_input]:text-base sm:[&_input]:text-sm">
          <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center">
            {forgot
              ? <ForgotPasswordForm t={t} onBack={() => navigate("/login")} />
              : <SignInForm t={t} onForgot={() => navigate("/forgot-password")} beforeSignIn={() => navigate("/patients")} />}
            {/* Ebttikar logo: full colour on the light form side, original proportions, clear space (brand guidelines 05, 08, 10) */}
            <div className="mt-8 flex items-center justify-center gap-4">
              <span className="text-xs text-muted-foreground">{t.powered}</span>
              <img src="/brand/ebttikar-logo-primary.png" alt="Ebttikar" width={54} height={64} className="h-16 w-auto dark:rounded-md dark:bg-white dark:p-1.5" />
            </div>
          </div>
          <nav className="mt-6 flex justify-center gap-2 sm:hidden" aria-label="Onasi">
            <SiteLinks t={t} />
          </nav>
          <p className="pt-3 text-center text-xs text-muted-foreground">{t.rights(now.getFullYear())}</p>
        </div>
      </main>
    </div>
  );
}
