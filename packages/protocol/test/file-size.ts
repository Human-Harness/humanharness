import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The repo root (this file is packages/protocol/test/file-size.ts). */
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const CAP = 48 * 1024;
export const TARGET = 32 * 1024;
export const baselineFile = path.join(root, "packages/protocol/test/file-size-baseline.json");

const SKIP_DIRS = new Set(["node_modules", "dist", "out", "fixtures"]);

function walk(dir: string, keep: (name: string) => boolean): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return SKIP_DIRS.has(d.name) ? [] : walk(p, keep);
    return keep(d.name) ? [p] : [];
  });
}

const code = (name: string) => /\.(ts|tsx|css)$/.test(name) && !name.endsWith(".d.ts");

/** Every counted file (spec §2), repo-relative with forward slashes. */
export function countedFiles(): string[] {
  const packages = path.join(root, "packages");
  const pkgDirs = fs.readdirSync(packages, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(packages, d.name));
  const modDirs = fs.existsSync(path.join(packages, "mods"))
    ? fs.readdirSync(path.join(packages, "mods"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(packages, "mods", d.name))
    : [];
  const files = [...pkgDirs, ...modDirs].flatMap((p) => [...walk(path.join(p, "src"), code), ...walk(path.join(p, "test"), code)]);
  files.push(...walk(path.join(root, "docs/architecture"), (n) => n.endsWith(".md")));
  return [...new Set(files)].map((f) => path.relative(root, f).split(path.sep).join("/")).sort();
}

export const sizeOf = (rel: string): number => fs.statSync(path.join(root, rel)).size;
export const roundUpKb = (bytes: number): number => Math.ceil(bytes / 1024) * 1024;

export type Baseline = Record<string, number>;
export const readBaseline = (): Baseline => JSON.parse(fs.readFileSync(baselineFile, "utf8")) as Baseline;

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

/** Every rule the ratchet breaks (spec §3), one message per problem. */
export function problems(files: string[], baseline: Baseline, size: (rel: string) => number | null): string[] {
  const out: string[] = [];
  for (const f of files) {
    const s = size(f);
    if (s === null || s <= CAP || f in baseline) continue;
    out.push(`${f} is ${kb(s)}, over the ${kb(CAP)} cap. Split it into files of one responsibility each (target ${kb(TARGET)}).`);
  }
  for (const [f, limit] of Object.entries(baseline)) {
    const s = size(f);
    if (s === null) out.push(`${f} is in the baseline but no longer exists. Run \`pnpm size-baseline\`.`);
    else if (s <= CAP) out.push(`${f} is ${kb(s)}, now under the cap. Run \`pnpm size-baseline\` to drop its entry.`);
    else if (s > limit) out.push(`${f} is ${kb(s)}, over its baseline of ${kb(limit)}. The baseline only goes down: move code out of it (or split it) instead of adding to it.`);
  }
  return out;
}

/** The baseline lowered: each entry to its file's size rounded up to the next KB, never raised; gone or under-cap files dropped; nothing added. */
export function lowered(baseline: Baseline, size: (rel: string) => number | null): Baseline {
  const out: Baseline = {};
  for (const [f, limit] of Object.entries(baseline).sort(([a], [b]) => a.localeCompare(b))) {
    const s = size(f);
    if (s === null || s <= CAP) continue;
    out[f] = Math.min(limit, roundUpKb(s));
  }
  return out;
}

export const sizeOrNull = (rel: string): number | null => (fs.existsSync(path.join(root, rel)) ? sizeOf(rel) : null);

/** The core size ratchet (minimal-core spec §8): the lines of the core packages' sources only go down. */
export const coreBaselineFile = path.join(root, "packages/protocol/test/core-size-baseline.json");
/** Packages that are not the core: the mods, and the test tooling. */
const NOT_CORE = new Set(["mods", "e2e", "fake-agent"]);

/** Every `.ts`, `.tsx` and `.css` file under the core packages' `src`, repo-relative; `.d.ts` (generated) left out. */
export function coreFiles(): string[] {
  const dirs = fs.readdirSync(path.join(root, "packages"), { withFileTypes: true }).filter((d) => d.isDirectory() && !NOT_CORE.has(d.name));
  const files = dirs.flatMap((d) => walk(path.join(root, "packages", d.name, "src"), code));
  return files.map((f) => path.relative(root, f).split(path.sep).join("/")).sort();
}

/** Newlines, plus a last line that has none. */
export const countLines = (text: string): number => (text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0));
export const linesOf = (rel: string): number => countLines(fs.readFileSync(path.join(root, rel), "utf8"));
export const readCoreBaseline = (): number => (JSON.parse(fs.readFileSync(coreBaselineFile, "utf8")) as { lines: number }).lines;

/** Over the baseline fails; under it passes, with the number to record. */
export function checkCoreSize(lines: number, baseline: number): { failure: string | null; hint: string | null } {
  if (lines > baseline)
    return {
      failure: `The core is ${lines} lines, over its baseline of ${baseline} (+${lines - baseline}). The core only shrinks: move code into a mod (docs/architecture/mods.md) or remove as much. Raising the baseline is a decision to take on purpose.`,
      hint: null,
    };
  const hint = lines < baseline ? `The core is ${lines} lines, under its baseline of ${baseline}. Lower packages/protocol/test/core-size-baseline.json to ${lines}.` : null;
  return { failure: null, hint };
}
