# Onasi HIS

A clickable HIS and EMR for Saudi healthcare. It shows the HIS workflows and the NPHIES and UHR integration
messages (HL7 v2 ADT, vital signs, FHIR lab and radiology, medication, clinical documents) with a HIS View for
clinicians and a Developer View for integrators.

All patients are made up. Nothing is sent to NPHIES: every response is simulated, and data stays in the browser.

## Run it

```
npm install
npm run dev
```

Other commands: `npm run build`, `npx vitest run`, `npx tsc --noEmit`.

## Deploy

It is a static Vite app. On Vercel, import the repository: the framework preset is Vite, the build command is
`npm run build` and the output folder is `dist`. The app uses hash routes, so no rewrite rules are needed.

&copy; 2026 Ebttikar. All rights reserved. Onasi and the Onasi logo are products and marks of Ebttikar.
