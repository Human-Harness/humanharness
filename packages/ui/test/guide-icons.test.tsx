// @vitest-environment happy-dom
import { render } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ICON_NAMES, Icon } from "../src/guide/icons";

describe("icon set (style guide §4)", () => {
  it("has exactly the closed names", () => {
    expect([...ICON_NAMES].sort()).toEqual([
      "add", "attention", "back", "bell", "callout-decision", "callout-note", "callout-question", "callout-summary", "callout-tip", "callout-warning",
      "check", "chevron", "clock", "close", "coach", "daily-summary", "engine", "files", "focus", "fullscreen", "guardian", "history", "home", "inbox",
      "info", "jobs", "loading", "lock", "mentor", "more", "next", "note", "plugins", "remove", "search", "settings", "tasks", "text", "undo",
    ].sort());
  });
  it.each([14, 18, 32] as const)("draws a 24 box, 1.75 stroke, round caps, currentColor, no fill at %i", (size) => {
    const { container } = render(<Icon name="check" size={size} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.getAttribute("width")).toBe(String(size));
    expect(svg.getAttribute("stroke-width")).toBe("1.75");
    expect(svg.getAttribute("stroke-linecap")).toBe("round");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.getAttribute("fill")).toBe("none");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
  });
  it("the loading icon is static under reduced motion", async () => {
    const { css, rule } = await import("./guide-css");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*{[^}]*\.hh-icon-loading\s*{[^}]*animation:\s*none/);
    expect(rule(".hh-icon-loading").animation).toBeDefined();
  });
  it("the chevron turns 90 degrees when its button is expanded (§4 Desplegar)", async () => {
    const { css } = await import("./guide-css");
    expect(css).toMatch(/\[aria-expanded="true"\]\s*>\s*\.hh-icon-chevron\s*{[^}]*transform:\s*rotate\(90deg\)/);
  });
});

const SRC = join(import.meta.dirname, "../src");
const files = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? files(join(d, f)) : [join(d, f)]));
it("no <svg> outside the icon set, the logos and the sidekick mark; no GIF (style guide §4, rows 13, 14)", () => {
  const allowed = [
    "guide/icons.tsx",
    "chrome.tsx", // HHLogo only
    "MermaidDiagram.tsx", // the diagram's own drawing
    "FlowSide.tsx", // the context meter's ring, a gauge and not an icon
    "markdown.tsx", // until Task 15 (callout icons)
    "sidekick/mark.tsx", // until Task 15 (sidekick marks)
  ];
  for (const f of files(SRC).filter((x) => x.endsWith(".tsx"))) {
    const text = readFileSync(f, "utf8");
    if (allowed.some((a) => f.endsWith(a))) continue;
    expect(text, f).not.toMatch(/<svg[\s>]/);
  }
  expect(files(SRC).filter((f) => f.endsWith(".gif"))).toEqual([]);
  expect(readFileSync(join(SRC, "chrome.tsx"), "utf8").match(/<svg[\s>]/g)?.length).toBe(1); // HHLogo
});

it("no character stands in for an icon in any component (style guide §4, row 12)", () => {
  for (const f of files(SRC).filter((x) => x.endsWith(".tsx"))) {
    const text = readFileSync(f, "utf8");
    expect(text, f).not.toMatch(/>\s*[✓←×✕›↩]\s*</);
    expect(text, f).not.toMatch(/["'][✓←×✕›↩]["']/);
    expect(text, f).not.toMatch(/^\s*[✓←×✕›↩]\s*$/m); // JSX text alone on its line
    expect(text, f).not.toMatch(/^\s*← \{t\(/m);
  }
});
