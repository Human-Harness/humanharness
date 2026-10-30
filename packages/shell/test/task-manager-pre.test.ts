import { describe, expect, it, vi } from "vitest";
import type { ModelProfile } from "@humanharness/engines";
import type { Event, ToolCallView } from "@humanharness/runtime";
import type { ContextItem } from "@humanharness/ui/client";
import { approxTokens } from "../src/main/context-record";
import type { PrepareAnswer, TaskDeps } from "../src/main/task-manager";
import { PHASES, ok, profile, setup } from "./task-manager-fixture";

type PrepareCall = Parameters<NonNullable<TaskDeps["prepare"]>>[0];

const PRE = [{ tool: "list-sources", as: "sources" }];
/** The fixture's actions, with pre-steps on both. */
const ACTIONS: TaskDeps["actions"] = { session: { label: "Session", phases: PHASES, pre: PRE }, quiz: { label: "Quiz", pre: PRE } };
const TEXT = "## Prepared data\n\n### sources · list-sources\n\n```\n{\"packages\":[]}\n```";
const item = { id: "prepared:sources", kind: "prepared", label: "Prepared · sources", tokens: 100 } as unknown as ContextItem;
const view: ToolCallView = { tool: "list-sources", caller: "pre", ok: true, ms: 12, summary: "2 packages", args: "{}", accesses: [], at: "2026-10-26T10:00:00.000Z" };
const answer: PrepareAnswer = { text: TEXT, items: [item], views: [view] };

/** A recording `prepare` answering `got` (a function: called with what it was asked). */
function prepareOf(got: PrepareAnswer | ((o: PrepareCall) => Promise<PrepareAnswer>) = answer) {
  const calls: PrepareCall[] = [];
  const prepare = async (o: PrepareCall) => {
    calls.push(o);
    return typeof got === "function" ? got(o) : got;
  };
  return { calls, prepare };
}

const doneOf = (emitted: Event[]) => emitted.filter((e) => e.type === "done");

