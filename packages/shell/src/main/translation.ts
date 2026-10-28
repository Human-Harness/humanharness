import { type Language, offeredLanguage } from "@humanharness/harness-sdk/language";
import {
  type PluralCategory,
  type TranslateItem,
  type Translated,
  checkTranslation,
  englishItems,
  flattenStrings,
  pluralForms,
  toResourceEntries,
} from "@humanharness/i18n/translate";
import type { EngineError, SystemTaskResult } from "@humanharness/runtime";
import type { GeneratedStrings, LanguageChoose, LanguageRun, LanguageStart, LanguageState } from "@humanharness/ui/client";
import { translatePrompt } from "./task-prompts";
import { type CacheFile, type TranslationCache, safeKey } from "./translation-cache";

/** Runs one translation session (runSystemSession bound to the engine, model and log in index.ts). */
export type Runner = (o: {
  next: (turn: number) => Promise<string | null>;
  handle: (request: unknown) => Promise<unknown>;
  onTurn: (result: SystemTaskResult, turn: number) => Promise<void>;
  signal: AbortSignal;
  /** The language being translated into (for the usage log). */
  tag: Language;
}) => Promise<{ ok: boolean; turns: number; error?: EngineError }>;

export interface TranslationDeps {
  cache: TranslationCache;
  /** The core's English, flattened (CORE_EN). */
  core: Record<string, string>;
  /** The harness's `tone` (manifest), or none: neutral. */
  tone?: string;
  language(): Promise<Language>;
  saveLanguage(tag: Language): Promise<void>;
  /** Cheap: whether a run could start now (spec §3); "no-engine" also covers an engine with a problem. */
  available(): Promise<true | "no-engine" | "mock">;
  /** The engine's name and a runner; null when the engine can't run after all. */
  prepare(): Promise<{ engineName: string; run: Runner } | null>;
  engineName(): Promise<string | undefined>;
  send(state: LanguageState): void;
  /** Keys per batch (plan Q4: 100). */
  batchSize?: number;
}

/** Turns per run, retries included (runSystemSession stops there too). */
const MAX_BATCHES = 60;
/** Keys sent in one run. */
const MAX_KEYS = 5000;
/** Keys read from one save_translation call; the rest are ignored. */
const MAX_SAVE_KEYS = 150;
/** Refusals named in the tool's answer. */
const MAX_REFUSALS = 20;
/** What the agent reads once the cache can't be written: neutral, no path. */
const STORE_FAILED = "The app could not store this batch. Stop now.";

/** English and its variants (en-GB) never get generated strings: the app's own English shows. */
const isEnglish = (tag: string): boolean => tag === "en" || tag.startsWith("en-");

/**
 * Sorts the items against a loaded cache: kept (valid for this English), missing. A key that failed twice for this
 * English is given up: it stays English and is in neither. `TranslationCache.load` has already checked every entry
 * against `items` (hash and `checkTranslation`), so an entry with the item's hash is kept as it is.
 */
export function classify(items: readonly TranslateItem[], file: CacheFile) {
  const kept = new Map<string, Translated>();
  const missing: TranslateItem[] = [];
  for (const item of items) {
    const e = file.entries[item.key];
    if (e && e.en === item.hash) kept.set(item.key, e.value);
    else if (!(file.failed[item.key]?.en === item.hash && file.failed[item.key].count >= 2)) missing.push(item);
  }
  return { kept, missing };
}

/**
 * Language on demand in the main process (language spec §4–§6, §9): the state the window shows, switching to English
 * or a complete translation, and the translation run itself. One run at a time; a run never changes the saved language
 * until it completes, and a cancelled or failed one never does (plan Q6: "Try again" resumes). Every public method
 * answers data.
 */
export class TranslationService {
  private run: LanguageRun | null = null;
  private controller: AbortController | null = null;
  private running: Promise<void> | null = null;
  /** The last state sent, the fallback when a fresh one can't be read. */
  private last: LanguageState | null = null;
  /** Bumped by cancel() and stop(): a start whose engine was still being prepared then never runs. */
  private generation = 0;

  constructor(private readonly d: TranslationDeps) {}

  /** What a run would send for this app: core plus the window's harness map (bounded by flattenStrings). */
  private items(harnessRaw: unknown): TranslateItem[] {
    return englishItems(this.d.core, flattenStrings(harnessRaw));
  }

  private load(tag: Language, items: readonly TranslateItem[]): Promise<CacheFile> {
    return this.d.cache.load(tag, items);
  }

  async state(harnessRaw: unknown): Promise<LanguageState> {
    return this.stateOf(this.items(harnessRaw));
  }

