import * as React from "react";
import { Button } from "@/components/ui/primitives";
import { ContactSection } from "@/components/login/ContactSection";
import { ForgotPasswordForm } from "@/components/login/ForgotPasswordForm";
import { SignInForm } from "@/components/login/SignInForm";
import { LOGIN_TEXT, type Lang } from "@/components/login/text";
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

/**
 * The public site before sign-in: Home (the hospital scene and staff sign-in) and Contact, on one page.
 * The HIS routes are kept: #/login is Home, #/contact scrolls to Contact, #/forgot-password swaps the form.
 * Patient self sign-up is left out on purpose: this is the staff entry point.
 */
export function LoginPage() {
  const [lang, setLang] = React.useState<Lang>(() => {
    try { return localStorage.getItem("login.lang") === "ar" ? "ar" : "en"; } catch { return "en"; }
  });
  const t = LOGIN_TEXT[lang];
  const rtl = lang === "ar";
  const now = useClock();
  const route = useRoute();
  const scroller = React.useRef<HTMLDivElement>(null);
  const contact = React.useRef<HTMLElement>(null);
  const forgot = route.path === "/forgot-password";
  const onContact = route.path === "/contact";

  const switchLang = () => {
    const next: Lang = rtl ? "en" : "ar";
    setLang(next);
    try { localStorage.setItem("login.lang", next); } catch { /* private mode */ }
  };

  const smooth = (): ScrollBehavior => (window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");
  // Scroll only this page's own box: scrollIntoView would also shift the locked window and hide the header.
  const showContact = () => {
    const box = scroller.current;
    const el = contact.current;
    if (box && el) box.scrollTo({ top: el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 64, behavior: smooth() });
  };
  const goContact = () => { navigate("/contact"); showContact(); };
  const goHome = () => { navigate("/login"); scroller.current?.scrollTo({ top: 0, behavior: smooth() }); };
  React.useEffect(() => { if (onContact) showContact(); }, [onContact]);

  const navItem = (active: boolean) =>
    `rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${active ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`;

  return (
    <div ref={scroller} dir={rtl ? "rtl" : "ltr"} lang={lang} className="h-full overflow-y-auto bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-2 px-4 sm:px-6">
          <button type="button" onClick={goHome} aria-label="Onasi HIS" className="me-auto rounded focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            <img src="/brand/onasi-wordmark.png" alt="" className="h-7 w-auto dark:hidden" />
            <img src="/brand/onasi-wordmark-mint.png" alt="" className="hidden h-7 w-auto dark:block" />
          </button>
          <nav aria-label={t.nav} className="flex items-center">
            <button type="button" onClick={goHome} aria-current={!onContact ? "page" : undefined} className={navItem(!onContact)}>{t.home}</button>
            <button type="button" onClick={goContact} aria-current={onContact ? "page" : undefined} className={navItem(onContact)}>{t.contact}</button>
          </nav>
          <Button onClick={switchLang} className="ms-1 h-10 px-4" lang={rtl ? "en" : "ar"} aria-label={t.otherLabel}>{t.other}</Button>
        </div>
      </header>

      {/* Home: the hospital scene and sign-in, one screen tall on a desktop */}
      <section aria-label={t.home} className="mx-auto flex max-w-[1600px] flex-col lg:h-[calc(100dvh-4rem)] lg:min-h-[640px] lg:flex-row">
        <div className="relative shrink-0 p-3 sm:h-[380px] lg:h-full lg:w-[56%] lg:p-4">
          {/* On a phone the scene is its own strip under the text; from tablet width it fills the panel behind the text. */}
          <div className="relative flex h-full flex-col overflow-hidden rounded-[20px] bg-[#032c26]">
            <React.Suspense fallback={<div className="h-[168px] sm:hidden" />}>
              <HospitalScene rtl={rtl} label={t.sceneLabel} className="relative order-last h-[168px] outline-none focus-visible:ring-2 focus-visible:ring-[#39edd5] focus-visible:ring-inset sm:absolute sm:inset-0 sm:h-auto" />
            </React.Suspense>
            <div className="pointer-events-none relative flex flex-col p-6 pb-0 sm:h-full sm:p-10">
              <p className="max-w-[14ch] text-[32px] leading-[1.1] font-medium tracking-[-0.01em] text-[#f4fbf7] sm:text-[48px] lg:text-[56px]">{t.headline}</p>
              <p className="mt-3 max-w-[36ch] text-[15px] leading-6 text-[#daf0e4]/75 sm:text-[17px]">{t.sub}</p>
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

        <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 sm:px-10 lg:min-h-0 lg:overflow-y-auto">
          <div className="w-full max-w-[400px]">
            {forgot
              ? <ForgotPasswordForm t={t} onBack={goHome} onContact={goContact} />
              : <SignInForm t={t} onForgot={() => navigate("/forgot-password")} onContact={goContact} beforeSignIn={() => navigate("/patients")} />}
            {/* Ebttikar logo: full colour on the light form side, original proportions, clear space (brand guidelines 05, 08, 10) */}
            <div className="mt-10 flex items-center justify-center gap-4 py-2">
              <span className="text-xs text-muted-foreground">{t.powered}</span>
              <img src="/brand/ebttikar-logo-primary.png" alt="Ebttikar" width={61} height={72} className="h-[72px] w-auto dark:rounded-md dark:bg-white dark:p-1.5" />
            </div>
          </div>
        </div>
      </section>

      <ContactSection ref={contact} t={t} />

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-[1600px] justify-center px-6 py-6 text-center text-xs text-muted-foreground sm:px-10">
          <span>{t.rights(now.getFullYear())}</span>
        </div>
      </footer>
    </div>
  );
}
