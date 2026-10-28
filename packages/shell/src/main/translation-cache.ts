import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { type Language, offeredLanguage } from "@humanharness/harness-sdk/language";
import { type TranslateItem, type Translated, checkTranslation, isLegalKey, pluralForms } from "@humanharness/i18n/translate";

export interface CacheFile {
  version: 1;
  tag: Language;
  /** By namespaced key: the hash of the English it was made from, and the translation. */
  entries: Record<string, { en: string; value: Translated }>;
  /** Keys that failed validation for this English: twice is final (spec §6). */
  failed: Record<string, { en: string; count: number }>;
}

export const emptyCache = (tag: Language): CacheFile => ({ version: 1, tag, entries: {}, failed: {} });
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_ENTRIES = 10_000;
const FORMS = new Set(["zero", "one", "two", "few", "many", "other"]);
const KEY = /^(core|harness):[A-Za-z0-9_.-]{1,200}$/;
const UNSAFE = new Set(["__proto__", "constructor", "prototype"]);
/** A namespaced key the app could have written: no prototype or empty segment, never a legal text. */
const safeKey = (k: string): boolean => {
  if (!KEY.test(k)) return false;
  const key = k.slice(k.indexOf(":") + 1);
  return !isLegalKey(key) && !key.split(".").some((p) => p === "" || UNSAFE.has(p));
};
const isHash = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 32;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isForms = (v: unknown): v is Record<string, string> =>
  isRecord(v) && Object.keys(v).length > 0 && Object.entries(v).every(([f, s]) => FORMS.has(f) && typeof s === "string" && s.length <= 4000);
/** Own entries of an untrusted object, capped. */
const ownEntries = (v: unknown): [string, unknown][] => (isRecord(v) ? Object.entries(v).slice(0, MAX_ENTRIES) : []);

/**
 * `<userData>/locales/<tag>.json` (language spec §6). Only a translation run writes it; reading never creates anything.
 * The file is untrusted on load: it is size-capped before parsing and every entry is shape-checked again.
 */
export class TranslationCache {
  private readonly dir: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(userData: string) {
    this.dir = path.join(userData, "locales");
  }

  private file(tag: Language): string {
    if (!offeredLanguage(tag)) throw new Error(`Not a language the app translates into: ${String(tag).slice(0, 40)}`);
    return path.join(this.dir, `${tag}.json`);
  }

  /** The tags with a cache file, canonical and offered only. */
  async tags(): Promise<Language[]> {
    const names = await fs.readdir(this.dir).catch(() => [] as string[]);
    return names
      .filter((n) => n.endsWith(".json"))
      .map((n) => n.slice(0, -5))
      .filter(offeredLanguage)
      .sort()
      .slice(0, 50);
  }

  /**
   * The cache of `tag`, shape-checked; anything missing, too big, malformed or written for another tag reads as empty.
   * With `english` (the current items), an entry is kept only when its hash matches that English and the
   * translation passes `checkTranslation` again: callers that show or reuse entries must pass it.
   */
  async load(tag: Language, english?: readonly TranslateItem[]): Promise<CacheFile> {
    const out = emptyCache(tag);
    let text: string;
    try {
      const file = this.file(tag);
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > MAX_BYTES) return out;
      text = await fs.readFile(file, "utf8");
    } catch {
      return out;
    }
    if (text.length > MAX_BYTES) return out;
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return out;
    }
    if (!isRecord(raw) || raw.tag !== tag) return out;
    const items = english ? new Map(english.map((i) => [i.key, i])) : undefined;
    const forms = pluralForms(tag);
    for (const [k, v] of ownEntries(raw.entries)) {
      if (!safeKey(k) || !isRecord(v) || !isHash(v.en)) continue;
      const value = v.value;
      if (!((typeof value === "string" && value.length <= 4000) || isForms(value))) continue;
      if (items) {
        const item = items.get(k);
        if (!item || item.hash !== v.en) continue;
        const checked = checkTranslation(item, value, forms);
        if (checked.ok) out.entries[k] = { en: v.en, value: checked.value };
      } else out.entries[k] = { en: v.en, value: typeof value === "string" ? value : { ...value } };
    }
    for (const [k, v] of ownEntries(raw.failed)) {
      if (safeKey(k) && isRecord(v) && isHash(v.en) && Number.isInteger(v.count) && (v.count as number) > 0) out.failed[k] = { en: v.en, count: Math.min(2, v.count as number) };
    }
    return out;
  }

  /** Writes the whole file (temp + rename), one save after another. A file `load` would refuse is never written. */
  save(file: CacheFile): Promise<void> {
    const run = this.queue.then(async () => {
      const target = this.file(file.tag);
      const text = JSON.stringify(file);
      if (Buffer.byteLength(text) > MAX_BYTES) throw new Error("The translation cache would be too big to read back.");
      await fs.mkdir(this.dir, { recursive: true });
      const tmp = `${target}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(tmp, text);
        await fs.rename(tmp, target);
      } catch (err) {
        await fs.rm(tmp, { force: true });
        throw err;
      }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
