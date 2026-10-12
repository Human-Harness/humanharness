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
  it("has the models, checkpoint and fallback strings", async () => {
    const es = await createI18n("es");
    expect(es.t("settings.tabs.models")).toBe("Modelos");
    expect(es.t("models.tier.custom")).toBe("Personalizado");
    expect(es.t("models.fallbackNotice", { model: "opus", tier: "Estándar" })).toBe("Tu plan no incluye opus; usamos el nivel Estándar.");
    expect(es.t("flow.checkpoint")).toBe("Guardando lo importante…");
    const en = await createI18n("en");
    expect(en.t("models.changed", { tier: "Standard" })).toBe("Changed · recommended: Standard");
    expect(en.t("models.contextTitle", { used: "170,000", cap: "200,000" })).toBe("170,000 of 200,000 tokens");
  });

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
      "You use your own Anthropic account (Claude Pro or Max plan) under their terms. This app is not made or endorsed by Anthropic.",
    );
    expect(en.t("usage.window", { label: "5 h", percent: 16 })).toBe("5 h: 16% used");
    expect(en.t("preflight.estimate", { action: "Research", estimate: 8, left: 84 })).toBe(
      "\"Research\" usually uses about 8% of your 5-hour window. You have 84% left.",
    );
    expect(en.t("preflight.hint", { action: "Research", left: 84 })).toBe(
      "\"Research\" can use a large part of your 5-hour window. You have 84% left.",
    );
    expect(en.t("home.usage", { label: "5 h", percent: 42 })).toBe("5 h · 42%");
    expect(en.t("usage.estimate", { percent: 8 })).toBe("Usually about 8% of the 5-hour window");
    expect(en.t("engine.loggingIn")).toBe("Finish signing in using your browser…");
    expect(en.t("engine.noticeProvider", { engine: "Claude", provider: "Anthropic", where: "Anthropic, USA" })).toBe(
      "Claude is a service of Anthropic. What you write here, and the files in your folder that the AI reads, are sent to Anthropic, USA.",
    );
    expect(en.t("settings.madeBy", { author: "Marco" })).toBe("Made by Marco with Human Harness");
    const es = await createI18n("es");
    expect(es.t("settings.tabs.engine")).toBe("Motor");
    expect(es.t("engine.accept")).toBe("Entiendo y acepto");
    expect(es.t("errors.fix.session-expired")).toBe("Volver a entrar");
    expect(es.t("usage.window", { label: "5 h", percent: 16 })).toBe("5 h: 16 % usado");
    expect(es.t("engine.noticeProvider", { engine: "Claude", provider: "Anthropic", where: "Anthropic, EE. UU." })).toBe(
      "Claude es un servicio de Anthropic. Lo que escribas acá, y los archivos de tu carpeta que lea la IA, se envían a Anthropic, EE. UU. para ser procesados.",
    );
  });

  it("has the flow, choices and notes strings, with plural key points", async () => {
    const es = await createI18n("es");
    expect(es.t("flow.path")).toBe("Recorrido");
    expect(es.t("flow.covered")).toBe("Lo que ya quedó claro");
    expect(es.t("flow.readOnly")).toBe("Solo lectura: la IA no cambia nada acá");
    expect(es.t("choices.title")).toBe("¿Cómo seguimos?");
    expect(es.t("notes.resume")).toBe("Retomar este tema");
    expect(es.t("notes.open")).toBe("Abrir el archivo");
    expect(es.t("notes.keyPoints", { count: 1 })).toBe("1 idea clave");
    expect(es.t("notes.keyPoints", { count: 4 })).toBe("4 ideas clave");
    expect(es.t("notes.resumeQuestion", { title: "Motores" })).toBe("Retomemos el tema «Motores».");
    const en = await createI18n("en");
    expect(en.t("notes.keyPoints", { count: 2 })).toBe("2 key points");
    expect(en.t("notes.savings")).toBe("The next question starts from your summaries instead of re-reading the code.");
    expect(en.t("notes.resumeQuestion", { title: "Engines" })).toBe('Let\'s pick up "Engines" again.');
  });

  it("never states token savings as numbers (spec §5.3)", () => {
    for (const language of ["es", "en"] as const) {
      expect(JSON.stringify(CORE_LOCALES[language].notes)).not.toMatch(/token|\d\s?k\b/i);
    }
  });
});
