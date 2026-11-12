import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Disposer, MainCtx, ModDefinition, SendInfo, SendVerdict, TaskRef, TurnEndInfo } from "@humanharness/mod-sdk";
import type { ModRow } from "@humanharness/protocol";
import { type ModsSettings, isModOn } from "./config";
import { coreModOn } from "./core-mods";
import { guarded } from "./guard";
import type { ResolvedMod } from "./resolve";

/** Spec §4.2: a held send waits at most this long in total, then it sends. */
export const BEFORE_SEND_MS = 6_000;
export const HOOK_MS = 5_000;
export const STRIKES = 3;

type HookName = "beforeSend" | "turnStart" | "turnEnd" | "taskOpen" | "taskClose";
type Fn = (arg: never) => unknown;
/** The services a mod's ctx gets (services.ts builds them); the host adds on/ipc/provide/mods/config/id. */
export type Services = Partial<Omit<MainCtx<unknown>, "id" | "config" | "on" | "ipc" | "provide" | "mods">>;

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
}

/** Loads the mods that are on, runs their hooks guarded (try/catch, a timeout), and turns one off after three strikes. */
export class ModHost {
  private readonly mods = new Map<string, Running>();

  private seq = 0;
  constructor(private readonly d: HostDeps) {}

  private entry(mod: ResolvedMod, c: ModsSettings | undefined): Running {
    const failed = c?.failed?.[mod.json.id];
    const r: Running = { mod, on: false, version: 0, strikes: 0, hooks: new Map(), channels: new Map(), disposers: [], ...(failed ? { failed } : {}) };
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
      id: r.mod.json.id,
      config,
      on: { beforeSend: add("beforeSend"), turnStart: add("turnStart"), turnEnd: add("turnEnd"), taskOpen: add("taskOpen"), taskClose: add("taskClose") } as MainCtx<unknown>["on"],
      ipc: (name, handler) => {
        r.channels.set(name, handler);
        const off = () => void r.channels.delete(name);
        r.disposers.push(off);
        return off;
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

  private async each(name: Exclude<HookName, "beforeSend">, arg: unknown): Promise<void> {
    await Promise.all(
      this.listeners(name).map(async ([r, fn]) => {
        const res = await guarded(() => (fn as (a: unknown) => unknown)(arg), this.hookMs);
        await this.count(r, res.ok, res.ok ? undefined : res.reason);
      }),
    );
  }

  /** The text to send: each mod in turn may rewrite it; past the total budget the rest are skipped (spec §4.2). */
  async beforeSend(send: SendInfo): Promise<string> {
    const deadline = Date.now() + (this.d.beforeSendMs ?? BEFORE_SEND_MS);
    let text = send.text;
    for (const [r, fn] of this.listeners("beforeSend")) {
      const left = deadline - Date.now();
      if (left <= 0) break;
      const res = await guarded(() => (fn as (s: SendInfo) => SendVerdict | Promise<SendVerdict>)({ ...send, text }), left);
      await this.count(r, res.ok, res.ok ? undefined : res.reason);
      if (res.ok && res.value?.kind === "rewrite" && typeof res.value.text === "string" && res.value.text.trim() && res.value.text.length <= 20_000) text = res.value.text;
    }
    return text;
  }
  turnStart(task: TaskRef): Promise<void> {
    return this.each("turnStart", task);
  }
  turnEnd(end: TurnEndInfo): Promise<void> {
    return this.each("turnEnd", end);
  }
  taskOpen(task: TaskRef): Promise<void> {
    return this.each("taskOpen", task);
  }
  taskClose(task: TaskRef): Promise<void> {
    return this.each("taskClose", task);
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

  async stop(): Promise<void> {
    for (const r of this.mods.values()) this.dispose(r);
  }

  /** Tests only: a mod defined in memory, on. Never called by the app. */
  registerForTest(id: string, name: string, main: (ctx: MainCtx<unknown>) => void): void {
    const r: Running = {
      mod: { json: { id, name, version: "0.0.0", apiVersion: 1, requires: [], history: false, main: "main.js" }, dir: "", origin: "local", shipped: "local", config: undefined },
      on: true,
      version: 0,
      strikes: 0,
      hooks: new Map(),
      channels: new Map(),
      disposers: [],
    };
    this.mods.set(id, r);
    main(this.ctx(r, undefined));
  }
}
