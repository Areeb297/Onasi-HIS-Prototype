import {
  BadgeCheck, CalendarDays, CheckCircle2, Circle, ClipboardList, FileCheck2, FilePen, HandCoins, HeartPulse, KeyRound, ListChecks, NotebookText, Pill, PillBottle,
  ScanLine, StickyNote, TestTube, type LucideIcon,
} from "lucide-react";
import { cn } from "@/components/ui/primitives";
import type { Connection, UseCaseId } from "@/lib/nphies-connection";

/**
 * NPHIES and UHR use cases with one icon each, after the NHIC "nphies facility connection indicator"
 * (https://nhic.gov.sa/nuc/): the same 14 use cases, labels and metaphors, drawn with the closest lucide icons
 * (NHIC's own files are not copied). Outline icons, 1.5 stroke, in the brand green (`--admit`, AA on white).
 */

export type { UseCaseId };

export interface UseCase { id: UseCaseId; label: string; labelAr: string; icon: LucideIcon; financial: boolean }

export const USE_CASES: readonly UseCase[] = [
  { id: "visit-history", label: "Visit History", labelAr: "تاريخ الزيارات", icon: CalendarDays, financial: false },
  { id: "sso", label: "Single Sign-On", labelAr: "تسجيل الدخول الموحد", icon: KeyRound, financial: false },
  { id: "clinical-notes", label: "Clinical Summaries And Notes", labelAr: "الملخصات والملاحظات السريرية", icon: NotebookText, financial: false },
  { id: "e-prescribe", label: "Prescribed Medicines", labelAr: "الأدوية الموصوفة", icon: Pill, financial: false },
  { id: "e-dispense", label: "Dispensed Medicines", labelAr: "الأدوية المصروفة", icon: PillBottle, financial: false },
  { id: "lab-result", label: "Lab Results", labelAr: "نتائج التحاليل المخبرية", icon: TestTube, financial: false },
  { id: "lab-order", label: "Lab Orders", labelAr: "طلبات التحاليل المخبرية", icon: ClipboardList, financial: false },
  { id: "rad-order", label: "Radiology Orders", labelAr: "طلبات الأشعة", icon: FilePen, financial: false },
  { id: "rad-view", label: "View Imaging", labelAr: "عرض الأشعة", icon: ScanLine, financial: false },
  { id: "rad-report", label: "Radiology Reports", labelAr: "تقارير الأشعة", icon: StickyNote, financial: false },
  { id: "prior-auth", label: "Prior Authorization", labelAr: "الموافقة المسبقة", icon: FileCheck2, financial: true },
  { id: "claims", label: "Claims Management", labelAr: "إدارة المطالبات", icon: ListChecks, financial: true },
  { id: "payment", label: "Payment Notice", labelAr: "إشعار الدفع", icon: HandCoins, financial: true },
  { id: "eligibility", label: "Eligibility Check", labelAr: "التحقق من الأهلية", icon: BadgeCheck, financial: true },
];

export const USE_CASE_BY_ID = Object.fromEntries(USE_CASES.map((u) => [u.id, u])) as Record<UseCaseId, UseCase>;

/**
 * Vital signs go to NPHIES too (ORU) but are not one of NHIC's 14 use cases; they get a matching icon so every row
 * in a send list has one.
 */
export type IconId = UseCaseId | "vitals";
const ICON: Record<IconId, LucideIcon> = { ...Object.fromEntries(USE_CASES.map((u) => [u.id, u.icon])), vitals: HeartPulse } as Record<IconId, LucideIcon>;

export function NphiesUseCaseIcon({ id, size = 18, className, title }: { id: IconId; size?: number; className?: string; title?: string }) {
  const Icon = ICON[id];
  const label = title ?? (id === "vitals" ? "Vital Signs" : USE_CASE_BY_ID[id].label);
  return <Icon size={size} strokeWidth={1.5} className={cn("shrink-0 text-admit", className)} role="img" aria-label={label} />;
}

/** The use cases each NPHIES integration on the hub carries. */
export const INTEGRATION_USE_CASES: Record<string, readonly UseCaseId[]> = {
  "nphies-clinical": ["visit-history", "clinical-notes", "lab-order", "lab-result", "rad-order", "rad-report", "e-prescribe", "e-dispense"],
  "nphies-financial": ["eligibility", "prior-auth", "claims", "payment"],
};

/** A row of use-case icons, each named for screen readers and on hover. */
export function UseCaseIcons({ ids, size = 16, className }: { ids: readonly UseCaseId[]; size?: number; className?: string }) {
  return (
    <span className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {ids.map((id) => (
        <span key={id} title={USE_CASE_BY_ID[id].label} className="flex">
          <NphiesUseCaseIcon id={id} size={size} />
        </span>
      ))}
    </span>
  );
}

const CONNECTION_TEXT: Record<Connection, string> = { connected: "Connected", "not-yet": "Not sent yet", "not-built": "Not available here" };

/**
 * Like NHIC's connection indicator: one tile per use case, with a tick once this hospital has sent it successfully,
 * an empty circle when not yet, and a dimmed tile for use cases this system does not send.
 */
export function NphiesConnectionStrip({ status, className }: { status: Record<UseCaseId, Connection>; className?: string }) {
  const done = USE_CASES.filter((u) => status[u.id] === "connected").length;
  const offered = USE_CASES.filter((u) => status[u.id] !== "not-built").length;
  return (
    <section aria-label="NPHIES connection status" className={cn("glass-card rounded-2xl px-4 py-3", className)}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-[#032c26] dark:text-foreground">Connection Status</h2>
        <span className="text-xs text-muted-foreground tabular-nums">{done} of {offered} use cases connected</span>
      </div>
      <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-7">
        {USE_CASES.map((u) => {
          const st = status[u.id];
          return (
            <li key={u.id} title={`${u.label}: ${CONNECTION_TEXT[st]}`}
              className={cn("flex min-w-0 items-center gap-2 rounded-lg border border-border bg-white/70 px-2 py-1.5 dark:bg-card", st === "not-built" && "opacity-50")}>
              <NphiesUseCaseIcon id={u.id} size={18} title={u.label} />
              <span className="line-clamp-2 min-w-0 flex-1 text-xs leading-tight">{u.label}</span>
              {st === "connected"
                ? <CheckCircle2 size={14} strokeWidth={2} className="shrink-0 text-admit" aria-label="Connected" />
                : <Circle size={14} strokeWidth={1.5} className="shrink-0 text-muted-foreground" aria-label={CONNECTION_TEXT[st]} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
