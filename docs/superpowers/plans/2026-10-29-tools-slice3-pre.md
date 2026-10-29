# Tools and recipes, slice 3 (pre-steps) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship delivery slice 3 of the tools-and-recipes spec (§15.3): an action may declare `pre` steps (tool calls, with `input`, `forEach`, `as`, `required`) that run when the person presses Start, before the engine session opens; their results go into the first message under `## Prepared data` (cut to `preTokens`), each one a `"prepared"` start item in the context panel and one folded group in the chat; a phase may declare the tools it `expects`, and each miss is counted; `usage.jsonl` gets `pre` and `expects-miss` rows; the demo gets a real tool, `list-sources`, as a pre-step of its topics; `humanharness measure` reads the rows for the first measurement. A harness with no `pre` and no `expects` is byte for byte slice 2's app.

**Architecture.**

*SDK* (`packages/harness-sdk/src/steps.ts`, new): `toolStepSchema` (`{ tool, args?, input?, forEach?, as?, required? }`; slice 4 reuses it for job steps without `required`), `PRE_TOKENS_DEFAULT = 4000`, `hasPre(h)`, `hasExpects(h)`, `preProblems(m)` (manifest-only checks of §3.3: tools exist, `as` unique, `input`/`forEach` name an earlier `as`, `expects` name tools) and `stepProblems(m, json)` (the checks that need `tools.json`: a result fed to `input`/`forEach` comes from a tool that declares `returns`; a `forEach` result is an array whose items carry every required param the step's `args` don't give; `expects` names `agent: "call"` tools). `index.ts`: `actionSchema` gains `pre` and `preTokens`, `phaseSchema` gains `expects`. `tool.ts`: `ToolContext.inputs`.

