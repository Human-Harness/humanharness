import { describe, expect, it } from "vitest";
import { RestoreGuard, lastOpened } from "../src/main/restore-guard";

/** Deps whose flags the test flips; `history` resolves when `open` is called. */
function setup() {
  const flags = { quitting: false, busy: false, blocked: null as string | null };
  let open!: (h: string | null) => void;
  const guard = new RestoreGuard({ quitting: () => flags.quitting, busy: () => flags.busy, turnBlocked: () => flags.blocked });
  const history = () => new Promise<string | null>((r) => (open = r));
  return { flags, guard, history, open: (h: string | null) => open(h) };
}

describe("RestoreGuard", () => {
  it("holds new turns from the first moment of a restore until it ends", async () => {
    const { guard, history, open } = setup();
    expect(guard.turnBlocked()).toBeNull();
    const ran: string[] = [];
    const done = guard.run(history, async (h) => void ran.push(h));
    // Set synchronously: a send arriving while the history is being found is refused.
    expect(guard.turnBlocked()).not.toBeNull();
    open("h");
    await done;
    expect(ran).toEqual(["h"]);
    expect(guard.turnBlocked()).toBeNull();
  });

  it("refuses a second restore, and one while a turn runs, turns are held or the app quits", async () => {
    const { flags, guard, history, open } = setup();
    const first = guard.run(history, async () => undefined);
    await expect(guard.run(history, async () => undefined)).rejects.toThrow("Already going back");
    open("h");
    await first;
    flags.busy = true;
    await expect(guard.run(history, async () => undefined)).rejects.toThrow("A turn is running");
    flags.busy = false;
    flags.blocked = "The engine is being changed";
    await expect(guard.run(history, async () => undefined)).rejects.toThrow("A turn is running");
    flags.blocked = null;
    flags.quitting = true;
    await expect(guard.run(history, async () => undefined)).rejects.toThrow("The app is closing");
  });

  it("a run may name its own busy check (board mode's undo by paths: only that task's lane), held and quit as before", async () => {
    const { flags, guard } = setup();
    flags.busy = true;
    let ran = false;
    await guard.run(async () => "h", async () => void (ran = true), { busy: () => false });
    expect(ran).toBe(true);
    flags.busy = false;
    await expect(guard.run(async () => "h", async () => {}, { busy: () => true })).rejects.toThrow("A turn is running");
    flags.blocked = "Changing the engine";
    await expect(guard.run(async () => "h", async () => {}, { busy: () => false })).rejects.toThrow("A turn is running");
  });

  it("checks again once the history is found: an engine or folder change that began meanwhile wins", async () => {
    const { flags, guard, history, open } = setup();
    const ran: string[] = [];
    const done = guard.run(history, async (h) => void ran.push(h));
    flags.blocked = "The folder is being changed";
    open("h");
    await expect(done).rejects.toThrow("A turn is running");
    expect(ran).toEqual([]);
    expect(guard.turnBlocked()).toBeNull();
  });

  it("fails without a history, and releases the hold when the restore fails", async () => {
    const { guard, history, open } = setup();
    const none = guard.run(history, async () => undefined);
    open(null);
    await expect(none).rejects.toThrow("The app is not set up yet");
    const failing = guard.run(history, async () => {
      throw new Error("disk");
    });
    open("h");
    await expect(failing).rejects.toThrow("disk");
    expect(guard.turnBlocked()).toBeNull();
  });

  it("settles once the last restore has finished, whatever its outcome", async () => {
    const { guard, history, open } = setup();
    let release!: () => void;
    const done = guard.run(history, () => new Promise<void>((_, reject) => (release = () => reject(new Error("x")))));
    open("h");
    await Promise.resolve();
    let settled = false;
    void guard.settled().then(() => (settled = true));
    await new Promise((r) => setTimeout(r, 0));
    expect(settled).toBe(false);
    release();
    await expect(done).rejects.toThrow("x");
    await guard.settled();
    expect(settled).toBe(true);
  });
});

describe("lastOpened", () => {
  it("opens one value per key and reuses it while the key stays the same", async () => {
    let made = 0;
    const open = lastOpened(async (key: string) => `${key}#${++made}`);
    const [a, b] = await Promise.all([open("/f"), open("/f")]);
    expect(a).toBe("/f#1");
    expect(b).toBe("/f#1");
    expect(await open("/g")).toBe("/g#2");
    expect(await open("/f")).toBe("/f#3");
  });

  it("tries again after a failed open", async () => {
    let calls = 0;
    const open = lastOpened(async (key: string) => {
      if (++calls === 1) throw new Error("no");
      return key;
    });
    await expect(open("/f")).rejects.toThrow("no");
    expect(await open("/f")).toBe("/f");
  });
});
