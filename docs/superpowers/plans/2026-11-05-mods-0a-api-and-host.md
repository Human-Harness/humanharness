# Mods 0a: the mod API and its host — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A harness, or the person, can turn on a mod. The core loads it in main, runs its hooks safely, and lists it in Settings › Mods. No feature moves yet.

**Architecture:** The new package `@humanharness/mod-sdk` holds `defineMod`, the `mod.json` schema and the types of `MainCtx`. The shell gets `src/main/mods/`, which has three parts:
- a resolver that finds mods from core, harness and local folders;
- a `ModHost` that loads each mod's `main`, keeps its registrations with their disposers, and runs hooks with try/catch, a timeout and three strikes;
- the IPC for Settings › Mods.

The host plugs into hooks that already exist: `hh:send`, and `turnStarting`, `turnEnded` and `taskClosed` in `TaskDeps`. It adds one new hook, `taskOpened`. With no mod declared and none added locally, the host is never built (D0).

**Tech stack:** TypeScript, zod 4, vitest, Electron main, React 19 with the guide's Radix pieces, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-11-05-minimal-core-and-mods-design.md`. This plan implements §7 step 0a with §4.1, §4.2 and §4.3 (only what step 1 needs), and the parts of §6 and §5.6 that concern three strikes and the local warning.

---

## Scope

**In 0a:**
- `mod-sdk`: `defineMod`, `mod.json`, and the `MainCtx` and `UiCtx` types.
- The manifest key `mods`, and the `config.json` key `mods`.
- The hooks `beforeSend`, `turnStart`, `turnEnd`, `taskOpen`, `taskClose` and `ipc`.
- The services `engine.run`, `tasks.running`, `notes.titles`, `storage`, `dataDir`, `notify`, `provide`/`mods.get` and `log`.
- The three-strikes rule.
- Settings › Mods: the list, the switch, Add from folder with the local warning, and Remove.
- `docs/architecture/mods.md`.

**Not in 0a (where each one goes):**
- Loading `ui.tsx` and rendering blocks, the layout, the home folder (except `storage`), esbuild, live reload, `AGENTS.md`/`hh.d.ts`, check/shot/status, the escape hatch, the home history → **0b**.
- Packaging harness mods into a built app → **0b**. In 0a a harness mod is read from `<harness root>/mods/<id>/` with a prebuilt `main.js`, which works in `dev` and in e2e builds.
- `instructions`, `firstMessage`, `mcpServers`, `agentTools`, `engineOptions`, `partition` → the steps that first use them (4, 6, 7, 10).
- The `history` service → step 2. `secrets` → step 6. `data` collections → step 1 decides whether Sidekick keeps its collection or moves to `storage`.
- `packages/mods/*` in the pnpm workspace, vitest and tsconfig globs → step 1 (the first core mod).
- **Open for step 1:** Sidekick listens to `phaseMoved`, and phases stay core until step 8. Plan 1 either adds a temporary `phaseMove` hook or keeps that moment in core. 0a doesn't decide.

**Decision taken here (spec §4.1 left it to the plan):** `mod-sdk` is a new package, not part of `harness-sdk`. Mods import only `@humanharness/mod-sdk`. A mod that imports `@humanharness/shell` or `harness-sdk` internals fails `check` in 0b.

## File map

| File | Role |
|---|---|
| `packages/mod-sdk/package.json` | New package |
| `packages/mod-sdk/src/index.ts` | Re-exports |
| `packages/mod-sdk/src/mod-json.ts` | `modJsonSchema`, `MOD_ID`, `MOD_API_VERSION` |
| `packages/mod-sdk/src/types.ts` | `ModDefinition`, `MainCtx`, `UiCtx`, hook payloads |
| `packages/mod-sdk/src/define.ts` | `defineMod` |
| `packages/mod-sdk/test/mod-json.test.ts`, `define.test.ts` | Tests |
| `packages/harness-sdk/src/index.ts` | Manifest key `mods` |
| `packages/protocol/src/views.ts` | `AppConfig.mods`, `ModsView`, `ModRow`, `ModReview` |
| `packages/protocol/src/channels.ts`, `client.ts` | `hh:mods*` channels, `client.mods` |
| `packages/shell/src/main/mods/guard.ts` | `guarded()`: try/catch + timeout |
| `packages/shell/src/main/mods/resolve.ts` | Finds and reads mods (core registry, harness folder, local folders) |
| `packages/shell/src/main/mods/core-mods.ts` | The core mod registry (empty in 0a) |
| `packages/shell/src/main/mods/host.ts` | `ModHost` |
| `packages/shell/src/main/mods/services.ts` | Builds `MainCtx` services from shell deps |
| `packages/shell/src/main/mods/mods-ipc.ts` | Settings › Mods IPC |
| `packages/shell/src/main/mods/config.ts` | `cleanModsConfig`, `isModOn` |
| `packages/shell/src/main/task-manager.ts` | New `taskOpened` dep, one call in `begin` |
| `packages/shell/src/main/index.ts` | Builds the host, wires the hooks, registers the IPC |
| `packages/shell/test/mods/*.test.ts` | Host, guard, resolver, config, IPC tests |
| `packages/shell/test/fixtures/mods/{echo,broken,slow}/` | Test mods |
| `packages/ui/src/mods/ModsTab.tsx` | Settings › Mods |
| `packages/ui/src/settings-tabs.ts`, `SettingsPage.tsx` | The `mods` tab |
| `packages/i18n/src/locales/en.json` | `mods.*` strings |
| `packages/ui/test/mods-tab.test.tsx` | UI test |
| `packages/fake-agent/fixtures/mods-harness/` | e2e harness with one harness mod |
| `packages/e2e/tests/settings-mods-radix.spec.ts` | e2e plus light/dark screenshots |
| `docs/architecture/mods.md` | Docs |

Run every command from the worktree root. Unit tests: `corepack pnpm vitest run <path>`. Typecheck: `corepack pnpm typecheck`.

---

### Task 1: The `mod-sdk` package and `mod.json`

**Files:**
- Create: `packages/mod-sdk/package.json`, `packages/mod-sdk/src/mod-json.ts`, `packages/mod-sdk/src/index.ts`
- Test: `packages/mod-sdk/test/mod-json.test.ts`

- [ ] **Step 1: Create the package.**

```json
{
  "name": "@humanharness/mod-sdk",
  "version": "0.1.0",
  "type": "module",
  "license": "Apache-2.0",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "zod": "^4.6.5" }
}
```

Run `corepack pnpm install` so the workspace links it.

- [ ] **Step 2: Write the failing test.**

```ts
// packages/mod-sdk/test/mod-json.test.ts
import { describe, expect, it } from "vitest";
import { MOD_API_VERSION, modJsonSchema } from "../src/mod-json";

const ok = { id: "echo", name: "Echo", version: "0.1.0", apiVersion: MOD_API_VERSION };

describe("mod.json", () => {
  it("accepts the minimal file and defaults the rest", () => {
    expect(modJsonSchema.parse(ok)).toEqual({ ...ok, requires: [], history: false, main: "main.js" });
  });
  it("refuses a bad id, an unknown API version and unknown keys", () => {
    expect(modJsonSchema.safeParse({ ...ok, id: "Echo!" }).success).toBe(false);
    expect(modJsonSchema.safeParse({ ...ok, apiVersion: 99 }).success).toBe(false);
    expect(modJsonSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });
  it("refuses a main outside the mod's folder", () => {
    expect(modJsonSchema.safeParse({ ...ok, main: "../x.js" }).success).toBe(false);
    expect(modJsonSchema.safeParse({ ...ok, main: "/abs/x.js" }).success).toBe(false);
  });
  it("refuses requiring itself", () => {
    expect(modJsonSchema.safeParse({ ...ok, requires: ["echo"] }).success).toBe(false);
  });
});
```

- [ ] **Step 3: Run it and check it fails.** Run `corepack pnpm vitest run packages/mod-sdk/test/mod-json.test.ts`. Expected: FAIL, because `../src/mod-json` doesn't exist yet.

- [ ] **Step 4: Implement.**

```ts
// packages/mod-sdk/src/mod-json.ts
import { z } from "zod";

/** A mod's id: what the manifest's `mods` keys, config.json and `.harness/mods/<id>/` use. */
export const MOD_ID = /^[a-z][a-z0-9-]{0,39}$/;
/** The mod API this core speaks (spec §4.1 `apiVersion`). A mod for another version is refused. */
export const MOD_API_VERSION = 1;
/** A relative path inside the mod's folder: no `..` segment, not absolute. */
const inside = z.string().min(1).max(200).refine((p) => !p.startsWith("/") && !p.split(/[\\/]/).includes(".."), "main must be inside the mod's folder");

/** `mod.json`: the only part of a mod read without running its code (spec §4.1). */
export const modJsonSchema = z
  .strictObject({
    id: z.string().regex(MOD_ID, "A mod id is lowercase letters, digits and -, at most 40"),
    name: z.string().min(1).max(60),
    version: z.string().regex(/^\d+\.\d+\.\d+$/, "version is x.y.z"),
    apiVersion: z.literal(MOD_API_VERSION),
    requires: z.array(z.string().regex(MOD_ID)).max(10).default([]),
    /** The mod's `.harness/mods/<id>/` folder is in the work folder's history. Absent: excluded. */
    history: z.boolean().default(false),
    /** The built main part, relative to the folder. 0b adds bundling `main.ts`. */
    main: inside.default("main.js"),
  })
  .refine((m) => !m.requires.includes(m.id), { message: "A mod can't require itself", path: ["requires"] });

export type ModJson = z.output<typeof modJsonSchema>;
```

```ts
// packages/mod-sdk/src/index.ts
export * from "./mod-json";
```

- [ ] **Step 5: Run it and check it passes.** Same command. Expected: PASS (4 tests).

