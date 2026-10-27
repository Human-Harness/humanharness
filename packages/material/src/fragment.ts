import type { CheckName, Fragment, FragmentMeta, Validation } from "./types";

/** A source id: a slug of its name. A fragment id: `<source id>-<nnn>`. */
export const SOURCE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const FRAGMENT_ID = /^[a-z0-9][a-z0-9-]{0,63}-\d{3,4}$/;
export const isFragmentId = (v: unknown): v is string => typeof v === "string" && FRAGMENT_ID.test(v);
export const isSourceId = (v: unknown): v is string => typeof v === "string" && SOURCE_ID.test(v);

/** `fractions-ch2-007`. */
export const fragmentId = (source: string, n: number): string => `${source}-${String(n).padStart(3, "0")}`;

const VALIDATIONS: readonly Validation[] = ["sample", "flagged-reviewed", "repaired", "not-reviewed", "pending"];
const CHECKS: readonly CheckName[] = ["garbled", "reading-order", "size", "no-structure", "table", "noise", "leftover"];
const ORDER: (keyof FragmentMeta)[] = ["id", "source", "location", "path", "kind", "summary", "keywords", "tokens", "items", "checks", "validated"];

/** A kind as the manifest declares it; written plain only then (and never as a YAML/JSON literal), else as JSON. */
const KIND = /^[a-z][a-z0-9-]{0,31}$/;
const plainKind = (v: unknown): boolean => typeof v === "string" && KIND.test(v) && v !== "true" && v !== "false" && v !== "null";

/** A value as one YAML line: plain for ids, numbers, the enums and plain kinds; JSON (valid YAML) for any other text and lists. */
function yamlValue(key: keyof FragmentMeta, v: unknown): string {
  if (key === "id" || key === "validated" || typeof v === "number" || (key === "kind" && plainKind(v))) return String(v);
  if (key === "checks" && v === "ok") return "ok";
  return JSON.stringify(v);
}

/** The fragment file (§4.1): front matter, a blank line, the Markdown. */
export function renderFragment(f: Fragment): string {
  const lines = ORDER.filter((k) => f.meta[k] !== undefined).map((k) => `${k}: ${yamlValue(k, f.meta[k])}`);
  return `---\n${lines.join("\n")}\n---\n\n${f.md.trim()}\n`;
}

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** A fragment file read back; null when it has no front matter or no valid id (a hand edit broke it). */
export function parseFragment(text: string): Fragment | null {
  const m = /^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, "\n"));
  if (!m) return null;
  // No prototype: a `__proto__:` line is just an unknown key.
  const raw: Record<string, unknown> = Object.create(null);
  for (const line of m[1].split("\n")) {
    const at = line.indexOf(": ");
    if (at < 0) continue;
    const value = line.slice(at + 2);
    try {
      raw[line.slice(0, at)] = JSON.parse(value);
    } catch {
      raw[line.slice(0, at)] = value;
    }
  }
  const id = String(raw.id ?? "");
  if (!isFragmentId(id)) return null;
  const checks = raw.checks === "ok" ? "ok" : strs(raw.checks).filter((c): c is CheckName => (CHECKS as string[]).includes(c));
  const validated = VALIDATIONS.find((v) => v === raw.validated) ?? "not-reviewed";
  const meta: FragmentMeta = {
    id,
    source: str(raw.source),
    location: str(raw.location),
    path: str(raw.path),
    ...(typeof raw.kind === "string" && raw.kind ? { kind: raw.kind } : {}),
    summary: str(raw.summary),
    keywords: strs(raw.keywords),
    tokens: typeof raw.tokens === "number" ? raw.tokens : 0,
    items: strs(raw.items),
    checks: Array.isArray(checks) && checks.length === 0 ? "ok" : checks,
    validated,
  };
  return { meta, md: m[2].trim() };
}
