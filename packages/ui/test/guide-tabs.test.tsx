// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GUIDE_CLASSES } from "../src/guide/classes";
import { Tabs, type TabItem } from "../src/guide/Tabs";
import { css, rule } from "./guide-css";

afterEach(cleanup);

const token = (name: string) => rule(":root")[name];
const px = (value: string | undefined) => {
  const m = /^var\((--[\w-]+)\)$/.exec(value ?? "");
  return m ? token(m[1]) : value;
};

const items: TabItem[] = [
  { id: "a", label: "Alpha" },
  { id: "b", label: "Beta", waiting: true, ariaLabel: "Beta, waiting for you" },
  { id: "c", label: "Gamma", title: "Third" },
];

function Harness({ onChange = () => {} }: { onChange?: (id: string) => void }) {
  const [value, setValue] = useState("a");
  return (
    <Tabs
      label="Open things"
      items={items}
      value={value}
      onChange={(id) => {
        setValue(id);
        onChange(id);
      }}
    />
  );
}

describe("Tabs (style guide §3, row 23)", () => {
  it("is a tablist of tabs that say which one is selected", () => {
    render(<Harness />);
    const list = screen.getByRole("tablist", { name: "Open things" });
    const tabs = within(list).getAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    expect(tabs[2].getAttribute("title")).toBe("Third");
    expect(tabs.every((t) => t.querySelector('.hh-tab-label[dir="auto"]'))).toBe(true);
  });

  it("a click reports the tab", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("tab", { name: "Gamma" }));
    expect(onChange).toHaveBeenCalledWith("c");
    expect(screen.getByRole("tab", { name: "Gamma" }).getAttribute("aria-selected")).toBe("true");
  });

  it("arrow keys, Home and End move between tabs and wrap around", () => {
    render(<Harness />);
    const tabs = screen.getAllByRole("tab");
    fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs[1]);
    fireEvent.keyDown(tabs[1], { key: "ArrowLeft" });
    fireEvent.keyDown(tabs[0], { key: "ArrowLeft" });
    expect(tabs[2].getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs[2]);
    fireEvent.keyDown(tabs[2], { key: "Home" });
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tabs[0], { key: "End" });
    expect(tabs[2].getAttribute("aria-selected")).toBe("true");
  });

  it("a waiting tab shows the orange dot; the others show none", () => {
    const { container } = render(<Harness />);
    const dots = container.querySelectorAll("span.hh-tab-dot");
    expect(dots).toHaveLength(1);
    expect(dots[0].getAttribute("data-tone")).toBe("waiting");
    expect(dots[0].getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByRole("tab", { name: "Beta, waiting for you" }).contains(dots[0])).toBe(true);
  });

  it("with an id it links each tab and the selected one to its panel", () => {
    render(<Tabs id="x" label="L" items={items} value="b" onChange={() => {}} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.id)).toEqual(["x-tab-0", "x-tab-1", "x-tab-2"]);
    expect(tabs.map((t) => t.getAttribute("aria-controls"))).toEqual([null, "x-panel", null]);
  });

  it("is 40 high; the selected tab is underlined in the ink; the dot is orange", () => {
    expect(px(rule(".hh-tab-item").height)).toBe("40px");
    expect(rule('.hh-tab-item[aria-selected="true"]')["border-bottom-color"]).toBe("var(--hh-ink)");
    expect(rule(".hh-tab-dot").background).toBe("var(--hh-t-orange-ink)");
    expect(GUIDE_CLASSES.has("hh-tab-item")).toBe(true);
    expect(GUIDE_CLASSES.has("hh-tab-dot")).toBe(true);
  });

  it("leaves no rule of the old task and plugin tabs", () => {
    expect(css).not.toMatch(/\.hh-tk-tab\b|\.hh-tk-tabs\b|\.hh-tk-dot|\.hh-pl-tab\b|\.hh-pl-tabs\b/);
  });
});

describe("Tabs size (answer T5)", () => {
  it("task tabs are 13, the plugin panel tabs 12, and both stay at most 220 wide", () => {
    expect(rule(".hh-tab-item")["font-size"]).toBe("13px");
    expect(rule(".hh-tab-item")["max-width"]).toBe("220px");
    expect(rule('.hh-tabs[data-small="true"] .hh-tab-item')["font-size"]).toBe("12px");
    expect(rule('.hh-tabs[data-small="true"] .hh-tab-item')["max-width"]).toBeUndefined();
  });
  it("small marks the tab list, and only the plugin panels ask for it", () => {
    render(<Tabs small label="Panels" items={items} value="a" onChange={() => {}} />);
    expect(screen.getByRole("tablist").getAttribute("data-small")).toBe("true");
    cleanup();
    render(<Tabs label="Tasks" items={items} value="a" onChange={() => {}} />);
    expect(screen.getByRole("tablist").getAttribute("data-small")).toBeNull();
    const src = (f: string) => readFileSync(join(import.meta.dirname, "../src", f), "utf8");
    expect(src("plugins/PluginsSection.tsx")).toMatch(/<Tabs[^>]*\bsmall\b/);
    expect(src("parallel/TaskStrip.tsx")).not.toMatch(/<Tabs[^>]*\bsmall\b/);
  });
});
