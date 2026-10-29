# Background jobs

A harness may declare `jobs`: work that runs with no chat and no person in the loop. A sync of tickets, a check after a task, a digest every few hours. A job is `prompt` (a brief the agent runs) or, from slice 4 of the tools spec, `steps` (a recipe: tool steps, and an AI step only when a condition holds, `docs/superpowers/specs/2026-10-28-tools-and-recipes-design.md` §7). Today every job is `prompt`: each run gets its own engine session on a job slot, ends with a `job_result` block and is logged in `.harness/jobs.jsonl`. A run that needs the person raises an item that starts one of the harness's actions. Spec: `docs/superpowers/specs/2026-10-27-parallel-tasks-and-jobs-design.md` §3, §8, §9, §10 (slices 5 and 6). Slots are in `turn.md`, the gate and the inbox in `parallel.md`, the trailers in `history.md`.

## The manifest

```ts
jobs: {
  sync: { label: "Sync tickets", prompt: "./jobs/sync.md", on: { start: true, manual: true }, permissions: { edit: "none" } },
  review: { label: "Review the note", prompt: "./jobs/review.md", on: { afterTask: ["write"] }, scope: "trigger" },
  digest: { label: "Digest", prompt: "./jobs/digest.md", on: { every: "2h" }, dailyTokens: 50_000 },
},
```

`jobSchema` and `jobProblems` (`packages/harness-sdk/src/jobs.ts`). Strict: a typo is refused.

