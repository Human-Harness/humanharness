# ModelPolicy Implementation Plan (replaceable parts, plan 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The model decisions (which profile a task runs on, and what to retry with) leave the shell for a new `@humanharness/policies` package behind a `ModelPolicy` interface. `config.json` may name a policy, the chosen ids stay fixed per task, `usage.jsonl` records them, and one test enforces §3's import arrows.

**Architecture:**
- **`packages/policies`** (new; pure: no `node:fs`, no `child_process`, no engine transport). `src/model.ts` holds `ModelPolicy`, `DefaultModelPolicy` and the decision functions moved from `shell/src/main/models.ts` (`taskKey`, `QUESTIONS`, `tierSpec`, `resolveProfile`, `nextFallback`, `offered`, `firstOffered`, `fitEffort`). `src/registry.ts` maps ids to policies. `src/index.ts` re-exports both.
- **`shell/src/main/models.ts` re-exports the moved functions**, so `shell/test/models.test.ts` and every other importer keep working unchanged (D2). Config cleaning and display helpers stay there (`cleanModels`, `cleanSpec`, `cleanProfile`, `nearestTier`, `engineOffer`, `pinnedBudget`, `manifestTier`).
- **The shell picks and falls back only through the policy** (`pick`, `fallback`): the task flow's `profileFor`/`fallbackFor`, material, translation and the Sidekick in `shell/src/main/index.ts`, and the CLI's `run`.
- **Choice and fixing (§8):** `config.json` → `policies: { model?, context? }`, cleaned when read. When a task starts, its policy ids are kept on the task (`tasks.json`) and passed on every pick and fallback for it. `usage.jsonl` lines carry `modelPolicy` / `contextPolicy`.

**Tech Stack:** TypeScript (tsc 7, `moduleResolution: bundler`), pnpm via corepack, Vitest, Electron 44 + electron-vite 5, Playwright e2e.

Spec: `docs/superpowers/specs/2026-10-29-replaceable-parts-design.md`, §6 (part 3), §8 (shared rules), D2, D4, D7. "§" and "D" numbers below refer to it.

---

## Deviations from the spec (decided while planning; tell Marco)

1. **`pick` takes an optional `tier`: a fixed tier that skips the person's task choice and the manifest.** The Sidekick's own tier (and the routing turn's light one) uses that tier's model directly today (`index.ts`, `profile: async (engine, tier)`). §6's input has no way to say it; without it the Sidekick would bypass the policy.
2. **Default ids are not written.** A task's `policies` in `tasks.json` and the `modelPolicy`/`contextPolicy` fields in `usage.jsonl` are written only when an id is not `"default"`. §8 says a task saved before this spec runs the defaults, so "absent" already means "default"; writing it everywhere would change every saved task and usage line the existing tests compare (D2). Comparing variants still works: a line without the field ran the default.
3. **`policies.context` is read, cleaned and kept per task now, but only `"default"` exists** until plan 4 adds `ContextPolicy`. An unknown context id is logged and dropped, the same as a model id.
4. **The CLI's `run` picks through `DefaultModelPolicy` directly** (it never reads `config.json`'s models today: `models: {}`). It does not read `policies` either.
5. **`manifestTier` stays in the shell**: it reads the harness manifest, which is input to the decision, not the decision.

---

## File map

| File | Change |
|---|---|
| `packages/policies/package.json` | new: deps `engines`, `harness-sdk` |
| `packages/policies/src/model.ts` | new: `ModelPolicy`, `PickInput`, `DefaultModelPolicy`, moved functions |
| `packages/policies/src/registry.ts` | new: `MODEL_POLICY_IDS`, `CONTEXT_POLICY_IDS`, `modelPolicy(id)`, `isModelPolicyId`, `isContextPolicyId`, `DEFAULT_POLICY` |
| `packages/policies/src/index.ts` | new: re-exports |
| `packages/policies/test/model.test.ts` | new: `pick`/`fallback` compose the moved functions |
| `packages/policies/test/registry.test.ts` | new |
| `packages/shell/src/main/models.ts` | moved functions become re-exports from `@humanharness/policies` |
| `packages/shell/package.json`, `packages/cli/package.json` | add `@humanharness/policies` |
| `packages/shell/electron.vite.config.ts` | add `@humanharness/policies` to `workspacePackages` |
| `packages/protocol/src/views.ts` | `AppConfig.policies?: PolicyIds` |
| `packages/shell/src/main/config.ts` | `cleanPolicies` |
| `packages/shell/src/main/index.ts` | pick/fallback through the policy; task's policy ids |
| `packages/shell/src/main/task-manager.ts` | `deps.policies()`, `CurrentTask.policies`, pass on pick/fallback, usage meta |
| `packages/shell/src/main/task-store.ts` | save/clean `policies` |
| `packages/shell/src/main/usage-log.ts` | `modelPolicy`, `contextPolicy` in `UsageMeta`/`UsageRecord` |
| `packages/cli/src/run.ts` | `DefaultModelPolicy.pick`/`fallback` |
| `packages/protocol/test/boundary.test.ts` | §8's import arrows; `policies` purity; `transport.kind` only in `engines/src` |
| `docs/architecture/replaceable-parts.md`, `docs/architecture/engines.md` | part 3 |

