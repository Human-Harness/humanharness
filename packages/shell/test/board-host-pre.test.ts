import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Event, HarnessWorkspace, SessionSlot, SlotOptions, SlotRef, SlotSendOptions, TurnAttribution } from "@humanharness/runtime";
import type { AppConfig, ChatEntry, ChatNotice, TaskSummary, TasksState } from "@humanharness/protocol";
import { type BoardHostDeps, conflictOf, createBoardHost, hostMode } from "../src/main/board-host";
import { type InputBlock, defineBlock, z } from "@humanharness/harness-sdk";
import { ChatLog } from "../src/main/chat-log";
import type { TaskDeps } from "../src/main/task-manager";
import type { TurnDeps } from "../src/main/turn-controller";
import { TaskStore, emptyTasks } from "../src/main/task-store";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-board-host-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const ok: Event = { type: "done", ok: true };
const flush = () => new Promise((r) => setTimeout(r, 0));
/** Resolves once `check` holds (polls every 5 ms, up to 2 s). */
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  if (!check()) throw new Error("timed out");
}

/** One turn a fake slot runs: the test ends it with `end`. */
interface FakeTurn {
  slot: string;
  message: string;
  emit: (e: Event) => void;
  options: SlotSendOptions | undefined;
  /** Emits `events`; an `attribution` reaches `onAttribution` just before the `done`, as the workspace's slot does. */
  end: (events?: Event[], attribution?: TurnAttribution) => void;
}

/**
 * A host over a temp folder whose workspace is a fake: each slot's `send` waits until the test ends its turn. Lanes are
 * real TaskManagers and TurnControllers over the folder's tasks.json and per-task chats.
 */
function host(
  o: {
    tasks?: number;
    engineId?: string;
    config?: Partial<AppConfig>;
    onSession?: (key: string, o: SlotOptions) => void;
    chatLogNull?: () => boolean;
    attention?: BoardHostDeps["attention"];
    saveOwn?: BoardHostDeps["saveOwn"];
    /** More task deps (Sidekick's hooks, phased actions). */
    taskDeps?: Partial<TaskDeps>;
    /** Turn deps' descriptors laid over the defaults (a getter stays a getter). */
    turnDeps?: Partial<TurnDeps>;
    /** The harness declares scopes. */
    scoped?: boolean;
  } = {},
) {
  const base = fs.mkdtempSync(path.join(root, "b-"));
  fs.mkdirSync(path.join(base, ".harness"), { recursive: true });
  const turns: FakeTurn[] = [];
  const slots = new Map<string, SessionSlot & { sleeps: number; options: SlotOptions }>();
  let refresh: () => Promise<boolean> = async () => true;
  let running = 0;
  let asked: ((slot: SlotRef) => Promise<{ id: string } | null>) | null = null;
  const workspace: HarnessWorkspace = {
    history: null as never,
    linkedHistory: async () => null,
    linkedRunningPaths: async () => [],
    anyRunning: () => running > 0,
    runningPaths: async () => [],
    refreshInstructions: () => refresh(),
    close: async () => {
      for (const s of [...slots.values()]) await s.close();
    },
    openSlot: async (so) => {
      let busy = false;
      const slot = {
        key: so.key,
        options: so,
        sleeps: 0,
        isBusy: () => busy,
        send(message: string, emit: (e: Event) => void, options?: SlotSendOptions) {
          if (busy) throw new Error("A turn is already running");
          busy = true;
          running++;
          let end!: () => void;
          const done = new Promise<void>((r) => (end = r));
          turns.push({
            slot: so.key,
            message,
            emit,
            options,
            end: (events = [ok], attribution) => {
              running--;
              busy = false;
              for (const e of events) {
                if (e.type === "done" && attribution) options?.onAttribution?.(attribution);
                emit(e);
              }
              end();
            },
          });
          o.onSession?.(so.key, so);
          return { cancel: () => {}, done };
        },
        endSession: async () => {},
        async sleep() {
          if (busy) return;
          busy = true;
          slot.sleeps++;
          await flush();
          busy = false;
        },
        close: async () => void slots.delete(so.key),
      };
      slots.set(so.key, slot);
      return slot;
    },
  };
  const window: Event[] = [];
  const sent: { channel: string; value: unknown }[] = [];
  const config: AppConfig = { engineId: o.engineId ?? "claude", parallel: { tasks: o.tasks ?? 2, jobs: 1 }, ...o.config };
  const taskDeps: TaskDeps = {
    store: null as never,
    turns: null as never,
    actions: { write: { label: "Write" } },
    path: [],
    readPrompt: async (action) => `# Task: ${action}`,
    language: async () => "en",
    engine: async () => config.engineId ?? "",
    notes: async () => [],
    writeNote: async () => {},
    endSession: async () => {},
    changed: () => {},
    ...o.taskDeps,
  };
  const deps: BoardHostDeps = {
    suggested: { tasks: 1, jobs: 1 },
    config: async () => config,
    base: async () => base,
    taskStoreOptions: () => ({}),
    openWorkspace: async (runningTask) => {
      asked = runningTask;
      return workspace;
    },
    turnDeps: Object.defineProperties(
      { ensureRuntime: async () => null, chatLog: async () => null, stateBlocks: () => new Set(), emit: () => {} },
      Object.getOwnPropertyDescriptors(o.turnDeps ?? {}),
    ) as TurnDeps,
    checkTurn: async () => {},
    chatLog: async (chat, task) => (o.chatLogNull?.() ? null : new ChatLog(base, config.engineId, chat, task)),
    taskDeps,
    scoped: () => o.scoped === true,
    scopeExists: async () => true,
    emit: (e) => window.push(e),
    send: (channel, value) => sent.push({ channel, value }),
    label: (t) => t.action ?? t.question ?? "",
    ...(o.attention ? { attention: o.attention } : {}),
    ...(o.saveOwn ? { saveOwn: o.saveOwn } : {}),
  };
  const h = createBoardHost(deps, { engineId: config.engineId, parallel: config.parallel });
  const lastState = () => [...sent].reverse().find((s) => s.channel === "hh:tasksChange")?.value as TasksState | undefined;
  return {
    h,
    base,
    turns,
    slots,
    window,
    sent,
    lastState,
    taskDeps,
    config,
    setRefresh: (fn: () => Promise<boolean>) => (refresh = fn),
    setRunning: (n: number) => (running = n),
    askedBy: (key: string) => asked!({ key }),
    chat: (scope: string, task: string) => new ChatLog(base, undefined, scope, task).load(),
    file: () => new TaskStore(base).load(),
  };
}

