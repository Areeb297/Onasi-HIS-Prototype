import { DOCTORS } from "../reference-data";
import type { DemoUser } from "../session";
import type { Person } from "./common";

/** The pathologist who signs laboratory reports (legal authenticator). Made-up. */
export const LAB_DIRECTOR: Person = { id: "L9001", name: "Dr. Sultan Alharbi" };

/** A doctor from the reference data as a FHIR person. The id matches PV1-7 in the ADT messages. */
export function personFromDoctor(id: string): Person {
  const d = DOCTORS.find((x) => x.id === id);
  return { id, name: d ? `Dr. ${d.given} ${d.family}` : id };
}

export const personFromUser = (u: DemoUser): Person => ({ id: u.id, name: u.name });

/** The reference-data doctor that matches a signed-in user by name, if any. */
export const doctorIdForUser = (u: DemoUser): string | undefined =>
  DOCTORS.find((d) => u.name.includes(d.family) && u.name.includes(d.given))?.id;