New tests only in `packages/policies/test`, `packages/protocol/test/boundary.test.ts`, and new `it` blocks for the new behaviour (config cleaning, tasks.json round trip, usage fields, the task manager passing the ids). Existing `it` blocks do not change (D2).

---

### Task 1: `policies` package with `ModelPolicy` and `DefaultModelPolicy`

**Files:** create `packages/policies/{package.json,src/model.ts,src/index.ts,test/model.test.ts}`; modify `packages/shell/src/main/models.ts`, `packages/shell/package.json`, `packages/shell/electron.vite.config.ts`.

- [ ] **Step 1: Scaffold the package** the way `packages/protocol` is set up (same `package.json` fields, `"exports": { ".": "./src/index.ts" }`, deps `@humanharness/engines` and `@humanharness/harness-sdk` as `workspace:*`). Check whether the root `tsconfig`/vitest config lists packages explicitly (`git show 09500b19 --stat` shows what plan 2 touched); mirror it. Run `corepack pnpm install --offline` to link.

- [ ] **Step 2: Write the failing test** `packages/policies/test/model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DefaultModelPolicy } from "../src";

describe("DefaultModelPolicy", () => {
  it("is the default policy", () => expect(DefaultModelPolicy.id).toBe("default"));

  it("picks the task's profile: the manifest's tier through the core's table", () => {
    expect(DefaultModelPolicy.pick({ engine: "claude", action: "turn", manifestTier: "deep", models: {} })).toEqual({ engine: "claude", tier: "deep", model: "opus", effort: "high", cap: 400_000 });
  });

  it("a fixed tier skips the person's choice for the task", () => {
    const models = { tasks: { sidekick: "deep" as const } };
    expect(DefaultModelPolicy.pick({ engine: "claude", action: "sidekick", tier: "light", models })).toMatchObject({ tier: "light", model: "haiku" });
  });

  it("with an offer: falls back to a listed model, then fits the effort", () => {
    const p = DefaultModelPolicy.pick({ engine: "codex", models: { tiers: { codex: { standard: { model: "gpt-9", effort: "max", cap: 200_000 } } } }, offer: { models: [{ id: "gpt-5.5" }], efforts: ["low", "medium", "high"] } });
    expect(p).toEqual({ engine: "codex", tier: "standard", effort: "high", cap: 200_000, fallbackFrom: "gpt-9" });
  });

  it("falls back deep → standard → light → the engine's default, then null", () => {
    const deep = DefaultModelPolicy.pick({ engine: "claude", manifestTier: "deep", models: {} });
    const standard = DefaultModelPolicy.fallback(deep, {}, []);
    expect(standard).toMatchObject({ tier: "standard", model: "sonnet", fallbackFrom: "opus" });
    const light = DefaultModelPolicy.fallback(standard!, {}, ["opus"]);
    const last = DefaultModelPolicy.fallback(light!, {}, ["opus", "sonnet"]);
    expect(last?.model).toBeUndefined();
    expect(DefaultModelPolicy.fallback(last!, {}, ["opus", "sonnet", "haiku"])).toBeNull();
  });
});
```

Check the expected values against `packages/shell/test/models.test.ts` (same fixtures); adjust literals only if the core table says otherwise.

- [ ] **Step 3: Run** `corepack pnpm vitest run packages/policies` — expect failure (module missing).

- [ ] **Step 4: Implement `src/model.ts`.** Move, unchanged in body and doc comment, from `shell/src/main/models.ts`: `QUESTIONS`, `taskKey`, `tierSpec`, `resolveProfile`, `nextFallback`, `offered`, `firstOffered`, `fitEffort`. Then add:

