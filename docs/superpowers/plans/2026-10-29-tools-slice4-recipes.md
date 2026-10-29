# Tools and recipes, slice 4 (job recipes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship delivery slice 4 of the tools-and-recipes spec (§15.4): a job declares `prompt` (an AI job, exactly as part 3 built it) or `steps` (a recipe): tool steps, at most one AI step that runs only when its `when` holds and ends with the core block `step_output`, a post-step tool that may ask for another AI round with `ctx.requestAi` (capped by `maxAi`), and a run result mapped to part 3's `job_result` shape and `jobs.jsonl` record. `ctx.summary` sets the run's line. A recipe run writes one `recipe` row in `usage.jsonl`; its calls show as folded lines under the run in the inbox and Settings › Jobs. A harness whose jobs all declare `prompt` is byte for byte slice 3's app.

**Architecture.**

*SDK* (`packages/harness-sdk/src/recipes.ts`, new): `whenSchema`, `aiStepSchema` (`{ ai, input, output, when?, tier?, as? }`, `output` a zod object), `jobStepSchema` (slice 3's `toolStepSchema` or an AI step), `STEP_OUTPUT_TOOL = "step_output"`, `MAX_AI_CAP = 3`, `RECIPE_STEPS_MAX = 20`, `isAiStep`, `aiStepOf(job)`, `postStepIndex(job)`, `hasRecipes(h)`, `jobUsesAi(job)`, `recipeProblems(h)` (manifest-only checks) and `recipeSourceProblems(h, json)` (the checks that need `tools.json`, through slice 3's `sourceProblems` with the AI step as a source). `jobs.ts`: `jobSchema` gains `steps`, `maxAi`, `onLimit`; `prompt` becomes optional; `jobProblems` checks "prompt or steps, never both", `dailyTokens` with `every` only when the job uses AI, and refuses `permissions` on a recipe. `loadHarness` resolves an AI step's brief like a job's prompt.

*Blocks* (`packages/blocks/src/ui-server.ts`): a third mode, `step: <job id>` (env `HH_STEP`): the server has one tool, `step_output`, whose input schema is that job's AI step `output`; nothing else.

*Runtime* (`packages/runtime/src/workspace.ts`): `SlotOptions.kind` gains `"step"` (with `job`): its MCP list is the step-mode `ui` server only (no data, material, review or `tools` server, no harness MCP servers), permissions narrowed to `edit: "none"`, no exec, no web, and no reference folders. Task and job slots clear `HH_STEP` only when the harness has a recipe (D0).

*Main* (`packages/shell/src/main/`):
- `tools/tool-broker.ts`, `tools/tool-registry.ts`, `resources/tool-host.mjs`: `ctx.summary(text)` (one line, at most 300 characters; kept by a job run, ignored by other callers) and `ctx.requestAi(input)` (only in a call the runner marks `post`, once per call, input at most 1 MB). `ToolCall.post?`; `ToolAnswer` gains `summary?` and `requestAi?`. Slice 3's `runToolStep` carries both out.
- `jobs/when.ts` (new, pure): `whenHolds(when, values)`; `jobs/step-data.ts` (new, pure): `dataSection(parts)`, the AI step's `## Data`.
- `jobs/ai-step.ts` (new): `runAiStep` opens a `step:<run>:<round>` slot, sends the brief and `## Data`, takes the first valid `step_output`, retries once with the validation error, counts tokens and writes the usual job usage lines.
- `jobs/recipe-runner.ts` (new): `runRecipe` — same gate, `stillValid`, time limit and cancel as `runJob`; tool steps through slice 3's `runToolStep` with `caller: "job"`, `job`, `run`; the `when`; the AI step; the post-step and its extra rounds; the result mapping of §7.4; the same `JobRunRecord`; one `recipe` usage row; trace notes for AI rounds.
- `jobs/jobs-host.ts`: a run of a job with `steps` goes to `runRecipe`, any other to `runJob` (untouched); `JobsHostDeps.tools?`; `JobSummary.last.run` when the harness has tools. `jobs/job-scheduler.ts`: a job that uses no AI is never paused by a daily cap.
- `usage-log.ts`: `recipeRecord`.

*Window*: `JobRunSteps.tsx` (new): under a run's summary in the inbox's Jobs rows and Settings › Jobs, "Steps" unfolds the run's trace (`client.tools.trace(run)`) as slice 2's `ToolCallLine`s.

*Mock mode*: a step turn in `dev --mock` plays nothing and saves no session state, so the AI step ends without output and the run fails "The AI step gave no valid output". Answering AI steps from a recording is slice 5's.

**Tech Stack:** TypeScript, Zod 4 (`z.toJSONSchema` for the AI step's output), MCP SDK, React 19, Vitest, Playwright (fake-claude scripts).

**Spec:** `docs/superpowers/specs/2026-10-28-tools-and-recipes-design.md` §2 D6; §3 (the `jobs.sync` example); §3.3 (`when`, `maxAi`, `onLimit`, prompt or steps); §4.2 (`ctx.requestAi`, `ctx.summary`); §5 (runner caller `job`); §7 (all); §8.1–8.2 (job run lines), §8.4 (`recipe` row); §10 (failed job step, invalid output twice); §13 (runner rows: `when` forms, `step_output` retry, `requestAi` up to `maxAi`, the result mapping; e2e "a job recipe with a conditional AI step, a post-step and one extra round"); §14 (parallel tasks and jobs); §15 slice 4. Also `docs/architecture/jobs.md` (part 3 as built). **Base:** slice 3's end on `feat/tools-pre`. **Branch:** `feat/tools-recipes`, created from `feat/tools-pre` in Task 0.

---

## Conventions

As slices 1–3:
- worktree `/Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-sidekick`, never `cd` elsewhere;
- commands: one file `corepack pnpm vitest run <path>`; all `corepack pnpm typecheck` and `corepack pnpm test`; shell main, preload, resources or UI touched: `corepack pnpm app:build`; e2e `corepack pnpm --filter @humanharness/e2e exec playwright test <file>` (or `corepack pnpm e2e`);
- install nothing (no `pnpm install` of any kind, no `npx` that downloads);
- git: `git -C <worktree> …`, one command per call; `git add` new files, then `git commit --only <every path of the task> -m … -m "<trailer>"`; never push, never a bare `git stash`, never commit on another branch;
- English everywhere; tests in `packages/<name>/test/`; one behaviour per `it`;
- en.json: only inside slice 2's top-level `"tools"` block;
- hot files (`index.ts`, `workspace.ts`, `jobs-host.ts`, `job-scheduler.ts`, `usage-log.ts`, `client.ts`, `Inbox.tsx`, `JobsTab.tsx`, `ui-server.ts`, `ui-server-bin.ts`, `mock-claude.ts`) changed small and additive. `job-runner.ts` is not changed at all.

Trailer:

```
Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv
```

**Security rules (every task).** Never read `~/.claude`, `~/.codex`, `~/.gemini`, `~/.config/opencode`, `~/.local/share/opencode`, `~/.ssh`, `~/.netrc` or any credential, token or account file. Tests never touch the real Keychain (fake `SecretCrypto`, `HH_TEST_FAKE_SECRETS=1` in e2e), never raise OS notifications or touch the Dock, never reach the network beyond 127.0.0.1. Never run the real `claude`, `codex` or `opencode` (e2e uses fake-claude scripts; mock mode for `dev --mock`).

## Frozen files

Byte-identical at the end of every task (each task's last step runs both commands; both print nothing):

```bash
git -C <worktree> diff --stat feat/harness-hatches -- packages/shell/test/plugin-*.test.ts packages/shell/test/plugins-*.test.ts packages/shell/test/plugins-fixtures.ts packages/cli/test/plugin-*.test.ts packages/harness-sdk/test/plugin*.test.ts packages/harness-sdk/test/define-plugin.test.ts packages/e2e/tests/plugins.spec.ts packages/e2e/tests/plugins-surface.spec.ts packages/shell/test/jobs/ packages/harness-sdk/test/jobs.test.ts packages/blocks/test/ui-server-job.test.ts packages/ui/test/jobs-ui.test.tsx packages/e2e/tests/jobs.spec.ts packages/shell/src/main/jobs/job-runner.ts packages/shell/src/main/jobs/job-prompt.ts packages/shell/src/main/jobs/job-log.ts
git -C <worktree> diff --stat feat/tools-pre -- packages/runtime/test/runtime-d0.test.ts packages/runtime/test/hatches-d0.test.ts packages/runtime/test/claude-cli.test.ts packages/shell/test/hatches-surface.test.ts packages/e2e/tests/history.spec.ts packages/shell/test/usage-log.test.ts packages/shell/test/usage-pre.test.ts packages/harness-sdk/test/tools.test.ts packages/harness-sdk/test/pre-steps.test.ts packages/shell/test/tools/tool-registry.test.ts packages/shell/test/tools/pre-steps.test.ts packages/ui/test/tool-call-ui.test.tsx packages/e2e/tests/tools-pre.spec.ts
```

The first list also pins part 3's runner, prompt and log: `runJob`, `jobFirstMessage`, `JobRunRecord` and jobs.jsonl stay exactly as built. The second is compared with slice 3's end. This slice's tests go in new files.

## D0 is a hard rule

A harness whose jobs all declare `prompt` (and a harness with no jobs) runs no slice-4 code:
- `defineHarness` output has no `steps`, `maxAi` or `onLimit` key on any job; a prompt job's parsed value deep-equals slice 3's;
- every run goes to part 3's `runJob`, unchanged; `jobs.jsonl` lines, `job_result`, first messages and usage lines as before;
- no slot of kind `"step"`; the `ui` server's env has no `HH_STEP` key, and its tools are as before;
- the scheduler's daily cap behaves as before for every job that uses AI (every prompt job does);
- `JobSummary` has no `last.run` without tools; the inbox and Settings › Jobs render as before;
- `ToolAnswer` of a call that uses neither `summary` nor `requestAi` deep-equals slice 2's; the tool host's `ctx` gains two methods and nothing else changes.

| D0 item | Pinned by |
|---|---|
| Manifest | `packages/harness-sdk/test/recipes.test.ts` "D0: a prompt job parses as before, with no steps, maxAi or onLimit" (Task 1); `jobs.test.ts` frozen |
| `ui` server | `packages/blocks/test/ui-server-step.test.ts` "D0: without step the tools are as before" (Task 5); `ui-server-job.test.ts` frozen |
| Slots | `packages/runtime/test/workspace-step.test.ts` "D0: without a recipe no slot's ui env has HH_STEP" (Task 5); `runtime-d0.test.ts`, `claude-cli.test.ts` frozen |
| Registry answer | `packages/shell/test/tools/tool-run-summary.test.ts` "D0: a call without summary or requestAi answers as before" (Task 4); `tool-registry.test.ts` frozen |
| Dispatch | `packages/shell/test/jobs-recipes/jobs-host-recipes.test.ts` "D0: a prompt job runs through runJob and nothing else" (Task 8); `packages/shell/test/jobs/` frozen |
| Scheduler | `packages/shell/test/jobs-recipes/scheduler-no-ai.test.ts` "D0: a job that uses AI is paused at its cap as before" (Task 8) |
| Window | `packages/ui/test/job-run-steps-ui.test.tsx` "D0: a row without last.run renders as before" (Task 9); `jobs-ui.test.tsx` frozen |
| Runtime, history, jobs | the frozen lists above |

New shell tests for this slice live in `packages/shell/test/jobs-recipes/` (a new folder), never in `packages/shell/test/jobs/`.

## Threat model (slice 4)

A recipe runs the harness's own tools (slice 2's sandbox and broker) and, at most `maxAi` times per run, a model that sees tool results. What this slice adds is a model's output feeding a tool, and a tool asking for more model rounds.

| # | Boundary | What enforces it | Test |
|---|---|---|---|
| R1 | The AI step reaches nothing but `step_output` | slot kind `"step"`: `edit: "none"`, no exec, no web, no reference folders, MCP list = the step-mode `ui` server, which registers only `step_output` | `workspace-step.test.ts`, `ui-server-step.test.ts` (Task 5) |
| R2 | A model's output reaches the post-step only when valid | the runner parses the block's data with the job's own zod `output` in main; an invalid output is never passed on; at most one retry | `ai-step.test.ts` (Task 6) |
| R3 | A tool can't buy unbounded AI | `requestAi` only in a call marked `post` (caller `job`, the step right after the AI step), once per call; the run counts rounds against `maxAi` (1–3, default 1); beyond it, `needs-you` | `tool-run-summary.test.ts` (Task 4), `recipe-runner.test.ts` (Task 7) |
| R4 | Tool results can't break out of the AI step's `## Data` | each part compact JSON in a fence one longer than its longest backtick run (`fenceFor`); the heading is an `as` id checked against `TOOL_ID`; the section is cut at 200,000 characters with a note | `step-data.test.ts` (Task 3) |
| R5 | `requestAi` input and `summary` text are bounded data | input at most 1 MB of JSON, refused above; summary one line (controls and hidden characters removed), at most 300 characters | `tool-run-summary.test.ts` (Task 4) |
| R6 | A recipe run can't hang the jobs slot | the whole run under part 3's 15-minute limit and the scheduler's cancel; each tool call has its timeout; the AI step's slot is always closed | `recipe-runner.test.ts` (Task 7) |
| R7 | An `onLimit` target is a real action | checked at load (`recipeProblems`) and again by the runner (`Object.hasOwn(actions, …)`) and by `settle` (J3, unchanged) | `recipes.test.ts` (Task 1), `recipe-runner.test.ts` (Task 7) |

## Decisions (product questions take the spec's defaults; Marco may change any)

1. **One job schema.** `jobSchema` keeps its keys; `prompt` becomes optional and `steps`, `maxAi`, `onLimit` join it. `jobProblems` refuses a job with both or neither ("A job declares prompt or steps, not both" / "A job declares prompt or steps"). `HarnessJob.prompt` is therefore `string | undefined` for TypeScript; part 3's code reads it only for a prompt job.
2. **`dailyTokens` with `every`** is required only when the job uses AI (`jobUsesAi`: a prompt job, or a recipe with an AI step). A job that uses no AI is never paused by a daily cap (the scheduler skips the check); Settings › Jobs still shows the cap field for every `every` job, as today.
3. **A recipe has no `permissions`** ("permissions narrow an AI job's session; a recipe's tools use their own uses"): its tools reach what their `uses` declare and its AI step reaches nothing (R1).
4. **AI step shape.** `{ ai: briefPath, input: [as…] (1–10), output: <zod object>, when?, tier? (default "light"), as? }`; at most one per recipe; `input`, `when.from` name earlier `as`. `output` must be a zod object (an MCP tool's input is an object); its JSON Schema (`z.toJSONSchema`) is the `as` source for later steps' checks.
5. **Steps.** 1–20 per recipe; tool steps as slice 3's `toolStepSchema` (no `required`: in a recipe every failure fails the run).
6. **The post-step** is the first tool step after the AI step. Only it may call `ctx.requestAi`. Steps after it run once, after the rounds end. Any other caller gets `ToolRefused`: "ctx.requestAi is only for the step right after a job's AI step".
7. **`requestAi(input)`.** The tool's call goes on and returns normally; the runner then runs the AI step again with `## Data` holding one part, `### request`, whose value is `input` (at most 1 MB), and the post-step again with the new result. A second `requestAi` in one call is refused ("ctx.requestAi was already called in this call"). In a `forEach` post-step, the first item's request (in item order) counts.
8. **`ctx.summary(text)`** is accepted from every caller (a tool can be a pre-step and a job step), kept only by a job run: the run's summary is the last one given by any of its steps.
9. **The AI step's slot** (kind `"step"`, key `step:<run>:<round>`): a fresh engine session per round, the job's engine, the model of the step's `tier` (`profileFor(undefined, undefined, tier)`, as a job's), the run's trailer (`task: <run>`, `job`), no scope access. The first message is the brief, then `## Data` (one `### <as>` part per input, compact JSON in a fence), then the line "End by calling step_output once with the whole result. Nothing you write besides it is read."
10. **Retry.** When the turn ends with no valid `step_output`, the runner sends, in the same session, "Your turn ended without a valid step_output: <first problem>. Call step_output once with the whole result." A second turn without one fails the run: "The AI step gave no valid output: <first problem>". "<first problem>" is "it was not called" or the first zod issue as "path: message".
11. **Rounds and the cap.** `maxAi` is 1–3, default 1, and counts every AI step of the run (the first included). A `requestAi` when the run already ran `maxAi` AI steps ends the run `needs-you`, summary "Stopped after N AI step(s)" (singular for 1), then " · " and the post-step's last summary when there is one; `action` is `onLimit` when declared.
12. **`when` false** skips the AI step and every step after it; the run ends `ok`.
13. **The result** (§7.4): a failed or refused tool step → `failed`, "<tool> failed: <message>" (the registry's redacted message; for `forEach`, the failing item's); invalid output twice → `failed` (Decision 10); the cap → `needs-you` (Decision 11); otherwise `ok` with the last `ctx.summary`, else "N steps" plus " · 1 AI step" / " · N AI steps" when any ran, plus " · <tool>: <resultSummary>" of the last tool call in the trace. Timeout and cancel as part 3 ("Timed out", "Cancelled"). Every summary passes through part 3's one-line cut (300 characters). The record is part 3's `JobRunRecord`, unchanged; `tokens` is the AI steps' tokens (0 without one).
14. **The gate.** A recipe run takes the gate's `jobs` slot for the whole run, as a prompt run does (dedupe, caps, `stillValid` and the 15-minute limit are part 3's). A stop or the limit waits for the running tool call to end (each has its timeout), then starts nothing more; the AI step's turn is cancelled at once.
15. **Usage rows.** The AI step's turns write part 3's job lines (`jobRecord`, `task: <run>`). The run writes one `{ at, engine, phase: "job", kind: "recipe", job, task: <run>, run, scope?, toolSteps, aiSteps, ms, ok }` row (`toolSteps` counts tool calls made, a `forEach` as one step; `phase: "job"` keeps it out of the tasks' readers, as a job line; it has no `usage`, so no token reader counts it).
16. **AI rounds in the trace.** Each AI round writes a trace note under the run: tool `step_output`, text "AI step: valid output · N tokens" or "AI step: no valid output · N tokens". `step_output` is therefore reserved: a tool can't be named `step_output` (the same check as `job_result`).
17. **Steps in the inbox.** When the harness has tools, `JobSummary.last.run` is the last run's id, for every job (a prompt job's agent may call tools too); the row shows "Steps" that unfolds the run's trace with slice 2's `ToolCallLine` (errors unfolded). Without tools, no `run` and no "Steps" (D0).
18. **Mock mode.** A step turn (`HH_STEP` set on the `ui` server) plays nothing and saves no session state; the run fails with Decision 10's message. Slice 5 adds recordings for AI steps.
19. **The daily cap during a run** is part 3's: checked once per `every` fire. A run's extra AI rounds are counted after the run and are not stopped mid-run by the cap (a known gap, documented).