  private async stateOf(items: readonly TranslateItem[]): Promise<LanguageState> {
    const language = await this.d.language();
    const cached = await Promise.all(
      (await this.d.cache.tags()).map(async (tag) => ({ tag, complete: classify(items, await this.load(tag, items)).missing.length === 0 })),
    );
    const missing = isEnglish(language) || !offeredLanguage(language) ? 0 : classify(items, await this.load(language, items)).missing.length;
    const engineName = await this.d.engineName().catch(() => undefined);
    const canTranslate = await this.d.available().catch(() => "no-engine" as const);
    return { language, cached, missing, canTranslate, ...(engineName ? { engineName } : {}), run: this.run };
  }

  async strings(tag: unknown, harnessRaw: unknown): Promise<GeneratedStrings> {
    if (!offeredLanguage(tag) || isEnglish(tag)) return {};
    const items = this.items(harnessRaw);
    const { kept } = classify(items, await this.load(tag, items));
    return Object.assign({}, ...[...kept].map(([k, v]) => toResourceEntries(k, v)));
  }

  async choose(tag: unknown, harnessRaw: unknown): Promise<LanguageChoose> {
    if (!offeredLanguage(tag)) return { ok: false, reason: "invalid" };
    if (this.running) return { ok: false, reason: "busy" };
    if (!isEnglish(tag)) {
      const items = this.items(harnessRaw);
      if (classify(items, await this.load(tag, items)).missing.length > 0) return { ok: false, reason: "needs-translation" };
    }
    if ((await this.d.language()) !== tag) await this.d.saveLanguage(tag);
    return { ok: true, language: tag, strings: await this.strings(tag, harnessRaw) };
  }

  async translate(tag: unknown, harnessRaw: unknown): Promise<LanguageStart> {
    if (!offeredLanguage(tag) || isEnglish(tag)) return { ok: false, reason: "invalid" };
    if (this.running) return { ok: false, reason: "busy" };
    const can = await this.d.available().catch(() => "no-engine" as const);
    if (can !== true) return { ok: false, reason: can };
    const generation = this.generation;
    const ready = await this.d.prepare().catch(() => null);
    // A cancel or stop came while the engine was being prepared: the run doesn't start.
    if (generation !== this.generation) return { ok: false, reason: "failed" };
    if (!ready) return { ok: false, reason: "no-engine" };
    // Another start may have won while the engine was being prepared.
    if (this.running) return { ok: false, reason: "busy" };
    const items = this.items(harnessRaw);
    const controller = new AbortController();
    this.controller = controller;
    this.running = this.go(tag, items, ready.run, controller.signal).finally(() => {
      this.running = null;
      this.controller = null;
    });
    return { ok: true };
  }

  async cancel(): Promise<{ ok: boolean }> {
    this.generation++;
    this.controller?.abort();
    return { ok: true };
  }

  /** Quitting or an engine change: the run stops, what it saved stays. */
  async stop(): Promise<void> {
    this.generation++;
    this.controller?.abort();
    await this.running;
  }

  /** Resolves once no run is going (tests). */
  async settled(): Promise<void> {
    while (this.running) await this.running;
  }

  private async push(items: readonly TranslateItem[]): Promise<void> {
    let state: LanguageState;
    try {
      state = await this.stateOf(items);
    } catch (err) {
      console.error("Could not read the language state", err);
      state = { ...(this.last ?? { language: "en", cached: [], missing: 0, canTranslate: "no-engine" }), run: this.run };
    }
    this.last = state;
    this.d.send(state);
  }

