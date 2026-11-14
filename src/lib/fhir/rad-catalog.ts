/**
 * Radiology procedure catalogue.
 *
 * Every code here is in the national "KSA Imaging Procedure" value set (CS-Rad-Procedure v2.0, Confluence page id 23168870,
 * the NICIP list with the Saudi extension). The code, name, modality and report title of each row were copied from that
 * workbook. A real hospital maps its own catalogue to the same list.
 *
 * Modalities come from the "Modalities" value set (page id 39780455, DICOM codes).
 * Body regions come from the "KSA Body Regions" value set (page id 39846061, 11 SNOMED CT codes).
 */

export interface Modality { code: string; display: string }
export interface BodyRegion { code: string; display: string }

/** Display names as written in the Modalities value set. The workbook maps plain X-ray procedures to DX. */
export const MODALITIES: Record<string, Modality> = {
  DX: { code: "DX", display: "Digital Radiography" },
  CT: { code: "CT", display: "Computed Tomography" },
  MR: { code: "MR", display: "Magnetic Resonance" },
  US: { code: "US", display: "Ultrasound" },
  MG: { code: "MG", display: "Mammography" },
  BMD: { code: "BMD", display: "Bone Mineral Densitometry" },
};

/** Codes and names from the KSA Body Regions value set. */
export const BODY_REGIONS: Record<string, BodyRegion> = {
  head: { code: "69536005", display: "Head structure" },
  chest: { code: "51185008", display: "Thoracic structure" },
  breast: { code: "76752008", display: "Breast structure" },
  abdomen: { code: "113345001", display: "Abdominal structure" },
  pelvis: { code: "12921003", display: "Pelvic structure" },
  spine: { code: "280717001", display: "Spinal structure" },
  lower: { code: "61685007", display: "Lower limb structure" },
  whole: { code: "243928005", display: "Entire body region" },
};

/** The twelve titles a radiology report may carry (Composition.title, page id 414547978). */
export type ReportTitle =
  | "CT Report" | "MR Report" | "Nuclear Medicine Report" | "PET Scan Report" | "Ultrasound Report" | "Obstetric Ultrasound Report"
  | "X-Ray Report" | "Fluoroscopy Study Report" | "Mammography Screening Report" | "Mammography Diagnostic Report"
  | "Bone Density Report" | "Interventional Radiology Report";

export interface RadProcedure {
  /** Code from the KSA Imaging Procedure value set. */
  code: string;
  /** Name as written in the value set. */
  display: string;
  short: string;
  modality: keyof typeof MODALITIES;
  region: keyof typeof BODY_REGIONS;
  /** Report title the value set links to this procedure. */
  reportTitle: ReportTitle;
  /** Needs contrast. Shown as a reminder only. */
  contrast?: boolean;
  /** Findings template for the report editor. */
  technique: string;
}