- [ ] **Step 6: Commit.** `git add packages/mod-sdk pnpm-lock.yaml && git commit -m "feat(mods): mod-sdk package with mod.json schema"`

### Task 2: `defineMod` and the API types

**Files:**
- Create: `packages/mod-sdk/src/types.ts`, `packages/mod-sdk/src/define.ts`
- Modify: `packages/mod-sdk/src/index.ts`
- Test: `packages/mod-sdk/test/define.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// packages/mod-sdk/test/define.test.ts
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { defineMod, type MainCtx, type SendVerdict } from "../src";

describe("defineMod", () => {
  it("returns the definition unchanged and types ctx.config from the schema", () => {
    const def = defineMod({
      id: "echo",
      schema: z.object({ word: z.string().default("pong") }),
      main(ctx) {
        expectTypeOf(ctx.config.word).toEqualTypeOf<string>();
        ctx.on.beforeSend(async (send): Promise<SendVerdict> => (send.text === "ping" ? { kind: "rewrite", text: ctx.config.word } : { kind: "pass" }));
      },
    });
    expect(def.id).toBe("echo");
    expectTypeOf(def.main).parameter(0).toEqualTypeOf<MainCtx<{ word: string }>>();
  });
  it("allows a mod with no schema (config is undefined)", () => {
    const def = defineMod({ id: "bare", main(ctx) { expectTypeOf(ctx.config).toEqualTypeOf<undefined>(); } });
    expect(def.schema).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and check it fails.** Run `corepack pnpm vitest run packages/mod-sdk/test/define.test.ts`. Expected: FAIL, because `defineMod` is not exported.

- [ ] **Step 3: Implement the types.**

```ts
// packages/mod-sdk/src/types.ts
import type { ZodType } from "zod";

/** Every registration returns one; the host runs it before reloading or turning the mod off (spec §4.2). */
export type Disposer = () => void;
export type Tier = "light" | "standard" | "deep";

export interface TaskRef {
  id: string;
  action?: string;
  scope: string;
  phase?: string;
}
/** A send about to happen: a new task (`action` set) or a follow-up/question in the open one. */
export interface SendInfo {
  text: string;
  action?: string;
  scope?: string;
  /** The task that receives it, if one is open. */
  task: TaskRef | null;
}
/** Pass, or replace the text. Holding is just answering late: the host waits at most BEFORE_SEND_MS in total. */
export type SendVerdict = { kind: "pass" } | { kind: "rewrite"; text: string };
export interface TurnEndInfo {
  task: TaskRef;
  ok: boolean;
  prompt: string;
  reply: string;
  fromBlock: boolean;
  modeSwitch: boolean;
  context?: { used: number; cap?: number };
}
export interface EngineRunResult {
  ok: boolean;
  text: string;
  error?: string;
}

export interface MainCtx<C = undefined> {
  readonly id: string;
  /** The harness's `mods.<id>`, parsed by the mod's schema; undefined without a schema. */
  readonly config: C;
  readonly on: {
    beforeSend(fn: (send: SendInfo) => Promise<SendVerdict> | SendVerdict): Disposer;
    turnStart(fn: (task: TaskRef) => void | Promise<void>): Disposer;
    turnEnd(fn: (end: TurnEndInfo) => void | Promise<void>): Disposer;
    taskOpen(fn: (task: TaskRef) => void | Promise<void>): Disposer;
    taskClose(fn: (task: TaskRef) => void | Promise<void>): Disposer;
  };
  /** A channel the mod's own ui calls (0b wires the ui side). */
  ipc(name: string, handler: (payload: unknown) => unknown): Disposer;
  /** A session of the mod's own, on a tier, outside the work folder, without tools; usage is tagged with the mod's id. */
  readonly engine: { run(tier: Tier, prompt: string, opts?: { signal?: AbortSignal }): Promise<EngineRunResult> };
  readonly tasks: { running(): Promise<TaskRef | null> };
  readonly notes: { titles(scope?: string): Promise<string[]> };
  /** App-private JSON state, outside the work folder. */
  readonly storage: { get<T = unknown>(key: string): Promise<T | undefined>; set(key: string, value: unknown): Promise<void> };
  /** `.harness/mods/<id>/` in the work folder, created on first call; null before setup. */
  dataDir(): Promise<string | null>;
  notify(text: string): void;
  provide(service: unknown): void;
  readonly mods: { get<T = unknown>(id: string): T | undefined };
  log(...args: unknown[]): void;
}

/** 0b renders what a mod registers here; 0a only types it. */
export interface UiCtx {
  readonly id: string;
  block(name: string, component: unknown): Disposer;
}

export interface ModDefinition<C = undefined> {
  id: string;
  schema?: ZodType<C>;
  main?(ctx: MainCtx<C>): void | Promise<void>;
  ui?(ctx: UiCtx): void;
}
```

```ts
// packages/mod-sdk/src/define.ts
import type { ZodType } from "zod";
import type { MainCtx, ModDefinition, UiCtx } from "./types";

/** Types a mod. `mod.json` stays the source of id, name and version; the host checks the ids match. */
export function defineMod<C = undefined>(def: { id: string; schema?: ZodType<C>; main?(ctx: MainCtx<C>): void | Promise<void>; ui?(ctx: UiCtx): void }): ModDefinition<C> {
  return def;
}
```

```ts
// packages/mod-sdk/src/index.ts
export * from "./mod-json";
export * from "./types";
export * from "./define";
```

- [ ] **Step 4: Run the tests and the typecheck.** Run `corepack pnpm vitest run packages/mod-sdk && corepack pnpm typecheck`. Expected: PASS. If `ZodType<C>` infers the schema's input type instead of its output, change the generic to `ZodType<C, unknown>` (zod 4's output-first order) and run again.

- [ ] **Step 5: Commit.** `git commit -am "feat(mods): defineMod and the main/ui ctx types"`

### Task 3: The manifest's `mods` and `config.json`'s `mods`

**Files:**
- Modify: `packages/harness-sdk/src/index.ts` (the `manifestSchema` object, next to `sidekick`)
- Modify: `packages/protocol/src/views.ts` (`AppConfig`)
- Create: `packages/shell/src/main/mods/config.ts`
- Test: `packages/harness-sdk/test/mods-manifest.test.ts`, `packages/shell/test/mods/config.test.ts`

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/harness-sdk/test/mods-manifest.test.ts
import { describe, expect, it } from "vitest";
import { defineHarness } from "../src";
import { baseManifest } from "./helpers";

describe("manifest mods", () => {
  it("is absent by default (D0)", () => {
    expect(defineHarness(baseManifest()).mods).toBeUndefined();
  });
  it("keeps each mod's config as given, for the mod's own schema", () => {
    expect(defineHarness({ ...baseManifest(), mods: { echo: { word: "hi" }, bare: {} } }).mods).toEqual({ echo: { word: "hi" }, bare: {} });
  });
  it("refuses a bad mod id", () => {
    expect(() => defineHarness({ ...baseManifest(), mods: { "Bad!": {} } })).toThrow();
  });
});
```

Before writing it, check `packages/harness-sdk/test/` for an existing helper that builds a minimal valid manifest. Use it if there is one; otherwise copy the smallest valid manifest object from an existing manifest test into a local `baseManifest()` in this file.

```ts
// packages/shell/test/mods/config.test.ts
import { describe, expect, it } from "vitest";
import { cleanModsConfig, isModOn } from "../../src/main/mods/config";

describe("mods config", () => {
  it("drops junk and keeps on/local/failed", () => {
    expect(cleanModsConfig({ on: { echo: false, "Bad!": true, x: "yes" }, local: ["/a", 3, "/a"], failed: { echo: "threw" } })).toEqual({ on: { echo: false }, local: ["/a"], failed: { echo: "threw" } });
    expect(cleanModsConfig("nope")).toBeUndefined();
    expect(cleanModsConfig({})).toBeUndefined();
  });
  it("decides on/off: failed > person's switch > declared by the harness; local mods start off", () => {
    expect(isModOn("echo", "harness", undefined)).toBe(true);
    expect(isModOn("echo", "harness", { on: { echo: false } })).toBe(false);
    expect(isModOn("echo", "local", undefined)).toBe(false);
    expect(isModOn("echo", "local", { on: { echo: true } })).toBe(true);
    expect(isModOn("echo", "harness", { on: { echo: true }, failed: { echo: "x" } })).toBe(false);
    expect(isModOn("core-x", "core", undefined)).toBe(false);
  });
});
```

`isModOn` gets the origin `"harness"` only for mods the manifest declares. A core mod the manifest declares in `mods` resolves with origin `"harness"` for on/off purposes (see Task 5).

- [ ] **Step 2: Run them and check they fail.** Run `corepack pnpm vitest run packages/harness-sdk/test/mods-manifest.test.ts packages/shell/test/mods/config.test.ts`. Expected: both FAIL.

- [ ] **Step 3: Implement.**

In `packages/harness-sdk/src/index.ts`, import `MOD_ID` from `@humanharness/mod-sdk`, add the dependency `"@humanharness/mod-sdk": "workspace:*"` to `packages/harness-sdk/package.json`, and add this to `manifestSchema` right after `sidekick`:

```ts
  /** Mods this harness turns on, each with its config for the mod's own schema (minimal-core spec §4.1). Absent: none (D0). */
  mods: z.record(z.string().regex(MOD_ID, "A mod id is lowercase letters, digits and -"), z.record(z.string(), z.unknown())).optional(),
```

In `packages/protocol/src/views.ts`, add to `AppConfig`:

```ts
  /** Settings › Mods (minimal-core spec §4): the person's switches, local mod folders, mods turned off after three strikes. Cleaned when read. */
  mods?: ModsConfig;
```

and next to `PolicyIds`:

```ts
export interface ModsConfig {
  on?: Record<string, boolean>;
  /** Absolute folders the person added (after the warning). */
  local?: string[];
  /** Turned off after three failures in a row, with the reason; turning the mod on clears it. */
  failed?: Record<string, string>;
}
```