*Main* (`packages/shell/src/main/tools/`):
- `pre-steps.ts` (new, pure over a registry double): `runPreSteps({ registry, steps, task, scope, phase, metaOf })` runs the steps in order through `registry.call` with `caller: "pre"`, expands `forEach` (≤ 100 items, 4 at a time, results in order), passes `input` results as `inputs`, and returns each `as` with its value or its failure, plus `required` failures.
- `prepared-section.ts` (new, pure): `preparedSection(results, preTokens)` → `{ text, items, cuts, tokens }`: the `## Prepared data` text (one block per `as`, compact JSON in a fence one longer than its longest backtick run), cut largest-first to `preTokens`, and one `ContextItem` of kind `"prepared"` per `as`.
- `expects.ts` (new, pure): `expectsMisses(entries, { task, phase, expects })`.
- `tool-registry.ts`, `tool-trace.ts`, `tool-host.ts`, `resources/tool-host.mjs`, `tool-protocol.ts` (slice 2's): a call carries `inputs`; `registry.meta(id)`; `registry.note({ tool, caller, task, phase?, text })` writes a trace entry whose `note` is the text (a cut, an expects miss) and reaches the chat as a line.
- `tools-host.ts` (slice 2's): `prepare(o)` (runs `runPreSteps` + `preparedSection`, writes the `pre` usage row, answers what `TaskDeps.prepare` needs) and `phaseEnded(o)` (reads the task's trace, writes `expects-miss` rows and trace notes). Agent and UI calls keep reaching the chat live; `caller: "pre"` calls don't (they come with the first turn, below).
- `task-manager.ts`: `TaskDeps.prepare?` and `TaskDeps.phaseEnded?`. `begin` takes the task id first, runs `prepare` for an action with `pre` before the task is written; a `required` failure ends the start with `fail("prepare-failed", detail)` (the chat's error card with Retry); otherwise the prepared text becomes a context part after the data tables (before pins and material) and its items join `start`. A resumed task runs nothing again. `enterPhase` and the closing turn call `phaseEnded` for the part the task leaves.
- `turn-controller.ts`: `TurnOptions.prepared?: ToolCallView[]`: the first turn shows them first, through the same path slice 2's `tool-call` events take into the live turn and its saved entry.
- `usage-log.ts`: `preRecord`, `expectsMissRecord`; `summarizeUsage` leaves these rows out of its turn walk.

*Window*: `ContextItemKind` gains `"prepared"`; `ToolCallView` gains `note?`; `PreparedGroup.tsx` folds a turn's leading `caller: "pre"` calls into one line ("Prepared 2 items · 0.4 s · 0 tokens"); `ErrorCard` shows `prepare-failed` with its detail and Retry.

*Demo*: `harnesses/demo/tools/list-sources.ts` (`uses: { files: "read" }`), `pre: [{ tool: "list-sources", as: "sources" }]` on the six topics, `harnesses/demo/dist/tools*` committed with a freshness test.

*CLI*: `humanharness measure [--folder <dir>]` (`packages/cli/src/measure.ts`) prints, per action, first-turn tokens of tasks with and without prepared data and the average `preparedTokens`.

**Tech Stack:** TypeScript, Zod 4 (`z.toJSONSchema` output read as JSON Schema), React 19, Vitest, Playwright (fake-claude scripts and mock mode).

**Spec:** `docs/superpowers/specs/2026-10-28-tools-and-recipes-design.md` §2 D5; §3 (the `pre`/`preTokens`/`expects` keys); §3.3 (the pre and expects rows); §4.2 (`ctx.inputs`); §5 (runner caller `pre`); §6, §6.1; §8.1–8.2 (pre lines, cuts); §8.4; §10 (failed pre-step); §13 (runner rows for pre, `expects`, e2e pre-step, demo); §14 (context panel, task phases); §15 slice 3. **Base:** slice 2's end on `feat/tools`. **Branch:** `feat/tools-pre`, created from `feat/tools` in Task 0.

---

## Conventions

As slices 1 and 2:
- worktree `/Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-sidekick`, never `cd` elsewhere;
- commands: one file `corepack pnpm vitest run <path>`; all `corepack pnpm typecheck` and `corepack pnpm test`; shell main, preload, resources or UI touched: `corepack pnpm app:build`; e2e `corepack pnpm --filter @humanharness/e2e exec playwright test <file>` (or `corepack pnpm e2e`);
- install nothing (no `pnpm install` of any kind, no `npx` that downloads; esbuild comes through tsx as `plugin build` uses it);
- git: `git -C <worktree> …`, one command per call; `git add` new files, then `git commit --only <every path of the task> -m … -m "<trailer>"`; never push, never a bare `git stash`, never commit on another branch;
- English everywhere; tests in `packages/<name>/test/`; one behaviour per `it`;
- en.json: only inside slice 2's top-level `"tools"` block (this slice adds keys there, never elsewhere);
- hot files (`index.ts`, `task-manager.ts`, `turn-controller.ts`, `usage-log.ts`, `client.ts`, `state.ts`, `ChatView.tsx`, `ContextPanel.tsx`, `task-store.ts`, `ErrorCard.tsx`, `events.ts`) changed small and additive.

Trailer:

```
Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv
```

**Security rules (every task).** Never read `~/.claude`, `~/.codex`, `~/.gemini`, `~/.config/opencode`, `~/.local/share/opencode`, `~/.ssh`, `~/.netrc` or any credential, token or account file. Tests never touch the real Keychain (fake `SecretCrypto`, `HH_TEST_FAKE_SECRETS=1` in e2e), never raise OS notifications or touch the Dock, never reach the network beyond 127.0.0.1. Never run the real `claude`, `codex` or `opencode` (e2e uses mock mode and fake-claude scripts). The first measurement with a real engine is Marco's, by hand (Task 14 ships the reader and the method, never a real run).

## Frozen files

Byte-identical at the end of every task (each task's last step runs both commands; both print nothing):

```bash
git -C <worktree> diff --stat feat/harness-hatches -- packages/shell/test/plugin-*.test.ts packages/shell/test/plugins-*.test.ts packages/shell/test/plugins-fixtures.ts packages/cli/test/plugin-*.test.ts packages/harness-sdk/test/plugin*.test.ts packages/harness-sdk/test/define-plugin.test.ts packages/e2e/tests/plugins.spec.ts packages/e2e/tests/plugins-surface.spec.ts packages/shell/test/jobs/ packages/harness-sdk/test/jobs.test.ts packages/blocks/test/ui-server-job.test.ts packages/ui/test/jobs-ui.test.tsx packages/e2e/tests/jobs.spec.ts
git -C <worktree> diff --stat feat/tools -- packages/runtime/test/runtime-d0.test.ts packages/runtime/test/hatches-d0.test.ts packages/runtime/test/claude-cli.test.ts packages/shell/test/hatches-surface.test.ts packages/e2e/tests/history.spec.ts packages/shell/test/usage-log.test.ts packages/shell/test/task-manager.test.ts packages/harness-sdk/test/tools.test.ts packages/shell/test/tools/tool-registry.test.ts packages/ui/test/tool-call-ui.test.tsx
```

The second list is compared with slice 2's end: slice 2's own D0 pins and today's task-manager and usage tests stay as they are; this slice's tests go in new files or are appended to new `describe` blocks in the files the tasks name.

## D0 is a hard rule

A harness whose actions declare no `pre` and whose phases declare no `expects` runs no slice-3 code:
- `defineHarness` output has no `pre`, `preTokens` or `expects` key on any action or phase;
- `TaskDeps.prepare` and `TaskDeps.phaseEnded` are absent (index.ts builds them only when `hasTools(harness)` and `hasPre`/`hasExpects`); every first message, `start` list, chat entry, usage line and trace file is as in slice 2;
- `ContextItemKind` gains a value, but no item of that kind is ever written; `task-store` reads old files as before;
- `usage.jsonl` gets no `pre` or `expects-miss` row; `summarizeUsage` of a log without them is unchanged;
- a tool call from the agent or the UI reaches the chat exactly as in slice 2.

| D0 item | Pinned by |
|---|---|
| Manifest | `packages/harness-sdk/test/pre-steps.test.ts` "D0: no pre, preTokens or expects without them" (Task 1) |
| First message and start items | `packages/shell/test/task-manager-pre.test.ts` "D0: without prepare the first message and start are byte-identical" (Task 6) |
| Turn entries | `packages/shell/test/turn-controller-pre.test.ts` "D0: a turn without prepared emits what it emitted" (Task 8) |
| Usage | `packages/shell/test/usage-pre.test.ts` "D0: a log without pre or expects rows summarises as before" (Task 9); `usage-log.test.ts` frozen |
| Wiring | `packages/shell/test/tools-pre-surface.test.ts` "D0: prepare and phaseEnded are passed only under hasTools and hasPre/hasExpects" (Task 11) |
| Chat | `packages/ui/test/prepared-ui.test.tsx` "D0: an entry without pre calls renders as before" (Task 8) |
| Runtime, history | the frozen list above |

## Threat model (slice 3)

Pre-steps run the harness's own tools, with slice 2's sandbox and broker. What this slice adds is data from tools reaching the first message and the trace.

| # | Boundary | What enforces it | Test |
|---|---|---|---|
| P1 | A tool's result can't break out of its block in the first message | each block is compact JSON inside a fence one backtick longer than its longest backtick run (`fenceFor`); the header line is the `as` id (checked against `TOOL_ID`) and the tool's description put on one line (controls and hidden characters removed, ≤ 200 characters) | `prepared-section.test.ts` "a result holding ``` and a heading stays inside its fence" (Task 5) |
| P2 | The prepared data never exceeds its cap | `preTokens` (default 4000, at most 20,000) bounds the section; cuts largest first; a value that can't be cut is replaced by a one-line note | `prepared-section.test.ts` (Task 5) |
| P3 | `inputs` are only earlier results | `inputs` holds exactly the named `as` values the runner produced; a tool can't name another task's data; the host freezes it | `pre-steps.test.ts`, `tool-host-script.test.ts` (Tasks 3, 4) |
| P4 | `forEach` can't fan out without bound | ≤ 100 items (else the step fails), 4 calls at a time, each call with its own timeout | `pre-steps.test.ts` (Task 4) |
| P5 | Secrets never reach the first message | a step's error text is the registry's, already passed through `hideSecrets` (slice 2 T4); the section adds nothing of its own | `pre-steps.test.ts` "a failed step's message is the registry's redacted text" (Task 4) |
| P6 | A trace note is bounded data | `note` text one line, ≤ 200 characters; tool and task ids checked as slice 2's trace checks them | `tool-trace` append tests (Task 3) |

## Decisions (product questions take the spec's defaults; Marco may change any)

1. **Where the prepared data goes.** A context part right after the data tables and before the pins and the material (the material stays last, as today). A harness whose brief has no `{{notesIndex}}` gets it where the notes index goes today (the same `fillPrompt` behaviour).
2. **The section's text.** `## Prepared data`, the line "Code prepared this before the task started. It is exact: use it as given, and call the tool again only when you need fresher data.", then per `as`: `### <as> · <tool>`, the tool's description on one line, the JSON in a fence, and, when cut, `(cut: N of M items)` (`keys` for an object, `characters` for a string). A failed step's block is `### <as> · <tool>` and `<tool> failed: <message>`.
3. **Cuts.** Sizes are characters ÷ 4, rounded up. While the section is over `preTokens`, the largest result is cut: an array keeps its first items, an object its first keys, a string its first characters, each to the largest size that fits what is left; a result that can't fit even empty becomes `(cut: too large)`. The trace gets one `note` entry per cut (`today: cut: 12 of 40 items`).
4. **A failed step**, not required: its block says so (spec §6.5) and later steps whose `input` or `forEach` names it are skipped with "`<as>` is not available: `<tool>` failed". **Required**: the task doesn't start; the chat shows the error card "Couldn't prepare this task: `<tool>` failed: `<message>`" with "Try again" (it resends the start, as for a failed first turn). The spec's "start view" is this chat start.
5. **`forEach`**: at most 100 items (more fails the step "forEach over N items; at most 100"), 4 calls at a time, results in item order; one failed item fails the step with that item's error. Params from the item's fields named like the tool's `params.properties`, then `args` over them.
6. **A resumed task** (after "Move folder") gets no prepared data and runs no pre-step (spec §6.1). Its `start` lists no `prepared` item.
7. **Stop while preparing** waits for the running step to end (each call has its timeout), then starts nothing. Calls aren't aborted into the sandbox.
8. **The chat group.** Pre calls don't stream into the chat while they run. The first turn shows them first, folded as one line "Prepared N items · S s · 0 tokens" (N: the number of `as`, S: the sum of the calls' time), unfolding to each call's line (slice 2's `ToolCallLine`), notes included. A failed step's line is unfolded (slice 2's rule) and so is the group.
9. **Context panel label.** `Prepared · <as>` (en.json `tools.contextPrepared`), with its token estimate; no path, no actions.
10. **`usage.jsonl` rows** carry `at`, `engine` and `ok` like every row, plus the spec's fields: `{ at, engine, kind: "pre", action, task, scope?, steps, ms, preparedTokens, ok }` (`ok`: no step failed) and `{ at, engine, kind: "expects-miss", action, task, scope?, taskPhase, tool, ok: true }` (the spec's `phase` is written `taskPhase`, the field every phased row uses; `phase` is the turn kind in this file). `summarizeUsage` leaves both out of its turn walk, so they never make a task unmeasured.
11. **When `expects` is checked.** When the task leaves a part (any move: agent, person, approval, time box) and after the closing turn of the part it closes in. A cancelled or unfinished task counts nothing. A call counts when its trace entry has the task's id and that part's id, whatever its caller.
12. **The miss line** is a trace note, "Expected apply-evidence in Close: not called", and reaches the chat as a line of the turn that follows, or of the closing entry; nothing else happens (spec §6.1).
13. **`preTokens`**: an integer 500–20,000; default 4000.
14. **`pre`**: 1–10 steps; `as` follows `TOOL_ID`, unique within the action; `required` only on `pre` steps.
15. **The demo's `list-sources`** returns `{ packages: [{ name, path, role?, files, more? }], docs: [{ path, role }] }`: per `packages/<name>/` its `src/` files (at most 40, sorted, `more` counts the rest) and the first sentence of its `README.md` when it has one (only `packages/e2e` has one today), and per `docs/architecture/*.md` its first paragraph's first sentence (these files are the repository's READMEs in practice). The topics' briefs don't change.
16. **The demo's `dist/`** for tools is committed (`.gitignore` exception `!harnesses/demo/dist/`, as slice 2's fixture): the built shell loads the demo from `harnesses/demo`, and the e2e suite can't build. A test rebuilds it in memory and compares.
17. **`humanharness measure [--folder <dir>]`** prints per action: tasks with a `pre` row and without, the average first-turn tokens of each (input + cache read + cache write of the task's first `run` line), the average `preparedTokens` and pre time. It reads only `.harness/usage.jsonl`. The first measurement itself (real topics on a real engine) is Marco's; Task 14 writes the method and an empty results table in `docs/architecture/tools.md`.
18. **`humanharness run`** runs no pre-step in this slice (the CLI has no tool host until slice 5): `run`'s first message lacks the prepared data, and `run` prints "Pre-steps are not run in the terminal yet." once when the action has `pre`.

## Assumptions about slices 1–2 (they are plans, not code)

Every name below is from the slice-2 plan. Task 0 checks each one and writes the real name in `carry-notes.md` when it differs; later tasks use the real one.

- `ToolRegistry.call(c: ToolCall): Promise<ToolAnswer>` with `ToolCall = { tool, args, caller, scope, task?, job?, run?, phase? }`, `ToolCaller` already including `"pre"` (slice 2 Task 7).
- `ToolRegistryDeps.called?(entry: TraceEntry)` and `TraceEntry` (§8.1 shape plus `run?`); `ToolTrace.append`, `ToolTrace.read(id)` (slice 2 Task 7).
- `host.call({ callId, tool, args, scope }, timeoutMs)` and the `call` command `{ kind: "call", callId, tool, args, scope }` in `resources/tool-host.mjs` (slice 2 Task 6).
- `createToolsHost(...)` returning `{ start, stop, registry, workspaceOptions, info }`, a `view(entry) → ToolCallView` mapping, and `called` → `emitToTask(task, { type: "tool-call", call })` (slice 2 Task 9).
- `ToolCallView` in `packages/ui/src/client.ts`, `ChatEntry.tools?`, `LiveTurn.tools?`, the reducer's `"tool-call"` case, `ToolCallLine.tsx`, and main's chat log saving an entry's `tools` (slice 2 Task 11). **The path a `tool-call` event takes into the running turn's saved entry** is not spelled out in slice 2's plan: Task 8 reads what slice 2 built and reuses that path; if the event bypasses `TurnController` and the saved entry, Task 8 stops and reports.
- `toolProblems(m, json)` and `readToolsJson` running it in main (slice 2 Tasks 3, 7); `hasTools`, `TOOL_ID`, `ToolsJson`, `ToolMeta` from `@humanharness/harness-sdk` (slice 2 Task 1).
- The `"tools"` block in en.json (slice 2 Task 11).
- Slice 2's e2e fixture `packages/fake-agent/fixtures/tools-harness/` with a committed `dist/` and `packages/cli/test/fixture-dist.test.ts` (slice 2 Task 12).

## File structure

| File | Change | Responsibility |
|---|---|---|
| `packages/harness-sdk/src/steps.ts` | Create | step schema, `PRE_TOKENS_DEFAULT`, `hasPre`, `hasExpects`, `preProblems`, `stepProblems` |
| `packages/harness-sdk/src/index.ts`, `tool.ts`, `tools.ts` | Modify | keys on actions/phases, superRefine, `ToolContext.inputs`, `toolProblems` calls `stepProblems` |
| `packages/cli/src/check.ts`, `run.ts` | Modify | `tool-steps` rule (Task 2); the run's one-line notice (Task 14) |
| `packages/cli/src/measure.ts`, `main.ts` | Create/Modify | `humanharness measure` |
| `packages/shell/src/main/tools/pre-steps.ts`, `prepared-section.ts`, `expects.ts` | Create | runner, section, misses |
| `packages/shell/src/main/tools/tool-registry.ts`, `tool-trace.ts`, `tool-host.ts`, `tool-protocol.ts`, `tools-host.ts` | Modify | `inputs`, `meta`, `note`, `prepare`, `phaseEnded` |
| `packages/shell/resources/tool-host.mjs` | Modify | `ctx.inputs` |
| `packages/shell/src/main/task-manager.ts`, `turn-controller.ts`, `usage-log.ts`, `task-store.ts`, `index.ts`, `tasks.ts` | Modify | start, first turn, rows, kind, wiring, the CLI's `measurePre` |
| `packages/runtime/src/events.ts` | Modify | `ErrorCode` gains `"prepare-failed"` |
| `packages/ui/src/client.ts`, `ContextPanel.tsx`, `ErrorCard.tsx`, `ChatView.tsx`, `tools/PreparedGroup.tsx` | Modify/Create | kind, label, error, group |
| `packages/i18n/src/locales/en.json` | Modify | `"tools"` block keys |
| `packages/fake-agent/fixtures/tools-harness/` | Modify | an action with `pre`, one with a required step, a phase with `expects`; rebuilt `dist/` |
| `packages/e2e/tests/tools-pre.spec.ts` | Create | e2e |
| `harnesses/demo/tools/list-sources.ts`, `harness.config.ts`, `HARNESS.md`, `dist/`, `test/list-sources.test.ts`, `.gitignore` | Create/Modify | demo tool |
| `docs/architecture/tools.md`, `context.md`, `phases.md`, `manifest.md`, `authoring.md` | Modify | docs |

## Overlaps

- **Slice 2:** registry, trace, host, broker, `tools-host.ts`, `ToolCallView`, `ToolCallLine`. Additive: `inputs`, `meta`, `note`, `prepare`, `phaseEnded`.
- **Context panel:** one more start-item kind; `startItems` and `contextFor` take the prepared part. `task-store`'s `ITEM_KINDS` gains `"prepared"` (it also lacks `"linked-folders"` today, a separate bug noted for Marco, not fixed here).
- **Task phases:** `expects` is checked at a part's end; no change to moves.
- **Jobs (part 3, built):** untouched. A job's first message, runner and records don't change in this slice; job `steps` are slice 4's, and they reuse `toolStepSchema`, `stepProblems` and `runPreSteps`'s step runner shape.
- **Mock mode:** `dev --mock` runs pre-steps for real (tools are code); a recording's `match` is found in the brief part, which comes first, so recordings still match.
- **Hatches:** unchanged.

## Open questions (each with the default this plan takes)

1. Placement of `## Prepared data` (Decision 1).
2. Chat group timing: shown with the first turn, not live (Decision 8).
3. `list-sources` role source while packages have no READMEs (Decision 15).
4. The measure command's name and output (Decision 17).
5. `run` without pre-steps until slice 5 (Decision 18).

## Self-review (done while writing)

- Spec coverage (slice 3 list): `pre` with `args`/`input`/`forEach`/`as`/`required` (Tasks 1, 4); `preTokens` and cuts (Task 5); `## Prepared data` (Tasks 5, 6); `"prepared"` items (Tasks 6, 7); failed and required pre-steps (Tasks 4, 6, 8); the folded group (Task 8); `expects` (Tasks 1, 2, 10); `usage.jsonl` rows (Task 9); `ctx.inputs` (Task 3); checks of §3.3 for pre and expects (Tasks 1, 2); demo `list-sources` (Task 13); first measurement method (Task 14); §13 unit rows (runner order, input, forEach, cuts, failed/required, expects misses) and e2e "a pre-step whose result shows in the first message and the context panel" (Task 12).
- Not in slice 3: job `steps`, `when`, `step_output`, `requestAi`, `summary` (4); `tool test`/`run`, guide, template, mock recordings (5).
- Types: `PreStep`, `PRE_TOKENS_DEFAULT` (Task 1); `StepProblem` (Task 2); `ToolCall.inputs`, `TraceEntry.note`, `ToolCallView.note` (Task 3); `PreResult`, `PreRun` (Task 4); `PreparedPart` (Task 5); `TaskDeps.prepare`, `PrepareAnswer` (Task 6); `TurnOptions.prepared` (Task 8); `preRecord`, `expectsMissRecord` (Task 9); `TaskDeps.phaseEnded`, `expectsMisses` (Task 10).

---

### Task 0: Branch, plan and base line

**Files:** branch `feat/tools-pre`; `docs/superpowers/plans/2026-10-29-tools-slice3-pre.md`.

- [ ] **Step 1: Check the base.**

```bash
git -C <worktree> status --short
git -C <worktree> branch --show-current
git -C <worktree> log --oneline -1
```
Expected: no status output; `feat/tools`; the last commit is slice 2's docs commit ("docs: tools — build, host, broker, registry, trace, the tools server" or what slice 2 actually wrote). Otherwise stop and report.

- [ ] **Step 2: Branch.** `git -C <worktree> switch -c feat/tools-pre`.

- [ ] **Step 3: Plan.**

```bash
cp SCRATCH/../plans/2026-10-29-tools-slice3-pre.md <worktree>/docs/superpowers/plans/
git -C <worktree> add docs/superpowers/plans/2026-10-29-tools-slice3-pre.md
git -C <worktree> commit --only docs/superpowers/plans/2026-10-29-tools-slice3-pre.md -m "docs: tools slice 3 plan (pre-steps)" -m "<trailer>"
```

- [ ] **Step 4: Base line and slice-2 names.** `corepack pnpm typecheck`, `corepack pnpm test` green. In `SCRATCH/carry-notes.md` write HEAD, the test count, and for each name in context.md's "Assumptions about slices 1–2" either "as planned" or the real name and file (use `/usr/bin/grep -rn` over `packages/`). Note in particular how a `tool-call` event reaches the running turn's saved chat entry (the file and function), since Task 8 reuses it. Run both frozen-list commands from context.md: both print nothing.

---

### Task 1: `pre`, `preTokens` and `expects` in the manifest

**Files:**
- Create: `packages/harness-sdk/src/steps.ts`
- Modify: `packages/harness-sdk/src/index.ts` (`actionSchema`, `phaseSchema`, `superRefine`, `export * from "./steps"`)
- Test: `packages/harness-sdk/test/pre-steps.test.ts` (new)

- [ ] **Step 1: Write the failing tests.**

```ts
import { describe, expect, it } from "vitest";
import { defineHarness, hasExpects, hasPre, PRE_TOKENS_DEFAULT } from "../src";

const base = {
  id: "t", name: "T", core: "^0.1.0", engines: ["claude"], folder: { suggested: "Documents/T" }, instructions: "./AGENTS.md",
  permissions: { edit: "folder" as const, exec: false, web: false }, blocks: {}, author: "x",
  tools: { "due-today": "./tools/due-today.ts", "warmup-cards": "./tools/warmup-cards.ts", "apply-evidence": "./tools/apply-evidence.ts" },
};
const study = (extra: Record<string, unknown> = {}) => ({ label: "Study", prompt: "./prompts/study.md", cost: "light" as const, ...extra });

describe("pre and expects in the manifest (tools spec §3, §6)", () => {
  it("D0: no pre, preTokens or expects without them", () => {
    const h = defineHarness({ ...base, actions: { study: study({ phases: [{ id: "main", label: "Main" }] }) } });
    expect("pre" in h.actions.study).toBe(false);
    expect("preTokens" in h.actions.study).toBe(false);
    expect("expects" in h.actions.study.phases![0]).toBe(false);
    expect(hasPre(h)).toBe(false);
    expect(hasExpects(h)).toBe(false);
  });
  it("keeps pre steps, preTokens and expects", () => {
    const h = defineHarness({
      ...base,
      actions: {
        study: study({
          pre: [{ tool: "due-today", as: "today" }, { tool: "warmup-cards", args: { n: 3 }, input: ["today"], as: "warmup", required: true }],
          preTokens: 3000,
          phases: [{ id: "main", label: "Main" }, { id: "close", label: "Close", expects: ["apply-evidence"] }],
        }),
      },
    });
    expect(h.actions.study.pre).toHaveLength(2);
    expect(h.actions.study.preTokens).toBe(3000);
    expect(h.actions.study.phases![1].expects).toEqual(["apply-evidence"]);
    expect(hasPre(h)).toBe(true);
    expect(hasExpects(h)).toBe(true);
    expect(PRE_TOKENS_DEFAULT).toBe(4000);
  });
  it("refuses a pre step naming no tool of the harness", () => {
    expect(() => defineHarness({ ...base, actions: { study: study({ pre: [{ tool: "nope" }] }) } })).toThrow(/pre\[0\]: "nope" is not a tool of this harness/);
  });
  it("refuses input or forEach naming no earlier as", () => {
    expect(() => defineHarness({ ...base, actions: { study: study({ pre: [{ tool: "warmup-cards", input: ["today"] }, { tool: "due-today", as: "today" }] }) } })).toThrow(
      /pre\[0\]: input "today" names no earlier step's as/,
    );
    expect(() => defineHarness({ ...base, actions: { study: study({ pre: [{ tool: "warmup-cards", forEach: "x" }] }) } })).toThrow(/pre\[0\]: forEach "x" names no earlier step's as/);
  });
  it("refuses two steps with the same as, a bad as, more than 10 steps and preTokens outside 500–20,000", () => {
    expect(() => defineHarness({ ...base, actions: { study: study({ pre: [{ tool: "due-today", as: "a" }, { tool: "due-today", as: "a" }] }) } })).toThrow(/as "a" is used twice/);
    expect(() => defineHarness({ ...base, actions: { study: study({ pre: [{ tool: "due-today", as: "A b" }] }) } })).toThrow();
    expect(() => defineHarness({ ...base, actions: { study: study({ pre: Array.from({ length: 11 }, () => ({ tool: "due-today" })) }) } })).toThrow();
    expect(() => defineHarness({ ...base, actions: { study: study({ pre: [{ tool: "due-today" }], preTokens: 499 }) } })).toThrow();
  });
  it("refuses preTokens without pre, and expects naming no tool", () => {
    expect(() => defineHarness({ ...base, actions: { study: study({ preTokens: 1000 }) } })).toThrow(/preTokens needs pre/);
    expect(() => defineHarness({ ...base, actions: { study: study({ phases: [{ id: "main", label: "Main", expects: ["nope"] }] }) } })).toThrow(/expects "nope" is not a tool of this harness/);
  });
  it("refuses pre or expects in a harness without tools", () => {
    const { tools: _t, ...noTools } = base;
    expect(() => defineHarness({ ...noTools, actions: { study: study({ pre: [{ tool: "due-today" }] }) } })).toThrow(/is not a tool of this harness/);
  });
});
```

- [ ] **Step 2: Run to see them fail.** `corepack pnpm vitest run packages/harness-sdk/test/pre-steps.test.ts`.

- [ ] **Step 3: Implement `steps.ts`.**

```ts
import { z } from "zod";
import { TOOL_ID } from "./tools";

/** The cap on a task's prepared data in its first message, in tokens (tools spec §6). */
export const PRE_TOKENS_DEFAULT = 4000;
export const PRE_TOKENS_MIN = 500;
export const PRE_TOKENS_MAX = 20_000;
export const PRE_STEPS_MAX = 10;

/** A tool step (tools spec §6, §7.1): pre-steps of an action; job recipes reuse it without `required` (slice 4). */
export const toolStepSchema = z.strictObject({
  tool: z.string().regex(TOOL_ID),
  /** Fixed arguments; for forEach, they override the item's fields. */
  args: z.record(z.string(), z.unknown()).optional(),
  /** Earlier results, by their `as`, passed to the tool as `ctx.inputs`. */
  input: z.array(z.string().regex(TOOL_ID)).min(1).max(10).optional(),
  /** Runs the tool once per item of an earlier array result; params come from the item's fields of the same name. */
  forEach: z.string().regex(TOOL_ID).optional(),
  /** The result's name: for later steps and for the first message. */
  as: z.string().regex(TOOL_ID).optional(),
});
export const preStepSchema = toolStepSchema.extend({
  /** The task does not start when this step fails (tools spec §6.5). */
  required: z.literal(true).optional(),
});
export type ToolStep = z.output<typeof toolStepSchema>;
export type PreStep = z.output<typeof preStepSchema>;

export const preSchema = z.array(preStepSchema).min(1).max(PRE_STEPS_MAX);
export const preTokensSchema = z.int().min(PRE_TOKENS_MIN).max(PRE_TOKENS_MAX);
export const expectsSchema = z.array(z.string().regex(TOOL_ID)).min(1).max(10);

type ActionLike = { pre?: PreStep[]; preTokens?: number; phases?: { id: string; expects?: string[] }[] };

/** Some action declares pre-steps. False: no slice-3 start code runs (D0). */
export const hasPre = (h: { actions?: Record<string, ActionLike> }): boolean => Object.values(h.actions ?? {}).some((a) => (a.pre?.length ?? 0) > 0);
/** Some phase declares expects. False: no part-end check runs (D0). */
export const hasExpects = (h: { actions?: Record<string, ActionLike> }): boolean =>
  Object.values(h.actions ?? {}).some((a) => (a.phases ?? []).some((p) => (p.expects?.length ?? 0) > 0));

export interface StepProblem {
  path: (string | number)[];
  message: string;
}

/**
 * The order checks of a list of steps (tools spec §3.3), shared by pre-steps and job recipes: each tool is declared,
 * each `as` is unique, `input` and `forEach` name an earlier `as`. `where` is the list's path ("pre", or "steps").
 */
export function orderProblems(steps: readonly { tool?: string; input?: string[]; forEach?: string; as?: string }[], tools: Record<string, unknown>, at: (string | number)[], where: string, earlierExtra: readonly string[] = []): StepProblem[] {
  const out: StepProblem[] = [];
  const seen = new Set<string>(earlierExtra);
  steps.forEach((s, i) => {
    const issue = (message: string) => out.push({ path: [...at, i], message: `${where}[${i}]: ${message}` });
    if (s.tool !== undefined && !Object.hasOwn(tools, s.tool)) issue(`"${s.tool}" is not a tool of this harness`);
    for (const n of s.input ?? []) if (!seen.has(n)) issue(`input "${n}" names no earlier step's as`);
    if (s.forEach !== undefined && !seen.has(s.forEach)) issue(`forEach "${s.forEach}" names no earlier step's as`);
    if (s.as !== undefined) {
      if (seen.has(s.as)) issue(`as "${s.as}" is used twice`);
      seen.add(s.as);
    }
  });
  return out;
}

