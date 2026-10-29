import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CrashPolicy, PluginScheduler } from "../src/main/plugin-scheduler";

const MIN = 60_000;
function setup(
  o: {
    ttl?: number;
    workHoursOnly?: boolean;
    inHours?: () => boolean;
    results?: (() => Promise<void>)[];
    raise?: () => Promise<void>;
  } = {},
) {
  const runs: string[] = [];
  const raised: unknown[] = [];
  const resolved: string[] = [];
  const results = o.results ?? [];
  const s = new PluginScheduler({
    sources: [{ id: "queues", ttl: o.ttl ?? 300, workHoursOnly: o.workHoursOnly ?? false }],
    inWorkHours: o.inHours ?? (() => true),
    run: async (source) => {
      runs.push(source);
      const r = results.shift();
      if (r) await r();
      return { writes: 0 };
    },
    raise: async (item) => {
      if (o.raise) await o.raise();
      raised.push(item);
    },
    resolve: async (key) => void resolved.push(key),
    runLimitMs: 2 * MIN,
    onTimeout: () => {},
  });
  return { s, runs, raised, resolved };
}
const fail = () => Promise.reject(new Error("HTTP 500"));

describe("PluginScheduler (plugins spec §4.3)", () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date("2026-10-27T10:00:00Z") }));
  afterEach(() => vi.useRealTimers());

  it("runs at start, then every TTL", async () => {
    const t = setup({ ttl: 300 });
    t.s.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.runs).toEqual(["queues"]);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(t.runs).toEqual(["queues", "queues"]);
    expect(t.s.status("queues")).toMatchObject({
      running: false,
      failures: 0,
      lastOk: "2026-10-27T10:05:00.000Z",
      nextAt: "2026-10-27T10:10:00.000Z",
    });
    t.s.stop();
  });

  it("one run in flight per source: refreshes during a run share one follow-up run", async () => {
    let release!: () => void;
    const t = setup({ results: [() => new Promise<void>((r) => (release = r))] });
    t.s.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.s.status("queues").running).toBe(true);
    const refreshes = Array.from({ length: 50 }, () => t.s.refresh("queues"));
    expect(t.runs).toHaveLength(1);
    release();
    const results = await Promise.all(refreshes);
    expect(results).toHaveLength(50);
    for (const r of results) expect(r).toEqual({ ok: true, writes: 0 });
    expect(t.runs).toHaveLength(2);
    expect(await t.s.refresh("queues")).toEqual({ ok: true, writes: 0 }); // the next one runs on its own
    expect(t.runs).toHaveLength(3);
    t.s.stop();
  });

  it("a refresh resets the timer: the next run is a TTL after it", async () => {
    const t = setup({ ttl: 300 });
    t.s.start();
    await vi.advanceTimersByTimeAsync(200_000);
    await t.s.refresh("queues");
    await vi.advanceTimersByTimeAsync(299_000);
    expect(t.runs).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.runs).toHaveLength(3);
    t.s.stop();
  });

  it("workHoursOnly sources skip outside the hours; Refresh runs anyway", async () => {
    const t = setup({ workHoursOnly: true, inHours: () => false });
    t.s.start();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(t.runs).toEqual([]);
    await t.s.refresh("queues");
    expect(t.runs).toEqual(["queues"]);
    t.s.stop();
  });

  it("a due workHoursOnly source re-checks every minute and runs once the hours begin", async () => {
    let open = false;
    const t = setup({ workHoursOnly: true, inHours: () => open });
    t.s.start();
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(t.runs).toEqual([]);
    open = true;
    await vi.advanceTimersByTimeAsync(MIN);
    expect(t.runs).toEqual(["queues"]);
    t.s.stop();
  });

  it("an inWorkHours that throws counts as in the hours (logged); the source keeps running", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = setup({
      ttl: 60,
      workHoursOnly: true,
      inHours: () => {
        throw new Error("no clock");
      },
    });
    t.s.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(MIN);
    expect(t.runs).toEqual(["queues", "queues"]);
    expect(error).toHaveBeenCalled();
    t.s.stop();
    error.mockRestore();
  });

  it("a failure backs off 1, 2, 4 minutes capped at the TTL, and 3 in a row raise an info item resolved by a success", async () => {
    const t = setup({ ttl: 180, results: [fail, fail, fail, fail] });
    t.s.start();
    await vi.advanceTimersByTimeAsync(0); // fail 1
    await vi.advanceTimersByTimeAsync(1 * MIN); // fail 2
    expect(t.raised).toEqual([]);
    await vi.advanceTimersByTimeAsync(2 * MIN); // fail 3 → item
    expect(t.raised).toEqual([
      expect.objectContaining({ key: "sync-failing:queues", severity: "info", title: "queues isn't syncing", body: "HTTP 500" }),
    ]);
    await vi.advanceTimersByTimeAsync(3 * MIN); // capped at the TTL (3 min), fail 4
    expect(t.runs).toHaveLength(4);
    expect(t.raised).toHaveLength(1);
    expect(t.s.status("queues")).toMatchObject({ lastError: "HTTP 500", failures: 4 });
    await vi.advanceTimersByTimeAsync(3 * MIN); // success
    expect(t.resolved).toEqual(["sync-failing:queues"]);
    expect(t.s.status("queues")).toMatchObject({ lastError: undefined, failures: 0 });
    t.s.stop();
  });

  it("a refused raise is retried on the next failure and never breaks the schedule", async () => {
    let refuse = true;
    const t = setup({
      ttl: 600,
      results: [fail, fail, fail, fail],
      raise: async () => {
        if (refuse) throw new Error("link refused");
      },
    });
    t.s.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3 * MIN); // fails 2 and 3; raise refused
    expect(t.runs).toHaveLength(3);
    expect(t.raised).toEqual([]);
    refuse = false;
    await vi.advanceTimersByTimeAsync(4 * MIN); // fail 4 → raised now
    expect(t.raised).toHaveLength(1);
    t.s.stop();
  });

  it("the item's body is the last error, at most 500 characters", async () => {
    const long = () => Promise.reject(new Error("x".repeat(2_000)));
    const t = setup({ ttl: 600, results: [long, long, long] });
    t.s.start();
    await vi.advanceTimersByTimeAsync(3 * MIN);
    expect((t.raised[0] as { body: string }).body).toHaveLength(500);
    t.s.stop();
  });

  it("a run over the limit fails as a timeout and asks for a reload", async () => {
    let reloads = 0;
    const t = setup({ results: [() => new Promise<void>(() => {})] });
    (t.s as unknown as { d: { onTimeout: () => void } }).d.onTimeout = () => void (reloads += 1);
    t.s.start();
    await vi.advanceTimersByTimeAsync(2 * MIN + 1);
    expect(t.s.status("queues")).toMatchObject({ running: false, failures: 1, lastError: expect.stringMatching(/2 minutes/) });
    expect(reloads).toBe(1);
    await vi.advanceTimersByTimeAsync(MIN); // the backoff run goes ahead despite the stuck one
    expect(t.runs).toHaveLength(2);
    expect(t.s.status("queues").failures).toBe(0);
    t.s.stop();
  });

  it("stop clears every timer: nothing runs afterwards", async () => {
    const t = setup();
    t.s.start();
    await vi.advanceTimersByTimeAsync(0);
    t.s.stop();
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(t.runs).toEqual(["queues"]);
  });

  it("a run that ends after stop neither raises nor schedules", async () => {
    let reject!: (e: Error) => void;
    const pending = () => new Promise<void>((_r, j) => (reject = j));
    const t = setup({ ttl: 600, results: [fail, fail, pending] });
    t.s.start();
    await vi.advanceTimersByTimeAsync(3 * MIN); // fails 1, 2; run 3 in flight
    expect(t.runs).toHaveLength(3);
    t.s.stop();
    reject(new Error("HTTP 500"));
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(t.raised).toEqual([]);
    expect(t.runs).toHaveLength(3);
  });

  it("stop settles a refresh waiting on a run that never ends", async () => {
    const t = setup({ results: [() => new Promise<void>(() => {})] });
    t.s.start();
    await vi.advanceTimersByTimeAsync(0);
    const refresh = t.s.refresh("queues");
    t.s.stop();
    await vi.advanceTimersByTimeAsync(0);
    await expect(refresh).resolves.toMatchObject({ ok: true });
    expect(t.s.status("queues").running).toBe(false);
  });

  it("stop settles every attempt in flight, and no attempt keeps a stopper once settled", async () => {
    const t = setup({ results: [() => new Promise<void>(() => {}), () => new Promise<void>(() => {})] });
    const stoppers = () => (t.s as unknown as { stoppers: Set<unknown> }).stoppers.size;
    t.s.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(stoppers()).toBe(1);
    const waiting = t.s.refresh("queues"); // its follow-up run gets stuck too
    t.s.stop();
    expect(stoppers()).toBe(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(stoppers()).toBe(1);
    t.s.stop();
    await expect(waiting).resolves.toEqual({ ok: false, error: "Stopped" });
    expect(stoppers()).toBe(0);
    for (let i = 0; i < 5; i++) await t.s.refresh("queues");
    expect(stoppers()).toBe(0);
  });

  it("resumed() runs now every source whose next run passed during sleep, one in flight at a time", async () => {
    let clock = Date.parse("2026-10-27T10:00:00Z");
    const runs: string[] = [];
    let release: (() => void) | undefined;
    const s = new PluginScheduler({
      sources: [
        { id: "due", ttl: 300, workHoursOnly: false },
        { id: "later", ttl: 3600, workHoursOnly: false },
      ],
      inWorkHours: () => true,
      run: async (source) => {
        runs.push(source);
        if (source === "due" && runs.length > 2) await new Promise<void>((r) => (release = r));
        return { writes: 0 };
      },
      raise: async () => {},
      resolve: async () => {},
      runLimitMs: 2 * MIN,
      onTimeout: () => {},
      now: () => clock,
    });
    s.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(runs.sort()).toEqual(["due", "later"]);
    clock += 10 * MIN; // asleep: the clock moved, the timers did not fire
    s.resumed();
    await vi.advanceTimersByTimeAsync(0);
    expect(runs.filter((r) => r === "due")).toHaveLength(2);
    expect(runs.filter((r) => r === "later")).toHaveLength(1);
    expect(s.status("due").running).toBe(true);
    clock += 10 * MIN;
    s.resumed(); // "due" is in flight: no second run
    await vi.advanceTimersByTimeAsync(0);
    expect(runs.filter((r) => r === "due")).toHaveLength(2);
    release?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.status("due")).toMatchObject({ running: false, nextAt: new Date(clock + 300_000).toISOString() });
    s.stop();
    s.resumed(); // stopped: nothing runs
    clock += 60 * MIN;
    await vi.advanceTimersByTimeAsync(0);
    expect(runs).toHaveLength(3);
  });

  it("starts again after a stop", async () => {
    const t = setup();
    t.s.start();
    await vi.advanceTimersByTimeAsync(0);
    t.s.stop();
    t.s.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.runs).toEqual(["queues", "queues"]);
    t.s.stop();
  });

  it("an unknown source (even an Object.prototype name) is refused, never run", async () => {
    const t = setup();
    expect(await t.s.refresh("constructor")).toEqual({ ok: false, error: "Unknown source" });
    expect(t.s.status("__proto__")).toEqual({ running: false, failures: 0 });
    expect(t.runs).toEqual([]);
  });

  it("reports status changes", async () => {
    const changed = vi.fn();
    const t = setup();
    (t.s as unknown as { d: { changed: () => void } }).d.changed = changed;
    t.s.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(changed).toHaveBeenCalled();
    t.s.stop();
  });
});

