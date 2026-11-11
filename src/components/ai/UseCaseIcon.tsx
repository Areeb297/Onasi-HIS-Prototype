import type { UseCaseId } from "@/lib/ai/engine";

/**
 * One custom icon per use case, drawn on the same 24 point grid with one teal accent each.
 * They describe the job (a forked decision, a tag, a page leaving) instead of using a generic AI symbol.
 */
const A = "var(--admit)";

export function UseCaseIcon({ id, className = "size-5" }: { id: UseCaseId; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {id === "soap" && (
        <>
          <rect x="4.5" y="3" width="15" height="18" rx="2.5" />
          <circle cx="8.6" cy="7.8" r="0.9" stroke={A} />
          <circle cx="8.6" cy="11.3" r="0.9" stroke={A} />
          <circle cx="8.6" cy="14.8" r="0.9" stroke={A} />
          <circle cx="8.6" cy="18.3" r="0.9" stroke={A} />
          <path d="M11.5 7.8h4.5M11.5 11.3h3.5M11.5 14.8h4.5M11.5 18.3h2.5" />
        </>
      )}
      {id === "cds" && (
        <>
          <path d="M12 21v-7M12 14 7 9M12 14l5-5" />
          <circle cx="7" cy="7.5" r="2.2" />
          <circle cx="17" cy="7.5" r="2.2" stroke={A} />
          <circle cx="12" cy="21" r="0.8" />
        </>
      )}
      {id === "codes" && (
        <>
          <path d="M3.5 12.5V5A1.5 1.5 0 0 1 5 3.5h7.5l8 8a1.5 1.5 0 0 1 0 2.1l-6.4 6.4a1.5 1.5 0 0 1-2.1 0z" />
          <circle cx="8" cy="8" r="1" stroke={A} />
          <path d="M11 12.8h5M10 15.3h5" />
        </>
      )}
      {id === "discharge" && (
        <>
          <path d="M13 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21H13" />
          <path d="M10 12h10" stroke={A} />
          <path d="m16.5 8.5 3.5 3.5-3.5 3.5" stroke={A} />
        </>
      )}
      {id === "summary" && (
        <>
          <path d="M4 6h6l5 6M4 18h6l5-6M4 12h11" />
          <path d="M16.5 12H21" stroke={A} />
        </>
      )}
      {id === "education" && (
        <>
          <path d="M3.5 6.5 8.5 4.5l7 2 5-2v13l-5 2-7-2-5 2z" />
          <path d="M8.5 4.5v13M15.5 6.5v13" />
          <path d="M10.7 9.5h2.6M10.7 12h2.6" stroke={A} />
        </>
      )}
      {id === "orders" && (
        <>
          <path d="M8 3h6M9.5 3v12.5a2.5 2.5 0 0 0 5 0V3" />
          <path d="M9.5 11h5" stroke={A} />
          <path d="M18 15.5v5M15.5 18h5" stroke={A} />
        </>
      )}
      {id === "nphies-error" && (
        <>
          <path d="M8.5 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19h2M15.5 5h2A1.5 1.5 0 0 1 19 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-2" />
          <path d="M12 8.5v4.5" stroke={A} />
          <circle cx="12" cy="16" r="0.6" stroke={A} />
        </>
      )}
      {id === "quality" && (
        <>
          <rect x="3.5" y="14.5" width="17" height="5.5" rx="1.5" />
          <path d="M8 14.5v2.5M12 14.5v3.5M16 14.5v2.5" />
          <path d="m7.5 8.5 2.8 2.8L16.5 5" stroke={A} />
        </>
      )}
      {id === "help" && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.6 9.6a2.5 2.5 0 1 1 3.6 2.2c-.8.5-1.2 1-1.2 1.8" />
          <circle cx="12" cy="17" r="0.6" stroke={A} />
        </>
      )}
    </svg>
  );
}