```ts
// packages/shell/src/main/mods/config.ts
import { MOD_ID } from "@humanharness/mod-sdk";
import type { ModsConfig } from "@humanharness/protocol";

export type ModOrigin = "core" | "harness" | "local";
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** `config.json` → `mods`, cleaned; undefined when nothing is left. */
export function cleanModsConfig(v: unknown): ModsConfig | undefined {
  if (!isObj(v)) return undefined;
  const out: ModsConfig = {};
  if (isObj(v.on)) {
    const on = Object.fromEntries(Object.entries(v.on).filter(([id, b]) => MOD_ID.test(id) && typeof b === "boolean")) as Record<string, boolean>;
    if (Object.keys(on).length > 0) out.on = on;
  }
  if (Array.isArray(v.local)) {
    const local = [...new Set(v.local.filter((p): p is string => typeof p === "string" && p.startsWith("/")))];
    if (local.length > 0) out.local = local;
  }
  if (isObj(v.failed)) {
    const failed = Object.fromEntries(Object.entries(v.failed).filter(([id, r]) => MOD_ID.test(id) && typeof r === "string").map(([id, r]) => [id, (r as string).slice(0, 300)]));
    if (Object.keys(failed).length > 0) out.failed = failed;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** On when not failed, and then the person's switch, else on only if the harness declares it. */
export function isModOn(id: string, origin: ModOrigin, c: ModsConfig | undefined): boolean {
  if (c?.failed?.[id] !== undefined) return false;
  const own = c?.on?.[id];
  if (own !== undefined) return own;
  return origin === "harness";
}
```

On Windows, absolute paths don't start with `/`. Use `path.isAbsolute` from `node:path` in place of `p.startsWith("/")`, and keep the test's paths POSIX.

Then find where `config.ts` cleans fields on load (the place that calls `cleanPolicies`) and add `mods: cleanModsConfig(raw.mods)` the same way, leaving it out when undefined.

- [ ] **Step 4: Run them and check they pass.** Same command, plus `corepack pnpm typecheck`. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -am "feat(mods): manifest and config.json mods keys"`

### Task 4: `guarded()`, a hook call with try/catch and a timeout

**Files:**
- Create: `packages/shell/src/main/mods/guard.ts`
- Test: `packages/shell/test/mods/guard.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, it } from "vitest";
import { guarded } from "../../src/main/mods/guard";

describe("guarded", () => {
  it("returns the value", async () => {
    expect(await guarded(() => 2, 100)).toEqual({ ok: true, value: 2 });
  });
  it("turns a throw and a rejection into a failure, never a throw", async () => {
    expect(await guarded(() => { throw new Error("boom"); }, 100)).toEqual({ ok: false, reason: "boom" });
    expect(await guarded(() => Promise.reject(new Error("no")), 100)).toEqual({ ok: false, reason: "no" });
  });
  it("times out", async () => {
    expect(await guarded(() => new Promise(() => {}), 20)).toEqual({ ok: false, reason: "timed out after 20 ms" });
  });
});
```

- [ ] **Step 2: Run it and check it fails.** Run `corepack pnpm vitest run packages/shell/test/mods/guard.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**

```ts
// packages/shell/src/main/mods/guard.ts
export type Guarded<T> = { ok: true; value: T } | { ok: false; reason: string };

/** Runs a mod's function: a throw, a rejection or running past `ms` is a failure the host counts, never a throw. */
export async function guarded<T>(fn: () => T | Promise<T>, ms: number): Promise<Guarded<Awaited<T>>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Guarded<Awaited<T>>>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: `timed out after ${ms} ms` }), ms);
  });
  const run = (async (): Promise<Guarded<Awaited<T>>> => {
    try {
      return { ok: true, value: await fn() };
    } catch (err) {
      return { ok: false, reason: (err instanceof Error ? err.message : String(err)).slice(0, 300) };
    }
  })();
  try {
    return await Promise.race([run, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run it and check it passes.** Expected: PASS (3 tests).
- [ ] **Step 5: Commit.** `git commit -am "feat(mods): guarded hook calls"`

### Task 5: The resolver: core registry, harness folder, local folders

**Files:**
- Create: `packages/shell/src/main/mods/core-mods.ts`, `packages/shell/src/main/mods/resolve.ts`
- Create fixtures: `packages/shell/test/fixtures/mods/echo/{mod.json,main.js}`, `.../broken/{mod.json,main.js}`, `.../slow/{mod.json,main.js}`, `.../badjson/mod.json`
- Test: `packages/shell/test/mods/resolve.test.ts`

- [ ] **Step 1: Create the fixtures.** They are plain ESM, so no build is needed.

`echo/mod.json`:
```json
{ "id": "echo", "name": "Echo", "version": "0.1.0", "apiVersion": 1 }
```
`echo/main.js`:
```js
export default {
  id: "echo",
  main(ctx) {
    ctx.on.beforeSend((s) => (s.text === "ping" ? { kind: "rewrite", text: (ctx.config && ctx.config.word) || "pong" } : { kind: "pass" }));
    ctx.on.turnEnd((e) => ctx.log("turn ended", e.task.id));
    ctx.ipc("hello", (p) => ({ hello: p }));
  },
};
```
`broken/mod.json`: the same as echo's with `"id": "broken", "name": "Broken"`. `broken/main.js`:
```js
export default { id: "broken", main(ctx) { ctx.on.beforeSend(() => { throw new Error("broken on purpose"); }); } };
```
`slow/mod.json`: `"id": "slow", "name": "Slow"`. `slow/main.js`:
```js
export default { id: "slow", main(ctx) { ctx.on.beforeSend(() => new Promise(() => {})); } };
```
`badjson/mod.json`: `{ "id": "badjson" }`.

- [ ] **Step 2: Write the failing test.**

```ts
// packages/shell/test/mods/resolve.test.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveMods } from "../../src/main/mods/resolve";

const fx = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/mods");

describe("resolveMods", () => {
  it("finds harness-declared mods in the harness folder, and local folders", async () => {
    const r = await resolveMods({ declared: { echo: { word: "hi" } }, harnessModsDir: fx, local: [path.join(fx, "broken")], core: {} });
    expect(r.mods.map((m) => [m.json.id, m.origin])).toEqual([["echo", "harness"], ["broken", "local"]]);
    expect(r.mods[0].config).toEqual({ word: "hi" });
    expect(r.problems).toEqual([]);
  });
  it("reports, without throwing, a declared mod that doesn't exist and a bad mod.json", async () => {
    const r = await resolveMods({ declared: { nope: {} }, harnessModsDir: fx, local: [path.join(fx, "badjson")], core: {} });
    expect(r.mods).toEqual([]);
    expect(r.problems.map((p) => p.id)).toEqual(["nope", path.join(fx, "badjson")]);
  });
  it("prefers a core mod over a harness folder of the same id", async () => {
    const core = { echo: { dir: path.join(fx, "echo") } };
    const r = await resolveMods({ declared: { echo: {} }, harnessModsDir: "/nowhere", local: [], core });
    expect(r.mods[0].origin).toBe("harness"); // declared by the harness, so its switch default is the harness's
    expect(r.mods[0].shipped).toBe("core");
  });
  it("refuses a local mod whose id is already taken", async () => {
    const r = await resolveMods({ declared: { echo: {} }, harnessModsDir: fx, local: [path.join(fx, "echo")], core: {} });
    expect(r.mods).toHaveLength(1);
    expect(r.problems[0].reason).toMatch(/already/);
  });
});
```

- [ ] **Step 3: Run it and check it fails.** Run `corepack pnpm vitest run packages/shell/test/mods/resolve.test.ts`. Expected: FAIL.

- [ ] **Step 4: Implement.**

```ts
// packages/shell/src/main/mods/core-mods.ts
/** Mods the core ships (spec D2), off unless a harness declares them or the person turns them on. Step 1 adds sidekick. */
export const CORE_MODS: Record<string, { dir: string }> = {};
```

```ts
// packages/shell/src/main/mods/resolve.ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { type ModJson, modJsonSchema } from "@humanharness/mod-sdk";
import type { ModOrigin } from "./config";

export interface ResolvedMod {
  json: ModJson;
  dir: string;
  /** For the on/off rule: "harness" when the manifest declares it, whoever shipped it. */
  origin: ModOrigin;
  /** Who shipped the code. */
  shipped: ModOrigin;
  config: Record<string, unknown> | undefined;
}
export interface ResolveProblem {
  id: string;
  reason: string;
}