/** The manifest-only checks of pre-steps and expects (tools spec §3.3), for the manifest's `superRefine`. */
export function preProblems(h: { tools?: Record<string, string>; actions?: Record<string, ActionLike> }): StepProblem[] {
  const tools = h.tools ?? {};
  const out: StepProblem[] = [];
  for (const [id, a] of Object.entries(h.actions ?? {})) {
    if (a.preTokens !== undefined && !a.pre) out.push({ path: ["actions", id, "preTokens"], message: "preTokens needs pre" });
    out.push(...orderProblems(a.pre ?? [], tools, ["actions", id, "pre"], "pre"));
    (a.phases ?? []).forEach((p, i) => {
      for (const t of p.expects ?? []) if (!Object.hasOwn(tools, t)) out.push({ path: ["actions", id, "phases", i, "expects"], message: `expects "${t}" is not a tool of this harness` });
    });
  }
  return out;
}
```

In `index.ts`: `actionSchema` gains, after `timeBox`,

```ts
  /** Tool steps run when the task starts, before its session opens (tools spec §6). Absent: none (D0). */
  pre: preSchema.optional(),
  /** The cap on the prepared data in the first message; default PRE_TOKENS_DEFAULT. Only with `pre`. */
  preTokens: preTokensSchema.optional(),
```
`phaseSchema` gains `/** Tools the agent should call in this part; a miss is counted (tools spec §6.1). */ expects: expectsSchema.optional(),`. In the manifest's `superRefine`, after the tools checks slice 2 added: `for (const p of preProblems(m)) ctx.addIssue({ code: "custom", path: p.path, message: p.message });`. `export * from "./steps";`.

- [ ] **Step 4: Run** the new test, `packages/harness-sdk/test/tools.test.ts` (frozen, green) and every `packages/harness-sdk/test/*.test.ts`; typecheck.

- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/harness-sdk/src/steps.ts packages/harness-sdk/test/pre-steps.test.ts
git -C <worktree> commit --only packages/harness-sdk/src/steps.ts packages/harness-sdk/src/index.ts packages/harness-sdk/test/pre-steps.test.ts -m "feat(sdk): pre-steps, preTokens and expects in the manifest" -m "<trailer>"
```

---

### Task 2: The checks that need `tools.json` (`stepProblems`)

**Files:**
- Modify: `packages/harness-sdk/src/steps.ts` (`stepProblems`, `sourceProblems`), `packages/cli/src/check.ts` (rule `tool-steps`), `packages/shell/src/main/tools/tools-json.ts` (run it beside `toolProblems`)
- Test: `packages/harness-sdk/test/step-problems.test.ts` (new), `packages/cli/test/check-pre.test.ts` (new), `packages/shell/test/tools/tools-json-pre.test.ts` (new)

- [ ] **Step 1: Write the failing tests** (one per rule, exact messages). `json(tools)` builds a `ToolsJson` whose entries take `{ agent, params, returns }` overrides; `m(pre, phases?)` builds a manifest with `tools` for every id used.

```ts
describe("stepProblems (tools spec §3.3)", () => {
  it("input names a result whose tool declares returns", () => {
    expect(msgs(m([{ tool: "due-today", as: "today" }, { tool: "warmup-cards", input: ["today"] }]), json({ "due-today": { returns: undefined } }))).toContain(
      'study: pre[1]: input "today": due-today declares no returns',
    );
  });
  it("forEach names an array result", () => {
    expect(msgs(m([{ tool: "open-prs", as: "prs" }, { tool: "pr-ci", forEach: "prs" }]), json({ "open-prs": { returns: { type: "object", properties: {} } } }))).toContain(
      'study: pre[1]: forEach "prs": open-prs does not return an array',
    );
  });
  it("forEach items carry every required param the args don't give", () => {
    const j = json({
      "open-prs": { returns: { type: "array", items: { type: "object", properties: { repo: { type: "string" } } } } },
      "pr-ci": { params: { type: "object", properties: { repo: { type: "string" }, number: { type: "integer" } }, required: ["repo", "number"] } },
    });
    expect(msgs(m([{ tool: "open-prs", as: "prs" }, { tool: "pr-ci", forEach: "prs" }]), j)).toContain('study: pre[1]: forEach "prs": its items have no "number", a required param of pr-ci');
    expect(msgs(m([{ tool: "open-prs", as: "prs" }, { tool: "pr-ci", forEach: "prs", args: { number: 1 } }]), j)).toEqual([]);
  });
  it("expects names tools the agent can call", () => {
    expect(msgs(m([], [{ id: "close", label: "Close", expects: ["apply-evidence"] }]), json({ "apply-evidence": { agent: "none" } }))).toContain(
      'study: phase close: expects "apply-evidence" is a tool the agent can\'t call (agent: "none")',
    );
  });
  it("D0: a manifest without pre or expects has no problems", () => { /* any tools.json → [] */ });
});
```
`check-pre.test.ts`: a temp harness (helpers in `packages/cli/test/helpers.ts`) with a pre step feeding `input` from a tool without `returns` → finding rule `tool-steps`, severity error, the message above. `tools-json-pre.test.ts`: the same harness read in main → tools off with that message.

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement** in `steps.ts`:

```ts
/** What an `as` was made by: a tool (its tools.json entry) or, in a job recipe, the AI step (its output's JSON Schema; slice 4). */
export type StepSource = { kind: "tool"; tool: string; returns?: Record<string, unknown> } | { kind: "ai"; returns: Record<string, unknown> };

const props = (s: Record<string, unknown> | undefined): Record<string, unknown> =>
  s && typeof s.properties === "object" && s.properties !== null ? (s.properties as Record<string, unknown>) : {};
const required = (s: Record<string, unknown> | undefined): string[] => (Array.isArray(s?.required) ? (s.required as unknown[]).filter((r): r is string => typeof r === "string") : []);

/**
 * The checks of a step list that need tools.json (tools spec §3.3): `input` and `forEach` read results whose maker
 * declares `returns`; a `forEach` result is an array whose items carry the tool's required params not in `args`.
 * `sources` starts with what earlier lists made (slice 4's AI step), and gains each `as` in order.
 */
export function sourceProblems(
  steps: readonly { tool?: string; args?: Record<string, unknown>; input?: string[]; forEach?: string; as?: string }[],
  json: { tools: Record<string, { params: Record<string, unknown>; returns?: Record<string, unknown> }> },
  label: string,
  sources: Map<string, StepSource> = new Map(),
): string[] {
  const out: string[] = [];
  const maker = (src: StepSource) => (src.kind === "tool" ? src.tool : "the AI step");
  steps.forEach((s, i) => {
    const at = `${label}[${i}]`;
    for (const n of s.input ?? []) {
      const src = sources.get(n);
      if (src && !src.returns) out.push(`${at}: input "${n}": ${maker(src)} declares no returns`);
    }
    if (s.forEach !== undefined) {
      const src = sources.get(s.forEach);
      if (src && !src.returns) out.push(`${at}: forEach "${s.forEach}": ${maker(src)} declares no returns`);
      else if (src && src.returns?.type !== "array") out.push(`${at}: forEach "${s.forEach}": ${maker(src)} does not return an array`);
      else if (src && s.tool !== undefined && Object.hasOwn(json.tools, s.tool)) {
        const items = (src.returns!.items ?? undefined) as Record<string, unknown> | undefined;
        const has = props(items);
        for (const p of required(json.tools[s.tool].params)) {
          if (s.args && Object.hasOwn(s.args, p)) continue;
          if (!Object.hasOwn(has, p)) out.push(`${at}: forEach "${s.forEach}": its items have no "${p}", a required param of ${s.tool}`);
        }
      }
    }
    if (s.as !== undefined && s.tool !== undefined && Object.hasOwn(json.tools, s.tool)) {
      const returns = json.tools[s.tool].returns;
      // forEach makes an array of the tool's results.
      sources.set(s.as, { kind: "tool", tool: s.tool, ...(returns ? { returns: s.forEach !== undefined ? { type: "array", items: returns } : returns } : {}) });
    }
  });
  return out;
}

