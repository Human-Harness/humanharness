import { describe, expect, it, vi } from "vitest";
import { Dropped, TurnGate } from "../src/main/turn-gate";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("TurnGate (parallel spec §7)", () => {
  it("runs up to the cap; the rest wait FIFO and start as slots free", async () => {
    const gate = new TurnGate({ tasks: 2, jobs: 1 });
    const order: string[] = [];
    const run = async (id: string) => {
      const release = await gate.acquire("tasks", { id, text: id });
      order.push(id);
      return release;
    };
    const ra = await run("a");
    const rb = await run("b");
    const pc = run("c");
    const pd = run("d");
    await flush();
    expect(gate.queued("tasks").map((q) => q.id)).toEqual(["c", "d"]);
    ra();
    const rc = await pc;
    expect(order).toEqual(["a", "b", "c"]);
    rb();
    rc();
    (await pd)();
    expect(gate.running("tasks")).toBe(0);
  });

  it("the two caps are counted apart", async () => {
    const gate = new TurnGate({ tasks: 1, jobs: 1 });
    await gate.acquire("tasks", { id: "t" });
    await expect(Promise.race([gate.acquire("jobs", { id: "j" }).then(() => "ran"), flush().then(() => "waited")])).resolves.toBe("ran");
  });

  it("drop() takes a queued turn out and rejects it with Dropped; returns its text (Decision 7)", async () => {
    const gate = new TurnGate({ tasks: 1, jobs: 1 });
    await gate.acquire("tasks", { id: "a" });
    const p = gate.acquire("tasks", { id: "b", text: "hello" });
    await flush();
    expect(gate.drop("b")).toBe("hello");
    await expect(p).rejects.toBeInstanceOf(Dropped);
    expect(gate.isQueued("b")).toBe(false);
    expect(gate.queued("tasks")).toEqual([]);
    expect(gate.drop("nobody")).toBeNull();
  });

  it("pause holds both queues until resume; resetsAt resumes on its own", async () => {
    vi.useFakeTimers();
    try {
      const gate = new TurnGate({ tasks: 2, jobs: 1 }, { now: () => Date.parse("2026-10-28T10:00:00Z") });
      gate.pause({ reason: "out-of-quota", resetsAt: "2026-10-28T10:05:00Z" });
      let started = false;
      void gate.acquire("tasks", { id: "a" }).then(() => (started = true));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(started).toBe(false);
      expect(gate.paused()).toMatchObject({ reason: "out-of-quota", resetsAt: "2026-10-28T10:05:00Z" });
      await vi.advanceTimersByTimeAsync(4 * 60_000 + 1);
      expect(started).toBe(true);
      expect(gate.paused()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("pause without a reset waits for resume(); a later pause replaces the earlier timer", async () => {
    vi.useFakeTimers();
    try {
      const gate = new TurnGate({ tasks: 1, jobs: 1 }, { now: () => 0 });
      gate.pause({ reason: "out-of-quota", resetsAt: new Date(1_000).toISOString() });
      gate.pause({ reason: "folder-move" });
      let started = false;
      void gate.acquire("jobs", { id: "j" }).then(() => (started = true));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(started).toBe(false);
      gate.resume();
      await vi.advanceTimersByTimeAsync(0);
      expect(started).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("hold() keeps new turns back at most 10 s, or until unhold (spec §10)", async () => {
    vi.useFakeTimers();
    try {
      const gate = new TurnGate({ tasks: 2, jobs: 1 });
      const unhold = gate.hold(10_000);
      let started = false;
      void gate.acquire("tasks", { id: "a" }).then(() => (started = true));
      await vi.advanceTimersByTimeAsync(9_000);
      expect(started).toBe(false);
      await vi.advanceTimersByTimeAsync(1_001);
      expect(started).toBe(true);
      unhold();
    } finally {
      vi.useRealTimers();
    }
  });

  it("an early unhold starts the queue; a second call does nothing", async () => {
    vi.useFakeTimers();
    try {
      const gate = new TurnGate({ tasks: 2, jobs: 1 });
      const u1 = gate.hold(10_000);
      const u2 = gate.hold(10_000);
      let started = false;
      void gate.acquire("tasks", { id: "a" }).then(() => (started = true));
      u1();
      u1();
      await vi.advanceTimersByTimeAsync(0);
      expect(started).toBe(false);
      u2();
      await vi.advanceTimersByTimeAsync(0);
      expect(started).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("setCaps raises the cap and starts waiting turns; onChange fires on every change", async () => {
    const gate = new TurnGate({ tasks: 1, jobs: 1 });
    const changes = vi.fn();
    gate.onChange(changes);
    await gate.acquire("tasks", { id: "a" });
    const pb = gate.acquire("tasks", { id: "b" });
    gate.setCaps({ tasks: 2, jobs: 1 });
    await pb;
    expect(changes).toHaveBeenCalled();
    expect(gate.running("tasks")).toBe(2);
  });

  it("setCaps lowering a cap never stops a running turn; new turns wait until the count is under it", async () => {
    const gate = new TurnGate({ tasks: 3, jobs: 1 });
    const ra = await gate.acquire("tasks", { id: "a" });
    const rb = await gate.acquire("tasks", { id: "b" });
    gate.setCaps({ tasks: 1, jobs: 1 });
    expect(gate.running("tasks")).toBe(2);
    let started = false;
    const pc = gate.acquire("tasks", { id: "c" }).then((r) => ((started = true), r));
    ra();
    await flush();
    expect(started).toBe(false);
    rb();
    (await pc)();
    expect(started).toBe(true);
    expect(gate.running("tasks")).toBe(0);
  });

  it("a release called twice frees one slot only (a turn that throws then releases again)", async () => {
    const gate = new TurnGate({ tasks: 1, jobs: 1 });
    const ra = await gate.acquire("tasks", { id: "a" });
    const rb = await gate.acquire("jobs", { id: "j" });
    const pc = gate.acquire("tasks", { id: "c" });
    const pd = gate.acquire("tasks", { id: "d" });
    ra();
    ra();
    await pc;
    expect(gate.running("tasks")).toBe(1);
    expect(gate.isQueued("d")).toBe(true);
    expect(gate.running("jobs")).toBe(1);
    rb();
    gate.dropAll();
    await expect(pd).rejects.toBeInstanceOf(Dropped);
  });

  it("dropAll rejects every queued turn (engine switch, quit; spec §10)", async () => {
    const gate = new TurnGate({ tasks: 1, jobs: 1 });
    await gate.acquire("tasks", { id: "a" });
    await gate.acquire("jobs", { id: "j" });
    const p = gate.acquire("tasks", { id: "b" });
    const q = gate.acquire("jobs", { id: "k" });
    gate.dropAll();
    await expect(p).rejects.toBeInstanceOf(Dropped);
    await expect(q).rejects.toBeInstanceOf(Dropped);
    expect(gate.queued("tasks")).toEqual([]);
    expect(gate.queued("jobs")).toEqual([]);
  });

  it("a listener that throws doesn't stop the others", async () => {
    const gate = new TurnGate({ tasks: 1, jobs: 1 });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const other = vi.fn();
    gate.onChange(() => {
      throw new Error("boom");
    });
    gate.onChange(other);
    await gate.acquire("tasks", { id: "a" });
    expect(other).toHaveBeenCalled();
    err.mockRestore();
  });

  describe("tryAcquire (cap 1, nothing waiting: no await, as today)", () => {
    it("takes a free slot synchronously", () => {
      const gate = new TurnGate({ tasks: 1, jobs: 1 });
      const release = gate.tryAcquire("tasks", { id: "a" });
      expect(release).toBeTypeOf("function");
      expect(gate.running("tasks")).toBe(1);
      expect(gate.tryAcquire("tasks", { id: "b" })).toBeNull();
      release!();
      expect(gate.running("tasks")).toBe(0);
    });
    it("never jumps the queue, a pause or a hold", async () => {
      const gate = new TurnGate({ tasks: 2, jobs: 1 });
      await gate.acquire("tasks", { id: "a" });
      gate.pause({ reason: "folder-move" });
      void gate.acquire("tasks", { id: "b" }).catch(() => {});
      gate.resume();
      // b took the second slot through the queue.
      expect(gate.tryAcquire("tasks", { id: "c" })).toBeNull();
      const g2 = new TurnGate({ tasks: 2, jobs: 1 });
      const unhold = g2.hold(10_000);
      expect(g2.tryAcquire("tasks", { id: "x" })).toBeNull();
      unhold();
      g2.pause({ reason: "folder-move" });
      expect(g2.tryAcquire("tasks", { id: "x" })).toBeNull();
      g2.resume();
      void g2.acquire("tasks", { id: "q" });
      expect(g2.tryAcquire("tasks", { id: "x" })).toBeTypeOf("function");
      gate.dropAll();
    });
  });

  describe("singleSession (an engine held at one live process; Task 1 carry note)", () => {
    it("counts tasks and jobs together at one, and takes them in arrival order", async () => {
      const gate = new TurnGate({ tasks: 1, jobs: 1 }, { hold: { singleSession: true } });
      const rt = await gate.acquire("tasks", { id: "t" });
      const order: string[] = [];
      const pj = gate.acquire("jobs", { id: "j" }).then((r) => (order.push("j"), r));
      const pt = gate.acquire("tasks", { id: "t2" }).then((r) => (order.push("t2"), r));
      await flush();
      expect(order).toEqual([]);
      rt();
      (await pj)();
      (await pt)();
      expect(order).toEqual(["j", "t2"]);
      expect(gate.running("tasks") + gate.running("jobs")).toBe(0);
    });

    it("beforeStart runs before every admitted turn and holds the slot until it settles (idle lanes sleep first)", async () => {
      const gate = new TurnGate({ tasks: 1, jobs: 1 }, { hold: { singleSession: true } });
      let finishSleep!: () => void;
      const beforeStart = vi.fn((_t: { cap: string; id: string }) => new Promise<void>((r) => (finishSleep = r)));
      gate.setBeforeStart(beforeStart);
      expect(gate.tryAcquire("tasks", { id: "a" })).toBeNull();
      let started = false;
      const pa = gate.acquire("tasks", { id: "a" }).then((r) => ((started = true), r));
      await flush();
      expect(beforeStart).toHaveBeenCalledWith({ cap: "tasks", id: "a" });
      expect(started).toBe(false);
      expect(gate.running("tasks")).toBe(1);
      expect(gate.isQueued("a")).toBe(false);
      let jobStarted = false;
      void gate.acquire("jobs", { id: "j" }).then(() => (jobStarted = true));
      finishSleep();
      const ra = await pa;
      expect(jobStarted).toBe(false);
      ra();
      await flush();
      expect(beforeStart).toHaveBeenLastCalledWith({ cap: "jobs", id: "j" });
    });

    it("a failing beforeStart is logged and the turn still runs", async () => {
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      const gate = new TurnGate({ tasks: 1, jobs: 1 }, { hold: { singleSession: true } });
      gate.setBeforeStart(async () => {
        throw new Error("no sleep");
      });
      const r = await gate.acquire("tasks", { id: "a" });
      expect(err).toHaveBeenCalled();
      r();
      err.mockRestore();
    });

    it("drop() during beforeStart frees the slot once and rejects with Dropped", async () => {
      const gate = new TurnGate({ tasks: 1, jobs: 1 }, { hold: { singleSession: true } });
      let finishSleep!: () => void;
      gate.setBeforeStart(() => new Promise<void>((r) => (finishSleep = r)));
      const pa = gate.acquire("tasks", { id: "a", text: "hi" });
      await flush();
      expect(gate.drop("a")).toBe("hi");
      await expect(pa).rejects.toBeInstanceOf(Dropped);
      expect(gate.running("tasks")).toBe(0);
      finishSleep();
      await flush();
      expect(gate.running("tasks")).toBe(0);
      gate.setBeforeStart(null);
      (await gate.acquire("tasks", { id: "b" }))();
    });

    it("dropAll during beforeStart drops the admitting turn too", async () => {
      const gate = new TurnGate({ tasks: 1, jobs: 1 }, { hold: { singleSession: true } });
      gate.setBeforeStart(() => new Promise<void>(() => {}));
      const pa = gate.acquire("tasks", { id: "a" });
      await flush();
      gate.dropAll();
      await expect(pa).rejects.toBeInstanceOf(Dropped);
      expect(gate.running("tasks")).toBe(0);
    });

    it("beforeStart isn't called without singleSession", async () => {
      const gate = new TurnGate({ tasks: 1, jobs: 1 });
      const beforeStart = vi.fn(async () => {});
      gate.setBeforeStart(beforeStart);
      (await gate.acquire("tasks", { id: "a" }))();
      expect(beforeStart).not.toHaveBeenCalled();
    });

    it("setCaps with a new hold turns singleSession on and off; without one keeps it", async () => {
      const gate = new TurnGate({ tasks: 2, jobs: 2 });
      const ra = await gate.acquire("tasks", { id: "a" });
      gate.setCaps({ tasks: 2, jobs: 2 }, { singleSession: true });
      expect(gate.tryAcquire("jobs", { id: "j" })).toBeNull();
      gate.setCaps({ tasks: 3, jobs: 3 });
      expect(gate.tryAcquire("jobs", { id: "j" })).toBeNull();
      gate.setCaps({ tasks: 2, jobs: 2 }, {});
      const rj = gate.tryAcquire("jobs", { id: "j" });
      expect(rj).toBeTypeOf("function");
      ra();
      rj!();
    });
  });
});
