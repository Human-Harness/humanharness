import { randomBytes, randomUUID } from "node:crypto";
import type { EngineDef, ModelProfile } from "@humanharness/engines";
import { DEFAULT_SIDEKICK, SIDEKICK_ALWAYS_MAX_MS, SIDEKICK_COLLECTION, type SidekickDef, type SidekickManifest, type SidekickMoment, sidekickMinWords, sidekickMode, sidekickTips } from "@humanharness/harness-sdk";
import type { SidekickAnswer, SidekickSessionOptions } from "@humanharness/runtime";
import type { SidekickCard, SidekickHeadsUp, SidekickInfo, SidekickLearned, SidekickOutcome, SidekickReview, SidekickSetResult, SidekickSettings, SidekickSettingsPatch, SidekickState } from "@humanharness/ui/client";
import {
  MAIN_SCOPE,
  SIDEKICK_FLAG_KINDS,
  type SidekickEvent,
  type SidekickEventMoment,
  type SidekickFlagKind,
  localCheck,
  sidekickBrief,
  thresholdFor,
  usedShare,
  whyShown,
} from "@humanharness/workspace";
import { candidates, pickSpeaker } from "./sidekick-route";
import type { SidekickStore } from "./sidekick-store";
import { SIDEKICK_LEARN_MIN, afterReplyPrompt, learnPrompt, parseAfter, parseLearn, parseReview, parseRoute, preSendPrompt, routePrompt } from "./sidekick-turns";
import type { TurnEnd } from "./task-manager";
import { type UsageRecord, capTokens, sidekickRecord, sidekickSpent, sidekickWeek } from "./usage-log";

/** Part 1's one sidekick (plan Decision 9). */
export const SIDEKICK_ID = DEFAULT_SIDEKICK.id;
export const SIDEKICK_NAME = DEFAULT_SIDEKICK.name;
const SPEAKER: SidekickInfo = { id: DEFAULT_SIDEKICK.id, name: DEFAULT_SIDEKICK.name, mark: DEFAULT_SIDEKICK.mark };
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** The task's earlier prompts an after-reply turn keeps (its prompt names the last three). */
const PROMPTS_KEPT = 4;
/** Heads-ups (spec §4.3): the context share that warns, how often an ask comes back, how many off-phase prompts in a row. */
const CONTEXT_SHARE = 0.75;
const REPEATS = 3;
const DRIFT = 2;
/** Every off-phase flag kind but the one that names a phase (finding which other phase a prompt matched). */
const NOT_OFF_PHASE = SIDEKICK_FLAG_KINDS.filter((k) => k !== "off-phase");
/** Learning (spec §6.4): the newest events its prompt names, and how long its turn may run. */
const LEARN_EVENTS = 50;
const LEARN_MS = 60_000;
/** How long a routing turn (spec §2a.3) may run before the person's order decides. */
const ROUTE_MS = 15_000;
/** The routing session's folder (a reserved sidekick id) and its brief: it only names who speaks. */
const ROUTE_ID = "route";
const ROUTE_BRIEF = "# Route\n\nYou pick which sidekick of the app should speak. Answer with one id from the choices only. Never act.\n";

/** What a card names: the speaker's id, name and mark. */
const infoOf = (s: SidekickDef): SidekickInfo => ({ id: s.id, name: s.name, mark: s.mark });
/** Part 1's sidekick unchanged (name, personality, purposes): its session gets part 1's brief (D0). */
const plainDefault = (s: SidekickDef) =>
  s.name === DEFAULT_SIDEKICK.name && !s.personality.trim() && JSON.stringify(s.purposes) === JSON.stringify(DEFAULT_SIDEKICK.purposes);

/** The events line's short name (spec §6.1) for an SDK moment. */
export function eventMoment(m: SidekickMoment): SidekickEventMoment {
  if (m === "pre-send") return "pre";
  if (m === "after-reply") return "after";
  if (m.startsWith("place:")) return "place";
  return m as Exclude<SidekickEventMoment, "pre" | "after" | "place">;
}

/** A sidekick's muted kinds (`muted` is keyed by stored, untrusted ids). */
const mutedOf = (s: SidekickSettings, sidekick: string): string[] => (Object.hasOwn(s.muted, sidekick) ? s.muted[sidekick] : []);
const taskFields = (t: OpenTask | null) => (t ? { task: t.id, scope: t.scope, ...(t.action ? { action: t.action } : {}) } : {});

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
  /**
   * Sidekick's model (the `sidekick` process in Settings › Models), resolved when a session opens; with `tier`, that
   * tier's model instead (a sidekick's own tier, or the routing turn's light one).
   */
  profile(engine: EngineDef, tier?: "light" | "standard" | "deep"): Promise<ModelProfile>;
  /** The session's working folder for `base` (sidekickWorkDir): the sidekick's, or a one-off turn's (`id`). */
  workDir(base: string, id?: string): string;
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
  /** The learning signals (`.harness/sidekick/events.jsonl`, spec §6.1). */
  events: { read(base: string): Promise<SidekickEvent[]>; append(base: string, e: SidekickEvent): Promise<void> };
  /** "Save as decision" (plan Decision 7): a note written as the person in the task's scope, with its history commit. */
  saveDecision(o: { task: string; scope: string; action?: string; title: string; decision: string }): Promise<void>;
  /**
   * Data requests on the `sidekick` collection as the app (learning, spec §6.4), all run then one history commit.
   * Refused (throws) when `base` is no longer the set-up app's base, or a switch, restore or quit holds turns.
   */
  writeApp(base: string, requests: unknown[]): Promise<void>;
  /** How long a learning turn may run, in ms (tests shorten it). */
  learnMs?: number;
  /** How long a routing turn may run, in ms (tests shorten it). */
  routeMs?: number;
}

export const defaultWaitMs = (wait: SidekickSettings["wait"]): number => (wait === "always" ? SIDEKICK_ALWAYS_MAX_MS : wait * 1000);
/**
 * Sessions are bound to a sidekick and the open task; a review with no task open binds to NO_TASK, adopted by that
 * sidekick's session in the next task. A NO_TASK session survives one betweenTasks (the one right before its task
 * starts); the next closes it, so it never outlives the task it was made for.
 */
