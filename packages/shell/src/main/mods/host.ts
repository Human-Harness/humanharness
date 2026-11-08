import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Disposer, MainCtx, ModDefinition, SendInfo, SendVerdict, TaskRef, TurnEndInfo } from "@humanharness/mod-sdk";
import type { ModRow, ModsConfig } from "@humanharness/protocol";
import { isModOn } from "./config";
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
  config: { load(): Promise<ModsConfig | undefined>; saveFailed(id: string, reason: string): Promise<void> };
  services: (id: string) => Services;
  /** A notice the window shows (a mod turned off after three strikes). */
  notice: (text: string) => void;
  /** Settings › Mods must redraw. */
  changed: () => void;
  beforeSendMs?: number;
  hookMs?: number;
}

interface Running {
  mod: ResolvedMod;
  on: boolean;
  failed?: string;
  problem?: string;
  strikes: number;
  hooks: Map<HookName, Set<Fn>>;
  ipc: Map<string, (p: unknown) => unknown>;
  disposers: Disposer[];
  service?: unknown;
}

/** Loads the mods that are on, runs their hooks guarded (try/catch, a timeout), and turns one off after three strikes. */
export class ModHost {
  private readonly mods = new Map<string, Running>();
  constructor(private readonly d: HostDeps) {}

  async start(list: ResolvedMod[]): Promise<void> {
    const c = await this.d.config.load();
    for (const mod of list) {
      const failed = c?.failed?.[mod.json.id];
      this.mods.set(mod.json.id, { mod, on: false, strikes: 0, hooks: new Map(), ipc: new Map(), disposers: [], ...(failed ? { failed } : {}) });
    }
    // Required mods first: a simple pass in list order, retried while something new started.
    const want = new Set(list.filter((m) => isModOn(m.json.id, m.origin, c)).map((m) => m.json.id));
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

  private async load(r: Running): Promise<void> {
    const id = r.mod.json.id;
    const imported = await guarded(async () => (await import(pathToFileURL(path.join(r.mod.dir, r.mod.json.main)).href)) as { default?: ModDefinition<unknown> }, this.hookMs);
    if (!imported.ok) return void (r.problem = imported.reason);
    const def = imported.value.default;
    if (!def || def.id !== id) return void (r.problem = `main does not export the mod "${id}"`);
    let config: unknown;
    if (def.schema) {
      const p = def.schema.safeParse(r.mod.config ?? {});
      if (!p.success) return void (r.problem = `config: ${p.error.issues.map((i) => i.message).join("; ")}`);
      config = p.data;
    } else config = r.mod.config;
    const ran = await guarded(() => def.main?.(this.ctx(r, config)), this.hookMs);
    if (!ran.ok) {
      this.dispose(r);
      return void (r.problem = ran.reason);
    }
    delete r.problem;
    r.strikes = 0;
    r.on = true;
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
        r.ipc.set(name, handler);
        const off = () => void r.ipc.delete(name);
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
    r.ipc.clear();
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
    const handler = r?.on ? r.ipc.get(name) : undefined;
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
      ...(r.failed ? { failed: r.failed } : {}),
      ...(r.problem ? { problem: r.problem } : {}),
      registers: { hooks: [...r.hooks].filter(([, s]) => s.size > 0).map(([n]) => n), ipc: [...r.ipc.keys()] },
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
      strikes: 0,
      hooks: new Map(),
      ipc: new Map(),
      disposers: [],
    };
    this.mods.set(id, r);
    main(this.ctx(r, undefined));
  }
}
