import { describe, expect, it } from "vitest";
import { COMMON_LANGUAGES, isRightToLeft, languageName, offeredLanguage, pickerLanguages } from "../src/language";

describe("picker languages (spec §2, D9)", () => {
  it("knows right-to-left languages from ICU or the fixed list", () => {
    for (const tag of ["ar", "he", "fa", "ur", "ps", "yi", "dv", "ckb", "sd", "ug", "ar-EG"]) expect(isRightToLeft(tag)).toBe(true);
    for (const tag of ["en", "es", "pt-BR", "ja", "zh-Hant"]) expect(isRightToLeft(tag)).toBe(false);
  });

  it("offers a canonical, left-to-right tag only", () => {
    expect(offeredLanguage("pt-BR")).toBe(true);
    expect(offeredLanguage("pt-br")).toBe(false);
    expect(offeredLanguage("he")).toBe(false);
    expect(offeredLanguage("not a tag")).toBe(false);
    expect(offeredLanguage("x".repeat(40))).toBe(false);
  });

  it("lists English first, with extras added once and RTL dropped", () => {
    const list = pickerLanguages(["es", "gl", "ar", "gl", "bad tag"]);
    expect(list[0]).toBe("en");
    expect(list).toContain("gl");
    expect(list).not.toContain("ar");
    expect(list.filter((t) => t === "gl")).toHaveLength(1);
    expect(COMMON_LANGUAGES.every((t) => !isRightToLeft(t))).toBe(true);
  });

  it("after English, the order is by English name", () => {
    const rest = pickerLanguages(["gl", "eu"]).slice(1);
    const names = rest.map((t) => languageName(t));
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en")));
    expect(rest.indexOf("eu")).toBeLessThan(rest.indexOf("gl"));
  });
});
