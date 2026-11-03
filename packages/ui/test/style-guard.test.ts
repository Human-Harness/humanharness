import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GUIDE_CLASSES } from "../src/guide/classes";
import offenders from "./style-guard-offenders.json";
import { PIECE_SIZES, ROUND_SELECTORS, scanCss, scanHarnessCss, scanRepo, scanTsx } from "./style-guard-lib";

describe("style guard scanner (style guide §15 Control)", () => {
  it("flags a loose color outside the token blocks, not inside them", () => {
    expect(scanCss("a.css", ":root { --hh-ink: #111111; }\n.x { color: #222222; }", { tokenFile: true })).toEqual(["a.css|color|.x|#222222"]);
  });
  it("flags off-scale heights, radii, spacing, font sizes and weights", () => {
    const out = scanCss("a.css", ".x { height: 36px; border-radius: 6px; gap: 10px; font-size: 11px; font-weight: 700; }", {});
    expect(out).toEqual(["a.css|height|.x|36px", "a.css|radius|.x|6px", "a.css|space|.x|10px", "a.css|font-size|.x|11px", "a.css|weight|.x|700"]);
  });
  it("allows the guide's values", () => {
    expect(scanCss("a.css", ".x { height: 30px; border-radius: 8px; padding: 0 16px 0 90px; gap: 12px; font-size: 13px; font-weight: 500; }", { topBarSelectors: [".x"] })).toEqual([]);
  });
  it("flags a className outside the guide's list", () => {
    expect(scanTsx("A.tsx", '<div className="hh-card hh-weird" />', new Set(["hh-card"]))).toEqual(["A.tsx|class|hh-weird|hh-weird"]);
  });
  it("flags a hex or rgb color in a TSX style", () => {
    expect(scanTsx("A.tsx", '<div style={{ color: "#fff" }} />', new Set())).toEqual(["A.tsx|color|style|#fff"]);
  });
});

describe("harness mode (style guide §15 Harness chat blocks)", () => {
  it("allows only --hh-* vars for color and scale values for sizes", () => {
    expect(scanCss("h.css", ".b { color: var(--hh-ink); background: var(--other); padding: 7px; }", { harness: true })).toEqual([
      "h.css|harness-color|.b|var(--other)",
      "h.css|harness-size|.b|7px",
    ]);
  });
  it("flags a literal hex, lets keywords and measure tokens through, ignores foreign vars outside color props", () => {
    const css = ".b { color: #fff; border: 1px solid transparent; background: inherit; padding: var(--hh-s-3); margin: var(--gap); border-color: currentColor; }";
    expect(scanCss("h.css", css, { harness: true })).toEqual(["h.css|harness-color|.b|#fff"]);
  });
});

describe("harness foreign vars", () => {
  const h = (css: string) => scanCss("h.css", css, { harness: true });
  it("sees a foreign var with a nested fallback, and one nested inside a fallback", () => {
    expect(h(".b { color: var(--other, var(--hh-ink)); }")).toEqual(["h.css|harness-color|.b|var(--other)"]);
    expect(h(".b { color: var(--hh-ink, var(--other)); }")).toEqual(["h.css|harness-color|.b|var(--other)"]);
  });
  it("checks vars in gradients, svg colors, webkit colors and filters", () => {
    expect(h(".b { background-image: linear-gradient(var(--x), var(--hh-line)); stop-color: var(--y); -webkit-text-fill-color: var(--z); filter: drop-shadow(0 0 var(--w)); }")).toEqual([
      "h.css|harness-color|.b|var(--x)",
      "h.css|harness-color|.b|var(--y)",
      "h.css|harness-color|.b|var(--z)",
      "h.css|harness-color|.b|var(--w)",
    ]);
  });
});

describe("harness stylesheet walk", () => {
  it("skips dist, node_modules and absent directories", () => {
    const root = mkdtempSync(join(tmpdir(), "sg-"));
    const ui = join(root, "ui");
    for (const d of ["dist", "node_modules/pkg"]) mkdirSync(join(ui, d), { recursive: true });
    writeFileSync(join(ui, "a.css"), ".a { padding: 7px; }");
    writeFileSync(join(ui, "dist/b.css"), ".b { padding: 7px; }");
    writeFileSync(join(ui, "node_modules/pkg/c.css"), ".c { padding: 7px; }");
    expect(scanHarnessCss(root, ui)).toEqual(["ui/a.css|harness-size|.a|7px"]);
    expect(scanHarnessCss(root, join(root, "plugins"))).toEqual([]);
  });
});

