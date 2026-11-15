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
- The logo gets no effects, shadows or rotation.
- Plain short text, Title Case labels, no em dashes. Never write the word "prototype" in the UI. Amounts in SAR.
- Developer View is for the System Administrator only.

## Before committing
- Run `npx tsc --noEmit`, `npx vitest run` and `npx vite build`. Commit only when all three pass.
- Never commit `onasi-journeys.html`: the repository is public.