## Assumptions about slices 1–3 (they are plans, not code)

Task 0 checks each one and writes the real name in `carry-notes.md` when it differs; later tasks use the real one.

- Slice 3: `toolStepSchema`, `ToolStep`, `orderProblems(steps, tools, at, where, earlierExtra?)`, `sourceProblems(steps, json, label, sources?)`, `StepSource` (with `{ kind: "ai"; returns }`), `StepProblem` in `packages/harness-sdk/src/steps.ts`; `runToolStep(r, step, values, base, extra?)`, `StepRegistry`, `StepValues`, `StepCallBase`, `FOR_EACH_MAX` in `packages/shell/src/main/tools/pre-steps.ts`; `ToolCall.inputs`, `registry.meta`, `registry.note`, `TraceEntry.note`, `ToolCallView.note` (slice 3 Task 3); `TOOL_ROW_KINDS` containing `"recipe"` and `UsageRecord.run`, `toolSteps`, `aiSteps`, `ms` (slice 3 Task 9).
- Slice 2: `ToolRegistry.call(ToolCall)` with `ToolCaller` including `"job"`; `ToolAnswer`; `ToolBroker` with `startCall(scope)`, `endCall(id)`, `TOOL_CALLS`, and the core `Broker`'s `extra` handler map (slice 1 Task 2: `ReadonlyMap<string, { max: number; fn: BrokerHandler }>`); the host's `call` command and `resources/tool-host.mjs` building `ctx`; `createToolsHost` returning `registry`; `client.tools.trace(id)` taking a task or run id; `ToolCallLine`; `TOOL_ID`, `hasTools`, `ToolsJson` and the check that a tool id doesn't clash with core names (slice 2 Task 3); `WorkspaceOptions.tools` and the tools server joining task and job slots (slice 2 Task 8, Decision 9).
- Part 3 (built, on this branch's base): everything in `docs/architecture/jobs.md`.

## File structure

| File | Change | Responsibility |
|---|---|---|
| `packages/harness-sdk/src/recipes.ts` | Create | step schemas, `when`, `STEP_OUTPUT_TOOL`, `hasRecipes`, `jobUsesAi`, `recipeProblems`, `recipeSourceProblems` |
| `packages/harness-sdk/src/jobs.ts`, `index.ts`, `tool.ts`, `tools.ts` | Modify | job keys and checks, `loadHarness` briefs, `ToolContext.summary`/`requestAi`, `step_output` reserved |
| `packages/cli/src/check.ts` | Modify | AI step briefs, `tool-steps` for recipes |
| `packages/blocks/src/ui-server.ts`, `ui-server-bin.ts` | Modify | step mode |
| `packages/runtime/src/workspace.ts` | Modify | slot kind `"step"` |
| `packages/shell/src/main/tools/tool-broker.ts`, `tool-registry.ts`, `pre-steps.ts`, `tool-protocol.ts`, `resources/tool-host.mjs` | Modify | `summary`, `requestAi`, `post` |
| `packages/shell/src/main/jobs/when.ts`, `step-data.ts`, `ai-step.ts`, `recipe-runner.ts` | Create | the recipe runner |
| `packages/shell/src/main/jobs/jobs-host.ts`, `job-scheduler.ts`, `usage-log.ts`, `tools/tools-json.ts`, `index.ts` | Modify | dispatch, cap, row, checks in main, wiring |
| `packages/ui/src/client.ts`, `parallel/Inbox.tsx`, `parallel/JobsTab.tsx`, `tools/JobRunSteps.tsx` | Modify/Create | steps under a run |
| `packages/i18n/src/locales/en.json` | Modify | `"tools"` block keys |
| `packages/fake-agent/src/mock-claude.ts`, `mock-replay.ts` | Modify | a step turn plays nothing |
| `packages/fake-agent/fixtures/recipes-harness/` | Create | e2e fixture (single mode, tools, four recipe jobs, committed `dist/`) |
| `packages/e2e/tests/recipes.spec.ts`, `packages/cli/test/recipes-fixture-dist.test.ts` | Create | e2e, fixture freshness |
| `docs/architecture/jobs.md`, `tools.md`, `manifest.md`, `authoring.md` | Modify | docs |

## Overlaps

- **Part 3 (jobs, built):** `runJob`, `jobFirstMessage`, `JobLog` and their tests are frozen. A recipe is a sibling runner that writes the same record; `jobs-host.ts` picks the runner. `settle`, the inbox item, the Dock badge, dedupe and caps are shared and unchanged.
- **Slice 3:** reuses `toolStepSchema`, `orderProblems`, `sourceProblems`, `runToolStep`, `registry.note`, `TOOL_ROW_KINDS`. `runToolStep` gains `summary` and `requestAi` in its answer (additive).
- **Slice 2:** registry, broker, host script, `ToolCallLine`, `client.tools.trace`. Additive: `post`, `summary`, `requestAi`.
- **Blocks / `ui` server:** a third mode beside `job` and `review`.
- **Hatches:** unchanged (a recipe's AI step has no hatch: no harness MCP servers).
- **Mock mode:** part 3's canned `job_result` is untouched; a step turn plays nothing.

## Open questions (each with the default this plan takes)

1. Which step is the post-step, and what `requestAi`'s input becomes (Decisions 6, 7).
2. The summary built from the trace (Decision 13).
3. AI rounds as trace notes (Decision 16) — the spec says only tool calls are traced.
4. Steps under a run for prompt jobs too (Decision 17).
5. The daily cap during a run (Decision 19).

## Self-review (done while writing)

- Spec coverage (slice 4 list): `steps` (Tasks 1, 7); `when` (Tasks 1, 3, 7); `step_output` (Tasks 5, 6); post-steps and `requestAi` (Tasks 4, 7); the result mapping (Task 7); `maxAi`, `onLimit` (Tasks 1, 7); `ctx.summary` (Tasks 4, 7); checks of §3.3 for recipes (Tasks 1, 2); `recipe` row (Tasks 7, 8); inbox lines (Task 9); §13 unit rows (`when` forms, `step_output` retry, `requestAi` up to `maxAi`, §7.4 mapping) and e2e (Task 10); docs and jobs.md's known gaps against §7 (Task 11).
- Not in slice 4: mock recordings of tool accesses and AI steps, `tool test`, `tool run`, guide, template (slice 5).
- Types: `JobStep`, `AiStep`, `When`, `STEP_OUTPUT_TOOL` (Task 1); `ToolCall.post`, `ToolAnswer.summary`/`requestAi` (Task 4); `whenHolds`, `dataSection` (Task 3); `runAiStep`, `AiStepResult` (Task 6); `runRecipe`, `RecipeRunDeps` (Task 7); `recipeRecord` (Task 7); `JobsHostDeps.tools`, `JobSummary.last.run` (Tasks 8, 9).

---

### Task 0: Branch, plan and base line

**Files:** branch `feat/tools-recipes`; `docs/superpowers/plans/2026-10-29-tools-slice4-recipes.md`.

- [ ] **Step 1: Check the base.**

```bash
git -C <worktree> status --short
git -C <worktree> branch --show-current
git -C <worktree> log --oneline -1
```
Expected: no status output; `feat/tools-pre`; the last commit is slice 3's docs commit (Task 15 of slice 3, "docs: pre-steps, expects and the first measurement" or what slice 3 actually wrote). Otherwise stop and report.

- [ ] **Step 2: Branch.** `git -C <worktree> switch -c feat/tools-recipes`.

- [ ] **Step 3: Plan.**

```bash
cp SCRATCH/../plans/2026-10-29-tools-slice4-recipes.md <worktree>/docs/superpowers/plans/
git -C <worktree> add docs/superpowers/plans/2026-10-29-tools-slice4-recipes.md
git -C <worktree> commit --only docs/superpowers/plans/2026-10-29-tools-slice4-recipes.md -m "docs: tools slice 4 plan (job recipes)" -m "<trailer>"
```

- [ ] **Step 4: Base line and earlier names.** `corepack pnpm typecheck`, `corepack pnpm test` green. In `SCRATCH/carry-notes.md` write HEAD, the test count, and for each name in context.md's "Assumptions about slices 1–3" either "as planned" or the real name and file (use `/usr/bin/grep -rn` over `packages/`). Note in particular:
  - the real signature of `runToolStep` and what it returns;
  - how the core `Broker` takes extra handlers and how `ToolBroker` keeps per-call state (Task 4 adds two handlers);
  - how slice 2 checks that a tool id doesn't clash with core names (Task 1 adds `step_output`);
  - whether slice 2's tools server is added to job slots in `openSlotNow` and where (Task 5 must leave it out of step slots);
  - every place that reads `job.prompt` (`/usr/bin/grep -rn "\.prompt" packages/shell/src packages/cli/src packages/harness-sdk/src`), for Task 1.
  Run both frozen-list commands from context.md: both print nothing.

---

### Task 1: `steps`, `maxAi` and `onLimit` in the manifest

**Files:**
- Create: `packages/harness-sdk/src/recipes.ts`
- Modify: `packages/harness-sdk/src/jobs.ts` (`jobSchema`, `jobProblems`), `packages/harness-sdk/src/index.ts` (`export * from "./recipes"`, `step_output` reserved as a tool name, `loadHarness` resolves AI briefs and a job's prompt only when present, the manifest's `superRefine` runs `recipeProblems`), `packages/harness-sdk/src/tools.ts` (a tool id can't be `step_output`), `packages/shell/src/main/index.ts` (`readBrief` of a job without `prompt`), `packages/cli/src/check.ts` (`jobFindings` reads a brief only for a prompt job; Task 2 adds the AI step's), `packages/harness-sdk/test/parallel-fixture.test.ts`, `packages/shell/test/parallel-fixture-script.test.ts` (type only, see Step 3)
- Test: `packages/harness-sdk/test/recipes.test.ts` (new)

- [ ] **Step 1: Write the failing tests.**

```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { aiStepOf, defineHarness, hasRecipes, jobUsesAi, loadHarness, MAX_AI_CAP, postStepIndex, STEP_OUTPUT_TOOL } from "../src";

const base = {
  id: "t", name: "T", core: "^0.1.0", engines: ["claude"], folder: { suggested: "Documents/T" }, instructions: "./AGENTS.md",
  permissions: { edit: "folder" as const, exec: false, web: false }, blocks: {}, author: "x",
  actions: { "triage-ci": { label: "Triage CI", prompt: "./prompts/triage.md", cost: "light" as const } },
  tools: { "open-prs": "./tools/open-prs.ts", "pr-ci": "./tools/pr-ci.ts", "apply-triage": "./tools/apply-triage.ts" },
};
const Triage = z.object({ failing: z.array(z.string()), again: z.boolean() });
const ai = (extra: Record<string, unknown> = {}) => ({ ai: "./jobs/classify.md", input: ["ci"], output: Triage, as: "triage", ...extra });
const recipe = (steps: unknown[], extra: Record<string, unknown> = {}) => ({
  label: "Sync", on: { manual: true }, steps, ...extra,
});
const full = [{ tool: "open-prs", as: "prs" }, { tool: "pr-ci", forEach: "prs", as: "ci" }, ai({ when: { from: "ci", where: { failed: true } } }), { tool: "apply-triage", input: ["triage"] }];
const make = (jobs: Record<string, unknown>) => defineHarness({ ...base, jobs } as never);

describe("job recipes in the manifest (tools spec §3, §7)", () => {
  it("D0: a prompt job parses as before, with no steps, maxAi or onLimit", () => {
    const h = make({ sync: { label: "Sync", prompt: "./jobs/sync.md", on: { manual: true } } });
    expect(h.jobs!.sync).toEqual({ label: "Sync", prompt: "./jobs/sync.md", tier: "light", on: { manual: true }, scope: "none" });
    expect(hasRecipes(h)).toBe(false);
    expect(jobUsesAi(h.jobs!.sync)).toBe(true);
  });
  it("keeps a recipe: tool steps, one AI step with its zod output, a post-step, maxAi and onLimit", () => {
    const h = make({ sync: recipe(full, { maxAi: 3, onLimit: "triage-ci" }) });
    const j = h.jobs!.sync;
    expect(j.steps).toHaveLength(4);
    expect(j.maxAi).toBe(3);
    expect(j.onLimit).toBe("triage-ci");
    expect(aiStepOf(j)?.output).toBe(Triage);
    expect(aiStepOf(j)?.tier).toBe("light");
    expect(postStepIndex(j)).toBe(3);
    expect(hasRecipes(h)).toBe(true);
    expect(jobUsesAi(j)).toBe(true);
    expect(MAX_AI_CAP).toBe(3);
    expect(STEP_OUTPUT_TOOL).toBe("step_output");
  });
  it("a recipe of tool steps only uses no AI and needs no dailyTokens with every", () => {
    const h = make({ sync: recipe([{ tool: "open-prs" }], { on: { every: "30m" } }) });
    expect(jobUsesAi(h.jobs!.sync)).toBe(false);
    expect(postStepIndex(h.jobs!.sync)).toBe(-1);
  });
  it.each([
    ["both prompt and steps", { s: { ...recipe([{ tool: "open-prs" }]), prompt: "./jobs/s.md" } }, "prompt or steps, not both"],
    ["neither prompt nor steps", { s: { label: "S", on: { manual: true } } }, "A job declares prompt or steps"],
    ["two AI steps", { s: recipe([{ tool: "pr-ci", as: "ci" }, ai(), ai({ as: "again" })]) }, "at most one AI step"],
    ["an AI step whose input names no earlier as", { s: recipe([ai()]) }, 'input "ci" names no earlier step\'s as'],
    ["a when naming no earlier as", { s: recipe([{ tool: "pr-ci", as: "ci" }, ai({ when: { from: "nope" } })]) }, 'when "nope" names no earlier step\'s as'],
    ["a when on a tool step", { s: recipe([{ tool: "pr-ci", as: "ci", when: { from: "ci" } }]) }, undefined],
    ["a when with an object value", { s: recipe([{ tool: "pr-ci", as: "ci" }, ai({ when: { from: "ci", where: { failed: { x: 1 } } } })]) }, undefined],
    ["an output that isn't a zod object", { s: recipe([{ tool: "pr-ci", as: "ci" }, ai({ output: z.array(z.string()) })]) }, undefined],
    ["maxAi over 3", { s: recipe(full, { maxAi: 4 }) }, undefined],
    ["maxAi without an AI step", { s: recipe([{ tool: "open-prs" }], { maxAi: 2 }) }, "maxAi needs an AI step"],
    ["onLimit naming no action", { s: recipe(full, { onLimit: "nope" }) }, 'onLimit names no action "nope"'],
    ["onLimit without an AI step", { s: recipe([{ tool: "open-prs" }], { onLimit: "triage-ci" }) }, "onLimit needs an AI step"],
    ["maxAi on a prompt job", { s: { label: "S", prompt: "./jobs/s.md", on: { manual: true }, maxAi: 2 } }, "maxAi needs an AI step"],
    ["permissions on a recipe", { s: recipe([{ tool: "open-prs" }], { permissions: { exec: false } }) }, "a recipe's tools use their own uses"],
    ["every with an AI step and no dailyTokens", { s: recipe(full, { on: { every: "30m" } }) }, "dailyTokens is required with every"],
    ["more than 20 steps", { s: recipe(Array.from({ length: 21 }, () => ({ tool: "open-prs" }))) }, undefined],
    ["a step naming no tool", { s: recipe([{ tool: "nope" }]) }, '"nope" is not a tool of this harness'],
    ["required on a recipe step", { s: recipe([{ tool: "open-prs", required: true }]) }, undefined],
  ])("refuses %s", (_n, jobs, message) => {
    const run = () => make(jobs);
    if (message) expect(run).toThrow(message);
    else expect(run).toThrow();
  });
  it("refuses a tool named step_output", () => {
    expect(() => defineHarness({ ...base, tools: { step_output: "./tools/x.ts" } } as never)).toThrow(/step_output/);
  });
  it("loadHarness refuses an AI brief that escapes the harness folder", async () => {
    // write a temp harness (as jobs.test.ts's "a job's prompt stays inside the harness folder" does) whose AI step is
    // "../outside.md" → rejects "escapes"; "./jobs/classify.md" → loads, and a recipe job without prompt loads
  });
});
```

- [ ] **Step 2: Run to see them fail.** `corepack pnpm vitest run packages/harness-sdk/test/recipes.test.ts`.

- [ ] **Step 3: Implement.**

`recipes.ts`:

```ts
import { z } from "zod";
import { type StepProblem, type StepSource, orderProblems, sourceProblems, toolStepSchema } from "./steps";
import { TOOL_ID } from "./tools";

/** The core block an AI step ends with (tools spec §7.1). Registered only on a step slot's `ui` server. */
export const STEP_OUTPUT_TOOL = "step_output";
/** The most AI steps one run may run (D6). */
export const MAX_AI_CAP = 3;
export const RECIPE_STEPS_MAX = 20;

const scalar = z.union([z.string().max(200), z.number(), z.boolean(), z.null()]);
/** `when` is data, not code (tools spec §7.2): a result exists and isn't empty, or an array item has these field values. */
export const whenSchema = z.strictObject({
  from: z.string().regex(TOOL_ID),
  where: z.record(z.string().regex(TOOL_ID), scalar).refine((w) => Object.keys(w).length >= 1 && Object.keys(w).length <= 10, "where takes 1 to 10 fields").optional(),
});
export type When = z.output<typeof whenSchema>;

/** A zod object, checked by shape (the harness's zod may be another copy of the module than ours). */
const isZodObject = (v: unknown): v is z.ZodObject =>
  typeof v === "object" && v !== null && typeof (v as { safeParse?: unknown }).safeParse === "function" && (v as { _zod?: { def?: { type?: unknown } } })._zod?.def?.type === "object";

/** The one AI step of a recipe (tools spec §7.1). */
export const aiStepSchema = z.strictObject({
  /** The step's brief: a file in the harness folder. */
  ai: z.string().min(1),
  /** Earlier results, by their `as`, shown under `## Data`. */
  input: z.array(z.string().regex(TOOL_ID)).min(1).max(10),
  /** The result's schema: `step_output`'s input. A zod object. */
  output: z.custom<z.ZodObject>(isZodObject, "output must be a zod object (z.object({ … }))"),
  when: whenSchema.optional(),
  tier: z.enum(["light", "standard", "deep"]).default("light"),
  as: z.string().regex(TOOL_ID).optional(),
});
export type AiStep = z.output<typeof aiStepSchema>;