export const RAD_CATALOG: RadProcedure[] = [
  { code: "XCHES-PA", display: "XR Chest PA", short: "Chest X-Ray", modality: "DX", region: "chest", reportTitle: "X-Ray Report", technique: "PA erect view of the chest." },
  { code: "XABDO", display: "XR Abdomen", short: "Abdomen X-Ray", modality: "DX", region: "abdomen", reportTitle: "X-Ray Report", technique: "Supine view of the abdomen." },
  { code: "X-LSJ", display: "XR Lumbosacral junction", short: "Lumbosacral X-Ray", modality: "DX", region: "spine", reportTitle: "X-Ray Report", technique: "AP and lateral views of the lumbosacral junction." },
  { code: "XKNER", display: "XR Knee Rt", short: "Right Knee X-Ray", modality: "DX", region: "lower", reportTitle: "X-Ray Report", technique: "AP and lateral views of the right knee." },
  { code: "CSKUH", display: "CT Head", short: "CT Head", modality: "CT", region: "head", reportTitle: "CT Report", technique: "Axial CT of the head without contrast." },
  { code: "CCHES", display: "CT Chest", short: "CT Chest", modality: "CT", region: "chest", reportTitle: "CT Report", technique: "Axial CT of the chest." },
  // The workbook files this code under "Multi Area", which is not one of the 11 body regions. Abdomen is sent. See the open questions.
  { code: "CABPEC", display: "CT Abdomen and pelvis w/C", short: "CT Abdomen And Pelvis", modality: "CT", region: "abdomen", reportTitle: "CT Report", contrast: true, technique: "Axial CT of the abdomen and pelvis after intravenous contrast." },
  { code: "MSKUH", display: "MRI Head", short: "MRI Brain", modality: "MR", region: "head", reportTitle: "MR Report", technique: "Multiplanar MRI of the brain." },
  { code: "MLUSP", display: "MRI Spine lumbar", short: "MRI Lumbar Spine", modality: "MR", region: "spine", reportTitle: "MR Report", technique: "Sagittal and axial MRI of the lumbar spine." },
  { code: "UABDO", display: "US Abdomen", short: "Abdomen Ultrasound", modality: "US", region: "abdomen", reportTitle: "Ultrasound Report", technique: "Real-time ultrasound of the abdomen." },
  { code: "UPELV", display: "US Pelvis", short: "Pelvis Ultrasound", modality: "US", region: "pelvis", reportTitle: "Ultrasound Report", technique: "Transabdominal ultrasound of the pelvis." },
  { code: "XMAMB", display: "Mammogram Both", short: "Mammogram", modality: "MG", region: "breast", reportTitle: "Mammography Diagnostic Report", technique: "Bilateral two-view mammography." },
  { code: "XBDXW", display: "DEXA Whole body", short: "Bone Density", modality: "BMD", region: "whole", reportTitle: "Bone Density Report", technique: "Dual-energy X-ray absorptiometry of the whole body." },
];

const BY_CODE = new Map(RAD_CATALOG.map((p) => [p.code, p]));
export const procByCode = (code: string): RadProcedure | undefined => BY_CODE.get(code);

export const QUICK_RAD: { id: string; label: string; code: string }[] = [
  { id: "cxr", label: "Chest X-Ray", code: "XCHES-PA" },
  { id: "ctab", label: "CT Abdomen And Pelvis", code: "CABPEC" },
  { id: "cth", label: "CT Head", code: "CSKUH" },
  { id: "usab", label: "Abdomen Ultrasound", code: "UABDO" },
];

/** Report text for the editor's one-click templates. */
export const REPORT_TEMPLATES: Record<string, { findings: string; impression: string; comparison: string }> = {
  normal: {
    findings: "No acute abnormality. The structures in the study area are normal in size, position and appearance.",
    impression: "Normal study.",
    comparison: "No previous study available for comparison.",
  },
  abnormal: {
    findings: "There is a focal abnormality in the study area, described in detail by the reporting radiologist. Adjacent structures are otherwise unremarkable.",
    impression: "Abnormal study. Clinical correlation and follow-up are advised.",
    comparison: "No previous study available for comparison.",
  },
  critical: {
    findings: "A large right pneumothorax with partial lung collapse and mediastinal shift is seen.",
    impression: "Large right tension pneumothorax. Critical result.",
    comparison: "No previous study available for comparison.",
  },
};

