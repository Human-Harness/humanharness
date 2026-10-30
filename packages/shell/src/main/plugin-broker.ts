import type { PluginManifest } from "@humanharness/harness-sdk";
import type { PluginSeverity } from "@humanharness/harness-sdk/plugin-backend";
import type { runFile } from "./plugin-exec";
import { BROKER_LIMITS, fail, isPlainObject, onlyKeys, record, str, visible } from "./broker/broker-checks";
import { Broker, type BrokerAnswer, type BrokerDataOp, type BrokerHandler } from "./broker/broker";
export { BROKER_LIMITS } from "./broker/broker-checks";
export type { BrokerAnswer, BrokerDataOp } from "./broker/broker";

/**
 * The plugin broker (plugins spec §4.2; threat model B4, B6, B7, B9, B11): every `ctx` call of one plugin's backend
 * lands here, from code assumed hostile. One broker per plugin (and base), so its identity is never taken from the
 * call. A call needs a live run; its name must be one of BROKER_CALLS (nothing reaches the engine or the task manager:
 * B9); every argument's shape is checked here before any dependency sees it, and only what the approved manifest
 * declares goes through. A refusal is an answer, never a throw: the host script turns it into a "PluginRefused" error.
 */

export const BROKER_CALLS: ReadonlySet<string> = new Set([
  "fetch",
  "exec",
  "data.get",
  "data.query",
  "data.put",
  "data.patch",
  "data.delete",
  "data.replaceAll",
  "settings.get",
  "attention.raise",
  "attention.resolve",
  "chip.set",
  "chip.clear",
  "log",
]);

/** What a plugin may raise in the Attention inbox, checked and cleaned (Decision 12). */
export interface PluginAttentionInput {
  key: string;
  severity: PluginSeverity;
  title: string;
  body?: string;
  target?: { panel: string; focus?: string } | { action: string; vars?: Record<string, unknown> };
}

export interface BrokerDeps {
  /** The approved manifest: the broker enforces nothing wider than it (B8 is the controller's). */
  manifest: PluginManifest;
  /** This plugin's own data in the current base (one PluginData per plugin and base). */
  data: { run(op: BrokerDataOp): Promise<unknown> };
  /** The stored values of `ids`, which are always declared ones. */
  secrets(ids: string[]): Promise<Record<string, string>>;
  settings(): Promise<Record<string, unknown>>;
  attention: { raise(item: PluginAttentionInput): Promise<void>; resolve(key: string): Promise<void> };
  chips(id: string, chip: { text: string; severity: PluginSeverity } | null): void;
  /**
   * The plugin's error log; may reject (a refused write), which the broker swallows. `message` is one line but uncut
   * (bounded by the call's `chars`): the receiver hides the keys, then cuts to `BROKER_LIMITS.logChars` — cutting
   * first could keep the start of a key, which then no longer reads as one (B6).
   */
  log(level: "info" | "warn" | "error", message: string): Promise<void>;
  fetch: typeof fetch;
  /** An extra check of each fetch hop's host name (e.g. public addresses only). */
  allowHost?: (hostname: string) => Promise<boolean>;
  exec: { resolve(cmd: string): Promise<string | null>; run: typeof runFile; cwd(): Promise<string>; env(): Promise<Record<string, string>> };
  /**
   * Fixture mode (P10): the fetch and command runner of a run's source, in place of `fetch` and `exec.run`. Every check
   * above still applies first: hosts, https, exec patterns, key references and redaction.
   */
  transport?(source: string): { fetch: typeof fetch; run: typeof runFile };
}

const SEVERITIES: readonly PluginSeverity[] = ["info", "warn", "action"];
const ATTENTION_KEY = /^[A-Za-z0-9:._-]{1,80}$/;
const ENDED = "This sync run has ended";

export class PluginBroker {
  /** The core engine (runs, budget, fetch, exec, data, log), granted exactly what the manifest declares. */
  private readonly core: Broker;

