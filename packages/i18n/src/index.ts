import i18next, { type i18n } from "i18next";
import type { Language } from "@humanharness/harness-sdk";
import en from "./locales/en.json";
import es from "./locales/es.json";

export type Locales = Partial<Record<Language, Record<string, unknown>>>;

export const CORE_LOCALES: Record<Language, Record<string, unknown>> = { es, en };

/** Core strings in the default namespace; the harness's own strings under `harness:`. */
export async function createI18n(language: Language, harnessLocales: Locales = {}): Promise<i18n> {
  const instance = i18next.createInstance();
  await instance.init({
    lng: language,
    fallbackLng: "en",
    defaultNS: "core",
    ns: ["core", "harness"],
    interpolation: { escapeValue: false },
    resources: {
      es: { core: CORE_LOCALES.es, harness: harnessLocales.es ?? {} },
      en: { core: CORE_LOCALES.en, harness: harnessLocales.en ?? {} },
    },
  });
  return instance;
}
