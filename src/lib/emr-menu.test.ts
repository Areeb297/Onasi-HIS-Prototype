import { describe, expect, it } from "vitest";
import { EMR_MENU, EMR_TABS, tabFor } from "./emr-menu";

describe("chart module tabs", () => {
  it("keep every section reachable, with only Laboratory and Radiology in two tabs", () => {
    const places = new Map<string, number>();
    for (const t of EMR_TABS) for (const i of t.items) places.set(i.id, (places.get(i.id) ?? 0) + 1);
    expect([...places.keys()].sort()).toEqual(EMR_MENU.map((i) => i.id).sort());
    expect([...places].filter(([, n]) => n > 1).map(([id]) => id).sort()).toEqual(["laboratory", "radiology"]);
    expect(EMR_TABS.map((t) => t.label)).toEqual(["Overview", "Notes", "Orders", "Results", "Medications", "Vitals", "Problems", "Documents", "More"]);
  });

  it("open a deep link in the right tab", () => {
    expect(tabFor("overview").id).toBe("overview");
    expect(tabFor("soap").id).toBe("notes");
    expect(tabFor("laboratory").id).toBe("results");
    expect(tabFor("laboratory", "orders").id).toBe("orders");
    expect(tabFor("radiology", "orders").id).toBe("orders");
    expect(tabFor("sick-leave").id).toBe("documents");
    expect(tabFor("nursing-pain-scale").id).toBe("more");
    expect(tabFor("adt").id).toBe("more");
    expect(tabFor("soap", "orders").id).toBe("notes"); // a tab that does not hold the section is ignored
    expect(tabFor("no-such-section").id).toBe("overview");
  });
});