/** Every pre and expects problem that needs tools.json, as "<action>: …" lines (check's `tool-steps`, main's tools off). */
export function stepProblems(
  h: { actions?: Record<string, ActionLike> },
  json: { tools: Record<string, { agent: "call" | "none"; params: Record<string, unknown>; returns?: Record<string, unknown> }> },
): string[] {
  const out: string[] = [];
  for (const [id, a] of Object.entries(h.actions ?? {})) {
    out.push(...sourceProblems(a.pre ?? [], json, "pre").map((p) => `${id}: ${p}`));
    for (const p of a.phases ?? [])
      for (const t of p.expects ?? []) if (Object.hasOwn(json.tools, t) && json.tools[t].agent !== "call") out.push(`${id}: phase ${p.id}: expects "${t}" is a tool the agent can't call (agent: "none")`);
  }
  return out;
}
```
`check.ts`: when `hasTools` and the in-memory build gave a `tools.json`, each `stepProblems` line is a `tool-steps` error (after `tool-uses`). `tools-json.ts`: after `toolProblems`, `stepProblems(harness, json)`; the first line turns tools off, logged once (slice 2's path for a problem).

- [ ] **Step 4: Run** the three new tests, `check.test.ts`, slice 2's `tool-problems.test.ts` and `tools-json.test.ts` (green, unchanged); typecheck.

- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/harness-sdk/test/step-problems.test.ts packages/cli/test/check-pre.test.ts packages/shell/test/tools/tools-json-pre.test.ts
git -C <worktree> commit --only packages/harness-sdk/src/steps.ts packages/cli/src/check.ts packages/shell/src/main/tools/tools-json.ts packages/harness-sdk/test/step-problems.test.ts packages/cli/test/check-pre.test.ts packages/shell/test/tools/tools-json-pre.test.ts -m "feat(sdk): pre and expects checks against tools.json" -m "<trailer>"
```

---

### Task 3: `ctx.inputs`, `registry.meta` and trace notes

**Files:**
- Modify: `packages/harness-sdk/src/tool.ts` (`ToolContext.inputs`), `packages/shell/resources/tool-host.mjs` (`inputs` on the call command, frozen), `packages/shell/src/main/tools/tool-protocol.ts` (the command's shape), `packages/shell/src/main/tools/tool-host.ts` (`call` passes `inputs`), `packages/shell/src/main/tools/tool-registry.ts` (`ToolCall.inputs`, `meta`, `note`), `packages/shell/src/main/tools/tool-trace.ts` (`TraceEntry.note`), `packages/ui/src/client.ts` (`ToolCallView.note?`), `packages/shell/src/main/tools/tools-host.ts` (the view carries `note`)
- Test: `packages/shell/test/tools/tool-inputs.test.ts` (new), `packages/shell/test/tools/tool-host-script-inputs.test.ts` (new), `packages/shell/test/tools/tool-note.test.ts` (new)

- [ ] **Step 1: Write the failing tests.**

```ts
// tool-inputs.test.ts — the registry with slice 2's host and trace doubles
describe("inputs (tools spec §4.2 ctx.inputs)", () => {
  it("a call's inputs reach the host with the call", async () => { /* registry.call({ ..., inputs: { today: [1] } }) → host saw inputs { today: [1] } */ });
  it("a call without inputs sends {} (never undefined) and traces as before", async () => { /* host saw {}; the trace entry deep-equals slice 2's shape: no inputs key */ });
  it("inputs over 8 MB are refused before the host is asked", async () => { /* error 'The inputs are too large' */ });
  it("meta(id) is the tools.json entry, null for an unknown id or while off", async () => { /* … */ });
});
```
```ts
// tool-host-script-inputs.test.ts — load resources/tool-host.mjs as slice 2's tool-host-script.test.ts does
// "ctx.inputs is the command's inputs, frozen (a write throws in strict mode)"
// "a command without inputs gives ctx.inputs = {}"
```
```ts
// tool-note.test.ts
describe("trace notes (tools spec §6.3, §6.1)", () => {
  it("note() appends an entry with note, caller and task, ok true, ms 0, no args", async () => {
    // registry.note({ tool: "due-today", caller: "pre", task: "t1", text: "today: cut: 12 of 40 items" })
    // → trace.append({ at, tool: "due-today", caller: "pre", task: "t1", args: null, resultSummary: "", ms: 0, ok: true, accesses: [], note: "today: cut: 12 of 40 items" })
  });
  it("a note is put on one line and cut at 200 characters", async () => { /* "a\nb" → "a b"; 300 x → 200 */ });
  it("called() gets the note entry, so it reaches the chat", async () => { /* … */ });
  it("the view of a note entry carries note", () => { /* tools-host's view(entry).note */ });
});
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**
  - `tool.ts`: in `ToolContext`, `/** The results named by the step's input (tools spec §6, §7); {} for a call that isn't a step. */ readonly inputs: Readonly<Record<string, unknown>>;`.
  - `tool-protocol.ts`: the host-bound call command gains `inputs: Record<string, unknown>` (always present). `tool-host.ts`: `call({ callId, tool, args, scope, inputs }, timeoutMs)`.
  - `tool-host.mjs`: building `ctx` for a command, `inputs: Object.freeze(cmd.inputs ?? {})` (a shallow freeze: the values are the tool's own copy, structured-cloned over IPC).
  - `tool-registry.ts`:

```ts
/** The longest inputs a call carries: the host's payload cap is 12 MB (slice 2 T6). */
const INPUTS_MAX_BYTES = 8 * 1024 * 1024;

export interface ToolCall {
  // … slice 2's fields …
  /** A step's earlier results by `as` (tools spec §6); absent for a UI or agent call. */
  inputs?: Record<string, unknown>;
}

  /** A tool's tools.json entry; null when unknown or while tools are off. */
  async meta(id: string): Promise<ToolMeta | null> {
    const j = await this.d.json();
    return j.on && Object.hasOwn(j.tools, id) ? j.tools[id] : null;
  }

  /** A line in the trace that is not a call: a pre-step's cut, an expected tool not called (tools spec §6). */
  async note(n: { tool: string; caller: ToolCaller; task?: string; job?: string; run?: string; phase?: string; text: string }): Promise<void> {
    const text = Array.from(n.text.replace(/[\u0000-\u001f\u007f-\u009f  ]/g, " ").replace(/\s+/g, " ").trim()).slice(0, 200).join("");
    const entry: TraceEntry = {
      at: this.now().toISOString(), tool: n.tool, caller: n.caller,
      ...(n.task ? { task: n.task } : {}), ...(n.job ? { job: n.job } : {}), ...(n.run ? { run: n.run } : {}), ...(n.phase ? { phase: n.phase } : {}),
      args: null, resultSummary: "", ms: 0, ok: true, accesses: [], note: text,
    };
    await this.d.trace.append(entry);
    this.d.called?.(entry);
  }
```
  In `call`, before the host: `const inputs = c.inputs ?? {}; if (Buffer.byteLength(JSON.stringify(inputs)) > INPUTS_MAX_BYTES) return { ok: false, error: "The inputs are too large" };`, and pass `inputs` to `host.call`. The trace entry of a call never carries `inputs` (only `args`, as §8.1).
  - `tool-trace.ts`: `TraceEntry.note?: string`; the reader keeps `note` only as a string ≤ 200 characters.
  - `client.ts`: `ToolCallView` gains `/** A trace note, not a call (a cut, an expected tool not called). */ note?: string;`. `tools-host.ts`'s view copies it.

- [ ] **Step 4: Run** the new tests and slice 2's `tool-registry.test.ts`, `tool-host-script.test.ts`, `tool-host.test.ts`, `tool-trace.test.ts` (green; `tool-registry.test.ts` frozen); typecheck; `corepack pnpm app:build`.

- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/shell/test/tools/tool-inputs.test.ts packages/shell/test/tools/tool-host-script-inputs.test.ts packages/shell/test/tools/tool-note.test.ts
git -C <worktree> commit --only packages/harness-sdk/src/tool.ts packages/shell/resources/tool-host.mjs packages/shell/src/main/tools/tool-protocol.ts packages/shell/src/main/tools/tool-host.ts packages/shell/src/main/tools/tool-registry.ts packages/shell/src/main/tools/tool-trace.ts packages/shell/src/main/tools/tools-host.ts packages/ui/src/client.ts packages/shell/test/tools/tool-inputs.test.ts packages/shell/test/tools/tool-host-script-inputs.test.ts packages/shell/test/tools/tool-note.test.ts -m "feat(shell): ctx.inputs, tool metadata and trace notes" -m "<trailer>"
```

---

### Task 4: The pre-step runner

**Files:**
- Create: `packages/shell/src/main/tools/pre-steps.ts`
- Test: `packages/shell/test/tools/pre-steps.test.ts` (new)

- [ ] **Step 1: Write the failing tests.** A registry double: `call` answers from a table by tool (and records each `ToolCall`), `meta` from a small tools.json.

```ts
import { describe, expect, it } from "vitest";
import { runPreSteps } from "../../src/main/tools/pre-steps";

describe("runPreSteps (tools spec §6)", () => {
  it("runs the steps in order as caller pre, with the task, scope and phase", async () => {
    // steps [{ tool: "a", as: "x" }, { tool: "b", as: "y" }] → calls in order; each { caller: "pre", task: "t1", scope: "intro", phase: "warmup" }
  });
  it("passes args and the named earlier results as inputs", async () => {
    // [{ tool: "a", as: "today" }, { tool: "b", args: { n: 3 }, input: ["today"], as: "warmup" }] → b got args { n: 3 }, inputs { today: <a's value> }
  });
  it("forEach calls the tool once per item, params from the item's fields of the tool's params, args over them", async () => {
    // a returns [{ repo: "r", number: 1, title: "x" }, { repo: "r", number: 2 }]; b params properties repo, number;
    // step { tool: "b", forEach: "prs", args: { repo: "q" }, as: "ci" } → calls args { repo: "q", number: 1 } and { repo: "q", number: 2 } (no title); result [b1, b2] in order
  });
  it("forEach runs at most 4 calls at a time and keeps the item order", async () => { /* 10 items, delayed answers in reverse; max in flight 4; order kept */ });
  it("forEach over more than 100 items fails the step", async () => { /* error "forEach over 101 items; at most 100" and no call made */ });
  it("forEach over a value that isn't an array fails the step", async () => { /* "prs is not a list" */ });
  it("one failed item fails the forEach step with its error", async () => { /* … */ });
  it("a failed step is kept with its message and the next steps still run", async () => { /* results[0] { ok: false, error: "boom" }; results[1].ok true */ });
  it("a step whose input names a failed result is skipped with a reason", async () => {
    // error: '"today" is not available: a failed'; the tool is never called
  });
  it("a failed required step stops the run and is reported", async () => {
    // [{ tool: "a", required: true, as: "x" }, { tool: "b" }] with a failing → requiredFailure { tool: "a", error: "boom" }; b never called
  });
  it("a failed step's message is the registry's redacted text", async () => {
    // the double answers { ok: false, error: "bad token [redacted]" } → kept as is, nothing added
  });
  it("measures each step's time and the whole run", async () => { /* fake clock */ });
});
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**

```ts
import type { PreStep, ToolMeta, ToolStep } from "@humanharness/harness-sdk";
import type { ToolAnswer, ToolCall } from "./tool-registry";

/** At most this many items in one forEach (Decision 5). */
export const FOR_EACH_MAX = 100;
/** forEach calls in flight at once. */
const FOR_EACH_PARALLEL = 4;

/** What a step runner needs of the registry. */
export interface StepRegistry {
  call(c: ToolCall): Promise<ToolAnswer>;
  meta(id: string): Promise<ToolMeta | null>;
}

/** One step's outcome, by its `as` (or its tool when it has none). */
export interface StepResult {
  as?: string;
  tool: string;
  ok: boolean;
  value?: unknown;
  error?: string;
  ms: number;
}

export interface PreRun {
  results: StepResult[];
  /** A `required` step failed: the task does not start (tools spec §6.5). */
  requiredFailure?: { tool: string; error: string };
  ms: number;
}

/** The call fields every call of a step list shares (caller, task or job run, scope, phase). */
export type StepCallBase = Omit<ToolCall, "tool" | "args" | "inputs">;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Earlier results by `as`: a value, or why it is missing. */
export type StepValues = Map<string, { ok: true; value: unknown } | { ok: false; tool: string }>;

/**
 * One tool step (tools spec §6.2, §7.1): its `input` from earlier results, once or once per `forEach` item. Shared by
 * pre-steps and job recipes (slice 4). Never throws: a failure is a result.
 */
export async function runToolStep(r: StepRegistry, step: ToolStep, values: StepValues, base: StepCallBase, extra: Partial<ToolCall> = {}): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  const inputs: Record<string, unknown> = {};
  for (const n of step.input ?? []) {
    const v = values.get(n);
    if (!v) return { ok: false, error: `"${n}" is not available` };
    if (!v.ok) return { ok: false, error: `"${n}" is not available: ${v.tool} failed` };
    inputs[n] = v.value;
  }
  const one = async (args: Record<string, unknown>) => {
    const a = await r.call({ ...base, ...extra, tool: step.tool, args, ...(step.input ? { inputs } : {}) });
    return a.ok ? ({ ok: true, value: a.result } as const) : ({ ok: false, error: a.error } as const);
  };
  if (step.forEach === undefined) return one({ ...(step.args ?? {}) });
  const src = values.get(step.forEach);
  if (!src) return { ok: false, error: `"${step.forEach}" is not available` };
  if (!src.ok) return { ok: false, error: `"${step.forEach}" is not available: ${src.tool} failed` };
  if (!Array.isArray(src.value)) return { ok: false, error: `${step.forEach} is not a list` };
  const items = src.value;
  if (items.length > FOR_EACH_MAX) return { ok: false, error: `forEach over ${items.length} items; at most ${FOR_EACH_MAX}` };
  const meta = await r.meta(step.tool);
  const names = Object.keys(isObject(meta?.params?.properties) ? meta!.params.properties : {});
  const out: unknown[] = new Array(items.length);
  let failed: string | null = null;
  let next = 0;
  const worker = async () => {
    while (failed === null && next < items.length) {
      const i = next++;
      const item = items[i];
      const fromItem = isObject(item) ? Object.fromEntries(names.filter((n) => Object.hasOwn(item, n)).map((n) => [n, item[n]])) : {};
      const got = await one({ ...fromItem, ...(step.args ?? {}) });
      if (!got.ok) failed ??= got.error;
      else out[i] = got.value;
    }
  };
  await Promise.all(Array.from({ length: Math.min(FOR_EACH_PARALLEL, items.length) }, worker));
  return failed !== null ? { ok: false, error: failed } : { ok: true, value: out };
}

