/**
 * A small built-in dictionary for code suggestions. These are suggestions only.
 * A coder must confirm every code against the official ICD-10-AM and SNOMED CT releases.
 */

export interface CodeEntry {
  keys: string[];
  text: string;
  icd: string;
  snomed: string;
}

export const CODE_DICTIONARY: CodeEntry[] = [
  { keys: ["fever", "pyrexia", "high temperature"], text: "Fever, unspecified", icd: "R50.9", snomed: "386661006" },
  { keys: ["cough"], text: "Cough", icd: "R05", snomed: "49727002" },
  { keys: ["chest pain"], text: "Chest pain, unspecified", icd: "R07.4", snomed: "29857009" },
  { keys: ["headache"], text: "Headache", icd: "R51", snomed: "25064002" },
  { keys: ["abdominal pain", "stomach pain", "tummy pain"], text: "Abdominal pain, unspecified", icd: "R10.4", snomed: "21522001" },
  { keys: ["shortness of breath", "breathless", "dyspnea", "dyspnoea"], text: "Dyspnoea", icd: "R06.0", snomed: "267036007" },
  { keys: ["vomiting"], text: "Vomiting", icd: "R11", snomed: "422400008" },
  { keys: ["nausea"], text: "Nausea", icd: "R11.0", snomed: "422587007" },
  { keys: ["diarrhea", "diarrhoea", "loose stool"], text: "Diarrhoea", icd: "R19.7", snomed: "62315008" },
  { keys: ["dizzy", "dizziness"], text: "Dizziness", icd: "R42", snomed: "404640003" },
  { keys: ["palpitation"], text: "Palpitations", icd: "R00.2", snomed: "80313002" },
  { keys: ["fatigue", "tired"], text: "Fatigue", icd: "R53", snomed: "84229001" },
  { keys: ["rash"], text: "Rash", icd: "R21", snomed: "271807003" },
  { keys: ["back pain"], text: "Low back pain", icd: "M54.5", snomed: "161891005" },
  { keys: ["joint pain", "arthralgia"], text: "Joint pain", icd: "M25.50", snomed: "57676002" },
  { keys: ["knee pain"], text: "Pain in knee", icd: "M25.56", snomed: "30989003" },
  { keys: ["sore throat", "pharyngitis"], text: "Acute pharyngitis, unspecified", icd: "J02.9", snomed: "405737000" },
  { keys: ["tonsillitis"], text: "Acute tonsillitis, unspecified", icd: "J03.9", snomed: "90176007" },
  { keys: ["upper respiratory", "common cold", "runny nose"], text: "Acute upper respiratory infection, unspecified", icd: "J06.9", snomed: "54150009" },
  { keys: ["pneumonia"], text: "Pneumonia, unspecified organism", icd: "J18.9", snomed: "233604007" },
  { keys: ["asthma", "wheeze", "wheezing"], text: "Asthma, unspecified", icd: "J45.9", snomed: "195967001" },
  { keys: ["copd", "chronic obstructive"], text: "Chronic obstructive pulmonary disease, unspecified", icd: "J44.9", snomed: "13645005" },
  { keys: ["urinary tract infection", "uti", "burning urine", "dysuria"], text: "Urinary tract infection, site not specified", icd: "N39.0", snomed: "68566005" },
  { keys: ["hypertension", "high blood pressure"], text: "Essential (primary) hypertension", icd: "I10", snomed: "38341003" },
  { keys: ["diabetes", "high blood sugar", "hyperglycemia", "hyperglycaemia"], text: "Type 2 diabetes mellitus without complications", icd: "E11.9", snomed: "44054006" },
  { keys: ["cholesterol", "hyperlipidemia", "hyperlipidaemia"], text: "Hyperlipidaemia, unspecified", icd: "E78.5", snomed: "55822004" },
  { keys: ["myocardial infarction", "heart attack"], text: "Acute myocardial infarction, unspecified", icd: "I21.9", snomed: "22298006" },
  { keys: ["heart failure"], text: "Heart failure, unspecified", icd: "I50.9", snomed: "84114007" },
  { keys: ["stroke"], text: "Stroke, not specified as haemorrhage or infarction", icd: "I64", snomed: "230690007" },
  { keys: ["appendicitis"], text: "Acute appendicitis, unspecified", icd: "K35.80", snomed: "74400008" },
  { keys: ["gastroenteritis"], text: "Gastroenteritis and colitis of unspecified origin", icd: "A09", snomed: "25374005" },
  { keys: ["dehydration"], text: "Dehydration", icd: "E86", snomed: "34095006" },
  { keys: ["anemia", "anaemia"], text: "Anaemia, unspecified", icd: "D64.9", snomed: "271737000" },
  { keys: ["sepsis"], text: "Sepsis, unspecified", icd: "A41.9", snomed: "91302008" },
  { keys: ["migraine"], text: "Migraine, unspecified", icd: "G43.9", snomed: "37796009" },
  { keys: ["ear infection", "otitis"], text: "Otitis media, unspecified", icd: "H66.9", snomed: "65363002" },
  { keys: ["conjunctivitis", "red eye"], text: "Conjunctivitis, unspecified", icd: "H10.9", snomed: "9826008" },
  { keys: ["ankle sprain", "sprained ankle"], text: "Sprain of ankle", icd: "S93.4", snomed: "44465007" },
  { keys: ["anxiety"], text: "Anxiety disorder, unspecified", icd: "F41.9", snomed: "48694002" },
  { keys: ["depression"], text: "Depressive episode, unspecified", icd: "F32.9", snomed: "35489007" },
  { keys: ["hip pain", "neck of femur", "hip fracture"], text: "Fracture of neck of femur (check the exact site code)", icd: "S72.0", snomed: "5913000" },
];

export interface CodeSuggestion extends CodeEntry {
  /** The words in the chart that matched. */
  matched: string;
  /** Where the words were found. */
  from: string;
}

export interface TextSource {
  from: string;
  text: string;
}

/** Looks for dictionary words in the given texts. One suggestion per dictionary row. */
export function suggestCodes(sources: TextSource[]): CodeSuggestion[] {
  const out: CodeSuggestion[] = [];
  for (const row of CODE_DICTIONARY) {
    for (const s of sources) {
      const t = s.text.toLowerCase();
      const hit = row.keys.find((k) => new RegExp(`(^|[^a-z])${k.replace(/ /g, "\\s+")}`).test(t));
      if (hit) {
        out.push({ ...row, matched: hit, from: s.from });
        break;
      }
    }
  }
  return out;
}
