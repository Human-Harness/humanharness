import { describe, expect, it } from "vitest";
import { foldText, localScore, markLocal } from "../src/search-local";

describe("local matching (plan deviation 2)", () => {
  it("folds case and accents", () => {
    expect(foldText("Apariencia ÉCOLE")).toBe("apariencia ecole");
  });

  it("every typed word starts a word: the label scores 2, a section or keyword 1, else 0", () => {
    expect(localScore("app", "Appearance", ["Settings", "theme dark"])).toBe(2);
    expect(localScore("dark", "Appearance", ["Settings", "theme dark"])).toBe(1);
    expect(localScore("text si", "Text size", [])).toBe(2);
    expect(localScore("pear", "Appearance", [])).toBe(0);
    expect(localScore("", "Appearance", [])).toBe(0);
  });

  it("an accented or capitalised query finds the plain label, and the other way round", () => {
    expect(localScore("TÉXT", "Text size", [])).toBe(2);
    expect(localScore("fraccion", "Fracción", [])).toBe(2);
    expect(markLocal("Fracción", "FRAC")).toEqual([{ text: "Frac", mark: true }, { text: "ción" }]);
  });

  it("marks the typed prefix of each matching word", () => {
    expect(markLocal("Text size", "si te")).toEqual([{ text: "Te", mark: true }, { text: "xt " }, { text: "si", mark: true }, { text: "ze" }]);
    expect(markLocal("Backup", "zzz")).toEqual([{ text: "Backup" }]);
  });
});

describe("marking a decomposed label", () => {
  it("a label in NFD (é as e + U+0301) is marked as one word, its accent kept", () => {
    expect(markLocal("Résumé settings", "resu")).toEqual([{ text: "Résu", mark: true }, { text: "mé settings" }]);
  });
});
