import type { BackendInit } from "@humanharness/harness-sdk";
import { describe, expect, it } from "vitest";
import type { BackendExit } from "../../src/main/backend/backend-process";
import { BackendSupervisor, type BackendState, type SupervisedProcess } from "../../src/main/backend/backend-supervisor";

const init: BackendInit = { folder: "/w", scopes: [], language: "en", coreVersion: "0.1.0", dataDir: "/d", mock: false };
const scope = { id: "s1", title: "One", linked: [{ key: "code", path: "/code", mode: "read" as const }] };

/** A process whose exit the test decides: crash() is an unexpected exit, stop() an expected one. */
class FakeProcess implements SupervisedProcess {
  readonly exited: Promise<BackendExit>;
  readonly notified: { method: string; params: BackendInit }[] = [];
  readonly calls: { method: string; params: unknown }[] = [];
  stopped = false;
  crashed = false;
  /** When set, stop() waits for this before the process is gone. */
  stopGate: Promise<void> | null = null;
  private resolveExit!: (e: BackendExit) => void;

  constructor(readonly init: BackendInit) {
    this.exited = new Promise((r) => {
      this.resolveExit = r;
    });
  }
  crash(): void {
    this.crashed = true;
    this.resolveExit({ code: 1, signal: null, expected: false });
  }
  call(method: string, params: unknown): Promise<unknown> {
    this.calls.push({ method, params });
    return Promise.resolve({ echo: params });
  }
  notify(method: "scopesChanged", params: BackendInit): void {
    this.notified.push({ method, params });
  }
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.stopGate) await this.stopGate;
    this.resolveExit({ code: null, signal: "SIGTERM", expected: true });
  }
}

/** Lets every pending promise callback run. */
const settle = () => new Promise((r) => setTimeout(r, 0));

function rig(opts: { failStarts?: number; startGate?: () => Promise<void>; throwOnState?: BackendState } = {}) {
  let t = 0;
  let failStarts = opts.failStarts ?? 0;
  const procs: FakeProcess[] = [];
  const states: BackendState[] = [];
  const events: [string, unknown][] = [];
  const startedWith: BackendInit[] = [];
  const sup = new BackendSupervisor({
    startProcess: async (i, onEvent) => {
      startedWith.push(i);
      if (opts.startGate) await opts.startGate();
      if (failStarts > 0) {
        failStarts--;
        throw new Error("spawn failed");
      }
      onEvent("hello", { n: procs.length });
      const p = new FakeProcess(i);
      procs.push(p);
      return p;
    },
    onEvent: (e, d) => events.push([e, d]),
    onState: (s) => {
      states.push(s);
      if (s === opts.throwOnState) throw new Error("listener failed");
    },
    now: () => t,
  });
  return {
    sup,
    procs,
    states,
    events,
    startedWith,
    last: () => procs[procs.length - 1]!,
    at: (ms: number) => {
      t = ms;
    },
  };
}

