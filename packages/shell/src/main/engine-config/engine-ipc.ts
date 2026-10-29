import type { EngineApproval, ScopeStore } from "@humanharness/workspace";
import { ENGINE_PREFIX, isScopeId } from "@humanharness/workspace";
import type { EngineApproveResult, EngineConfigView, EngineRunsCommandView, EngineSkillView } from "@humanharness/ui/client";
import { engineApprovalTag } from "./approval";
import type { Hooks } from "./clean";
import { agentFromMarkdown, parseFrontmatter } from "./frontmatter";
import { commandLoadsOtherCode, importsOtherCode } from "./outside-code";
import type { EngineConfig, EngineLayer } from "./read-config";

export type { EngineConfigView };

// The scope settings' "Engine config" (hatches spec §5.3, E10): what a scope's engine folder holds, as the person
// reads it, and its approval. Registered only for a harness that declares `enginePresets` (D0). The window never
// names a hash it made up: it sends back the one it was shown, main computes the folder's hash again right then and
// approves only when the two are equal, signing the approval with the app's key (`.harness/scopes.json` is in the
// folder the agent writes). A revoke bumps the scope's epoch before it clears the approval, so the old signed entry,
// pasted back, no longer verifies.

const HASH = /^[0-9a-f]{64}$/;
const CHANGED = "hh:engineConfigChanged";
const SCOPES_FILE = ".harness/scopes.json";

export interface EngineIpcDeps {
  /** The live config of a scope and its app-signed approval (`EngineHost.current`); null without engine config. */
  current(scope: string): Promise<{ config: EngineConfig; approval: EngineApproval | null } | null>;
  /** The open base's scope registry and profile id ("" without profiles); throws before setup. */
  store(): Promise<{ store: ScopeStore; profile: string }>;
  /** The app's approval key, made by the first approval (`linkedSecret(userData)(true)`). */
  secret(): Promise<Buffer | null>;
  /** The scopes' approval epochs in `<userData>` (epochs.ts): approvals sign at `sign`'s, a revoke `bump`s. */
  epochs: { sign(profile: string, scope: string): Promise<number>; bump(profile: string, scope: string): Promise<number> };
  /** Decision 14: the harness supports Codex (its `engines` list it). Read on each view: a harness update changes it. */
  codexLimit(): boolean;
  /** Decision 10: the engine the person chose ("" before one is), so the screen marks what it leaves out. */
  activeEngine(): Promise<string>;
  send(channel: string, value: unknown): void;
  now?(): Date;
}

/** What `registerEngineIpc` gives back: index.ts hands it each history commit's paths (`announcedPaths`). */
export interface EngineIpc {
  committed(paths: string[] | null): void;
}

/** The commands a hooks object runs, as the screen lists them: event (and matcher), command. */
function hookItems(hooks: Hooks | undefined, layer: string, file: string): EngineRunsCommandView[] {
  return Object.entries(hooks ?? {}).flatMap(([event, matchers]) =>
    matchers.flatMap((m) =>
      m.hooks.map((h) =>
        withOutside({ kind: "hook" as const, label: m.matcher ? `${event} · ${m.matcher}` : event, command: h.command, args: [], layer, file }, h.command),
      ),
    ),
  );
}

/** `item` marked when its command may load code the approval doesn't cover (a package runner, `python -m`). */
function withOutside(item: EngineRunsCommandView, command: string | readonly string[]): EngineRunsCommandView {
  return commandLoadsOtherCode(command) ? { ...item, loadsOtherCode: true } : item;
}

/** A layer's hooks then its servers (`layer` "" for the scope's own; `prefix` the layer's folder). */
function layerItems(l: EngineLayer, layer: string, prefix: string, codexHooks?: Hooks): EngineRunsCommandView[] {
  return [
    ...hookItems(l.settings?.hooks, layer, `${prefix}settings.json`),
    ...hookItems(codexHooks, layer, "codex.toml"),
    ...l.servers.map((s) =>
      withOutside(
        {
          kind: "server" as const,
          label: s.name,
          command: s.command,
          args: [...s.args],
          layer,
          file: `${prefix}mcp.json`,
          ...(Object.keys(s.env).length > 0 ? { env: { ...s.env } } : {}),
        },
        [s.command, ...s.args],
      ),
    ),
  ];
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The cleaned codex.toml's keys, dotted to their leaves, each with its value as JSON (`true`, `"low"`), so the screen
 * says whether network access or web search is on; its hooks are listed with the other commands.
 */
function codexKeys(codex: Record<string, unknown> | null): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  const walk = (v: Record<string, unknown>, at: string) => {
    for (const [k, child] of Object.entries(v)) {
      const key = at ? `${at}.${k}` : k;
      if (!at && k === "hooks") continue;
      if (isPlainObject(child)) walk(child, key);
      else out.push({ key, value: JSON.stringify(child) ?? String(child) });
    }
  };
  if (codex) walk(codex, "");
  return out;
}

