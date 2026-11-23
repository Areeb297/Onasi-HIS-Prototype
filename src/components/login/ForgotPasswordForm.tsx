import * as React from "react";
import { ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import { Button, Field, Input } from "@/components/ui/primitives";
import { isEmail, linkClass, mintButton, type LoginText } from "./text";

/** CT-HIS /forgot-password: an email, then "Check Your Email". Nothing is sent in the demo. */
export function ForgotPasswordForm({ t, onBack, onContact }: { t: LoginText; onBack: () => void; onContact: () => void }) {
  const [email, setEmail] = React.useState("");
  const [error, setError] = React.useState("");
  const [status, setStatus] = React.useState<"idle" | "pending" | "sent">("idle");

  if (status === "sent") {
    return (
      <div role="status">
        <CheckCircle2 className="mb-4 size-10 text-[#016d48] dark:text-[#39edd5]" aria-hidden="true" />
        <h1 className="text-[28px] leading-9 font-medium">{t.checkTitle}</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">{t.checkLead(email.trim())}</p>
        <p className="mt-3 text-sm text-muted-foreground">{t.checkHint}</p>
        <Button className={`mt-8 ${mintButton}`} onClick={onBack}>{t.back}</Button>
      </div>
    );
  }
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!isEmail(email)) return setError(t.badEmail);
        setError("");
        setStatus("pending");
        window.setTimeout(() => setStatus("sent"), 500);
      }}
    >
      <button type="button" onClick={onBack} className={`${linkClass} mb-6 inline-flex items-center gap-1.5 text-sm`}>
        <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden="true" />
        {t.back}
      </button>
      <h1 className="text-[28px] leading-9 font-medium">{t.forgotTitle}</h1>
      <p className="mt-2 text-[15px] text-muted-foreground">{t.forgotLead}</p>
      <div className="mt-8 [--field-h:2.75rem]">
        <Field label={t.emailAddress} error={error} name="forgot-email" required>
          <Input id="forgot-email" type="email" dir="ltr" autoComplete="email" placeholder={t.emailPlaceholder} value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </Field>
      </div>
      <Button type="submit" disabled={status === "pending"} aria-busy={status === "pending"} className={`mt-6 ${mintButton}`}>
        {status === "pending" && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        {status === "pending" ? t.sending : t.sendLink}
      </Button>
      <p className="mt-6 text-sm text-muted-foreground">
        {t.needHelp} <button type="button" onClick={onContact} className={linkClass}>{t.contactUs}</button>
      </p>
    </form>
  );
}
