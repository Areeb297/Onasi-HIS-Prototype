import type { FormDef } from "./schema";
import { GENERAL_FORMS } from "./forms/general";
import { NURSING_FORMS } from "./forms/nursing";
import { OT_FORMS } from "./forms/ot";
import { REHAB_FORMS } from "./forms/rehab";
import { WOMENS_FORMS } from "./forms/womens";

/**
 * Every EMR form that is rendered by the generic engine (General items without a dedicated screen, Rehab,
 * Gynecology, Obstetrics, OT and Nursing). Each form is data. The form files live in src/lib/forms/.
 * Scored forms: Humpty Dumpty falls scale, New Ballard Score, Braden Scale (pressure ulcer chart), pain score.
 */
export const EMR_FORMS: FormDef[] = [...GENERAL_FORMS, ...REHAB_FORMS, ...WOMENS_FORMS, ...OT_FORMS, ...NURSING_FORMS];

export const EMR_FORM_BY_ID: Record<string, FormDef> = Object.fromEntries(EMR_FORMS.map((f) => [f.id, f]));

/** True when the form is made for this patient sex. A form with no sex rule fits everyone, and an unknown sex hides nothing. */
export function fitsSex(form: Pick<FormDef, "sex"> | undefined, sex: string | undefined): boolean {
  if (!form?.sex || (sex !== "F" && sex !== "M")) return true;
  return form.sex === sex;
}

/** Why a form cannot be used for this patient, in words for the person at the screen. Empty when it fits. */
export function sexProblem(form: Pick<FormDef, "sex" | "title"> | undefined, sex: string | undefined): string {
  if (fitsSex(form, sex)) return "";
  return `${form!.title} is only for ${form!.sex === "F" ? "female" : "male"} patients. This patient is ${sex === "F" ? "female" : "male"}.`;
}
