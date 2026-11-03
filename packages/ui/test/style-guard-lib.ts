/**
 * Scanner behind the style guard (style guide §15 Control). It reads CSS and TSX sources and returns
 * offenders as "<file>|<kind>|<where>|<value>" strings; the test compares them with the known-offenders
 * list, which may only shrink.
 *
 * Limits: only px literals are checked (not rem, the `font` shorthand or px inside calc/min/max); TSX
 * classes held in variables or props other than `className` are not seen; identical offenders in one file
 * collapse into one line (the string format has no count).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { GUIDE_CLASSES } from "../src/guide/classes";

// Style guide §2 (heights, radii, spacing, type, weights) and the fixed sizes named in §4–§10.
export const HEIGHTS = [18, 24, 30, 40, 52, 104];
/** Sizes the spec gives to specific pieces (§4–§10): progress bar 6, dot 8, icon 14 / 18 / 32, ring 16,
 * toggle 20 × 34, avatar 32, logo 84, underline 2, border 1. Each size is allowed ONLY on its own piece's
 * selectors, never as a general height: the list of selectors per size starts empty and each piece task
 * (Parts 3, 4 and 6) adds its own selector when it writes the piece's CSS, like ROUND_SELECTORS. */
export const PIECE_SIZES: Record<number, string[]> = {
  1: [], // border: only `border*` widths and the 1 px line pieces (divider)
  2: [], // active underline (Tabs, NavItem, active review mark)
  6: [], // ProgressBar
  8: [], // Dot
  14: [],
  18: [],
  32: [], // icon sizes (Icon piece selectors; 18 and 32 are also Counter and Avatar)
  16: [], // Ring
  20: [],
  34: [], // Toggle (20 high, 34 wide)
  84: [], // engine / harness logo
};
export const RADII = [8, 12, 14, 18]; // plus 4 only on inline code, plus round (999px or 50%) only on round pieces
export const SPACES = [0, 4, 8, 12, 16, 24, 32]; // plus 90 only as the top bar's left padding (§9)
export const FONT_SIZES = [12, 13, 14, 15, 16, 20, 28];
export const WEIGHTS = [400, 500, 600];
/** Selectors allowed a round radius (999px / 50%). Part 6 fills it with the round pieces. */
export const ROUND_SELECTORS: string[] = [];

export type CssOptions = {
  /** The file defines the tokens: colors are allowed inside its `:root` / `[data-theme]` blocks. */
  tokenFile?: boolean;
  /** Selectors of the top bar, the only place where a 90px left padding is allowed. */
  topBarSelectors?: string[];
  /** A harness or plugin panel stylesheet (§15 Harness chat blocks): color properties may use only `--hh-*`
   * vars (or keywords), and every size check of the app applies, reported as `harness-size`. */
  harness?: boolean;
};

type Kind = "color" | "height" | "radius" | "space" | "font-size" | "weight" | "class" | "harness-color" | "harness-size";

const COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\([^)]*\)/g;
const SIZE_PROPS = /^(?:min-|max-)?(?:height|width)$/;
const HEIGHT_PROPS = /^(?:min-|max-)?height$/;
const RADIUS_PROPS = /^border(?:-(?:top|bottom|start|end)-(?:left|right|start|end))?-radius$/;
// Only a pure `:root` / `:root[data-theme=…]` block (or `[data-theme=…]` alone) may hold literal colors.
const TOKEN_BLOCK = /^(?::root(?:\[data-theme=[^\]]+\]|:not\(\[data-theme=[^\]]+\]\))*|\[data-theme=[^\]]+\])$/;
const SPACE_PROPS = /^(?:gap|row-gap|column-gap|padding(?:-[a-z]+)*|margin(?:-[a-z]+)*)$/;

// Properties that carry a color. Only these are checked for foreign vars: a non-`--hh-` var in any other
// property (a size, `content`, `transition`) is not flagged, because a harness may name its own custom
// properties for measures; its literal px values are still checked against the scale. Named colors
// (`red`) are not detected either: the guard only sees hex / rgb / hsl literals and vars.
const COLOR_PROPS =
  /^(?:color|background(?:-color)?|(?:border|outline|column-rule)(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-color)?|fill|stroke|caret-color|accent-color|text-decoration(?:-color)?|text-emphasis-color|box-shadow|text-shadow|scrollbar-color)$/;
