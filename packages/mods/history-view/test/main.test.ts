import { describe, expect, it } from "vitest";
import type { CoreMainCtx } from "@humanharness/mod-sdk/core";
import mod from "../src/main";

const SHA = "a".repeat(40);

/** A core mod's ctx that records its channels; `ctx.app.history` records what reaches the restore service. */
function fakeCtx(answers: { point?: unknown; task?: unknown } = {}) {
  const channels = new Map<string, (payload: unknown) => unknown>();
  const calls: unknown[][] = [];
  const ctx = {
    id: "history-view",
    ipc: (name: string, handler: (payload: unknown) => unknown) => (channels.set(name, handler), () => undefined),
    app: {
      history: {
        restorePoint: (sha: string) => (calls.push(["restorePoint", sha]), Promise.resolve(answers.point ?? { ok: true })),
        restoreTask: (id: string, includeShared?: boolean) => (calls.push(["restoreTask", id, includeShared]), Promise.resolve(answers.task ?? { ok: true })),
      },
    },
  } as unknown as CoreMainCtx;
  return { ctx, channels, calls };
}

describe("the history-view core mod's main", () => {
  it("registers restore and restoreTask, its own channels and no app channel", async () => {
    const f = fakeCtx();
    await mod.main!(f.ctx as never);
    expect([...f.channels.keys()].sort()).toEqual(["restore", "restoreTask"]);
  });

  it("restore checks a commit id and goes back through ctx.app.history, the answer unchanged", async () => {
    const answer = { ok: false, reason: "cancelled" };
    const f = fakeCtx({ point: answer });
    await mod.main!(f.ctx as never);
    expect(await f.channels.get("restore")!(SHA)).toBe(answer);
    expect(f.calls).toEqual([["restorePoint", SHA]]);
    for (const bad of ["abc", 12, null, undefined, `${SHA}0`, "A".repeat(40)]) await expect(Promise.resolve().then(() => f.channels.get("restore")!(bad))).rejects.toThrow();
    expect(f.calls).toHaveLength(1);
  });

  it("restoreTask checks the task id and the choice, and answers as the service does", async () => {
    const refused = { refused: { reason: "later", path: "q.md", by: "task" } };
    const f = fakeCtx({ task: refused });
    await mod.main!(f.ctx as never);
    expect(await f.channels.get("restoreTask")!({ id: "t1" })).toBe(refused);
    await f.channels.get("restoreTask")!({ id: "t2", includeShared: true });
    expect(f.calls).toEqual([
      ["restoreTask", "t1", undefined],
      ["restoreTask", "t2", true],
    ]);
    for (const bad of [{}, { id: "" }, { id: "x".repeat(201) }, { id: 4 }, { id: "t", includeShared: "yes" }, "t1", null, undefined]) {
      await expect(Promise.resolve().then(() => f.channels.get("restoreTask")!(bad))).rejects.toThrow();
    }
    expect(f.calls).toHaveLength(2);
  });
});
