import { describe, expect, it, vi } from "vitest";
import { setup } from "./task-manager-fixture";

describe("TaskManager: mods hooks (minimal-core spec §4.2)", () => {
  it("calls taskOpened once with the new task, after it is current", async () => {
    let currentAtCall: unknown;
    const taskOpened = vi.fn((_task: { id: string; action?: string; scope: string }) => void (currentAtCall = t.state().current?.id));
    const t = setup({ extra: { taskOpened } });
    await t.manager.start("quiz");
    await t.manager.ask("Go on");
    expect(taskOpened).toHaveBeenCalledTimes(1);
    expect(taskOpened.mock.calls[0][0]).toMatchObject({ action: "quiz", scope: expect.any(String), id: "t1" });
    expect(currentAtCall).toBe("t1");
  });
  it("D0: without taskOpened a task starts as before", async () => {
    const t = setup();
    await t.manager.start("quiz");
    expect(t.state().current?.id).toBe("t1");
  });
});
