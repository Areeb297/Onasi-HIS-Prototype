import * as React from "react";
import { renderToString } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { AiAssistant } from "@/components/AiAssistant";
import { OutputCard } from "@/components/ai/OutputCard";
import { ClinicalDocsSection } from "@/components/emr/ClinicalDocsSection";
import { SoapSection } from "@/components/emr/SoapSection";
import { AiGovernancePage } from "@/pages/AiGovernancePage";
import { amendDoc, generateDoc, publishDoc, recordDeath, resetDocs } from "@/lib/docs";
import { setDevMode } from "@/lib/devmode";
import { switchUser } from "@/lib/session";
import { getState } from "@/lib/store";
import { audit } from "@/lib/audit";
import { buildContext } from "./live";
import { ruleEngine, USE_CASES } from "./engine";
import { saveSoap, signSoap } from "./soap-store";

const h = React.createElement;
const enc = (pid: string) => getState().encounters.find((e) => e.patientId === pid)!;
const pat = (pid: string) => getState().patients.find((p) => p.id === pid)!;

/** Render-time smoke test: the new screens render in both views and in every state without throwing. */
describe("clinical documents and AI screens render", () => {
  beforeAll(() => {
    switchUser("U9");
    resetDocs();
    const e = enc("P006");
    const g = generateDoc(e, pat("P006"), "discharge");
    if (!g.ok) throw new Error(g.message);
    publishDoc(g.doc.id);
    amendDoc(e, pat("P006"), g.doc.id, "Added a missing item");
    generateDoc(enc("P007"), pat("P007"), "outpatient"); // an invalid draft
    const p = enc("P001");
    generateDoc(p, pat("P001"), "operative", { procIndex: 0 });
    recordDeath(enc("P009"), pat("P009"));
    const n = saveSoap(p.visitNumber, "P001", { subjective: "s", objective: "o", assessment: "a", plan: "p" }, { aiDrafted: true });
    signSoap(n.id);
    saveSoap(p.visitNumber, "P001", { subjective: "draft", objective: "", assessment: "", plan: "" });
  });

  for (const dev of [true, false]) {
    const view = dev ? "Developer View" : "HIS View";
    it(`renders Clinical Documents in ${view}`, () => {
      setDevMode(dev);
      for (const pid of ["P006", "P007", "P001", "P009", "P003"]) {
        const html = renderToString(h(ClinicalDocsSection, { enc: enc(pid) }));
        expect(html).toContain("Clinical Documents");
        expect(html).toContain("Discharge Summary");
        if (dev) expect(html).toContain("NPHIES Requirements");
        else expect(html).not.toContain("NPHIES Requirements");
      }
      expect(renderToString(h(ClinicalDocsSection, { enc: enc("P009") }))).toContain("patient death");
    });

    it(`renders SOAP Notes in ${view}`, () => {
      setDevMode(dev);
      const html = renderToString(h(SoapSection, { enc: enc("P001") }));
      expect(html).toContain("Electronically signed");
      expect(html).toContain("Draft With Onasi AI");
      expect(renderToString(h(SoapSection, { enc: enc("P002") }))).toContain("No SOAP notes yet");
    });

    it(`renders AI Governance in ${view}`, () => {
      setDevMode(dev);
      audit("ai-suggest", "AI soap: SOAP note draft", { patient: "Saad Almutairi", detail: "soap" });
      const html = renderToString(h(AiGovernancePage));
      expect(html).toContain("AI Governance");
      expect(html).toContain("not a certified medical device");
      expect(html).toContain("AI Use Case Register");
    });

    it(`renders the assistant button and every output card in ${view}`, async () => {
      setDevMode(dev);
      // The router reads window.location. Tests run in node, so give it a small stand-in.
      (globalThis as unknown as { window: unknown }).window = { location: { hash: "#/chart?visit=V100001" }, addEventListener: () => {}, removeEventListener: () => {} };
      expect(renderToString(h(AiAssistant))).toContain("Onasi AI");
      delete (globalThis as unknown as { window?: unknown }).window;
      const e = enc("P001");
      for (const u of USE_CASES) {
        const out = await ruleEngine.run({ useCase: u.id, ctx: buildContext(e, pat("P001")) });
        const html = renderToString(h(OutputCard, { out, enc: e, patient: pat("P001") }));
        expect(html).toContain("AI draft. A clinician must review.");
        expect(html).toContain("Accept");
        expect(html).toContain("Reject");
      }
    });
  }
});
