import path from "node:path";
import { pathToFileURL } from "node:url";
import type { AgentInfo, AgentTool, DailyInfo, Disposer, HoldVerdict, MainCtx, ModDefinition, PhaseMovedInfo, SendInfo, SendVerdict, TaskRef, TurnEndInfo } from "@humanharness/mod-sdk";
import type { CoreApp, CoreMainCtx, CoreSender, FirstMessageSection } from "@humanharness/mod-sdk/core";
import type { ModRow } from "@humanharness/protocol";
import type { PushChannel } from "@humanharness/protocol/channels";
import { isLines, modOff, modReloaded, readAgentTools } from "./agent-answers";
import { type ModsSettings, isModOn } from "./config";
import { coreModOn } from "./core-mods";
import { guarded } from "./guard";
import { MOD_APP_CHANNELS } from "./app-channels";
import { isPushChannel } from "./push-channels";
import type { ResolvedMod } from "./resolve";

/** Spec §4.2: the beforeSend handlers run at most this long in total, then it sends; a hold's wait doesn't count. */
export const BEFORE_SEND_MS = 6_000;
export const HOOK_MS = 5_000;
export const STRIKES = 3;

type HookName = "beforeSend" | "turnStart" | "turnEnd" | "taskOpen" | "taskClose" | "betweenTasks" | "phaseMoved" | "daily" | "close" | "instructions" | "agentTools" | "refresh" | "firstMessage" | "contextChanged" | "dataChanged" | "restored" | "baseGone" | "historyCommit" | "windowClosed" | "folderChanged";
const HOOKS: readonly HookName[] = ["beforeSend", "turnStart", "turnEnd", "taskOpen", "taskClose", "betweenTasks", "phaseMoved", "daily", "close", "instructions", "agentTools"];
/** A local calendar day, YYYY-MM-DD. */
export const localDay = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** Milliseconds from `now` to the next local midnight. */
export const msToNextDay = (now: Date): number => new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime();
type Fn = (arg: never) => unknown;
/** The services a mod's ctx gets (services.ts builds them); the host adds on/ipc/provide/mods/config/id. */
export type Services = Partial<Omit<MainCtx<unknown>, "id" | "config" | "on" | "ipc" | "push" | "provide" | "mods" | "holds" | "focus">>;

export interface HostDeps {
  config: { load(): Promise<ModsSettings | undefined>; saveFailed(id: string, reason: string): Promise<void> };
  services: (id: string) => Services;
  /** A notice the window shows (a mod turned off after three strikes). */
  notice: (text: string) => void;
  /** Settings › Mods must redraw. */
  changed: () => void;
  beforeSendMs?: number;
  hookMs?: number;
  /** Whether a core mod is on by default; `CORE_MODS` when absent. */
  coreOn?: (id: string) => boolean;
  /** Builds a user-layer mod's sources and keeps its last good build (user-layer.ts); without it a user mod can't load. */
  builds?: UserBuilds;
  /** A user-layer mod was reloaded after an edit; `version` counts its reloads. */
  reloaded?: (id: string, version: number) => void;
  /** Some mod's focus on a task changed (`focused`). */
  focusChanged?: (taskId: string) => void;
  /** A core mod's send to the window (`ctx.push`), on an app push channel only. Absent: core mods get no `push`. */
  push?: (channel: PushChannel, value: unknown) => void;
  /** Any mod's `ctx.push(name, value)` to its own ui (`hh:modPush`). Absent: a mod's own push goes nowhere. */
  modPush?: (id: string, name: string, value: unknown) => void;
  /** Core mod `id`'s `ctx.app` (core-app.ts). Absent: core mods get no `app`. Harness and local mods never get either. */
  coreApp?: (id: string) => CoreApp | undefined;
}

/** What the host needs to load a user-layer mod (`ModBuilds` in user-layer.ts). */
export interface UserBuilds {
  /** Bundles the mod's sources; `main` is the built main part's file, when it has one. */
  build(mod: ResolvedMod): Promise<{ ok: true; main?: string } | { ok: false; file: string; reason: string }>;
  /** The build ran: it becomes the last good one, and every `.error` of the mod goes away. */
  keep(mod: ResolvedMod): Promise<void>;
  /** The build failed: writes `<file>.error` and puts the last good build back; `restored` false when there is none. */
  fail(mod: ResolvedMod, file: string, reason: string): Promise<{ restored: boolean; main?: string }>;
}

