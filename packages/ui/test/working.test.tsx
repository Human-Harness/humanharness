// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FinishedActivity, WorkingStatus, resetWorkDetail } from "../src/ActivityList";
import { renderIn } from "./render";

const steps = [
  { kind: "read" as const, detail: "manifest.md", done: true },
  { kind: "read" as const, detail: "index.ts", done: true },
  { kind: "read" as const, detail: "harness.config.ts", done: false },
];

/** Makes `prefers-reduced-motion: reduce` match (or not). */
function reducedMotion(on: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: on && query.includes("prefers-reduced-motion: reduce"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

beforeEach(() => {
  resetWorkDetail();
  reducedMotion(false);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("WorkingStatus (a live turn)", () => {
  it("is collapsed by default: one status row, no activity lines", async () => {
    const { container } = await renderIn("en", <WorkingStatus items={steps} />);
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Working…");
    const loader = container.querySelector("img.hh-loader") as HTMLImageElement;
    expect(loader.getAttribute("alt")).toBe("");
    expect(loader.getAttribute("width")).toBe("18");
    const toggle = screen.getByRole("button", { name: "Show details" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Reading manifest.md")).toBeNull();
  });

  it("shows another label when given one (the checkpoint)", async () => {
    await renderIn("en", <WorkingStatus items={steps} label="Saving what matters…" />);
    expect(await screen.findByText("Saving what matters…")).toBeTruthy();
    expect(screen.queryByText("Working…")).toBeNull();
  });

  it("the toggle expands and collapses the activity list, with aria-expanded and aria-controls", async () => {
    await renderIn("en", <WorkingStatus items={steps} />);
    const toggle = screen.getByRole("button", { name: "Show details" });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.textContent).toContain("Hide details");
    const list = document.getElementById(toggle.getAttribute("aria-controls")!) as HTMLElement;
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Reading manifest.md",
      "Reading index.ts",
      "Reading harness.config.ts",
    ]);
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Reading manifest.md")).toBeNull();
  });

  it("marks finished steps with a check and the current step with a small loader", async () => {
    await renderIn("en", <WorkingStatus items={steps} />);
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    const [first, , current] = screen.getAllByRole("listitem");
    expect(first.querySelector("svg")).toBeTruthy();
    expect(first.querySelector(".hh-loader")).toBeNull();
    const small = current.querySelector("img.hh-loader") as HTMLImageElement;
    expect(small.getAttribute("width")).toBe("13");
    expect(small.getAttribute("alt")).toBe("");
  });

  it("keeps the activity lines out of the live region", async () => {
    await renderIn("en", <WorkingStatus items={steps} />);
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    expect(screen.getByRole("status").textContent).not.toContain("Reading");
  });

  it("remembers the choice for the rest of the session", async () => {
    await renderIn("en", <WorkingStatus items={steps} />);
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    cleanup();
    await renderIn("en", <WorkingStatus items={steps} />);
    expect(screen.getByRole("button", { name: "Hide details" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Reading manifest.md")).toBeTruthy();
  });

  it("shows a still ring instead of the animated gif when motion is reduced", async () => {
    reducedMotion(true);
    const { container } = await renderIn("en", <WorkingStatus items={steps} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".hh-loader-static")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("FinishedActivity (a turn that ended)", () => {
  const done = steps.map((s) => ({ ...s, done: true }));

  it("puts what it did behind a collapsed toggle that counts the steps", async () => {
    await renderIn("en", <FinishedActivity items={done} />);
    const toggle = screen.getByRole("button", { name: "See what it did (3 steps)" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Reading manifest.md")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const list = document.getElementById(toggle.getAttribute("aria-controls")!) as HTMLElement;
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(list.querySelector(".hh-loader")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("uses the singular for one step, and shows nothing without steps", async () => {
    await renderIn("en", <FinishedActivity items={done.slice(0, 1)} />);
    expect(screen.getByRole("button", { name: "See what it did (1 step)" })).toBeTruthy();
    cleanup();
    const { container } = await renderIn("en", <FinishedActivity items={[]} />);
    expect(container.textContent).toBe("");
  });
});
