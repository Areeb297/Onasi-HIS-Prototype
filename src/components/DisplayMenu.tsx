import * as React from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button, cn } from "@/components/ui/primitives";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TEXT_SIZES, setPrefs, usePrefs, type Density, type TextSize } from "@/lib/prefs";

function Choice<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: { id: T; label: string }[]; onPick: (v: T) => void }) {
  return (
    <div className="px-2 py-1.5">
      <div className="mb-1.5 text-sm font-medium">{label}</div>
      <div role="radiogroup" aria-label={label} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }} className="grid gap-1 rounded-lg border border-border bg-muted p-1">
        {options.map((o) => (
          <button
            key={o.id}
            role="radio"
            aria-checked={value === o.id}
            onClick={() => onPick(o.id)}
            className={cn("rounded-md px-2 py-1.5 text-sm", value === o.id ? "bg-card font-semibold shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Text size, row density and theme. Saved in the browser. */
export function DisplayMenu() {
  const prefs = usePrefs();
  const [dark, setDark] = React.useState(() => typeof document !== "undefined" && document.documentElement.classList.contains("dark"));
  function theme(next: boolean) {
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("nphies-adt-theme", next ? "dark" : "light");
    } catch {
      /* ignore */
    }
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" aria-label="Display settings: text size, density and theme">
          <SlidersHorizontal className="size-4" />
          Display
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-1">
        <DropdownMenuLabel>Make it easier to read</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <Choice<TextSize> label="Text size" value={prefs.textSize} options={TEXT_SIZES} onPick={(v) => setPrefs({ textSize: v })} />
        <Choice<Density> label="Row spacing" value={prefs.density} options={[{ id: "comfortable", label: "Roomy" }, { id: "compact", label: "Compact" }]} onPick={(v) => setPrefs({ density: v })} />
        <Choice<"light" | "dark"> label="Theme" value={dark ? "dark" : "light"} options={[{ id: "light", label: "Light" }, { id: "dark", label: "Dark" }]} onPick={(v) => theme(v === "dark")} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
