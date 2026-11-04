// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HHLogo, Rail, Tag, TopBar } from "../src/chrome";
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

  it("TopBar shows a breadcrumb whose last part is the current page, and trailing controls, but no logo", async () => {
    const onCrumb = vi.fn();
    await renderIn("en", <TopBar crumbs={[{ label: "Demo", onClick: onCrumb }, { label: "The turn" }]} trailing={<button>Inbox</button>} />);
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    fireEvent.click(within(nav).getByRole("button", { name: "Demo" }));
    expect(onCrumb).toHaveBeenCalled();
    expect(within(nav).getByText("The turn").getAttribute("aria-current")).toBe("page");
    // The traffic lights sit at the bar's left edge: no logo beside them.
    expect(document.querySelector("header img, header svg")).toBeNull();
    expect(screen.getByRole("button", { name: "Inbox" })).toBeTruthy();
  });

  it("TopBar shows its centre slot", async () => {
    await renderIn("en", <TopBar crumbs={[{ label: "Demo" }]} center={<button>Search</button>} />);
    expect(screen.getByRole("button", { name: "Search" }).closest(".hh-spacer")).toBeTruthy();
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("TopBar isolates each crumb's text: an RTL name or bidi controls don't reorder the bar", async () => {
    const rlo = "Evil\u202Etxt.exe";
    await renderIn("en", <TopBar crumbs={[{ label: "مرحبا", onClick: () => {} }, { label: rlo }]} />);
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    // dir="auto" isolates each label (unicode-bidi: isolate), as <bdi> would, on the crumb itself.
    const rtl = within(nav).getByText("مرحبا");
    expect(rtl.tagName).toBe("BUTTON");
    expect(rtl.getAttribute("dir")).toBe("auto");
    const controls = within(nav).getByText(rlo);
    expect(controls.getAttribute("aria-current")).toBe("page");
    expect(controls.getAttribute("dir")).toBe("auto");
    // The separators stay outside the isolation: every crumb is its own island.
    for (const sep of nav.querySelectorAll(".hh-crumb-sep")) expect(sep.getAttribute("dir")).toBeNull();
  });

  it("HHLogo is decorative unless it gets a title", () => {
    const { container, rerender } = render(<HHLogo />);
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    rerender(<HHLogo title="Human Harness" />);
    expect(screen.getByRole("img", { name: "Human Harness" })).toBeTruthy();
  });

  it("Rail draws each entry with a set icon at 18, hidden from screen readers", async () => {
    const { container } = await renderIn("en", <Rail entries={["home", "tasks", "inbox", "jobs", "notes", "plugins"]} current="home" onPick={() => {}} />);
    const icons = container.querySelectorAll("svg.hh-icon");
    expect(icons).toHaveLength(6);
    for (const icon of icons) {
      expect(icon.getAttribute("aria-hidden")).toBe("true");
      expect(icon.getAttribute("width")).toBe("18");
    }
    expect([...icons].map((i) => i.getAttribute("class"))).toEqual(["hh-icon hh-icon-home", "hh-icon hh-icon-tasks", "hh-icon hh-icon-inbox", "hh-icon hh-icon-jobs", "hh-icon hh-icon-files", "hh-icon hh-icon-plugins"]);
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
