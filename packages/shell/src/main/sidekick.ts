import { randomUUID } from "node:crypto";
import type { EngineDef, ModelProfile } from "@humanharness/engines";
import { SIDEKICK_ALWAYS_MAX_MS, type SidekickManifest, sidekickMinWords, sidekickMode, sidekickTips } from "@humanharness/harness-sdk";
import type { SidekickAnswer, SidekickSessionOptions } from "@humanharness/runtime";
import type { SidekickCard, SidekickOutcome, SidekickReview, SidekickSetResult, SidekickSettings, SidekickSettingsPatch, SidekickState } from "@humanharness/ui/client";
import { localCheck, sidekickBrief } from "@humanharness/workspace";
import type { SidekickStore } from "./sidekick-store";
import { parseReview, preSendPrompt } from "./sidekick-turns";
import { type UsageRecord, capTokens, sidekickRecord, sidekickSpent, sidekickWeek } from "./usage-log";

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
/**
 * Sessions are bound to the open task; a review with no task open binds to NO_TASK, adopted by the next task. A NO_TASK
 * session survives one betweenTasks (the one right before its task starts); the next closes it, so it never outlives
 * the task it was made for.
 */
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
  /** Bumped by every review, cancel, turn-off and close: a review superseded while it awaited its inputs ends as cancelled. */
  private reviews = 0;
  /** The NO_TASK session may survive the next betweenTasks (set whenever a review uses it). */
  private looseArmed = false;
  private card: SidekickCard | null = null;
  private notice: SidekickState["notice"];
  private closed = false;
  /** Sidekick's usage lines per base, read once: only the controller writes them, and each write drops the copy. */
  private readonly lines = new Map<string, Promise<UsageRecord[]>>();
  /** The tier last resolved; state() resolves it only while on (Settings › Models changes show from the next state). */
  private tier = "light";

  constructor(private readonly d: SidekickDeps) {}

  async state(): Promise<SidekickState> {
    const settings = await this.d.store.settings();
    const setup = await this.d.setup().catch(() => null);
    const task = await this.d.task().catch(() => null);
    const records = setup ? await this.usage(setup.base) : [];
    const spent = (task ? sidekickSpent(records, task.id) : 0) + (this.pending.get(task?.id ?? NO_TASK) ?? 0);
    const cap = settings.cap === "none" ? null : settings.cap;
    if (setup && settings.on) {
      // An unknown engine id (a hand-edited setup) must not make state() reject.
      const p = await Promise.resolve()
        .then(() => this.d.profile(this.d.engine(setup.engineId)))
        .catch(() => null);
      if (p) this.tier = p.tier;
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
      tier: this.tier,
      card: this.card,
      week: sidekickWeek(records),
      ...(this.notice ? { notice: this.notice } : {}),
    };
  }

  async set(patch: SidekickSettingsPatch): Promise<SidekickSetResult> {
    const r = await this.d.store.set(patch);
    if (r.ok && !r.settings.on) {
      // Off: nothing runs and nothing stays open (D0: "the person can turn it off").
      this.reviews++;
      this.running?.abort();
      this.card = null;
      this.notice = undefined;
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
    this.reviews++;
    this.running?.abort();
  }

  /** Between tasks (TaskDeps.betweenTasks): sessions of tasks no longer open close (spec §5 "closed when the task closes"). */
  async betweenTasks(): Promise<void> {
    const open = (await this.d.task().catch(() => null))?.id;
    const keepLoose = this.looseArmed;
    this.looseArmed = false;
    await this.closeSessions((key) => (key === NO_TASK ? !keepLoose : key !== open));
    if (this.card && open === undefined) {
      this.card = null;
      await this.push();
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.reviews++;
    this.running?.abort();
    await this.closeSessions(() => true);
  }

  /**
   * The pre-send review (spec §4.1): the local check, the decision, the model within the wait, the card. `force` is
   * the Review button; `attached` says the send carries attachments or material, so "the file" isn't missing context.
   */
  async review(req: { text: string; force?: boolean; attached?: boolean }): Promise<SidekickReview> {
    const turn = ++this.reviews;
    this.running?.abort();
    // An early return still pushes when it cleared a card or notice, so the renderer drops them too.
    const stale = this.card !== null || this.notice !== undefined;
    this.card = null;
    this.notice = undefined;
    const early = async (kind: "send" | "cancelled"): Promise<SidekickReview> => {
      if (stale) await this.push();
      return { kind };
    };
    const live = () => turn === this.reviews && !this.closed;
    const settings = await this.d.store.settings();
    if (this.closed || !settings.on || !settings.preSend) return early("send");
    const task = await this.d.task().catch(() => null);
    const mode = sidekickMode(this.d.manifest, task?.action);
    if (mode === "off") return early("send");
    const setup = await this.d.setup().catch(() => null);
    if (!setup || !(await this.d.hasNotice(setup.engineId).catch(() => false))) return early("send");

    // 1. The local check (0 tokens).
    const ctx = await this.d.context(setup.base, task?.scope).catch(() => ({ notes: [] as string[], data: [] as string[] }));
    const phases = this.d.phases(task?.action);
    const open = phases.find((p) => p.id === task?.phase);
    const flags = localCheck(req.text, {
      minWords: sidekickMinWords(this.d.manifest),
      known: [...ctx.notes, ...ctx.data],
      ...(open ? { phases: { open, others: phases.filter((p) => p.id !== open.id) } } : {}),
      ...(req.attached ? { muted: ["missing-context" as const] } : {}),
    });
    // 2. The decision.
    if (flags.length === 0 && mode === "auto" && !req.force) return early("send");
    const key = task?.id ?? NO_TASK;
    const records = await this.usage(setup.base);
    const spent = (task ? sidekickSpent(records, task.id) : 0) + (this.pending.get(key) ?? 0);
    if (settings.cap !== "none" && spent >= settings.cap) return early("send");

    // 3. The model, within the wait (unless a newer review, ⌘⏎, turning off or closing superseded this one meanwhile).
    if (!live()) return early("cancelled");
    const controller = new AbortController();
    this.running = controller;
    let timedOut = false;
    const timer = setTimeout(
      () => {
        timedOut = true;
        controller.abort();
      },
      (this.d.waitMs ?? defaultWaitMs)(settings.wait),
    );
    try {
      await this.push();
      const engine = this.d.engine(setup.engineId);
      const session = await this.sessionFor(setup.base, engine, key, task?.id, live);
      if (timedOut) return this.finish("timeout");
      if (controller.signal.aborted || !live()) return this.finish("cancelled");
      if (!session) return this.finish("error");
      const prompt = preSendPrompt({
        harness: this.d.harness,
        ...(open ? { phase: { label: open.label, ...(open.brief ? { brief: open.brief } : {}) } } : {}),
        notes: ctx.notes,
        data: ctx.data,
        flags,
        uiLanguage: await this.d.uiLanguage().catch(() => "English"),
        prompt: req.text,
      });
      if (!live()) return this.finish("cancelled");
      const answer = await session.ask(prompt, controller.signal);
      if (answer.usage) {
        if (!task) this.pending.set(key, (this.pending.get(key) ?? 0) + capTokens(answer.usage));
        const record = sidekickRecord({
          engine: engine.id,
          ...(task ? { task: task.id, scope: task.scope } : {}),
          ...(task?.action ? { action: task.action } : {}),
          sidekick: SIDEKICK_ID,
          moment: "pre",
          profile: session.profile,
          ok: answer.ok,
          usage: answer.usage,
          ...(answer.limits ? { limits: answer.limits } : {}),
        });
        await this.d.log(setup.base, record).catch((err: unknown) => console.error("Could not record the Sidekick turn", err));
        this.lines.delete(setup.base);
      }
      // A late answer is dropped: the prompt already went as typed (or the person sent at once).
      if (timedOut) return this.finish("timeout");
      if (controller.signal.aborted) return this.finish("cancelled");
      const reply = answer.ok ? parseReview(answer.text, req.text) : null;
      if (!reply) return this.finish("error");
      if (reply.verdict === "send" || reply.confidence < SIDEKICK_THRESHOLD) return this.finish("send");
      // 4. The card.
      this.card = {
        id: randomUUID(),
        prompt: req.text,
        flags,
        issues: reply.issues,
        ...(reply.rewrite ? { rewrite: reply.rewrite } : {}),
        ...(reply.queued?.length ? { queued: reply.queued } : {}),
        confidence: reply.confidence,
        at: new Date().toISOString(),
      };
      return { kind: "card", card: this.card };
    } catch (err) {
      console.error("Sidekick could not review the prompt", err);
      return this.finish(timedOut ? "timeout" : controller.signal.aborted ? "cancelled" : "error");
    } finally {
      clearTimeout(timer);
      if (this.running === controller) this.running = null;
      await this.push();
    }
  }

  /** Records the quiet notice for a failed review (spec §5 "Errors") and returns what the composer does. */
  private finish(kind: "send" | "timeout" | "error" | "cancelled"): SidekickReview {
    if (kind === "timeout") this.notice = "timeout";
    if (kind === "error") this.notice = "failed";
    return { kind };
  }

  /**
   * The session for `key` (the open task, or NO_TASK): reused; a task adopts the NO_TASK session a review opened
   * before it existed; else a new one, its brief written first and never again for that session (spec §5). Null
   * without a CLI, or once `live` says the review was superseded (nothing written, nothing opened).
   */
  private async sessionFor(base: string, engine: EngineDef, key: string, taskId: string | undefined, live: () => boolean): Promise<SidekickLike | null> {
    const s = await this.findSession(base, engine, key, taskId, live);
    if (s && key === NO_TASK) this.looseArmed = true;
    return s;
  }

  private async findSession(base: string, engine: EngineDef, key: string, taskId: string | undefined, live: () => boolean): Promise<SidekickLike | null> {
    const have = this.sessions.get(key);
    if (have && have.base === base) return have.session;
    if (taskId !== undefined) {
      const loose = this.sessions.get(NO_TASK);
      if (loose && loose.base === base) {
        // Decision 14: the pre-task spend stays in the week's total; the task's own lines start its cap.
        this.sessions.delete(NO_TASK);
        this.pending.delete(NO_TASK);
        this.sessions.set(key, loose);
        return loose.session;
      }
    }
    if (have) {
      this.sessions.delete(key);
      await have.session.close().catch(() => undefined);
    }
    const cmd = await this.d.command(engine).catch(() => null);
    if (!cmd) return null;
    const profile = await this.d.profile(engine);
    if (!live()) return null;
    const folder = this.d.workDir(base);
    const tips = sidekickTips(this.d.manifest);
    await this.d.writeBrief(folder, sidekickBrief({ name: SIDEKICK_NAME, harness: this.d.harness.name, ...(tips ? { tips } : {}) }), engine);
    // A review that replaced this one may have opened the key's session meanwhile: keep that one.
    const raced = this.sessions.get(key);
    if (raced && raced.base === base) return raced.session;
    if (!live()) return null;
    const session = this.d.open({ engine, command: cmd.command, env: cmd.env, folder, profile });
    this.sessions.set(key, { session, base });
    return session;
  }

  /** Sidekick's usage lines in `base` (cached; [] when the log can't be read, which is not kept). */
  private usage(base: string): Promise<UsageRecord[]> {
    let lines = this.lines.get(base);
    if (!lines) {
      lines = this.d.usage(base).then((rs) => rs.filter((r) => r.phase === "sidekick"));
      this.lines.set(base, lines);
      lines.catch(() => {
        if (this.lines.get(base) === lines) this.lines.delete(base);
      });
    }
    return lines.catch(() => []);
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
