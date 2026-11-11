/**
 * Value sets published in the NPHIES-CS Integration Guide (Confluence, space NPHIES).
 * Generated from the live pages on 2026-11-11. Each constant names its page id. Do not edit codes by hand:
 * re-fetch the page and regenerate. Used by the message builders and the validators.
 */

export interface VsEntry { code: string; label: string }

/** CS-Adm-PatientClass, page id 23134851. 12 codes. */
export const VS_PATIENT_CLASS: VsEntry[] = [
  { code: "E", label: "Emergency" }, { code: "I", label: "Inpatient" }, { code: "O", label: "Outpatient" }, { code: "D", label: "Inpatient Daycase" },
  { code: "VR", label: "Virtual" }, { code: "HH", label: "Home health" }, { code: "L", label: "Non-admitted- Long term" }, { code: "P", label: "Outpatient- Primary Care" },
  { code: "R", label: "Outpatient- Rehabilitation (specialized standalone centers)" }, { code: "M", label: "Outpatient- Mental (specialized standalone centers)" },
  { code: "S", label: "Dialysis (specialized standalone centers)" }, { code: "T", label: "Dental (specialized standalone centers)" },
];

/** CS-Adm-AdmissionMethod, page id 528809996. 19 codes. */
export const VS_ADMISSION_METHOD: VsEntry[] = [
  { code: "01", label: "Immediate Admission" }, { code: "02", label: "Emergency Admission from hospital ER" },
  { code: "03", label: "Emergency Admission from hospital outpatient" }, { code: "04", label: "Emergency Admission by referral from government primary Health Care center" },
  { code: "05", label: "Emergency Admission by referral from general government hospital" },
  { code: "06", label: "Emergency Admission by referral from private primary Healthcare center" }, { code: "07", label: "Emergency Admission by referral from private hospital" },
  { code: "08", label: "Emergency Admission by insurance company" }, { code: "09", label: "Elective waiting list admission government free Scheme" },
  { code: "10", label: "Elective waiting list admission self-payment Scheme" }, { code: "11", label: "Elective waiting list admission insurance coverage Scheme" },
  { code: "12", label: "Emergency Maternity Birth Admission" }, { code: "13", label: "Planned Maternity Birth Admission" }, { code: "14", label: "Elective, Other" },
  { code: "15", label: "Emergency, Other" }, { code: "88", label: "Others" }, { code: "99", label: "Unknown" }, { code: "N", label: "Newborn (Birth in healthcare facility)" },
  { code: "R", label: "Routine" },
];

/** CS-Adm-AdmitSource, page id 23233363. 10 codes. */
export const VS_ADMIT_SOURCE: VsEntry[] = [
  { code: "P", label: "Patient/Self/Walk-in" }, { code: "1", label: "Physician referral" }, { code: "2", label: "Clinic referral" }, { code: "3", label: "HMO referral" },
  { code: "4", label: "Transfer from a hospital" }, { code: "5", label: "Transfer from a skilled nursing facility" },
  { code: "6", label: "Transfer from another healthcare facility" }, { code: "7", label: "Emergency room" }, { code: "8", label: "Court/law enforcement" },
  { code: "9", label: "Information not available" },
];

/** CS-Adm-DischargeDisposition, page id 23200505. 28 codes. */
export const VS_DISCHARGE_DISPOSITION: VsEntry[] = [
  { code: "225928004", label: "patient self-discharge against medical advice" }, { code: "306689006", label: "discharge to home (procedure)" },
  { code: "306698009", label: "discharge to warden controlled accommodation (procedure)" }, { code: "306699001", label: "discharge to hospital (procedure)" },
  { code: "306706006", label: "discharge to ward (procedure)" }, { code: "405807003", label: "discharge to convalescence (procedure)" },
  { code: "710951009", label: "Arranging transportation of device" }, { code: "306707002", label: "Discharge to day ward" },
  { code: "306705005", label: "Discharge to police custody" }, { code: "306703003", label: "Discharge to tertiary referral hospital" },
  { code: "306700000", label: "Discharge to long stay hospital" }, { code: "306691003", label: "Discharge to residential home" },
  { code: "306690002", label: "Discharge to relative's home" }, { code: "306685000", label: "Discharge to establishment" },
  { code: "86400002", label: "Patient discharge, to home, ambulatory" }, { code: "65537008", label: "Patient discharge, to home, routine" },
  { code: "50861005", label: "Patient discharge, to legal custody" }, { code: "10161009", label: "Patient discharge, to home, with assistance" },
  { code: "20541009", label: "Patient on pass" }, { code: "1258989004", label: "Patient disciplinary discharge" }, { code: "34596002", label: "Patient discharge, elopement" },
  { code: "1917008", label: "Patient discharge, deceased, medicolegal case" }, { code: "3133002", label: "Patient discharge, deceased, autopsy" },
  { code: "41819004", label: "Patient discharge, deceased, donation of body" }, { code: "79779006", label: "Patient discharge, deceased, no autopsy" },
  { code: "89334003", label: "Patient discharge, deceased, to anatomic board" }, { code: "12616003", label: "Patient discharge, escaped from custody" },
  { code: "183955003", label: "Patient self-discharge" },
];

/** CS-Adm-EDArrivalMode, page id 526909458. 13 codes. */
export const VS_ED_ARRIVAL_MODE: VsEntry[] = [
  { code: "1", label: "Ground EMS Ambulance" }, { code: "2", label: "Ground MOH Ambulance" }, { code: "3", label: "Ground Civil Defense Ambulance" },
  { code: "4", label: "Ground Military Ambulance" }, { code: "5", label: "Ground Private Ambulance" }, { code: "6", label: "EMS Air Ambulance" },
  { code: "7", label: "Air Civil Defense Ambulance" }, { code: "8", label: "Air Military Ambulance" }, { code: "9", label: "Police Vehicle" },
  { code: "10", label: "Other Government Vehicles" }, { code: "11", label: "Personal Vehicle" }, { code: "88", label: "Other" }, { code: "99", label: "Not stated / Unknown" },
];

