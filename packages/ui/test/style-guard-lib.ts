/**
 * Scanner behind the style guard (style guide §15 Control). It reads CSS and TSX sources and returns
 * offenders as "<file>|<kind>|<where>|<value>" strings; the test compares them with the known-offenders
 * list, which may only shrink.
 *
 * Lengths are px and rem (16px per rem), also inside calc / min / max / clamp, and the `font` shorthand is
 * read for its size and weight. Identical offenders in one file collapse into one line with a " ×N" suffix.
 *
 * Limits: TSX classes held in variables or props other than `className` are not seen, and a class token
 * with an interpolation (`hh-btn--${v}`) is not checked at all.
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
  8: [".hh-tab-dot"], // Dot (Tabs' waiting dot until Task 26 replaces it with Dot)
  14: [],
  18: [],
  32: [".hh-sk-mark-pick"], // icon sizes (Icon piece selectors; 18 and 32 are also Counter and Avatar)
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
export const ROUND_SELECTORS: string[] = [".hh-sk-mark", ".hh-tab-dot"]; // the sidekick mark, a 24 circle (§4, row 44)

export type CssOptions = {
  /** The file defines the tokens: colors are allowed inside its `:root` / `[data-theme]` blocks. */
  tokenFile?: boolean;
  /** Selectors of the top bar, the only place where a 90px left padding is allowed. */
  topBarSelectors?: string[];
  /** A harness or plugin panel stylesheet (§15 Harness chat blocks): color properties may use only `--hh-*`
   * vars (or keywords), and every size check of the app applies, reported as `harness-size`. */
  harness?: boolean;
};

type Kind = "color" | "height" | "width" | "radius" | "space" | "font-size" | "weight" | "class" | "harness-color" | "harness-size";

const COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\([^)]*\)/g;
const SIZE_PROPS = /^(?:min-|max-)?(?:height|width)$/;
const HEIGHT_PROPS = /^(?:min-|max-)?height$/;
const RADIUS_PROPS = /^border(?:-(?:top|bottom|start|end)-(?:left|right|start|end))?-radius$/;
// Only a pure `:root` / `:root[data-theme=…]` block (or `[data-theme=…]` alone) may hold literal colors.
const TOKEN_BLOCK = /^(?::root(?:\[data-theme=[^\]]+\]|:not\(\[data-theme=[^\]]+\]\))*|\[data-theme=[^\]]+\])$/;
const SPACE_PROPS = /^(?:gap|row-gap|column-gap|padding(?:-[a-z]+)*|margin(?:-[a-z]+)*)$/;

// The 148 CSS named colors. `transparent`, `currentColor`, `inherit`, `initial`, `unset` and `none` are not in
// it, so they pass. Checked as whole words, only inside color properties.
const NAMED_COLORS = new Set(
  "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen".split(" "),
);

// Properties that carry a color. Only these are checked for foreign vars: a non-`--hh-` var in any other
// property (a size, `content`, `transition`) is not flagged, because a harness may name its own custom
// properties for measures; its literal px values are still checked against the scale. Named colors
// (`red`) are flagged in these properties only. Keyframe steps
// check literal colors only, not foreign vars. Offenders of every size kind in a harness file share the
// kind `harness-size`, so identical selector + value collapse into one line.
const COLOR_PROPS =
  /^(?:-webkit-)?(?:(?:text-fill|tap-highlight)-color|color|background(?:-image|-color)?|(?:border|outline|column-rule)(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-color)?|border-image|fill|stroke|stop-color|flood-color|lighting-color|caret-color|accent-color|text-decoration(?:-color)?|text-emphasis-color|box-shadow|text-shadow|scrollbar-color|filter)$/;
const VAR_CALL = /var\(\s*(--[\w-]+)/g;

const line = (file: string, kind: Kind, where: string, value: string) => `${file}|${kind}|${where}|${value}`;

const COUNT_SUFFIX = / \u00d7(\d+)$/;
/** Collapses repeated lines into one with a " ×N" suffix (N > 1), keeping first-seen order. */
function countLines(items: string[]): string[] {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i, (counts.get(i) ?? 0) + 1);
  return [...counts].map(([k, n]) => (n > 1 ? `${k} \u00d7${n}` : k));
}
/** Reads a list line back into its key and count (1 when there is no suffix). */
export function parseCounted(l: string): { key: string; count: number } {
  const m = COUNT_SUFFIX.exec(l);
  return m ? { key: l.slice(0, m.index), count: Number(m[1]) } : { key: l, count: 1 };
}

