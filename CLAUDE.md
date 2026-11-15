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
