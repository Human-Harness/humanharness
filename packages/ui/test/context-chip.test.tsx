// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EngineOption, LimitWindow } from "../src/client";
import { ContextChip } from "../src/task-view/ContextChip";
import { renderIn } from "./render";

afterEach(cleanup);

const claude = { id: "claude", name: "Claude", reportsLimits: true } as EngineOption;
const later = new Date(Date.now() + 3_600_000).toISOString();
const limits: LimitWindow[] = [
  { kind: "five_hour", utilization: 0.3, resetsAt: later },
  { kind: "seven_day", utilization: 0.12, resetsAt: later },
];

describe("the context chip (task view one column, T4)", () => {
  it("opens a popover with the context, the plan's usage and Open context; Escape closes it", async () => {
    const onOpen = vi.fn();
    await renderIn("en", <ContextChip used={88_000} cap={200_000} engine={claude} limits={limits} lastTokens={null} onOpen={onOpen} />, { theme: true });
    fireEvent.click(screen.getByRole("button", { name: "Context 44%" }));
    const pop = await screen.findByRole("dialog");
    expect(within(pop).getByRole("progressbar")).toBeTruthy();
    expect(pop.textContent).toContain("In use now: 88,000 of 200,000 tokens");
    expect(pop.textContent).toContain("Plan usage");
    expect(pop.textContent).toContain("5 h: 30% used");
    expect(pop.textContent).toContain("week: 12% used");
    fireEvent.keyDown(pop, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Context 44%" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Open context" }));
    expect(onOpen).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("says the plan's usage shows up after the first message when none is known yet", async () => {
    await renderIn("en", <ContextChip used={0} cap={200_000} engine={claude} limits={null} lastTokens={null} onOpen={() => {}} />, { theme: true });
    fireEvent.click(screen.getByRole("button", { name: "Context 0%" }));
    expect((await screen.findByRole("dialog")).textContent).toContain("shows up after the first message");
  });
});
