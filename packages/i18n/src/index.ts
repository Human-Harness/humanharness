import i18next, { type i18n } from "i18next";
import type { Language } from "@humanharness/harness-sdk";
import en from "./locales/en.json";

/** A harness's own strings by language. A harness ships `en` only; other languages come from the app (spec 5 D1). */
export type Locales = Partial<Record<Language, Record<string, unknown>>>;

export const CORE_LOCALES: Record<"en", Record<string, unknown>> = { en };

/**
 * Core strings in the default namespace; the harness's own strings under `harness:`. A language with no
 * strings shows English (`resolvedLanguage` is "en") while `language` keeps the tag for dates and numbers.
 */
export async function createI18n(language: Language, harnessLocales: Locales = {}): Promise<i18n> {
  const instance = i18next.createInstance();
  await instance.init({
    lng: language,
    fallbackLng: "en",
    defaultNS: "core",
    ns: ["core", "harness"],
    interpolation: { escapeValue: false },
    resources: { en: { core: CORE_LOCALES.en, harness: harnessLocales.en ?? {} } },
  });
  return instance;
}
