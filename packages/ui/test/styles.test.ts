import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

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
  it("uses the spec's light palette", () => {
    expect(["paper", "sheet", "surface", "ink", "slate", "muted", "line-strong", "line", "segment", "ok", "warn"].map((n) => token(light, n))).toEqual([
      "#f4f4f1", "#fbfbfa", "#ffffff", "#191e24", "#3f4852", "#5b636c", "#cfcfcb", "#e1e1dd", "#e7e7e3", "#2e6b4f", "#9a4a12",
    ]);
  });

  it("keeps text readable in light and dark: muted, ok and warn ≥ 4.5:1, ink ≥ 7:1", () => {
    for (const block of [light, dark]) {
      for (const bg of ["paper", "sheet", "surface"]) {
        for (const fg of ["muted", "ok", "warn", "slate"]) expect(ratio(token(block, fg), token(block, bg))).toBeGreaterThanOrEqual(4.5);
        expect(ratio(token(block, "ink"), token(block, bg))).toBeGreaterThanOrEqual(7);
      }
      expect(ratio(token(block, "on-ink"), token(block, "ink"))).toBeGreaterThanOrEqual(7);
    }
  });
});

describe("styles", () => {
  it("makes the top bar the window's drag region, except its controls", () => {
    expect(css).toMatch(/\.hh-topbar\s*{[^}]*-webkit-app-region:\s*drag/);
    expect(css).toMatch(/\.hh-topbar button,[^{]*{[^}]*-webkit-app-region:\s*no-drag/);
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
});
