import { describe, expect, it, vi } from "vitest";
import { getEngine } from "@humanharness/engines";
import type { SidekickAnswer } from "@humanharness/runtime";
import type { SidekickRecord } from "@humanharness/harness-sdk";
import type { SidekickEvent } from "@humanharness/workspace";
import { SidekickController, type SidekickDeps } from "../src/main/sidekick";
import { SidekickStore } from "../src/main/sidekick-store";
import { type UsageRecord, sidekickRecord } from "../src/main/usage-log";

const profile = { engine: "claude", tier: "light" as const, model: "haiku", effort: "low" as const, cap: 80 };
const json = (o: unknown) => JSON.stringify(o);
const SUGGEST = json({ verdict: "suggest", issues: [{ kind: "vague", text: "Say what better means." }], rewrite: "Make the intro shorter.", confidence: 0.8 });

export function harness(o: { record?: Partial<SidekickRecord> | null; answers?: (string | ((signal: AbortSignal) => Promise<SidekickAnswer>))[]; task?: { id: string; action?: string; scope: string; phase?: string } | null; usage?: UsageRecord[]; manifest?: SidekickDeps["manifest"]; waitMs?: number; events?: SidekickEvent[] } = {}) {
  // The `sidekick` collection by id; `record()` is the settings record.
  const records = new Map<string, Partial<SidekickRecord>>(o.record ? [[o.record.id ?? "settings", o.record]] : []);
  const writes: { op: string; record?: Partial<SidekickRecord>; key?: string }[] = [];
  const events: SidekickEvent[] = [...(o.events ?? [])];
  const asked: string[] = [];
  const opened: string[] = [];
  const closed: string[] = [];
  const logged: UsageRecord[] = [];
  const briefs: string[] = [];
  const states: unknown[] = [];
  let task = o.task === undefined ? { id: "t1", scope: "main" } : o.task;
  const answers = [...(o.answers ?? [])];
  const store = new SidekickStore({
    readAll: async () => [...records.values()] as SidekickRecord[],
    write: async (req) => {
      const r = req as { op: string; record?: Partial<SidekickRecord>; key?: string };
      writes.push(r);
      if (r.op === "delete") records.delete(r.key ?? "");
      else if (r.record) records.set(r.record.id ?? "", r.record);
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
    events: { read: async () => [...events], append: async (_b, e) => void events.push(e) },
    waitMs: () => o.waitMs ?? 5_000,
  };
  return { ctl: new SidekickController(deps), deps, asked, opened, closed, logged, briefs, states, setTask: (t: typeof task) => (task = t), events,
    writes,
    record: () => records.get("settings") ?? null,
    setRecord: (r: Partial<SidekickRecord> | null) => (r ? records.set("settings", r) : records.delete("settings")),
  };
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

describe("SidekickController.refresh (undo, profile switch)", () => {
  it("pushes the state the store now holds (an undo turned it on)", async () => {
    const h = harness();
    h.setRecord(on);
    await h.ctl.refresh();
    expect(h.states.at(-1)).toMatchObject({ status: "watching", settings: { on: true } });
  });

  it("an undo that turned it off closes the sessions and clears the card", async () => {
    const h = harness({ record: on });
    expect((await h.ctl.review({ text: "make it better" })).kind).toBe("card");
    h.setRecord(null);
    await h.ctl.refresh();
    expect(h.closed).toEqual(["s1"]);
    expect(h.states.at(-1)).toMatchObject({ status: "off", card: null });
  });

  it("same base: keeps the sessions and the card", async () => {
    const h = harness({ record: on });
    await h.ctl.review({ text: "make it better" });
    await h.ctl.refresh();
    expect(h.closed).toEqual([]);
    expect(h.states.at(-1)).toMatchObject({ status: "suggestion" });
  });

  it("a profile switch (new base) closes the old base's sessions, the loose one too, and drops the card", async () => {
    const h = harness({ record: on, task: null });
    await h.ctl.review({ text: "make it better" });
    h.deps.setup = async () => ({ engineId: "claude", base: "/other" });
    await h.ctl.refresh();
    expect(h.closed).toEqual(["s1"]);
    expect(h.states.at(-1)).toMatchObject({ status: "watching", card: null, spent: 0 });
    await h.ctl.review({ text: "make it better" });
    expect(h.opened).toEqual(["s1", "s2"]);
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

describe("SidekickController state() cost", () => {
  it("reads usage.jsonl once per base; a Sidekick turn reloads it", async () => {
    const h = harness({ record: on });
    let reads = 0;
    const usage = h.deps.usage;
    (h.deps as { usage: SidekickDeps["usage"] }).usage = (b) => (reads++, usage(b));
    // An empty log is not kept (the loader answers [] on read errors too), so reads go on until a line exists.
    await h.ctl.state();
    await h.ctl.state();
    expect(reads).toBe(2);
    reads = 0;
    expect((await h.ctl.review({ text: "make it better" })).kind).toBe("card");
    await h.ctl.state();
    reads = 0;
    // Now a line exists: kept.
    await h.ctl.state();
    await h.ctl.state();
    expect(reads).toBe(0);
    expect((await h.ctl.review({ text: "make it better" })).kind).toBe("card");
    reads = 0;
    const s = await h.ctl.state();
    // The logged turn dropped the copy: at most one fresh read.
    expect(reads).toBeLessThanOrEqual(1);
    expect(s.spent).toBe(680);
    expect(s.week).toBe(4680);
  });

  it("a failed read is not kept", async () => {
    const h = harness({ record: on });
    let fail = true;
    const usage = h.deps.usage;
    (h.deps as { usage: SidekickDeps["usage"] }).usage = (b) => (fail ? Promise.reject(new Error("busy")) : usage(b));
    expect((await h.ctl.state()).week).toBe(0);
    fail = false;
    const line = sidekickRecord({ engine: "claude", task: "t0", sidekick: "sidekick", moment: "pre", profile, ok: true, usage: { inputTokens: 5, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 } });
    h.logged.push(line);
    expect((await h.ctl.state()).week).toBe(10);
  });

  it("off: state() still shows the tier the Models row sets", async () => {
    const h = harness();
    (h.deps as { profile: SidekickDeps["profile"] }).profile = async () => ({ ...profile, tier: "standard" as const });
    expect(await h.ctl.state()).toMatchObject({ status: "off", tier: "standard" });
  });
});

describe("outcomes and learning signals (spec §6.1–6.3)", () => {
  it("resolve appends one event with the card's kind and confidence", async () => {
    const h = harness({ record: on });
    const r = await h.ctl.review({ text: "make it better" });
    if (r.kind !== "card") throw new Error("card expected");
    expect(r.card).toMatchObject({ moment: "pre", kind: "vague", speaker: { id: "sidekick", name: "Sidekick", mark: "spark" } });
    expect(r.card.why).toBeUndefined();
    await h.ctl.resolve(r.card.id, "used");
    expect(h.events).toEqual([expect.objectContaining({ sidekick: "sidekick", moment: "pre", kind: "vague", outcome: "used", confidence: 0.8, task: "t1", scope: "main" })]);
    expect((await h.ctl.state()).past).toEqual([{ id: r.card.id, kind: "vague", outcome: "used", speaker: "sidekick" }]);
    expect((await h.ctl.state()).used).toEqual({ used: 1, of: 1 });
  });

  it("the past list belongs to the task: another task starts empty", async () => {
    const h = harness({ record: on });
    const r = await h.ctl.review({ text: "make it better" });
    if (r.kind !== "card") throw new Error("card expected");
    await h.ctl.resolve(r.card.id, "dismissed");
    h.setTask({ id: "t2", scope: "main" });
    await h.ctl.betweenTasks();
    expect((await h.ctl.state()).past).toEqual([]);
  });

  it("a timeout is an event too", async () => {
    const h = harness({ record: on, answers: [slow], waitMs: 30 });
    await h.ctl.review({ text: "make it better" });
    expect(h.events.map((e) => [e.outcome, e.kind, e.moment])).toEqual([["timeout", "vague", "pre"]]);
  });

  it("a kind ignored 9 times in 10 needs 0.8: a 0.7 suggestion is sent with nothing shown", async () => {
    const ignored = Array.from({ length: 10 }, (_, i) => ({ at: "2026-10-27T09:00:00Z", sidekick: "sidekick", moment: "pre" as const, kind: "vague", outcome: i === 0 ? ("used" as const) : ("dismissed" as const) }));
    const h = harness({ record: on, events: ignored, answers: [json({ verdict: "suggest", issues: [{ kind: "vague", text: "x" }], rewrite: "y", confidence: 0.7 })] });
    expect(await h.ctl.review({ text: "make it better" })).toEqual({ kind: "send" });
  });

  it("why: with 3+ past cards of the kind", async () => {
    const past = Array.from({ length: 3 }, () => ({ at: "2026-10-27T09:00:00Z", sidekick: "sidekick", moment: "pre" as const, kind: "vague", outcome: "used" as const }));
    const r = await harness({ record: on, events: past }).ctl.review({ text: "make it better" });
    expect(r.kind === "card" && r.card.why).toEqual({ used: 3, of: 3 });
  });

  it("used counts the last 7 days only", async () => {
    const old = { at: "2020-01-01T00:00:00Z", sidekick: "sidekick", moment: "pre" as const, kind: "vague", outcome: "used" as const };
    const fresh = { ...old, at: new Date().toISOString(), outcome: "dismissed" as const };
    expect((await harness({ record: on, events: [old, fresh] }).ctl.state()).used).toEqual({ used: 0, of: 1 });
  });

  it("mute: the kind is muted for that sidekick, remembered as the person's, and no longer flagged", async () => {
    const h = harness({ record: on });
    const r = await h.ctl.review({ text: "make it better" });
    if (r.kind !== "card") throw new Error("card expected");
    await h.ctl.mute(r.card.id);
    expect(h.record()).toMatchObject({ muted: { sidekick: ["vague"] } });
    expect(h.writes).toContainEqual(expect.objectContaining({ op: "put", record: expect.objectContaining({ type: "learned", kind: "vague", source: "person", level: "you" }) }));
    expect(h.events.at(-1)).toMatchObject({ outcome: "muted", kind: "vague" });
    expect((await h.ctl.state()).card).toBeNull();
    expect(await h.ctl.review({ text: "make it better" })).toEqual({ kind: "send" });
    await h.ctl.unmute("sidekick", "vague");
    expect(h.record()).not.toHaveProperty("muted.sidekick");
  });

  it("a muted kind the model raises on a forced review shows no card", async () => {
    const h = harness({ record: { ...on, muted: { sidekick: ["vague"] } } });
    expect(await h.ctl.review({ text: "make it better", force: true })).toEqual({ kind: "send" });
  });

  it("two quick outcomes both land, written one at a time", async () => {
    const h = harness({ record: on, answers: [SUGGEST, slow] });
    let busy = 0;
    let overlap = false;
    const landed: string[] = [];
    h.deps.events.append = async (_b, e) => {
      if (busy++ > 0) overlap = true;
      await new Promise((r) => setTimeout(r, 30));
      landed.push(e.outcome);
      busy--;
    };
    const r = await h.ctl.review({ text: "make it better" });
    if (r.kind !== "card") throw new Error("card expected");
    h.deps.waitMs = () => 1;
    // The card's outcome is still being written when the next review times out.
    await Promise.all([h.ctl.resolve(r.card.id, "dismissed"), h.ctl.review({ text: "make it better" })]);
    expect(landed).toEqual(["dismissed", "timeout"]);
    expect(overlap).toBe(false);
  });

  it("D0: with Sidekick off nothing appends an event", async () => {
    const h = harness({ record: on });
    const r = await h.ctl.review({ text: "make it better" });
    if (r.kind !== "card") throw new Error("card expected");
    await h.ctl.set({ on: false });
    await h.ctl.resolve(r.card.id, "used");
    await h.ctl.mute(r.card.id);
    await h.ctl.review({ text: "make it better", force: true });
    expect(h.events).toEqual([]);
    expect(h.writes.filter((w) => w.record?.type === "learned")).toEqual([]);
  });
});

describe("after the reply (spec §4.2)", () => {
  const end = (o: Partial<Parameters<SidekickController["afterReply"]>[0]> = {}) => ({ task: { id: "t1", scope: "main" }, kind: "run" as const, ok: true, prompt: "Outline chapter 2", reply: "Here it is.", fromBlock: false, ...o });
  const GAP = json({ gap: { title: "Sources", text: "No source for claim 2." }, next: "Add a source for claim 2" });

  it("D0: off → nothing: no session, no turn, no event, no usage line", async () => {
    const h = harness();
    await h.ctl.afterReply(end());
    h.ctl.turnStarting();
    expect(h.asked).toEqual([]);
    expect(h.opened).toEqual([]);
    expect(h.events).toEqual([]);
    expect(h.logged).toEqual([]);
    expect((await h.ctl.state()).cards).toEqual([]);
  });

  it("a gap becomes an after card, with Put in composer's text", async () => {
    const h = harness({ record: on, answers: [GAP] });
    await h.ctl.afterReply(end());
    expect(h.asked[0]).toContain("Sidekick: after the reply");
    const s = await h.ctl.state();
    expect(s.cards).toEqual([expect.objectContaining({ moment: "after", kind: "gap", speaker: expect.objectContaining({ id: "sidekick" }), after: { gap: { title: "Sources", text: "No source for claim 2." }, next: "Add a source for claim 2" } })]);
    expect(s.card).toBeNull();
    expect(s.status).toBe("suggestion");
    expect(h.logged.at(-1)).toMatchObject({ moment: "after", task: "t1" });
    expect(h.states.at(-1)).toMatchObject({ cards: [expect.objectContaining({ kind: "gap" })] });
  });

  it("the turn carries the task's earlier prompts", async () => {
    const h = harness({ record: on, answers: ["{}", "{}"] });
    await h.ctl.afterReply(end({ prompt: "First ask" }));
    await h.ctl.afterReply(end({ prompt: "Second ask" }));
    expect(h.asked[1]).toContain("Earlier prompts (first lines):\n- First ask\n");
  });

  it("skipped: checkpoint or close turns, failed turns, block answers, the setting off, nothing to show", async () => {
    for (const e of [end({ kind: "checkpoint" }), end({ kind: "close" }), end({ ok: false }), end({ fromBlock: true })]) {
      const h = harness({ record: on });
      await h.ctl.afterReply(e);
      expect(h.asked).toEqual([]);
    }
    const off = harness({ record: { ...on, afterReply: false } });
    await off.ctl.afterReply(end());
    expect(off.asked).toEqual([]);
    const empty = harness({ record: on, answers: ["{}"] });
    await empty.ctl.afterReply(end());
    expect((await empty.ctl.state()).cards).toEqual([]);
  });

  it("past the cap → no turn", async () => {
    const line = sidekickRecord({ engine: "claude", task: "t1", sidekick: "sidekick", moment: "pre", profile, ok: true, usage: { inputTokens: 25_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } });
    const h = harness({ record: on, usage: [line] });
    await h.ctl.afterReply(end());
    expect(h.asked).toEqual([]);
  });

  it("a muted kind shows no card", async () => {
    const h = harness({ record: { ...on, muted: { sidekick: ["gap"] } }, answers: [GAP] });
    await h.ctl.afterReply(end());
    expect((await h.ctl.state()).cards).toEqual([]);
  });

  it("a new send cancels a running after-reply turn", async () => {
    const h = harness({ record: on, answers: [slow] });
    const running = h.ctl.afterReply(end());
    await vi.waitFor(() => expect(h.asked).toHaveLength(1));
    h.ctl.turnStarting();
    await running;
    expect((await h.ctl.state()).cards).toEqual([]);
  });

  it("resolve takes an after card: one event with moment after, a past line", async () => {
    const h = harness({ record: on, answers: [GAP] });
    await h.ctl.afterReply(end());
    const card = (await h.ctl.state()).cards[0];
    await h.ctl.resolve(card.id, "used");
    expect(h.events).toEqual([expect.objectContaining({ sidekick: "sidekick", moment: "after", kind: "gap", outcome: "used", task: "t1" })]);
    const s = await h.ctl.state();
    expect(s.cards).toEqual([]);
    expect(s.past).toEqual([{ id: card.id, kind: "gap", outcome: "used", speaker: "sidekick" }]);
  });

  it("an older task's card resolving does not wipe the open task's past list", async () => {
    const h = harness({ record: on, answers: [SUGGEST, GAP] });
    const r = await h.ctl.review({ text: "make it better" });
    if (r.kind !== "card") throw new Error("card expected");
    h.setTask({ id: "t2", scope: "main" });
    await h.ctl.betweenTasks();
    await h.ctl.afterReply(end({ task: { id: "t2", scope: "main" } }));
    const after = (await h.ctl.state()).cards[0];
    await h.ctl.resolve(after.id, "dismissed");
    await h.ctl.resolve(r.card.id, "used");
    expect((await h.ctl.state()).past).toEqual([{ id: after.id, kind: "gap", outcome: "dismissed", speaker: "sidekick" }]);
    expect(h.events.map((e) => [e.task, e.outcome])).toEqual([["t2", "dismissed"], ["t1", "used"]]);
  });

  it("another task drops the cards; turning off drops them too", async () => {
    const h = harness({ record: on, answers: [GAP, GAP] });
    await h.ctl.afterReply(end());
    h.setTask({ id: "t2", scope: "main" });
    await h.ctl.betweenTasks();
    expect((await h.ctl.state()).cards).toEqual([]);
    await h.ctl.afterReply(end({ task: { id: "t2", scope: "main" } }));
    expect((await h.ctl.state()).cards).toHaveLength(1);
    await h.ctl.set({ on: false });
    expect((await h.ctl.state()).cards).toEqual([]);
  });
});
