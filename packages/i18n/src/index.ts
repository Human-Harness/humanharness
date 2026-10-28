import i18next, { type i18n } from "i18next";
import type { Language } from "@humanharness/harness-sdk";
import en from "./locales/en.json";
import { hasResources, toResources } from "./translate";

/** A harness's own strings by language. A harness ships `en` only; other languages come from the app (spec 5 D1). */
export type Locales = Partial<Record<Language, Record<string, unknown>>>;

export const CORE_LOCALES: Record<"en", Record<string, unknown>> = { en };

/** Translated strings from the cache, flat and namespaced ("core:chat.send", "harness:title"). */
export type GeneratedStrings = Record<string, string>;

/**
 * Core strings in the default namespace; the harness's own strings under `harness:`. A language with no
 * strings shows English: `resolvedLanguage` is "en", the language dates and numbers follow too.
 * `generated` (plan 5b) holds the cached translation of `language`: absent or empty, the resources are
 * English only (D0). Legal keys in it are dropped, so they show in English.
 */
export async function createI18n(language: Language, harnessLocales: Locales = {}, generated: GeneratedStrings = {}): Promise<i18n> {
  const instance = i18next.createInstance();
  const translated = language !== "en" ? toResources(generated) : null;
  // Only a set that kept at least one key after toResources switches: a legal-only or dropped set adds nothing,
  // so resolvedLanguage stays "en" and dates and numbers stay English with the texts.
  const extra = translated && hasResources(translated) ? { [language]: translated } : {};
  await instance.init({
    lng: language,
    fallbackLng: "en",
    defaultNS: "core",
    ns: ["core", "harness"],
    interpolation: { escapeValue: false },
    // <Trans> turns only the tags its `components` name into elements; any other tag (even <strong>, <br>) shows as text.
    react: { transKeepBasicHtmlNodesFor: [] },
    resources: { en: { core: CORE_LOCALES.en, harness: harnessLocales.en ?? {} }, ...extra },
  });
  return instance;
}
