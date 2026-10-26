import { DEFAULT_LANGUAGE, type Language, canonicalLanguage, languageName } from "@humanharness/harness-sdk/language";

/** The system's language as a canonical tag; English when it gives none. Saved as the person's language at setup. */
export function systemLanguage(): Language {
  return canonicalLanguage(navigator.language || "") ?? DEFAULT_LANGUAGE;
}

/** The language the text is shown in: dates and numbers follow it so they read like the sentence around them. */
export function shownLanguage(i18n: { resolvedLanguage?: string }): string {
  return i18n.resolvedLanguage ?? DEFAULT_LANGUAGE;
}

/** `tag`'s name in itself, first letter up ("es" → "Español"). */
export function ownName(tag: Language): string {
  const name = languageName(tag, tag);
  try {
    return name.charAt(0).toLocaleUpperCase(tag) + name.slice(1);
  } catch {
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
}
