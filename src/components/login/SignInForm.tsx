import * as React from "react";
import { Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { Button, Field, Input } from "@/components/ui/primitives";
import { currentUser, signIn, userForEmail } from "@/lib/session";
import { LINKS, linkClass, mintButton, type LoginText } from "./text";

/**
 * Staff sign-in, as CT-HIS /login: email, password with show and hide, Forgot Password, the restricted notice.
 * Sign In always works in the demo. A staff name before the @ opens that account; anything else keeps the last account used.
 * shortcut: no credential check at all; the real HIS checks the password and locks the account on the server.
 */
export function SignInForm({ t, onForgot, beforeSignIn }: { t: LoginText; onForgot: () => void; beforeSignIn: () => void }) {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [reveal, setReveal] = React.useState(false);
  const [caps, setCaps] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const capsCheck = (e: React.KeyboardEvent) => setCaps(e.getModifierState?.("CapsLock") ?? false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    window.setTimeout(() => {
      beforeSignIn();
      signIn((userForEmail(email.trim()) ?? currentUser()).id);
    }, 300);
  };

  return (
    <form onSubmit={submit} noValidate>
      <h1 className="text-[28px] leading-9 font-medium">{t.title}</h1>
      <p className="mt-2 text-[15px] text-muted-foreground">{t.lead}</p>

      <div className="mt-8 flex flex-col gap-5 [--field-h:2.75rem]">
        <Field label={t.email} name="email">
          <Input id="email" type="email" dir="ltr" autoComplete="username" placeholder="name@hospital.sa" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
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
        <button type="button" onClick={onForgot} className={`${linkClass} text-sm`}>{t.forgot}</button>
      </div>

      <Button type="submit" disabled={busy} aria-busy={busy} className={`mt-6 ${mintButton}`}>
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        {busy ? t.signingIn : t.submit}
      </Button>

      <p className="mt-5 flex gap-2 text-xs leading-5 text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{t.restricted}</span>
      </p>

      <p className="mt-6 border-t border-border pt-5 text-sm text-muted-foreground">
        {t.needHelp} <a href={LINKS.contact} target="_blank" rel="noreferrer" className={linkClass}>{t.contactUs}<span className="sr-only"> ({t.newTab})</span></a>
      </p>
    </form>
  );
}