  constructor(private readonly d: BrokerDeps) {
    const m = d.manifest;
    const extra = new Map<string, { max: number; fn: BrokerHandler }>([
      ["settings.get", { max: 0, fn: async () => ({ ok: true, value: await d.settings() }) }],
      ["attention.raise", { max: 1, fn: async (_run, [item]) => ok(await d.attention.raise(this.attentionItem(item))) }],
      ["attention.resolve", { max: 1, fn: async (_run, [key]) => ok(await d.attention.resolve(attentionKey(key))) }],
      ["chip.set", { max: 2, fn: async (_run, [id, chip]) => ok(d.chips(this.chipId(id), chipValue(chip))) }],
      ["chip.clear", { max: 1, fn: async (_run, [id]) => ok(d.chips(this.chipId(id), null)) }],
    ]);
    this.core = new Broker({
      grant: {
        hosts: m.permissions.hosts,
        secrets: m.permissions.secrets.map((s) => s.id),
        exec: m.permissions.exec,
        // A plugin reads and writes only its own collections (B4): any declared one, either way.
        collection: (name) => Object.hasOwn(m.data, name),
        refusals: {
          collection: "The collection is not declared in plugin.json data",
          secret: (id) => `The key "${id}" is not declared in permissions.secrets`,
          exec: (line) => `${line} is not declared in permissions.exec`,
        },
      },
      calls: [...BROKER_CALLS],
      extra,
      data: d.data,
      secrets: d.secrets,
      log: d.log,
      fetch: d.fetch,
      ...(d.allowHost ? { allowHost: d.allowHost } : {}),
      exec: d.exec,
      ...(d.transport ? { transport: d.transport } : {}),
      ended: ENDED,
    });
  }

  /** A run of a declared source: its id is what every `ctx` call must carry. */
  startRun(source: string): { id: string; signal: AbortSignal } {
    if (!this.d.manifest.sources.some((s) => s.id === source)) throw new Error(`The source ${String(source)} is not declared`);
    return this.core.startRun(source);
  }

  /** Ends a run: its id dies, its in-flight fetches and commands abort. */
  endRun(id: string): { writes: number } {
    return this.core.endRun(id);
  }

  killAll(): void {
    this.core.killAll();
  }

  call(runId: unknown, name: unknown, args: unknown): Promise<BrokerAnswer> {
    return this.core.call(runId, name, args);
  }

  private attentionItem(v: unknown): PluginAttentionInput {
    if (!isPlainObject(v)) fail("An attention item is an object");
    const item = v as Record<string, unknown>;
    onlyKeys(item, ["key", "severity", "title", "body", "target"], "An attention item");
    const out: PluginAttentionInput = {
      key: attentionKey(item.key),
      severity: severity(item.severity),
      title: visible(item.title, "A title", BROKER_LIMITS.titleChars),
    };
    if (item.body !== undefined) {
      const body = visible(item.body, "A body", BROKER_LIMITS.bodyChars, { newlines: true, optional: true });
      if (body !== "") out.body = body;
    }
    if (item.target !== undefined) out.target = this.target(item.target);
    return out;
  }

  private target(v: unknown): NonNullable<PluginAttentionInput["target"]> {
    if (!isPlainObject(v)) fail("A target is an object");
    const t = v as Record<string, unknown>;
    if (t.panel !== undefined) {
      onlyKeys(t, ["panel", "focus"], "A target");
      if (typeof t.panel !== "string" || !this.d.manifest.panels.some((p) => p.id === t.panel)) fail("The panel is not declared in plugin.json panels");
      const focus = t.focus === undefined ? undefined : str(t.focus, "A focus", BROKER_LIMITS.focusChars);
      return focus === undefined ? { panel: t.panel as string } : { panel: t.panel as string, focus };
    }
    onlyKeys(t, ["action", "vars"], "A target");
    if (typeof t.action !== "string" || !this.d.manifest.actions.some((a) => a.id === t.action)) fail("The action is not declared in plugin.json actions");
    if (t.vars === undefined) return { action: t.action as string };
    const vars = record(t.vars, "An action's vars");
    if (Buffer.byteLength(JSON.stringify(vars), "utf8") > BROKER_LIMITS.varsBytes) fail("An action's vars are at most 4 KB");
    return { action: t.action as string, vars };
  }

  private chipId(v: unknown): string {
    if (typeof v !== "string" || !this.d.manifest.chips.some((c) => c.id === v)) fail("The chip is not declared in plugin.json chips");
    return v as string;
  }
}

const ok = (_: unknown): BrokerAnswer => ({ ok: true, value: null });

function attentionKey(v: unknown): string {
  if (typeof v !== "string" || !ATTENTION_KEY.test(v)) fail("An attention key is 1–80 letters, digits or : . _ -");
  return v as string;
}

function severity(v: unknown): PluginSeverity {
  if (typeof v !== "string" || !(SEVERITIES as readonly string[]).includes(v)) fail("A severity is info, warn or action");
  return v as PluginSeverity;
}

function chipValue(v: unknown): { text: string; severity: PluginSeverity } {
  if (!isPlainObject(v)) fail("A chip is an object");
  const c = v as Record<string, unknown>;
  onlyKeys(c, ["text", "severity"], "A chip");
  return { text: visible(c.text, "A chip's text", BROKER_LIMITS.chipChars), severity: c.severity === undefined ? "info" : severity(c.severity) };
}