/** CS-Adm-EDDisposition, page id 527335436. 6 codes. */
export const VS_ED_DISPOSITION: VsEntry[] = [
  { code: "1", label: "Patient admitted to hospital" }, { code: "2", label: "Treatment episode complete and patient discharged" },
  { code: "3", label: "Patient did not wait to be seen" }, { code: "4", label: "Patient was dead on arrival" }, { code: "5", label: "Patient transferred to another hospital" },
  { code: "6", label: "Patient died in ER" },
];

/** CS-Adm-TriageCategory, page id 529137666. 5 codes. */
export const VS_TRIAGE_CATEGORY: VsEntry[] = [
  { code: "1", label: "Immediate resuscitation" }, { code: "2", label: "Very Urgent" }, { code: "3", label: "Urgent" }, { code: "4", label: "Standard ER" },
  { code: "5", label: "Non-Urgent" },
];

/** CS-Adm-Gender, page id 23233690. 8 codes. */
export const VS_GENDER: VsEntry[] = [
  { code: "M", label: "Male" }, { code: "F", label: "Female" }, { code: "N", label: "Undifferentiated" }, { code: "U", label: "Undetermined" },
  { code: "C", label: "Not Completed" }, { code: "A", label: "Sex changed to Male" }, { code: "B", label: "Sex changed to female" }, { code: "K", label: "Unknown" },
];

/** CS-Adm-MaritalStatus, page id 23200982. 6 codes. */
export const VS_MARITAL_STATUS: VsEntry[] = [
  { code: "D", label: "Divorced" }, { code: "M", label: "Married" }, { code: "S", label: "Single" }, { code: "W", label: "Widowed" }, { code: "A", label: "Seperated" },
  { code: "U", label: "Uknown" },
];

/** CS-Allergy-Type, page id 26476765. 3 codes. */
export const VS_ALLERGY_TYPE: VsEntry[] = [
  { code: "DALG", label: "Drug Allergy" }, { code: "FALG", label: "Food Allergy" }, { code: "ALG", label: "Allergy (other than drug or food)" },
];

/** CS-Allergy-Severity, page id 23233389. 4 codes. */
export const VS_ALLERGY_SEVERITY: VsEntry[] = [
  { code: "SV", label: "Severe" }, { code: "MO", label: "Moderate" }, { code: "MI", label: "Mild" }, { code: "U", label: "Unknown" },
];