interface Running {
  mod: ResolvedMod;
  on: boolean;
  failed?: string;
  problem?: string;
  /** Reloads after an edit (user-layer mods). */
  version: number;
  strikes: number;
  hooks: Map<HookName, Set<Fn>>;
  channels: Map<string, (p: unknown, sender?: CoreSender) => unknown>;
  disposers: Disposer[];
  service?: unknown;
  /** Sends this mod holds, by token: each ends once (resolved, or cancelled). */
  holds: Map<string, { task: string | null; end(v: HoldVerdict): void }>;
  /** The tasks this mod holds in focus. */
  focus: Set<string>;
}

/** Loads the mods that are on, runs their hooks guarded (try/catch, a timeout), and turns one off after three strikes. */
export class ModHost {
  private readonly mods = new Map<string, Running>();

  private seq = 0;
  constructor(private readonly d: HostDeps) {}

  private entry(mod: ResolvedMod, c: ModsSettings | undefined): Running {
    const failed = c?.failed?.[mod.json.id];
    const r: Running = { mod, on: false, version: 0, strikes: 0, hooks: new Map(), channels: new Map(), disposers: [], holds: new Map(), focus: new Set(), ...(failed ? { failed } : {}) };
    this.mods.set(mod.json.id, r);
    return r;
  }

  /** On by config, and, for a user-layer mod, reviewed (`mods.trusted`): a hand-edited `on` alone never runs one. */
  private wanted(m: ResolvedMod, c: ModsSettings | undefined): boolean {
    if (m.user && !c?.trusted?.includes(m.json.id)) return false;
    return isModOn(m.json.id, m.origin, c, m.shipped === "core" && (this.d.coreOn ?? coreModOn)(m.json.id));
  }

  async start(list: ResolvedMod[]): Promise<void> {
    const c = await this.d.config.load();
    for (const mod of list) this.entry(mod, c);
    // Required mods first: a simple pass in list order, retried while something new started.
    const want = new Set(list.filter((m) => this.wanted(m, c)).map((m) => m.json.id));
    let progress = true;
    while (progress) {
      progress = false;
      for (const id of want) {
        const r = this.mods.get(id)!;
        if (r.on || r.problem) continue;
        if (r.mod.json.requires.every((q) => this.mods.get(q)?.on)) {
          await this.load(r);
          progress = progress || r.on;
        }
      }
    }
    for (const id of want) {
      const r = this.mods.get(id)!;
      const missing = r.mod.json.requires.find((q) => !this.mods.get(q)?.on);
      if (!r.on && missing && !r.problem) r.problem = `needs the mod "${missing}"`;
    }
  }

  private started(r: Running): void {
    delete r.problem;
    r.strikes = 0;
    r.on = true;
  }

  private async load(r: Running): Promise<void> {
    if (r.mod.user) return this.loadUser(r);
    const main = r.mod.json.main;
    // No main part: nothing to import or run; the mod is on with its raw config and no hooks.
    const why = main === undefined ? undefined : await this.run(r, pathToFileURL(path.join(r.mod.dir, main)).href);
    if (why === undefined) this.started(r);
    else r.problem = why;
  }

  /** Imports a main part and runs it; the reason it couldn't, or undefined when it runs. */
  private async run(r: Running, url: string): Promise<string | undefined> {
    const id = r.mod.json.id;
    const imported = await guarded(async () => (await import(url)) as { default?: ModDefinition<unknown> }, this.hookMs);
    if (!imported.ok) return imported.reason;
    const def = imported.value.default;
    if (!def || def.id !== id) return `main does not export the mod "${id}"`;
    let config: unknown;
    if (def.schema) {
      const p = def.schema.safeParse(r.mod.config ?? {});
      if (!p.success) return `config: ${p.error.issues.map((i) => i.message).join("; ")}`;
      config = p.data;
    } else config = r.mod.config;
    const ran = await guarded(() => def.main?.(this.ctx(r, config)), this.hookMs);
    if (!ran.ok) {
      this.dispose(r);
      return ran.reason;
    }
    return undefined;
  }

