# Onasi HIS: working rules for Claude

## Delegating work
- Prefer the other open Claude Code sessions on this machine over spawning subagents. They use fewer tokens.
- Find them with ListAgents, then hand work over with SendMessage. Give each session its own files so no two sessions edit the same file, and ask it to report back when done.
- Spawn a subagent only when no suitable session is idle.
- The orchestrating session wires routes and the sidebar, runs the type-check, the tests and the build, then commits and pushes.

## Product rules
- Saudi coding only: ICD-10-AM diagnoses, ACHI procedures, SBS billing codes, AR-DRG, LOINC, NICIP. Never CPT, E&M levels or MS-DRG.
- Onasi brand colours: Dark Green #032C26, Minty White #DAF0E4, Mint #0CE69F, Cyan #39EDD5. Keep standard healthcare colours where clinicians rely on them (CTAS triage levels, red for critical results).
- Light glass design: white frosted cards on the light green page, no green tint on cards.
- Lists and tables use a spreadsheet-style grid, as in Epic worklists:
  - compact rows of about 32 to 36px (Comfortable stays available), thin cell lines, light zebra striping;
  - a sticky header row and a sticky first column (patient or code);
  - column header menus to sort and hide, resizable columns where cheap;
  - a checkbox column for selection, keyboard movement between cells, Enter opens the row;
  - row actions on one line (one icon plus a More menu), never stacked;
  - right-aligned numbers, monospace codes that do not wrap, small status pills;
  - a crisp white grid with fine neutral lines and no blur inside the grid, inside the glass page;
  - on a phone, rows become cards.
  - Look for patterns on 21st.dev first (data grid, spreadsheet table) and adapt them without new packages.
- The logo gets no effects, shadows or rotation.
- Plain short text, Title Case labels, no em dashes. Never write the word "prototype" in the UI. Amounts in SAR.
- Developer View is for the System Administrator only.

## UI standards (product lead feedback, 16 Nov 2026)
- Row and record actions are standard icon buttons, not text buttons: one shared set (View, Open Chart, Edit, Print, Download, Delete, More), each with a tooltip and an aria-label, the same icon for the same action on every page. One primary action per row may stay a labelled button only when it is the next step (for example Check In).
- Listing pages open with the left sidebar collapsed to its icon rail, so the grid gets the width; the user can still expand it, and other pages keep their state.
- Buttons, everywhere, in this order from left to right: Cancel or Back (ghost), secondary actions (outline), Save As Draft (outline), then the one primary action (solid Dark Green) on the far right. Destructive actions are red and always ask first. Page headers: secondary actions in a More menu or outline, the primary action solid on the right. Never two solid primary buttons side by side.

## CT-HIS database reference
- `docs/ct-his-db/` (kept out of git) holds a read-only snapshot of the real CT-HIS SQL Server database: `SCHEMA.md` (310 tables with columns and keys), `LOOKUPS.md` (303 dropdown lists in English and Arabic), `EMR-PAGES.md` (EMR pages and routes) and `form-templates/` (the dynamic form JSON). Read these before designing a form or a list; query the database (`sqlcmd -S . -E -C -d CT-HIS`, read-only) only when the snapshot is not enough.

## Build only what the HIS can implement (user, 16 Nov 2026)
- Everything here will be implemented in the real CT-HIS codebase, so screens, fields, statuses, dropdowns and sample data must come from it: the database (`docs/ct-his-db/`) and the source (`CT-CoreApp`, branch `origin/dev-Sham`, read only with `git show`: `CT-HIS.WebApp/app/(pages)/` for pages, `CT-HIS.Domain` and `CT-HIS.API` for entities, enums and endpoints).
- Use the HIS names for fields, statuses and lookups, and HIS formats for identifiers (MRN, visit and invoice numbers). Sample data uses only values the HIS tables could hold.
- A field or feature with no HIS table, column or page is not added silently: either map it to the nearest HIS table, or list it in `docs/ct-his-db/parity/` as "New in HIS" with the table or column it would need, and ask before building it.
- `docs/ct-his-db/parity/` holds one file per area mapping our pages to HIS pages, routes and tables.

## Epic benchmarking (physician feedback, see `MoM Onasi HIS Epic Benchmarking.docx`, kept out of git)
- Fewer clicks: every routine doctor task (labs, vitals, imaging) in one or two clicks.
- The whole visit on one page with module tabs (Lab, Imaging, Vitals and so on), not list menus; a patient list is the doctor's landing view.
- Lab results: a two-column layout, a narrow side panel of categories (Chemistry / Electrolytes, Metabolic Profile, Renal Profile, Special Tests) and a main spreadsheet grid:
  - analytes as rows, collection dates as columns, newest date next to the analyte names, older dates to the right;
  - every date reachable by horizontal scroll, plus a date search;
  - abnormal values flagged in the cell with a small red exclamation mark, nothing louder;
  - double-click a cell for a trend graph of that analyte (date on X, value on Y), never a chart by default;
  - no export of lab results to Excel or CSV (patient privacy).
- Doctors read tables: one large readable table beats dashboards and per-result pages.

## Before committing
- Run `npx tsc --noEmit`, `npx vitest run` and `npx vite build`. Commit only when all three pass.
- Never commit `onasi-journeys.html`: the repository is public.