describe("style guard scanner details", () => {
  // The lists are shared module state that later parts extend; keep these cases from leaking into each other.
  afterEach(() => {
    PIECE_SIZES[8] = [];
    ROUND_SELECTORS.length = 0;
  });

  it("allows a piece size only on its own selectors", () => {
    expect(scanCss("a.css", ".x { height: 8px; }", {})).toEqual(["a.css|height|.x|8px"]);
    PIECE_SIZES[8].push(".x");
    expect(scanCss("a.css", ".x { height: 8px; }", {})).toEqual([]);
    expect(scanCss("a.css", ".y { height: 8px; }", {})).toEqual(["a.css|height|.y|8px"]);
  });
  it("allows 4px radius on code and round radii only on round selectors", () => {
    expect(scanCss("a.css", ".md code { border-radius: 4px; }\n.dot { border-radius: 999px; }", {})).toEqual(["a.css|radius|.dot|999px"]);
    ROUND_SELECTORS.push(".dot");
    expect(scanCss("a.css", ".dot { border-radius: 999px; } .av { border-radius: 50%; }", {})).toEqual(["a.css|radius|.av|50%"]);
  });
  it("lets tokens and keywords through the size checks", () => {
    const css = ".x { height: var(--hh-h-md); padding: 0 var(--hh-s-3) auto; margin: -4px; font-size: calc(1em - 1px); width: 50%; font-weight: var(--w); border-radius: inherit; }";
    expect(scanCss("a.css", css, {})).toEqual([]);
  });
  it("walks nested at-rules, ignores comments and flags 90 outside the top bar", () => {
    const css = "/* .a { color: #fff } */\n@media (max-width: 600px) { .y { padding-left: 90px; color: rgba(0,0,0,.5); } }";
    expect(scanCss("a.css", css, {})).toEqual(["a.css|space|.y|90px", "a.css|color|.y|rgba(0,0,0,.5)"]);
  });
  it("accepts colors in dark and theme token blocks of a token file", () => {
    const css = '@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --a: #000; } }\n:root[data-theme="dark"] { --a: #000; }';
    expect(scanCss("t.css", css, { tokenFile: true })).toEqual([]);
  });
  it("reads class names from expressions and templates, checking dynamic prefixes", () => {
    const src = 'const a = <div className={cx("hh-card", on && "hh-bad", `hh-btn--${v} hh-tpl`)} />;';
    expect(scanTsx("A.tsx", src, new Set(["hh-card", "hh-btn--primary"]))).toEqual(["A.tsx|class|hh-bad|hh-bad", "A.tsx|class|hh-tpl|hh-tpl"]);
  });

  it("frees colors only in pure token blocks, not in rules that start with :root", () => {
    const css = ':root .x { color: #123; }\n[data-theme="dark"] .y { background: #000; }\n:root { --a: #fff; }';
    expect(scanCss("t.css", css, { tokenFile: true })).toEqual(["t.css|color|:root .x|#123", 't.css|color|[data-theme="dark"] .y|#000']);
  });
  it("is not fooled by escaped quotes, comment markers or separators inside strings and urls", () => {
    const css = '.a { content: "\\"{"; }\n.b { content: "/*"; height: 7px; }\n.c { background: url(data:image/png;base64,AA{;}) ; padding: 10px; }';
    expect(scanCss("a.css", css, {})).toEqual(["a.css|height|.b|7px", "a.css|space|.c|10px"]);
  });
  it("handles !important, keyframes, font-face and multi-value margins", () => {
    const css = [
      ".a { font-weight: 700 ! important; margin: -4px auto 10px 0; }",
      "@keyframes k { from { height: 7px; } 50% { color: #fff; } }",
      "@font-face { font-family: x; src: url(x.woff2); }",
      ".b { border-radius: 8px 6px / 12px; }",
    ].join("\n");
    expect(scanCss("a.css", css, {})).toEqual(["a.css|weight|.a|700", "a.css|space|.a|10px", "a.css|color|@keyframes k|#fff", "a.css|radius|.b|6px"]);
  });
  it("flags a literal color in a keyframe step, even in a token file, but not var()", () => {
    const css = "@keyframes pulse { from { background: var(--hh-accent); } to { background: rgba(0, 0, 0, .5); box-shadow: 0 0 0 7px #abc; } }";
    expect(scanCss("t.css", css, { tokenFile: true })).toEqual(["t.css|color|@keyframes pulse|rgba(0, 0, 0, .5)", "t.css|color|@keyframes pulse|#abc"]);
  });
  it("treats only the code element as inline code", () => {
    expect(scanCss("a.css", ".hh-code { border-radius: 4px; }", {})).toEqual(["a.css|radius|.hh-code|4px"]);
  });
  it("throws on unbalanced input instead of dropping the rest of the file", () => {
    expect(() => scanCss("a.css", ".a { color: red;", {})).toThrow(/unbalanced/);
  });
});

describe("the app stays inside the guide (style guide §15 Control, §16.2)", () => {
  const found = scanRepo(); // styles.css, plugin-ui/*.css and packages/ui/src/**/*.tsx; harness and plugin CSS included
  it("no new offender: fix it, don't add it to the list", () => {
    const known = new Set(offenders as string[]);
    const added = found.filter((o) => !known.has(o));
    const how =
      "Use a token or a scale value (style guide §2), or add the piece's class to packages/ui/src/guide/classes.ts in the PR that adds the piece (§15). " +
      "Never add lines to style-guard-offenders.json. New offenders (file|kind|where|value):\n" + added.join("\n");
    expect(added, how).toEqual([]);
  });
  it("the list only shrinks: remove an offender you fixed", () => {
    const now = new Set(found);
    const fixed = (offenders as string[]).filter((o) => !now.has(o));
    const how = "These offenders are fixed: remove these lines from packages/ui/test/style-guard-offenders.json:\n" + fixed.join("\n");
    expect(fixed, how).toEqual([]);
  });
});

describe("the guide's class list", () => {
  const css = readFileSync(resolve(__dirname, "../src/styles.css"), "utf8");
  it("every guide class has a rule in styles.css", () => {
    for (const c of GUIDE_CLASSES) expect(css, c).toMatch(new RegExp(`\\.${c}(?![\\w-])`));
  });
});
