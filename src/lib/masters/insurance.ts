import type { MasterDef } from "../schema";
import { badge, bool, date, mono, num, pick, text } from "./helpers";

/**
 * Insurance setup. Insurer and TPA names are real market names. Policy numbers,
 * contacts and contract details are made up.
 */

const INSURERS = ["Bupa Arabia", "Tawuniya", "MedGulf", "Daman", "NextCare", "Malath Insurance", "Walaa Insurance", "Self-pay"];
const TPAS = ["None", "NextCare", "GlobeMed Saudi", "Mednet (sample)"];

export const INSURANCE: MasterDef[] = [
  {
    id: "tpa",
    title: "TPA",
    module: "Insurance Setup",
    description: "Third party administrators that process claims for insurers.",
    columns: [
      mono("code", "Code", true),
      text("name", "TPA", true),
      text("contact", "Contact Person"),
      text("email", "Email", false, "name@example.com"),
      text("phone", "Phone"),
      badge("status", "Status", ["Active", "Draft", "Disabled"]),
    ],
    seed: [
      { code: "TPA-NC", name: "NextCare", contact: "Claims desk (sample)", email: "claims@example.com", phone: "+966 11 000 0101", status: "Active" },
      { code: "TPA-GM", name: "GlobeMed Saudi", contact: "Provider relations (sample)", email: "providers@example.com", phone: "+966 12 000 0102", status: "Active" },
      { code: "TPA-MN", name: "Mednet (sample)", contact: "Provider desk (sample)", email: "desk@example.com", phone: "+966 11 000 0103", status: "Active" },
      { code: "TPA-GC", name: "Gulf Care TPA (sample)", contact: "Claims desk (sample)", email: "claims2@example.com", phone: "+966 13 000 0104", status: "Draft" },
    ],
  },
  {
    id: "insurance",
    title: "Insurance",
    module: "Insurance Setup",
    description: "Insurance companies and government payers.",
    columns: [
      mono("code", "Code", true),
      text("name", "Insurer", true),
      pick("type", "Type", ["Private insurer", "Government payer", "Self-pay"], true),
      pick("tpa", "TPA", TPAS),
      mono("payerId", "Payer Id", false, "PAYER-000"),
      badge("status", "Status", ["Active", "Draft", "Disabled"]),
    ],
    seed: [
      { code: "INS-BUPA", name: "Bupa Arabia", type: "Private insurer", tpa: "None", payerId: "PAYER-0001", status: "Active" },
      { code: "INS-TAW", name: "Tawuniya", type: "Private insurer", tpa: "None", payerId: "PAYER-0002", status: "Active" },
      { code: "INS-MEDG", name: "MedGulf", type: "Private insurer", tpa: "Mednet (sample)", payerId: "PAYER-0003", status: "Active" },
      { code: "INS-DAM", name: "Daman", type: "Government payer", tpa: "None", payerId: "PAYER-0004", status: "Active" },
      { code: "INS-NXC", name: "NextCare", type: "Private insurer", tpa: "NextCare", payerId: "PAYER-0005", status: "Active" },
      { code: "INS-MAL", name: "Malath Insurance", type: "Private insurer", tpa: "GlobeMed Saudi", payerId: "PAYER-0006", status: "Active" },
      { code: "INS-WAL", name: "Walaa Insurance", type: "Private insurer", tpa: "None", payerId: "PAYER-0007", status: "Draft" },
      { code: "INS-SELF", name: "Self-pay", type: "Self-pay", tpa: "None", payerId: "", status: "Active" },
    ],
  },
  {
    id: "insurance-policy",
    title: "Insurance Policy",
    module: "Insurance Setup",
    description: "Corporate and individual policies. Policy numbers are made up.",
    columns: [
      mono("policyNo", "Policy No", true),
      pick("insurer", "Insurer", INSURERS, true),
      text("holder", "Policy Holder", true),
      pick("class", "Class", ["VIP", "A", "B", "C"]),
      date("start", "Start", true),
      date("end", "End", true),
      badge("status", "Status", ["Active", "Pending", "Expired"]),
    ],
    seed: [
      { policyNo: "POL-24-81001", insurer: "Bupa Arabia", holder: "Gulf Logistics Co (sample)", class: "A", start: "2026-01-01", end: "2026-12-31", status: "Active" },
      { policyNo: "POL-24-81002", insurer: "Tawuniya", holder: "Najd Construction (sample)", class: "B", start: "2026-03-01", end: "2027-02-28", status: "Active" },
      { policyNo: "POL-24-81003", insurer: "MedGulf", holder: "Red Sea Retail (sample)", class: "C", start: "2025-07-01", end: "2026-06-30", status: "Expired" },
      { policyNo: "POL-24-81004", insurer: "Daman", holder: "Government employees (sample)", class: "A", start: "2026-01-01", end: "2026-12-31", status: "Active" },
      { policyNo: "POL-24-81005", insurer: "NextCare", holder: "Eastern Foods (sample)", class: "VIP", start: "2026-12-01", end: "2027-11-30", status: "Pending" },
      { policyNo: "POL-24-81006", insurer: "Malath Insurance", holder: "Individual plan (sample)", class: "B", start: "2026-05-15", end: "2027-05-14", status: "Active" },
    ],
  },
  {
    id: "insurance-class",
    title: "Insurance Class",
    module: "Insurance Setup",
    description: "Cover classes with co-pay and limits in SAR.",
    columns: [
      mono("code", "Class", true),
      text("name", "Class Name", true),
      text("room", "Room Entitlement"),
      num("copay", "Co-pay %"),
      num("deductible", "Deductible (SAR)"),
      num("annualLimit", "Annual Limit (SAR)"),
      bool("active", "Active"),
    ],
    seed: [
      { code: "VIP", name: "VIP", room: "Private suite", copay: 0, deductible: 0, annualLimit: 1000000, active: true },
      { code: "A", name: "Class A", room: "Private room", copay: 10, deductible: 0, annualLimit: 500000, active: true },
      { code: "B", name: "Class B", room: "Shared room (2 beds)", copay: 20, deductible: 50, annualLimit: 250000, active: true },
      { code: "C", name: "Class C", room: "Shared room (3 or more beds)", copay: 20, deductible: 100, annualLimit: 150000, active: true },
    ],
  },
  {
    id: "insurance-network",
    title: "Insurance Network",
    module: "Insurance Setup",
    description: "Provider networks offered by each insurer. Names are sample names.",
    columns: [
      mono("code", "Code", true),
      text("name", "Network", true),
      pick("insurer", "Insurer", INSURERS, true),
      pick("tier", "Tier", ["Premium", "Standard", "Basic"]),
      pick("region", "Region", ["Riyadh", "Jeddah", "Dammam", "All regions"]),
      badge("status", "Status", ["Active", "Draft", "Expired"]),
    ],
    seed: [
      { code: "NET-BUPA-1", name: "Premier Network (sample)", insurer: "Bupa Arabia", tier: "Premium", region: "All regions", status: "Active" },
      { code: "NET-BUPA-2", name: "Standard Network (sample)", insurer: "Bupa Arabia", tier: "Standard", region: "Riyadh", status: "Active" },
      { code: "NET-TAW-1", name: "Gold Network (sample)", insurer: "Tawuniya", tier: "Premium", region: "All regions", status: "Active" },
      { code: "NET-MEDG-1", name: "Basic Network (sample)", insurer: "MedGulf", tier: "Basic", region: "Jeddah", status: "Active" },
      { code: "NET-DAM-1", name: "Government Network (sample)", insurer: "Daman", tier: "Standard", region: "All regions", status: "Active" },
      { code: "NET-NXC-1", name: "Corporate Network (sample)", insurer: "NextCare", tier: "Standard", region: "Dammam", status: "Draft" },
    ],
  },
  {
    id: "insurance-master",
    title: "Insurance Master Setup",
    module: "Insurance Setup",
    description: "Rules that apply when a patient with this insurer is billed.",
    columns: [
      mono("code", "Code", true),
      pick("insurer", "Insurer", INSURERS, true),
      pick("priceList", "Price List", ["Insured Standard", "Insured VIP", "Cash"], true),
      bool("preauth", "Pre-auth Needed"),
      num("copay", "Default Co-pay %"),
      pick("claimRoute", "Claim Route", ["NPHIES", "TPA portal", "Insurer portal"]),
      date("validFrom", "Valid From"),
      badge("status", "Status", ["Active", "Draft", "Expired"]),
    ],
    seed: [
      { code: "IM-001", insurer: "Bupa Arabia", priceList: "Insured Standard", preauth: true, copay: 20, claimRoute: "NPHIES", validFrom: "2026-01-01", status: "Active" },
      { code: "IM-002", insurer: "Tawuniya", priceList: "Insured Standard", preauth: true, copay: 20, claimRoute: "NPHIES", validFrom: "2026-01-01", status: "Active" },
      { code: "IM-003", insurer: "MedGulf", priceList: "Insured Standard", preauth: true, copay: 20, claimRoute: "TPA portal", validFrom: "2026-01-01", status: "Active" },
      { code: "IM-004", insurer: "Daman", priceList: "Insured Standard", preauth: false, copay: 10, claimRoute: "NPHIES", validFrom: "2026-01-01", status: "Active" },
      { code: "IM-005", insurer: "NextCare", priceList: "Insured VIP", preauth: true, copay: 0, claimRoute: "TPA portal", validFrom: "2026-06-01", status: "Draft" },
      { code: "IM-006", insurer: "Self-pay", priceList: "Cash", preauth: false, copay: 0, claimRoute: "Insurer portal", validFrom: "2026-01-01", status: "Active" },
    ],
  },
];
