// @vitest-environment happy-dom
import { render } from "@testing-library/react";
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
});