/** CS-Adm-Country, page id 528875547. 250 codes. */
export const VS_COUNTRY: VsEntry[] = [
  { code: "AFG", label: "Afghanistan" }, { code: "ALB", label: "Albania" }, { code: "DZA", label: "Algeria" }, { code: "ASM", label: "American Samoa" },
  { code: "AND", label: "Andorra" }, { code: "AGO", label: "Angola" }, { code: "AIA", label: "Anguilla" }, { code: "ATA", label: "Antarctica" },
  { code: "ATG", label: "Antigua and Barbuda" }, { code: "ARG", label: "Argentina" }, { code: "ARM", label: "Armenia" }, { code: "ABW", label: "Aruba" },
  { code: "AUS", label: "Australia" }, { code: "AUT", label: "Austria" }, { code: "AZE", label: "Azerbaijan" }, { code: "BHS", label: "Bahamas (the)" },
  { code: "BHR", label: "Bahrain" }, { code: "BGD", label: "Bangladesh" }, { code: "BRB", label: "Barbados" }, { code: "BLR", label: "Belarus" },
  { code: "BEL", label: "Belgium" }, { code: "BLZ", label: "Belize" }, { code: "BEN", label: "Benin" }, { code: "BMU", label: "Bermuda" }, { code: "ALA", label: "Åland Islands" },
  { code: "BTN", label: "Bhutan" }, { code: "BOL", label: "Bolivia (Plurinational State of)" }, { code: "BES", label: "Bonaire, Sint Eustatius and Saba" },
  { code: "BIH", label: "Bosnia and Herzegovina" }, { code: "BWA", label: "Botswana" }, { code: "BVT", label: "Bouvet Island" }, { code: "BRA", label: "Brazil" },
  { code: "IOT", label: "British Indian Ocean Territory (the)" }, { code: "BRN", label: "Brunei Darussalam" }, { code: "BGR", label: "Bulgaria" },
  { code: "BFA", label: "Burkina Faso" }, { code: "BDI", label: "Burundi" }, { code: "CPV", label: "Cabo Verde" }, { code: "KHM", label: "Cambodia" },
  { code: "CMR", label: "Cameroon" }, { code: "CAN", label: "Canada" }, { code: "CYM", label: "Cayman Islands (the)" }, { code: "CAF", label: "Central African Republic (the)" },
  { code: "TCD", label: "Chad" }, { code: "CHL", label: "Chile" }, { code: "CHN", label: "China" }, { code: "CXR", label: "Christmas Island" },
  { code: "CCK", label: "Cocos (Keeling) Islands (the)" }, { code: "COL", label: "Colombia" }, { code: "COM", label: "Comoros (the)" },
  { code: "COD", label: "Congo (the Democratic Republic of the)" }, { code: "COG", label: "Congo (the)" }, { code: "COK", label: "Cook Islands (the)" },
  { code: "CRI", label: "Costa Rica" }, { code: "HRV", label: "Croatia" }, { code: "CUB", label: "Cuba" }, { code: "CUW", label: "Curaçao" }, { code: "CYP", label: "Cyprus" },
  { code: "CZE", label: "Czechia" }, { code: "CIV", label: "Côte d'Ivoire" }, { code: "DNK", label: "Denmark" }, { code: "DJI", label: "Djibouti" },
  { code: "DMA", label: "Dominica" }, { code: "DOM", label: "Dominican Republic (the)" }, { code: "ECU", label: "Ecuador" }, { code: "EGY", label: "Egypt" },
  { code: "SLV", label: "El Salvador" }, { code: "GNQ", label: "Equatorial Guinea" }, { code: "ERI", label: "Eritrea" }, { code: "EST", label: "Estonia" },
  { code: "SWZ", label: "Eswatini" }, { code: "ETH", label: "Ethiopia" }, { code: "FLK", label: "Falkland Islands (the) [Malvinas]" },
  { code: "FRO", label: "Faroe Islands (the)" }, { code: "FJI", label: "Fiji" }, { code: "FIN", label: "Finland" }, { code: "FRA", label: "France" },
  { code: "GUF", label: "French Guiana" }, { code: "PYF", label: "French Polynesia" }, { code: "ATF", label: "French Southern Territories (the)" },
  { code: "GAB", label: "Gabon" }, { code: "GMB", label: "Gambia (the)" }, { code: "GEO", label: "Georgia" }, { code: "DEU", label: "Germany" }, { code: "GHA", label: "Ghana" },
  { code: "GIB", label: "Gibraltar" }, { code: "GRC", label: "Greece" }, { code: "GRL", label: "Greenland" }, { code: "GRD", label: "Grenada" },
  { code: "GLP", label: "Guadeloupe" }, { code: "GUM", label: "Guam" }, { code: "GTM", label: "Guatemala" }, { code: "GGY", label: "Guernsey" }, { code: "GIN", label: "Guinea" },
  { code: "GNB", label: "Guinea-Bissau" }, { code: "GUY", label: "Guyana" }, { code: "HTI", label: "Haiti" }, { code: "HMD", label: "Heard Island and McDonald Islands" },
  { code: "VAT", label: "Holy See (the)" }, { code: "HND", label: "Honduras" }, { code: "HKG", label: "Hong Kong" }, { code: "HUN", label: "Hungary" },
  { code: "ISL", label: "Iceland" }, { code: "IND", label: "India" }, { code: "IDN", label: "Indonesia" }, { code: "IRN", label: "Iran (Islamic Republic of)" },
  { code: "IRQ", label: "Iraq" }, { code: "IRL", label: "Ireland" }, { code: "IMN", label: "Isle of Man" }, { code: "ISR", label: "Israel" }, { code: "ITA", label: "Italy" },
  { code: "JAM", label: "Jamaica" }, { code: "JPN", label: "Japan" }, { code: "JEY", label: "Jersey" }, { code: "JOR", label: "Jordan" }, { code: "KAZ", label: "Kazakhstan" },
  { code: "KEN", label: "Kenya" }, { code: "KIR", label: "Kiribati" }, { code: "PRK", label: "Korea (the Democratic People's Republic of)" },
  { code: "KOR", label: "Korea (the Republic of)" }, { code: "KWT", label: "Kuwait" }, { code: "KGZ", label: "Kyrgyzstan" },
  { code: "LAO", label: "Lao People's Democratic Republic (the)" }, { code: "LVA", label: "Latvia" }, { code: "LBN", label: "Lebanon" }, { code: "LSO", label: "Lesotho" },
  { code: "LBR", label: "Liberia" }, { code: "LBY", label: "Libya" }, { code: "LIE", label: "Liechtenstein" }, { code: "LTU", label: "Lithuania" },
  { code: "LUX", label: "Luxembourg" }, { code: "MAC", label: "Macao" }, { code: "MDG", label: "Madagascar" }, { code: "MWI", label: "Malawi" },
  { code: "MYS", label: "Malaysia" }, { code: "MDV", label: "Maldives" }, { code: "MLI", label: "Mali" }, { code: "MLT", label: "Malta" },
  { code: "MHL", label: "Marshall Islands (the)" }, { code: "MTQ", label: "Martinique" }, { code: "MRT", label: "Mauritania" }, { code: "MUS", label: "Mauritius" },
  { code: "MYT", label: "Mayotte" }, { code: "MEX", label: "Mexico" }, { code: "FSM", label: "Micronesia (Federated States of)" },
  { code: "MDA", label: "Moldova (the Republic of)" }, { code: "MCO", label: "Monaco" }, { code: "MNG", label: "Mongolia" }, { code: "MNE", label: "Montenegro" },
  { code: "MSR", label: "Montserrat" }, { code: "MAR", label: "Morocco" }, { code: "MOZ", label: "Mozambique" }, { code: "MMR", label: "Myanmar" },
  { code: "NAM", label: "Namibia" }, { code: "NRU", label: "Nauru" }, { code: "NPL", label: "Nepal" }, { code: "NLD", label: "Netherlands (the)" },
  { code: "NCL", label: "New Caledonia" }, { code: "NZL", label: "New Zealand" }, { code: "NIC", label: "Nicaragua" }, { code: "NER", label: "Niger (the)" },
  { code: "NGA", label: "Nigeria" }, { code: "NIU", label: "Niue" }, { code: "NFK", label: "Norfolk Island" }, { code: "MKD", label: "North Macedonia" },
  { code: "MNP", label: "Northern Mariana Islands (the)" }, { code: "NOR", label: "Norway" }, { code: "OMN", label: "Oman" }, { code: "PAK", label: "Pakistan" },
  { code: "PLW", label: "Palau" }, { code: "PSE", label: "Palestine, State of" }, { code: "PAN", label: "Panama" }, { code: "PNG", label: "Papua New Guinea" },
  { code: "PRY", label: "Paraguay" }, { code: "PER", label: "Peru" }, { code: "PHL", label: "Philippines (the)" }, { code: "PCN", label: "Pitcairn" },
  { code: "POL", label: "Poland" }, { code: "PRT", label: "Portugal" }, { code: "PRI", label: "Puerto Rico" }, { code: "QAT", label: "Qatar" }, { code: "ROU", label: "Romania" },
  { code: "RUS", label: "Russian Federation (the)" }, { code: "RWA", label: "Rwanda" }, { code: "REU", label: "Réunion" }, { code: "BLM", label: "Saint Barthélemy" },
  { code: "SHN", label: "Saint Helena, Ascension and Tristan da Cunha" }, { code: "KNA", label: "Saint Kitts and Nevis" }, { code: "LCA", label: "Saint Lucia" },
  { code: "MAF", label: "Saint Martin (French part)" }, { code: "SPM", label: "Saint Pierre and Miquelon" }, { code: "VCT", label: "Saint Vincent and the Grenadines" },
  { code: "WSM", label: "Samoa" }, { code: "SMR", label: "San Marino" }, { code: "STP", label: "Sao Tome and Principe" }, { code: "SAU", label: "Saudi Arabia" },
  { code: "SEN", label: "Senegal" }, { code: "SRB", label: "Serbia" }, { code: "SYC", label: "Seychelles" }, { code: "SLE", label: "Sierra Leone" },
  { code: "SGP", label: "Singapore" }, { code: "SXM", label: "Sint Maarten (Dutch part)" }, { code: "SVK", label: "Slovakia" }, { code: "SVN", label: "Slovenia" },
  { code: "SLB", label: "Solomon Islands" }, { code: "SOM", label: "Somalia" }, { code: "ZAF", label: "South Africa" },
  { code: "SGS", label: "South Georgia and the South Sandwich Islands" }, { code: "SSD", label: "South Sudan" }, { code: "ESP", label: "Spain" },
  { code: "LKA", label: "Sri Lanka" }, { code: "SDN", label: "Sudan (the)" }, { code: "SUR", label: "Suriname" }, { code: "SJM", label: "Svalbard and Jan Mayen" },
  { code: "SWE", label: "Sweden" }, { code: "CHE", label: "Switzerland" }, { code: "SYR", label: "Syrian Arab Republic (the)" },
  { code: "TWN", label: "Taiwan (Province of China)" }, { code: "TJK", label: "Tajikistan" }, { code: "TZA", label: "Tanzania, the United Republic of" },
  { code: "THA", label: "Thailand" }, { code: "TLS", label: "Timor-Leste" }, { code: "TGO", label: "Togo" }, { code: "TKL", label: "Tokelau" }, { code: "TON", label: "Tonga" },
  { code: "TTO", label: "Trinidad and Tobago" }, { code: "TUN", label: "Tunisia" }, { code: "TKM", label: "Turkmenistan" },
  { code: "TCA", label: "Turks and Caicos Islands (the)" }, { code: "TUV", label: "Tuvalu" }, { code: "TUR", label: "Türkiye" }, { code: "UGA", label: "Uganda" },
  { code: "UKR", label: "Ukraine" }, { code: "ARE", label: "United Arab Emirates (the)" }, { code: "GBR", label: "United Kingdom of Great Britain and Northern Ireland (the)" },
  { code: "UMI", label: "United States Minor Outlying Islands (the)" }, { code: "USA", label: "United States of America (the)" }, { code: "URY", label: "Uruguay" },
  { code: "UZB", label: "Uzbekistan" }, { code: "VUT", label: "Vanuatu" }, { code: "VEN", label: "Venezuela (Bolivarian Republic of)" }, { code: "VNM", label: "Viet Nam" },
  { code: "VGB", label: "Virgin Islands (British)" }, { code: "VIR", label: "Virgin Islands (U.S.)" }, { code: "WLF", label: "Wallis and Futuna" },
  { code: "ESH", label: "Western Sahara*" }, { code: "YEM", label: "Yemen" }, { code: "ZMB", label: "Zambia" }, { code: "ZWE", label: "Zimbabwe" },
  { code: "999", label: "Unknown" },
];

