import { RESTORE_POINT, RESTORE_TASK } from "@humanharness/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GoBackAsk } from "../src/main/go-back";
import { type FileRestoreService, type HistoryRestoreDeps, historyRestores } from "../src/main/history-restore";

const byPaths = vi.hoisted(() => ({ restoreTaskByPaths: vi.fn() }));
vi.mock("../src/main/restore-paths", () => byPaths);

const SHA = (c: string) => c.repeat(40);
const task = (taskId: string, at: string, o: Record<string, unknown> = {}) => ({
  taskId,
  actionId: "plan",
  start: SHA("0"),
  end: SHA("e"),
  date: new Date(at),
  changes: [{ path: "a.md", kind: "modified" }],
  entries: [{ sha: SHA(taskId.at(-1) ?? "f"), message: "Turn: x", date: new Date(at) }],
  ...o,
});
// Newest first: t2 came after t1.
const tasks = () => [task("t2", "2026-10-28T10:00:00.000Z"), task("t1", "2026-10-28T09:00:00.000Z")];

function setup(over: Partial<HistoryRestoreDeps> = {}) {
  const history = { tasks: vi.fn(async () => tasks()), restore: vi.fn(async () => undefined) };
  const window = { id: "main-window" };
  const asked: { sender: unknown; ask: GoBackAsk }[] = [];
  let answer = true;
  const d: HistoryRestoreDeps = {
    quitting: () => false,
    tasksBusy: () => false,
    restoreHeld: () => null,
    linked_: () => null,
    currentHistory: async () => history as never,
    linkedHistoriesOf: async () => [],
    confirmGoBack: async (sender, ask) => {
      asked.push({ sender, ask });
      return answer;
    },
    mainWindow: () => window as never,
    restoreWith: async (run) => void (await run(history as never)),
    afterRestore: vi.fn(),
    restores: { run: async (find, fn) => void (await fn((await find())!)) },
    undoByPaths: () => null,
    fileTimelines: {} as never,
    ...over,
  };
  return { svc: historyRestores(d), d, history, window, asked, say: (v: boolean) => void (answer = v) };
}

beforeEach(() => byPaths.restoreTaskByPaths.mockReset());

describe("restorePoint", () => {
  it("asks once on the main window and restores on yes", async () => {
    const { svc, history, asked, window, d } = setup();
    expect(await svc.restorePoint(SHA("1"))).toEqual({ ok: true });
    expect(asked).toHaveLength(1);
    expect(asked[0].sender).toBe(window);
    expect(asked[0].ask.kind).toBe("point");
    expect(history.restore).toHaveBeenCalledWith(SHA("1"), RESTORE_POINT);
    expect(d.afterRestore).toHaveBeenCalledTimes(1);
  });

  it("answers cancelled on no and changes nothing", async () => {
    const { svc, history, say, d } = setup();
    say(false);
    expect(await svc.restorePoint(SHA("1"))).toEqual({ ok: false, reason: "cancelled" });
    expect(history.restore).not.toHaveBeenCalled();
    expect(d.afterRestore).not.toHaveBeenCalled();
  });

  it("refuses an unlisted point and a bad one before asking", async () => {
    const { svc, asked } = setup();
    await expect(svc.restorePoint(SHA("9"))).rejects.toThrow("Invalid point");
    await expect(svc.restorePoint("nope")).rejects.toThrow("Invalid point");
    expect(asked).toHaveLength(0);
  });

  it.each([
    ["quitting", { quitting: () => true }],
    ["busy", { tasksBusy: () => true }],
    ["held", { restoreHeld: () => "held" }],
  ])("refuses while %s, asking nothing", async (_n, over) => {
    const { svc, asked, history } = setup(over);
    await expect(svc.restorePoint(SHA("1"))).rejects.toThrow("Going back can't run now");
    expect(asked).toHaveLength(0);
    expect(history.restore).not.toHaveBeenCalled();
  });
});

