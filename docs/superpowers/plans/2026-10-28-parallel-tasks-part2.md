# Parallel tasks and jobs, part 2 (parallel tasks and the inbox) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship slices 3 and 4 of the parallel-tasks spec (§13). In a harness that declares `parallel`:
- the person keeps several tasks open at once, each with its own chat and engine session;
- up to the cap of them run turns at the same time, and the rest wait in a visible FIFO queue;
- a core inbox (and `client.tasks`) shows what waits for the person;
- undo touches only a task's own files.

A harness without `parallel` is byte for byte today's app.

**Architecture.**

*Board mode.* The shell picks a mode once, when it loads the harness: `isConcurrent(harness)` → **board**, otherwise **plain**.
- **Plain** is today's code path, untouched: `createRuntime`, one `TaskManager` and one `TurnController`.
- **Board** builds:
  - one `HarnessWorkspace` (part 1);
  - a `TaskBoard` (`packages/shell/src/main/task-board.ts`) that holds one **lane** per open task.

*Lanes.* A lane is today's single-task machinery, reused unchanged:
- a `TaskManager`;
- its own `TurnController`;
- a `SessionSlot` keyed by the task id;
- a `LaneStore` adapter. The adapter shows the `TaskManager` a `TasksFile` whose `current` is that lane's task. On save it writes the change back into the real file's `lanes[]` with a three-way merge of the shared fields (`actions`, `scopes`, `open`, `engine`).

`TaskManager` is therefore unchanged: its states, checkpoint, phases, modes, time box and closing turn stay per task, as spec §6 asks. Plan 17 changes `TaskManager` internals, and this design keeps the merge clean.

*Board behaviour.*
- The board starts each new task in a fresh **idle lane**: a lane with no task, which stands for the start view. Its `TaskManager` is pre-seeded with the id the task will get (`newId`).
- Starting never closes another lane.
- The board routes the window's IPC calls to the **focused** lane.
- Only the focused lane's events reach the window. The others' are buffered from their last user message, so focusing a lane mid-turn replays its live turn.

*Gate.* Each lane's `turns` dependency goes through `gatedTurns(lane, gate, controller)`. The `TurnGate` (`turn-gate.ts`):
- counts running turns per cap (`tasks`, and `jobs` for part 3);
- queues the rest FIFO, so a queued turn makes its lane's summary `queued`;
- pauses both queues on `out-of-quota` until the engine's reset time or the person's Resume;
- holds new turns for up to 10 s while an `AGENTS.md` rewrite waits for a gap (spec §10).

*Chats.* Chats move to `.harness/chats/<scope>/<task id>.jsonl` (spec §6), with a one-time migration.

*Inbox.* The inbox has four sections. Its "Jobs" section stays empty until part 3.
- It reads `client.tasks.list()` (`TaskSummary[]`).
- It sits in a toolbar button with a waiting count.
- A manifest `inbox: false` hides it; the API stays.
- The Dock badge shows the waiting count.
- An optional OS notification (Settings › General, off by default) fires when a task starts waiting.
- Waiting tasks also raise items in the shared `AttentionStore` (origin `{ kind: "task" }`), so the plugins inbox and the task inbox count the same thing.

**Tech Stack:** TypeScript, Electron 44 (main, preload), React 19, Vitest + happy-dom, Playwright e2e with fake-claude, zod 4, pnpm via corepack.

**Spec:** `docs/superpowers/specs/2026-10-27-parallel-tasks-and-jobs-design.md`: §5.3, §6, §7, §9, §10, §11, §13 slices 3–4. Builds on part 1 (`docs/superpowers/plans/2026-10-28-parallel-tasks-part1.md`): `createWorkspace`, `SessionSlot`, `TurnAttribution`, `edits`, `History.commitPaths/restorePaths/tasks({ ownCommits })`, `ownedPathsOf`, `sharedPathsOf`, `laterTasksSharing`, `isConcurrent`, `parallelCaps`. **Branch:** `feat/parallel-tasks` (continues part 1).

---

## Conventions

Same as part 1: worktree `/Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-sidekick`, written in full where `<worktree>` appears; `git -C <worktree> …`; `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm vitest run <path>`, `corepack pnpm app:build` (any shell, preload or UI change), `corepack pnpm e2e` (Tasks 16–17). No install of any kind. Never push, never a bare `git stash`. Commit trailer exactly:

```
Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv
```

**Hot files** (small, additive edits only):
- `packages/shell/src/main/index.ts`. Board wiring lives in a new `board-host.ts`; `index.ts` only branches on the mode where it builds `runtime`, `turns` and `tasks`, and registers the new IPC channels through `handle()`.
- `packages/ui/src/client.ts`, `packages/shell/src/preload/index.ts`, `packages/ui/test/fake-client.ts`: new optional fields and namespaces.
- `packages/ui/src/ChatView.tsx`, `HarnessApp.tsx`, `SettingsSheet.tsx`: one prop, one key change and one section each.
- `packages/shell/src/main/task-store.ts`, `chat-log.ts`, `packages/workspace/src/layout.ts`: new optional fields and functions.
- `packages/i18n/src/locales/en.json`: **only** a new top-level `"parallel"` block. Never prettier an existing file.

Every new IPC channel goes through `handle()`: `test/ipc-surface.test.ts` pins this.

**Compliance:** as in part 1. The e2e uses fake-claude only.

## D0 is a hard rule

A harness without `parallel` (and without `jobs`, part 3) behaves byte for byte as today. The shell takes the **plain** path, and no part-2 code runs:
- no `TaskBoard`, gate, lane store, per-task chat path or migration;
- no `lanes`/`focus` keys in tasks.json;
- no inbox button, no Dock badge;
- no new `AppState` field;
- no new keys in config.json unless the person sets them (and Settings shows the parallel section only in board mode).

| D0 item | Test |
|---|---|
| Mode is plain without `parallel` | `board-host.test.ts`: `hostMode(harness)` is `"plain"` for the demo and notes fixtures (Task 9) |
| tasks.json unchanged | `task-store.test.ts`: a file without `lanes` round-trips to the same bytes; `cleanLanes` absent → no key (Task 2) |
| Chats unchanged | `chat-log.test.ts`: `new ChatLog(base, engine, scope)` without a task writes `chats/<scope>.jsonl` exactly as before (Task 5) |
| No migration without parallel | `chat-migration.test.ts`: never called on the plain path; `board-host.test.ts` pins it (Tasks 5, 9) |
| AppState unchanged | `app-state` test: `parallel` absent for a harness without it (Task 1) |
| UI unchanged | `ui/test/inbox.test.tsx`: no inbox button and no task strip without `state.parallel`; ChatView key unchanged (Tasks 13–14) |
| Dock badge never set | `task-attention.test.ts`: the badge function is never called on the plain path (Task 11) |
| Commits and prompts | part 1's `runtime-d0.test.ts` and the e2e golden in `history.spec.ts` stay green (Task 16 runs the e2e) |
| A `parallel` harness at cap 1 commits as today | `parallel.spec.ts` e2e: two tasks one after another at cap 1, commit subjects equal the plain run's shape (Task 16; spec §5.4) |

## Threat model (part 2)

| # | Boundary | What enforces it | Test |
|---|---|---|---|
| P1 | The window can only focus, cancel-queued or open a task by an id main knows | `board.focus(id)`, `gate.drop(id)` look ids up in the board's lanes with `Map.get`; unknown ids → refused; ids are strings ≤ 200 | `task-board.test.ts`, `ipc` test (Tasks 6, 9) |
| P2 | Undo of a task never restores another running task's paths | `restoreTaskByPaths` refuses while any running lane's window touched one of the paths (`ledger.running()` edits ∪ `changedSince`), names the file | `restore-paths.test.ts` (Task 9) |
| P3 | A data request is attributed to the lane whose socket it came on | `data(request, slot)` → `board.runningTaskOf(slot.key)`; never a task id from the request | `board-host.test.ts` (Task 9) |
| P4 | The Dock badge and OS notifications carry no chat content | they show a count and the task's label (action label or the first 60 chars of a free question, as the history already does) only | `task-attention.test.ts` (Task 11) |
| P5 | Task attention items can't be forged by the agent editing attention.json | the store's existing HMAC tag; `known` for `task` origins = an open lane id | `task-attention.test.ts` (Task 11) |
| P6 | Migration never loses a chat | the old file is archived (renamed) after the copy succeeded; a failure leaves it in place | `chat-migration.test.ts` (Task 5) |

## Decisions this plan takes where the spec leaves room

1. **`inbox: false` is a top-level manifest key.** The spec writes `ui: { inbox: false }`, but `ui` is already a string (a custom UI path, `manifestSchema.ui`). Default: `inbox?: boolean`, true when absent.
2. **`parallel` declared with `tasks: 1` still uses the board.** Several tasks stay open, but one turn runs at a time, so there is never an overlap and every commit equals today's (spec §5.4). A harness that wants today's app declares nothing.
3. **Lanes reuse `TaskManager` unchanged** via `LaneStore` (see Architecture). The task id is chosen by the board (`newId`), so lane key = task id = slot key.
4. **An idle lane is the start view.** `focus: null` in tasks.json means the start view: actions and the question box. "New task" in the inbox focuses it.
5. **`switchScope` never closes lanes in board mode.** It sets `open` and focuses that scope's newest open lane, or the idle lane.
6. **Only the focused lane talks to the window.** The others buffer events from their last user line, at most 2,000 events per lane, oldest dropped. Focusing replays them through `ChatLoad.live` and a new `resume` reducer action.
7. **A queued message can be cancelled, not edited in place.** Spec §7 says "edited or cancelled". Default: "Edit" = cancel + put the text back in the box (`client.tasks.cancelQueued(id)` returns the text). Same outcome, no second code path.
8. **Per-task chat migration** (spec §6): on the first board start, each scope's `<scope>.jsonl`:
   - is **copied** to `<scope>/<last task id>.jsonl` when that scope's last task (tasks.json `current`) is still open;
   - is then archived with `ChatLog.archive("parallel")`.

   An archived chat has no viewer today (open question); it stays a readable JSONL file under `chats/archive/`.
9. **The `tasks` cap counts quiet turns too** (spec §7): checkpoint, phase brief, closing. All of a lane's turns go through `gatedTurns`.
10. **Waiting → attention item.** A lane entering `waiting` raises `{ kind: "task", id }` with key `"waiting"`, severity `"action"`, title = the task's label and target `{ panel: "task", focus: id }`. Leaving `waiting` resolves it. The store is the same per-base `AttentionStore` plugins use, now built by `attention-stores.ts` and shared. Its `known` accepts plugin origins (as before) and task origins of open lanes.
11. **OS notifications:** `config.notifyWaiting`, off by default (Marco, spec open question 2). The notification shows the task label only, and is shown when the window isn't focused.
12. **Undo in board mode** (spec §5.3) restores by paths: the task's owned paths, plus its shared ones after a confirm. It uses `History.restorePaths(paths, group.start, RESTORE_TASK, { task })`, where `group.start` is the task's start commit. "Go back here" (`hh:restore`) stays a whole-folder restore and is **refused** while any lane runs a turn. The existing `RestoreGuard` already refuses while busy; `busy()` becomes "any lane busy".
13. **The stale plugin runtime** (`plugins.takeRuntimeStale()`) closes the workspace only when no lane is open. Until then the old catalogue stays (logged).
14. **Engine switch** (spec §10) = `board.interruptAll()`: every lane `interrupt()`s (ends unfinished, as today), both queues are dropped, the workspace closes.
15. **Moving the folder** (spec §10): the queues pause; `board.checkpointAllBeforeMove()` runs each waiting lane's `checkpointBeforeMove()` one at a time; then every lane is marked `resume`, as today's single task is.
16. **Quit:** every lane is cancelled. At the next start, every lane left open ends unfinished. The existing `TaskStore.interrupted` logic is applied to each lane by `cleanLanes`.

## File structure

| File | Change | Responsibility |
|---|---|---|
| `packages/harness-sdk/src/index.ts` | Modify | `inbox?: boolean` |
| `packages/ui/src/client.ts` | Modify | `ParallelInfo`, `AppState.parallel?`, `AppConfig.parallel?`/`notifyWaiting?`, `TaskSummary`, `client.tasks`, `ChatLoad.live?` |
| `packages/shell/src/main/config.ts` | Modify | clean `parallel` and `notifyWaiting` on load |
| `packages/shell/src/main/parallel-config.ts` | Create | `effectiveCaps`, `parallelInfo` |
| `packages/shell/src/main/task-store.ts` | Modify | `lanes?`, `focus?`, `tokens?`, `conflict?`, `cleanLanes` |
| `packages/shell/src/main/lane-store.ts` | Create | `LaneStore` adapter with three-way merge |
| `packages/shell/src/main/turn-gate.ts` | Create | caps, FIFO, pause, hold |
| `packages/shell/src/main/gated-turns.ts` | Create | a lane's `turns` through the gate |
| `packages/workspace/src/layout.ts` | Modify | `taskChatFile` |
| `packages/shell/src/main/chat-log.ts` | Modify | optional `task` |
| `packages/shell/src/main/chat-migration.ts` | Create | one-time move to per-task chats |
| `packages/shell/src/main/task-board.ts` | Create | lanes, focus, routing, summaries |
| `packages/shell/src/main/live-buffer.ts` | Create | per-lane event buffer |
| `packages/shell/src/main/board-host.ts` | Create | mode, workspace, lanes' deps, IPC handlers for board mode |
| `packages/shell/src/main/restore-paths.ts` | Create | undo by paths and its refusal |
| `packages/shell/src/main/attention-stores.ts` | Create | one AttentionStore per base, shared |
| `packages/shell/src/main/task-attention.ts` | Create | waiting → attention, Dock badge, OS notification |
| `packages/shell/src/main/plugins.ts` | Modify | optional `attentionStoreFor` dep |
| `packages/shell/src/main/index.ts` | Modify | mode branch, IPC channels |
| `packages/shell/src/preload/index.ts` | Modify | `tasks` namespace |
| `packages/ui/src/state.ts` | Modify | `resume` action |
| `packages/ui/src/parallel/Inbox.tsx`, `TaskStrip.tsx`, `useTasks.ts` | Create | inbox panel, button, focused-task strip |
| `packages/ui/src/ChatView.tsx`, `HarnessApp.tsx`, `SettingsSheet.tsx` | Modify | live replay, key, General section |
| `packages/ui/test/fake-client.ts` | Modify | `tasks` namespace |
| `packages/fake-agent/fixtures/parallel-harness/` | Create | e2e fixture |
| `packages/e2e/tests/parallel.spec.ts` | Create | e2e |
| `packages/i18n/src/locales/en.json` | Modify | `"parallel"` block |
| docs | Modify | `docs/architecture/tasks.md` (or the file that documents TaskManager), `history.md`, `ui.md`; `packages/cli/guide/new-harness.md`; `packages/cli/template/HARNESS.md` |

## Overlaps with other in-flight plans

- **Plan 17 (context panel)** changes `TaskManager.contextFor`, `begin`, `runTurn`, `task-store.ts` (a context list per task) and adds TurnKind `"context-add"`.
  - This part changes none of `TaskManager`'s logic. Its `task-store.ts` edits are new optional fields next to plan 17's.
  - Per-task context lists work per lane for free, because each lane has its own `TaskManager`.
- **Plan 16 (file timeline)** reads `History` commits. Its timeline will show `Shared:` commits like any other commit; its "undo this file" must call `restorePaths` / `restoreFile`, which are compatible (part 1).
- **Plans 16 and 17 both add panels to the side area.** The inbox is a toolbar button + popover, not a side panel, so the side layout is untouched.

