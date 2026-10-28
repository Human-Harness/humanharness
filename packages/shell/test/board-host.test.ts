import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Event, HarnessWorkspace, SessionSlot, SlotOptions, SlotRef, SlotSendOptions, TurnAttribution } from "@humanharness/runtime";
import type { AppConfig, ChatEntry, ChatNotice, TaskSummary, TasksState } from "@humanharness/ui/client";
import { type BoardHostDeps, conflictOf, createBoardHost, hostMode } from "../src/main/board-host";
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
    /** More task deps (Sidekick's hooks, phased actions). */
    taskDeps?: Partial<TaskDeps>;
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
    turnDeps: { ensureRuntime: async () => null, chatLog: async () => null, stateBlocks: () => new Set(), emit: () => {} },
    checkTurn: async () => {},
    chatLog: async (chat, task) => (o.chatLogNull?.() ? null : new ChatLog(base, config.engineId, chat, task)),
    taskDeps,
    scoped: () => false,
    scopeExists: async () => true,
    emit: (e) => window.push(e),
    send: (channel, value) => sent.push({ channel, value }),
    label: (t) => t.action ?? t.question ?? "",
    ...(o.attention ? { attention: o.attention } : {}),
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

  it("Settings › General's caps reach the running gate: a queued turn starts once the cap is raised, and the window hears the caps", async () => {
    const t = host({ tasks: 1 });
    await t.h.interrupt();
    const a = t.h.board.start("write", "First");
    await until(() => t.turns.length === 1);
    const b = t.h.board.start("write", "Second");
    await until(() => (t.lastState()?.tasks ?? []).some((s) => s.state === "queued"));
    t.h.capsChanged({ tasks: 2, jobs: 1 });
    await until(() => t.turns.length === 2);
    await until(() => t.lastState()?.caps.tasks === 2);
    expect((await t.h.tasksState()).caps).toEqual({ tasks: 2, jobs: 1 });
    t.turns[0].end();
    t.turns[1].end();
    await Promise.all([a, b]);
  });

  it("the window's open tasks are read one at a time: a slow earlier read never lands after a later one", async () => {
    const t = host();
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    const stale = { id: "old", scope: "main", action: null, label: "Old", state: "waiting", startedAt: "2026-10-28T10:00:00Z", tokens: 0 } as TaskSummary;
    let calls = 0;
    vi.spyOn(t.h.board, "summaries").mockImplementation(async () => {
      calls++;
      if (calls === 1) {
        await slow;
        return [stale];
      }
      return [];
    });
    t.h.capsChanged({ tasks: 2, jobs: 1 });
    t.h.capsChanged({ tasks: 3, jobs: 1 });
    await flush();
    release();
    await until(() => t.lastState()?.caps.tasks === 3 && t.lastState()?.tasks.length === 0);
    await flush();
    await flush();
    expect(t.lastState()?.tasks).toEqual([]);
  });

  it("an engine held at one session keeps the caps at 1 whatever Settings › General asks", async () => {
    const t = host({ engineId: "opencode" });
    t.h.capsChanged({ tasks: 4, jobs: 3 });
    expect((await t.h.tasksState()).caps).toEqual({ tasks: 1, jobs: 1 });
  });

  it("the attention gets the open tasks as they change, one update at a time: a lane that waits, then closes (Decision 10)", async () => {
    const seen: TaskSummary[][] = [];
    let inFlight = 0;
    let overlapped = false;
    const t = host({
      tasks: 2,
      attention: {
        update: async (tasks) => {
          inFlight++;
          if (inFlight > 1) overlapped = true;
          await flush();
          seen.push([...tasks]);
          inFlight--;
        },
      },
    });
    await t.h.interrupt();
    const a = t.h.board.start("write", "First");
    await until(() => t.turns.length === 1);
    t.turns[0].end();
    await a;
    const id = t.turns[0].slot;
    await until(() => seen.at(-1)?.[0]?.state === "waiting");
    expect(seen.at(-1)!.map((x) => [x.id, x.label, x.state])).toEqual([[id, "write", "waiting"]]);
    // The closing turn, then the lane leaves the open tasks.
    const closing = t.h.board.finish();
    await until(() => t.turns.length === 2);
    t.turns[1].end();
    await closing;
    await until(() => seen.at(-1)?.length === 0);
    expect(overlapped).toBe(false);
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
    expect(t.window.some((e) => e.type === "task-notice")).toBe(false);
    // After a sleep the adapter reconnects; a failed session/load makes a new session.
    const follow = t.h.board.ask("More");
    await until(() => t.turns.length === 2);
    opts.onSession?.({ id: "s2", started: true });
    // The window's own notice, a system line (never a "Working on …" activity).
    expect(t.window.filter((e) => e.type === "task-notice")).toEqual([{ type: "task-notice", notice: { kind: "resume-failed" } }]);
    expect(t.window.some((e) => e.type === "activity" && e.kind === "other")).toBe(false);
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

describe("conflicts and tokens per task (parallel spec §5.3, §9.1)", () => {
  const usage = (input: number, output: number): Event => ({ type: "usage", inputTokens: input, outputTokens: output, cacheReadTokens: 1000, cacheWriteTokens: 500 });
  const attribution = (conflicts: TurnAttribution["conflicts"]): TurnAttribution => ({ owned: [], shared: conflicts.map((c) => c.path), with: [], conflicts });
  const notices = (events: Event[]): unknown[] => events.flatMap((e): unknown[] => (e.type === "task-notice" ? [e.notice] : e.type === "activity" && e.kind === "other" ? ["activity"] : []));

  it("a conflict marks both tasks and adds a notice to both chats (spec §5.3)", async () => {
    const t = host({ tasks: 2 });
    await t.h.interrupt();
    const a = t.h.board.start("write", "First");
    await until(() => t.turns.length === 1);
    const b = t.h.board.start("write", "Second");
    await until(() => t.turns.length === 2);
    const [ta, tb] = t.turns;
    // B (focused) ends while A still runs: both changed spec.md, and B's turn names A.
    tb.end([{ type: "text", delta: "Done B" }, ok], attribution([{ path: "spec.md", tasks: [ta.slot] }]));
    await b;
    const notice: ChatNotice = { kind: "conflict", paths: ["spec.md"], other: "write" };
    // The window gets B's notice now (B is focused), structured, never as an activity line; A's goes only to A's buffer.
    expect(notices(t.window)).toEqual([notice]);
    await t.h.board.focus(ta.slot);
    expect(notices((await t.h.loadChat(t.base)).live?.events ?? [])).toEqual([notice]);
    const lanes = (await t.file()).lanes!;
    expect(lanes.find((l) => l.id === ta.slot)?.conflict).toEqual(["spec.md"]);
    expect(lanes.find((l) => l.id === tb.slot)?.conflict).toEqual(["spec.md"]);
    // B's notice follows its reply in its chat: a structured notice with no text of its own (never a reply).
    expect((await t.chat("main", tb.slot)).map((e) => [e.role, e.text, e.notice])).toEqual([
      ["user", "Second", undefined],
      ["assistant", "Done B", undefined],
      ["assistant", "", notice],
    ]);
    // A is mid-turn: its notice waits for its reply, so the person's line and the answer stay together.
    expect((await t.chat("main", ta.slot)).map((e) => e.text)).toEqual(["First"]);
    ta.end([{ type: "text", delta: "Done A" }, ok]);
    await a;
    const chatA = await t.chat("main", ta.slot);
    expect(chatA.map((e) => [e.role, e.text, e.notice])).toEqual([
      ["user", "First", undefined],
      ["assistant", "Done A", undefined],
      ["assistant", "", notice],
    ]);
    expect(chatA.at(-1)).toMatchObject({ blocks: [], activities: [], task: ta.slot });
    // Focusing A while its next turn runs: the person's line still comes from the buffer, past the notice.
    const follow = t.h.board.ask("Then?");
    await until(() => t.turns.length === 3);
    const load = await t.h.loadChat(t.base);
    expect(load.entries.filter((e) => e.role === "user").map((e) => e.text)).toEqual(["First", "Then?"]);
    t.turns[2].end();
    await follow;
    // The summaries carry the paths on both tasks.
    const summaries = (await t.h.tasksState()).tasks;
    expect(summaries.map((s) => s.conflict)).toEqual([["spec.md"], ["spec.md"]]);
    expect(t.lastState()?.tasks.map((s) => s.conflict)).toEqual([["spec.md"], ["spec.md"]]);
  });

  it("an idle task gets its notice at once; paths stay unique, newest last, at most 20; a turn without conflicts adds none", async () => {
    const t = host({ tasks: 2 });
    await t.h.interrupt();
    const a = t.h.board.start("write", "First");
    await until(() => t.turns.length === 1);
    t.turns[0].end();
    await a;
    const idA = t.turns[0].slot;
    const b = t.h.board.start("write", "Second");
    await until(() => t.turns.length === 2);
    const idB = t.turns[1].slot;
    const many = Array.from({ length: 22 }, (_, i) => ({ path: `n/${i}.md`, tasks: [idA] }));
    t.turns[1].end([ok], attribution([{ path: "spec.md", tasks: [idA] }, ...many, { path: "spec.md", tasks: [idA, idB] }]));
    await b;
    const lanes = (await t.file()).lanes!;
    const expected = [...many.map((m) => m.path)].slice(-20);
    // spec.md came first, so the newest twenty leave it out.
    expect(lanes.find((l) => l.id === idA)?.conflict).toEqual(expected);
    expect(lanes.find((l) => l.id === idB)?.conflict).toEqual(expected);
    // A was idle: its notice is in its chat now, naming B and the first five paths, then how many more.
    const last = (await t.chat("main", idA)).at(-1)!;
    expect(last.notice).toEqual({ kind: "conflict", paths: ["spec.md", "n/0.md", "n/1.md", "n/2.md", "n/3.md"], more: 18, other: "write" });
    // B's own notice: its task in `tasks` is never a conflict with itself, so it names A once.
    expect((await t.chat("main", idB)).filter((e) => e.notice)).toHaveLength(1);
    const follow = t.h.board.ask("More");
    await until(() => t.turns.length === 3);
    t.turns[2].end([ok], attribution([]));
    await follow;
    expect((await t.file()).lanes!.find((l) => l.id === idB)?.conflict).toEqual(expected);
    expect((await t.chat("main", idB)).filter((e) => e.notice)).toHaveLength(1);
  });

  it("an idle task on screen gets its notice in the window at once, as well as in its chat", async () => {
    const t = host({ tasks: 2 });
    await t.h.interrupt();
    const a = t.h.board.start("write", "First");
    await until(() => t.turns.length === 1);
    t.turns[0].end();
    await a;
    const idA = t.turns[0].slot;
    const b = t.h.board.start("write", "Second");
    await until(() => t.turns.length === 2);
    const idB = t.turns[1].slot;
    // A waits on screen while B runs in the background.
    await t.h.board.focus(idA);
    t.window.length = 0;
    t.turns[1].end([ok], attribution([{ path: "spec.md", tasks: [idA] }]));
    await b;
    await until(() => t.window.some((e) => e.type === "task-notice"));
    expect(notices(t.window)).toEqual([{ kind: "conflict", paths: ["spec.md"], other: "write" }]);
    expect((await t.chat("main", idA)).filter((e) => e.notice)).toHaveLength(1);
    // B is not on screen: its notice waits in its chat for its next load.
    expect((await t.chat("main", idB)).filter((e) => e.notice)).toHaveLength(1);
  });

  it("a conflict with a task that has ended names no task and marks only this one", async () => {
    const t = host({ tasks: 2 });
    await t.h.interrupt();
    const a = t.h.board.start("write", "First");
    await until(() => t.turns.length === 1);
    t.turns[0].end([ok], attribution([{ path: "spec.md", tasks: ["gone"] }]));
    await a;
    const id = t.turns[0].slot;
    expect((await t.file()).lanes!.map((l) => [l.id, l.conflict])).toEqual([[id, ["spec.md"]]]);
    expect((await t.chat("main", id)).at(-1)?.notice).toEqual({ kind: "conflict", paths: ["spec.md"], ended: true });
    expect(conflictOf(["spec.md"], null)).toEqual({ kind: "conflict", paths: ["spec.md"], ended: true });
  });

  it("tokens: each usage event adds its total to the lane's tokens", async () => {
    const t = host({ tasks: 2 });
    await t.h.interrupt();
    const a = t.h.board.start("write", "First");
    await until(() => t.turns.length === 1);
    const id = t.turns[0].slot;
    // Two usage events in one turn: input + output of each, never the cache counts.
    t.turns[0].end([usage(100, 20), usage(30, 5), ok]);
    await a;
    expect((await t.file()).lanes!.find((l) => l.id === id)?.tokens).toBe(155);
    expect((await t.h.tasksState()).tasks[0].tokens).toBe(155);
    // The next turn adds its own; the task manager's saves in between keep the count.
    const follow = t.h.board.ask("More");
    await until(() => t.turns.length === 2);
    expect((await t.file()).lanes!.find((l) => l.id === id)?.tokens).toBe(155);
    t.turns[1].end([usage(10, 2), ok]);
    await follow;
    expect((await t.file()).lanes!.find((l) => l.id === id)?.tokens).toBe(167);
    // A turn with no usage (or a bad one) adds nothing.
    const third = t.h.board.ask("Again");
    await until(() => t.turns.length === 3);
    t.turns[2].end([{ type: "usage", inputTokens: Number.NaN, outputTokens: -4, cacheReadTokens: 0, cacheWriteTokens: 0 }, ok]);
    await third;
    expect((await t.file()).lanes!.find((l) => l.id === id)?.tokens).toBe(167);
  });

  it("tokens: a turn taken out of the queue before it started counts nothing", async () => {
    const t = host({ tasks: 1 });
    await t.h.interrupt();
    const a = t.h.board.start("write", "First");
    await until(() => t.turns.length === 1);
    const b = t.h.board.start("write", "Second");
    await until(() => (t.lastState()?.tasks ?? []).some((s) => s.state === "queued"));
    const queued = t.h.board.focusedId()!;
    t.h.board.cancel();
    await b.catch(() => undefined);
    t.turns[0].end([usage(7, 3), ok]);
    await a;
    expect(t.turns).toHaveLength(1);
    const lanes = (await t.file()).lanes ?? [];
    expect(lanes.find((l) => l.id === t.turns[0].slot)?.tokens).toBe(10);
    expect(lanes.find((l) => l.id === queued)?.tokens).toBeUndefined();
  });

  it("a session the lane ended itself (a fallback, a resume from the notes) starts anew without the resume notice", async () => {
    const t = host({ tasks: 2 });
    await t.h.interrupt();
    const a = t.h.board.start("write", "First");
    await until(() => t.turns.length === 1);
    const id = t.turns[0].slot;
    const opts = t.slots.get(id)!.options;
    opts.onSession?.({ id: "s1", started: true });
    t.turns[0].end();
    await a;
    // The lane's TaskManager ends its session (its `endSession` dep), then a new one starts.
    const deps = (t.h.lane(id)!.manager as unknown as { d: TaskDeps }).d;
    await deps.endSession();
    const follow = t.h.board.ask("More");
    await until(() => t.turns.length === 2);
    opts.onSession?.({ id: "s2", started: true });
    expect(t.window.some((e) => e.type === "task-notice")).toBe(false);
    t.turns[1].end();
    await follow;
  });

  it("quit: closeAll waits for a cancelled turn's reply to be written, though its lane already left the board", async () => {
    const t = host();
    await t.h.interrupt();
    const a = t.h.board.start("write", "First");
    await until(() => t.turns.length === 1);
    const id = t.turns[0].slot;
    let closed = false;
    const closing = t.h.closeAll().then(() => (closed = true));
    await until(() => t.h.board.laneIds().length === 0);
    await flush();
    expect(closed).toBe(false);
    t.turns[0].end([{ type: "text", delta: "Half done" }, { type: "done", ok: false, error: { code: "cancelled" } }]);
    await closing;
    await a.catch(() => undefined);
    const entries = await t.chat("main", id);
    expect(entries.map((e) => e.role)).toEqual(["user", "assistant"]);
    expect(entries[1].text).toBe("Half done");
  });

  it("a failed start whose send was refused before it ran never fails the lane's next turn", async () => {
    let refuse = false;
    const t = host({ engineId: "opencode", chatLogNull: () => refuse });
    await t.h.interrupt();
    let hookFails = false;
    t.h.gate.setBeforeStart(async () => {
      if (hookFails) throw new Error("sleep failed");
    });
    const a = t.h.board.start("write", "First");
    await until(() => t.turns.length === 1);
    t.turns[0].end();
    await a;
    // The hook fails, and the failed start's own send is refused before its ensureRuntime runs (no chat log).
    hookFails = true;
    refuse = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await t.h.board.ask("Again").catch(() => undefined);
    log.mockRestore();
    hookFails = false;
    refuse = false;
    const follow = t.h.board.ask("More");
    await until(() => t.turns.length === 2);
    t.turns[1].end();
    await follow;
    expect(t.turns[1].message).toContain("More");
  });
});

describe("Sidekick in board mode: only the focused task (sidekick spec §4.2, §2a.2)", () => {
  /** Sidekick's three hooks, recording which task each call was about. */
  function sidekick() {
    const heard = { starting: 0, ended: [] as [string, string][], moved: [] as [string, string][] };
    const hooks: Partial<TaskDeps> = {
      turnStarting: () => void heard.starting++,
      turnEnded: (end) => void heard.ended.push([end.task.id, end.kind]),
      phaseMoved: (e) => void heard.moved.push([e.task.id, e.to]),
    };
    return { heard, hooks };
  }

  it("a turn is heard only when its task is focused as it starts and as it ends", async () => {
    const s = sidekick();
    const t = host({ tasks: 2, taskDeps: s.hooks });
    await t.h.interrupt();
    const a = t.h.board.start("write", "First");
    await until(() => t.turns.length === 1);
    // A started focused: Sidekick hears its start.
    expect(s.heard.starting).toBe(1);
    const b = t.h.board.start("write", "Second");
    await until(() => t.turns.length === 2);
    expect(s.heard.starting).toBe(2);
    const [ta, tb] = t.turns;
    // A ends in the background (B is focused): no after-reply about a chat the person isn't looking at.
    ta.end();
    await a;
    expect(s.heard.ended).toEqual([]);
    // B, focused throughout, is heard as in the plain app.
    tb.end();
    await b;
    expect(s.heard.ended).toEqual([[tb.slot, "run"]]);
    // A follow-up in a task focused again is heard again, start and end.
    await t.h.board.focus(ta.slot);
    const more = t.h.board.ask("More");
    await until(() => t.turns.length === 3);
    expect(s.heard.starting).toBe(3);
    t.turns[2].end();
    await more;
    expect(s.heard.ended).toEqual([
      [tb.slot, "run"],
      [ta.slot, "run"],
    ]);
  });

  it("focus that moves to a task mid-turn: Sidekick never hears an end whose start it didn't hear; a background phase move stays unheard", async () => {
    const s = sidekick();
    const t = host({
      tasks: 2,
      taskDeps: {
        ...s.hooks,
        actions: {
          write: { label: "Write" },
          staged: {
            label: "Staged",
            phases: [
              { id: "warmup", label: "Warm-up", brief: "w.md", auto: true },
              { id: "main", label: "Main block", brief: "m.md" },
            ],
          },
        } as TaskDeps["actions"],
        readPhaseBrief: async (_action, phase) => `Brief of ${phase}.`,
      },
    });
    await t.h.interrupt();
    const a = t.h.board.start("staged", "First");
    await until(() => t.turns.length === 1);
    const b = t.h.board.start("write", "Second");
    await until(() => t.turns.length === 2);
    const [ta, tb] = t.turns;
    // A's warm-up asks for the next part while B is focused: the app moves A on its own, in the background.
    ta.end([{ type: "block", name: "set_phase", data: { to: "main", reason: "Recall done" } }, ok]);
    await until(() => t.turns.length === 3);
    const change = t.turns[2];
    expect(change.slot).toBe(ta.slot);
    expect(s.heard.moved).toEqual([]);
    // The person focuses A while its phase-change turn runs, and the turn ends there: its start wasn't heard.
    await t.h.board.focus(ta.slot);
    change.end();
    await a;
    expect(s.heard.ended).toEqual([]);
    // B ends while A is focused: neither heard.
    tb.end();
    await b;
    expect(s.heard.ended).toEqual([]);
    expect(s.heard.starting).toBe(2);
    // A's next turn starts and ends focused: heard, as in the plain app.
    const more = t.h.board.ask("More");
    await until(() => t.turns.length === 4);
    t.turns[3].end();
    await more;
    expect(s.heard.ended).toEqual([[ta.slot, "run"]]);
    expect(s.heard.starting).toBe(3);
  });

  it("a phase move of the focused task is heard", async () => {
    const s = sidekick();
    const t = host({
      tasks: 2,
      taskDeps: {
        ...s.hooks,
        actions: {
          staged: {
            label: "Staged",
            phases: [
              { id: "warmup", label: "Warm-up", brief: "w.md", auto: true },
              { id: "main", label: "Main block", brief: "m.md" },
            ],
          },
        } as TaskDeps["actions"],
        readPhaseBrief: async (_action, phase) => `Brief of ${phase}.`,
      },
    });
    await t.h.interrupt();
    const a = t.h.board.start("staged", "First");
    await until(() => t.turns.length === 1);
    t.turns[0].end([{ type: "block", name: "set_phase", data: { to: "main", reason: "Recall done" } }, ok]);
    await until(() => t.turns.length === 2);
    expect(s.heard.moved).toEqual([[t.turns[0].slot, "main"]]);
    t.turns[1].end();
    await a;
    expect(s.heard.ended).toEqual([
      [t.turns[0].slot, "run"],
      [t.turns[0].slot, "phase-change"],
    ]);
  });
});
