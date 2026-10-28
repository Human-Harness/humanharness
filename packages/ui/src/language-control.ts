import { useCallback, useEffect, useRef, useState } from "react";
import type { i18n as I18n } from "i18next";
import type { Language } from "@humanharness/harness-sdk/language";
import { hasResources, toResources } from "@humanharness/i18n/translate";
import type { GeneratedStrings, HarnessClient, LanguageState } from "./client";

export interface LanguageControl {
  /** The last state asked for or pushed; null until `load()` or a push (and always without `client.language`, D0). */
  view: LanguageState | null;
  /** Asks main for the state. Only the Language row, the picker and the offer card call it: asking runs an engine check. */
  load(): void;
  choose(tag: Language): Promise<"switched" | "needs-translation" | "failed">;
  /** Starts a run; false when nothing started (including a cancel while it was preparing). */
  translate(tag: Language): Promise<boolean>;
  cancel(): void;
}

/** English and its variants (en-GB) show the bundled English and never take generated strings (D0). */
const isEnglish = (tag: string): boolean => tag === "en" || tag.startsWith("en-");

/**
 * Puts `strings` under `tag` in i18next, replacing what it had there, and shows it (English: just switches back).
 * A non-English set with nothing left after the checks (empty, legal-only) changes nothing and answers false:
 * switching would turn dates and numbers while every text stays English.
 */
export async function applyLanguage(i18n: I18n, tag: Language, strings: GeneratedStrings): Promise<boolean> {
  if (!isEnglish(tag)) {
    const resources = toResources(strings);
    if (!hasResources(resources)) return false;
    const { core, harness } = resources;
    i18n.removeResourceBundle(tag, "core");
    i18n.removeResourceBundle(tag, "harness");
    i18n.addResourceBundle(tag, "core", core);
    i18n.addResourceBundle(tag, "harness", harness);
  }
  await i18n.changeLanguage(tag);
  return true;
}

/**
 * Language on demand in the window (spec §3–§6): the state, choosing, translating, and the live switch at a
 * run's end. It asks main for nothing by itself: the state comes from `load()` or a push. Each switch drops
 * the answers of the switches before it, so a late answer never puts back a language the person left.
 */
export function useLanguage(client: HarnessClient, i18n: I18n | null, harness: Record<string, unknown>, onSwitched: (tag: Language) => void): LanguageControl {
  const [view, setView] = useState<LanguageState | null>(null);
  const harnessRef = useRef(harness);
  harnessRef.current = harness;
  const switchedRef = useRef(onSwitched);
  switchedRef.current = onSwitched;
  /** Bumped by every switch (and on unmount): a switch whose number moved on is dropped. */
  const switchSeq = useRef(0);
  /** Bumped by every state ask and push: an asked state that a newer one passed is dropped. */
  const viewSeq = useRef(0);
  /** Whether the last push showed a run going: only its end (running → done) loads the new strings. A ref, so a resubscribe keeps it. */
  const runningRef = useRef(false);
  const lang = client.language;

  const switchTo = useCallback(
    async (tag: Language, given?: GeneratedStrings): Promise<boolean> => {
      if (!i18n || !lang) return false;
      const mine = ++switchSeq.current;
      let strings = given ?? {};
      if (!given && !isEnglish(tag)) strings = await lang.strings(tag, harnessRef.current).catch(() => ({}));
      if (mine !== switchSeq.current) return false;
      // A failed or empty answer for a non-English tag switches nothing (applyLanguage answers false).
      if (!(await applyLanguage(i18n, tag, strings))) return false;
      if (mine !== switchSeq.current) return false;
      switchedRef.current(tag);
      return true;
    },
    [i18n, lang],
  );

  useEffect(() => {
    if (!lang) return;
    let live = true;
    const off = lang.onChange((s) => {
      if (!live) return;
      viewSeq.current++;
      setView(s);
      const ended = runningRef.current && s.run?.status === "done";
      runningRef.current = s.run?.status === "running";
      // Always load at a run's end, even when i18next already names the language: a saved language with no
      // cache starts as `lng` with English resources, and a run for new texts must add them.
      if (ended && s.run && s.language === s.run.tag && i18n) void switchTo(s.language);
    });
    return () => {
      live = false;
      switchSeq.current++;
      viewSeq.current++;
      off();
    };
  }, [lang, i18n, switchTo]);

  const load = useCallback(() => {
    if (!lang) return;
    const mine = ++viewSeq.current;
    lang.state(harnessRef.current).then(
      (s) => {
        if (s && mine === viewSeq.current) setView(s);
      },
      () => undefined,
    );
  }, [lang]);

  return {
    view,
    load,
    choose: async (tag) => {
      if (!lang) return "failed";
      const r = await lang.choose(tag, harnessRef.current).catch(() => ({ ok: false, reason: "failed" }) as const);
      if (r.ok) {
        if (!(await switchTo(r.language, r.strings))) return "failed";
        viewSeq.current++;
        setView((v) => v && { ...v, language: r.language, missing: 0 });
        return "switched";
      }
      return r.reason === "needs-translation" ? "needs-translation" : "failed";
    },
    translate: async (tag) => {
      if (!lang) return false;
      const r = await lang.translate(tag, harnessRef.current).catch(() => ({ ok: false }) as const);
      return r.ok;
    },
    cancel: () => void lang?.cancel().catch(() => undefined),
  };
}