## Open questions (each with the default this plan takes)

1. `ui: { inbox: false }` → top-level `inbox: false` (Decision 1).
2. `parallel` at 1 → board, one running turn (Decision 2).
3. Editing a queued message = cancel + refill (Decision 7).
4. Archived chats after migration have no viewer (Decision 8). *Default: files only; a viewer is follow-up work.*
5. Undo with shared paths: the confirm lists them; "Undo only mine" is the default button.
6. OpenCode may not take concurrent `opencode acp` processes (spike PT-S5). *Default: if the spike says no, `effectiveCaps` forces `tasks: 1` for OpenCode and Settings says why.*
7. The idle-lane sleep after 10 minutes waiting (spec §4) uses a main-process timer per lane. *Default: one `setTimeout` per waiting ACP lane; tests use a held clock.*

## Standing rules
As in part 1. en.json: only the `"parallel"` block. All UI labels English only (plan 5a); the spec's Spanish labels ("Esperando por vos", "Trabajando", "En espera", "Tareas a la vez", "Jobs a la vez") become the English strings "Waiting for you", "Working", "Queued", "Tasks at once", "Jobs at once".

---

### Task 0: This plan

- [ ] **Step 1:** Copy `/private/tmp/claude-501/-Users-marcozanger-Documents-workspace-humanharness--claude-worktrees-plan-scopes-data/e2d9762b-c53e-4c2d-9cc2-c4e0683ef9d2/scratchpad/pt/2026-10-28-parallel-tasks-part2.md` to `docs/superpowers/plans/2026-10-28-parallel-tasks-part2.md`. Check that part 1's last commit is on the branch (`git -C <worktree> log --oneline -3`).

- [ ] **Step 2: Commit**

```bash
git -C <worktree> add docs/superpowers/plans/2026-10-28-parallel-tasks-part2.md
git -C <worktree> commit -m "docs(plans): parallel tasks and jobs, part 2

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 1: `inbox` key, caps in config, `AppState.parallel`

**Files:**
- Modify: `packages/harness-sdk/src/index.ts`, `packages/ui/src/client.ts`, `packages/shell/src/main/config.ts`
- Create: `packages/shell/src/main/parallel-config.ts`
- Test: `packages/harness-sdk/test/parallel.test.ts` (append), `packages/shell/test/parallel-config.test.ts`, `packages/shell/test/config.test.ts` (append)

- [ ] **Step 1: Write the failing tests.**

Append to `packages/harness-sdk/test/parallel.test.ts`:

```ts
describe("inbox (parallel spec §9.2, Decision 1)", () => {
  it("absent by default; false hides the core inbox", () => {
    expect("inbox" in defineHarness(base)).toBe(false);
    expect(defineHarness({ ...base, parallel: {}, inbox: false }).inbox).toBe(false);
    expect(() => defineHarness({ ...base, inbox: "no" as never })).toThrow();
  });
});
```

```ts
// packages/shell/test/parallel-config.test.ts
import { describe, expect, it } from "vitest";
import { effectiveCaps, parallelInfo } from "../src/main/parallel-config";

describe("effectiveCaps (parallel spec §7)", () => {
  it("the person's value wins, clamped to 1..8; else the manifest's", () => {
    expect(effectiveCaps({ tasks: 3, jobs: 1 }, undefined)).toEqual({ tasks: 3, jobs: 1 });
    expect(effectiveCaps({ tasks: 3, jobs: 1 }, { tasks: 5 })).toEqual({ tasks: 5, jobs: 1 });
    expect(effectiveCaps({ tasks: 3, jobs: 1 }, { tasks: 99, jobs: 0 })).toEqual({ tasks: 8, jobs: 1 });
  });
  it("an engine that can't run two sessions at once is held at one task (open question 6)", () => {
    expect(effectiveCaps({ tasks: 3, jobs: 2 }, undefined, { singleSession: true })).toEqual({ tasks: 1, jobs: 1 });
  });
});

describe("parallelInfo", () => {
  it("D0: undefined without parallel", () => {
    expect(parallelInfo({}, {})).toBeUndefined();
  });
  it("caps, suggested caps and whether the core inbox shows", () => {
    expect(parallelInfo({ parallel: { tasks: 3, jobs: 1 }, inbox: false }, { parallel: { tasks: 2 }, notifyWaiting: true })).toEqual({
      caps: { tasks: 2, jobs: 1 },
      suggested: { tasks: 3, jobs: 1 },
      inbox: false,
      notifyWaiting: true,
    });
  });
});
```

Append to `packages/shell/test/config.test.ts` (it already builds a `ConfigStore` on a temp dir; use its helper):

```ts
it("keeps valid parallel caps and notifyWaiting; drops bad ones (parallel spec §7)", async () => {
  await writeConfig({ parallel: { tasks: 3, jobs: "x" }, notifyWaiting: "yes" });
  expect(await store.load()).toMatchObject({ parallel: { tasks: 3 } });
  expect((await store.load()).notifyWaiting).toBeUndefined();
});
```

(`writeConfig`/`store`: use the file's own names for writing a raw `config.json` and the store.)

- [ ] **Step 2: Run them to see them fail.** `corepack pnpm vitest run packages/harness-sdk/test/parallel.test.ts packages/shell/test/parallel-config.test.ts packages/shell/test/config.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**

`harness-sdk/src/index.ts`, in `manifestSchema` after `parallel`:

```ts
  /** False hides the core inbox and its button (parallel spec §9.2); `client.tasks` stays. `ui` is taken (a custom UI path). */
  inbox: z.boolean().optional(),
```

`ui/src/client.ts`:

```ts
/** Caps on turns running at once (parallel spec §7). */
export interface ParallelCaps {
  tasks: number;
  jobs: number;
}

/** The harness declares `parallel` (spec §3): several open tasks, the inbox. Absent: one task at a time (D7). */
export interface ParallelInfo {
  /** In force now: the person's (Settings › General) or the manifest's. */
  caps: ParallelCaps;
  /** The manifest's suggestion. */
  suggested: ParallelCaps;
  /** The core inbox and its button show (manifest `inbox`, default true). */
  inbox: boolean;
  /** An OS notification when a task starts waiting (Settings › General; off by default). */
  notifyWaiting: boolean;
  /** Why the tasks cap is held at 1 (an engine that can't run two sessions), when it is. */
  heldReason?: "engine";
}
```

`AppState` gains `/** Parallel tasks (parallel spec). Absent: one task at a time, no inbox (D7). */ parallel?: ParallelInfo;`.

`AppConfig` gains:

```ts
  /** Settings › General: the person's caps (parallel spec §7). Absent: the manifest's. */
  parallel?: { tasks?: number; jobs?: number };
  /** Settings › General: an OS notification when a task waits for the person. Absent: off. */
  notifyWaiting?: boolean;
```

`packages/shell/src/main/parallel-config.ts`:

```ts
import { PARALLEL_MAX, type ParallelCaps } from "@humanharness/harness-sdk";
import type { AppConfig, ParallelInfo } from "@humanharness/ui/client";

const clamp = (n: unknown, fallback: number) => (typeof n === "number" && Number.isInteger(n) ? Math.min(PARALLEL_MAX, Math.max(1, n)) : fallback);

/**
 * The caps in force (parallel spec §7): the person's, clamped to 1..8, else the manifest's. An engine that can't run two
 * sessions at once (spike PT-S5) holds tasks and jobs at 1.
 */
export function effectiveCaps(suggested: ParallelCaps, person: AppConfig["parallel"], engine: { singleSession?: boolean } = {}): ParallelCaps {
  if (engine.singleSession) return { tasks: 1, jobs: 1 };
  return { tasks: clamp(person?.tasks, suggested.tasks), jobs: clamp(person?.jobs, suggested.jobs) };
}

/** `AppState.parallel`: undefined without `parallel` (D7). */
export function parallelInfo(
  harness: { parallel?: ParallelCaps; inbox?: boolean },
  config: Pick<AppConfig, "parallel" | "notifyWaiting">,
  engine: { singleSession?: boolean } = {},
): ParallelInfo | undefined {
  if (!harness.parallel) return undefined;
  return {
    caps: effectiveCaps(harness.parallel, config.parallel, engine),
    suggested: harness.parallel,
    inbox: harness.inbox !== false,
    notifyWaiting: config.notifyWaiting === true,
    ...(engine.singleSession ? { heldReason: "engine" as const } : {}),
  };
}
```

`config.ts` `load()`: destructure `parallel, notifyWaiting` too and add

```ts
        ...(cleanParallel(parallel) ? { parallel: cleanParallel(parallel) } : {}),
        ...(typeof notifyWaiting === "boolean" ? { notifyWaiting } : {}),
```

with

```ts
/** A hand-edited `parallel` keeps only integer caps (Settings clamps them again). */
function cleanParallel(v: unknown): AppConfig["parallel"] | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const out: { tasks?: number; jobs?: number } = {};
  if (Number.isInteger(o.tasks)) out.tasks = o.tasks as number;
  if (Number.isInteger(o.jobs)) out.jobs = o.jobs as number;
  return Object.keys(out).length > 0 ? out : undefined;
}
```

`validate.ts` doesn't reject these keys. Read its `configProblem` to confirm that unknown keys pass, and add nothing if they do.

In `index.ts` `appState()`, after `plugins`:

```ts
    ...(parallelInfo(harness, saved, engineHold(saved.engineId)) ? { parallel: parallelInfo(harness, saved, engineHold(saved.engineId))! } : {}),
```

where `engineHold(id)` returns `{ singleSession: true }` only for an engine the spike found unable to run two sessions (PT-S5). If the spike found none, define `const engineHold = (_id?: string) => ({})` in `parallel-config.ts` and say so in the commit.

Add a test next to the existing app-state tests (if `index.ts` has none, test `parallelInfo` only. It is the single source, and D0 is its `undefined`).

- [ ] **Step 4: Run the tests.** Expected: PASS.

- [ ] **Step 5: Typecheck, test, build, commit.** `corepack pnpm typecheck && corepack pnpm test && corepack pnpm app:build`.

```bash
git -C <worktree> add packages/harness-sdk/src/index.ts packages/harness-sdk/test/parallel.test.ts packages/ui/src/client.ts packages/shell/src/main/config.ts packages/shell/src/main/parallel-config.ts packages/shell/src/main/index.ts packages/shell/test/parallel-config.test.ts packages/shell/test/config.test.ts
git -C <worktree> commit -m "feat(shell): parallel caps in config and app state; manifest inbox key

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 2: Lanes in tasks.json and the lane store

**Files:**
- Modify: `packages/shell/src/main/task-store.ts`
- Create: `packages/shell/src/main/lane-store.ts`
- Test: `packages/shell/test/task-store.test.ts` (append), `packages/shell/test/lane-store.test.ts`

- [ ] **Step 1: Write the failing tests.**

Append to `task-store.test.ts`:

```ts
describe("lanes (parallel spec §6)", () => {
  it("D0: a file without lanes round-trips without new keys", async () => {
    const store = new TaskStore(base, opts);
    await store.save({ version: 1, current: null, actions: {} });
    const raw = JSON.parse(fs.readFileSync(path.join(base, ".harness", "tasks.json"), "utf8"));
    expect(Object.keys(raw).sort()).toEqual(["actions", "current", "version"]);
  });
  it("cleanLanes keeps valid tasks, drops duplicates and bad entries, and ends interrupted ones as current does", () => {
    const t = (id: string, status = "waiting") => ({ id, status, startedAt: "2026-10-28T10:00:00Z", turns: 1 });
    const lanes = cleanLanes([t("a"), t("a"), { id: 3 }, t("b", "running")], { interrupted: true });
    expect(lanes.map((l) => l.id)).toEqual(["a", "b"]);
    expect(lanes.find((l) => l.id === "b")?.status).toBe("waiting");
  });
});
```

(`interrupted: true` mirrors what `TaskStore.load` does for `current` after a quit. Read `cleanCurrent` and `interrupted` in `task-store.ts` and apply the same rule per lane. The test's expected status after an interrupted running task must equal what `current` gets today; adjust the literal to that.)

```ts
// packages/shell/test/lane-store.test.ts
import { describe, expect, it } from "vitest";
import { LaneStore } from "../src/main/lane-store";
import type { TasksFile } from "../src/main/task-store";

function memory(initial: TasksFile) {
  let file = structuredClone(initial);
  return { load: async () => structuredClone(file), save: async (s: TasksFile) => void (file = structuredClone(s)), peek: () => file };
}
const task = (id: string, extra: object = {}) => ({ id, status: "waiting" as const, startedAt: "2026-10-28T10:00:00Z", turns: 0, ...extra });

describe("LaneStore (Decision 3)", () => {
  it("a lane sees its task as current; saving writes it back into lanes", async () => {
    const m = memory({ version: 1, current: null, actions: {}, lanes: [task("a"), task("b")] });
    const a = new LaneStore(m, "a");
    const seen = await a.load();
    expect(seen.current?.id).toBe("a");
    expect("lanes" in seen).toBe(false);
    await a.save({ ...seen, current: { ...seen.current!, turns: 2 } });
    expect(m.peek().lanes?.map((l) => [l.id, l.turns])).toEqual([["a", 2], ["b", 0]]);
    expect(m.peek().current).toBeNull();
  });
  it("a lane whose task ended is removed; a new task is added", async () => {
    const m = memory({ version: 1, current: null, actions: {}, lanes: [task("a")] });
    await new LaneStore(m, "a").save({ version: 1, current: null, actions: { intro: "done" } });
    expect(m.peek().lanes).toEqual([]);
    const n = new LaneStore(m, "n");
    const s = await n.load();
    expect(s.current).toBeNull();
    await n.save({ ...s, current: task("n") });
    expect(m.peek().lanes?.map((l) => l.id)).toEqual(["n"]);
  });
  it("two lanes' changes to actions both survive (three-way merge)", async () => {
    const m = memory({ version: 1, current: null, actions: { x: "done" }, lanes: [task("a"), task("b")] });
    const a = new LaneStore(m, "a");
    const b = new LaneStore(m, "b");
    const sa = await a.load();
    const sb = await b.load();
    await a.save({ ...sa, actions: { ...sa.actions, one: "done" } });
    await b.save({ ...sb, actions: { ...sb.actions, two: "unfinished" } });
    expect(m.peek().actions).toEqual({ x: "done", one: "done", two: "unfinished" });
  });
  it("scopes and open merge the same way; engine follows the last writer", async () => {
    const m = memory({ version: 1, current: null, actions: {}, open: "s1", scopes: { s1: {} }, lanes: [task("a"), task("b")] });
    const a = new LaneStore(m, "a");
    const b = new LaneStore(m, "b");
    const sa = await a.load();
    const sb = await b.load();
    await a.save({ ...sa, scopes: { s1: { one: "done" } } });
    await b.save({ ...sb, scopes: { s1: {}, s2: { two: "done" } }, engine: "claude" });
    expect(m.peek().scopes).toEqual({ s1: { one: "done" }, s2: { two: "done" } });
    expect(m.peek().engine).toBe("claude");
    expect(m.peek().open).toBe("s1");
  });
});
```

- [ ] **Step 2: Run them to see them fail.** Expected: FAIL.

- [ ] **Step 3: Implement.**

`task-store.ts`:
- `CurrentTask` gains:

```ts
  /** Tokens the task's turns used so far (parallel spec §9.1 `TaskSummary.tokens`). Board mode only. */
  tokens?: number;
  /** Paths another task also changed (spec §5.3), newest notice last, at most 20. Board mode only. */
  conflict?: string[];
