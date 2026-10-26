import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ModelProfile } from "@humanharness/engines";
import { type InputBlock, answerMessage, defineBlock, z } from "@humanharness/harness-sdk";
import type { Event } from "@humanharness/runtime";
import type { TaskView } from "@humanharness/ui/client";
import { type TaskDeps, TaskManager } from "../src/main/task-manager";
import { CHECKPOINT_PROMPT } from "../src/main/task-prompts";
import { TaskStore, type TasksFile, emptyTasks } from "../src/main/task-store";
import type { TurnOptions } from "../src/main/turn-controller";

const commit = defineBlock({
  description: "Commit.",
  visible: true,
  schema: z.object({ question: z.string() }),
  input: z.object({ why: z.string().min(1) }),
  inputUi: { why: { label: { es: "Por qué", en: "Why" } } },
  skippable: true,
  example: { question: "q" },
}) as InputBlock;
const ok: Event = { type: "done", ok: true };
const cancelled: Event = { type: "done", ok: false, error: { code: "cancelled" } };
const shown = (id: string): Event => ({ type: "block", name: "commit_answer", data: { question: "¿Por qué?" }, id });
const NOW = "2026-10-25T10:00:00.000Z";

/** A task manager over memory, for a harness whose `commit_answer` block the person answers. */
function setup(
  opts: {
    script?: Event[][];
    state?: TasksFile;
    /** false: a harness with no input block (spec D0). */
    inputs?: false | Record<string, InputBlock>;
    gate?: Promise<void>;
    sendError?: Error;
    saveAnswer?: TaskDeps["saveAnswer"];
    markAnswered?: TaskDeps["markAnswered"];
    scoped?: boolean;
  } = {},
) {
  let state = opts.state ?? emptyTasks();
  const script = [...(opts.script ?? [])];
  const turns: { message: string; options: TurnOptions }[] = [];
  const views: TaskView[] = [];
  const emitted: Event[] = [];
  const marked: unknown[] = [];
  let busy = false;
  let n = 0;
  const manager = new TaskManager({
    store: {
      load: async () => structuredClone(state),
      save: async (s) => {
        state = structuredClone(s);
      },
    },
    turns: {
      isBusy: () => busy,
      cancel: () => {},
      send: async (message, options) => {
        if (opts.sendError) throw opts.sendError;
        busy = true;
        turns.push({ message, options });
        await opts.gate;
        for (const e of script.shift() ?? [ok]) options.onEvent?.(e);
        busy = false;
      },
    },
    actions: { practice: { label: { es: "Practicar", en: "Practice" } } },
    path: ["practice"],
    readPrompt: async () => "# Task: practice\n\n{{notesIndex}}",
    language: async () => "en",
    engine: async () => "claude",
    notes: async () => [],
    writeNote: async () => {},
    endSession: async () => {},
    changed: (v) => views.push(v),
    emit: (e) => void emitted.push(e),
    ...(opts.inputs === false ? {} : { inputBlocks: opts.inputs ?? { commit_answer: commit } }),
    markAnswered: opts.markAnswered ?? (async (chat, answer) => {
      marked.push({ chat, answer });
      return true;
    }),
    ...(opts.scoped ? { scoped: true, scopeExists: async (id: string) => id === "fracciones" } : {}),
    ...(opts.saveAnswer ? { saveAnswer: opts.saveAnswer } : {}),
    now: () => new Date(NOW),
    newId: () => `t${++n}`,
  });
  return { manager, turns, views, emitted, marked, state: () => state };
}