const NO_TASK = "";

/** One sidekick's session (spec §2a: one per sidekick and task), with the base and task it was opened for. */
interface Held {
  session: SidekickLike;
  base: string;
  sidekick: string;
  task: string;
}
const heldKey = (sidekick: string, task: string) => `${sidekick}\n${task}`;

/**
 * Sidekick (spec §4.1, §5, §8): the local check, the decision, the model review with its timeout, the card, the
 * cap, and one no-tools session per task. Never blocks a send: every failure sends the prompt as typed.
 */
export class SidekickController {
  /** Keyed by heldKey(sidekick, task). */
  private readonly sessions = new Map<string, Held>();
  /**
   * Tokens toward the cap of reviews that ran before their task existed, counted by state() only while no task is
   * open; dropped on adoption (Decision 14: the task's own lines start its cap; the week's total keeps them).
   */
  private readonly pending = new Map<string, number>();
  private running: AbortController | null = null;
  /** Bumped by every review, cancel, turn-off and close: a review superseded while it awaited its inputs ends as cancelled. */
  private reviews = 0;
  /** The NO_TASK session may survive the next betweenTasks (set whenever a review uses it). */
  private looseArmed = false;
  private card: SidekickCard | null = null;
  /** The task and base the card was made in: its outcome's event names them. */
  private cardCtx: { task: OpenTask | null; base: string } | null = null;
  /** The running after-reply turn; a send drops it (spec §5 "Sending cancels"). */
  private after: AbortController | null = null;
  /**
   * Bumped by every send, review, turn-off, move and close: an after-reply turn that started before one of them never
   * asks or shows its card, even while it is still setting up (before `after` holds its controller).
   */
  private sends = 0;
  /** The open task's waiting cards other than the live pre-send one (after the reply), with where each was made. */
  private cards: { card: SidekickCard; ctx: { task: OpenTask | null; base: string } }[] = [];
  /** Running routing turns (spec §2a.3); turning off, a profile switch or closing aborts them. */
  private readonly routing = new Set<AbortController>();
  /** The running learning turn (spec §6.4); turning off, a profile switch or closing drops it. */
  private learning: AbortController | null = null;
  /** The running learning turn's promise (never rejects), for `learned`. */
  private learnRun: Promise<void> | null = null;
  /** The task open at the last betweenTasks (or seen open since): learning runs only when it closes (spec §6.4). */
  private lastOpen = NO_TASK;
  /** The task's earlier prompts, oldest first, for its next after-reply turn. */
  private prompts: { key: string; items: string[] } = { key: NO_TASK, items: [] };
  /** The open task's earlier cards (spec §7 "Earlier · used"); reset when another task opens. */
  private past: { key: string; items: SidekickState["past"] } = { key: NO_TASK, items: [] };
  /** Per task (spec §4.3): whether the context heads-up showed, how often each topic came back, the off-phase streak. */
  private signals = { task: NO_TASK, context: false, topics: new Map<string, number>(), drift: 0 };
  /**
   * Event writes per base, one at a time: appendSidekickEvent's trim (read, temp file, rename) must not race another
   * append. The events per base are read once and dropped after each write.
   */
  private readonly eventWrites = new Map<string, Promise<void>>();
  private readonly eventLines = new Map<string, Promise<SidekickEvent[]>>();
  private notice: SidekickState["notice"];
  private closed = false;
  /** The base the last review or refresh saw: a refresh with another one is a profile switch. */
  private base: string | undefined;
  /**
   * Sidekick's usage lines per base, read once: only the controller writes them, and each write drops the copy.
   * This assumes one app process per base (the single-instance lock); another process writing the same log goes unseen.
   */
  private readonly lines = new Map<string, Promise<UsageRecord[]>>();

  constructor(private readonly d: SidekickDeps) {}

  async state(): Promise<SidekickState> {
    const settings = await this.d.store.settings();
    const setup = await this.d.setup().catch(() => null);
    const task = await this.d.task().catch(() => null);
    // A task restored at launch is seen here first: its close is a close too.
    if (task) this.lastOpen = task.id;
    const records = setup ? await this.usage(setup.base) : [];
    const events = setup ? await this.events(setup.base) : [];
    const since = Date.now() - WEEK_MS;
    const spent = (task ? sidekickSpent(records, task.id) : 0) + (this.pending.get(task?.id ?? NO_TASK) ?? 0);
    const cap = settings.cap === "none" ? null : settings.cap;
    let tier = "light";
    if (setup) {
      // Read from the saved models (no model runs), so Settings shows the right tier while off too.
      // An unknown engine id (a hand-edited setup) must not make state() reject.
      const p = await Promise.resolve()
        .then(() => this.d.profile(this.d.engine(setup.engineId)))
        .catch(() => null);
      if (p) tier = p.tier;
    }
    const status: SidekickState["status"] = !settings.on
      ? "off"
      : this.running
        ? "reading"
        : this.card || this.cards.length
          ? "suggestion"
          : cap !== null && spent >= cap
            ? "capped"
            : "watching";
    return {
      info: SPEAKER,
      settings,
      status,
      spent,
      cap,
      tier,
      card: this.card,
      cards: this.cards.map((c) => c.card),
      week: sidekickWeek(records),
      past: this.past.key === (task?.id ?? NO_TASK) ? [...this.past.items] : [],
      used: usedShare(events.filter((e) => Date.parse(e.at) >= since)),
      ...(this.notice ? { notice: this.notice } : {}),
    };
  }

  async set(patch: SidekickSettingsPatch): Promise<SidekickSetResult> {
    const r = await this.d.store.set(patch);
    if (r.ok && !r.settings.on) {
      // Off: nothing runs and nothing stays open (D0: "the person can turn it off").
      this.reviews++;
      this.running?.abort();
      this.dropAfter();
      this.learning?.abort();
      this.abortRouting();
      this.card = null;
      this.cards = [];
      this.notice = undefined;
      await this.closeSessions(() => true);
    }
    await this.push();
    return r;
  }

