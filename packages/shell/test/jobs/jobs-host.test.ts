import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type HarnessJob, jobSchema } from "@humanharness/harness-sdk";
import type { Event, HarnessWorkspace, SessionSlot, SlotOptions, SlotSendOptions } from "@humanharness/runtime";
import { APP_SCOPE } from "@humanharness/workspace";
import type { TurnOptions } from "../../src/main/turn-controller";
import { JobLog, type JobRunRecord } from "../../src/main/jobs/job-log";
import {
  CachedJobLog,
  type JobsHostDeps,
  cleanJobSettings,
  createJobsHost,
  isJobSlot,
  jobOriginKnown,
  openSingleRuntime,
  singleBeforeStart,
  singleCaps,
  singleGate,
  singleTurns,
} from "../../src/main/jobs/jobs-host";
import type { UsageRecord } from "../../src/main/usage-log";
import { attentionStores } from "../../src/main/attention-stores";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-jobs-host-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
let n = 0;
const freshBase = () => fs.mkdtempSync(path.join(root, `b${++n}-`));

const job = (o: Record<string, unknown> = {}): HarnessJob => jobSchema.parse({ label: "Sync", prompt: "jobs/sync.md", on: { manual: true }, ...o });

/** Resolves once `check` holds (polls every 5 ms, up to 2 s). */
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  if (!check()) throw new Error("timed out");
}

/** One turn a fake slot runs: the test ends it with `end` (or it ends cancelled when cancelled). */
interface FakeTurn {
  slot: string;
  message: string;
  emit: (e: Event) => void;
  options: SlotSendOptions | undefined;
  end: (events?: Event[]) => void;
}

/** A workspace double: each slot's `send` waits until the test ends its turn; a cancel ends it cancelled. */
function fakeWorkspace() {
  const turns: FakeTurn[] = [];
  const opened: SlotOptions[] = [];
  const closed: string[] = [];
  const sleeps: string[] = [];
  let running = 0;
  let refreshWrites = false;
  const ws = {
    history: { tag: "history" },
    anyRunning: () => running > 0,
    runningPaths: async () => [],
    refreshInstructions: async () => refreshWrites,
    close: async () => {},
    async openSlot(o: SlotOptions): Promise<SessionSlot> {
      opened.push(o);
      let busy = false;
      let finish: ((events: Event[]) => void) | null = null;
      return {
        key: o.key,
        isBusy: () => busy,
        send(message: string, emit: (e: Event) => void, options?: SlotSendOptions) {
          busy = true;
          running++;
          let resolve!: () => void;
          const done = new Promise<void>((r) => (resolve = r));
          finish = (events) => {
            if (!busy) return;
            busy = false;
            running--;
            for (const e of events) emit(e);
            resolve();
          };
          turns.push({ slot: o.key, message, emit, options, end: (events = [{ type: "done", ok: true }]) => finish?.(events) });
          return { cancel: () => finish?.([{ type: "done", ok: false, error: { code: "cancelled" } }]), done };
        },
        endSession: async () => {},
        sleep: async () => void sleeps.push(o.key),
        close: async () => {
          finish?.([{ type: "done", ok: false, error: { code: "cancelled" } }]);
          closed.push(o.key);
        },
      };
    },
  } as unknown as HarnessWorkspace;
  return {
    ws,
    turns,
    opened,
    closed,
    sleeps,
    setRefreshWrites: (v: boolean) => {
      refreshWrites = v;
    },
  };
}

const result = (data: unknown): Event => ({ type: "block", name: "job_result", data });
const usage: Event = { type: "usage", inputTokens: 100, outputTokens: 20, cacheReadTokens: 5, cacheWriteTokens: 3 };

function host(o: { jobs?: Record<string, HarnessJob>; gate?: ReturnType<typeof singleGate>; deps?: Partial<JobsHostDeps> } = {}) {
  const base = freshBase();
  const fake = fakeWorkspace();
  const gate = o.gate ?? singleGate("claude", undefined);
  const usageLines: { base: string; record: UsageRecord }[] = [];
  const reports: string[] = [];
  const h = createJobsHost({
    jobs: o.jobs ?? { sync: job() },
    actions: { implement: { label: "Implement" } },
    readBrief: async () => "Sync the inbox.",
    workspace: async () => fake.ws,
    gate,
    base: async () => base,
    taskDeps: { notes: async () => [] },
    scoped: () => false,
    scopes: async () => ["main"],
    scopeExists: async (s) => s === "main",
    engine: async () => "claude",
    usage: async (b, record) => void usageLines.push({ base: b, record }),
    report: (m) => void reports.push(m),
    ...o.deps,
  });
  const runs = () => new JobLog(base).all();
  return { h, base, fake, gate, usageLines, reports, runs };
}

