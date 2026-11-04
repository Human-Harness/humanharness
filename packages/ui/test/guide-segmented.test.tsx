// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GUIDE_CLASSES } from "../src/guide/classes";
import { Segmented, segmentedFits } from "../src/guide/Segmented";
import { css, rule } from "./guide-css";

afterEach(cleanup);

const token = (name: string) => rule(":root")[name];
const px = (value: string | undefined) => {
  const m = /^var\((--[\w-]+)\)$/.exec(value ?? "");
  return m ? token(m[1]) : value;
};

describe("Segmented (style guide §3, rows 22 and 77)", () => {
  it("is a group of buttons that say which one is chosen and report the click", () => {
    const onChange = vi.fn();
    render(<Segmented label="Appearance" value="system" onChange={onChange} options={[{ value: "system", label: "Automatic" }, { value: "dark", label: "Dark" }]} />);
    const group = screen.getByRole("group", { name: "Appearance" });
    expect(group.classList.contains("hh-segmented")).toBe(true);
    expect(within(group).getByRole("button", { name: "Automatic" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(group).getByRole("button", { name: "Dark" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(within(group).getByRole("button", { name: "Dark" }));
    expect(onChange).toHaveBeenCalledWith("dark");
  });

  it("points at the text that describes it", () => {
    render(<Segmented label="Size" describedBy="hint" value="a" onChange={() => {}} options={[{ value: "a", label: "A" }, { value: "b", label: "B" }]} />);
    expect(screen.getByRole("group", { name: "Size" }).getAttribute("aria-describedby")).toBe("hint");
  });

  it("with several chosen values each segment toggles by itself", () => {
    const onChange = vi.fn();
    const days = ["0", "1", "2", "3", "4", "5", "6"].map((d) => ({ value: d, label: `D${d}`, ariaLabel: `Day ${d}` }));
    render(<Segmented label="Days" value={["1", "2"]} onChange={onChange} options={days} />);
    const buttons = within(screen.getByRole("group", { name: "Days" })).getAllByRole("button");
    expect(buttons).toHaveLength(7);
    expect(buttons.filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.getAttribute("aria-label"))).toEqual(["Day 1", "Day 2"]);
    fireEvent.click(buttons[6]);
    expect(onChange).toHaveBeenCalledWith("6");
  });

  it("holds 2 to 4 options, and seven only when several can be chosen (the weekdays)", () => {
    expect([1, 2, 3, 4, 5, 7].map((n) => segmentedFits(n))).toEqual([false, true, true, true, false, false]);
    expect([1, 2, 4, 5, 6, 7, 8].map((n) => segmentedFits(n, true))).toEqual([false, true, true, false, false, true, false]);
  });

  it("is 30 high with radius 8, grey, and the chosen segment is the active color", () => {
    const seg = rule(".hh-segmented");
    expect(px(seg.height)).toBe("30px");
    expect(px(seg["border-radius"])).toBe("8px");
    expect(seg.background).toBe("var(--hh-surface-2)");
    const chosen = rule('.hh-segmented button[aria-pressed="true"]');
    expect(chosen.background).toBe("var(--hh-active)");
    expect(chosen.color).toBe("var(--hh-active-ink)");
    expect(px(rule(".hh-segmented button")["border-radius"])).toBe("8px");
  });

  it("leaves no rule of the text-size tiles or the weekday chips", () => {
    expect(css).not.toMatch(/\.hh-text-sizes|\.hh-text-size-sample|\.hh-pl-days/);
    expect(GUIDE_CLASSES.has("hh-segmented")).toBe(true);
  });
});
