import { describe, expect, it } from "vitest";
import { MaterialJobs } from "../src/main/material-jobs";

const tick = () => new Promise((r) => setTimeout(r, 5));

describe("MaterialJobs (material spec §10)", () => {
  it("runs jobs one at a time, only while idle", async () => {
    const queue = ["a", "b"];
    let idle = false;
    const ran: string[] = [];
    let running = 0;
    const jobs = new MaterialJobs<string>({
      idle: () => idle,
      next: async () => queue.shift() ?? null,
      run: async (j) => {
        running++;
        expect(running).toBe(1);
        await tick();
        ran.push(j);
        running--;
      },
      pollMs: 2,
    });
    jobs.kick();
    await tick();
    expect(ran).toEqual([]);
    idle = true;
    await jobs.settled();
    expect(ran).toEqual(["a", "b"]);
  });

  it("stop aborts the running job and waits for it; a kick starts again", async () => {
    let aborted = false;
    let calls = 0;
    const jobs = new MaterialJobs<string>({
      idle: () => true,
      next: async () => (calls++ < 1 ? "long" : null),
      run: (_j, signal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            resolve();
          });
        }),
      pollMs: 2,
    });
    jobs.kick();
    await tick();
    await jobs.stop();
    expect(aborted).toBe(true);
    aborted = false;
    calls = 0;
    jobs.kick();
    await tick();
    await jobs.stop();
    expect(aborted).toBe(true);
  });

  it("stop ends a queue waiting for the person, even when kicked meanwhile (no deadlock with a profile switch)", async () => {
    const ran: string[] = [];
    const jobs = new MaterialJobs<string>({ idle: () => false, next: async () => "x", run: async (j) => void ran.push(j), pollMs: 2 });
    jobs.kick();
    await tick();
    jobs.kick();
    await jobs.stop();
    expect(ran).toEqual([]);
  });

  it("a kick while it looks for work makes it look once more", async () => {
    const queue: string[] = [];
    const ran: string[] = [];
    const jobs = new MaterialJobs<string>({
      idle: () => true,
      next: async () => {
        const j = queue.shift() ?? null;
        await tick();
        return j;
      },
      run: async (j) => void ran.push(j),
      pollMs: 2,
    });
    jobs.kick();
    queue.push("late");
    jobs.kick();
    await jobs.settled();
    expect(ran).toEqual(["late"]);
  });

  it("a failing job doesn't stop the queue", async () => {
    const queue = ["bad", "good"];
    const ran: string[] = [];
    const jobs = new MaterialJobs<string>({
      idle: () => true,
      next: async () => queue.shift() ?? null,
      run: async (j) => {
        if (j === "bad") throw new Error("x");
        ran.push(j);
      },
      pollMs: 2,
    });
    jobs.kick();
    await jobs.settled();
    expect(ran).toEqual(["good"]);
  });
});
