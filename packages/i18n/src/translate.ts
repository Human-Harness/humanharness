// No Node and no i18next here: the screens and the main process both import this (`@humanharness/i18n/translate`).
// Translations are agent output, so they are untrusted: every reader below is a linear scan, never a backtracking regex.
import en from "./locales/en.json";

export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";
const CATEGORIES: readonly PluralCategory[] = ["zero", "one", "two", "few", "many", "other"];
export type Translated = string | Partial<Record<PluralCategory, string>>;

/** One thing sent for translation: a namespaced key, its English (an object of forms for a plural), and its hash. */
export interface TranslateItem {
  key: string;
  en: Translated;
  hash: string;
}

/** Keys under this prefix are never sent and always render in English (spec §8). */
export const LEGAL_PREFIX = "legal.";
export const STRING_LIMITS = { keys: 5000, keyLength: 200, text: 4000, depth: 8 } as const;
const KEY = /^[A-Za-z0-9_.-]+$/;
/** Key segments that would reach an object's prototype; never read or written. */
const UNSAFE = new Set(["__proto__", "constructor", "prototype"]);
const safeKey = (key: string) => key.length <= STRING_LIMITS.keyLength && KEY.test(key) && !key.split(".").some((p) => p === "" || UNSAFE.has(p));

/** Nested string maps flattened to `a.b` keys; anything not a string, too deep, too long or past the key cap is dropped. */
export function flattenStrings(raw: unknown, limits = STRING_LIMITS): Record<string, string> {
  const out: Record<string, string> = {};
  let n = 0;
  const walk = (node: unknown, prefix: string, depth: number) => {
    if (typeof node !== "object" || node === null || Array.isArray(node) || depth > limits.depth) return;
    for (const [k, v] of Object.entries(node)) {
      if (n >= limits.keys) return;
      if (k.length > limits.keyLength) continue;
      const key = prefix ? `${prefix}.${k}` : k;
      if (key.length > limits.keyLength || !safeKey(key)) continue;
      if (typeof v === "string") {
        if (v.length <= limits.text) {
          out[key] = v;
          n++;
        }
      } else walk(v, key, depth + 1);
    }
  };
  walk(raw, "", 0);
  return out;
}

/** The core's English, flattened. */
export const CORE_EN: Record<string, string> = flattenStrings(en);

/** cyrb53: a 53-bit hash of the English, to see when it changed (spec §6). Not for security. */
export function textHash(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

const sortedJson = (forms: Partial<Record<PluralCategory, string>>) => JSON.stringify(CATEGORIES.filter((c) => forms[c] !== undefined).map((c) => [c, forms[c]]));

/** The plural forms `tag` needs, sorted ("pl" → few, many, one, other). */
export function pluralForms(tag: string): PluralCategory[] {
  try {
    return [...(new Intl.PluralRules(tag).resolvedOptions().pluralCategories as PluralCategory[])].sort();
  } catch {
    return ["one", "other"];
  }
}

/** `x_one` → ["x", "one"]; anything without a plural suffix → undefined. */
function pluralSplit(key: string): [string, PluralCategory] | undefined {
  const i = key.lastIndexOf("_");
  if (i <= 0) return undefined;
  const form = key.slice(i + 1) as PluralCategory;
  return CATEGORIES.includes(form) ? [key.slice(0, i), form] : undefined;
}

/** What goes for translation (spec §5): every core and harness key but `legal.`, plurals grouped by their base key. */
export function englishItems(core: Record<string, string>, harness: Record<string, string>): TranslateItem[] {
  const items: TranslateItem[] = [];
  for (const [ns, map] of [["core", core], ["harness", harness]] as const) {
    const plurals = new Map<string, Partial<Record<PluralCategory, string>>>();
    for (const [k, v] of Object.entries(map)) {
      const p = pluralSplit(k);
      if (p && Object.hasOwn(map, `${p[0]}_other`)) plurals.set(p[0], { ...plurals.get(p[0]), [p[1]]: v });
    }
    const seen = new Set<string>();
    for (const [k, v] of Object.entries(map)) {
      if (typeof v !== "string" || k.startsWith(LEGAL_PREFIX)) continue;
      const p = pluralSplit(k);
      if (p && plurals.has(p[0])) {
        if (seen.has(p[0])) continue;
        seen.add(p[0]);
        const forms = plurals.get(p[0])!;
        items.push({ key: `${ns}:${p[0]}`, en: forms, hash: textHash(sortedJson(forms)) });
      } else items.push({ key: `${ns}:${k}`, en: v, hash: textHash(v) });
    }
  }
  return items;
}

const isTagChar = (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isSpace = (c: number) => c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 11;

/** A tag like i18next's Trans reads it (`<b>`, `</b>`, `<br/>`, `<1>`, spaces before `>` or `/>` ignored), starting at `<`. */
function tagAt(s: string, i: number): { tag: string; end: number } | undefined {
  let j = i + 1;
  const close = s.charCodeAt(j) === 47; // "/"
  if (close) j++;
  const nameStart = j;
  while (j < s.length && isTagChar(s.charCodeAt(j))) j++;
  if (j === nameStart) return undefined;
  const name = s.slice(nameStart, j);
  while (j < s.length && isSpace(s.charCodeAt(j))) j++;
  const self = s.charCodeAt(j) === 47;
  if (self) j++;
  if (s.charCodeAt(j) !== 62) return undefined; // ">"
  return { tag: `<${close ? "/" : ""}${name}${self ? "/" : ""}>`, end: j + 1 };
}

/** A `{{ name }}` placeholder starting at `{{`: no brace inside, a name that isn't blank. */
function placeholderAt(s: string, i: number): { name: string; end: number } | undefined {
  let j = i + 2;
  while (j < s.length && s[j] !== "{" && s[j] !== "}") j++;
  if (s[j] !== "}" || s[j + 1] !== "}") return undefined;
  const name = s.slice(i + 2, j).trim();
  return name ? { name, end: j + 2 } : undefined;
}

/** One left-to-right pass: the placeholders, the tags, and how many `<`/`>` are left outside them. */
function scan(s: string): { placeholders: string[]; tags: string[]; angles: number } {
  const ph: string[] = [];
  const tg: string[] = [];
  let angles = 0;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "<") {
      const t = tagAt(s, i);
      if (t) {
        tg.push(t.tag);
        i = t.end;
        continue;
      }
      angles++;
    } else if (c === ">") angles++;
    else if (c === "{" && s[i + 1] === "{") {
      const p = placeholderAt(s, i);
      if (p) {
        ph.push(p.name);
        i = p.end;
        continue;
      }
    }
    i++;
  }
  return { placeholders: ph.sort(), tags: tg.sort(), angles };
}