  /**
   * A user-layer mod: bundle its sources, then run the build (a fresh `?v=` so an edit is imported anew). A build or a
   * run that fails writes `<file>.error` and runs the last good build instead, when there is one.
   */
  private async loadUser(r: Running): Promise<void> {
    const b = this.d.builds;
    if (!b) return void (r.problem = "this app can't build mods from the home folder");
    const fresh = (file: string) => `${pathToFileURL(file).href}?v=${++this.seq}`;
    const built = await b.build(r.mod);
    let failure: { file: string; reason: string };
    if (built.ok) {
      const why = built.main === undefined ? undefined : await this.run(r, fresh(built.main));
      if (why === undefined) {
        await b.keep(r.mod).catch((err: unknown) => console.error(`Mod ${r.mod.json.id}: could not keep its build`, err));
        return this.started(r);
      }
      failure = { file: r.mod.json.main ?? "mod.json", reason: why };
    } else failure = built;
    console.error(`Mod ${r.mod.json.id}: ${failure.file}: ${failure.reason}`);
    const back = await b.fail(r.mod, failure.file, failure.reason).catch(() => ({ restored: false, main: undefined }));
    if (back.restored && (back.main === undefined || (await this.run(r, fresh(back.main))) === undefined)) {
      this.started(r);
      r.problem = `${failure.reason} (the last good version runs; see ${failure.file}.error)`;
      return;
    }
    r.problem = failure.reason;
  }

  /**
   * `ctx.push`: a name of the mod's own goes to its ui (`hh:modPush`, with its id), while the mod is on. A core mod may
   * also name an app push channel (`hh:…`, never `hh:modPush`, which would forge another mod's id); any other mod can't.
   */
  private pusher(r: Running): (name: string, value: unknown) => void {
    const id = r.mod.json.id;
    return (name, value) => {
      if (typeof name !== "string" || !name) throw new Error("A push needs a name");
      if (name.startsWith("hh:")) {
        const send = this.d.push;
        if (r.mod.shipped !== "core" || !send) throw new Error(`Only a core mod may push on the app channel ${name}`);
        // PUSH_CHANNELS leaves hh:modPush out.
        if (!isPushChannel(name)) throw new Error(`Not an app push channel: ${name}`);
        if (r.on) send(name, value);
        return;
      }
      if (r.on) this.d.modPush?.(id, name, value);
    };
  }

  /** What only a core mod's ctx has: `app` and `onRefresh` (its `push` also takes an app push channel, `pusher`). */
  private core(r: Running, add: (name: HookName) => (fn: Fn) => Disposer): Partial<Pick<CoreMainCtx<unknown>, "app" | "onRefresh" | "handle" | "handleFrom">> & { coreOn?: Record<string, unknown> } {
    if (r.mod.shipped !== "core") return {};
    const base = this.d.coreApp?.(r.mod.json.id);
    // The context-changed listeners live in the host (a restart builds a new one): the mod's registration is a hook.
    const app = base ? { ...base, tasks: { ...base.tasks, onContextChanged: add("contextChanged") as unknown as CoreApp["tasks"]["onContextChanged"] } } : undefined;
    const answer = (name: string, run: (args: unknown[], sender: CoreSender | undefined) => unknown): Disposer => {
      if (!(MOD_APP_CHANNELS as readonly string[]).includes(name)) throw new Error(`Not an app channel a core mod answers: ${String(name)}`);
      if (this.appChannel(name)) throw new Error(`Another mod already handles ${name}`);
      r.channels.set(name, (args, sender) => run(Array.isArray(args) ? args : [], sender));
      const off = () => void r.channels.delete(name);
      r.disposers.push(off);
      return off;
    };
    const events = ["firstMessage", "dataChanged", "restored", "baseGone", "historyCommit", "windowClosed", "folderChanged"] as const;
    return {
      ...(app ? { app } : {}),
      handle: (name, fn) => answer(name, (args) => fn(...args)),
      handleFrom: (name, fn) => answer(name, (args, sender) => fn(sender!, ...args)),
      onRefresh: add("refresh") as CoreMainCtx<unknown>["onRefresh"],
      coreOn: Object.fromEntries(events.map((n) => [n, add(n)])),
    };
  }

