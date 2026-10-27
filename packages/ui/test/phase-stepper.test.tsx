// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CurrentTaskView, PhaseView } from "../src/client";
import { PhaseStepper } from "../src/PhaseStepper";
import { phaseModesOf, timeLeftMs } from "../src/phases";
import { renderIn } from "./render";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const PHASES: PhaseView[] = [
  { id: "warmup", label: "Warm-up", auto: true, modes: "none" },
  { id: "main", label: "Main block" },
  { id: "close", label: "Close", close: true, modes: "none" },
];
const NOW = "2026-10-26T10:00:00.000Z";
const task = (over: Partial<CurrentTaskView> = {}): CurrentTaskView => ({ id: "t1", action: "session", status: "waiting", phase: "main", ...over });

function stepper(current: CurrentTaskView, disabled = false) {
  const calls: string[] = [];
  const props = {
    phases: PHASES,
    task: current,
    disabled,
    onPhase: (id: string) => calls.push(`phase:${id}`),
    onFinish: () => calls.push("finish"),
    onPause: () => calls.push("pause"),
    onResume: () => calls.push("resume"),
    onExtend: () => calls.push("extend"),
  };
  return { calls, props };
}

describe("phases helpers", () => {
  it("phaseModesOf narrows the action's modes by the phase", () => {
    expect(phaseModesOf(["a", "b"], PHASES[0])).toEqual([]);
    expect(phaseModesOf(["a", "b"], PHASES[1])).toEqual(["a", "b"]);
    expect(phaseModesOf(["a", "b"], { id: "x", label: "X", modes: ["b", "z"] })).toEqual(["b"]);
    expect(phaseModesOf(["a", "b"], undefined)).toEqual(["a", "b"]);
  });

  it("timeLeftMs counts from the view's moment unless paused, never below zero", () => {
    const box = { minutes: 10, totalMs: 600_000, usedMs: 60_000, at: NOW, paused: false };
    expect(timeLeftMs(box, Date.parse(NOW) + 30_000)).toBe(510_000);
    expect(timeLeftMs({ ...box, paused: true }, Date.parse(NOW) + 30_000)).toBe(540_000);
    expect(timeLeftMs(box, Date.parse(NOW) + 10 * 600_000)).toBe(0);
  });
});

describe("PhaseStepper", () => {
  it("shows the parts in order, the current one marked, and moves on a click", async () => {
    const s = stepper(task());
    await renderIn("en", <PhaseStepper {...s.props} />);
    const group = screen.getByRole("navigation", { name: "Task parts" });
    expect(group.textContent).toContain("Warm-up");
    expect(screen.getByRole("button", { name: "Main block" }).getAttribute("aria-current")).toBe("step");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(s.calls).toEqual(["phase:close"]);
  });

  it("shows the agent's proposal as a card the person confirms or dismisses", async () => {
    const s = stepper(task({ phaseProposal: { to: "close", reason: "We covered it all." } }));
    await renderIn("en", <PhaseStepper {...s.props} />);
    expect(screen.getByText("The AI proposes to move to Close: We covered it all.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Go to Close" }));
    expect(s.calls).toEqual(["phase:close"]);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByText(/The AI proposes/)).toBeNull();
  });

  it("in the close part: a proposal to finish, and a Finish button", async () => {
    const s = stepper(task({ phase: "close", phaseProposal: { to: "close", reason: "All summed up." } }));
    await renderIn("en", <PhaseStepper {...s.props} />);
    expect(screen.getByText("The AI says this part is done: All summed up.")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Finish" })[0]);
    expect(s.calls).toEqual(["finish"]);
  });

  it("the time left, counting down; pause, resume, +5 min", async () => {
    vi.useFakeTimers({ now: Date.parse(NOW) });
    const s = stepper(task({ timeBox: { minutes: 10, totalMs: 600_000, usedMs: 0, at: NOW, paused: false } }));
    await renderIn("en", <PhaseStepper {...s.props} />);
    expect(screen.getByText("10 min left")).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(61_000);
    });
    expect(screen.getByText("9 min left")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    fireEvent.click(screen.getByRole("button", { name: "+5 min" }));
    expect(s.calls).toEqual(["pause", "extend"]);
  });

  it("time up without a close part: Time is up and Finish", async () => {
    const s = stepper(task({ timeBox: { minutes: 10, totalMs: 600_000, usedMs: 600_000, at: NOW, paused: false, wrappedUp: true, ended: true } }));
    s.props.phases = PHASES.slice(0, 2);
    await renderIn("en", <PhaseStepper {...s.props} />);
    expect(screen.getByText("Time is up")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(s.calls).toEqual(["finish"]);
  });

  it("disabled while a turn runs", async () => {
    const s = stepper(task(), true);
    await renderIn("en", <PhaseStepper {...s.props} />);
    expect((screen.getByRole("button", { name: "Close" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
