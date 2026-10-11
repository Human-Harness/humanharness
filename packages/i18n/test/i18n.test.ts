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
    expect(i18n.t("setup.title", { name: "Demo" })).toBe("Preparemos Demo");
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
});
