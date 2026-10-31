# ContextPolicy Implementation Plan (replaceable parts, plan 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The context decisions leave `task-manager.ts` for a `ContextPolicy` in `@humanharness/policies`. The policy decides three things: what a new session starts with and how much of each part, when to checkpoint, and how work continues. Detecting a compaction becomes the engine adapter's job. A test-registered policy that checkpoints at 50% works with no shell edit.

**Architecture:**
- **`policies/src/context.ts`** (new): `ContextPolicy`, `TaskStart`, `StartPlan`, `TurnState`, `DefaultContextPolicy`. The default's parameters are today's constants: `CHECKPOINT_AT` 0.8 and `APP_INDEX_TOKENS` 500, plus the manifest's material `budget.indexTokens`, which is passed through. Building each part stays in `workspace`, `material` and the shell's hooks (D3); the task manager runs the plan.
- **`policies/src/registry.ts`** gains `contextPolicy(id)` and `registerModelPolicy` / `registerContextPolicy`. Each register call returns an unregister function, for variants and tests. `isModelPolicyId` / `isContextPolicyId` read the live maps.
- **The task manager asks the task's context policy** (its id fixed per task since plan 3) at each decision point: `start` in `contextFor`, `beforeFollowUp` where `needsCheckpoint` is called today, and `continuity` where a task ends, a folder moves or a task resumes.
- **Compaction:** the Claude adapter emits `{ type: "compaction" }` itself when the context falls by more than half; the shell's `COMPACTED_DROP` heuristic goes.

**Tech Stack:** TypeScript (tsc 7), pnpm via corepack, Vitest, Electron 44 + electron-vite 5, Playwright e2e.

Spec: `docs/superpowers/specs/2026-10-29-replaceable-parts-design.md` §7, §8, D2, D3, D7. "§" and "D" numbers below refer to it. Plan 3 (`docs/superpowers/plans/2026-10-30-model-policy.md`) is the base: per-task ids live in `CurrentTask.policies`, and `usage.jsonl` gets `modelPolicy`/`contextPolicy`.

---

## Deviations from the spec (decided while planning; tell Marco)

1. **A registry with `register*` functions**, not only a fixed map. §7.3's "a test registers a policy" needs one. A registered policy is selectable from `config.json` like a built-in one. Only tests use it today.
2. **`StartPlan` also orders the scope's instructions, the pre-step results and the linked folders**, not only the five parts §7.1 lists. All three are parts of today's first message, and leaving them out would keep ordering decisions in the shell.
3. **`APP_INDEX_TOKENS` moves out of `notes-index.ts` too.** `notesIndexParts` takes the budget as an argument, and job runs' first message passes `DefaultContextPolicy`'s value. Jobs have no task policy (plan 3 deviation 6), and they keep the same value.
4. **`INDEX_NOTES_MAX`, `READS_MAX`, `START_ITEMS_MAX` stay in `context-record.ts`.** They cap what the context panel records, and they don't decide what the engine gets.
5. **The Claude compaction heuristic is seeded across transport restarts.** Today the shell compares against the `used` saved in `tasks.json`, so a compaction is still caught after the transport sleeps or the app restarts. The Claude adapter gets the last known `used` when it resumes a session (Task 4 decides the plumbing; see its step 1). If seeding needs more than passing one number into the transport's options, stop and report.
6. **Plan 3's known limit is fixed here.** `usage.jsonl` records the id of the policy that actually ran (`modelPolicy(id).id`, `contextPolicy(id).id`), and only when it is not the default. An unregistered id in `tasks.json` therefore logs nothing. Plan 3's tests that use `"eco"` / `"lean-2"` register those ids in a `beforeEach`; their assertions don't change.

---

### Task 1: `ContextPolicy`, `DefaultContextPolicy`, registration

**Files:** create `packages/policies/src/context.ts`, `packages/policies/test/context.test.ts`; modify `src/registry.ts`, `src/index.ts`, `test/registry.test.ts` (new `it` blocks).

- [ ] **Step 1: Failing tests.**
  - `DefaultContextPolicy.id === "default"`.
  - `start({ scoped: false, materialIndexTokens: 600 })` returns the parts in today's order, `["instructions", "notes", "app-notes", "data", "prepared", "pins", "material", "linked"]`, with `app-notes` budget 500 and `material` budget 600 (the input's).
  - `beforeFollowUp({ used: 79, cap: 100, checkpointed: false })` is `"go"`, `used: 80` is `"checkpoint"`, and `checkpointed: true` gives `"go"` at any `used`. With no `cap` or no `used`, the answer is `"go"`: this mirrors `needsCheckpoint`, which needs a profile and a context.
  - `continuity("task-end" | "move" | "resume")` is `"new-session-from-notes"`.
  - Registry: `registerContextPolicy({ id: "half", ... })` makes `isContextPolicyId("half")` true and `contextPolicy("half")` that policy, and unregistering undoes both. `contextPolicy("nope")` is the default. Registering an id that already exists throws. Do the same for `registerModelPolicy`.