export const placeholders = (s: string): string[] => scan(s).placeholders;
export const tags = (s: string): string[] => scan(s).tags;
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
// C0 controls but newline, DEL, and the bidi embeddings, overrides and isolates (U+202A–202E, U+2066–2069).
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F‪-‮⁦-⁩]/;

export type CheckReason = "empty" | "too-long" | "placeholders" | "markup" | "control" | "forms";
export type Checked = { ok: true; value: Translated } | { ok: false; reason: CheckReason };

function checkText(en: string, text: unknown): Checked {
  if (typeof text !== "string" || text.trim() === "") return { ok: false, reason: "empty" };
  // The length goes first so nothing longer than the cap is scanned further.
  if (text.length > Math.min(STRING_LIMITS.text, Math.max(80, en.length * 4))) {
    return CONTROL.test(text) ? { ok: false, reason: "control" } : { ok: false, reason: "too-long" };
  }
  if (CONTROL.test(text) || (text.includes("\n") && !en.includes("\n"))) return { ok: false, reason: "control" };
  const t = scan(text);
  const e = scan(en);
  if (!same(t.placeholders, e.placeholders)) return { ok: false, reason: "placeholders" };
  if (!same(t.tags, e.tags) || t.angles > e.angles || (text.includes("$t(") && !en.includes("$t("))) return { ok: false, reason: "markup" };
  return { ok: true, value: text };
}

/** Whether `value` may be kept as `item`'s translation (spec §6); `forms` are the target language's plural forms. */
export function checkTranslation(item: TranslateItem, value: unknown, forms: readonly PluralCategory[]): Checked {
  if (typeof item.en === "string") return checkText(item.en, value);
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, reason: "forms" };
  const given = value as Record<string, unknown>;
  const keys = Object.keys(given);
  if (keys.length > CATEGORIES.length || !same(keys.sort(), [...forms].sort())) return { ok: false, reason: "forms" };
  const englishOther = item.en.other ?? Object.values(item.en)[0] ?? "";
  const out: Partial<Record<PluralCategory, string>> = {};
  for (const f of forms) {
    // Each form is checked against the same English form, else the English `other` (it has every placeholder).
    const en = item.en[f] ?? englishOther;
    const r = checkText(en, given[f]);
    if (!r.ok) return r;
    out[f] = r.value as string;
  }
  return { ok: true, value: out };
}

/** A kept translation as flat namespaced i18next keys ("core:notes.keyPoints_one"); legal keys never. */
export function toResourceEntries(key: string, value: Translated): Record<string, string> {
  if (typeof value === "string") return { [key]: value };
  return Object.fromEntries(Object.entries(value).map(([f, v]) => [`${key}_${f}`, v as string]));
}

/** Flat namespaced strings as i18next resources; anything under `legal.`, outside core/harness or through a prototype is dropped. */
export function toResources(flat: Record<string, string>): { core: Record<string, unknown>; harness: Record<string, unknown> } {
  const out = { core: {} as Record<string, unknown>, harness: {} as Record<string, unknown> };
  for (const [full, text] of Object.entries(flat)) {
    const i = full.indexOf(":");
    if (i < 0) continue;
    const ns = full.slice(0, i);
    const key = full.slice(i + 1);
    if ((ns !== "core" && ns !== "harness") || key.startsWith(LEGAL_PREFIX) || typeof text !== "string" || !safeKey(key)) continue;
    const parts = key.split(".");
    let node = out[ns];
    for (const p of parts.slice(0, -1)) {
      if (!Object.hasOwn(node, p) || typeof node[p] !== "object" || node[p] === null) node[p] = {};
      node = node[p] as Record<string, unknown>;
    }
    node[parts.at(-1)!] = text;
  }
  return out;
}
