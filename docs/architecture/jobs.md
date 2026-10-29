# Background jobs

A harness may declare `jobs`: work that runs with no chat and no person in the loop. A sync of tickets, a check after a task, a digest every few hours. A job declares `prompt` (an AI job: one turn on a `job:<run>` slot, ending with `job_result`) or `steps` (a recipe, tools spec `docs/superpowers/specs/2026-10-28-tools-and-recipes-design.md` §7: tool steps, and at most one AI step that runs only when its condition holds; "Recipes" below). Both end in the same `JobRunRecord` and `.harness/jobs.jsonl` line, the same inbox item and the same Dock count. A run that needs the person raises an item that starts one of the harness's actions. Spec: `docs/superpowers/specs/2026-10-27-parallel-tasks-and-jobs-design.md` §3, §8, §9, §10 (slices 5 and 6). Slots are in `turn.md`, the gate and the inbox in `parallel.md`, the trailers in `history.md`.

## The manifest

```ts
jobs: {
  sync: { label: "Sync tickets", prompt: "./jobs/sync.md", on: { start: true, manual: true }, permissions: { edit: "none" } },
  review: { label: "Review the note", prompt: "./jobs/review.md", on: { afterTask: ["write"] }, scope: "trigger" },
  digest: { label: "Digest", prompt: "./jobs/digest.md", on: { every: "2h" }, dailyTokens: 50_000 },
},
```

`jobSchema` and `jobProblems` (`packages/harness-sdk/src/jobs.ts`). Strict: a typo is refused.