const VAR_CALL = /var\(\s*(--[\w-]+)\s*(?:,[^()]*)?\)/g;

const line = (file: string, kind: Kind, where: string, value: string) => `${file}|${kind}|${where}|${value}`;
const dedupe = (items: string[]) => [...new Set(items)];

/** Drops function calls (var, calc, url...) so only literal values are left to check. */
function stripCalls(value: string): string {
  let prev: string;
  let out = value;
  do {
    prev = out;
    out = out.replace(/\b(?:var|calc|clamp|min|max|url|env)\([^()]*\)/g, " ");
  } while (out !== prev);
  return out;
}

const pxValues = (value: string): number[] =>
  [...stripCalls(value).matchAll(/(?<![\w.#-])(-?\d*\.?\d+)px\b/g)].map((m) => Number(m[1]));

const selectorParts = (selector: string) => selector.split(",").map((s) => s.trim());
const inList = (selector: string, list: string[]) => selectorParts(selector).some((s) => list.includes(s));

function checkDeclaration(file: string, selector: string, prop: string, value: string, opts: CssOptions, inTokenBlock: boolean, out: string[]) {
  if (!inTokenBlock) {
    for (const m of value.matchAll(COLOR)) out.push(line(file, "color", selector, m[0]));
  }
  if (prop.startsWith("--")) return;
  const bare = stripCalls(value).trim();

  if (SIZE_PROPS.test(prop)) {
    const isHeight = HEIGHT_PROPS.test(prop);
    for (const px of pxValues(value)) {
      if (px === 0) continue;
      const own = inList(selector, PIECE_SIZES[px] ?? []);
      if (isHeight && !HEIGHTS.includes(px) && !own) out.push(line(file, "height", selector, `${px}px`));
      // Widths are reported with kind `height` (the plan has no width kind).
      // A width off the piece list belongs to the width tokens, which are checked elsewhere.
      else if (!isHeight && px in PIECE_SIZES && !own) out.push(line(file, "height", selector, `${px}px`));
    }
  } else if (RADIUS_PROPS.test(prop)) {
    for (const token of bare.split(/[\s/]+/).filter(Boolean)) {
      const m = /^(-?\d*\.?\d+)(px|%)$/.exec(token);
      if (!m) continue;
      const n = Number(m[1]);
      if (n === 0) continue;
      const round = (m[2] === "px" && n === 999) || (m[2] === "%" && n === 50);
      const ok = round
        ? inList(selector, ROUND_SELECTORS)
        : m[2] === "px" && (RADII.includes(n) || (n === 4 && selectorParts(selector).some((s) => /(?:^|[\s>+~])code$/.test(s))));
      if (!ok && (m[2] === "px" || round)) out.push(line(file, "radius", selector, token));
    }
  } else if (SPACE_PROPS.test(prop)) {
    for (const px of pxValues(value)) {
      if (px <= 0 || SPACES.includes(px)) continue;
      const topBar = px === 90 && prop.startsWith("padding") && inList(selector, opts.topBarSelectors ?? []);
      if (!topBar) out.push(line(file, "space", selector, `${px}px`));
    }
  } else if (prop === "font-size") {
    for (const px of pxValues(value)) if (!FONT_SIZES.includes(px)) out.push(line(file, "font-size", selector, `${px}px`));
  } else if (prop === "font-weight") {
    const n = bare === "bold" ? 700 : /^\d+$/.test(bare) ? Number(bare) : null;
    if (n !== null && !WEIGHTS.includes(n)) out.push(line(file, "weight", selector, String(n)));
  }
}

/** Scans one stylesheet. Walks nested blocks (`@media`, `@container`) with a stack of selectors. */
export function scanCss(file: string, css: string, opts: CssOptions = {}): string[] {
  const out: string[] = [];
  const stack: { selector: string; at: boolean; keyframes: boolean }[] = [];
  let buf = "";
  let depth = 0; // parentheses and quotes keep `;` and `{` inside url(...) or strings from splitting
  let quote = "";

  const declare = (text: string) => {
    const idx = text.indexOf(":");
    const top = stack[stack.length - 1];
    if (idx < 0 || !top) return;
    if (top.at) {
      // A keyframe step holds animated values, so only its colors are checked; they are reported under the
      // animation's name because step names (`from`, `50%`) would collide between animations.
      const parent = stack[stack.length - 2];
      if (top.keyframes && !top.selector.startsWith("@") && parent) {
        for (const m of text.slice(idx + 1).matchAll(COLOR)) out.push(line(file, opts.harness ? "harness-color" : "color", parent.selector, m[0]));
      }
      return;
    }
    const prop = text.slice(0, idx).trim().toLowerCase();
    const value = text.slice(idx + 1).replace(/!\s*important/i, "").trim();
    const inToken = !!opts.tokenFile && selectorParts(top.selector).every((s) => TOKEN_BLOCK.test(s));
    if (!opts.harness) return checkDeclaration(file, top.selector, prop, value, opts, inToken, out);
    // Harness mode reuses the app's checks and renames the kinds, then adds the token-only color rule.
    const found: string[] = [];
    checkDeclaration(file, top.selector, prop, value, opts, false, found);
    for (const f of found) out.push(f.replace("|color|", "|harness-color|").replace(/\|(?:height|radius|space|font-size|weight)\|/, "|harness-size|"));
    if (COLOR_PROPS.test(prop)) {
      for (const m of value.matchAll(VAR_CALL)) if (!m[1].startsWith("--hh-")) out.push(line(file, "harness-color", top.selector, m[0]));
    }
  };

  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (quote) {
      buf += ch;
      if (ch === "\\") buf += css[++i] ?? "";
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      if (end < 0) throw new Error(`scanCss: unterminated comment in ${file}`);
      i = end + 1;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (depth > 0 || quote) {
      buf += ch;
      continue;
    }
    if (ch === "{") {
      const selector = buf.trim().replace(/\s+/g, " ");
      const parent = stack[stack.length - 1];
      const keyframes = /^@(?:-\w+-)?keyframes\b/.test(selector) || !!parent?.keyframes;
      // Keyframe steps (`from`, `50%`) are not selectors; a name like that would collide between animations.
      stack.push({ selector, at: selector.startsWith("@") || keyframes, keyframes });
      buf = "";
    } else if (ch === "}") {
      declare(buf);
      stack.pop();
      buf = "";
    } else if (ch === ";") {
      declare(buf);
      buf = "";
    } else {
      buf += ch;
    }
  }
  // A broken parse must fail loudly: silently dropping the rest of a file would shrink the offenders list.
  if (quote || stack.length) throw new Error(`scanCss: unbalanced input in ${file}`);
  return dedupe(out);
}

type Part = { text: string; dynamicEnd: boolean };

/** Index just after the string or template literal that starts at `i`. */
function skipString(src: string, i: number): number {
  const q = src[i];
  let j = i + 1;
  while (j < src.length && src[j] !== q) {
    if (src[j] === "\\") j++;
    else if (q === "`" && src[j] === "$" && src[j + 1] === "{") j = matchBrace(src, j + 1);
    j++;
  }
  return j + 1;
}

/** Index of the `}` that closes the `{` at `i`, skipping strings. */
function matchBrace(src: string, i: number): number {
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (ch === '"' || ch === "'" || ch === "`") j = skipString(src, j) - 1;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return j;
  }
  return src.length;
}

/** Static text of every string literal and template literal in an expression. */
function stringParts(src: string): Part[] {
  const parts: Part[] = [];
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      const end = skipString(src, i);
      parts.push({ text: src.slice(i + 1, end - 1), dynamicEnd: false });
      i = end - 1;
    } else if (ch === "`") {
      const end = skipString(src, i);
      let buf = "";
      for (let j = i + 1; j < end - 1; j++) {
        if (src[j] === "$" && src[j + 1] === "{") {
          const close = matchBrace(src, j + 1);
          parts.push({ text: buf, dynamicEnd: true }, ...stringParts(src.slice(j + 2, close)));
          buf = "";
          j = close;
        } else buf += src[j];
      }
      parts.push({ text: buf, dynamicEnd: false });
      i = end - 1;
    }
  }
  return parts;
}

/**
 * Scans one TSX file: every `hh-*` class in a `className` must be in the guide's list, and a `style`
 * object must not hold a hex / rgb / hsl color. A class cut by an interpolation (`hh-btn--${v}`) passes
 * when some class in the list starts with the static prefix.
 */
export function scanTsx(file: string, tsx: string, guideClasses: ReadonlySet<string>): string[] {
  const out: string[] = [];

  for (const m of tsx.matchAll(/\bclassName\s*=\s*/g)) {
    const start = m.index + m[0].length;
    let parts: Part[] = [];
    if (tsx[start] === '"' || tsx[start] === "'") parts = stringParts(tsx.slice(start, skipString(tsx, start)));
    else if (tsx[start] === "{") parts = stringParts(tsx.slice(start + 1, matchBrace(tsx, start)));
    for (const part of parts) {
      for (const c of part.text.matchAll(/(?<![\w-])hh-[\w-]*/g)) {
        const name = c[0];
        const cut = part.dynamicEnd && c.index + name.length === part.text.length;
        const ok = cut ? [...guideClasses].some((g) => g.startsWith(name)) : guideClasses.has(name);
        if (!ok) out.push(line(file, "class", name, name));
      }
    }
  }

  for (const m of tsx.matchAll(/\bstyle\s*=\s*\{/g)) {
    const open = m.index + m[0].length - 1;
    for (const c of tsx.slice(open, matchBrace(tsx, open)).matchAll(COLOR)) out.push(line(file, "color", "style", c[0]));
  }
  return dedupe(out);
}

// From packages/ui/test to the repo root, independent of process.cwd().
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
/** The top bar is the only place with a 90px left padding (§9). */
const TOP_BAR_SELECTORS = [".hh-topbar"];

const filesUnder = (dir: string, ext: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    return e.isDirectory() ? (e.name === "node_modules" || e.name === "dist" ? [] : filesUnder(full, ext)) : full.endsWith(ext) ? [full] : [];
  });

/** Scans the app's own sources. Paths in the result are relative to the repo root. */
export function scanRepo(): string[] {
  const src = join(REPO_ROOT, "packages/ui/src");
  const rel = (f: string) => relative(REPO_ROOT, f).split("\\").join("/");
  const out: string[] = [];
  const css = (f: string, opts: CssOptions) => out.push(...scanCss(rel(f), readFileSync(f, "utf8"), opts));

  css(join(src, "styles.css"), { tokenFile: true, topBarSelectors: TOP_BAR_SELECTORS });
  for (const f of filesUnder(join(src, "plugin-ui"), ".css")) css(f, { tokenFile: rel(f) === "packages/ui/src/plugin-ui/tokens.css" });
  for (const f of filesUnder(src, ".tsx")) out.push(...scanTsx(rel(f), readFileSync(f, "utf8"), GUIDE_CLASSES));
  // Harness and plugin stylesheets (§15). Missing directories are skipped; `dist/` is build output.
  const subdirs = (base: string): string[] =>
    existsSync(base) ? readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(base, e.name)) : [];
  const harnesses = subdirs(join(REPO_ROOT, "harnesses"));
  const harnessRoots = [
    ...harnesses.map((d) => join(d, "ui")),
    ...harnesses.flatMap((d) => subdirs(join(d, "plugins"))).map((d) => join(d, "panels")),
    join(REPO_ROOT, "packages/cli/template/ui"),
    ...subdirs(join(REPO_ROOT, "packages/e2e/fixtures/plugins")).map((d) => join(d, "panels")),
  ];
  for (const root of harnessRoots) if (existsSync(root)) for (const f of filesUnder(root, ".css")) css(f, { harness: true });
  return dedupe(out).sort();
}
