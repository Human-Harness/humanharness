import { afterEach, describe, expect, it, vi } from "vitest";
import type { HarnessPhase, HarnessTimeBox, SavedNote } from "@humanharness/harness-sdk";
import type { Event } from "@humanharness/runtime";
import { MAIN_SCOPE } from "@humanharness/workspace";
import { EXPECTS_CHECK_MS, type TaskDeps } from "../src/main/task-manager";
import { CLOSE_PROMPT } from "../src/main/task-prompts";
import { ok, setup } from "./task-manager-fixture";

type Ended = Parameters<NonNullable<TaskDeps["phaseEnded"]>>[0];

/** A phased action whose parts both expect a tool: main (the agent may move on by itself), then close. */
const PHASES: HarnessPhase[] = [
  { id: "main", label: "Main block", brief: "phases/main.md", auto: true, expects: ["apply-evidence"] },
  { id: "close", label: "Close", brief: "phases/close.md", close: true, expects: ["save-evidence"] },
];
const NOTE: SavedNote = { title: "Fractions", summary: ["Two halves make a whole."], decisions: [], files: [], open: [] };
const saveNote: Event = { type: "block", name: "save_note", data: NOTE };
const ask = (to: string): Event => ({ type: "block", name: "set_phase", data: { to, reason: "Done here" } });
const cancelled: Event = { type: "done", ok: false, error: { code: "cancelled" } };
const left = (phase: string): Ended => ({ task: "t1", action: "session", scope: MAIN_SCOPE, phase });

/** A recording `phaseEnded`. */
function recorder() {
  const calls: Ended[] = [];
  const phaseEnded = async (o: Ended) => {
    calls.push(o);
  };
  return { calls, phaseEnded };
}

afterEach(() => vi.restoreAllMocks());