  private async go(tag: Language, items: TranslateItem[], run: Runner, signal: AbortSignal): Promise<void> {
    const forms: readonly PluralCategory[] = pluralForms(tag);
    let file: CacheFile;
    let missing: TranslateItem[];
    try {
      file = await this.load(tag, items);
      missing = classify(items, file).missing.slice(0, MAX_KEYS);
    } catch (err) {
      console.error("Could not read the translation cache", err);
      this.run = { tag, done: 0, total: 0, status: "failed", reason: "engine" };
      await this.push(items);
      return;
    }
    const size = Math.max(1, Math.min(MAX_SAVE_KEYS, this.d.batchSize ?? 100));
    const batches: TranslateItem[][] = [];
    for (let i = 0; i < missing.length && batches.length < MAX_BATCHES; i += size) batches.push(missing.slice(i, i + size));
    /** Batches planned so far, retries included: never more than MAX_BATCHES. */
    let planned = batches.length;
    let retry: TranslateItem[] = [];
    let retried = false;
    // The batch the agent is answering, and the keys it already answered in it; null between turns, so a late save
    // (after its turn ended, or after the run) is refused instead of landing in the next batch.
    let current: Map<string, TranslateItem> | null = null;
    let answered = new Set<string>();
    // A cache write that fails (disk full, no permission, the size cap) ends the run as failed: the language never
    // switches to a translation that isn't on disk. `halt` stops the session without counting as the person's cancel.
    let writeFailed = false;
    const halt = new AbortController();
    const runSignal = AbortSignal.any([signal, halt.signal]);
    const store = async (): Promise<boolean> => {
      if (writeFailed) return false;
      try {
        await this.d.cache.save(file);
        return true;
      } catch (err) {
        console.error("Could not save the translation", err);
        writeFailed = true;
        current = null;
        halt.abort();
        return false;
      }
    };
    this.run = { tag, done: 0, total: batches.length, status: "running" };
    await this.push(items);

    const fail = (key: string, item: TranslateItem) => {
      const count = (file.failed[key]?.en === item.hash ? file.failed[key].count : 0) + 1;
      file.failed[key] = { en: item.hash, count: Math.min(2, count) };
      delete file.entries[key];
      // A first failure is sent once more in a later batch of this run (spec §6); a second one is final.
      if (count < 2 && !retried) retry.push(item);
    };

    const next = async (turn: number): Promise<string | null> => {
      let batch = batches.shift();
      if (!batch && retry.length > 0 && !retried) {
        retried = true;
        for (let i = 0; i < retry.length && planned < MAX_BATCHES; i += size, planned++) batches.push(retry.slice(i, i + size));
        retry = [];
        this.run = { ...this.run!, total: planned };
        batch = batches.shift();
      }
      if (!batch || runSignal.aborted) return null;
      current = new Map(batch.map((it) => [it.key, it]));
      answered = new Set();
      const map = Object.fromEntries(batch.map((it) => [it.key, it.en]));
      return translatePrompt({ first: turn === 0, language: tag, ...(this.d.tone ? { tone: this.d.tone } : {}), forms, batch: map });
    };

    // save_translation: untrusted agent output. Only keys of the open batch, each re-checked (safe key, the same
    // placeholders and tags, lengths for this English), are kept; the answer the agent reads is bounded.
    const handle = async (request: unknown): Promise<unknown> => {
      const r = typeof request === "object" && request !== null ? (request as { op?: unknown; strings?: unknown }) : {};
      if (r.op !== "save" || typeof r.strings !== "object" || r.strings === null || Array.isArray(r.strings)) throw new Error("Unknown request");
      if (writeFailed) return STORE_FAILED;
      const open = current;
      if (!open) throw new Error("No batch is open: this translation turn has ended.");
      const entries = Object.entries(r.strings as Record<string, unknown>).slice(0, MAX_SAVE_KEYS);
      const refused: string[] = [];
      let kept = 0;
      for (const [key, value] of entries) {
        const item = safeKey(key) ? open.get(key) : undefined;
        if (!item) {
          refused.push(`${key.slice(0, 80)} (not in this batch)`);
          continue;
        }
        if (answered.has(key)) {
          refused.push(`${key} (already answered)`);
          continue;
        }
        answered.add(key);
        const c = checkTranslation(item, value, forms);
        if (c.ok) {
          file.entries[key] = { en: item.hash, value: c.value };
          delete file.failed[key];
          kept++;
        } else {
          fail(key, item);
          refused.push(`${key} (${c.reason})`);
        }
      }
      // The fs error (it names the userData path) is logged, never handed to the agent.
      if ((kept > 0 || refused.length > 0) && !(await store())) return STORE_FAILED;
      const more = refused.length > MAX_REFUSALS ? ` and ${refused.length - MAX_REFUSALS} more` : "";
      return refused.length === 0 ? `Saved ${kept}.` : `Saved ${kept}. Not kept: ${refused.slice(0, MAX_REFUSALS).join(", ")}${more}.`;
    };

    const onTurn = async (result: SystemTaskResult) => {
      const open = current;
      current = null;
      // A failed turn leaves its unanswered keys missing: "Try again" sends them (Q6).
      if (!open || !result.ok || writeFailed) return;
      // A key the agent left out counts as a failure, like a refused one.
      for (const [key, item] of open) if (!answered.has(key)) fail(key, item);
      if (!(await store())) return;
      this.run = { ...this.run!, done: this.run!.done + 1 };
      await this.push(items);
    };

    let outcome: Awaited<ReturnType<Runner>>;
    try {
      outcome = batches.length === 0 ? { ok: true, turns: 0 } : await run({ next, handle, onTurn, signal: runSignal, tag });
    } catch (err) {
      console.error("The translation run failed", err);
      outcome = { ok: false, turns: 0, error: { code: "agent-crashed" } };
    }
    current = null;
    if (outcome.ok && !runSignal.aborted && !writeFailed) {
      await this.d.saveLanguage(tag).catch((err: unknown) => console.error("Could not save the language", err));
      this.run = { ...this.run!, status: "done" };
    } else {
      const code = outcome.error?.code;
      // Only the person's cancel (or stop) is "cancelled": a turn timeout also reports code "cancelled", and is a failure.
      const cancelled = signal.aborted && !writeFailed;
      this.run = { ...this.run!, status: cancelled ? "cancelled" : "failed", ...(cancelled ? {} : { reason: code === "out-of-quota" ? "quota" : "engine" }) };
    }
    await this.push(items);
  }
}