describe("CrashPolicy (§4.3, Decision 11)", () => {
  it("backs off 1, 2, 4… s capped at 60 s; the 5th crash within an hour turns the plugin off", () => {
    const p = new CrashPolicy();
    const t0 = Date.parse("2026-10-27T10:00:00Z");
    expect(p.crashed(t0)).toEqual({ restartInMs: 1000 });
    expect(p.crashed(t0 + 1000)).toEqual({ restartInMs: 2000 });
    expect(p.crashed(t0 + 2000)).toEqual({ restartInMs: 4000 });
    expect(p.crashed(t0 + 3000)).toEqual({ restartInMs: 8000 });
    expect(p.crashed(t0 + 4000)).toEqual({ turnOff: true });
  });
  it("crashes older than an hour don't count", () => {
    const p = new CrashPolicy();
    const t0 = 0;
    for (let i = 0; i < 4; i++) p.crashed(t0 + i);
    expect(p.crashed(t0 + 3_600_001 + 4)).toEqual({ restartInMs: 1000 });
  });
  it("reset forgets every crash", () => {
    const p = new CrashPolicy();
    for (let i = 0; i < 4; i++) p.crashed(i);
    p.reset();
    expect(p.crashed(10)).toEqual({ restartInMs: 1000 });
  });
});
