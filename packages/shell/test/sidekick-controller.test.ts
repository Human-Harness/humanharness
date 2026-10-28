import { describe, expect, it, vi } from "vitest";
import { getEngine } from "@humanharness/engines";
import type { SidekickAnswer } from "@humanharness/runtime";
import type { SidekickRecord } from "@humanharness/harness-sdk";
import type { SidekickEvent } from "@humanharness/workspace";
import { createHash } from "node:crypto";
import { SidekickController, type SidekickDeps } from "../src/main/sidekick";
import { joinImportFiles, readImportFiles } from "../src/main/sidekick-import";
import { type SidekickInput, SidekickStore } from "../src/main/sidekick-store";
import type { DailyInput } from "../src/main/sidekick-turns";
import { type UsageRecord, sidekickRecord } from "../src/main/usage-log";

const profile = { engine: "claude", tier: "light" as const, model: "haiku", effort: "low" as const, cap: 80 };
const json = (o: unknown) => JSON.stringify(o);
const SUGGEST = json({ verdict: "suggest", issues: [{ kind: "vague", text: "Say what better means." }], rewrite: "Make the intro shorter.", confidence: 0.8 });

export function harness(o: { record?: Partial<SidekickRecord> | null; answers?: (string | ((signal: AbortSignal) => Promise<SidekickAnswer>))[]; task?: { id: string; action?: string; scope: string; phase?: string } | null; usage?: UsageRecord[]; manifest?: SidekickDeps["manifest"]; waitMs?: number; events?: SidekickEvent[]; phases?: { id: string; label: string; brief?: string }[]; phaseBriefs?: Record<string, string | Error>; extra?: Partial<SidekickRecord>[]; learnMs?: number; routeMs?: number; spent?: number; dailyInput?: DailyInput; dailyMs?: number; placeMs?: number; files?: Record<string, string>; picked?: string[]; importMs?: number; noticed?: boolean } = {}) {
  // The `sidekick` collection by id; `record()` is the settings record.
  const records = new Map<string, Partial<SidekickRecord>>([...(o.record ? [o.record] : []), ...(o.extra ?? [])].map((r) => [r.id ?? "settings", r]));
  const writes: { op: string; record?: Partial<SidekickRecord>; key?: string }[] = [];
  // Writes as the app (learning, spec §6.4), applied to the same records.
  const appWrites: { op: string; record?: Partial<SidekickRecord>; key?: string }[] = [];
  // Each writeApp call (one commit): its base and how many requests it carried.
  const appCalls: { base: string; n: number }[] = [];
  const folders: string[] = [];
  const events: SidekickEvent[] = [...(o.events ?? [])];
  const asked: string[] = [];
  // Each phase-brief read: `action/phase`.
  const briefReads: string[] = [];
  const opened: string[] = [];
  // Each opened session's folder name: the sidekick's id, or a one-off turn's (`learn`, `route`).
  const sessions: string[] = [];
  const closed: string[] = [];
  const logged: UsageRecord[] = [];
  const briefs: string[] = [];
  const states: unknown[] = [];
  const decisions: unknown[] = [];
  // The days dailyInput was asked for.
  const days: string[] = [];
  // Each imported file read (its resolved path).
  const imported: string[] = [];
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
    phases: () => o.phases ?? [],
    // A phase's brief file, by phase id: its text, a read failure, or none.
    phaseBrief: async (action, phase) => {
      briefReads.push(`${action}/${phase}`);
      const t = o.phaseBriefs?.[phase];
      if (t instanceof Error) throw t;
      return t ?? null;
    },
    store,
    setup: async () => ({ engineId: "claude", base: "/base" }),
    hasNotice: async () => o.noticed ?? true,
    engine: getEngine,
    command: async () => ({ command: ["claude"], env: {} }),
    // A sidekick's own tier (or the routing turn's light one) when given.
    profile: async (_e, tier) => (tier ? { ...profile, tier } : profile),
    workDir: (_b, id = "sidekick") => (folders.push(id), `/ud/sidekick/k/${id}`),
    writeBrief: async (_f, text) => void briefs.push(text),
    open: (s) => {
      const id = `s${opened.length + 1}`;
      opened.push(id);
      sessions.push(s.folder.split("/").at(-1) ?? "");
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
    usage: async () => [
      ...(o.usage ?? []),
      ...(o.spent ? [sidekickRecord({ engine: "claude", task: "t1", sidekick: "rulo", moment: "after", profile, ok: true, usage: { inputTokens: o.spent, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } })] : []),
      ...logged,
    ],
    log: async (_b, r) => void logged.push(r),
    changed: (s) => void states.push(s),
    events: { read: async () => [...events], append: async (_b, e) => void events.push(e) },
    waitMs: () => o.waitMs ?? 5_000,
    saveDecision: async (d) => void decisions.push(d),
    writeApp: async (base, reqs) => {
      appCalls.push({ base, n: reqs.length });
      for (const req of reqs) {
        const r = req as { op: string; record?: Partial<SidekickRecord>; key?: string };
        appWrites.push(r);
        if (r.op === "delete") records.delete(r.key ?? "");
        else if (r.record) records.set(r.record.id ?? "", r.record);
      }
    },
    ...(o.learnMs !== undefined ? { learnMs: o.learnMs } : {}),
    ...(o.routeMs !== undefined ? { routeMs: o.routeMs } : {}),
    dailyInput: async (_b, day) => (days.push(day), o.dailyInput ?? { day, notes: [], tokens: { tasks: 0, sidekick: 0 }, open: [] }),
    ...(o.dailyMs !== undefined ? { dailyMs: o.dailyMs } : {}),
    ...(o.placeMs !== undefined ? { placeMs: o.placeMs } : {}),
    // In-memory files under a home folder that doesn't exist: the real home's folders are never looked at.
    importFiles: (paths, signal) =>
      readImportFiles(
        paths,
        { home: "/hh-test-home", env: {} },
        {
          read: async (p) => {
            imported.push(p);
            if (!Object.hasOwn(o.files ?? {}, p)) throw new Error("ENOENT");
            return o.files![p];
          },
          stat: async (p) => {
            if (!Object.hasOwn(o.files ?? {}, p)) throw new Error("ENOENT");
            return { id: p, size: Buffer.byteLength(o.files![p]), file: true };
          },
        },
        signal,
      ),
    pickImportFiles: async () => o.picked ?? [],
    ...(o.importMs !== undefined ? { importMs: o.importMs } : {}),
  };
  return { ctl: new SidekickController(deps), deps, asked, opened, sessions, closed, logged, briefs, states, setTask: (t: typeof task) => (task = t), events,
    writes,
    appWrites,
    briefReads,
    appCalls,
    folders,
    decisions,
    days,
    imported,
    records: () => [...records.values()],
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
  const end = (o: Partial<Parameters<SidekickController["afterReply"]>[0]> = {}) => ({ task: { id: "t1", scope: "main" }, kind: "run" as const, ok: true, prompt: "Outline chapter 2", reply: "Here it is.", fromBlock: false, modeSwitch: false, ...o });
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

  it("earlier prompts hold only the person's typed run prompts: no checkpoint, close, block answer or mode switch", async () => {
    const h = harness({ record: on, answers: ["{}", "{}"] });
    await h.ctl.afterReply(end({ prompt: "Typed first" }));
    await h.ctl.afterReply(end({ kind: "checkpoint", prompt: "CHECKPOINT internal" }));
    await h.ctl.afterReply(end({ kind: "close", prompt: "CLOSE internal" }));
    await h.ctl.afterReply(end({ fromBlock: true, prompt: "BLOCK answer" }));
    await h.ctl.afterReply(end({ modeSwitch: true, prompt: "Switched to Socratic" }));
    await h.ctl.afterReply(end({ prompt: "Typed second" }));
    expect(h.asked).toHaveLength(2);
    expect(h.asked[1]).toContain("Earlier prompts (first lines):\n- Typed first\nUI language");
  });

  it("a mode switch's turn gets no after-reply turn", async () => {
    const h = harness({ record: on, answers: [GAP] });
    await h.ctl.afterReply(end({ modeSwitch: true, prompt: "Switched to Socratic" }));
    expect(h.asked).toEqual([]);
  });

  it("a send or a review while the turn is still setting up drops it: no ask, no card", async () => {
    for (const cut of [(c: SidekickController) => c.turnStarting(), (c: SidekickController) => void c.review({ text: "next ask" })]) {
      const h = harness({ record: on, answers: [GAP, json({ verdict: "send", issues: [], confidence: 1 })] });
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const real = h.deps.setup;
      let calls = 0;
      h.deps.setup = async () => {
        if (calls++ === 0) await gate;
        return real();
      };
      const running = h.ctl.afterReply(end());
      await vi.waitFor(() => expect(calls).toBe(1));
      cut(h.ctl);
      release();
      await running;
      expect(h.asked.filter((a) => a.startsWith("Sidekick: after the reply"))).toEqual([]);
      expect((await h.ctl.state()).cards).toEqual([]);
    }
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

describe("heads-ups (spec §4.3)", () => {
  const end = (o: Partial<Parameters<SidekickController["afterReply"]>[0]> = {}) => ({ task: { id: "t1", scope: "main" }, kind: "run" as const, ok: true, prompt: "p", reply: "r", fromBlock: false, modeSwitch: false, ...o });
  const REP = json({ repeated: { topic: "APA style", decision: "Use APA 7 everywhere." } });
  const phases = [{ id: "outline", label: "Outline" }, { id: "review", label: "Review citations" }];
  const essay = { id: "t1", action: "essay", scope: "main", phase: "outline" };
  const SEND = json({ verdict: "send", issues: [], confidence: 1 });
  const headsUps = async (h: ReturnType<typeof harness>) => (await h.ctl.state()).cards.filter((c) => c.moment === "heads-up");

  it("context ≥ 75% of the cap: one heads-up per task, 0 tokens", async () => {
    const h = harness({ record: { ...on, afterReply: false } });
    await h.ctl.afterReply(end({ context: { used: 120_000, cap: 200_000 } }));
    expect(await headsUps(h)).toEqual([]);
    await h.ctl.afterReply(end({ context: { used: 160_000, cap: 200_000 } }));
    await h.ctl.afterReply(end({ context: { used: 170_000, cap: 200_000 } }));
    expect(await headsUps(h)).toEqual([expect.objectContaining({ kind: "context", speaker: expect.objectContaining({ id: "sidekick" }), headsUp: { kind: "context", share: 0.8 } })]);
    expect(h.asked).toEqual([]);
    expect(h.logged).toEqual([]);
    expect((await h.ctl.state()).status).toBe("suggestion");
  });

  it("the context heads-up comes back in another task", async () => {
    const h = harness({ record: { ...on, afterReply: false } });
    await h.ctl.afterReply(end({ context: { used: 160_000, cap: 200_000 } }));
    h.setTask({ id: "t2", scope: "main" });
    await h.ctl.betweenTasks();
    expect(await headsUps(h)).toEqual([]);
    await h.ctl.afterReply(end({ task: { id: "t2", scope: "main" }, context: { used: 160_000, cap: 200_000 } }));
    expect(await headsUps(h)).toHaveLength(1);
  });

  it("no cap reported, or a turn of a task no longer open: no heads-up", async () => {
    const h = harness({ record: { ...on, afterReply: false } });
    await h.ctl.afterReply(end({ context: { used: 190_000 } }));
    await h.ctl.afterReply(end({ task: { id: "t0", scope: "main" }, context: { used: 190_000, cap: 200_000 } }));
    expect(await headsUps(h)).toEqual([]);
  });

  it("the same topic asked 3 times: a heads-up with the draft decision, never an after card", async () => {
    const h = harness({ record: on, answers: [REP, REP, json({ repeated: { topic: "apa Style ", decision: "Use APA 7 everywhere." } })] });
    await h.ctl.afterReply(end());
    await h.ctl.afterReply(end());
    expect((await h.ctl.state()).cards).toEqual([]);
    await h.ctl.afterReply(end());
    const s = await h.ctl.state();
    expect(s.cards).toEqual([expect.objectContaining({ moment: "heads-up", kind: "repeated", headsUp: { kind: "repeated", topic: "apa Style", decision: "Use APA 7 everywhere." } })]);
  });

  it("a gap with a repeated ask: the after card leaves the repeated part to the heads-up", async () => {
    const h = harness({ record: on, answers: [json({ gap: { title: "Sources", text: "No source." }, repeated: { topic: "APA style", decision: "Use APA 7." } })] });
    await h.ctl.afterReply(end());
    expect((await h.ctl.state()).cards).toEqual([expect.objectContaining({ moment: "after", kind: "gap", after: { gap: { title: "Sources", text: "No source." } } })]);
  });

  it("two off-phase flags in a row: drift, naming the other phase", async () => {
    const h = harness({ record: on, task: essay, phases, answers: [SEND, SEND] });
    await h.ctl.review({ text: "Check the citations in section 2 against the bibliography" });
    expect(await headsUps(h)).toEqual([]);
    await h.ctl.review({ text: "Check the citations in section 3 against the bibliography" });
    expect(await headsUps(h)).toEqual([expect.objectContaining({ kind: "off-phase", headsUp: { kind: "off-phase", phase: "Review citations" } })]);
  });

  it("turned off while the drift review reads the context → no heads-up", async () => {
    const h = harness({ record: on, task: essay, phases, answers: [SEND, SEND] });
    await h.ctl.review({ text: "Check the citations in section 2 against the bibliography" });
    let open!: () => void;
    const held = new Promise<void>((r) => (open = r));
    let reading = false;
    const context = h.deps.context;
    h.deps.context = async (...args) => {
      reading = true;
      await held;
      return context(...args);
    };
    const p = h.ctl.review({ text: "Check the citations in section 3 against the bibliography" });
    await vi.waitFor(() => expect(reading).toBe(true));
    await h.ctl.set({ on: false });
    open();
    await p;
    const s = await h.ctl.state();
    expect(s.status).toBe("off");
    expect(s.cards).toEqual([]);
  });

  it("turned off while the context heads-up checks its task → no heads-up", async () => {
    const h = harness({ record: { ...on, afterReply: false } });
    let open!: () => void;
    const held = new Promise<void>((r) => (open = r));
    let hold = true;
    let checking = false;
    const task = h.deps.task;
    h.deps.task = async () => {
      // The heads-up's first look at the open task waits while Sidekick is turned off; later reads (state) don't.
      if (hold) {
        hold = false;
        checking = true;
        await held;
      }
      return task();
    };
    const p = h.ctl.afterReply(end({ context: { used: 190_000, cap: 200_000 } }));
    await vi.waitFor(() => expect(checking).toBe(true));
    await h.ctl.set({ on: false });
    open();
    await p;
    expect((await h.ctl.state()).cards).toEqual([]);
  });

  it("a late turn of a closed task keeps the open task's signals", async () => {
    const h = harness({ record: { ...on, afterReply: false } });
    await h.ctl.afterReply(end({ context: { used: 190_000, cap: 200_000 } }));
    await h.ctl.afterReply(end({ task: { id: "t0", scope: "main" }, context: { used: 190_000, cap: 200_000 } }));
    await h.ctl.afterReply(end({ context: { used: 195_000, cap: 200_000 } }));
    expect(await headsUps(h)).toHaveLength(1);
  });

  it("a prompt on the open phase breaks the streak", async () => {
    const h = harness({ record: on, task: essay, phases, answers: [SEND, SEND, SEND] });
    await h.ctl.review({ text: "Check the citations in section 2 against the bibliography" });
    await h.ctl.review({ text: "Rewrite the outline of section 2 so it has three numbered parts" });
    await h.ctl.review({ text: "Check the citations in section 3 against the bibliography" });
    expect(await headsUps(h)).toEqual([]);
  });

  it("heads-ups off: none", async () => {
    const h = harness({ record: { ...on, headsUps: false }, task: essay, phases, answers: [REP, REP, REP, SEND, SEND] });
    for (let i = 0; i < 3; i++) await h.ctl.afterReply(end({ context: { used: 190_000, cap: 200_000 } }));
    await h.ctl.review({ text: "Check the citations in section 2 against the bibliography" });
    await h.ctl.review({ text: "Check the citations in section 3 against the bibliography" });
    expect((await h.ctl.state()).cards).toEqual([]);
  });

  it("D0: Sidekick off → no heads-up, no turn, no event", async () => {
    const h = harness({ task: essay, phases });
    await h.ctl.afterReply(end({ context: { used: 190_000, cap: 200_000 } }));
    await h.ctl.review({ text: "Check the citations in section 2 against the bibliography" });
    await h.ctl.review({ text: "Check the citations in section 3 against the bibliography" });
    expect((await h.ctl.state()).cards).toEqual([]);
    expect(h.asked).toEqual([]);
    expect(h.events).toEqual([]);
    expect(h.decisions).toEqual([]);
  });

  it("a muted heads-up kind never shows", async () => {
    const h = harness({ record: { ...on, afterReply: false, muted: { sidekick: ["context"] } } });
    await h.ctl.afterReply(end({ context: { used: 190_000, cap: 200_000 } }));
    expect(await headsUps(h)).toEqual([]);
  });

  it("Dismiss: one event with moment heads-up", async () => {
    const h = harness({ record: { ...on, afterReply: false } });
    await h.ctl.afterReply(end({ context: { used: 190_000, cap: 200_000 } }));
    const [card] = await headsUps(h);
    await h.ctl.resolve(card.id, "dismissed");
    expect(h.events).toEqual([expect.objectContaining({ moment: "heads-up", kind: "context", outcome: "dismissed", task: "t1" })]);
    expect((await h.ctl.state()).cards).toEqual([]);
  });

  it("Save as decision writes the note as the person, then the card goes", async () => {
    const h = harness({ record: on, answers: [REP, REP, REP] });
    for (let i = 0; i < 3; i++) await h.ctl.afterReply(end());
    const [card] = await headsUps(h);
    expect(await h.ctl.saveDecision(card.id)).toEqual({ ok: true });
    expect(h.decisions).toEqual([{ task: "t1", scope: "main", title: "Decision: APA style", decision: "Use APA 7 everywhere." }]);
    expect((await h.ctl.state()).cards).toEqual([]);
    expect(h.events).toEqual([expect.objectContaining({ moment: "heads-up", kind: "repeated", outcome: "used" })]);
  });

  it("Save as decision refuses another card, and keeps the card when the write fails", async () => {
    const h = harness({ record: { ...on, afterReply: false } });
    await h.ctl.afterReply(end({ context: { used: 190_000, cap: 200_000 } }));
    const [context] = await headsUps(h);
    expect(await h.ctl.saveDecision(context.id)).toMatchObject({ ok: false });
    expect(await h.ctl.saveDecision("nope")).toMatchObject({ ok: false });
    const f = harness({ record: on, answers: [REP, REP, REP] });
    f.deps.saveDecision = async () => {
      throw new Error("disk full");
    };
    for (let i = 0; i < 3; i++) await f.ctl.afterReply(end());
    const [rep] = await headsUps(f);
    expect(await f.ctl.saveDecision(rep.id)).toEqual({ ok: false, message: "disk full" });
    expect(await headsUps(f)).toHaveLength(1);
    expect(f.events).toEqual([]);
  });
});

describe("learning at task close (spec §6.4)", () => {
  const ev = (i: number, at = `2026-10-27T10:0${i}:00Z`): SidekickEvent => ({ at, sidekick: "sidekick", moment: "pre", kind: "vague", outcome: "used" });
  const five = [ev(1), ev(2), ev(3), ev(4), ev(5)];
  const learned = (id: string, text: string, source: "learned" | "person" = "learned") => ({ id, type: "learned" as const, text, level: "you" as const, source, updatedAt: "2026-10-26T00:00:00Z" });
  /** A task opens and closes (two betweenTasks), without waiting for the learning turn. */
  const closeTask = async (h: ReturnType<typeof harness>) => {
    h.setTask({ id: "t1", scope: "main" });
    await h.ctl.betweenTasks();
    h.setTask(null);
    await h.ctl.betweenTasks();
  };
  /** A task closes and its learning turn ends. */
  const closeAndLearn = async (h: ReturnType<typeof harness>) => {
    await closeTask(h);
    await h.ctl.learningSettled();
  };

  it("fewer than 5 new events: no turn", async () => {
    const h = harness({ record: on, events: [ev(1), ev(2), ev(3), ev(4)], task: null });
    await closeAndLearn(h);
    expect(h.asked).toEqual([]);
    expect(h.opened).toEqual([]);
  });

  it("only events after learnedAt count", async () => {
    const h = harness({ record: { ...on, learnedAt: "2026-10-27T10:02:30Z" }, events: five, task: null });
    await closeAndLearn(h);
    expect(h.asked).toEqual([]);
  });

  it("5 or more: one learn turn in its own session; the result goes in as the app in one write; person items never change", async () => {
    const h = harness({
      record: on,
      extra: [{ ...learned("l-p", "Doesn't want vague suggestions.", "person"), kind: "vague" }, learned("l-1", "Old."), learned("l-2", "Gone.")],
      events: five,
      task: null,
      answers: [json({ add: [{ text: "Writes short prompts.", level: "you" }], update: [{ id: "l-1", text: "New." }, { id: "l-p", text: "Hacked." }, { id: "l-x", text: "Unknown." }], remove: ["l-p", "l-2"] })],
    });
    await closeAndLearn(h);
    expect(h.asked).toHaveLength(1);
    expect(h.asked[0]).toContain("Sidekick: learn");
    expect(h.asked[0]).toContain("- [l-p] (person) Doesn't want vague suggestions.");
    expect(h.folders).toEqual(["learn"]);
    expect(h.closed).toEqual(["s1"]);
    expect(h.appWrites).toEqual([
      expect.objectContaining({ op: "put", record: expect.objectContaining({ type: "learned", text: "Writes short prompts.", level: "you", source: "learned", id: expect.stringMatching(/^l-[0-9a-f]{8}$/) }) }),
      expect.objectContaining({ op: "put", record: expect.objectContaining({ id: "l-1", text: "New.", source: "learned" }) }),
      { op: "delete", collection: "sidekick", key: "l-2" },
    ]);
    // One call, so one `Data: sidekick` commit, in the base it learned in.
    expect(h.appCalls).toEqual([{ base: "/base", n: 3 }]);
    expect(h.records()).toContainEqual(expect.objectContaining({ id: "l-p", text: "Doesn't want vague suggestions.", source: "person" }));
    expect(h.record()).toMatchObject({ on: true, learnedAt: expect.any(String) });
    expect(h.logged.at(-1)).toMatchObject({ moment: "learn", sidekick: "sidekick" });
    // Not a loose session's spend: the next task's cap starts at 0.
    expect((await h.ctl.state()).spent).toBe(0);
    // Done until 5 more events come.
    await closeAndLearn(h);
    expect(h.asked).toHaveLength(1);
  });

  it("the prompt names the newest 50 events only", async () => {
    const many = Array.from({ length: 60 }, (_, i): SidekickEvent => ({ at: `2026-10-27T10:${String(i).padStart(2, "0")}:00Z`, sidekick: "sidekick", moment: "pre", kind: i < 10 ? "scope" : "vague", outcome: "used" }));
    const h = harness({ record: on, events: many, task: null, answers: [json({})] });
    await closeAndLearn(h);
    expect(h.asked[0]).not.toContain("scope");
    expect(h.asked[0].match(/- pre vague → used/g)).toHaveLength(50);
    // learnedAt still covers every event it saw.
    expect(h.record()).toMatchObject({ learnedAt: "2026-10-27T10:59:00Z" });
  });

  it("a task still open: no learning yet", async () => {
    const h = harness({ record: on, events: five });
    await h.ctl.betweenTasks();
    await h.ctl.learningSettled();
    expect(h.asked).toEqual([]);
  });

  it("no learning before a task starts (no task → no task); a task seen open at launch counts when it closes", async () => {
    const h = harness({ record: on, events: five, task: null, answers: [json({})] });
    await h.ctl.betweenTasks();
    await h.ctl.learningSettled();
    expect(h.asked).toEqual([]);
    // A task restored at launch: state() sees it before any betweenTasks.
    h.setTask({ id: "t9", scope: "main" });
    await h.ctl.state();
    h.setTask(null);
    await h.ctl.betweenTasks();
    await h.ctl.learningSettled();
    expect(h.asked).toHaveLength(1);
  });

  it("betweenTasks never waits for the learning turn", async () => {
    let release: (a: SidekickAnswer) => void = () => undefined;
    const h = harness({ record: on, events: five, task: null, answers: [() => new Promise<SidekickAnswer>((r) => (release = r))] });
    await closeTask(h);
    await vi.waitFor(() => expect(h.asked).toHaveLength(1));
    // The turn is still pending; another close doesn't start a second one.
    await closeTask(h);
    expect(h.closed).toEqual([]);
    release({ ok: true, text: json({ add: [{ text: "Writes short prompts.", level: "you" }] }) });
    await h.ctl.learningSettled();
    expect(h.asked).toHaveLength(1);
    expect(h.appCalls).toHaveLength(1);
    expect(h.closed).toEqual(["s1"]);
  });

  it("a hung turn times out: nothing written, the session closes", async () => {
    const h = harness({ record: on, events: five, task: null, answers: [slow], learnMs: 20 });
    await closeAndLearn(h);
    expect(h.asked).toHaveLength(1);
    expect(h.appWrites).toEqual([]);
    expect(h.record()?.learnedAt).toBeUndefined();
    expect(h.closed).toEqual(["s1"]);
  });

  it("a refused write leaves learnedAt alone, so the next close tries again", async () => {
    const h = harness({ record: on, events: five, task: null, answers: [json({ add: [{ text: "Writes short prompts.", level: "you" }] })] });
    h.deps.writeApp = async () => {
      throw new Error("A profile switch is running");
    };
    await closeAndLearn(h);
    expect(h.asked).toHaveLength(1);
    expect(h.record()?.learnedAt).toBeUndefined();
    expect(h.closed).toEqual(["s1"]);
  });

  it("an answer that isn't the contract changes nothing, and learnedAt stays", async () => {
    const h = harness({ record: on, events: five, task: null, answers: ["not json"] });
    await closeAndLearn(h);
    expect(h.asked).toHaveLength(1);
    expect(h.appWrites).toEqual([]);
    expect(h.record()).not.toHaveProperty("learnedAt");
    expect(h.closed).toEqual(["s1"]);
  });

  it("turned off while the turn runs: nothing is written", async () => {
    let release: (a: SidekickAnswer) => void = () => undefined;
    const h = harness({ record: on, events: five, task: null, answers: [() => new Promise<SidekickAnswer>((r) => (release = r))] });
    await closeTask(h);
    await vi.waitFor(() => expect(h.asked).toHaveLength(1));
    await h.ctl.set({ on: false });
    release({ ok: true, text: json({ add: [{ text: "Writes short prompts.", level: "you" }] }) });
    await h.ctl.learningSettled();
    expect(h.appWrites).toEqual([]);
    expect(h.record()?.learnedAt).toBeUndefined();
    expect(h.closed).toEqual(["s1"]);
  });

  /** A learning turn that answers only when aborted, aborted by `stop`. */
  const aborted = async (stop: (h: ReturnType<typeof harness>) => Promise<void>) => {
    const h = harness({ record: on, events: five, task: null, answers: [slow] });
    await h.ctl.refresh();
    await closeTask(h);
    await vi.waitFor(() => expect(h.asked).toHaveLength(1));
    await stop(h);
    await h.ctl.learningSettled();
    expect(h.appWrites).toEqual([]);
    expect(h.record()?.learnedAt).toBeUndefined();
    expect(h.closed).toContain("s1");
  };

  it("a profile switch (refresh with another base) aborts the turn", async () => {
    await aborted(async (h) => {
      h.deps.setup = async () => ({ engineId: "claude", base: "/other" });
      await h.ctl.refresh();
    });
  });

  it("an undo that turned Sidekick off (refresh) aborts the turn", async () => {
    await aborted(async (h) => {
      h.setRecord({ ...on, on: false });
      await h.ctl.refresh();
    });
  });

  it("closing the app aborts the turn", async () => {
    await aborted((h) => h.ctl.close());
  });

  it("D0: Sidekick off → no learning turn, no event, no record write", async () => {
    const h = harness({ events: five, task: null, extra: [learned("l-1", "Old.")] });
    await closeAndLearn(h);
    expect(h.asked).toEqual([]);
    expect(h.opened).toEqual([]);
    expect(h.briefs).toEqual([]);
    expect(h.logged).toEqual([]);
    expect(h.events).toEqual(five);
    expect(h.writes).toEqual([]);
    expect(h.appWrites).toEqual([]);
  });

  it("learnedAt survives a toggle", async () => {
    const h = harness({ record: on, events: five, task: null, answers: [json({})] });
    await closeAndLearn(h);
    const at = (h.record() as { learnedAt?: string }).learnedAt;
    expect(at).toEqual(expect.any(String));
    await h.ctl.set({ afterReply: false });
    expect(h.record()).toMatchObject({ learnedAt: at, afterReply: false });
  });

  it("the next session's brief carries the learned items", async () => {
    const h = harness({ record: on, extra: [learned("l-1", "Writes short prompts."), { ...learned("l-p", "Doesn't want vague suggestions.", "person"), kind: "vague" }] });
    await h.ctl.review({ text: "make it better", force: true });
    expect(h.briefs[0]).toContain("## About this person");
    expect(h.briefs[0]).toContain("- Writes short prompts.");
    expect(h.briefs[0]).toContain("- Doesn't want vague suggestions.");
  });
});

describe("What Sidekick learned in Settings (spec §6.4)", () => {
  const items: Partial<SidekickRecord>[] = [
    { id: "l-00000001", type: "learned", text: "Takes scope fixes.", level: "you", source: "learned", updatedAt: "2026-10-26T09:00:00Z" },
    { id: "l-00000002", type: "learned", text: "Sections stay under 400 words.", level: "harness", source: "learned", updatedAt: "2026-10-26T09:00:00Z" },
    { id: "l-00000003", type: "learned", text: "Doesn't want vague suggestions from Sidekick.", level: "you", kind: "vague", source: "person", updatedAt: "2026-10-26T09:00:00Z" },
  ];

  it("lists the learned items of both levels, and nothing else of the collection", async () => {
    const h = harness({ record: { id: "settings", type: "settings", on: true }, extra: [...items, { id: "sidekick", type: "sidekick", name: "Sidekick" } as Partial<SidekickRecord>] });
    expect(await h.ctl.learned()).toEqual([
      { id: "l-00000001", text: "Takes scope fixes.", level: "you", source: "learned" },
      { id: "l-00000002", text: "Sections stay under 400 words.", level: "harness", source: "learned" },
      { id: "l-00000003", text: "Doesn't want vague suggestions from Sidekick.", level: "you", kind: "vague", source: "person" },
    ]);
  });

  it("works with Sidekick off too: it is the person's data", async () => {
    const h = harness({ extra: items });
    expect(await h.ctl.learned()).toHaveLength(3);
  });

  it("Forget this deletes that item as the person; an unknown id or another record type is left alone", async () => {
    const h = harness({ extra: items });
    await h.ctl.forget("l-00000001");
    await h.ctl.forget("l-99999999");
    await h.ctl.forget("settings");
    expect(h.writes).toEqual([{ op: "delete", collection: "sidekick", key: "l-00000001" }]);
    expect(h.appWrites).toEqual([]);
    expect((await h.ctl.learned()).map((i) => i.id)).toEqual(["l-00000002", "l-00000003"]);
  });

  it("Forget everything deletes every learned item, the person's too, and keeps the settings", async () => {
    const h = harness({ record: { id: "settings", type: "settings", on: true }, extra: items });
    await h.ctl.forgetAll();
    expect(h.writes.map((w) => [w.op, w.key])).toEqual([["delete", "l-00000001"], ["delete", "l-00000002"], ["delete", "l-00000003"]]);
    expect(await h.ctl.learned()).toEqual([]);
    expect(h.record()).toMatchObject({ on: true });
  });

  it("an edit makes the item the person's, with the new text; unchanged and unknown items are not written", async () => {
    const h = harness({ extra: items });
    await h.ctl.editLearned([
      { id: "l-00000002", text: "Sections stay under 500 words." },
      { id: "l-00000001", text: "Takes scope fixes." },
      { id: "l-99999999", text: "Made up." },
    ]);
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0]).toMatchObject({ op: "put", collection: "sidekick", record: { id: "l-00000002", type: "learned", text: "Sections stay under 500 words.", level: "harness", source: "person", updatedAt: expect.any(String) } });
    expect(h.writes[0].record?.updatedAt).not.toBe("2026-10-26T09:00:00Z");
  });

  it("a failed write reaches the caller", async () => {
    const h = harness({ extra: items });
    h.deps.store.remove = async () => {
      throw new Error("Turns are running");
    };
    await expect(h.ctl.forget("l-00000001")).rejects.toThrow("Turns are running");
  });
});

describe("several sidekicks (spec §2a)", () => {
  const RULO = { id: "rulo", type: "sidekick" as const, name: "Rulo", mark: "🦊", personality: "Direct.", purposes: [{ id: "mentor" as const }], order: 1 };
  const DEF = { id: "sidekick", type: "sidekick" as const, name: "Sidekick", mark: "spark", personality: "", purposes: [{ id: "prompt-coach" as const }, { id: "focus" as const }], order: 0 };
  const CUSTOM = (id: string, text: string, order: number) => ({ id, type: "sidekick" as const, name: id.toUpperCase(), mark: "x", personality: "", purposes: [{ id: "custom" as const, text, moments: ["after-reply" as const] }], order });
  const END = { task: { id: "t1", scope: "main" }, kind: "run" as const, ok: true, prompt: "p", reply: "r", fromBlock: false, modeSwitch: false };

  it("pre-send: only Sidekick speaks (Rulo has no pre-send purpose); one session", async () => {
    const h = harness({ record: on, extra: [DEF, RULO] });
    const r = await h.ctl.review({ text: "make it better" });
    expect(r.kind === "card" && r.card.speaker).toEqual({ id: "sidekick", name: "Sidekick", mark: "spark" });
    expect(h.sessions).toEqual(["sidekick"]);
    expect(h.logged[0]).toMatchObject({ sidekick: "sidekick", moment: "pre" });
  });

  it("D0: no sidekick records → the part 1 session, folder, brief and usage line", async () => {
    const h = harness({ record: on });
    await h.ctl.review({ text: "make it better" });
    expect(h.sessions).toEqual(["sidekick"]);
    expect(h.briefs[0]).toMatch(/^# Sidekick\n\nYou are Sidekick, the prompt coach inside the app "Essay Coach"\./);
    expect(h.logged[0]).toMatchObject({ sidekick: "sidekick", moment: "pre", tier: "light" });
  });

  it("after-reply with two candidates: one speaker by order, the other's session never opens", async () => {
    const h = harness({ record: on, extra: [{ ...RULO, order: 0 }, { ...DEF, order: 1 }], answers: [json({ lesson: "Sources first." })] });
    await h.ctl.afterReply(END);
    expect((await h.ctl.state()).cards[0]?.speaker).toEqual({ id: "rulo", name: "Rulo", mark: "🦊" });
    expect(h.sessions).toEqual(["rulo"]);
    expect(h.briefs[0]).toContain("You are Rulo");
    expect(h.briefs[0]).toContain("## Mentor");
    expect(h.logged[0]).toMatchObject({ sidekick: "rulo", moment: "after" });
  });

  it("a sidekick's own tier opens its session", async () => {
    const h = harness({ record: on, extra: [{ ...RULO, order: 0, tier: "deep" as const }, { ...DEF, order: 1 }], answers: [json({ next: "x" })] });
    await h.ctl.afterReply(END);
    expect(h.logged[0]).toMatchObject({ sidekick: "rulo", tier: "deep" });
  });

  it("a sidekick off in the scope never speaks there", async () => {
    const h = harness({ record: on, extra: [{ ...DEF, purposes: [{ id: "focus" as const }] }, RULO, { id: "s-main-rulo", type: "scope", scope: "main", sidekick: "rulo", on: false }] });
    await h.ctl.afterReply(END);
    expect(h.asked).toEqual([]);
  });

  it("pre-send with no candidate sends as typed", async () => {
    const h = harness({ record: on, extra: [{ ...DEF, purposes: [{ id: "focus" as const }] }, RULO] });
    expect(await h.ctl.review({ text: "make it better" })).toEqual({ kind: "send" });
    expect(h.opened).toEqual([]);
  });

  it("the cap is shared", async () => {
    const h = harness({ record: { ...on, cap: 20_000 as const }, extra: [DEF, RULO], spent: 20_000 });
    expect(await h.ctl.review({ text: "make it better" })).toMatchObject({ kind: "send" });
  });

  it("a flag goes to the prompt-coach candidate, whatever the order (prefer)", async () => {
    const coach = { ...CUSTOM("aaa", "Watch the tests.", 0), purposes: [{ id: "custom" as const, text: "Watch the tests.", moments: ["pre-send" as const] }] };
    const h = harness({ record: on, extra: [coach, { ...DEF, order: 1 }] });
    const r = await h.ctl.review({ text: "make it better" });
    expect(r.kind === "card" && r.card.speaker.id).toBe("sidekick");
    expect(h.sessions).toEqual(["sidekick"]);
  });

  it("each sidekick mutes its own kinds: Rulo's muted `gap` silences Rulo's lessons", async () => {
    const h = harness({ record: { ...on, muted: { rulo: ["gap"] } }, extra: [{ ...RULO, order: 0 }, { ...DEF, order: 1 }], answers: [json({ lesson: "x" })] });
    await h.ctl.afterReply(END);
    expect((await h.ctl.state()).cards).toEqual([]);
  });

  it("custom-only candidates: one light routing turn in its own `route` session picks, logged as `route`", async () => {
    const h = harness({ record: on, extra: [{ ...DEF, purposes: [{ id: "focus" as const }] }, CUSTOM("aaa", "Watch the tests.", 1), CUSTOM("bbb", "Watch the style.", 2)], answers: ["bbb", json({ next: "Fix the style" })] });
    await h.ctl.afterReply(END);
    expect(h.sessions).toEqual(["route", "bbb"]);
    expect(h.asked[0]).toContain("Sidekick: route");
    expect(h.asked[0]).toContain("- aaa: Watch the tests.");
    expect(h.closed).toContain("s1");
    expect(h.logged.map((l) => [l.moment, l.sidekick, l.tier])).toEqual([["route", "route", "light"], ["after", "bbb", "light"]]);
    expect((await h.ctl.state()).cards[0]?.speaker.id).toBe("bbb");
  });

  it("an unknown routing answer falls back to the person's order", async () => {
    const h = harness({ record: on, extra: [CUSTOM("aaa", "Watch the tests.", 1), CUSTOM("bbb", "Watch the style.", 2)], answers: ["nobody", json({ next: "x" })] });
    await h.ctl.afterReply(END);
    expect(h.sessions).toEqual(["route", "aaa"]);
  });

  it("a hung routing turn times out to the person's order", async () => {
    const h = harness({ record: on, routeMs: 20, extra: [CUSTOM("aaa", "Watch the tests.", 1), CUSTOM("bbb", "Watch the style.", 2)], answers: [slow, json({ next: "x" })] });
    await h.ctl.afterReply(END);
    expect(h.sessions).toEqual(["route", "aaa"]);
    expect(h.closed).toContain("s1");
  });

  it("past the cap: no routing turn (and no speaker turn)", async () => {
    const h = harness({ record: { ...on, cap: 20_000 as const }, spent: 20_000, extra: [CUSTOM("aaa", "Watch the tests.", 1), CUSTOM("bbb", "Watch the style.", 2)] });
    await h.ctl.afterReply(END);
    expect(h.asked).toEqual([]);
  });

  it("turning off aborts a running routing turn and nothing more is asked", async () => {
    const h = harness({ record: on, extra: [CUSTOM("aaa", "Watch the tests.", 1), CUSTOM("bbb", "Watch the style.", 2)], answers: [slow] });
    const run = h.ctl.afterReply(END);
    await vi.waitFor(() => expect(h.asked).toHaveLength(1));
    await h.ctl.set({ on: false });
    await run;
    expect(h.asked).toHaveLength(1);
    expect(h.closed).toContain("s1");
    expect(h.sessions).toEqual(["route"]);
  });

  it("closing aborts a running routing turn", async () => {
    const h = harness({ record: on, extra: [CUSTOM("aaa", "Watch the tests.", 1), CUSTOM("bbb", "Watch the style.", 2)], answers: [slow] });
    const run = h.ctl.afterReply(END);
    await vi.waitFor(() => expect(h.asked).toHaveLength(1));
    await h.ctl.close();
    await run;
    expect(h.asked).toHaveLength(1);
  });

  it("a removed sidekick's session closes", async () => {
    const h = harness({ record: on, extra: [{ ...RULO, order: 0 }, { ...DEF, order: 1 }], answers: [json({ next: "x" })] });
    await h.ctl.afterReply(END);
    expect(h.sessions).toEqual(["rulo"]);
    await h.deps.store.removeSidekick("rulo");
    await h.ctl.review({ text: "make it better" });
    expect(h.closed).toContain("s1");
    expect(h.sessions).toEqual(["rulo", "sidekick"]);
  });

  it("each sidekick keeps its own session across moments; betweenTasks closes them all", async () => {
    const h = harness({ record: on, extra: [{ ...RULO, order: 0 }, { ...DEF, order: 1 }], answers: [json({ next: "x" })] });
    await h.ctl.afterReply(END);
    await h.ctl.review({ text: "make it better" });
    await h.ctl.afterReply(END);
    expect(h.sessions).toEqual(["rulo", "sidekick"]);
    h.setTask(null);
    await h.ctl.betweenTasks();
    expect(h.closed.sort()).toEqual(["s1", "s2"]);
  });

  it("a heads-up goes to the focus candidate", async () => {
    const h = harness({ record: on, extra: [{ ...RULO, order: 0, purposes: [{ id: "custom" as const, text: "x", moments: ["heads-up" as const] }] }, { ...DEF, order: 1 }] });
    await h.ctl.afterReply({ ...END, modeSwitch: true, context: { used: 80, cap: 100 } });
    expect((await h.ctl.state()).cards[0]).toMatchObject({ speaker: { id: "sidekick" }, headsUp: { kind: "context" } });
    expect(h.asked).toEqual([]);
  });
});

describe("scope purpose text (spec §2a.4)", () => {
  const SCOPE = { id: "s-main-sidekick", type: "scope" as const, scope: "main", sidekick: "sidekick", on: true, purposeText: "No spec without AC." };

  it("the open scope's purpose text reaches the speaker's turn, never the brief", async () => {
    const h = harness({ record: on, extra: [SCOPE] });
    await h.ctl.review({ text: "make it better" });
    expect(h.asked[0]).toContain("Scope purpose: No spec without AC.");
    expect(h.briefs[0]).not.toContain("No spec without AC.");
  });

  it("the after-reply turn carries it too", async () => {
    const h = harness({ record: on, extra: [SCOPE], answers: ["{}"] });
    await h.ctl.afterReply({ task: { id: "t1", scope: "main" }, kind: "run", ok: true, prompt: "p", reply: "r", fromBlock: false, modeSwitch: false });
    expect(h.asked[0]).toContain("Scope purpose: No spec without AC.");
    expect(h.briefs[0]).not.toContain("No spec without AC.");
  });

  it("only the speaker's record in the open scope counts", async () => {
    const other = harness({ record: on, extra: [{ ...SCOPE, id: "s-other-sidekick", scope: "other" }] });
    await other.ctl.review({ text: "make it better" });
    expect(other.asked[0]).not.toContain("Scope purpose");
  });

  it("D0: no scope records → no purpose line", async () => {
    const h = harness({ record: on });
    await h.ctl.review({ text: "make it better" });
    expect(h.asked[0]).not.toContain("Scope purpose");
  });
});

describe("purposes at work (spec §2a.2): the mentor after the reply, the process-guard at a phase change", () => {
  const MENTOR = { id: "rulo", type: "sidekick" as const, name: "Rulo", mark: "🦊", personality: "", purposes: [{ id: "mentor" as const }], order: 0 };
  const COACH = { id: "sidekick", type: "sidekick" as const, name: "Sidekick", mark: "spark", personality: "", purposes: [{ id: "prompt-coach" as const }, { id: "focus" as const }], order: 1 };
  const GUARD = { id: "guard", type: "sidekick" as const, name: "Guard", mark: "🛡️", personality: "", purposes: [{ id: "process-guard" as const }], order: 2 };
  const END = { task: { id: "t1", scope: "main" }, kind: "run" as const, ok: true, prompt: "Outline chapter 2", reply: "Here it is.", fromBlock: false, modeSwitch: false };
  const BOTH = json({ gap: { title: "Sources", text: "No source." }, next: "Add a source", lesson: "A thesis is the claim the essay defends." });
  // A phase's `brief` is a file in the harness folder: turns carry its text (read through phaseBrief), never the path.
  const phases = [{ id: "outline", label: "Outline", brief: "phases/outline.md" }, { id: "draft", label: "Draft" }];
  const phaseBriefs = { outline: "Agree on\n  sections.\n\nList each one." };
  const MOVE = { task: { id: "t1", scope: "main", action: "essay" }, from: "outline", to: "draft" };

  it("a mentor speaker is asked for a lesson only, and its card carries only the lesson", async () => {
    const h = harness({ record: on, extra: [MENTOR, COACH], answers: [BOTH] });
    await h.ctl.afterReply(END);
    expect(h.asked[0]).toContain('{"lesson":string?}');
    expect(h.asked[0]).not.toContain('"gap"');
    expect((await h.ctl.state()).cards).toEqual([expect.objectContaining({ moment: "after", kind: "gap", speaker: expect.objectContaining({ id: "rulo" }), after: { lesson: "A thesis is the claim the essay defends." } })]);
  });

  it("a speaker with both purposes makes one call; the card carries both parts", async () => {
    const h = harness({ record: on, extra: [{ ...COACH, order: 0, purposes: [{ id: "prompt-coach" as const }, { id: "mentor" as const }] }], answers: [BOTH] });
    await h.ctl.afterReply(END);
    expect(h.asked).toHaveLength(1);
    expect(h.asked[0]).toContain('"lesson":string?');
    expect((await h.ctl.state()).cards[0]).toMatchObject({ kind: "gap", after: { gap: { title: "Sources" }, next: "Add a source", lesson: "A thesis is the claim the essay defends." } });
  });

  it("D0: the prompt coach is never asked for a lesson and drops one it makes up", async () => {
    const h = harness({ record: on, answers: [BOTH] });
    await h.ctl.afterReply(END);
    expect(h.asked[0]).not.toContain("lesson");
    expect((await h.ctl.state()).cards[0]?.after).toEqual({ gap: { title: "Sources", text: "No source." }, next: "Add a source" });
  });

  it("a guard speaks with what the phase left missing, in its own session, logged as phase-change", async () => {
    const h = harness({ record: on, extra: [COACH, GUARD], phases, phaseBriefs, answers: [json({ missing: ["No agreed section list"] })] });
    await h.ctl.phaseMoved(MOVE);
    expect(h.sessions).toEqual(["guard"]);
    expect(h.asked[0]).toContain("Sidekick: phase change");
    expect(h.asked[0]).toContain("Leaving: Outline — Agree on sections. List each one.\nEntering: Draft");
    expect(h.asked[0]).not.toContain("phases/outline.md");
    expect(h.logged[0]).toMatchObject({ sidekick: "guard", moment: "phase-change", task: "t1" });
    expect((await h.ctl.state()).cards).toEqual([expect.objectContaining({ moment: "phase-change", kind: "missing", speaker: { id: "guard", name: "Guard", mark: "🛡️" }, guard: { missing: ["No agreed section list"] } })]);
  });

  it("the phase-change turn names the task's last typed prompts and the scope's purpose text", async () => {
    const SCOPE = { id: "s-main-guard", type: "scope" as const, scope: "main", sidekick: "guard", on: true, purposeText: "Never draft without an outline." };
    const h = harness({ record: { ...on, afterReply: false }, extra: [COACH, GUARD, SCOPE], phases, answers: [json({ missing: [] })] });
    await h.ctl.afterReply({ ...END, task: { ...END.task, phase: "outline" }, prompt: "List the sections" });
    await h.ctl.afterReply({ ...END, task: { ...END.task, phase: "intro" }, prompt: "Another phase's ask" });
    await h.ctl.phaseMoved(MOVE);
    expect(h.asked[0]).toContain("Scope purpose: Never draft without an outline.");
    expect(h.asked[0]).toContain("Prompts in the phase left (first lines):\n- List the sections\nUI language");
  });

  it("the open phase's brief text reaches the pre-send and after-reply turns, read once per task", async () => {
    const task = { id: "t1", action: "essay", scope: "main", phase: "outline" };
    const h = harness({ record: on, task, phases, phaseBriefs, answers: [SUGGEST, BOTH, BOTH] });
    await h.ctl.review({ text: "Outline chapter 2 with three sections and a conclusion", force: true });
    await h.ctl.afterReply({ ...END, task });
    await h.ctl.afterReply({ ...END, task });
    expect(h.asked).toHaveLength(3);
    for (const p of h.asked) {
      expect(p).toContain("Open phase: Outline — Agree on sections. List each one.\n");
      expect(p).not.toContain("phases/outline.md");
    }
    expect(h.briefReads).toEqual(["essay/outline"]);
  });

  it("a brief that can't be read is left out; a long one is cut", async () => {
    const failed = harness({ record: on, extra: [COACH, GUARD], phases, phaseBriefs: { outline: new Error("ENOENT") }, answers: [json({ missing: [] })] });
    await failed.ctl.phaseMoved(MOVE);
    expect(failed.asked[0]).toContain("Leaving: Outline\nEntering: Draft");
    const long = harness({ record: on, extra: [COACH, GUARD], phases, phaseBriefs: { outline: `${"a".repeat(600)}TAIL` }, answers: [json({ missing: [] })] });
    await long.ctl.phaseMoved(MOVE);
    expect(long.asked[0]).toContain(`Leaving: Outline — ${"a".repeat(600)}\nEntering: Draft`);
  });

  it("two quick moves: the older one, finishing its checks later, never aborts the newer turn", async () => {
    let release!: () => void;
    const h = harness({ record: on, extra: [COACH, GUARD], phases, answers: [json({ missing: ["Newer"] })] });
    const setup = h.deps.setup;
    let calls = 0;
    (h.deps as { setup: SidekickDeps["setup"] }).setup = async () => {
      if (++calls === 1) await new Promise<void>((r) => (release = r));
      return setup();
    };
    const older = h.ctl.phaseMoved(MOVE);
    await vi.waitFor(() => expect(calls).toBe(1));
    await h.ctl.phaseMoved({ ...MOVE, from: "draft", to: "outline" });
    release();
    await older;
    expect(h.asked).toHaveLength(1);
    expect(h.asked[0]).toContain("Leaving: Draft\nEntering: Outline");
    expect((await h.ctl.state()).cards).toEqual([expect.objectContaining({ kind: "missing", guard: { missing: ["Newer"] } })]);
  });

  it("nothing missing, a muted kind, or a task no longer open: no card", async () => {
    const none = harness({ record: on, extra: [COACH, GUARD], phases, answers: [json({ missing: [] })] });
    await none.ctl.phaseMoved(MOVE);
    expect((await none.ctl.state()).cards).toEqual([]);
    const muted = harness({ record: { ...on, muted: { guard: ["missing"] } }, extra: [COACH, GUARD], phases, answers: [json({ missing: ["x"] })] });
    await muted.ctl.phaseMoved(MOVE);
    expect((await muted.ctl.state()).cards).toEqual([]);
    const gone = harness({ record: on, extra: [COACH, GUARD], phases, answers: [json({ missing: ["x"] })] });
    gone.setTask({ id: "t2", scope: "main" });
    await gone.ctl.phaseMoved(MOVE);
    expect(gone.asked).toEqual([]);
  });

  it("turned off while the turn runs: no card", async () => {
    let answer!: (a: SidekickAnswer) => void;
    const h = harness({ record: on, extra: [COACH, GUARD], phases, answers: [() => new Promise<SidekickAnswer>((r) => (answer = r))] });
    const run = h.ctl.phaseMoved(MOVE);
    await vi.waitFor(() => expect(h.asked).toHaveLength(1));
    await h.ctl.set({ on: false });
    answer({ ok: true, text: json({ missing: ["x"] }) });
    await run;
    expect((await h.ctl.state()).cards).toEqual([]);
  });

  it("past the cap: no turn", async () => {
    const h = harness({ record: { ...on, cap: 20_000 as const }, spent: 20_000, extra: [COACH, GUARD], phases });
    await h.ctl.phaseMoved(MOVE);
    expect(h.asked).toEqual([]);
  });

  it("D0: no process-guard sidekick, or Sidekick off → no turn", async () => {
    const h = harness({ record: on, phases });
    await h.ctl.phaseMoved(MOVE);
    expect(h.asked).toEqual([]);
    const off = harness({ extra: [COACH, GUARD], phases });
    await off.ctl.phaseMoved(MOVE);
    expect(off.asked).toEqual([]);
    expect(off.events).toEqual([]);
  });
});

describe("daily (spec §2a.2 daily-summary, Decision 12)", () => {
  const DAILY = { id: "day", type: "sidekick" as const, name: "Day", mark: "☀️", personality: "", purposes: [{ id: "daily-summary" as const }], order: 1 };
  const input = { day: "2026-10-26", notes: ["Outline"], tokens: { tasks: 1, sidekick: 1 }, open: [] };

  it("once per local day: a card, and lastDaily set", async () => {
    const h = harness({ record: on, extra: [DAILY], dailyInput: input, answers: ["Yesterday you outlined chapter 2."] });
    await h.ctl.daily(new Date("2026-10-27T08:00:00"));
    await h.ctl.daily(new Date("2026-10-27T15:00:00"));
    expect(h.asked).toHaveLength(1);
    expect((await h.ctl.state()).cards).toEqual([expect.objectContaining({ moment: "daily", kind: "daily", text: "Yesterday you outlined chapter 2.", speaker: { id: "day", name: "Day", mark: "☀️" } })]);
    expect(h.record()).toMatchObject({ lastDaily: "2026-10-27" });
  });

  it("asks about yesterday in a light one-off session of its own, logged as daily, closed after", async () => {
    const h = harness({ record: on, extra: [DAILY], dailyInput: input, answers: ["Quiet day."] });
    await h.ctl.daily(new Date("2026-10-27T00:30:00"));
    expect(h.days).toEqual(["2026-10-26"]);
    expect(h.sessions).toEqual(["daily"]);
    expect(h.closed).toEqual(["s1"]);
    expect(h.asked[0]).toContain("Sidekick: daily summary");
    expect(h.asked[0]).toContain("- Outline");
    expect(h.briefs[0]).toContain("Day");
    expect(h.logged[0]).toMatchObject({ sidekick: "day", moment: "daily", tier: "light" });
    expect(h.logged[0]?.task).toBeUndefined();
  });

  it("D0: no daily-summary sidekick, or Sidekick off → nothing", async () => {
    for (const h of [harness({ record: on, dailyInput: input }), harness({ extra: [DAILY], dailyInput: input })]) {
      await h.ctl.daily(new Date("2026-10-27T08:00:00"));
      expect(h.asked).toEqual([]);
      expect(h.opened).toEqual([]);
      expect(h.writes).toEqual([]);
      expect(h.events).toEqual([]);
      expect(h.days).toEqual([]);
    }
  });

  it("nothing happened yesterday → no turn", async () => {
    const h = harness({ record: on, extra: [DAILY], dailyInput: { ...input, notes: [], tokens: { tasks: 0, sidekick: 0 } } });
    await h.ctl.daily(new Date("2026-10-27T08:00:00"));
    expect(h.asked).toEqual([]);
    expect(h.record()).toMatchObject({ lastDaily: "2026-10-27" });
  });

  it("muted for its sidekick, or an empty answer → no card", async () => {
    const muted = harness({ record: { ...on, muted: { day: ["daily"] } }, extra: [DAILY], dailyInput: input });
    await muted.ctl.daily(new Date("2026-10-27T08:00:00"));
    expect(muted.asked).toEqual([]);
    const empty = harness({ record: on, extra: [DAILY], dailyInput: input, answers: ["  "] });
    await empty.ctl.daily(new Date("2026-10-27T08:00:00"));
    expect((await empty.ctl.state()).cards).toEqual([]);
  });

  it("a hung CLI ends at dailyMs: no card, the session closed", async () => {
    const h = harness({ record: on, extra: [DAILY], dailyInput: input, answers: [slow], dailyMs: 20 });
    await h.ctl.daily(new Date("2026-10-27T08:00:00"));
    expect((await h.ctl.state()).cards).toEqual([]);
    expect(h.closed).toEqual(["s1"]);
  });

  it("turning off, a refresh with Sidekick off, or closing drops the running turn", async () => {
    for (const stop of [(h: ReturnType<typeof harness>) => h.ctl.set({ on: false }), (h: ReturnType<typeof harness>) => h.ctl.close()]) {
      const h = harness({ record: on, extra: [DAILY], dailyInput: input, answers: [slow] });
      const run = h.ctl.daily(new Date("2026-10-27T08:00:00"));
      await vi.waitFor(() => expect(h.asked).toHaveLength(1));
      await stop(h);
      await run;
      expect(h.ctl["cards"]).toEqual([]);
      expect(h.closed).toContain("s1");
    }
    const r = harness({ record: on, extra: [DAILY], dailyInput: input, answers: [slow] });
    const run = r.ctl.daily(new Date("2026-10-27T08:00:00"));
    await vi.waitFor(() => expect(r.asked).toHaveLength(1));
    r.setRecord({ ...on, on: false, lastDaily: "2026-10-27" });
    await r.ctl.refresh();
    await run;
    expect((await r.ctl.state()).cards).toEqual([]);
  });

  it("the card is app-wide: it stays when a task opens or closes", async () => {
    const h = harness({ record: on, extra: [DAILY], dailyInput: input, answers: ["Quiet day."], task: null });
    await h.ctl.daily(new Date("2026-10-27T08:00:00"));
    h.setTask({ id: "t2", scope: "main" });
    await h.ctl.betweenTasks();
    h.setTask(null);
    await h.ctl.betweenTasks();
    await h.ctl.learningSettled();
    expect((await h.ctl.state()).cards).toEqual([expect.objectContaining({ moment: "daily" })]);
  });
});

describe("before approve (spec §2a.2, Decision 10)", () => {
  const GUARD = { id: "guard", type: "sidekick" as const, name: "Guard", mark: "🛡️", personality: "", purposes: [{ id: "process-guard" as const }], order: 1 };
  const DOC = { title: "Spec: login", text: "# Login\nUsers sign in." };
  const APPROVE = { kind: "approve" };

  it("returns what's missing and leaves a card; approval itself is never blocked", async () => {
    const h = harness({ record: on, extra: [GUARD], answers: [json({ missing: ["No acceptance criteria"] })] });
    const r = await h.ctl.beforeApprove(DOC);
    expect(r).toEqual({ kind: "card", card: expect.objectContaining({ moment: "before-approve", kind: "missing", speaker: { id: "guard", name: "Guard", mark: "🛡️" }, guard: { missing: ["No acceptance criteria"] } }) });
    expect((await h.ctl.state()).cards).toEqual([expect.objectContaining({ moment: "before-approve" })]);
    expect(h.logged[0]).toMatchObject({ sidekick: "guard", moment: "before-approve", task: "t1" });
    expect(h.sessions).toEqual(["guard"]);
  });

  it("nothing missing, no guard, Sidekick off, or past the wait: approve", async () => {
    expect(await harness({ record: on, extra: [GUARD], answers: [json({ missing: [] })] }).ctl.beforeApprove({ title: "x", text: "y" })).toEqual(APPROVE);
    expect(await harness({ record: on }).ctl.beforeApprove({ title: "x", text: "y" })).toEqual(APPROVE);
    expect(await harness({ extra: [GUARD] }).ctl.beforeApprove({ title: "x", text: "y" })).toEqual(APPROVE);
  });

  it("the document is cut like a reply", async () => {
    const h = harness({ record: on, extra: [GUARD], answers: [json({ missing: [] })] });
    await h.ctl.beforeApprove({ title: "x", text: "# A\n" + "a ".repeat(20000) });
    expect(h.asked[0]!.length).toBeLessThan(12000);
  });

  it("the prompt carries the title, the open phase's brief text (never its path) and the scope purpose", async () => {
    const phases = [{ id: "spec", label: "Spec", brief: "phases/spec.md" }];
    const h = harness({
      record: on,
      extra: [GUARD, { id: "s-main-guard", type: "scope", scope: "main", sidekick: "guard", on: true, purposeText: "Every spec\nlists its risks." }],
      task: { id: "t1", action: "feature", scope: "main", phase: "spec" },
      phases,
      phaseBriefs: { spec: "Write the spec.\nWith criteria." },
      answers: [json({ missing: [] })],
    });
    await h.ctl.beforeApprove({ title: 'The "login" spec', text: "Users sign in." });
    expect(h.asked[0]?.startsWith("Sidekick: before approve")).toBe(true);
    expect(h.asked[0]).toContain(`<document title="The 'login' spec">`);
    expect(h.asked[0]).toContain("Open phase: Spec — Write the spec. With criteria.");
    expect(h.asked[0]).not.toContain("phases/spec.md");
    expect(h.asked[0]).toContain("Scope purpose: Every spec lists its risks.");
  });

  it("D0: Sidekick off → approve, no turn, no event, no write", async () => {
    const h = harness({ extra: [GUARD], answers: [json({ missing: ["x"] })] });
    expect(await h.ctl.beforeApprove(DOC)).toEqual(APPROVE);
    expect(h.asked).toEqual([]);
    expect(h.opened).toEqual([]);
    expect(h.briefs).toEqual([]);
    expect(h.logged).toEqual([]);
    expect(h.events).toEqual([]);
    expect(h.writes).toEqual([]);
    expect(h.states).toEqual([]);
  });

  it("past the cap, or its kind muted: approve without a turn", async () => {
    const capped = harness({ record: { ...on, cap: 20_000 as const }, spent: 20_000, extra: [GUARD] });
    expect(await capped.ctl.beforeApprove(DOC)).toEqual(APPROVE);
    expect(capped.asked).toEqual([]);
    const muted = harness({ record: { ...on, muted: { guard: ["missing"] } }, extra: [GUARD] });
    expect(await muted.ctl.beforeApprove(DOC)).toEqual(APPROVE);
    expect(muted.asked).toEqual([]);
  });

  it("a hung turn: approve at the wait, a timeout event, and no card even if the answer comes late", async () => {
    let answer!: (a: SidekickAnswer) => void;
    const h = harness({ record: on, extra: [GUARD], waitMs: 30, answers: [() => new Promise<SidekickAnswer>((r) => (answer = r))] });
    expect(await h.ctl.beforeApprove(DOC)).toEqual(APPROVE);
    await vi.waitFor(() => expect(h.events).toEqual([expect.objectContaining({ sidekick: "guard", moment: "before-approve", kind: "missing", outcome: "timeout", task: "t1" })]));
    answer({ ok: true, text: json({ missing: ["late"] }) });
    await new Promise((r) => setTimeout(r, 10));
    expect((await h.ctl.state()).cards).toEqual([]);
  });

  it("a failing turn or a broken answer: approve", async () => {
    const thrown = harness({ record: on, extra: [GUARD], answers: [async () => Promise.reject(new Error("boom"))] });
    expect(await thrown.ctl.beforeApprove(DOC)).toEqual(APPROVE);
    const broken = harness({ record: on, extra: [GUARD], answers: ["not json"] });
    expect(await broken.ctl.beforeApprove(DOC)).toEqual(APPROVE);
    expect((await broken.ctl.state()).cards).toEqual([]);
  });

  it("the approval answered (cancelApprove), turning off, a refresh with Sidekick off, or closing: approve at once, no card", async () => {
    const stops = [
      (h: ReturnType<typeof harness>) => h.ctl.cancelApprove(),
      (h: ReturnType<typeof harness>) => h.ctl.set({ on: false }),
      (h: ReturnType<typeof harness>) => (h.setRecord({ ...on, on: false }), h.ctl.refresh()),
      (h: ReturnType<typeof harness>) => h.ctl.close(),
    ];
    for (const stop of stops) {
      let answer!: (a: SidekickAnswer) => void;
      const h = harness({ record: on, extra: [GUARD], waitMs: 60_000, answers: [() => new Promise<SidekickAnswer>((r) => (answer = r))] });
      const run = h.ctl.beforeApprove(DOC);
      await vi.waitFor(() => expect(h.asked).toHaveLength(1));
      await stop(h);
      expect(await run).toEqual(APPROVE);
      answer({ ok: true, text: json({ missing: ["x"] }) });
      await new Promise((r) => setTimeout(r, 10));
      expect(h.ctl["cards"]).toEqual([]);
    }
  });

  it("the task closed while the turn ran: approve, no card", async () => {
    let answer!: (a: SidekickAnswer) => void;
    const h = harness({ record: on, extra: [GUARD], waitMs: 60_000, answers: [() => new Promise<SidekickAnswer>((r) => (answer = r))] });
    const run = h.ctl.beforeApprove(DOC);
    await vi.waitFor(() => expect(h.asked).toHaveLength(1));
    h.setTask({ id: "t2", scope: "main" });
    answer({ ok: true, text: json({ missing: ["x"] }) });
    expect(await run).toEqual(APPROVE);
    expect((await h.ctl.state()).cards).toEqual([]);
  });

  it("a newer check replaces the running one", async () => {
    let first!: (a: SidekickAnswer) => void;
    const h = harness({ record: on, extra: [GUARD], waitMs: 60_000, answers: [() => new Promise<SidekickAnswer>((r) => (first = r)), json({ missing: ["Risks"] })] });
    const old = h.ctl.beforeApprove(DOC);
    await vi.waitFor(() => expect(h.asked).toHaveLength(1));
    const now = h.ctl.beforeApprove({ ...DOC, text: "v2" });
    expect(await old).toEqual(APPROVE);
    first({ ok: true, text: json({ missing: ["Old"] }) });
    expect(await now).toMatchObject({ kind: "card", card: { guard: { missing: ["Risks"] } } });
    expect((await h.ctl.state()).cards).toHaveLength(1);
  });
});

describe("places (spec §2a.5, Decision 13)", () => {
  const WATCH = { id: "watch", type: "sidekick" as const, name: "Watch", mark: "👀", personality: "", purposes: [{ id: "custom" as const, text: "Explain terminal output.", moments: ["place:terminal" as const] }], order: 1 };
  const manifest = { default: "off" as const, places: [{ id: "terminal", label: "Terminal", description: "Agent output." }] };
  const NO = { ok: false };

  it("a sidekick with that place answers in free text, in a one-off session closed right after", async () => {
    const h = harness({ record: on, extra: [WATCH], manifest, answers: ["That error means the port is busy."] });
    expect(await h.ctl.ask("terminal", "EADDRINUSE :3000")).toEqual({ ok: true, text: "That error means the port is busy.", speaker: { id: "watch", name: "Watch", mark: "👀" } });
    expect(h.logged.at(-1)).toMatchObject({ moment: "place:terminal", sidekick: "watch", task: "t1" });
    expect(h.sessions).toEqual(["place"]);
    expect(h.closed).toEqual(h.opened);
    expect(h.asked[0]?.startsWith("Sidekick: place")).toBe(true);
    expect(h.asked[0]).toContain("<content>\nEADDRINUSE :3000\n</content>");
    // Never a card: the harness shows the answer in its place.
    expect((await h.ctl.state()).cards).toEqual([]);
    expect(h.events).toEqual([]);
  });

  it("unknown place, no sidekick there, off in the scope, not in the scope's places, Sidekick off: not ok, no turn", async () => {
    const hs = [
      harness({ record: on, extra: [WATCH], manifest }),
      harness({ record: on, manifest }),
      harness({ record: on, extra: [WATCH, { id: "s-main-watch", type: "scope", scope: "main", sidekick: "watch", on: false }], manifest }),
      harness({ record: on, extra: [WATCH, { id: "s-main-watch", type: "scope", scope: "main", sidekick: "watch", on: true, places: ["browser"] }], manifest }),
      harness({ extra: [WATCH], manifest }),
    ];
    const rs = await Promise.all([hs[0]!.ctl.ask("nope", "x"), ...hs.slice(1).map((h) => h.ctl.ask("terminal", "x"))]);
    for (const r of rs) expect(r).toEqual(NO);
    for (const h of hs) expect(h.asked).toEqual([]);
  });

  it("a scope record whose places name it keeps it", async () => {
    const h = harness({ record: on, extra: [WATCH, { id: "s-main-watch", type: "scope", scope: "main", sidekick: "watch", on: true, places: ["terminal"] }], manifest, answers: ["Fine."] });
    expect(await h.ctl.ask("terminal", "x")).toMatchObject({ ok: true, text: "Fine." });
  });

  it("D0: a manifest without places, or Sidekick off: not ok at once, no turn, no event, no write", async () => {
    for (const h of [harness({ record: on, extra: [WATCH] }), harness({ extra: [WATCH], manifest })]) {
      expect(await h.ctl.ask("terminal", "x")).toEqual(NO);
      expect(h.asked).toEqual([]);
      expect(h.opened).toEqual([]);
      expect(h.briefs).toEqual([]);
      expect(h.logged).toEqual([]);
      expect(h.events).toEqual([]);
      expect(h.writes).toEqual([]);
      expect(h.states).toEqual([]);
    }
  });

  it("answers are cut to 600 characters; an empty or failed one is not ok", async () => {
    const h = harness({ record: on, extra: [WATCH], manifest, answers: ["x".repeat(900), "   ", async () => ({ ok: false, text: "" })] });
    const r = await h.ctl.ask("terminal", "y");
    expect(r.ok && r.text.length).toBe(600);
    expect(await h.ctl.ask("terminal", "y")).toEqual(NO);
    expect(await h.ctl.ask("terminal", "y")).toEqual(NO);
  });

  it("past the cap: not ok, no turn", async () => {
    const h = harness({ record: { ...on, cap: 20_000 as const }, spent: 20_000, extra: [WATCH], manifest });
    expect(await h.ctl.ask("terminal", "x")).toEqual(NO);
    expect(h.asked).toEqual([]);
  });

  it("the prompt carries the open phase's brief text (never its path) and the scope purpose", async () => {
    const h = harness({
      record: on,
      extra: [WATCH, { id: "s-main-watch", type: "scope", scope: "main", sidekick: "watch", on: true, purposeText: "Mind the\nports." }],
      task: { id: "t1", action: "feature", scope: "main", phase: "build" },
      phases: [{ id: "build", label: "Build", brief: "phases/build.md" }],
      phaseBriefs: { build: "Make it run." },
      manifest,
      answers: ["Ok."],
    });
    await h.ctl.ask("terminal", "x");
    expect(h.asked[0]).toContain("Place: Terminal — Agent output.");
    expect(h.asked[0]).toContain("Open phase: Build — Make it run.");
    expect(h.asked[0]).not.toContain("phases/build.md");
    expect(h.asked[0]).toContain("Scope purpose: Mind the ports.");
  });

  it("the place session's brief never carries what Sidekick learned (the harness reads the answer)", async () => {
    const h = harness({ record: on, extra: [WATCH, { id: "l-1", type: "learned", level: "you", text: "Prefers Rust", source: "learned", updatedAt: "2026-10-01T00:00:00.000Z" }], manifest, answers: ["Ok."] });
    await h.ctl.ask("terminal", "x");
    expect(h.briefs).toHaveLength(1);
    expect(h.briefs[0]).not.toContain("Prefers Rust");
    expect(h.briefs[0]).toContain("Watch");
  });

  it("no task open: the app scope, no task on the usage line", async () => {
    const h = harness({ record: on, extra: [WATCH], manifest, task: null, answers: ["Ok."] });
    expect(await h.ctl.ask("terminal", "x")).toMatchObject({ ok: true });
    expect(h.logged.at(-1)).toMatchObject({ moment: "place:terminal" });
    expect(h.logged.at(-1)?.task).toBeUndefined();
  });

  it("a hung turn ends at placeMs: not ok", async () => {
    const h = harness({ record: on, extra: [WATCH], manifest, placeMs: 30, answers: [(signal) => new Promise<SidekickAnswer>((r) => signal.addEventListener("abort", () => r({ ok: false, text: "" })))] });
    expect(await h.ctl.ask("terminal", "x")).toEqual(NO);
    expect(h.closed).toEqual(h.opened);
  });

  it("turning off, a refresh with Sidekick off, closing, or a newer ask in the same place: not ok, the answer dropped", async () => {
    const stops = [
      (h: ReturnType<typeof harness>) => h.ctl.set({ on: false }),
      (h: ReturnType<typeof harness>) => (h.setRecord({ ...on, on: false }), h.ctl.refresh()),
      (h: ReturnType<typeof harness>) => h.ctl.close(),
      (h: ReturnType<typeof harness>) => void h.ctl.ask("terminal", "newer"),
    ];
    for (const stop of stops) {
      let answer!: (a: SidekickAnswer) => void;
      const h = harness({ record: on, extra: [WATCH], manifest, answers: [() => new Promise<SidekickAnswer>((r) => (answer = r)), "Newer."] });
      const run = h.ctl.ask("terminal", "x");
      await vi.waitFor(() => expect(h.asked).toHaveLength(1));
      await stop(h);
      answer({ ok: true, text: "Late." });
      expect(await run).toEqual(NO);
    }
  });
});

describe("presets (spec §2a.7)", () => {
  const manifest = { default: "off" as const, presets: [{ name: "Guard", mark: "🛡️", personality: "Calm.", purposes: [{ id: "process-guard" as const }] }] };

  it("lists the harness's presets with whether each is adopted", async () => {
    const h = harness({ record: on, manifest });
    expect(await h.ctl.presets()).toEqual([{ name: "Guard", mark: "🛡️", personality: "Calm.", purposes: [{ id: "process-guard" }], adopted: false }]);
  });

  it("adopting writes a sidekick with `preset`, and marks presets offered", async () => {
    const h = harness({ record: on, manifest });
    await h.ctl.adoptPreset("Guard");
    expect(h.records()).toContainEqual(expect.objectContaining({ type: "sidekick", name: "Guard", preset: "Guard", mark: "🛡️", personality: "Calm.", purposes: [{ id: "process-guard" }] }));
    // The implicit default is written first (Decision 2): the person keeps part 1's Sidekick next to the preset.
    expect(h.records()).toContainEqual(expect.objectContaining({ type: "sidekick", id: "sidekick" }));
    expect(h.record()).toMatchObject({ presetsOffered: true });
    expect((await h.ctl.presets())[0]?.adopted).toBe(true);
    expect(h.states.length).toBeGreaterThan(0);
  });

  it("an unknown preset is refused; adopting one twice (a double click) writes it once", async () => {
    const h = harness({ record: on, manifest });
    await expect(h.ctl.adoptPreset("Nope")).rejects.toThrow();
    expect(h.writes).toEqual([]);
    await Promise.all([h.ctl.adoptPreset("Guard"), h.ctl.adoptPreset("Guard")]);
    expect(h.records().filter((r) => r.type === "sidekick" && r.preset === "Guard")).toHaveLength(1);
  });

  it("works with Sidekick off (the sidekicks are the person's settings)", async () => {
    const h = harness({ manifest });
    await h.ctl.adoptPreset("Guard");
    expect(h.records()).toContainEqual(expect.objectContaining({ type: "sidekick", preset: "Guard" }));
    expect(h.asked).toEqual([]);
  });

  it("D0: a harness without presets → []", async () => {
    expect(await harness({ record: on }).ctl.presets()).toEqual([]);
  });

  it("D0: listing presets with no sidekick records and presetsOffered false writes nothing", async () => {
    const h = harness({ record: on, manifest });
    await h.ctl.presets();
    await h.ctl.state();
    expect(h.writes).toEqual([]);
    expect(h.record()).not.toHaveProperty("presetsOffered");
    expect(h.records().filter((r) => r.type === "sidekick")).toEqual([]);
  });
});

/** The hash readImportFiles gives one file named `name` holding `body`. */
const sha256 = (body: string, name = "a.md") => createHash("sha256").update(joinImportFiles([{ name, text: body }])).digest("hex");

describe("import (spec §2a.6)", () => {
  const RULO = { name: "Rulo", mark: "🦊", personality: "Direct.", purposes: [{ id: "mentor" }], learned: [{ text: "Prefers short answers.", level: "you" }], skipped: ["Tool permissions"] };

  it("converts pasted text to a draft sidekick plus learned items; nothing is saved yet", async () => {
    const h = harness({ record: on, answers: [json(RULO)] });
    const d = await h.ctl.importDraft({ kind: "paste", text: "You are Rulo. Be direct. Prefer short answers. Allow Bash." });
    expect(d).toEqual({ ok: true, draft: { name: "Rulo", mark: "🦊", personality: "Direct.", purposes: [{ id: "mentor" }], source: { kind: "paste" } }, learned: [{ text: "Prefers short answers.", level: "you" }], skipped: ["Tool permissions"] });
    expect(h.writes).toEqual([]);
    expect(h.appWrites).toEqual([]);
    expect(h.logged.at(-1)).toMatchObject({ moment: "import" });
    // A one-off session in its own folder, standard tier, its own brief; closed right after.
    expect(h.sessions).toEqual(["import"]);
    expect(h.closed).toEqual(["s1"]);
    expect(h.briefs[0]).toContain("# Import");
    expect(h.asked[0]).toContain("<instructions>\nYou are Rulo.");
  });

  it("works with Sidekick off (it's Settings), but needs the engine notice; D0: nothing written, no event", async () => {
    const off = harness({ answers: [json(RULO)] });
    expect(await off.ctl.importDraft({ kind: "paste", text: "You are Rulo." })).toMatchObject({ ok: true });
    expect(off.writes).toEqual([]);
    expect(off.events).toEqual([]);
    const unnoticed = harness({ noticed: false, answers: [json(RULO)] });
    expect(await unnoticed.ctl.importDraft({ kind: "paste", text: "You are Rulo." })).toEqual({ ok: false, reason: "unavailable" });
    expect(unnoticed.opened).toEqual([]);
  });

  it("a paste over 64 KB or blank never reaches the model; a bad reply fails", async () => {
    const h = harness({ record: on, answers: ["nope"] });
    expect(await h.ctl.importDraft({ kind: "paste", text: "x".repeat(64 * 1024 + 1) })).toEqual({ ok: false, reason: "too-big" });
    expect(await h.ctl.importDraft({ kind: "paste", text: "  \n " })).toEqual({ ok: false, reason: "empty" });
    expect(h.opened).toEqual([]);
    expect(await h.ctl.importDraft({ kind: "paste", text: "You are Rulo." })).toEqual({ ok: false, reason: "failed" });
  });

  it("files: the draft keeps the paths and hash; a refused file is never read and no turn runs", async () => {
    const h = harness({ record: on, answers: [json(RULO)], files: { "/n/a.md": "You are Rulo.", "/hh-test-home/.claude/CLAUDE.md": "secret" }, picked: ["/n/a.md"] });
    const pick = await h.ctl.pickFiles();
    expect(pick).toEqual({ token: expect.stringMatching(/^[0-9a-f]{32}$/), files: ["a.md"] });
    const d = await h.ctl.importDraft({ kind: "files", token: pick!.token });
    expect(d).toMatchObject({ ok: true, draft: { source: { kind: "files", paths: ["/n/a.md"], hash: sha256("You are Rulo.") } } });
    expect(h.asked[0]).toContain('<file name="a.md">\nYou are Rulo.\n</file>');
    const refused = harness({ record: on, files: { "/n/a.md": "x", "/hh-test-home/.claude/CLAUDE.md": "secret" }, picked: ["/n/a.md", "/hh-test-home/.claude/CLAUDE.md"] });
    expect(await refused.ctl.importDraft({ kind: "files", token: (await refused.ctl.pickFiles())!.token })).toEqual({ ok: false, reason: "engine-settings" });
    expect(refused.imported).toEqual([]);
    expect(refused.opened).toEqual([]);
  });

  it("files only through a pick's token: unknown, reused, expired or another base's token reads nothing", async () => {
    const h = harness({ record: on, answers: [json(RULO), json(RULO)], files: { "/n/a.md": "You are Rulo." }, picked: ["/n/a.md"] });
    // Raw paths are not an input (the IPC drops them; the controller has no path to read).
    expect(await h.ctl.importDraft({ kind: "files", paths: ["/n/a.md"] } as never)).toEqual({ ok: false, reason: "expired" });
    expect(await h.ctl.importDraft({ kind: "files", token: "f".repeat(32) })).toEqual({ ok: false, reason: "expired" });
    const pick = (await h.ctl.pickFiles())!;
    expect(await h.ctl.importDraft({ kind: "files", token: pick.token })).toMatchObject({ ok: true });
    expect(await h.ctl.importDraft({ kind: "files", token: pick.token })).toEqual({ ok: false, reason: "expired" });
    expect(h.imported).toEqual(["/n/a.md"]);
    // A newer pick replaces the older one; a cancelled one drops it.
    const older = (await h.ctl.pickFiles())!;
    const newer = (await h.ctl.pickFiles())!;
    expect(await h.ctl.importDraft({ kind: "files", token: older.token })).toEqual({ ok: false, reason: "expired" });
    expect(newer.token).not.toBe(older.token);
    // Too old.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const stale = (await h.ctl.pickFiles())!;
      vi.setSystemTime(Date.now() + 10 * 60_000 + 1);
      expect(await h.ctl.importDraft({ kind: "files", token: stale.token })).toEqual({ ok: false, reason: "expired" });
    } finally {
      vi.useRealTimers();
    }
    // Another profile's base: a profile switch drops the pick.
    const moved = (await h.ctl.pickFiles())!;
    h.deps.setup = async () => ({ engineId: "claude", base: "/other-base" });
    expect(await h.ctl.importDraft({ kind: "files", token: moved.token })).toEqual({ ok: false, reason: "expired" });
    expect(h.imported).toEqual(["/n/a.md"]);
    const cancelled = harness({ record: on, picked: [] });
    expect(await cancelled.ctl.pickFiles()).toBeNull();
  });

  it("original: a stored sidekick's own files read again, never paths the renderer names", async () => {
    const rulo = { id: "rulo", type: "sidekick" as const, name: "Rulo", mark: "🦊", personality: "", purposes: [{ id: "mentor" as const }], order: 0, source: { kind: "files" as const, paths: ["/n/a.md"], hash: sha256("v1") } };
    const h = harness({ record: on, extra: [rulo], answers: [json(RULO)], files: { "/n/a.md": "v2" } });
    expect(await h.ctl.importDraft({ kind: "original", sidekickId: "rulo" })).toMatchObject({ ok: true, draft: { source: { kind: "files", paths: ["/n/a.md"] } } });
    expect(await h.ctl.importDraft({ kind: "original", sidekickId: "nobody" })).toEqual({ ok: false, reason: "failed" });
    expect(h.imported).toEqual(["/n/a.md"]);
  });

  it("original: only a stored source with a content hash is read again; an extensionless path only when picked this session", async () => {
    const def = (id: string, source: unknown) => ({ id, type: "sidekick" as const, name: id, mark: "🦊", personality: "", purposes: [{ id: "mentor" as const }], order: 0, source: source as never });
    // The agent can edit sidekick.json: no hash, a bad hash, a relative path, too many paths or a key with no extension.
    const planted = [
      def("nohash", { kind: "files", paths: ["/n/a.md"] }),
      def("badhash", { kind: "files", paths: ["/n/a.md"], hash: "x" }),
      def("relative", { kind: "files", paths: ["n/a.md"], hash: sha256("v1") }),
      def("many", { kind: "files", paths: ["/n/a.md", "/n/a.md", "/n/a.md", "/n/a.md", "/n/a.md"], hash: sha256("v1") }),
      def("key", { kind: "files", paths: ["/n/id_ed25519"], hash: sha256("v1", "id_ed25519") }),
    ];
    const h = harness({ record: on, extra: planted, answers: [json(RULO), json(RULO)], files: { "/n/a.md": "v1", "/n/id_ed25519": "secret", "/n/notes": "You are Rulo." }, picked: ["/n/notes"] });
    for (const k of planted) {
      expect(await h.ctl.importDraft({ kind: "original", sidekickId: k.id })).toEqual({ ok: false, reason: "failed" });
      expect(await h.ctl.checkSidekick(k.id)).toBe("none");
    }
    expect(h.imported).toEqual([]);
    expect(h.opened).toEqual([]);
    // An extensionless file the person picked: its own import and its check this session read it.
    const d = await h.ctl.importDraft({ kind: "files", token: (await h.ctl.pickFiles())!.token });
    if (!d.ok) throw new Error("no draft");
    expect(await h.ctl.checkOriginal(d.draft.source)).toBe("unchanged");
    expect(h.imported).toEqual(["/n/notes", "/n/notes"]);
    // Another session (a new controller) doesn't read it again from the stored source alone.
    const later = harness({ record: on, extra: [def("notes", d.draft.source)], files: { "/n/notes": "You are Rulo." } });
    expect(await later.ctl.checkSidekick("notes")).toBe("none");
    expect(later.imported).toEqual([]);
  });

  it("a hung file read ends with the import's timeout", async () => {
    const h = harness({ record: on, picked: ["/n/a.md"], importMs: 20 });
    (h.deps as { importFiles: SidekickDeps["importFiles"] }).importFiles = (_paths, signal) => new Promise((ok) => signal.addEventListener("abort", () => ok({ ok: false, reason: "unreadable", file: "a.md" })));
    expect(await h.ctl.importDraft({ kind: "files", token: (await h.ctl.pickFiles())!.token })).toEqual({ ok: false, reason: "unreadable", file: "a.md" });
    expect(h.opened).toEqual([]);
  });

  it("a newer import, a profile switch or closing ends a running one; a hung turn times out", async () => {
    const h = harness({ record: on, answers: [slow, json(RULO)] });
    const first = h.ctl.importDraft({ kind: "paste", text: "One" });
    await vi.waitFor(() => expect(h.asked).toHaveLength(1));
    const second = h.ctl.importDraft({ kind: "paste", text: "Two" });
    expect(await first).toEqual({ ok: false, reason: "cancelled" });
    expect(await second).toMatchObject({ ok: true });
    const closing = harness({ record: on, answers: [slow] });
    const run = closing.ctl.importDraft({ kind: "paste", text: "One" });
    await vi.waitFor(() => expect(closing.asked).toHaveLength(1));
    await closing.ctl.close();
    expect(await run).toEqual({ ok: false, reason: "cancelled" });
    const hung = harness({ record: on, answers: [slow], importMs: 20 });
    expect(await hung.ctl.importDraft({ kind: "paste", text: "One" })).toEqual({ ok: false, reason: "failed" });
    expect(hung.closed).toEqual(["s1"]);
  });

  it("checkOriginal: same hash → unchanged; different → changed; a refused or missing file → gone", async () => {
    const h = harness({ record: on, files: { "/n/a.md": "v2", "/hh-test-home/.codex/AGENTS.md": "v2" } });
    expect(await h.ctl.checkOriginal({ kind: "files", paths: ["/n/a.md"], hash: sha256("v2") })).toBe("unchanged");
    expect(await h.ctl.checkOriginal({ kind: "files", paths: ["/n/a.md"], hash: sha256("v1") })).toBe("changed");
    expect(await h.ctl.checkOriginal({ kind: "files", paths: ["/n/gone.md"], hash: sha256("v1") })).toBe("gone");
    expect(await h.ctl.checkOriginal({ kind: "files", paths: ["/hh-test-home/.codex/AGENTS.md"], hash: sha256("v2", "AGENTS.md") })).toBe("gone");
    expect(h.imported).not.toContain("/hh-test-home/.codex/AGENTS.md");
    expect(await h.ctl.checkOriginal({ kind: "paste" })).toBe("none");
  });

  it("checkSidekick looks the source up by id; pickFiles reads nothing", async () => {
    const rulo = { id: "rulo", type: "sidekick" as const, name: "Rulo", mark: "🦊", personality: "", purposes: [{ id: "mentor" as const }], order: 0, source: { kind: "files" as const, paths: ["/n/a.md"], hash: sha256("v1") } };
    const h = harness({ record: on, extra: [rulo], files: { "/n/a.md": "v2" }, picked: ["/n/a.md"] });
    expect(await h.ctl.checkSidekick("rulo")).toBe("changed");
    expect(await h.ctl.checkSidekick("nobody")).toBe("none");
    expect(await h.ctl.pickFiles()).toEqual({ token: expect.any(String), files: ["a.md"] });
    expect(h.imported).toEqual(["/n/a.md"]);
  });

  it("saveSidekick writes the draft with its source and the learned items as the person's; works with Sidekick off", async () => {
    const h = harness({ answers: [json(RULO)], files: { "/n/a.md": "You are Rulo." }, picked: ["/n/a.md"] });
    const d = await h.ctl.importDraft({ kind: "files", token: (await h.ctl.pickFiles())!.token });
    if (!d.ok) throw new Error("no draft");
    // The IPC checks the draft as a record before it reaches the controller.
    const draft = d.draft as SidekickInput;
    const info = await h.ctl.saveSidekick(draft, d.learned);
    expect(info).toEqual({ id: "rulo", name: "Rulo", mark: "🦊" });
    expect(h.records()).toContainEqual(expect.objectContaining({ type: "sidekick", id: "rulo", source: { kind: "files", paths: ["/n/a.md"], hash: sha256("You are Rulo.") } }));
    expect(h.records().filter((r) => r.type === "learned")).toEqual([expect.objectContaining({ text: "Prefers short answers.", level: "you", source: "person" })]);
    // Saving it again (the original changed, the person brought the changes) never doubles a learned item.
    await h.ctl.saveSidekick({ ...draft, id: "rulo", personality: "Blunt." }, d.learned);
    expect(h.records().filter((r) => r.type === "learned")).toHaveLength(1);
    expect(h.records()).toContainEqual(expect.objectContaining({ id: "rulo", personality: "Blunt." }));
    expect(h.states.length).toBeGreaterThan(0);
  });

  it("saveSidekick refuses a files source this app never read (the renderer can't plant paths to check later)", async () => {
    const h = harness({ record: on });
    const planted = { name: "Rulo", mark: "🦊", personality: "", purposes: [{ id: "mentor" as const }], source: { kind: "files" as const, paths: ["/etc/hosts"], hash: sha256("x") } };
    await expect(h.ctl.saveSidekick(planted)).rejects.toThrow();
    expect(h.writes).toEqual([]);
    // A paste has nothing to check: saved as given.
    await h.ctl.saveSidekick({ ...planted, source: { kind: "paste" } });
    expect(h.records()).toContainEqual(expect.objectContaining({ id: "rulo", source: { kind: "paste" } }));
  });

  it("saveSidekick writes the learned items first: a failed one writes no sidekick, and the retry doubles nothing", async () => {
    const h = harness({ record: on });
    const def = { name: "Rulo", mark: "🦊", personality: "", purposes: [{ id: "mentor" as const }], source: { kind: "paste" as const } };
    const learned = [
      { text: "Prefers short answers.", level: "you" as const },
      { text: "Cites sources.", level: "harness" as const },
    ];
    const put = h.deps.store.put.bind(h.deps.store);
    const spy = vi.spyOn(h.deps.store, "put").mockImplementation(async (r) => {
      if (r.type === "learned" && r.text === "Cites sources.") throw new Error("disk full");
      return put(r);
    });
    await expect(h.ctl.saveSidekick(def, learned)).rejects.toThrow();
    expect(h.records().filter((r) => r.type === "sidekick")).toEqual([]);
    spy.mockRestore();
    await h.ctl.saveSidekick(def, learned);
    // One Rulo (no `rulo-2`), beside the default sidekick a first save seeds.
    expect(h.records().filter((r) => r.type === "sidekick" && r.name === "Rulo").map((r) => r.id)).toEqual(["rulo"]);
    expect(h.records().filter((r) => r.type === "learned").map((r) => r.text)).toEqual(["Prefers short answers.", "Cites sources."]);
  });

  it("saveSidekick keeps a stored files source on an edit of that sidekick", async () => {
    const source = { kind: "files" as const, paths: ["/n/a.md"], hash: sha256("v1") };
    const rulo = { id: "rulo", type: "sidekick" as const, name: "Rulo", mark: "🦊", personality: "", purposes: [{ id: "mentor" as const }], order: 0, source };
    const h = harness({ record: on, extra: [rulo] });
    await h.ctl.saveSidekick({ id: "rulo", name: "Rulo", mark: "🦊", personality: "Calm.", purposes: [{ id: "mentor" }], source });
    expect(h.records()).toContainEqual(expect.objectContaining({ id: "rulo", personality: "Calm.", source }));
  });
});