- [ ] **Step 2: Implement.**

```ts
/** What a new session's first message holds after the brief (spec §7.1), in order. */
export type StartPart = "instructions" | "notes" | "app-notes" | "data" | "prepared" | "pins" | "material" | "linked";
export interface TaskStart {
  scoped: boolean;
  action?: string;
  /** The manifest's material `budget.indexTokens` (harness-sdk default 600); absent without material. */
  materialIndexTokens?: number;
}
export interface StartPlan { parts: { part: StartPart; budgetTokens?: number }[] }
export interface TurnState { used?: number; cap?: number; checkpointed: boolean }
export interface ContextPolicy {
  id: string;
  start(task: TaskStart): StartPlan;
  beforeFollowUp(state: TurnState): "go" | "checkpoint";
  continuity(event: "task-end" | "move" | "resume"): "new-session-from-notes";
}
/** Share of the task's cap at which the checkpoint runs (spec D4 of the flow spec). */
export const CHECKPOINT_AT = 0.8;
/** How much the app-wide notes index may take in a scope's session (spec §3.3 "trimmed"). */
export const APP_INDEX_TOKENS = 500;
export const DefaultContextPolicy: ContextPolicy = { ... };
```

  Keep the doc comments that the constants have today. Export `CHECKPOINT_AT` and `APP_INDEX_TOKENS` from `policies`, and have `task-manager.ts` and `notes-index.ts` re-export them under the same names so their importers keep working (D2). The registry keeps two maps; `register*` returns `() => void`.
- [ ] **Step 3:** Run `corepack pnpm vitest run packages/policies` and `corepack pnpm typecheck`.
- [ ] **Step 4: Commit** `feat(policies): ContextPolicy with today's rules as DefaultContextPolicy; policies can be registered`.

### Task 2: The checkpoint asks the task's context policy

**Files:** `packages/shell/src/main/task-manager.ts`; new `it` blocks in `packages/shell/test/task-manager.test.ts`.

- [ ] **Step 1: Failing test, §7.3's proof.** Register `{ id: "half", ...DefaultContextPolicy, beforeFollowUp: (s) => (s.used !== undefined && s.cap !== undefined && !s.checkpointed && s.used >= 0.5 * s.cap ? "checkpoint" : "go") }` and unregister it in `afterEach`. A task started with `deps.policies = async () => ({ context: "half" })`, whose context reaches 50% of the cap, runs the checkpoint turn before the next follow-up. Without the policy, the same setup runs no checkpoint at 50%.
- [ ] **Step 2: Implement.**
  - `private contextPolicyOf(c: CurrentTask) { return contextPolicy(c.policies?.context); }`.
  - Every `needsCheckpoint(x)` call (5 today; grep for them) becomes `this.contextPolicyOf(x).beforeFollowUp(turnState(x)) === "checkpoint"`.
  - `turnState(c)` gives `{ used: c.context?.used, cap: c.profile?.cap, checkpointed: c.checkpointed === true }`.
  - Keep `export function needsCheckpoint(c)` as a wrapper over the default policy, so importers and tests still work. `CHECKPOINT_AT` is re-exported from `policies`.
- [ ] **Step 3:** Run the task-manager tests and typecheck. Existing tests unchanged.
- [ ] **Step 4: Commit** `refactor(shell): the checkpoint is the task's context policy's call`.

### Task 3: A new session's start follows the policy's plan

