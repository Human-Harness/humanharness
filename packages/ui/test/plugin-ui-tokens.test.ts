import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "../src");
const TOKEN = /--hh-[a-z0-9-]+:\s*[^;]+;/g;

function tokens(css: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of css.match(TOKEN) ?? []) {
    const i = m.indexOf(":");
    out.set(m.slice(0, i), m.slice(i + 1, -1).trim());
  }
  return out;
}
/** The text of the first `{…}` block after `marker` (one level of nesting). */
function block(css: string, marker: string): string {
  const at = css.indexOf(`${marker} {`);
  expect(at, marker).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`unclosed ${marker}`);
}

const app = readFileSync(join(SRC, "styles.css"), "utf8");
const panel = readFileSync(join(SRC, "plugin-ui/tokens.css"), "utf8");
const appLight = tokens(block(app, ":root"));
const appDark = tokens(block(app, "@media (prefers-color-scheme: dark)"));

describe("plugin-ui tokens (Decision 4)", () => {
  it("the app's own blocks hold tokens to compare with", () => {
    expect(appLight.size).toBeGreaterThan(20);
    expect(appDark.size).toBeGreaterThan(20);
  });

  it.each([
    [":root", appLight],
    ["@media (prefers-color-scheme: dark)", appDark],
    ['[data-theme="light"]', appLight],
    ['[data-theme="dark"]', appDark],
  ])("every token under %s has the app's value", (marker, expected) => {
    const got = tokens(block(panel, marker));
    expect(got.size).toBeGreaterThan(20);
    for (const [name, value] of got) expect([name, value]).toEqual([name, expected.get(name)]);
  });

  it("carries every colour the app has, light and dark", () => {
    const colours = (m: Map<string, string>) => [...m.keys()].filter((k) => k !== "--hh-font" && k !== "--hh-display");
    expect(colours(tokens(block(panel, ":root")))).toEqual(colours(appLight));
    expect(colours(tokens(block(panel, '[data-theme="light"]')))).toEqual(colours(appLight));
    expect([...tokens(block(panel, "@media (prefers-color-scheme: dark)")).keys()]).toEqual([...appDark.keys()]);
    expect([...tokens(block(panel, '[data-theme="dark"]')).keys()]).toEqual([...appDark.keys()]);
  });

  it("the app's theme is set on :root only, so html/body follow it and nothing else can set it", () => {
    expect(panel).toMatch(/^:root\[data-theme="light"\] \{/m);
    expect(panel).toMatch(/^:root\[data-theme="dark"\] \{/m);
    expect(panel).not.toMatch(/(^|[^t])\[data-theme/m);
  });

  it("every token plugin-ui.css uses is defined", () => {
    const css = readFileSync(join(SRC, "plugin-ui/plugin-ui.css"), "utf8");
    const used = new Set([...css.matchAll(/var\((--hh-[a-z0-9-]+)\)/g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThan(0);
    for (const name of used) expect(appLight.has(name), name).toBe(true);
  });

  it("plugin-ui imports nothing else from @humanharness/ui", () => {
    const dir = join(SRC, "plugin-ui");
    for (const f of readdirSync(dir)) {
      const text = readFileSync(join(dir, f), "utf8");
      expect(text, f).not.toMatch(/from\s+["']\.\.\//);
      expect(text, f).not.toMatch(/import\s+["']\.\.\//);
      expect(text, f).not.toMatch(/@import\s+["']\.\.\//);
      expect(text, f).not.toMatch(/["']@humanharness\/(?!ui\/plugin-ui)/);
    }
  });

  it("plugin-ui never writes a <style> element or a style attribute (the panel CSP blocks both)", () => {
    const dir = join(SRC, "plugin-ui");
    for (const f of readdirSync(dir).filter((x) => /\.tsx?$/.test(x))) {
      const text = readFileSync(join(dir, f), "utf8");
      expect(text, f).not.toMatch(/createElement\(\s*["']style["']/);
      expect(text, f).not.toMatch(/setAttribute\(\s*["']style["']/);
      expect(text, f).not.toMatch(/<style/);
      expect(text, f).not.toMatch(/innerHTML|dangerouslySetInnerHTML|cssText/);
    }
  });
});
