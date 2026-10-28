import { type Event, type LimitWindow, fail } from "@humanharness/runtime";
import { type TurnOptions, isHeld } from "./turn-controller";
import { type Cap, Dropped, type TurnGate } from "./turn-gate";

type Done = Extract<Event, { type: "done" }>;

/** A lane's `turns` (TaskDeps.turns): its TurnController, which runs on the lane's session slot. */
export type Turns = { send(message: string, options: TurnOptions): Promise<void>; isBusy(): boolean; cancel(): void };

/**
 * A lane's `turns` through the gate (parallel spec §7): a turn waits for a free slot of its cap, FIFO; a free gate
 * starts it with no await, so at cap 1 a turn starts exactly when today's app starts it. The slot is freed once,
 * however the turn ends.
 *
 * A turn taken out before it started (cancel, the gate's `drop`) never reaches the engine: `send` resolves and the
 * caller's `onEvent` gets a cancelled `done`, as TurnController's cancel before the runtime starts does; the window gets
 * it too, unless the turn is quiet or held, so it drops the turn it shows. Nothing is written to the chat. A turn the
 * gate couldn't get ready (its `beforeStart` failed) ends the same way with an `agent-crashed` `done`.
 * A turn that ends `out-of-quota` pauses both queues until the reset the engine reported last, if it is still ahead;
 * otherwise until the person's Resume. It never replaces another kind of pause (a folder move).
 */
export function gatedTurns(
  lane: string,
  gate: TurnGate,
  inner: Turns,
  o: {
    cap: Cap;
    emit?: (e: Event) => void;
    now?: () => number;
    /**
     * A turn the gate couldn't get ready (its `beforeStart` failed) goes here instead: the board host runs it through
     * its TurnController's failed start, so the chat keeps the person's line and the error. Absent: it ends unstarted.
     */
    startFailed?: (message: string, options: TurnOptions, err: unknown) => Promise<void>;
  },
): Turns & { isQueued(): boolean } {
  const now = o.now ?? Date.now;
  /** From the send until the turn starts: queued, in the gate's `beforeStart`, or let in and not yet started. */
  let waiting = false;
  /** A cancel that came once the gate had let the turn in, before the send saw it. */
  let cancelLater = false;

  /** Ends a turn that never started, as TurnController ends one whose runtime never started. */
  const endUnstarted = (options: TurnOptions, done: Done) => {
    try {
      options.onEvent?.(done);
    } catch (err) {
      console.error("A turn listener failed", err);
    }
    // A quiet turn shows only a failure other than a cancel; a held one shows nothing.
    if (isHeld(done, options) || (options.quiet && (done.ok || done.error.code === "cancelled"))) return;
    try {
      o.emit?.(done);
    } catch (err) {
      console.error("Could not send an event to the window", err);
    }
  };

  /** Pauses the queues; a reset already past would let the next turns run into the same wall, so it waits for Resume. */
  const outOfQuota = (resetsAt: string | undefined) => {
    const ahead = resetsAt !== undefined && Date.parse(resetsAt) > now() ? resetsAt : undefined;
    const current = gate.paused();
    if (current && current.reason !== "out-of-quota") return;
    // Another lane's pause with a reset to wait for keeps it: this end knows none.
    if (current?.resetsAt && !ahead) return;
    gate.pause({ reason: "out-of-quota", ...(ahead ? { resetsAt: ahead } : {}) });
  };

  const run = async (message: string, options: TurnOptions, release: () => void) => {
    let resetsAt: string | undefined;
    try {
      await inner.send(message, {
        ...options,
        onEvent: (e) => {
          if (e.type === "limits") resetsAt = resetOf(e.windows) ?? resetsAt;
          if (e.type === "done" && !e.ok && e.error.code === "out-of-quota") outOfQuota(resetsAt);
          options.onEvent?.(e);
        },
      });
    } finally {
      release();
    }
  };

  return {
    send(message, options) {
      if (waiting || inner.isBusy()) return Promise.reject(new Error("A turn is already running"));
      const free = gate.tryAcquire(o.cap, { id: lane });
      if (free) return run(message, options, free);
      waiting = true;
      cancelLater = false;
      return gate.acquire(o.cap, { id: lane, text: message }).then(
        (release) => {
          waiting = false;
          if (!cancelLater) return run(message, options, release);
          release();
          endUnstarted(options, fail("cancelled") as Done);
        },
        (err: unknown) => {
          waiting = false;
          if (err instanceof Dropped) return endUnstarted(options, fail("cancelled") as Done);
          // The gate's `beforeStart` failed: it already gave the slot back.
          console.error("Could not get ready for the turn", err);
          if (o.startFailed) return o.startFailed(message, options, err);
          endUnstarted(options, fail("agent-crashed", "Couldn't get ready for this turn") as Done);
        },
      );
    },
    isBusy: () => waiting || inner.isBusy(),
    isQueued: () => gate.isQueued(lane),
    cancel() {
      if (!waiting) return inner.cancel();
      // Queued or in `beforeStart`: the gate takes it out. Already let in: the send drops it when it sees its slot.
      if (gate.drop(lane) === null) cancelLater = true;
    },
  };
}

/**
 * The reset to wait for after an out-of-quota end: the latest among the full windows (utilization 1), else the most
 * used window's. Undefined when the engine reported no window: the queues wait for the person's Resume.
 */
function resetOf(windows: LimitWindow[]): string | undefined {
  if (windows.length === 0) return undefined;
  const full = windows.filter((w) => w.utilization >= 1);
  if (full.length > 0) return full.reduce((a, b) => (Date.parse(b.resetsAt) > Date.parse(a.resetsAt) ? b : a)).resetsAt;
  return windows.reduce((a, b) => (b.utilization > a.utilization ? b : a)).resetsAt;
}