async function readJson(dir: string): Promise<ModJson> {
  const raw = JSON.parse(await fs.readFile(path.join(dir, "mod.json"), "utf8")) as unknown;
  const r = modJsonSchema.safeParse(raw);
  if (!r.success) throw new Error(`mod.json: ${r.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  return r.data;
}

/**
 * Every mod this app could run, read without running code: the harness's declared ones (a core mod of that id first,
 * else `<harnessModsDir>/<id>`), then the person's local folders. Problems are reported, never thrown.
 */
export async function resolveMods(o: {
  declared: Record<string, Record<string, unknown>> | undefined;
  harnessModsDir: string;
  local: string[];
  core: Record<string, { dir: string }>;
}): Promise<{ mods: ResolvedMod[]; problems: ResolveProblem[] }> {
  const mods: ResolvedMod[] = [];
  const problems: ResolveProblem[] = [];
  for (const [id, config] of Object.entries(o.declared ?? {})) {
    const core = Object.hasOwn(o.core, id) ? o.core[id] : undefined;
    const dir = core ? core.dir : path.join(o.harnessModsDir, id);
    try {
      const json = await readJson(dir);
      if (json.id !== id) throw new Error(`mod.json says "${json.id}"`);
      mods.push({ json, dir, origin: "harness", shipped: core ? "core" : "harness", config });
    } catch (err) {
      problems.push({ id, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  for (const dir of o.local) {
    try {
      const json = await readJson(dir);
      if (mods.some((m) => m.json.id === json.id)) throw new Error(`the id "${json.id}" is already used`);
      mods.push({ json, dir, origin: "local", shipped: "local", config: undefined });
    } catch (err) {
      problems.push({ id: dir, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return { mods, problems };
}
```

Core mods the manifest doesn't declare are listed too, so the person can turn them on. Add this at the end of `resolveMods`, before `return`:

```ts
  for (const [id, { dir }] of Object.entries(o.core)) {
    if (mods.some((m) => m.json.id === id)) continue;
    try {
      mods.push({ json: await readJson(dir), dir, origin: "core", shipped: "core", config: undefined });
    } catch (err) {
      problems.push({ id, reason: err instanceof Error ? err.message : String(err) });
    }
  }
```

Then put the core loop **before** the local loop, so a local folder can't take a core id. Add this test case: `resolveMods({ declared: undefined, harnessModsDir: "/x", local: [], core: { echo: { dir: <echo> } } })` lists echo with origin `"core"`.

- [ ] **Step 5: Run it and check it passes.** Expected: PASS (5 tests).
- [ ] **Step 6: Commit.** `git add packages/shell/src/main/mods packages/shell/test/mods packages/shell/test/fixtures/mods && git commit -m "feat(mods): resolve core, harness and local mods"`

### Task 6: `ModHost`: loading, registrations, hooks, three strikes

**Files:**
- Create: `packages/shell/src/main/mods/host.ts`
- Test: `packages/shell/test/mods/host.test.ts`

The host only depends on the services factory and a few callbacks, so the test runs it in plain Node.

- [ ] **Step 1: Write the failing test.**

```ts
// packages/shell/test/mods/host.test.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { ModHost, type HostDeps } from "../../src/main/mods/host";
import { resolveMods } from "../../src/main/mods/resolve";

const fx = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/mods");
const task = { id: "t1", scope: "main" };

async function host(declared: Record<string, Record<string, unknown>>, over: Partial<HostDeps> = {}) {
  const { mods } = await resolveMods({ declared, harnessModsDir: fx, local: [], core: {} });
  const deps: HostDeps = {
    config: { load: async () => undefined, saveFailed: vi.fn(async () => {}) },
    services: () => ({}),
    notice: vi.fn(),
    changed: vi.fn(),
    beforeSendMs: 50,
    hookMs: 50,
    ...over,
  };
  const h = new ModHost(deps);
  await h.start(mods);
  return { h, deps };
}

describe("ModHost", () => {
  it("runs beforeSend rewrites in load order and passes config", async () => {
    const { h } = await host({ echo: { word: "hi" } });
    expect(await h.beforeSend({ text: "ping", task: null })).toBe("hi");
    expect(await h.beforeSend({ text: "other", task: null })).toBe("other");
  });
  it("sends the text unchanged when a mod throws or holds past the budget", async () => {
    const { h } = await host({ broken: {}, slow: {} });
    expect(await h.beforeSend({ text: "x", task: null })).toBe("x");
  });
  it("turns a mod off after three failures in a row, saves why, and tells the person", async () => {
    const { h, deps } = await host({ broken: {} });
    for (let i = 0; i < 3; i++) await h.beforeSend({ text: "x", task: null });
    expect(h.view().find((m) => m.id === "broken")).toMatchObject({ on: false, failed: "broken on purpose" });
    expect(deps.config.saveFailed).toHaveBeenCalledWith("broken", "broken on purpose");
    expect(deps.notice).toHaveBeenCalledWith(expect.stringContaining("Broken"));
  });
  it("a success resets the count", async () => {
    let fail = true;
    const { mods } = await resolveMods({ declared: {}, harnessModsDir: fx, local: [], core: {} });
    const h = new ModHost({ config: { load: async () => undefined, saveFailed: vi.fn(async () => {}) }, services: () => ({}), notice: vi.fn(), changed: vi.fn(), beforeSendMs: 50, hookMs: 50 });
    await h.start(mods);
    h.registerForTest("flaky", "Flaky", (ctx) => ctx.on.taskOpen(() => { if (fail) throw new Error("x"); }));
    await h.taskOpen(task);
    await h.taskOpen(task);
    fail = false;
    await h.taskOpen(task);
    fail = true;
    await h.taskOpen(task);
    await h.taskOpen(task);
    expect(h.view().find((m) => m.id === "flaky")?.on).toBe(true);
  });
  it("turning a mod off runs its disposers: its hooks stop", async () => {
    const { h } = await host({ echo: {} });
    await h.set("echo", false);
    expect(await h.beforeSend({ text: "ping", task: null })).toBe("ping");
    await h.set("echo", true);
    expect(await h.beforeSend({ text: "ping", task: null })).toBe("pong");
  });
  it("answers a mod's ipc and refuses an unknown one", async () => {
    const { h } = await host({ echo: {} });
    expect(await h.ipc("echo", "hello", 1)).toEqual({ ok: true, value: { hello: 1 } });
    expect(await h.ipc("echo", "nope", 1)).toEqual({ ok: false, reason: "no such channel" });
  });
  it("doesn't start a mod whose required mod is missing or off", async () => {
    const h = new ModHost({ config: { load: async () => undefined, saveFailed: vi.fn(async () => {}) }, services: () => ({}), notice: vi.fn(), changed: vi.fn(), beforeSendMs: 50, hookMs: 50 });
    await h.start([{ json: { id: "needy", name: "Needy", version: "0.1.0", apiVersion: 1, requires: ["ghost"], history: false, main: "main.js" }, dir: path.join(fx, "echo"), origin: "harness", shipped: "harness", config: undefined }]);
    expect(h.view()[0]).toMatchObject({ on: false, problem: 'needs the mod "ghost"' });
  });
});
```

`registerForTest` is a test-only entry that registers an in-memory definition. It's exported and documented as such. It saves writing a fixture per edge case.

- [ ] **Step 2: Run it and check it fails.** Run `corepack pnpm vitest run packages/shell/test/mods/host.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**

```ts
// packages/shell/src/main/mods/host.ts
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

export class ModHost {
  private readonly mods = new Map<string, Running>();
  constructor(private readonly d: HostDeps) {}

  async start(list: ResolvedMod[]): Promise<void> {
    const c = await this.d.config.load();
    for (const mod of list) this.mods.set(mod.json.id, { mod, on: false, strikes: 0, hooks: new Map(), ipc: new Map(), disposers: [], ...(c?.failed?.[mod.json.id] ? { failed: c.failed[mod.json.id] } : {}) });
    // Required mods first: a simple pass in list order, retried while something new started.
    let progress = true;
    const want = new Set(list.filter((m) => isModOn(m.json.id, m.origin, c)).map((m) => m.json.id));
    while (progress) {
      progress = false;
      for (const id of want) {
        const r = this.mods.get(id)!;
        if (r.on) continue;
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
    let config: unknown = undefined;
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
    r.on = true;
  }

  private ctx(r: Running, config: unknown): MainCtx<unknown> {
    const add = (name: HookName) => (fn: Fn) => {
      const set = r.hooks.get(name) ?? new Set();
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
    await Promise.all(this.listeners(name).map(async ([r, fn]) => {
      const res = await guarded(() => (fn as (a: unknown) => unknown)(arg), this.hookMs);
      await this.count(r, res.ok, res.ok ? undefined : res.reason);
    }));
  }

  /** The text to send: each mod in turn may rewrite it; past the total budget the rest are skipped (spec §4.2). */
  async beforeSend(send: Omit<SendInfo, "text"> & { text: string }): Promise<string> {
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
  turnStart(task: TaskRef) { return this.each("turnStart", task); }
  turnEnd(end: TurnEndInfo) { return this.each("turnEnd", end); }
  taskOpen(task: TaskRef) { return this.each("taskOpen", task); }
  taskClose(task: TaskRef) { return this.each("taskClose", task); }

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
      await this.load(r);
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

  /** Tests only: a mod defined in memory, on. */
  registerForTest(id: string, name: string, main: (ctx: MainCtx<unknown>) => void): void {
    const r: Running = { mod: { json: { id, name, version: "0.0.0", apiVersion: 1, requires: [], history: false, main: "main.js" }, dir: "", origin: "local", shipped: "local", config: undefined }, on: true, strikes: 0, hooks: new Map(), ipc: new Map(), disposers: [] };
    this.mods.set(id, r);
    main(this.ctx(r, undefined));
  }
}
```

In `packages/protocol/src/views.ts`, add:

```ts
/** One row of Settings › Mods (minimal-core spec §4, §6). */
export interface ModRow {
  id: string;
  name: string;
  version: string;
  /** Who shipped the code: the core, the harness, or a folder the person added. */
  origin: "core" | "harness" | "local";
  on: boolean;
  /** Turned off after three strikes, and why. */
  failed?: string;
  /** Couldn't start: a missing required mod, a bad config, a throw in main. */
  problem?: string;
  /** What it registered while on (spec §6: the person sees it). */
  registers: { hooks: string[]; ipc: string[] };
}
export interface ModsView {
  mods: ModRow[];
  /** Folders that couldn't be read as mods, with why. */
  problems: { id: string; reason: string }[];
}
/** What the warning before turning on a local mod shows (spec D2, §6). */
export interface ModReview {
  id: string;
  name: string;
  version: string;
  folder: string;
}
```

- [ ] **Step 4: Run the tests and the typecheck.** Run `corepack pnpm vitest run packages/shell/test/mods && corepack pnpm typecheck`. Expected: PASS. Vitest's module cache: the host imports `main.js` by file URL, and the test only toggles with `set`, so one import per run is enough.

- [ ] **Step 5: Commit.** `git commit -am "feat(mods): ModHost with guarded hooks, requires and three strikes"`

### Task 7: The services in a mod's `ctx`

**Files:**
- Create: `packages/shell/src/main/mods/services.ts`
- Test: `packages/shell/test/mods/services.test.ts`

`engine.run` reuses `SidekickSession` from `@humanharness/runtime`, a session without tools in a folder of its own, with `pickProfile` for the tier. That is how Sidekick opens its sessions today (`index.ts` around line 3396). `services.ts` takes those pieces as deps, so it doesn't import `index.ts`.

- [ ] **Step 1: Write the failing test.**

```ts
// packages/shell/test/mods/services.test.ts
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildServices, appHome } from "../../src/main/mods/services";

describe("mod services", () => {
  it("storage is a JSON file per mod in the app home, outside the work folder", async () => {
    const userData = await mkdtemp(path.join(os.tmpdir(), "hh-mods-"));
    const s = buildServices(fakeDeps({ userData }))("echo");
    expect(await s.storage!.get("k")).toBeUndefined();
    await s.storage!.set("k", { a: 1 });
    expect(await s.storage!.get("k")).toEqual({ a: 1 });
    expect(JSON.parse(await readFile(path.join(appHome(userData, "demo"), "storage", "echo.json"), "utf8"))).toEqual({ k: { a: 1 } });
  });
  it("dataDir is created only when asked (D0), under .harness/mods/<id>", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "hh-base-"));
    const s = buildServices(fakeDeps({ base }))("echo");
    await expect(stat(path.join(base, ".harness", "mods", "echo"))).rejects.toThrow();
    expect(await s.dataDir!()).toBe(path.join(base, ".harness", "mods", "echo"));
    expect((await stat(path.join(base, ".harness", "mods", "echo"))).isDirectory()).toBe(true);
  });
  it("dataDir is null before setup", async () => {
    expect(await buildServices(fakeDeps({ base: null }))("echo").dataDir!()).toBeNull();
  });
  it("engine.run tags usage with the mod id and returns the text", async () => {
    const deps = fakeDeps({});
    const r = await buildServices(deps)("echo").engine!.run("light", "hi");
    expect(r).toEqual({ ok: true, text: "answer to hi" });
    expect(deps.engineRun).toHaveBeenCalledWith(expect.objectContaining({ process: "mod:echo", tier: "light", prompt: "hi" }));
  });
});

function fakeDeps(o: { userData?: string; base?: string | null }) {
  return {
    harnessId: "demo",
    userData: o.userData ?? os.tmpdir(),
    base: async () => (o.base === undefined ? os.tmpdir() : o.base),
    engineRun: vi.fn(async (r: { prompt: string }) => ({ ok: true, text: `answer to ${r.prompt}` })),
    runningTask: async () => null,
    noteTitles: async () => [],
    notify: vi.fn(),
  };
}
```

- [ ] **Step 2: Run it and check it fails.** Run `corepack pnpm vitest run packages/shell/test/mods/services.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**

```ts
// packages/shell/src/main/mods/services.ts
import { promises as fs } from "node:fs";
import path from "node:path";
import type { EngineRunResult, TaskRef, Tier } from "@humanharness/mod-sdk";
import type { Services } from "./host";

/** The app's home folder (spec §5.1). 0a only uses `storage/`; 0b lands the rest. */
export const appHome = (userData: string, harnessId: string) => path.join(userData, harnessId, "app");

export interface ServiceDeps {
  harnessId: string;
  userData: string;
  /** The work folder, or null before setup. */
  base(): Promise<string | null>;
  /** One tool-less turn on a tier; `process` tags the usage line. index.ts builds it on SidekickSession. */
  engineRun(r: { process: string; tier: Tier; prompt: string; workDir: string; signal?: AbortSignal }): Promise<EngineRunResult>;
  runningTask(): Promise<TaskRef | null>;
  noteTitles(scope?: string): Promise<string[]>;
  notify(text: string): void;
}

export function buildServices(d: ServiceDeps): (id: string) => Services {
  return (id) => {
    const file = path.join(appHome(d.userData, d.harnessId), "storage", `${id}.json`);
    const read = async (): Promise<Record<string, unknown>> => {
      try {
        return JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
      } catch {
        return {};
      }
    };
    let queue: Promise<unknown> = Promise.resolve();
    return {
      storage: {
        get: async <T>(key: string) => (await read())[key] as T | undefined,
        set: (key, value) => {
          const next = queue.then(async () => {
            const all = await read();
            all[key] = value;
            await fs.mkdir(path.dirname(file), { recursive: true });
            await fs.writeFile(`${file}.tmp`, JSON.stringify(all));
            await fs.rename(`${file}.tmp`, file);
          });
          queue = next.catch(() => undefined);
          return next;
        },
      },
      dataDir: async () => {
        const base = await d.base();
        if (!base) return null;
        const dir = path.join(base, ".harness", "mods", id);
        await fs.mkdir(dir, { recursive: true });
        return dir;
      },
      engine: { run: (tier, prompt, opts) => d.engineRun({ process: `mod:${id}`, tier, prompt, workDir: path.join(appHome(d.userData, d.harnessId), "sessions", id), ...(opts?.signal ? { signal: opts.signal } : {}) }) },
      tasks: { running: () => d.runningTask() },
      notes: { titles: (scope) => d.noteTitles(scope) },
      notify: (text) => d.notify(text),
      log: (...args) => console.log(`[mod ${id}]`, ...args),
    };
  };
}
```

**History exclusion (spec §4.1):** `.harness/mods/<id>/` stays out of the work folder's history unless `mod.json` says `history: true`. Find the ignore list passed to `new History(folder, …, ignore, …)` in `index.ts` (around line 1213), and add `.harness/mods/<id>/` for each resolved mod with `history: false`. Add a test in `packages/shell/test/mods/services.test.ts` (or next to the existing history ignore test, wherever that helper is tested) that checks the ignore list holds `.harness/mods/echo/` for echo and doesn't hold it for a mod with `history: true`. Put that logic in an exported function in `services.ts`:

```ts
/** Work-folder history ignores for mod data (spec §4.1). */
export const modHistoryIgnores = (mods: { id: string; history: boolean }[]) => mods.filter((m) => !m.history).map((m) => `.harness/mods/${m.id}/`);
```

- [ ] **Step 4: Run it and check it passes.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -am "feat(mods): ctx services (storage, dataDir, engine.run, tasks, notes, notify)"`

### Task 8: The `taskOpened` dep in `TaskManager`

**Files:**
- Modify: `packages/shell/src/main/task-manager.ts`. Add to the `TaskDeps` interface next to `taskClosed` (around line 255), and add the call in `begin` right after `this.begun = true;` (around line 1900).
- Test: the existing task-manager unit test file for start, `packages/shell/test/task-manager*.test.ts` (find the file that tests `start()` with `ls packages/shell/test | grep task-manager`).

- [ ] **Step 1: Write the failing test** in that file, following its setup helpers:

```ts
it("calls taskOpened once with the new task, after it is current (mods spec §4.2)", async () => {
  const taskOpened = vi.fn();
  const m = makeManager({ taskOpened }); // the file's own factory
  await m.start("write", "go");
  expect(taskOpened).toHaveBeenCalledTimes(1);
  expect(taskOpened.mock.calls[0][0]).toMatchObject({ action: "write", scope: expect.any(String), id: expect.any(String) });
});
```

- [ ] **Step 2: Run it and check it fails.**

- [ ] **Step 3: Implement.** In `TaskDeps`:

```ts
  /** A task opened: it is current, before its first turn (minimal-core spec §4.2 taskOpen). Never awaited. Absent: nothing (D0). */
  taskOpened?(task: { id: string; action?: string; scope: string }): void;
```

In `begin`, right after `this.begun = true;`:

```ts
    this.d.taskOpened?.({ id, ...(task.action ? { action: task.action } : {}), scope });
```

- [ ] **Step 4: Run the task-manager tests and check they pass.** Run `corepack pnpm vitest run packages/shell/test/task-manager` (glob). Expected: all PASS.
- [ ] **Step 5: Commit.** `git commit -am "feat(mods): taskOpened task dep"`

### Task 9: Settings › Mods IPC and the local-mod flow

**Files:**
- Create: `packages/shell/src/main/mods/mods-ipc.ts`
- Modify: `packages/protocol/src/channels.ts`, `packages/protocol/src/client.ts`, and the preload that maps `client.*` to channels (find it with `grep -rn '"hh:sidekick' packages/shell/src/preload*`)
- Test: `packages/shell/test/mods/mods-ipc.test.ts`

Add-from-folder mirrors Settings › Plugins: main shows the folder dialog and answers a review plus a one-time token. The renderer never sends a path.

- [ ] **Step 1: Write the failing test.**

```ts
// packages/shell/test/mods/mods-ipc.test.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { registerModsIpc } from "../../src/main/mods/mods-ipc";

const fx = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/mods");

function setup(pick: string | null) {
  const handlers = new Map<string, (...a: never[]) => unknown>();
  const handle = (c: string, fn: (...a: never[]) => unknown) => void handlers.set(c, fn);
  const deps = {
    view: vi.fn(async () => ({ mods: [], problems: [] })),
    set: vi.fn(async () => {}),
    pickFolder: vi.fn(async () => pick),
    addLocal: vi.fn(async () => {}),
    removeLocal: vi.fn(async () => {}),
    isLocal: (id: string) => id === "broken",
  };
  registerModsIpc(handle as never, deps);
  const call = (c: string, ...a: unknown[]) => (handlers.get(c) as (...x: unknown[]) => Promise<unknown>)(...a);
  return { call, deps };
}

describe("mods IPC", () => {
  it("lists, and refuses a malformed switch", async () => {
    const { call, deps } = setup(null);
    await call("hh:mods");
    await expect(call("hh:modSet", "Bad!", true)).rejects.toThrow();
    await expect(call("hh:modSet", "echo", "yes")).rejects.toThrow();
    await call("hh:modSet", "echo", true);
    expect(deps.set).toHaveBeenCalledWith("echo", true);
  });
  it("add: reviews the picked folder and adds it only with the matching token", async () => {
    const { call, deps } = setup(path.join(fx, "echo"));
    const r = (await call("hh:modReviewLocal")) as { review: { id: string; folder: string }; token: string };
    expect(r.review).toMatchObject({ id: "echo", name: "Echo", folder: path.join(fx, "echo") });
    await expect(call("hh:modAddLocal", "0".repeat(32))).rejects.toThrow();
    await call("hh:modAddLocal", r.token);
    expect(deps.addLocal).toHaveBeenCalledWith(path.join(fx, "echo"));
    await expect(call("hh:modAddLocal", r.token)).rejects.toThrow(); // one-time
  });
  it("add: a cancelled dialog answers null; a folder without a valid mod.json answers its problem", async () => {
    expect(await setup(null).call("hh:modReviewLocal")).toBeNull();
    expect(await setup(path.join(fx, "badjson")).call("hh:modReviewLocal")).toMatchObject({ problem: expect.stringContaining("mod.json") });
  });
  it("remove only applies to local mods", async () => {
    const { call, deps } = setup(null);
    await expect(call("hh:modRemoveLocal", "echo")).rejects.toThrow();
    await call("hh:modRemoveLocal", "broken");
    expect(deps.removeLocal).toHaveBeenCalledWith("broken");
  });
});
```

- [ ] **Step 2: Run it and check it fails.**

- [ ] **Step 3: Implement.**

```ts
// packages/shell/src/main/mods/mods-ipc.ts
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { MOD_ID, modJsonSchema } from "@humanharness/mod-sdk";
import type { ModReview, ModsView } from "@humanharness/protocol";

const TOKEN = /^[0-9a-f]{32}$/;
type Handle = (channel: string, fn: (...args: never[]) => unknown) => void;

export interface ModsIpcDeps {
  view(): Promise<ModsView>;
  set(id: string, on: boolean): Promise<void>;
  /** Main's folder dialog; null when cancelled. */
  pickFolder(): Promise<string | null>;
  /** Saves the folder in config.json `mods.local`, resolves it, and turns it on (the person already confirmed). */
  addLocal(folder: string): Promise<void>;
  removeLocal(id: string): Promise<void>;
  isLocal(id: string): boolean;
}

export function registerModsIpc(handle: Handle, d: ModsIpcDeps): void {
  const pending = new Map<string, string>();
  handle("hh:mods", () => d.view());
  handle("hh:modSet", async (id: unknown, on: unknown) => {
    if (typeof id !== "string" || !MOD_ID.test(id) || typeof on !== "boolean") throw new Error("Invalid mod change");
    await d.set(id, on);
    return d.view();
  });
  handle("hh:modReviewLocal", async (): Promise<{ review: ModReview; token: string } | { problem: string } | null> => {
    const folder = await d.pickFolder();
    if (!folder) return null;
    try {
      const json = modJsonSchema.parse(JSON.parse(await fs.readFile(path.join(folder, "mod.json"), "utf8")));
      const token = randomBytes(16).toString("hex");
      pending.set(token, folder);
      return { review: { id: json.id, name: json.name, version: json.version, folder }, token };
    } catch (err) {
      return { problem: `This folder has no valid mod.json (${err instanceof Error ? err.message.slice(0, 200) : "unreadable"})` };
    }
  });
  handle("hh:modAddLocal", async (token: unknown) => {
    if (typeof token !== "string" || !TOKEN.test(token) || !pending.has(token)) throw new Error("Unknown review");
    const folder = pending.get(token)!;
    pending.delete(token);
    await d.addLocal(folder);
    return d.view();
  });
  handle("hh:modRemoveLocal", async (id: unknown) => {
    if (typeof id !== "string" || !MOD_ID.test(id) || !d.isLocal(id)) throw new Error("Not a local mod");
    await d.removeLocal(id);
    return d.view();
  });
}
```

In `packages/protocol/src/channels.ts`, add to `Invoke` (after the Sidekick entries):

```ts
  "hh:mods": () => Promise<ModsView>;
  "hh:modSet": (id: string, on: boolean) => Promise<ModsView>;
  "hh:modReviewLocal": () => Promise<{ review: ModReview; token: string } | { problem: string } | null>;
  "hh:modAddLocal": (token: string) => Promise<ModsView>;
  "hh:modRemoveLocal": (id: string) => Promise<ModsView>;
```

Add to `Push`: `"hh:modsChanged": ModsView;`. Import `ModReview` and `ModsView` from `./views`.

In `packages/protocol/src/client.ts`, add to `HarnessClient`:

```ts
  /** Settings › Mods (minimal-core spec §4, §6). */
  mods: {
    view(): Promise<ModsView>;
    set(id: string, on: boolean): Promise<ModsView>;
    reviewLocal(): Promise<{ review: ModReview; token: string } | { problem: string } | null>;
    addLocal(token: string): Promise<ModsView>;
    removeLocal(id: string): Promise<ModsView>;
    onChanged(fn: (v: ModsView) => void): () => void;
  };
```

Map it in the preload the same way `sidekick` is mapped. Also add a no-op `mods` to `packages/ui/test/fake-client.ts` (`view` resolves `{ mods: [], problems: [] }`) so existing UI tests still typecheck.

- [ ] **Step 4: Run it and check it passes,** plus `corepack pnpm typecheck` and `corepack pnpm vitest run packages/shell/test/ipc-surface.test.ts`. That last test lists every channel, so add the five new channels to its expected list if it fails.
- [ ] **Step 5: Commit.** `git commit -am "feat(mods): Settings › Mods IPC with the local-mod review token"`

### Task 10: Wire the host into `index.ts`

**Files:**
- Modify: `packages/shell/src/main/index.ts`
- Test: `packages/shell/test/mods/wiring.test.ts` (pure helper) and the e2e in Task 12

`index.ts` is too large to unit-test. Keep the logic in a small exported helper, test that, and keep `index.ts` to calls.

- [ ] **Step 1: Write the failing test** for a helper that turns `TurnEnd`/task shapes into hook payloads and decides whether a host is needed:

```ts
// packages/shell/test/mods/wiring.test.ts
import { describe, expect, it } from "vitest";
import { needsHost, toTurnEnd } from "../../src/main/mods/wiring";

describe("mods wiring", () => {
  it("builds no host with nothing declared, nothing local, and no core mod (D0)", () => {
    expect(needsHost({ declared: undefined, local: [], coreIds: [] })).toBe(false);
    expect(needsHost({ declared: { echo: {} }, local: [], coreIds: [] })).toBe(true);
    expect(needsHost({ declared: undefined, local: ["/x"], coreIds: [] })).toBe(true);
    expect(needsHost({ declared: undefined, local: [], coreIds: ["sidekick"] })).toBe(true);
  });
  it("passes a TurnEnd through without the kind", () => {
    const end = { task: { id: "t", scope: "main" }, kind: "run" as const, ok: true, prompt: "p", reply: "r", fromBlock: false, modeSwitch: false };
    expect(toTurnEnd(end)).toEqual({ task: { id: "t", scope: "main" }, ok: true, prompt: "p", reply: "r", fromBlock: false, modeSwitch: false });
  });
});
```

- [ ] **Step 2: Run it and check it fails.**

- [ ] **Step 3: Implement `wiring.ts`.**

```ts
// packages/shell/src/main/mods/wiring.ts
import type { TurnEndInfo } from "@humanharness/mod-sdk";
import type { TurnEnd } from "../task-manager";

/** D0: the host exists only if some mod could run. Settings › Mods still shows (empty) without one. */
export const needsHost = (o: { declared: Record<string, unknown> | undefined; local: string[]; coreIds: string[] }) =>
  Object.keys(o.declared ?? {}).length > 0 || o.local.length > 0 || o.coreIds.length > 0;

export function toTurnEnd(e: TurnEnd): TurnEndInfo {
  const { kind: _kind, ...rest } = e;
  return rest;
}
```

- [ ] **Step 4: Run it and check it passes.**

- [ ] **Step 5: Wire `index.ts`.** Make these edits; each anchor is a line found in this plan's exploration:

1. **Module state**, next to `let sidekickCtl` (around line 347):
   ```ts
   /** The mod host (minimal-core spec §4); null with no mod that could run (D0). */
   let modHost: ModHost | null = null;
   ```
2. **Task deps object** (the one with `get turnStarting()`, around lines 1444–1457). Combine Sidekick's existing callbacks with the host's. Don't replace them; Sidekick still lives in core until step 1.
   ```ts
   get turnStarting() {
     const sidekick = sidekickCtl;
     const mods = modHost;
     if (!sidekick && !mods) return undefined;
     return () => {
       sidekick?.turnStarting();
       if (mods) void tasks.runningTask().then((t) => t && mods.turnStart({ id: t.id, scope: t.scope, ...(t.action ? { action: t.action } : {}) }));
     };
   },
   get turnEnded() {
     const sidekick = sidekickCtl;
     const mods = modHost;
     if (!sidekick && !mods) return undefined;
     return (end: TurnEnd) => {
       if (sidekick) void sidekick.afterReply(end).catch((err: unknown) => console.error("Sidekick's after-reply turn failed", err));
       if (mods) void mods.turnEnd(toTurnEnd(end));
     };
   },
   get taskOpened() {
     const mods = modHost;
     return mods ? (t: { id: string; action?: string; scope: string }) => void mods.taskOpen(t) : undefined;
   },
   ```
   Then change the existing `get taskClosed()` (around line 1330) so it calls both `jobs.taskClosed(t)` and `modHost?.taskClose(t)`, and returns `undefined` only when both are absent. Check what `tasks.runningTask()` returns before relying on `t.scope` and `t.action`. If its shape differs, map it the same way the Sidekick `task:` dep does (around line 3430).
3. **`hh:send`** (around line 2661). Make the handler `async`. After the existing validation and before `const sent = …`, add:
   ```ts
   if (modHost) {
     const running = await tasks.runningTask().catch(() => null);
     message = await modHost.beforeSend({ text: message, ...(action ? { action } : {}), ...(scope ? { scope } : {}), task: running ? { id: running.id, scope: running.scope, ...(running.action ? { action: running.action } : {}) } : null });
   }
   ```
   `message` is a parameter; reassigning it is fine. The host already refuses blank or oversized rewrites.
4. **Startup**, right after the Sidekick controller is built (after `sidekickCtl = new SidekickController({…})`, around line 3396+). Build the host when `needsHost(...)` is true:
   ```ts
   const modsConfig = (await config.load()).mods;
   const harnessModsDir = path.join(loaded.root ?? __HARNESS_DIR__, "mods");
   if (needsHost({ declared: harness.mods, local: modsConfig?.local ?? [], coreIds: Object.keys(CORE_MODS) })) {
     const resolved = await resolveMods({ declared: harness.mods, harnessModsDir, local: modsConfig?.local ?? [], core: CORE_MODS });
     for (const p of resolved.problems) console.error(`Mod ${p.id}: ${p.reason}`);
     modProblems = resolved.problems;
     modHost = new ModHost({
       config: {
         load: async () => (await config.load()).mods,
         saveFailed: (id, reason) => config.update((c) => ({ ...c, mods: { ...c.mods, failed: { ...c.mods?.failed, [id]: reason } } })),
       },
       services: buildServices({ harnessId: harness.id, userData: app.getPath("userData"), base: async () => { const c = await validConfig(); return c ? baseOf(c) : null; }, engineRun: modEngineRun, runningTask: async () => { const t = await tasks.runningTask(); return t ? { id: t.id, scope: t.scope, ...(t.action ? { action: t.action } : {}) } : null; }, noteTitles: async (scope) => { const c = await validConfig(); return c ? (await readNotes(baseOf(c), notesPrefix(scoped(), scope ?? MAIN_SCOPE)).catch(() => [])).map((n) => n.title) : []; }, notify: (text) => showNotice(text) }),
       notice: (text) => showNotice(text),
       changed: () => void modsView().then((v) => sendToWindow("hh:modsChanged", v)),
     });
     await modHost.start(resolved.mods);
   }
   ```
   - Check how `loaded` exposes the harness root (`loadHarness(…, { root: __HARNESS_DIR__ })`) and use that field. If none exists, use `__HARNESS_DIR__`.
   - Check how `config` writes a change (find the function the `hh:saveConfig` handler uses) and use that in place of `config.update` if the name differs.
   - Check what shows a notice in the window today (search for how `hasNotice` notices are sent) and use it for `showNotice`. If that path is engine-specific, push a plain `hh:notice`-style message the window already renders. Don't add a new UI element in this plan.
5. **`modEngineRun`**: a function near the host block. It builds on the same pieces as Sidekick's `open`, `profile`, `command` and `log` deps:
   ```ts
   const modEngineRun: ServiceDeps["engineRun"] = async ({ process: proc, tier, prompt, workDir, signal }) => {
     const c = await validConfig();
     if (!c) return { ok: false, text: "", error: "not set up" };
     const engine = getEngine(c.engineId);
     const command = hooks.engines?.[engine.id] ?? (await engineCommand(engine, commandDeps, { sharedPath: hasEnginePresets(harness) }));
     const models = cleanModels((await config.load()).models);
     const profile = pickProfile((await config.load()).policies?.model, { engine: engine.id, tier, models });
     await fs.mkdir(workDir, { recursive: true });
     const session = new SidekickSession({ engine, command, folder: workDir, profile });
     try {
       const a = await session.ask(prompt, signal);
       if (a.usage) await new UsageLog(baseOf(c)).append({ process: proc, ...a.usage }).catch(() => undefined);
       return a.ok ? { ok: true, text: a.text } : { ok: false, text: "", error: a.error?.message ?? "failed" };
     } finally {
       await session.close?.();
     }
   };
   ```
   Before writing it, read `packages/runtime/src/sidekick.ts` for the real method names (`ask`/`close` or their equivalents) and how Sidekick appends its usage record (`log: (base, record) => new UsageLog(base).append(record)`). Match the record shape Sidekick writes, with `process` set to the mod's tag.
6. **IPC**, next to `registerSidekickIpc(handle, () => sidekickCtl)` (around line 2773):
   ```ts
   registerModsIpc(handle, {
     view: modsView,
     set: async (id, on) => {
       await config.update((c) => ({ ...c, mods: { ...c.mods, on: { ...c.mods?.on, [id]: on }, ...(on && c.mods?.failed ? { failed: Object.fromEntries(Object.entries(c.mods.failed).filter(([k]) => k !== id)) } : {}) } }));
       await modHost?.set(id, on);
     },
     pickFolder: async () => {
       if (!window || window.isDestroyed()) return null;
       const r = await dialog.showOpenDialog(window, { properties: ["openDirectory"] });
       return r.canceled ? null : (r.filePaths[0] ?? null);
     },
     addLocal: async (folder) => {
       await config.update((c) => ({ ...c, mods: { ...c.mods, local: [...new Set([...(c.mods?.local ?? []), folder])] } }));
       await restartModHost(); // re-resolves; the new mod's id gets on:true first
     },
     removeLocal: async (id) => { /* drop its folder from mods.local and its on/failed entries, then restartModHost() */ },
     isLocal: (id) => modHost?.view().some((m) => m.id === id && m.origin === "local") ?? false,
   });
   ```
   - `modsView()` returns `{ mods: modHost?.view() ?? [], problems: modProblems }`.
   - `restartModHost()` stops the current host, then runs the startup block from point 4 again. Extract that block into `async function startModHost()` so both use it.
   - In `addLocal`, read the new folder's `mod.json` id first and set `on[id] = true` in the same config update, so the mod starts on. The person already confirmed the warning.
   - `removeLocal`: map `id` to its folder by resolving `mods.local` (each folder's `mod.json`), then remove that folder, `on[id]` and `failed[id]`.
7. **History ignores.** Where the `History` is built (around line 1213), append `modHistoryIgnores(resolvedMods)` to `ignore`. Keep the last resolved list in a module variable set by `startModHost`.
8. **Quit.** Where the app tears down the runtime on quit, add `await modHost?.stop()`.

- [ ] **Step 6: Typecheck and run the shell suite.** Run `corepack pnpm typecheck && corepack pnpm vitest run packages/shell`. Expected: PASS. The queue lists two known flaky tests, the `board-host/watch` conflict notice and on-this-day's `dist byte-identical` under the full suite. If one of them fails, rerun it alone before treating it as new.
- [ ] **Step 7: Commit.** `git commit -am "feat(mods): host wired into send, turns, tasks, IPC and quit"`

### Task 11: Settings › Mods in the window (UI work, Radix + Impeccable)

This task touches UI, so CLAUDE.md applies:
- Read `PRODUCT.md` and `DESIGN.md` first.
- Use the `impeccable` skill.
- Build only from `packages/ui/src/guide`.
- Loop: shape → build → screenshots light and dark (Task 12) → critique and fix, three rounds at most.

**Shape (put this in the PR):** Settings › Mods copies Settings › Plugins' layout, which is already approved in Radix stage 2e:
- a loose list with one row per mod: its name, an origin badge, and a switch on the right;
- for a mod that failed, a red line under its row with the reason, as Plugins shows a plugin turned off after crashes;
- an outline button **Add from folder…** under the list;
- the review takes the list's place, with the top bar reading "← Mods" and Escape going back.

There's no detail screen in 0a. The row's secondary line lists what the mod registers (spec §6). Only a local mod gets a **Remove** action in its row.

**Visual values this plan doesn't set.** Ask Marco, with a "Dejar para después" option, before choosing any of these:
- the badge color for each origin. DESIGN.md's "Badge" defines green, orange and gray for states, not origins. Proposal: no badge for Core and Harness, and the gray badge "Local" only for local mods;
- how the review's warning looks: a callout, or plain text above the buttons.

**Files:**
- Create: `packages/ui/src/mods/ModsTab.tsx`, `packages/ui/src/mods/useMods.ts`
- Modify: `packages/ui/src/settings-tabs.ts`, `packages/ui/src/SettingsPage.tsx`, `packages/i18n/src/locales/en.json`
- Test: `packages/ui/test/mods-tab.test.tsx`

- [ ] **Step 1: Add the strings** to `en.json`, as a top-level `"mods"` key next to `"plugins"`:

```json
"mods": {
  "tab": "Mods",
  "empty": "No mods yet. A mod adds a part to this app: a panel, a check before sending, a helper.",
  "origin": { "core": "Core", "harness": "Harness", "local": "Local" },
  "registers": "Uses: {{list}}",
  "failed": "Turned off after failing three times: {{reason}}",
  "problem": "Couldn't start: {{reason}}",
  "add": "Add from folder…",
  "remove": "Remove",
  "review": {
    "title": "Turn on {{name}}?",
    "warning": "A mod runs with full access to your folder, your files and your keys. Turn it on only if you trust where it came from.",
    "folder": "From {{folder}}",
    "on": "Turn on",
    "cancel": "Cancel"
  }
}
```

- [ ] **Step 2: Write the failing UI test.** Follow `packages/ui/test/` conventions: `dom-setup.ts`, `fake-client.ts`, and the render helpers used in the existing Plugins UI test (find it with `ls packages/ui/test | grep -i plugin`).

```tsx
// packages/ui/test/mods-tab.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModsTab } from "../src/mods/ModsTab";
import { fakeClient } from "./fake-client";

const view = { mods: [
  { id: "echo", name: "Echo", version: "0.1.0", origin: "harness" as const, on: true, registers: { hooks: ["beforeSend"], ipc: [] } },
  { id: "mine", name: "Mine", version: "0.1.0", origin: "local" as const, on: false, failed: "boom", registers: { hooks: [], ipc: [] } },
], problems: [] };

describe("Settings › Mods", () => {
  it("lists mods with their switch, the local badge, the failure line and what they use", async () => {
    const client = fakeClient({ mods: { view: vi.fn(async () => view) } });
    render(<ModsTab client={client} />);
    expect(await screen.findByRole("switch", { name: "Echo" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Mine" })).not.toBeChecked();
    expect(screen.getByText("Local")).toBeInTheDocument();
    expect(screen.getByText("Turned off after failing three times: boom")).toBeInTheDocument();
    expect(screen.getByText("Uses: beforeSend")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(1);
  });
  it("Add from folder shows the warning and turns on only after Turn on", async () => {
    const addLocal = vi.fn(async () => view);
    const client = fakeClient({ mods: { view: vi.fn(async () => view), reviewLocal: vi.fn(async () => ({ review: { id: "x", name: "X", version: "1.0.0", folder: "/m/x" }, token: "a".repeat(32) })), addLocal } });
    render(<ModsTab client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add from folder…" }));
    expect(await screen.findByText(/full access to your folder/)).toBeInTheDocument();
    expect(addLocal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(addLocal).toHaveBeenCalledWith("a".repeat(32)));
  });
});
```

Change `fakeClient`'s call shape to match how `fake-client.ts` actually takes overrides.

- [ ] **Step 3: Run it and check it fails.** Run `corepack pnpm vitest run packages/ui/test/mods-tab.test.tsx`. Expected: FAIL.

- [ ] **Step 4: Build `ModsTab`.** Start from `packages/ui/src/plugins/PluginsTab.tsx` and keep:
- its `Screen` state (`list` | `review`);
- its `SettingsSub` hand-back to the top bar;
- its focus return to the row or the add button;
- its use of `Group`, `Row`, `SectionHead` and `Rx` from `../guide`.

Drop the detail screen, the permission review and the rescan. `useMods.ts` loads `client.mods.view()` once, subscribes to `client.mods.onChanged`, and exposes `set`, `review`, `add` and `remove`, each replacing the view with the answer. Show the row secondary line as `mods.registers` with `registers.hooks` and `registers.ipc` joined by ", " (left out when both are empty). Show `failed`/`problem` as the red line, the same way PluginsTab shows its crash line.

- [ ] **Step 5: Add the tab.** In `settings-tabs.ts`, add `"mods"` to `TABS` right after `"sidekick"` (before `"plugins"`), and add `id === "mods" ? t("mods.tab")` in `tabLabel`. It is always visible, since it is core (spec §3.1). If `SearchSettingsTab` is a union in `client.ts`, add `"mods"` to it. In `SettingsPage.tsx`, render `<ModsTab client={client} onSub={…} />` for `tab === "mods"` the way it renders `PluginsTab`.

- [ ] **Step 6: Run the UI tests and check they pass.** Run `corepack pnpm vitest run packages/ui && corepack pnpm typecheck`. Search's settings rows may list tabs; if a search test lists every tab, add Mods to its expectation.

- [ ] **Step 7: Commit.** `git commit -am "feat(ui): Settings › Mods tab"`

### Task 12: e2e with a harness mod, and the screenshots

**Files:**
- Create: `packages/fake-agent/fixtures/mods-harness/`, a copy of `packages/fake-agent/fixtures/settings-harness`, then:
  - in its manifest, add `mods: { echo: { word: "pong" } }`;
  - add `mods/echo/mod.json` and `mods/echo/main.js`, the same as the shell fixture's echo.
- Create: `packages/e2e/tests/settings-mods-radix.spec.ts`

- [ ] **Step 1: Write the spec.** Model it on `settings-plugins-harness-radix.spec.ts`: build with `HH_HARNESS_DIR` pointing at the fixture and its own `HH_OUT_DIR`, then launch it with `launch(makeSandbox(...), { claude: claudeScript })`.

```ts
for (const theme of ["light", "dark"] as const) {
  test(`Settings › Mods with Radix, ${theme}`, async () => {
    test.setTimeout(120_000);
    const s = makeSandbox(`settings-mods-radix-${theme}`);
    const { app, page } = await launch(s, { claude: claudeScript });
    try {
      await app.evaluate(({ dialog }, folder) => {
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as unknown as typeof dialog.showOpenDialog;
      }, localEcho2); // a second fixture mod folder with id "echo-two"
      const tab = await openTab(page, theme, "Mods");
      await expect(tab.getByRole("switch", { name: "Echo" })).toBeChecked();
      await shot(page, `mods-radix-${theme}`);
      await tab.getByRole("button", { name: "Add from folder…" }).click();
      await expect(tab.getByText(/full access to your folder/)).toBeVisible();
      await shot(page, `mods-radix-${theme}-review`);
      await tab.getByRole("button", { name: "Turn on" }).click();
      await expect(tab.getByRole("switch", { name: "Echo two" })).toBeChecked();
      await expect(tab.getByText("Local")).toBeVisible();
      await tab.getByRole("switch", { name: "Echo" }).click();
      await expect(tab.getByRole("switch", { name: "Echo" })).not.toBeChecked();
    } finally {
      await closeAndClean(app, s);
    }
  });
}
```

Copy `openTab` and `shot` from the plugins spec, or move them into `helpers.ts` if they aren't there yet; check first. Add `packages/e2e/fixtures/mods/echo-two/{mod.json,main.js}` with `id: "echo-two"`, `name: "Echo two"` and a `main.js` that registers nothing.

- [ ] **Step 2: Add the send-hook e2e.** In the same file, without screenshots: send `ping` in a task, then check that the fake agent received `pong`. The fake agent's script tools let a scripted reply echo the prompt; see how `packages/e2e/tests/scripts.ts` builds `claudeScript`, and use or add a script that answers with the prompt it got. Assert that the chat shows `pong`.

- [ ] **Step 3: Run it.** Run `corepack pnpm e2e -- settings-mods-radix`. Expected: PASS, with four PNGs under `packages/e2e/test-results/look/`.

- [ ] **Step 4: Critique the screenshots** with the `impeccable` skill, against DESIGN.md's Settings template and the Plugins screenshots. Fix, re-shoot, and stop after three rounds at most. List what Impeccable decided in the PR.

- [ ] **Step 5: Commit.** `git add packages/fake-agent/fixtures/mods-harness packages/e2e && git commit -m "test(e2e): Settings › Mods and the beforeSend hook"`

### Task 13: Docs

**Files:**
- Create: `docs/architecture/mods.md`
- Modify: `docs/architecture/plugins.md` (one line at the top)
- Modify: `docs/superpowers/specs/2026-11-05-minimal-core-and-mods-design.md` (nothing; the spec stays as approved)

- [ ] **Step 1: Write `docs/architecture/mods.md`** with these sections:
  1. What a mod is, and its three origins.
  2. `mod.json`, with the fields from Task 1.
  3. `defineMod` and `MainCtx`: every hook and service from Task 2 with one line each, and the timeouts (6 s for `beforeSend` in total, 5 s per other hook).
  4. On and off: the `isModOn` rule, three strikes and where failures are saved.
  5. Local mods: the warning, and that the renderer never sends a path.
  6. Data: `storage` in the app home, `dataDir()` in `.harness/mods/<id>/`, and the history exclusion.
  7. What 0a doesn't have yet, linking the spec's §7 order.
- [ ] **Step 2: Add a header line to `plugins.md`:** `> Superseded by [mods](mods.md) (minimal-core spec, 2026-11-05). The plugin runtime is removed in step 6.`
- [ ] **Step 3: Commit.** `git commit -am "docs: mods architecture"`

### Task 14: The gate

- [ ] Run `corepack pnpm typecheck && corepack pnpm test`. Expected: all PASS. For the two known flaky tests in the queue, rerun them alone before calling a failure new.
- [ ] Run `corepack pnpm e2e -- settings-mods-radix settings-plugins-harness-radix sidekick`. Expected: PASS. Sidekick's e2e still passes because its core wiring is kept (Task 10, step 5.2).
- [ ] Check D0 by hand: start the demo (`corepack pnpm start-demo`). The demo declares no mods, so `<userData>/demo/app/` must not exist (nothing called `storage`) and `.harness/mods/` must not exist in the work folder. Settings › Mods shows the empty line.
- [ ] Open the PR against `master` from this plan's branch. Include the shape note, the screenshots, Impeccable's decisions, and "Step 0a of the minimal-core spec". Merging is Marco's.

---

## Self-review

- **Spec coverage (0a row of §7):**
  - mod-sdk/defineMod: T1, T2.
  - The host in main: T5, T6, T10.
  - Hooks for step 1: T6 and T8 (`beforeSend`, `turnStart`, `turnEnd`, `taskOpen`, `taskClose`, `ipc`).
  - Services: T7.
  - Settings › Mods: T9, T11.
  - Local-mod warning: T9, T11.
  - Three strikes: T6.
  - D0: T10's `needsHost` and the T14 check.
  - §4.1 storage, history exclusion and `requires`: T6, T7.
  - §6 "lists what it registers": T6's `view`, T11.
  - Moved to other plans, as listed under Scope: §4.5 error boundary (0b, with blocks), `partition` and the other hooks.
- **Types:**
  - `ModRow`, `ModsView` and `ModReview` are defined in T6 and T9 and used in T9 and T11.
  - `Services` is defined in T6 and built in T7.
  - `ServiceDeps["engineRun"]` is defined in T7 and used in T10.
  - `TurnEndInfo` is defined in T2 and built by `toTurnEnd` in T10.
- **Things the engineer must check in the code, named where they come up:**
  - the harness-sdk test helper (T3);
  - config's write function and the notice path (T10);
  - `SidekickSession`'s method names (T10);
  - `tasks.runningTask()`'s shape (T10);
  - the preload mapping (T9);
  - `fake-client` overrides (T11).
