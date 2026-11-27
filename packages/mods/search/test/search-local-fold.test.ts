import { describe, expect, it } from "vitest";
import { foldText } from "@humanharness/protocol";
import { fold } from "@humanharness/search";

describe("the window folds a query like the index does (plan deviation 2)", () => {
  it("same accents and case folding", () => {
    for (const s of ["Apariencia ÉCOLE", "Fracción", "Ñandú", "Straße", "İstanbul", "Crème brûlée", "é́", "ÅNGSTRÖM"]) expect(foldText(s)).toBe(fold(s));
  });
});