  private ctx(r: Running, config: unknown): MainCtx<unknown> {
    const add = (name: HookName) => (fn: Fn) => {
      const set = r.hooks.get(name) ?? new Set<Fn>();
      r.hooks.set(name, set.add(fn));
      const off = () => void set.delete(fn);
      r.disposers.push(off);
      return off;
    };
    const { coreOn, ...core } = this.core(r, add);
    return {
      ...(this.d.services(r.mod.json.id) as MainCtx<unknown>),
      ...core,
      push: this.pusher(r),
      id: r.mod.json.id,
      config,
      on: { ...Object.fromEntries(HOOKS.map((n) => [n, add(n)])), ...coreOn } as unknown as MainCtx<unknown>["on"],
      ipc: (name, handler) => {
        // A mod's own name (`mods.<id>.<name>`): never an app channel's, not even a core mod's (minimal-core 1b).
        if (typeof name !== "string" || !name || name.startsWith("hh:")) throw new Error(`Not a mod's own channel: ${String(name)}`);
        r.channels.set(name, handler);
        const off = () => void r.channels.delete(name);
        r.disposers.push(off);
        return off;
      },
      holds: {
        resolve: (token, verdict) => {
          const h = r.holds.get(token);
          if (!h) return false;
          h.end(verdict);
          return true;
        },
      },
      focus: {
        set: (taskId, on) => {
          if (typeof taskId !== "string" || !taskId || on === r.focus.has(taskId)) return;
          if (on) r.focus.add(taskId);
          else r.focus.delete(taskId);
          this.d.focusChanged?.(taskId);
        },
      },
      provide: (service) => void (r.service = service),
      mods: { get: <T>(other: string) => (this.mods.get(other)?.on ? (this.mods.get(other)!.service as T) : undefined) },
    };
  }

  private dispose(r: Running): void {
    for (const off of r.disposers.splice(0).reverse()) {
      try {
        off();
      } catch (err) {
        console.error(`Mod ${r.mod.json.id}: a disposer threw`, err);
      }
    }
    r.hooks.clear();
    r.channels.clear();
    delete r.service;
    r.on = false;
    // Its held sends are cancelled, its focus dropped.
    for (const h of [...r.holds.values()]) h.end({ kind: "cancel" });
    const focused = [...r.focus];
    r.focus.clear();
    for (const t of focused) this.d.focusChanged?.(t);
  }

  private get hookMs() {
    return this.d.hookMs ?? HOOK_MS;
  }

  /** Counts a result; three failures in a row turn the mod off, persist why, and tell the person (spec §4.2). */
  private async count(r: Running, ok: boolean, reason?: string): Promise<void> {
    if (ok) return void (r.strikes = 0);
    if (!r.on) return; // already turned off by an earlier strike of the same round
    r.strikes += 1;
    console.error(`Mod ${r.mod.json.id} failed (${r.strikes}/${STRIKES}): ${reason}`);
    if (r.strikes < STRIKES) return;
    this.dispose(r);
    r.failed = reason ?? "failed";
    r.strikes = 0;
    await this.d.config.saveFailed(r.mod.json.id, r.failed).catch((err: unknown) => console.error("Could not save a mod's failure", err));
    this.d.notice(`${r.mod.json.name} was turned off after failing three times in a row. Settings › Mods can turn it back on.`);
    this.d.changed();
  }

  private listeners(name: HookName): [Running, Fn][] {
    const out: [Running, Fn][] = [];
    for (const r of this.mods.values()) if (r.on) for (const fn of r.hooks.get(name) ?? []) out.push([r, fn]);
    return out;
  }

  private each(name: Exclude<HookName, "beforeSend">, arg: unknown): Promise<void> {
    return this.eachFor(name, () => ({ arg }));
  }

  /** Like `each`, with each mod's own argument; a mod `argFor` answers null for is skipped. */
  private async eachFor(name: Exclude<HookName, "beforeSend">, argFor: (r: Running) => { arg: unknown } | null): Promise<void> {
    await Promise.all(
      this.listeners(name).map(async ([r, fn]) => {
        const a = argFor(r);
        if (!a) return;
        const res = await guarded(() => (fn as (a: unknown) => unknown)(a.arg), this.hookMs);
        await this.count(r, res.ok, res.ok ? undefined : res.reason);
      }),
    );
  }

