import type { Pr } from "./model";

/**
 * Common ACHI procedures for the chart's procedure search.
 * ACHI is the Australian Classification of Health Interventions used in Saudi Arabia with ICD-10-AM.
 * Codes are 7 digits written NNNNN-NN. This is a sample of frequent procedures, not the full classification:
 * the hospital's licensed ACHI edition is the source of truth, so check codes against it before go-live.
 */

/** Clinical procedure type as the HIS records it. Separate from the PR1-6 functional type. */
export const PROC_TYPES = [
  "Major Surgical", "Minor Surgical", "Endoscopic", "Interventional", "Diagnostic", "Therapeutic", "Obstetric", "Anaesthesia", "Allied Health",
] as const;
export type ProcType = (typeof PROC_TYPES)[number];

export interface AchiItem {
  code: string;
  text: string;
  /** ACHI chapter, in words. Used to group and filter. */
  area: string;
  /** Suggested clinical procedure type. */
  procType: ProcType;
  /** Suggested PR1-6 functional type: A anesthesia, D diagnostic, I invasive (other), P treatment. */
  type: NonNullable<Pr["type"]>;
}

const t = (code: string, text: string, area: string, procType: ProcType, type: AchiItem["type"]): AchiItem => ({ code, text, area, procType, type });

export const ACHI_CATALOG: AchiItem[] = [
  // Digestive system
  t("30443-00", "Cholecystectomy", "Digestive system", "Major Surgical", "P"),
  t("30445-00", "Laparoscopic cholecystectomy", "Digestive system", "Major Surgical", "P"),
  t("30571-00", "Appendicectomy", "Digestive system", "Major Surgical", "P"),
  t("30572-00", "Laparoscopic appendicectomy", "Digestive system", "Major Surgical", "P"),
  t("30609-00", "Repair of inguinal hernia, unilateral", "Digestive system", "Major Surgical", "P"),
  t("30617-00", "Repair of umbilical hernia", "Digestive system", "Minor Surgical", "P"),
  t("30373-00", "Exploratory laparotomy", "Digestive system", "Major Surgical", "D"),
  t("30390-00", "Laparoscopy", "Digestive system", "Endoscopic", "D"),
  t("30597-00", "Splenectomy", "Digestive system", "Major Surgical", "P"),
  t("30473-00", "Panendoscopy to duodenum", "Digestive system", "Endoscopic", "D"),
  t("30473-01", "Panendoscopy to duodenum with biopsy", "Digestive system", "Endoscopic", "D"),
  t("30481-00", "Percutaneous endoscopic gastrostomy [PEG]", "Digestive system", "Endoscopic", "P"),
  t("30484-00", "Endoscopic retrograde cholangiopancreatography [ERCP]", "Digestive system", "Endoscopic", "D"),
  t("32084-00", "Fibreoptic colonoscopy to hepatic flexure", "Digestive system", "Endoscopic", "D"),
  t("32090-00", "Fibreoptic colonoscopy to caecum", "Digestive system", "Endoscopic", "D"),
  t("32090-01", "Fibreoptic colonoscopy to caecum with biopsy", "Digestive system", "Endoscopic", "D"),
  t("32138-00", "Haemorrhoidectomy", "Digestive system", "Minor Surgical", "P"),

  // Skin, subcutaneous tissue and breast
  t("30223-01", "Incision and drainage of abscess of skin and subcutaneous tissue", "Skin and breast", "Minor Surgical", "P"),
  t("30026-00", "Repair of wound of skin and subcutaneous tissue of other site, superficial", "Skin and breast", "Minor Surgical", "P"),
  t("31205-00", "Excision of lesion of skin and subcutaneous tissue of other site", "Skin and breast", "Minor Surgical", "P"),
  t("30071-00", "Biopsy of skin and subcutaneous tissue", "Skin and breast", "Minor Surgical", "D"),
  t("30023-00", "Excisional debridement of soft tissue", "Skin and breast", "Minor Surgical", "P"),
  t("30676-00", "Excision of pilonidal sinus or cyst", "Skin and breast", "Minor Surgical", "P"),
  t("31500-00", "Excision of lesion of breast", "Skin and breast", "Major Surgical", "P"),
  t("31518-00", "Simple mastectomy, unilateral", "Skin and breast", "Major Surgical", "P"),

  // Endocrine
  t("30296-00", "Hemithyroidectomy", "Endocrine system", "Major Surgical", "P"),
  t("30296-01", "Total thyroidectomy", "Endocrine system", "Major Surgical", "P"),

  // Obstetrics and gynaecology
  t("16520-00", "Elective classical caesarean section", "Obstetrics", "Obstetric", "P"),
  t("16520-01", "Emergency classical caesarean section", "Obstetrics", "Obstetric", "P"),
  t("16520-02", "Elective lower segment caesarean section", "Obstetrics", "Obstetric", "P"),
  t("16520-03", "Emergency lower segment caesarean section", "Obstetrics", "Obstetric", "P"),
  t("90467-00", "Spontaneous vertex delivery", "Obstetrics", "Obstetric", "P"),
  t("90472-00", "Episiotomy", "Obstetrics", "Obstetric", "P"),
  t("16511-00", "Cervical cerclage", "Obstetrics", "Obstetric", "P"),
  t("35640-00", "Dilation and curettage of uterus [D&C]", "Gynaecology", "Minor Surgical", "P"),
  t("35653-01", "Total abdominal hysterectomy", "Gynaecology", "Major Surgical", "P"),
  t("35657-00", "Vaginal hysterectomy", "Gynaecology", "Major Surgical", "P"),

  // Cardiovascular
  t("38200-00", "Right heart catheterisation", "Cardiovascular system", "Interventional", "D"),
  t("38203-00", "Left heart catheterisation", "Cardiovascular system", "Interventional", "D"),
  t("38218-00", "Coronary angiography", "Cardiovascular system", "Interventional", "D"),
  t("38300-00", "Percutaneous transluminal balloon angioplasty of 1 coronary artery", "Cardiovascular system", "Interventional", "P"),
  t("38306-00", "Percutaneous insertion of 1 transluminal stent into single coronary artery", "Cardiovascular system", "Interventional", "P"),
  t("38497-00", "Coronary artery bypass, using 1 saphenous vein graft", "Cardiovascular system", "Major Surgical", "P"),
  t("13400-00", "Cardioversion", "Cardiovascular system", "Therapeutic", "P"),
  t("11700-00", "Other electrocardiography [ECG]", "Cardiovascular system", "Diagnostic", "D"),
  t("92052-00", "Cardiopulmonary resuscitation", "Cardiovascular system", "Therapeutic", "P"),
  t("13815-00", "Percutaneous central vein catheterisation", "Cardiovascular system", "Interventional", "I"),
  t("13757-00", "Therapeutic venesection", "Cardiovascular system", "Therapeutic", "P"),

  // Blood, dialysis and ventilation
  t("13706-02", "Administration of packed cells", "Blood and blood forming organs", "Therapeutic", "I"),
  t("13706-03", "Administration of platelets", "Blood and blood forming organs", "Therapeutic", "I"),
  t("30087-00", "Biopsy of bone marrow", "Blood and blood forming organs", "Diagnostic", "D"),
  t("13100-00", "Haemodialysis", "Urinary system", "Therapeutic", "P"),
  t("92209-00", "Management of noninvasive ventilatory support, 24 hours or less", "Respiratory system", "Therapeutic", "P"),
  t("13882-00", "Management of continuous ventilatory support, 24 hours or less", "Respiratory system", "Therapeutic", "P"),
  t("13882-01", "Management of continuous ventilatory support, more than 24 and less than 96 hours", "Respiratory system", "Therapeutic", "P"),
  t("13882-02", "Management of continuous ventilatory support, 96 hours or more", "Respiratory system", "Therapeutic", "P"),

  // Respiratory
  t("41889-00", "Bronchoscopy", "Respiratory system", "Endoscopic", "D"),
  t("41898-00", "Fibreoptic bronchoscopy", "Respiratory system", "Endoscopic", "D"),
  t("41898-01", "Fibreoptic bronchoscopy with biopsy", "Respiratory system", "Endoscopic", "D"),

  // Urinary and male genital
  t("36800-00", "Catheterisation of bladder", "Urinary system", "Therapeutic", "I"),
  t("36812-00", "Cystoscopy", "Urinary system", "Endoscopic", "D"),
  t("37203-00", "Transurethral resection of prostate [TURP]", "Male genital organs", "Major Surgical", "P"),
  t("30653-00", "Male circumcision", "Male genital organs", "Minor Surgical", "P"),

  // Musculoskeletal
  t("49318-00", "Total arthroplasty of hip, unilateral", "Musculoskeletal system", "Major Surgical", "P"),
  t("49518-00", "Total arthroplasty of knee, unilateral", "Musculoskeletal system", "Major Surgical", "P"),
  t("47522-00", "Hemiarthroplasty of femur", "Musculoskeletal system", "Major Surgical", "P"),
  t("49557-00", "Arthroscopy of knee", "Musculoskeletal system", "Endoscopic", "D"),
  t("39331-00", "Release of carpal tunnel", "Nervous system", "Minor Surgical", "P"),

  // Ear, nose, mouth and throat
  t("41789-00", "Tonsillectomy without adenoidectomy", "Ear, nose, mouth and throat", "Major Surgical", "P"),
  t("41789-01", "Tonsillectomy with adenoidectomy", "Ear, nose, mouth and throat", "Major Surgical", "P"),
  t("41801-00", "Adenoidectomy without tonsillectomy", "Ear, nose, mouth and throat", "Major Surgical", "P"),
  t("41677-00", "Control of epistaxis by anterior nasal packing", "Ear, nose, mouth and throat", "Minor Surgical", "P"),

  // Nervous system and diagnostics
  t("39000-00", "Lumbar puncture", "Nervous system", "Diagnostic", "D"),
  t("11000-00", "Electroencephalography [EEG]", "Nervous system", "Diagnostic", "D"),

  // Medicines given as a procedure
  t("96199-00", "Intravenous administration of pharmacological agent, antineoplastic agent", "Medication administration", "Therapeutic", "I"),
  t("96199-09", "Intravenous administration of pharmacological agent, other and unspecified agent", "Medication administration", "Therapeutic", "I"),
  t("96197-09", "Intramuscular administration of pharmacological agent, other and unspecified agent", "Medication administration", "Therapeutic", "I"),

  // Anaesthesia
  t("92514-19", "General anaesthesia, ASA 1, non emergency", "Anaesthesia", "Anaesthesia", "A"),
  t("92514-29", "General anaesthesia, ASA 2, non emergency", "Anaesthesia", "Anaesthesia", "A"),
  t("92508-29", "Neuraxial block, ASA 2, non emergency", "Anaesthesia", "Anaesthesia", "A"),

  // Allied health
  t("95550-00", "Allied health intervention, dietetics", "Allied health", "Allied Health", "P"),
  t("95550-01", "Allied health intervention, social work", "Allied health", "Allied Health", "P"),
  t("95550-02", "Allied health intervention, occupational therapy", "Allied health", "Allied Health", "P"),
  t("95550-03", "Allied health intervention, physiotherapy", "Allied health", "Allied Health", "P"),
];