describe("pre-steps at the start (tools spec §6)", () => {
  it("D0: without prepare the first message and start are byte-identical", async () => {
    const plain = setup({ extra: { dataContext: async () => "DATA" } });
    await plain.manager.start("quiz");
    const p = prepareOf();
    // The fixture's actions declare no `pre`: a `prepare` dep is never reached.
    const hooked = setup({ extra: { dataContext: async () => "DATA", prepare: p.prepare } });
    await hooked.manager.start("quiz");
    expect(p.calls).toEqual([]);
    expect(hooked.turns[0].message).toBe(plain.turns[0].message);
    expect(hooked.state().current?.start).toEqual(plain.state().current?.start);
    const { onEvent: _a, ...hookedOptions } = hooked.turns[0].options;
    const { onEvent: _b, ...plainOptions } = plain.turns[0].options;
    expect(hookedOptions).toEqual(plainOptions);
    expect("prepared" in hooked.turns[0].options).toBe(false);
  });

  it("an action with pre calls prepare once with its action, scope, task id and first phase, before the first turn", async () => {
    let seen: { turns: number; current: unknown } | null = null;
    const calls: PrepareCall[] = [];
    const t = setup({
      extra: {
        actions: ACTIONS,
        prepare: async (o) => {
          calls.push(o);
          // The task isn't written and no turn ran yet.
          seen = { turns: t.turns.length, current: t.state().current };
          return answer;
        },
      },
    });
    await t.manager.start("session");
    expect(calls).toEqual([{ action: "session", scope: "main", task: "t1", phase: "warmup" }]);
    expect(seen).toEqual({ turns: 0, current: null });
    expect(t.state().current?.id).toBe("t1");
    expect(t.turns).toHaveLength(1);
  });

  it("an action without phases passes no phase", async () => {
    const p = prepareOf();
    const t = setup({ extra: { actions: ACTIONS, prepare: p.prepare } });
    await t.manager.start("quiz");
    expect(p.calls).toEqual([{ action: "quiz", scope: "main", task: "t1" }]);
  });

  it("the prepared text is a context part after the data tables and before the pins and the material", async () => {
    const p = prepareOf();
    const t = setup({
      extra: {
        actions: ACTIONS,
        prepare: p.prepare,
        dataContext: async () => "DATA",
        personContext: async () => ({ pinned: "PINS", items: [], excluded: new Set<string>() }),
        materialContext: async () => "MATERIAL",
      },
    });
    await t.manager.start("quiz");
    expect(t.turns[0].message).toContain(["DATA", TEXT, "PINS", "MATERIAL"].join("\n\n"));
  });

  it("its items join start after the data items, and the brief's estimate excludes them", async () => {
    const p = prepareOf();
    const pin: ContextItem = { id: "pin:main:a.md", kind: "pinned", label: "Pinned · a.md", path: "a.md", tokens: 100, scope: "main" };
    const t = setup({
      extra: {
        actions: ACTIONS,
        prepare: p.prepare,
        dataContext: async () => "DATA",
        personContext: async () => ({ pinned: "PINS", items: [pin], excluded: new Set<string>() }),
      },
    });
    await t.manager.start("quiz");
    const start = t.state().current?.start ?? [];
    expect(start.map((i) => i.id)).toEqual(["brief", "data", "prepared:sources", "pin:main:a.md"]);
    const others = start.slice(1).reduce((n, i) => n + i.tokens, 0);
    expect(start[0].tokens).toBe(Math.max(0, approxTokens(t.turns[0].message.length) - others));
  });

  it("the prepared views ride on the first turn's options", async () => {
    const p = prepareOf();
    const t = setup({ extra: { actions: ACTIONS, prepare: p.prepare } });
    await t.manager.start("quiz");
    expect(t.turns[0].options.prepared).toEqual([view]);
    await t.manager.ask("And then?");
    expect(t.turns).toHaveLength(2);
    expect("prepared" in t.turns[1].options).toBe(false);
  });

  it("an answer with no text, items or views adds nothing to the start", async () => {
    const plain = setup({ extra: { dataContext: async () => "DATA" } });
    await plain.manager.start("quiz");
    const p = prepareOf({ text: "", items: [], views: [] });
    const t = setup({ extra: { actions: ACTIONS, prepare: p.prepare, dataContext: async () => "DATA" } });
    await t.manager.start("quiz");
    expect(p.calls).toHaveLength(1);
    expect(t.turns[0].message).toBe(plain.turns[0].message);
    expect(t.state().current?.start).toEqual(plain.state().current?.start);
    expect("prepared" in t.turns[0].options).toBe(false);
  });

  it("a retried first turn (model unavailable) carries the prepared views again", async () => {
    const p = prepareOf();
    const lower: ModelProfile = { ...profile, model: "haiku", tier: "light" };
    const t = setup({
      script: [[{ type: "done", ok: false, error: { code: "model-unavailable" } }], [ok]],
      extra: { actions: ACTIONS, prepare: p.prepare, fallbackFor: async (_p, tried) => (tried.length === 0 ? lower : null) },
    });
    await t.manager.start("quiz");
    expect(t.turns).toHaveLength(2);
    expect(t.turns[0].options.prepared).toEqual([view]);
    // The held attempt never reached the chat: the retry shows the group.
    expect(t.turns[1].options.prepared).toEqual([view]);
    expect(p.calls).toHaveLength(1);
  });

  it("a required failure starts nothing: no task in tasks.json, no turn, the window gets prepare-failed with the detail", async () => {
    const p = prepareOf({ text: "", items: [], views: [view], failed: "due-today failed: boom" });
    const t = setup({ extra: { actions: ACTIONS, prepare: p.prepare } });
    await t.manager.start("quiz");
    expect(t.state().current).toBeNull();
    expect(t.turns).toEqual([]);
    expect(doneOf(t.emitted)).toEqual([{ type: "done", ok: false, error: { code: "prepare-failed", detail: "due-today failed: boom" } }]);
    expect(t.manager.isBusy()).toBe(false);
  });

  it("after a required failure, starting again runs prepare again", async () => {
    let n = 0;
    const p = prepareOf(async () => (++n === 1 ? { text: "", items: [], views: [], failed: "due-today failed: boom" } : answer));
    const t = setup({ extra: { actions: ACTIONS, prepare: p.prepare } });
    await t.manager.start("quiz");
    await t.manager.start("quiz");
    expect(p.calls).toHaveLength(2);
    expect(t.turns).toHaveLength(1);
    expect(t.turns[0].message).toContain(TEXT);
  });

  it("a Stop while preparing starts nothing once prepare returns", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let asked!: () => void;
    const reached = new Promise<void>((r) => {
      asked = r;
    });
    const p = prepareOf(async () => {
      asked();
      await gate;
      return answer;
    });
    const t = setup({ extra: { actions: ACTIONS, prepare: p.prepare } });
    const started = t.manager.start("quiz");
    await reached;
    t.manager.cancel();
    release();
    await started;
    expect(t.turns).toEqual([]);
    expect(t.state().current).toBeNull();
    expect(doneOf(t.emitted)).toEqual([{ type: "done", ok: false, error: { code: "cancelled" } }]);
  });

  it("a prepare that throws is logged and the start fails with a fixed text, never the thrown message", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const p = prepareOf(async () => {
        throw new Error("token sk-secret-123 at /Users/me/.harness/tools");
      });
      const t = setup({ extra: { actions: ACTIONS, prepare: p.prepare } });
      await t.manager.start("quiz");
      expect(t.turns).toEqual([]);
      expect(t.state().current).toBeNull();
      const done = doneOf(t.emitted);
      expect(done).toEqual([{ type: "done", ok: false, error: { code: "prepare-failed", detail: "the pre-steps could not run" } }]);
      expect(JSON.stringify(done)).not.toContain("sk-secret");
      expect(logged).toHaveBeenCalledWith("Could not run the pre-steps", expect.any(Error));
    } finally {
      logged.mockRestore();
    }
  });

  it("a resumed task (after Move folder) never calls prepare", async () => {
    const p = prepareOf();
    const t = setup({ extra: { actions: ACTIONS, prepare: p.prepare } });
    await t.manager.start("quiz");
    expect(p.calls).toHaveLength(1);
    await t.manager.resumeFromNotes();
    await t.manager.ask("And the blocks?");
    expect(p.calls).toHaveLength(1);
    expect(t.turns).toHaveLength(2);
    expect(t.turns[1].message).not.toContain("## Prepared data");
    expect("prepared" in t.turns[1].options).toBe(false);
    expect((t.state().current?.start ?? []).map((i) => i.id)).not.toContain("prepared:sources");
  });

  it("a free question and a review task never call prepare", async () => {
    const p = prepareOf();
    const t = setup({ extra: { actions: ACTIONS, prepare: p.prepare } });
    await t.manager.ask("Where is the chat kept?");
    expect(t.turns).toHaveLength(1);
    await t.manager.finish();
    await t.manager.reviewRound({ path: "docs/a.md", title: "A", message: "Look at this", tier: "standard" });
    expect(t.state().current?.review).toBe("docs/a.md");
    expect(p.calls).toEqual([]);
  });

  it("a plugin's prepared task never calls prepare", async () => {
    const p = prepareOf();
    const t = setup({ extra: { actions: ACTIONS, prepare: p.prepare } });
    await t.manager.startPrepared({ prompt: "Do this", display: "Do this", tier: "standard", plugin: "jira" });
    expect(t.turns).toHaveLength(1);
    expect(p.calls).toEqual([]);
  });
});