  /**
   * The text to send, or null when a held send was cancelled: each mod in turn may rewrite or hold it. The handlers
   * run within the total budget (past it the rest are skipped, spec §4.2); a hold's wait counts toward none.
   */
  async beforeSend(send: SendInfo): Promise<string | null> {
    let left = this.d.beforeSendMs ?? BEFORE_SEND_MS;
    let text = send.text;
    for (const [r, fn] of this.listeners("beforeSend")) {
      if (left <= 0) break;
      // Turned off while an earlier mod held the send.
      if (!r.on) continue;
      const started = Date.now();
      const res = await guarded(() => (fn as (s: SendInfo) => SendVerdict | Promise<SendVerdict>)({ ...send, text }), left);
      left -= Date.now() - started;
      await this.count(r, res.ok, res.ok ? undefined : res.reason);
      if (!res.ok) continue;
      let v: SendVerdict | HoldVerdict | undefined = res.value;
      if (v?.kind === "hold") {
        if (!r.on || typeof v.token !== "string" || !v.token || r.holds.has(v.token)) continue;
        v = await this.hold(r, v.token, send.task?.id ?? null);
        if (v.kind === "cancel") return null;
      }
      if (v?.kind === "rewrite" && typeof v.text === "string" && v.text.trim() && v.text.length <= 20_000) text = v.text;
    }
    return text;
  }

  /** Waits, with no limit, for the mod to resolve `token`; closing the task, quitting or turning the mod off cancels it. */
  private hold(r: Running, token: string, task: string | null): Promise<HoldVerdict> {
    return new Promise((resolve) => {
      r.holds.set(token, {
        task,
        end: (v) => {
          if (!r.holds.delete(token)) return;
          const ok = v?.kind === "pass" || v?.kind === "cancel" || (v?.kind === "rewrite" && typeof v.text === "string");
          resolve(ok ? v : { kind: "pass" });
        },
      });
    });
  }

  /** Whether some mod that is on registered this hook: the app calls it only then (D0). */
  registered(name: HookName): boolean {
    return this.listeners(name).length > 0;
  }

  /** Whether some mod that is on holds `taskId` in focus (`ctx.focus`). */
  focused(taskId: string): boolean {
    for (const r of this.mods.values()) if (r.on && r.focus.has(taskId)) return true;
    return false;
  }

  /** The mod that is on and answers app channel `name`, if any. */
  private appChannel(name: string): Running | undefined {
    for (const r of this.mods.values()) if (r.on && r.channels.has(name)) return r;
    return undefined;
  }

  /** Whether a core mod that is on answers app channel `name`. */
  handles(name: string): boolean {
    return this.appChannel(name) !== undefined;
  }

  /**
   * A window call on app channel `name`, with its arguments, to the core mod that answers it. Unlike a mod's own
   * channel, it may take as long as it needs and a throw reaches the window as is: neither counts as a strike.
   */
  async channel(name: string, args: unknown[], sender: CoreSender): Promise<unknown> {
    const r = this.appChannel(name);
    if (!r) throw new Error(`No mod handles ${name}`);
    return r.channels.get(name)!(args, sender);
  }