```

- `TasksFile` gains:

```ts
  /** Board mode (parallel spec §6): every open task. Absent in a harness without `parallel` (D7); `current` stays null then. */
  lanes?: CurrentTask[];
  /** Board mode: the task the window shows; null or absent: the start view. */
  focus?: string | null;
```

Add `cleanLanes(raw: unknown, o: { interrupted: boolean }): CurrentTask[]`. It maps each entry through the same cleaning `TaskStore.load` applies to `current` (call `cleanCurrent` and the interrupted rule), drops entries that come back null and duplicate ids, keeps at most `LANES_MAX = 32`, and keeps `tokens` (non-negative integer) and `conflict` (strings, at most 20).

In `TaskStore.load`, only when the raw file has a `lanes` key: `lanes: cleanLanes(raw.lanes, …)`; and `focus` when it is a string or null. `save` writes what it's given, so a file without lanes stays without lanes.

`packages/shell/src/main/lane-store.ts`:

```ts
import type { ActionStatus, TasksFile } from "./task-store";

type Store = { load(): Promise<TasksFile>; save(state: TasksFile): Promise<void> };

/**
 * One lane's view of tasks.json (parallel spec §6, Decision 3): its task is `current`, the others are hidden. On save
 * its task goes back into `lanes` and its changes to the shared fields are merged three-way against what it loaded,
 * so two lanes saving one after the other never undo each other's action statuses.
 */
export class LaneStore {
  private base: TasksFile | null = null;

  constructor(
    private readonly file: Store,
    readonly id: string,
  ) {}

  async load(): Promise<TasksFile> {
    const f = await this.file.load();
    const { lanes, focus: _focus, ...rest } = f;
    const view: TasksFile = { ...rest, current: (lanes ?? []).find((l) => l.id === this.id) ?? null };
    this.base = structuredClone(view);
    return view;
  }

  async save(state: TasksFile): Promise<void> {
    const base = this.base ?? (await this.load());
    const fresh = await this.file.load();
    const lanes = (fresh.lanes ?? []).filter((l) => l.id !== this.id);
    const at = (fresh.lanes ?? []).findIndex((l) => l.id === this.id);
    if (state.current && state.current.id === this.id) lanes.splice(at < 0 ? lanes.length : at, 0, state.current);
    const merged: TasksFile = {
      ...fresh,
      current: null,
      lanes,
      actions: mergeRecord(base.actions, state.actions, fresh.actions),
      ...mergeOptional("open", base, state, fresh),
      ...mergeOptional("engine", base, state, fresh),
    };
    const scopes = mergeScopes(base.scopes, state.scopes, fresh.scopes);
    if (scopes) merged.scopes = scopes;
    else delete merged.scopes;
    await this.file.save(merged);
    this.base = structuredClone(state);
  }
}

/** Keys this lane changed (added, changed or removed against `base`) applied to `fresh`. */
function mergeRecord<T>(base: Record<string, T>, mine: Record<string, T>, fresh: Record<string, T>): Record<string, T> {
  const out = { ...fresh };
  for (const k of new Set([...Object.keys(base), ...Object.keys(mine)])) {
    const before = Object.hasOwn(base, k) ? base[k] : undefined;
    const after = Object.hasOwn(mine, k) ? mine[k] : undefined;
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    if (after === undefined) delete out[k];
    else out[k] = after;
  }
  return out;
}

function mergeScopes(
  base: Record<string, Record<string, ActionStatus>> | undefined,
  mine: Record<string, Record<string, ActionStatus>> | undefined,
  fresh: Record<string, Record<string, ActionStatus>> | undefined,
): Record<string, Record<string, ActionStatus>> | undefined {
  if (!base && !mine) return fresh;
  const out: Record<string, Record<string, ActionStatus>> = { ...(fresh ?? {}) };
  for (const s of new Set([...Object.keys(base ?? {}), ...Object.keys(mine ?? {})])) {
    const b = base && Object.hasOwn(base, s) ? base[s] : {};
    const m = mine && Object.hasOwn(mine, s) ? mine[s] : undefined;
    if (m === undefined) {
      if (base && Object.hasOwn(base, s)) delete out[s];
      continue;
    }
    out[s] = mergeRecord(b, m, Object.hasOwn(out, s) ? out[s] : {});
  }
  return out;
}

function mergeOptional<K extends "open" | "engine">(key: K, base: TasksFile, mine: TasksFile, fresh: TasksFile): Partial<Pick<TasksFile, K>> {
  if (base[key] === mine[key]) return fresh[key] === undefined ? {} : ({ [key]: fresh[key] } as Partial<Pick<TasksFile, K>>);
  return mine[key] === undefined ? {} : ({ [key]: mine[key] } as Partial<Pick<TasksFile, K>>);
}
```

The `open` merge drops `open` when this lane cleared it. When `fresh` had it and this lane didn't change it, it is kept. The spread of `...fresh` already carries `open`/`engine`. Make sure `mergeOptional`'s empty result **removes** a key this lane cleared: build `merged` without `open`/`engine` from `fresh` first (`const { open: _o, engine: _e, ...freshRest } = fresh;`) and spread `freshRest`. Adjust the code above accordingly. The tests pin the behaviour.

- [ ] **Step 4: Run the tests.** `corepack pnpm vitest run packages/shell/test/task-store.test.ts packages/shell/test/lane-store.test.ts packages/shell/test/task-manager.test.ts`. Expected: PASS (`task-manager.test.ts` unchanged).

- [ ] **Step 5: Typecheck, test, commit.**

```bash
git -C <worktree> add packages/shell/src/main/task-store.ts packages/shell/src/main/lane-store.ts packages/shell/test/task-store.test.ts packages/shell/test/lane-store.test.ts
git -C <worktree> commit -m "feat(shell): open tasks as lanes in tasks.json, with a per-lane store

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 3: `TurnGate` — caps, FIFO queues, pause, hold

