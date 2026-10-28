import { offeredLanguage } from "@humanharness/harness-sdk/language";
import type { TranslationService } from "./translation";

export const LANGUAGE_CHANNELS = ["hh:languageState", "hh:languageChoose", "hh:languageTranslate", "hh:languageCancel", "hh:languageStrings"] as const;
export type LanguageChannel = (typeof LANGUAGE_CHANNELS)[number];

/** The window's harness map: a plain object, else none (the service bounds and flattens it). */
const harnessMap = (raw: unknown): object => (typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {});

/**
 * The `hh:language*` handlers (language spec). Every renderer argument is checked here first (a tag the app can't
 * offer never reaches the service) and every answer is data; a throw is a bug, logged, answered with a fallback.
 */
export function languageHandlers(
  svc: Pick<TranslationService, "state" | "choose" | "translate" | "cancel" | "strings">,
): Record<LanguageChannel, (...args: unknown[]) => Promise<unknown>> {
  const call = (fn: () => unknown, fallback: unknown): Promise<unknown> =>
    Promise.resolve()
      .then(fn)
      .catch((err: unknown) => {
        console.error("A language call failed", err);
        return fallback;
      });
  const failed = { ok: false as const, reason: "failed" as const };
  const invalid = { ok: false as const, reason: "invalid" as const };
  return {
    "hh:languageState": (harness) => call(() => svc.state(harnessMap(harness)), null),
    "hh:languageChoose": (tag, harness) =>
      offeredLanguage(tag) ? call(() => svc.choose(tag, harnessMap(harness)), failed) : Promise.resolve(invalid),
    "hh:languageTranslate": (tag, harness) =>
      offeredLanguage(tag) ? call(() => svc.translate(tag, harnessMap(harness)), failed) : Promise.resolve(invalid),
    "hh:languageCancel": () => call(() => svc.cancel(), { ok: false }),
    "hh:languageStrings": (tag, harness) =>
      offeredLanguage(tag) ? call(() => svc.strings(tag, harnessMap(harness)), {}) : Promise.resolve({}),
  };
}