/** Drops var(), url() and env() calls: their content is not a value of the property. calc / min / max /
 * clamp stay, because their literals are sizes like any other. */
function stripCalls(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; ) {
    const m = /^(?:var|url|env)\(/.exec(value.slice(i));
    if (m && !/[\w-]/.test(value[i - 1] ?? " ")) {
      // Balanced parentheses, so a fallback like var(--a, calc(10px)) goes away whole.
      let depth = 0;
      let j = i + m[0].length - 1;
      for (; j < value.length; j++) {
        if (value[j] === "(") depth++;
        else if (value[j] === ")" && --depth === 0) break;
      }
      out += " ";
      i = j + 1;
    } else out += value[i++];
  }
  return out;
}

/** Compares the known list with a fresh scan: `added` are offenders above their listed count (or not
 * listed), `fixed` are listed offenders now below it. Both are printed in the failure messages. */
export function compareCounts(known: string[], now: string[]): { added: string[]; fixed: string[] } {
  const sum = (lines: string[]) => {
    const m = new Map<string, number>();
    for (const l of lines) {
      const { key, count } = parseCounted(l);
      m.set(key, (m.get(key) ?? 0) + count);
    }
    return m;
  };
  const k = sum(known);
  const n = sum(now);
  return {
    added: [...n].filter(([key, c]) => c > (k.get(key) ?? 0)).map(([key, c]) => `${key} (now ${c}, list ${k.get(key) ?? 0})`),
    fixed: [...k].filter(([key, c]) => (n.get(key) ?? 0) < c).map(([key, c]) => `${key} (list ${c}, now ${n.get(key) ?? 0})`),
  };
}

type Length = { px: number; text: string };
/** px and rem literals (rem at 16px), with the text to report. In `font-size`, the guide's own
 * `calc(Nem ± 1px)` ("one point below the surrounding text", §2) leaves its 1px offset out. */