describe("restoreTask in plain mode", () => {
  it("lists the later tasks in the ask and restores the task's start", async () => {
    const { svc, history, asked, window } = setup();
    expect(await svc.restoreTask("t1")).toEqual({ ok: true });
    expect(asked[0].sender).toBe(window);
    const ask = asked[0].ask;
    expect(ask.kind === "task" && ask.later.map((g) => g.taskId)).toEqual(["t2"]);
    expect(history.restore).toHaveBeenCalledWith(SHA("0"), RESTORE_TASK);
  });

  it("answers cancelled on no", async () => {
    const { svc, history, say } = setup();
    say(false);
    expect(await svc.restoreTask("t1")).toEqual({ ok: false, reason: "cancelled" });
    expect(history.restore).not.toHaveBeenCalled();
  });

  it("refuses an unknown task and a blocked call", async () => {
    await expect(setup().svc.restoreTask("zzz")).rejects.toThrow("Nothing to go back to");
    const { svc, asked } = setup({ tasksBusy: () => true });
    await expect(svc.restoreTask("t1")).rejects.toThrow("Going back can't run now");
    expect(asked).toHaveLength(0);
  });
});

describe("restoreTask by paths", () => {
  const paths = () => ({ running: async () => [], linkedRunning: async () => [], busy: () => false });

  it("lists no later task, restores its own paths and runs afterRestore", async () => {
    byPaths.restoreTaskByPaths.mockResolvedValue({ ok: true, paths: ["a.md"], sharedLeft: [], skipped: [] });
    const { svc, asked, d } = setup({ undoByPaths: paths });
    expect(await svc.restoreTask("t1", true)).toEqual({ ok: true });
    const ask = asked[0].ask;
    expect(ask.kind === "task" && ask.later).toEqual([]);
    expect(byPaths.restoreTaskByPaths.mock.calls[0][1]).toBe("t1");
    expect(byPaths.restoreTaskByPaths.mock.calls[0][2].includeShared).toBe(true);
    expect(d.afterRestore).toHaveBeenCalledTimes(1);
  });

  it("answers a refusal as data, as undoRefusalOf does", async () => {
    byPaths.restoreTaskByPaths.mockResolvedValue({ ok: false, reason: "running", path: "a.md" });
    const { svc, d } = setup({ undoByPaths: paths });
    expect(await svc.restoreTask("t1")).toEqual({ refused: { reason: "running", path: "a.md" } });
    expect(d.afterRestore).not.toHaveBeenCalled();
  });

  it("answers nothing for an unknown task, cancelled on no, and refuses while quitting or held", async () => {
    expect(await setup({ undoByPaths: paths }).svc.restoreTask("zzz")).toEqual({ refused: { reason: "nothing" } });
    const no = setup({ undoByPaths: paths });
    no.say(false);
    expect(await no.svc.restoreTask("t1")).toEqual({ ok: false, reason: "cancelled" });
    expect(byPaths.restoreTaskByPaths).not.toHaveBeenCalled();
    for (const over of [{ quitting: () => true }, { restoreHeld: () => "held" }]) {
      const { svc, asked } = setup({ undoByPaths: paths, ...over });
      await expect(svc.restoreTask("t1")).rejects.toThrow("Going back can't run now");
      expect(asked).toHaveLength(0);
    }
  });
});