/** A recipe step: a tool step (slice 3's, without `required`) or the AI step. */
export const jobStepSchema = z.union([toolStepSchema, aiStepSchema]);
export type JobStep = z.output<typeof jobStepSchema>;
export const jobStepsSchema = z.array(jobStepSchema).min(1).max(RECIPE_STEPS_MAX);

export const isAiStep = (s: JobStep): s is AiStep => Object.hasOwn(s, "ai");

type JobLike = { prompt?: string; steps?: JobStep[]; maxAi?: number; onLimit?: string };

/** The recipe's AI step; undefined for a prompt job or a recipe without one. */
export const aiStepOf = (j: JobLike): AiStep | undefined => j.steps?.find(isAiStep);
/** The post-step (Decision 6): the first tool step after the AI step; -1 when there is none. */
export function postStepIndex(j: JobLike): number {
  const at = j.steps?.findIndex(isAiStep) ?? -1;
  if (at < 0) return -1;
  const next = j.steps!.findIndex((s, i) => i > at && !isAiStep(s));
  return next;
}
/** The job runs a model: a prompt job always, a recipe only with an AI step (Decision 2). */
export const jobUsesAi = (j: JobLike): boolean => j.steps === undefined || aiStepOf(j) !== undefined;
/** Some job is a recipe. False: no slice-4 code runs (D0). */
export const hasRecipes = (h: { jobs?: Record<string, JobLike> }): boolean => Object.values(h.jobs ?? {}).some((j) => j.steps !== undefined);

/** The manifest-only checks of recipes (tools spec §3.3), for the manifest's `superRefine`. */
export function recipeProblems(h: { tools?: Record<string, string>; jobs?: Record<string, JobLike & { steps?: JobStep[] }> }): StepProblem[] {
  const out: StepProblem[] = [];
  const tools = h.tools ?? {};
  for (const [id, j] of Object.entries(h.jobs ?? {})) {
    if (!j.steps) continue;
    const at = ["jobs", id, "steps"];
    const ais = j.steps.filter(isAiStep).length;
    if (ais > 1) out.push({ path: at, message: `Job "${id}": a recipe has at most one AI step` });
    // Tool steps' order rules (slice 3); the AI step takes part with its input and as, and has no tool.
    out.push(...orderProblems(j.steps.map((s) => (isAiStep(s) ? { input: s.input, ...(s.as ? { as: s.as } : {}) } : s)), tools, at, "steps").map((p) => ({ ...p, message: `Job "${id}": ${p.message}` })));
    const aiAt = j.steps.findIndex(isAiStep);
    const step = aiAt >= 0 ? (j.steps[aiAt] as AiStep) : undefined;
    if (step?.when) {
      const earlier = new Set(j.steps.slice(0, aiAt).map((s) => s.as).filter((a): a is string => a !== undefined));
      if (!earlier.has(step.when.from)) out.push({ path: [...at, aiAt, "when"], message: `Job "${id}": steps[${aiAt}]: when "${step.when.from}" names no earlier step's as` });
    }
  }
  return out;
}

/** The recipe checks that need tools.json (tools spec §3.3), as "Job "<id>": …" lines; the AI step's output is a source. */
export function recipeSourceProblems(
  h: { jobs?: Record<string, JobLike> },
  json: { tools: Record<string, { params: Record<string, unknown>; returns?: Record<string, unknown> }> },
): string[] {
  const out: string[] = [];
  for (const [id, j] of Object.entries(h.jobs ?? {})) {
    if (!j.steps) continue;
    const sources = new Map<string, StepSource>();
    j.steps.forEach((s, i) => {
      if (isAiStep(s)) {
        if (s.as) sources.set(s.as, { kind: "ai", returns: z.toJSONSchema(s.output) as Record<string, unknown> });
        return;
      }
      // One step at a time so that the AI step's source sits between them; labels keep the recipe's index.
      out.push(...sourceProblems([s], json, `steps[${i}]`, sources).map((p) => `Job "${id}": ${p.replace(`steps[${i}][0]`, `steps[${i}]`)}`));
    });
  }
  return out;
}
```

(`orderProblems` and `sourceProblems` are slice 3's; if Task 0 found other signatures, adapt and note it. If `sourceProblems` can't take one step at a time with an outer index, give it an index offset parameter instead — additive, with slice 3's tests unchanged.)

`jobs.ts` (`jobSchema`): `prompt: z.string().min(1).optional()`, and after `permissions`:

```ts
  /** A recipe (tools spec §7): tool steps, at most one AI step, a post-step. A job declares `prompt` or `steps`. */
  steps: jobStepsSchema.optional(),
  /** The most AI steps one run may run: 1–3, default 1 (tools spec §7.3). Only with an AI step. */
  maxAi: z.int().min(1).max(MAX_AI_CAP).optional(),
  /** The action the inbox offers when a run stops at maxAi. Only with an AI step. */
  onLimit: z.string().max(64).optional(),
