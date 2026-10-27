import type { EngineDef, ModelProfile } from "@humanharness/engines";
import { SIDEKICK_ALWAYS_MAX_MS, type SidekickManifest } from "@humanharness/harness-sdk";
import type { SidekickAnswer, SidekickSessionOptions } from "@humanharness/runtime";
import type { SidekickCard, SidekickOutcome, SidekickReview, SidekickSetResult, SidekickSettings, SidekickSettingsPatch, SidekickState } from "@humanharness/ui/client";
import type { SidekickStore } from "./sidekick-store";
import { type UsageRecord, sidekickSpent, sidekickWeek } from "./usage-log";

/** Part 1's one sidekick (plan Decision 9). */
export const SIDEKICK_ID = "sidekick";
export const SIDEKICK_NAME = "Sidekick";
/** A `suggest` shows a card at or above this confidence (spec §6.2's starting threshold; per kind in part 2). */
export const SIDEKICK_THRESHOLD = 0.5;

/** What the controller needs of a session (SidekickSession, or a fake in tests). */
export interface SidekickLike {
  readonly profile: ModelProfile;
  ask(prompt: string, signal: AbortSignal): Promise<SidekickAnswer>;
  close(): Promise<void>;
}

export interface OpenTask {
  id: string;
  action?: string;
  scope: string;
  /** The open phase's id, when the action has phases. */
  phase?: string;
}

export interface SidekickDeps {
  manifest?: SidekickManifest;
  harness: { name: string; tagline?: string };
  /** The phases of `action`, in order ([] without). */
  phases(action: string | undefined): readonly { id: string; label: string; brief?: string }[];
  store: SidekickStore;
  /** The set-up app's engine and base; null when it isn't set up. */
  setup(): Promise<{ engineId: string; base: string } | null>;
  hasNotice(engineId: string): Promise<boolean>;
  engine(engineId: string): EngineDef;
  /** The engine's CLI; null when it can't be found. */
  command(engine: EngineDef): Promise<{ command: string[]; env: Record<string, string> } | null>;
  /** Sidekick's model (the `sidekick` process in Settings › Models), resolved when a session opens. */
  profile(engine: EngineDef): Promise<ModelProfile>;
  /** The session's working folder for `base` (sidekickWorkDir). */
  workDir(base: string): string;
  writeBrief(folder: string, text: string, engine: EngineDef): Promise<unknown>;
  open(o: SidekickSessionOptions): SidekickLike;
  task(): Promise<OpenTask | null>;
  /** The scope's note titles (latest first) and the data tables the task agent sees. */
  context(base: string, scope: string | undefined): Promise<{ notes: string[]; data: string[] }>;
  /** The app's UI language, by name. */
  uiLanguage(): Promise<string>;
  usage(base: string): Promise<UsageRecord[]>;
  log(base: string, record: UsageRecord): Promise<void>;
  changed(state: SidekickState): void;
  /** The wait for a setting, in ms (tests shorten it). */
  waitMs?(wait: SidekickSettings["wait"]): number;
}

export const defaultWaitMs = (wait: SidekickSettings["wait"]): number => (wait === "always" ? SIDEKICK_ALWAYS_MAX_MS : wait * 1000);
/** Sessions are bound to the open task; a review with no task open binds to NO_TASK, adopted by the next task. */
const NO_TASK = "";

/**
 * Sidekick (spec §4.1, §5, §8): the local check, the decision, the model review with its timeout, the card, the
 * cap, and one no-tools session per task. Never blocks a send: every failure sends the prompt as typed.
 */
export class SidekickController {
  private readonly sessions = new Map<string, { session: SidekickLike; base: string }>();
  /** Tokens toward the cap of reviews that ran before their task existed (moved on adoption). */
  private readonly pending = new Map<string, number>();
  private running: AbortController | null = null;
  private card: SidekickCard | null = null;
  private notice: SidekickState["notice"];
  private closed = false;

  constructor(private readonly d: SidekickDeps) {}

  async state(): Promise<SidekickState> {
    const settings = await this.d.store.settings();
    const setup = await this.d.setup().catch(() => null);
    const task = await this.d.task().catch(() => null);
    const records = setup ? await this.d.usage(setup.base).catch(() => []) : [];
    const spent = (task ? sidekickSpent(records, task.id) : 0) + (this.pending.get(task?.id ?? NO_TASK) ?? 0);
    const cap = settings.cap === "none" ? null : settings.cap;
    let tier = "light";
    if (setup) {
      const p = await this.d.profile(this.d.engine(setup.engineId)).catch(() => null);
      if (p) tier = p.tier;
    }
    const status: SidekickState["status"] = !settings.on
      ? "off"
      : this.running
        ? "reading"
        : this.card
          ? "suggestion"
          : cap !== null && spent >= cap
            ? "capped"
            : "watching";
    return {
      info: { id: SIDEKICK_ID, name: SIDEKICK_NAME },
      settings,
      status,
      spent,
      cap,
      tier,
      card: this.card,
      week: sidekickWeek(records),
      ...(this.notice ? { notice: this.notice } : {}),
    };
  }

  async set(patch: SidekickSettingsPatch): Promise<SidekickSetResult> {
    const r = await this.d.store.set(patch);
    if (r.ok && !r.settings.on) {
      // Off: nothing runs and nothing stays open (D0: "the person can turn it off").
      this.running?.abort();
      this.card = null;
      await this.closeSessions(() => true);
    }
    await this.push();
    return r;
  }

  async resolve(cardId: string, _outcome: SidekickOutcome): Promise<void> {
    // Part 2 appends the outcome to events.jsonl (spec §6.1).
    if (this.card?.id !== cardId) return;
    this.card = null;
    await this.push();
  }

  cancel(): void {
    this.running?.abort();
  }

  /** Between tasks (TaskDeps.betweenTasks): sessions of tasks no longer open close (spec §5 "closed when the task closes"). */
  async betweenTasks(): Promise<void> {
    const open = (await this.d.task().catch(() => null))?.id;
    await this.closeSessions((key) => key !== NO_TASK && key !== open);
    if (this.card && open === undefined) {
      this.card = null;
      await this.push();
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.running?.abort();
    await this.closeSessions(() => true);
  }

  review(req: { text: string; force?: boolean }): Promise<SidekickReview> {
    // Task 11.
    void req;
    return Promise.resolve({ kind: "send" });
  }

  private async closeSessions(which: (key: string) => boolean): Promise<void> {
    const gone = [...this.sessions].filter(([key]) => which(key));
    for (const [key] of gone) {
      this.sessions.delete(key);
      this.pending.delete(key);
    }
    await Promise.all(gone.map(([, s]) => s.session.close().catch(() => undefined)));
  }

  private async push(): Promise<void> {
    if (this.closed) return;
    this.d.changed(await this.state());
  }
}
