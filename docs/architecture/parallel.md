# Parallel tasks

A harness that declares `parallel` lets the person keep several tasks open at once, each with its own chat and engine session. Up to the cap of them run turns at the same time; the rest wait in a visible queue. A core inbox shows what waits for the person, and undo touches only a task's own files. Spec: `docs/superpowers/specs/2026-10-27-parallel-tasks-and-jobs-design.md` §5.3, §6, §7, §9, §10 (slices 3 and 4). The history side (turn windows, attribution, restore by paths) is in `history.md`, "Parallel turns"; slots are in `turn.md`. Background jobs (part 3) run on the same gate under the `jobs` cap and fill the inbox's Jobs section: `jobs.md`.

## Board or plain

The shell picks a mode once, when it loads the harness: `hostMode(harness)` (`packages/shell/src/main/board-host.ts`) is `"board"` when the manifest declares `parallel`, `"single"` when it declares `jobs` without `parallel` (today's single task with job slots beside it, `jobs.md`), otherwise `"plain"`.

- **Plain** is the app as it was: `createRuntime`, one `TaskManager`, one `TurnController`. No part-2 code runs.
- **Board** builds one `HarnessWorkspace`, a `TaskBoard` (`task-board.ts`), a `TurnGate` (`turn-gate.ts`) and one lane per open task. `index.ts` branches on `host` (null in plain mode) where it builds the runtime, the turns and the tasks, and in the handlers whose board behaviour differs:
  - the runtime's life: `closeRuntime`, `dropRuntime`, `openHistory` (the shared workspace's history), `flushTurns`, `interruptTasks`, and the host built at startup (`buildBoardHost`, only when `hostMode(harness) === "board"`) and closed at quit (`closeAll`);
  - between tasks: `betweenTasks` and the plugins' `takeRuntimeStale` (Decision 13), and `refreshInstructions` for the settings and the plugins (held for a gap, spec §10);
  - IPC: `hh:saveConfig` (the caps, `capsChanged`), `hh:loadChat` (the focused task's chat and live turn), `startBlocked`, `hh:restoreTask` (undo by paths) and the `hh:tasks*` channels (refused in plain mode);
  - the folder move: the checkpoint (`checkpointAllBeforeMove`), the turns' flush and `moveEnded`;
  - attention: `sharedAttention` and the plugins' `attentionStoreFor`/`registerKnown`, the task attention (`buildTaskAttention`);
  - the history of the app's own changes: a note, a person's data write, Sidekick's learning and decision note, and a material change go through `saveAppChange` (`app-change.ts`), which in board mode commits only their own files (see Undo).
- `parallel: { tasks: 1 }` still uses the board: several tasks stay open, one turn runs at a time, so turns never overlap and every commit equals the plain app's (spec §5.4). A harness that wants today's app declares nothing.

**D0.** A harness without `parallel` is byte for byte today's app:

| What stays as before | Pinned by |
|---|---|
| Mode is plain | `packages/shell/test/board-host.test.ts`: `hostMode({})` is `"plain"`; `packages/harness-sdk/test/parallel.test.ts`: a manifest without `parallel` parses as before and `isConcurrent` is false |
| tasks.json: no `lanes`, `focus`, `tokens`, `conflict` | `task-store.test.ts`: a file without `lanes` round-trips to the same bytes |
| Chats: `chats/<scope>.jsonl`, no migration | `chat-log.test.ts` (no task → today's path), `chat-migration.test.ts`, `board-host.test.ts` |
| `AppState` has no `parallel` field | `packages/shell/test/parallel-config.test.ts`: `parallelInfo` is undefined without `parallel` (`index.ts` adds the field only when defined) |
| No inbox button, no task strip, ChatView key unchanged | `packages/ui/test/inbox.test.tsx`, `packages/ui/test/parallel-chat.test.tsx` |
| The Dock badge is never set | `task-attention.test.ts` |
| config.json gets `parallel`/`notifyWaiting` only when the person sets them; Settings shows the section only in board mode | `config.test.ts`, `packages/ui/test/settings.test.tsx` |
| Commits and prompts | `packages/runtime/test/runtime-d0.test.ts`, the e2e golden in `packages/e2e/tests/history.spec.ts` |

`client.tasks` exists in every app, but main refuses every call in plain mode ("No parallel tasks") and never sends `hh:tasksChange`. The UI gates everything on `state.parallel`.

## Lanes

A lane is today's single-task machinery, reused unchanged: a `TaskManager`, its own `TurnController`, a `SessionSlot` keyed by the task id, and a `LaneStore` (`lane-store.ts`). Lane key = task id = slot key; the board chooses the id (`newId`, which must pass `isLaneId`: lowercase `^[a-z0-9][a-z0-9_-]{0,199}$`, and not be open).

- **`LaneStore`** shows the lane's `TaskManager` a `TasksFile` whose `current` is that lane's task. On save it writes the change back into the real file's `lanes[]`, with a three-way merge of the shared fields (`actions`, `scopes`, `open`, `engine`): it keeps the views it loaded since its last save (at most 64), and a field counts as its own change only if it differs from all of them. A lane never writes another lane's task ("Lane a can't save task b"), and an ended lane stays ended.
- **One write chain per tasks.json**: `withTasksFile` serializes every load-merge-save by the file's resolved path. The lanes, the board's `focus`, the engine change's `TaskStore.forgetEngine` all go through it.
- **The idle lane** is the start view: a lane with no task whose `TaskManager` is pre-seeded with the id the next task will get. A new task (`start`, `ask`, `startPrepared`) runs in it; it becomes an open, focused lane. Starting never closes another lane. Only the lane-making step is serialized, so two quick starts get two lanes. A start that leaves no task (refused, failed early) drops the lane and gives the focus back.
- **Successors.** The guided path's next action, a follow-up option naming another action, a mode switch below the tier floor, or an ask in another scope never restarts inside a lane: `TaskDeps.successor` (board mode only) hands the next task to `board.handOver`, which starts it in a fresh focused lane; the closed lane leaves the board.
- **At most 32 open tasks** (`LANES_MAX`): one more is refused, "Too many open tasks".
- tasks.json keeps `lanes[]` (each a `CurrentTask` plus `tokens` and `conflict`) and `focus` (a lane id, or null for the start view). `cleanLanes` only cleans (dedupe, shapes); `interruptedLanes` ends them. An older app saving a new tasks.json drops `lanes` and `focus` (PR decision).

## Focus and events

- The window talks to the **focused** lane: the board forwards each per-task call (`ask`, `choose`, `finish`, `cancel`, phases, time box, `view`) to it, or to the idle lane at the start view. A lane without a method answers "This task can't X".
- `board.focus(id)` takes only an open lane's id (`isLaneId`, then `Map.get`; threat model P1). `hh:tasksFocus` checks the id is a string of 1 to 200 characters first (`tasks-ipc.ts`). `focus(null)` is the start view.
- Only the focused lane's events reach the window (`laneEmit`). Every lane's events also go to a `LiveBuffer` (`live-buffer.ts`): from its last user line to its `done`, at most 2,000 events and about 2 M characters, oldest dropped, consecutive text deltas merged, `edits` stripped (`forWindow`) before they are kept.
- **Replay.** `hh:loadChat` in board mode loads the focused task's chat file and, when its turn is still running, `ChatLoad.live` (read last, after every await). The window dispatches the `resume` action and replays the buffered events. A user line not yet written to the file comes from the buffer.
- The window remounts the chat (ChatView key `${engineId}:${profile}:${openScope}:${epoch}`, `useFocusEpoch`) when main's pushed state focuses another listed task, or after its own `focus(null)` resolves. A message put back from a cancelled queued turn survives that remount once (`draftKeep`); nothing else carries from one task's box to another's.
- **The task strip** (`TaskStrip.tsx`) over the chat names the focused task, its phase and a "New task" button.
- **Data requests** (P3): `data(request, slot)` attributes a write to the host's `runningTaskOf(slot.key)` (that lane's `manager.runningTask()`), the lane whose socket asked; never a task id from the request.

**Sidekick hears only the focused task.** Each lane's `turnStarting`, `turnEnded` and `phaseMoved` reach Sidekick only while that lane is focused:

- a turn that starts in the background is not heard, start or end;
- a turn that started focused and ends in the background is not heard at its end either: no after-reply card, no note-context heads-up for that turn (PR decision);
- a phase move of a background lane (an `auto` move) isn't heard then; the lane keeps its latest unheard move, and the process guard hears it once when that lane is next focused (the board's change hook). Earlier unheard moves of that lane are not replayed.

