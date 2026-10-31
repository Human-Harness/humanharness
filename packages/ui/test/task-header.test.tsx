// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HarnessApp } from "../src";
import { SidekickToggle } from "../src/chrome";
import { ContextMeter } from "../src/FlowSide";
import { TaskHeader } from "../src/TaskHeader";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

describe("TaskHeader", () => {
  it("shows title, where the task is, then context, usage, Sidekick, plugin chips, History and New task (spec §5.1)", async () => {
    const onHistory = vi.fn(),
      onNew = vi.fn();
    await renderIn(
      "en",
      <TaskHeader title="The turn" subtitle="Topic 3 of 6 · started 12 min ago" meters={<span>meters</span>} sidekick={<button>Sidekick</button>} chips={null} onHistory={onHistory} onNewTask={onNew} />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "The turn" })).toBeTruthy();
    expect(screen.getByText("Topic 3 of 6 · started 12 min ago")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    fireEvent.click(screen.getByRole("button", { name: "New task" }));
    expect(onHistory).toHaveBeenCalled();
    expect(onNew).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "New task" }).className).toContain("hh-cta");
  });

  it("has no New task without onNewTask (plain mode, D0)", async () => {
    await renderIn("en", <TaskHeader title="Demo" onHistory={() => {}} />);
    expect(screen.queryByRole("button", { name: "New task" })).toBeNull();
  });

  it("the context meter as a pill reads 'Context n%' and keeps its name and readout", async () => {
    await renderIn("en", <ContextMeter used={84_000} cap={200_000} onOpen={() => {}} pill />);
    const pill = screen.getByRole("button", { name: "What the AI takes into account" });
    expect(pill.className).toContain("hh-pill");
    expect(pill.textContent).toContain("Context 42%");
    expect(screen.getByRole("meter", { name: "Context in use" }).getAttribute("aria-valuenow")).toBe("42");
  });

  it("the Sidekick toggle is a pill with a state dot", async () => {
    await renderIn("en", <SidekickToggle on label="Sidekick is on. Turn it off" onToggle={() => {}} />);
    const toggle = screen.getByRole("button", { name: "Sidekick is on. Turn it off" });
    expect(toggle.className).toContain("hh-pill");
    expect(toggle.querySelector(".hh-dot")).toBeTruthy();
  });

  it("the work screen's h1 is the task header's title", async () => {
    const client = new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo", engineId: "claude" });
    render(<HarnessApp client={client} locales={{ en: {} }} />);
    const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
    await waitFor(() => expect(start.disabled).toBe(false));
    fireEvent.click(start);
    const h1 = await screen.findByRole("heading", { level: 1 });
    expect(h1.closest("header")?.className).toContain("hh-task-head");
    expect(screen.getByRole("button", { name: "History" }).className).toContain("hh-pill");
  });
});