  turnStart(task: TaskRef): Promise<void> {
    return this.each("turnStart", task);
  }
  /**
   * A turn's end with the app's kind of turn (absent: the person's `run`). A core mod gets every turn with its kind
   * (Sidekick's context heads-up reads checkpoints and wrap-ups too); any other mod only the person's turns, without it.
   */
  turnEnd(end: TurnEndInfo & { kind?: string }): Promise<void> {
    const { kind = "run", ...info } = end;
    return this.eachFor("turnEnd", (r) => (r.mod.shipped === "core" ? { arg: { ...info, kind } } : kind === "run" ? { arg: info } : null));
  }
  /** The base or its data changed under the core mods with no task opening or closing (a profile switch, an undo). */
  refresh(): Promise<void> {
    return this.each("refresh", undefined);
  }
  /** The base's data changed (a collection write, a plugin's data or on/off; `collection` null for a plugin): the core mods that listen hear it. */
  dataChanged(collection: string | null): Promise<void> {
    return this.each("dataChanged", { collection });
  }
  /** A history restore touched `paths` (null: the whole folder). */
  restored(paths: readonly string[] | null): Promise<void> {
    return this.each("restored", paths);
  }
  /** `base` is gone (a folder move, a forgotten profile). */
  baseGone(base: string): Promise<void> {
    return this.each("baseGone", base);
  }
  /** The history saved a commit touching `paths`. */
  historyCommit(paths: readonly string[] | null): Promise<void> {
    return this.each("historyCommit", paths);
  }
  /** The window whose contents are `senderId` closed or reloaded. */
  windowClosed(senderId: number): Promise<void> {
    return this.each("windowClosed", senderId);
  }
  /** The base folder moved, changed or switched with the profile. */
  folderChanged(): Promise<void> {
    return this.each("folderChanged", undefined);
  }
  /** Task `taskId`'s context record changed: the core mods that listen (`ctx.app.tasks.onContextChanged`) hear it. */
  contextChanged(taskId: string): Promise<void> {
    return this.each("contextChanged", taskId);
  }
  /**
   * What the core mods add to `task`'s first or resume message, joined in the order the mods run: texts, items and
   * the notes to leave out. Each text is cut to its own budget; a section with a bad shape or no budget, null or a
   * throw adds nothing (a throw is a strike). Null when no mod added anything.
   */
  async firstMessage(task: TaskRef): Promise<{ text: string; items: FirstMessageSection["items"][number][]; excluded: Set<string> } | null> {
    const texts: string[] = [];
    const items: FirstMessageSection["items"][number][] = [];
    const excluded = new Set<string>();
    for (const [r, fn] of this.listeners("firstMessage")) {
      if (!r.on) continue;
      const res = await guarded(() => (fn as (t: TaskRef) => FirstMessageSection | null | Promise<FirstMessageSection | null>)(task), this.hookMs);
      await this.count(r, res.ok, res.ok ? undefined : res.reason);
      const s = res.ok ? res.value : null;
      if (!s || typeof s.text !== "string" || !Number.isFinite(s.budgetTokens) || s.budgetTokens <= 0) continue;
      if (s.text) texts.push(s.text.length > s.budgetTokens * 4 ? s.text.slice(0, s.budgetTokens * 4) : s.text);
      if (Array.isArray(s.items)) items.push(...s.items);
      if (Array.isArray(s.excludeNotes)) for (const n of s.excludeNotes) if (typeof n === "string") excluded.add(n);
    }
    return texts.length > 0 || items.length > 0 || excluded.size > 0 ? { text: texts.join("\n\n"), items, excluded } : null;
  }
  /**
   * One section per `instructions()` hook that answers lines, in mod order, each led by a blank line as the app's own
   * are. A throw, a timeout or another shape adds nothing and is a strike.
   */
  async instructions(o: AgentInfo): Promise<string[][]> {
    const sections: string[][] = [];
    for (const [r, fn] of this.listeners("instructions")) {
      if (!r.on) continue;
      const res = await guarded(() => (fn as (o: AgentInfo) => unknown)({ ...o }), this.hookMs);
      const lines = res.ok && isLines(res.value) ? res.value : null;
      await this.count(r, lines !== null, res.ok ? "instructions() must return a list of lines" : res.reason);
      if (lines && lines.length > 0) sections.push(lines[0] === "" ? [...lines] : ["", ...lines]);
    }
    return sections;
  }
  /**
   * The mods' `agentTools()`, in mod order, none under a `taken` name or an earlier mod's. A throw or a timeout adds
   * nothing; a tool the `ui` server can't take is left out; each is a strike, and a mod it turns off adds nothing.
   */
  async agentTools(o: AgentInfo, taken: Iterable<string>): Promise<(AgentTool & { mod: string })[]> {
    const names = new Set(taken);
    const tools: (AgentTool & { mod: string })[] = [];
    for (const [r, fn] of this.listeners("agentTools")) {
      if (!r.on) continue;
      const res = await guarded(async () => readAgentTools(await (fn as (o: AgentInfo) => unknown)({ ...o }), names), this.hookMs);
      const problem = res.ok ? res.value.problem : res.reason;
      await this.count(r, problem === undefined, problem);
      if (!res.ok || !r.on) continue;
      for (const tool of res.value.tools) {
        names.add(tool.name);
        const { name, description, inputSchema, tasksOnly, timeoutError } = tool;
        const extra = { ...(tasksOnly !== undefined ? { tasksOnly } : {}), ...(timeoutError !== undefined ? { timeoutError } : {}) };
        tools.push({ mod: r.mod.json.id, name, description, inputSchema, ...extra, handle: (args) => this.toolCall(r, fn, tool, args) });
      }
    }
    return tools;
  }
  /**
   * The agent's call of a mod's tool. As `call`: a core mod's may take as long as it needs and its throw reaches the
   * agent as it is; any other's is guarded, and a throw or a timeout is a strike.
   */
  private async toolCall(r: Running, hook: Fn, tool: AgentTool, args: Record<string, unknown>): Promise<unknown> {
    // The mod went off, or was loaded again, after the agent's session was opened with this tool.
    if (!r.on) throw modOff(r.mod.json.id);
    if (!r.hooks.get("agentTools")?.has(hook)) throw modReloaded(r.mod.json.id);
    if (r.mod.shipped === "core") return tool.handle(args);
    const res = await guarded(() => tool.handle(args), this.hookMs);
    await this.count(r, res.ok, res.ok ? undefined : res.reason);
    if (!res.ok) throw new Error(res.reason);
    return res.value;
  }

