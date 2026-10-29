import { describe, expect, it } from "vitest";
import { TurnGate } from "../src/main/turn-gate";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("lowering the tasks cap while turns run (Settings › General, parallel spec §7)", () => {
  it("2 → 1 with two running and one queued: the running turns finish, and the queued one starts only once both ended", async () => {
    const gate = new TurnGate({ tasks: 2, jobs: 1 });
    const ra = await gate.acquire("tasks", { id: "a", text: "a" });
    const rb = await gate.acquire("tasks", { id: "b", text: "b" });
    let started = false;
    const pc = gate.acquire("tasks", { id: "c", text: "c" }).then((release) => {
      started = true;
      return release;
    });
    await flush();
    expect(gate.queued("tasks").map((q) => q.id)).toEqual(["c"]);
    gate.setCaps({ tasks: 1, jobs: 1 });
    await flush();
    expect(gate.running("tasks")).toBe(2);
    ra();
    await flush();
    expect(started).toBe(false);
    expect(gate.isQueued("c")).toBe(true);
    rb();
    (await pc)();
    expect(started).toBe(true);
    expect(gate.running("tasks")).toBe(0);
  });
});
