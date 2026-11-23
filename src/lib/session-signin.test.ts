import { describe, expect, it } from "vitest";
import { userForEmail } from "@/lib/session";

describe("userForEmail", () => {
  it("finds the demo account from a first or last name before the @", () => {
    expect(userForEmail("khalid@onasi.care")?.id).toBe("U1");
    expect(userForEmail("noura.alzahrani@hospital.sa")?.id).toBe("U4");
    expect(userForEmail("Alotaibi@hospital.sa")?.id).toBe("U2");
    expect(userForEmail("admin@hospital.sa")?.role).toBe("admin");
  });

  it("finds nobody for an unknown name or a name only after the @", () => {
    expect(userForEmail("someone@hospital.sa")).toBeUndefined();
    expect(userForEmail("x@khalid.sa")).toBeUndefined();
  });
});