  taskOpen(task: TaskRef): Promise<void> {
    return this.each("taskOpen", task);
  }
  taskClose(task: TaskRef): Promise<void> {
    // A send held for this task won't go.
    for (const r of this.mods.values()) for (const h of [...r.holds.values()]) if (h.task === task.id) h.end({ kind: "cancel" });
    return this.each("taskClose", task);
  }
  betweenTasks(): Promise<void> {
    return this.each("betweenTasks", undefined);
  }
  phaseMoved(e: PhaseMovedInfo): Promise<void> {
    return this.each("phaseMoved", e);
  }
  daily(now: Date = new Date()): Promise<void> {
    return this.each("daily", { day: localDay(now) } satisfies DailyInfo);
  }

  private dailyTimer: ReturnType<typeof setTimeout> | undefined;
  /** Runs `daily` now and at each local midnight from now on, until `stop`. */
  startDaily(now: () => Date = () => new Date()): void {
    clearTimeout(this.dailyTimer);
    void this.daily(now());
    const next = () => {
      this.dailyTimer = setTimeout(() => {
        void this.daily(now());
        next();
      }, msToNextDay(now()) + 1_000);
      this.dailyTimer.unref?.();
    };
    next();
  }

  async ipc(id: string, name: string, payload: unknown): Promise<{ ok: true; value: unknown } | { ok: false; reason: string }> {
    const r = this.mods.get(id);
    // An app channel's name (`hh:…`) is never one of a mod's own.
    const handler = r?.on && !name.startsWith("hh:") ? r.channels.get(name) : undefined;
    if (!r || !handler) return { ok: false, reason: "no such channel" };
    const res = await guarded(() => handler(payload), this.hookMs);
    await this.count(r, res.ok, res.ok ? undefined : res.reason);
    return res;
  }

  /**
   * A mod's ui calling its own main by name (`hh:modCall`): guarded and counted as a hook, rejecting with a
   * clear reason. An app channel's name (`hh:…`) is never one of a mod's own. A core mod's call (Sidekick's review
   * waits for a model turn) may take as long as it needs and a throw reaches the window as is: neither is a strike.
   */
  async call(id: string, name: string, payload: unknown): Promise<unknown> {
    const r = this.mods.get(id);
    if (!r) throw new Error(`No mod "${id}"`);
    if (!r.on) throw new Error(`Mod "${id}" is off`);
    const handler = name.startsWith("hh:") ? undefined : r.channels.get(name);
    if (!handler) throw new Error(`Mod "${id}" has no channel "${name}"`);
    if (r.mod.shipped === "core") return handler(payload);
    const res = await guarded(() => handler(payload), this.hookMs);
    await this.count(r, res.ok, res.ok ? undefined : res.reason);
    if (!res.ok) throw new Error(res.reason);
    return res.value;
  }