- `label`: 1 to 80 characters, one English string. `prompt`: the brief, a file in the harness folder (`loadHarness` refuses one outside it; `check` says `brief-missing` when it doesn't exist or is empty). A job declares `prompt` or `steps` ("A job declares prompt or steps", "A job declares prompt or steps, not both"); `steps`, `maxAi` and `onLimit` are in "Recipes".
- `tier`: `light` (the default), `standard` or `deep`.
- `on`: at least one of `start`, `manual`, `afterTask` (`true`, or a list of action ids) and `every` (`"30m"`, `"2h"`; at least 15 minutes, `EVERY_MIN_MS`).
- `scope`: `none` (the default, app-wide), `each` (once per active scope) or `trigger` (the scope of the task or the "Run now" that fired it; needs `afterTask` or `manual`, and no `start` or `every`). A scope other than `none` needs the harness's `scopes`.
- `dailyTokens`: required with `every` for a job that uses AI (`jobUsesAi`: a prompt job, or a recipe with an AI step). Without `every` it caps nothing, and on a recipe with no AI step neither: `check` warns (`job-daily-tokens`).
- `permissions`: `edit`, `exec`, `web`. They can only narrow the harness's (J2); a widening is refused at load. A recipe can't have them ("permissions narrow an AI job's session; a recipe's tools use their own uses").
- A job id has the action id shape and can't be an action's id.

`hasJobs(h)` is false for an absent or empty `jobs`: no part-3 code runs (D0, below). `isConcurrent` is `parallel || jobs`.

## Host modes

`hostMode(harness)` (`board-host.ts`):

- `board`: the harness declares `parallel` (with or without jobs). Jobs run beside the lanes, on the board's gate and workspace.
- `single`: jobs without `parallel` (Decision 12). The person's side is today's single task: one `TaskManager`, one `TurnController`, no inbox, no task strip. Only the runtime changes: a workspace (`createWorkspace`) with a `"main"` slot for the task (`openSingleRuntime`, in `HarnessRuntime`'s shape) and the job slots beside it. A `TurnGate` with `tasks: 1` keeps one task turn at a time (`singleGate`, `singleTurns`); the jobs' cap is 1 unless config.json's `parallel.jobs` says otherwise (there is no control for it in this mode).
- `plain`: neither. Today's app.

The jobs' wiring is `createJobsHost` (`packages/shell/src/main/jobs/jobs-host.ts`), built in `index.ts` only when `hasJobs(harness)`.

## A run's life

For a prompt job, `runJob` (`jobs/job-runner.ts`), called by the scheduler through the jobs host (a recipe's run is in "Recipes"; it shares steps 1, 2 and 7, the time limit and the stops):

1. **Base.** The host reads the current base (the folder, or the profile's folder). None: the app isn't set up, the run is skipped.
2. **Gate.** The run waits in the gate's `jobs` queue (key `job:<run id>`, the run id a `randomUUID()`). An abort while queued drops it: nothing is logged. Once let in, `stillValid` checks the base is still the same; after a profile or folder switch the run is dropped, never run in the new one.
3. **Slot.** `workspace.openSlot({ key: "job:<run>", kind: "job", permissions })`. A job slot's `ui` server runs with `HH_JOB=1` (only exactly `"1"` turns job mode on), and its permissions go through `narrowPermissions`. With `exec: false`, Bash is in Claude's `--disallowedTools`. With jobs declared, a task slot's `ui` server gets `HH_JOB=""`, so an `HH_JOB` in the app's own environment (which the engine passes on to its MCP servers) can't make it a job.
4. **First message** (`jobFirstMessage`, `jobs/job-prompt.ts`): the brief (hidden characters stripped, cut at 20,000 characters), then the same context an action's first message carries for that scope (the notes index, `notesIndexFor` in `notes-index.ts`; the data asked with no action; the material), then how to end: "This is a background job: nobody reads this conversation and nobody can answer. Don't ask anything.", call `job_result` once, and the actions a needs-you result may name. A context part that fails to load is logged and left out. An app-wide run reads the app scope (with scopes) or `main` (without).
5. **The turn.** One send on the slot. Its model follows the job's tier (`profileFor`), unless the person set Settings › Models' free-questions row: then that row's. Its commits carry `Task: <run>`, `Job: <job id>` and, when scoped, `Scope:`. Each `usage` event becomes a usage line (below). An `out-of-quota` end pauses the gate as a task turn does.
6. **`job_result`.** Only the run's own slot is listened to. The first valid result stands; a later or malformed one is logged and ignored. The summary is put on one line (controls as spaces, hidden characters gone) and cut at 300 code points; empty becomes "No summary". `action` is kept only for `needs-you` and only when `Object.hasOwn(harness.actions, action)` (J3); otherwise it is dropped and logged.
7. **End.** The slot always closes and the gate's slot is always freed. The record goes to `jobs.jsonl` with its tokens (input + output + cache writes, `capTokens`).

How a prompt job's run ends:

| Case | `status` | `summary` |
|---|---|---|
| A `job_result` | its status | its summary |
| No `job_result` | `failed` | "No result" |
| Past `JOB_RUN_MAX_MS` (15 minutes, Decision 8) | `failed` | "Timed out" |
| Cancelled (engine switch, profile switch, folder move, plugin change, quit) | `failed` | "Cancelled" |
| The gate couldn't get ready, or the turn threw | `failed` | "Could not run" |

The time limit counts from the first setup step, so a slot that never opens can't hold the jobs' slot either.

**`jobs.jsonl`** (`jobs/job-log.ts`, `jobsFile(base)` = `.harness/jobs.jsonl`, untracked): one line per run, `{ run, job, scope, trigger, status, summary, action?, tokens, startedAt, endedAt }`. `scope` is null for an app-wide run. `startedAt` is the run's start, though the line is written at its end. Lines are checked strictly on read; a torn last line is skipped, and the next append starts on a new line. One `CachedJobLog` per base reads the file once until the next append.

**Usage lines** (Decision 2): `{ phase: "job", job: <id>, task: <run>, scope? }` (`jobRecord`, `usage-log.ts`). Settings › Usage splits them out by `phase === "job"`: they stay out of the topics' estimates and the per-scope rows, and a caption says "Background jobs: about N tokens" when there are any. Sidekick's daily card counts them as ", background jobs N". `recentUsage(records, n)` keeps the last `n` lines that aren't a job's plus the job lines among them, so a job on a timer never pushes the tasks' turns, the material stages or the latest limits window out of what the app reads.

**Data and material requests** from a job slot belong to the run (`runningOf(key)`: `{ id: <run>, scope }`), never to the open task.

**Harness tools** (`docs/architecture/tools.md`, tools Decision 9): in a harness with an `agent: "call"` tool, a job slot gets the core `tools` MCP server as a task slot does (a `prompt` job's agent may call tools; nothing assumes a job is an AI run). A call from a job slot belongs to the run (`runOf(key)`: `{ id: <run>, scope, job, trailer }`, the trailer being `jobRunTrailer(run, job, scope)`, the run's own history trailer): it traces `caller: "agent"`, `job: <job id>`, `run: <run id>`, in the run's scope, and a tool's data write commits under the run's trailer plus `Tool: <id>`. The job's permissions hold for its tools too: with `web: false` a tool it calls can't `ctx.fetch`, with `exec: false` it can't `ctx.exec` (refused naming them; an undeclared job reaches neither), so a narrowed job never reaches more through a tool (`jobLimits`, tools.md). Each run's calls go to `.harness/trace/jobs/<run-id>.jsonl`, whatever the job runs, and `client.tools.trace(runId)` returns them; the inbox and Settings › Jobs show them under the run ("Steps", in "Recipes").

## Recipes

Tools slice 4 (tools spec §3.3, §7, §8.4; plan `docs/superpowers/plans/2026-10-29-tools-slice4-recipes.md`, "Decision N" and the threat rows "R1"–"R7" in this section). A recipe is a job with `steps`: the harness's tools run in order as code, and a model is asked only when a condition says it is needed. A recipe with no AI step costs 0 tokens.

```ts
jobs: {
  sync: {
    label: "Sync",
    on: { every: "2h" },
    dailyTokens: 50_000,
    steps: [
      { tool: "open-prs", as: "prs" },
      { tool: "pr-ci", forEach: "prs", as: "ci" },
      { ai: "./jobs/classify-ci.md", input: ["ci"], when: { from: "ci", where: { failed: true } },
        output: z.object({ ids: z.array(z.string()), again: z.boolean() }), as: "triage" },
      { tool: "apply-triage", input: ["triage"] },
    ],
    maxAi: 2,
    onLimit: "review-ci",
  },
},
```

**The keys** (`packages/harness-sdk/src/recipes.ts`, `jobs.ts`):

- `steps`: 1 to 20 (`RECIPE_STEPS_MAX`). A tool step is slice 3's `toolStepSchema` (`tool`, `args?`, `input?`, `forEach?`, `as?`; no `required`: in a recipe every failure fails the run). The AI step is `{ ai, input, output, when?, tier?, as? }`: `ai` the step's brief (a file in the harness folder, resolved by `loadHarness`; `check` says `brief-missing` when it doesn't exist or is empty), `input` 1 to 10 earlier `as` names, `output` a zod object (`step_output`'s input; one that can't convert to JSON Schema, such as a date or a transform, is refused), `tier` (default `light`). At most one AI step a recipe.
- `when`: data, not code. `{ from }` holds when that earlier result is there and not empty (a list with items, an object with keys, a non-empty string, any other non-null value). `{ from, where }` holds when it is a list with an object item whose own top-level fields equal (`===`) every value; `where` takes 1 to 10 fields, each a string (≤ 200), number, boolean or null. A missing or failed result never holds. Every name in `when` (`from` and the `where` field names) must match `TOOL_ID` (`^[a-z][a-z0-9_-]{0,63}$`): lowercase, so a camelCase result field (`failedCount`) can't be matched; name the tool's result fields in that shape.
- `maxAi`: 1 to 3 (`MAX_AI_CAP`), default 1: the most AI steps one run may run, the first included. `onLimit`: an action the inbox offers when a run stops at `maxAi`. Both need an AI step ("maxAi needs an AI step", "onLimit needs an AI step"); `onLimit` must name an action (R7: at load, again by the runner, and by `settle`).
- Checks (`recipeProblems` in the manifest, `recipeSourceProblems` against `tools.json`): each step's tool is declared, each `as` once, `input`, `forEach` and `when.from` name an earlier `as`; a result read through `input` or `forEach` (the AI step's input too) comes from a tool that declares `returns`; the AI step's output is the source of later steps. `check` reports the second kind as `tool-steps` lines `Job "<id>": steps[i]: …`; the app turns tools off on the first one, as for pre-steps.
- `step_output` is reserved, like `job_result`: no tool or block may take the name.
- `hasRecipes(h)` (some job has `steps`) is the D0 switch; `jobUsesAi(job)` decides the daily cap.

**The walk** (`runRecipe`, `jobs/recipe-runner.ts`). `jobs-host.ts` sends a job with `steps` to `runRecipe` and any other to part 3's `runJob`, unchanged. The prologue is `runJob`'s: the gate's `jobs` slot (key `job:<run>`), dropped while queued, `stillValid`, the 15-minute limit (counted from when the gate lets the run in); the slot is held for the whole run, AI rounds included.

1. Tool steps run in order through slice 3's `runToolStep` as caller `"job"` (`job`, `run`, the run's scope, the job's `jobLimits`), inside the run's history trailer (a tool's data write commits under the run plus `Tool: <id>`). The runner sets each `as`. A failed or refused step fails the run: "<tool> failed: <message>" (the registry's redacted message; for `forEach`, the failing item's).
2. The AI step: when its `when` doesn't hold, it and every step after it are skipped and the run ends `ok` (Decision 12). A missing or failed input fails the run before any AI call (`"<as>" is not available[: <tool> failed]`).
3. One AI round (`runAiStep`, `jobs/ai-step.ts`) opens its own slot `step:<run>:<round>` (kind `"step"`, below) with a fresh session and the model of the step's `tier` (`profileFor(undefined, undefined, tier)`, as a job's). The first message (`aiStepMessage`) is the brief, then `## Data` (`dataSection`, `jobs/step-data.ts`: one `### <as>` part per input, compact JSON in a fence one longer than its longest backtick run, hidden characters written as `\u` escapes, the section cut at 200,000 characters with a note, R4), then "End by calling step_output once with the whole result. Nothing you write besides it is read." (`STEP_END_LINE`).
4. **The output** (R2): the `step_output` block's data is parsed in main with the job's own zod `output`; the parsed value is kept (unknown keys dropped) and the first valid one stands. A turn without one gets **one retry** in the same session: "Your turn ended without a valid step_output: <problem>. Call step_output once with the whole result." A second miss fails the run: "The AI step gave no valid output: <problem>", the problem being "it was not called" or the first zod issue as "path: message" (a path segment the schema doesn't name, such as a record key the model wrote, shows as `?`; an unrecognized key as "unrecognized key"). An **out-of-quota** turn gets no retry: it pauses the gate, as a job's turn does, and the run fails "The AI step gave no valid output: the engine is out of quota". A slot that can't open, a brief that can't be read or a send that throws fails the run "Could not run the AI step" (the cause only logged). The step slot is always closed.
5. **The post-step** is the first tool step after the AI step (`postStepIndex`). Only its call may use `ctx.requestAi(input)`: the call goes on and returns normally, then the runner runs the AI step again with `## Data` holding one part, `### request` (the input), and the post-step again with the new result. In a `forEach` post-step the first item's request, in item order, counts. Steps after the post-step run once, after the rounds end.
6. **The cap**: a `requestAi` when the run already ran `maxAi` AI steps ends it `needs-you`: "Stopped after N AI step(s)", plus " · " and the post-step's own last `ctx.summary` when it gave one, with `action` = `onLimit` when declared.
7. **The result** (§7.4): a run with no failure ends `ok` with the last `ctx.summary` any step gave, else a built line: "N steps" counting **tool steps only** (each call of a step; a `forEach` is one, a post-step run again counts again), plus " · 1 AI step" / " · N AI steps" when any ran, plus " · <tool>: <resultSummary>" of the last call in the trace ("3 steps · 1 AI step · apply-triage: 2 items"). Timeout and cancel are part 3's ("Timed out", "Cancelled"): a stop cancels a running AI turn at once, waits for a running tool call to end on its own timeout, and starts nothing more. An AI round the engine cancelled on its own (its slot or workspace closed) fails the run "Cancelled". A throw from the registry or the AI step's deps fails it "Could not run". Every summary goes through part 3's one-line cut (300 characters; empty is "No summary").
8. **The record** is part 3's `JobRunRecord`, unchanged, in `jobs.jsonl`; `tokens` is the AI rounds' (0 without one). `settle`, the inbox item, the Dock badge, dedupe and caps are shared.

| Case | `status` | `summary` |
|---|---|---|
| Every step ran, or `when` didn't hold | `ok` | the last `ctx.summary`, else "N steps · N AI steps · <tool>: <resultSummary>" |
| A tool step failed | `failed` | "<tool> failed: <message>" |
| No valid `step_output` after the retry | `failed` | "The AI step gave no valid output: <problem>" |
| The AI step couldn't run (slot, brief, send; any engine but Claude) | `failed` | "Could not run the AI step" |
| `requestAi` past `maxAi` | `needs-you` | "Stopped after N AI step(s)[ · <post-step summary>]", action `onLimit` |
| Time limit / cancel | `failed` | "Timed out" / "Cancelled" |
| The gate couldn't get ready, or a dep threw | `failed` | "Could not run" |

**The step slot** (`workspace.ts`, kind `"step"`, R1). Its `ui` server runs in step mode (`HH_STEP=<job id>`, `HH_JOB=""`): one tool, `step_output`, whose input schema is that job's AI step `output`, and nothing else (`stepServer`, `packages/blocks/src/ui-server.ts`). No data, material, review or `tools` server, no harness MCP server, no reference folder, no scope access (no linked folder, no engine preset); permissions narrowed to `edit: "none"`, no exec, no web, and `mcpOnly` (Claude's `--allowedTools` is only `mcp__ui`: no Read, Glob or Grep). The engine runs in **its own empty temp folder** (`hh-step-*` under `WorkspaceOptions.stepParent`, default the OS temp folder; removed when the slot closes, on a stop and on `ws.close()`), never the work folder, so no AGENTS.md or CLAUDE.md is loaded. A step turn opens **no turn window**, adds nothing to the ledger and makes **no history commits**. **Claude only for now**: `openSlot` refuses kind `"step"` on any other transport ("An AI step runs only with Claude for now", before any folder or socket), so on Codex or OpenCode a recipe with an AI step fails "Could not run the AI step" (an ACP engine's own sandbox can't yet keep a step from reading the disk). With a recipe declared, task and job slots set `HH_STEP=""` on their `ui` server, so an outer `HH_STEP` can't make them a step slot.

**Without tools** a recipe can't be declared (each step's tool must be declared), but the jobs host fails closed if it ever runs one: with no `tools` dep every call answers "Tools are off", so the run fails "<first tool> failed: Tools are off". With tools declared but off (not built, a problem, crashes), each call answers the registry's reason: "<tool> failed: Tools are not built: run humanharness build".

**Usage** (§8.4). Each AI round's turns write part 3's job lines (`jobRecord`, `task: <run>`), so the daily cap and Settings › Usage count them. The run writes one row `{ at, engine, phase: "job", kind: "recipe", job, task: <run>, run, scope?, toolSteps, aiSteps, ms, ok }` (`recipeRecord`, `usage-log.ts`), also for a failed or timed-out run (`ok` is `status === "ok"`). `recipe` is a `TOOL_ROW_KINDS` row: no `usage`, so no token reader counts it, and `phase: "job"` keeps it out of the tasks' readers.

**The daily cap**: a job that uses no AI (a recipe without an AI step) is never paused by it (`overCap` in `job-scheduler.ts`), whatever Settings › Jobs says; the field still shows for every `every` job.

**Trace notes** (Decision 16): each AI round, failed or cancelled too, writes a trace note under the run: tool `step_output`, caller `job`, "AI step: valid output · 1,234 tokens" or "AI step: no valid output · N tokens". The built summary's last call skips notes.

**Steps** (Decision 17): when the harness has tools, `JobSummary.last.run` is the last run's id, for every job (a prompt job's agent may call tools too). The inbox's Jobs row and Settings › Jobs then show a "Steps" button under the summary (`JobRunSteps`, `packages/ui/src/tools/JobRunSteps.tsx`, `aria-expanded`, `aria-describedby` the row's label) that unfolds the run's trace (`client.tools.trace(run)`, read on the first open, read again after an error) as slice 2's `ToolCallLine`s: a note as its one line, a failed call unfolded. "Reading the steps…", "No steps recorded for this run.", "Couldn't read this run's steps." (`tools.jobSteps*`). A new run on the same row folds it and reads the new one. Without tools, no `run` and no Steps.

**Mock mode**: a step turn (non-empty `HH_STEP` on the `ui` server, checked before anything else) plays nothing and saves no session state, so the AI step ends without output and the run fails "The AI step gave no valid output: it was not called". Recordings for AI steps are slice 5's. The e2e answers AI steps with fake-claude scripts (`fixtures/recipes-harness`).

## Triggers

`JobScheduler` (`jobs/job-scheduler.ts`):

- **`start`**: once per app start, after setup (Decision 7). `jobsReady` in `index.ts` calls `appReady()` after the window opens, after a save that sets the app up, and after arriving in a profile; only the first call does anything. It waits for the scopes to settle first, so `each` runs in the scopes as they are.
- **`manual`**: "Run now" (`client.jobs.run`). Only a declared manual job, not off, in an existing scope (J4). A scope-`trigger` job needs a scope; a scope-`none` job takes none; a scope-`each` job given a scope runs in it alone.
- **`afterTask`**: `TaskManager`'s optional `taskClosed` dep, called when a task ends `done` with its note written (Decision 6). A task cancelled or ended unfinished fires nothing. A throw is logged.
- **`every`**: a one-shot main-process timer, armed at `appReady`. The first run is one interval after the start; each next one, one interval after the timer fires. A wait longer than `setTimeout` allows is armed in steps (`TIMER_MAX_MS`).

**Scopes.** A scope-`each` job runs in every active scope whatever fired it; only a Run now given a scope narrows it to that one. A scope-`trigger` job runs in the closed task's scope or the Run now's.

**Dedupe.** One run per job and scope at a time (`dedupeKey`: `<job>:<scope>`, `-` for app-wide). A trigger while one is queued or running is skipped and logged.

**The daily cap** (J5). An `every` fire is skipped when the job's tokens today reach its cap: today's runs of that job (every trigger, manual too), by the local day of `startedAt` (Decision 9). The cap is the person's `dailyTokens` in Settings › Jobs, else the manifest's. Only `every` checks it, and only for a job that uses AI (a recipe without an AI step is never paused). The Jobs section then says "Paused until tomorrow".

**Off.** A job turned off in Settings › Jobs is refused by every trigger. Settings are read at each trigger, so a change applies from the next one.

**Stopping** (Decision 11):
- engine switch (`dropRuntime`): `cancelRuns()` aborts the runs queued or running; in single mode the gate's queue empties too. Timers stay;
- profile switch, folder move, plugin catalogue change (`closeRuntime`): `cancelAndSettle()` cancels the runs and waits until they settle, before the workspace closes: a running one logs "Cancelled", a queued one is dropped (nothing logged);
- quit: `stopAll()` cancels the runs, clears the timers, and nothing fires again. `start` jobs run again at the next start.

## What a job can't do

- **Ask the person** (J1). The job-mode `ui` server (`createUiServer(cfg, bridge, { job: true })`, `packages/blocks/src/ui-server.ts`) still lists `choices`, `set_phase`, `recommend_mode` and the input blocks, but refuses them without reaching the app: "A background job cannot ask the person; end with job_result." (`JOB_CANNOT_ASK`). In job mode they are registered with no input schema, so the refusal comes before any argument check: bad arguments don't cost a turn on a schema error first.
- **Save a note** (Decision 4). `save_note` is refused: "A background job saves no note; end with job_result." (`JOB_NO_NOTE`). There is no closing turn.
- **Wait for a permission.** The ACP transport answers each permission request from the slot's narrowed policy; Claude's `-p` denies a tool outside `--allowedTools` without asking (Decision 5). The time limit ends a run that hangs anyway.
- **Widen permissions** (J2): refused at load; the slot only narrows.
- **Name an undeclared action** (J3): dropped by the runner, checked again before an attention item gets a target.

`job_result` (`jobResultSchema`: `status`, `summary` up to 300 characters, optional `action`) is registered only on a job slot's `ui` server. It is not in `allBlocks`, so AGENTS.md doesn't change (Decision 1). It is a reserved block name: a harness block can't be called `job_result`.

## Results the person sees

- **Attention item.** A `needs-you` run raises `{ kind: "job", id: <job>:<scope> }`, key `result`, severity `action`, in the base's shared Attention store (the plugins' and the tasks' store). Its title is the summary, cut to the store's limit by UTF-16 units without splitting a pair (the whole summary in the body when cut), and its target is `{ action, vars: { scope } }` when the run named a declared action. The item follows the job and scope's last run: any later result, a failed or cancelled one too, resolves it (PR decision). Only declared jobs' origins show (`jobOriginKnown`). Nothing raises an OS notification for a job.
- **Dock badge.** Board mode: the waiting tasks, the plugins' count and the jobs' needs-you count. Single mode: the plugins' count and the jobs'. A job turned off, or an archived or gone scope, doesn't count (`needsYou()`). Plain mode never sets it.
- **The inbox's Jobs section** (board mode, `Inbox.tsx`, `useJobs.ts`): one row per job × active scope (one app-wide row for `scope: "none"`): label, scope, "Running" or the last status ("OK", "Needs you", "Failed"), "Last run" and "Next run" times, "Paused until tomorrow" or "Turned off", the summary, "Run now" for a manual job and "Start" for a needs-you result's action. Start runs the action through the chat's own start path in the row's scope; it doesn't resolve the item. A refused Start or Run now keeps the list open and says "Couldn't start it now." or "Couldn't run it now.". The inbox count is the waiting tasks plus the needs-you rows of jobs that aren't off.
- **Settings › Jobs** (`JobsTab.tsx`, only with `state.jobs`, before Usage): per job an "On" checkbox, for an `every` job "Every {interval}" and a "Daily token cap" field (at least 1,000 in the field; saved on blur or Enter; empty removes it), and the runs per scope as in the inbox, with Run now and Start. In single mode this tab is where a needs-you result is seen and started (there is no inbox); Start works while the chat is on screen. Saved as `config.jobs[id] = { off?: true, dailyTokens? }` (`cleanJobs`: only declared ids, `off` only `true`, a cap a whole number ≥ 1, empty entries dropped). Saves go through `useLatestConfig`, so a quick second change never wipes the first.
- **History**: a job run's row is labelled "Job · {label}" from its commits' `Job:` trailer (`historyView` → `jobId`); a job the harness no longer has shows "A background job".

**`client.jobs`** (`JobsClient`; preload `hh:jobsList`, `hh:jobsRun`, push `hh:jobsChange`; `jobsIpc` in `jobs-host.ts`):
- `list()` answers `JobSummary[]`: `{ id, label, scope, last?: { status, summary, at, action? }, next?, paused?: "off" | "daily-cap", manual, running }`. `last.at` is the run's end. `next` is hidden while paused. Archived scopes don't show. Never the brief.
- `run(id, scope?)` refuses a bad or unknown id (`Object.hasOwn`), a job that isn't manual or is off, a scope on an app-wide job, no scope on a `trigger` job, and an unknown scope. It answers false when that job and scope is already queued or running, or before setup (nothing is queued then).
- Both refuse without jobs ("No jobs"). `hh:jobsChange` is pushed when a run is queued or ends, when settings are saved and when the scopes change. `coalescedSender` reads one list at a time and never loses the last push.
- `AppState.jobs` (`jobsInfo`): each job's id, label, `every`, `dailyTokens` and `manual`; only for a harness with jobs.

## Single mode details

- **Commits.** While a job runs, the app's own changes commit only their own files (`ownCommits()`: board mode, or `jobsHost.running()`): the single task's note, a data write, Sidekick's learning, a material change. A job's work never gets the task's trailer. When no job runs, the commits are today's.
- **A crashed run.** A job turn that ends `agent-crashed` never restores the folder to its `Before message`, even when it ran alone: the app's commits made meanwhile (a data write, a note, Sidekick's learning, the material) would go. Only the paths the run named in its edit events go back, from the head as it is then (`endTurn`, as an overlapped crash's own paths); a path it changed without naming it stays for the next commit, and so does a named one an app commit already took in (it is in the head). A task's crash alone restores the whole folder as before (`runtime-d0.test.ts`).
- **Undo.** "Undo this task" is by paths, as in board mode (`history.md`, "Undo in board mode"): a job's commits between the task's stay. A run still going refuses its own undo, and "Go back here" is refused while a run is queued or running (`RestoreGuard`'s `busy`). The History panel uses `undoByFiles` when `state.parallel` or `state.jobs`.
- **Out of quota.** A job turn that ends out of quota pauses the gate. Every task turn lifts that pause, quiet ones too (the closing note, a checkpoint, the wrap-up): the plain view has no Resume, and a held quiet turn would leave the task waiting for one (PR decision). At worst the task meets the engine's limit itself, as today.
- **Engine hold.** On an engine held at one session (anything but `claude` and `codex`), tasks and jobs share one turn, and the task's idle `"main"` process sleeps before a job's turn (`singleBeforeStart`).
- **AGENTS.md.** A rewrite while a job runs is refused (`refreshInstructions` throws); the change waits for the next gap.

## Mock mode

`humanharness dev --mock` answers a job's turn with a canned `job_result` `{ status: "ok", summary: "Mock run" }` (`MOCK_JOB_RESULT`, Decision 10). A turn is a job's when the slot's `ui` server carries `HH_JOB=1` (only job slots do) and `isMockJobTurn` (`packages/fake-agent/src/mock-replay.ts`) finds a prompt line that starts with `MOCK_JOB_MARK`, the first line of the first message's "how to end" part; the brief comes before it. A task's prompt with that line plays its recording as any other. `mock-claude` saves no session state for a job turn, so it never moves a task's recording on. A recipe's AI step turn plays nothing ("Recipes"). Tests that need other results use fake-claude scripts: `packages/fake-agent/fixtures/parallel-harness` (board mode) and `fixtures/jobs-harness` (single mode, id `jobs`) declare jobs whose scripted turns answer ok, needs-you naming an action, a refused ask and no result (`packages/e2e/tests/jobs.spec.ts`).

## D0

A harness without `jobs` runs no part-3 code: no scheduler or timers, no jobs.jsonl, no `job_result` tool, no `Job:` trailers, usage lines byte for byte as before, no Jobs tab and no Jobs rows.

| What stays as before | Pinned by |
|---|---|
| `allBlocks` and AGENTS.md | `packages/harness-sdk/test/jobs.test.ts` ("D0: absent; allBlocks unchanged by jobs") |
| The `ui` server's tools without `HH_JOB` | `packages/blocks/test/ui-server-job.test.ts` (the tool list is exactly today's; `choices` still reaches the bridge) |
| No scheduler work | `packages/shell/test/jobs/job-scheduler.test.ts` ("no jobs, no timers and no runs") |
| Host mode | `packages/shell/test/board-host.test.ts`: plain without `parallel` or jobs (an empty `jobs` too), single with jobs only, board with `parallel` |
| Usage lines | `packages/shell/test/usage-log.test.ts`: a task's record serialises as before; a log without job lines has no jobs total; `recentUsage` without job lines is the last `n` |
| `TaskManager` without `taskClosed` | `packages/shell/test/task-manager.test.ts` ("without taskClosed the flow is today's") |
| No Jobs tab, no jobs call | `packages/ui/test/jobs-ui.test.tsx` |
| Commits | `packages/runtime/test/runtime-d0.test.ts`, the e2e golden in `history.spec.ts` |

`client.jobs` exists in every app, but main refuses every call without jobs.

**Recipes (tools slice 4).** A harness whose jobs all declare `prompt` (or that has no jobs) runs no slice-4 code: `defineHarness` gives no `steps`, `maxAi` or `onLimit` key and a prompt job parses as before; every run goes to `runJob`, unchanged (`job-runner.ts`, `job-prompt.ts` and `job-log.ts` are as part 3 built them); `jobs.jsonl`, `job_result`, first messages and usage lines as before; no slot of kind `"step"` and no `HH_STEP` key in any `ui` env; the daily cap as before for every job that uses AI; no `last.run` in `JobSummary` without tools, and the inbox and Settings › Jobs as before; a tool call that uses neither `ctx.summary` nor `ctx.requestAi` answers as in slice 2.

| D0 item (slice 4) | Pinned by |
|---|---|
| Manifest | `packages/harness-sdk/test/recipes.test.ts` "D0: a prompt job parses as before, with no steps, maxAi or onLimit"; `jobs.test.ts` unchanged |
| `ui` server | `packages/blocks/test/ui-server-step.test.ts` "D0: without step the tools are as before"; `ui-server-job.test.ts` unchanged |
| Slots | `packages/runtime/test/workspace-step.test.ts` "D0: without a recipe no slot's ui env has HH_STEP", "D0: a task slot still runs in the work folder and opens its window"; `runtime-d0.test.ts`, `claude-cli.test.ts` unchanged |
| Registry answer | `packages/shell/test/tools/tool-run-summary.test.ts` "D0: a call without summary or requestAi answers as before"; `tool-registry.test.ts` unchanged |
| Dispatch | `packages/shell/test/jobs-recipes/jobs-host-recipes.test.ts` "D0: a prompt job runs through runJob and nothing else"; `packages/shell/test/jobs/` unchanged |
| Scheduler | `packages/shell/test/jobs-recipes/scheduler-no-ai.test.ts` "D0: a job that uses AI is paused at its cap as before" |
| Window | `packages/ui/test/job-run-steps-ui.test.tsx` "D0: a row without last.run renders as before", "D0: Settings › Jobs without last.run has no Steps and reads no trace"; `jobs-ui.test.tsx` unchanged |
| Runtime, history, jobs | `runtime-d0`, `hatches-d0`, `claude-cli` goldens, `hatches-surface`, `history.spec.ts`, `jobs.spec.ts`: unchanged |

## Known gaps

- In a harness without jobs, task slots don't clear `HH_JOB` (D0 pins their `ui` server's env): an app started with `HH_JOB=1` in its environment would give them a job-mode `ui` server.
- The usage readers (`recentUsage` callers: Settings › Usage, the material window, measured material costs, Sidekick) read the whole usage.jsonl on each call. A job on a timer makes it grow faster; a tail read or a cache is a follow-up. jobs.jsonl is read whole too, once per append.
- A job's model follows Settings › Models' free-questions row when the person changed it (`profileFor` with no action): jobs have no Models row of their own yet (PR decision).
- The daily cap is checked once per `every` fire and doesn't count runs still going: a scope-`each` job over N scopes can pass it by up to N runs.
- `cancelRuns` sets no flag: an `every` fire in the middle of its await during an engine switch can queue runs for the new engine.
- A checkpoint-only end of a task counts as `done` and fires `afterTask`.
- In single mode, a person's message can wait behind a running job for up to the run's time limit when the engine is held at one session, with nothing on screen saying why; there is no 10 s hold before an AGENTS.md rewrite as in board mode.
- With profiles, `start` runs once per app start in the profile that was active when the app was first set up; another profile gets none until the next start.
- A day with only job runs still makes Sidekick's daily card (PR decision).
- **Recipes: the daily cap during a run.** It is checked once per `every` fire: a run's extra AI rounds (up to `maxAi`) are counted after the run, not stopped mid-run (tools spec §7.3 says each counts; it does, late). Closing it: check the cap before each extra round.
- **Recipes: an AI step's model** follows Settings › Models' free-questions row when the person changed it, as a job's: there is no Models row for jobs or AI steps. Closing it: a Models row per job.
- **Recipes: the 15-minute limit** covers the whole recipe, every AI round included; a long tool chain plus three rounds can reach it. Closing it: a per-job limit in the manifest.
- **Recipes: `cancelRuns`** still sets no flag (part 3's gap above) and now covers recipes too. Closing it: a cancelled flag checked before queueing.
- **Recipes: mock mode** has no recording for an AI step (slice 5), so a recipe with an AI step fails there ("The AI step gave no valid output: it was not called"). Closing it: slice 5's AI step recordings.
- **Recipes: `HH_STEP`.** A harness with recipes clears `HH_STEP` in its task and job slots; one without them doesn't (D0), so an outer `HH_STEP` would reach their `ui` server (the same gap as `HH_JOB`). Closing it: clear both in every slot once D0 allows.
- **Recipes: `dailyTokens`** was required with `every` for every job; now only for a job that uses AI (plan Decision 2), and Settings › Jobs still shows the cap field for a no-AI recipe, where it caps nothing. Closing it: hide the field for a job that uses no AI.
- **Recipes: AI steps run only with Claude.** On Codex or OpenCode a recipe with an AI step fails "Could not run the AI step" (the fixed "An AI step runs only with Claude for now" is only logged). Closing it: a step-only sandbox for those engines (Codex's shell off, OpenCode's outside reads denied), then lift the rule.
- **Recipes: Claude's session files.** Each AI round's session is stored by Claude under its own projects folder for the step's temp folder, data included, and isn't removed with the folder (the in-round retry needs the session, so it isn't turned off). Open for Marco.
- **Recipes: the step folder** is under the OS temp folder (`stepParent` not passed); a crash leaves an empty `hh-step-*` folder for the OS to clean.

## Where to look

- `packages/harness-sdk/src/jobs.ts` (`jobSchema`, `jobProblems`, `jobResultSchema`, `hasJobs`, `parseEvery`, `JOB_CANNOT_ASK`, `JOB_NO_NOTE`), `index.ts` (`jobs`).
- `packages/blocks/src/ui-server.ts`, `ui-server-bin.ts` (job mode).
- `packages/shell/src/main/jobs/`: `job-log.ts`, `job-prompt.ts`, `job-runner.ts`, `job-scheduler.ts`, `jobs-host.ts`. Also `board-host.ts` (`hostMode`), `config.ts` (`cleanJobs`), `usage-log.ts` (`jobRecord`, `recentUsage`, `dayTokens`), `notes-index.ts`, `index.ts` (`buildJobsHost`, `buildSingleJobs`, `jobsReady`).
- `packages/ui/src/parallel/` (`Inbox.tsx`, `useJobs.ts`, `JobsTab.tsx`), `client.ts` (`JobSummary`, `JobsInfo`, `JobsClient`), `latest-config.ts`.
- `packages/fake-agent/src/mock-replay.ts`, `mock-claude.ts`; fixtures `parallel-harness`, `jobs-harness`; `packages/e2e/tests/jobs.spec.ts`.
- Recipes: `packages/harness-sdk/src/recipes.ts` (`aiStepSchema`, `whenSchema`, `jobStepSchema`, `STEP_OUTPUT_TOOL`, `MAX_AI_CAP`, `RECIPE_STEPS_MAX`, `aiStepOf`, `postStepIndex`, `jobUsesAi`, `hasRecipes`, `aiOutputSchema`, `recipeProblems`, `recipeSourceProblems`); `packages/shell/src/main/jobs/recipe-runner.ts` (`runRecipe`), `ai-step.ts` (`runAiStep`, `aiStepMessage`, `aiStepParts`, `STEP_END_LINE`), `when.ts` (`whenHolds`), `step-data.ts` (`dataSection`); `jobs-host.ts` (`JobsHostDeps.tools`, the dispatch), `job-scheduler.ts` (`overCap`), `usage-log.ts` (`recipeRecord`); `packages/runtime/src/workspace.ts` (kind `"step"`); `packages/blocks/src/ui-server.ts` (`stepServer`); `packages/ui/src/tools/JobRunSteps.tsx`; `packages/fake-agent/fixtures/recipes-harness`, `packages/e2e/tests/recipes.spec.ts`; tests in `packages/shell/test/jobs-recipes/`.