## The gate and its queue

Every turn of a lane, quiet ones included (checkpoint, phase brief, closing), goes through `gatedTurns(lane, gate, controller)` (`gated-turns.ts`):

- A free slot starts the turn with no await (`tryAcquire`), so at cap 1 a turn starts exactly when the plain app starts it. Otherwise it waits in its cap's FIFO queue, and the lane's summary says `queued`. The slot is freed once, however the turn ends.
- A second send while a lane's turn waits or runs is refused: "A turn is already running".
- **Cancel** (`client.tasks.cancelQueued(id)`, `gate.drop`) takes a queued turn out and returns its text. The turn ends with a cancelled `done`, as Stop does, so that task ends unfinished (PR decision). The inbox puts the text back in the box only when the cancelled task is the focused one (Decision 7: "edit" = cancel and refill). A dropped turn writes nothing to the chat.
- **Caps** (`parallel-config.ts`): `effectiveCaps(suggested, person, hold)` = the person's caps (whole numbers clamped to 1..8) where set, else the manifest's. The board recomputes them when Settings changes them (`host.capsChanged` → `gate.setCaps`) and on an engine switch.
- **Engine hold.** `engineHold(engineId)` is an allowlist: only `claude` (spike PT-S1) and `codex` (PT-S3) are checked to run two sessions at once. Any other engine, OpenCode included (PT-S5 couldn't run), gets `singleSession`: caps forced to `{ tasks: 1, jobs: 1 }`, tasks and jobs counted together in arrival order, and before each turn the gate's `beforeStart` puts every other lane's engine process to sleep. A failed sleep fails the turn ("Couldn't get ready for this turn"), never risking two processes (PR decision).
- **Out of quota.** A turn that ends `out-of-quota` pauses both queues until the reset the engine reported: the latest among full windows (utilization 1), else the most used window's. With no reset (Codex and OpenCode report no limit windows), a reset already past, or one too far for a timer, the queues wait for the person's **Resume** (inbox, `client.tasks.resumeQueues()`). Resume lifts only an out-of-quota pause.
- **Folder-move pause.** A folder move pauses the queues after its checkpoints (below); the inbox says "Paused while the folder moves", with no Resume. An out-of-quota pause is never replaced by it, and the move's end never lifts an out-of-quota pause.
- **AGENTS.md refresh** (spec §10): the workspace refuses to rewrite instructions while any turn runs. Board mode's `betweenTasks` then holds new turns for up to 10 s (`gate.hold`) while it waits for a gap and tries again; past that, the change stays pending for the next gap.

## Settings › General

A "Parallel tasks" section (`SettingsSheet.tsx`, `ParallelSection`) shows only in board mode:

- "Tasks at once" and "Jobs at once", 1 to 8. A cap saves `{ ...config.parallel, [key]: n }`, so a cap the person never set keeps following the manifest (PR decision). Main keeps only whole numbers 1..8 (`cleanCaps`); a bad entry is dropped, never a reason to refuse the save. A hand-edited `tasks: 12` is valid and clamped.
- On a held engine both selects are disabled with "One at a time: running more at once is not yet checked with {engine}." (`heldReason: "engine"`).
- "Notify me when a task waits" (`notifyWaiting`, off by default).

`AppState.parallel` (`ParallelInfo`): the caps in force, the manifest's suggested caps, `inbox`, `notifyWaiting` and `heldReason`.

## Per-task chats

- A task's chat is `.harness/chats/<scope>/<task id>.jsonl` (`taskChatFile`, `ChatLog`'s optional fourth argument). The scope folder is checked by real path, appends use `O_NOFOLLOW`. A scope named `archive` is reserved. The start view has no chat.
- **Migration** (`chat-migration.ts`, Decision 8), once per folder, at the first board start, before any lane writes (`host.interrupt`): each `chats/<scope>.jsonl` is copied (atomically) to the file of the first open task of that scope (tasks.json's `current` first, then the lanes in file order), then archived by rename to `chats/archive/`. A file is archived only after its copy succeeded; a task chat that already has lines of its own is kept as it is and the scope chat only archived (`kept`, logged). A scope chat that is a link or a hard link is never read, only archived. A `.per-task` marker, written last, makes it run once; every step can be repeated after a crash.
- Archived chats have no viewer: they stay readable JSONL files.
- An engine change archives the per-task chats too (`ChatLog.taskChatsIn`).

## Conflict notices and tokens

- An overlapped turn's attribution (`onAttribution`, `history.md`, "Conflicts") names paths another task also changed: paths this turn committed or surely wrote (an edit that ended without an error), compared in NFC. Both tasks get a **notice** in their chat naming the other task ("This task and “{task}” both changed {path}."), at most 5 paths then "and N more"; when the other task has ended, only this one gets "A task that has ended also changed {path}.".
- A notice is stored as a structured system line: an assistant entry with empty text and `notice: { kind: "conflict", paths, more?, other?, ended? }` (`ChatNotice`, the runtime's `TaskNotice`). The window draws it as a system line in the person's language (`Message.tsx`, `parallel.conflict*`); it never counts as the last answer, so a waiting task's choices stay answerable. An older app shows nothing for it.
- **Live.** Board mode also sends the notice to the window as a runtime event, `{ type: "task-notice", notice }` (only the app sends it, never a transport; plain mode never gets one). It goes through `laneEmit`, so the focused task shows it at once and the live buffer keeps it for a later focus. The window's reducer (`state.ts`) keeps a notice that comes during a turn and adds it after that turn's answer, as the saved chat has it; with no turn on screen (the focused task waits) it goes on screen at once. The chat file gets it after the running turn's entries, or at once when the task is idle.
- Each task keeps `conflict` (the paths, newest last, at most 20); the inbox shows a chip.
- **Tokens.** Each send adds its own usage (input + output, never cache) to the lane's `tokens` once, at its end (`LaneStore.amend`).
- A lane whose engine couldn't `session/load` its earlier conversation (PT-S4) gets a live `task-notice` of kind `resume-failed`, drawn as the system line "Couldn't resume the earlier conversation; started a new one." (`parallel.resumeFailed`). It is not written to the chat, so it doesn't come back on the next load.

## The inbox

- **`client.tasks`** (`TasksClient`, preload channels `hh:tasksList`, `hh:tasksFocus`, `hh:tasksCancelQueued`, `hh:tasksResume`, push `hh:tasksChange`): `list()` answers `TasksState` (`tasks: TaskSummary[]`, oldest first; `paused?`; `caps`), `onChange`, `focus(id | null)`, `cancelQueued(id)`, `resumeQueues()`. A `TaskSummary` carries the id, scope, action, label (the action's label or the first 60 characters of the question, as the history names it), state (`running`, `waiting`, `queued`, `closing`, `checkpoint`), `waitingFor` (`message`, `answer`, `phase`), phase, `startedAt`, tokens, conflict and `focused`. Nothing else of the task leaves main.
- **The core inbox** (`packages/ui/src/parallel/Inbox.tsx`, `useTasks.ts`): a button in the chat's top bar, "Inbox" with a count badge (its label for screen readers: "Inbox, N waiting"), that opens a popover with the pause line ("Out of quota until 3:00 PM", with the weekday when the reset is not today, and Resume when out of quota), then the sections Waiting for you, Working, Queued (each row with Cancel) and Jobs (each job × scope, `jobs.md`; "No jobs" without them), and "New task" (the start view). A row focuses its task; a queued row's Cancel is described by the row's label (`aria-describedby`). A polite live region announces "N waiting for you" when the count changes. It shows on the work screen, not on Home.
- **`inbox: false`** (a top-level manifest key, since `ui` is already the custom-UI path) hides the core inbox and its button. `client.tasks` stays, for a harness that draws its own panel.
- **Attention items** (`task-attention.ts`, Decision 10): a task entering `waiting` raises `{ kind: "task", id }` with key `waiting`, severity `action`, its label as the title and target `{ panel: "task", focus: id }`, in the base's shared `AttentionStore` (`attention-stores.ts`, the plugins' store, HMAC-tagged; `known` for a task origin = an open lane). Leaving `waiting` or the open tasks resolves it. `TaskAttention` counts a task as raised only once the store took the item, so a failed raise (or a missing store) is tried again at the next update, and so is a failed resolve; a badge call that throws is logged. The task inbox reads `client.tasks`, never the items' `read` flag; in board mode the plugins inbox's "mark all read" marks only plugin origins.
- **Dock badge**: the waiting count plus the plugins' count and the jobs' needs-you count (`app.dock.setBadge`), set on change only. Board mode, and single mode for the plugins and jobs (`jobs.md`); never in plain mode.
- **Notification** (`notifyWaiting`, off by default): when a task starts waiting and the window isn't focused, an OS notification with the task's label and "Waiting for you"; its click shows the window and focuses that task. Main keeps a reference to each notification until it is clicked or closed, so its click isn't lost to garbage collection. Badge and notification carry a count and a label only, never chat content (P4).

## Undo

In board mode "Undo this task" restores the task's own paths only, never another task's changes: its confirm is for the task alone, and a refusal shows in the History panel with the reason and the file. "Go back here" is refused while any task is busy. See `history.md`, "Undo in board mode".

The commits that aren't a turn's never take another task's work either. In plain mode a note, a data write or a material change commits the whole folder, as it always did (D0). In board mode another task's turn may be writing the folder at that moment, and a whole-folder commit under this task's trailer would make that work this task's, so undoing this task would delete it. So board mode commits only the change's own files (`saveAppChange`, `packages/shell/src/main/app-change.ts`):
- a task's checkpoint or closing note: the note file (the lane's `writeNote`/`saveHistory`, `BoardHostDeps.saveOwn`);
- the person's data write (`Data: <collection>`) and Sidekick's learning: the collection's file (`dataPath`);
- Sidekick's "Save as decision": its note file;
- a material change: that scope's originals (`material/<scope>/`) and records (`.harness/material/<scope>/`).

The person's own edits made between turns are no longer swept into these commits; the next turn's "Before message" takes them, as for any edit outside a turn.

An answer to an input block is marked in the task's own chat file (`chats/<scope>/<task>.jsonl`). That rewrite runs one at a time with the conflict notices appended to the same file.

## Edge cases

- **Scope switch** never closes a lane (Decision 5): it sets `open` and focuses that scope's newest open task, or the start view. An ask in another scope starts a new lane; the focused one stays open.
- **Folder move** (Decision 15): `checkpointAllBeforeMove` runs each lane's checkpoint turn one at a time, then pauses the queues; the move's end lifts only its own pause. If the queues were already paused (out of quota), no checkpoint runs (logged) and the tasks resume from the notes there are. Then every lane is marked `resume`.
- **Engine switch, engine update, folder change** (Decision 14, `host.dropAll`): every lane ends unfinished, both queues empty, the workspace closes; on a new engine the caps and hold become its own and the old pause goes.
- **Profile switch**: the focused task closes as in the plain app; arriving in a profile ends every task left open there, unfinished.
- **Quit** (Decision 16, `closeAll`): every lane's turn is cancelled and its slot closed; replies still being written are flushed. tasks.json stays; the next start (`host.interrupt`) migrates the chats if needed, then ends every lane left open, unfinished.
- **Idle sleep** (spec §4): after 10 minutes waiting, a lane's ACP adapter process goes (`slot.sleep()`; about 0.3 GB each with Codex); its next turn waits for the sleep in flight, then reconnects with `session/load`. Claude has nothing to sleep.
- **Plugin catalogue change** (Decision 13): the workspace closes at once when no task is open, else once none is; until then the old catalogue stays (logged).

## Known gaps

- The window can't ask for the shared paths of an undo: `client.restoreTask(id)` sends the id only, so board mode always undoes the task's own paths and leaves its shared ones (open question 5's "Undo only mine" confirm isn't built).
- OpenCode is held at one session until a spike with OpenCode installed shows two `opencode acp` processes work (PT-S5; spec open question 1).
- Archived chats have no viewer. A scope chat plain mode writes after the migration marker (drop `parallel`, then add it back) is never migrated.
- A lane's turns write the chat of the open scope, while loading and notices use the task's own scope: they disagree for a `scope: "none"` action, or after a scope switch while the lane is open.
- Sidekick: of a background lane's phase moves only the latest reaches the process guard, and only once the lane is focused; Sidekick's after-reply cards of one task stay on screen after the focus moves to another (pre-existing).
- A focused task that ends leaves its chat on screen while main is at the start view. (A successor takes the chat on screen as in the plain app: a next topic chosen from a choice replaces it, `parallel.spec.ts`.)
- The resume-failed notice is live only: it isn't saved in the task's chat.

## Where to look

- `packages/harness-sdk/src/parallel.ts` (`parallelSchema`, `isConcurrent`, `parallelCaps`), `index.ts` (`parallel`, `inbox`).
- `packages/shell/src/main/`: `board-host.ts`, `task-board.ts`, `lane-store.ts`, `turn-gate.ts`, `gated-turns.ts`, `parallel-config.ts`, `live-buffer.ts`, `chat-migration.ts`, `restore-paths.ts`, `tasks-ipc.ts`, `attention-stores.ts`, `task-attention.ts`, `task-store.ts` (`lanes`, `focus`, `cleanLanes`, `interruptedLanes`).
- `packages/ui/src/parallel/` (`Inbox.tsx`, `TaskStrip.tsx`, `useTasks.ts`), `packages/protocol/src/views.ts` (`TaskSummary`, `TasksState`, `ParallelInfo`) and `client.ts` (`TasksClient`), `SettingsSheet.tsx`, `HarnessApp.tsx`, `Message.tsx` (the notice line).
- `packages/fake-agent/fixtures/parallel-harness` (id `parallel`, actions "Write A" and "Write B", `parallel: { tasks: 2, jobs: 1 }`) backs `packages/e2e/tests/parallel.spec.ts`.