describe("createJobsHost (part 3 Task 7)", () => {
  it("wires the scheduler to runJob: a job slot of the workspace, through the gate's jobs cap, logged in the base", async () => {
    const t = host();
    expect(await t.h.runManual("sync")).toBe(true);
    await until(() => t.fake.turns.length === 1);
    const turn = t.fake.turns[0];
    // Its own `job:<run>` slot, of kind job; the gate counts it under `jobs`, never `tasks`.
    expect(isJobSlot(turn.slot)).toBe(true);
    expect(t.fake.opened[0]).toMatchObject({ key: turn.slot, kind: "job" });
    expect(t.gate.running("jobs")).toBe(1);
    expect(t.gate.running("tasks")).toBe(0);
    expect(turn.message).toContain("Sync the inbox.");
    const run = turn.slot.slice("job:".length);
    expect(turn.options?.trailer).toEqual({ task: run, job: "sync" });
    // A data request from that slot is the run's, app-wide without scopes (`main`).
    expect(t.h.runningOf(turn.slot)).toEqual({ id: run, scope: "main" });
    expect(t.h.runningOf("main")).toBeNull();
    expect(t.h.running()).toBe(true);
    turn.end([usage, result({ status: "ok", summary: "Synced 3" }), { type: "done", ok: true }]);
    await until(() => !t.h.running());
    const [rec] = await t.runs();
    expect(rec).toMatchObject({ run, job: "sync", scope: null, trigger: "manual", status: "ok", summary: "Synced 3", tokens: 123 });
    expect(t.gate.running("jobs")).toBe(0);
    expect(t.h.runningOf(turn.slot)).toBeNull();
    // The usage line the way a task's is built: phase job, the job's id, the run as its task.
    expect(t.usageLines).toEqual([
      {
        base: t.base,
        record: {
          at: expect.any(String),
          engine: "claude",
          task: run,
          phase: "job",
          job: "sync",
          ok: true,
          usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 5, cacheWriteTokens: 3 },
        },
      },
    ]);
  });

  it("a scoped run reads its scope; an app-wide one the app scope in a scoped harness", async () => {
    const t = host({
      jobs: { sync: job({ scope: "trigger" }), tidy: job({ scope: "none" }) },
      gate: singleGate("claude", { jobs: 2 }),
      deps: { scoped: () => true, scopeExists: async () => true },
    });
    await t.h.runManual("sync", "physics");
    await t.h.runManual("tidy");
    await until(() => t.fake.turns.length === 2);
    const bySlot = (i: number) => t.h.runningOf(t.fake.turns[i].slot);
    expect([bySlot(0)?.scope, bySlot(1)?.scope].sort()).toEqual([APP_SCOPE, "physics"].sort());
    for (const turn of t.fake.turns) turn.end();
  });

  it("appReady runs the start jobs once per app start", async () => {
    const t = host({ jobs: { boot: job({ on: { start: true } }), later: job({ on: { manual: true } }) } });
    await t.h.appReady();
    await t.h.appReady();
    await until(() => t.fake.turns.length === 1);
    expect(t.fake.turns[0].message).toContain("Sync the inbox.");
    t.fake.turns[0].end([result({ status: "ok", summary: "Booted" }), { type: "done", ok: true }]);
    await until(() => !t.h.running());
    expect((await t.runs()).map((r) => [r.job, r.trigger])).toEqual([["boot", "start"]]);
  });

  it("cancelRuns (engine switch) cancels the running run; stopAll (quit) lets nothing start again", async () => {
    const t = host();
    await t.h.runManual("sync");
    await until(() => t.fake.turns.length === 1);
    t.h.cancelRuns();
    await until(() => !t.h.running());
    expect((await t.runs())[0]).toMatchObject({ status: "failed", summary: "Cancelled" });
    // Timers and triggers still work after an engine switch.
    expect(await t.h.runManual("sync")).toBe(true);
    await until(() => t.fake.turns.length === 2);
    t.h.stopAll();
    await until(() => !t.h.running());
    expect(await t.h.runManual("sync")).toBe(false);
    expect((await t.runs()).map((r) => r.summary)).toEqual(["Cancelled", "Cancelled"]);
  });

  it("taskClosed reaches the afterTask jobs", async () => {
    const t = host({ jobs: { review: job({ on: { afterTask: ["implement"] } }) } });
    t.h.taskClosed({ id: "t1", action: "write", scope: "main" });
    t.h.taskClosed({ id: "t2", action: "implement", scope: "main" });
    await until(() => t.fake.turns.length === 1);
    t.fake.turns[0].end();
    await until(() => !t.h.running());
    expect((await t.runs()).map((r) => [r.job, r.trigger, r.status, r.summary])).toEqual([["review", "afterTask", "failed", "No result"]]);
  });

  it("a run before setup (no base) is skipped, logs nothing and frees its dedupe key", async () => {
    const t = host({ deps: { base: async () => null } });
    expect(await t.h.runManual("sync")).toBe(true);
    await until(() => !t.h.scheduler.isActive("sync", null));
    expect(t.fake.turns).toHaveLength(0);
    expect(t.reports.some((r) => r.includes("not set up"))).toBe(true);
  });

  it("Settings › Jobs: off only when true, a cap only as a whole number ≥ 1", async () => {
    expect(cleanJobSettings({ off: true, dailyTokens: 5000 })).toEqual({ off: true, dailyTokens: 5000 });
    for (const bad of [0, -1, 1.5, "5000", Number.NaN, Number.POSITIVE_INFINITY]) expect(cleanJobSettings({ dailyTokens: bad })).toEqual({});
    expect(cleanJobSettings({ off: "yes" })).toEqual({});
    expect(cleanJobSettings(null)).toEqual({});
    // A job turned off in settings is refused by every trigger.
    const t = host({ deps: { settings: (id) => (id === "sync" ? { off: true } : undefined) } });
    expect(await t.h.runManual("sync")).toBe(false);
  });
});