**Files:**
- Create: `packages/shell/src/main/turn-gate.ts`
- Test: `packages/shell/test/turn-gate.test.ts`

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/shell/test/turn-gate.test.ts
import { describe, expect, it, vi } from "vitest";
import { Dropped, TurnGate } from "../src/main/turn-gate";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("TurnGate (parallel spec §7)", () => {
  it("runs up to the cap; the rest wait FIFO and start as slots free", async () => {
    const gate = new TurnGate({ tasks: 2, jobs: 1 });
    const order: string[] = [];
    const run = async (id: string) => {
      const release = await gate.acquire("tasks", { id, text: id });
      order.push(id);
      return release;
    };
    const ra = await run("a");
    const rb = await run("b");
    const pc = run("c");
    const pd = run("d");
    await flush();
    expect(gate.queued("tasks").map((q) => q.id)).toEqual(["c", "d"]);
    ra();
    const rc = await pc;
    expect(order).toEqual(["a", "b", "c"]);
    rb();
    rc();
    (await pd)();
    expect(gate.running("tasks")).toBe(0);
  });
  it("the two caps are counted apart", async () => {
    const gate = new TurnGate({ tasks: 1, jobs: 1 });
    await gate.acquire("tasks", { id: "t" });
    await expect(Promise.race([gate.acquire("jobs", { id: "j" }).then(() => "ran"), flush().then(() => "waited")])).resolves.toBe("ran");
  });
  it("drop() takes a queued turn out and rejects it with Dropped; returns its text (Decision 7)", async () => {
    const gate = new TurnGate({ tasks: 1, jobs: 1 });
    await gate.acquire("tasks", { id: "a" });
    const p = gate.acquire("tasks", { id: "b", text: "hello" });
    await flush();
    expect(gate.drop("b")).toBe("hello");
    await expect(p).rejects.toBeInstanceOf(Dropped);
    expect(gate.drop("nobody")).toBeNull();
  });
  it("pause holds both queues until resume; resetsAt resumes on its own", async () => {
    vi.useFakeTimers();
    try {
      const gate = new TurnGate({ tasks: 2, jobs: 1 }, { now: () => Date.parse("2026-10-28T10:00:00Z") });
      gate.pause({ reason: "out-of-quota", resetsAt: "2026-10-28T10:05:00Z" });
      let started = false;
      void gate.acquire("tasks", { id: "a" }).then(() => (started = true));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(started).toBe(false);
      expect(gate.paused()).toMatchObject({ reason: "out-of-quota", resetsAt: "2026-10-28T10:05:00Z" });
      await vi.advanceTimersByTimeAsync(4 * 60_000 + 1);
      expect(started).toBe(true);
      expect(gate.paused()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
  it("hold() keeps new turns back at most 10 s, or until unhold (spec §10)", async () => {
    vi.useFakeTimers();
    try {
      const gate = new TurnGate({ tasks: 2, jobs: 1 });
      const unhold = gate.hold(10_000);
      let started = false;
      void gate.acquire("tasks", { id: "a" }).then(() => (started = true));
      await vi.advanceTimersByTimeAsync(9_000);
      expect(started).toBe(false);
      await vi.advanceTimersByTimeAsync(1_001);
      expect(started).toBe(true);
      unhold();
    } finally {
      vi.useRealTimers();
    }
  });
  it("setCaps raises the cap and starts waiting turns; onChange fires on every change", async () => {
    const gate = new TurnGate({ tasks: 1, jobs: 1 });
    const changes = vi.fn();
    gate.onChange(changes);
    await gate.acquire("tasks", { id: "a" });
    const pb = gate.acquire("tasks", { id: "b" });
    gate.setCaps({ tasks: 2, jobs: 1 });
    await pb;
    expect(changes).toHaveBeenCalled();
  });
  it("dropAll rejects every queued turn (engine switch, quit; spec §10)", async () => {
    const gate = new TurnGate({ tasks: 1, jobs: 1 });
    await gate.acquire("tasks", { id: "a" });
    const p = gate.acquire("tasks", { id: "b" });
    gate.dropAll();
    await expect(p).rejects.toBeInstanceOf(Dropped);
  });
});
```

- [ ] **Step 2: Run to see it fail.** Expected: FAIL.

- [ ] **Step 3: Implement.**

```ts
// packages/shell/src/main/turn-gate.ts
import type { ParallelCaps } from "@humanharness/harness-sdk";

export type Cap = keyof ParallelCaps;

/** A queued turn taken out before it started (cancel, engine switch, quit). */
export class Dropped extends Error {
  constructor() {
    super("The queued turn was cancelled");
  }
}

/** Why the queues wait (spec §7 "Out of quota"). */
export interface Pause {
  reason: "out-of-quota" | "folder-move";
  /** When the engine said its window resets, if it did. */
  resetsAt?: string;
}

interface Waiter {
  id: string;
  text?: string;
  at: number;
  start: (release: () => void) => void;
  fail: (err: Error) => void;
}

/**
 * The caps on running turns and their FIFO queues (parallel spec §7). `acquire` resolves with a release function when
 * the turn may run. Every change is synchronous, then listeners are told.
 */
export class TurnGate {
  private readonly runningCount: Record<Cap, number> = { tasks: 0, jobs: 0 };
  private readonly queues: Record<Cap, Waiter[]> = { tasks: [], jobs: [] };
  private pauseState: Pause | null = null;
  private pauseTimer: ReturnType<typeof setTimeout> | null = null;
  private holds = 0;
  private readonly listeners = new Set<() => void>();

  constructor(
    private caps: ParallelCaps,
    private readonly o: { now?: () => number } = {},
  ) {}

  acquire(cap: Cap, w: { id: string; text?: string }): Promise<() => void> {
    return new Promise((resolve, reject) => {
      this.queues[cap].push({ id: w.id, text: w.text, at: (this.o.now ?? Date.now)(), start: resolve, fail: reject });
      this.pump();
      this.changed();
    });
  }

  /** Takes a queued turn out (spec §7 "cancelled until it starts"); its text, or null when `id` isn't queued. */
  drop(id: string): string | null {
    for (const cap of ["tasks", "jobs"] as const) {
      const i = this.queues[cap].findIndex((w) => w.id === id);
      if (i < 0) continue;
      const [w] = this.queues[cap].splice(i, 1);
      w.fail(new Dropped());
      this.changed();
      return w.text ?? "";
    }
    return null;
  }

  dropAll(): void {
    for (const cap of ["tasks", "jobs"] as const) for (const w of this.queues[cap].splice(0)) w.fail(new Dropped());
    this.changed();
  }

  queued(cap: Cap): { id: string; text?: string; at: number }[] {
    return this.queues[cap].map(({ id, text, at }) => ({ id, text, at }));
  }

  isQueued(id: string): boolean {
    return this.queues.tasks.some((w) => w.id === id) || this.queues.jobs.some((w) => w.id === id);
  }

  running(cap: Cap): number {
    return this.runningCount[cap];
  }

  setCaps(caps: ParallelCaps): void {
    this.caps = caps;
    this.pump();
    this.changed();
  }

  pause(p: Pause): void {
    this.pauseState = p;
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    this.pauseTimer = null;
    const at = p.resetsAt ? Date.parse(p.resetsAt) : Number.NaN;
    if (Number.isFinite(at)) this.pauseTimer = setTimeout(() => this.resume(), Math.max(0, at - (this.o.now ?? Date.now)()));
    this.changed();
  }

  resume(): void {
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    this.pauseTimer = null;
    this.pauseState = null;
    this.pump();
    this.changed();
  }

  paused(): Pause | null {
    return this.pauseState;
  }

  /** Holds new turns for at most `ms` (spec §10: a pending AGENTS.md rewrite). Returns the early release. */
  hold(ms: number): () => void {
    this.holds++;
    let done = false;
    const release = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      this.holds--;
      this.pump();
      this.changed();
    };
    const timer = setTimeout(release, ms);
    return release;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private pump(): void {
    if (this.pauseState || this.holds > 0) return;
    for (const cap of ["tasks", "jobs"] as const) {
      while (this.queues[cap].length > 0 && this.runningCount[cap] < this.caps[cap]) {
        const w = this.queues[cap].shift()!;
        this.runningCount[cap]++;
        let released = false;
        w.start(() => {
          if (released) return;
          released = true;
          this.runningCount[cap]--;
          this.pump();
          this.changed();
        });
      }
    }
  }

  private changed(): void {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch (err) {
        console.error("A queue listener failed", err);
      }
    }
  }
}
```

- [ ] **Step 4: Run the tests.** Expected: PASS.

- [ ] **Step 5: Typecheck, test, commit.**

```bash
git -C <worktree> add packages/shell/src/main/turn-gate.ts packages/shell/test/turn-gate.test.ts
git -C <worktree> commit -m "feat(shell): caps on running turns with FIFO queues, pause and hold

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 4: A lane's turns through the gate

**Files:**
- Create: `packages/shell/src/main/gated-turns.ts`
- Test: `packages/shell/test/gated-turns.test.ts`

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/shell/test/gated-turns.test.ts
import { describe, expect, it, vi } from "vitest";
import type { Event } from "@humanharness/runtime";
import { gatedTurns } from "../src/main/gated-turns";
import { TurnGate } from "../src/main/turn-gate";

function fakeTurns() {
  const pending: { resolve: () => void; options: { onEvent?: (e: Event) => void } }[] = [];
  return {
    pending,
    send: vi.fn((_m: string, options: { onEvent?: (e: Event) => void }) => new Promise<void>((resolve) => pending.push({ resolve, options }))),
    isBusy: vi.fn(() => pending.length > 0),
    cancel: vi.fn(),
  };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("gatedTurns (parallel spec §7)", () => {
  it("a turn over the cap waits; the lane says queued; it runs when a slot frees", async () => {
    const gate = new TurnGate({ tasks: 1, jobs: 1 });
    const a = fakeTurns();
    const b = fakeTurns();
    const ga = gatedTurns("a", gate, a, { cap: "tasks" });
    const gb = gatedTurns("b", gate, b, { cap: "tasks" });
    const pa = ga.send("one", {});
    await flush();
    const pb = gb.send("two", {});
    await flush();
    expect(b.send).not.toHaveBeenCalled();
    expect(gb.isQueued()).toBe(true);
    expect(gb.isBusy()).toBe(true);
    a.pending[0].resolve();
    await pa;
    await flush();
    expect(b.send).toHaveBeenCalledWith("two", expect.anything());
    b.pending[0].resolve();
    await pb;
  });
  it("cancel while queued drops it: send resolves and emits a cancelled done", async () => {
    const gate = new TurnGate({ tasks: 1, jobs: 1 });
    const a = fakeTurns();
    const b = fakeTurns();
    const emitted: Event[] = [];
    void gatedTurns("a", gate, a, { cap: "tasks" }).send("one", {});
    await flush();
    const gb = gatedTurns("b", gate, b, { cap: "tasks", emit: (e) => emitted.push(e) });
    const pb = gb.send("two", {});
    await flush();
    gb.cancel();
    await pb;
    expect(b.send).not.toHaveBeenCalled();
    expect(emitted).toEqual([{ type: "done", ok: false, error: { code: "cancelled" } }]);
  });
  it("an out-of-quota end pauses the queues with the last reported reset", async () => {
    const gate = new TurnGate({ tasks: 2, jobs: 1 });
    const a = fakeTurns();
    const ga = gatedTurns("a", gate, a, { cap: "tasks" });
    const p = ga.send("one", {});
    await flush();
    const on = a.pending[0].options.onEvent!;
    on({ type: "limits", windows: [{ kind: "five_hour", usedPercent: 100, resetsAt: "2026-10-28T15:00:00Z" }] } as never);
    on({ type: "done", ok: false, error: { code: "out-of-quota" } });
    a.pending[0].resolve();
    await p;
    expect(gate.paused()).toEqual({ reason: "out-of-quota", resetsAt: "2026-10-28T15:00:00Z" });
  });
  it("forwards the caller's onEvent", async () => {
    const gate = new TurnGate({ tasks: 1, jobs: 1 });
    const a = fakeTurns();
    const seen: Event[] = [];
    const p = gatedTurns("a", gate, a, { cap: "tasks" }).send("x", { onEvent: (e) => seen.push(e) });
    await flush();
    a.pending[0].options.onEvent!({ type: "text", delta: "hi" });
    a.pending[0].resolve();
    await p;
    expect(seen).toEqual([{ type: "text", delta: "hi" }]);
  });
});
```

(Use the real shape of the `limits` event from `packages/runtime/src/events.ts` for the windows' fields, and take `resetsAt` from it.)

- [ ] **Step 2: Run to see it fail.** Expected: FAIL.

- [ ] **Step 3: Implement.**

```ts
// packages/shell/src/main/gated-turns.ts
import type { Event } from "@humanharness/runtime";
import type { TurnOptions } from "./turn-controller";
import { type Cap, Dropped, type TurnGate } from "./turn-gate";

type Turns = { send(message: string, options: TurnOptions): Promise<void>; isBusy(): boolean; cancel(): void };

/**
 * A lane's `turns` (TaskDeps.turns) through the gate (parallel spec §7): a turn waits for a free slot of its cap, FIFO.
 * Cancel while it waits takes it out of the queue and sends a cancelled `done` so the window drops the turn it shows.
 * A turn that ends `out-of-quota` pauses both queues until the reset the engine reported last, if any.
 */
export function gatedTurns(
  lane: string,
  gate: TurnGate,
  inner: Turns,
  o: { cap: Cap; emit?: (e: Event) => void },
): Turns & { isQueued(): boolean } {
  let waiting = false;
  return {
    async send(message, options) {
      waiting = true;
      let release: () => void;
      try {
        release = await gate.acquire(o.cap, { id: lane, text: message });
      } catch (err) {
        if (err instanceof Dropped) {
          o.emit?.({ type: "done", ok: false, error: { code: "cancelled" } });
          return;
        }
        throw err;
      } finally {
        waiting = false;
      }
      let resetsAt: string | undefined;
      try {
        await inner.send(message, {
          ...options,
          onEvent: (e) => {
            if (e.type === "limits") resetsAt = latestReset(e) ?? resetsAt;
            if (e.type === "done" && !e.ok && e.error.code === "out-of-quota") gate.pause({ reason: "out-of-quota", ...(resetsAt ? { resetsAt } : {}) });
            options.onEvent?.(e);
          },
        });
      } finally {
        release();
      }
    },
    isBusy: () => waiting || inner.isBusy(),
    isQueued: () => gate.isQueued(lane),
    cancel() {
      if (gate.drop(lane) === null) inner.cancel();
    },
  };
}

/** The latest `resetsAt` among a limits event's windows that are full. */
function latestReset(e: Extract<Event, { type: "limits" }>): string | undefined {
  const full = e.windows.filter((w) => w.resetsAt && (w.usedPercent ?? 0) >= 100).map((w) => w.resetsAt as string);
  return full.sort().at(-1);
}
```

(Adapt `w.usedPercent` to the real field of `LimitWindow` in `events.ts`. If a window has no percent, take any window with `resetsAt`.)

- [ ] **Step 4: Run the tests.** Expected: PASS.

- [ ] **Step 5: Typecheck, test, commit.**

```bash
git -C <worktree> add packages/shell/src/main/gated-turns.ts packages/shell/test/gated-turns.test.ts
git -C <worktree> commit -m "feat(shell): a lane's turns wait for a free slot; out of quota pauses the queues

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 5: Per-task chats and their migration

**Files:**
- Modify: `packages/workspace/src/layout.ts`, `packages/shell/src/main/chat-log.ts`
- Create: `packages/shell/src/main/chat-migration.ts`
- Test: `packages/workspace/test/layout.test.ts` (append), `packages/shell/test/chat-log.test.ts` (append), `packages/shell/test/chat-migration.test.ts`

- [ ] **Step 1: Write the failing tests.**

Append to the workspace layout test:

```ts
it("taskChatFile: chats/<scope>/<task>.jsonl (parallel spec §6)", () => {
  expect(taskChatFile("/b", "main", "t1")).toBe(path.join("/b", ".harness", "chats", "main", "t1.jsonl"));
  expect(() => taskChatFile("/b", "main", "../x")).toThrow();
});
```

Append to `chat-log.test.ts`:

```ts
describe("per-task chats (parallel spec §6)", () => {
  it("D0: without a task, the scope's file as before", async () => {
    await new ChatLog(base, "claude", "main").append(entry("hi"));
    expect(fs.existsSync(path.join(base, ".harness", "chats", "main.jsonl"))).toBe(true);
  });
  it("with a task: chats/<scope>/<task>.jsonl", async () => {
    await new ChatLog(base, "claude", "main", "t1").append(entry("hi"));
    expect(fs.existsSync(path.join(base, ".harness", "chats", "main", "t1.jsonl"))).toBe(true);
    expect(await new ChatLog(base, undefined, "main", "t1").load()).toHaveLength(1);
  });
});
```

(`entry(text)`: the file's helper that builds a user `ChatEntry`. Add a small one if missing.)

```ts
// packages/shell/test/chat-migration.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { migrateChats } from "../src/main/chat-migration";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-cmig-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const line = (text: string) => JSON.stringify({ id: text, role: "user", text, blocks: [], activities: [], at: "2026-10-28T10:00:00Z" }) + "\n";

describe("migrateChats (Decision 8, P6)", () => {
  it("the scope's chat becomes its open task's chat; the old file is archived", async () => {
    const base = fs.mkdtempSync(path.join(root, "b-"));
    const chats = path.join(base, ".harness", "chats");
    fs.mkdirSync(chats, { recursive: true });
    fs.writeFileSync(path.join(chats, "main.jsonl"), line("a") + line("b"));
    fs.writeFileSync(path.join(chats, "s1.jsonl"), line("c"));
    const moved = await migrateChats(base, [{ scope: "main", task: "t1" }]);
    expect(moved).toEqual({ copied: ["main"], archived: ["main", "s1"] });
    expect(fs.readFileSync(path.join(chats, "main", "t1.jsonl"), "utf8")).toBe(line("a") + line("b"));
    expect(fs.existsSync(path.join(chats, "main.jsonl"))).toBe(false);
    expect(fs.existsSync(path.join(chats, "s1.jsonl"))).toBe(false);
    expect(fs.readdirSync(path.join(chats, "archive")).length).toBe(2);
  });
  it("runs once: a second call does nothing", async () => {
    const base = fs.mkdtempSync(path.join(root, "b-"));
    fs.mkdirSync(path.join(base, ".harness", "chats"), { recursive: true });
    expect(await migrateChats(base, [])).toEqual({ copied: [], archived: [] });
    expect(await migrateChats(base, [])).toEqual({ copied: [], archived: [] });
  });
  it("a failed copy leaves the old file where it was", async () => {
    const base = fs.mkdtempSync(path.join(root, "b-"));
    const chats = path.join(base, ".harness", "chats");
    fs.mkdirSync(chats, { recursive: true });
    fs.writeFileSync(path.join(chats, "main.jsonl"), line("a"));
    fs.writeFileSync(path.join(chats, "main"), "a file where the folder should be");
    await expect(migrateChats(base, [{ scope: "main", task: "t1" }])).rejects.toThrow();
    expect(fs.existsSync(path.join(chats, "main.jsonl"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to see them fail.** Expected: FAIL.

- [ ] **Step 3: Implement.**

`layout.ts`:

```ts
/** A task's chat in a harness with parallel tasks (parallel spec §6): `chats/<scope>/<task id>.jsonl`. */
export const taskChatFile = (base: string, scope: string, task: string): string => {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(task)) throw new Error("Invalid task id");
  return path.join(chatsDir(base), scopeDir(scope), `${task}.jsonl`);
};
```

(Task ids are `randomUUID()` values or test ids, and the pattern fits both. Check that `TaskManager`'s ids match it.)

`chat-log.ts` constructor gains a fourth parameter:

```ts
  constructor(
    folder: string,
    private readonly engine?: string,
    private readonly scope: string = MAIN_SCOPE,
    /** Board mode (parallel spec §6): the task's own chat. Absent: the scope's chat, as before. */
    private readonly task?: string,
  ) {
    this.file = task ? taskChatFile(folder, scope, task) : chatFile(folder, scope);
  }
```

`archive()` of a task chat writes to `chats/archive/<stamp>-<scope>-<task>-<label>.jsonl`. Keep the old naming when `task` is absent.

`scopesIn` must ignore the new scope folders: it already filters `.jsonl` names, so nothing changes.

`packages/shell/src/main/chat-migration.ts`:

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { chatsDir, isScopeDir, taskChatFile } from "@humanharness/workspace";
import { ChatLog } from "./chat-log";

/** The marker that the move to per-task chats ran in this folder. */
const MARKER = ".per-task";

/**
 * The one-time move to per-task chats (parallel spec §6, Decision 8). For each `<scope>.jsonl`: when that scope's last
 * task is still open (`open`), its content is copied to that task's chat; then the scope file is archived
 * (`ChatLog.archive("parallel")`). A file is archived only after its copy succeeded. A marker makes it run once.
 */
export async function migrateChats(base: string, open: readonly { scope: string; task: string }[]): Promise<{ copied: string[]; archived: string[] }> {
  const dir = chatsDir(base);
  const marker = path.join(dir, MARKER);
  if (await fs.access(marker).then(() => true, () => false)) return { copied: [], archived: [] };
  const copied: string[] = [];
  const archived: string[] = [];
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  for (const name of names.filter((n) => n.endsWith(".jsonl")).sort()) {
    const scope = name.slice(0, -".jsonl".length);
    if (!isScopeDir(scope)) continue;
    const owner = open.find((o) => o.scope === scope);
    if (owner) {
      const target = taskChatFile(base, scope, owner.task);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(path.join(dir, name), target);
      copied.push(scope);
    }
    await new ChatLog(base, undefined, scope).archive("parallel");
    archived.push(scope);
  }
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(marker, "");
  return { copied, archived };
}
```

(`isScopeDir` maps a file name back to a scope id. If the workspace exports a different helper to turn a dir name back into a scope (e.g. `scopeOfDir`), use that and pass the real scope id to `ChatLog`/`taskChatFile`. `main` maps to `main`.)

- [ ] **Step 4: Run the tests.** Expected: PASS, the old `chat-log.test.ts` cases included.

- [ ] **Step 5: Typecheck, test, commit.**

```bash
git -C <worktree> add packages/workspace/src/layout.ts packages/workspace/test packages/shell/src/main/chat-log.ts packages/shell/src/main/chat-migration.ts packages/shell/test/chat-log.test.ts packages/shell/test/chat-migration.test.ts
git -C <worktree> commit -m "feat(shell): per-task chats and the one-time move to them

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 6: `TaskBoard` core — lanes, focus, starting without closing

**Files:**
- Create: `packages/shell/src/main/task-board.ts`
- Test: `packages/shell/test/task-board.test.ts`

The board owns lanes. It never touches engines itself: a `LaneFactory` gives it each lane's `TaskManager` and its gated turns. Tests use a factory that builds real `TaskManager`s over fake turns (as `task-manager.test.ts` does).

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/shell/test/task-board.test.ts
import { describe, expect, it, vi } from "vitest";
import { TaskBoard, type LaneHandle } from "../src/main/task-board";
import type { TasksFile } from "../src/main/task-store";

/** A lane double with the TaskManager surface the board uses; state lives in the shared memory file through `file`. */
function harness() {
  let file: TasksFile = { version: 1, current: null, actions: {}, lanes: [] };
  const made: FakeLane[] = [];
  class FakeLane implements LaneHandle {
    status: "idle" | "running" | "waiting" = "idle";
    started: string[] = [];
    closed = false;
    constructor(readonly id: string) {}
    async start(action: string) {
      this.started.push(action);
      this.status = "waiting";
      file = { ...file, lanes: [...(file.lanes ?? []), { id: this.id, action, status: "waiting", startedAt: "2026-10-28T10:00:00Z", turns: 1 }] };
    }
    async ask(text: string) {
      await this.start(`q:${text}`);
    }
    isBusy() {
      return this.status === "running";
    }
    async view() {
      return { current: this.status === "idle" ? null : ({ id: this.id, status: "waiting" } as never), actions: {}, notes: [] };
    }
    async finish() {
      this.closed = true;
      file = { ...file, lanes: (file.lanes ?? []).filter((l) => l.id !== this.id) };
      return true;
    }
    cancel() {}
    async interrupt() {
      await this.finish();
    }
    async close() {}
  }
  let n = 0;
  const board = new TaskBoard({
    file: { load: async () => structuredClone(file), save: async (s) => void (file = structuredClone(s)) },
    newLane: (id) => {
      const l = new FakeLane(id);
      made.push(l);
      return l;
    },
    newId: () => `t${++n}`,
    changed: vi.fn(),
  });
  return { board, made, file: () => file };
}

describe("TaskBoard (parallel spec §6)", () => {
  it("starting a task never closes another; each gets its own lane", async () => {
    const { board, made } = harness();
    await board.start("intro");
    await board.start("plan");
    expect(made.filter((l) => l.started.length > 0).map((l) => l.started[0])).toEqual(["intro", "plan"]);
    expect(made.some((l) => l.closed)).toBe(false);
    expect((await board.list()).map((s) => s.id)).toEqual(["t1", "t2"]);
  });
  it("the new task is focused; focus(id) switches; unknown ids are refused (P1)", async () => {
    const { board, file } = harness();
    await board.start("intro");
    await board.start("plan");
    expect(file().focus).toBe("t2");
    await board.focus("t1");
    expect(file().focus).toBe("t1");
    await expect(board.focus("nope")).rejects.toThrow("Unknown task");
    await board.focus(null);
    expect(file().focus).toBeNull();
  });
  it("finish acts on the focused task only", async () => {
    const { board, made } = harness();
    await board.start("intro");
    await board.start("plan");
    await board.focus("t1");
    await board.finish();
    expect(made.find((l) => l.id === "t1")?.closed).toBe(true);
    expect(made.find((l) => l.id === "t2")?.closed).toBe(false);
  });
  it("loads open lanes from tasks.json at start (resume after a restart)", async () => {
    const h = harness();
    await h.board.start("intro");
    const again = new TaskBoard({
      file: { load: async () => structuredClone(h.file()), save: async () => {} },
      newLane: (id) => ({ id, start: async () => {}, ask: async () => {}, isBusy: () => false, view: async () => ({ current: null, actions: {}, notes: [] }), finish: async () => true, cancel: () => {}, interrupt: async () => {}, close: async () => {} }),
      newId: () => "x",
      changed: () => {},
    });
    await again.restore();
    expect(again.laneIds()).toEqual(["t1"]);
  });
});
```

- [ ] **Step 2: Run to see it fail.** Expected: FAIL.

- [ ] **Step 3: Implement.** The board's public surface mirrors what `index.ts` calls on `tasks` (the method list in `TaskManager`): `start`, `ask`, `startPrepared`, `choose`, `respond`, `chooseMode`, `setPhase`, `switchScope`, `currentScope`, `chatScope`, `runningTask`, `openPhase`, `trailerNow`, `finish`, `cancel`, `pauseTimeBox`, `resumeTimeBox`, `extendTimeBox`, `close`, `interrupt`, `resumeFromNotes`, `checkpointBeforeMove`, `sessionStarted`, `whenNoTask`, `isBusy`, `idle`, `view`. Every per-task method goes to `this.focused()`.

```ts
// packages/shell/src/main/task-board.ts
import type { TaskView } from "@humanharness/ui/client";
import type { TasksFile } from "./task-store";

/** What the board needs from one lane: a TaskManager (its methods have the same names) plus close. */
export interface LaneHandle {
  readonly id: string;
  start(action: string, display?: string, scope?: string, mode?: string, opts?: { timeBox?: number | null }): Promise<void>;
  ask(text: string, display?: string, scope?: string): Promise<void>;
  isBusy(): boolean;
  view(): Promise<TaskView>;
  finish(): Promise<boolean>;
  cancel(): void;
  interrupt(): Promise<void>;
  /** Closes its slot and listeners (the task already ended, or the app quits). */
  close(): Promise<void>;
  [method: string]: unknown;
}

export interface BoardDeps {
  /** The real tasks.json (not a lane's view). */
  file: { load(): Promise<TasksFile>; save(s: TasksFile): Promise<void> };
  /** Builds a lane whose task will have `id` (its TaskManager's `newId`). */
  newLane(id: string): LaneHandle;
  newId(): string;
  /** The board's summary or the focused view changed: tell the window. */
  changed(): void;
}

/**
 * Every open task as a lane (parallel spec §6). One idle lane stands for the start view (Decision 4): a start or a
 * question goes to it, and it becomes that task's lane. The focused lane is the one the window shows; closing, "next"
 * and the guided path act on it only.
 */
export class TaskBoard {
  private readonly lanes = new Map<string, LaneHandle>();
  private idle: LaneHandle | null = null;
  private focusId: string | null = null;
  private ops: Promise<unknown> = Promise.resolve();

  constructor(private readonly d: BoardDeps) {}

  /** Reopens the lanes tasks.json lists (after a restart). */
  async restore(): Promise<void> {
    const f = await this.d.file.load();
    for (const t of f.lanes ?? []) if (!this.lanes.has(t.id)) this.lanes.set(t.id, this.d.newLane(t.id));
    this.focusId = typeof f.focus === "string" && this.lanes.has(f.focus) ? f.focus : null;
  }

  laneIds(): string[] {
    return [...this.lanes.keys()];
  }

  lane(id: string): LaneHandle | undefined {
    return this.lanes.get(id);
  }

  /** The lane the window shows, or the idle lane (start view). */
  focused(): LaneHandle {
    if (this.focusId !== null) {
      const l = this.lanes.get(this.focusId);
      if (l) return l;
    }
    return this.idleLane();
  }

  start(action: string, display?: string, scope?: string, mode?: string, opts?: { timeBox?: number | null }): Promise<void> {
    return this.begin((l) => l.start(action, display, scope, mode, opts));
  }

  ask(text: string, display?: string, scope?: string): Promise<void> {
    // A question in an open task's chat goes to that task; at the start view it starts a new one (as today).
    if (this.focusId !== null && this.lanes.has(this.focusId)) return this.lanes.get(this.focusId)!.ask(text, display, scope);
    return this.begin((l) => l.ask(text, display, scope));
  }

  async focus(id: string | null): Promise<void> {
    if (id !== null && (typeof id !== "string" || !this.lanes.has(id))) throw new Error("Unknown task");
    this.focusId = id;
    await this.writeFocus();
    this.d.changed();
  }

  finish(): Promise<boolean> {
    return this.focused().finish();
  }

  cancel(): void {
    this.focused().cancel();
  }

  isBusy(): boolean {
    return [...this.lanes.values()].some((l) => l.isBusy()) || (this.idle?.isBusy() ?? false);
  }

  view(): Promise<TaskView> {
    return this.focused().view();
  }

  /** Every lane ends unfinished (engine switch, spec §10; Decision 14). */
  async interruptAll(): Promise<void> {
    for (const l of [...this.lanes.values()]) await l.interrupt().catch((err: unknown) => console.error("Could not end a task", err));
  }

  /** A lane's task ended (note saved, cancelled): drop it; focus falls back to the start view. */
  async laneEnded(id: string): Promise<void> {
    const l = this.lanes.get(id);
    if (!l) return;
    this.lanes.delete(id);
    await l.close().catch((err: unknown) => console.error("Could not close a lane", err));
    if (this.focusId === id) {
      this.focusId = null;
      await this.writeFocus();
    }
    this.d.changed();
  }

  async list(): Promise<{ id: string }[]> {
    return [...this.lanes.keys()].map((id) => ({ id }));
  }

  private idleLane(): LaneHandle {
    this.idle ??= this.d.newLane(this.d.newId());
    return this.idle;
  }

  /** Runs `fn` on the idle lane; once it has a task, it becomes an open lane and gets the focus. */
  private begin(fn: (l: LaneHandle) => Promise<void>): Promise<void> {
    const run = this.ops.then(async () => {
      const l = this.idleLane();
      this.idle = null;
      this.lanes.set(l.id, l);
      this.focusId = l.id;
      await this.writeFocus();
      this.d.changed();
      try {
        await fn(l);
      } finally {
        if ((await l.view()).current === null && !l.isBusy()) await this.laneEnded(l.id);
      }
    });
    this.ops = run.catch(() => undefined);
    return run;
  }

  private async writeFocus(): Promise<void> {
    const f = await this.d.file.load();
    await this.d.file.save({ ...f, focus: this.focusId });
  }
}
```

Two points need care:
- `begin` serializes only the **creation** of a lane, so two quick starts get two lanes. It awaits the start op, which in a `TaskManager` resolves once its first turn is done. Make sure only lane creation is serialized: `begin` must **not** hold `ops` across the whole first turn. Move the `await fn(l)` out of the `ops` chain: set the lane up inside `ops`, then run `fn(l)` outside it. The first test checks this (two starts, two lanes) and only passes with that fix in place. Write it that way from the start.
- `list()` returns ids only here. Task 8 replaces it with full `TaskSummary`s.

- [ ] **Step 4: Run the tests.** Expected: PASS.

- [ ] **Step 5: Typecheck, test, commit.**

```bash
git -C <worktree> add packages/shell/src/main/task-board.ts packages/shell/test/task-board.test.ts
git -C <worktree> commit -m "feat(shell): a board of open tasks, one lane each, with focus

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 7: Board edge cases — scope switch, move, engine switch, quit, idle sleep

**Files:**
- Modify: `packages/shell/src/main/task-board.ts`
- Test: `packages/shell/test/task-board.test.ts` (append)

- [ ] **Step 1: Write the failing tests** (reuse Task 6's `harness()`; give `FakeLane` `checkpointBeforeMove`, `sleep` and a `scope`):

```ts
describe("board edge cases (parallel spec §10)", () => {
  it("switchScope never closes a lane; focus goes to that scope's newest lane or the start view (Decision 5)", async () => {
    const { board, made, file } = harness();
    await board.start("intro", undefined, "s1");
    await board.start("plan", undefined, "s2");
    expect(await board.switchScope("s1")).toBe(true);
    expect(file().focus).toBe("t1");
    expect(file().open).toBe("s1");
    expect(made.some((l) => l.closed)).toBe(false);
    await board.switchScope("s3");
    expect(file().focus).toBeNull();
  });
  it("checkpointAllBeforeMove runs each waiting lane's checkpoint one at a time", async () => {
    const { board, made } = harness();
    await board.start("a");
    await board.start("b");
    const order: string[] = [];
    for (const l of made) (l as unknown as { checkpointBeforeMove: () => Promise<void> }).checkpointBeforeMove = async () => void order.push(l.id);
    await board.checkpointAllBeforeMove();
    expect(order).toEqual(["t1", "t2"]);
  });
  it("interruptAll ends every lane (engine switch)", async () => {
    const { board, made } = harness();
    await board.start("a");
    await board.start("b");
    await board.interruptAll();
    expect(made.filter((l) => l.started.length > 0).every((l) => l.closed)).toBe(true);
  });
  it("a waiting ACP lane sleeps after 10 minutes; a new turn wakes it (spec §4, open question 7)", async () => {
    const timers: { fn: () => void; ms: number }[] = [];
    const sleep = vi.fn(async () => {});
    const { board } = harness();
    board.setIdleSleep({ ms: 600_000, timer: { set: (fn, ms) => (timers.push({ fn, ms }), timers.length), clear: () => {} }, sleep });
    await board.start("a");
    board.laneWaiting("t1");
    expect(timers.at(-1)?.ms).toBe(600_000);
    timers.at(-1)!.fn();
    expect(sleep).toHaveBeenCalledWith("t1");
  });
});
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement** in `TaskBoard`:

```ts
  /** Opens scope `id` (null: none) without closing a lane; focus: its newest lane, or the start view (Decision 5). */
  async switchScope(id: string | null): Promise<boolean> {
    const f = await this.d.file.load();
    const inScope = (f.lanes ?? []).filter((t) => (t.scope ?? "main") === (id ?? "main") && this.lanes.has(t.id));
    const newest = inScope.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
    this.focusId = newest?.id ?? null;
    const next: TasksFile = { ...f, focus: this.focusId };
    if (id === null) delete next.open;
    else next.open = id;
    await this.d.file.save(next);
    this.d.changed();
    return true;
  }

  async currentScope(): Promise<string | null> {
    return (await this.d.file.load()).open ?? null;
  }

  /** Folder move (spec §10): each lane's checkpoint, one at a time; the lanes then resume from notes as today. */
  async checkpointAllBeforeMove(): Promise<void> {
    for (const l of [...this.lanes.values()]) {
      const fn = l.checkpointBeforeMove as (() => Promise<void>) | undefined;
      if (fn) await fn.call(l).catch((err: unknown) => console.error("Could not checkpoint a task before the move", err));
    }
  }

  private sleepCfg: { ms: number; timer: { set(fn: () => void, ms: number): unknown; clear(h: unknown): void }; sleep(id: string): Promise<void> } | null = null;
  private readonly sleepTimers = new Map<string, unknown>();

  /** Board host: put a waiting lane's ACP adapter to sleep after `ms` (spec §4). Claude lanes pass a no-op `sleep`. */
  setIdleSleep(cfg: NonNullable<TaskBoard["sleepCfg"]>): void {
    this.sleepCfg = cfg;
  }

  /** A lane started waiting for the person: arm its sleep timer. */
  laneWaiting(id: string): void {
    const cfg = this.sleepCfg;
    if (!cfg || !this.lanes.has(id)) return;
    this.laneActive(id);
    this.sleepTimers.set(id, cfg.timer.set(() => {
      this.sleepTimers.delete(id);
      void cfg.sleep(id).catch((err: unknown) => console.error("Could not put an idle session to sleep", err));
    }, cfg.ms));
  }

  /** A lane runs a turn again (or ended): no sleep pending. */
  laneActive(id: string): void {
    const h = this.sleepTimers.get(id);
    if (h !== undefined) this.sleepCfg?.timer.clear(h);
    this.sleepTimers.delete(id);
  }
```

`laneEnded` also calls `laneActive(id)`. `currentScope`/`chatScope` in board mode: `chatScope()` returns the focused lane's task scope, or the open scope at the start view.

Quit (Decision 16): `closeAll()` cancels every lane (`cancel()`), awaits `close()` on each, and leaves tasks.json as is. The next start's `cleanLanes(…, { interrupted: true })` ends them. Add `closeAll()` with a small test: after it, every lane's `close` was called.

- [ ] **Step 4: Run the tests.** Expected: PASS.

- [ ] **Step 5: Typecheck, test, commit.**

```bash
git -C <worktree> add packages/shell/src/main/task-board.ts packages/shell/test/task-board.test.ts
git -C <worktree> commit -m "feat(shell): the board across scopes, folder moves, engine switch, quit and idle sessions

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 8: Summaries and event routing — only the focused lane talks to the window

**Files:**
- Create: `packages/shell/src/main/live-buffer.ts`
- Modify: `packages/shell/src/main/task-board.ts`, `packages/ui/src/client.ts`, `packages/ui/src/state.ts`
- Test: `packages/shell/test/live-buffer.test.ts`, `packages/shell/test/task-board.test.ts` (append), `packages/ui/test/state.test.ts` (append; create if absent)

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/shell/test/live-buffer.test.ts
import { describe, expect, it } from "vitest";
import { LiveBuffer } from "../src/main/live-buffer";

describe("LiveBuffer (Decision 6)", () => {
  it("keeps a lane's events from its last user line until done; a new user line starts over", () => {
    const b = new LiveBuffer(5);
    b.user("t1", { text: "hi", at: "2026-10-28T10:00:00Z" });
    b.event("t1", { type: "text", delta: "a" });
    expect(b.live("t1")).toEqual({ user: { text: "hi", at: "2026-10-28T10:00:00Z" }, events: [{ type: "text", delta: "a" }] });
    b.event("t1", { type: "done", ok: true });
    expect(b.live("t1")).toBeUndefined();
    expect(b.live("nobody")).toBeUndefined();
  });
  it("keeps at most `max` events, oldest dropped", () => {
    const b = new LiveBuffer(2);
    b.user("t1", { text: "x", at: "t" });
    for (const d of ["1", "2", "3"]) b.event("t1", { type: "text", delta: d });
    expect(b.live("t1")?.events.map((e) => (e as { delta: string }).delta)).toEqual(["2", "3"]);
  });
});
```

Append to `task-board.test.ts`:

```ts
describe("summaries (parallel spec §9.1)", () => {
  it("lists every open task with its state; queued wins over running", async () => {
    const { board } = harness();
    await board.start("intro");
    await board.start("plan");
    board.setQueued((id) => id === "t2");
    const list = await board.summaries({ label: (t) => t.action ?? "Question" });
    expect(list).toEqual([
      expect.objectContaining({ id: "t1", state: "waiting", waitingFor: "message", action: "intro", label: "intro", tokens: 0 }),
      expect.objectContaining({ id: "t2", state: "queued", action: "plan" }),
    ]);
  });
});
```

`ui/test/state.test.ts`:

```ts
it("resume: a live turn without a new user entry (parallel spec Decision 6)", () => {
  const s = reduceChat(initialChat([]), { type: "resume", at: "2026-10-28T10:00:00Z" });
  expect(s.live).not.toBeNull();
  expect(s.entries).toEqual([]);
  const t = reduceChat(s, { type: "text", delta: "hi" });
  expect(t.live?.text).toBe("hi");
});
```

(Use the real field name of the live turn's text in `ChatState`.)

- [ ] **Step 2: Run them to see them fail.**

- [ ] **Step 3: Implement.**

`ui/src/client.ts`:

```ts
/** One open task as the inbox and a harness's own panel see it (parallel spec §9.1). */
export interface TaskSummary {
  id: string;
  scope: string;
  action: string | null;
  label: string;
  state: "running" | "waiting" | "queued" | "closing" | "checkpoint";
  /** message: the agent finished its turn · answer: an open choices/input block · phase: a phase proposal. */
  waitingFor?: "message" | "answer" | "phase";
  phase?: string;
  startedAt: string;
  tokens: number;
  /** Paths another task also changed (spec §5.3). */
  conflict?: string[];
  /** The focused task (the one the window shows). */
  focused?: true;
}

/** What `tasks.list` answers: the open tasks, the queue pause, and the caps. */
export interface TasksState {
  tasks: TaskSummary[];
  paused?: { reason: "out-of-quota" | "folder-move"; resetsAt?: string };
  caps: ParallelCaps;
}
```

`ChatLoad` gains `/** Board mode: the focused task's turn still running, to replay (Decision 6). */ live?: { user: { text: string; at: string }; events: Event[] };`. Import `Event` from the runtime types as client.ts already does for `ChatAction`; if it doesn't, use the type `state.ts` uses.

`HarnessClient` gains:

```ts
  /** Open tasks (parallel spec §9.1). Only with `state.parallel` (D7). */
  tasks: {
    list(): Promise<TasksState>;
    onChange(listener: (state: TasksState) => void): () => void;
    /** null: the start view. */
    focus(id: string | null): Promise<void>;
    /** Takes a queued message out; its text, for the box (Decision 7). Null when it already started. */
    cancelQueued(id: string): Promise<string | null>;
    /** Resumes the queues paused by an out-of-quota end (spec §7). */
    resumeQueues(): Promise<void>;
  };
```

`state.ts`: `ChatAction` gains `| { type: "resume"; at: string }`. The reducer case builds the same `live` object `"user"` builds, without appending an entry:

```ts
    case "resume":
      return { ...state, live: newLive(action.at) };
```

Extract `newLive(at)` from the `"user"` case so both use it.

`live-buffer.ts`:

```ts
import type { Event } from "@humanharness/runtime";

/** Each lane's events since its last user line, until its `done` (Decision 6): what focusing that lane replays. */
export class LiveBuffer {
  private readonly turns = new Map<string, { user: { text: string; at: string }; events: Event[] }>();

  constructor(private readonly max = 2000) {}

  user(lane: string, user: { text: string; at: string }): void {
    this.turns.set(lane, { user, events: [] });
  }

  event(lane: string, e: Event): void {
    const t = this.turns.get(lane);
    if (!t) return;
    if (e.type === "done") {
      this.turns.delete(lane);
      return;
    }
    t.events.push(e);
    if (t.events.length > this.max) t.events.splice(0, t.events.length - this.max);
  }

  live(lane: string): { user: { text: string; at: string }; events: Event[] } | undefined {
    const t = this.turns.get(lane);
    return t ? { user: t.user, events: [...t.events] } : undefined;
  }

  drop(lane: string): void {
    this.turns.delete(lane);
  }
}
```

`TaskBoard` gains:
- a `setQueued(fn)` hook, set by the host to `gate.isQueued`;
- `summaries({ label })`. It reads the file's `lanes` and maps each to a `TaskSummary`:
  - `state`: `queued` when `isQueued(id)`, otherwise the task's `status`;
  - `waitingFor`: `"answer"` when `pendingInput` is set, `"phase"` when `phaseProposal` is set, otherwise `"message"`, only for `waiting`;
  - `scope`: `scope ?? "main"`;
  - `action`: `action ?? null`;
  - `phase`: `phase?.id`;
  - `tokens`: `tokens ?? 0`;
  - `conflict` and `startedAt` as stored;
  - `focused`.

  Order: oldest first.

Event routing lives in the host (Task 9), with this rule. Each lane's `TurnController.emit` is `(e) => { buffer.event(lane, e); if (board.isFocused(lane)) emitToWindow(e); }`; each lane's user line goes to `buffer.user`; `hh:loadChat` in board mode returns `live: buffer.live(focused)`. Add `isFocused(id)` to the board.

- [ ] **Step 4: Run the tests.** Expected: PASS.

- [ ] **Step 5: Typecheck, test, commit.**

```bash
git -C <worktree> add packages/shell/src/main/live-buffer.ts packages/shell/src/main/task-board.ts packages/ui/src/client.ts packages/ui/src/state.ts packages/shell/test/live-buffer.test.ts packages/shell/test/task-board.test.ts packages/ui/test/state.test.ts
git -C <worktree> commit -m "feat(shell): task summaries and a live buffer per lane for the focused chat

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 9: The board host — workspace, lanes' deps, IPC, undo by paths

This is the wiring task. `index.ts` changes only at three points:
- where `runtime`/`turns`/`tasks` are built;
- `currentHistory`;
- the IPC registrations.

Everything else goes in `board-host.ts`.

**Files:**
- Create: `packages/shell/src/main/board-host.ts`, `packages/shell/src/main/restore-paths.ts`
- Modify: `packages/shell/src/main/index.ts`
- Test: `packages/shell/test/board-host.test.ts`, `packages/shell/test/restore-paths.test.ts`, `packages/shell/test/ipc-surface.test.ts` (stays green)

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/shell/test/restore-paths.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { History } from "@humanharness/workspace";
import { restoreTaskByPaths } from "../src/main/restore-paths";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-rpaths-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
let folder: string;
let history: History;
const write = (rel: string, c: string) => fs.writeFileSync(path.join(folder, rel), c);
const read = (rel: string) => fs.readFileSync(path.join(folder, rel), "utf8");

beforeEach(async () => {
  const base = fs.mkdtempSync(path.join(root, "b-"));
  folder = path.join(base, "w");
  fs.mkdirSync(folder);
  history = new History(folder, path.join(base, "h.git"), [".harness/"]);
  await history.init();
  write("a.md", "a0");
  write("b.md", "b0");
  await history.save("Start");
});

describe("undo a task by its paths (parallel spec §5.3, Decision 12, P2)", () => {
  it("restores only the task's own paths; another task's stay", async () => {
    await history.save("Before message", { task: "t1" });
    write("a.md", "a1");
    await history.commitPaths(["a.md"], "Turn: A", { task: "t1" });
    write("b.md", "b1");
    await history.commitPaths(["b.md"], "Turn: B", { task: "t2" });
    const r = await restoreTaskByPaths(history, "t1", { running: [], includeShared: false });
    expect(r).toMatchObject({ ok: true, paths: ["a.md"] });
    expect(read("a.md")).toBe("a0");
    expect(read("b.md")).toBe("b1");
  });
  it("refused while a running turn touched one of its paths; names the file", async () => {
    await history.save("Before message", { task: "t1" });
    write("a.md", "a1");
    await history.commitPaths(["a.md"], "Turn: A", { task: "t1" });
    const r = await restoreTaskByPaths(history, "t1", { running: [{ task: "t2", paths: new Set(["a.md"]) }], includeShared: false });
    expect(r).toEqual({ ok: false, reason: "running", path: "a.md" });
    expect(read("a.md")).toBe("a1");
  });
  it("shared paths only after confirm", async () => {
    await history.save("Before message", { task: "t1" });
    write("a.md", "a1");
    await history.commitPaths(["a.md"], "Turn: A", { task: "t1" });
    write("b.md", "b1");
    await history.commitPaths(["b.md"], "Shared: A", { task: "t1", shared: ["t2"] });
    expect(await restoreTaskByPaths(history, "t1", { running: [], includeShared: false })).toMatchObject({ paths: ["a.md"], sharedLeft: ["b.md"] });
    expect(read("b.md")).toBe("b1");
  });
});
```

```ts
// packages/shell/test/board-host.test.ts
import { describe, expect, it } from "vitest";
import { hostMode } from "../src/main/board-host";

describe("hostMode (D7)", () => {
  it("plain without parallel or jobs; board with parallel", () => {
    expect(hostMode({})).toBe("plain");
    expect(hostMode({ parallel: { tasks: 1, jobs: 1 } })).toBe("board");
  });
});
```

Then add three tests that build a real board host with the fake-claude engine and a temp folder, in the style of the existing shell tests that drive a `TaskManager` with a real `TurnController` (read `packages/shell/test/task-manager.test.ts` for its fakes):
1. two lanes' first turns both run under cap 2, and their `send`s overlap in time;
2. under cap 1 the second waits, and its summary says `queued`;
3. a data request on lane B's socket reports lane B's running task (P3).

These use the host's `createBoardHost(deps)` with an injected `createWorkspace` that returns a fake workspace: `openSlot` gives a slot whose `send` resolves when the test says so.

- [ ] **Step 2: Run them to see them fail.**

- [ ] **Step 3: Implement `restore-paths.ts`.**

```ts
// packages/shell/src/main/restore-paths.ts
import { type History, RESTORE_TASK, ownedPathsOf, sharedPathsOf } from "@humanharness/workspace";

export type RestoreByPaths =
  | { ok: true; paths: string[]; sharedLeft: string[]; skipped: string[] }
  | { ok: false; reason: "running"; path: string }
  | { ok: false; reason: "nothing" };

/**
 * "Undo this task" in board mode (parallel spec §5.3): its own paths (and its shared ones when `includeShared`) back
 * to how they were at its start, in one commit. Refused while a running turn touched one of them (P2): the answer names
 * the file.
 */
export async function restoreTaskByPaths(
  history: History,
  task: string,
  o: { running: readonly { task: string; paths: ReadonlySet<string> }[]; includeShared: boolean },
): Promise<RestoreByPaths> {
  const group = (await history.tasks(200, { ownCommits: true })).find((g) => g.taskId === task);
  if (!group?.start) return { ok: false, reason: "nothing" };
  const owned = await ownedPathsOf(history, group);
  const shared = await sharedPathsOf(history, group);
  const paths = [...new Set([...owned, ...(o.includeShared ? shared : [])])].sort();
  for (const p of paths) if (o.running.some((r) => r.task !== task && r.paths.has(p))) return { ok: false, reason: "running", path: p };
  const r = await history.restorePaths(paths, group.start, RESTORE_TASK, { task });
  return { ok: true, paths, sharedLeft: o.includeShared ? [] : shared.filter((p) => !owned.includes(p)), skipped: r.skipped };
}
```

The `running` list comes from the workspace's ledger. Expose `HarnessWorkspace.runningPaths(): { task; paths }[]` as each running window's `edits` ∪ `changedSince(startDirty)`. This is a small addition to part 1's `workspace.ts`; add its test to `workspace.test.ts`.

- [ ] **Step 4: Implement `board-host.ts`.**

```ts
// packages/shell/src/main/board-host.ts  (outline with every piece; fill each from index.ts's plain wiring)
import { isConcurrent } from "@humanharness/harness-sdk";

export type HostMode = "plain" | "board";

/** Plain: today's single runtime and task (D7). Board: the harness declares `parallel`. Part 3 adds "single" for jobs. */
export function hostMode(harness: { parallel?: unknown }): HostMode {
  return isConcurrent(harness as never) ? "board" : "plain";
}
```

`createBoardHost(deps)` builds and returns `{ board, gate, workspace, history(), lane(id), loadChat(), tasksState(), closeAll(), dropAll() }`. Its deps are the closures `index.ts` already has:
- `config`, `validConfig`, `baseOf`, `taskStoreOptions`;
- `runtimeOptions()`: **extract** from `index.ts`'s `runtime` memo the object it passes to `createRuntime`, into a function both paths call. The plain path's call is unchanged, character for character;
- `turnDeps`: the `TurnController` deps object minus `chatLog`;
- `taskDeps`: the `TaskManager` deps object minus `store`, `turns`, `changed`, `emit`, `newId`, `endSession`, `sessionStarted`;
- `emitToWindow`, `sendToWindow`.

Inside it:
1. **The workspace**, memoised like `runtime`: `createWorkspace({ ...runtimeOptions(), data: (r, slot) => agentDataRequest({ store, runningTask: () => board.runningTaskOf(slot.key), plugin }, r), material: … })`. Run `migrateChats(base, openLanes)` once, before the first workspace opens.
2. **A lane** `newLane(id)`:
   - `slot`: memoised `ws.openSlot({ key: id, session: storedSession(id), onSession: (s) => lanes.get(id)?.sessionStarted(s) })`;
   - `controller = new TurnController({ ...turnDeps, ensureRuntime: async () => { guards…; return slot(); }, chatLog: async (chat) => new ChatLog(base, engineId, chat, id), emit: (e) => route(id, e) })`;
   - `turns = gatedTurns(id, gate, controller, { cap: "tasks", emit: (e) => route(id, e) })`;
   - `manager = new TaskManager({ ...taskDeps, store: new LaneStore(fileStore, id), turns, newId: () => id, changed: () => board.laneChanged(id), emit: (e) => route(id, e), endSession: async () => (await slot()).endSession() })`;
   - the lane = `manager` plus `close: async () => (await slot.peek())?.close()`.
3. **`route(id, e)`**: `buffer.event(id, e)`; if `board.isFocused(id)`, `emitToWindow(e)`.
4. **`board.laneChanged(id)`** (add it to the board):
   - recomputes summaries;
   - sends `hh:tasksChange`;
   - for the focused lane, sends `hh:tasks` with its view, as today's `changed`;
   - when its status became `waiting`, calls `board.laneWaiting(id)` and Task 11's attention hook;
   - when the lane's task is gone, calls `board.laneEnded(id)`.
5. **`gate.onChange`** sends `hh:tasksChange`.
6. **The refresh hold** (spec §10): `betweenTasks` becomes `refreshSoon()`. If `ws.anyRunning()` is false it runs the deps' `betweenTasks()` now. Otherwise it calls `gate.hold(10_000)`, runs `betweenTasks()` when the running count reaches 0 (via `gate.onChange`) or after 10 s, and on timeout leaves it pending for the next gap.

`index.ts` changes:
- At the top, after `harness` is loaded: `const mode = hostMode(harness);`.
- `runtime` stays as is. Extract its options into `runtimeOptions(c, base, cmd)` and call it from `createRuntime(...)` (the plain path's behaviour is unchanged).
- `turns` and `tasks` are built as today when `mode === "plain"`. When `mode === "board"`, `tasks` is the board host's `board` (typed as the TaskManager surface `index.ts` uses: declare `type TaskApi = Pick<TaskManager, …the methods in the grep list…>` and make both satisfy it).
- `currentHistory`/`openHistory`: in board mode, `(await host.workspace.peek())?.history` before the standalone one.
- `closeRuntime`: in board mode, `await host.closeAll()`.
- `dropRuntime`: in board mode, `await host.board.interruptAll(); host.gate.dropAll(); await host.closeAll();`.
- `hh:loadChat`: in board mode, `host.loadChat()`, which returns the focused lane's per-task chat and `live`.
- `hh:restoreTask` in board mode: `restoreWith((history) => restoreTaskByPaths(history, taskId, { running: ws.runningPaths(), includeShared }))`. It takes an optional second argument `includeShared: boolean` (validated: `typeof === "boolean"`, default false) and returns the result to the window.
- `RestoreGuard.busy()` in board mode is `host.board.isBusy()`. "Go back here" (`hh:restore`) stays whole-folder and refused while busy (Decision 12).
- New channels, all through `handle()`, all refusing in plain mode with `"No parallel tasks"`:

```ts
  handle("hh:tasksList", () => requireBoard().tasksState());
  handle("hh:tasksFocus", (id: unknown) => requireBoard().board.focus(id === null ? null : validTaskId(id)));
  handle("hh:tasksCancelQueued", (id: unknown) => requireBoard().gate.drop(validTaskId(id)));
  handle("hh:tasksResume", () => requireBoard().gate.resume());
```

with `validTaskId(v)`: a string of 1..200 characters, else throw `"Invalid task"`.

Update `test/ipc-surface.test.ts` only if it lists the channels explicitly (add the four).

- [ ] **Step 5: Run.** `corepack pnpm vitest run packages/shell/test`. Expected: PASS, every existing shell test included (the plain path is unchanged).

- [ ] **Step 6: Typecheck, test, build, commit.** `corepack pnpm typecheck && corepack pnpm test && corepack pnpm app:build`.

```bash
git -C <worktree> add packages/shell/src/main/board-host.ts packages/shell/src/main/restore-paths.ts packages/shell/src/main/index.ts packages/runtime/src/workspace.ts packages/runtime/test/workspace.test.ts packages/shell/test/board-host.test.ts packages/shell/test/restore-paths.test.ts packages/shell/test/ipc-surface.test.ts
git -C <worktree> commit -m "feat(shell): board mode runs one lane per open task on a shared workspace

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 10: Conflict notices and tokens per task

**Files:**
- Modify: `packages/shell/src/main/board-host.ts`
- Test: `packages/shell/test/board-host.test.ts` (append)

- [ ] **Step 1: Write the failing test.** Drive two lanes whose slots report an attribution through `onAttribution`. Pass `onAttribution` through `TurnController` → `rt.send` options. Add `onAttribution?` to `TurnOptions` and forward it in `TurnController.run` to `rt.send(..., { profile, trailer, onAttribution })`; it is ignored by `HarnessRuntime` on the plain path (one slot never overlaps).

```ts
it("a conflict marks both tasks and adds a notice to both chats (spec §5.3)", async () => {
  // lane t2's turn ends with { conflicts: [{ path: "spec.md", tasks: ["t1"] }] }
  // expect: tasks.json lanes t1 and t2 have conflict ["spec.md"];
  //         t2's chat gets a notice "Both tasks changed spec.md." now (route → window if focused, and appended to its log);
  //         t1's log gets the same notice appended; summaries show conflict on both.
});
it("tokens: each usage event adds its total to the lane's tokens", async () => { /* … */ });
```

Write both tests in full using the host fakes from Task 9 (the slot double calls `options.onAttribution(...)` before its `done`).

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**
- `TurnOptions.onAttribution?: (a: TurnAttribution) => void` in `turn-controller.ts`, forwarded to `rt.send`. `TurnRunner` stays `Pick<HarnessRuntime, "send">`: `HarnessRuntime.send`'s options are now `SlotSendOptions` (part 1 Task 8), so the type holds.
- In the board host, each lane's `TaskManager` gets `onAttribution` through a `gatedTurns` wrapper option, so `TaskManager` itself doesn't change. `gatedTurns(…, { onAttribution })` adds it to the options it forwards.
- On a conflict:
  - append `{ role: "assistant", text: t("parallel.conflict", { path }), notice: true }`, the same shape `ChatLog` uses for app notices (read how the window's `notice` entries are stored; if they aren't stored, emit a `notice`-type window action through `route` and skip the log);
  - update each involved lane's `conflict` (deduped, at most 20) through its `LaneStore`;
  - fire `laneChanged`.
- Tokens: in `route`, a `usage` event adds `input + output` to a pending per-lane counter, written once at the turn's `done` through the lane's `LaneStore`. Use the real `usage` event field names.

en.json, new block (this task creates it):

```json
  "parallel": {
    "conflict": "Both tasks changed {{path}}."
  }
```

(Use the interpolation syntax the file already uses.)

- [ ] **Step 4: Run.** Expected: PASS.

- [ ] **Step 5: Typecheck, test, build, commit.**

```bash
git -C <worktree> add packages/shell/src/main/board-host.ts packages/shell/src/main/gated-turns.ts packages/shell/src/main/turn-controller.ts packages/i18n/src/locales/en.json packages/shell/test/board-host.test.ts
git -C <worktree> commit -m "feat(shell): conflict notices on both tasks; tokens per open task

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 11: Waiting tasks in the shared attention store; Dock badge; OS notification

**Files:**
- Create: `packages/shell/src/main/attention-stores.ts`, `packages/shell/src/main/task-attention.ts`
- Modify: `packages/shell/src/main/plugins.ts` (one optional dep), `packages/shell/src/main/index.ts`, `packages/shell/src/main/board-host.ts`
- Test: `packages/shell/test/attention-stores.test.ts`, `packages/shell/test/task-attention.test.ts`; `plugins.test.ts` stays green

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/shell/test/task-attention.test.ts
import { describe, expect, it, vi } from "vitest";
import { TaskAttention } from "../src/main/task-attention";

function fakeStore() {
  const items = new Map<string, { title: string }>();
  return {
    items,
    raise: vi.fn(async (o: { kind: string; id: string }, input: { key: string; title: string }) => void items.set(`${o.id}/${input.key}`, input)),
    resolve: vi.fn(async (o: { kind: string; id: string }, key: string) => void items.delete(`${o.id}/${key}`)),
  };
}

describe("TaskAttention (parallel spec §9.2, Decision 10, P4)", () => {
  it("a waiting task raises one action item; leaving waiting resolves it", async () => {
    const store = fakeStore();
    const badge = vi.fn();
    const a = new TaskAttention({ store: async () => store as never, badge, notify: vi.fn(), notifyOn: () => false, windowFocused: () => true });
    await a.update([{ id: "t1", state: "waiting", label: "Intro" } as never]);
    expect(store.raise).toHaveBeenCalledWith({ kind: "task", id: "t1" }, expect.objectContaining({ key: "waiting", severity: "action", title: "Intro", target: { panel: "task", focus: "t1" } }));
    expect(badge).toHaveBeenLastCalledWith(1);
    await a.update([{ id: "t1", state: "running", label: "Intro" } as never]);
    expect(store.resolve).toHaveBeenCalledWith({ kind: "task", id: "t1" }, "waiting");
    expect(badge).toHaveBeenLastCalledWith(0);
  });
  it("an OS notification only when on and the window isn't focused; label only", async () => {
    const notify = vi.fn();
    const a = new TaskAttention({ store: async () => fakeStore() as never, badge: vi.fn(), notify, notifyOn: () => true, windowFocused: () => false });
    await a.update([{ id: "t1", state: "waiting", label: "Intro" } as never]);
    expect(notify).toHaveBeenCalledWith({ title: "Intro", body: expect.any(String) });
    await a.update([{ id: "t1", state: "waiting", label: "Intro" } as never]);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
```

```ts
// packages/shell/test/attention-stores.test.ts
import { describe, expect, it } from "vitest";
import { attentionStores } from "../src/main/attention-stores";

describe("one AttentionStore per base, shared (Decision 10, P5)", () => {
  it("the same base gives the same store; known origins come from every registered kind", async () => {
    const stores = attentionStores({ tagKey: async () => Buffer.alloc(32, 1) });
    stores.registerKnown("task", (id) => id === "t1");
    stores.registerKnown("plugin", (id) => id === "p");
    const a = await stores.forBase("/b", true);
    expect(a).toBe(await stores.forBase("/b", true));
    expect(stores.known({ kind: "task", id: "t1" })).toBe(true);
    expect(stores.known({ kind: "task", id: "t2" })).toBe(false);
    expect(stores.known({ kind: "plugin", id: "p" })).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to see them fail.**

- [ ] **Step 3: Implement.**

`attention-stores.ts` takes the body of `PluginsController.attentionStore` (HMAC sign/verify with `tagKey`) and keys stores by base. It exposes:
- `forBase(base, create)`;
- `registerKnown(kind, fn)`;
- `known(o)`.

`plugins.ts`:
- gains an optional dep `attentionStoreFor?: (base: string, create: boolean) => Promise<AttentionStore | null>`. When it's present, `attentionStore(c, create)` returns `this.d.attentionStoreFor(c.base, create)`. When it's absent, today's code runs unchanged, so `plugins.test.ts` stays green;
- registers its `known` rule via `stores.registerKnown("plugin", (id) => this.running.has(id) || this.crashedIds.has(id))`, passed in as an optional `registerKnown` dep.

Its `attentionView` already filters to plugin origins. Keep that filter for the plugins inbox: tasks show in the task inbox, and the badge combines both counts (below).

`index.ts`: build `attentionStores` once (`tagKey` = the same `sourceTagKey(path.join(appDir, "attention-key"), create)` the plugins controller gets now) and pass `attentionStoreFor` to the plugins controller. **Only in board mode** do anything new with it: the plain path passes nothing, so plugins build their store as today (D0).

`task-attention.ts`:

```ts
import type { AttentionStore } from "@humanharness/workspace";
import type { TaskSummary } from "@humanharness/ui/client";

/**
 * Waiting tasks as attention items, the Dock badge and the optional OS notification (parallel spec §9.2, Decision 10,
 * 11). Content stays out: the badge is a count, the item and the notification carry the task's label only (P4).
 */
export class TaskAttention {
  private waiting = new Set<string>();

  constructor(
    private readonly d: {
      store(): Promise<Pick<AttentionStore, "raise" | "resolve"> | null>;
      badge(count: number): void;
      notify(n: { title: string; body: string }): void;
      notifyOn(): boolean;
      windowFocused(): boolean;
      /** Items other sources (plugins) count toward the badge. */
      otherCount?(): number;
    },
  ) {}

  async update(tasks: readonly TaskSummary[]): Promise<void> {
    const now = new Set(tasks.filter((t) => t.state === "waiting").map((t) => t.id));
    const store = await this.d.store();
    for (const t of tasks) {
      if (!now.has(t.id) || this.waiting.has(t.id)) continue;
      await store?.raise({ kind: "task", id: t.id }, { key: "waiting", severity: "action", title: t.label, target: { panel: "task", focus: t.id } } as never);
      if (this.d.notifyOn() && !this.d.windowFocused()) this.d.notify({ title: t.label, body: "Waiting for you" });
    }
    for (const id of this.waiting) if (!now.has(id)) await store?.resolve({ kind: "task", id }, "waiting");
    this.waiting = now;
    this.d.badge(now.size + (this.d.otherCount?.() ?? 0));
  }
}
```

(Match `raise`'s real input type in `packages/workspace/src/attention.ts`: its fields, how `target` is typed, and whether `{ panel, focus }` takes a task id. If `target.panel` must name a plugin panel, add `{ task: string }` as a third target kind in `AttentionTarget` with its own test in the workspace attention tests, and make the plugins inbox ignore it.) Set the body string from en.json `parallel.waitingBody` ("Waiting for you") through the shell's i18n helper, as other main-process strings do; if main has no i18n helper, keep the English literal (plan 5a: English only).

In the board host, `laneChanged` calls `attention.update(await board.summaries(...))`.

`badge`: `(n) => app.dock?.setBadge(n > 0 ? String(n) : "")` (macOS; guard `app.dock`).

`notify`: `new Notification({ title, body }).show()` from Electron.

`windowFocused`: `window?.isFocused() ?? false`.

`notifyOn`: `(await config.load()).notifyWaiting === true`, cached in the host on each config save.

A click on the notification focuses the window and calls `board.focus(id)`.

- [ ] **Step 4: Run.** `corepack pnpm vitest run packages/shell/test`. Expected: PASS.

- [ ] **Step 5: Typecheck, test, build, commit.**

```bash
git -C <worktree> add packages/shell/src/main/attention-stores.ts packages/shell/src/main/task-attention.ts packages/shell/src/main/plugins.ts packages/shell/src/main/index.ts packages/shell/src/main/board-host.ts packages/shell/test/attention-stores.test.ts packages/shell/test/task-attention.test.ts packages/i18n/src/locales/en.json
git -C <worktree> commit -m "feat(shell): waiting tasks in the attention store, the Dock badge and an optional notification

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 12: Client `tasks` API in the preload and the fake client

**Files:**
- Modify: `packages/shell/src/preload/index.ts`, `packages/ui/test/fake-client.ts`
- Test: `packages/ui/test/client.test.ts` (append), `packages/shell/test/preload.test.ts` (if one exists)

- [ ] **Step 1: Write the failing test.** The fake client test checks the namespace exists, that `list()` answers `{ tasks: [], caps: { tasks: 1, jobs: 1 } }` by default, and that `emitTasks(state)` reaches `onChange` listeners.

- [ ] **Step 2: Run to see it fail.**

- [ ] **Step 3: Implement.**

Preload:

```ts
  tasks: {
    list: () => ipcRenderer.invoke("hh:tasksList"),
    onChange: (listener) => subscribe<TasksState>("hh:tasksChange", listener),
    focus: (id) => ipcRenderer.invoke("hh:tasksFocus", id),
    cancelQueued: (id) => ipcRenderer.invoke("hh:tasksCancelQueued", id),
    resumeQueues: () => ipcRenderer.invoke("hh:tasksResume"),
  },
```

The fake client gets a `tasks` namespace with a settable state, an `emitTasks(state)` helper, and spies on `focus`/`cancelQueued`/`resumeQueues`, in the style of its `attention` namespace.

- [ ] **Step 4: Run, typecheck, build.** `corepack pnpm typecheck && corepack pnpm test && corepack pnpm app:build`.

- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/shell/src/preload/index.ts packages/ui/test/fake-client.ts packages/ui/test/client.test.ts
git -C <worktree> commit -m "feat(ui): the client's tasks namespace

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 13: The inbox panel and its button

**Files:**
- Create: `packages/ui/src/parallel/useTasks.ts`, `packages/ui/src/parallel/Inbox.tsx`
- Modify: `packages/ui/src/HarnessApp.tsx` (the button in the top bar), `packages/ui/src/styles.css` (inbox styles, appended), `packages/i18n/src/locales/en.json` (`"parallel"` block)
- Test: `packages/ui/test/inbox.test.tsx`

- [ ] **Step 1: Write the failing tests.**

```tsx
// packages/ui/test/inbox.test.tsx
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderApp } from "./render";
import { fakeClient } from "./fake-client";

const summary = (id: string, state: string, extra: object = {}) => ({ id, scope: "main", action: "intro", label: `Task ${id}`, state, startedAt: "2026-10-28T10:00:00Z", tokens: 0, ...extra });

describe("Inbox (parallel spec §9.2)", () => {
  it("D0: no button without state.parallel", async () => {
    renderApp(fakeClient());
    await screen.findByRole("main");
    expect(screen.queryByRole("button", { name: /inbox/i })).toBeNull();
  });
  it("no button when the manifest says inbox: false; the client API still works", async () => {
    const c = fakeClient({ state: { parallel: { caps: { tasks: 2, jobs: 1 }, suggested: { tasks: 2, jobs: 1 }, inbox: false, notifyWaiting: false } } });
    renderApp(c);
    await screen.findByRole("main");
    expect(screen.queryByRole("button", { name: /inbox/i })).toBeNull();
  });
  it("four sections; the button counts waiting tasks; a row focuses its task", async () => {
    const c = fakeClient({ state: { parallel: { caps: { tasks: 2, jobs: 1 }, suggested: { tasks: 2, jobs: 1 }, inbox: true, notifyWaiting: false } } });
    c.tasks.set({ tasks: [summary("a", "waiting", { waitingFor: "answer" }), summary("b", "running"), summary("c", "queued")], caps: { tasks: 2, jobs: 1 } });
    renderApp(c);
    const button = await screen.findByRole("button", { name: "Inbox, 1 waiting" });
    fireEvent.click(button);
    expect(screen.getByRole("heading", { name: "Waiting for you" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Working" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Queued" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Jobs" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Task a/ }));
    await waitFor(() => expect(c.tasks.focus).toHaveBeenCalledWith("a"));
  });
  it("a queued row can be cancelled; a pause shows why and a Resume button", async () => {
    const c = fakeClient({ state: { parallel: { caps: { tasks: 1, jobs: 1 }, suggested: { tasks: 1, jobs: 1 }, inbox: true, notifyWaiting: false } } });
    c.tasks.set({ tasks: [summary("c", "queued")], caps: { tasks: 1, jobs: 1 }, paused: { reason: "out-of-quota", resetsAt: "2026-10-28T15:00:00Z" } });
    renderApp(c);
    fireEvent.click(await screen.findByRole("button", { name: /Inbox/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(c.tasks.cancelQueued).toHaveBeenCalledWith("c"));
    expect(screen.getByText(/Out of quota/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(c.tasks.resumeQueues).toHaveBeenCalled());
  });
});
```

(`renderApp`/`fakeClient`: use the real helpers in `packages/ui/test/render.tsx` and `fake-client.ts`, and how they take a partial state.)

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**

`useTasks.ts`: `useTasks(client, enabled)` loads `client.tasks.list()` once when `enabled`, subscribes to `onChange`, and returns the `TasksState | null`.

`Inbox.tsx`: a button `aria-label={t("parallel.inboxButton", { count })}` ("Inbox, {{count}} waiting"). It opens a popover (the same popover pattern `AttentionInbox.tsx` uses) with four `<section>`s, each with an `<h3>`:
- **Waiting for you**: `waiting`, newest first;
- **Working**: `running`, `closing`, `checkpoint`;
- **Queued**: `queued`, oldest first;
- **Jobs**: empty in part 2, with the text "No jobs" (part 3 fills it).

Each row is a button with the label, scope (when the harness has scopes), and a short state text:
- waiting: "Your turn" / "Has a question" / "Wants to change phase" from `waitingFor`;
- the phase;
- a "Both tasks changed …" chip when `conflict` is set.

A queued row also has "Cancel" (`cancelQueued`). Put the returned text in the chat box via the existing draft hook: read `ChatView`'s draft state, and if none is reachable, skip the refill and keep cancel only. Note it in carry-notes.

A pause line reads "Out of quota until {{time}}" (or "Out of quota" without a reset) with a "Resume" button.

`HarnessApp.tsx`: render `<Inbox>` in the top bar only when `state.parallel?.inbox`.

en.json `"parallel"` block additions:

```json
    "inboxButton": "Inbox, {{count}} waiting",
    "waitingTitle": "Waiting for you",
    "workingTitle": "Working",
    "queuedTitle": "Queued",
    "jobsTitle": "Jobs",
    "noJobs": "No jobs",
    "yourTurn": "Your turn",
    "hasQuestion": "Has a question",
    "wantsPhase": "Wants to change phase",
    "cancel": "Cancel",
    "resume": "Resume",
    "outOfQuota": "Out of quota",
    "outOfQuotaUntil": "Out of quota until {{time}}",
    "waitingBody": "Waiting for you",
    "newTask": "New task"
```

- [ ] **Step 4: Run.** `corepack pnpm vitest run packages/ui/test/inbox.test.tsx`, then the whole `packages/ui/test`. Expected: PASS.

- [ ] **Step 5: Typecheck, test, build, commit.**

```bash
git -C <worktree> add packages/ui/src/parallel packages/ui/src/HarnessApp.tsx packages/ui/src/styles.css packages/i18n/src/locales/en.json packages/ui/test/inbox.test.tsx
git -C <worktree> commit -m "feat(ui): the core inbox of open tasks

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 14: ChatView with several tasks; Settings › General caps and notification

**Files:**
- Create: `packages/ui/src/parallel/TaskStrip.tsx`
- Modify: `packages/ui/src/ChatView.tsx`, `packages/ui/src/HarnessApp.tsx`, `packages/ui/src/SettingsSheet.tsx`, en.json `"parallel"`
- Test: `packages/ui/test/parallel-chat.test.tsx`, `packages/ui/test/settings.test.tsx` (append)

- [ ] **Step 1: Write the failing tests.**

```tsx
// packages/ui/test/parallel-chat.test.tsx (outline → write in full with the file's helpers)
// 1. D0: without state.parallel the ChatView key is `${engineId}:${profile}:${openScope}` (assert by spying that loadChat
//    is called once and not again on a tasks change).
// 2. Board: a tasks change whose focused id differs remounts the chat (loadChat called again).
// 3. Board: loadChat answering `live` replays it: the user line from entries, then the live turn's text shows
//    ("hi" streamed) without a duplicated user line.
// 4. TaskStrip: shows the focused task's label and "New task", which calls tasks.focus(null).
```

Append to `settings.test.tsx`:

```tsx
it("General shows caps and the notification toggle only with state.parallel (D7)", async () => { /* without → absent; with → 'Tasks at once' select 1..8 = caps.tasks, 'Jobs at once', and 'Notify me when a task waits' off; changing saves config.parallel / notifyWaiting */ });
```

Write both test files in full using `render.tsx` and `fake-client.ts`.

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**

`HarnessApp.tsx`:

```tsx
const focus = state.parallel ? (tasksState?.tasks.find((t) => t.focused)?.id ?? "start") : null;
// …
<ChatView key={focus === null ? `${engineId}:${profile}:${openScope}` : `${engineId}:${profile}:${openScope}:${focus}`} … />
```

`tasksState` comes from `useTasks(client, !!state.parallel)`.

`ChatView.tsx`, in the existing load effect: after `loaded`, if the load answer has `live`, dispatch `{ type: "resume", at: live.user.at }` and then each of `live.events`. Nothing else changes.

`TaskStrip.tsx`: a thin bar above the chat (board mode only) with the focused task's label and phase, and a "New task" button (`tasks.focus(null)`).

`SettingsSheet.tsx` `GeneralTab`: a "Parallel tasks" section, only with `state.parallel`:
- "Tasks at once": a select 1..8 (`PARALLEL_MAX`), saving `config.parallel.tasks`;
- "Jobs at once": the same, saving `config.parallel.jobs`;
- "Notify me when a task waits": a checkbox, saving `notifyWaiting`.

When `heldReason === "engine"`, the tasks select is disabled with "This engine runs one task at a time".

Main applies new caps on config save: the board host's `gate.setCaps(effectiveCaps(...))`, wired in `index.ts`'s config-save handler, board mode only.

en.json additions: `"parallelSection": "Parallel tasks"`, `"tasksAtOnce": "Tasks at once"`, `"jobsAtOnce": "Jobs at once"`, `"notifyWaiting": "Notify me when a task waits"`, `"engineHeld": "This engine runs one task at a time"`.

- [ ] **Step 4: Run.** `corepack pnpm vitest run packages/ui/test`. Expected: PASS.

- [ ] **Step 5: Typecheck, test, build, commit.**

```bash
git -C <worktree> add packages/ui/src/parallel/TaskStrip.tsx packages/ui/src/ChatView.tsx packages/ui/src/HarnessApp.tsx packages/ui/src/SettingsSheet.tsx packages/shell/src/main/index.ts packages/i18n/src/locales/en.json packages/ui/test/parallel-chat.test.tsx packages/ui/test/settings.test.tsx
git -C <worktree> commit -m "feat(ui): one chat per open task with live replay; caps and notifications in Settings

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 15: The parallel fixture harness and fake-agent scenarios

**Files:**
- Create: `packages/fake-agent/fixtures/parallel-harness/` (`harness.config.ts`, `AGENTS.md`, `prompts/*.md`, `fake-script.json`)
- Test: `packages/harness-sdk/test/fixtures.test.ts` (or wherever fixtures are loaded in tests: it must load)

- [ ] **Step 1:** Copy the structure of `packages/fake-agent/fixtures/phases-harness/`. Manifest:
- `id: "parallel"`;
- `parallel: { tasks: 2, jobs: 1 }`;
- `permissions: { edit: "folder", exec: false, web: false }`;
- two actions, `write-a` and `write-b`, each with a one-line brief;
- a free question allowed;
- no scopes (keep the fixture small; scopes are covered by unit tests).

- [ ] **Step 2:** A fake-claude script with turns matched by the briefs' first words:
- **different files**: `write-a` emits `claudeEditLine("ea", "a.md")`, writes `a.md`, sleeps 800 ms, replies "Wrote a." `write-b` does the same for `b.md` with no sleep;
- **same file**: a question starting `both` writes `spec.md` with an edit line naming it, after a 400 ms sleep;
- every reply ends with a `choices` block (so the task waits), using the fixture's existing pattern for blocks in phases-harness.

Recorded scenarios (spec §11 "Fake agent"): store them as `fake-script.json` scenarios the e2e picks by `HH_FAKE_SCRIPT`.

- [ ] **Step 3:** Add the fixture to the test that loads every fixture (if such a test exists). Otherwise add `parallel-fixture.test.ts` that `loadHarness`es it and checks `isConcurrent` is true.

- [ ] **Step 4: Run, typecheck, commit.**

```bash
git -C <worktree> add packages/fake-agent/fixtures/parallel-harness packages/harness-sdk/test
git -C <worktree> commit -m "test(fake-agent): a parallel fixture harness with overlapping scenarios

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 16: End to end — two tasks at once, the inbox, undo one, cap 1 as today

**Files:**
- Create: `packages/e2e/tests/parallel.spec.ts`

- [ ] **Step 1: Write the e2e.** Build the fixture app the way `phases.spec.ts` does (`HH_HARNESS_DIR=<fixture> HH_OUT_DIR=<out>` + electron-vite build; copy its `beforeAll`). Tests:

1. **Two tasks in parallel with the inbox** (spec §11):
   - start `write-a`; at the start view (Inbox → New task) start `write-b`;
   - the inbox shows both under "Working", then both under "Waiting for you";
   - the badge button says "Inbox, 2 waiting";
   - `a.md` and `b.md` exist;
   - the history (read with isomorphic-git from the gitdir, as part 1 Task 12 does) has `Turn: …` commits whose trees differ only by their own file.
2. **Undo one without touching the other:**
   - open History, "Undo this task" on the `write-a` task;
   - `a.md` is gone, `b.md` is still there;
   - the `write-b` task is still open in the inbox.
3. **Focus replays a live turn:**
   - with `write-a` running (800 ms sleep), focus `write-b`, then `write-a` again;
   - the chat shows "Wrote a." when it ends, and the user line appears exactly once.
4. **Cap 1 (D7, spec §5.4):**
   - with Settings › General › "Tasks at once" = 1, start both;
   - the second shows "Queued" in the inbox until the first waits;
   - the commit subjects are, in order: `Before message`, `Turn: …`, `Before message`, `Turn: …`. No `Shared:` commit; same shape as the plain app.
5. **D0:** the demo-harness e2e suite (unchanged) still passes. Run the whole `corepack pnpm e2e`.

- [ ] **Step 2: Run.** `corepack pnpm app:build && corepack pnpm e2e`. Expected: green.

- [ ] **Step 3: Commit.**

```bash
git -C <worktree> add packages/e2e/tests/parallel.spec.ts
git -C <worktree> commit -m "test(e2e): two tasks at once, the inbox, undo one, and cap 1 as today

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 17: Docs, authoring guide and HARNESS.md template

**Files:**
- Modify: the architecture doc that describes `TaskManager` (find it with `grep -l "TaskManager" docs/architecture/*.md`), `docs/architecture/history.md`, the UI doc (`grep -l "AttentionInbox\|inbox" docs/architecture/*.md`), `packages/cli/guide/new-harness.md`, `packages/cli/template/HARNESS.md`

- [ ] **Step 1: Write.**
- **Tasks doc**, a "Parallel tasks (board mode)" section:
  - modes;
  - lanes and `LaneStore`;
  - the idle lane;
  - focus and event routing;
  - the gate and its queue;
  - per-task chats and the migration;
  - the edge cases (scope switch, move, engine switch, quit, idle sleep);
  - the D0 table.
- **History doc**: undo by paths in board mode; "Go back here" refused while busy.
- **UI doc**: the inbox, `client.tasks`, `inbox: false`, the Dock badge, notifications.
- **Guide and template**: when to declare `parallel` (independent tasks the person runs side by side) and when not to (one guided flow), `inbox: false` with `client.tasks` for a harness's own panel, and that caps are suggestions the person can change.

- [ ] **Step 2: Commit.**

```bash
git -C <worktree> add docs/architecture packages/cli/guide/new-harness.md packages/cli/template/HARNESS.md
git -C <worktree> commit -m "docs: parallel tasks, the inbox and how a harness declares them

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

## Self-review (done while writing)

- Spec coverage:
  - §6: Tasks 2, 5, 6, 7, 8, 9.
  - §7: Tasks 3, 4, 14. "Edit queued" is Decision 7.
  - §5.3 undo/refusal/conflict: Tasks 9, 10.
  - §9.1: Tasks 8, 12.
  - §9.2: Tasks 11, 13. The Jobs section is a placeholder until part 3.
  - §10: engine switch, move, quit, refresh hold: Tasks 7, 9. Usage `kind`: part 3.
  - §11 e2e: Task 16.
  - §4 idle adapters: Task 7.
- D0: the plain path is untouched. Every new behaviour hangs off `hostMode === "board"`.
- Types:
  - `TaskSummary`, `TasksState`, `ParallelInfo` are in client.ts (Tasks 1, 8);
  - `LaneHandle` in Task 6;
  - `TurnGate`/`Dropped` in Task 3;
  - `gatedTurns` in Task 4, extended with `onAttribution` in Task 10;
  - `restoreTaskByPaths` in Task 9;
  - `TaskAttention` in Task 11.
- Placeholders:
  - Task 9 Step 1's host tests and Task 10's tests are described in prose with exact assertions; the implementer writes them with the fakes named.
  - Task 14's test file is an outline with exact assertions. These sit on wiring whose fakes depend on part 1's actual code. The reviewer must check they exist and would fail without the change.
