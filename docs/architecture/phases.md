# Task phases and the time box

A phase is an ordered part inside one task (a student's warm-up, main block and close; a dev's investigate, plan, implement, review). The whole task stays one engine session: the app moves it from part to part with one more turn of the same session, so the conversation and its cache stay. An action may also offer a time box (15, 30, 45 minutes…): the clock runs in the main process, never cuts a turn, asks the agent to wrap up near the end and then moves to the close part. Spec: `docs/superpowers/specs/2026-10-25-task-phases-design.md`.

## What a phase is

An action declares `phases` (1 to 12), in order. Each one has:

- `id`: the action id pattern (`PHASE_ID`), unique within its action.
- `label`: one English string, at most 80 characters, put on one line before it reaches a prompt.
- `brief` (optional): a file in the harness folder (`agent/phases/<id>.md` by convention), resolved with `resolveInHarness` when the harness loads. A part without a brief changes only the state.
- `auto` (optional): the agent may move on from this part on its own (below).
- `modes` (optional): the modes allowed in this part: absent or `"any"` (all the action's), `"none"`, or a list of the action's mode ids (see "Modes by part").
- `close` (optional, `true` only): the part that ends with the core closing turn.

The checks are in the manifest schema (`defineHarness` and `loadHarness` refuse them, `check` lists them as `schema` with their paths): unique ids, `close` only on the last part, a list of `modes` only on an action with modes and each of them one of its modes. `auto` is allowed on any part, the last one included: on the close part it means the agent's "done" closes the task at once. `check` adds `brief-missing` for a phase brief that is missing or empty.

`packages/harness-sdk/src/phases.ts` has `PHASE_ID`, `TIME_BOX_MAX`, `hasPhases`, `phaseIds` and `phaseModes`.

## Who moves

**The agent** calls the hidden core block `set_phase` (`{ to, reason }`, the reason at most 300 characters) at the end of its answer. The app reads the last call of a turn and acts only after that turn ended well, and only for the task's own turns (a run turn or a phase change turn; a call in the closing, checkpoint or wrap-up turn is ignored):

- The current part has `auto` and `to` is the next part: the app moves at once (`by: "agent"`).
- `to` is the current part's own id and it is the `close` part: "the task is done". With `auto` on the close part, the closing turn runs at once; without it, the stepper shows "The AI says this part is done" and its "Finish".
- Anything else (no `auto`, a skip, going back): the task waits with `phaseProposal: { to, reason }`. The stepper shows it with "Go to <label>" and "Not now". It goes away when the task moves, or when the person sends anything else (they ignored it).
- The current part's own id in any other part does nothing; an id this action doesn't have is ignored (logged). The `ui` server refuses an id no action of the harness declares (see `blocks.md`).

**The person** moves with the stepper, the proposal's button or, from a harness's own UI, `client.setPhase(taskId, phaseId)` → `hh:setPhase` (`phase-ipc.ts`) → `TaskManager.setPhase(to, task)`. It returns `{ accepted, done }` like `chooseMode`; `accepted` is a `PhaseResult` (data, not a thrown error): `{ ok: true, changed: "turn" | "quiet" | "same" | "closing" }` or `{ ok: false, reason: "no-task" | "unknown" }`. Only while the task waits: unlike a mode pick it never waits for a turn, and a call while a turn runs rejects ("A turn is already running"), so the stepper is disabled meanwhile. Any part, forward or back. The current part answers `same`, except the current close part, which is its Finish (`closing`). In `humanharness run`, `>phase <id>` does the same (see `authoring.md`).

**The app** puts a new task in its first part (`by: "app"`), and moves to the close part after the time box's wrap-up or at its end.

## The change turn

Entering a part runs inside the operation that moves:

1. When there is something to say, the window is told first (`hh:taskTurn`, below) and a due checkpoint runs, still in the part the task leaves. A cancelled checkpoint moves nothing.
2. The state is written: `phase`, the `phases` log, the mode fields, and the proposal goes.
3. One run turn of the same session (not a quiet one: its answer shows). Its message (`phasePrompt` in `task-prompts.ts`) is `PHASE_PROMPT` (`Next part of this task: "<label>" (`<id>`).`), "The person went back to this part." when they did, `Time left: about N minutes.` with a time box, the part's brief filled, any mode section, then "Then continue with the person in this part."

- The chat's user entry is a system line, `— <label> —` (`TurnOptions.phaseChange`, `ChatEntry.phase`), never the brief.
- In `usage.jsonl` that turn is `phase: "phase-change"`, with the new part as `taskPhase`.
- A part with no brief and no mode section runs no turn and draws no line (`changed: "quiet"`): only the state and the stepper change.
- A failed change turn leaves the task in the new part (the state was written first); its line offers no "Try again". A cancelled one ends the task, as a cancelled follow-up does.
- A task whose session is gone (after "Move folder", marked `resume`) moves quietly whoever moves it, the wrap-up included: only the state changes, and the resumed session's first message carries the part.

The window learns of every change turn through `hh:taskTurn` → `client.onTaskTurn(listener)`: `{ task, kind: "phase" | "wrap-up", phase?, by?, back? }`, sent before the turn's events, whoever started it (the agent, the time box, the window itself or the harness's UI). It draws the system line and the live turn then; it never draws a change itself.

