import * as React from "react";
import { Check, CheckCircle2, Loader2 } from "lucide-react";
import { Button, Field, Input } from "@/components/ui/primitives";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { isEmail, mintButton, type LoginText } from "./text";

const EMPTY = { name: "", email: "", phone: "", organization: "", message: "", website: "" };

/**
 * Contact Us in a shadcn Sheet that slides over the sign-in screen (#/contact), so the page itself never scrolls and
 * the form has room to breathe. It keeps what the onasi.care form asks (name, email, products, message) and improves on
 * it: phone and organization for a hospital sale, products as chips, errors under each field, and a hidden honeypot
 * field instead of a CAPTCHA that blocks Send. Nothing is sent in the demo.
 * shortcut: no rate limit or server check; the real form needs both on the server.
 */
export function ContactSheet({ t, open, rtl, onClose }: { t: LoginText; open: boolean; rtl: boolean; onClose: () => void }) {
  const [f, setF] = React.useState(EMPTY);
  const [products, setProducts] = React.useState<string[]>([]);
  const [errors, setErrors] = React.useState<Partial<Record<"name" | "email" | "message", string>>>({});
  const [status, setStatus] = React.useState<"idle" | "pending" | "sent">("idle");
  const set = (k: keyof typeof EMPTY, v: string) => setF((p) => ({ ...p, [k]: v }));
  const toggle = (id: string) => setProducts((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  // A fresh form each time it opens after a message was sent.
  React.useEffect(() => {
    if (open && status === "sent") { setF(EMPTY); setProducts([]); setErrors({}); setStatus("idle"); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "pending") return;
    const next = {
      name: f.name.trim() ? undefined : t.required,
      email: isEmail(f.email) ? undefined : t.badEmail,
      message: f.message.trim() ? undefined : t.required,
    };
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;
    setStatus("pending");
    // A bot fills the hidden field; a person never sees it. Either way the page shows the same confirmation.
    window.setTimeout(() => setStatus("sent"), 600);
  };

  const optional = <span className="font-normal text-muted-foreground"> ({t.optional})</span>;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side={rtl ? "left" : "right"} dir={rtl ? "rtl" : "ltr"} lang={rtl ? "ar" : "en"} className="w-full gap-0 sm:max-w-[540px]">
        {status === "sent" ? (
          <div role="status" className="flex flex-1 flex-col justify-center px-6 sm:px-10">
            <CheckCircle2 className="mb-4 size-10 text-[#016d48] dark:text-[#39edd5]" aria-hidden="true" />
            <SheetTitle className="text-2xl font-medium">{t.sentTitle}</SheetTitle>
            <SheetDescription className="mt-2 text-[15px]">{t.sentLead(f.email.trim())}</SheetDescription>
            <Button className={`mt-8 ${mintButton}`} onClick={onClose}>{t.back}</Button>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
            <SheetHeader className="border-b border-border px-6 pt-8 pb-6 sm:px-10">
              <SheetTitle className="text-2xl font-medium">{t.contactTitle}</SheetTitle>
              <SheetDescription className="text-[15px]">{t.contactLead}</SheetDescription>
            </SheetHeader>

            <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-8 sm:px-10 [--field-h:2.75rem] [&_input]:text-base sm:[&_input]:text-sm">
              <Field label={t.fullName} error={errors.name} name="ct-name" required>
                <Input id="ct-name" autoComplete="name" value={f.name} onChange={(e) => set("name", e.target.value)} autoFocus />
              </Field>
              <Field label={t.emailAddress} error={errors.email} name="ct-email" required>
                <Input id="ct-email" type="email" dir="ltr" autoComplete="email" placeholder="name@hospital.sa" value={f.email} onChange={(e) => set("email", e.target.value)} />
              </Field>
              <div className="grid gap-6 sm:grid-cols-2 sm:items-end">
                <div>
                  <label htmlFor="ct-phone" className="mb-1.5 block text-sm font-medium">{t.phone}{optional}</label>
                  <Input id="ct-phone" type="tel" dir="ltr" autoComplete="tel" placeholder="05X XXX XXXX" value={f.phone} onChange={(e) => set("phone", e.target.value)} />
                </div>
                <div>
                  <label htmlFor="ct-org" className="mb-1.5 block text-sm font-medium">{t.organization}{optional}</label>
                  <Input id="ct-org" autoComplete="organization" value={f.organization} onChange={(e) => set("organization", e.target.value)} />
                </div>
              </div>

              <fieldset>
                <legend className="mb-2 text-sm font-medium">{t.products}{optional}</legend>
                <div className="flex flex-wrap gap-2">
                  {t.productList.map(([id, label]) => {
                    const on = products.includes(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggle(id)}
                        className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                          on ? "border-[#032c26] bg-[#032c26] text-white dark:border-[#39edd5] dark:bg-[#39edd5] dark:text-[#032c26]" : "border-border bg-card text-foreground hover:border-foreground/40"
                        }`}
                      >
                        {on && <Check className="size-3.5" aria-hidden="true" />}
                        {label}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <Field label={t.message} error={errors.message} name="ct-message" required>
                <Textarea id="ct-message" rows={4} placeholder={t.messagePlaceholder} value={f.message} onChange={(e) => set("message", e.target.value)} className="min-h-[112px] py-2.5" />
              </Field>

              {/* Honeypot: hidden from people and screen readers, filled only by bots. */}
              <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" value={f.website} onChange={(e) => set("website", e.target.value)} className="pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0" />
            </div>

            {/* Buttons in the house order: Cancel on the start side, the one primary action on the end side. */}
            <SheetFooter className="mt-0 flex-row justify-between gap-3 border-t border-border px-6 py-5 sm:px-10">
              <Button variant="ghost" className="h-11" onClick={onClose}>{t.cancel}</Button>
              <Button type="submit" disabled={status === "pending"} aria-busy={status === "pending"} className={`${mintButton} w-auto px-6`}>
                {status === "pending" && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                {status === "pending" ? t.sending : t.send}
              </Button>
            </SheetFooter>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