/** Tool rules split on commas and spaces outside parentheses (`Read, Bash(npm run x)`). */
function splitRules(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === "," || /\s/.test(ch))) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** A frontmatter value as a list (`allowed-tools: Read, Grep` or `[Read, Grep]`). */
const listOf = (v: string | string[] | undefined): string[] =>
  (v === undefined ? [] : Array.isArray(v) ? v : splitRules(v)).map((x) => x.trim()).filter((x) => x !== "");

/** A skill as the screen shows it: what its frontmatter asks for while it runs, read again from its file. */
function skillView(s: { name: string; description: string }, files: ReadonlyMap<string, Buffer>): EngineSkillView {
  const dir = `skills/${s.name}/`;
  const data = files.get(`${dir}SKILL.md`);
  const others = [...files.keys()]
    .filter((k) => k.startsWith(dir) && k !== `${dir}SKILL.md`)
    .map((k) => k.slice(dir.length))
    .sort();
  let fields: Record<string, string | string[]> = {};
  try {
    if (data) fields = parseFrontmatter(data.toString("utf8")).fields;
  } catch {
    // Refused: listed with the refusals.
  }
  const own = (k: string) => (Object.hasOwn(fields, k) ? fields[k] : undefined);
  const model = own("model");
  return {
    name: s.name,
    description: s.description,
    allowedTools: listOf(own("allowed-tools")),
    files: others,
    ...(typeof model === "string" && model !== "" ? { model } : {}),
    ...(own("context") === "fork" ? { fork: true as const } : {}),
  };
}

/** The view of `config` (plain data: it crosses the bridge by copy). Commands come first: the screen leads with them. */
export function engineConfigView(scope: string, config: EngineConfig, approval: EngineApproval | null, codexLimit: boolean): EngineConfigView {
  const actions = Object.keys(config.actions).sort();
  const runsCommands = [
    ...layerItems(config, "", "", isPlainObject(config.codex?.hooks) ? (config.codex.hooks as Hooks) : undefined),
    ...actions.flatMap((id) => layerItems(config.actions[id]!, id, `actions/${id}/`)),
  ];
  const instructions = [
    { layer: "", text: config.instructions },
    ...actions.map((id) => ({ layer: id, text: config.actions[id]!.instructions })),
  ].filter((i) => i.text.trim() !== "");
  // An agent's dropped keys (`permissionMode`) show with the agent: its file read again for them (the parse is pure).
  const agentIgnored = new Map<string, string[]>();
  for (const [rel, data] of config.files) {
    const parts = rel.split("/");
    if (parts[0] !== "agents" || parts.length !== 2 || !rel.endsWith(".md")) continue;
    try {
      const a = agentFromMarkdown(parts[1]!, data.toString("utf8"));
      if (!agentIgnored.has(a.name)) agentIgnored.set(a.name, a.ignored);
    } catch {
      // Refused: listed with the refusals.
    }
  }
  const approved = approval !== null && approval.hash === config.hash;
  return {
    scope,
    base: config.base,
    codexLimit,
    runsCommands,
    instructions,
    skills: config.skills.map((s) => skillView(s, config.files)),
    agents: Object.entries(config.agents).map(([name, a]) => ({
      name,
      description: a.description,
      ignored: agentIgnored.get(name) ?? [],
      // What it may use and where it keeps memory (spec §5.3: an agent shows like the settings it carries).
      ...(a.tools !== undefined ? { tools: listOf(a.tools) } : {}),
      ...(a.disallowedTools !== undefined ? { disallowedTools: listOf(a.disallowedTools) } : {}),
      ...(a.model ? { model: a.model } : {}),
      ...(a.skills !== undefined ? { skills: listOf(a.skills) } : {}),
      ...(a.memory ? { memory: a.memory } : {}),
    })),
    codexKeys: codexKeys(config.codex),
    ignored: [...config.ignored.filter((i) => !i.startsWith("agents/")), ...actions.flatMap((id) => config.actions[id]!.ignored)],
    permissions: [{ layer: "", l: config as EngineLayer }, ...actions.map((id) => ({ layer: id, l: config.actions[id]! }))].flatMap(({ layer, l }) => {
      const p = l.settings?.permissions;
      const rules = { allow: [...(p?.allow ?? [])], deny: [...(p?.deny ?? [])], ask: [...(p?.ask ?? [])] };
      return rules.allow.length + rules.deny.length + rules.ask.length > 0 ? [{ layer, ...rules }] : [];
    }),
    scripts: [...config.scripts],
    loadsOtherCode: config.scripts.filter((p) => {
      const data = config.scriptFiles.get(p);
      return data !== undefined && importsOtherCode(data.toString("utf8"));
    }),
    refusals: config.refusals.map((r) => ({ file: r.file, message: r.message })),
    hash: config.hash,
    approved,
    ...(approved ? { approvedAt: approval.at } : {}),
    ...(approval !== null && !approved ? { changed: true as const } : {}),
  };
}

