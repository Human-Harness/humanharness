// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HHLogo, Segmented, TopBar } from "../src/chrome";

afterEach(cleanup);

describe("chrome", () => {
  it("TopBar shows a title and its controls", () => {
    render(
      <TopBar title="Demo">
        <button>Settings</button>
      </TopBar>,
    );
    expect(screen.getByRole("heading", { name: "Demo" }).closest("header")?.className).toBe("hh-topbar");
    expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
  });

  it("Segmented marks the chosen option and reports changes", () => {
    const onChange = vi.fn();
    render(<Segmented label="Appearance" value="system" onChange={onChange} options={[{ value: "system", label: "Automatic" }, { value: "dark", label: "Dark" }]} />);
    expect(screen.getByRole("group", { name: "Appearance" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Automatic" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(onChange).toHaveBeenCalledWith("dark");
  });

  it("HHLogo is decorative unless it gets a title", () => {
    const { container, rerender } = render(<HHLogo />);
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    rerender(<HHLogo title="Human Harness" />);
    expect(screen.getByRole("img", { name: "Human Harness" })).toBeTruthy();
  });
});
