import * as React from "react";
import { Clock, Globe, Loader2, MapPin } from "lucide-react";
import { Button, Card, Field, Input, textareaBase } from "@/components/ui/primitives";
import { isEmail, linkClass, mintButton, type LoginText } from "./text";

const EMPTY = { firstName: "", lastName: "", email: "", phone: "", message: "" };

/**
 * Contact Us on the same page as sign-in (CT-HIS /contact fields and wording). Layout adapted from the 21st.dev
 * "Contact Form" section: the header and contact details on one side, the form in a card on the other, with a
 * pending state and a status line that stays mounted so screen readers announce it. Nothing is sent in the demo.
 */
export const ContactSection = React.forwardRef<HTMLElement, { t: LoginText }>(function ContactSection({ t }, ref) {
  const [f, setF] = React.useState(EMPTY);
  const [errors, setErrors] = React.useState<Partial<Record<keyof typeof EMPTY, string>>>({});
  const [status, setStatus] = React.useState<"idle" | "pending" | "sent">("idle");
  const [sentTo, setSentTo] = React.useState("");
  const set = (k: keyof typeof EMPTY, v: string) => setF((p) => ({ ...p, [k]: v }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "pending") return;
    const next: typeof errors = {
      firstName: f.firstName.trim() ? undefined : t.required,
      lastName: f.lastName.trim() ? undefined : t.required,
      email: isEmail(f.email) ? undefined : t.badEmail,
      phone: f.phone.trim() ? undefined : t.required,
      message: f.message.trim() ? undefined : t.required,
    };
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;
    setStatus("pending");
    window.setTimeout(() => {
      setSentTo(f.email.trim());
      setF(EMPTY);
      setStatus("sent");
    }, 600);
  };

  const details = [
    [Clock, t.hours, t.hoursValue],
    [MapPin, t.visit, t.address],
    [Globe, t.website, null],
  ] as const;

  return (
    <section ref={ref} id="contact" aria-labelledby="contact-title" data-status={status} className="scroll-mt-16 border-t border-border py-16 sm:py-24">
      <div className="mx-auto grid w-full max-w-6xl gap-12 px-6 sm:px-10 lg:grid-cols-2">
        <div className="max-w-xl">
          <p className="text-sm font-medium text-[#016d48] dark:text-[#39edd5]">{t.supportTitle}</p>
          <h2 id="contact-title" className="mt-2 text-3xl font-medium tracking-tight sm:text-4xl">{t.contactTitle}</h2>
          <p className="mt-4 text-lg text-muted-foreground">{t.contactLead}</p>
          <ul className="mt-8 flex flex-col gap-5 text-sm">
            {details.map(([Icon, label, value]) => (
              <li key={label} className="flex gap-3">
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-0.5">
                    {value ?? <a href="https://ebttikar.com/" target="_blank" rel="noreferrer" dir="ltr" className={linkClass}>ebttikar.com</a>}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <Card className="min-w-0 p-6 sm:p-8">
          <h3 className="text-base font-medium">{t.formTitle}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t.formLead}</p>
          <form onSubmit={submit} noValidate className="mt-6 flex flex-col gap-5 [--field-h:2.75rem]">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label={t.firstName} error={errors.firstName} name="ct-first" required>
                <Input id="ct-first" autoComplete="given-name" value={f.firstName} onChange={(e) => set("firstName", e.target.value)} />
              </Field>
              <Field label={t.lastName} error={errors.lastName} name="ct-last" required>
                <Input id="ct-last" autoComplete="family-name" value={f.lastName} onChange={(e) => set("lastName", e.target.value)} />
              </Field>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label={t.emailAddress} error={errors.email} name="ct-email" required>
                <Input id="ct-email" type="email" dir="ltr" autoComplete="email" placeholder="name@example.com" value={f.email} onChange={(e) => set("email", e.target.value)} />
              </Field>
              <Field label={t.phone} error={errors.phone} name="ct-phone" required>
                <Input id="ct-phone" type="tel" dir="ltr" autoComplete="tel" placeholder="05X XXX XXXX" value={f.phone} onChange={(e) => set("phone", e.target.value)} />
              </Field>
            </div>
            <Field label={t.message} error={errors.message} name="ct-message" required>
              <textarea id="ct-message" rows={5} placeholder={t.messagePlaceholder} value={f.message} onChange={(e) => set("message", e.target.value)} className={`${textareaBase} min-h-[120px] py-2.5`} />
            </Field>
            <div>
              <Button type="submit" disabled={status === "pending"} aria-busy={status === "pending"} className={`${mintButton} sm:w-auto sm:px-6`}>
                {status === "pending" && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                {status === "pending" ? t.sending : t.send}
              </Button>
              <p role="status" className="mt-4 text-sm text-[#016d48] empty:mt-0 dark:text-[#39edd5]">{status === "sent" ? t.sent(sentTo) : null}</p>
            </div>
          </form>
        </Card>
      </div>
    </section>
  );
});