describe("TaskManager: the pending input", () => {
  it("records the input block a run turn shows, while the turn runs, and the view names it", async () => {
    const t = setup({ script: [[shown("t1:0:0"), ok]] });
    await t.manager.start("practice");
    expect(t.turns[0].options.turn).toBe(0);
    expect(t.state().current?.pendingInput).toEqual({ blockId: "t1:0:0", block: "commit_answer", shownAt: NOW });
    // The window knew before the turn ended: the first view naming it still shows the task running.
    expect(t.views.find((v) => v.current?.pendingInput)?.current?.status).toBe("running");
    expect(t.views.at(-1)?.current).toMatchObject({ status: "waiting", pendingInput: "t1:0:0" });
  });

  it("a newer input block replaces it (D5); a typed follow-up keeps it", async () => {
    const t = setup({ script: [[shown("t1:0:0"), shown("t1:0:1"), ok], [ok]] });
    await t.manager.start("practice");
    expect(t.state().current?.pendingInput?.blockId).toBe("t1:0:1");
    await t.manager.ask("What do you mean?");
    expect(t.turns[1].options.turn).toBe(1);
    expect(t.state().current?.pendingInput?.blockId).toBe("t1:0:1");
  });

  it("D0: without input blocks, no turn number and nothing pending", async () => {
    const t = setup({ inputs: false, script: [[shown("t1:0:0"), ok]] });
    await t.manager.start("practice");
    expect(t.turns[0].options).not.toHaveProperty("turn");
    expect(t.state().current).not.toHaveProperty("pendingInput");
    expect(t.views.at(-1)?.current).not.toHaveProperty("pendingInput");
  });

  it("tasks.json keeps a well-formed pending input and drops a bad one", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "hh-pending-"));
    try {
      const store = new TaskStore(folder);
      const current = { id: "t1", status: "waiting", startedAt: "", turns: 1 };
      const write = (pendingInput: unknown) => {
        fs.mkdirSync(path.dirname(store.file), { recursive: true });
        fs.writeFileSync(store.file, JSON.stringify({ version: 1, actions: {}, current: { ...current, pendingInput } }));
      };
      write({ blockId: "t1:0:0", block: "commit_answer", shownAt: NOW });
      expect((await store.load()).current?.pendingInput).toEqual({ blockId: "t1:0:0", block: "commit_answer", shownAt: NOW });
      for (const bad of [{ blockId: "../t1:0:0", block: "commit_answer", shownAt: NOW }, { blockId: "t1:0:0", block: "Bad Name", shownAt: NOW }, "t1:0:0"]) {
        write(bad);
        expect((await store.load()).current).not.toHaveProperty("pendingInput");
      }
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});