/** CS-Adm-MedicalUnitIdentifier, page id 23200557. 368 codes. */
export const VS_MEDICAL_UNIT: VsEntry[] = [
  { code: "MA", label: "Anesthesiology & Operating Rooms" }, { code: "MA1", label: "Anesthesia Department" }, { code: "MA1.1", label: "Cardiac Anesthesia Section" },
  { code: "MA1.2", label: "General Anesthesia Section" }, { code: "MA1.3", label: "Neuro - Anesthesia Section" }, { code: "MA1.4", label: "Obstetrics Anesthesia Section" },
  { code: "MA1.5", label: "Pain Management Section" }, { code: "MA1.6", label: "Pediatrics Anesthesia Section" }, { code: "MA1.7", label: "Transplant Anesthesia Department" },
  { code: "MA2", label: "Operating Room Department" }, { code: "MA2.01", label: "Cardiac Operation Unit" }, { code: "MA2.02", label: "Main Operation Unit" },
  { code: "MA2.03", label: "Obstetrics Gynecology Operation Unit" }, { code: "MA2.04", label: "Pediatrics Operation Unit" },
  { code: "MA3", label: "Central Sterilization Services Department" }, { code: "MB", label: "Cardiac Surgery & Cardiology" }, { code: "MB1", label: "Cardiac Surgery Department" },
  { code: "MB1.1", label: "Adult Cardiac Surgery Department" }, { code: "MB1.2", label: "Pediatric Cardiac Surgery Department" }, { code: "MB2", label: "Cardiology Department" },
  { code: "MB2.1", label: "Adult Cardiology Department" }, { code: "MB2.2", label: "Cardiac Imaging Section" }, { code: "MB2.3", label: "Catheterization Laboratory" },
  { code: "MB2.4", label: "Non-Invasive Laboratory" }, { code: "MB2.5", label: "Pediatric Cardiology Department" }, { code: "MC", label: "Clinical Nutrition" },
  { code: "MC1.1", label: "Clinical Nutrition Adult Department" }, { code: "MC1.2", label: "Clinical Nutrition Outpatient Department" },
  { code: "MC1.3", label: "Clinical Nutrition Pediatric Department" }, { code: "MC1.4", label: "Clinical Nutrition Dietetic Section" },
  { code: "MD", label: "Dentistry Department" }, { code: "MD1.1", label: "Endodontics" }, { code: "MD1.2", label: "General Dentistry" },
  { code: "MD1.3", label: "Oral Maxillofacial Surgery" }, { code: "MD1.4", label: "Orthodontics" }, { code: "MD1.5", label: "Pediatric Dentistry" },
  { code: "MD1.6", label: "Periodontics" }, { code: "MD1.7", label: "Prosthodontics" }, { code: "MD1.8", label: "Restorative Dentistry" },
  { code: "MD1.9", label: "Dental Screening Clinic" }, { code: "ME", label: "Emergency Medicine" }, { code: "ME1.1", label: "Adult Emergency Department" },
  { code: "ME1.2", label: "Disaster Management Department" }, { code: "ME1.3", label: "EMS Department" }, { code: "ME1.4", label: "Pediatric Emergency Department" },
  { code: "ME1.5", label: "Poison Control Department" }, { code: "MF", label: "Family Medicine and Employee Health Department" },
  { code: "MF1.1", label: "Employees Clinics Section" }, { code: "MF1.2", label: "Family Medicine Clinics Section" }, { code: "MF1.3", label: "Family Medicine Screening Clinic" },
  { code: "MG", label: "Home Health Care" }, { code: "MG1.1", label: "Home Care Allied Health Department" }, { code: "MG1.2", label: "Home Care Nursing Department" },
  { code: "MG1.3", label: "Home Care Respiratory Department" }, { code: "MG1.4", label: "Home Care Support Services Department" },
  { code: "MG1.5", label: "Home Durable Medical Equipment" }, { code: "MH", label: "Infection Control & Environmental Health" },
  { code: "MH1.1", label: "Infection Control Department" }, { code: "MH1.2", label: "Hospital Epidemiology Department" },
  { code: "MH1.3", label: "Environmental Health Department" }, { code: "MI", label: "Intensive Care Department" }, { code: "MI1.1", label: "Cardiac Intensive Care Unit" },
  { code: "MI1.2", label: "Neonatal Intensive Care" }, { code: "MI1.3", label: "Neocritical Care Department" }, { code: "MI1.4", label: "Pediatric Intensive Care" },
  { code: "MI1.5", label: "Step Down Intensive Care" }, { code: "MI1.6", label: "Surgical Intensive Care" }, { code: "MJ", label: "Obstetrics & Gynecology Department" },
  { code: "MJ1", label: "Gyn-Oncology Department" }, { code: "MJ1.1", label: "Maternal Fetal Medicine Department" },
  { code: "MJ1.2", label: "Obstetrics and Gynecology Department" }, { code: "MJ1.3", label: "Reproductive Endocrine & InfertilityMedicine Department" },
  { code: "MJ1.4", label: "Urogynecology Department" }, { code: "MJ1.5", label: "Obstetrics & Gynecology Screening Clinic" },
  { code: "MJ1.6", label: "Gynecology Oncology Diagonistic Clinic" }, { code: "MJ1.7", label: "Early Detection of Gynecology Oncology Clinic" },
  { code: "MJ1.8", label: "High-risk Pregnancy Clinic" }, { code: "MJ1.9", label: "Pregnant control Clinic" }, { code: "MJ1.10", label: "Family Planning Clinic" },
  { code: "MJ1.11", label: "Gestational Diabetes Clinic" }, { code: "MK", label: "Medical Imaging" }, { code: "MK1", label: "Body Imaging Department" },
  { code: "MK1.1", label: "Abdominal Radiology Section" }, { code: "MK1.2", label: "Cardiothoracic Radiology Section" },
  { code: "MK1.3", label: "General Radiology Technical Section" }, { code: "MK1.4", label: "CT Imaging Technical Section" },
  { code: "MK1.5", label: "Musculoskeletal Radiology Section" }, { code: "MK1.6", label: "MR Imaging Technical Section" }, { code: "MK1.7", label: "Ultrasound Section" },
  { code: "MK2", label: "Body Interventional Radiology" }, { code: "Mk2.1", label: "Interventional Radiology Procedures" },
  { code: "Mk2.2", label: "Interventional Vascular Radiology Section" }, { code: "MK3", label: "Neuro - Imaging and Intervention" },
  { code: "MK3.1", label: "Intervention Neuroradiology Section" }, { code: "MK3.2", label: "Neuroradiology Diagnostic Section" },
  { code: "MK4", label: "Nuclear Medicine Department" }, { code: "MK4.1", label: "Nuclear Medicine Diagnostic Section" },
  { code: "MK4.2", label: "Nuclear Medicine Treatment Section" }, { code: "MK5", label: "Pediatric Radiology Department" }, { code: "MK6", label: "Women's Imaging Department" },
  { code: "MK6.1", label: "Mammography Section" }, { code: "MK6.2", label: "Pregnancy Ultrasound Section" }, { code: "ML", label: "Medical Specialties Department" },
  { code: "ML1.1", label: "Dermatology Section" }, { code: "ML1.2", label: "Endocrinology Section" }, { code: "ML1.3", label: "Gastroenterology Hepatology Section" },
  { code: "ML1.4", label: "General Medicine Section" }, { code: "ML1.5", label: "Geriatric Medicine" }, { code: "ML1.6", label: "Infectious Diseases Section" },
  { code: "ML1.7", label: "Nephrology Section" }, { code: "ML1.8", label: "Neurology Section" }, { code: "ML1.9", label: "Neurophysiology Section" },
  { code: "ML1.10", label: "Pulmonology Section" }, { code: "ML1.11", label: "Rheumatology Section" }, { code: "MM", label: "Mental Health" },
  { code: "MM1.1", label: "Addiction Department" }, { code: "MM1.2", label: "Mental Health Department" }, { code: "MM1.3", label: "Rehabilitation Department" },
  { code: "MN", label: "Oncology Department" }, { code: "MN1.1", label: "Adult Hematology & Bone Marrow Transplant" }, { code: "MN1.2", label: "Adult Medical Oncology" },
  { code: "MN1.3", label: "Palliative Care" }, { code: "MN1.4", label: "Pediatric Hematology & Oncology" }, { code: "MN1.5", label: "Radiation Oncology" },
  { code: "MN1.6", label: "Radiotherapy" }, { code: "MN1.7", label: "Chemotherapy Clinic" }, { code: "MO", label: "Pathology & Clinical Laboratory" },
  { code: "MO1", label: "Laboratory Department" }, { code: "MO1.1", label: "Biochemistry Section" }, { code: "MO1.2", label: "Biochemical genetic Section" },
  { code: "MO1.3", label: "Emergency Room Satellite Lab" }, { code: "MO1.4", label: "Flowcytometry Section" }, { code: "MO1.5", label: "Hematology Section" },
  { code: "MO1.6", label: "HLA Section" }, { code: "MO1.7", label: "Immunology Section" }, { code: "MO1.8", label: "Microbiology Section" },
  { code: "MO1.9", label: "Molecular Microbiology Section" }, { code: "MO1.10", label: "Transfusion Medicine Service Department" },
  { code: "MO1.11", label: "Toxicology Section" }, { code: "MO1.12", label: "Specimen Processing & Phlebotomy Section" }, { code: "MO1.13", label: "Serology Section" },
  { code: "MO2", label: "Pathology Department" }, { code: "MO2.1", label: "Anatomic Pathology" }, { code: "MO2.2", label: "Clinical Pathology Section" },
  { code: "MO2.3", label: "Cytogenetic Section" }, { code: "MO2.4", label: "Cytopathology Section" }, { code: "MO2.5", label: "Cellular Therapy Section" },
  { code: "MO2.6", label: "Molecular Pathology Section" }, { code: "MO2.7", label: "Surgical Specimen Section" }, { code: "MP", label: "Pediatric" },
  { code: "MP1", label: "General Pediatrics" }, { code: "MP1.1", label: "Adolescent Medicine Section" }, { code: "MP1.2", label: "Allergy and Clinical Immunology Section" },
  { code: "MP1.3", label: "Endocrinology Section" }, { code: "MP1.4", label: "Gastroenterology Section" }, { code: "MP1.5", label: "General Pediatrics Section" },
  { code: "MP1.6", label: "Genetics Section" }, { code: "MP1.7", label: "Infectious Diseases Section" }, { code: "MP1.8", label: "Nephrology Section" },
  { code: "MP1.9", label: "Neurology Section" }, { code: "MP1.10", label: "Pediatric Development & Behavioral Section" }, { code: "MP1.11", label: "Pulmonology Section" },
  { code: "MP1.12", label: "Rheumatology Section" }, { code: "MP1.13", label: "Pediatric Screening Clinic" },
  { code: "MP1.14", label: "Pediatric Diabetes and Endocrinology Screening Clinic" }, { code: "MP1.15", label: "Autism Spectrum Disorder" },
  { code: "MP2", label: "Neonatology Department" }, { code: "MP3", label: "Pediatric Surgery Department" }, { code: "MP3.1", label: "Pediatric Surgery Screening Clinic" },
  { code: "MQ", label: "Pharmacy Services" }, { code: "MQ1", label: "Ambulatory Pharmacy Department" }, { code: "MQ2", label: "Clinical Pharmacy Department" },
  { code: "MQ3", label: "Pharmacy Supply Department" }, { code: "MR", label: "Rehabilitation" }, { code: "MR1", label: "Communication & Swallowing Disorders Department" },
  { code: "MR1.1", label: "Audiology Unit" }, { code: "MR1.2", label: "Speech-Language Pathology Unit" }, { code: "MR1.3", label: "Swallowing Unit" },
  { code: "MR2", label: "Rehabilitation Care Department" }, { code: "MR2.1", label: "Art Therapy Services" }, { code: "MR2.2", label: "Low Vision Rehabilitation" },
  { code: "MR2.3", label: "Occupational Therapy" }, { code: "MR2.4", label: "Recreation Therapy Services" }, { code: "MR2.5", label: "Vocational Counseling" },
  { code: "MR3", label: "Physical Medicine Department" }, { code: "MR4", label: "Rehabilitation Technology Department" }, { code: "MR4.1", label: "Assistive Devices Services" },
  { code: "MR4.2", label: "Orthotic Services" }, { code: "MR4.3", label: "Prosthetic services" }, { code: "MR5", label: "Respiratory Therapy Department" },
  { code: "MR5.1", label: "Ambulatory Respiratory Therapy" }, { code: "MR5.2", label: "Pulmonary Function Laboratory" }, { code: "MS", label: "Surgical Specialties Department" },
  { code: "MS1.1", label: "Bariatric Surgery" }, { code: "MS1.2", label: "General Surgery Section" }, { code: "MS1.3", label: "Neurosurgery Section" },
  { code: "MS1.4", label: "Ophthalmology Section" }, { code: "MS1.5", label: "Oral and Maxillofacial Surgery Section" }, { code: "MS1.6", label: "Orthopedic Surgery Section" },
  { code: "MS1.7", label: "Pediatric Surgery Section" }, { code: "MS1.8", label: "Plastic Surgery Section" }, { code: "MS1.9", label: "Podiatric Surgery Section" },
  { code: "MS1.10", label: "Pediatric Neurosurgery Section" }, { code: "MS1.11", label: "Spinal Surgery Section" }, { code: "MS1.12", label: "Thoracic Surgery Section" },
  { code: "MS1.13", label: "Urology Surgery Section" }, { code: "MS1.14", label: "Vascular Surgery Section" }, { code: "MS1.15", label: "General Surgery Screening Clinic" },
  { code: "MS1.16", label: "Breast Tumors Diagnostic Clinic" }, { code: "MS1.17", label: "Colorectal Tumors Early Detection Clinic" },
  { code: "MS1.18", label: "Colorectal Tumors Diagnostic Clinic" }, { code: "MS2", label: "Orthopedic Surgery Department" },
  { code: "MS2.1", label: "Orthopedic Surgery Screening Clinic" }, { code: "MS2.2", label: "Orthopedic Surgery (Fractures) Clinic" },
  { code: "MT", label: "Units For Primary Health Care Use" }, { code: "MT1", label: "Chronic Diseases Clinic" }, { code: "MT3", label: "Maternity Care" },
  { code: "MT6", label: "Well Baby and Vaccination Clinic" }, { code: "MT7", label: "Smoking Cessation Clinic" }, { code: "MT9", label: "Dressing" },
  { code: "MT11", label: "Minor Surgery" }, { code: "MT14", label: "Family Medicine Clinic" }, { code: "MT14.1", label: "Health Promotion and Clinical Education Room" },
  { code: "MT14.2", label: "Comprehensive guidance" }, { code: "MT15", label: "General Dentistry" }, { code: "MT16", label: "Pharmacy" },
  { code: "MT17", label: "Laboratory Department" }, { code: "MT18", label: "X-Ray Department" }, { code: "MT18.1", label: "Ultrasound Unit" },
  { code: "MT19", label: "Epidemiology Clinic" }, { code: "MT20", label: "Central Sterilization Room" }, { code: "MT21", label: "Internal Medicine" },
  { code: "MT22", label: "Orthopedic Clinic" }, { code: "MT23", label: "Dermatology" }, { code: "MT24", label: "Ophthalmology" }, { code: "MT25", label: "ENT Clinic" },
  { code: "MT26", label: "General Surgery" }, { code: "MT27", label: "Obstetrics & Gynecology Clinic" }, { code: "MT28", label: "General Pediatrics" },
  { code: "MT29", label: "Cardiology Clinic" }, { code: "MT30", label: "Kidney Clinic" }, { code: "MT31", label: "Urology Clinic" }, { code: "MT32", label: "Nutrition Clinic" },
  { code: "MT33", label: "Premarital Screening Clinic" }, { code: "MT34", label: "Premarital Counseling Clinic" }, { code: "MT35", label: "Breast Cancer" },
  { code: "MT36", label: "Schools Examination and" }, { code: "MT37", label: "Hepatitis" }, { code: "MT38", label: "Know Your Numbers" }, { code: "MT39", label: "Dexa Scan" },
  { code: "MT40", label: "Obesity Clinic" }, { code: "MT41", label: "Physical Therapy" }, { code: "MT42", label: "Family Medicine Clinic (Consultant)" },
  { code: "MT43", label: "Family Medicine Academy Clinic" }, { code: "MU", label: "Ophthalmology Department" }, { code: "MU1", label: "Ophthalmology Screening Clinic" },
  { code: "MU2", label: "Optometry and Contact Lenses Clinic" }, { code: "MU3", label: "Comprehensive Ophthalmology Clinic" },
  { code: "MU4", label: "Diseases and Surgery of the Retina" }, { code: "MU5", label: "Glaucoma Clinic" }, { code: "MU6", label: "Neuro-Ophthalmology Clinic" },
  { code: "MU7", label: "Ocular Oncology Clinic" }, { code: "MU8", label: "Oculoplastic Clinic" }, { code: "MU9", label: "Uveitis / Medical Rina Clinic" },
  { code: "MV", label: "Dermatology Department" }, { code: "MV1", label: "Dermatology Screening" }, { code: "MV2", label: "Derma Procedures Clinic" },
  { code: "MW", label: "Ear Nose & Throat Department" }, { code: "MW1", label: "Ear Nose & Throat Screening Clinic" }, { code: "MX", label: "Internal Medicine Department" },
  { code: "MX1", label: "Internal Medicine Screening Clinic" }, { code: "MX2", label: "Endoscopy Clinic" }, { code: "MX3", label: "Counseling Clinic" },
  { code: "MX4", label: "Down Syndrome Clinic" }, { code: "MX5", label: "Smoking Cessation Clinic" }, { code: "MX6", label: "Diabetes Screening Clinic" },
  { code: "MY", label: "Urology Department" }, { code: "MY1", label: "Urology Screening Clinic" }, { code: "MY2", label: "Laparoscopic Urology Clinic" },
  { code: "MY3", label: "Neuro - Urology Clinic" }, { code: "MY4", label: "Oncology Urology Clinic" }, { code: "MY5", label: "Reconstruction Urology Clinic" },
  { code: "MZ", label: "Allied Health" }, { code: "MZ1", label: "Allied Health Clinic" }, { code: "MZ2", label: "ECG Clinic" }, { code: "MZ3", label: "EEG Clinic" },
  { code: "MZ4", label: "Optics Clinic" }, { code: "MZ5", label: "Clinical Dietitian Clinic" }, { code: "MZ6", label: "Diabetic Educator Clinic" },
  { code: "MZ7", label: "Health Education Clinic" }, { code: "MZ8", label: "EMG Clinic" }, { code: "MZ9", label: "NCS-EMG Clinic" },
  { code: "MZ10", label: "Stress Testing Clinic" }, { code: "MZ11", label: "Holter Clinic" }, { code: "MZ12", label: "Stress Echo Clinic" },
  { code: "MZ13", label: "Pediatrics EEG Clinic" }, { code: "MZ14", label: "Premarital Screening Clinic" }, { code: "MZ15", label: "Premarital Counseling Clinic" },
  { code: "MZ16", label: "Laser for Retinal Therapy Clinic" }, { code: "MZ17", label: "Insulin Pump Clinic" }, { code: "NA", label: "General Directorate of Health Affairs" },
  { code: "NA1", label: "Audit Administration" }, { code: "NA2", label: "Clinical Audit Administration" },
  { code: "NA3", label: "Disaster & Emergency Management Administration" }, { code: "NA4", label: "Electronic Health Administration" },
  { code: "NA5", label: "Employee rights Administration" }, { code: "NA6", label: "Engineering Affairs Administration" },
  { code: "NA7", label: "Finance and Administrative Affairs Administration" }, { code: "NA8", label: "General Director Administration" },
  { code: "NA9", label: "General Medical Commission" }, { code: "NA10", label: "Hajj & Omra Administration" }, { code: "NA11", label: "Legal Affairs Administration" },
  { code: "NA12", label: "Logistics Support Administration" }, { code: "NA13", label: "Nursing Affairs Administration" },
  { code: "NA14", label: "Private Sector Affairs Administration" }, { code: "NA15", label: "Public Health Administration" },
  { code: "NA16", label: "Public Relations Administration" }, { code: "NA17", label: "Quality Management Administration" },
  { code: "NA18", label: "Religious Awareness Administration" }, { code: "NA19", label: "Stock Control Administration" },
  { code: "NA20", label: "Supervision and Review Administration" }, { code: "NA21", label: "Training and Development Administration" },
  { code: "NA22", label: "Treatment Services Administration" }, { code: "NA23", label: "Primary Health Care and Preventive Medicine Administration" },
  { code: "NB", label: "Hospital Administration" }, { code: "NB1", label: "General Management Administration" }, { code: "NB2", label: "Finance Affairs Administration" },
  { code: "NB3", label: "Human Resources Administration" }, { code: "NB4", label: "Medical Administration" }, { code: "NB5", label: "Nursing Administration" },
  { code: "NB6", label: "Logistics Administration" }, { code: "NB7", label: "Pharmaceutical Supplies Administration" },
  { code: "NB8", label: "Administrative Communications Administration" }, { code: "NB9", label: "Credentialing & Verification Administration" },
  { code: "NB10", label: "Documentation and Information Administration" }, { code: "NB11", label: "Governmental Relation Administration" },
  { code: "NB12", label: "Legal Affairs Administration" }, { code: "NB13", label: "Material Planning Administration" },
  { code: "NB14", label: "Patient Relations Administration" }, { code: "NB15", label: "Procurement and Contracts Administration" },
  { code: "NB16", label: "Property Management Administration" }, { code: "NB17", label: "Public Relation & Media Administration" },
  { code: "NB18", label: "Translation Administration" }, { code: "NB19", label: "Warehouse Administration" }, { code: "NB20", label: "Training Administration" },
  { code: "NC", label: "Hospital Health Facility Operation Administration and Support Services Administration" },
  { code: "NC1", label: "Health Informatics and Information Technology Administration" }, { code: "NC2", label: "Biomedical Engineering Administration" },
  { code: "NC3", label: "Catering Administration" }, { code: "NC4", label: "Environmental Safety Administration" }, { code: "NC5", label: "Housing Administration" },
  { code: "NC6", label: "Laundry Services Administration" }, { code: "NC7", label: "Maintenance & Projects Administration" },
  { code: "NC8", label: "Medical Record Administration" }, { code: "NC9", label: "Transportation Administration" }, { code: "ND", label: "Patient Services Administration" },
  { code: "ND1", label: "Religious Spiritual Counseling Administration" }, { code: "ND2", label: "Patients Information Administration" },
  { code: "ND3", label: "Eligibility and Registration Administration" }, { code: "ND4", label: "Social Services Administration" },
  { code: "NE", label: "Primary Health Care Administration" }, { code: "NE1", label: "General Management Administration" },
  { code: "NE2", label: "Medical Management Administration" }, { code: "NE3", label: "Finance and Administrative Affairs Administration" },
  { code: "NE4", label: "Medical Records Administration" }, { code: "NE5", label: "Transportation Administration" },
  { code: "NE6", label: "Maintenance & Projects Administration" }, { code: "NE7", label: "Warehouse Administration" },
];

const setOf = (v: VsEntry[]) => new Set(v.map((x) => x.code));

/** Code sets for quick membership checks. */
export const VS = {
  patientClass: setOf(VS_PATIENT_CLASS),
  admissionMethod: setOf(VS_ADMISSION_METHOD),
  admitSource: setOf(VS_ADMIT_SOURCE),
  dischargeDisposition: setOf(VS_DISCHARGE_DISPOSITION),
  edArrivalMode: setOf(VS_ED_ARRIVAL_MODE),
  edDisposition: setOf(VS_ED_DISPOSITION),
  triageCategory: setOf(VS_TRIAGE_CATEGORY),
  gender: setOf(VS_GENDER),
  maritalStatus: setOf(VS_MARITAL_STATUS),
  allergyType: setOf(VS_ALLERGY_TYPE),
  allergySeverity: setOf(VS_ALLERGY_SEVERITY),
  country: setOf(VS_COUNTRY),
  medicalUnit: setOf(VS_MEDICAL_UNIT),
} as const;

export const vsLabel = (v: VsEntry[], code: string | undefined): string => v.find((x) => x.code === code)?.label ?? "";
