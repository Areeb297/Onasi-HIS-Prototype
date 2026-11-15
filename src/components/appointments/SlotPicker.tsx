import { cn } from "@/components/ui/primitives";
import { doctorName, slotsFor, useAppointments } from "@/lib/appointments";

/**
 * The doctor's day as time buttons. Booked and past times are shown but cannot be picked.
 * `ignoreId` treats one appointment's own time as free, for rescheduling it.
 */
export function SlotPicker({
  doctorId, date, value, onChange, now, ignoreId, invalid,
}: {
  doctorId: string;
  date: string;
  value: string;
  onChange: (start: string) => void;
  now: number;
  ignoreId?: string;
  invalid?: boolean;
}) {
  const store = useAppointments();
  if (!doctorId || !date) {
    return <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">Pick the doctor and the date to see the free times.</p>;
  }
  const slots = slotsFor(doctorId, date, now, ignoreId, store);
  const free = slots.filter((s) => s.free).length;
  return (
    <div>
      <p className="mb-2 text-xs text-muted-foreground" aria-live="polite">
        {free ? `${free} free ${free === 1 ? "time" : "times"} for ${doctorName(doctorId)}. Each visit is 20 minutes.` : `No free time left for ${doctorName(doctorId)} on this day. Try another date.`}
      </p>
      <div
        role="radiogroup"
        aria-label="Free times"
        aria-invalid={invalid || undefined}
        className={cn("grid grid-cols-3 gap-1.5 sm:grid-cols-5", invalid && "rounded-lg outline outline-1 outline-destructive outline-offset-2")}
      >
        {slots.map((s) => {
          const on = value === s.start;
          return (
            <button
              key={s.start}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={!s.free}
              title={s.free ? `${s.start} to ${s.end}` : `${s.start}: ${s.why}`}
              onClick={() => onChange(s.start)}
              className={cn(
                "flex h-11 flex-col items-center justify-center rounded-lg border text-sm font-medium tabular-nums transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted",
                !s.free && "cursor-not-allowed border-dashed bg-muted/60 text-muted-foreground hover:bg-muted/60",
              )}
            >
              <span className={cn(!s.free && "line-through decoration-1")}>{s.start}</span>
              {!s.free && <span className="text-[0.6875rem] font-normal leading-none">{s.why}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