describe("BackendSupervisor (hatches spec §4.3, B6)", () => {
  it("start → starting → running; state changes are reported", async () => {
    const r = rig();
    expect(r.sup.state()).toBe("stopped");
    await r.sup.start(init);
    expect(r.sup.state()).toBe("running");
    expect(r.states).toEqual(["starting", "running"]);
    expect(r.startedWith).toEqual([init]);
    expect(r.events).toEqual([["hello", { n: 0 }]]);
    // A second start while running starts nothing.
    await r.sup.start(init);
    expect(r.procs).toHaveLength(1);
    expect(r.states).toEqual(["starting", "running"]);
  });

  it("restarts after a crash, up to 3 times in 5 minutes, then failed", async () => {
    const r = rig();
    await r.sup.start(init);
    for (const [i, ms] of [0, 10_000, 20_000].entries()) {
      r.at(ms);
      r.last().crash();
      await settle();
      expect(r.procs).toHaveLength(i + 2);
      expect(r.sup.state()).toBe("running");
    }
    r.at(30_000);
    r.last().crash();
    await settle();
    expect(r.sup.state()).toBe("failed");
    expect(r.procs).toHaveLength(4); // the first start plus three restarts, no fourth
    expect(r.states.at(-1)).toBe("failed");
  });

  it("crashes spread over more than 5 minutes keep restarting", async () => {
    const r = rig();
    await r.sup.start(init);
    for (const ms of [0, 2, 4, 6, 8].map((m) => m * 60_000)) {
      r.at(ms);
      r.last().crash();
      await settle();
    }
    expect(r.sup.state()).toBe("running");
    expect(r.procs).toHaveLength(6);
  });

  it("a start that throws counts as a crash", async () => {
    const r = rig({ failStarts: 4 });
    await r.sup.start(init);
    await settle();
    // Four failed starts: the first plus three restarts, then failed, no fifth attempt.
    expect(r.sup.state()).toBe("failed");
    expect(r.startedWith).toHaveLength(4);
    expect(r.procs).toHaveLength(0);
  });

  it("restart() from failed starts again and clears the count", async () => {
    const r = rig();
    await r.sup.start(init);
    for (let i = 0; i < 4; i++) {
      r.last().crash();
      await settle();
    }
    expect(r.sup.state()).toBe("failed");
    await r.sup.restart();
    expect(r.sup.state()).toBe("running");
    expect(r.procs).toHaveLength(5);
    // The count starts over: three more crashes at the same instant still restart.
    for (let i = 0; i < 3; i++) {
      r.last().crash();
      await settle();
    }
    expect(r.sup.state()).toBe("running");
    expect(r.procs).toHaveLength(8);
  });

  it("an expected exit (stop) is not a crash", async () => {
    const r = rig();
    await r.sup.start(init);
    await r.sup.stop();
    await settle();
    expect(r.procs[0]!.stopped).toBe(true);
    expect(r.procs).toHaveLength(1);
    expect(r.sup.state()).toBe("stopped");
    expect(r.states).toEqual(["starting", "running", "stopped"]);
    // A later start (a folder move's end) starts it again.
    await r.sup.start(init);
    expect(r.sup.state()).toBe("running");
    expect(r.procs).toHaveLength(2);
  });

  it("rebase(init) stops and starts with the new init; a call during it rejects 'The backend isn't running'", async () => {
    const r = rig();
    await r.sup.start(init);
    const first = r.last();
    let open!: () => void;
    first.stopGate = new Promise((res) => {
      open = res;
    });
    const moved = { ...init, folder: "/moved" };
    const rebasing = r.sup.rebase(moved);
    await expect(r.sup.call("echo", 1)).rejects.toThrow("The backend isn't running");
    expect(first.calls).toEqual([]);
    open();
    await rebasing;
    expect(first.stopped).toBe(true);
    expect(r.procs).toHaveLength(2);
    expect(r.last().init).toEqual(moved);
    expect(r.sup.state()).toBe("running");
    await expect(r.sup.call("echo", 2)).resolves.toEqual({ echo: 2 });
    expect(r.last().calls).toEqual([{ method: "echo", params: 2 }]);
  });

  it("rebase and a crash restart never interleave", async () => {
    const r = rig();
    await r.sup.start(init);
    r.last().crash();
    const rebasing = r.sup.rebase({ ...init, folder: "/b" });
    await rebasing;
    await settle();
    // One restart for the crash and one start for the rebase, each on its own; one process left running.
    expect(r.sup.state()).toBe("running");
    expect(r.procs.filter((p) => !p.stopped && !p.crashed)).toHaveLength(1);
    expect(r.last().init.folder).toBe("/b");
  });

  it("stop() for quit: no restart afterwards, even if it crashes while stopping", async () => {
    const r = rig();
    await r.sup.start(init);
    const p = r.last();
    let open!: () => void;
    p.stopGate = new Promise((res) => {
      open = res;
    });
    const stopping = r.sup.stop();
    p.crash(); // dies on its own while being stopped
    open();
    await stopping;
    await settle();
    expect(r.procs).toHaveLength(1);
    expect(r.sup.state()).toBe("stopped");
    await expect(r.sup.call("echo", 1)).rejects.toThrow("The backend isn't running");
  });

  it("scopesChanged notifies a running backend, and is remembered for the next start", async () => {
    const r = rig();
    await r.sup.start(init);
    r.sup.scopesChanged([scope]);
    expect(r.last().notified).toEqual([{ method: "scopesChanged", params: { ...init, scopes: [scope] } }]);
    r.last().crash();
    await settle();
    expect(r.procs).toHaveLength(2);
    expect(r.last().init.scopes).toEqual([scope]);
    expect(r.last().notified).toEqual([]);
  });

  it("scopes that change while it starts reach the new backend", async () => {
    let open!: () => void;
    const gate = new Promise<void>((res) => {
      open = res;
    });
    const r = rig({ startGate: () => gate });
    const starting = r.sup.start(init);
    await settle();
    expect(r.startedWith).toHaveLength(1);
    r.sup.scopesChanged([scope]);
    open();
    await starting;
    expect(r.last().init.scopes).toEqual([]);
    expect(r.last().notified).toEqual([{ method: "scopesChanged", params: { ...init, scopes: [scope] } }]);
  });

  it("a running backend with unchanged scopes gets no scopesChanged at start", async () => {
    const r = rig();
    await r.sup.start(init);
    expect(r.last().notified).toEqual([]);
  });

  it("a throwing onState still leaves the process watched: its crash restarts it", async () => {
    const r = rig({ throwOnState: "running" });
    await expect(r.sup.start(init)).rejects.toThrow("listener failed");
    r.last().crash();
    await settle().then(settle);
    expect(r.procs).toHaveLength(2);
  });

  it("after stop({ quit: true }) nothing brings it back", async () => {
    const r = rig();
    await r.sup.start(init);
    await r.sup.stop({ quit: true });
    await r.sup.restart();
    await r.sup.rebase({ ...init, folder: "/b" });
    await r.sup.start(init);
    expect(r.procs).toHaveLength(1);
    expect(r.sup.state()).toBe("stopped");
  });

  it("call when not running rejects 'The backend isn't running'", async () => {
    const r = rig();
    await expect(r.sup.call("echo", 1)).rejects.toThrow("The backend isn't running");
    await r.sup.start(init);
    await expect(r.sup.call("echo", 1)).resolves.toEqual({ echo: 1 });
    for (let i = 0; i < 4; i++) {
      r.last().crash();
      await settle();
    }
    expect(r.sup.state()).toBe("failed");
    await expect(r.sup.call("echo", 1)).rejects.toThrow("The backend isn't running");
  });
});
