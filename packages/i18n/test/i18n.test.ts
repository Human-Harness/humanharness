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
    expect(en.t("settings.languageHint")).toBe("The AI always thinks in English and writes to you in this language.");
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

describe("legal strings (spec §8)", () => {
  const en = CORE_LOCALES.en as Record<string, any>;
  it("live under legal., and the engine block keeps no notice text of its own", () => {
    expect(Object.keys(en.legal.engine).sort()).toEqual(["accept", "noticeAccount", "noticeContent", "noticeProvider", "noticeTitle", "noticeTraining", "noticeUserProvider"]);
    expect(Object.keys(en.engine).filter((k) => k.startsWith("notice") || k === "accept")).toEqual([]);
  });

  it("the language strings exist, and the notice bolds one word with <b>", () => {
    expect(en.language.notice).toContain("<b>{{language}}</b>");
    expect(en.language.legalEnglish).toBe("Legal texts are shown in English.");
    expect(en.language.needsEngine).toBe("Connect an AI engine to translate the app.");
    expect(en.setupFlow.languageLater).toBe("You can choose the app's language once it's set up.");
  });
});

describe("generated strings (spec §6)", () => {
  it("D0: no generated strings build exactly today's resources", async () => {
    const i18n = await createI18n("es");
    expect(Object.keys(i18n.options.resources ?? {})).toEqual(["en"]);
    const empty = await createI18n("es", {}, {});
    expect(Object.keys(empty.options.resources ?? {})).toEqual(["en"]);
    expect(empty.resolvedLanguage).toBe("en");
  });

  it("shows the cached strings, English for the rest and for legal keys", async () => {
    const i18n = await createI18n("es", { en: { title: "Notes" } }, { "core:chat.send": "Enviar", "harness:title": "Notas", "core:legal.engine.accept": "Acepto" });
    expect(i18n.resolvedLanguage).toBe("es");
    expect(i18n.t("chat.send")).toBe("Enviar");
    expect(i18n.t("harness:title")).toBe("Notas");
    expect(i18n.t("legal.engine.accept")).toBe("I understand and accept");
    expect(i18n.t("settings.title")).toBe("Settings");
  });

  it("a set with nothing left after the checks (legal-only, dropped keys) adds no language", async () => {
    const sets: Record<string, string>[] = [{ "core:legal.engine.accept": "Acepto" }, { "other:chat.send": "Enviar", "core:__proto__.x": "y", nokey: "z" }];
    for (const generated of sets) {
      const i18n = await createI18n("es", {}, generated);
      expect(Object.keys(i18n.options.resources ?? {})).toEqual(["en"]);
      expect(i18n.resolvedLanguage).toBe("en");
    }
  });

  it("one harness key is enough to switch", async () => {
    const i18n = await createI18n("es", { en: { title: "Notes" } }, { "harness:title": "Notas" });
    expect(i18n.resolvedLanguage).toBe("es");
    expect(i18n.t("harness:title")).toBe("Notas");
  });

  it("English never takes generated strings", async () => {
    const i18n = await createI18n("en", {}, { "core:chat.send": "Enviar" });
    expect(i18n.t("chat.send")).toBe("Send");
    expect(Object.keys(i18n.options.resources ?? {})).toEqual(["en"]);
  });
});
