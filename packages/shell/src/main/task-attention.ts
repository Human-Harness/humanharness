import type { TaskSummary } from "@humanharness/ui/client";
import { ATTENTION_LIMITS, type AttentionStore } from "@humanharness/workspace";

/** The notification's body: the same text as the window's `parallel.waitingBody` (main has no i18n; plan 5a: English). */
export const WAITING_BODY = "Waiting for you";
/** The item's key for a task that waits for the person: one per task. */
export const WAITING_KEY = "waiting";

export interface TaskAttentionDeps {
  /** The current base's shared Attention store (attention-stores.ts); null before the app is set up. */
  store(): Promise<Pick<AttentionStore, "raise" | "resolve"> | null>;
  /** The Dock badge: the count only (0 clears it). */
  badge(count: number): void;
  /** An OS notification; `task` is the waiting task's id, for its click. */
  notify(n: { title: string; body: string }, task: string): void;
  /** Settings › General: notify when a task starts waiting (off by default, Decision 11). */
  notifyOn(): boolean | Promise<boolean>;
  windowFocused(): boolean;
  /** Items other sources (plugins) count toward the badge. */
  otherCount?(): number;
  log?(message: string, err?: unknown): void;
}

/**
 * Waiting tasks as attention items, the Dock badge and the optional OS notification (parallel spec §9.2, Decision 10,
 * 11). Content stays out: the badge is a count, the item and the notification carry the task's label only (P4). A task
 * that starts waiting raises `{ kind: "task", id }` / "waiting" (an action) and notifies once; leaving `waiting`, or
 * leaving the open tasks, resolves it. Board mode only: plain mode never builds one (D0).
 */
export class TaskAttention {
  private waiting = new Set<string>();
  /** Tasks whose item the store holds (the raise succeeded and no resolve has yet). */
  private raised = new Set<string>();
  private shown = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly d: TaskAttentionDeps) {}

  /** The open tasks as they are now; calls run one at a time, in order. */
  update(tasks: readonly TaskSummary[]): Promise<void> {
    const run = this.chain.then(() => this.apply(tasks));
    this.chain = run.catch((err: unknown) => this.log("Could not update the waiting tasks", err));
    return run;
  }

  /** The badge again (another source's count changed). A badge that fails is logged, never thrown at the caller. */
  refreshBadge(): void {
    const n = this.waiting.size + (this.d.otherCount?.() ?? 0);
    if (n === this.shown) return;
    try {
      this.d.badge(n);
      this.shown = n;
    } catch (err) {
      this.log("Could not set the Dock badge", err);
    }
  }

  private async apply(tasks: readonly TaskSummary[]): Promise<void> {
    const now = new Map(tasks.filter((t) => t.state === "waiting").map((t) => [t.id, t]));
    const entered = [...now.values()].filter((t) => !this.waiting.has(t.id));
    this.waiting = new Set(now.keys());
    this.refreshBadge();
    // The store's items follow `raised`, which changes only when a call succeeded: a failed one is tried again next time.
    const raise = [...now.values()].filter((t) => !this.raised.has(t.id));
    const resolve = [...this.raised].filter((id) => !now.has(id));
    if (raise.length === 0 && resolve.length === 0 && entered.length === 0) return;
    const store = await this.d.store().catch((err: unknown) => {
      this.log("Could not open the Attention inbox", err);
      return null;
    });
    for (const t of raise) {
      if (!store) break;
      try {
        await store.raise({ kind: "task", id: t.id }, { key: WAITING_KEY, severity: "action", title: titleOf(t), target: { panel: "task", focus: t.id } });
        this.raised.add(t.id);
      } catch (err) {
        this.log("Could not raise a waiting task", err);
      }
    }
    for (const t of entered) {
      if (this.d.windowFocused()) continue;
      const on = await Promise.resolve()
        .then(() => this.d.notifyOn())
        .catch(() => false);
      if (on !== true) continue;
      try {
        this.d.notify({ title: titleOf(t), body: WAITING_BODY }, t.id);
      } catch (err) {
        this.log("Could not show a notification", err);
      }
    }
    for (const id of resolve) {
      if (!store) break;
      try {
        await store.resolve({ kind: "task", id }, WAITING_KEY);
        this.raised.delete(id);
      } catch (err) {
        this.log("Could not resolve a waiting task", err);
      }
    }
  }

  private log(message: string, err?: unknown): void {
    (this.d.log ?? console.error)(message, err);
  }
}

function titleOf(t: TaskSummary): string {
  return t.label.slice(0, ATTENTION_LIMITS.titleChars).trim() || "Task";
}

/**
 * Electron can collect a Notification nothing references, and its click goes with it: each one stays in `kept` until
 * it is clicked, closed or failed. At most `max` are held; the oldest is let go first.
 */
export function keepNotification<N extends { once(event: "click" | "close" | "failed", fn: () => void): unknown }>(n: N, kept: Set<N>, max = 20): N {
  kept.add(n);
  const done = () => void kept.delete(n);
  n.once("click", done);
  n.once("close", done);
  n.once("failed", done);
  for (const old of kept) {
    if (kept.size <= max) break;
    kept.delete(old);
  }
  return n;
}