/** The window's start the refused required pre-step leaves (tools spec §6.5, Decision 4). */
const DETAIL = "always-fails failed: boom";
const preDeps = (): Partial<TaskDeps> => ({
  actions: { write: { label: "Write" }, strict: { label: "Strict", pre: [{ tool: "always-fails", required: true }] } },
  prepare: async () => ({ text: "", items: [], views: [], failed: DETAIL }),
});
const refused: Event = { type: "done", ok: false, error: { code: "prepare-failed", detail: DETAIL } };
/** Every open-tasks push's focused task (null: none in the list). */
const focusSeen = (sent: { channel: string; value: unknown }[]) =>
  sent.filter((s) => s.channel === "hh:tasksChange").map((s) => (s.value as TasksState).tasks.find((x) => x.focused)?.id ?? null);

describe("a refused start in board mode (tools spec §6.5)", () => {
  it("from an open task's chat: the window gets the card; the lane goes; the focus goes back to that task, as the chat shows", async () => {
    const t = host({ tasks: 2, taskDeps: preDeps() });
    await t.h.interrupt();
    const a = t.h.board.start("write", "First");
    await until(() => t.turns.length === 1);
    t.turns[0].end();
    await a;
    const first = t.turns[0].slot;
    expect(t.h.board.focusedId()).toBe(first);
    t.window.length = 0;
    t.sent.length = 0;
    await t.h.board.start("strict", "Strict");
    await t.h.flush();
    await until(() => !t.h.board.isBusy());
    // The card's event reached the window (the new lane was focused when it came); no engine turn ran.
    expect(t.window).toEqual([refused]);
    expect(t.turns).toHaveLength(1);
    // Nothing was written: the lane left, the earlier task is the one shown again.
    expect(t.h.board.laneIds()).toEqual([first]);
    expect(t.h.board.focusedId()).toBe(first);
    expect((await t.file()).focus).toBe(first);
    // The window's focus never showed another task than the one on screen: its chat isn't swapped (useFocusEpoch).
    await until(() => focusSeen(t.sent).at(-1) === first);
    expect(focusSeen(t.sent).every((f) => f === first || f === null)).toBe(true);
  });

  it("from the start view with another task open: the card shows there and the focus stays on the start view", async () => {
    const t = host({ tasks: 2, taskDeps: preDeps() });
    await t.h.interrupt();
    const a = t.h.board.start("write", "First");
    await until(() => t.turns.length === 1);
    t.turns[0].end();
    await a;
    const first = t.turns[0].slot;
    await t.h.board.focus(null);
    t.window.length = 0;
    t.sent.length = 0;
    await t.h.board.start("strict", "Strict");
    await t.h.flush();
    await until(() => !t.h.board.isBusy());
    expect(t.window).toEqual([refused]);
    expect(t.h.board.laneIds()).toEqual([first]);
    expect(t.h.board.focusedId()).toBeNull();
    expect((await t.file()).focus ?? null).toBeNull();
    // No push ever showed the open task focused: the start view's chat (and its card) stays.
    await t.h.flush();
    expect(focusSeen(t.sent).every((f) => f === null)).toBe(true);
  });
});
