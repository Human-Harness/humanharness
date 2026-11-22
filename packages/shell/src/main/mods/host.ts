import path from "node:path";
import { pathToFileURL } from "node:url";
import type { DailyInfo, Disposer, HoldVerdict, MainCtx, ModDefinition, PhaseMovedInfo, SendInfo, SendVerdict, TaskRef, TurnEndInfo } from "@humanharness/mod-sdk";
import type { CoreApp, CoreMainCtx } from "@humanharness/mod-sdk/core";
import type { ModRow } from "@humanharness/protocol";
import type { PushChannel } from "@humanharness/protocol/channels";
import { type ModsSettings, isModOn } from "./config";
import { coreModOn } from "./core-mods";
import { guarded } from "./guard";
import { isPushChannel } from "./push-channels";
import type { ResolvedMod } from "./resolve";

/** Spec §4.2: the beforeSend handlers run at most this long in total, then it sends; a hold's wait doesn't count. */
export const BEFORE_SEND_MS = 6_000;
export const HOOK_MS = 5_000;
export const STRIKES = 3;

type HookName = "beforeSend" | "turnStart" | "turnEnd" | "taskOpen" | "taskClose" | "betweenTasks" | "phaseMoved" | "daily" | "close" | "refresh";
const HOOKS: readonly HookName[] = ["beforeSend", "turnStart", "turnEnd", "taskOpen", "taskClose", "betweenTasks", "phaseMoved", "daily", "close"];
/** An app channel a core mod may handle (`ctx` ipc with an `hh:…` name). */
export const APP_CHANNEL = /^hh:[A-Za-z][A-Za-z0-9]{0,63}$/;
/** A local calendar day, YYYY-MM-DD. */
export const localDay = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** Milliseconds from `now` to the next local midnight. */
export const msToNextDay = (now: Date): number => new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime();
type Fn = (arg: never) => unknown;
/** The services a mod's ctx gets (services.ts builds them); the host adds on/ipc/provide/mods/config/id. */
export type Services = Partial<Omit<MainCtx<unknown>, "id" | "config" | "on" | "ipc" | "provide" | "mods" | "holds" | "focus">>;

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
  channels: Map<string, (p: unknown) => unknown>;
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

  /** What only a core mod's ctx has: `push` (an app push channel, while the mod is on), `app` and `onRefresh`. */
  private core(r: Running, add: (name: HookName) => (fn: Fn) => Disposer): Partial<Pick<CoreMainCtx<unknown>, "push" | "app" | "onRefresh">> {
    if (r.mod.shipped !== "core") return {};
    const send = this.d.push;
    const app = this.d.coreApp?.(r.mod.json.id);
    return {
      ...(send
        ? {
            push: (channel: string, value: unknown) => {
              if (!isPushChannel(channel)) throw new Error(`Not an app push channel: ${String(channel)}`);
              if (r.on) send(channel, value);
            },
          }
        : {}),
      ...(app ? { app } : {}),
      onRefresh: add("refresh") as CoreMainCtx<unknown>["onRefresh"],
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
    return {
      ...(this.d.services(r.mod.json.id) as MainCtx<unknown>),
      ...this.core(r, add),
      id: r.mod.json.id,
      config,
      on: Object.fromEntries(HOOKS.map((n) => [n, add(n)])) as unknown as MainCtx<unknown>["on"],
      ipc: (name, handler) => {
        // An app channel (Sidekick's `hh:sidekick…`) is a core mod's only, and one mod's at a time.
        if (name.startsWith("hh:")) {
          if (r.mod.shipped !== "core") throw new Error(`Only a core mod may handle the app channel ${name}`);
          if (!APP_CHANNEL.test(name)) throw new Error(`Not an app channel: ${name}`);
          if (this.appChannel(name)) throw new Error(`Another mod already handles ${name}`);
        }
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

  /** The mod whose handler takes app channel `name`, if one is on. */
  private appChannel(name: string): Running | undefined {
    for (const r of this.mods.values()) if (r.on && r.channels.has(name)) return r;
    return undefined;
  }

  /**
   * A window call on app channel `name`, with its arguments, to the core mod that handles it. Unlike a mod's own
   * channel, it may take as long as it needs and a throw reaches the window as is: neither counts as a strike.
   */
  async channel(name: string, args: unknown[]): Promise<unknown> {
    const r = this.appChannel(name);
    if (!r) throw new Error(`No mod handles ${name}`);
    return r.channels.get(name)!(args);
  }

  /** The app channels the mods that are on handle. */
  appChannels(): string[] {
    return [...this.mods.values()].filter((r) => r.on).flatMap((r) => [...r.channels.keys()].filter((n) => n.startsWith("hh:")));
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
    const handler = r?.on ? r.channels.get(name) : undefined;
    if (!r || !handler) return { ok: false, reason: "no such channel" };
    const res = await guarded(() => handler(payload), this.hookMs);
    await this.count(r, res.ok, res.ok ? undefined : res.reason);
    return res;
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