## The close part

Entering the close part is a normal change: its brief runs as a turn. Its end is the core closing turn (`closeCurrent`, `CLOSE_PROMPT` unchanged, D5): the person's Finish (`setPhase` to the current close part, or `client.finishTask()`, which calls `TaskManager.finish()` like `run`'s `q`), or the agent's "done" when the close part has `auto`. That turn asks for `save_note` and ends the task, so "close" in the harness and in the core is one moment. A stopped closing turn leaves the task open: `finishTask` resolves `false` and the window reads the tasks again.

## Modes by part

Modes spec §7, as built (see also `modes.md`):

- Entering a part that doesn't allow the current mode suspends it: `mode` is cleared, `suspendedMode` keeps it, `belowMinTier` goes with it. A later part that allows it brings it back, and its `modeSection` rides on that part's change turn (one turn, not a separate `MODE_PROMPT` turn).
- A task whose first part allows no modes starts with none: an explicit mode or a `defaultMode` id starts suspended, `"recommend"` waits. At the first part that allows modes, a task that never worked in a mode gets its `defaultMode` mode's section or, for `"recommend"` and `"ask"` (the app can't ask from a change it makes), the recommendation's section listing only the modes that part allows. The recommendation comes once per task: not when a part already in the task's log allowed modes.
- `chooseMode` refuses a mode the current part doesn't allow with `reason: "phase"`. Picking any mode clears `suspendedMode`.
- The window's mode bar lists only the modes the current part allows and hides when it allows none.
- A resumed task's move sets the mode fields only; no mode brief is read.

## The time box

- **Declared** on the action: `timeBox: { options, default, wrapUpAt }`. `options`: 1 to 6 whole minutes, 1–240 (`TIME_BOX_MAX`), each once; `default`: one of them, or `null` (also when absent) for no limit; `wrapUpAt` (optional, `0 < x ≤ 1`): the share of the time at which the wrap-up runs, else at the end. A time box works with or without phases.
- **Picked** at the start: the window asks "How long?" (the options and "No limit", the default first; "Not now" sends nothing) before an action with a time box, before the modes' "ask" question; a harness's own UI may pass `SendOptions.timeBox`. A start the window doesn't make itself (a `choices` option, the path's `next`) takes the default. `run --time <minutes>` picks it in the terminal. A length the action doesn't offer is refused before anything closes.
- **Told to the agent**: the first message ends with `Time left: about N minutes.`, and every change turn carries the time left.
- **The counter** is `timeBox: { minutes, usedMs, runningSince? }` in `tasks.json`: time used so far, plus the running stretch since `runningSince` (absent: paused). One timer in `TaskManager` is armed after every write for the next step; when it fires, the step waits until no operation or turn runs, so a turn is never cut.
- **Pause** (`client.pauseTask()`) only while the task waits; **Resume** (`client.resumeTask()`), and any turn the person starts (a message, a phase or mode pick) resumes it. Quitting pauses it. **"+5 min"** (`client.extendTimeBox()`, also during a turn) adds five minutes and clears `ended`, so the end runs again later; the wrap-up never runs twice.
- **The wrap-up**, once, at `wrapUpAt`: `wrappedUp` is set, a due checkpoint runs, then one turn with `WRAP_UP_PROMPT` ("Time is almost up: finish the current point briefly…"). Its chat line is "Time is almost up" (`TurnOptions.wrapUp`, `ChatEntry.timeUp`), `usage.jsonl` `phase: "wrap-up"`. After it the app moves to the close part, if the task was never in it.
- **At 100%** `ended` is set, and the app moves to the close part only if the task was never in it. The close part itself is never cut off: the person or the agent finishes it.
- **Without a close part** (or without phases), the stepper shows "Time is up" and a Finish button once the wrap-up ran; nothing closes on its own.
- **The window** gets `CurrentTaskView.timeBox`: `{ minutes, totalMs, usedMs, at, paused, wrappedUp?, ended? }` (`at`: when `usedMs` was measured), and counts down between views.
- **Minute length**: `TaskDeps.minuteMs` (default 60 000). `HH_TEST_MINUTE_MS` (10 to 60 000, development builds only) sets it for tests, and `humanharness dev --mock` sets it to 1000, so a 15-minute box wraps up in about 13 seconds.

