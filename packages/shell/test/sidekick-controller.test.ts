import { describe, expect, it, vi } from "vitest";
import { getEngine } from "@humanharness/engines";
import type { SidekickAnswer } from "@humanharness/runtime";
import type { SidekickRecord } from "@humanharness/harness-sdk";
import { SidekickController, type SidekickDeps } from "../src/main/sidekick";
import { SidekickStore } from "../src/main/sidekick-store";
import { type UsageRecord, sidekickRecord } from "../src/main/usage-log";

const profile = { engine: "claude", tier: "light" as const, model: "haiku", effort: "low" as const, cap: 80 };
const json = (o: unknown) => JSON.stringify(o);
const SUGGEST = json({ verdict: "suggest", issues: [{ kind: "vague", text: "Say what better means." }], rewrite: "Make the intro shorter.", confidence: 0.8 });

export function harness(o: { record?: Partial<SidekickRecord> | null; answers?: (string | ((signal: AbortSignal) => Promise<SidekickAnswer>))[]; task?: { id: string; action?: string; scope: string; phase?: string } | null; usage?: UsageRecord[]; manifest?: SidekickDeps["manifest"]; waitMs?: number } = {}) {
  let record: Partial<SidekickRecord> | null = o.record ?? null;
  const asked: string[] = [];
  const opened: string[] = [];
  const closed: string[] = [];
  const logged: UsageRecord[] = [];
  const briefs: string[] = [];
  const states: unknown[] = [];
  let task = o.task === undefined ? { id: "t1", scope: "main" } : o.task;
  const answers = [...(o.answers ?? [])];
  const store = new SidekickStore({
    read: async () => record as SidekickRecord | null,
    write: async (req) => {
      const r = req as { op: string; record?: Partial<SidekickRecord> };
      record = r.op === "delete" ? null : (r.record ?? null);
    },
    ...(o.manifest ? { manifest: o.manifest } : {}),
  });
  const deps: SidekickDeps = {
    ...(o.manifest ? { manifest: o.manifest } : {}),
    harness: { name: "Essay Coach" },
    phases: () => [],
    store,
    setup: async () => ({ engineId: "claude", base: "/base" }),
    hasNotice: async () => true,
    engine: getEngine,
    command: async () => ({ command: ["claude"], env: {} }),
    profile: async () => profile,
    workDir: () => "/ud/sidekick/k/sidekick",
    writeBrief: async (_f, text) => void briefs.push(text),
    open: (s) => {
      const id = `s${opened.length + 1}`;
      opened.push(id);
      return {
        profile: s.profile,
        ask: async (prompt, signal) => {
          asked.push(prompt);
          const next = answers.shift() ?? SUGGEST;
          if (typeof next === "function") return next(signal);
          return { ok: true, text: next, usage: { inputTokens: 300, outputTokens: 40, cacheReadTokens: 2000, cacheWriteTokens: 0 } };
        },
        close: async () => void closed.push(id),
      };
    },
    task: async () => task,
    context: async () => ({ notes: ["Chapter 2 outline"], data: ["sources"] }),
    uiLanguage: async () => "English",
    usage: async () => [...(o.usage ?? []), ...logged],
    log: async (_b, r) => void logged.push(r),
    changed: (s) => void states.push(s),
    waitMs: () => o.waitMs ?? 5_000,
  };
  return { ctl: new SidekickController(deps), deps, asked, opened, closed, logged, briefs, states, setTask: (t: typeof task) => (task = t), record: () => record };
}

describe("SidekickController state and settings", () => {
  it("off by default without a manifest block", async () => {
    const h = harness();
    const s = await h.ctl.state();
    expect(s).toMatchObject({ info: { id: "sidekick", name: "Sidekick" }, status: "off", settings: { on: false }, cap: 20_000, spent: 0, card: null, tier: "light" });
  });

  it("on by default when the manifest says so", async () => {
    expect((await harness({ manifest: { default: "on" } }).ctl.state()).status).toBe("watching");
  });

  it("set stores the change and pushes the new state", async () => {
    const h = harness();
    expect(await h.ctl.set({ on: true, cap: "none" })).toMatchObject({ ok: true });
    expect(h.record()).toMatchObject({ on: true, cap: "none" });
    expect(h.states.at(-1)).toMatchObject({ status: "watching", cap: null });
  });

  it("spent is the open task's Sidekick tokens from the log; past the cap reads capped", async () => {
    const line = sidekickRecord({ engine: "claude", task: "t1", sidekick: "sidekick", moment: "pre", profile, ok: true, usage: { inputTokens: 19_000, outputTokens: 1_500, cacheReadTokens: 0, cacheWriteTokens: 0 } });
    const h = harness({ record: { id: "settings", type: "settings", on: true }, usage: [line] });
    expect(await h.ctl.state()).toMatchObject({ spent: 20_500, status: "capped" });
    h.setTask({ id: "t2", scope: "main" });
    expect(await h.ctl.state()).toMatchObject({ spent: 0, status: "watching" });
  });

  it("the week's tokens", async () => {
    const line = sidekickRecord({ engine: "claude", task: "t0", sidekick: "sidekick", moment: "pre", profile, ok: true, usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 } });
    expect((await harness({ usage: [line] }).ctl.state()).week).toBe(110);
  });
});

