// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CheckIcon, EngineIcon, GearIcon, HHLogo, LockIcon, NoteIcon, Rail, Segmented, Tag, TopBar } from "../src/chrome";
import { renderIn } from "./render";

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

  it("TopBar shows the logo, a breadcrumb whose last part is the current page, and trailing controls", async () => {
    const onCrumb = vi.fn();
    await renderIn("en", <TopBar crumbs={[{ label: "Demo", onClick: onCrumb }, { label: "The turn" }]} trailing={<button>Inbox</button>} />);
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    fireEvent.click(within(nav).getByRole("button", { name: "Demo" }));
    expect(onCrumb).toHaveBeenCalled();
    expect(within(nav).getByText("The turn").getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("img", { name: "Human Harness" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Inbox" })).toBeTruthy();
  });

  it("TopBar shows the harness logo instead of the HH tile, and its centre slot", async () => {
    await renderIn("en", <TopBar logo="data:image/png;base64,AAA" crumbs={[{ label: "Demo" }]} center={<button>Search</button>} />);
    expect(screen.getByRole("img", { name: "Human Harness" }).getAttribute("src")).toBe("data:image/png;base64,AAA");
    expect(screen.getByRole("button", { name: "Search" }).closest(".hh-spacer")).toBeTruthy();
    expect(screen.queryByRole("heading")).toBeNull();
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

  it("draws decorative icons hidden from screen readers", () => {
    const { container } = render(
      <>
        <CheckIcon />
        <LockIcon />
        <NoteIcon />
        <GearIcon />
        <EngineIcon />
      </>,
    );
    const icons = container.querySelectorAll("svg");
    expect(icons).toHaveLength(5);
    for (const icon of icons) expect(icon.getAttribute("aria-hidden")).toBe("true");
  });

  it("draws the gear and the engine icon as 24-unit line icons", () => {
    const { container } = render(
      <>
        <GearIcon />
        <EngineIcon size={40} />
      </>,
    );
    const [gear, engine] = container.querySelectorAll("svg");
    for (const icon of [gear, engine]) {
      expect(icon.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(icon.getAttribute("fill")).toBe("none");
      expect(icon.getAttribute("stroke")).toBe("currentColor");
    }
    expect(gear.getAttribute("width")).toBe("18");
    expect(engine.getAttribute("width")).toBe("40");
  });

  it("Tag colours a state by its meaning", () => {
    render(<Tag tone="orange">Waiting for you</Tag>);
    expect(screen.getByText("Waiting for you").className).toBe("hh-tag hh-tag-orange");
  });

  it("Rail labels each entry, marks the current one and reports picks", async () => {
    const onPick = vi.fn();
    await renderIn("en", <Rail entries={["home", "tasks", "inbox", "settings"]} current="tasks" onPick={onPick} />);
    const nav = screen.getByRole("navigation", { name: "App" });
    expect(within(nav).getByRole("button", { name: "Tasks" }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("button", { name: "Home" }).getAttribute("aria-current")).toBeNull();
    fireEvent.click(within(nav).getByRole("button", { name: "Inbox" }));
    expect(onPick).toHaveBeenCalledWith("inbox");
  });
});