describe("TaskManager.respond", () => {
  const profile: ModelProfile = { engine: "claude", tier: "standard", model: "sonnet", effort: "medium", cap: 1000 };
  const waiting = (extra: Record<string, unknown> = {}): TasksFile => ({
    ...emptyTasks(),
    current: {
      id: "t1",
      action: "practice",
      status: "waiting",
      startedAt: "",
      turns: 1,
      pendingInput: { blockId: "t1:0:0", block: "commit_answer", shownAt: NOW },
      ...extra,
    } as TasksFile["current"],
  });

  it("takes a valid answer: marks the chat, clears the question and sends the readable line with the JSON", async () => {
    const t = setup({ state: waiting() });
    const { accepted, done } = t.manager.respond("t1:0:0", { why: "porque sí", extra: 1 });
    expect(await accepted).toEqual({ ok: true, display: "Why: porque sí", value: { why: "porque sí" }, answeredAt: NOW });
    await done;
    expect(t.marked).toEqual([{ chat: "main", answer: { blockId: "t1:0:0", value: { why: "porque sí" }, answeredAt: NOW } }]);
    expect(t.turns).toHaveLength(1);
    expect(t.turns[0].message).toBe(answerMessage({ name: "commit_answer", blockId: "t1:0:0", value: { why: "porque sí" }, display: "Why: porque sí", language: "en" }));
    expect(t.turns[0].options).toMatchObject({ display: "Why: porque sí", followUp: true, task: "t1", turn: 1, phase: "run" });
    expect(t.state().current).not.toHaveProperty("pendingInput");
    expect(t.state().current).toMatchObject({ status: "waiting", turns: 2 });
  });

  it("takes a skip from a skippable block", async () => {
    const t = setup({ state: waiting() });
    const { accepted, done } = t.manager.respond("t1:0:0", { skipped: true });
    expect(await accepted).toMatchObject({ ok: true, display: "(skipped)", value: { skipped: true } });
    await done;
    expect(t.turns[0].message).toContain('"value":{"skipped":true}');
  });

  it("refuses a stale block, a closed question, a task that isn't waiting or no task, and runs nothing", async () => {
    const cases: [TasksFile, string][] = [
      [waiting(), "t1:0:9"],
      [waiting({ pendingInput: undefined }), "t1:0:0"],
      [waiting({ status: "closing" }), "t1:0:0"],
      [waiting({ status: "running" }), "t1:0:0"],
      [emptyTasks(), "t1:0:0"],
    ];
    for (const [state, id] of cases) {
      const t = setup({ state });
      const { accepted, done } = t.manager.respond(id, { why: "x" });
      expect(await accepted).toMatchObject({ ok: false, reason: "stale" });
      await done;
      expect(t.turns).toEqual([]);
      expect(t.marked).toEqual([]);
    }
  });

  it("refuses an invalid answer with its field errors; the question stays open", async () => {
    const t = setup({ state: waiting() });
    const { accepted, done } = t.manager.respond("t1:0:0", { why: "" });
    const r = await accepted;
    expect(r).toMatchObject({ ok: false, reason: "invalid" });
    if (!r.ok) expect(r.errors.map((e) => e.path)).toEqual(["why"]);
    await done;
    expect(t.turns).toEqual([]);
    expect(t.state().current?.pendingInput?.blockId).toBe("t1:0:0");
  });

  it("runs a due checkpoint before the answer is taken, and only once (spec §6)", async () => {
    const t = setup({ state: waiting({ profile, context: { used: 900 } }) });
    const { accepted, done } = t.manager.respond("t1:0:0", { why: "x" });
    expect((await accepted).ok).toBe(true);
    await done;
    expect(t.turns.map((x) => x.options.phase)).toEqual(["checkpoint", "run"]);
    expect(t.turns[0].message).toBe(CHECKPOINT_PROMPT);
    expect(t.marked).toHaveLength(1);
  });

  it("a stopped checkpoint takes nothing: the question stays open and the window gets no event", async () => {
    const t = setup({ state: waiting({ profile, context: { used: 900 } }), script: [[cancelled]] });
    const { accepted, done } = t.manager.respond("t1:0:0", { why: "x" });
    expect(await accepted).toMatchObject({ ok: false, reason: "stopped" });
    await done;
    expect(t.turns).toHaveLength(1);
    expect(t.marked).toEqual([]);
    expect(t.emitted).toEqual([]);
    expect(t.state().current).toMatchObject({ status: "waiting", pendingInput: { blockId: "t1:0:0" } });
  });

  it("refuses while a turn runs: both promises reject", async () => {
    let open!: () => void;
    const t = setup({ state: waiting(), gate: new Promise<void>((r) => (open = r)) });
    const first = t.manager.respond("t1:0:0", { why: "x" });
    await first.accepted;
    const second = t.manager.respond("t1:0:0", { why: "y" });
    await expect(second.accepted).rejects.toThrow("A turn is already running");
    await expect(second.done).rejects.toThrow("A turn is already running");
    open();
    await first.done;
  });

  it("a turn that can't start after the answer was taken ends the window's turn with an error", async () => {
    const t = setup({ state: waiting(), sendError: new Error("The app is closing") });
    const { accepted, done } = t.manager.respond("t1:0:0", { why: "x" });
    expect((await accepted).ok).toBe(true);
    await expect(done).rejects.toThrow("The app is closing");
    expect(t.emitted).toEqual([{ type: "done", ok: false, error: { code: "agent-crashed", detail: "The app is closing" } }]);
    // The agent never got the answer: the question is open again.
    expect(t.state().current).toMatchObject({ status: "waiting", turns: 1, pendingInput: { blockId: "t1:0:0", block: "commit_answer" } });
  });

  it("a Stop before the answer is taken refuses it: nothing changes and no turn runs", async () => {
    const t = setup({ state: waiting() });
    const { accepted, done } = t.manager.respond("t1:0:0", { why: "x" });
    t.manager.cancel();
    expect(await accepted).toMatchObject({ ok: false, reason: "stopped" });
    await done;
    expect(t.turns).toEqual([]);
    expect(t.marked).toEqual([]);
    expect(t.emitted).toEqual([]);
    expect(t.state().current?.pendingInput?.blockId).toBe("t1:0:0");
  });

  it("a Stop after the answer was taken, before its turn starts, opens the question again", async () => {
    const t = setup({ state: waiting() });
    const { accepted, done } = t.manager.respond("t1:0:0", { why: "x" });
    expect((await accepted).ok).toBe(true);
    t.manager.cancel();
    await done;
    expect(t.turns).toEqual([]);
    expect(t.emitted).toEqual([{ type: "done", ok: false, error: { code: "cancelled" } }]);
    expect(t.state().current).toMatchObject({ status: "waiting", turns: 1, pendingInput: { blockId: "t1:0:0" } });
  });

  it("a mark that fails or finds no block is logged, and the answer still goes to the agent", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const markAnswered of [
        async () => {
          throw new Error("disk full");
        },
        async () => false,
      ]) {
        errors.mockClear();
        const t = setup({ state: waiting(), markAnswered });
        const { accepted, done } = t.manager.respond("t1:0:0", { why: "x" });
        expect((await accepted).ok).toBe(true);
        await done;
        expect(t.turns).toHaveLength(1);
        expect(t.state().current).not.toHaveProperty("pendingInput");
        expect(errors).toHaveBeenCalledTimes(1);
      }
    } finally {
      errors.mockRestore();
    }
  });

  it("with scopes, the mark goes to the open scope's chat", async () => {
    const t = setup({ scoped: true, state: { ...waiting({ scope: "fracciones" }), open: "fracciones" } });
    const { accepted, done } = t.manager.respond("t1:0:0", { why: "x" });
    expect((await accepted).ok).toBe(true);
    await done;
    expect(t.marked).toEqual([{ chat: "fracciones", answer: { blockId: "t1:0:0", value: { why: "x" }, answeredAt: NOW } }]);
    expect(t.turns[0].options).toMatchObject({ chat: "fracciones", scope: "fracciones" });
  });
});

