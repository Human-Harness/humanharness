import { describe, expect, it } from "vitest";
import { CORE_LOCALES, createI18n } from "../src";

describe("core locales", () => {
  it("ship English only (spec 5 D1)", () => {
    expect(Object.keys(CORE_LOCALES)).toEqual(["en"]);
  });

  it("never state token savings as numbers (spec §5.3)", () => {
    expect(JSON.stringify(CORE_LOCALES.en.notes)).not.toMatch(/token|\d\s?k\b/i);
  });
});

describe("createI18n", () => {
  it("translates core keys with interpolation and plurals", async () => {
    const en = await createI18n("en");
    expect(en.t("home.start", { name: "Demo" })).toBe("Start Demo");
    expect(en.t("models.changed", { tier: "Standard" })).toBe("Changed · recommended: Standard");
    expect(en.t("notes.keyPoints", { count: 1 })).toBe("1 key point");
    expect(en.t("notes.keyPoints", { count: 2 })).toBe("2 key points");
    expect(en.t("settings.languageHint")).toBe("The app's texts are in English for now. The AI answers in this language.");
  });

  it("shows English for a language with no strings", async () => {
    const i18n = await createI18n("pt-BR");
    expect(i18n.language).toBe("pt-BR");
    expect(i18n.resolvedLanguage).toBe("en");
    expect(i18n.t("chat.send")).toBe("Send");
  });

  it("adds the harness's own English strings under the harness namespace", async () => {
    const i18n = await createI18n("es", { en: { title: "Notes" } });
    expect(i18n.t("harness:title")).toBe("Notes");
  });
});
