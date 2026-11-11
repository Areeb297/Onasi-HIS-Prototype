/**
 * Radiology procedure catalogue.
 * Codes follow the NICIP style the NPHIES mapping guide shows (for example CSKUH = CT head, X-LSJ = XR lumbosacral junction).
 * Only codes that appear in the mapping guide (page id 81166338) are left unmarked. Others are `madeUp: true`
 * and shown as "(test code)". A real hospital maps its own catalogue to the national NICIP list (IS0200).
 *
 * Modalities use DICOM modality codes. Body regions use SNOMED CT body structures; ones the author could not
 * confirm are marked made-up. The "KSA Imaging Procedure", "Modalities" and "KSA Body Region" value sets are not in the snapshot.
 */

export interface Modality { code: string; display: string }
export interface BodyRegion { code: string; display: string; madeUp?: boolean }

export const MODALITIES: Record<string, Modality> = {
  CR: { code: "CR", display: "Computed Radiography (X-Ray)" },
  CT: { code: "CT", display: "Computed Tomography" },
  MR: { code: "MR", display: "Magnetic Resonance" },
  US: { code: "US", display: "Ultrasound" },
  MG: { code: "MG", display: "Mammography" },
  BMD: { code: "BMD", display: "Bone Densitometry" },
};

export const BODY_REGIONS: Record<string, BodyRegion> = {
  chest: { code: "51185008", display: "Thoracic structure" },
  abdomen: { code: "113345001", display: "Abdominal structure" },
  head: { code: "69536005", display: "Head structure" },
  brain: { code: "12738006", display: "Brain structure" },
  pelvis: { code: "12921003", display: "Pelvic structure" },
  breast: { code: "76752008", display: "Breast structure" },
  knee: { code: "72696002", display: "Knee region structure" },
  lspine: { code: "122496007", display: "Lumbar spine structure", madeUp: true }, // made-up
  whole: { code: "38266002", display: "Entire body as a whole", madeUp: true }, // made-up
};

export interface RadProcedure {
  /** NICIP-style code. */
  code: string;
  display: string;
  short: string;
  modality: keyof typeof MODALITIES;
  region: keyof typeof BODY_REGIONS;
  madeUp?: boolean;
  /** Needs contrast. Shown as a reminder only. */
  contrast?: boolean;
  /** Findings template for the report editor. */
  technique: string;
}

export const RAD_CATALOG: RadProcedure[] = [
  { code: "XCHPA", display: "XR Chest PA", short: "Chest X-Ray", modality: "CR", region: "chest", madeUp: true, technique: "PA erect view of the chest." },
  { code: "XABDO", display: "XR Abdomen", short: "Abdomen X-Ray", modality: "CR", region: "abdomen", madeUp: true, technique: "Supine view of the abdomen." },
  { code: "X-LSJ", display: "XR Lumbosacral junction", short: "Lumbosacral X-Ray", modality: "CR", region: "lspine", technique: "AP and lateral views of the lumbosacral junction." },
  { code: "XKNEE", display: "XR Knee", short: "Knee X-Ray", modality: "CR", region: "knee", madeUp: true, technique: "AP and lateral views of the knee." },
  { code: "CSKUH", display: "CT head", short: "CT Head", modality: "CT", region: "head", technique: "Axial CT of the head without contrast." },
  { code: "CTCHE", display: "CT chest", short: "CT Chest", modality: "CT", region: "chest", madeUp: true, technique: "Axial CT of the chest." },
  { code: "CTABP", display: "CT abdomen and pelvis with contrast", short: "CT Abdomen And Pelvis", modality: "CT", region: "abdomen", madeUp: true, contrast: true, technique: "Axial CT of the abdomen and pelvis after intravenous contrast." },
  { code: "MBRAN", display: "MRI brain", short: "MRI Brain", modality: "MR", region: "brain", madeUp: true, technique: "Multiplanar MRI of the brain." },
  { code: "MLSPI", display: "MRI lumbar spine", short: "MRI Lumbar Spine", modality: "MR", region: "lspine", madeUp: true, technique: "Sagittal and axial MRI of the lumbar spine." },
  { code: "UABDO", display: "US abdomen", short: "Abdomen Ultrasound", modality: "US", region: "abdomen", madeUp: true, technique: "Real-time ultrasound of the abdomen." },
  { code: "UPELV", display: "US pelvis", short: "Pelvis Ultrasound", modality: "US", region: "pelvis", madeUp: true, technique: "Transabdominal ultrasound of the pelvis." },
  { code: "MBILA", display: "Mammography bilateral", short: "Mammogram", modality: "MG", region: "breast", madeUp: true, technique: "Bilateral two-view mammography." },
  { code: "DBMDW", display: "Bone density (DEXA)", short: "Bone Density", modality: "BMD", region: "whole", madeUp: true, technique: "Dual-energy X-ray absorptiometry of the lumbar spine and hip." },
];

const BY_CODE = new Map(RAD_CATALOG.map((p) => [p.code, p]));
export const procByCode = (code: string): RadProcedure | undefined => BY_CODE.get(code);

export const QUICK_RAD: { id: string; label: string; code: string }[] = [
  { id: "cxr", label: "Chest X-Ray", code: "XCHPA" },
  { id: "ctab", label: "CT Abdomen And Pelvis", code: "CTABP" },
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
