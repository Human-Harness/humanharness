import { describe, expect, it } from "vitest";
import { CORE_LOCALES, createI18n } from "../src";

function keys(o: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(o).flatMap(([k, v]) =>
    typeof v === "object" && v !== null ? keys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe("core locales", () => {
  it("es and en have exactly the same keys", () => {
    expect(keys(CORE_LOCALES.es).sort()).toEqual(keys(CORE_LOCALES.en).sort());
  });
});

describe("createI18n", () => {
  it("translates core keys with interpolation", async () => {
    const i18n = await createI18n("es");
    expect(i18n.t("home.start", { name: "Demo" })).toBe("Iniciar Demo");
    expect(i18n.t("errors.engine-not-installed", { engine: "Claude" })).toBe("No encuentro Claude en esta compu.");
  });

  it("adds the harness's own strings under the harness namespace, falling back to English", async () => {
    const i18n = await createI18n("es", { es: { title: "Notas" }, en: { title: "Notes", only: "English only" } });
    expect(i18n.t("harness:title")).toBe("Notas");
    expect(i18n.t("harness:only")).toBe("English only");
  });

  it("switches language", async () => {
    const i18n = await createI18n("es");
    await i18n.changeLanguage("en");
    expect(i18n.t("chat.send")).toBe("Send");
  });

  it("has the Home, Settings, legal notice, usage and pre-flight strings in both languages", async () => {
    const en = await createI18n("en");
    expect(en.t("engine.noticeAccount", { provider: "Anthropic", plan: "Claude Pro or Max plan" })).toBe(
      "You use your own Anthropic account and plan (Claude Pro or Max plan) under their terms. This app is not made or endorsed by Anthropic.",
    );
    expect(en.t("usage.window", { label: "5 h", percent: 16 })).toBe("5 h: 16 % used");
    expect(en.t("preflight.estimate", { action: "Research", estimate: 8, left: 84 })).toBe(
      "\"Research\" usually uses about 8 % of your 5-hour window. You have 84 % left.",
    );
    expect(en.t("settings.madeBy", { author: "Marco" })).toBe("Made by Marco with Human Harness");
    const es = await createI18n("es");
    expect(es.t("settings.tabs.engine")).toBe("Motor");
    expect(es.t("engine.accept")).toBe("Entiendo y acepto");
    expect(es.t("errors.fix.session-expired")).toBe("Volver a entrar");
  });
});
