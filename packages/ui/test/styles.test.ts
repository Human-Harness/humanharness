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
    logo: "#1b1c1e", "logo-ink": "#ffffff",
    "t-green": "#dff2e5", "t-green-ink": "#1d6e3f", "t-orange": "#fdebd7", "t-orange-ink": "#a94f08",
    "t-blue": "#e4ecfd", "t-blue-ink": "#2d55c4", "t-violet": "#ece6fb", "t-violet-ink": "#5f3dba",
    "t-red": "#fbe4e1", "t-red-ink": "#a3321f",
  };
  const DARK: Record<string, string> = {
    bg: "#121315", rail: "#16171a", column: "#17181b", surface: "#1e2024", "surface-2": "#26292e",
    line: "#2a2d32", "line-strong": "#383c42", ink: "#eceef0", muted: "#a3a8ae", faint: "#80858c",
    cta: "#f3c56a", "cta-ink": "#2a1d02", "cta-hover": "#f7d184", active: "#3a2e14", "active-ink": "#f3c56a",
    logo: "#eceef0", "logo-ink": "#121315",
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

  it("keeps highlight equal to active in light and dark", () => {
    // highlight is a hex copy of active, not var(--hh-active), because token() reads hex values only.
    for (const block of [light, dark]) expect(token(block, "highlight")).toBe(token(block, "active"));
  });

  it("drops the renamed tokens (paper, sheet, segment, slate)", () => {
    for (const old of ["paper", "sheet", "segment", "slate"]) expect(css).not.toMatch(new RegExp(`--hh-${old}:`));
  });

  it("defines the diff tokens in light and dark, and keeps the timeline's chips readable (file-timeline spec §6.1)", () => {
    for (const block of [light, dark]) {
      for (const n of ["diff-ins", "diff-del", "diff-bar-ins", "diff-bar-del"]) expect(token(block, n)).toMatch(/^#/);
      expect(ratio(token(block, "t-green-ink"), token(block, "diff-ins"))).toBeGreaterThanOrEqual(4.5);
      for (const bg of ["review-question", "review-done"]) expect(ratio(token(block, "ink"), token(block, bg))).toBeGreaterThanOrEqual(4.5);
      for (const bg of ["review-question", "review-done", "review-comment", "callout-note", "callout-tip", "callout-warning", "callout-summary", "callout-decision", "callout-question"]) expect(ratio(token(block, "ink"), token(block, bg))).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("styles", () => {
  it("gives the timeline's chips their own classes: the start view's .hh-chip rule is the only one (D0)", () => {
    expect(css.match(/^\.hh-chip[\s,{-]/gm)).toEqual([".hh-chip "]);
    expect(css).toMatch(/^\.hh-chip\s*{\s*height:\s*30px;/m);
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

  it("lets the top bar's selects open (the scope picker, the profile switcher) instead of dragging the window", () => {
    expect(css).toMatch(/\.hh-topbar button,[^{]*\.hh-topbar select[^{]*{[^}]*-webkit-app-region:\s*no-drag/);
  });

  it("keeps the profile switcher's refusal on one line in the top bar", () => {
    expect(css).toMatch(/\.hh-profile-switcher \[role="alert"\]\s*{[^}]*white-space:\s*nowrap[^}]*text-overflow:\s*ellipsis/);
  });

  it("uses the system font for UI text and Lexend for display text, with no network fonts", () => {
    expect(css).toMatch(/--hh-font:\s*-apple-system/);
    expect(css).toMatch(/--hh-display:\s*"Lexend"/);
    expect(css).not.toMatch(/url\(\s*["']?https?:/);
    expect(css).not.toMatch(/@import/);
  });

  it("preserves single line breaks in messages", () => {
    expect(css).toMatch(/\.hh-message p\s*{[^}]*white-space:\s*pre-wrap/);
  });

  it("gives the clipped Start button a focus ring drawn inside it", () => {
    expect(css).toMatch(/\.hh-start:focus-visible\s*\{[^}]*outline-offset:\s*-\d/);
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

describe("annotate marks", () => {
  it("the highlight under a gap keeps ink readable in light and dark", () => {
    for (const block of [light, dark]) expect(ratio(token(block, "ink"), token(block, "highlight"))).toBeGreaterThanOrEqual(7);
  });
});

describe("profile avatars", () => {
  it("every avatar colour has a light and a dark token, and its letter stays readable (≥ 4.5:1)", () => {
    for (const block of [light, dark]) {
      for (const color of AVATAR_COLORS) expect(ratio(token(block, "ink"), token(block, `profile-${color}`))).toBeGreaterThanOrEqual(4.5);
    }
  });
});