```ts
/** What a pick needs (spec §6). `tier`: a fixed tier that skips the person's choice and the manifest (the Sidekick's own). */
export interface PickInput {
  engine: string;
  action?: string;
  manifestTier?: Tier;
  tier?: Tier;
  models: ModelsConfig;
  floor?: Tier;
  /** What the engine offers (`engineOffer`): a model off the list falls back before the turn, an effort is fitted. */
  offer?: { models: readonly ModelChoice[]; efforts: readonly Effort[] };
}

/** Decides which model profile a task runs on and what to retry with (spec §6). Decides only: no I/O. */
export interface ModelPolicy {
  id: string;
  pick(input: PickInput): ModelProfile;
  fallback(profile: ModelProfile, models: ModelsConfig, tried: readonly string[]): ModelProfile | null;
}

/** Today's rules: the person's choice, else the manifest's tier, the mode's floor, deep → standard → light → the engine's default. */
export const DefaultModelPolicy: ModelPolicy = {
  id: "default",
  pick(o) {
    const base = o.tier !== undefined ? { engine: o.engine, tier: o.tier, ...tierSpec(o.engine, o.tier, o.models) } : resolveProfile(o);
    if (!o.offer) return base;
    return fitEffort(firstOffered(base, o.models, o.offer.models), o.offer.efforts);
  },
  fallback: (profile, models, tried) => nextFallback(profile, models, tried),
};
```

`resolveProfile(o)` must get only its own fields (`engine`, `action`, `manifestTier`, `models`, `floor`); pass an object with those, not `o`, if tsc's excess-property rules complain. `src/index.ts`: `export * from "./model";`.

- [ ] **Step 5: `shell/src/main/models.ts`** removes the moved bodies and re-exports them: `export { QUESTIONS, firstOffered, fitEffort, nextFallback, offered, resolveProfile, taskKey, tierSpec } from "@humanharness/policies";`, and imports what `nearestTier` still needs (`tierSpec`). Add the dep to `shell/package.json` and `@humanharness/policies` to `workspacePackages` in `electron.vite.config.ts` (as plan 2 did for `protocol`).

- [ ] **Step 6: Run** `corepack pnpm vitest run packages/policies packages/shell/test/models.test.ts` and `corepack pnpm typecheck` — all pass; `models.test.ts` unchanged.

- [ ] **Step 7: Commit** `refactor(policies): model decisions move behind ModelPolicy in @humanharness/policies`.

### Task 2: Registry and `config.json` → `policies`

**Files:** create `packages/policies/src/registry.ts`, `packages/policies/test/registry.test.ts`; modify `packages/policies/src/index.ts`, `packages/protocol/src/views.ts`, `packages/shell/src/main/config.ts`, `packages/shell/test/config.test.ts` (new `it` blocks only; find the file that tests `cleanJobs`).

- [ ] **Step 1: Failing tests.** `registry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, DefaultModelPolicy, isContextPolicyId, isModelPolicyId, modelPolicy } from "../src";

describe("policy registry", () => {
  it("knows the default ids", () => {
    expect(DEFAULT_POLICY).toBe("default");
    expect(isModelPolicyId("default")).toBe(true);
    expect(isContextPolicyId("default")).toBe(true);
    expect(isModelPolicyId("eco")).toBe(false);
  });
  it("an absent or unknown id runs the default", () => {
    expect(modelPolicy(undefined)).toBe(DefaultModelPolicy);
    expect(modelPolicy("nope")).toBe(DefaultModelPolicy);
  });
});
```

In the config test: `cleanPolicies({ model: "default", context: "x" }, warn)` returns `undefined` (nothing non-default kept) and calls `warn` once with a line naming `"x"`; a second call with the same unknown id does not warn again; `cleanPolicies("junk")` is `undefined`.

- [ ] **Step 2: Implement.**

```ts
// registry.ts
import { DefaultModelPolicy, type ModelPolicy } from "./model";

/** The id every task runs when config.json names none (spec §8). */
export const DEFAULT_POLICY = "default";
const MODEL_POLICIES: ReadonlyMap<string, ModelPolicy> = new Map([[DefaultModelPolicy.id, DefaultModelPolicy]]);
/** Context policies arrive with plan 4; only the default exists until then. */
const CONTEXT_POLICY_IDS: ReadonlySet<string> = new Set([DEFAULT_POLICY]);

export const isModelPolicyId = (id: unknown): id is string => typeof id === "string" && MODEL_POLICIES.has(id);
export const isContextPolicyId = (id: unknown): id is string => typeof id === "string" && CONTEXT_POLICY_IDS.has(id);
/** The policy named `id`; an absent or unknown one runs the default. */
export const modelPolicy = (id: string | undefined): ModelPolicy => (id !== undefined && MODEL_POLICIES.get(id)) || DefaultModelPolicy;
```