describe("job results in the Attention inbox (part 3 Task 8)", () => {
  /** A host whose base's shared store is real (attention-stores.ts, a test key), job origins known as index.ts registers them. */
  function attended(jobs: Record<string, HarnessJob> = { sync: job({ scope: "trigger" }) }, store?: JobsHostDeps["attention"]) {
    const stores = attentionStores({ tagKey: async () => Buffer.from("test key"), log: () => {} });
    stores.registerKnown("job", jobOriginKnown(jobs));
    let changes = 0;
    const t = host({
      jobs,
      deps: { scoped: () => true, scopeExists: async () => true, attention: store ?? ((b) => stores.forBase(b, true)), needsYouChanged: () => void changes++ },
    });
    const items = async () => (await stores.forBase(t.base, false))?.list() ?? [];
    return { ...t, stores, items, changes: () => changes };
  }
  /** Runs `sync` in `scope` once, its turn answering `data`. */
  async function runOnce(t: ReturnType<typeof attended>, data: unknown, scope = "main") {
    const before = t.fake.turns.length;
    expect(await t.h.runManual("sync", scope)).toBe(true);
    await until(() => t.fake.turns.length === before + 1);
    t.fake.turns[before].end([result(data), { type: "done", ok: true }]);
    await until(() => !t.h.running());
  }

  it("needs-you raises { kind: job, id: <job>:<scope> }, an action leading to the declared action; the next ok run resolves it", async () => {
    const t = attended();
    await runOnce(t, { status: "needs-you", summary: "Two conflicts need you", action: "implement" });
    expect(await t.items()).toMatchObject([
      {
        origin: { kind: "job", id: "sync:main" },
        key: "result",
        severity: "action",
        title: "Two conflicts need you",
        target: { action: "implement", vars: { scope: "main" } },
        read: false,
      },
    ]);
    expect(await t.h.needsYou()).toBe(1);
    expect(t.changes()).toBe(1);
    // Another scope's run leaves it alone.
    await runOnce(t, { status: "ok", summary: "Fine" }, "physics");
    expect((await t.items()).map((i) => i.origin.id)).toEqual(["sync:main"]);
    await runOnce(t, { status: "ok", summary: "Synced" });
    expect(await t.items()).toEqual([]);
    expect(await t.h.needsYou()).toBe(0);
  });

  it("a needs-you without an action has no target; a long summary is cut for the title and kept whole in the body", async () => {
    const t = attended();
    const long = `${"word ".repeat(40)}end`;
    await runOnce(t, { status: "needs-you", summary: long });
    const [item] = await t.items();
    expect(item.target).toBeUndefined();
    expect(item.title.length).toBeLessThanOrEqual(120);
    expect(long.startsWith(item.title)).toBe(true);
    expect(item.body).toBe(long);
  });

  it("an undeclared action never becomes a target (J3), even if the runner let one through", async () => {
    const t = attended();
    // `ghost` isn't an action: the runner drops it, and the host checks again before it leads anywhere.
    await runOnce(t, { status: "needs-you", summary: "Look", action: "ghost" });
    await runOnce(t, { status: "needs-you", summary: "Look again", action: "constructor" });
    expect((await t.items())[0].target).toBeUndefined();
  });

  it("a store that fails is logged; the run is still recorded", async () => {
    const t = attended(undefined, async () => ({
      raise: async () => {
        throw new Error("disk full");
      },
      resolve: async () => {},
    }));
    await runOnce(t, { status: "needs-you", summary: "Look" });
    expect((await t.runs())[0]).toMatchObject({ status: "needs-you" });
    expect(t.reports.some((r) => r.includes("Attention"))).toBe(true);
  });

  it("known: only `<declared job>:<scope>` origins show", () => {
    const known = jobOriginKnown({ sync: job() });
    expect(known("sync:main")).toBe(true);
    expect(known("sync:-")).toBe(true);
    expect(known("ghost:main")).toBe(false);
    expect(known("sync")).toBe(false);
    expect(known("sync:")).toBe(false);
    expect(known("constructor:main")).toBe(false);
    const t = attended();
    expect(t.stores.known({ kind: "job", id: "sync:main" })).toBe(true);
    expect(t.stores.known({ kind: "job", id: "toString:main" })).toBe(false);
  });

  it("needsYou counts the declared jobs' scopes whose last run needs the person", async () => {
    const t = attended();
    await runOnce(t, { status: "needs-you", summary: "A" });
    await runOnce(t, { status: "needs-you", summary: "B" }, "physics");
    expect(await t.h.needsYou()).toBe(2);
    await runOnce(t, { status: "failed", summary: "x" }, "physics");
    expect(await t.h.needsYou()).toBe(1);
  });

  it("an app-wide job's id is `<job>:-`, its target has no scope", async () => {
    const t = attended({ sync: job() });
    await runOnce(t, { status: "needs-you", summary: "Look", action: "implement" });
    expect(await t.items()).toMatchObject([{ origin: { kind: "job", id: "sync:-" }, target: { action: "implement", vars: {} } }]);
  });
});