function lengths(value: string, prop = ""): Length[] {
  let v = stripCalls(value);
  if (prop === "font-size") v = v.replace(/(calc\(\s*[\d.]+em\s*[-+]\s*)1px\b/g, "$1");
  return [...v.matchAll(/(?<![\w.#-])(-?\d*\.?\d+)(px|rem)\b/g)].map((m) => ({ px: Number(m[1]) * (m[2] === "rem" ? 16 : 1), text: m[0] }));
}

const selectorParts = (selector: string) => selector.split(",").map((s) => s.trim());
const inList = (selector: string, list: string[]) => selectorParts(selector).some((s) => list.includes(s));

/** Named colors (lowercase) in a value; strings, url() and var() are not looked at. */
function namedColors(value: string): string[] {
  const words = stripCalls(value).replace(/(["'])(?:\\.|(?!\1).)*\1/g, " ").matchAll(/(?<![\w#-])[a-z]+(?![\w-])/gi);
  return [...words].map((m) => m[0].toLowerCase()).filter((w) => NAMED_COLORS.has(w));
}

function checkWeight(file: string, selector: string, token: string, out: string[]) {
  const n = token === "bold" ? 700 : /^\d+$/.test(token) ? Number(token) : null;
  if (n !== null && !WEIGHTS.includes(n)) out.push(line(file, "weight", selector, String(n)));
}

function checkDeclaration(file: string, selector: string, prop: string, value: string, opts: CssOptions, inTokenBlock: boolean, out: string[]) {
  if (!inTokenBlock) {
    for (const m of value.matchAll(COLOR)) out.push(line(file, "color", selector, m[0]));
  }
  // A custom property holds any value, so a named color in it is flagged outside token blocks only.
  if (prop.startsWith("--")) {
    if (!inTokenBlock) for (const c of namedColors(value)) out.push(line(file, "color", selector, c));
    return;
  }
  if (COLOR_PROPS.test(prop)) for (const c of namedColors(value)) out.push(line(file, "color", selector, c));
  const bare = stripCalls(value).trim();

  if (SIZE_PROPS.test(prop)) {
    const isHeight = HEIGHT_PROPS.test(prop);
    for (const { px, text } of lengths(value, prop)) {
      if (px === 0) continue;
      const own = inList(selector, PIECE_SIZES[px] ?? []);
      if (isHeight && !HEIGHTS.includes(px) && !own) out.push(line(file, "height", selector, text));
      // A width off the piece list belongs to the width tokens, which are checked elsewhere.
      else if (!isHeight && px in PIECE_SIZES && !own) out.push(line(file, "width", selector, text));
    }
  } else if (RADIUS_PROPS.test(prop)) {
    // Math functions are opened up so their literals are tokens too.
    for (const token of bare.replace(/\b(?:calc|min|max|clamp)\(|[(),*]/g, " ").split(/[\s/]+/).filter(Boolean)) {
      const m = /^(-?\d*\.?\d+)(px|rem|%)$/.exec(token);
      if (!m) continue;
      const n = Number(m[1]) * (m[2] === "rem" ? 16 : 1);
      if (n === 0) continue;
      const round = (m[2] === "px" && n === 999) || (m[2] === "%" && n === 50);
      const ok = round
        ? inList(selector, ROUND_SELECTORS)
        : m[2] !== "%" && (RADII.includes(n) || (n === 4 && selectorParts(selector).some((s) => /(?:^|[\s>+~])code$/.test(s))));
      if (!ok) out.push(line(file, "radius", selector, token));
    }
  } else if (SPACE_PROPS.test(prop)) {
    for (const { px, text } of lengths(value)) {
      if (px <= 0 || SPACES.includes(px)) continue;
      const topBar = px === 90 && prop.startsWith("padding") && inList(selector, opts.topBarSelectors ?? []);
      if (!topBar) out.push(line(file, "space", selector, text));
    }
  } else if (prop === "font-size") {
    for (const { px, text } of lengths(value, prop)) if (!FONT_SIZES.includes(px)) out.push(line(file, "font-size", selector, text));
  } else if (prop === "font-weight") {
    checkWeight(file, selector, bare, out);
  } else if (prop === "font") {
    // Shorthand: [style variant weight stretch] size[/line-height] family. The line height is cut first so
    // it is not read as the size; the weight is whatever stands before the size.
    const noLineHeight = bare.replace(/\/\s*[^\s,]+/, " ");
    const size = lengths(noLineHeight, "font-size")[0];
    if (size && !FONT_SIZES.includes(size.px)) out.push(line(file, "font-size", selector, size.text));
    // Up to the first token that is a size, a function or a family (a calc size has no plain length left).
    for (const t of noLineHeight.split(/\s+/)) {
      if (/[\d.]+(?:px|rem|em|%)|\(|^["']/.test(t)) break;
      if (/^(?:\d{3,4}|bold|bolder|lighter)$/.test(t)) checkWeight(file, selector, t, out);
    }
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
      // A keyframe step holds animated values, so only its colors are checked (literal, and named ones in
      // color or custom properties); they are reported under the animation's name because step names
      // (`from`, `50%`) would collide between animations.
      const parent = stack[stack.length - 2];
      if (top.keyframes && !top.selector.startsWith("@") && parent) {
        const stepProp = text.slice(0, idx).trim().toLowerCase();
        const stepValue = text.slice(idx + 1);
        const kind = opts.harness ? "harness-color" : "color";
        for (const m of stepValue.matchAll(COLOR)) out.push(line(file, kind, parent.selector, m[0]));
        if (COLOR_PROPS.test(stepProp) || stepProp.startsWith("--")) for (const c of namedColors(stepValue)) out.push(line(file, kind, parent.selector, c));
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
    for (const f of found) out.push(f.replace("|color|", "|harness-color|").replace(/\|(?:height|width|radius|space|font-size|weight)\|/, "|harness-size|"));
    if (COLOR_PROPS.test(prop)) {
      for (const m of value.matchAll(VAR_CALL)) if (!m[1].startsWith("--hh-")) out.push(line(file, "harness-color", top.selector, `var(${m[1]})`));
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
  return countLines(out);
}

type Part = { text: string; dynamicStart: boolean; dynamicEnd: boolean };

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
      parts.push({ text: src.slice(i + 1, end - 1), dynamicStart: false, dynamicEnd: false });
      i = end - 1;
    } else if (ch === "`") {
      const end = skipString(src, i);
      let buf = "";
      let afterExpr = false;
      for (let j = i + 1; j < end - 1; j++) {
        if (src[j] === "$" && src[j + 1] === "{") {
          const close = matchBrace(src, j + 1);
          parts.push({ text: buf, dynamicStart: afterExpr, dynamicEnd: true }, ...stringParts(src.slice(j + 2, close)));
          buf = "";
          afterExpr = true;
          j = close;
        } else buf += src[j];
      }
      parts.push({ text: buf, dynamicStart: afterExpr, dynamicEnd: false });
      i = end - 1;
    }
  }
  return parts;
}

/**
 * Scans one TSX file: every `hh-*` class in a `className` must be in the guide's list, and a `style`
 * object must not hold a hex / rgb / hsl or named color. A class token touching an interpolation
 * (`hh-btn--${v}`) is built at run time and is not checked.
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
        const cutEnd = part.dynamicEnd && c.index + name.length === part.text.length;
        const cutStart = part.dynamicStart && c.index === 0;
        if (!cutEnd && !cutStart && !guideClasses.has(name)) out.push(line(file, "class", name, name));
      }
    }
  }

  for (const m of tsx.matchAll(/\bstyle\s*=\s*\{/g)) {
    const open = m.index + m[0].length - 1;
    const end = matchBrace(tsx, open);
    for (const c of tsx.slice(open, end).matchAll(COLOR)) out.push(line(file, "color", "style", c[0]));
    for (const c of styleNamedColors(tsx.slice(open + 1, end))) out.push(line(file, "color", "style", c));
  }
  return countLines(out);
}

/** Splits at the commas that are not inside a string or a bracket. */
function splitTop(src: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === "`") i = skipString(src, i) - 1;
    else if ("({[".includes(ch)) depth++;
    else if (")}]".includes(ch)) depth--;
    else if (ch === "," && depth === 0) {
      parts.push(src.slice(from, i));
      from = i + 1;
    }
  }
  return [...parts, src.slice(from)];
}

/** Named colors in the string literals of every color property of a style object, whatever the shape of
 * the value (ternary, template) and the key (`backgroundColor`, `"color"`); nested objects are walked. */
function styleNamedColors(obj: string): string[] {
  const found: string[] = [];
  for (const seg of splitTop(obj)) {
    const t = seg.trim();
    if (t.startsWith("{")) {
      found.push(...styleNamedColors(t.slice(1, matchBrace(t, 0))));
      continue;
    }
    const kv = /^(["']?)([\w-]+)\1\s*:([\s\S]*)$/.exec(t);
    if (!kv) continue;
    const value = kv[3].trim();
    if (value.startsWith("{")) found.push(...styleNamedColors(value.slice(1, matchBrace(value, 0))));
    else if (COLOR_PROPS.test(kv[2].replace(/[A-Z]/g, (u) => `-${u.toLowerCase()}`))) for (const p of stringParts(value)) found.push(...namedColors(p.text));
  }
  return found;
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

const subdirs = (base: string): string[] =>
  existsSync(base) ? readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(base, e.name)) : [];

/** Harness and plugin stylesheet roots (§15). Absent directories are simply not in the list. */
export function harnessRoots(root: string): string[] {
  const harnesses = subdirs(join(root, "harnesses"));
  return [
    ...harnesses.map((d) => join(d, "ui")),
    ...harnesses.flatMap((d) => subdirs(join(d, "plugins"))).map((d) => join(d, "panels")),
    join(root, "packages/cli/template/ui"),
    ...subdirs(join(root, "packages/e2e/fixtures/plugins")).map((d) => join(d, "panels")),
  ];
}

/** Scans every .css under one harness root in harness mode; `dist/` and `node_modules` are skipped. */
export function scanHarnessCss(repoRoot: string, dir: string): string[] {
  if (!existsSync(dir)) return [];
  return filesUnder(dir, ".css").flatMap((f) => scanCss(relative(repoRoot, f).split("\\").join("/"), readFileSync(f, "utf8"), { harness: true }));
}

/** Scans the app's own sources. Paths in the result are relative to the repo root. */
export function scanRepo(): string[] {
  const src = join(REPO_ROOT, "packages/ui/src");
  const rel = (f: string) => relative(REPO_ROOT, f).split("\\").join("/");
  const out: string[] = [];
  const css = (f: string, opts: CssOptions) => out.push(...scanCss(rel(f), readFileSync(f, "utf8"), opts));

  css(join(src, "styles.css"), { tokenFile: true, topBarSelectors: TOP_BAR_SELECTORS });
  for (const f of filesUnder(join(src, "plugin-ui"), ".css")) css(f, { tokenFile: rel(f) === "packages/ui/src/plugin-ui/tokens.css" });
  for (const f of filesUnder(src, ".tsx")) out.push(...scanTsx(rel(f), readFileSync(f, "utf8"), GUIDE_CLASSES));
  for (const root of harnessRoots(REPO_ROOT)) out.push(...scanHarnessCss(REPO_ROOT, root));
  return out.sort();
}
