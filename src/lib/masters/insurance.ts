import type { MasterDef } from "../schema";
import { badge, bool, date, mono, more, num, pick, text } from "./helpers";

/**
 * Insurance setup. Insurer and TPA names are real market names. Policy numbers,
 * contacts and contract details are made up.
 */

const INSURERS = ["Bupa Arabia", "Tawuniya", "MedGulf", "Daman", "NextCare", "Malath Insurance", "Walaa Insurance"];
const TPAS = ["None", "NextCare", "GlobeMed Saudi", "Mednet (sample)"];
const NETWORKS = ["Premier Network (sample)", "Standard Network (sample)", "Gold Network (sample)", "Basic Network (sample)", "Government Network (sample)", "Corporate Network (sample)"];

export const INSURANCE: MasterDef[] = [
  {
    id: "tpa",
    title: "TPA",
    module: "Insurance Setup",
    description: "Third party administrators that process claims for insurers.",
    columns: [
      mono("code", "TPA Code", true),
      text("name", "TPA / Group Name", true),
      text("contact", "Contact Person"),
      text("email", "Email", false, "name@example.com"),
      text("phone", "Phone"),
      mono("licenseNo", "TPA License / CHI Code", false, "CHI-TPA-000"),
      text("payers", "Linked Insurances"),
      badge("status", "Status", ["Active", "Inactive"]),
      ...more(
        text("countries", "Countries / Regions", false, "Saudi Arabia, GCC"),
        mono("policyNumber", "Policy Number"),
        mono("groupNumber", "Group Number"),
      ),
    ],
    seed: [
      { code: "TPA-NC", name: "NextCare", contact: "Claims desk (sample)", email: "claims@example.com", phone: "+966 11 000 0101", licenseNo: "CHI-TPA-0101", payers: "NextCare", status: "Active", countries: "Saudi Arabia, GCC", policyNumber: "TPA-POL-1101", groupNumber: "GRP-501" },
      { code: "TPA-GM", name: "GlobeMed Saudi", contact: "Provider relations (sample)", email: "providers@example.com", phone: "+966 12 000 0102", licenseNo: "CHI-TPA-0102", payers: "Malath Insurance", status: "Active", countries: "Saudi Arabia", policyNumber: "TPA-POL-1102", groupNumber: "GRP-502" },
      { code: "TPA-MN", name: "Mednet (sample)", contact: "Provider desk (sample)", email: "desk@example.com", phone: "+966 11 000 0103", licenseNo: "CHI-TPA-0103", payers: "MedGulf", status: "Active", countries: "Saudi Arabia", policyNumber: "TPA-POL-1103", groupNumber: "" },
      { code: "TPA-GC", name: "Gulf Care TPA (sample)", contact: "Claims desk (sample)", email: "claims2@example.com", phone: "+966 13 000 0104", licenseNo: "CHI-TPA-0104", payers: "", status: "Inactive" },
    ],
  },
  {
    id: "insurance",
    title: "Insurance",
    module: "Insurance Setup",
    description: "Insurance companies and government payers.",
    columns: [
      mono("code", "Payer Code", true),
      text("name", "Payer Name", true),
      mono("licenseNumber", "License Number (NPHIES)", true),
      pick("tpa", "Associated TPA", TPAS),
      mono("registrationNumber", "CR / Unified No", false, "7000000000"),
      text("networkName", "Network Name"),
      badge("status", "Status", ["Active", "Inactive"]),
      ...more(
        text("contactEmail", "Email", false, "payer@example.com"),
        text("contactPhone", "Phone", false, "+966 5..."),
        text("address", "Address", false, "District, City, KSA"),
        pick("adminRoute", "Admin Route", ["Direct", "TPA"]),
        text("fhirEndpoint", "FHIR Endpoint URL", false, "https://nphies.sa/fhir/r4/..."),
        mono("vatNumber", "VAT Number"),
        num("vatPercentage", "VAT %"),
        bool("drgEnabled", "Enable DRG"),
        bool("ebpEnabled", "Enable EBP"),
      ),
    ],
    seed: [
      { code: "INS-BUPA", name: "Bupa Arabia", tpa: "None", registrationNumber: "7001000011", networkName: "Premier Network (sample)", status: "Active", licenseNumber: "INS-LIC-0001", contactEmail: "providers.bupa@example.com", contactPhone: "+966 12 000 1001", address: "Al Khalidiyah, Jeddah", adminRoute: "Direct", fhirEndpoint: "https://nphies.example/fhir/r4/bupa", vatNumber: "300000000100003", vatPercentage: 15, drgEnabled: true, ebpEnabled: false },
      { code: "INS-TAW", name: "Tawuniya", tpa: "None", registrationNumber: "7001000022", networkName: "Gold Network (sample)", status: "Active", licenseNumber: "INS-LIC-0002", contactEmail: "providers.taw@example.com", contactPhone: "+966 11 000 1002", address: "Al Olaya, Riyadh", adminRoute: "Direct", fhirEndpoint: "https://nphies.example/fhir/r4/tawuniya", vatNumber: "300000000200003", vatPercentage: 15, drgEnabled: true, ebpEnabled: true },
      { code: "INS-MEDG", name: "MedGulf", tpa: "Mednet (sample)", registrationNumber: "7001000033", networkName: "Basic Network (sample)", status: "Active", licenseNumber: "INS-LIC-0003", contactEmail: "providers.medgulf@example.com", contactPhone: "+966 11 000 1003", address: "Al Malaz, Riyadh", adminRoute: "TPA", vatNumber: "300000000300003", vatPercentage: 15, drgEnabled: false, ebpEnabled: false },
      { code: "INS-DAM", name: "Daman", tpa: "None", registrationNumber: "7001000044", networkName: "Government Network (sample)", status: "Active", licenseNumber: "INS-LIC-0004", adminRoute: "Direct", vatPercentage: 0, drgEnabled: true, ebpEnabled: false },
      { code: "INS-NXC", name: "NextCare", tpa: "NextCare", registrationNumber: "7001000055", networkName: "Corporate Network (sample)", status: "Active", licenseNumber: "INS-LIC-0005", adminRoute: "TPA", vatPercentage: 15, drgEnabled: false, ebpEnabled: false },
      { code: "INS-MAL", name: "Malath Insurance", tpa: "GlobeMed Saudi", registrationNumber: "7001000066", networkName: "", status: "Active", licenseNumber: "INS-LIC-0006", adminRoute: "TPA", vatPercentage: 15, drgEnabled: false, ebpEnabled: false },
      { code: "INS-WAL", name: "Walaa Insurance", tpa: "None", registrationNumber: "7001000077", networkName: "", status: "Inactive", licenseNumber: "INS-LIC-0007", adminRoute: "Direct", vatPercentage: 15, drgEnabled: false, ebpEnabled: false },
    ],
  },
  {
    id: "insurance-policy",
    title: "Insurance Policy",
    module: "Insurance Setup",
    description: "Corporate and individual policies. Policy numbers are made up.",
    columns: [
      mono("policyNo", "Policy Code", true),
      text("holder", "Policy Name", true),
      pick("insurer", "Linked Insurers", INSURERS, true),
      pick("class", "Linked Classes", ["VIP", "A", "B", "C"]),
      date("start", "Start Date", true),
      date("end", "End Date", true),
      text("copay", "Copay Rules / Details", false, "e.g. 10% on outpatient consults"),
      badge("status", "Policy Status", ["Active", "Expired", "On Hold"]),
      ...more(
        text("coverage", "Coverage Summary", false, "e.g. Full outpatient and rehab"),
        text("premium", "Premium Details", false, "e.g. Monthly premium 500 SAR"),
        text("deductible", "Deductible Rules / Details", false, "e.g. 100 SAR max deductible"),
        text("cancellation", "Cancellation Terms", false, "e.g. 30 days notice"),
        pick("network", "Linked Networks", NETWORKS),
      ),
    ],
    seed: [
      { policyNo: "POL-24-81001", insurer: "Bupa Arabia", holder: "Gulf Logistics Co (sample)", class: "A", start: "2026-01-01", end: "2026-12-31", copay: "10% on outpatient, up to SAR 100", status: "Active", coverage: "Outpatient, inpatient and maternity", premium: "Annual premium SAR 6,200 per member", deductible: "SAR 100 per outpatient visit", cancellation: "30 days notice", network: "Premier Network (sample)" },
      { policyNo: "POL-24-81002", insurer: "Tawuniya", holder: "Najd Construction (sample)", class: "B", start: "2026-03-01", end: "2027-02-28", copay: "20% on outpatient, up to SAR 150", status: "Active", coverage: "Outpatient and inpatient", premium: "Annual premium SAR 4,800 per member", deductible: "SAR 150 per outpatient visit", cancellation: "60 days notice", network: "Gold Network (sample)" },
      { policyNo: "POL-24-81003", insurer: "MedGulf", holder: "Red Sea Retail (sample)", class: "C", start: "2025-07-01", end: "2026-06-30", copay: "20% on all services", status: "Expired" },
      { policyNo: "POL-24-81004", insurer: "Daman", holder: "Government employees (sample)", class: "A", start: "2026-01-01", end: "2026-12-31", copay: "No copay", status: "Active", coverage: "Full outpatient, inpatient and emergency", premium: "Paid by the employer", deductible: "None", cancellation: "End of the policy year", network: "Government Network (sample)" },
      { policyNo: "POL-24-81005", insurer: "NextCare", holder: "Eastern Foods (sample)", class: "VIP", start: "2026-12-01", end: "2027-11-30", copay: "No copay", status: "On Hold" },
      { policyNo: "POL-24-81006", insurer: "Malath Insurance", holder: "Individual plan (sample)", class: "B", start: "2026-05-15", end: "2027-05-14", copay: "20% on outpatient, up to SAR 200", status: "Active" },
    ],
  },
  {
    id: "insurance-class",
    title: "Insurance Class",
    module: "Insurance Setup",
    description: "Cover classes with co-pay and limits in SAR.",
    columns: [
      mono("code", "Class Code", true),
      text("name", "Class / Plan Name", true),
      pick("planType", "Class Type", ["Class", "Group", "Plan", "SubClass", "SubGroup", "SubPlan"], true),
      num("copay", "Co-Pay %"),
      num("coInsurance", "Co-Insurance %"),
      num("deductible", "Deductible Amount (SAR)"),
      num("annualLimit", "Max Limit (SAR)"),
      bool("active", "Active"),
      ...more(
        text("package", "Package", false, "e.g. VIP, Basic"),
        date("startDate", "Start Date"),
        date("endDate", "End Date"),
      ),
    ],
    seed: [
      { code: "VIP", name: "VIP", planType: "Class", copay: 0, deductible: 0, annualLimit: 1000000, active: true, package: "VIP", coInsurance: 0, startDate: "2026-01-01", endDate: "2026-12-31" },
      { code: "A", name: "Class A", planType: "Class", copay: 10, deductible: 0, annualLimit: 500000, active: true, package: "Gold", coInsurance: 0, startDate: "2026-01-01", endDate: "2026-12-31" },
      { code: "B", name: "Class B", planType: "Class", copay: 20, deductible: 50, annualLimit: 250000, active: true, package: "Silver", coInsurance: 10, startDate: "2026-01-01", endDate: "2026-12-31" },
      { code: "C", name: "Class C", planType: "Class", copay: 20, deductible: 100, annualLimit: 150000, active: true, package: "Basic", coInsurance: 20, startDate: "2026-01-01", endDate: "2026-12-31" },
    ],
  },
  {
    id: "insurance-network",
    title: "Insurance Network",
    module: "Insurance Setup",
    description: "Provider networks offered by each insurer. Names are sample names.",
    columns: [
      text("name", "Network Name", true),
      text("networkType", "Network Type", false, "e.g. A4"),
      mono("insurerAbbreviation", "Insurer Abbreviation", false, "BUPA"),
      text("service", "Service", false, "Outpatient, Inpatient"),
      text("note", "Note"),
      badge("status", "Status", ["Active", "Inactive"]),
    ],
    seed: [
      { name: "Premier Network (sample)", service: "Outpatient, Inpatient, Dental", note: "Direct billing for all classes", status: "Active", networkType: "A1", insurerAbbreviation: "BUPA" },
      { name: "Standard Network (sample)", service: "Outpatient, Inpatient", note: "", status: "Active", networkType: "B2", insurerAbbreviation: "BUPA" },
      { name: "Gold Network (sample)", service: "Outpatient, Inpatient, Maternity", note: "", status: "Active", networkType: "A3", insurerAbbreviation: "TAW" },
      { name: "Basic Network (sample)", service: "Outpatient", note: "Referral needed for inpatient care", status: "Active", networkType: "C1", insurerAbbreviation: "MEDG" },
      { name: "Government Network (sample)", service: "Outpatient, Inpatient, Emergency", note: "", status: "Active" },
      { name: "Corporate Network (sample)", service: "Outpatient, Inpatient", note: "Contract under review", status: "Inactive" },
    ],
  },
  {
    id: "insurance-master",
    title: "Insurance Master Setup",
    module: "Insurance Setup",
    description: "Rules that apply when a patient with this insurer is billed.",
    columns: [
      mono("code", "Code", true),
      pick("insurer", "Insurance Co.", INSURERS, true),
      mono("policy", "Policy", false, "POL-24-81001"),
      pick("insuranceClass", "Class", ["VIP", "A", "B", "C"]),
      pick("network", "Network", NETWORKS),
      date("validFrom", "Effective From"),
      badge("status", "Status", ["Active", "Inactive"]),
    ],
    seed: [
      { code: "IM-001", insurer: "Bupa Arabia", validFrom: "2026-01-01", status: "Active", policy: "POL-24-81001", insuranceClass: "A", network: "Premier Network (sample)" },
      { code: "IM-002", insurer: "Tawuniya", validFrom: "2026-01-01", status: "Active", policy: "POL-24-81002", insuranceClass: "B", network: "Gold Network (sample)" },
      { code: "IM-003", insurer: "MedGulf", validFrom: "2026-01-01", status: "Active", policy: "POL-24-81003", insuranceClass: "C", network: "Basic Network (sample)" },
      { code: "IM-004", insurer: "Daman", validFrom: "2026-01-01", status: "Active", policy: "POL-24-81004", insuranceClass: "A", network: "Government Network (sample)" },
      { code: "IM-005", insurer: "NextCare", validFrom: "2026-06-01", status: "Inactive", policy: "POL-24-81005", insuranceClass: "VIP", network: "Corporate Network (sample)" },
    ],
  },
];
