import { randomUUID } from "node:crypto";
import { constants, promises as fs } from "node:fs";
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
export const safeKey = (k: string): boolean => {
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

  /** The file's text: a regular file only (never through a symlink), at most MAX_BYTES read; else undefined. */
  private async read(tag: Language): Promise<string | undefined> {
    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(this.file(tag), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      if (!(await handle.stat()).isFile()) return undefined;
      const buf = Buffer.alloc(MAX_BYTES + 1);
      let size = 0;
      for (;;) {
        const { bytesRead } = await handle.read(buf, size, buf.length - size, null);
        if (bytesRead === 0) break;
        size += bytesRead;
        if (size > MAX_BYTES) return undefined;
      }
      return buf.subarray(0, size).toString("utf8");
    } catch {
      return undefined;
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  /**
   * The cache of `tag`, checked against `english` (the current items) on every load (spec §6): an entry is kept
   * only when its key is safe, its hash matches that English and the translation passes `checkTranslation` again;
   * a failure counts only for the English it failed on. Anything missing, too big, malformed, of another version
   * or written for another tag reads as empty. A save after a load therefore drops keys the current English no
   * longer has; that is fine, since one userData belongs to one harness.
   */
  async load(tag: Language, english: readonly TranslateItem[]): Promise<CacheFile> {
    const out = emptyCache(tag);
    const text = await this.read(tag);
    if (text === undefined) return out;
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return out;
    }
    if (!isRecord(raw) || raw.version !== 1 || raw.tag !== tag) return out;
    const items = new Map(english.map((i) => [i.key, i]));
    const forms = pluralForms(tag);
    for (const [k, v] of ownEntries(raw.entries)) {
      if (!safeKey(k) || !isRecord(v) || !isHash(v.en)) continue;
      const value = v.value;
      if (!((typeof value === "string" && value.length <= 4000) || isForms(value))) continue;
      const item = items.get(k);
      if (!item || item.hash !== v.en) continue;
      const checked = checkTranslation(item, value, forms);
      if (checked.ok) out.entries[k] = { en: v.en, value: checked.value };
    }
    for (const [k, v] of ownEntries(raw.failed)) {
      if (!safeKey(k) || !isRecord(v) || !isHash(v.en) || items.get(k)?.hash !== v.en) continue;
      if (Number.isInteger(v.count) && (v.count as number) > 0) out.failed[k] = { en: v.en, count: Math.min(2, v.count as number) };
    }
    return out;
  }

  /**
   * Writes the whole file (temp + rename), one save after another. Only the size and tag are checked here: the
   * caller saves keys it has already checked, and `load` checks everything again anyway.
   */
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
