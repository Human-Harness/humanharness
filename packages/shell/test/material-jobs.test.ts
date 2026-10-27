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

  it("a turn that starts while the next job is looked for comes first: the job waits for it", async () => {
    let idle = true;
    const ran: string[] = [];
    let looks = 0;
    const jobs = new MaterialJobs<string>({
      idle: () => idle,
      next: async () => {
        looks++;
        if (looks === 1) {
          // Converting a changed original takes a while; the person sends a message meanwhile.
          idle = false;
          setTimeout(() => (idle = true), 20);
        }
        return ran.length === 0 ? "a" : null;
      },
      run: async (j) => {
        ran.push(`${j}:${idle ? "idle" : "busy"}`);
      },
      pollMs: 2,
    });
    jobs.kick();
    await tick();
    expect(ran).toEqual([]);
    await jobs.settled();
    expect(ran).toEqual(["a:idle"]);
    expect(looks).toBeGreaterThanOrEqual(2);
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