describe("CachedJobLog", () => {
  it("reads jobs.jsonl once until the next append", async () => {
    const base = freshBase();
    const log = new CachedJobLog(base);
    const rec = (run: string, tokens: number): JobRunRecord => ({
      run,
      job: "sync",
      scope: null,
      trigger: "every",
      status: "ok",
      summary: "ok",
      tokens,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
    });
    await log.append(rec("a", 10));
    expect(await log.tokensToday("sync", new Date())).toBe(10);
    // Written behind its back: the cache doesn't see it…
    fs.appendFileSync(path.join(base, ".harness", "jobs.jsonl"), JSON.stringify(rec("b", 5)) + "\n");
    expect(await log.tokensToday("sync", new Date())).toBe(10);
    // …until its own next append, which reads the file afresh.
    await log.append(rec("c", 1));
    expect(await log.tokensToday("sync", new Date())).toBe(16);
    expect((await log.lastRuns()).get("sync:-")?.run).toBe("c");
  });
});

describe("single mode (Decision 12)", () => {
  it("caps: one task turn, the person's jobs cap; an engine held at one session runs one turn in all", () => {
    expect(singleCaps("claude", undefined)).toEqual({ tasks: 1, jobs: 1 });
    expect(singleCaps("codex", { tasks: 4, jobs: 3 })).toEqual({ tasks: 1, jobs: 3 });
    expect(singleCaps("opencode", { tasks: 4, jobs: 3 })).toEqual({ tasks: 1, jobs: 1 });
  });

  it("the task's runtime is the workspace's main slot, in HarnessRuntime's shape", async () => {
    const fake = fakeWorkspace();
    const sessions: unknown[] = [];
    const { runtime, slot } = await openSingleRuntime(fake.ws, { onSession: (s) => void sessions.push(s) });
    expect(Object.keys(runtime).sort()).toEqual(["close", "endSession", "history", "refreshInstructions", "send"]);
    expect(slot.key).toBe("main");
    expect(fake.opened).toEqual([expect.objectContaining({ key: "main" })]);
    expect(fake.opened[0].kind).toBeUndefined();
    expect(runtime.history).toBe(fake.ws.history);
    runtime.send("hello", () => {});
    expect(fake.turns.map((t) => [t.slot, t.message])).toEqual([["main", "hello"]]);
    // A rewrite refused because a turn runs throws, so the settings stay stale until the next gap.
    await expect(runtime.refreshInstructions()).rejects.toThrow(/AGENTS\.md waits/);
    fake.turns[0].end();
    expect(await runtime.refreshInstructions()).toBe(false);
    fake.setRefreshWrites(true);
    expect(await runtime.refreshInstructions()).toBe(true);
  });

  /** Today's TurnController stand-in: sends on the runtime's main slot. */
  function mainTurns(runtime: { send: (m: string, emit: (e: Event) => void) => { done: Promise<void>; cancel(): void } }) {
    let busy = false;
    return {
      async send(message: string, options: TurnOptions) {
        busy = true;
        try {
          await runtime.send(message, (e) => options.onEvent?.(e)).done;
        } finally {
          busy = false;
        }
      },
      isBusy: () => busy,
      cancel: () => {},
    };
  }

  it("a job run overlaps the task's turn: the gate counts them apart", async () => {
    const t = host();
    const { runtime } = await openSingleRuntime(t.fake.ws, {});
    const taskTurns = singleTurns(t.gate, mainTurns(runtime), () => {});
    const sent = taskTurns.send("write the essay", {});
    expect(t.gate.running("tasks")).toBe(1);
    await t.h.runManual("sync");
    await until(() => t.fake.turns.length === 2);
    expect(t.fake.turns.map((x) => x.slot)).toEqual(["main", expect.stringMatching(/^job:/)]);
    expect(t.gate.running("jobs")).toBe(1);
    // Only one task turn at a time, as today.
    await expect(taskTurns.send("again", {})).rejects.toThrow(/already running/);
    t.fake.turns[1].end([result({ status: "ok", summary: "Done" }), { type: "done", ok: true }]);
    t.fake.turns[0].end();
    await sent;
    await until(() => !t.h.running());
    expect(t.gate.running("tasks") + t.gate.running("jobs")).toBe(0);
  });

  it("an engine held at one session: the job waits for the task's turn, then the main process sleeps first", async () => {
    const gate = singleGate("opencode", undefined);
    const t = host({ gate });
    const { runtime, slot } = await openSingleRuntime(t.fake.ws, {});
    gate.setBeforeStart(singleBeforeStart("opencode", async () => slot));
    const taskTurns = singleTurns(gate, mainTurns(runtime), () => {});
    const sent = taskTurns.send("write", {});
    await until(() => t.fake.turns.length === 1);
    await t.h.runManual("sync");
    await new Promise((r) => setTimeout(r, 20));
    // Queued behind the task's turn: one engine process at a time.
    expect(t.fake.turns).toHaveLength(1);
    expect(gate.queued("jobs")).toHaveLength(1);
    t.fake.turns[0].end();
    await sent;
    await until(() => t.fake.turns.length === 2);
    expect(t.fake.sleeps).toEqual(["main"]);
    t.fake.turns[1].end();
    await until(() => !t.h.running());
    // An engine that runs two at once needs no hook.
    expect(singleBeforeStart("claude", async () => slot)).toBeNull();
  });

  it("the person's send lifts an out-of-quota pause (the plain view has no Resume)", async () => {
    const gate = singleGate("claude", undefined);
    gate.pause({ reason: "out-of-quota" });
    let sends = 0;
    const turns = singleTurns(gate, { send: async () => void sends++, isBusy: () => false, cancel: () => {} }, () => {});
    await turns.send("retry", {});
    expect(sends).toBe(1);
    expect(gate.paused()).toBeNull();
    // Another pause (a folder move) stays.
    gate.pause({ reason: "folder-move" });
    void turns.send("later", {});
    await new Promise((r) => setTimeout(r, 10));
    expect(sends).toBe(1);
    gate.dropAll();
  });
});