/** An action's pre-steps (tools spec §6), in order, before its session opens. */
export async function runPreSteps(o: { registry: StepRegistry; steps: PreStep[]; task: string; scope: string | null; phase?: string; now?: () => number }): Promise<PreRun> {
  const now = o.now ?? Date.now;
  const start = now();
  const values: StepValues = new Map();
  const results: StepResult[] = [];
  const base: StepCallBase = { caller: "pre", scope: o.scope, task: o.task, ...(o.phase ? { phase: o.phase } : {}) };
  for (const step of o.steps) {
    const t0 = now();
    const got = await runToolStep(o.registry, step, values, base);
    const ms = now() - t0;
    if (step.as !== undefined) values.set(step.as, got.ok ? { ok: true, value: got.value } : { ok: false, tool: step.tool });
    results.push({ ...(step.as !== undefined ? { as: step.as } : {}), tool: step.tool, ok: got.ok, ...(got.ok ? { value: got.value } : { error: got.error }), ms });
    if (!got.ok && step.required) return { results, requiredFailure: { tool: step.tool, error: got.error }, ms: now() - start };
  }
  return { results, ms: now() - start };
}
```
(`ToolMeta.params` is a JSON Schema record from slice 2: read `properties` defensively as above.)

- [ ] **Step 4: Run, typecheck, commit.**

```bash
git -C <worktree> add packages/shell/src/main/tools/pre-steps.ts packages/shell/test/tools/pre-steps.test.ts
git -C <worktree> commit --only packages/shell/src/main/tools/pre-steps.ts packages/shell/test/tools/pre-steps.test.ts -m "feat(shell): the pre-step runner — order, input, forEach, failures" -m "<trailer>"
```

---

### Task 5: `## Prepared data`: the section, the cuts and the start items

**Files:**
- Create: `packages/shell/src/main/tools/prepared-section.ts`
- Modify: `packages/ui/src/client.ts` (`ContextItemKind` gains `"prepared"`, with the comment "Data a pre-step prepared (tools spec §6.4).")
- Test: `packages/shell/test/tools/prepared-section.test.ts` (new)

- [ ] **Step 1: Write the failing tests.**

```ts
import { describe, expect, it } from "vitest";
import { preparedSection } from "../../src/main/tools/prepared-section";

const desc = { "due-today": "Reviews due today and the next concept.", "warmup-cards": "Three warm-up cards." };
const r = (as: string, tool: string, value: unknown) => ({ as, tool, ok: true, value, ms: 5 });

describe("preparedSection (tools spec §6.3, §6.4)", () => {
  it("one block per as: header, description, compact JSON in a fence", () => {
    const s = preparedSection([r("today", "due-today", [{ id: 1 }])], { descriptions: desc, preTokens: 4000 });
    expect(s.text).toBe(
      [
        "## Prepared data",
        "",
        "Code prepared this before the task started. It is exact: use it as given, and call the tool again only when you need fresher data.",
        "",
        "### today · due-today",
        "Reviews due today and the next concept.",
        "```json",
        '[{"id":1}]',
        "```",
      ].join("\n"),
    );
  });
  it("a failed step's block says so", () => {
    const s = preparedSection([{ as: "today", tool: "due-today", ok: false, error: "Jira API token is not set — Settings › Connections", ms: 1 }], { descriptions: desc, preTokens: 4000 });
    expect(s.text).toContain("### today · due-today\ndue-today failed: Jira API token is not set — Settings › Connections");
  });
  it("a step without as is a block under its tool's name", () => { /* "### due-today" */ });
  it("a result holding ``` and a heading stays inside its fence", () => {
    // value "```\n## Injected" → fence is ```` (one longer than the longest run), the text holds one "## Prepared data" heading only at the start
  });
  it("a description is one line, controls and hidden characters removed, at most 200 characters", () => { /* … */ });
  it("cuts the largest result first, keeping its first items, and marks the cut", () => {
    // big: 400 items, small: 3 items, preTokens 500 → big cut to k items with "(cut: k of 400 items)", small whole; s.tokens ≤ 500
  });
  it("cuts an object by keys and a string by characters", () => { /* "(cut: 3 of 10 keys)", "(cut: 800 of 5000 characters)" */ });
  it("a result that can't fit even empty becomes (cut: too large)", () => { /* preTokens 500 with 30 tools' headers… */ });
  it("reports each cut for the trace", () => { /* s.cuts [{ as: "big", tool: "x", text: "big: cut: 12 of 400 items" }] */ });
  it("one prepared start item per block: id prepared:<as>, its label and token estimate", () => {
    // items [{ id: "prepared:today", kind: "prepared", label: "Prepared · today", tokens: approxTokens(blockLength) }]
  });
  it("tokens is the section's characters ÷ 4, rounded up", () => { /* … */ });
  it("no results: no text, no items", () => { /* { text: "", items: [], cuts: [], tokens: 0 } */ });
});
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**

```ts
import { HIDDEN_CHARS } from "@humanharness/harness-sdk";
import type { ContextItem } from "@humanharness/ui/client";
import { fenceFor } from "@humanharness/workspace";
import { approxTokens } from "../context-record";
import type { StepResult } from "./pre-steps";

const HEAD =
  "Code prepared this before the task started. It is exact: use it as given, and call the tool again only when you need fresher data.";
const HIDDEN = new RegExp(HIDDEN_CHARS.source, "gu");
const tokensOf = (chars: number) => Math.ceil(chars / 4);
/** One line, no controls or hidden characters, at most 200 characters. */
const line = (t: string) =>
  Array.from(t.replace(/[\u0000-\u001f\u007f-\u009f  ]/g, " ").replace(HIDDEN, "").replace(/\s+/g, " ").trim()).slice(0, 200).join("");

export interface PreparedPart {
  /** The section, or "" when there is nothing to say. */
  text: string;
  /** One `prepared` start item per block (tools spec §6.4). */
  items: ContextItem[];
  /** Each cut, for the trace (Decision 3). */
  cuts: { as: string; tool: string; text: string }[];
  /** The section's size in tokens (characters ÷ 4, rounded up): the `pre` row's preparedTokens. */
  tokens: number;
}

type Shown = { key: string; tool: string; header: string; body: string; json?: string; cut?: string };

function block(s: Shown): string {
  const lines = [s.header, ...(s.body ? [s.body] : [])];
  if (s.json !== undefined) {
    const fence = fenceFor(s.json);
    lines.push(`${fence}json`, s.json, fence);
  }
  if (s.cut) lines.push(`(${s.cut})`);
  return lines.join("\n");
}

/** `value` cut to `n` parts (items, keys or characters) and what was cut, or null when it has no parts. */
function cutTo(value: unknown, n: number): { value: unknown; note: string } | null {
  if (Array.isArray(value)) return { value: value.slice(0, n), note: `cut: ${n} of ${value.length} items` };
  if (typeof value === "string") return { value: Array.from(value).slice(0, n).join(""), note: `cut: ${n} of ${Array.from(value).length} characters` };
  if (typeof value === "object" && value !== null) {
    const keys = Object.keys(value);
    return { value: Object.fromEntries(keys.slice(0, n).map((k) => [k, (value as Record<string, unknown>)[k]])), note: `cut: ${n} of ${keys.length} keys` };
  }
  return null;
}
const partsOf = (v: unknown) => (Array.isArray(v) ? v.length : typeof v === "string" ? Array.from(v).length : typeof v === "object" && v !== null ? Object.keys(v).length : 0);

/**
 * The first message's `## Prepared data` (tools spec §6.3): one block per result, compact JSON, the tool's
 * description as its line. Over `preTokens`, the largest result is cut first to what still fits (Decision 3).
 */
export function preparedSection(results: StepResult[], o: { descriptions: Record<string, string>; preTokens: number }): PreparedPart {
  if (results.length === 0) return { text: "", items: [], cuts: [], tokens: 0 };
  const shown: Shown[] = results.map((r) => {
    const key = r.as ?? r.tool;
    const header = `### ${r.as !== undefined ? `${r.as} · ${r.tool}` : r.tool}`;
    if (!r.ok) return { key, tool: r.tool, header, body: line(`${r.tool} failed: ${r.error ?? "unknown error"}`) };
    return { key, tool: r.tool, header, body: line(o.descriptions[r.tool] ?? ""), json: JSON.stringify(r.value ?? null) };
  });
  const values = new Map(results.map((r, i) => [i, r.value]));
  const head = ["## Prepared data", "", HEAD].join("\n");
  const total = () => tokensOf([head, ...shown.map(block)].join("\n\n").length);
  const cuts: PreparedPart["cuts"] = [];
  const done = new Set<number>();
  while (total() > o.preTokens) {
    // The largest block not cut yet.
    let i = -1;
    for (let k = 0; k < shown.length; k++) if (!done.has(k) && shown[k].json !== undefined && (i < 0 || shown[k].json!.length > shown[i].json!.length)) i = k;
    if (i < 0) break;
    done.add(i);
    const v = values.get(i);
    const size = partsOf(v);
    // The largest n that fits, by halving (each try re-measures the whole section).
    let lo = 0;
    let hi = size;
    let best: { value: unknown; note: string } | null = null;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const c = cutTo(v, mid);
      if (!c) break;
      const before = { json: shown[i].json, cut: shown[i].cut };
      shown[i].json = JSON.stringify(c.value);
      shown[i].cut = c.note;
      if (total() <= o.preTokens) {
        best = c;
        lo = mid + 1;
      } else hi = mid - 1;
      shown[i].json = before.json;
      shown[i].cut = before.cut;
    }
    if (best) {
      shown[i].json = JSON.stringify(best.value);
      shown[i].cut = best.note;
    } else {
      shown[i].json = undefined;
      shown[i].cut = "cut: too large";
    }
    cuts.push({ as: shown[i].key, tool: shown[i].tool, text: `${shown[i].key}: ${shown[i].cut}` });
  }
  const blocks = shown.map(block);
  const text = [head, ...blocks].join("\n\n");
  return {
    text,
    items: shown.map((s, k) => ({ id: `prepared:${s.key}`, kind: "prepared" as const, label: `Prepared · ${s.key}`, tokens: approxTokens(blocks[k].length) })),
    cuts,
    tokens: tokensOf(text.length),
  };
}
```
In `client.ts`, add `| "prepared"` to `ContextItemKind` (after `"linked-folders"`, with its comment). Nothing writes it yet; the store and the panel learn it in Task 7.

- [ ] **Step 4: Run, typecheck, commit.**

```bash
git -C <worktree> add packages/shell/src/main/tools/prepared-section.ts packages/shell/test/tools/prepared-section.test.ts
git -C <worktree> commit --only packages/shell/src/main/tools/prepared-section.ts packages/ui/src/client.ts packages/shell/test/tools/prepared-section.test.ts -m "feat(shell): the prepared data section with its cuts and start items" -m "<trailer>"
```

---

### Task 6: Pre-steps at the start of a task (`TaskDeps.prepare`)

**Files:**
- Modify: `packages/shell/src/main/task-manager.ts` (`TaskDeps.prepare?`, `begin`, `contextFor`'s extra part, the refusal), `packages/runtime/src/events.ts` (`ErrorCode` gains `"prepare-failed"`), `packages/shell/src/main/turn-controller.ts` (`TurnOptions.prepared?` only as a type here; Task 8 uses it)
- Test: `packages/shell/test/task-manager-pre.test.ts` (new; build the manager as `task-manager.test.ts` does, copying its small helpers rather than importing them, since that file is frozen)

- [ ] **Step 1: Write the failing tests.**

```ts
describe("pre-steps at the start (tools spec §6)", () => {
  it("D0: without prepare the first message and start are byte-identical", async () => {
    // the same action and deps, once without `prepare` and once with a `prepare` that the action never reaches
    // (an action without `pre`): first messages equal, start lists equal, prepare never called
  });
  it("an action with pre calls prepare once with its action, scope, task id and first phase, before the first turn", async () => {
    // order: prepare, then turns.send; the task id passed is the task's id in tasks.json
  });
  it("the prepared text is a context part after the data tables and before the pins and the material", async () => {
    // dataContext "DATA", personContext pinned "PINS", materialContext "MATERIAL", prepare text "## Prepared data…"
    // → first message has DATA, then the prepared text, then PINS, then MATERIAL, joined by blank lines
  });
  it("its items join start after the data items, and the brief's estimate excludes them", async () => { /* … */ });
  it("the prepared views ride on the first turn's options", async () => { /* turns.send's options.prepared equals the answer's views */ });
  it("a required failure starts nothing: no task in tasks.json, no turn, the window gets prepare-failed with the detail", async () => {
    // prepare answers { failed: "due-today failed: boom" } → emit saw { type: "done", ok: false, error: { code: "prepare-failed", detail: "due-today failed: boom" } }
  });
  it("a Stop while preparing starts nothing once prepare returns", async () => { /* cancel() during a pending prepare → no turn, stopped() emitted */ });
  it("a prepare that throws is logged and the task starts without prepared data", async () => { /* … */ });
  it("a resumed task (after Move folder) never calls prepare", async () => { /* resume path */ });
  it("a free question and a review task never call prepare", async () => { /* … */ });
});
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**
  - `events.ts`: `ErrorCode` gains `/** A required pre-step failed: the task didn't start (tools spec §6.5). */ | "prepare-failed"`.
  - `task-manager.ts`:

```ts
/** What `prepare` answers (tools spec §6). */
export interface PrepareAnswer {
  /** The `## Prepared data` part ("" for none). */
  text: string;
  /** Its `prepared` start items. */
  items: ContextItem[];
  /** The pre calls as the chat shows them, for the first turn (Decision 8). */
  views: ToolCallView[];
  /** A required step failed: the task doesn't start; the window shows this. */
  failed?: string;
}

// in TaskDeps:
  /**
   * Runs an action's pre-steps before its session opens (tools spec §6). Absent without tools or without `pre` (D0).
   * Called only for an action that declares `pre`; never for a resumed task, a question or a review.
   */
  prepare?(o: { action: string; scope: string; task: string; phase?: string }): Promise<PrepareAnswer>;
```
  In `begin`: move `const id = this.newId();` to right after `await this.between();` (before `presetFor`); nothing else reads it earlier. Then:

```ts
    let prepared: PrepareAnswer | null = null;
    if (task.action !== undefined && task.review === undefined && task.plugin === undefined && this.d.prepare && (this.d.actions[task.action]?.pre?.length ?? 0) > 0) {
      prepared = await this.d
        .prepare({ action: task.action, scope, task: id, ...(task.phase ? { phase: task.phase.id } : {}) })
        .catch((err: unknown) => {
          console.error("Could not run the pre-steps", err);
          return null;
        });
      if (this.cancelRequested) return this.stopped();
      if (prepared?.failed !== undefined) return this.refusedStart(prepared.failed);
    }
    const preset = await this.presetFor(scope, task.action);
    const { text: context, items } = withScopeInstructions(await this.contextFor(scope, task.action, prepared && prepared.text ? prepared : undefined), preset?.instructions ?? "");
```
  `contextFor(scope, action, prepared?: { text: string; items: ContextItem[] })`: right after the data tables block, `if (prepared) { parts.push(prepared.text); items.push(...prepared.items); }`. Every other caller passes nothing (the resume path at line ~1632 included), so their messages don't change.
  The first turn: `this.firstTurn(current, first, { display, ...(task.action ? { action: task.action } : {}), ...(prepared && prepared.views.length > 0 ? { prepared: prepared.views } : {}) })`; `firstTurn`'s retry passes the same options, and `runTurn` hands `prepared` to the turn controller only on attempt 0 (a retry already shows them).
  The refusal:

```ts
  /** A start that a required pre-step stopped (tools spec §6.5): nothing was written; the chat shows why and Retry. */
  private refusedStart(detail: string): void {
    if (this.windowDone) return;
    this.windowDone = true;
    try {
      this.d.emit?.(fail("prepare-failed", detail));
    } catch (err) {
      console.error("Could not send an event to the window", err);
    }
  }
```
  (Follow `stopped()`'s shape exactly; if the real code differs, mirror it.)
  - `turn-controller.ts`: `TurnOptions` gains `/** The first turn of a task with pre-steps: their calls, shown first (tools spec §8.2). Absent: none (D0). */ prepared?: ToolCallView[];` (used in Task 8).

- [ ] **Step 4: Run** the new test, the frozen `task-manager.test.ts` and every `packages/shell/test/*task*` test (green, unchanged), `runtime-d0.test.ts`; typecheck.

- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/shell/test/task-manager-pre.test.ts
git -C <worktree> commit --only packages/shell/src/main/task-manager.ts packages/runtime/src/events.ts packages/shell/src/main/turn-controller.ts packages/shell/test/task-manager-pre.test.ts -m "feat(shell): pre-steps run before a task's session opens" -m "<trailer>"
```

---

### Task 7: The `"prepared"` start item in the store and the panel

**Files:**
- Modify: `packages/shell/src/main/task-store.ts` (`ITEM_KINDS` gains `"prepared"`), `packages/ui/src/ContextPanel.tsx` (its label), `packages/i18n/src/locales/en.json` (`"tools"` block: `"contextPrepared": "Prepared · {{name}}"`)
- Test: `packages/shell/test/task-store-prepared.test.ts` (new), `packages/ui/test/context-prepared.test.tsx` (new)

- [ ] **Step 1: Write the failing tests.**
  - store: "a prepared item is kept on read with its id, label and tokens"; "a prepared item with a path keeps it only if it is a relative path (as any item)"; "D0: a file without prepared items reads as before" (write a `tasks.json` with today's kinds, read, deep-equal).
  - panel: "a prepared item reads 'Prepared · today' with its estimate in At the start, with no Exclude, Pin or open"; "it counts in the total".

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.** `ITEM_KINDS` gains `"prepared"` (nothing else in `cleanItem` changes). `ContextPanel.tsx`'s `itemText`: before the generic line, `if (i.kind === "prepared") return t("tools.contextPrepared", { name: i.id.startsWith("prepared:") ? i.id.slice("prepared:".length) : i.label });`. A prepared item has no `path`, so it renders as a plain `<span>` (the existing branch). en.json: one key in `"tools"`.

- [ ] **Step 4: Run, typecheck, `corepack pnpm app:build`, commit.**

```bash
git -C <worktree> add packages/shell/test/task-store-prepared.test.ts packages/ui/test/context-prepared.test.tsx
git -C <worktree> commit --only packages/shell/src/main/task-store.ts packages/ui/src/ContextPanel.tsx packages/i18n/src/locales/en.json packages/shell/test/task-store-prepared.test.ts packages/ui/test/context-prepared.test.tsx -m "feat(ui): prepared data as a start item in the context panel" -m "<trailer>"
```

---

### Task 8: The prepared group in the chat, and the refused start

**Files:**
- Create: `packages/ui/src/tools/PreparedGroup.tsx`
- Modify: `packages/shell/src/main/turn-controller.ts` (emit `prepared` first), `packages/ui/src/ChatView.tsx` (draw the group), `packages/ui/src/ErrorCard.tsx` (`prepare-failed`), `packages/i18n/src/locales/en.json` (`"tools"` block)
- Test: `packages/shell/test/turn-controller-pre.test.ts` (new), `packages/ui/test/prepared-ui.test.tsx` (new)

- [ ] **Step 1: Write the failing tests.**

```ts
// turn-controller-pre.test.ts — a TurnController with a fake runtime, as the existing turn-controller tests build it
describe("prepared calls on the first turn (tools spec §8.2)", () => {
  it("D0: a turn without prepared emits what it emitted", async () => { /* the event list of a plain turn, recorded, deep-equal */ });
  it("the views arrive as tool-call events after the user entry and before any engine event", async () => { /* order */ });
  it("they are saved on the turn's assistant entry in the chat log, first in its tools", async () => {
    // chat log entry.tools = [...prepared, ...the agent's calls during the turn]
  });
  it("a held first attempt (model-unavailable fallback) shows them once, with the retry", async () => { /* … */ });
});
```
```tsx
// prepared-ui.test.tsx
describe("the prepared group (tools spec §8.2)", () => {
  it("D0: an entry without pre calls renders as before", () => { /* an entry with slice-2 agent tool lines only: same markup as slice 2's test */ });
  it("an entry's leading pre calls fold into one line: Prepared 2 items · 0.4 s · 0 tokens", () => {
    // tools: [pre due-today 300 ms, pre warmup-cards 100 ms, agent pr-ci] → one group button "Prepared 2 items · 0.4 s · 0 tokens" then pr-ci's own line
  });
  it("unfolding the group shows each call's line and each note", async () => { /* click → two ToolCallLines and "today: cut: 12 of 40 items" */ });
  it("the group is unfolded when a pre call failed", () => { /* aria-expanded true without a click */ });
  it("N counts the calls with a distinct as… forEach calls of one step count once", () => {
    // pre calls carry no `as` in the view: N is the number of distinct tool ids among the group's calls that aren't notes (Decision 8)
  });
});
describe("a refused start", () => {
  it("prepare-failed shows 'Couldn't prepare this task: <detail>' and Try again", () => { /* ErrorCard with error { code: "prepare-failed", detail } and onRetry */ });
});
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**
  - `turn-controller.ts`: at the start of a non-quiet turn with `options.prepared`, right after the user entry is out and before the engine is asked, each view goes through the same function slice 2 uses to add a `tool-call` to the running turn and its saved entry (named in `carry-notes.md` by Task 0). On a held first attempt (`holdModelError`) they are emitted only once the attempt's events reach the window, as its first content; a retry carries them again (Task 6 passes them on every attempt; the controller emits them once per shown turn).
  - The live path: slice 2's tools host must not emit `caller: "pre"` calls to the task (Task 11 makes that change; until then, a test double stands in for it).
  - `PreparedGroup.tsx`:

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ToolCallView } from "../client";
import { ToolCallLine } from "./ToolCallLine";