/**
 * The Engine config channels (hatches spec §5.3), registered only for a harness that declares `enginePresets` (D0).
 * Every id from the window is checked here (E10): a registered, active scope; a hash of 64 lowercase hex characters.
 */
export function registerEngineIpc(handle: (channel: string, fn: (...args: never[]) => unknown) => void, d: EngineIpcDeps): EngineIpc {
  // One approval or revoke at a time: each reads the folder and writes scopes.json.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn);
    chain = run.catch(() => undefined);
    return run;
  };
  /** The registry and the scope `id`: registered and not archived (an id compared, never used as a key). */
  const scopeOf = async (id: unknown): Promise<{ store: ScopeStore; profile: string; id: string }> => {
    if (!isScopeId(id)) throw new Error("Unknown scope");
    const { store, profile } = await d.store();
    if (!(await store.list()).some((s) => s.id === id && !s.archived)) throw new Error("Unknown scope");
    return { store, profile, id };
  };
  const viewOf = async (id: string): Promise<EngineConfigView | null> => {
    const now = await d.current(id);
    if (!now) return null;
    const engine = await d.activeEngine();
    return { ...engineConfigView(id, now.config, now.approval, d.codexLimit()), ...(engine ? { engine } : {}) };
  };

  handle("hh:engineConfig", async (scope: unknown): Promise<EngineConfigView | null> => viewOf((await scopeOf(scope)).id));

  // Approves only the hash computed now (E10): a folder changed since the screen showed it answers "changed".
  handle("hh:engineApprove", async (scope: unknown, hash: unknown): Promise<EngineApproveResult> => {
    if (typeof hash !== "string" || !HASH.test(hash)) throw new Error("Invalid engine config hash");
    return serial(async () => {
      const { store, profile, id } = await scopeOf(scope);
      const now = await d.current(id);
      if (!now || now.config.hash !== hash) return { ok: false, reason: "changed" };
      if (now.config.refusals.length > 0) return { ok: false, reason: "refused" };
      const secret = await d.secret();
      if (!secret) throw new Error("Could not read the app's key");
      const epoch = await d.epochs.sign(profile, id);
      await store.approveEngine(id, hash, (a) => engineApprovalTag(profile, id, a, secret, epoch), d.now?.());
      d.send(CHANGED, id);
      const view = await viewOf(id);
      return view ? { ok: true, view } : { ok: false, reason: "changed" };
    });
  });

  // Revokes the scope's approval (spec §5.3): new tasks start without its config, and running ones drop it from their
  // next turn. The epoch goes first, so even a failed clear leaves the old approval void.
  handle("hh:engineRevoke", async (scope: unknown): Promise<EngineConfigView | null> =>
    serial(async () => {
      const { store, profile, id } = await scopeOf(scope);
      await d.epochs.bump(profile, id);
      if ((await store.list()).some((s) => s.id === id && s.engineApproval !== undefined)) await store.clearEngineApproval(id);
      d.send(CHANGED, id);
      return viewOf(id);
    }),
  );

  return {
    // A commit (a history save, or an outside change the history took) that touched a scope's engine folder: that
    // scope's section reads it again. Too many paths to list, or the approvals file: any scope (null).
    committed(paths) {
      if (paths === null || paths.includes(SCOPES_FILE)) {
        d.send(CHANGED, null);
        return;
      }
      const scopes = new Set<string>();
      for (const p of paths) {
        if (!p.startsWith(ENGINE_PREFIX)) continue;
        const id = p.slice(ENGINE_PREFIX.length).split("/")[0];
        if (isScopeId(id)) scopes.add(id);
      }
      for (const id of scopes) d.send(CHANGED, id);
    },
  };
}