```

`jobProblems`, inside the loop (the existing `dailyTokens` line becomes conditional; every other line stays as it is):

```ts
    if (j.prompt !== undefined && j.steps !== undefined) issue([], "A job declares prompt or steps, not both");
    if (j.prompt === undefined && j.steps === undefined) issue([], "A job declares prompt or steps");
    const usesAi = jobUsesAi(j);
    // in the `every` branch:
      if (j.dailyTokens === undefined && usesAi) issue(["dailyTokens"], "dailyTokens is required with every");
    // after it:
    if (!aiStepOf(j)) {
      if (j.maxAi !== undefined) issue(["maxAi"], "maxAi needs an AI step");
      if (j.onLimit !== undefined) issue(["onLimit"], "onLimit needs an AI step");
    } else if (j.onLimit !== undefined && !isAction(j.onLimit)) issue(["onLimit"], `onLimit names no action "${j.onLimit}"`);
    if (j.steps !== undefined && j.permissions !== undefined) issue(["permissions"], "permissions narrow an AI job's session; a recipe's tools use their own uses");
```

`index.ts`: `export * from "./recipes";`; in the tool-name map, `tools.set(STEP_OUTPUT_TOOL, STEP_OUTPUT_TOOL)` next to `JOB_RESULT_TOOL`; in `superRefine`, after `jobProblems`: `for (const p of recipeProblems(m)) ctx.addIssue({ code: "custom", path: p.path, message: p.message });`. `loadHarness` line 545 becomes:

```ts
  for (const job of Object.values(loaded.jobs ?? {})) {
    if (job.prompt !== undefined) resolveInHarness(loaded, job.prompt);
    const step = aiStepOf(job);
    if (step) resolveInHarness(loaded, step.ai);
  }
```

`tools.ts`: wherever slice 2 refuses a tool id that clashes with core names (Task 0's note), add `STEP_OUTPUT_TOOL` to that list.

`packages/shell/src/main/index.ts` line ~1813: `readBrief: (job) => (job.prompt !== undefined ? fs.readFile(resolveInHarness(harness, job.prompt), "utf8") : Promise.reject(new Error("A recipe has no brief")))` — `jobMessageFor` is only called for prompt jobs (Task 8), so the rejection never happens; it keeps the type honest.

`packages/cli/src/check.ts` `jobFindings`: wrap the three brief lines in `if (job.prompt !== undefined) { … }` (same messages); the `dailyTokens` warning stays outside.

Type fallout (Decision 1): `HarnessJob.prompt` is now `string | undefined`. Two existing tests call `resolveInHarness(h, j.prompt)` on prompt jobs: `packages/harness-sdk/test/parallel-fixture.test.ts:45` and `packages/shell/test/parallel-fixture-script.test.ts:99`. They are not on the frozen list; change only `j.prompt` to `j.prompt!` on those two lines (no other edit) and say so in the final reply. If any file on the frozen list fails to typecheck, stop and report instead.

- [ ] **Step 4: Run** the new test, `jobs.test.ts` (frozen, green), every `packages/harness-sdk/test/*.test.ts`, `packages/shell/test/parallel-fixture-script.test.ts`; typecheck; both frozen-list commands.

- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/harness-sdk/src/recipes.ts packages/harness-sdk/test/recipes.test.ts
git -C <worktree> commit --only packages/harness-sdk/src/recipes.ts packages/harness-sdk/src/jobs.ts packages/harness-sdk/src/index.ts packages/harness-sdk/src/tools.ts packages/shell/src/main/index.ts packages/cli/src/check.ts packages/harness-sdk/test/recipes.test.ts packages/harness-sdk/test/parallel-fixture.test.ts packages/shell/test/parallel-fixture-script.test.ts -m "feat(sdk): job recipes in the manifest — steps, when, maxAi, onLimit" -m "<trailer>"
```

---

### Task 2: Recipe checks in `check` and in main

**Files:**
- Modify: `packages/cli/src/check.ts` (`jobFindings`: the AI step's brief; rule `tool-steps` runs `recipeSourceProblems`), `packages/shell/src/main/tools/tools-json.ts` (run `recipeSourceProblems` beside slice 3's `stepProblems`)
- Test: `packages/harness-sdk/test/recipe-source-problems.test.ts` (new), `packages/cli/test/check-recipes.test.ts` (new), `packages/shell/test/tools/tools-json-recipes.test.ts` (new)

- [ ] **Step 1: Write the failing tests.**

```ts
// recipe-source-problems.test.ts — json(tools) and m(steps) as in slice 3's step-problems.test.ts
import { z } from "zod";
import { recipeSourceProblems } from "../src";

describe("recipeSourceProblems (tools spec §3.3)", () => {
  it("a post-step's input may name the AI step's as: its output is the source", () => {
    const steps = [{ tool: "pr-ci", as: "ci" }, { ai: "./b.md", input: ["ci"], output: z.object({ ids: z.array(z.string()) }), as: "triage", tier: "light" }, { tool: "apply-triage", input: ["triage"] }];
    expect(recipeSourceProblems({ jobs: { sync: { steps } } } as never, json({ "pr-ci": { returns: { type: "array", items: { type: "object" } } } }))).toEqual([]);
  });
  it("forEach over the AI step's output needs an array output", () => {
    // forEach "triage" on z.object output → 'Job "sync": steps[2]: forEach "triage": the AI step does not return an array'
  });
  it("an AI step's input naming a tool without returns is a problem", () => {
    // → 'Job "sync": steps[1]: input "ci": pr-ci declares no returns'
  });
  it("forEach in a recipe checks the items against the tool's required params", () => { /* as slice 3, message prefixed with Job "sync" */ });
  it("D0: a harness with prompt jobs only has no problems", () => { /* any tools.json → [] */ });
});
```
Note: the AI step's own `input` must also come from a source with `returns` (the model reads it as data); `recipeSourceProblems` checks it like a tool step's `input` (add it in Task 1's function if missing: for an AI step, run `sourceProblems([{ input: s.input }], …)` before setting its source).

`check-recipes.test.ts` (temp harness from `packages/cli/test/helpers.ts`):
- "an AI step whose brief is missing is brief-missing": `Job "sync": its AI step brief ./jobs/classify.md does not exist.`
- "an empty AI step brief is brief-missing": `Job "sync": its AI step brief ./jobs/classify.md is empty.`
- "a recipe without prompt reads no prompt brief" (no `brief-missing` for it).
- "a post-step reading a tool without returns is a tool-steps error" (with the in-memory build of slice 2).

`tools-json-recipes.test.ts`: the same harness read in main → tools off, reason = the first problem line (slice 2's off path), logged once.

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**
  - `check.ts` `jobFindings`, after the prompt-brief block (Task 1's guard):

```ts
    const step = aiStepOf(job);
    if (step) {
      const file = resolveInHarness(h, step.ai);
      const text = await read(file);
      if (text === null) out.push(error("brief-missing", `Job "${id}": its AI step brief ${step.ai} does not exist.`, MANIFEST));
      else if (!text.trim()) out.push(error("brief-missing", `Job "${id}": its AI step brief ${step.ai} is empty.`, path.relative(h.root, file)));
    }
```
  - `check.ts` rule `tool-steps` (slice 3's): after `stepProblems(harness, json)`, append `recipeSourceProblems(harness, json)`, each a `tool-steps` error.
  - `tools-json.ts`: after slice 3's `stepProblems`, `recipeSourceProblems(harness, json)`; the first line of either turns tools off (slice 2's path).

- [ ] **Step 4: Run** the three new tests, `check.test.ts`, slice 3's `check-pre.test.ts`, `tools-json-pre.test.ts` and `step-problems.test.ts` (green, unchanged); typecheck; both frozen-list commands.

- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/harness-sdk/test/recipe-source-problems.test.ts packages/cli/test/check-recipes.test.ts packages/shell/test/tools/tools-json-recipes.test.ts
git -C <worktree> commit --only packages/cli/src/check.ts packages/shell/src/main/tools/tools-json.ts packages/harness-sdk/src/recipes.ts packages/harness-sdk/test/recipe-source-problems.test.ts packages/cli/test/check-recipes.test.ts packages/shell/test/tools/tools-json-recipes.test.ts -m "feat(cli): recipe checks — AI step briefs and sources" -m "<trailer>"
```

---

### Task 3: `when` and the AI step's `## Data` (pure)

**Files:**
- Create: `packages/shell/src/main/jobs/when.ts`, `packages/shell/src/main/jobs/step-data.ts`
- Test: `packages/shell/test/jobs-recipes/when.test.ts`, `packages/shell/test/jobs-recipes/step-data.test.ts` (new folder)

- [ ] **Step 1: Write the failing tests.**

```ts
// when.test.ts
import { describe, expect, it } from "vitest";
import { whenHolds } from "../../src/main/jobs/when";

const v = (entries: Record<string, unknown>) => new Map(Object.entries(entries).map(([k, value]) => [k, { ok: true as const, value }]));

describe("when (tools spec §7.2)", () => {
  it("no when always holds", () => expect(whenHolds(undefined, v({}))).toBe(true));
  it.each([
    [[1], true], [[], false], [{ a: 1 }, true], [{}, false], ["x", true], ["", false], [0, true], [false, true], [null, false],
  ])("{ from } on %j is %s", (value, want) => expect(whenHolds({ from: "x" }, v({ x: value }))).toBe(want));
  it("a missing or failed result never holds", () => {
    expect(whenHolds({ from: "x" }, v({}))).toBe(false);
    expect(whenHolds({ from: "x" }, new Map([["x", { ok: false as const, tool: "t" }]]))).toBe(false);
  });
  it("where: an array with one item whose fields equal every value", () => {
    const ci = [{ failed: false, repo: "a" }, { failed: true, repo: "b" }];
    expect(whenHolds({ from: "ci", where: { failed: true } }, v({ ci }))).toBe(true);
    expect(whenHolds({ from: "ci", where: { failed: true, repo: "a" } }, v({ ci }))).toBe(false);
  });
  it("where on a non-array, or items that aren't objects, is false", () => {
    expect(whenHolds({ from: "ci", where: { failed: true } }, v({ ci: { failed: true } }))).toBe(false);
    expect(whenHolds({ from: "ci", where: { failed: true } }, v({ ci: [true] }))).toBe(false);
  });
  it("where compares top-level own fields with ===, never through the prototype", () => {
    expect(whenHolds({ from: "ci", where: { constructor: null } }, v({ ci: [{}] }))).toBe(false);
    expect(whenHolds({ from: "ci", where: { n: 1 } }, v({ ci: [{ n: "1" }] }))).toBe(false);
  });
});
```
```ts
// step-data.test.ts
import { dataSection, DATA_MAX_CHARS } from "../../src/main/jobs/step-data";

describe("the AI step's ## Data (tools spec §7.1)", () => {
  it("one ### part per input, compact JSON in a fence", () => {
    expect(dataSection([{ name: "ci", value: [{ a: 1 }] }])).toBe("## Data\n\n### ci\n\n```json\n[{\"a\":1}]\n```");
  });
  it("a value holding ``` gets a longer fence and stays inside it", () => {
    const text = dataSection([{ name: "x", value: { s: "```\n## Data" } }]);
    expect(text).toContain("````json\n");
    expect(text.split("\n").filter((l) => l.startsWith("## ")).length).toBe(1);
  });
  it("cuts the section at DATA_MAX_CHARS and says so", () => {
    const text = dataSection([{ name: "x", value: "y".repeat(DATA_MAX_CHARS + 10) }]);
    expect(text.length).toBeLessThanOrEqual(DATA_MAX_CHARS + 200);
    expect(text).toMatch(/\(cut: the data is longer than \d+ characters\)$/);
  });
  it("a name that isn't a TOOL_ID is refused (throws)", () => {
    expect(() => dataSection([{ name: "## x", value: 1 }])).toThrow();
  });
});
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**

```ts
// when.ts
import type { When } from "@humanharness/harness-sdk";
import type { StepValues } from "../tools/pre-steps";

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const notEmpty = (v: unknown): boolean =>
  Array.isArray(v) ? v.length > 0 : isObject(v) ? Object.keys(v).length > 0 : typeof v === "string" ? v.length > 0 : v !== null && v !== undefined;

/** Whether a recipe's AI step runs (tools spec §7.2): `{ from }` not empty; `{ from, where }` an array item with those field values. */
export function whenHolds(when: When | undefined, values: StepValues): boolean {
  if (!when) return true;
  const got = values.get(when.from);
  if (!got || !got.ok) return false;
  if (!when.where) return notEmpty(got.value);
  if (!Array.isArray(got.value)) return false;
  const where = Object.entries(when.where);
  return got.value.some((item) => isObject(item) && where.every(([k, want]) => Object.hasOwn(item, k) && item[k] === want));
}
```
```ts
// step-data.ts
import { TOOL_ID } from "@humanharness/harness-sdk";
import { fenceFor } from "@humanharness/workspace";

/** The longest `## Data` sent to an AI step (R4): about 50,000 tokens. */
export const DATA_MAX_CHARS = 200_000;

