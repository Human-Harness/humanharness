// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GUIDE_CLASSES } from "../src/guide/classes";
import { NavItem } from "../src/guide/NavItem";
import { css, rule } from "./guide-css";

afterEach(cleanup);

const token = (name: string) => rule(":root")[name];
const px = (value: string | undefined) => {
  const m = /^var\((--[\w-]+)\)$/.exec(value ?? "");
  return m ? token(m[1]) : value;
};

describe("NavItem (style guide §3, row 'Nav item')", () => {
  it("is a button that reports a click", () => {
    const onClick = vi.fn();
    render(<NavItem onClick={onClick}>General</NavItem>);
    fireEvent.click(screen.getByRole("button", { name: "General" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("says aria-current page (Settings) or step (Assistant, walkthrough) only when selected", () => {
    render(
      <>
        <NavItem selected current="page" onClick={() => {}}>
          General
        </NavItem>
        <NavItem current="page" onClick={() => {}}>
          Engine
        </NavItem>
        <NavItem selected current="step" onClick={() => {}}>
          Engines
        </NavItem>
      </>,
    );
    expect(screen.getByRole("button", { name: "General" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "Engine" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("button", { name: "Engines" }).getAttribute("aria-current")).toBe("step");
  });

  it("holds an optional lead (step mark) and an optional trail (counter or value)", () => {
    const { container, rerender } = render(<NavItem onClick={() => {}}>Plain</NavItem>);
    expect(container.querySelector(".hh-nav-lead")).toBeNull();
    expect(container.querySelector(".hh-nav-trail")).toBeNull();
    rerender(
      <NavItem onClick={() => {}} lead={<span>1</span>} trail={<span>3</span>}>
        Full
      </NavItem>,
    );
    const button = screen.getByRole("button");
    expect(button.firstElementChild?.className).toBe("hh-nav-lead");
    expect(button.children[1].className).toBe("hh-nav-label");
    expect(button.lastElementChild?.className).toBe("hh-nav-trail");
  });

  it("without a click handler it is a plain block, not a dead button", () => {
    const { container } = render(
      <NavItem selected current="step">
        Folder
      </NavItem>,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.firstElementChild?.getAttribute("aria-current")).toBe("step");
  });

  it("is 40 high with radius 12, and the selected one is the active color", () => {
    const item = rule(".hh-nav-item");
    expect(px(item["min-height"])).toBe("40px");
    expect(px(item["border-radius"])).toBe("12px");
    const chosen = rule('.hh-nav-item[data-selected="true"]');
    expect(chosen.background).toBe("var(--hh-active)");
    expect(chosen.color).toBe("var(--hh-active-ink)");
  });

  it("leaves no rule of the old nav items", () => {
    expect(css).not.toMatch(/\.hh-settings-navitem|\.hh-flow-step|\.hh-flow-label|\.hh-setup-steps li/);
    expect(GUIDE_CLASSES.has("hh-nav-item")).toBe(true);
  });
});
