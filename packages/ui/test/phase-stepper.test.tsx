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

  it("the current part's pill is inert", async () => {
    const s = stepper(task({ phase: "close" }));
    await renderIn("en", <PhaseStepper {...s.props} />);
    const pill = screen.getByRole("button", { name: "Close" });
    expect(pill.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(pill);
    expect(s.calls).toEqual([]);
  });

  it("marks the parts before the current one as done", async () => {
    const s = stepper(task());
    await renderIn("en", <PhaseStepper {...s.props} />);
    expect(screen.getByRole("button", { name: "Warm-up" }).classList.contains("hh-phase-done")).toBe(true);
    expect(screen.getByRole("button", { name: "Main block" }).classList.contains("hh-phase-done")).toBe(false);
    expect(screen.getByRole("button", { name: "Close" }).classList.contains("hh-phase-done")).toBe(false);
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
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
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

  it("a paused box: Paused, and Resume; the clock does not tick", async () => {
    vi.useFakeTimers({ now: Date.parse(NOW) });
    const s = stepper(task({ timeBox: { minutes: 10, totalMs: 600_000, usedMs: 60_000, at: NOW, paused: true } }));
    await renderIn("en", <PhaseStepper {...s.props} />);
    expect(screen.getByText("Paused")).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(s.calls).toEqual(["resume"]);
  });

  it("the clock stops when the time is up and when the stepper goes away", async () => {
    vi.useFakeTimers({ now: Date.parse(NOW) });
    const s = stepper(task({ timeBox: { minutes: 1, totalMs: 60_000, usedMs: 58_000, at: NOW, paused: false } }));
    const first = await renderIn("en", <PhaseStepper {...s.props} />);
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.getByText("Time is up")).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
    first.unmount();
    const other = stepper(task({ timeBox: { minutes: 10, totalMs: 600_000, usedMs: 0, at: NOW, paused: false } }));
    const second = await renderIn("en", <PhaseStepper {...other.props} />);
    expect(vi.getTimerCount()).toBe(1);
    second.unmount();
    expect(vi.getTimerCount()).toBe(0);
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
