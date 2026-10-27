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
  return { ctl: new SidekickController(deps), asked, opened, closed, logged, briefs, states, setTask: (t: typeof task) => (task = t), record: () => record };
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
