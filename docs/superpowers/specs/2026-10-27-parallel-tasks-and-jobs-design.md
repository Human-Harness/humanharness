# Parallel tasks and background jobs — design

Status: draft, 2026-10-27, written after a brainstorming session with Marco. He approved every decision below on 2026-10-26/27, and the file on 2026-10-27 with four fixes from his review (§5.3 crash restore, §8 permission requests and per-job permissions, §4 idle Codex adapters, §10 instructions refresh). Not in the roadmap yet.

This is spec A from the dev-vs-core gap analysis (`docs/discovery/2026-10-26-dev-vs-core.md`, candidates C6 and C7). It builds on scopes and data (`2026-10-25-scopes-and-data-design.md`) and refers to task phases (`2026-10-25-task-phases-design.md`).

## 1. Why

The core runs one task at a time:

- `TaskManager` (`packages/shell/src/main/task-manager.ts`) holds a single `current` task.
- Switching to a task in another scope closes the current one (scopes spec §3.3).
- The runtime (`packages/runtime/src/runtime.ts`) has one transport, one session and a `busy` flag: a second `send` throws "A turn is already running".
- The history snapshots the **whole folder** before and after each turn. A crash restores the whole folder, and "Undo this task" resets every tracked file to the task's start.
- Only the person starts tasks.

Harnesses need more than that:

- **Dev.** Several tickets in flight at once, each with its own agent chain. A Jira sync on start and on demand, run by a light agent.
- **Others (Claude's guess, accepted by Marco as a reason for the core).** A writer drafting two chapters. A teacher preparing material for several courses. A student whose flashcards are prepared after the session closes.

Without a core feature, the dev harness would reimplement the engine layer, the history and the usage log. Every later harness that needs background work would do the same.

## 2. Decisions (approved by Marco)

- **D1. Parallel tasks share the folder.** No copy per task and no merge. The core records which files each task changed, and undo and crash recovery touch only those files. When two tasks change the same file, the core warns. (Dev's code lives in its own repos, outside the core history; see hatches H1/H2.)
- **D2. Any tasks can run at once,** in the same scope or in different ones. Each task gets its own chat.
- **D3. Background jobs** are declared in the manifest. Four triggers: app start, manual, after a task closes, and every N minutes.
- **D4. A cap with a queue.**
  - The harness suggests a cap, and the person changes it in Settings.
  - What goes over the cap waits in a visible queue.
  - Jobs have their own small cap.
  - Periodic jobs have a daily token cap.
- **D5. An inbox in the core, plus a client API.** The shell shows a default inbox. A harness can hide it and draw its own from `client`.
- **D6. Attribution by turn window** (approach 1 of the brainstorm):
  - A file that changed while only one turn was running belongs to that turn's task.
  - When turns overlap, the engine's edit events break the tie.
  - What still cannot be told apart is marked **shared**.
- **D7. Harnesses without `parallel` behave exactly as today.** The default cap is 1.

## 3. Manifest

```ts
parallel: { tasks: 3, jobs: 1 },          // suggested caps on running turns; default { tasks: 1, jobs: 1 }

jobs: {
  "sync-jira": {
    label: { es: "Sincronizar Jira", en: "Sync Jira" },
    prompt: "jobs/sync-jira.md",           // resolved in the harness folder, like an action's prompt
    tier: "light",                         // default "light"
    on: {
      start: true,                         // when the app opens
      manual: true,                        // client.jobs.run and the inbox's "Run now"
      afterTask: ["implement"],            // when a task of these actions closes; `true` = any action
      every: "30m",                        // while the app is open; minimum 15m
    },
    scope: "each",                         // "none": one app-wide run · "each": one run per scope · "trigger": the triggering task's scope
    dailyTokens: 200_000,                  // only for `every` runs; required when `every` is set
  },
},

ui: { inbox: false },                       // optional: hide the core inbox
```

Checks (`loadHarness` / `humanharness check`):
- Job ids follow the action-id pattern and do not clash with action ids.
- `prompt` resolves inside the harness (`resolveInHarness`).
- `every` is a duration of 15m or more, and needs `dailyTokens`.
- `afterTask` names existing actions.
- `scope: "each"` or `"trigger"` only when the harness declares `scopes`. `"trigger"` needs `afterTask` or `manual` and no other trigger: start and periodic runs have no triggering scope.
- `parallel.tasks` and `parallel.jobs` are integers from 1 to 8.

## 4. Sessions: one slot per open task

The runtime is split in two:

| Shared, one per folder | Per open task (`SessionSlot`) |
|---|---|
| Folder, `prepareFolder`, `AGENTS.md` and its refresh | Transport (Claude `-p` process per turn / ACP session) |
| `History` (§5) | Engine session id and profile |
| Data RPC server and its write lock (§8) | Block bridge (one socket per slot, so a block goes to the right task) |
| Harness MCP server specs | The current turn's `AbortController` |

- `createRuntime` returns a `Workspace`, which opens slots with `workspace.openSlot(taskId, session, profile)`. A slot's `send` keeps today's contract: one turn at a time **per slot**, and the `busy` error stays per slot.
- **Claude.** Nothing changes per turn: each turn is already its own `claude -p --resume <session>` process. Slots differ only in session id and flags.
- **Codex.** One `codex-acp` process per slot. Slots never share an adapter, even with the same profile, so one slot's `session/cancel` or crash cannot touch another. See open question 1.
- **Idle Codex adapters.** The cap counts running turns, not open tasks (§7), so many tasks may wait at once. A Codex slot whose task has waited for the person more than 10 minutes closes its adapter process and keeps the session id. The next turn starts a new adapter and resumes with `session/load`. Claude needs nothing: it already runs one process per turn.
- A slot closes when its task ends (note saved, cancelled, engine switch, quit). `endSession` stays per slot.

## 5. History with parallel turns

### 5.1 One queue

Every `save`, `restore` and note commit goes through one queue in `History`. Two commits never interleave. The `Task:`, `Action:` and `Scope:` trailers stay as today, and a job adds `Job: <job id>`.

### 5.2 Turn windows and attribution

Each turn records `before` (the snapshot commit it starts from) and the time window it runs in. When it ends:

1. **Changed paths.** Diff the working tree against `before`, keeping only paths that changed since then. Paths already committed by another turn are dropped, unless their content changed again since that commit.
2. **No overlap.** If no other turn ran during any part of this window, every changed path belongs to this turn.
3. **Overlap.** Paths named by this turn's edit events belong to it:
   - Claude: `Edit`, `Write` and `MultiEdit` `tool_use` inputs with `file_path`;
   - Codex: ACP `tool_call` `locations` and diff content.

   Paths named by another overlapping turn's edit events belong to that turn. The rest are **shared**: they are committed with this turn, with `Shared: <other task ids>` trailers.
4. **Partial commit.** The commit's tree is the queue head's tree plus only this turn's paths (owned and shared). Other tasks' in-flight changes stay in the working tree, uncommitted, until their own turn ends.

The edit events come from the transport as `activity` events. They gain an optional `paths: string[]`, filled by the transport parsers. No new engine calls are made.

### 5.3 What uses attribution

- **Crash recovery.** A turn that ends `agent-crashed` restores only the paths it owns, from the queue head (the latest commit of each path), not from `before`. That drops only what the crashed turn left uncommitted: another task's change to the same path, committed during the window, is kept. Shared paths are left alone and logged.
- **"Undo this task" / "Go back here".** These restore only the task's own paths (owned, plus shared ones after the person confirms). They are refused while a running turn has touched any of those paths; the line says which file. The "this also undoes N later tasks" warning stays, but it counts only later tasks that changed the same paths.
- **`History.tasks()`.** Unchanged grouping. A task's `FileChange[]` comes from its own commits, not from a tree diff between start and end (other tasks' commits now sit in between).
- **Conflict.** When a turn ends and one of its paths was also changed by another task's commit since its `before`, both tasks get a notice: "Las dos tareas cambiaron `spec.md`". There is no merge: the file keeps its last content, and both commits stay in the history.

### 5.4 When `parallel.tasks` is 1

There is never an overlap, so attribution reduces to "every changed path", and partial commits equal full ones. Behavior and commits stay as today. The e2e regression test (§11) checks this.

## 6. Tasks and chats

- `TaskManager` holds `open: Map<taskId, Task>` instead of `current`. The states (`running`, `waiting`, `closing`, `checkpoint`) and the checkpoint at 80% stay per task. Phases (task phases spec) are per task too.
- **Starting a task no longer closes another.** That holds in the same scope or in another one. Closing, "next" and the guided `path` act on the focused task only.
- **Chats are per task:** `.harness/chats/<scope>/<task id>.jsonl`.
  - On first start, the existing `<scope>.jsonl` becomes the chat of that scope's last task.
  - Older history stays readable as an archived chat.
- **Focus.** The window shows one task's chat at a time. `client.tasks.focus(id)` changes it.
- `tasks.json` keeps every open task, with its session, profile, phase and `checkpointTurns`, plus the queue (§7).

## 7. Cap and queue

- **The cap counts running turns,** not open tasks. A task waiting for the person holds an engine session but uses no plan quota, so it takes no slot in the cap.
- **Two caps:**
  - `tasks`: person-facing turns, including quiet ones (checkpoint, phase brief, closing);
  - `jobs`: job turns.

  The manifest suggests both, and the person changes them in Settings › General ("Tareas a la vez", "Jobs a la vez"; 1 to 8).
- **Queue.** A turn over the cap waits in a FIFO queue per cap: a message, a new action, or a quiet turn. Its task shows "En espera". A queued message can be edited or cancelled until it starts.
- **Out of quota.** A turn that ends `out-of-quota` pauses both queues. The inbox says why and when the engine's window resets, if it reported one (`limits` event). The person resumes them by hand, or they resume after the reset.

## 8. Jobs

- **A job run is a task of kind `job`.**
  - It has no chat and no person in the loop.
  - It uses the harness's permissions and gets the same first message as an action: its brief plus the notes index and the loaded data of its scope.
  - Its history commits carry `Job:` and follow §5.
- **It cannot ask.** `choices`, input blocks and `set_phase` proposals answer the agent with an error: "A background job cannot ask the person; end with job_result."
- **It cannot ask for permission either.** An engine permission request (Codex `session/request_permission`, a Claude tool that would need confirmation) is denied by the core at once, with "A background job cannot ask for permission", so the run never hangs.
- **Its own permissions.** A job may declare `permissions` that narrow the harness's (`{ edit: "none" }` for a sync that only writes data). They can only narrow, never widen; `humanharness check` refuses a widening.
- **Core block `job_result`:** `{ status: "ok" | "needs-you" | "failed", summary: string, action?: actionId }`. It ends the run. `needs-you` can name an action for the person to start from the inbox ("2 tickets sin AC → Completar AC"). A run that ends without the block counts as `failed`, with the summary "No result".
- **No closing turn.** A job saves no note and runs no `save_note` turn. Its result is the record (`.harness/jobs.jsonl`: job, scope, trigger, status, summary, tokens, time).
- **Triggers:**
  - `start`: after setup, once per app start.
  - `manual`: `client.jobs.run(id, scope?)` or the inbox.
  - `afterTask`: when a task of those actions saves its note. A task cancelled or ended unfinished does not trigger it.
  - `every`: a main-process timer while the app is open, first run one interval after start.
- **Dedupe.** A job and scope already queued or running is not queued again. The trigger is logged as skipped.
- **Daily cap.** `every` runs stop for the day once that job's tokens in `jobs.jsonl` reach `dailyTokens`. Manual and other triggered runs still work. The inbox says "Pausado hasta mañana". The person can change the cap or turn the job off in Settings › Jobs.
- **Data writes.** Collections already go through one data RPC server. It gains a lock per collection, so writes from parallel tasks and jobs happen one at a time, each still checked against the schema and the harness's rules. The last write wins.

## 9. Inbox and client

### 9.1 Client

```ts
client.tasks.list(): TaskSummary[]
client.tasks.onChange(cb): Unsubscribe
client.tasks.focus(id): void
client.jobs.list(): JobSummary[]          // each job × scope: last run, status, summary, next run, paused
client.jobs.run(id, scope?): void
client.jobs.onChange(cb): Unsubscribe

type TaskSummary = {
  id: string; scope: string; action: string | null; label: string;
  state: "running" | "waiting" | "queued" | "closing" | "checkpoint";
  waitingFor?: "message" | "answer" | "phase";   // message: the agent finished its turn · answer: an open choices/input block · phase: a phase proposal
  phase?: string; startedAt: string; tokens: number;
  conflict?: string[];                            // paths shared with another task (§5.3)
};
```

### 9.2 The core inbox

- A panel in the shell, opened from a toolbar button with a count of what is waiting for the person. Four sections:
  - "Esperando por vos": `waiting`, newest first;
  - "Trabajando": running, closing and checkpoint;
  - "En espera": queued;
  - "Jobs": last result per job and scope, "Run now" for manual jobs, and why a job is paused.
- A row opens its task (`focus`), or for a `needs-you` result starts the named action.
- `ui.inbox: false` hides the panel and the button. The client API stays, so the harness draws its own (dev's "Pendiente" panel).
- The Dock badge shows the count waiting for the person, in both cases.

## 10. Edge cases

- **Engine switch.** Every open task ends unfinished, both queues are emptied, and running jobs are cancelled. The notes stay, as today.
- **Moving the folder.**
  - Both queues pause, and the move waits for the running turns.
  - Each waiting task without a fresh note gets its checkpoint turn, one at a time (today: only the current task).
  - Then every open task is marked `resume`.
- **Quit.** Running turns and jobs are cancelled. At the next start every task left open ends unfinished (as today), the queues are dropped, and `start` jobs run again.
- **Usage.** Each `usage.jsonl` line gains `kind: "task" | "job"` and `job` when it is one. Settings › Uso shows tasks and jobs apart.
- **Instructions refresh.** `AGENTS.md` changes only when no turn is running in any slot, so no running session sees its cached prefix change mid-turn. While a rewrite is pending, both queues hold new turns for up to 10 s so the running ones can finish and the rewrite can happen; after 10 s they start anyway and the rewrite waits for the next gap.

## 11. Tests

- **Unit:**
  - attribution: no overlap; overlap resolved by edit events; shared paths; a path changed again after another task's commit;
  - partial commits; crash and undo restoring only the task's paths; refusal while a running turn touched them;
  - the queue and both caps; dedupe; the daily cap; `out-of-quota` pause;
  - `TaskManager` with N open tasks; per-task chats and the migration;
  - manifest checks for `jobs` and `parallel`.
- **Fake agent:** recorded scenarios for two overlapping tasks (different files, then the same file), a job ending `needs-you`, a job that tries to ask, and a job that ends without `job_result`.
- **E2e:**
  - two tasks in parallel with the inbox;
  - undo one without touching the other;
  - a `start` job;
  - a harness with `parallel` at 1 behaving as today (regression).

## 12. What this closes from the gap analysis

| Gap | How |
|---|---|
| C7 Several tasks at once + "waiting for you" across tasks | Slots (§4), attribution (§5), per-task chats (§6), the inbox (§9) |
| C6 Background agent jobs | `jobs` (§3, §8) |
| Dev: Jira sync on start and by hand, with a light model | A job with `start` + `manual`, `tier: "light"`, writing the tickets collection |
| H4 (dropped) | Not needed: the core runs the sessions |

## 13. Delivery slices

1. **Slots.** Split the runtime into `Workspace` + `SessionSlot`, with one slot only. No behavior change.
2. **History queue and attribution.** Turn windows, edit-event paths in the transports, partial commits, restore by paths. Still one slot.
3. **Parallel tasks.** `TaskManager` with N open tasks, per-task chats with migration, the `tasks` cap and its queue, the client `tasks` API.
4. **Inbox.** The core panel, the Dock badge, `ui.inbox`, conflict notices.
5. **Jobs.** Manifest and checks, the `job_result` block, triggers, the `jobs` cap, dedupe, the daily cap, `jobs.jsonl`, Settings › Jobs.
6. **Mock and fake agent.** Parallel and job scenarios; the authoring guide and `HARNESS.md` template mention `parallel` and `jobs`.

## 14. Open questions

1. **One Codex adapter per slot.** It is the safest option, but each process costs memory and start time. To measure in the slot slice; idle adapters close after 10 minutes (§4), and sharing an adapter per profile would be a later optimization.
2. **OS notifications.** Decided (Marco, 2026-10-27): off by default, a setting in Settings › General.
3. **A job's own permissions.** Decided (Marco, 2026-10-27): an override per job that can only narrow (§8).