// One file's go-back for a core mod (`ctx.app.history.restoreFile`): the mod's service checks and writes; the core
// asks, and only its yes opens the restore guard.
describe("restoreFile (a core mod's one-file go-back)", () => {
  const prompt = { path: "a.md", author: { kind: "person" as const }, at: "2026-10-28T09:00:00.000Z", kind: "turn" as const } as never;
  const sender = { id: "asking-window" } as never;

  function mod(over: Partial<FileRestoreService> = {}) {
    const wrote: unknown[] = [];
    const service: FileRestoreService = {
      restorePrompt: vi.fn(async () => ({ ok: true as const, prompt })),
      restore: vi.fn<FileRestoreService["restore"]>(async (file, commit, guard) => {
        await guard(async (history) => void wrote.push([file, commit, history]));
        return { ok: true };
      }),
      ...over,
    };
    return { service, wrote };
  }

  it("after a yes on the asking window, writes through the restore guard and tells the app", async () => {
    const guarded = { id: "guarded" };
    const restoreWith = vi.fn<HistoryRestoreDeps["restoreWith"]>(async (run) => void (await run(guarded as never)));
    const { svc, asked, d } = setup({ restoreWith });
    const { service, wrote } = mod();
    expect(await svc.restoreFile(sender, "a.md", SHA("1"), service)).toEqual({ ok: true });
    expect(asked).toEqual([{ sender, ask: { kind: "file", prompt } }]);
    expect(service.restorePrompt).toHaveBeenCalledWith("a.md", SHA("1"));
    expect(restoreWith).toHaveBeenCalledTimes(1);
    expect(wrote).toEqual([["a.md", SHA("1"), guarded]]);
    expect(d.afterRestore).toHaveBeenCalledTimes(1);
  });

  it("a no writes nothing: the service never gets the guard", async () => {
    const restoreWith = vi.fn();
    const { svc, say, d } = setup({ restoreWith });
    say(false);
    const { service } = mod();
    expect(await svc.restoreFile(sender, "a.md", SHA("1"), service)).toEqual({ ok: false, reason: "cancelled" });
    expect(service.restore).not.toHaveBeenCalled();
    expect(restoreWith).not.toHaveBeenCalled();
    expect(d.afterRestore).not.toHaveBeenCalled();
  });

  it("no dialog, no guard: a go-back the service refuses asks nothing and gets none", async () => {
    const { svc, asked } = setup();
    const { service } = mod({ restorePrompt: vi.fn(async () => ({ ok: false as const, reason: "busy" as const })) });
    expect(await svc.restoreFile(sender, "a.md", SHA("1"), service)).toEqual({ ok: false, reason: "busy" });
    expect(asked).toHaveLength(0);
    expect(service.restore).not.toHaveBeenCalled();
  });

  it("only the dialog's true is a yes", async () => {
    const { svc } = setup({ confirmGoBack: async () => "yes" as never });
    const { service } = mod();
    expect(await svc.restoreFile(sender, "a.md", SHA("1"), service)).toEqual({ ok: false, reason: "cancelled" });
    expect(service.restore).not.toHaveBeenCalled();
  });

  it("one dialog at a time across the three go-backs", async () => {
    let answer: (yes: boolean) => void = () => undefined;
    const confirm = vi.fn(() => new Promise<boolean>((r) => (answer = r)));
    const { svc } = setup({ confirmGoBack: confirm });
    const first = mod();
    const second = mod();
    const open = svc.restoreFile(sender, "a.md", SHA("1"), first.service);
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(await svc.restoreFile(sender, "b.md", SHA("1"), second.service)).toEqual({ ok: false, reason: "cancelled" });
    expect(await svc.restorePoint(SHA("1"))).toEqual({ ok: false, reason: "cancelled" });
    expect(await svc.restoreTask("t2")).toEqual({ ok: false, reason: "cancelled" });
    expect(second.service.restore).not.toHaveBeenCalled();
    answer(false);
    await open;
    // And the other way round: while a folder go-back asks, a file's gets no guard.
    const folder = svc.restorePoint(SHA("1"));
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(2));
    expect(await svc.restoreFile(sender, "b.md", SHA("1"), second.service)).toEqual({ ok: false, reason: "cancelled" });
    expect(second.service.restore).not.toHaveBeenCalled();
    answer(false);
    await folder;
  });

  it("an answer that is not ok tells the app nothing; a throw is answered as a failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { svc, d } = setup();
    expect(await svc.restoreFile(sender, "a.md", SHA("1"), mod({ restore: async () => ({ ok: false, reason: "unsafe" }) }).service)).toEqual({ ok: false, reason: "unsafe" });
    const boom = mod({ restore: () => Promise.reject(new Error("boom")) });
    expect(await svc.restoreFile(sender, "a.md", SHA("1"), boom.service)).toEqual({ ok: false, reason: "failed" });
    expect(d.afterRestore).not.toHaveBeenCalled();
  });

  it("the guard ends with the call: kept, it writes nothing later", async () => {
    const restoreWith = vi.fn(async () => {});
    const { svc } = setup({ restoreWith });
    let kept: Parameters<FileRestoreService["restore"]>[2] | undefined;
    const { service } = mod({ restore: async (_file, _commit, guard) => ((kept = guard), { ok: true }) });
    await svc.restoreFile(sender, "a.md", SHA("1"), service);
    await expect(kept!(async () => {})).rejects.toThrow("over");
    expect(restoreWith).not.toHaveBeenCalled();
  });
});