const on = { id: "settings", type: "settings" as const, on: true };
const slow = (signal: AbortSignal) => new Promise<SidekickAnswer>((resolve) => signal.addEventListener("abort", () => resolve({ ok: false, text: "", error: { code: "cancelled" } })));

describe("SidekickController.review (spec §4.1)", () => {
  it("D0: off → send, no session, nothing logged", async () => {
    const h = harness();
    expect(await h.ctl.review({ text: "make it better" })).toEqual({ kind: "send" });
    expect(h.opened).toEqual([]);
    expect(h.logged).toEqual([]);
    expect(h.briefs).toEqual([]);
  });

  it("pre-send off, or the action off → send", async () => {
    expect(await harness({ record: { ...on, preSend: false } }).ctl.review({ text: "make it better" })).toEqual({ kind: "send" });
    const h = harness({ record: on, task: { id: "t1", action: "export", scope: "main" }, manifest: { default: "off", actions: { export: "off" } } });
    expect(await h.ctl.review({ text: "make it better", force: true })).toEqual({ kind: "send" });
    expect(h.opened).toEqual([]);
  });

  it("auto with no flags → send without the model", async () => {
    const h = harness({ record: on });
    expect(await h.ctl.review({ text: "Rewrite the second paragraph of chapter 2 so it cites Smith 2019." })).toEqual({ kind: "send" });
    expect(h.asked).toEqual([]);
  });

  it("a send that carries attachments is not flagged missing-context", async () => {
    const h = harness({ record: on });
    expect(await h.ctl.review({ text: "Summarize the main argument of the document in three bullet points for my notes", attached: true })).toEqual({ kind: "send" });
    expect(h.asked).toEqual([]);
    const bare = harness({ record: on });
    expect((await bare.ctl.review({ text: "Summarize the main argument of the document in three bullet points for my notes" })).kind).toBe("card");
  });

  it("a flag → the model → a card; the prompt carries the flags and the context", async () => {
    const h = harness({ record: on });
    const r = await h.ctl.review({ text: "make it better" });
    expect(r.kind).toBe("card");
    if (r.kind !== "card") return;
    expect(r.card).toMatchObject({ prompt: "make it better", rewrite: "Make the intro shorter.", flags: [{ kind: "vague", match: "better" }] });
    expect(h.asked[0]).toContain('- vague: "better"');
    expect(h.asked[0]).toContain("- Chapter 2 outline");
    expect(h.asked[0]).toContain("UI language: English");
    expect((await h.ctl.state()).status).toBe("suggestion");
  });

  it("the open phase drives the off-phase check", async () => {
    const h = harness({ record: on, task: { id: "t1", action: "draft", scope: "main", phase: "outline" } });
    (h.deps as { phases: SidekickDeps["phases"] }).phases = () => [{ id: "outline", label: "Outline" }, { id: "polish", label: "Polish wording" }];
    const r = await h.ctl.review({ text: "Polish wording of chapter 2, paragraph 3, keep Smith 2019 cited." });
    expect(r.kind).toBe("card");
    expect(h.asked[0]).toContain("Open phase: Outline");
    expect(h.asked[0]).toContain('- off-phase: "Polish"');
  });

  it("Review (force) and `always` ask the model without flags", async () => {
    const forced = harness({ record: on });
    expect((await forced.ctl.review({ text: "Rewrite paragraph 2 of chapter 2 to cite Smith 2019.", force: true })).kind).toBe("card");
    const always = harness({ record: on, task: { id: "t1", action: "draft", scope: "main" }, manifest: { default: "off", actions: { draft: "always" } } });
    expect((await always.ctl.review({ text: "Rewrite paragraph 2 of chapter 2 to cite Smith 2019." })).kind).toBe("card");
  });

  it("a send verdict or low confidence → send", async () => {
    expect(await harness({ record: on, answers: [json({ verdict: "send", issues: [], confidence: 0.9 })] }).ctl.review({ text: "make it better" })).toEqual({ kind: "send" });
    expect(await harness({ record: on, answers: [json({ verdict: "suggest", issues: [{ kind: "vague", text: "x" }], rewrite: "y", confidence: 0.3 })] }).ctl.review({ text: "make it better" })).toEqual({ kind: "send" });
  });

  it("a rewrite that echoes the prompt is dropped", async () => {
    const h = harness({ record: on, answers: [json({ verdict: "suggest", issues: [], rewrite: "make it better", confidence: 0.9 })] });
    expect(await h.ctl.review({ text: "make it better" })).toEqual({ kind: "send" });
  });

  it("invalid JSON or an engine error → error, with the quiet notice", async () => {
    const h = harness({ record: on, answers: ["not json"] });
    expect(await h.ctl.review({ text: "make it better" })).toEqual({ kind: "error" });
    expect((await h.ctl.state()).notice).toBe("failed");
    const e = harness({ record: on, answers: [async () => ({ ok: false, text: "", error: { code: "agent-crashed" as const } })] });
    expect(await e.ctl.review({ text: "make it better" })).toEqual({ kind: "error" });
    expect((await e.ctl.state()).notice).toBe("failed");
  });

  it("the wait runs out → timeout; the late answer is dropped", async () => {
    const h = harness({ record: on, answers: [slow], waitMs: 30 });
    expect(await h.ctl.review({ text: "make it better" })).toEqual({ kind: "timeout" });
    expect(await h.ctl.state()).toMatchObject({ card: null, notice: "timeout", status: "watching" });
  });

  it("after a timeout the next review reuses the session, and the notice clears", async () => {
    const h = harness({ record: on, answers: [slow], waitMs: 30 });
    expect(await h.ctl.review({ text: "make it better" })).toEqual({ kind: "timeout" });
    expect((await h.ctl.review({ text: "make it better" })).kind).toBe("card");
    expect(h.opened).toEqual(["s1"]);
    expect((await h.ctl.state()).notice).toBeUndefined();
  });

  it("cancel (⌘⏎) → cancelled, no card", async () => {
    const h = harness({ record: on, answers: [slow] });
    const p = h.ctl.review({ text: "make it better" });
    await vi.waitFor(() => expect(h.asked.length).toBe(1));
    h.ctl.cancel();
    expect(await p).toEqual({ kind: "cancelled" });
    expect(await h.ctl.state()).toMatchObject({ card: null, status: "watching" });
  });

  it("past the cap → send without the model", async () => {
    const line = sidekickRecord({ engine: "claude", task: "t1", sidekick: "sidekick", moment: "pre", profile, ok: true, usage: { inputTokens: 20_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } });
    const h = harness({ record: on, usage: [line] });
    expect(await h.ctl.review({ text: "make it better" })).toEqual({ kind: "send" });
    expect(h.asked).toEqual([]);
  });

  it("logs one tagged usage line per model turn, with the engine's limits", async () => {
    const limits = [{ kind: "five_hour", utilization: 0.4, resetsAt: "2030-01-01T00:00:00.000Z" }];
    const h = harness({ record: on, task: { id: "t1", action: "draft", scope: "main" }, answers: [async () => ({ ok: true, text: SUGGEST, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }, limits })] });
    await h.ctl.review({ text: "make it better" });
    expect(h.logged).toHaveLength(1);
    expect(h.logged[0]).toMatchObject({ phase: "sidekick", process: "sidekick", moment: "pre", sidekick: "sidekick", task: "t1", action: "draft", tier: "light", limits });
  });

  it("one session per task: reused, a new task gets a new one, betweenTasks closes the old", async () => {
    const h = harness({ record: on });
    await h.ctl.review({ text: "make it better" });
    await h.ctl.review({ text: "make it better" });
    expect(h.opened).toEqual(["s1"]);
    expect(h.briefs).toHaveLength(1);
    expect(h.briefs[0]).toContain("Essay Coach");
    h.setTask({ id: "t2", scope: "main" });
    await h.ctl.betweenTasks();
    expect(h.closed).toEqual(["s1"]);
    await h.ctl.review({ text: "make it better" });
    expect(h.opened).toEqual(["s1", "s2"]);
  });

  it("betweenTasks keeps the open task's session and closes the rest", async () => {
    const h = harness({ record: on });
    await h.ctl.review({ text: "make it better" });
    await h.ctl.betweenTasks();
    expect(h.closed).toEqual([]);
    h.setTask(null);
    await h.ctl.betweenTasks();
    expect(h.closed).toEqual(["s1"]);
  });

  it("a review before the task exists opens a session the task adopts", async () => {
    const h = harness({ record: on, task: null });
    await h.ctl.review({ text: "make it better" });
    h.setTask({ id: "t9", scope: "main" });
    await h.ctl.betweenTasks();
    await h.ctl.review({ text: "make it better" });
    expect(h.opened).toEqual(["s1"]);
    expect(h.closed).toEqual([]);
  });

  it("turning off closes the sessions", async () => {
    const h = harness({ record: on });
    await h.ctl.review({ text: "make it better" });
    await h.ctl.set({ on: false });
    expect(h.closed).toEqual(["s1"]);
  });

  it("turning off aborts the running review, clears the card and the notice, and closes sessions", async () => {
    const h = harness({ record: on, answers: [SUGGEST, slow] });
    expect((await h.ctl.review({ text: "make it better" })).kind).toBe("card");
    const p = h.ctl.review({ text: "make it better" });
    await vi.waitFor(() => expect(h.asked.length).toBe(2));
    await h.ctl.set({ on: false });
    expect(await p).toEqual({ kind: "cancelled" });
    expect(h.closed).toEqual(["s1"]);
    expect(await h.ctl.state()).toMatchObject({ status: "off", card: null });
    const failed = harness({ record: on, answers: ["not json"] });
    await failed.ctl.review({ text: "make it better" });
    expect((await failed.ctl.state()).notice).toBe("failed");
    await failed.ctl.set({ on: false });
    expect((await failed.ctl.state()).notice).toBeUndefined();
  });

  it("an unknown engine id never makes state() reject", async () => {
    const h = harness({ record: on });
    (h.deps as { engine: SidekickDeps["engine"] }).engine = () => {
      throw new Error("unknown engine");
    };
    expect(await h.ctl.state()).toMatchObject({ status: "watching", tier: "light" });
    expect(await h.ctl.review({ text: "make it better" })).toEqual({ kind: "error" });
  });
});