**Files:** `task-manager.ts` (`contextFor`, `withScopeInstructions` and their callers), `notes-index.ts`, `packages/shell/src/main/index.ts` (the `materialContext` hook and the job runs' first message); new `it` blocks.

- [ ] **Step 1: Failing tests.**
  - A registered policy whose `start` returns `[notes, material]` only gives a first message with only the notes index and the material, in that order. The start items list only those.
  - A policy that gives `app-notes` a 100-token budget trims the app-wide index to it.
  - With the default policy, the first message and the items are byte-identical to today. The existing tests cover this, so they must stay green.
- [ ] **Step 2: Implement.**
  - `contextFor` and the scope-instructions step build the parts the plan names, in the plan's order.
  - `notesIndexParts(notes, scoped, scope, excluded, appBudgetTokens = APP_INDEX_TOKENS)`.
  - `materialContext(scope, budgetTokens?)`: the hook uses the plan's budget, falling back to the manifest's.
  - The task manager gets `materialIndexTokens` the way `index.ts` reads it today (`m.budget.indexTokens`). Pass it through a dep, or put it in `TaskStart` from the hook's side; choose the smaller change.
  - Where the resume or restart path also builds a first message (`resumeMessageFor`, ~1657, and the restart at ~1689), use the same plan.
- [ ] **Step 3:** Run the shell tests and typecheck.
- [ ] **Step 4: Commit** `refactor(shell): a new session's first message follows the context policy's start plan`.

### Task 4: Compaction detection moves into the Claude adapter

**Files:** `packages/engines/src/claude/transport.ts` (and its options), `task-manager.ts` (`track`), engine tests; new `it` blocks.

- [ ] **Step 1: Investigate and decide the seed (deviation 5).**
  - Read how a task's turns reach a Claude transport: the runtime slot, `TransportOptions`, resume.
  - Find where a transport is created for a task session that is resumed after sleep or restart.
  - The shell knows the last `used` (`CurrentTask.context.used`). Pass it as a transport option, e.g. `lastContextUsed`. The adapter compares each turn's `context.used` with the previous one, seeded from that option, and emits `{ type: "compaction" }` before the `context` event when it falls below half.
  - If this takes more than adding one option through existing plumbing, stop and report NEEDS_CONTEXT with what you found.
- [ ] **Step 2: Failing tests.**
  - Claude transport: in one session, `used` 100k then 40k emits `compaction`; 100k then 60k doesn't. With the seed 100k, a first turn at 40k emits it.
  - ACP: unchanged.
  - Task manager: `track` no longer infers a compaction from a drop. A drop without a `compaction` event records no compaction. That is a new test, and existing tests that feed a drop through a fake transport must still pass. If they rely on the shell heuristic, report it: those tests would change, which D2 forbids, so the plan needs a decision.
- [ ] **Step 3: Implement.** Remove `COMPACTED_DROP` and the drop check from `track`.
- [ ] **Step 4: Commit** `refactor(engines): the Claude adapter reports compactions; the shell only reacts`.

### Task 5: `continuity`, usage labels, the "no thresholds" check

**Files:** `task-manager.ts`, `turn-controller.ts`, `index.ts` (`recordCompaction`), `packages/protocol/test/boundary.test.ts`, plan 3's test files (setup lines only).

- [ ] **Step 1: `continuity`.** Where a task ends and the next starts fresh, where a folder move closes the session, and where a stored task resumes, ask `this.contextPolicyOf(c).continuity(event)`. Handle the union exhaustively (`switch` with a `never` check); its only value runs today's code. Find the three sites and name them in the commit body.
- [ ] **Step 2: Usage labels (deviation 6).**
  - Usage lines carry `modelPolicy: modelPolicy(id).id` and `contextPolicy: contextPolicy(id).id`, only when they are not `"default"`.
  - Plan 3's tests that expect `"eco"` / `"lean-2"` in usage lines register those ids in `beforeEach` and unregister them in `afterEach`.
  - New test: an unregistered stored id logs no field.
- [ ] **Step 3: Boundary check.** Add to `boundary.test.ts`: `task-manager.ts`, with comments stripped, defines no `CHECKPOINT_AT`, `COMPACTED_DROP` or `APP_INDEX_TOKENS` value. Re-exports are allowed. It also has no numeric literal compared with `cap`. Prove it fails by adding the forbidden code temporarily.
- [ ] **Step 4:** Run the full `corepack pnpm test` and typecheck. Commit `feat(shell): continuity asks the policy; usage records the policies that ran`.

### Task 6: Docs

- [ ] `docs/architecture/replaceable-parts.md`: add "Part 4 — ContextPolicy (done)" with the deviations.
- [ ] `docs/architecture/context.md`, `turn.md`, `engines.md`: the new homes of the checkpoint rule, the start plan and compaction detection.
- [ ] Commit `docs: ContextPolicy lives in @humanharness/policies`.

### Final verification

- Run `corepack pnpm typecheck`, `test`, `app:build` and `e2e`.
- D2 audit: test diffs against `feat/model-policy` contain only new `it` blocks, import lines, and plan 3's register/unregister setup.
