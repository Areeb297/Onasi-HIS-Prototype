import { ageOf, vitalNums, type AiContext } from "./context";

/**
 * Clinical decision support: simple, fixed screening rules. Not validated and not a medical device.
 * Every flag says which chart field it came from.
 */

export interface Flag {
  level: "high" | "medium" | "info";
  text: string;
  /** The chart field that triggered it. */
  source: string;
}

export function drugAllergyFlags(c: AiContext): Flag[] {
  const out: Flag[] = [];
  const allergies = c.enc.allergies.map((a) => a.text.toLowerCase());
  for (const m of c.meds) {
    const name = m.name.toLowerCase();
    for (const a of allergies) {
      const direct = name.includes(a) || a.includes(name.split(" ")[0]) || m.allergyKeys.some((k) => a.includes(k.toLowerCase()) || k.toLowerCase().includes(a));
      const cross = !direct && m.crossKeys.some((k) => a.includes(k.toLowerCase()) || k.toLowerCase().includes(a));
      if (direct) out.push({ level: "high", text: `${m.name} conflicts with the recorded allergy to ${a}. Check before the next dose.`, source: "Allergies and Prescriptions" });
      else if (cross) out.push({ level: "medium", text: `${m.name} may cross-react with the recorded allergy to ${a}. Review the choice.`, source: "Allergies and Prescriptions" });
    }
  }
  return out;
}

export function vitalFlags(c: AiContext): Flag[] {
  const v = vitalNums(c.enc.vitals);
  const out: Flag[] = [];
  const add = (level: Flag["level"], text: string, field: string) => out.push({ level, text, source: `Vitals: ${field}` });
  if (v.temp !== undefined) {
    if (v.temp >= 39) add("high", `High fever: ${v.temp} C.`, "temperature");
    else if (v.temp >= 38) add("medium", `Fever: ${v.temp} C (38 C or more).`, "temperature");
    else if (v.temp < 35.5) add("medium", `Low temperature: ${v.temp} C.`, "temperature");
  }
  if (v.spo2 !== undefined) {
    if (v.spo2 < 90) add("high", `Low oxygen saturation: ${v.spo2}%. This is severe.`, "SpO2");
    else if (v.spo2 < 94) add("medium", `Oxygen saturation is ${v.spo2}% (below 94%).`, "SpO2");
  }
  if (v.pulse !== undefined) {
    if (v.pulse > 100) add("medium", `Fast pulse (tachycardia): ${v.pulse}/min.`, "pulse");
    else if (v.pulse < 50) add("medium", `Slow pulse (bradycardia): ${v.pulse}/min.`, "pulse");
  }
  if (v.rr !== undefined && v.rr >= 22) add("medium", `Fast breathing: ${v.rr}/min (22 or more).`, "respiratory rate");
  if (v.sbp !== undefined) {
    if (v.sbp < 90) add("high", `Low blood pressure: ${v.sbp}/${v.dbp ?? "?"} mmHg.`, "blood pressure");
    else if (v.sbp >= 180 || (v.dbp ?? 0) >= 120) add("high", `Very high blood pressure: ${v.sbp}/${v.dbp ?? "?"} mmHg.`, "blood pressure");
    else if (v.sbp >= 140 || (v.dbp ?? 0) >= 90) add("info", `Raised blood pressure: ${v.sbp}/${v.dbp ?? "?"} mmHg.`, "blood pressure");
  }
  return out;
}

/** qSOFA: breathing 22 or more, systolic 100 or less, altered mentation. Mentation is not in the chart, so at most 2 of 3 can be scored. */
export function qsofa(c: AiContext): Flag[] {
  const v = vitalNums(c.enc.vitals);
  if (v.rr === undefined && v.sbp === undefined) return [];
  let score = 0;
  const hit: string[] = [];
  if (v.rr !== undefined && v.rr >= 22) { score++; hit.push("breathing rate 22 or more"); }
  if (v.sbp !== undefined && v.sbp <= 100) { score++; hit.push("systolic pressure 100 or less"); }
  const text = `qSOFA screen: ${score} of 3 scored (mental status is not recorded in the chart).${hit.length ? ` Met: ${hit.join(", ")}.` : ""}`;
  if (score >= 2) return [{ level: "high", text: `${text} A score of 2 or more suggests a higher risk with infection. Consider urgent senior review.`, source: "Vitals: respiratory rate, blood pressure" }];
  if (score === 1 && (v.temp ?? 0) >= 38) return [{ level: "medium", text: `${text} Fever is present too. Reassess soon.`, source: "Vitals" }];
  return [{ level: "info", text, source: "Vitals" }];
}

/** Things the chart still needs before the patient can be discharged and the A03 message sent. */
export function missingBeforeDischarge(c: AiContext): Flag[] {
  const e = c.enc;
  if (e.status === "discharged" || e.status === "cancelled") return [];
  const out: Flag[] = [];
  const need = (cond: boolean, level: Flag["level"], text: string, source: string) => !cond && out.push({ level, text, source });
  need(e.dx.length > 0, "high", "No diagnosis is recorded. The discharge message (A03) needs at least one.", "Diagnosis");
  need(!!e.disposition, "medium", "No discharge disposition (where the patient is going) is chosen.", "Visit: disposition");
  need(!!e.vitals, "medium", "No vital signs are recorded.", "Vitals");
  need(e.complaints.length > 0 || !!e.reason, "medium", "No chief complaint or reason for the visit is recorded.", "Chief Complaints");
  need(e.allergies.length > 0, "info", "No allergies are recorded. Confirm 'no known allergies' with the patient.", "Allergies");
  need(e.dx.some((d) => d.type === "F"), "info", "No final diagnosis is set yet (only admitting or working).", "Diagnosis");
  return out;
}

export function runCds(c: AiContext): Flag[] {
  const rank = { high: 0, medium: 1, info: 2 } as const;
  const flags = [...drugAllergyFlags(c), ...vitalFlags(c), ...qsofa(c), ...missingBeforeDischarge(c)];
  const age = ageOf(c.patient.dob, c.now);
  if (age >= 65 && c.meds.length >= 5) flags.push({ level: "info", text: `Patient is ${age} and has ${c.meds.length} medicines. Consider a medicine review.`, source: "Age and Prescriptions" });
  return flags.sort((a, b) => rank[a.level] - rank[b.level]);
}