export const ACHI_BY_CODE: Record<string, AchiItem> = Object.fromEntries(ACHI_CATALOG.map((x) => [x.code, x]));

/** ACHI code format: five digits, a hyphen and two digits. */
export const ACHI_CODE = /^\d{5}-\d{2}$/;

/**
 * Search the catalogue by code or words. Every word must appear in the code, the description or the area.
 * The hyphen in a code is optional, so "3044500" finds 30445-00. A procedure type limits the results when given.
 */
export function searchAchi(query: string, opts: { procType?: string; limit?: number } = {}): AchiItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const list = ACHI_CATALOG.filter((x) => !opts.procType || x.procType === opts.procType).filter((x) => {
    const hay = `${x.code} ${x.code.replace("-", "")} ${x.text} ${x.area}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  return list.slice(0, opts.limit ?? 25);
}

/**
 * A procedure row with its HIS-only fields filled for display. Old rows saved before these fields existed
 * read as Completed, with coverage following the visit and no diagnosis link.
 */
export function readPr(p: Pr, visitPay?: "Cash" | "Insurance"): Required<Pick<Pr, "status" | "coverage">> & Pr {
  return {
    ...p,
    status: p.status ?? "Completed",
    coverage: p.coverage ?? (visitPay === "Cash" ? "Cash" : "Insured"),
  };
}

/** A new procedure row from a catalogue entry. */
export function newPr(item: AchiItem, at: string, visitPay?: "Cash" | "Insurance", dxCode?: string): Pr {
  return {
    code: item.code, text: item.text, system: "ACHI", type: item.type, at, procType: item.procType,
    coverage: visitPay === "Cash" ? "Cash" : "Insured", status: "Completed", ...(dxCode ? { dxCode } : {}),
  };
}

/**
 * SBS billing code for each catalog ACHI code, checked against the CT-HIS code catalog (dbo.Codes, NPHIES
 * CodeSystem/procedures and services) on 16 Nov 2026. SBS is the ACHI code plus a two-digit extension. Codes with more
 * than one SBS extension (side, size) are left out: the coder picks the extension on the claim.
 */
export const SBS_OF_ACHI: Readonly<Record<string, string>> = {
  "11000-00": "11000-00-00",
  "11700-00": "11700-00-00",
  "13100-00": "13100-00-00",
  "13400-00": "13400-00-00",
  "13706-02": "13706-02-00",
  "13706-03": "13706-03-00",
  "13757-00": "13757-00-00",
  "13815-00": "13815-00-00",
  "13882-00": "13882-00-00",
  "13882-01": "13882-01-00",
  "13882-02": "13882-02-00",
  "16511-00": "16511-00-00",
  "16520-00": "16520-00-00",
  "16520-01": "16520-01-00",
  "16520-02": "16520-02-00",
  "16520-03": "16520-03-00",
  "30071-00": "30071-00-00",
  "30087-00": "30087-00-00",
  "30296-01": "30296-01-00",
  "30373-00": "30373-00-00",
  "30390-00": "30390-00-00",
  "30443-00": "30443-00-00",
  "30445-00": "30445-00-00",
  "30473-00": "30473-00-00",
  "30473-01": "30473-01-00",
  "30481-00": "30481-00-00",
  "30484-00": "30484-00-00",
  "30571-00": "30571-00-00",
  "30572-00": "30572-00-00",
  "30597-00": "30597-00-00",
  "30609-00": "30609-00-00",
  "30617-00": "30617-00-00",
  "30676-00": "30676-00-00",
  "31518-00": "31518-00-00",
  "32084-00": "32084-00-00",
  "32090-00": "32090-00-00",
  "32090-01": "32090-01-00",
  "32138-00": "32138-00-00",
  "35640-00": "35640-00-00",
  "35653-01": "35653-01-00",
  "35657-00": "35657-00-00",
  "36800-00": "36800-00-00",
  "36812-00": "36812-00-00",
  "38200-00": "38200-00-00",
  "38203-00": "38203-00-00",
  "38218-00": "38218-00-00",
  "38300-00": "38300-00-00",
  "38306-00": "38306-00-00",
  "38497-00": "38497-00-00",
  "39000-00": "39000-00-00",
  "41677-00": "41677-00-00",
  "41789-00": "41789-00-00",
  "41789-01": "41789-01-00",
  "41801-00": "41801-00-00",
  "49318-00": "49318-00-00",
  "49518-00": "49518-00-00",
  "90467-00": "90467-00-00",
  "90472-00": "90472-00-00",
  "92052-00": "92052-00-00",
  "92209-00": "92209-00-00",
  "92508-29": "92508-29-00",
  "92514-19": "92514-19-00",
  "92514-29": "92514-29-00",
  "95550-00": "95550-00-00",
  "95550-01": "95550-01-00",
  "95550-02": "95550-02-00",
  "95550-03": "95550-03-00",
  "96199-00": "96199-00-00",
};

/** The verified SBS code for an ACHI code, or undefined when it needs the coder (several extensions, or not in the list). */
export const sbsForAchi = (achi: string): string | undefined => SBS_OF_ACHI[achi];
