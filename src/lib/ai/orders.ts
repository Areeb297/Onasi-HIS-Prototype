/** Order suggestions for a complaint. Plain test names. The clinician decides and orders from the Laboratory and Radiology tabs. */

export interface OrderSet {
  keys: string[];
  label: string;
  labs: string[];
  imaging: string[];
  note?: string;
}

export const ORDER_SETS: OrderSet[] = [
  { keys: ["fever", "pyrexia", "infection"], label: "Fever", labs: ["Complete blood count", "C-reactive protein", "Urinalysis", "Blood cultures if the patient looks unwell"], imaging: ["Chest X-ray if there is a cough or breathing problem"] },
  { keys: ["chest pain", "angina"], label: "Chest pain", labs: ["Troponin (repeat as per protocol)", "Complete blood count", "Renal profile", "Lipid profile"], imaging: ["Chest X-ray"], note: "A 12-lead ECG is also needed. It is not a lab or imaging order." },
  { keys: ["shortness of breath", "dyspnea", "dyspnoea", "breathless"], label: "Shortness of breath", labs: ["Complete blood count", "Renal profile", "D-dimer if a clot is suspected", "BNP if heart failure is suspected"], imaging: ["Chest X-ray"] },
  { keys: ["cough"], label: "Cough", labs: ["Complete blood count", "C-reactive protein"], imaging: ["Chest X-ray if it lasts more than 3 weeks or there is fever"] },
  { keys: ["abdominal pain", "stomach pain", "appendic"], label: "Abdominal pain", labs: ["Complete blood count", "C-reactive protein", "Liver profile", "Lipase", "Urinalysis", "Pregnancy test if a woman of child-bearing age"], imaging: ["Ultrasound of the abdomen", "CT of the abdomen if the diagnosis is unclear"] },
  { keys: ["headache", "migraine"], label: "Headache", labs: ["Complete blood count if fever", "C-reactive protein if fever"], imaging: ["CT of the head if there are red flags (sudden severe onset, weakness, confusion, head injury)"] },
  { keys: ["diabetes", "blood sugar", "glucose"], label: "High blood sugar", labs: ["Random blood glucose", "HbA1c", "Renal profile", "Electrolytes", "Urinalysis for ketones"], imaging: [] },
  { keys: ["hypertension", "blood pressure"], label: "High blood pressure", labs: ["Renal profile", "Electrolytes", "Lipid profile", "Fasting glucose", "Urinalysis"], imaging: [], note: "An ECG is also usual." },
  { keys: ["back pain"], label: "Back pain", labs: ["Complete blood count and C-reactive protein if fever or weight loss"], imaging: ["X-ray of the lumbar spine if there was injury", "MRI only if there are nerve signs"] },
  { keys: ["hip", "fracture", "fall", "trauma"], label: "Injury or fracture", labs: ["Complete blood count", "Blood group and cross match before surgery", "Renal profile"], imaging: ["X-ray of the injured area"] },
  { keys: ["urinary", "dysuria", "uti"], label: "Urinary symptoms", labs: ["Urinalysis", "Urine culture"], imaging: [] },
  { keys: ["vomiting", "diarrhea", "diarrhoea", "gastroenteritis"], label: "Vomiting or diarrhoea", labs: ["Renal profile and electrolytes if dehydrated", "Stool test if it lasts more than 5 days or there is blood"], imaging: [] },
];

export function suggestOrders(text: string): OrderSet[] {
  const t = text.toLowerCase();
  return ORDER_SETS.filter((s) => s.keys.some((k) => t.includes(k)));
}