/** Normal wording per study type, so the radiologist starts from the right text for the exam. Demo wording. */
const NORMAL_REPORTS: Record<string, { findings: string; impression: string }> = {
  "XCHES-PA": {
    findings: "The lungs are clear. No consolidation, collapse or pleural effusion. The heart size and mediastinal contours are normal. No pneumothorax. The visible bones are intact.",
    impression: "Normal chest X-ray.",
  },
  XABDO: {
    findings: "The bowel gas pattern is normal. No dilated bowel loops and no free gas. No abnormal calcification. The visible bones are intact.",
    impression: "Normal abdominal X-ray.",
  },
  "X-LSJ": {
    findings: "Normal alignment. The vertebral body heights and disc spaces are preserved. No fracture or bone lesion. The sacroiliac joints are normal.",
    impression: "Normal X-ray of the lumbosacral junction.",
  },
  XKNER: {
    findings: "No fracture or dislocation. The joint spaces are preserved. No joint effusion. Bone density is normal.",
    impression: "Normal X-ray of the right knee.",
  },
  CSKUH: {
    findings: "No intracranial bleed, mass or midline shift. The ventricles and sulci are normal for age. Grey and white matter differentiation is preserved. The skull is intact.",
    impression: "Normal CT of the head.",
  },
  CCHES: {
    findings: "The lungs are clear, with no nodule, mass or consolidation. No pleural or pericardial effusion. No enlarged lymph nodes. The heart and great vessels are normal.",
    impression: "Normal CT of the chest.",
  },
  CABPEC: {
    findings: "The liver, gallbladder, spleen, pancreas, adrenal glands and kidneys are normal. No bowel obstruction or wall thickening. No free fluid or free gas. No enlarged lymph nodes. The pelvic organs are normal.",
    impression: "Normal CT of the abdomen and pelvis.",
  },
  MSKUH: {
    findings: "Normal brain signal. No mass, bleed or acute infarct. The ventricles are normal in size. The midline structures and the posterior fossa are normal.",
    impression: "Normal MRI of the brain.",
  },
  MLUSP: {
    findings: "Normal lumbar alignment. The vertebral body heights and signal are normal. The discs are well hydrated with no herniation. No spinal canal or foraminal narrowing. The conus is normal.",
    impression: "Normal MRI of the lumbar spine.",
  },
  UABDO: {
    findings: "The liver is normal in size and texture with no focal lesion. The gallbladder has no stones and a normal wall. The bile ducts are not dilated. The pancreas, spleen and both kidneys are normal. No free fluid.",
    impression: "Normal ultrasound of the abdomen.",
  },
  UPELV: {
    findings: "The urinary bladder is normal. The pelvic organs are normal in size and texture. No mass and no free fluid.",
    impression: "Normal ultrasound of the pelvis.",
  },
  XMAMB: {
    findings: "Both breasts show scattered fibroglandular tissue. No mass, suspicious calcification or distortion. The skin and nipples are normal. No enlarged axillary lymph nodes.",
    impression: "Normal mammogram of both breasts. BI-RADS 1.",
  },
  XBDXW: {
    findings: "Bone mineral density is within the expected range for age. The T-score is above minus 1.0.",
    impression: "Normal bone density.",
  },
};

export interface ReportTemplate {
  key: string;
  label: string;
  technique?: string;
  findings: string;
  impression: string;
  comparison: string;
  critical: boolean;
}

/**
 * The templates the report editor offers for one study type. The first is the normal wording for that exact exam,
 * the others are the general abnormal and critical starts.
 */
export function reportTemplatesFor(procCode: string): ReportTemplate[] {
  const proc = procByCode(procCode);
  const normal = NORMAL_REPORTS[procCode] ?? REPORT_TEMPLATES.normal;
  return [
    { key: "normal", label: `Normal ${proc?.short ?? "Study"}`, technique: proc?.technique, findings: normal.findings, impression: normal.impression, comparison: REPORT_TEMPLATES.normal.comparison, critical: false },
    { key: "abnormal", label: "Abnormal Study", technique: proc?.technique, ...REPORT_TEMPLATES.abnormal, critical: false },
    { key: "critical", label: "Critical Finding", technique: proc?.technique, ...REPORT_TEMPLATES.critical, critical: true },
  ];
}

/** Machines per modality, for the technologist record. Made-up room names. */
export const RAD_MACHINES: Record<string, string[]> = {
  DX: ["X-Ray Room 1", "X-Ray Room 2", "Portable X-Ray"],
  CT: ["CT Scanner 1", "CT Scanner 2"],
  MR: ["MRI 1.5 Tesla", "MRI 3 Tesla"],
  US: ["Ultrasound Room 1", "Ultrasound Room 2", "Portable Ultrasound"],
  MG: ["Mammography Unit"],
  BMD: ["Bone Density Unit"],
};

export const machinesFor = (procCode: string): string[] => RAD_MACHINES[procByCode(procCode)?.modality ?? ""] ?? [];

export const RAD_REGION_LABEL =(p: RadProcedure) => BODY_REGIONS[p.region].display;
export const RAD_MODALITY_LABEL = (p: RadProcedure) => MODALITIES[p.modality].display;
