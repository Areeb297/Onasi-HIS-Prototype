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

export const RAD_REGION_LABEL = (p: RadProcedure) => BODY_REGIONS[p.region].display;
export const RAD_MODALITY_LABEL = (p: RadProcedure) => MODALITIES[p.modality].display;
