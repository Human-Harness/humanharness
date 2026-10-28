// No Node imports here: the screens import this file (`@humanharness/harness-sdk/language`).

/** A BCP 47 language tag ("en", "pt-BR"). The app ships in English; other languages are generated on demand (spec 5 §1). */
export type Language = string;
export const DEFAULT_LANGUAGE: Language = "en";

/** The canonical form of `tag` ("pt-br" → "pt-BR"), or null when it isn't a language tag. */
export function canonicalLanguage(tag: string): Language | null {
  try {
    return Intl.getCanonicalLocales(tag)[0] ?? null;
  } catch {
    return null;
  }
}

/** `tag`'s name in the language `display` ("pt-BR" → "Brazilian Portuguese"); the tag itself when there is no name. */
export function languageName(tag: Language, display: Language = DEFAULT_LANGUAGE): string {
  try {
    return new Intl.DisplayNames([display], { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

/** Right-to-left languages the picker never offers (spec D9), when ICU doesn't say. */
const RTL = new Set(["ar", "he", "fa", "ur", "ps", "yi", "dv", "ckb", "sd", "ug"]);

/** Common languages the picker lists (spec §2: `Intl.supportedValuesOf` has no language list). All left-to-right. */
export const COMMON_LANGUAGES: readonly Language[] = [
  "en", "es", "pt-BR", "pt-PT", "fr", "de", "it", "nl", "ca", "gl", "eu", "pl", "cs", "sk", "hu", "ro", "bg", "hr", "sr", "sl",
  "el", "uk", "ru", "lt", "lv", "et", "fi", "sv", "da", "nb", "is", "tr", "id", "ms", "fil", "vi", "th", "hi", "bn", "ta", "te",
  "mr", "sw", "ja", "ko", "zh-Hans", "zh-Hant",
];

/** Whether `tag` is written right to left: ICU's text info when it has one, else the spec's fixed list. */
export function isRightToLeft(tag: Language): boolean {
  try {
    const locale = new Intl.Locale(tag) as Intl.Locale & { getTextInfo?: () => { direction?: string }; textInfo?: { direction?: string } };
    const direction = locale.getTextInfo?.().direction ?? locale.textInfo?.direction;
    return direction === "rtl" || RTL.has(locale.language);
  } catch {
    return false;
  }
}

/** A tag the app can offer and translate into: canonical (at most 35 characters) and left to right. */
export function offeredLanguage(tag: unknown): tag is Language {
  return typeof tag === "string" && tag.length <= 35 && canonicalLanguage(tag) === tag && !isRightToLeft(tag);
}

/** The picker's list: English first, then the common languages and `extra` (cached, saved, suggested), by English name. */
export function pickerLanguages(extra: readonly string[] = []): Language[] {
  const rest = [...new Set([...COMMON_LANGUAGES, ...extra])].filter((t) => t !== DEFAULT_LANGUAGE && offeredLanguage(t));
  rest.sort((a, b) => languageName(a).localeCompare(languageName(b), "en"));
  return [DEFAULT_LANGUAGE, ...rest];
}
