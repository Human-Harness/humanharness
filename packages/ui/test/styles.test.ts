import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AVATAR_COLORS } from "../src/profiles";

const css = readFileSync(resolve(__dirname, "../src/styles.css"), "utf8");
const [light, dark] = css.split("prefers-color-scheme: dark");
const token = (block: string, name: string) => block.match(new RegExp(`--hh-${name}:\\s*(#[0-9a-f]{6})`, "i"))![1].toLowerCase();

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe("design tokens", () => {
  const LIGHT: Record<string, string> = {
    bg: "#f3f3f1", rail: "#fbfbfa", column: "#f8f8f6", surface: "#ffffff", "surface-2": "#f2f2ef",
    line: "#e7e7e3", "line-strong": "#d9d9d4", ink: "#1b1c1e", muted: "#62656b", faint: "#8a8d93",
    cta: "#fbd38d", "cta-ink": "#3b2a06", "cta-hover": "#f8c76e", active: "#fde6b3", "active-ink": "#7a4f00",
    "t-green": "#dff2e5", "t-green-ink": "#1d6e3f", "t-orange": "#fdebd7", "t-orange-ink": "#a94f08",
    "t-blue": "#e4ecfd", "t-blue-ink": "#2d55c4", "t-violet": "#ece6fb", "t-violet-ink": "#5f3dba",
    "t-red": "#fbe4e1", "t-red-ink": "#a3321f",
  };
  const DARK: Record<string, string> = {
    bg: "#121315", rail: "#16171a", column: "#17181b", surface: "#1e2024", "surface-2": "#26292e",
    line: "#2a2d32", "line-strong": "#383c42", ink: "#eceef0", muted: "#a3a8ae", faint: "#80858c",
    cta: "#f3c56a", "cta-ink": "#2a1d02", "cta-hover": "#f7d184", active: "#3a2e14", "active-ink": "#f3c56a",
    "t-green": "#17311f", "t-green-ink": "#8bd8a8", "t-orange": "#3a2715", "t-orange-ink": "#f4b47e",
    "t-blue": "#1c2944", "t-blue-ink": "#a3beff", "t-violet": "#29223f", "t-violet-ink": "#c6b4ff",
    "t-red": "#3b1d19", "t-red-ink": "#f3a497",
  };
  const TAGS = ["green", "orange", "blue", "violet", "red"];

  it("uses the UI refresh palette in light and dark (spec §3.1)", () => {
    for (const [name, hex] of Object.entries(LIGHT)) expect(token(light, name), name).toBe(hex);
    for (const [name, hex] of Object.entries(DARK)) expect(token(dark, name), name).toBe(hex);
  });

  it("keeps text readable: ink ≥ 7:1 and muted ≥ 4.5:1 on every ground, each tag ink ≥ 4.5:1 on its fill", () => {
    for (const block of [light, dark]) {
      for (const bg of ["bg", "rail", "column", "surface", "surface-2"]) {
        expect(ratio(token(block, "ink"), token(block, bg)), `ink on ${bg}`).toBeGreaterThanOrEqual(7);
        expect(ratio(token(block, "muted"), token(block, bg)), `muted on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
      for (const t of TAGS) expect(ratio(token(block, `t-${t}-ink`), token(block, `t-${t}`)), t).toBeGreaterThanOrEqual(4.5);
      expect(ratio(token(block, "cta-ink"), token(block, "cta"))).toBeGreaterThanOrEqual(7);
      expect(ratio(token(block, "active-ink"), token(block, "active"))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("drops the renamed tokens (paper, sheet, segment, slate)", () => {
    for (const old of ["paper", "sheet", "segment", "slate"]) expect(css).not.toMatch(new RegExp(`--hh-${old}:`));
  });

  // spec §2 Color: the only color tokens. Tag tokens keep today's names (--hh-t-<color>, --hh-t-<color>-ink).
  const GUIDE_COLORS = [
    "bg", "rail", "column", "surface", "surface-2", "line", "line-strong", "ink", "muted", "faint",
    "cta", "cta-ink", "cta-hover", "active", "active-ink",
    "t-green", "t-green-ink", "t-orange", "t-orange-ink", "t-blue", "t-blue-ink",
    "t-violet", "t-violet-ink", "t-red", "t-red-ink",
  ];
  const NON_COLOR = ["shadow", "backdrop", "font", "mono", "display"]; // plus the measure tokens of Task 5
  const colorTokens = (block: string) =>
    [...block.matchAll(/--hh-([a-z0-9-]+):\s*(#[0-9a-f]{3,8}|rgba?\([^)]*\)|var\(--hh-[a-z0-9-]+\))/gi)].map((m) => m[1]);

  it("defines exactly the guide's color tokens in light and dark (style guide §2)", () => {
    for (const block of [light, dark]) {
      const names = colorTokens(block).filter((n) => !NON_COLOR.includes(n) && !n.endsWith("-w") && !n.endsWith("-h") && !n.endsWith("-r"));
      expect(new Set(names)).toEqual(new Set(GUIDE_COLORS));
    }
  });

  it("drops the single-use tokens (style guide §2 'Tokens that go', row 45)", () => {
    for (const gone of ["callout-", "review-", "diff-", "profile-", "highlight", "logo", "on-ink", "ok:", "ok-dot", "warn:", "error-bg", "shadow-sm"])
      expect(css).not.toMatch(new RegExp(`--hh-${gone}`));
  });
});

describe("styles", () => {
  it("gives the timeline's chips their own classes: the start view's .hh-chip rule is the only one (D0)", () => {
    expect(css.match(/^\.hh-chip[\s,{-]/gm)).toEqual([".hh-chip "]);
    expect(css).toMatch(/^\.hh-chip\s*{\s*height:\s*32px;/m);
    for (const c of ["", "-amber", "-green", "-grey"]) expect(css).toMatch(new RegExp(`^\\.hh-timeline-chip${c}\\s*{`, "m"));
  });

  it("keeps the file diff's rules in one block of its own classes, so they restyle nothing else (D0)", () => {
    const lines = css.split("\n");
    const at = lines.flatMap((l, i) => (l.includes("hh-filediff") ? [i] : []));
    expect(at.length).toBeGreaterThan(10);
    expect(at.at(-1)! - at[0]).toBe(at.length - 1);
    for (const i of at.slice(1)) expect(lines[i].startsWith(".hh-filediff")).toBe(true);
  });

  it("makes the top bar the window's drag region, except its controls", () => {
    expect(css).toMatch(/\.hh-topbar\s*{[^}]*-webkit-app-region:\s*drag/);
    expect(css).toMatch(/\.hh-topbar button,[^{]*{[^}]*-webkit-app-region:\s*no-drag/);
  });

  it("keeps 90px for the traffic lights and a gap before the first text (spec §4.1)", () => {
    expect(css).toMatch(/^\.hh-topbar\s*{[^}]*padding:\s*0 16px 0 90px/m);
    expect(css).toMatch(/^\.hh-topbar\s*{[^}]*background:\s*var\(--hh-rail\)/m);
  });

  it("lets the top bar's selects open (the scope picker, the profile switcher) instead of dragging the window", () => {
    expect(css).toMatch(/\.hh-topbar button,[^{]*\.hh-topbar select[^{]*{[^}]*-webkit-app-region:\s*no-drag/);
  });

  it("keeps the profile switcher's refusal on one line in the top bar", () => {
    expect(css).toMatch(/\.hh-profile-switcher \[role="alert"\]\s*{[^}]*white-space:\s*nowrap[^}]*text-overflow:\s*ellipsis/);
  });

  it("uses DM Sans for text and display, 14px base, with no network fonts (spec §3.2)", () => {
    expect(css).toMatch(/--hh-font:\s*"DM Sans",/);
    expect(css).toMatch(/--hh-display:\s*var\(--hh-font\)/);
    expect(css).toMatch(/:root\s*{[^}]*font-size:\s*14px/);
    expect(css).not.toMatch(/Lexend/);
    expect(css).not.toMatch(/url\(\s*["']?https?:/);
    expect(css).not.toMatch(/@import/);
  });

  it("preserves single line breaks in messages", () => {
    expect(css).toMatch(/\.hh-message p\s*{[^}]*white-space:\s*pre-wrap/);
  });

  it("draws the CTA's focus ring inside it, in its ink", () => {
    expect(css).toMatch(/^\.hh-primary:focus-visible,\s*\.hh-cta:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--hh-cta-ink\)[^}]*outline-offset:\s*-\d/m);
    expect(css).not.toMatch(/\.hh-start:focus-visible/);
  });

  it("keeps the border of buttons that set their own on hover", () => {
    const hover = (sel: string) => css.match(new RegExp(`^${sel}:hover:not\\(:disabled\\)[^{]*{[^}]*border-color:\\s*([^;}]+)`, "m"))?.[1].trim();
    expect(hover("\\.hh-steps button")).toBe("transparent");
    expect(hover('\\.hh-steps button\\[aria-current="step"\\]')).toBe("var(--hh-line)");
    expect(hover("\\.hh-choice\\.next")).toBe("var(--hh-ink)");
    expect(css).toMatch(/\.hh-choice\[aria-pressed="true"\]:hover:not\(:disabled\)\s*{[^}]*border-color:\s*var\(--hh-ink\)/);
    expect(hover('\\.hh-pl-tab\\[aria-selected="true"\\]')).toBe("var(--hh-ink)");
  });

  it("has the soft-cards controls: amber CTA, tags by meaning, no chamfer (spec §3.2–3.3)", () => {
    expect(css).toMatch(/^\.hh-primary,\s*\.hh-cta\s*{[^}]*background:\s*var\(--hh-cta\)[^}]*color:\s*var\(--hh-cta-ink\)/m);
    expect(css).not.toMatch(/clip-path:\s*polygon/);
    for (const t of ["green", "orange", "blue", "violet", "red"])
      expect(css).toMatch(new RegExp(`^\\.hh-tag-${t}\\s*{\\s*background:\\s*var\\(--hh-t-${t}\\);\\s*color:\\s*var\\(--hh-t-${t}-ink\\)`, "m"));
    expect(css).toMatch(/^\.hh-tag-gray\s*{\s*background:\s*var\(--hh-surface-2\);\s*color:\s*var\(--hh-muted\)/m);
    expect(css).toMatch(/^\.hh-card\s*{[^}]*border-radius:\s*14px/m);
  });
});

describe("start view in the chat column", () => {
  it("fits a narrow chat card: the chat is a size container and the topics never overflow it", () => {
    // The flow layout puts the chat in a card between the path and the panels: ~360 px wide at the default 1100 px
    // window, ~310 px at the 900 px minimum.
    expect(css).toMatch(/^\.hh-chat\s*{[^}]*container:\s*hh-chat\s*\/\s*inline-size/m);
    expect(css).toMatch(/^\.hh-chat\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/m);
    expect(css).toMatch(/^\.hh-topics\s*{[^}]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(min\(200px,\s*100%\),\s*1fr\)\)/m);
    expect(css).toMatch(/^\.hh-topic-head\s*{[^}]*flex-wrap:\s*wrap/m);
    const narrow = css.match(/@container hh-chat \(max-width:\s*(\d+)px\)\s*{([\s\S]*?)\n}/);
    expect(narrow).not.toBeNull();
    expect(Number(narrow![1])).toBeGreaterThanOrEqual(560);
    expect(narrow![2]).toMatch(/\.hh-topics\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(narrow![2]).toMatch(/\.hh-start-view\s*{[^}]*padding:/);
  });
});

describe("flow layout (UI refresh spec §5.1)", () => {
  it("the side columns give way to the chat card, never grow against it", () => {
    expect(css).toMatch(/^\.hh-main\s*{[^}]*flex:\s*1 1 400px[^}]*min-width:\s*0/m);
    expect(css).toMatch(/^\.hh-side\s*{[^}]*box-sizing:\s*border-box[^}]*flex:\s*0 4 var\(--hh-column-w\)[^}]*min-width:\s*220px[^}]*max-width:\s*320px/m);
    expect(css).toMatch(/^\.hh-flow-side\s*{[^}]*flex:\s*0 4 var\(--hh-column-w\)[^}]*min-width:\s*220px[^}]*max-width:\s*320px/m);
  });

  it("in a setup step (slim) the chat card and the composer get no margins or shadow", () => {
    expect(css).not.toMatch(/^\.hh-chat\.hh-conversation\s*{[^}]*(margin|box-shadow):/m);
    expect(css).not.toMatch(/^\.hh-composer\s*{[^}]*(margin|box-shadow):/m);
    expect(css).toMatch(/^\.hh-app:not\(\.hh-app-slim\) \.hh-chat\.hh-conversation\s*{[^}]*margin:[^}]*box-shadow:/m);
    expect(css).toMatch(/^\.hh-app:not\(\.hh-app-slim\) \.hh-composer\s*{[^}]*margin:[^}]*box-shadow:/m);
  });
});

describe("annotate marks", () => {
  it("the highlight under a gap keeps ink readable on active in light and dark", () => {
    for (const block of [light, dark]) expect(ratio(token(block, "ink"), token(block, "active"))).toBeGreaterThanOrEqual(7);
  });
});

describe("the scope settings dialog", () => {
  it("has a rule for each class it draws its backdrop, sheet and head with", () => {
    const tsx = readFileSync(resolve(__dirname, "../src/hatches/ScopeSettings.tsx"), "utf8");
    for (const name of ["hh-scope-dialog-backdrop", "hh-scope-dialog", "hh-scope-dialog-head"]) {
      expect(tsx).toMatch(new RegExp(`className="[^"]*\\b${name}(?![\\w-])`));
      expect(css).toMatch(new RegExp(`\\.${name}\\s*\\{`));
    }
  });
});

describe("control size tokens and top bar overrides", () => {
  it("defines the 40px / 12px control tokens at root and shrinks them to 30px / 8px in the top bar", () => {
    expect(css).toMatch(/:root\s*\{[^}]*--hh-control-h:\s*40px;[^}]*--hh-control-r:\s*12px/);
    expect(css).toMatch(/\.hh-topbar\s*\{[^}]*--hh-control-h:\s*30px;[^}]*--hh-control-r:\s*8px/);
  });

  it("has rules for the top bar icon button and the language row label", () => {
    expect(css).toMatch(/\.hh-topbar-icon\s*\{/);
    expect(css).toMatch(/\.hh-langrow-label\s*\{|\.hh-langrow-label::after\s*\{/);
    const tsx = readFileSync(resolve(__dirname, "../src/chrome.tsx"), "utf8");
    expect(tsx).toMatch(/className="hh-topbar-icon"/);
  });
});

describe("profile avatars (style guide §2 special uses)", () => {
  it("six colors, each a tag fill with its tag ink; grey is surface-2 + ink", () => {
    expect([...AVATAR_COLORS]).toEqual(["green", "orange", "blue", "violet", "red", "gray"]);
    for (const c of ["green", "orange", "blue", "violet", "red"])
      expect(css).toMatch(new RegExp(`\\.hh-avatar\\[data-color="${c}"\\]\\s*{[^}]*background:\\s*var\\(--hh-t-${c}\\);[^}]*color:\\s*var\\(--hh-t-${c}-ink\\)`));
    expect(css).toMatch(/\.hh-avatar\[data-color="gray"\]\s*{[^}]*background:\s*var\(--hh-surface-2\);[^}]*color:\s*var\(--hh-ink\)/);
  });
});

describe("widths (style guide §2 Widths)", () => {
  it("defines the closed width tokens", () => {
    expect(css).toMatch(/:root\s*{[^}]*--hh-rail-w:\s*64px/);
    expect(css).toMatch(/:root\s*{[^}]*--hh-column-w:\s*280px/);
    expect(css).toMatch(/:root\s*{[^}]*--hh-split-w:\s*55%/);
    expect(css).toMatch(/:root\s*{[^}]*--hh-read-w:\s*680px/);
    expect(css).toMatch(/:root\s*{[^}]*--hh-dialog-w:\s*440px/);
    expect(css).toMatch(/:root\s*{[^}]*--hh-dialog-w-search:\s*640px/);
    expect(css).toMatch(/:root\s*{[^}]*--hh-popover-w:\s*320px/);
    expect(css).toMatch(/:root\s*{[^}]*--hh-index-w:\s*200px/);
  });
  it("the rail uses its token", () => {
    expect(css).toMatch(/^\.hh-rail\s*{[^}]*width:\s*var\(--hh-rail-w\)/m);
  });
});

describe("type (style guide §2 Type)", () => {
  it("only 12, 13, 14, 15, 16, 20 and 28 px text", () => {
    const sizes = new Set([...css.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1])));
    for (const s of sizes) expect([12, 13, 14, 15, 16, 20, 28], `${s}px`).toContain(s);
  });
  it("only weights 400, 500 and 600", () => {
    const w = new Set([...css.matchAll(/font-weight:\s*(\d+)/g)].map((m) => Number(m[1])));
    for (const v of w) expect([400, 500, 600]).toContain(v);
  });
  it("inline code: DM Mono 400, one point below, surface-2, radius 4", () => {
    expect(css).toMatch(/--hh-mono:\s*"DM Mono"/);
    expect(css).toMatch(/^:not\(pre\)\s*>\s*code\s*{[^}]*font-family:\s*var\(--hh-mono\)[^}]*font-size:\s*calc\(1em - 1px\)[^}]*background:\s*var\(--hh-surface-2\)[^}]*border-radius:\s*4px/m);
  });
  it("raw diff line code is not styled as inline code, and the reset stays off the Markdown diff", () => {
    expect(css).toMatch(/^\.hh-filediff-lines code,\s*\.hh-filediff-mono code\s*{[^}]*background:\s*none[^}]*border-radius:\s*0[^}]*font-size:\s*12px/m);
    expect(css).not.toMatch(/^\.hh-filediff code/m);
  });
});