describe("phaseEnded (tools spec §6.1)", () => {
  it("moving from a part calls phaseEnded with the task, its action, scope and the part it left", async () => {
    const r = recorder();
    const t = setup({ phases: PHASES, extra: { phaseEnded: r.phaseEnded } });
    await t.manager.start("session");
    expect(r.calls).toEqual([]);
    await t.manager.setPhase("close", "t1").done;
    expect(r.calls).toEqual([left("main")]);
    // Going back leaves the close part.
    await t.manager.setPhase("main", "t1").done;
    expect(r.calls).toEqual([left("main"), left("close")]);
  });

  it("the person picking the part the task is in moves nothing and calls nothing", async () => {
    const r = recorder();
    const t = setup({ phases: PHASES, extra: { phaseEnded: r.phaseEnded } });
    await t.manager.start("session");
    expect(await t.manager.setPhase("main", "t1").accepted).toEqual({ ok: true, changed: "same" });
    expect(r.calls).toEqual([]);
  });

  it("the closing turn calls it for the part the task closes in, after the turn", async () => {
    const seen: { turns: number; last?: string; current: unknown }[] = [];
    const calls: Ended[] = [];
    const t = setup({
      phases: PHASES,
      script: [[ok], [ok], [saveNote, ok]],
      extra: {
        phaseEnded: async (o) => {
          calls.push(o);
          seen.push({ turns: t.turns.length, last: t.turns.at(-1)?.options.phase, current: t.state().current });
        },
      },
    });
    await t.manager.start("session");
    await t.manager.setPhase("close", "t1").done;
    expect(await t.manager.finish()).toBe(true);
    expect(t.turns.at(-1)!.message).toBe(CLOSE_PROMPT);
    expect(calls).toEqual([left("main"), left("close")]);
    // The closing turn ran before the hook; the task ends after it.
    expect(seen[1]).toMatchObject({ turns: 3, last: "close", current: { id: "t1" } });
    expect(t.state().current).toBeNull();
  });

  it("a Finish outside the close part checks the part the task is in", async () => {
    const r = recorder();
    const t = setup({ phases: PHASES, script: [[ok], [saveNote, ok]], extra: { phaseEnded: r.phaseEnded } });
    await t.manager.start("session");
    await t.manager.finish();
    expect(r.calls).toEqual([left("main")]);
  });

  it("a task whose note is already saved ends done with no closing turn, and its part ends too", async () => {
    const r = recorder();
    const t = setup({ phases: PHASES, script: [[saveNote, ok]], extra: { phaseEnded: r.phaseEnded } });
    await t.manager.start("session");
    expect(t.state().current).toMatchObject({ noteSaved: true });
    await t.manager.finish();
    expect(t.turns).toHaveLength(1);
    expect(t.state().actions).toEqual({ session: "done" });
    expect(r.calls).toEqual([left("main")]);
  });

  it("on close it runs while the task is still current, so its line can reach the chat (both close paths)", async () => {
    for (const script of [[[ok], [saveNote, ok]], [[saveNote, ok]]]) {
      const current: unknown[] = [];
      const t = setup({
        phases: PHASES,
        script,
        extra: {
          phaseEnded: async () => {
            current.push(t.state().current?.id);
          },
        },
      });
      await t.manager.start("session");
      await t.manager.finish();
      expect(current).toEqual(["t1"]);
      expect(t.state().current).toBeNull();
    }
  });

  it("a phaseEnded that never answers holds the close no longer than its bound", async () => {
    vi.useFakeTimers();
    try {
      let asked = 0;
      const t = setup({
        phases: PHASES,
        script: [[ok], [saveNote, ok]],
        extra: {
          phaseEnded: () => {
            asked++;
            return new Promise<void>(() => {});
          },
        },
      });
      await t.manager.start("session");
      let closed = false;
      const finishing = t.manager.finish().then((v) => {
        closed = true;
        return v;
      });
      // Settles the close up to the check without moving the clock (vi.waitFor would advance it).
      for (let i = 0; i < 200 && asked === 0; i++) await vi.advanceTimersByTimeAsync(0);
      expect(asked).toBe(1);
      await vi.advanceTimersByTimeAsync(EXPECTS_CHECK_MS - 1);
      expect(closed).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await finishing).toBe(true);
      expect(t.state().actions).toEqual({ session: "done" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("a task closed unfinished (its session gone) counts nothing", async () => {
    const r = recorder();
    const current = { id: "t1", action: "session", status: "waiting" as const, startedAt: "", turns: 2, resume: true as const, phase: { id: "main", startedAt: "" } };
    const t = setup({ phases: PHASES, state: { version: 1, actions: {}, current }, extra: { phaseEnded: r.phaseEnded } });
    await t.manager.finish();
    expect(t.state().actions).toEqual({ session: "unfinished" });
    expect(r.calls).toEqual([]);
  });

  it("a closing turn that ends badly (not cancelled) still ends the part", async () => {
    const r = recorder();
    const failed: Event = { type: "done", ok: false, error: { code: "agent-crashed", detail: "boom" } };
    const t = setup({ phases: PHASES, script: [[ok], [failed]], extra: { phaseEnded: r.phaseEnded } });
    await t.manager.start("session");
    await t.manager.finish();
    expect(t.state().actions).toEqual({ session: "unsaved" });
    expect(r.calls).toEqual([left("main")]);
  });

  it("a cancelled closing turn calls nothing", async () => {
    const r = recorder();
    const t = setup({ phases: PHASES, script: [[ok], [cancelled]], extra: { phaseEnded: r.phaseEnded } });
    await t.manager.start("session");
    await t.manager.finish();
    expect(t.state().actions).toEqual({ session: "unfinished" });
    expect(r.calls).toEqual([]);
  });

  it("a task cancelled midway through its closing calls nothing", async () => {
    const first = setup({ phases: PHASES });
    await first.manager.start("session");
    let open!: () => void;
    const r = recorder();
    // A second manager over the same state: its first turn (held by the gate) is the closing one.
    const t = setup({ phases: PHASES, state: first.state(), script: [[saveNote, ok]], gate: new Promise<void>((resolve) => (open = resolve)), extra: { phaseEnded: r.phaseEnded } });
    const finishing = t.manager.finish();
    await vi.waitFor(() => expect(t.turns).toHaveLength(1));
    t.manager.cancel();
    open();
    await finishing;
    expect(t.turns[0].options).toMatchObject({ phase: "close" });
    expect(r.calls).toEqual([]);
  });

  it("on a move the next part's turn waits for the check, so a miss line comes before the phase brief", async () => {
    let answer!: () => void;
    const asked: number[] = [];
    const t = setup({
      phases: PHASES,
      extra: {
        phaseEnded: () => {
          asked.push(t.turns.length);
          return new Promise<void>((res) => (answer = res));
        },
      },
    });
    await t.manager.start("session");
    const moving = t.manager.setPhase("close", "t1").done;
    await vi.waitFor(() => expect(asked).toEqual([1]));
    await new Promise((res) => setTimeout(res, 30));
    // The check hasn't answered: no phase brief turn yet.
    expect(t.turns).toHaveLength(1);
    answer();
    await moving;
    expect(t.turns).toHaveLength(2);
    expect(t.turns[1]!.options).toMatchObject({ phase: "phase-change", phaseChange: "close" });
  });

  it("a phaseEnded that never answers holds a move no longer than its bound", async () => {
    vi.useFakeTimers();
    try {
      let asked = 0;
      const t = setup({
        phases: PHASES,
        extra: {
          phaseEnded: () => {
            asked++;
            return new Promise<void>(() => {});
          },
        },
      });
      await t.manager.start("session");
      const moving = t.manager.setPhase("close", "t1").done;
      for (let i = 0; i < 200 && asked === 0; i++) await vi.advanceTimersByTimeAsync(0);
      expect(asked).toBe(1);
      await vi.advanceTimersByTimeAsync(EXPECTS_CHECK_MS - 1);
      expect(t.turns).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      await moving;
      expect(t.turns).toHaveLength(2);
      expect(t.state().current).toMatchObject({ phase: { id: "close" } });
    } finally {
      vi.useRealTimers();
    }
  });

  it("an agent's auto move calls it too", async () => {
    const r = recorder();
    const t = setup({ phases: PHASES, script: [[ask("close"), ok], [ok]], extra: { phaseEnded: r.phaseEnded } });
    await t.manager.start("session");
    expect(t.state().current).toMatchObject({ phase: { id: "close" }, phases: [{ id: "main", by: "app" }, { id: "close", by: "agent" }] });
    expect(r.calls).toEqual([left("main")]);
  });

  it("the time box's move calls it too", async () => {
    const box: HarnessTimeBox = { options: [10], default: null, wrapUpAt: 0.5 };
    const r = recorder();
    const t = setup({ phases: PHASES, timeBox: box, extra: { phaseEnded: r.phaseEnded } });
    await t.manager.start("session", undefined, undefined, undefined, { timeBox: 10 });
    t.fire();
    await vi.waitFor(() => expect(t.turns).toHaveLength(3));
    await t.manager.idle();
    expect(t.state().current).toMatchObject({ phase: { id: "close" }, phases: [{ id: "main" }, { id: "close", by: "app" }] });
    expect(r.calls).toEqual([left("main")]);
  });

  it("a phaseEnded that throws is logged; the move goes on", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = setup({
      phases: PHASES,
      extra: {
        phaseEnded: () => {
          throw new Error("boom");
        },
      },
    });
    await t.manager.start("session");
    await t.manager.setPhase("close", "t1").done;
    expect(t.state().current).toMatchObject({ status: "waiting", phase: { id: "close" } });
    expect(t.turns.at(-1)!.options).toMatchObject({ phase: "phase-change", phaseChange: "close" });
    expect(errors).toHaveBeenCalledWith("The expects check failed", expect.any(Error));
  });

  it("a phaseEnded that rejects is logged; the close goes on", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = setup({ phases: PHASES, script: [[ok], [saveNote, ok]], extra: { phaseEnded: () => Promise.reject(new Error("boom")) } });
    await t.manager.start("session");
    expect(await t.manager.finish()).toBe(true);
    expect(t.state().actions).toEqual({ session: "done" });
    await vi.waitFor(() => expect(errors).toHaveBeenCalledWith("The expects check failed", expect.any(Error)));
  });

  it("a task without phases calls nothing", async () => {
    const r = recorder();
    const t = setup({ script: [[ok], [saveNote, ok]], extra: { phaseEnded: r.phaseEnded } });
    await t.manager.start("quiz");
    await t.manager.finish();
    expect(t.state().actions).toEqual({ quiz: "done" });
    expect(r.calls).toEqual([]);
  });

  it("D0: without phaseEnded nothing changes (the move's calls and writes are as before)", async () => {
    const run = async (extra: Partial<TaskDeps>) => {
      const t = setup({ phases: PHASES, script: [[ask("close"), ok], [ok], [saveNote, ok]], extra });
      await t.manager.start("session");
      await t.manager.setPhase("main", "t1").done;
      await t.manager.finish();
      return {
        turns: t.turns.map(({ message, options: { onEvent: _e, ...options } }) => ({ message, options })),
        state: t.state(),
        views: t.views,
        notices: t.notices,
        written: t.written,
        emitted: t.emitted,
      };
    };
    const r = recorder();
    const plain = await run({});
    const hooked = await run({ phaseEnded: r.phaseEnded });
    expect(r.calls).toEqual([left("main"), left("close"), left("main")]);
    expect(hooked).toEqual(plain);
  });
});

describe("phaseEnded absent (D0 timing)", () => {
  it("D0: without phaseEnded a close arms no bound timer (both close paths)", async () => {
    for (const script of [[[ok], [saveNote, ok]], [[saveNote, ok]]]) {
      const spy = vi.spyOn(globalThis, "setTimeout");
      try {
        const t = setup({ phases: PHASES, script });
        await t.manager.start("session");
        await t.manager.finish();
        expect(t.state().current).toBeNull();
        expect(spy.mock.calls.filter((c) => c[1] === EXPECTS_CHECK_MS)).toEqual([]);
      } finally {
        spy.mockRestore();
      }
    }
  });
});
