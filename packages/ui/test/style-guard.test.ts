import { afterEach, describe, expect, it } from "vitest";
import { PIECE_SIZES, ROUND_SELECTORS, scanCss, scanTsx } from "./style-guard-lib";

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
    expect(scanCss("a.css", css, {})).toEqual(["a.css|weight|.a|700", "a.css|space|.a|10px", "a.css|radius|.b|6px"]);
  });
  it("treats only the code element as inline code", () => {
    expect(scanCss("a.css", ".hh-code { border-radius: 4px; }", {})).toEqual(["a.css|radius|.hh-code|4px"]);
  });
  it("throws on unbalanced input instead of dropping the rest of the file", () => {
    expect(() => scanCss("a.css", ".a { color: red;", {})).toThrow(/unbalanced/);
  });
});