/** An entry's leading pre-step calls (tools spec §8.2): one folded line, open when one failed. */
export function PreparedGroup({ calls }: { calls: ToolCallView[] }) {
  const { t } = useTranslation();
  const failed = calls.some((c) => !c.ok && c.note === undefined);
  const [open, setOpen] = useState(failed);
  const items = new Set(calls.filter((c) => c.note === undefined).map((c) => c.tool)).size;
  const seconds = (calls.reduce((n, c) => n + c.ms, 0) / 1000).toFixed(1);
  return (
    <div className="hh-tool-group">
      <button type="button" className="hh-tool-line" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {t("tools.prepared", { count: items, seconds })}
      </button>
      {open && (
        <ul className="hh-tool-group-list">
          {calls.map((c, i) => (
            <li key={`${c.at}:${i}`}>{c.note !== undefined ? <span className="hh-tool-note">{c.note}</span> : <ToolCallLine call={c} />}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
```
  (Use `ToolCallLine`'s real props from slice 2.) `ChatView.tsx`: where slice 2 draws an entry's `tools`, take the leading run of `caller === "pre"` calls into `<PreparedGroup calls={…} />` and draw the rest as before; an entry with no leading pre calls draws exactly as before.
  - `ErrorCard.tsx`: `const text = error.code === "prepare-failed" ? t("tools.prepareFailed", { detail: error.detail ?? "" }) : t(\`errors.${error.code}\`, …)`; Try again shows as for other codes (the existing condition already allows it).
  - en.json `"tools"`: `"prepared_one": "Prepared {{count}} item · {{seconds}} s · 0 tokens"`, `"prepared_other": "Prepared {{count}} items · {{seconds}} s · 0 tokens"`, `"prepareFailed": "Couldn't prepare this task: {{detail}}"`. (Match how the repo writes plurals; if it doesn't use i18next plural keys, use one key with "item(s)" avoided by two keys and pick in code.)

- [ ] **Step 4: Run** the new tests, slice 2's `tool-call-ui.test.tsx` (frozen) and `state.test.ts`, `chat-log.test.ts`; typecheck; `corepack pnpm app:build`.

- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/ui/src/tools/PreparedGroup.tsx packages/shell/test/turn-controller-pre.test.ts packages/ui/test/prepared-ui.test.tsx
git -C <worktree> commit --only packages/ui/src/tools/PreparedGroup.tsx packages/shell/src/main/turn-controller.ts packages/ui/src/ChatView.tsx packages/ui/src/ErrorCard.tsx packages/i18n/src/locales/en.json packages/shell/test/turn-controller-pre.test.ts packages/ui/test/prepared-ui.test.tsx -m "feat(ui): pre-steps as one folded group on the first turn; a refused start" -m "<trailer>"
```
(Add any slice-2 file the reused path lives in to `--only` and say so.)

---

### Task 9: `pre` and `expects-miss` rows in `usage.jsonl`

**Files:**
- Modify: `packages/shell/src/main/usage-log.ts` (`UsageRecord.kind`, new fields, `preRecord`, `expectsMissRecord`, `summarizeUsage`'s walk)
- Test: `packages/shell/test/usage-pre.test.ts` (new; `usage-log.test.ts` is frozen)

- [ ] **Step 1: Write the failing tests.**

```ts
describe("pre and expects rows (tools spec §8.4)", () => {
  it("preRecord: kind pre with action, task, scope, steps, ms, preparedTokens, ok", () => {
    expect(preRecord({ engine: "claude", action: "study", task: "t1", scope: "intro", steps: 2, ms: 412, preparedTokens: 830, ok: true }, "2026-10-29T10:00:00.000Z")).toEqual({
      at: "2026-10-29T10:00:00.000Z", engine: "claude", kind: "pre", action: "study", task: "t1", scope: "intro", steps: 2, ms: 412, preparedTokens: 830, ok: true,
    });
  });
  it("expectsMissRecord: kind expects-miss with taskPhase and tool", () => { /* { at, engine, kind: "expects-miss", action, task, taskPhase: "close", tool: "apply-evidence", ok: true } */ });
  it("D0: a log without pre or expects rows summarises as before", () => {
    // a fixed log of task turns, job lines and a compaction: summarizeUsage deep-equals the value computed before this task (record it)
  });
  it("a pre row between two tasks' turns leaves both measured", () => {
    // task A's last turn, then a pre row (no limits), then task B's first turn: A's estimate is the same as without the pre row
  });
  it("an expects-miss row is not a turn: no task, scope or token total changes", () => { /* … */ });
  it("recentUsage counts pre rows like other non-job lines", () => { /* documented behaviour */ });
});
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**

```ts
/** Rows that are not turns (tools spec §8.4): a pre-step group, a recipe run (slice 4), an expected tool not called. */
export const TOOL_ROW_KINDS: readonly string[] = ["pre", "recipe", "expects-miss"];

// UsageRecord: kind?: "checkpoint" | "compaction" | "pre" | "recipe" | "expects-miss";
//   /** Tool rows only (tools spec §8.4). */ steps?: number; ms?: number; preparedTokens?: number; tool?: string;
//   /** Recipe rows only (slice 4). */ run?: string; toolSteps?: number; aiSteps?: number;

/** A task's pre-steps (tools spec §8.4): one row per start that ran them. */
export function preRecord(o: { engine: string; action: string; task: string; scope?: string; steps: number; ms: number; preparedTokens: number; ok: boolean }, at: string = new Date().toISOString()): UsageRecord {
  return { at, engine: o.engine, kind: "pre", action: o.action, task: o.task, ...(o.scope ? { scope: o.scope } : {}), steps: o.steps, ms: o.ms, preparedTokens: o.preparedTokens, ok: o.ok };
}

/** A phase that ended without a call to a tool it expects (tools spec §6.1). */
export function expectsMissRecord(o: { engine: string; action: string; task: string; scope?: string; taskPhase: string; tool: string }, at: string = new Date().toISOString()): UsageRecord {
  return { at, engine: o.engine, kind: "expects-miss", action: o.action, task: o.task, ...(o.scope ? { scope: o.scope } : {}), taskPhase: o.taskPhase, tool: o.tool, ok: true };
}
```
  `summarizeUsage`: `const all = records.filter((r) => r.kind !== "compaction" && !(r.kind !== undefined && TOOL_ROW_KINDS.includes(r.kind)));` — the only change; a log without tool rows gives the same `all` (D0).

- [ ] **Step 4: Run** the new test and the frozen `usage-log.test.ts`; typecheck.

- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/shell/test/usage-pre.test.ts
git -C <worktree> commit --only packages/shell/src/main/usage-log.ts packages/shell/test/usage-pre.test.ts -m "feat(shell): pre and expects-miss rows in usage.jsonl" -m "<trailer>"
```

---

### Task 10: `expects`: the misses and the part-end hook

**Files:**
- Create: `packages/shell/src/main/tools/expects.ts`
- Modify: `packages/shell/src/main/task-manager.ts` (`TaskDeps.phaseEnded?`, calls in `enterPhase` and after the closing turn)
- Test: `packages/shell/test/tools/expects.test.ts` (new), `packages/shell/test/task-manager-expects.test.ts` (new)

- [ ] **Step 1: Write the failing tests.**

```ts
// expects.test.ts
describe("expectsMisses (tools spec §6.1)", () => {
  it("a tool called in that part by this task is not a miss", () => {
    expect(expectsMisses([entry({ tool: "apply-evidence", task: "t1", phase: "close" })], { task: "t1", phase: "close", expects: ["apply-evidence"] })).toEqual([]);
  });
  it("a call in another part, of another task, or a note doesn't count", () => {
    const es = [entry({ tool: "apply-evidence", task: "t1", phase: "main" }), entry({ tool: "apply-evidence", task: "t2", phase: "close" }), entry({ tool: "apply-evidence", task: "t1", phase: "close", note: "x" })];
    expect(expectsMisses(es, { task: "t1", phase: "close", expects: ["apply-evidence"] })).toEqual(["apply-evidence"]);
  });
  it("a failed call still counts as called", () => { /* ok: false entry → not a miss */ });
  it("each expected tool is reported once, in the order declared", () => { /* … */ });
});
```
```ts
// task-manager-expects.test.ts — the manager with a phased action (phases main → close with expects on both)
describe("phaseEnded (tools spec §6.1)", () => {
  it("moving from a part calls phaseEnded with the task, its action, scope and the part it left", async () => { /* setPhase("close") → { task, action: "study", scope, phase: "main" } */ });
  it("the closing turn calls it for the part the task closes in, after the turn", async () => { /* finish() → phaseEnded({ phase: "close" }) after turns.send of the close prompt resolved */ });
  it("a cancelled closing turn or a task cancelled midway calls nothing", async () => { /* … */ });
  it("an agent's auto move and the time box's move call it too", async () => { /* … */ });
  it("a phaseEnded that throws is logged; the move goes on", async () => { /* … */ });
  it("D0: without phaseEnded nothing changes (the move's calls and writes are as before)", async () => { /* … */ });
});
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**

```ts
// expects.ts
import type { TraceEntry } from "./tool-trace";

/** The expected tools this task didn't call in this part (tools spec §6.1). Notes aren't calls; a failed call counts. */
export function expectsMisses(entries: readonly TraceEntry[], o: { task: string; phase: string; expects: readonly string[] }): string[] {
  const called = new Set(entries.filter((e) => e.task === o.task && e.phase === o.phase && e.note === undefined).map((e) => e.tool));
  return [...new Set(o.expects)].filter((t) => !called.has(t));
}
```
  `task-manager.ts`:

```ts
  /**
   * A task left a part (a move of any kind, or the closing turn of the part it closes in): its `expects` are checked
   * (tools spec §6.1). Fire and forget; absent without expects (D0).
   */
  phaseEnded?(o: { task: string; action: string; scope: string; phase: string }): Promise<void>;
```
  A private `endedPhase(c: CurrentTask, phase: string | undefined)` calls it when `c.action` and `phase` are set, catching and logging. Call it in `enterPhase` once `moved` is true, with `c.phase?.id` (the part left); and in `closeCurrent`, after the closing turn, when `!cancelled`, with the phase the task had (`c.phase?.id`).

- [ ] **Step 4: Run** the new tests, the frozen `task-manager.test.ts`, every `phase*` test in `packages/shell/test/`; typecheck.

- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/shell/src/main/tools/expects.ts packages/shell/test/tools/expects.test.ts packages/shell/test/task-manager-expects.test.ts
git -C <worktree> commit --only packages/shell/src/main/tools/expects.ts packages/shell/src/main/task-manager.ts packages/shell/test/tools/expects.test.ts packages/shell/test/task-manager-expects.test.ts -m "feat(shell): expects — a part's expected tools checked when it ends" -m "<trailer>"
```

---

### Task 11: Wiring: `toolsHost.prepare`, `toolsHost.phaseEnded`, and `TaskDeps` in index.ts

**Files:**
- Modify: `packages/shell/src/main/tools/tools-host.ts` (`prepare`, `phaseEnded`, no live emission for `caller: "pre"`), `packages/shell/src/main/index.ts` (`taskDeps.prepare`, `taskDeps.phaseEnded` under the gates)
- Test: `packages/shell/test/tools/tools-host-pre.test.ts` (new), `packages/shell/test/tools-pre-surface.test.ts` (new)

- [ ] **Step 1: Write the failing tests.**

```ts
// tools-host-pre.test.ts — createToolsHost with slice 2's doubles (registry over a host double, a trace in a temp folder)
describe("toolsHost.prepare (tools spec §6)", () => {
  it("runs the action's pre-steps and answers the section, items and views", async () => { /* … */ });
  it("cuts to the action's preTokens (default 4000) and writes one trace note per cut", async () => { /* … */ });
  it("writes one pre row: steps, ms, preparedTokens, ok", async () => { /* usage double */ });
  it("a required failure answers failed '<tool> failed: <message>' and writes the row with ok false", async () => { /* … */ });
  it("tools off: every step fails with the off reason, and a required one stops the start", async () => { /* … */ });
  it("pre calls are not emitted to the task live; agent and UI calls still are", async () => { /* emitToTask sees only the agent call */ });
});
describe("toolsHost.phaseEnded (tools spec §6.1)", () => {
  it("reads the task's trace and writes one expects-miss row and one note per miss", async () => {
    // note text "Expected apply-evidence in Close: not called" (the part's label), caller "agent", task, phase
  });
  it("no miss: nothing written", async () => { /* … */ });
  it("a part without expects reads nothing", async () => { /* trace.read never called */ });
});
```
```ts
// tools-pre-surface.test.ts
// "D0: prepare and phaseEnded are passed only under hasTools and hasPre/hasExpects": index.ts sets taskDeps.prepare
// only inside a block guarded by hasTools(harness) && hasPre(harness), and phaseEnded by hasTools && hasExpects
// (read index.ts's text, as slice 2's tools-surface.test.ts does)
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**
  - `tools-host.ts`:

```ts
    /** An action's pre-steps (tools spec §6): TaskDeps.prepare. */
    async prepare(o: { action: string; scope: string; task: string; phase?: string }): Promise<PrepareAnswer> {
      const action = d.harness.actions[o.action];
      const steps = action?.pre ?? [];
      const views: ToolCallView[] = [];
      const run = await runPreSteps({ registry: recording(registry, views), steps, task: o.task, scope: scopeOrNull(o.scope), ...(o.phase ? { phase: o.phase } : {}) });
      const json = await registry.json();
      const descriptions = json.on ? Object.fromEntries(Object.entries(json.tools).map(([id, m]) => [id, m.description])) : {};
      const part = preparedSection(run.results, { descriptions, preTokens: action?.preTokens ?? PRE_TOKENS_DEFAULT });
      for (const c of part.cuts) await registry.note({ tool: c.tool, caller: "pre", task: o.task, ...(o.phase ? { phase: o.phase } : {}), text: c.text });
      await d.usage(preRecord({ engine: await d.engine(), action: o.action, task: o.task, ...(d.scoped ? { scope: o.scope } : {}), steps: steps.length, ms: run.ms, preparedTokens: part.tokens, ok: run.results.every((r) => r.ok) })).catch((err: unknown) => console.error("Could not record the pre-steps", err));
      if (run.requiredFailure) return { text: "", items: [], views, failed: `${run.requiredFailure.tool} failed: ${run.requiredFailure.error}` };
      return { text: part.text, items: part.items, views };
    },
```
  `recording(registry, views)` wraps `registry` so each call's and note's `TraceEntry` (through the `called` hook slice 2 has) is turned into a view and pushed to `views` instead of being emitted to the task: in the `called` handler, `if (entry.caller === "pre") { pendingPre.get(entry.task)?.push(view(entry)); return; }`. `scopeOrNull`: the app scope or `main` without scopes is `null` for `ctx.scope`, as slice 2 maps an app-wide UI call (reuse its mapping). New deps of `createToolsHost`: `usage(record)`, `engine()`, `scoped`.
  - `phaseEnded(o)`: find the action's phase by id; no `expects` → return; `entries = await trace.read(o.task)`; for each miss: `usage(expectsMissRecord({ …, taskPhase: o.phase, tool }))` and `registry.note({ tool, caller: "agent", task: o.task, phase: o.phase, text: \`Expected ${tool} in ${label}: not called\` })` (the note reaches the chat through `called` like any agent call).
  - `index.ts` (additive, inside the existing `hasTools` wiring): `...(toolsHost && hasPre(harness) ? { prepare: (o) => toolsHost!.prepare(o) } : {})` and `...(toolsHost && hasExpects(harness) ? { phaseEnded: (o) => toolsHost!.phaseEnded(o) } : {})` in `taskDeps` (it's a `const` object today: use a getter or build the two entries where `toolsHost` exists, keeping the object's other keys untouched). Board lanes take `taskDeps` as is.

- [ ] **Step 4: Run** the new tests and slice 2's `tools-host.test.ts`, `tools-surface.test.ts`; typecheck; `corepack pnpm app:build`.

- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/shell/test/tools/tools-host-pre.test.ts packages/shell/test/tools-pre-surface.test.ts
git -C <worktree> commit --only packages/shell/src/main/tools/tools-host.ts packages/shell/src/main/index.ts packages/shell/test/tools/tools-host-pre.test.ts packages/shell/test/tools-pre-surface.test.ts -m "feat(shell): pre-steps and expects wired in the app, only when declared" -m "<trailer>"
```

---

### Task 12: Fixture and e2e

**Files:**
- Modify: `packages/fake-agent/fixtures/tools-harness/` (slice 2's): a tool `due-today` (`returns` an array of `{ id, title }`, `uses: {}`, answers three fixed items), a tool `pick-two` (`input` reader: returns the first two of `ctx.inputs.today`), a tool `always-fails` (throws "boom"), an action `study` with `pre: [{ tool: "due-today", as: "today" }, { tool: "pick-two", input: ["today"], as: "warmup" }]` and phases `main`, `close` (`close` with `expects: ["count-notes"]`), an action `strict` with `pre: [{ tool: "always-fails", as: "x", required: true }]`; the rebuilt `dist/`; the fake-claude script's turns (below)
- Create: `packages/e2e/tests/tools-pre.spec.ts`

- [ ] **Step 1: Fixture.** Add the tools and actions above (briefs in `agent/tasks/study.md` and `strict.md`, one line each). The fake-claude script gets a turn whose `match` is `## Prepared data[\\s\\S]*### today · due-today[\\s\\S]*### warmup · pick-two` and answers the text "Saw the prepared data." with a `set_phase` to `close` (so the task can close), and a turn matching the close prompt that saves a note without calling `count-notes`. Rebuild `dist/` with `node packages/cli/bin/humanharness.js build --harness packages/fake-agent/fixtures/tools-harness`; `fixture-dist.test.ts` (slice 2) stays green.

- [ ] **Step 2: e2e** (`HH_TEST_FAKE_SECRETS=1`, the fixture's fake-claude script, as slice 2's `tools.spec.ts` launches it):
  - "a pre-step's result reaches the first message": start Study; the answer "Saw the prepared data." shows (the script's turn matched only if the first message held both blocks);
  - "the chat shows one folded group above the first answer": "Prepared 2 items · … s · 0 tokens"; unfolding shows `due-today` and `pick-two` lines;
  - "the context panel lists the prepared items": open the panel; "At the start" has "Prepared · today" and "Prepared · warmup" with estimates;
  - "a pre row is written": `.harness/usage.jsonl` has one line `kind: "pre"`, `action: "study"`, `steps: 2`, `ok: true`;
  - "a required pre-step that fails starts nothing": start Strict; the chat shows "Couldn't prepare this task: always-fails failed: boom" and "Try again"; `tasks.json` has no current task;
  - "an expected tool not called is counted": finish Study; `usage.jsonl` has `kind: "expects-miss"`, `taskPhase: "close"`, `tool: "count-notes"`, and the chat shows "Expected count-notes in Close: not called".

- [ ] **Step 3: Run** `corepack pnpm app:build`, the new spec, slice 2's `tools.spec.ts`, `history.spec.ts`, `context.spec.ts`, `phases.spec.ts`.

- [ ] **Step 4: Commit.**

```bash
git -C <worktree> add packages/fake-agent/fixtures/tools-harness packages/e2e/tests/tools-pre.spec.ts
git -C <worktree> commit --only packages/fake-agent/fixtures/tools-harness packages/e2e/tests/tools-pre.spec.ts -m "test(e2e): pre-steps — first message, folded group, context panel, required failure, expects" -m "<trailer>"
```

---

### Task 13: The demo's `list-sources`

**Files:**
- Create: `harnesses/demo/tools/list-sources.ts`, `harnesses/demo/test/list-sources.test.ts`, `harnesses/demo/dist/tools.json`, `harnesses/demo/dist/tools/list-sources.js` (built), `packages/cli/test/demo-dist.test.ts`
- Modify: `harnesses/demo/harness.config.ts` (`tools`, `pre` on the topics), `harnesses/demo/HARNESS.md` (a decision-log entry and the Flow note), `.gitignore` (`!harnesses/demo/dist/`)

- [ ] **Step 1: Write the failing tests.**

```ts
// harnesses/demo/test/list-sources.test.ts — the tool's run() with a fake ctx (no app, no sandbox)
describe("list-sources (tools spec §13 demo)", () => {
  it("lists each package's src files, sorted, at most 40, with more", async () => {
    // ctx.files.list("refs/source/packages", "*/src/**") answers 45 paths under packages/a/src and 2 under packages/b/src
    // → packages [{ name: "a", path: "packages/a", files: <first 40 relative to the package>, more: 5 }, { name: "b", … files: 2 }]
  });
  it("a package's role is its README's first sentence when it has one", async () => { /* packages/e2e/README.md "End-to-end tests. More." → role "End-to-end tests." */ });
  it("each docs/architecture file with its first paragraph's first sentence", async () => {
    // "# A turn end to end\n\nA turn is one message from the person and the agent's complete answer. It crosses…" → role "A turn is one message from the person and the agent's complete answer."
  });
  it("uses only ctx.files (uses: files read)", async () => { /* the tool's uses deep-equal { files: "read" } */ });
});
```
```ts
// packages/cli/test/demo-dist.test.ts
// "the demo's tools dist matches a fresh build": buildTools(harnesses/demo, { write: false }) byte-equals the committed files
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**

```ts
// harnesses/demo/tools/list-sources.ts
// The demo depends on the SDK, not the CLI: the same defineTool through its `./tool` sub-path (slice 2 Task 1).
import { defineTool, z } from "@humanharness/harness-sdk/tool";

const FILES_MAX = 40;
const firstSentence = (text: string): string | undefined => {
  const para = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p && !p.startsWith("#"));
  if (!para) return undefined;
  const one = para.replace(/\s+/g, " ");
  const end = one.search(/[.!?](\s|$)/);
  return (end >= 0 ? one.slice(0, end + 1) : one).slice(0, 200);
};

export default defineTool({
  description:
    "The Human Harness source by package: each package's src files and a one-line role, and each architecture doc with its first sentence. Read this before exploring the reference folder.",
  params: z.object({}),
  returns: z.object({
    packages: z.array(z.object({ name: z.string(), path: z.string(), role: z.string().optional(), files: z.array(z.string()), more: z.number().int().optional() })),
    docs: z.array(z.object({ path: z.string(), role: z.string() })),
  }),
  uses: { files: "read" },
  summary: (r) => `${r.packages.length} packages, ${r.docs.length} docs`,
  run: async (_args, ctx) => {
    const root = "refs/source";
    const srcFiles = await ctx.files.list(`${root}/packages`, "*/src/**");
    const byPackage = new Map<string, string[]>();
    for (const f of srcFiles) {
      const [name, ...rest] = f.split("/");
      if (!name || rest.length === 0) continue;
      byPackage.set(name, [...(byPackage.get(name) ?? []), rest.join("/")]);
    }
    const readmes = new Set(await ctx.files.list(`${root}/packages`, "*/README.md"));
    const packages = [];
    for (const name of [...byPackage.keys()].sort()) {
      const files = byPackage.get(name)!.sort();
      const role = readmes.has(`${name}/README.md`) ? firstSentence(await ctx.files.read(`${root}/packages/${name}/README.md`)) : undefined;
      packages.push({ name, path: `packages/${name}`, ...(role ? { role } : {}), files: files.slice(0, FILES_MAX), ...(files.length > FILES_MAX ? { more: files.length - FILES_MAX } : {}) });
    }
    const docs = [];
    for (const f of (await ctx.files.list(`${root}/docs/architecture`, "*.md")).sort()) {
      const role = firstSentence(await ctx.files.read(`${root}/docs/architecture/${f}`));
      if (role) docs.push({ path: `docs/architecture/${f}`, role });
    }
    return { packages, docs };
  },
});
```
  (Check slice 2's `ctx.files.list` contract — relative to `dir`, sorted, ≤ 1000 entries, glob `*`/`**` — and adapt; `node_modules` folders are under `packages/*/` but not under `src/`.) `harness.config.ts`: `tools: { "list-sources": "./tools/list-sources.ts" }`; the `topic` helper adds `pre: [{ tool: "list-sources", as: "sources" }]`. Build: `node packages/cli/bin/humanharness.js build --harness harnesses/demo`; `.gitignore` gains `!harnesses/demo/dist/` after the plugins' exception, with the comment "The demo's tools ship built: the e2e app loads the demo and can't build (a test checks it matches a fresh build)."; `git add -f` is not needed once the exception is in. HARNESS.md: under Flow, "Each topic starts with `list-sources` as a pre-step: the packages and docs come prepared, so the agent reads fewer files to find its way."; a Decision log entry (2026-10-29, the tools spec's first measurement; rejected: leaving the agent to explore).

- [ ] **Step 4: Run** the demo's tests (`corepack pnpm vitest run harnesses/demo/test`), `demo-dist.test.ts`, `corepack pnpm app:build`, then the whole e2e suite (`corepack pnpm e2e`): the built shell loads the demo, so every demo spec now starts topics with a pre-step. If a spec other than the frozen ones fails only because of the new prepared item or group, stop and report it with the failing expectation (don't loosen it).

- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add harnesses/demo/tools/list-sources.ts harnesses/demo/test/list-sources.test.ts harnesses/demo/dist/tools.json harnesses/demo/dist/tools/list-sources.js packages/cli/test/demo-dist.test.ts
git -C <worktree> commit --only harnesses/demo/tools/list-sources.ts harnesses/demo/test/list-sources.test.ts harnesses/demo/dist/tools.json harnesses/demo/dist/tools/list-sources.js harnesses/demo/harness.config.ts harnesses/demo/HARNESS.md .gitignore packages/cli/test/demo-dist.test.ts -m "feat(demo): list-sources prepares the packages and docs for every topic" -m "<trailer>"
```

---

### Task 14: `humanharness measure`, and `run`'s notice

**Files:**
- Create: `packages/cli/src/measure.ts`
- Modify: `packages/cli/src/main.ts` (command `measure`, USAGE line), `packages/cli/src/run.ts` (one notice when the action has `pre`), `packages/shell/src/main/usage-log.ts` (export `measurePre`, pure), `packages/shell/src/main/tasks.ts` (re-export `measurePre` beside `UsageLog`: the CLI's way in, `@humanharness/shell/tasks`)
- Test: `packages/shell/test/usage-measure.test.ts` (new), `packages/cli/test/measure.test.ts` (new), `packages/cli/test/run-pre.test.ts` (new)

- [ ] **Step 1: Write the failing tests.**

```ts
// usage-measure.test.ts
describe("measurePre (tools spec §8.4)", () => {
  it("per action: tasks with a pre row and without, their average first-turn tokens, preparedTokens and ms", () => {
    // log: study task A (no pre) first run turn 100k in, 20k cache read; study task B with pre row (preparedTokens 800, ms 300) first turn 40k
    // → { study: { without: { tasks: 1, firstTurn: 120000 }, with: { tasks: 1, firstTurn: 40000, preparedTokens: 800, ms: 300 } } }
  });
  it("a task's first turn is its first run line; close, checkpoint, job and material lines don't count", () => { /* … */ });
  it("a task with no usage on its first turn is left out", () => { /* … */ });
  it("an empty log gives {}", () => { /* … */ });
});
```
```ts
// measure.test.ts — measureCommand with a temp folder holding .harness/usage.jsonl
// "prints one block per action: with and without pre-steps, first-turn tokens, prepared tokens, pre time"
// "a folder without usage.jsonl says 'No usage recorded in <folder> yet.' and exits 0"
// "--folder is required when the current folder has no .harness" (UsageError text)
```
```ts
// run-pre.test.ts — runCommand on a temp harness whose action has pre
// "prints 'Pre-steps are not run in the terminal yet.' once before the first turn, and the first message has no Prepared data"
// "D0: an action without pre prints nothing new"
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**

```ts
// usage-log.ts
export interface PreMeasure {
  without: { tasks: number; firstTurn: number };
  with: { tasks: number; firstTurn: number; preparedTokens: number; ms: number };
}
/** First-turn tokens of each action's tasks with and without pre-steps (tools spec §8.4: the baseline for savings). */
export function measurePre(records: UsageRecord[]): Record<string, PreMeasure> {
  const pre = new Map<string, UsageRecord>();
  for (const r of records) if (r.kind === "pre" && r.task) pre.set(r.task, r);
  const first = new Map<string, UsageRecord>();
  for (const r of records) if (r.task && r.action && (r.phase ?? "run") === "run" && !r.kind && !first.has(r.task)) first.set(r.task, r);
  const sums: Record<string, { w: number[]; wo: number[]; prep: number[]; ms: number[] }> = {};
  for (const [task, r] of first) {
    if (!r.usage) continue;
    const t = r.usage.inputTokens + (r.usage.cacheReadTokens ?? 0) + (r.usage.cacheWriteTokens ?? 0);
    const s = (sums[r.action!] ??= { w: [], wo: [], prep: [], ms: [] });
    const p = pre.get(task);
    if (p) {
      s.w.push(t);
      s.prep.push(p.preparedTokens ?? 0);
      s.ms.push(p.ms ?? 0);
    } else s.wo.push(t);
  }
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
  return Object.fromEntries(
    Object.entries(sums).map(([a, s]) => [a, { without: { tasks: s.wo.length, firstTurn: avg(s.wo) }, with: { tasks: s.w.length, firstTurn: avg(s.w), preparedTokens: avg(s.prep), ms: avg(s.ms) } }]),
  );
}
```
  (Use `TurnUsage`'s real field names.) `measure.ts`: `measureCommand(args, io)`: `--folder <dir>` (default: the current folder when it has `.harness/`, else a `UsageError` "Run it in a harness folder, or pass --folder <dir>."); reads `new UsageLog(folder).load(Infinity)` and `measurePre` from `@humanharness/shell/tasks` (as `run.ts` imports `UsageLog`); prints

```
study
  without pre-steps: 3 tasks, first turn ≈ 118,400 tokens
  with pre-steps:    2 tasks, first turn ≈ 41,200 tokens; prepared ≈ 820 tokens in 0.3 s
```
  `main.ts`: `measure: measureCommand`; USAGE `"  measure [--folder <dir>]                Print first-turn tokens with and without pre-steps, per action"`. `run.ts`: when the action has `pre`, write "Pre-steps are not run in the terminal yet." once before the first turn (Decision 18).

- [ ] **Step 4: Run** the new tests, `main.test.ts` (update USAGE only if it pins the full text; say so), `run.test.ts`; typecheck.

- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/cli/src/measure.ts packages/shell/test/usage-measure.test.ts packages/cli/test/measure.test.ts packages/cli/test/run-pre.test.ts
git -C <worktree> commit --only packages/cli/src/measure.ts packages/cli/src/main.ts packages/cli/src/run.ts packages/shell/src/main/usage-log.ts packages/shell/src/main/tasks.ts packages/shell/test/usage-measure.test.ts packages/cli/test/measure.test.ts packages/cli/test/run-pre.test.ts -m "feat(cli): humanharness measure — first-turn tokens with and without pre-steps" -m "<trailer>"
```
(Add `packages/cli/test/main.test.ts` to `--only` if it changed.)

---

### Task 15: Docs and the full run

**Files:**
- Modify: `docs/architecture/tools.md` (a "Pre-steps" section, "Expects", "Measuring"), `context.md` (the prepared part and its item), `phases.md` (`expects`), `manifest.md` (`pre`, `preTokens`, `expects`), `authoring.md` (`humanharness measure`)

- [ ] **Step 1: `tools.md`.** "Pre-steps": the manifest keys and limits (Decisions 13, 14), the runner (order, `input`, `forEach` with its caps, failures, `required`), `## Prepared data` (its exact text, placement, fences, cuts, Decisions 1–3), the start items, the chat group and the refused start (Decisions 4, 8), resumed tasks (Decision 6), Stop (Decision 7), `run` (Decision 18). "Expects": when it's checked, what counts, the row and the line (Decisions 11, 12). "Measuring": the two row shapes (Decision 10), `humanharness measure`, and **the first measurement's method** for Marco: on the demo with a real engine, run each topic once on the slice-2 build (no pre-steps) and once on this one, in fresh folders, same engine and tier; then `humanharness measure --folder <folder>`; a table with one row per topic (first turn without, with, prepared tokens, pre time) left empty with "Pending: Marco's run". D0 table, threat rows P1–P6, known gaps (`run` without pre-steps until slice 5; the panel's "First turn" includes tool calls, as before; `linked-folders` items missing from `task-store`'s kinds, a bug noted, not fixed here).
- [ ] **Step 2: `context.md`** (the first message's order with the prepared part, the `prepared` item), **`phases.md`** (`expects` on a part), **`manifest.md`** (the three keys), **`authoring.md`** (`measure`).
- [ ] **Step 3: Full run.** `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm app:build`, `corepack pnpm e2e`. Both frozen-list commands from context.md print nothing.
- [ ] **Step 4: Commit.**

```bash
git -C <worktree> commit --only docs/architecture/tools.md docs/architecture/context.md docs/architecture/phases.md docs/architecture/manifest.md docs/architecture/authoring.md -m "docs: pre-steps, expects and the first measurement's method" -m "<trailer>"
```

---

## Parallel execution

0 first. 1 → 2 (sdk). 3 needs 1. 4 needs 3. 5 is independent of 1–4 (pure; it adds the `"prepared"` kind). 6 needs 4, 5. 7 needs 5. 8 needs 6. 9 is independent of 1–8. 10 needs 3. 11 needs 6, 8, 9, 10. 12 needs 7, 11. 13 needs 11. 14 needs 9. 15 last. Sixteen tasks (0–15).
