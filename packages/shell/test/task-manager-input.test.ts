import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
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
    markAnswered: async (chat, answer) => void marked.push({ chat, answer }),
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