describe("TaskManager.respond: saveTo", () => {
  const cards = defineBlock({
    description: "Cards.",
    visible: true,
    schema: z.object({ prompt: z.string() }),
    input: z.object({ cards: z.array(z.object({ front: z.string(), back: z.string() })) }),
    skippable: true,
    saveTo: { collection: "flashcards", records: (v) => v.cards.map((c) => ({ id: c.front, ...c })) },
    example: { prompt: "p" },
  }) as InputBlock;
  const onSummary = (scope?: string): TasksFile => ({
    ...emptyTasks(),
    ...(scope ? { open: scope } : {}),
    current: {
      id: "t1",
      action: "practice",
      status: "waiting",
      startedAt: "",
      turns: 1,
      ...(scope ? { scope } : {}),
      pendingInput: { blockId: "t1:0:0", block: "summary", shownAt: NOW },
    },
  });

  it("writes the answer's records as the person, in the task's scope, then takes it", async () => {
    for (const scope of [undefined, "fracciones"]) {
      const saved: unknown[] = [];
      const t = setup({
        state: onSummary(scope),
        scoped: scope !== undefined,
        inputs: { summary: cards },
        saveAnswer: async (collection, records, scope) => void saved.push({ collection, records, scope }),
      });
      const { accepted, done } = t.manager.respond("t1:0:0", { cards: [{ front: "2+2", back: "4" }] });
      expect((await accepted).ok).toBe(true);
      await done;
      expect(saved).toEqual([{ collection: "flashcards", records: [{ id: "2+2", front: "2+2", back: "4" }], scope: scope ?? "main" }]);
      expect(t.turns).toHaveLength(1);
    }
  });

  it("a refused write takes nothing: no turn, no mark, the question stays open", async () => {
    const t = setup({
      state: onSummary(),
      inputs: { summary: cards },
      saveAnswer: async () => {
        throw new Error('Not a valid "flashcards" record: back: Too small');
      },
    });
    const { accepted, done } = t.manager.respond("t1:0:0", { cards: [{ front: "2+2", back: "" }] });
    expect(await accepted).toEqual({ ok: false, reason: "refused", errors: [{ path: "", message: 'Not a valid "flashcards" record: back: Too small' }] });
    await done;
    expect(t.turns).toEqual([]);
    expect(t.marked).toEqual([]);
    expect(t.emitted).toEqual([]);
    expect(t.state().current?.pendingInput?.blockId).toBe("t1:0:0");
  });

  it("a records() that throws or gives no list is refused, with nothing written and the question open", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const records of [
        () => {
          throw new Error("no cards");
        },
        () => "nope" as never,
      ]) {
        const broken = { ...cards, saveTo: { collection: "flashcards", records } } as InputBlock;
        const saved: unknown[] = [];
        const t = setup({ state: onSummary(), inputs: { summary: broken }, saveAnswer: async (...args) => void saved.push(args) });
        const { accepted, done } = t.manager.respond("t1:0:0", { cards: [] });
        expect(await accepted).toMatchObject({ ok: false, reason: "refused", errors: [{ path: "" }] });
        await done;
        expect(saved).toEqual([]);
        expect(t.turns).toEqual([]);
        expect(t.marked).toEqual([]);
        expect(t.state().current?.pendingInput?.blockId).toBe("t1:0:0");
      }
    } finally {
      errors.mockRestore();
    }
  });

  it("a skip saves nothing", async () => {
    const saved: unknown[] = [];
    const t = setup({ state: onSummary(), inputs: { summary: cards }, saveAnswer: async (...args) => void saved.push(args) });
    const { accepted, done } = t.manager.respond("t1:0:0", { skipped: true });
    expect((await accepted).ok).toBe(true);
    await done;
    expect(saved).toEqual([]);
  });
});
