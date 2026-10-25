import { DEFAULT_LANGUAGE, type Language, canonicalLanguage } from "@humanharness/harness-sdk";

/** The system's language as a canonical tag; English when it gives none. Saved as the person's language at setup. */
export function systemLanguage(): Language {
  return canonicalLanguage(navigator.language || "") ?? DEFAULT_LANGUAGE;
}

/** `tag`'s name in itself, first letter up ("es" → "Español"). */
export function ownName(tag: Language): string {
  const name = new Intl.DisplayNames([tag], { type: "language" }).of(tag) ?? tag;
  return name.charAt(0).toLocaleUpperCase(tag) + name.slice(1);
}