- `label`: 1 to 80 characters, one English string. `prompt`: the brief, a file in the harness folder (`loadHarness` refuses one outside it; `check` says `brief-missing` when it doesn't exist or is empty).
- `tier`: `light` (the default), `standard` or `deep`.
- `on`: at least one of `start`, `manual`, `afterTask` (`true`, or a list of action ids) and `every` (`"30m"`, `"2h"`; at least 15 minutes, `EVERY_MIN_MS`).
- `scope`: `none` (the default, app-wide), `each` (once per active scope) or `trigger` (the scope of the task or the "Run now" that fired it; needs `afterTask` or `manual`, and no `start` or `every`). A scope other than `none` needs the harness's `scopes`.
- `dailyTokens`: required with `every`. Without `every` it caps nothing: `check` warns (`job-daily-tokens`).
- `permissions`: `edit`, `exec`, `web`. They can only narrow the harness's (J2); a widening is refused at load.
- A job id has the action id shape and can't be an action's id.

`hasJobs(h)` is false for an absent or empty `jobs`: no part-3 code runs (D0, below). `isConcurrent` is `parallel || jobs`.

## Host modes

`hostMode(harness)` (`board-host.ts`):

- `board`: the harness declares `parallel` (with or without jobs). Jobs run beside the lanes, on the board's gate and workspace.
- `single`: jobs without `parallel` (Decision 12). The person's side is today's single task: one `TaskManager`, one `TurnController`, no inbox, no task strip. Only the runtime changes: a workspace (`createWorkspace`) with a `"main"` slot for the task (`openSingleRuntime`, in `HarnessRuntime`'s shape) and the job slots beside it. A `TurnGate` with `tasks: 1` keeps one task turn at a time (`singleGate`, `singleTurns`); the jobs' cap is 1 unless config.json's `parallel.jobs` says otherwise (there is no control for it in this mode).
- `plain`: neither. Today's app.

The jobs' wiring is `createJobsHost` (`packages/shell/src/main/jobs/jobs-host.ts`), built in `index.ts` only when `hasJobs(harness)`.

## A run's life

`runJob` (`jobs/job-runner.ts`), called by the scheduler through the jobs host:

1. **Base.** The host reads the current base (the folder, or the profile's folder). None: the app isn't set up, the run is skipped.
2. **Gate.** The run waits in the gate's `jobs` queue (key `job:<run id>`, the run id a `randomUUID()`). An abort while queued drops it: nothing is logged. Once let in, `stillValid` checks the base is still the same; after a profile or folder switch the run is dropped, never run in the new one.
3. **Slot.** `workspace.openSlot({ key: "job:<run>", kind: "job", permissions })`. A job slot's `ui` server runs with `HH_JOB=1` (only exactly `"1"` turns job mode on), and its permissions go through `narrowPermissions`. With `exec: false`, Bash is in Claude's `--disallowedTools`. With jobs declared, a task slot's `ui` server gets `HH_JOB=""`, so an `HH_JOB` in the app's own environment (which the engine passes on to its MCP servers) can't make it a job.
4. **First message** (`jobFirstMessage`, `jobs/job-prompt.ts`): the brief (hidden characters stripped, cut at 20,000 characters), then the same context an action's first message carries for that scope (the notes index, `notesIndexFor` in `notes-index.ts`; the data asked with no action; the material), then how to end: "This is a background job: nobody reads this conversation and nobody can answer. Don't ask anything.", call `job_result` once, and the actions a needs-you result may name. A context part that fails to load is logged and left out. An app-wide run reads the app scope (with scopes) or `main` (without).
5. **The turn.** One send on the slot. Its model follows the job's tier (`profileFor`), unless the person set Settings › Models' free-questions row: then that row's. Its commits carry `Task: <run>`, `Job: <job id>` and, when scoped, `Scope:`. Each `usage` event becomes a usage line (below). An `out-of-quota` end pauses the gate as a task turn does.
6. **`job_result`.** Only the run's own slot is listened to. The first valid result stands; a later or malformed one is logged and ignored. The summary is put on one line (controls as spaces, hidden characters gone) and cut at 300 code points; empty becomes "No summary". `action` is kept only for `needs-you` and only when `Object.hasOwn(harness.actions, action)` (J3); otherwise it is dropped and logged.
7. **End.** The slot always closes and the gate's slot is always freed. The record goes to `jobs.jsonl` with its tokens (input + output + cache writes, `capTokens`).

How a run ends:

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

**Harness tools** (`docs/architecture/tools.md`, tools Decision 9): in a harness with an `agent: "call"` tool, a job slot gets the core `tools` MCP server as a task slot does (a `prompt` job's agent may call tools; nothing assumes a job is an AI run). A call from a job slot belongs to the run (`runOf(key)`: `{ id: <run>, scope, job, trailer }`, the trailer being `jobRunTrailer(run, job, scope)`, the run's own history trailer): it traces `caller: "agent"`, `job: <job id>`, `run: <run id>`, in the run's scope, and a tool's data write commits under the run's trailer plus `Tool: <id>`. Each run's calls go to `.harness/trace/jobs/<run-id>.jsonl`, whatever the job runs, and `client.tools.trace(runId)` returns them. The inbox doesn't show them yet: job inbox lines come with slice 4 (tools Decision 11).

## Triggers

`JobScheduler` (`jobs/job-scheduler.ts`):

- **`start`**: once per app start, after setup (Decision 7). `jobsReady` in `index.ts` calls `appReady()` after the window opens, after a save that sets the app up, and after arriving in a profile; only the first call does anything. It waits for the scopes to settle first, so `each` runs in the scopes as they are.
- **`manual`**: "Run now" (`client.jobs.run`). Only a declared manual job, not off, in an existing scope (J4). A scope-`trigger` job needs a scope; a scope-`none` job takes none; a scope-`each` job given a scope runs in it alone.
- **`afterTask`**: `TaskManager`'s optional `taskClosed` dep, called when a task ends `done` with its note written (Decision 6). A task cancelled or ended unfinished fires nothing. A throw is logged.
- **`every`**: a one-shot main-process timer, armed at `appReady`. The first run is one interval after the start; each next one, one interval after the timer fires. A wait longer than `setTimeout` allows is armed in steps (`TIMER_MAX_MS`).

**Scopes.** A scope-`each` job runs in every active scope whatever fired it; only a Run now given a scope narrows it to that one. A scope-`trigger` job runs in the closed task's scope or the Run now's.

**Dedupe.** One run per job and scope at a time (`dedupeKey`: `<job>:<scope>`, `-` for app-wide). A trigger while one is queued or running is skipped and logged.

**The daily cap** (J5). An `every` fire is skipped when the job's tokens today reach its cap: today's runs of that job (every trigger, manual too), by the local day of `startedAt` (Decision 9). The cap is the person's `dailyTokens` in Settings › Jobs, else the manifest's. Only `every` checks it. The Jobs section then says "Paused until tomorrow".

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

`humanharness dev --mock` answers a job's turn with a canned `job_result` `{ status: "ok", summary: "Mock run" }` (`MOCK_JOB_RESULT`, Decision 10). A turn is a job's when the slot's `ui` server carries `HH_JOB=1` (only job slots do) and `isMockJobTurn` (`packages/fake-agent/src/mock-replay.ts`) finds a prompt line that starts with `MOCK_JOB_MARK`, the first line of the first message's "how to end" part; the brief comes before it. A task's prompt with that line plays its recording as any other. `mock-claude` saves no session state for a job turn, so it never moves a task's recording on. Tests that need other results use fake-claude scripts: `packages/fake-agent/fixtures/parallel-harness` (board mode) and `fixtures/jobs-harness` (single mode, id `jobs`) declare jobs whose scripted turns answer ok, needs-you naming an action, a refused ask and no result (`packages/e2e/tests/jobs.spec.ts`).

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

## Where to look

- `packages/harness-sdk/src/jobs.ts` (`jobSchema`, `jobProblems`, `jobResultSchema`, `hasJobs`, `parseEvery`, `JOB_CANNOT_ASK`, `JOB_NO_NOTE`), `index.ts` (`jobs`).
- `packages/blocks/src/ui-server.ts`, `ui-server-bin.ts` (job mode).
- `packages/shell/src/main/jobs/`: `job-log.ts`, `job-prompt.ts`, `job-runner.ts`, `job-scheduler.ts`, `jobs-host.ts`. Also `board-host.ts` (`hostMode`), `config.ts` (`cleanJobs`), `usage-log.ts` (`jobRecord`, `recentUsage`, `dayTokens`), `notes-index.ts`, `index.ts` (`buildJobsHost`, `buildSingleJobs`, `jobsReady`).
- `packages/ui/src/parallel/` (`Inbox.tsx`, `useJobs.ts`, `JobsTab.tsx`), `client.ts` (`JobSummary`, `JobsInfo`, `JobsClient`), `latest-config.ts`.
- `packages/fake-agent/src/mock-replay.ts`, `mock-claude.ts`; fixtures `parallel-harness`, `jobs-harness`; `packages/e2e/tests/jobs.spec.ts`.
