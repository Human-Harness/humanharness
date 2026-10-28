import type { GeneratedStrings, LanguageChoose, LanguageClient, LanguageStart, LanguageState } from "@humanharness/ui/client";
import type { Invoke } from "./context";

type Subscribe = (channel: string, listener: (value: unknown) => void) => () => void;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** A minimal shape check: enough that the screens can read it without a throw. */
const isState = (v: unknown): v is LanguageState =>
  isObject(v) &&
  typeof v.language === "string" &&
  Array.isArray(v.cached) &&
  typeof v.missing === "number" &&
  (v.run === null || isObject(v.run));
const isResult = (v: unknown): v is { ok: unknown } => isObject(v) && "ok" in v;
/** Only the string values of a strings map (anything else would reach i18next). */
const onlyStrings = (v: unknown): GeneratedStrings =>
  isObject(v) ? Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === "string")) : {};

/** `client.language` (language spec): every answer is data, a rejected invoke included; the same fallbacks as main. */
export function languageClient(invoke: Invoke, subscribe: Subscribe): LanguageClient {
  const ask = <T>(fallback: T, ok: (v: unknown) => boolean, channel: string, ...args: unknown[]): Promise<T> =>
    invoke(channel, ...args).then(
      (v) => (ok(v) ? (v as T) : fallback),
      () => fallback,
    );
  const failed = { ok: false as const, reason: "failed" as const };
  return {
    state: (harness) => ask<LanguageState | null>(null, isState, "hh:languageState", harness),
    choose: (tag, harness) =>
      ask<LanguageChoose>(failed, isResult, "hh:languageChoose", tag, harness).then((r) => (r.ok ? { ...r, strings: onlyStrings(r.strings) } : r)),
    translate: (tag, harness) => ask<LanguageStart>(failed, isResult, "hh:languageTranslate", tag, harness),
    cancel: () => ask<{ ok: boolean }>({ ok: false }, isResult, "hh:languageCancel"),
    strings: (tag, harness) => ask<unknown>({}, isObject, "hh:languageStrings", tag, harness).then(onlyStrings),
    onChange: (listener) => subscribe("hh:language", (v) => (isState(v) ? listener(v) : undefined)),
  };
}