  /** What the person did with the card (spec §6.1): one event, and a line in the task's earlier cards. */
  async resolve(cardId: string, outcome: SidekickOutcome): Promise<void> {
    const card = this.take(cardId);
    if (!card) return;
    await this.outcome(card.card, card.ctx, outcome);
    await this.push();
  }

  /** "Don't flag …" (spec §6.3): the card's kind is muted for its sidekick at once and remembered as the person's. */
  async mute(cardId: string): Promise<void> {
    const card = this.take(cardId);
    if (!card) return;
    const { speaker, kind } = card.card;
    await this.d.store.mute(speaker.id, speaker.name, kind, new Date().toISOString()).catch((err: unknown) => console.error("Could not mute the Sidekick suggestion", err));
    await this.outcome(card.card, card.ctx, "muted");
    await this.push();
  }

  /** Undoes a mute (Settings). */
  async unmute(sidekick: string, kind: string): Promise<void> {
    await this.d.store.unmute(sidekick, kind);
    await this.push();
  }

  /**
   * "Save as decision" on a repeated-ask heads-up of the open task (plan Decision 7): the note is written as the
   * person, then the card goes with a `used` outcome. A failed write keeps the card and says why.
   */
  async saveDecision(cardId: string): Promise<{ ok: boolean; message?: string }> {
    const found = this.cards.find((c) => c.card.id === cardId);
    const h = found?.card.headsUp;
    const task = found?.ctx.task;
    if (!found || h?.kind !== "repeated" || !task) return { ok: false, message: "This suggestion can't be saved as a decision" };
    if ((await this.d.task().catch(() => null))?.id !== task.id) return { ok: false, message: "Its task is no longer open" };
    try {
      await this.d.saveDecision({ task: task.id, scope: task.scope, ...(task.action ? { action: task.action } : {}), title: `Decision: ${h.topic}`, decision: h.decision });
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
    const taken = this.take(cardId);
    if (taken) await this.outcome(taken.card, taken.ctx, "used");
    await this.push();
    return { ok: true };
  }

  /** What Sidekick learned (spec §6.4), both levels, for Settings; off too, since the items are the person's data. */
  async learned(): Promise<SidekickLearned[]> {
    return (await this.learnedRecords()).map((r) => ({
      id: r.id,
      text: r.text ?? "",
      level: r.level ?? "you",
      ...(r.kind !== undefined ? { kind: r.kind } : {}),
      source: r.source === "person" ? "person" : "learned",
    }));
  }

  /** "Forget this": the item is deleted as the person (a `Data: sidekick` commit). Only a learned item; a failed write throws. */
  async forget(id: string): Promise<void> {
    if (!(await this.learnedRecords()).some((r) => r.id === id)) return;
    await this.d.store.remove(id);
  }

  /** "Forget everything": every learned item of both levels, the person's too (they asked). The settings stay. */
  async forgetAll(): Promise<void> {
    for (const r of await this.learnedRecords()) await this.d.store.remove(r.id);
  }

  /** The person's edits: each changed item gets the new text and becomes theirs, so learning never changes it again. */
  async editLearned(changes: { id: string; text: string }[]): Promise<void> {
    const items = new Map((await this.learnedRecords()).map((r) => [r.id, r]));
    const now = new Date().toISOString();
    for (const { id, text } of changes) {
      const old = items.get(id);
      if (!old || old.text === text) continue;
      await this.d.store.put({ ...old, text, source: "person", updatedAt: now });
    }
  }

  private async learnedRecords() {
    return (await this.d.store.all()).filter((r) => r.type === "learned" && r.text !== undefined);
  }

  /** The card `cardId` if it is shown (the pre-send one or a waiting one); it leaves the panel. */
  private take(cardId: string): { card: SidekickCard; ctx: { task: OpenTask | null; base: string } } | null {
    const card = this.card;
    const ctx = this.cardCtx;
    if (card && card.id === cardId && ctx) {
      this.card = null;
      this.cardCtx = null;
      return { card, ctx };
    }
    const at = this.cards.findIndex((c) => c.card.id === cardId);
    if (at < 0) return null;
    const [taken] = this.cards.splice(at, 1);
    return taken;
  }

  private async outcome(card: SidekickCard, ctx: { task: OpenTask | null; base: string }, outcome: SidekickOutcome | "muted"): Promise<void> {
    const write = this.event(ctx.base, {
      at: new Date().toISOString(),
      ...taskFields(ctx.task),
      sidekick: card.speaker.id,
      moment: card.moment,
      kind: card.kind,
      outcome,
      confidence: card.confidence,
    });
    // The list is the open task's: a card of another task (resolved late) gets its event but never resets the list.
    const key = ctx.task?.id ?? NO_TASK;
    const open = (await this.d.task().catch(() => null))?.id ?? NO_TASK;
    if (this.past.key !== open) this.past = { key: open, items: [] };
    if (key === open) this.past.items.push({ id: card.id, kind: card.kind, outcome, speaker: card.speaker.id });
    await write;
  }

  /** Appends `e` after the base's earlier writes; a failure is logged, never thrown. */
  private event(base: string, e: SidekickEvent): Promise<void> {
    const run: Promise<void> = (this.eventWrites.get(base) ?? Promise.resolve())
      .then(() => this.d.events.append(base, e))
      .catch((err: unknown) => console.error("Could not record the Sidekick event", err))
      .then(() => {
        this.eventLines.delete(base);
        if (this.eventWrites.get(base) === run) this.eventWrites.delete(base);
      });
    this.eventWrites.set(base, run);
    return run;
  }

  /** The base's events (cached until the next write; a failed read is []). */
  private events(base: string): Promise<SidekickEvent[]> {
    let events = this.eventLines.get(base);
    if (!events) {
      events = this.d.events.read(base).catch(() => []);
      this.eventLines.set(base, events);
    }
    return events;
  }

  /**
   * After an undo (hh:restore, hh:restoreTask) or a profile switch (arrivedInProfile): the settings may have changed
   * under the controller, and so may the base. Off closes everything (like `set`); another base drops the running
   * review, the card and the old base's sessions, the loose one too. Then it pushes the state.
   */
  async refresh(): Promise<void> {
    if (this.closed) return;
    const settings = await this.d.store.settings();
    const base = (await this.d.setup().catch(() => null))?.base;
    const moved = this.base !== undefined && this.base !== base;
    this.base = base;
    if (!settings.on || moved) {
      this.reviews++;
      this.running?.abort();
      this.dropAfter();
      this.learning?.abort();
      this.abortRouting();
      this.card = null;
      this.cards = [];
      this.notice = undefined;
    }
    if (moved) this.pending.clear();
    await this.closeSessions(settings.on ? (s) => s.base !== base : () => true);
    await this.push();
  }

  cancel(): void {
    this.reviews++;
    this.running?.abort();
  }

  /**
   * Between tasks (TaskDeps.betweenTasks): sessions of tasks no longer open close (spec §5 "closed when the task
   * closes"); when a task just closed, Sidekick learns from the new events (spec §6.4), detached: the task manager's
   * queue never waits for the model turn.
   */
  async betweenTasks(): Promise<void> {
    const open = (await this.d.task().catch(() => null))?.id;
    // Learning is for a task → no task change, never before a task starts (no task → no task).
    const closedTask = open === undefined && this.lastOpen !== NO_TASK;
    this.lastOpen = open ?? NO_TASK;
    if (this.past.key !== (open ?? NO_TASK)) this.past = { key: open ?? NO_TASK, items: [] };
    // Another task: the old one's waiting cards and its running after-reply turn go (they were about its reply).
    const left = this.cards.filter((c) => (c.ctx.task?.id ?? NO_TASK) === (open ?? NO_TASK));
    const dropped = left.length !== this.cards.length;
    if (dropped) {
      this.dropAfter();
      this.cards = left;
    }
    const keepLoose = this.looseArmed;
    this.looseArmed = false;
    await this.closeSessions((s) => (s.task === NO_TASK ? !keepLoose : s.task !== open));
    if (this.card && open === undefined) {
      this.card = null;
      await this.push();
    } else if (dropped) await this.push();
    if (closedTask) this.startLearning();
  }

  /** The running learning turn, if any, ended (tests; resolves at once when none runs). */
  learningSettled(): Promise<void> {
    return this.learnRun ?? Promise.resolve();
  }

  /** Starts a learning turn unless one runs: one at a time, never rejecting (errors are logged). */
  private startLearning(): void {
    if (this.closed || this.learning) return;
    const controller = new AbortController();
    this.learning = controller;
    const run = this.learn(controller)
      .catch((err: unknown) => console.error("Sidekick could not learn", err))
      .finally(() => {
        if (this.learning === controller) this.learning = null;
        if (this.learnRun === run) this.learnRun = null;
      });
    this.learnRun = run;
  }

  /**
   * Learning (spec §6.4, plan Decision 6): with SIDEKICK_LEARN_MIN or more events since the last update, one turn in
   * a one-off session (its own `learn` folder, closed right after) updates the learned items, written as the app.
   * Only Sidekick's own items change; the person's (`source: "person"`) never do. Off, or turned off while the turn
   * runs: nothing is asked or written (D0). Turning off, another base (refresh) or closing aborts it; so does LEARN_MS.
   */
  private async learn(controller: AbortController): Promise<void> {
    const live = () => !controller.signal.aborted && !this.closed;
    const settings = await this.d.store.settings();
    if (!settings.on || !live()) return;
    const setup = await this.d.setup().catch(() => null);
    if (!setup || !(await this.d.hasNotice(setup.engineId).catch(() => false))) return;
    // The events still being written count too.
    await this.eventWrites.get(setup.base);
    const since = settings.learnedAt ?? "";
    const events = (await this.events(setup.base)).filter((e) => e.at > since);
    if (events.length < SIDEKICK_LEARN_MIN || !live()) return;
    let session: SidekickLike | null = null;
    try {
      const items = (await this.d.store.all()).filter((r) => r.type === "learned" && r.text !== undefined);
      const engine = this.d.engine(setup.engineId);
      session = await this.oneOff(setup.base, engine, "learn", live);
      if (!session || !live()) return;
      const prompt = learnPrompt({ items: items.map((r) => ({ id: r.id, text: r.text ?? "", level: r.level ?? "you", source: typeof r.source === "string" ? r.source : "learned" })), events: events.slice(-LEARN_EVENTS) });
      // A hung CLI must not keep the turn (and its session) forever.
      const answer = await session.ask(prompt, AbortSignal.any([controller.signal, AbortSignal.timeout(this.d.learnMs ?? LEARN_MS)]));
      await this.logTurn(setup.base, engine, session, null, "learn", answer);
      const result = answer.ok ? parseLearn(answer.text) : null;
      if (!result || !live()) return;
      // Settings may have changed while the turn ran.
      if (!(await this.d.store.settings()).on || !live()) return;
      const now = new Date().toISOString();
      // Read again: an item the person forgot or edited (now theirs) while the turn ran is no longer Sidekick's to change.
      const mine = new Map((await this.d.store.all()).filter((r) => r.type === "learned" && r.source === "learned").map((r) => [r.id, r]));
      const requests: unknown[] = [];
      for (const a of result.add) requests.push({ op: "put", collection: SIDEKICK_COLLECTION, record: { id: `l-${randomBytes(4).toString("hex")}`, type: "learned", ...a, source: "learned", updatedAt: now } });
      for (const u of result.update) {
        const old = mine.get(u.id);
        if (old) requests.push({ op: "put", collection: SIDEKICK_COLLECTION, record: { ...old, text: u.text, updatedAt: now } });
      }
      for (const id of result.remove) if (mine.has(id)) requests.push({ op: "delete", collection: SIDEKICK_COLLECTION, key: id });
      // All in one write and one commit; a refusal throws before learnedAt moves, so the next close tries again.
      if (requests.length) await this.d.writeApp(setup.base, requests);
      // Up to the newest event it read: one written while the turn ran counts toward the next update.
      const r = await this.d.store.set({ learnedAt: events.reduce((max, e) => (e.at > max ? e.at : max), since) });
      if (!r.ok) console.error("Could not record when Sidekick learned", r.message);
    } finally {
      await session?.close().catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.reviews++;
    this.running?.abort();
    this.dropAfter();
    this.learning?.abort();
    this.abortRouting();
    await this.closeSessions(() => true);
  }

  /**
   * The pre-send review (spec §4.1): the local check, the decision, the model within the wait, the card. `force` is
   * the Review button; `attached` says the send carries attachments or material, so "the file" isn't missing context.
   */
  async review(req: { text: string; force?: boolean; attached?: boolean }): Promise<SidekickReview> {
    const turn = ++this.reviews;
    this.running?.abort();
    this.dropAfter();
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
    this.base = setup.base;
    // The sidekicks that speak before a send in this scope (spec §2a.3); none: the prompt goes as typed.
    const list = await this.candidatesFor("pre-send", task?.scope);
    if (list.length === 0) return early("send");

    // 1. The local check (0 tokens), without the kinds every candidate muted (spec §6.3); the speaker's own are dropped below.
    const muted = SIDEKICK_FLAG_KINDS.filter((k) => list.every((c) => mutedOf(settings, c.id).includes(k)) || (req.attached && k === "missing-context"));
    const ctx = await this.d.context(setup.base, task?.scope).catch(() => ({ notes: [] as string[], data: [] as string[] }));
    const phases = this.d.phases(task?.action);
    const open = phases.find((p) => p.id === task?.phase);
    let flags = localCheck(req.text, {
      minWords: sidekickMinWords(this.d.manifest),
      known: [...ctx.notes, ...ctx.data],
      ...(open ? { phases: { open, others: phases.filter((p) => p.id !== open.id) } } : {}),
      ...(muted.length ? { muted } : {}),
    });
    if (task && open) await this.noteDrift({ task, base: setup.base }, settings, flags, open, phases, req.text, live);
    // 2. The decision.
    if (flags.length === 0 && mode === "auto" && !req.force) return early("send");
    const key = task?.id ?? NO_TASK;
    if (await this.pastCap(setup.base, task, settings)) return early("send");

    // 3. The model, within the wait (unless a newer review, ⌘⏎, turning off or closing superseded this one meanwhile).
    if (!live()) return early("cancelled");
    const controller = new AbortController();
    this.running = controller;
    let timedOut = false;
    // The first in the person's order until the speaker is picked (a timeout's event names it).
    let speaker = list[0]!;
    // A timeout is a learning signal too (spec §6.1); it doesn't count as a card.
    const timeout = async (): Promise<SidekickReview> => {
      await this.event(setup.base, { at: new Date().toISOString(), ...taskFields(task), sidekick: speaker.id, moment: eventMoment("pre-send"), kind: flags[0]?.kind ?? "other", outcome: "timeout" });
      return this.finish("timeout");
    };
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
      // A local-check flag goes to a prompt-coach sidekick (spec §2a.3); a routing turn runs within the wait.
      speaker = await this.pick(list, "pre-send", req.text, { base: setup.base, task, signal: controller.signal, live, ...(flags.length ? { prefer: "prompt-coach" as const } : {}) });
      if (timedOut) return await timeout();
      if (controller.signal.aborted || !live()) return this.finish("cancelled");
      const mutedKinds = mutedOf(settings, speaker.id);
      if (flags.some((f) => mutedKinds.includes(f.kind))) {
        flags = flags.filter((f) => !mutedKinds.includes(f.kind));
        if (flags.length === 0 && mode === "auto" && !req.force) return this.finish("send");
      }
      const session = await this.sessionFor(setup.base, engine, speaker, key, task?.id, live);
      if (timedOut) return await timeout();
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
      await this.logTurn(setup.base, engine, session, task, "pre", answer, speaker.id);
      // A late answer is dropped: the prompt already went as typed (or the person sent at once).
      if (timedOut) return await timeout();
      if (controller.signal.aborted) return this.finish("cancelled");
      const reply = answer.ok ? parseReview(answer.text, req.text) : null;
      if (!reply) return this.finish("error");
      // The kind's threshold (spec §6.2): raised for a kind the person keeps ignoring; a muted kind never shows.
      const kind = reply.issues[0]?.kind ?? flags[0]?.kind ?? "other";
      const events = await this.events(setup.base);
      if (reply.verdict === "send" || mutedKinds.includes(kind) || reply.confidence < thresholdFor(events, speaker.id, kind)) return this.finish("send");
      // The events read may have outlasted the wait, or a newer review may have replaced this one meanwhile.
      if (timedOut) return await timeout();
      if (controller.signal.aborted || !live()) return this.finish("cancelled");
      const why = whyShown(events, speaker.id, kind);
      // 4. The card.
      this.cardCtx = { task, base: setup.base };
      this.card = {
        id: randomUUID(),
        prompt: req.text,
        flags,
        issues: reply.issues,
        ...(reply.rewrite ? { rewrite: reply.rewrite } : {}),
        ...(reply.queued?.length ? { queued: reply.queued } : {}),
        confidence: reply.confidence,
        at: new Date().toISOString(),
        moment: eventMoment("pre-send"),
        speaker: infoOf(speaker),
        kind,
        ...(why ? { why: { used: why.used, of: why.of } } : {}),
      };
      return { kind: "card", card: this.card };
    } catch (err) {
      console.error("Sidekick could not review the prompt", err);
      if (timedOut) return await timeout();
      return this.finish(controller.signal.aborted ? "cancelled" : "error");
    } finally {
      clearTimeout(timer);
      if (this.running === controller) this.running = null;
      await this.push();
    }
  }

  /** A task turn is about to run: a running after-reply turn is dropped (spec §5 "Sending cancels"). */
  turnStarting(): void {
    this.dropAfter();
  }

  /** Drops the after-reply turn, running or still setting up. */
  private dropAfter(): void {
    this.sends++;
    this.after?.abort();
  }

  /**
   * After the reply (spec §4.2): a run turn that ended well, typed by the person (not a block's answer), gets one
   * Sidekick turn on the prompt and the cut reply; a gap, a next step or a repeated ask becomes a waiting card.
   * Off, the setting off, past the cap or without a CLI: nothing runs (D0). A send drops it while it runs.
   */
  async afterReply(end: TurnEnd): Promise<void> {
    const send = this.sends;
    const settings = await this.d.store.settings();
    if (this.closed || !settings.on) return;
    // The context heads-up costs no tokens: it runs with the after-reply moment off too.
    await this.noteContext(end, settings);
    if (!settings.afterReply) return;
    // Only what the person typed: no checkpoint, close or wrap-up prompt, no block answer, no mode switch's line.
    if (end.kind !== "run" || end.fromBlock || end.modeSwitch) return;
    if (this.prompts.key !== end.task.id) this.prompts = { key: end.task.id, items: [] };
    const earlier = [...this.prompts.items];
    this.prompts.items = [...earlier, end.prompt].slice(-PROMPTS_KEPT);
    if (!end.ok) return;
    const setup = await this.d.setup().catch(() => null);
    if (!setup || !(await this.d.hasNotice(setup.engineId).catch(() => false))) return;
    const task: OpenTask = end.task;
    // The sidekicks that speak after a reply in the task's scope (spec §2a.3).
    const list = await this.candidatesFor("after-reply", task.scope);
    if (list.length === 0) return;
    if (await this.pastCap(setup.base, task, settings)) return;
    // A send, a review or another after-reply came while this one was setting up: it is about an old reply.
    if (this.sends !== send) return;
    this.after?.abort();
    const turn = ++this.sends;
    const controller = new AbortController();
    this.after = controller;
    const live = () => !controller.signal.aborted && !this.closed && this.sends === turn;
    try {
      const engine = this.d.engine(setup.engineId);
      const speaker = await this.pick(list, "after-reply", `${end.prompt}\n\n${end.reply}`, { base: setup.base, task, signal: controller.signal, live });
      if (!live()) return;
      const session = await this.sessionFor(setup.base, engine, speaker, task.id, task.id, live);
      if (!session || !live()) return;
      const open = this.d.phases(task.action).find((p) => p.id === task.phase);
      const prompt = afterReplyPrompt({
        harness: this.d.harness,
        ...(open ? { phase: { label: open.label, ...(open.brief ? { brief: open.brief } : {}) } } : {}),
        prompt: end.prompt,
        reply: end.reply,
        lastPrompts: earlier,
        uiLanguage: await this.d.uiLanguage().catch(() => "English"),
      });
      if (!live()) return;
      const answer = await session.ask(prompt, controller.signal);
      await this.logTurn(setup.base, engine, session, task, "after", answer, speaker.id);
      if (!live() || !answer.ok) return;
      const after = parseAfter(answer.text);
      if (!after) return;
      // Settings may have changed while the turn ran.
      const now = await this.d.store.settings();
      if (!now.on || !live()) return;
      // A repeated ask is the heads-up's (spec §4.3): the after card shows only a gap or a next step.
      if (after.repeated) await this.noteRepeated({ task, base: setup.base }, now, after.repeated);
      if (!after.gap && !after.next) return;
      const kind = after.gap ? "gap" : "next";
      // A muted kind never shows (spec §6.3).
      if (!now.afterReply || mutedOf(now, speaker.id).includes(kind) || !live()) return;
      const shown = { ...(after.gap ? { gap: after.gap } : {}), ...(after.next ? { next: after.next } : {}) };
      this.cards.push({
        card: { id: randomUUID(), moment: eventMoment("after-reply"), speaker: infoOf(speaker), kind, prompt: end.prompt, flags: [], issues: [], confidence: 1, after: shown, at: new Date().toISOString() },
        ctx: { task, base: setup.base },
      });
      await this.push();
    } catch (err) {
      if (!controller.signal.aborted) console.error("Sidekick's after-reply turn failed", err);
    } finally {
      if (this.after === controller) this.after = null;
    }
  }

  /** The task's heads-up signals; another task starts them afresh. */
  private signalsFor(task: string) {
    if (this.signals.task !== task) this.signals = { task, context: false, topics: new Map(), drift: 0 };
    return this.signals;
  }

  /** The context at or past CONTEXT_SHARE of the task's cap: one heads-up per task, 0 tokens. */
  private async noteContext(end: TurnEnd, settings: SidekickSettings): Promise<void> {
    const c = end.context;
    if (!settings.headsUps || !c?.cap || c.used / c.cap < CONTEXT_SHARE) return;
    // A late turn of a closed task must not reset the open task's signals.
    if (!(await this.isOpen(end.task.id))) return;
    const signals = this.signalsFor(end.task.id);
    if (signals.context) return;
    signals.context = true;
    const setup = await this.d.setup().catch(() => null);
    if (!setup) return;
    await this.headsUp({ task: end.task, base: setup.base }, settings, { kind: "context", share: Math.round((c.used / c.cap) * 100) / 100 });
  }

  /** An ask the after-reply turn saw come back: at exactly REPEATS times, a heads-up with its draft decision. */
  private async noteRepeated(ctx: { task: OpenTask; base: string }, settings: SidekickSettings, repeated: { topic: string; decision: string }): Promise<void> {
    if (!(await this.isOpen(ctx.task.id))) return;
    const signals = this.signalsFor(ctx.task.id);
    const topic = repeated.topic.trim();
    const key = topic.toLowerCase();
    const n = (signals.topics.get(key) ?? 0) + 1;
    signals.topics.set(key, n);
    if (n === REPEATS) await this.headsUp(ctx, settings, { kind: "repeated", topic, decision: repeated.decision.trim() });
  }

  /** The off-phase streak of the task's reviewed prompts: at exactly DRIFT in a row, a heads-up naming the phase they matched. */
  private async noteDrift(
    ctx: { task: OpenTask; base: string },
    settings: SidekickSettings,
    flags: readonly { kind: string }[],
    open: { id: string; label: string },
    phases: readonly { id: string; label: string }[],
    text: string,
    live: () => boolean,
  ): Promise<void> {
    // A superseded or cancelled review (turned off, closed) counts nothing.
    if (!live() || !(await this.isOpen(ctx.task.id)) || !live()) return;
    const signals = this.signalsFor(ctx.task.id);
    if (!flags.some((f) => f.kind === "off-phase")) {
      signals.drift = 0;
      return;
    }
    if (++signals.drift !== DRIFT) return;
    const other = phases.find((p) => p.id !== open.id && localCheck(text, { minWords: 0, known: [], phases: { open, others: [p] }, muted: NOT_OFF_PHASE }).length > 0);
    await this.headsUp(ctx, settings, { kind: "off-phase", ...(other ? { phase: other.label } : {}) }, live);
  }

  /** Whether `task` is the open task. */
  private async isOpen(task: string): Promise<boolean> {
    return (await this.d.task().catch(() => null))?.id === task;
  }

  /**
   * A heads-up card (spec §4.3), waiting with the after-reply cards: only with Sidekick and heads-ups on, its kind not
   * muted, and its task still the open one (it was about that task). The settings are read again right before the
   * push: the caller's read may predate turning Sidekick off.
   */
  private async headsUp(ctx: { task: OpenTask; base: string }, settings: SidekickSettings, headsUp: SidekickHeadsUp, live: () => boolean = () => true): Promise<void> {
    const allowed = (s: SidekickSettings, id: string) => s.on && s.headsUps && !mutedOf(s, id).includes(headsUp.kind);
    if (this.closed || !settings.on || !settings.headsUps) return;
    if (!(await this.isOpen(ctx.task.id)) || this.closed) return;
    // A heads-up goes to a focus sidekick on in the task's scope (spec §2a.3); none: no heads-up.
    const list = await this.candidatesFor("heads-up", ctx.task.scope);
    if (list.length === 0 || !live()) return;
    const speaker = await this.pick(list, "heads-up", JSON.stringify(headsUp), { base: ctx.base, task: ctx.task, live: () => live() && !this.closed, prefer: "focus" });
    const now = await this.d.store.settings();
    if (this.closed || !allowed(now, speaker.id) || !live()) return;
    const card: SidekickCard = { id: randomUUID(), moment: eventMoment("heads-up"), speaker: infoOf(speaker), kind: headsUp.kind, prompt: "", flags: [], issues: [], confidence: 1, headsUp, at: new Date().toISOString() };
    this.cards.push({ card, ctx });
    await this.push();
  }

  /** The open task (or the loose session's pre-task spend) is past the cap; no cap: never. */
  private async pastCap(base: string, task: OpenTask | null, settings: SidekickSettings): Promise<boolean> {
    const records = await this.usage(base);
    const spent = (task ? sidekickSpent(records, task.id) : 0) + (this.pending.get(task?.id ?? NO_TASK) ?? 0);
    return settings.cap !== "none" && spent >= settings.cap;
  }

  /** One tagged usage line for a model turn (spec §8); a turn before its task counts toward the loose session's spend. */
  private async logTurn(
    base: string,
    engine: EngineDef,
    session: SidekickLike,
    task: OpenTask | null,
    moment: "pre" | "after" | "learn" | "route",
    answer: SidekickAnswer,
    sidekick: string = SIDEKICK_ID,
  ): Promise<void> {
    if (!answer.usage) return;
    // Learning runs between tasks: no loose session's spend.
    if (!task && moment !== "learn") this.pending.set(NO_TASK, (this.pending.get(NO_TASK) ?? 0) + capTokens(answer.usage));
    const record = sidekickRecord({
      engine: engine.id,
      ...(task ? { task: task.id, scope: task.scope } : {}),
      ...(task?.action ? { action: task.action } : {}),
      sidekick,
      moment,
      profile: session.profile,
      ok: answer.ok,
      usage: answer.usage,
      ...(answer.limits ? { limits: answer.limits } : {}),
    });
    await this.d.log(base, record).catch((err: unknown) => console.error("Could not record the Sidekick turn", err));
    this.lines.delete(base);
  }

  /** Records the quiet notice for a failed review (spec §5 "Errors") and returns what the composer does. */
  private finish(kind: "send" | "timeout" | "error" | "cancelled"): SidekickReview {
    if (kind === "timeout") this.notice = "timeout";
    if (kind === "error") this.notice = "failed";
    return { kind };
  }

  /**
   * The speaker's session for `key` (the open task, or NO_TASK): reused; a task adopts the speaker's NO_TASK session a
   * review opened before it existed; else a new one in the speaker's folder, its brief written first and never again
   * for that session (spec §5). Null without a CLI, or once `live` says the review was superseded (nothing written,
   * nothing opened).
   */
  private async sessionFor(base: string, engine: EngineDef, speaker: SidekickDef, key: string, taskId: string | undefined, live: () => boolean): Promise<SidekickLike | null> {
    const s = await this.findSession(base, engine, speaker, key, taskId, live);
    if (s && key === NO_TASK) this.looseArmed = true;
    return s;
  }

  private async findSession(base: string, engine: EngineDef, speaker: SidekickDef, key: string, taskId: string | undefined, live: () => boolean): Promise<SidekickLike | null> {
    const at = heldKey(speaker.id, key);
    const have = this.sessions.get(at);
    if (have && have.base === base) return have.session;
    if (taskId !== undefined) {
      const looseAt = heldKey(speaker.id, NO_TASK);
      const loose = this.sessions.get(looseAt);
      if (loose && loose.base === base) {
        // Decision 14: the pre-task spend stays in the week's total; the task's own lines start its cap.
        this.sessions.delete(looseAt);
        this.pending.delete(NO_TASK);
        this.sessions.set(at, { ...loose, task: key });
        return loose.session;
      }
    }
    if (have) {
      this.sessions.delete(at);
      await have.session.close().catch(() => undefined);
    }
    const cmd = await this.d.command(engine).catch(() => null);
    if (!cmd) return null;
    // The sidekick's own tier, else the `sidekick` process's.
    const profile = await this.d.profile(engine, speaker.tier);
    if (!live()) return null;
    const folder = this.d.workDir(base, speaker.id);
    const tips = sidekickTips(this.d.manifest);
    // What Sidekick learned (spec §6.4): read when the session opens, so the brief changes only between tasks.
    const learned = (await this.d.store.all()).filter((r) => r.type === "learned" && r.text).map((r) => r.text as string);
    if (!live()) return null;
    // Part 1's Sidekick keeps part 1's brief (D0); any other gets its name, personality and purposes (spec §2a.1).
    const own = plainDefault(speaker) ? {} : { sidekick: { name: speaker.name, personality: speaker.personality, purposes: speaker.purposes } };
    await this.d.writeBrief(folder, sidekickBrief({ name: SIDEKICK_NAME, harness: this.d.harness.name, ...(tips ? { tips } : {}), ...(learned.length ? { learned } : {}), ...own }), engine);
    // A review that replaced this one may have opened the key's session meanwhile: keep that one.
    const raced = this.sessions.get(at);
    if (raced && raced.base === base) return raced.session;
    if (!live()) return null;
    const session = this.d.open({ engine, command: cmd.command, env: cmd.env, folder, profile });
    this.sessions.set(at, { session, base, sidekick: speaker.id, task: key });
    return session;
  }

  /**
   * A one-off session in its own folder (`id`), never kept in `sessions`: the caller closes it. Null without a CLI or
   * once `live` says no. `tier` and `brief` replace the `sidekick` process's tier and part 1's brief.
   */
  private async oneOff(base: string, engine: EngineDef, id: string, live: () => boolean, o: { tier?: "light"; brief?: string } = {}): Promise<SidekickLike | null> {
    const cmd = await this.d.command(engine).catch(() => null);
    if (!cmd) return null;
    const profile = await (o.tier ? this.d.profile(engine, o.tier) : this.d.profile(engine));
    if (!live()) return null;
    const folder = this.d.workDir(base, id);
    const tips = sidekickTips(this.d.manifest);
    await this.d.writeBrief(folder, o.brief ?? sidekickBrief({ name: SIDEKICK_NAME, harness: this.d.harness.name, ...(tips ? { tips } : {}) }), engine);
    if (!live()) return null;
    return this.d.open({ engine, command: cmd.command, env: cmd.env, folder, profile });
  }

  /**
   * The sidekicks that speak at `moment` in `scope` (spec §2a.3), in the person's order. A sidekick no longer in the
   * list (removed) has its sessions closed here; its folder is never opened again under that id unless a new sidekick
   * takes the id, and then the new one's brief replaces the old (a session carries no state from its folder).
   */
  private async candidatesFor(moment: SidekickMoment, scope: string | undefined): Promise<SidekickDef[]> {
    const all = await this.d.store.sidekicks().catch(() => null);
    if (all) await this.closeSessions((s) => !all.some((k) => k.id === s.sidekick));
    return candidates(all ?? [DEFAULT_SIDEKICK], moment, scope ?? MAIN_SCOPE, (sc, id) => this.d.store.scopeFor(sc, id));
  }

  /** One speaker of `list` (pickSpeaker, D11), its routing turn (if any) given `context`. */
  private pick(
    list: readonly SidekickDef[],
    moment: SidekickMoment,
    context: string,
    o: { base: string; task: OpenTask | null; signal?: AbortSignal; live: () => boolean; prefer?: "prompt-coach" | "focus" },
  ): Promise<SidekickDef> {
    return pickSpeaker(list, moment, (choices) => this.routeTurn(moment, context, choices, o), o.prefer);
  }

  /**
   * The routing turn (spec §2a.3): a light one-off session in the `route` folder, closed right after, logged with
   * moment `route` toward the shared cap. Off, past the cap, another base, ROUTE_MS, turning off, a profile switch or
   * closing: "" (the person's order decides).
   */
  private async routeTurn(moment: SidekickMoment, context: string, choices: { id: string; text: string }[], o: { base: string; task: OpenTask | null; signal?: AbortSignal; live: () => boolean }): Promise<string> {
    const settings = await this.d.store.settings();
    if (this.closed || !settings.on || !o.live()) return "";
    const setup = await this.d.setup().catch(() => null);
    if (!setup || setup.base !== o.base || !(await this.d.hasNotice(setup.engineId).catch(() => false))) return "";
    if (await this.pastCap(o.base, o.task, settings)) return "";
    const controller = new AbortController();
    this.routing.add(controller);
    const live = () => !controller.signal.aborted && !o.signal?.aborted && !this.closed && o.live();
    let session: SidekickLike | null = null;
    try {
      const engine = this.d.engine(setup.engineId);
      session = await this.oneOff(o.base, engine, ROUTE_ID, live, { tier: "light", brief: ROUTE_BRIEF });
      if (!session || !live()) return "";
      // A hung CLI must not hold the moment: the person's order decides after ROUTE_MS.
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(this.d.routeMs ?? ROUTE_MS), ...(o.signal ? [o.signal] : [])]);
      const answer = await session.ask(routePrompt(moment, context, choices), signal);
      await this.logTurn(o.base, engine, session, o.task, "route", answer, ROUTE_ID);
      return answer.ok && live() ? (parseRoute(answer.text, choices.map((c) => c.id)) ?? "") : "";
    } finally {
      this.routing.delete(controller);
      await session?.close().catch(() => undefined);
    }
  }

  private abortRouting(): void {
    for (const c of this.routing) c.abort();
  }

  /** Sidekick's usage lines in `base` (cached; a failed or empty read is not kept, since the log loader answers [] on errors). */
  private usage(base: string): Promise<UsageRecord[]> {
    let lines = this.lines.get(base);
    if (!lines) {
      lines = this.d.usage(base).then((rs) => rs.filter((r) => r.phase === "sidekick"));
      this.lines.set(base, lines);
      const drop = () => {
        if (this.lines.get(base) === lines) this.lines.delete(base);
      };
      lines.then((rs) => rs.length === 0 && drop(), drop);
    }
    return lines.catch(() => []);
  }

  private async closeSessions(which: (s: Held) => boolean): Promise<void> {
    const gone = [...this.sessions].filter(([, s]) => which(s));
    for (const [key, s] of gone) {
      this.sessions.delete(key);
      this.pending.delete(s.task);
    }
    await Promise.all(gone.map(([, s]) => s.session.close().catch(() => undefined)));
  }

  private async push(): Promise<void> {
    if (this.closed) return;
    this.d.changed(await this.state());
  }
}