  /** The person's switch. Turning on clears a failure and retries a problem. */
  async set(id: string, on: boolean): Promise<void> {
    const r = this.mods.get(id);
    if (!r || r.on === on) return;
    if (on) {
      delete r.failed;
      delete r.problem;
      const missing = r.mod.json.requires.find((q) => !this.mods.get(q)?.on);
      if (missing) r.problem = `needs the mod "${missing}"`;
      else await this.load(r);
    } else {
      // Mods that require this one go off too.
      for (const other of this.mods.values()) if (other.on && other.mod.json.requires.includes(id)) await this.set(other.mod.json.id, false);
      this.dispose(r);
      delete r.problem; // only a running last-good version had one
    }
    this.d.changed();
  }

  /** Whether some mod, on or off, has this id. */
  has(id: string): boolean {
    return this.mods.has(id);
  }

  /** A mod as resolved and whether it is on (the `hh-mod` scheme serves only an on mod's ui). */
  info(id: string): { mod: ResolvedMod; on: boolean } | undefined {
    const r = this.mods.get(id);
    return r ? { mod: r.mod, on: r.on } : undefined;
  }

  /** A mod that appeared (a new folder in the user layer): listed, and on only if config.json and its review say so. */
  async add(mod: ResolvedMod): Promise<void> {
    if (this.mods.has(mod.json.id)) return;
    const c = await this.d.config.load();
    const r = this.entry(mod, c);
    if (this.wanted(mod, c) && mod.json.requires.every((q) => this.mods.get(q)?.on)) await this.load(r);
    this.d.changed();
  }

  /** A mod that went away (its folder was deleted): turned off, its hooks disposed, and dropped from the list. */
  async remove(id: string): Promise<void> {
    if (!this.mods.has(id)) return;
    await this.set(id, false);
    this.mods.delete(id);
    this.d.changed();
  }

  /**
   * After an edit: runs every disposer of the old main part, then loads the new build. A new build that fails puts
   * the last good one back (`loadUser`). `mod` is the mod as read again (its mod.json may have changed). An off mod
   * only takes the new mod.json; it builds when it is turned on.
   */
  async reload(id: string, mod?: ResolvedMod): Promise<void> {
    const r = this.mods.get(id);
    if (!r) return;
    if (mod) r.mod = mod;
    if (r.on) {
      this.dispose(r);
      delete r.problem;
      await this.load(r);
      r.version += 1;
      this.d.reloaded?.(id, r.version);
    }
    this.d.changed();
  }

  view(): ModRow[] {
    return [...this.mods.values()].map((r) => ({
      id: r.mod.json.id,
      name: r.mod.json.name,
      version: r.mod.json.version,
      origin: r.mod.shipped,
      on: r.on,
      ui: r.mod.json.ui !== undefined,
      ...(r.failed ? { failed: r.failed } : {}),
      ...(r.problem ? { problem: r.problem } : {}),
      registers: { hooks: [...r.hooks].filter(([, s]) => s.size > 0).map(([n]) => n), ipc: [...r.channels.keys()] },
    }));
  }

  /** Quitting: the mods' `close` hooks, then every disposer (held sends are cancelled). */
  async stop(): Promise<void> {
    clearTimeout(this.dailyTimer);
    await this.each("close", undefined);
    for (const r of this.mods.values()) this.dispose(r);
  }

  /** Tests only: a mod defined in memory, on. Never called by the app. */
  registerForTest(id: string, name: string, main: (ctx: MainCtx<unknown>) => void, o: { core?: boolean; origin?: ResolvedMod["shipped"] } = {}): void {
    const origin = o.origin ?? (o.core ? "core" : "local");
    const r: Running = {
      mod: { json: { id, name, version: "0.0.0", apiVersion: 1, requires: [], history: false, main: "main.js" }, dir: "", origin, shipped: origin, config: undefined },
      on: true,
      version: 0,
      strikes: 0,
      hooks: new Map(),
      channels: new Map(),
      disposers: [],
      holds: new Map(),
      focus: new Set(),
    };
    this.mods.set(id, r);
    main(this.ctx(r, undefined));
  }
}