`protocol/src/views.ts`: `export interface PolicyIds { model?: string; context?: string }` and `AppConfig.policies?: PolicyIds` with the comment "Which model and context policies run (replaceable-parts spec §8). No UI (D4). Cleaned when read; absent: the defaults."

`shell/src/main/config.ts`:

```ts
const warnedPolicies = new Set<string>();
/**
 * `config.json` → `policies` (replaceable-parts §8): a known non-default id is kept; an unknown one runs the default
 * and is logged once per id. Undefined when nothing but defaults remains.
 */
export function cleanPolicies(v: unknown, warn: (line: string) => void = console.warn): PolicyIds | undefined
```

Use whatever logger the neighbouring config cleaners use if they log; otherwise `console.warn` as the default. Wire it where `cleanJobs`/`cleanParallel` are applied when config is read (find the reader in `config.ts`).

- [ ] **Step 3: Run** the two test files and `corepack pnpm typecheck`; all pass.
- [ ] **Step 4: Commit** `feat(policies): config.json names the model and context policies; unknown ids run the default`.

### Task 3: The shell picks and falls back only through the policy

**Files:** modify `packages/shell/src/main/index.ts`, `packages/cli/src/run.ts`, `packages/cli/package.json`.

- [ ] **Step 1:** In `index.ts`, every pick goes through `modelPolicy(id).pick({... , offer })` and every fallback through `.fallback(...)`. The sites (search `resolveProfile(`, `firstOffered(`, `nextFallback(`, `tierSpec(engine.id`):
  - the task flow's `profileFor` / `fallbackFor` (around line 1476);
  - material jobs (`materialStageKey`, around 1583);
  - translation (`TRANSLATE_KEY`, around 1673);
  - the Sidekick's `profile` (around 3292), using `tier` (deviation 1).
  
  `supportedEffort(profile, saved)` today does `fitEffort(p, engineOffer(engine, saved).efforts)`; with `offer: engineOffer(engine, saved)` passed to `pick`, the pick already fits it. Keep `supportedEffort` for `fallbackFor`'s result and `fitProfile` (they pass a profile, not a pick). Keep the result identical: build `offer` only when the engine is known (as `supportedEffort` does: an unknown engine leaves the profile as it is, and `firstOffered` used `saved.models`).
  
  Which policy: in this task, `modelPolicy((await config.load()).policies?.model)`, read through `cleanPolicies`. Task 4 replaces it with the task's own id for tasks.

  After this step `index.ts` imports none of `resolveProfile`, `firstOffered`, `nextFallback`, `fitEffort` from `./models` (the settings view's `tierSpec` table at ~552 is display, not a decision: it may stay).

- [ ] **Step 2:** `cli/src/run.ts`: `profileFor` → `DefaultModelPolicy.pick({...same fields})`, `fallbackFor` → `DefaultModelPolicy.fallback(profile, {}, tried)`. Import from `@humanharness/policies`; add the dep. Leave `@humanharness/shell/tasks`'s re-exports in place (other callers).

- [ ] **Step 3: Run** `corepack pnpm typecheck` and `corepack pnpm test` (expect the known cli load timeouts only; rerun those files alone). No existing test changes.
- [ ] **Step 4: Commit** `refactor(shell): pick and fall back through the model policy`.

### Task 4: Policy ids fixed per task, recorded in `usage.jsonl`

**Files:** modify `packages/shell/src/main/task-manager.ts`, `task-store.ts`, `usage-log.ts`, `index.ts`; tests: new `it` blocks in the existing task-manager, task-store and usage-log test files.

- [ ] **Step 1: Failing tests.**
  - task-store: the stored ids are cleaned by shape, not by registry (tasks.json is agent-writable; `modelPolicy()` resolves an unknown id to the default at pick time): a string matching `/^[a-z][a-z0-9-]{0,31}$/` is kept, anything else dropped. `{ model: "eco" }` round-trips; `{ model: "Bad!", context: 3 }` loads as no `policies`; a task without `policies` loads without the key.
  - task-manager: with `deps.policies = async () => ({ model: "eco" })`, starting a task calls `profileFor(action, undefined, undefined, { model: "eco" })`, the saved task has `policies: { model: "eco" }`, a later fallback calls `fallbackFor(profile, tried, { model: "eco" })`, and the turn's usage record has `modelPolicy: "eco"`. Without `deps.policies` (or when it returns `{}`), calls keep their current arguments exactly and nothing new is saved.
  - usage-log: `usageRecord(entry, "claude", { modelPolicy: "eco", contextPolicy: "lean" })` carries both fields; without them, neither key exists.

- [ ] **Step 2: Implement.**
  - `TaskManagerDeps.policies?(): Promise<PolicyIds>` — the ids a new task starts with.
  - `profileFor?(action, floor?, tier?, policies?: PolicyIds)` and `fallbackFor?(profile, tried, policies?: PolicyIds)`: the extra argument is passed **only when the task has non-default ids** (the existing tests compare call arguments). For a defined `policies` with undefined `floor`/`tier`, pass `undefined` positionally.
  - At start (next to the `profile` resolution, ~1776): `const policies = await this.d.policies?.()`; keep it on `CurrentTask.policies` only if non-empty; store it in `tasks.json` (`task-store.ts`: save and clean as above). A resumed/restored task reuses its stored ids; a task without them runs the defaults (§8).
  - `UsageMeta`/`UsageRecord`: `modelPolicy?: string; contextPolicy?: string`, written in `metaFields` only when present; the task manager adds them from `current.policies` where it builds the turn's meta (~1898).
  - `index.ts`: `policies: async () => cleanPolicies((await config.load()).policies) ?? {}`; `profileFor`/`fallbackFor` use `modelPolicy(policies?.model)`.

- [ ] **Step 3: Run** the touched test files, `corepack pnpm typecheck`, full `corepack pnpm test`.
- [ ] **Step 4: Commit** `feat(shell): a task keeps its policy ids to the end; usage.jsonl records them`.

### Task 5: Import-boundary test for §8's arrows

**Files:** modify `packages/protocol/test/boundary.test.ts` (it already collects imports, including side-effect, dynamic and `require`).

- [ ] **Step 1: Add the arrows** as data, for the packages in §3 (other packages, e.g. `cli`, `e2e`, `material`, `blocks`, are not constrained here):

```ts
// §8: who may import whom among the core packages (services: workspace, material, blocks, i18n).
const SERVICES = ["workspace", "material", "blocks", "i18n"];
const ALLOWED: Record<string, readonly string[] | "all-but-ui"> = {
  "harness-sdk": [],
  engines: ["harness-sdk"],
  policies: ["engines", "harness-sdk"],
  runtime: ["engines", "harness-sdk", ...SERVICES],
  protocol: ["harness-sdk", "engines", "workspace", "i18n"], // plan 2 deviation 1
  ui: ["protocol", "harness-sdk", "i18n"], // plan 2 deviation 3
  shell: "all-but-ui", // shell/src/renderer may import ui (plan 2 deviation 2)
};
```

Run it first and print the violations. Existing violations are **not** fixed in this plan (D2): each one becomes a named exception in the test with a one-line reason, and is listed for Marco. Keep plan 2's existing assertions.

- [ ] **Step 2:** `policies/src` imports no `node:*`, `child_process`, `fs`, and nothing from `@humanharness/engines` other than the package root (no transport modules). No file outside `engines/src` contains `transport.kind` or `.kind === "claude-cli"` / `"acp"` on a transport (grep the sources, comments stripped as `channels.test.ts` does).
- [ ] **Step 3:** Prove each new assertion fails: temporarily add a forbidden import, see red, revert. Note it in the commit body.
- [ ] **Step 4: Commit** `test(protocol): the import-boundary test enforces the package arrows and policies' purity`.

### Task 6: Docs

- [ ] `docs/architecture/replaceable-parts.md`: "Part 3 — ModelPolicy (done)": where the policy lives, how config picks it, fixed per task, the usage fields, the deviations above.
- [ ] `docs/architecture/engines.md` (and `context.md`/`turn.md` where they name `resolveProfile`/`nextFallback` in the shell): new homes.
- [ ] `grep -rn "resolveProfile\|nextFallback\|firstOffered" docs/` and fix stale paths.
- [ ] Commit `docs: ModelPolicy lives in @humanharness/policies`.

### Final verification

- `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm app:build`, `corepack pnpm e2e`.
- D2 audit: `git diff origin/master...HEAD -- '*.test.ts' '*.spec.ts'` shows only new `it` blocks, new test files and import lines.
