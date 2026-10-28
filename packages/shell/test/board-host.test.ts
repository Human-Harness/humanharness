import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Event, HarnessWorkspace, SessionSlot, SlotOptions, SlotRef } from "@humanharness/runtime";
import type { AppConfig, ChatEntry, TasksState } from "@humanharness/ui/client";
import { type BoardHostDeps, RESUME_FAILED, createBoardHost, hostMode } from "../src/main/board-host";
import { ChatLog } from "../src/main/chat-log";
import type { TaskDeps } from "../src/main/task-manager";
import { TaskStore } from "../src/main/task-store";

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
  end: (events?: Event[]) => void;
}

/**
 * A host over a temp folder whose workspace is a fake: each slot's `send` waits until the test ends its turn. Lanes are
 * real TaskManagers and TurnControllers over the folder's tasks.json and per-task chats.
 */
function host(o: { tasks?: number; engineId?: string; config?: Partial<AppConfig>; onSession?: (key: string, o: SlotOptions) => void } = {}) {
  const base = fs.mkdtempSync(path.join(root, "b-"));
  fs.mkdirSync(path.join(base, ".harness"), { recursive: true });
  const turns: FakeTurn[] = [];
  const slots = new Map<string, SessionSlot & { sleeps: number; options: SlotOptions }>();
  let refresh: () => Promise<boolean> = async () => true;
  let running = 0;
  let asked: ((slot: SlotRef) => Promise<{ id: string } | null>) | null = null;
  const workspace: HarnessWorkspace = {
    history: null as never,
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
        send(message: string, emit: (e: Event) => void) {
          if (busy) throw new Error("A turn is already running");
          busy = true;
          running++;
          let end!: () => void;
          const done = new Promise<void>((r) => (end = r));
          turns.push({
            slot: so.key,
            message,
            emit,
            end: (events = [ok]) => {
              running--;
              busy = false;
              for (const e of events) emit(e);
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
    turnDeps: { ensureRuntime: async () => null, chatLog: async () => null, stateBlocks: () => new Set(), emit: () => {} },
    checkTurn: async () => {},
    chatLog: async (chat, task) => new ChatLog(base, config.engineId, chat, task),
    taskDeps,
    scoped: () => false,
    scopeExists: async () => true,
    emit: (e) => window.push(e),
    send: (channel, value) => sent.push({ channel, value }),
    label: (t) => t.action ?? t.question ?? "",
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

describe("hostMode (D7)", () => {
  it("plain without parallel or jobs; board with parallel", () => {
    expect(hostMode({})).toBe("plain");
    expect(hostMode({ parallel: { tasks: 1, jobs: 1 } })).toBe("board");
  });

  it("D0: the chat move and the board host run only in board mode", () => {
    const main = path.resolve(__dirname, "../src/main");
    const files = fs.readdirSync(main).filter((f) => f.endsWith(".ts"));
    const naming = (re: RegExp) => files.filter((f) => re.test(fs.readFileSync(path.join(main, f), "utf8"))).sort();
    // Only the host moves the chats; only index.ts builds the host.
    expect(naming(/\bmigrateChats\(/)).toEqual(["board-host.ts", "chat-migration.ts"]);
    expect(naming(/\bcreateBoardHost\(/)).toEqual(["board-host.ts", "index.ts"]);
    const index = fs.readFileSync(path.join(main, "index.ts"), "utf8");
    // index.ts builds it in one place, and calls that only when the harness is in board mode.
    expect([...index.matchAll(/\bbuildBoardHost\(/g)]).toHaveLength(2);
    expect(index).toMatch(/if \(hostMode\(harness\) === "board"\) \{\n\s*const board = buildBoardHost\(/);
  });
});

describe("the board host (parallel spec §6, §7)", () => {
  it("two lanes' first turns both run under cap 2: their sends overlap; each writes its own chat", async () => {
    const t = host({ tasks: 2 });
    await t.h.interrupt();
    const a = t.h.board.start("write", "First");
    await until(() => t.turns.length === 1);
    const b = t.h.board.start("write", "Second");
    await until(() => t.turns.length === 2);
    // Both are in their engine turn at once.
    expect(t.slots.get(t.turns[0].slot)?.isBusy()).toBe(true);
    expect(t.slots.get(t.turns[1].slot)?.isBusy()).toBe(true);
    expect(t.turns[0].slot).not.toBe(t.turns[1].slot);
    t.turns[1].end();
    t.turns[0].end();
    await Promise.all([a, b]);
    const ids = (await t.file()).lanes!.map((l) => l.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids)).toEqual(new Set([t.turns[0].slot, t.turns[1].slot]));
    expect((await t.chat("main", t.turns[0].slot)).map((e) => [e.role, e.text])[0]).toEqual(["user", "First"]);
    expect((await t.chat("main", t.turns[1].slot)).map((e) => [e.role, e.text])[0]).toEqual(["user", "Second"]);
    // The scope's own chat stays empty: board mode writes only per-task chats.
    expect(await new ChatLog(t.base).load()).toEqual([]);
  });

  it("under cap 1 the second waits: its summary says queued; it starts when the first ends", async () => {
    const t = host({ tasks: 1 });
    await t.h.interrupt();
    const a = t.h.board.start("write", "First");
    await until(() => t.turns.length === 1);
    const b = t.h.board.start("write", "Second");
    await until(() => (t.lastState()?.tasks ?? []).some((s) => s.state === "queued"));
    expect(t.turns).toHaveLength(1);
    const state = await t.h.tasksState();
    expect(state.caps).toEqual({ tasks: 1, jobs: 1 });
    expect(state.tasks.map((s) => s.state)).toEqual(["running", "queued"]);
    t.turns[0].end();
    await until(() => t.turns.length === 2);
    t.turns[1].end();
    await Promise.all([a, b]);
    expect((await t.h.tasksState()).tasks.map((s) => s.state)).toEqual(["waiting", "waiting"]);
  });

  it("a data request on lane B's socket reports lane B's running task (P3)", async () => {
    const t = host({ tasks: 2 });
    await t.h.interrupt();
    const a = t.h.board.start("write", "First");
    await until(() => t.turns.length === 1);
    const b = t.h.board.start("write", "Second");
    await until(() => t.turns.length === 2);
    const [ta, tb] = t.turns;
    expect(await t.askedBy(tb.slot)).toMatchObject({ id: tb.slot });
    expect(await t.askedBy(ta.slot)).toMatchObject({ id: ta.slot });
    expect(await t.askedBy("job:x")).toBeNull();
    ta.end();
    tb.end();
    await Promise.all([a, b]);
  });

  it("only the focused lane's events reach the window; focusing a lane mid-turn replays it from the buffer", async () => {
    const t = host({ tasks: 2 });
    await t.h.interrupt();
    const a = t.h.board.start("write", "First");
    await until(() => t.turns.length === 1);
    const b = t.h.board.start("write", "Second");
    await until(() => t.turns.length === 2);
    const [ta, tb] = t.turns;
    // B is focused (the newest start): A's text stays out of the window, in the buffer.
    ta.emit({ type: "text", delta: "Working on A" });
    tb.emit({ type: "text", delta: "Working on B" });
    expect(t.window).toEqual([{ type: "text", delta: "Working on B" }]);
    await t.h.board.focus(ta.slot);
    const load = await t.h.loadChat(t.base);
    expect(load.live).toEqual({ user: { text: "First", at: expect.any(String) }, events: [{ type: "text", delta: "Working on A" }] });
    // The user line shows exactly once, from the file or (not written yet) from the buffer.
    expect(load.entries.filter((e: ChatEntry) => e.role === "user").map((e) => e.text)).toEqual(["First"]);
    ta.end();
    tb.end();
    await Promise.all([a, b]);
    // A turn that ended replays nothing; the lane's buffer is gone with its turn.
    expect((await t.h.loadChat(t.base)).live).toBeUndefined();
    await t.h.board.focus(null);
    expect(await t.h.loadChat(t.base)).toEqual({ entries: [] });
  });

  it("a turn the gate couldn't get ready ends as an error and still writes the person's line and the error", async () => {
    // An engine held at one session: every turn runs the gate's beforeStart first.
    const t = host({ engineId: "opencode" });
    await t.h.interrupt();
    t.h.gate.setBeforeStart(async () => {
      throw new Error("sleep failed");
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await t.h.board.start("write", "First").catch(() => undefined);
    log.mockRestore();
    expect(t.turns).toHaveLength(0);
    const chats = fs.readdirSync(path.join(t.base, ".harness", "chats", "main"));
    expect(chats).toHaveLength(1);
    const entries = await t.chat("main", chats[0].slice(0, -".jsonl".length));
    expect(entries.map((e) => [e.role, e.text, e.error])).toEqual([
      ["user", "First", undefined],
      ["assistant", "", { code: "agent-crashed", detail: "Couldn't get ready for this turn" }],
    ]);
    expect(t.window.at(-1)).toEqual({ type: "done", ok: false, error: { code: "agent-crashed", detail: "Couldn't get ready for this turn" } });
  });

  it("a lane's sleep runs once however often it is asked; a turn sent meanwhile waits for it", async () => {
    const t = host({ tasks: 2 });
    await t.h.interrupt();
    const a = t.h.board.start("write", "First");
    await until(() => t.turns.length === 1);
    const id = t.turns[0].slot;
    t.turns[0].end();
    await a;
    const lane = t.h.lane(id)!;
    const slot = t.slots.get(id)!;
    // The idle timer and the single-session hook at once: one sleep.
    const s1 = (t.h.board as unknown as { sleepCfg: { sleep(id: string): Promise<void> } }).sleepCfg.sleep(id);
    const s2 = (t.h.board as unknown as { sleepCfg: { sleep(id: string): Promise<void> } }).sleepCfg.sleep(id);
    expect(s1).toBe(s2);
    // A follow-up sent while the slot sleeps (busy) waits for it instead of failing.
    const follow = t.h.board.ask("And then?");
    await s1;
    await until(() => t.turns.length === 2);
    expect(slot.sleeps).toBe(1);
    t.turns[1].end();
    await follow;
    expect(lane.manager.isBusy()).toBe(false);
  });

  it("an engine session that couldn't be loaded tells the person a new conversation started", async () => {
    const t = host({ tasks: 2 });
    await t.h.interrupt();
    const a = t.h.board.start("write", "First");
    await until(() => t.turns.length === 1);
    const id = t.turns[0].slot;
    const opts = t.slots.get(id)!.options;
    opts.onSession?.({ id: "s1", started: true });
    t.turns[0].end();
    await a;
    expect(t.window.some((e) => e.type === "activity" && e.detail === RESUME_FAILED)).toBe(false);
    // After a sleep the adapter reconnects; a failed session/load makes a new session.
    const follow = t.h.board.ask("More");
    await until(() => t.turns.length === 2);
    opts.onSession?.({ id: "s2", started: true });
    expect(t.window.filter((e) => e.type === "activity" && e.detail === RESUME_FAILED)).toHaveLength(2);
    t.turns[1].end();
    await follow;
  });

  it("refreshInstructions: false when nothing is open or unchanged; a refusal while a turn runs throws (the change stays stale)", async () => {
    const t = host();
    expect(await t.h.refreshInstructions()).toBe(false);
    await t.h.interrupt();
    const a = t.h.board.start("write", "First");
    await until(() => t.turns.length === 1);
    t.setRefresh(async () => false);
    await expect(t.h.refreshInstructions()).rejects.toThrow("A turn is running");
    t.turns[0].end();
    await a;
    expect(await t.h.refreshInstructions()).toBe(false);
  });

  it("betweenTasks refused while another lane runs: new turns wait for the gap, then it runs again", async () => {
    const t = host({ tasks: 2 });
    let calls = 0;
    t.taskDeps.betweenTasks = async () => {
      calls++;
      // As the settings controller does: the refresh, kept stale when it is refused.
      await t.h.refreshInstructions().catch(() => undefined);
    };
    await t.h.interrupt();
    const a = t.h.board.start("write", "First");
    await until(() => t.turns.length === 1);
    t.setRefresh(async () => t.turns.filter((x) => t.slots.get(x.slot)?.isBusy()).length === 0);
    const b = t.h.board.start("write", "Second");
    await until(() => calls === 2);
    await flush();
    // B's first turn is held while A runs and the rewrite waits.
    expect(t.turns).toHaveLength(1);
    t.turns[0].end();
    await until(() => t.turns.length === 2);
    expect(calls).toBe(3);
    t.turns[1].end();
    await Promise.all([a, b]);
  });

  it("start: the chats move to per-task files before any lane writes; an open lane of an earlier run ends", async () => {
    const t = host();
    await new ChatLog(t.base).append({ id: "1", role: "user", text: "earlier", blocks: [], activities: [], at: "t" });
    await new TaskStore(t.base).save({ version: 1, actions: {}, current: { id: "old", action: "write", status: "waiting", startedAt: "2026-10-28T09:00:00Z", turns: 1 } });
    await t.h.interrupt();
    expect((await t.chat("main", "old")).map((e) => e.text)).toEqual(["earlier"]);
    expect(await new ChatLog(t.base).load()).toEqual([]);
    const f = await t.file();
    expect(f.current).toBeNull();
    expect(f.lanes ?? []).toEqual([]);
    expect(f.actions.write).toBe("unfinished");
  });

  it("dropAll on an engine change: every lane ends, and the caps and hold become the new engine's", async () => {
    const t = host({ tasks: 3 });
    await t.h.interrupt();
    const a = t.h.board.start("write", "First");
    await until(() => t.turns.length === 1);
    t.turns[0].end();
    await a;
    expect((await t.h.tasksState()).caps).toEqual({ tasks: 3, jobs: 1 });
    t.config.engineId = "opencode";
    await t.h.dropAll();
    expect(t.h.board.laneIds()).toEqual([]);
    expect(t.slots.size).toBe(0);
    expect((await t.file()).lanes ?? []).toEqual([]);
    expect((await t.h.tasksState()).caps).toEqual({ tasks: 1, jobs: 1 });
  });

  it("quit: closeAll stops every lane and closes the slots; tasks.json keeps the lanes for the next start to end", async () => {
    const t = host();
    await t.h.interrupt();
    const a = t.h.board.start("write", "First");
    await until(() => t.turns.length === 1);
    t.turns[0].end();
    await a;
    await t.h.closeAll();
    expect(t.slots.size).toBe(0);
    expect((await t.file()).lanes).toHaveLength(1);
  });
});