/** The AI step's data (tools spec §7.1): one `### <name>` part per input, compact JSON in a fence that can't be closed from inside. */
export function dataSection(parts: { name: string; value: unknown }[]): string {
  const blocks = parts.map(({ name, value }) => {
    if (!TOOL_ID.test(name)) throw new Error(`Not a step name: ${name}`);
    const json = JSON.stringify(value) ?? "null";
    const fence = fenceFor(json);
    return `### ${name}\n\n${fence}json\n${json}\n${fence}`;
  });
  const text = ["## Data", ...blocks].join("\n\n");
  if (text.length <= DATA_MAX_CHARS) return text;
  // Cut by code points; the fence is reopened nowhere, so close it on its own line.
  const cut = Array.from(text).slice(0, DATA_MAX_CHARS).join("");
  const fence = fenceFor(text);
  return `${cut}\n${fence}\n\n(cut: the data is longer than ${DATA_MAX_CHARS} characters)`;
}
```
(Check `fenceFor`'s real signature in `@humanharness/workspace` — slice 3's `prepared-section.ts` uses it — and whether it returns the backticks alone; adapt and note it.)

- [ ] **Step 4: Run, typecheck, both frozen-list commands, commit.**

```bash
git -C <worktree> add packages/shell/src/main/jobs/when.ts packages/shell/src/main/jobs/step-data.ts packages/shell/test/jobs-recipes/when.test.ts packages/shell/test/jobs-recipes/step-data.test.ts
git -C <worktree> commit --only packages/shell/src/main/jobs/when.ts packages/shell/src/main/jobs/step-data.ts packages/shell/test/jobs-recipes/when.test.ts packages/shell/test/jobs-recipes/step-data.test.ts -m "feat(shell): recipe when and the AI step's data section" -m "<trailer>"
```

---

### Task 4: `ctx.summary` and `ctx.requestAi`

**Files:**
- Modify: `packages/harness-sdk/src/tool.ts` (`ToolContext.summary`, `ToolContext.requestAi`), `packages/shell/src/main/tools/tool-broker.ts` (`TOOL_CALLS`, two extra handlers, per-call state), `packages/shell/src/main/tools/tool-registry.ts` (`ToolCall.post`, `ToolAnswer.summary`/`requestAi`), `packages/shell/resources/tool-host.mjs` (`ctx.summary`, `ctx.requestAi`), `packages/shell/src/main/tools/pre-steps.ts` (`runToolStep` carries both out)
- Test: `packages/shell/test/tools/tool-run-summary.test.ts` (new), `packages/shell/test/tools/tool-host-script-recipes.test.ts` (new), `packages/shell/test/tools/run-tool-step-recipes.test.ts` (new)

- [ ] **Step 1: Write the failing tests.**

```ts
// tool-run-summary.test.ts — the registry with slice 2's host and trace doubles and a real ToolBroker (as tool-registry.test.ts builds them)
describe("ctx.summary and ctx.requestAi (tools spec §4.2, §7.3, §7.4)", () => {
  it("D0: a call without summary or requestAi answers as before", async () => {
    // registry.call({ tool, args, caller: "ui", scope: null }) → toEqual({ ok: true, result: … }) exactly (no extra keys)
  });
  it("summary: the answer carries the last summary, on one line, cut at 300 characters", async () => {
    // the host double makes two broker calls "summary" with "a\nb" then "x".repeat(400) → answer.summary === "x".repeat(300)
  });
  it("summary is accepted from every caller (ui, agent, pre, job)", async () => { /* each answers ok with summary */ });
  it("a summary that isn't a string is refused", async () => { /* broker answer { ok: false, … "ctx.summary takes a string" } */ });
  it("requestAi: refused unless the call is a job's post-step", async () => {
    // caller "job" without post, caller "pre" with post: true, caller "agent" → the broker answers the refusal
    // "ctx.requestAi is only for the step right after a job's AI step"; answer has no requestAi
  });
  it("requestAi: a post call's answer carries the input", async () => {
    // caller "job", post: true; host double calls requestAi with { ids: ["a"] } → answer.requestAi toEqual { input: { ids: ["a"] } }
  });
  it("requestAi: a second call in the same call is refused", async () => { /* "ctx.requestAi was already called in this call"; the first one stands */ });
  it("requestAi: input over 1 MB of JSON is refused", async () => { /* "The request is too large" */ });
  it("requestAi: input that isn't JSON (a function, a cycle) is refused", async () => { /* "ctx.requestAi takes JSON data" */ });
  it("a failed call still carries its summary, never a requestAi", async () => { /* tool throws after summary + requestAi → { ok: false, error, summary } */ });
  it("neither summary nor requestAi reaches the trace entry", async () => { /* trace entry deep-equals slice 2's shape */ });
});
```
```ts
// tool-host-script-recipes.test.ts — load resources/tool-host.mjs as slice 2's tool-host-script.test.ts does
// "ctx.summary(text) sends the broker call summary with the text and resolves"
// "ctx.requestAi(input) sends the broker call requestAi with the input and resolves; a refusal rejects with ToolRefused"
```
```ts
// run-tool-step-recipes.test.ts — slice 3's registry double, its answers carrying summary / requestAi
describe("runToolStep carries a call's summary and request (slice 4)", () => {
  it("a single call: summary and requestAi from its answer", async () => { /* … */ });
  it("forEach: the last summary in item order, the first request in item order", async () => { /* … */ });
  it("extra.post reaches every call of the step", async () => { /* the double saw post: true on each */ });
  it("D0: a pre-step's result is as before (no summary or requestAi keys when the answers have none)", async () => { /* … */ });
});
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**
  - `tool.ts`, in `ToolContext`:

```ts
  /** Sets the job run's summary line (tools spec §7.4); the last one of a run counts. Ignored outside a job run. */
  summary(text: string): Promise<void>;
  /**
   * Asks the runner for another AI round with `input` as its data (tools spec §7.3). Only in a job's post-step, once
   * per call; the round runs after this call returns. Throws ToolRefused anywhere else.
   */
  requestAi(input: unknown): Promise<void>;
```
  - `tool-broker.ts`: `TOOL_CALLS` gains `"summary"`, `"requestAi"`. Per-call state (the `calls` map) gains `post: boolean`, `summary?: string`, `request?: { input: unknown }`. `startCall(scope, o: { post?: boolean } = {})`; `endCall(id)` returns `{ accesses, summary?, requestAi? }`. Extra handlers (slice 1's map, `max` as the other cheap handlers):

```ts
/** The longest summary kept: part 3's job summary limit. */
const SUMMARY_CHARS = 300;
/** The largest requestAi input (R5). */
const REQUEST_MAX_BYTES = 1024 * 1024;
const POST_ONLY = "ctx.requestAi is only for the step right after a job's AI step";

// "summary": (callId, [text]) =>
//   typeof text !== "string" → refuse "ctx.summary takes a string";
//   state.summary = oneLine(text) cut to SUMMARY_CHARS by code points (controls, U+2028/9 and HIDDEN_CHARS removed, as job-runner's oneLine);
//   answer { ok: true, value: null }
// "requestAi": (callId, [input]) =>
//   !state.post → refuse POST_ONLY;
//   state.request → refuse "ctx.requestAi was already called in this call";
//   let json; try { json = JSON.stringify(input) } catch → refuse "ctx.requestAi takes JSON data";
//   json === undefined → refuse "ctx.requestAi takes JSON data";
//   Buffer.byteLength(json) > REQUEST_MAX_BYTES → refuse "The request is too large";
//   state.request = { input: JSON.parse(json) }   // a plain copy: nothing of the tool's object survives
//   answer { ok: true, value: null }
```
  The one-line cleaner: reuse part 3's rule. If no shared helper exists, add `oneLine(text, max)` to `packages/shell/src/main/tools/one-line.ts` (new) and use it here; don't touch `job-runner.ts` (frozen).
  - `tool-registry.ts`: `ToolCall` gains `/** A job's post-step call (tools spec §7.3): only then may the tool call ctx.requestAi. */ post?: boolean;`. `ToolAnswer` becomes `{ ok: true; result: unknown; summary?: string; requestAi?: { input: unknown } } | { ok: false; error: string; summary?: string }`. In `call`: `broker.startCall(c.scope, { post: c.caller === "job" && c.post === true })`; after `endCall`, add `summary` when set, and `requestAi` only on success. The trace entry is unchanged.
  - `tool-host.mjs`: `ctx.summary = (text) => brokerCall("summary", [text]).then(() => undefined)` and `ctx.requestAi = (input) => brokerCall("requestAi", [input]).then(() => undefined)` (the script's existing broker-call helper; a refusal already rejects with `ToolRefused`).
  - `pre-steps.ts` `runToolStep`: its answer type gains `summary?: string; requestAi?: { input: unknown }`. Single call: copy them from the registry answer when present. `forEach`: the last summary by item index and the first request by item index (collect per index, pick after `Promise.all`). `extra` already spreads into each call, so `{ post: true }` reaches every item. A pre-step's answer has neither key when no answer had one (D0 of slice 3's tests).

- [ ] **Step 4: Run** the three new tests, slice 2's `tool-registry.test.ts` (frozen), `tool-broker.test.ts`, `tool-host-script.test.ts`, slice 3's `pre-steps.test.ts` (frozen) — all green; typecheck; `corepack pnpm app:build`; both frozen-list commands.

- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/shell/test/tools/tool-run-summary.test.ts packages/shell/test/tools/tool-host-script-recipes.test.ts packages/shell/test/tools/run-tool-step-recipes.test.ts
git -C <worktree> commit --only packages/harness-sdk/src/tool.ts packages/shell/src/main/tools/tool-broker.ts packages/shell/src/main/tools/tool-registry.ts packages/shell/resources/tool-host.mjs packages/shell/src/main/tools/pre-steps.ts packages/shell/test/tools/tool-run-summary.test.ts packages/shell/test/tools/tool-host-script-recipes.test.ts packages/shell/test/tools/run-tool-step-recipes.test.ts -m "feat(shell): ctx.summary and ctx.requestAi for job steps" -m "<trailer>"
```
(Add `packages/shell/src/main/tools/one-line.ts` to both commands if you created it.)

---

### Task 5: The step slot: `step_output` on its own `ui` server

**Files:**
- Modify: `packages/blocks/src/ui-server.ts` (`opts.step`), `packages/blocks/src/ui-server-bin.ts` (`HH_STEP`), `packages/runtime/src/workspace.ts` (`SlotOptions.kind: "step"`, `SlotOptions.job`), `packages/fake-agent/src/mock-claude.ts` (a step turn plays nothing)
- Test: `packages/blocks/test/ui-server-step.test.ts` (new), `packages/runtime/test/workspace-step.test.ts` (new), `packages/fake-agent/test/mock-step.test.ts` (new)
- Fixture: `packages/blocks/test/fixtures/recipe-harness/harness.config.ts` (new, tiny: one action, one tool path, one recipe job with an AI step whose output is `z.object({ ids: z.array(z.string()), again: z.boolean() })`; plus every file `loadHarness` requires: `AGENTS.md`, the action's prompt, the AI brief, the tool's source file; no build needed: the ui server only loads the manifest; it imports `defineHarness` and `z` the way `packages/fake-agent/fixtures/jobs-harness/harness.config.ts` does)

- [ ] **Step 1: Write the failing tests.**

```ts
// ui-server-step.test.ts — the same connect() helper as ui-server-job.test.ts, with HH_STEP
describe("the ui server's step mode (tools spec §7.1)", () => {
  it("D0: without step the tools are as before", async () => {
    // RECIPE fixture without HH_STEP: listTools() names equal the list computed from allBlocks + review rules, as for any harness
    // (no step_output); with HH_JOB=1 the job list (job_result present, step_output absent)
  });
  it("with HH_STEP=<job> the only tool is step_output, its input schema the job's output", async () => {
    // tools → ["step_output"]; inputSchema.properties has ids (array) and again (boolean); required both
  });
  it("a valid call reaches the bridge as a block step_output and answers 'Done'", async () => {
    // received [{ name: "step_output", data: { ids: ["a"], again: false } }]; text "Done: the result is recorded. End your turn now."
  });
  it("an invalid call is refused by the schema and never reaches the bridge", async () => { /* again: "yes" → isError; received [] */ });
  it("HH_STEP naming no recipe job with an AI step exits with an error", async () => {
    // spawn ui-server-bin with HH_STEP=nope → exit code 1, stderr 'No AI step for job "nope"'
  });
  it("HH_STEP that isn't a job id is ignored as empty", async () => { /* HH_STEP="" → normal tools; HH_STEP="../x" → exit 1 "HH_STEP is not a job id" */ });
});
```
```ts
// workspace-step.test.ts — createWorkspace with a fake engine transport capture, as workspace-slots.test.ts does
describe("a step slot (tools spec §7.1, R1)", () => {
  it("its MCP list is the ui server alone, with HH_STEP=<job> and HH_JOB empty", async () => { /* … */ });
  it("no data, material, review or tools server and no harness MCP server, even when the harness has them", async () => { /* … */ });
  it("permissions are edit none, exec false, web false, whatever the harness allows", async () => { /* … */ });
  it("no reference folders", async () => { /* transportOptions.references [] */ });
  it("task and job slots of a harness with a recipe clear HH_STEP", async () => { /* ui env HH_STEP === "" on both */ });
  it("D0: without a recipe no slot's ui env has HH_STEP", async () => { /* a jobs harness with prompt jobs only: task and job ui env have no HH_STEP key */ });
  it("kind step without job is refused", async () => { /* openSlot({ key, kind: "step" }) rejects "A step slot needs its job" */ });
});
```
```ts
// mock-step.test.ts — runMockTurn with an mcpServers.ui whose env has HH_STEP
// "a step turn prints init and a success result, calls no tool and saves no session state"
// "a turn whose ui env has HH_STEP empty plays as before"
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**
  - `ui-server.ts`: `opts: { job?: boolean; review?: …; step?: string }`. At the top, after `loadHarness`:

```ts
  if (opts.step !== undefined) return stepServer(harness, opts.step, bridge);
```
  and

```ts
/**
 * A recipe's AI step (tools spec §7.1): one tool, `step_output`, whose input schema is the job's AI step `output`. No
 * block, no review tool, no job_result: the model's only way out is its result.
 */
function stepServer(harness: LoadedHarness, job: string, bridge: { path: string; token: string }): McpServer {
  const j = harness.jobs && Object.hasOwn(harness.jobs, job) ? harness.jobs[job] : undefined;
  const step = j ? aiStepOf(j) : undefined;
  if (!step) throw new Error(`No AI step for job "${job}"`);
  const server = new McpServer({ name: "ui", version: "0.1.0" });
  server.registerTool(
    STEP_OUTPUT_TOOL,
    { description: "Ends this step with its result. Call it once, with the whole result.", inputSchema: step.output.shape },
    async (args) => {
      try {
        await sendToBridge(bridge, { name: STEP_OUTPUT_TOOL, data: args });
      } catch (e) {
        return { isError: true, content: [{ type: "text" as const, text: `Could not reach the app (${e instanceof Error ? e.message : String(e)}).` }] };
      }
      return { content: [{ type: "text" as const, text: "Done: the result is recorded. End your turn now." }] };
    },
  );
  return server;
}
```
  - `ui-server-bin.ts`: `const stepEnv = process.env.HH_STEP ?? ""; if (stepEnv !== "" && !JOB_ID.test(stepEnv)) { console.error("HH_STEP is not a job id"); process.exit(1); }` and pass `...(stepEnv ? { step: stepEnv } : {})`.
  - `workspace.ts`:
    - `SlotOptions.kind?: "task" | "job" | "step"`; `/** A step slot's job (its ui server serves that job's step_output). */ job?: string;`.
    - In `openSlotNow`: `const step = o.kind === "step"; if (step && !o.job) throw new Error("A step slot needs its job");`. Skip opening `rpc`, `materialRpc`, `reviewRpc` and slice 2's `toolsRpc` when `step`.
    - Permissions: `step ? narrowPermissions(harness.permissions, { edit: "none", exec: false, web: false }) : <today's expression>`.
    - The `ui` entry:

```ts
const recipes = hasRecipes(harness);
const uiEnv =
  step ? { ...ui.env, HH_STEP: o.job!, HH_JOB: "" }
  : o.kind === "job" ? { ...ui.env, HH_JOB: "1", ...(recipes ? { HH_STEP: "" } : {}) }
  : hasJobs(harness) ? { ...ui.env, HH_JOB: "", ...(recipes ? { HH_STEP: "" } : {}) }
  : null;
// mcp: [uiEnv ? { ...ui, env: uiEnv } : ui, ...(step ? [] : [<data>, <material>, <tools>, ...harnessMcpServers(harness, launcher)])]
```
      Keep today's expression byte-identical in effect when `!recipes` (D0); restructure only as much as needed.
    - `references: step ? [] : references.map((r) => r.path)`.
  - `mock-claude.ts` `playTurn`, right after the Sidekick branch:

```ts
  // A recipe's AI step (HH_STEP on its ui server): no recording answers it yet (slice 5), so it ends with no output and
  // the run fails on its own terms. It never touches the recordings or the session state.
  if (mcpServers.ui?.env?.HH_STEP) {
    print({ type: "system", subtype: "init", session_id: sessionId, tools: [] });
    print({ type: "result", subtype: "success", is_error: false, result: "", session_id: sessionId, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
    return;
  }
```

- [ ] **Step 4: Run** the three new tests, `ui-server-job.test.ts`, `ui-server.test.ts`, `workspace-slots.test.ts`, `runtime-d0.test.ts`, `claude-cli.test.ts`, `hatches-d0.test.ts`, the fake-agent tests; typecheck; `corepack pnpm app:build`; both frozen-list commands.

- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/blocks/test/ui-server-step.test.ts packages/blocks/test/fixtures/recipe-harness packages/runtime/test/workspace-step.test.ts packages/fake-agent/test/mock-step.test.ts
git -C <worktree> commit --only packages/blocks/src/ui-server.ts packages/blocks/src/ui-server-bin.ts packages/runtime/src/workspace.ts packages/fake-agent/src/mock-claude.ts packages/blocks/test/ui-server-step.test.ts packages/blocks/test/fixtures/recipe-harness packages/runtime/test/workspace-step.test.ts packages/fake-agent/test/mock-step.test.ts -m "feat(runtime): step slots — step_output alone, nothing else reachable" -m "<trailer>"
```
(If `packages/fake-agent/test/` doesn't exist, put the mock test where the existing mock-replay tests live and say so.)

---

### Task 6: The AI step runner (`runAiStep`)

**Files:**
- Create: `packages/shell/src/main/jobs/ai-step.ts`
- Test: `packages/shell/test/jobs-recipes/ai-step.test.ts` (new)

- [ ] **Step 1: Write the failing tests.** A fake workspace whose `openSlot` records its options and returns a slot double: `send(message, emit, options)` records the message and options, then plays a scripted list of events for that turn (blocks, usage, done) and resolves; `cancel` ends it with `done { ok: false, error: { code: "cancelled" } }`; `close` is counted.

```ts
import { z } from "zod";
import { runAiStep } from "../../src/main/jobs/ai-step";

const output = z.object({ ids: z.array(z.string()), again: z.boolean() });
const step = { ai: "./jobs/classify.md", input: ["ci"], output, tier: "light" as const, as: "triage" };

describe("runAiStep (tools spec §7.1)", () => {
  it("opens a step slot for the job, keyed step:<run>:<round>", async () => {
    // openSlot saw { key: "step:r1:1", kind: "step", job: "sync" }
  });
  it("sends the brief, the data section and the closing line", async () => {
    // message === "Brief.\n\n## Data\n\n### ci\n\n```json\n[1]\n```\n\nEnd by calling step_output once with the whole result. Nothing you write besides it is read."
  });
  it("passes the tier's profile and the run's trailer", async () => {
    // profileFor("light") → P; send options { profile: P, trailer: { task: "r1", job: "sync" } } (+ scope when the run has one); no scope access
  });
  it("takes the first valid step_output and closes the slot", async () => {
    // → { ok: true, value: { ids: ["a"], again: false }, tokens: <capTokens of the usage events> }; close called once
  });
  it("ignores a block that isn't step_output", async () => { /* a show_choices block → no value */ });
  it("an invalid output then none: retries once in the same session with the first problem", async () => {
    // turn 1: step_output { ids: "a", again: false } → turn 2 message === "Your turn ended without a valid step_output: ids: <zod message>. Call step_output once with the whole result."
    // turn 2: valid → ok; one slot opened
  });
  it("no step_output twice fails with the problem", async () => {
    // → { ok: false, error: "The AI step gave no valid output: it was not called", tokens }
  });
  it("counts both turns' tokens and records each usage line", async () => { /* recordUsage called per usage event */ });
  it("an aborted signal cancels the running turn and reports Cancelled", async () => { /* → { ok: false, error: "Cancelled", cancelled: true } */ });
  it("an out-of-quota turn pauses the gate as a job's does", async () => { /* pauseOutOfQuota called with the limits' reset */ });
  it("closes the slot when sending throws", async () => { /* send throws → close called, error rethrown as { ok: false, error: "Could not run the AI step" } */ });
});
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**

```ts
import type { ModelProfile } from "@humanharness/engines";
import { type AiStep, STEP_OUTPUT_TOOL, type z } from "@humanharness/harness-sdk";
import type { Event, HarnessWorkspace, SessionSlot } from "@humanharness/runtime";
import { pauseOutOfQuota, resetOf } from "../gated-turns";
import type { TurnGate } from "../turn-gate";
import { capTokens } from "../usage-log";
import { dataSection } from "./step-data";

type Usage = Extract<Event, { type: "usage" }>;

export const STEP_END_LINE = "End by calling step_output once with the whole result. Nothing you write besides it is read.";

export interface AiStepDeps {
  workspace(): Promise<HarnessWorkspace>;
  /** The step's brief text (its file in the harness folder). */
  readBrief(path: string): Promise<string>;
  profileFor?(tier: AiStep["tier"]): Promise<ModelProfile | undefined>;
  /** A job usage line for the run (part 3's `jobRecord`, `task: <run>`). A failure is logged, never fails the step. */
  recordUsage(e: Usage): Promise<void>;
  /** The jobs' gate: an out-of-quota turn pauses it, as a job's does. */
  gate: TurnGate;
  now?: () => Date;
}

export type AiStepResult = { ok: true; value: Record<string, unknown>; tokens: number } | { ok: false; error: string; tokens: number; cancelled?: boolean };

/** The first problem of a zod result, as "path: message". */
const firstProblem = (e: z.ZodError): string => {
  const i = e.issues[0];
  return i ? `${i.path.length ? `${i.path.join(".")}: ` : ""}${i.message}` : "invalid";
};

/**
 * One round of a recipe's AI step (tools spec §7.1, Decisions 9–10): a fresh session on a `step` slot, the brief and
 * `## Data`, and the first valid `step_output`; one retry in the same session; the slot always closed.
 */
export async function runAiStep(
  d: AiStepDeps,
  o: { job: string; run: string; round: number; scope: string | null; step: AiStep; data: { name: string; value: unknown }[]; signal?: AbortSignal },
): Promise<AiStepResult> {
  // … open the slot ({ key: `step:${o.run}:${o.round}`, kind: "step", job: o.job }); a signal already aborted → Cancelled, no slot
  // … message = `${brief.trim()}\n\n${dataSection(o.data)}\n\n${STEP_END_LINE}`
  // … one turn: emit handler takes blocks named STEP_OUTPUT_TOOL, parses with o.step.output.safeParse; keeps the first
  //     valid value and the first problem; usage → tokens += capTokens(e) and recordUsage; limits → resetsAt;
  //     done out-of-quota → pauseOutOfQuota(d.gate, resetsAt, now); done cancelled → cancelled
  // … no value: problem = firstProblem or "it was not called"; second turn with the retry message (Decision 10)
  // … still none → { ok: false, error: `The AI step gave no valid output: ${problem}`, tokens }
  // … signal abort → running.cancel(); result { ok: false, error: "Cancelled", cancelled: true, tokens }
  // … finally slot.close() (errors logged)
}
```
Write the body in full following `runJob`'s patterns (`job-runner.ts`, read-only: don't change it): the abort listener added and removed, the slot closed in `finally`, `send` options `{ profile?, trailer: { task: run, job, scope? } }` and no `scope` access (the step slot reaches no folder). Keep the message builder a small exported function (`aiStepMessage(brief, data)`) so Task 7 and slice 5 can test it.

- [ ] **Step 4: Run, typecheck, both frozen-list commands, commit.**

```bash
git -C <worktree> add packages/shell/src/main/jobs/ai-step.ts packages/shell/test/jobs-recipes/ai-step.test.ts
git -C <worktree> commit --only packages/shell/src/main/jobs/ai-step.ts packages/shell/test/jobs-recipes/ai-step.test.ts -m "feat(shell): the recipe's AI step — one-shot, step_output, one retry" -m "<trailer>"
```

---

### Task 7: The recipe runner (`runRecipe`) and the `recipe` row

**Files:**
- Create: `packages/shell/src/main/jobs/recipe-runner.ts`
- Modify: `packages/shell/src/main/usage-log.ts` (`recipeRecord`)
- Test: `packages/shell/test/jobs-recipes/recipe-runner.test.ts` (new), `packages/shell/test/jobs-recipes/recipe-record.test.ts` (new)

- [ ] **Step 1: Write the failing tests.** Doubles: slice 3's registry double (answers by tool, may carry `summary`/`requestAi`, records each call), an `ai` double for `runAiStep` (scripted results per round, records each call's `data`), a real `TurnGate` with a `jobs` cap of 1 (as part 3's runner tests build it), a log double, a fake clock.

```ts
import { z } from "zod";
import { runRecipe } from "../../src/main/jobs/recipe-runner";

const output = z.object({ ids: z.array(z.string()), again: z.boolean() });
const job = (steps: unknown[], extra = {}) => ({ label: "Sync", on: { manual: true }, scope: "none", tier: "light", steps, ...extra }) as never;
const full = [
  { tool: "pr-ci", as: "ci" },
  { ai: "./b.md", input: ["ci"], output, tier: "light", as: "triage", when: { from: "ci", where: { failed: true } } },
  { tool: "apply-triage", input: ["triage"] },
  { tool: "notify" },
];

describe("runRecipe (tools spec §7)", () => {
  it("runs tool steps in order as caller job with the job, run and scope", async () => {
    // calls: pr-ci { caller: "job", job: "sync", run: "r1", scope: null }, then apply-triage, then notify
  });
  it("the AI step gets its inputs as data and its result is the post-step's input", async () => {
    // ai saw data [{ name: "ci", value: <pr-ci result> }]; apply-triage got inputs { triage: <ai value> }
  });
  it("only the post-step's calls are marked post", async () => { /* apply-triage post: true; pr-ci and notify without post */ });
  it("when false skips the AI step and every step after it, and ends ok", async () => {
    // pr-ci returns [{ failed: false }] → no ai call, no apply-triage, no notify; record status ok, summary "1 step · pr-ci: <resultSummary>"
  });
  it("a failed tool step ends the run failed with the tool and the message", async () => {
    // pr-ci { ok: false, error: "boom [redacted]" } → status failed, summary "pr-ci failed: boom [redacted]"; nothing after it runs
  });
  it("invalid AI output twice ends the run failed", async () => { /* ai → { ok: false, error: "The AI step gave no valid output: it was not called" } → that summary */ });
  it("requestAi within maxAi runs the AI step again with the request as data, then the post-step again", async () => {
    // maxAi 2; apply-triage round 1 answers requestAi { input: { ids: ["b"] } } → ai round 2 data [{ name: "request", value: { ids: ["b"] } }]
    // → apply-triage called again with the new triage; notify once at the end; status ok; aiSteps 2
  });
  it("requestAi beyond maxAi ends needs-you with the summary and onLimit", async () => {
    // maxAi 1 (default), onLimit "triage-ci" (an action); apply-triage answers requestAi and summary "2 still red"
    // → status needs-you, summary "Stopped after 1 AI step · 2 still red", action "triage-ci"; notify never runs
  });
  it("Stopped after N AI steps is plural above one", async () => { /* maxAi 3, three requests → "Stopped after 3 AI steps" */ });
  it("onLimit naming no action is dropped", async () => { /* the runner's own J3 check */ });
  it("ok uses the last ctx.summary of any step", async () => { /* apply-triage summary "Triaged 2" → summary "Triaged 2" */ });
  it("ok without a summary builds one from the counts and the last call", async () => {
    // "3 steps · 1 AI step · notify: <resultSummary>"; with two AI rounds "· 2 AI steps"
  });
  it("tokens are the AI steps' tokens only; 0 without an AI step", async () => { /* … */ });
  it("writes one JobRunRecord of part 3's shape", async () => {
    // keys exactly run, job, scope, trigger, status, summary, tokens, startedAt, endedAt (+ action only on needs-you)
  });
  it("writes one recipe usage row with toolSteps, aiSteps, ms and ok", async () => { /* recordRecipe called once */ });
  it("writes a trace note per AI round", async () => {
    // note({ tool: "step_output", caller: "job", job: "sync", run: "r1", text: "AI step: valid output · 1,234 tokens" })
  });
  it("goes through the gate's jobs slot and frees it however the run ends", async () => { /* … */ });
  it("a run dropped before it starts logs nothing and returns null", async () => { /* stillValid false, or the gate drops it */ });
  it("the time limit ends the run Timed out after the running call", async () => { /* maxMs 50; a slow call; no later step starts */ });
  it("an abort ends the run Cancelled and cancels a running AI step", async () => { /* … */ });
});
```
```ts
// recipe-record.test.ts
// "recipeRecord: { at, engine, phase: 'job', kind: 'recipe', job, task: run, run, scope?, toolSteps, aiSteps, ms, ok }"
// "a recipe row is a job line for the readers: recentUsage keeps it with the job lines, dayTokens and summarizeUsage count nothing from it"
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**

`usage-log.ts`:

```ts
/** A recipe run (tools spec §8.4): one row per run; `phase: "job"` keeps it with the job lines, and it has no tokens. */
export function recipeRecord(o: { engine: string; job: string; run: string; scope?: string; toolSteps: number; aiSteps: number; ms: number; ok: boolean }, at: string = new Date().toISOString()): UsageRecord {
  return { at, engine: o.engine, phase: "job", kind: "recipe", job: o.job, task: o.run, run: o.run, ...(o.scope ? { scope: o.scope } : {}), toolSteps: o.toolSteps, aiSteps: o.aiSteps, ms: o.ms, ok: o.ok };
}
```

`recipe-runner.ts`:

```ts
import { randomUUID } from "node:crypto";
import { type AiStep, type HarnessJob, type ToolStep, aiStepOf, isAiStep, postStepIndex } from "@humanharness/harness-sdk";
import { Dropped, type TurnGate } from "../turn-gate";
import { type StepRegistry, type StepValues, runToolStep } from "../tools/pre-steps";
import type { AiStepResult } from "./ai-step";
import { JOB_RUN_MAX_MS } from "./job-runner";
import type { JobLog, JobRunRecord, JobTrigger } from "./job-log";
import { whenHolds } from "./when";

export interface RecipeRunDeps {
  gate: TurnGate;
  log: Pick<JobLog, "append">;
  /** The tools' registry (calls as caller "job") and its trace notes. */
  registry: StepRegistry & { note(n: { tool: string; caller: "job"; job: string; run: string; text: string }): Promise<void> };
  /** The last trace entry's tool and resultSummary for the run (the built summary, Decision 13); null when none. */
  lastCall(run: string): Promise<{ tool: string; resultSummary: string } | null>;
  /** One AI round (Task 6's runAiStep with its deps bound). */
  ai(o: { job: string; run: string; round: number; scope: string | null; step: AiStep; data: { name: string; value: unknown }[]; signal: AbortSignal }): Promise<AiStepResult>;
  /** The `recipe` usage row. A failure is logged, never fails the run. */
  recordRecipe(row: { job: string; run: string; scope?: string; toolSteps: number; aiSteps: number; ms: number; ok: boolean }): Promise<void>;
  actions: Record<string, unknown>;
  stillValid?(): Promise<boolean>;
  now?: () => Date;
  newId?: () => string;
  maxMs?: number;
}

/** The longest summary kept (part 3's limit). */
const SUMMARY_CHARS = 300;
```
Then `runRecipe(d, id, job, scope, trigger, signal?) : Promise<JobRunRecord | null>`:
1. Same prologue as `runJob` (read it; don't import its private helpers): `signal.aborted` → null; `run = (d.newId ?? randomUUID)()`; `gate.acquire("jobs", { id: \`job:${run}\` })` with `Dropped` → null and a failed acquire → `outcome = "error"`; `stillValid` false → release, null; `startedAt`.
2. A run-level `AbortController` aborted by `signal` and by a `setTimeout(maxMs ?? JOB_RUN_MAX_MS)` (remember which: "Timed out" / "Cancelled").
3. The walk (inside `try { … } finally { clearTimeout; remove listener; release() }`):

```ts
const steps = job.steps!;
const aiAt = steps.findIndex(isAiStep);
const postAt = postStepIndex(job);
const values: StepValues = new Map();
const base = { caller: "job" as const, scope, job: id, run };
let toolSteps = 0, aiSteps = 0, tokens = 0;
let summary: string | undefined;
let end: { status: "ok" | "needs-you" | "failed"; summary?: string; action?: string } | null = null;
const maxAi = job.maxAi ?? 1;

const tool = async (s: ToolStep, post: boolean) => {
  toolSteps++;
  const got = await runToolStep(d.registry, s, values, base, post ? { post: true } : {});
  if (got.summary !== undefined) summary = got.summary;
  if (s.as !== undefined) values.set(s.as, got.ok ? { ok: true, value: got.value } : { ok: false, tool: s.tool });
  return got;
};
const aiRound = async (data: { name: string; value: unknown }[]) => {
  const step = steps[aiAt] as AiStep;
  aiSteps++;
  const r = await d.ai({ job: id, run, round: aiSteps, scope, step, data, signal: ctl.signal });
  tokens += r.tokens;
  await d.registry.note({ tool: "step_output", caller: "job", job: id, run, text: `AI step: ${r.ok ? "valid output" : "no valid output"} · ${r.tokens.toLocaleString("en-US")} tokens` }).catch(logErr);
  if (r.ok && step.as !== undefined) values.set(step.as, { ok: true, value: r.value });
  return r;
};

for (let i = 0; i < steps.length && !end; i++) {
  if (ctl.signal.aborted) break;
  const s = steps[i];
  if (isAiStep(s)) {
    if (!whenHolds(s.when, values)) break; // Decision 12: the AI step and every step after it are skipped
    const r = await aiRound(s.input.map((n) => ({ name: n, value: (values.get(n) as { value: unknown }).value })));
    if (!r.ok) end = { status: "failed", summary: r.error };
    continue;
  }
  let got = await tool(s, i === postAt);
  while (got.ok && i === postAt && got.requestAi && !ctl.signal.aborted) {
    if (aiSteps >= maxAi) {
      const action = job.onLimit !== undefined && Object.hasOwn(d.actions, job.onLimit) ? job.onLimit : undefined;
      end = { status: "needs-you", summary: `Stopped after ${aiSteps} AI step${aiSteps === 1 ? "" : "s"}${summary ? ` · ${summary}` : ""}`, ...(action ? { action } : {}) };
      break;
    }
    const r = await aiRound([{ name: "request", value: got.requestAi.input }]);
    if (!r.ok) { end = { status: "failed", summary: r.error }; break; }
    got = await tool(s, true);
  }
  if (!end && !got.ok) end = { status: "failed", summary: `${s.tool} failed: ${got.error}` };
}
```
   (Each input of the AI step exists and is ok here: an earlier failure already ended the run. A round cancelled by the abort returns `cancelled`; treat it as the halt, not as a failure.)
4. Outcome: halted → "Timed out" / "Cancelled", status failed; `outcome === "error"` → "Could not run"; `end` → its status and summary; else ok with `summary ?? built`, where `built = \`${toolSteps + aiSteps} step${…}\` + (aiSteps ? \` · ${aiSteps} AI step${aiSteps === 1 ? "" : "s"}\` : "") + (last ? \` · ${last.tool}: ${last.resultSummary}\` : "")` (`last = await d.lastCall(run)`, ignoring notes).
5. Every summary through a one-line cut (controls and hidden characters removed, 300 characters by code points; reuse Task 4's `oneLine` helper or the same rule). `record: JobRunRecord = { run, job: id, scope, trigger, status, summary, ...(status === "needs-you" && action ? { action } : {}), tokens, startedAt, endedAt }`; `await d.log.append(record)`; `await d.recordRecipe({ job: id, run, ...(scope ? { scope } : {}), toolSteps, aiSteps, ms, ok: status === "ok" }).catch(logErr)`; return the record.

Write the whole function; the snippet above is the walk, not the full file.

- [ ] **Step 4: Run, typecheck, both frozen-list commands, commit.**

```bash
git -C <worktree> add packages/shell/src/main/jobs/recipe-runner.ts packages/shell/test/jobs-recipes/recipe-runner.test.ts packages/shell/test/jobs-recipes/recipe-record.test.ts
git -C <worktree> commit --only packages/shell/src/main/jobs/recipe-runner.ts packages/shell/src/main/usage-log.ts packages/shell/test/jobs-recipes/recipe-runner.test.ts packages/shell/test/jobs-recipes/recipe-record.test.ts -m "feat(shell): the recipe runner — when, post-step rounds, maxAi, result mapping" -m "<trailer>"
```

---

### Task 8: Dispatch in the jobs host, the scheduler's cap, wiring

**Files:**
- Modify: `packages/shell/src/main/jobs/jobs-host.ts` (`JobsHostDeps.tools?`, `runOnce` picks the runner, `summaries` adds `last.run` with tools), `packages/shell/src/main/jobs/job-scheduler.ts` (`overCap`), `packages/shell/src/main/index.ts` (`buildJobsHost` passes `tools` when `hasRecipes(harness)` or `hasTools(harness)`), `packages/ui/src/client.ts` (`JobSummary.last.run?`)
- Test: `packages/shell/test/jobs-recipes/jobs-host-recipes.test.ts` (new), `packages/shell/test/jobs-recipes/scheduler-no-ai.test.ts` (new), `packages/shell/test/tools-recipes-surface.test.ts` (new)

- [ ] **Step 1: Write the failing tests.**

```ts
// jobs-host-recipes.test.ts — createJobsHost with doubles, as packages/shell/test/jobs/jobs-host.test.ts builds them (read it; don't change it)
describe("the jobs host with recipes (tools spec §7, §14)", () => {
  it("D0: a prompt job runs through runJob and nothing else", async () => {
    // a host without tools; runManual("sync") → the workspace opened a slot of kind "job"; firstMessage read the brief; no registry call
  });
  it("a recipe job runs through runRecipe: tool calls as caller job, no job slot opened", async () => { /* … */ });
  it("a recipe's needs-you settles the inbox item with its onLimit action, as a prompt job's", async () => { /* attention.raise with target { action } */ });
  it("a recipe's run logs in jobs.jsonl and its usage row goes to usage.jsonl", async () => { /* usage double got the recipe row with engine */ });
  it("the AI step's usage lines are part 3's job lines for the run", async () => { /* jobRecord with task: run */ });
  it("a recipe job without a tools dep fails its run 'Tools are off'", async () => {
    // defensive: hasRecipes implies tools; the run is logged failed with that summary, nothing thrown
  });
  it("summaries carry last.run only when the host has tools", async () => { /* with tools: last.run === record.run; without: no run key */ });
});
```
```ts
// scheduler-no-ai.test.ts — JobScheduler with a fake timer, as job-scheduler.test.ts builds it (read it; don't change it)
describe("the daily cap and jobs that use no AI (tools spec §7.4)", () => {
  it("D0: a job that uses AI is paused at its cap as before", async () => { /* tokensToday >= dailyTokens → every skipped, pausedToday true */ });
  it("an every recipe with no AI step and no dailyTokens is never paused", async () => { /* tokensToday 0, no cap → fires; pausedToday false */ });
  it("an every recipe with an AI step is paused at its cap", async () => { /* … */ });
});
```
```ts
// tools-recipes-surface.test.ts — reads packages/shell/src/main/index.ts as text, as slice 2's tools-surface test does
// "buildJobsHost passes tools only inside hasTools" ; "readBrief reads a brief only for a prompt job"
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**
  - `job-scheduler.ts` `overCap`, first line: `if (!jobUsesAi(job)) return false;` (a prompt job always uses AI: unchanged for it).
  - `jobs-host.ts`:

```ts
  /**
   * The tools (tools spec §7): a recipe's registry, the AI step's brief reader and the trace's last call. Absent without
   * tools (D0): every job is a prompt job then.
   */
  tools?: {
    registry: RecipeRunDeps["registry"];
    lastCall(run: string): Promise<{ tool: string; resultSummary: string } | null>;
    readAiBrief(path: string): Promise<string>;
  };
```
    In `runOnce`, the call to `runJob(...)` becomes `job.steps ? runRecipe(recipeDeps, id, job, scope, trigger, signal) : runJob(<today's deps>, id, job, scope, trigger, signal)`, today's object untouched. `recipeDeps`:

```ts
const recipeDeps: RecipeRunDeps = {
  gate: d.gate,
  log: logFor(base),
  registry: d.tools?.registry ?? offRegistry,
  lastCall: (r) => d.tools?.lastCall(r) ?? Promise.resolve(null),
  ai: (o) =>
    runAiStep(
      {
        workspace: () => d.workspace(),
        readBrief: (p) => (d.tools ? d.tools.readAiBrief(p) : Promise.reject(new Error("Tools are off"))),
        profileFor: async (tier) => d.taskDeps.profileFor?.(undefined, undefined, tier),
        recordUsage: async (e) => {
          const usage = { inputTokens: e.inputTokens, outputTokens: e.outputTokens, cacheReadTokens: e.cacheReadTokens, cacheWriteTokens: e.cacheWriteTokens, ...(e.costUsd !== undefined ? { costUsd: e.costUsd } : {}) };
          await appendUsage(base, jobRecord({ engine: await d.engine(), job: id, task: o.run, ...(scope ? { scope } : {}), usage }, now().toISOString()));
        },
        gate: d.gate,
        now,
      },
      o,
    ),
  recordRecipe: async (row) => appendUsage(base, recipeRecord({ engine: await d.engine(), ...row }, now().toISOString())),
  actions: d.actions,
  now,
  newId: () => runId,
  stillValid: async () => (await d.base()) === base,
  ...(d.maxMs !== undefined ? { maxMs: d.maxMs } : {}),
};
```
    `offRegistry` answers every call `{ ok: false, error: "Tools are off" }`, `meta` null, `note` a no-op. The `usage` object build is the same as `runJob`'s `recordUsage`: lift it into a small local function used by both (the prompt path's behaviour and output unchanged).
    `summaries()`: `...(r ? { last: { …today's keys…, ...(d.tools ? { run: r.run } : {}) } } : {})`.
  - `client.ts` `JobSummary.last`: `/** The run's id, for its steps (tools spec §8.2); only when the harness has tools. */ run?: string;`.
  - `index.ts` `buildJobsHost`: `readBrief` already guarded (Task 1). Add, only when `toolsHost` exists (slice 2's `if (hasTools(harness))` value):

```ts
    ...(toolsHost
      ? {
          tools: {
            registry: toolsHost.registry,
            lastCall: async (run) => {
              const entries = await toolsHost.registry.trace(run); // slice 2's trace read by run id (Task 0's note: the real name)
              const last = [...entries].reverse().find((e) => e.note === undefined);
              return last ? { tool: last.tool, resultSummary: last.resultSummary } : null;
            },
            readAiBrief: (p) => fs.readFile(resolveInHarness(harness, p), "utf8"),
          },
        }
      : {}),
```
    `buildJobsHost` runs after the tools host is built; if it runs before today, pass a getter (`tools: () => …`) instead and say so.

- [ ] **Step 4: Run** the three new tests, every file in `packages/shell/test/jobs/` (frozen, green), `board-host.test.ts`, slice 2's `tools-surface.test.ts`; typecheck; `corepack pnpm app:build`; `corepack pnpm --filter @humanharness/e2e exec playwright test jobs.spec.ts` (part 3's e2e, green); both frozen-list commands.

- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/shell/test/jobs-recipes/jobs-host-recipes.test.ts packages/shell/test/jobs-recipes/scheduler-no-ai.test.ts packages/shell/test/tools-recipes-surface.test.ts
git -C <worktree> commit --only packages/shell/src/main/jobs/jobs-host.ts packages/shell/src/main/jobs/job-scheduler.ts packages/shell/src/main/index.ts packages/ui/src/client.ts packages/shell/test/jobs-recipes/jobs-host-recipes.test.ts packages/shell/test/jobs-recipes/scheduler-no-ai.test.ts packages/shell/test/tools-recipes-surface.test.ts -m "feat(shell): a job is a prompt or a recipe — dispatch, cap, wiring" -m "<trailer>"
```

---

### Task 9: A run's steps in the inbox and Settings › Jobs

**Files:**
- Create: `packages/ui/src/tools/JobRunSteps.tsx`
- Modify: `packages/ui/src/parallel/Inbox.tsx` (a job row with `last.run`), `packages/ui/src/parallel/JobsTab.tsx` (the same in each run line), `packages/i18n/src/locales/en.json` (`"tools"` block: `jobSteps`, `jobStepsNone`, `jobStepsLoading`, `jobStepsError`)
- Test: `packages/ui/test/job-run-steps-ui.test.tsx` (new; `jobs-ui.test.tsx` frozen)

- [ ] **Step 1: Write the failing tests.** Use `packages/ui/test/fake-client.ts`'s `tools.trace` (slice 2) and `jobs.list`.

```tsx
describe("a job run's steps (tools spec §8.2)", () => {
  it("D0: a row without last.run renders as before", () => {
    // render the Jobs region with rows lacking run: no "Steps" button; the row's text and buttons equal jobs-ui.test.tsx's expectations
  });
  it("a row with last.run has a Steps button that unfolds the run's calls", async () => {
    // click "Steps" → client.tools.trace called with the run id → one ToolCallLine per entry (folded), notes as lines
  });
  it("an entry with an error shows unfolded", async () => { /* slice 2's rule */ });
  it("a run with no entries says so", async () => { /* en "No steps recorded for this run." */ });
  it("a trace that can't be read says so and keeps the row", async () => { /* en "Couldn't read this run's steps." */ });
  it("Settings › Jobs shows the same Steps under a run line", async () => { /* … */ });
});
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**
  - en.json, inside `"tools"`: `"jobSteps": "Steps"`, `"jobStepsNone": "No steps recorded for this run."`, `"jobStepsLoading": "Reading the steps…"`, `"jobStepsError": "Couldn't read this run's steps."`.
  - `JobRunSteps.tsx`: `({ run }: { run: string })` → a disclosure button "Steps" (`aria-expanded`); on first open, `client.tools.trace(run)`; renders the entries with slice 2's `ToolCallLine` (imported from where slice 2 put it), a note entry as its one line (slice 3's view), errors unfolded. Loading and error states as above. No polling: it reads once per open.
  - `Inbox.tsx` and `JobsTab.tsx`: after a row's summary line, `{row.last?.run ? <JobRunSteps run={row.last.run} /> : null}`. Nothing else changes in those files.

- [ ] **Step 4: Run** the new test and `jobs-ui.test.tsx` (frozen, green), slice 2's `tool-call-ui.test.tsx` (frozen); typecheck; `corepack pnpm app:build`; both frozen-list commands.

- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/ui/src/tools/JobRunSteps.tsx packages/ui/test/job-run-steps-ui.test.tsx
git -C <worktree> commit --only packages/ui/src/tools/JobRunSteps.tsx packages/ui/src/parallel/Inbox.tsx packages/ui/src/parallel/JobsTab.tsx packages/i18n/src/locales/en.json packages/ui/test/job-run-steps-ui.test.tsx -m "feat(ui): a job run's steps under its summary" -m "<trailer>"
```

---

### Task 10: Fixture harness and e2e

**Files:**
- Create: `packages/fake-agent/fixtures/recipes-harness/` (`harness.config.ts`, `AGENTS.md`, `prompts/write-a.md`, `jobs/classify.md`, `tools/check-items.ts`, `tools/apply-triage.ts`, `tools/boom.ts`, `fake-script.json`, committed `dist/tools/*.js` and `dist/tools.json`), `packages/e2e/tests/recipes.spec.ts`, `packages/cli/test/recipes-fixture-dist.test.ts`
- Modify: `.gitignore` (`!packages/fake-agent/fixtures/recipes-harness/dist/`, next to slice 2's fixture exception)

- [ ] **Step 1: The fixture.** Single mode (jobs, no `parallel`), id `recipes`, permissions `{ edit: "folder", exec: false, web: false }`, one action `write-a` (as `jobs-harness`), no scopes. Tools (`agent: "none"`, `uses: {}`):
  - `check-items` — params `{ fail: z.boolean() }`, returns `z.array(z.object({ id: z.string(), failed: z.boolean() }))`: `[{ id: "a", failed: fail }, { id: "b", failed: false }]`; `summary: (r) => \`${r.length} items\``.
  - `apply-triage` — params `{}`, returns `z.object({ applied: z.number() })`: reads `ctx.inputs.triage` (`{ ids, again }`); when `again` is true, `await ctx.requestAi({ ids })`; `await ctx.summary(\`Triaged ${ids.length}\`)`; returns `{ applied: ids.length }`.
  - `boom` — throws `new Error("boom")`.
  Jobs (all `on: { manual: true }`, `scope: "none"`):
  - `triage` "Triage": `[{ tool: "check-items", args: { fail: true }, as: "items" }, { ai: "./jobs/classify.md", input: ["items"], output: z.object({ ids: z.array(z.string()), again: z.boolean() }), when: { from: "items", where: { failed: true } }, as: "triage" }, { tool: "apply-triage", input: ["triage"] }]`, `maxAi: 2`.
  - `quiet` "Quiet": the same steps with `args: { fail: false }`.
  - `capped` "Capped": the same as `triage` with `maxAi: 1`, `onLimit: "write-a"`.
  - `broken` "Broken": `[{ tool: "boom" }]`.
  `jobs/classify.md` starts "Classify step:". `fake-script.json` turns, in this order (first match wins): `"### request"` → `step_output { ids: ["a"], again: false }`; `"^Classify step:"` → `step_output { ids: ["a"], again: true }`; `"# Task: write-a"` as jobs-harness's. Each AI turn ends with a usage line (`input_tokens: 1200 …`). Build `dist/` with `corepack pnpm --filter @humanharness/cli exec tsx src/main.ts build --harness <fixture>` (slice 2's build command; Task 0's note has the real invocation) and commit it.
  Note on `capped`: its first round answers `again: true`, so the post-step asks for a second round past `maxAi: 1`.

- [ ] **Step 2: Freshness test** `recipes-fixture-dist.test.ts`: rebuild the fixture's tools in memory (slice 2's `fixture-dist.test.ts` pattern) and compare with the committed `dist/` byte for byte.

- [ ] **Step 3: E2E** `recipes.spec.ts`, launching the built app on the fixture with fake-claude (as `jobs.spec.ts` launches `jobs-harness`; read it, don't change it), Settings › Jobs (single mode):
  - "a recipe with a conditional AI step, a post-step and one extra round ends ok": Run now on Triage → the run line shows "OK" and "Triaged 1"; `jobs.jsonl` has one line for `triage` with `status: "ok"` and `tokens` equal to two AI turns' tokens; `usage.jsonl` has one `kind: "recipe"` row with `aiSteps: 2`, `toolSteps: 3`.
  - "Steps unfolds the run's calls": open Steps on Triage → lines for check-items, apply-triage (twice) and two AI step notes.
  - "when false skips the AI step": Run now on Quiet → "OK", summary "1 step · check-items: 2 items"; `tokens: 0`; no step slot opened (no AI usage line for the run).
  - "a request past maxAi needs the person and offers the action": Run now on Capped → "Needs you", summary "Stopped after 1 AI step · Triaged 1", Start opens Write A.
  - "a failed tool step fails the run": Run now on Broken → "Failed", summary "boom failed: boom"; Steps shows its error unfolded.
  - "D0: the jobs fixture still runs prompt jobs only": covered by `jobs.spec.ts` unchanged (run it).

- [ ] **Step 4: Run** the freshness test, `corepack pnpm app:build`, `recipes.spec.ts`, `jobs.spec.ts`, slice 2's `tools.spec.ts` and slice 3's `tools-pre.spec.ts`; typecheck; both frozen-list commands.

- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/fake-agent/fixtures/recipes-harness packages/e2e/tests/recipes.spec.ts packages/cli/test/recipes-fixture-dist.test.ts
git -C <worktree> commit --only .gitignore packages/fake-agent/fixtures/recipes-harness packages/e2e/tests/recipes.spec.ts packages/cli/test/recipes-fixture-dist.test.ts -m "test(e2e): job recipes — when, post-step rounds, maxAi, a failed step" -m "<trailer>"
```

---

### Task 11: Docs, known gaps and the full run

**Files:**
- Modify: `docs/architecture/jobs.md` (a job is `prompt` or `steps`; recipes; the AI step; known gaps against tools spec §7), `docs/architecture/tools.md` (`ctx.summary`, `ctx.requestAi`, job callers, run lines), `docs/architecture/manifest.md` (`steps`, `maxAi`, `onLimit`), `docs/architecture/authoring.md` (writing a recipe)

- [ ] **Step 1: `jobs.md`.**
  - Opening: "A job declares `prompt` (an AI job: one turn on a `job:<run>` slot, ending with `job_result`) or `steps` (a recipe, tools spec §7). Both end in the same `JobRunRecord` and `jobs.jsonl` line, the same inbox item and the same Dock count." Keep every part-3 section; where a sentence says "a run is a turn", add "for a prompt job".
  - A "Recipes" section: the walk (tool steps; `when`; the AI step on a `step:<run>:<round>` slot with only `step_output`; the retry; the post-step and `requestAi`; `maxAi`; the result mapping with each summary text); the `recipe` usage row and the AI step's job lines; the trace notes; Steps in the inbox; `HH_STEP`; mock mode (a step turn plays nothing until slice 5); D0 table rows for this slice (context.md's).
  - "Known gaps", append (each one line, with what would close it):
    - the daily cap is checked once per `every` fire: a run's extra AI rounds (up to `maxAi`) are counted after the run, not stopped mid-run (§7.3 says each counts; it does, late);
    - an AI step's model follows Settings › Models' free-questions row when changed, as a job's (no Models row for jobs or steps);
    - the 15-minute limit covers the whole recipe, every AI round included;
    - `cancelRuns` still sets no flag (part 3's gap) and now also covers recipes;
    - in mock mode an AI step has no recording (slice 5), so a recipe with an AI step fails there;
    - a harness with recipes clears `HH_STEP` in its task and job slots; a harness without them doesn't (D0), so an outer `HH_STEP` would reach their `ui` server (the same gap as `HH_JOB`);
    - `dailyTokens` was required with `every` for every job; now only for a job that uses AI (Decision 2).
  - "Where to look": `recipes.ts`, `recipe-runner.ts`, `ai-step.ts`, `when.ts`, `step-data.ts`, `JobRunSteps.tsx`, `recipes-harness`, `recipes.spec.ts`.
- [ ] **Step 2: `tools.md`, `manifest.md`, `authoring.md`** — the job-step rows of `ctx`; the keys with their limits and checks; a short "Writing a recipe" (one AI step at most, `when` to skip it, the post-step applies the AI's judgment, `requestAi` for a second look, `maxAi` and `onLimit`).
- [ ] **Step 3: Full run.** `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm app:build`, `corepack pnpm e2e` — all green. Both frozen-list commands print nothing. In `SCRATCH/carry-notes.md`: test and e2e counts, and anything slice 5 must know (the mock step turn's place in `mock-claude.ts`, `aiStepMessage`, the recipes fixture).
- [ ] **Step 4: Commit.**

```bash
git -C <worktree> commit --only docs/architecture/jobs.md docs/architecture/tools.md docs/architecture/manifest.md docs/architecture/authoring.md -m "docs: job recipes — steps, the AI step, rounds and known gaps" -m "<trailer>"
```

---

## Parallel execution

0 first. 1 → 2 (sdk). 3 is independent of 1–2 (pure; needs only slice 3's `StepValues`). 4 is independent of 1–3. 5 needs 1. 6 needs 3, 5. 7 needs 4, 6. 8 needs 7. 9 needs 8. 10 needs 8, 9. 11 last. Twelve tasks (0–11).