describe("SidekickController.review races", () => {
  it("a review that replaces one still opening its session shares one session", async () => {
    const h = harness({ record: on });
    const first = h.ctl.review({ text: "make it better" });
    const second = h.ctl.review({ text: "make it better" });
    expect(await first).toEqual({ kind: "cancelled" });
    expect((await second).kind).toBe("card");
    expect(h.opened).toEqual(["s1"]);
  });

  const gate = <T>() => {
    let open!: (v: T) => void;
    const p = new Promise<T>((r) => (open = r));
    return { p, open };
  };

  it("cancel while the inputs load (reading usage) → cancelled, the model is never asked", async () => {
    const h = harness({ record: on });
    const g = gate<UsageRecord[]>();
    let reading = false;
    (h.deps as { usage: SidekickDeps["usage"] }).usage = () => ((reading = true), g.p);
    const p = h.ctl.review({ text: "make it better" });
    await vi.waitFor(() => expect(reading).toBe(true));
    h.ctl.cancel();
    g.open([]);
    expect(await p).toEqual({ kind: "cancelled" });
    expect(h.asked).toEqual([]);
    expect(h.opened).toEqual([]);
    expect(h.logged).toEqual([]);
  });

  it("close while the inputs load → no session opened", async () => {
    const h = harness({ record: on });
    const g = gate<UsageRecord[]>();
    let reading = false;
    (h.deps as { usage: SidekickDeps["usage"] }).usage = () => ((reading = true), g.p);
    const p = h.ctl.review({ text: "make it better" });
    await vi.waitFor(() => expect(reading).toBe(true));
    await h.ctl.close();
    g.open([]);
    expect((await p).kind).toBe("cancelled");
    expect(h.opened).toEqual([]);
    expect(h.asked).toEqual([]);
  });

  it("turned off while the session's CLI is found → no brief written, no session kept", async () => {
    const h = harness({ record: on });
    const g = gate<{ command: string[]; env: Record<string, string> } | null>();
    let finding = false;
    (h.deps as { command: SidekickDeps["command"] }).command = () => ((finding = true), g.p);
    const p = h.ctl.review({ text: "make it better" });
    await vi.waitFor(() => expect(finding).toBe(true));
    await h.ctl.set({ on: false });
    g.open({ command: ["claude"], env: {} });
    expect(await p).toEqual({ kind: "cancelled" });
    expect(h.briefs).toEqual([]);
    expect(h.opened).toEqual([]);
  });
});

describe("SidekickController loose sessions and stale cards", () => {
  it("a session made with no task open closes after the task it was made for ends", async () => {
    const h = harness({ record: on, task: null });
    await h.ctl.review({ text: "make it better" });
    // task-manager: betweenTasks before the task is current, then again after it ends.
    await h.ctl.betweenTasks();
    expect(h.closed).toEqual([]);
    h.setTask({ id: "t5", scope: "main" });
    h.setTask(null);
    await h.ctl.betweenTasks();
    expect(h.closed).toEqual(["s1"]);
    h.setTask({ id: "t6", scope: "main" });
    await h.ctl.review({ text: "make it better" });
    expect(h.opened).toEqual(["s1", "s2"]);
  });

  it("an early send clears a stale card in the renderer", async () => {
    const h = harness({ record: on });
    expect((await h.ctl.review({ text: "make it better" })).kind).toBe("card");
    expect(await h.ctl.review({ text: "Rewrite the second paragraph of chapter 2 so it cites Smith 2019." })).toEqual({ kind: "send" });
    expect(h.states.at(-1)).toMatchObject({ card: null, status: "watching" });
  });
});