## The window

`PhaseStepper` (`packages/ui/src/PhaseStepper.tsx`) sits under the mode bar for a task with phases or a time box: one pill per part (done ones styled, the current one marked and inert), Finish in the close part, the agent's proposal, and the time left with Pause/Resume and "+5 min". A time box without phases shows only its time and controls. Its calls disable the stepper and the mode bar until they answer; a refusal or failure shows "That didn't go through. Try again." The History panel shows the part next to each commit.

## State and records

- `tasks.json` (`task-store.ts`): `current.phase` (`{ id, startedAt }`), `phases` (the log, `{ id, at, by }`, at most 200 entries), `phaseProposal`, `timeBox` (`{ minutes, usedMs, runningSince?, wrappedUp?, ended? }`), `suspendedMode`. `TaskStore` takes each action's phase ids (`new TaskStore(folder, { modes, phases })`) and drops a phase the action no longer declares.
- `usage.jsonl`: `taskPhase` on every line of a phased task (closing, checkpoint, change and wrap-up turns, and compaction lines). The turn kind `phase` gains `phase-change` and `wrap-up`.
- The chat: a change's user entry has `phase`, the wrap-up's `timeUp`.
- History: every commit a phased task makes carries a `Phase: <id>` trailer (see `history.md`).
- The resumed session's first message: the action's brief, the mode's section, then the list of parts and the current part's section.
- `AppState` actions carry `phases` (id, label, `auto`, `close`, `modes`; never the brief) and `timeBox` (`options`, `default`).

## D0

An action without phases or a time box behaves and records exactly as before: the same `tasks.json`, prompts, chat log, usage lines, notes, history messages, `TaskView`, window and `run` output. Only the harness-wide pieces follow the whole manifest: in a harness where some action has phases, every task gets the `set_phase` tool, like `recommend_mode`.

## Not in v1

- A hidden answer for a part's brief turn (spec §9.1): it always shows.
- A `{ phase }` option on `choices` (spec §9.2): a harness's UI moves with `client.setPhase`, the agent with `set_phase`.
- A time box per phase (spec §9.3), and blocks offered only in some parts.

## Known gaps

- A resumed session's first message carries the time left only through a brief's `{{timeLeft}}`, not as its own `Time left:` line like the first message.
- When the tier floor starts a new task ("Start a new task with <mode>"), it gets the action's default time box, not the one the person picked.
- A restart never keeps a running box: startup ends any open task.

## Where to look

- `packages/harness-sdk/src/phases.ts`, `index.ts` (schema, checks, `loadHarness`), `core-blocks.ts` (`set_phase`).
- `packages/shell/src/main/task-manager.ts` (`setPhase`, `phaseAsked`, `phasePlan`, `enterPhase`, `modesOnEntry`, the time box), `task-prompts.ts`, `task-store.ts`, `time-box.ts`, `phase-ipc.ts`.
- `packages/ui/src/PhaseStepper.tsx`, `phases.ts`, `ChatView.tsx`.
- `packages/cli/src/run.ts`, `terminal.ts`, `check.ts`; `packages/fake-agent/src/mock.ts`, `mock-replay.ts`.
- `packages/fake-agent/fixtures/phases-harness` (id `tutor`) is the fixture.
