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
