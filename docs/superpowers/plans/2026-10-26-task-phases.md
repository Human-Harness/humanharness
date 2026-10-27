# Task Phases and Time Box Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An action may declare `phases`: ordered parts inside one task and one engine session (student: warm-up, main block, close; dev: investigate, plan, implement, review). The app moves the task from part to part. The agent asks with a new hidden core block, `set_phase`; the person moves with `client.setPhase`; the app moves when a time box ends. A phase change is one turn in the same session carrying the new part's brief, so the conversation and its cache stay. A part marked `close: true` ends with the core closing turn (`save_note`), so "close" in the harness and in the core is one moment. An action may also offer a time box (15, 30, 45 minutes…): the timer runs in the main process, never cuts a turn, runs one wrap-up turn near the end and then moves to the close part. The phase is task state (`tasks.json`), every `usage.jsonl` line carries it (`taskPhase`), history commits get a `Phase:` trailer, and the core ships a `PhaseStepper` in `@humanharness/ui`. Phases also allow or forbid modes: a mode a part doesn't allow is suspended and comes back when a later part allows it. A harness that declares no phases and no time box works exactly as today (D0 below).

**Architecture:**
- **Contract (harness-sdk).**
  - New `phases.ts`: `PHASE_ID`, `TIME_BOX_MAX`, `hasPhases`, `phaseIds`, `phaseModes`.
  - `index.ts`: `phaseSchema` and `timeBoxSchema` on each action, every structural check in the manifest's `superRefine`, `loadHarness` resolving each phase's brief, the `HarnessPhase` and `HarnessTimeBox` types.
  - `core-blocks.ts`: `setPhaseSchema`, `PHASE_CORE_BLOCKS` (`set_phase`, hidden), offered by `allBlocks` only to a harness with phases, its name reserved for all.
- **The `ui` MCP server (blocks).** A `set_phase` call whose `to` is no phase id of the harness answers with a tool error that lists the valid ids.
- **Task state, prompts and turns (shell main).**
  - `task-prompts.ts`: `phasesSection` (the list of parts), `phaseSection` (the current part's brief), `phasePrompt` (a phase change), `wrapUpPrompt`, `fillPrompt`'s `{{phase}}`, `{{previousPhase}}`, `{{timeLeft}}`, and `resumeMessage`'s phase.
  - `task-store.ts`: `CurrentTask.phase`, `phases`, `phaseProposal`, `timeBox`, `suspendedMode`; `TaskStore` drops a phase the action no longer declares.
  - New `time-box.ts`: pure time arithmetic (`usedMs`, `remainingMs`, `nextDue`, `paused`, `running`, `formatTimeLeft`).
  - `usage-log.ts` / `turn-controller.ts`: `TurnKind` gains `phase-change` and `wrap-up`; `UsageMeta.taskPhase`; `TurnOptions.taskPhase`, `phaseChange`, `wrapUp` (the chat's user entry is a system line: `ChatEntry.phase`, `ChatEntry.timeUp`); input blocks get ids in those turns too; the history trailer carries the phase.
  - `workspace/src/history.ts`: the `Phase:` trailer, written and parsed.
  - `task-manager.ts`: a task starts in its first part; `set_phase` after a turn ends (`auto` or a proposal); `setPhase(to, task)` (`{ accepted, done }`); the phase change turn; the close part ends with `closeCurrent`; modes suspended and restored by part; the time box (timer, wrap-up, end, pause, resume, extend); the resumed session's part; the view.
  - New `phase-ipc.ts`: the `hh:setPhase` handler. `index.ts` wires the deps, `AppState` actions' `phases`/`timeBox`, `hh:send`'s `timeBox`, `hh:finishTask`, `hh:pauseTask`, `hh:resumeTask`, `hh:extendTimeBox` and the `hh:taskTurn` channel.
- **The window (ui).** `PhaseStepper` (pills for done, current and pending parts; a "Waiting for you" proposal card; the time left with Pause/Resume and "+5 min"; "Finish" in the close part); `ChatView` draws it under the mode bar, draws the system lines ("— Main block —", "Time is almost up"), hears turns the app starts on its own (`client.onTaskTurn`), asks "How long?" before an action with a time box, and offers only the modes the current part allows. The History panel shows each commit's part.
- **Authoring tools (cli) and mock mode.** `check` reports a missing or empty phase brief (`brief-missing`). `humanharness run <action> --time <minutes>` starts with a time box, `>phase <id>` at the prompt moves the task, and the terminal prints the changes and the proposals. A recording's turn may carry `setPhase: "<id>"` (the answer to the move into that part) or `timeUp: true` (the answer to the wrap-up); `run --record` writes them. A new fixture, `packages/fake-agent/fixtures/phases-harness` (id `tutor`), drives the tests.

**Tech Stack:**
- Unchanged: TypeScript, pnpm via corepack, Electron 44 + electron-vite 5, React 19, i18next, zod 4, Vitest + happy-dom, and Playwright with the fake agents.
- No new dependency.

Spec: `docs/superpowers/specs/2026-10-25-task-phases-design.md` (source of truth; "§" and "D" numbers below refer to it unless they say "modes spec"). The modes interaction is `2026-10-25-task-modes-design.md` §7. It builds on plans 1–4 (`2026-10-25-scopes-and-data.md`, `2026-10-25-input-blocks.md`, `2026-10-26-harness-settings.md`, `2026-10-26-task-modes.md`), all merged into master at 9c022ce, and on plan 5a (English-only core).

---

## Conventions

**Code**
- Same as plans 1–4:
  - English everywhere (code, comments, docs, UI strings, manifest texts);
  - packages export TS source;
  - extensionless imports;
  - tests in `packages/<name>/test/`;
  - one commit per task.
- React tests are `*.test.tsx` with `// @vitest-environment happy-dom` on the first line. Find elements by role and visible text.
- `@humanharness/ui` only imports **types** from other packages (`import type`). The UI's own small helpers live in `packages/ui/src/` (`phases.ts` keeps its own copy of the phase-modes rule for that reason).
- Colours only through the existing `--hh-*` tokens.
- Every lookup by a name that comes from a person, a harness, the agent or IPC (`actions[id]`, a phase id, a stored record key, a block's `to`) goes through `Object.hasOwn` or a list's `find`/`includes` first.
- Errors over IPC travel as data where the window needs a reason (`PhaseResult`), never as thrown errors (Electron flattens thrown errors).

**Commands and git**
- The worktree is `/Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data`, on branch `feat/task-phases` (from master 9c022ce). Implement there.
- Run every `corepack pnpm …` command from the worktree root. A single test file: `corepack pnpm vitest run <path>`.
- Git: always `git -C <worktree> …`, one simple command per call. Never use bare `git stash`. Never push.
- Every commit message ends with these two lines, with a blank line before them:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7
  ```
- Every task ends with `corepack pnpm typecheck` and `corepack pnpm test` green before its commit.
  - Tasks that touch the shell's main process, the preload or the UI also run `corepack pnpm app:build`.
  - Task 17 runs `corepack pnpm e2e`.

**Compliance (core spec §5), restated for this plan**
- Never read `~/.claude`, `~/.codex`, `~/.gemini` or any account, token or credential file.
- Phases touch only the person's folder: `.harness/tasks.json`, `.harness/usage.jsonl`, the chats, the notes and the history's trailers.
- A phase's brief and labels are harness data read in the main process; no harness function runs for phases.

**D0 is a hard rule (like plans 1–4).** A harness whose actions declare no `phases` and no `timeBox` must keep, byte for byte:
- `tasks.json` (no `phase`, `phases`, `phaseProposal`, `timeBox`, `suspendedMode`);
- `AGENTS.md` and the engine's own instructions file (no `set_phase` tool);
- the MCP tool list of the `ui` server (`allBlocks` returns what it returns today);
- every prompt: a task's first message, follow-ups, the checkpoint, the closing turn, a mode switch and a resumed session's first message;
- the chat log (no `phase` or `timeUp` on any entry), `usage.jsonl` (no `taskPhase`), the notes, and history commit messages (no `Phase:` trailer);
- `TaskView` (no `phase`, `phases`, `phaseProposal`, `timeBox`), `AppState` (actions without `phases`/`timeBox`) and the window (no stepper, no separator lines, no "How long?" question);
- `check`'s findings for the untouched template and every existing fixture;
- `humanharness run` output and prompts (no `>phase` hint) without `--time`.

An action without phases in a harness where another action has them gets the `set_phase` tool (it is per harness, like `recommend_mode`), but everything else of its tasks stays as today.

Tasks 1, 2, 3, 4, 5, 6, 9, 10, 12, 13, 15 and 17 hold the regression tests. Every other task keeps D0 by adding fields only when phases or a time box exist (conditional spreads), never by changing a default.

## Decisions this plan takes where the spec leaves room, or where the code moved

**Manifest (§3), English-only (plan 5a)**
- A phase's `label` is one English string (≤ 80). The spec's `{ es, en }` pairs no longer exist in the core.
- An action's `phases`: 1 to 12 phases. A phase: `id` (`PHASE_ID`, the action id pattern), `label`, `brief` (optional file, resolved with `resolveInHarness` at load), `auto` (optional boolean), `modes` (optional), `close` (optional, `true` only).
- **`modes` on a phase** accepts both spellings the two specs use: absent or `"any"` (all the action's modes), `"none"`, or a list of the action's mode ids. A list needs the action's `modes`; each id must be one of them.
- An action's `timeBox`: `options` (1 to 6 whole minutes, 1–240, each once), `default` (one of them, or `null` for no limit; absent means `null`), `wrapUpAt` (optional, `0 < x ≤ 1`). A time box is allowed without phases (then the wrap-up is followed by "Time is up" and a Finish button, §5).
- Every structural rule of §3 `check` is in the manifest schema's `superRefine` (unique ids, `close` only on the last phase, a phase's modes in the action), so `check` reports them as `schema` findings with their paths, as plan 4 did. `check`'s own finding is a missing or empty phase brief (`brief-missing`).

**The agent asks (§4.1)**
- `set_phase` is hidden, tool name `set_phase` (like `save_note`). Arguments `{ to: phaseId, reason: string (1–300) }`.
- **It is offered to every task of a harness with phases**, not only to tasks whose action has them: the `ui` MCP server is one process per engine runtime, built from the whole manifest (`allBlocks`), the same as `recommend_mode`. Its name is reserved for every harness.
- **Unknown ids.** The `ui` server knows the harness, not the open task, so it refuses an id that no action declares, with "Unknown part. Use one of: warmup, main, close." An id of another action reaches the app, which ignores it (logged).
- The app reads the last `set_phase` of a turn and acts only after that turn ended well, and only for the task's own turns (a run turn, a phase change turn). A call in the closing, checkpoint or wrap-up turn is ignored.
- **Who decides:** the current part has `auto: true` and `to` is the next part → the app moves at once. Otherwise (a skip, going back, no `auto`) the task waits with `phaseProposal: { to, reason }`. The proposal goes away when the task moves, or when the person sends anything else (they "ignore it").
- **Close part done.** `to` equal to the current part, when it is the `close: true` part, means "the task is done". With `auto: true` on the close part the app runs the closing turn at once; without it, the proposal says "The AI proposes to finish" and the person's "Finish" closes. `to` equal to any other current part does nothing.
- The first message of a task whose action has phases lists the parts (`## Parts of this task`: how to use `set_phase`, then `` - `id` (Label) ``, the current one marked `← now`) and carries the first part's brief (`## Part: <label>`). No extra turn runs at the start.

**The person moves (§4.2)**
- `client.setPhase(taskId, phaseId)` → `hh:setPhase` → `TaskManager.setPhase(to, task)` → `{ accepted, done }` like `chooseMode`. `accepted` is a `PhaseResult`: `{ ok: true, changed: "turn" | "quiet" | "same" | "closing" }` or `{ ok: false, reason: "no-task" | "unknown" }`.
- Only while the task waits: unlike a mode pick, a phase pick never waits for a running turn (the stepper is disabled while a turn runs). A call while busy rejects, like `send`.
- Any part, forward or back. Going back adds "The person went back to this part." to the change's message.
- `setPhase` to the current `close: true` part closes the task (`changed: "closing"`): this is the stepper's "Finish". To any other current part: `same`, nothing runs.

**A phase change (§4.4)**
- Inside an operation, after a due checkpoint. **The state is written first** (spec §4.4 steps 3–4): `phase`, `phases` (the log, ≤ 200 entries), the mode suspended or restored. Then, when there is something to say, one turn.
- **The turn is a run turn of the same session, not a `quiet` one** (in the code, `quiet` hides the agent's answer, which the spec wants shown). Its user entry is a system line, `— <label> —` (`TurnOptions.phaseChange`, `ChatEntry.phase`), never the brief. In `usage.jsonl` its `phase` is `phase-change` and its `taskPhase` is the new part.
- Its message (`phasePrompt`): `Next part of this task: "<label>" (`<id>`).`, the "went back" line, `Time left: about N minutes.` with a time box, the part's brief filled (`{{language}}`, `{{phase}}` = its label, `{{previousPhase}}` = the previous part's label, `{{timeLeft}}`), any mode section (below), then `Then continue with the person in this part.`
- A part with no brief and no mode section: no turn (`changed: "quiet"`); only the state and the stepper change.
- **Spec §9.1 (simplest default, flagged):** the brief turn's answer is always shown. No `quiet: "hidden"` in v1.
- **Spec §9.2 (simplest default, flagged):** no `{ phase }` option in `choices`. A harness UI moves with `client.setPhase`; the agent with `set_phase`.
- **Spec §9.3:** no time box per phase in v1.
- A failed phase change turn leaves the task in the new part (the state was written first); the window's "Try again" sends the person's last message as usual. A cancelled one ends the task, as a cancelled follow-up does today.
- **The window learns of a turn the app starts on its own** (the agent's `auto` move, the wrap-up, the move to the close part, or a move the person made from the harness's own UI) through a new channel, `hh:taskTurn` → `client.onTaskTurn(listener)`, sent before the turn's events. It draws the system line and the live turn then. The window never draws a phase change itself.

**The close part (D5)**
- Entering it runs its brief like any part. Its end is the core closing turn, `closeCurrent()` (`CLOSE_PROMPT` unchanged), started by the agent's `set_phase` to the same part (see above), the person's "Finish" (`setPhase` to the same part), or `client.finishTask()`.
- `client.finishTask()` is new (the spec has no name for "Terminar" outside the stepper): it calls the existing `TaskManager.finish()`, which `humanharness run`'s `q` already uses.

**Modes and phases (modes spec §7)**
- On entering a part: the current mode, if the part doesn't allow it, is suspended (`mode` cleared, `suspendedMode` kept; `belowMinTier` goes with it). A suspended mode the new part allows comes back.
- **The restore rides on the phase change turn**: its message carries the mode's `modeSection` after the part's brief. The modes spec says "restored with a MODE_PROMPT turn"; one turn instead of two costs less and says the same.
- A task whose first part allows no modes starts with no mode: an explicit mode, or a `defaultMode` mode id, starts suspended; `"recommend"` waits. At the first part that allows modes and with no mode used yet, the change's message carries the mode's section (a `defaultMode` id) or the recommendation's section (`recommendSection`, only the modes that part allows). `"ask"` can't ask from a change the app makes, so it recommends.
- `chooseMode` refuses a mode the current part doesn't allow with the new reason `phase`. Picking any mode clears `suspendedMode`.
- The window's mode bar lists only the modes the current part allows and is hidden when it allows none.

**Time box (§5)**
- Chosen at the start: `SendOptions.timeBox` (minutes, or `null` for no limit), `TaskManager.start(…, { timeBox })`, `run --time <minutes>`. A start the window doesn't make itself (a `choices` option, the path's `next`) uses the action's `default`. A value not among the options is refused before anything closes.
- **The window asks "How long?"** before starting an action that offers a time box (its options and "No limit", the default first), like the modes' "ask" picker. A harness's own UI may pass `SendOptions.timeBox` and skip it.
- Stored as `timeBox: { minutes, usedMs, runningSince?, wrappedUp?, ended? }`. `ended` is not in the spec: it marks that the 100% step ran, so it runs once.
- **The timer.** One `setTimeout` in `TaskManager`, armed after every write to `tasks.json` for the next due step (`nextDue`: the wrap-up at `wrapUpAt × minutes`, else at 100%; then the end at 100%). When it fires, the step waits until no operation or turn runs (`whenFree`), so a turn is never cut.
- **The wrap-up** (once): `wrappedUp` is set, one turn with `WRAP_UP_PROMPT` ("Time is almost up: finish the current point briefly…") whose user entry is the system line "Time is almost up" (`TurnOptions.wrapUp`, `ChatEntry.timeUp`; `usage.jsonl` `phase: "wrap-up"`). Then the app moves to the `close: true` part (by `app`) if it was never entered. Without a close part, the stepper shows "Time is up" and "Finish"; nothing closes on its own.
- **At 100%:** `ended` is set; if the close part was never entered, the app moves there. The close part is never cut off.
- **Pause** (`client.pauseTask()`) only while the task waits. **Resume** (`client.resumeTask()`), and any turn the person starts resumes it (a person who writes is working). **Quitting** pauses it. `client.extendTimeBox()` adds 5 minutes, clears `ended` (the end runs again later) and never runs the wrap-up again.
- `CurrentTaskView.timeBox`: `{ minutes, usedMs, paused, at, wrappedUp?, ended? }` (`at`: when `usedMs` was measured, so the window counts down between views).
- **Minute length.** `TaskDeps.minuteMs` (default 60 000). The test hook `HH_TEST_MINUTE_MS` sets it in development builds, and `humanharness dev --mock` sets it to 1000, so a 15-minute box wraps up in about 13 seconds of test.

**State, usage, history, resume (§6)**
- `CurrentTask.phase`, `phases`, `phaseProposal`, `timeBox`, `suspendedMode` are checked in `cleanCurrent`. "Validated against the manifest": `TaskStore` takes each action's phase ids (`new TaskStore(folder, { modes, phases })`); a phase the action no longer declares is dropped from `phase`, `phases` and `phaseProposal`.
- `UsageMeta.taskPhase` / `UsageRecord.taskPhase`: every turn of a phased task (closing, checkpoint, phase change and wrap-up included) and compaction lines. The existing `phase` (turn kind) gains `phase-change` and `wrap-up`.
- History: `HistoryTrailer.phase` → a `Phase: <id>` trailer line on every commit a phased turn makes (the runtime's "Before message" and turn commits, the note commits). `parseCommitMessage` reads it; `HistoryItem.phase` reaches the panel, which shows the part's label next to the commit.
- Resumed session: `resumeMessage` puts the list of parts and the current part's section after the action's brief (and the mode's section).

**Mock and terminal (§6 "Mock mode", slice 4)**
- A recording's turn may carry `setPhase: "<id>"`: it is the recorded answer to the app's move into part `<id>` (the phase change turn). `timeUp: true`: the recorded answer to the wrap-up. The agent's own request stays a recorded `set_phase` call in `blocks`.
- `promptKind` knows the phase change (`Next part of this task:`) and the wrap-up (`Time is almost up:`). Replay plays the matching turn and continues from it; an unrecorded one plays the fallback.
- `run --record` writes `setPhase` on a phase change turn and `timeUp` on a wrap-up turn; neither is linked from the previous turn's `next`.
- `run` prints `— <label> —` before a phase change turn, `Time is almost up` before the wrap-up, and after a turn with a proposal: `The AI proposes to move to <label>: <reason>. Type >phase <id> to go there.` At the prompt, `>phase <id>` moves the task (a refusal prints why). The prompt line mentions `>phase <id>` only for an action with phases.

## What in the code conflicts with the spec (and how this plan handles it)

| Conflict | Where | Handling |
|---|---|---|
| §3 texts are `{ es, en }` pairs; the core is English-only since plan 5a | `harness-sdk/src/index.ts` (`text`) | Plain English strings (Task 1) |
| §3 phase `modes` is "optional, the modes allowed"; modes spec §7 says `"any" \| "none" \| modeId[]` | Two specs | Both spellings accepted (Task 1) |
| §4.1 `set_phase` "offered only to tasks whose action has phases" | One `ui` MCP server per runtime, built from the whole manifest (`ui-server.ts`) | Offered per harness, like `recommend_mode` (Task 2) |
| §4.1 "Unknown id: the tool answers with an error and the list of valid ids" | The `ui` server doesn't know the open task | It checks against every phase id of the harness; the app ignores another action's id (Tasks 2, 6) |
| §4.4 "quiet turn … the answer is shown" | `TurnOptions.quiet` hides the answer | A run turn whose user entry is a system line (`phaseChange`), as plan 4 did for modes (Tasks 5, 6) |
| §4.4 the window shows a separator for changes the app starts | The window only draws turns it starts, or `onModeSwitch` ones (preload-local) | New main → window channel `hh:taskTurn` / `client.onTaskTurn` (Tasks 6, 10, 12) |
| §5 `start(action, display, { timeBox })` | `start(action, display, scope, mode)` | A fifth argument, `{ timeBox }` (Task 9) |
| §5 the wrap-up runs once, the end "starts the close phase" once | No field says the end ran | `timeBox.ended` (Task 4) |
| §4.4.5 "the person pressing Terminar" | No client call closes a task without starting another | `client.finishTask()` → existing `TaskManager.finish()` (Task 10) |
| §6 mock `setPhase` / `timeUp: true` "to replay a phase change" | The fake can't move the app's timer | They mark the recorded answers to the change and the wrap-up prompts; mock time runs fast through `HH_TEST_MINUTE_MS` (Tasks 10, 14) |
| Modes spec §7 "restored with a MODE_PROMPT turn" | — | Folded into the phase change turn (Task 7) |
| Input blocks get ids only in run turns (`phase === "run"`) | `turn-controller.ts`, `task-manager.ts` | Also in `phase-change` and `wrap-up` turns, so a warm-up's first question can be an input block (Task 5) |
| `cleanCurrent` gets only the mode ids | `TaskStore(folder, { modes })` | `TaskStore(folder, { modes, phases })`; the internal `known` becomes an object (Task 4) |
| Electron flattens thrown errors | `shell/src/main/index.ts` `handle()` | `PhaseResult` as data (Task 10) |

**Reuse, and why.**
- **Reused:**
  - `chooseMode`'s `{ accepted, done }` shape and IPC handler pattern for `setPhase`;
  - `checkpoint`, `needsCheckpoint`, `afterRun`, `endsInWindow` for the phase change and wrap-up turns (follow-ups in every way but their text);
  - `closeCurrent` and `finish` for the close part's end;
  - `modeSection`, `recommendSection`, `modeText`, `hintOf` for modes coming back with a part;
  - `whenFree` (plan 4) so a time box step waits for the turn;
  - the "ask" picker pattern for "How long?", `ModeBar`'s look for the stepper.
- **Not reused:**
  - `quiet: true` turns (they hide the answer);
  - `onModeSwitch`'s preload-local notification (the app, not the window, starts most phase turns).

## File Structure

```
packages/harness-sdk/src/phases.ts         NEW. PHASE_ID, TIME_BOX_MAX, hasPhases, phaseIds, phaseModes          (Task 1)
packages/harness-sdk/src/index.ts          phaseSchema, timeBoxSchema, action phases/timeBox, checks,
                                           loadHarness briefs, HarnessPhase/HarnessTimeBox, exports              (Task 1)
packages/harness-sdk/src/core-blocks.ts    setPhaseSchema, PHASE_CORE_BLOCKS, allBlocks, reserved names         (Task 2)
packages/blocks/src/ui-server.ts           set_phase's unknown id error                                        (Task 2)
packages/fake-agent/fixtures/phases-harness/  NEW. The `tutor` fixture                                         (Task 2; mock/ in Task 14)
packages/shell/src/main/task-prompts.ts    phasesSection, phaseSection, phasePrompt, WRAP_UP_PROMPT,
                                           fillPrompt vars, resumeMessage phase                                (Task 3)
packages/shell/src/main/task-store.ts      CurrentTask phase fields, cleanCurrent, TaskStore phases            (Task 4)
packages/shell/src/main/time-box.ts        NEW. Time arithmetic                                                (Task 4)
packages/shell/src/main/usage-log.ts       TurnKind, UsageMeta/UsageRecord.taskPhase                           (Task 5)
packages/shell/src/main/turn-controller.ts TurnOptions.taskPhase, phaseChange, wrapUp, takesInputs, trailer    (Task 5)
packages/workspace/src/history.ts          HistoryTrailer.phase, withTrailer, parseCommitMessage, entries      (Task 5)
packages/shell/src/main/history-view.ts    entries' phase                                                      (Task 5)
packages/ui/src/client.ts                  ChatEntry.phase/timeUp, HistoryItem.phase (5); CurrentTaskView
                                           fields, PhaseResult, PhaseView, TimeBoxView, TaskTurnNotice,
                                           ActionOption.phases/timeBox, SendOptions.timeBox, ModeResult
                                           "phase", HarnessClient calls (6, 7, 10)                             (Tasks 5, 6, 7, 10)
packages/shell/src/main/task-manager.ts    phases at start, set_phase, setPhase, change turn, resume, view (6);
                                           modes by part (7); close part (8); time box (9)                     (Tasks 6–9)
packages/shell/src/main/phase-ipc.ts       NEW. setPhaseHandler                                                (Task 10)
packages/shell/src/main/test-hooks.ts      minuteMs (HH_TEST_MINUTE_MS)                                        (Task 10)
packages/shell/src/main/index.ts           deps, TaskStore phases, appState, hh:send timeBox, IPC handlers     (Task 10)
packages/shell/src/preload/index.ts        setPhase, finishTask, pauseTask, resumeTask, extendTimeBox,
                                           onTaskTurn                                                          (Task 10)
packages/ui/test/fake-client.ts            the same                                                            (Task 10)
packages/cli/src/mock-session.ts           HH_TEST_MINUTE_MS=1000                                              (Task 10)
packages/ui/src/phases.ts                  NEW. phaseModesOf, timeLeftMs, closePhaseOf                         (Task 11)
packages/ui/src/PhaseStepper.tsx           NEW. The stepper                                                    (Task 11)
packages/ui/src/index.ts                   exports PhaseStepper                                                (Task 11)
packages/ui/src/styles.css                 stepper, separator line, time picker                                (Task 11)
packages/i18n/src/locales/en.json          phases.*                                                            (Task 11)
packages/ui/src/state.ts                   the user action's phase/timeUp                                      (Task 12)
packages/ui/src/Message.tsx                system lines for phase and timeUp                                   (Task 12)
packages/ui/src/ChatView.tsx               stepper, onTaskTurn, time picker, modes by part                     (Task 12)
packages/ui/src/HistoryPanel.tsx           the part's label on a commit                                        (Task 12)
packages/cli/src/check.ts                  phase briefs                                                        (Task 13)
packages/fake-agent/src/mock.ts            setPhase, timeUp                                                    (Task 14)
packages/fake-agent/src/mock-replay.ts     promptKind phase/wrap-up, replay                                    (Task 14)
packages/cli/src/record.ts                 records setPhase/timeUp                                             (Task 14)
packages/cli/src/run.ts                    --time, >phase, deps, TaskStore phases                              (Task 15)
packages/cli/src/terminal.ts               taskTurn lines, proposals                                           (Task 15)
docs/architecture/phases.md                NEW                                                                 (Task 16)
docs/architecture/{manifest,blocks,context,turn,history,mock-mode,authoring,modes}.md                         (Task 16)
packages/cli/guide/new-harness.md          asks about phases and a time box                                    (Task 16)
packages/e2e/tests/phases.spec.ts          NEW. Phases, proposal, close, time box                              (Task 17)
packages/e2e/tests/helpers.ts              launch's extra env                                                  (Task 17)
```

---

## Phase 1 — Contract (spec §8 slice 1, manifest part)

### Task 1: The manifest declares phases and a time box

**Files:**
- Create: `packages/harness-sdk/src/phases.ts`
- Modify: `packages/harness-sdk/src/index.ts`
- Test: `packages/harness-sdk/test/phases.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/harness-sdk/test/phases.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type HarnessInput, PHASE_ID, defineHarness, hasPhases, loadHarness, phaseIds, phaseModes } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-phases-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const base: HarnessInput = {
  id: "tutor",
  name: "Tutor",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Tutor" },
  instructions: "./AGENTS.md",
  permissions: { edit: "none", exec: false, web: false },
  blocks: {},
  author: "t",
};
const modes = { socratic: { label: "Socratic", brief: "modes/socratic.md" }, feynman: { label: "Feynman", brief: "modes/feynman.md" } };
const phases = [
  { id: "warmup", label: "Warm-up", brief: "phases/warmup.md", auto: true, modes: "none" as const },
  { id: "main", label: "Main block", brief: "phases/main.md", modes: ["socratic"] },
  { id: "close", label: "Close", brief: "phases/close.md", close: true as const },
];
const session = { label: "Session", prompt: "tasks/session.md", cost: "medium" as const, modes: ["socratic", "feynman"], phases };
const quiz = { label: "Quiz", prompt: "tasks/quiz.md", cost: "light" as const };

const issues = (input: HarnessInput): string[] => {
  try {
    defineHarness(input);
    return [];
  } catch (err) {
    return (err as { issues: { path: PropertyKey[]; message: string }[] }).issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`);
  }
};

describe("phases in the manifest", () => {
  it("declares phases and a time box on an action; without them nothing is added (D0)", () => {
    const h = defineHarness({ ...base, modes, actions: { session: { ...session, timeBox: { options: [15, 30, 45], wrapUpAt: 0.85 } }, quiz } });
    expect(h.actions.session.phases?.map((p) => p.id)).toEqual(["warmup", "main", "close"]);
    expect(h.actions.session.timeBox).toEqual({ options: [15, 30, 45], default: null, wrapUpAt: 0.85 });
    expect(h.actions.quiz).not.toHaveProperty("phases");
    expect(h.actions.quiz).not.toHaveProperty("timeBox");
    expect(hasPhases(h)).toBe(true);
    expect(phaseIds(h)).toEqual(["warmup", "main", "close"]);
    expect(hasPhases(defineHarness({ ...base, actions: { quiz } }))).toBe(false);
    expect(PHASE_ID.test("main_2")).toBe(true);
    expect(PHASE_ID.test("Main")).toBe(false);
  });

  it("phaseModes: absent or any is every mode, none is none, a list is those", () => {
    const action = { modes: ["socratic", "feynman"] };
    expect(phaseModes(action, undefined)).toEqual(["socratic", "feynman"]);
    expect(phaseModes(action, { modes: "any" })).toEqual(["socratic", "feynman"]);
    expect(phaseModes(action, {})).toEqual(["socratic", "feynman"]);
    expect(phaseModes(action, { modes: "none" })).toEqual([]);
    expect(phaseModes(action, { modes: ["feynman"] })).toEqual(["feynman"]);
    expect(phaseModes({}, { modes: "any" })).toEqual([]);
  });

  it("refuses broken declarations, with their paths", () => {
    const dup = [phases[0], { ...phases[1], id: "warmup" }, phases[2]];
    expect(issues({ ...base, modes, actions: { session: { ...session, phases: dup } } })).toEqual(['actions.session.phases.1.id: Phase "warmup" is declared twice']);
    const early = [{ ...phases[0], close: true as const }, phases[1], phases[2]];
    expect(issues({ ...base, modes, actions: { session: { ...session, phases: early } } })).toEqual(["actions.session.phases.0.close: Only the last phase can be the close phase"]);
    const strange = [phases[0], { ...phases[1], modes: ["nope"] }, phases[2]];
    expect(issues({ ...base, modes, actions: { session: { ...session, phases: strange } } })).toEqual(['actions.session.phases.1.modes: "nope" is not one of this action\'s modes']);
    const noModes = { ...session, modes: undefined, phases: [phases[0], { ...phases[1], modes: ["socratic"] }] };
    expect(issues({ ...base, modes, actions: { session: noModes } })).toEqual(["actions.session.phases.1.modes: Only an action with modes can list the modes a phase allows"]);
    expect(issues({ ...base, actions: { quiz: { ...quiz, timeBox: { options: [15, 15] } } } })).toEqual(["actions.quiz.timeBox.options: Each length is offered once"]);
    expect(issues({ ...base, actions: { quiz: { ...quiz, timeBox: { options: [15, 30], default: 20 } } } })).toEqual([
      "actions.quiz.timeBox.default: The default is one of the options, or null",
    ]);
    expect(issues({ ...base, actions: { quiz: { ...quiz, timeBox: { options: [0] } } } })[0]).toMatch(/^actions\.quiz\.timeBox\.options\.0: /);
    expect(issues({ ...base, actions: { quiz: { ...quiz, timeBox: { options: [15], wrapUpAt: 1.5 } } } })[0]).toMatch(/^actions\.quiz\.timeBox\.wrapUpAt: /);
    expect(issues({ ...base, actions: { quiz: { ...quiz, phases: [] } } })[0]).toMatch(/^actions\.quiz\.phases: /);
    // A time box alone is fine; "any" and "none" without the action's modes are harmless.
    expect(issues({ ...base, actions: { quiz: { ...quiz, timeBox: { options: [10], default: 10 }, phases: [{ id: "a", label: "A", modes: "none" }] } } })).toEqual([]);
  });
});

describe("loadHarness and phase briefs", () => {
  it("refuses a phase brief outside the harness folder", async () => {
    const dir = fs.mkdtempSync(path.join(root, "t-"));
    const file = path.join(dir, "harness.config.mjs");
    const manifest = { ...base, actions: { quiz: { ...quiz, phases: [{ id: "far", label: "Far", brief: "../../outside.md" }] } } };
    fs.writeFileSync(file, `export default ${JSON.stringify(manifest)};`);
    await expect(loadHarness(file)).rejects.toThrow("Path escapes the harness folder: ../../outside.md");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm vitest run packages/harness-sdk/test/phases.test.ts`
Expected: FAIL (`hasPhases`, `phaseIds`, `phaseModes`, `PHASE_ID` are not exported; `phases` and `timeBox` are stripped from actions).

- [ ] **Step 3: Create `phases.ts`**

Create `packages/harness-sdk/src/phases.ts`:

```ts
import type { HarnessAction, HarnessPhase } from "./index";

/** A phase id (task-phases spec §3): the action id pattern, unique within its action. */
export const PHASE_ID = /^[a-z][a-z0-9_-]{0,63}$/;

/** The longest time box a manifest may offer, in minutes. */
export const TIME_BOX_MAX = 240;

/** Some action declares phases: only then the core offers `set_phase` (D0). */
export const hasPhases = (h: { actions: Record<string, { phases?: readonly unknown[] }> }): boolean =>
  Object.values(h.actions).some((a) => (a.phases?.length ?? 0) > 0);

/** Every phase id the harness declares, in action order, once each: what the `ui` server accepts in `set_phase`. */
export function phaseIds(h: { actions: Record<string, { phases?: readonly { id: string }[] }> }): string[] {
  return [...new Set(Object.values(h.actions).flatMap((a) => (a.phases ?? []).map((p) => p.id)))];
}

/** The modes allowed in `phase` (modes spec §7): absent or "any", all the action's; "none", none; a list, those. */
export function phaseModes(action: Pick<HarnessAction, "modes">, phase: Pick<HarnessPhase, "modes"> | undefined): string[] {
  const all = action.modes ?? [];
  const allowed = phase?.modes;
  if (allowed === undefined || allowed === "any") return all;
  if (allowed === "none") return [];
  return all.filter((m) => allowed.includes(m));
}
```

- [ ] **Step 4: Add the schema, the checks and the briefs to `index.ts`**

In `packages/harness-sdk/src/index.ts`:

1. Add the import and the export next to the modes ones:

```ts
import { PHASE_ID, TIME_BOX_MAX } from "./phases";
```
```ts
export * from "./phases";
```

2. Above `const actionSchema = z.object({`, add:

```ts
/** A part of a task (task-phases spec §3): its brief runs as one turn of the same session when the task enters it. */
const phaseSchema = z.object({
  id: z.string().regex(PHASE_ID),
  label: text.max(80),
  /** A file in the harness folder, filled like an action's prompt plus {{phase}}, {{previousPhase}}, {{timeLeft}}. Absent: no turn. */
  brief: z.string().min(1).optional(),
  /** The agent may move on to the next phase on its own; without it, its request waits for the person. */
  auto: z.boolean().optional(),
  /** The modes allowed here (modes spec §7): "any" (the default), "none" or a list of the action's modes. */
  modes: z.union([z.enum(["any", "none"]), z.array(z.string().regex(MODE_ID)).min(1)]).optional(),
  /** The last phase only: its end is the core closing turn (D5). */
  close: z.literal(true).optional(),
});
export type HarnessPhase = z.output<typeof phaseSchema>;
/** A time box the person may choose at the start (spec §5). */
const timeBoxSchema = z.object({
  /** Lengths in whole minutes. */
  options: z.array(z.number().int().min(1).max(TIME_BOX_MAX)).min(1).max(6),
  /** One of the options, or null for no limit. */
  default: z.number().int().nullable().default(null),
  /** The share of the time at which the wrap-up starts; absent: when the time is up. */
  wrapUpAt: z.number().gt(0).max(1).optional(),
});
export type HarnessTimeBox = z.output<typeof timeBoxSchema>;
```

3. In `actionSchema`, after `defaultMode`, add:

```ts
  /** Ordered parts inside one task and one session (task-phases spec D1); absent: none (D0). */
  phases: z.array(phaseSchema).min(1).max(12).optional(),
  /** Lengths the person may choose for the task (spec D6); absent: no time box. */
  timeBox: timeBoxSchema.optional(),
```

4. In the manifest's `superRefine`, after the modes' action loop (before the "A Settings tab needs something to draw" block), add:

```ts
  // Phases and the time box (task-phases spec §3).
  for (const [id, a] of Object.entries(m.actions)) {
    const phases = a.phases ?? [];
    const ids = new Set<string>();
    phases.forEach((p, i) => {
      const at = ["actions", id, "phases", i];
      if (ids.has(p.id)) ctx.addIssue({ code: "custom", path: [...at, "id"], message: `Phase "${p.id}" is declared twice` });
      ids.add(p.id);
      if (p.close && i !== phases.length - 1) ctx.addIssue({ code: "custom", path: [...at, "close"], message: "Only the last phase can be the close phase" });
      if (!Array.isArray(p.modes)) return;
      if (!a.modes) {
        ctx.addIssue({ code: "custom", path: [...at, "modes"], message: "Only an action with modes can list the modes a phase allows" });
        return;
      }
      for (const mode of p.modes) {
        if (!a.modes.includes(mode)) ctx.addIssue({ code: "custom", path: [...at, "modes"], message: `"${mode}" is not one of this action's modes` });
      }
    });
    if (!a.timeBox) continue;
    const options = a.timeBox.options;
    if (new Set(options).size !== options.length) ctx.addIssue({ code: "custom", path: ["actions", id, "timeBox", "options"], message: "Each length is offered once" });
    if (a.timeBox.default !== null && !options.includes(a.timeBox.default)) {
      ctx.addIssue({ code: "custom", path: ["actions", id, "timeBox", "default"], message: "The default is one of the options, or null" });
    }
  }
```

5. In `loadHarness`, after the mode briefs' loop, add:

```ts
  // And every phase's brief (task-phases spec §3).
  for (const action of Object.values(loaded.actions)) for (const p of action.phases ?? []) if (p.brief) resolveInHarness(loaded, p.brief);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `corepack pnpm vitest run packages/harness-sdk/test/phases.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify everything and commit**

Run: `corepack pnpm typecheck` and `corepack pnpm test`
Expected: all green (D0: the existing harness, modes and settings tests are unchanged).

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/harness-sdk/src/phases.ts packages/harness-sdk/src/index.ts packages/harness-sdk/test/phases.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(sdk): actions declare phases and a time box

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 2: The `set_phase` core block, the `ui` server's check and the `tutor` fixture

**Files:**
- Modify: `packages/harness-sdk/src/core-blocks.ts`, `packages/harness-sdk/src/index.ts`, `packages/blocks/src/ui-server.ts`
- Create: `packages/fake-agent/fixtures/phases-harness/` (`harness.config.ts`, `ui/App.tsx`, `agent/AGENTS.md`, `agent/tasks/session.md`, `agent/tasks/quiz.md`, `agent/phases/warmup.md`, `agent/phases/main.md`, `agent/phases/close.md`, `agent/modes/socratic.md`, `agent/modes/feynman.md`)
- Test: `packages/harness-sdk/test/phases.test.ts`, `packages/blocks/test/ui-server.test.ts`

- [ ] **Step 1: Create the fixture**

Create `packages/fake-agent/fixtures/phases-harness/harness.config.ts`:

```ts
// Test fixture for task phases: a tutor whose Session task has three parts and a time box, and a Quiz with none.
import { defineHarness } from "@humanharness/harness-sdk";

export default defineHarness({
  id: "tutor",
  name: "Tutor",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Human Harness Tutor" },
  instructions: "./agent/AGENTS.md",
  permissions: { edit: "none", exec: false, web: false },
  blocks: {},
  actions: {
    session: {
      label: "Session",
      prompt: "./agent/tasks/session.md",
      cost: "light",
      modes: ["socratic", "feynman"],
      defaultMode: "socratic",
      phases: [
        { id: "warmup", label: "Warm-up", brief: "./agent/phases/warmup.md", auto: true, modes: "none" },
        { id: "main", label: "Main block", brief: "./agent/phases/main.md" },
        { id: "close", label: "Close", brief: "./agent/phases/close.md", close: true, modes: "none" },
      ],
      timeBox: { options: [15, 30, 45], default: null, wrapUpAt: 0.85 },
    },
    quiz: { label: "Quiz", prompt: "./agent/tasks/quiz.md", cost: "light" },
  },
  path: ["session", "quiz"],
  modes: {
    socratic: { label: "Socratic", description: "Questions that lead you to the idea.", brief: "./agent/modes/socratic.md" },
    feynman: { label: "Feynman", description: "You explain it back in plain words.", brief: "./agent/modes/feynman.md" },
  },
  author: "Human Harness tests",
});
```

Copy `packages/fake-agent/fixtures/modes-harness/ui/App.tsx` to `packages/fake-agent/fixtures/phases-harness/ui/App.tsx`, changing only its comment to `// Only the core screens: the stepper and the mode bar come from the manifest.`

Create the agent files, one line each:
- `agent/AGENTS.md`: `You are a patient tutor. Keep answers short.`
- `agent/tasks/session.md`: `# Task: session` then a blank line, then `A study session about fractions, in {{language}}.` then a blank line, then `{{notesIndex}}`
- `agent/tasks/quiz.md`: `# Task: quiz` then a blank line, then `Three quick questions, in {{language}}.`
- `agent/phases/warmup.md`: `Ask two quick recall questions about what the person studied before.`
- `agent/phases/main.md`: `Teach the topic. We came from {{previousPhase}}. Time left: {{timeLeft}}`
- `agent/phases/close.md`: `Ask the person to sum up what they learned in three lines.`
- `agent/modes/socratic.md`: `Lead with questions; never give the answer first.`
- `agent/modes/feynman.md`: `Ask the person to explain it back in plain words.`

- [ ] **Step 2: Write the failing tests**

Append to `packages/harness-sdk/test/phases.test.ts` (add `PHASE_CORE_BLOCKS`, `RESERVED_BLOCK_NAMES`, `allBlocks`, `setPhaseSchema` to the import from `"../src"`):

```ts
describe("the set_phase core block (spec §4.1)", () => {
  it("is offered only to a harness with phases, hidden, under its own tool name; its name is reserved for all", () => {
    const phased = defineHarness({ ...base, modes, actions: { session, quiz } });
    expect(Object.keys(allBlocks(phased))).toContain("set_phase");
    expect(allBlocks(phased).set_phase.visible).toBe(false);
    expect(allBlocks(phased).set_phase.tool).toBe("set_phase");
    expect(Object.keys(allBlocks(defineHarness({ ...base, actions: { quiz } })))).not.toContain("set_phase");
    expect(RESERVED_BLOCK_NAMES).toContain("set_phase");
    expect(Object.keys(PHASE_CORE_BLOCKS)).toEqual(["set_phase"]);
    expect(issues({ ...base, blocks: { set_phase: PHASE_CORE_BLOCKS.set_phase } })).toContain('blocks.set_phase: "set_phase" is a core block name');
  });

  it("takes a phase id and a short reason", () => {
    expect(setPhaseSchema.safeParse({ to: "main", reason: "Warm-up done" }).success).toBe(true);
    expect(setPhaseSchema.safeParse({ to: "Main", reason: "x" }).success).toBe(false);
    expect(setPhaseSchema.safeParse({ to: "main", reason: "" }).success).toBe(false);
    expect(setPhaseSchema.safeParse({ to: "main", reason: "x".repeat(301) }).success).toBe(false);
  });
});
```

Append to `packages/blocks/test/ui-server.test.ts` (next to the other fixture constants):

```ts
const PHASES_FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/phases-harness/harness.config.ts");

describe("ui MCP server: set_phase (task-phases spec §4.1)", () => {
  it("is a tool only in a harness with phases", async () => {
    const plain = await connect([]);
    expect((await plain.listTools()).tools.map((t) => t.name)).not.toContain("set_phase");
    await client?.close();
    await bridge?.close();
    const phased = await connect([], PHASES_FIXTURE);
    expect((await phased.listTools()).tools.map((t) => t.name)).toContain("set_phase");
  });

  it("forwards a known phase id; answers an unknown one with the valid ids and sends nothing", async () => {
    const received: BlockMessage[] = [];
    const c = await connect(received, PHASES_FIXTURE);
    const ok = await c.callTool({ name: "set_phase", arguments: { to: "main", reason: "Warm-up done" } });
    expect(ok.isError).toBeFalsy();
    const bad = await c.callTool({ name: "set_phase", arguments: { to: "dessert", reason: "Hungry" } });
    expect(bad.isError).toBe(true);
    expect((bad.content as { text: string }[])[0].text).toBe("Unknown part. Use one of: warmup, main, close.");
    expect(received).toEqual([{ name: "set_phase", data: { to: "main", reason: "Warm-up done" } }]);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `corepack pnpm vitest run packages/harness-sdk/test/phases.test.ts packages/blocks/test/ui-server.test.ts`
Expected: FAIL (`PHASE_CORE_BLOCKS`, `setPhaseSchema` are not exported; no `set_phase` tool).

- [ ] **Step 4: Add the block**

In `packages/harness-sdk/src/core-blocks.ts`:

1. Change the modes import to also bring the phase helpers:

```ts
import { MODE_ID, hasModes } from "./modes";
import { PHASE_ID, hasPhases } from "./phases";
```

2. After `MODE_CORE_BLOCKS`, add:

```ts
/** The agent asks the app to move the task to another of its phases (task-phases spec §4.1). The app decides. */
export const setPhaseSchema = z.object({
  to: z.string().regex(PHASE_ID),
  reason: z.string().min(1).max(300),
});
export type PhaseRequest = z.infer<typeof setPhaseSchema>;

/** Core blocks only a harness with phases gets (spec §4.1). Their names are reserved for all. */
export const PHASE_CORE_BLOCKS = {
  set_phase: defineBlock({
    description:
      "Asks the app to move this task to another of its parts. `to`: a part id the app gave you; in the last part, its own id means the task is done. `reason`: one short sentence the person may read. Call it once, at the end of your answer, then stop: the app acts after your answer and may ask the person first.",
    visible: false,
    tool: "set_phase",
    schema: setPhaseSchema,
    example: { to: "main", reason: "The warm-up questions are done" },
  }),
} satisfies Record<string, Block>;
```

3. Replace `RESERVED_BLOCK_NAMES` and `allBlocks` with:

```ts
/** Every core block name, offered or not: no harness block may take one. */
export const RESERVED_BLOCK_NAMES: readonly string[] = [
  ...CORE_BLOCK_NAMES,
  ...Object.keys(INPUT_CORE_BLOCKS),
  ...Object.keys(MODE_CORE_BLOCKS),
  ...Object.keys(PHASE_CORE_BLOCKS),
];

export const hasInputBlocks = (blocks: Record<string, Block>): boolean => Object.values(blocks).some((b) => b.input !== undefined);

/**
 * The core blocks plus the harness's own: what the agent gets as tools. `annotate` only with input blocks (input-blocks
 * D0), `recommend_mode` only with modes (task-modes D0), `set_phase` only with phases (task-phases D0).
 */
export function allBlocks(harness: {
  blocks: Record<string, Block>;
  modes?: Record<string, unknown>;
  actions?: Record<string, { phases?: readonly unknown[] }>;
}): Record<string, Block> {
  return {
    ...CORE_BLOCKS,
    ...(hasInputBlocks(harness.blocks) ? INPUT_CORE_BLOCKS : {}),
    ...(hasModes(harness) ? MODE_CORE_BLOCKS : {}),
    ...(harness.actions && hasPhases({ actions: harness.actions }) ? PHASE_CORE_BLOCKS : {}),
    ...harness.blocks,
  };
}
```

4. In `packages/harness-sdk/src/index.ts`, import `PHASE_CORE_BLOCKS` from `./core-blocks` and add it to the tool-name map in `superRefine`:

```ts
    Object.entries({ ...CORE_BLOCKS, ...INPUT_CORE_BLOCKS, ...MODE_CORE_BLOCKS, ...PHASE_CORE_BLOCKS }).map(([name, b]) => [blockToolName(name, b), name]),
```

- [ ] **Step 5: Check the id in the `ui` server**

In `packages/blocks/src/ui-server.ts`:

1. Change the import to `import { allBlocks, blockToolName, loadHarness, phaseIds } from "@humanharness/harness-sdk";`
2. After `INPUT_DONE`, add:

```ts
/** What the agent reads when `set_phase` names no part of this harness (task-phases spec §4.1). */
export const unknownPhase = (ids: readonly string[]): string => `Unknown part. Use one of: ${ids.join(", ")}.`;
```

3. In `createUiServer`, after `const server = …`, add `const phases = phaseIds(harness);`, and at the top of the tool's handler, before `try`:

```ts
        // The server knows the harness, not the open task: an id of another action reaches the app, which ignores it.
        if (name === "set_phase" && !phases.includes(String((args as { to?: unknown }).to))) {
          return { isError: true, content: [{ type: "text" as const, text: unknownPhase(phases) }] };
        }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/harness-sdk/test/phases.test.ts packages/blocks/test/ui-server.test.ts`
Expected: PASS. The first ui-server test (`notes-harness`) still lists exactly `save_note`, `show_choices`, `show_note`, `update_progress` (D0).

- [ ] **Step 7: Verify everything and commit**

Run: `corepack pnpm typecheck` and `corepack pnpm test`
Expected: all green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/harness-sdk packages/blocks packages/fake-agent/fixtures/phases-harness
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(blocks): set_phase core block for harnesses with phases

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

## Phase 2 — Task state, prompts and turns (spec §8 slices 1–3: the main process)

### Task 3: The prompts: the list of parts, a part's brief, a change, the wrap-up, the resume

**Files:**
- Modify: `packages/shell/src/main/task-prompts.ts`
- Test: `packages/shell/test/task-prompts.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/shell/test/task-prompts.test.ts` (add `PHASES_HOW`, `WRAP_UP_PROMPT`, `phasePrompt`, `phaseSection`, `phasesSection`, `wrapUpPrompt` to the import):

```ts
describe("phase prompts (task-phases spec §4.4, §5, §6)", () => {
  const parts = [{ id: "warmup", label: "Warm-up" }, { id: "main", label: "Main block" }, { id: "close", label: "Close" }];
  const main = { id: "main", label: "Main block", brief: "Teach in {{language}}. We came from {{previousPhase}} to {{phase}}. Time left: {{timeLeft}}" };

  it("fillPrompt fills the phase variables only when given; an empty one's own line goes", () => {
    expect(fillPrompt("{{phase}}/{{previousPhase}}/{{timeLeft}}", { language: "en", notesIndex: "" })).toBe("{{phase}}/{{previousPhase}}/{{timeLeft}}");
    expect(fillPrompt("A\n{{timeLeft}}\nB", { language: "en", notesIndex: "", phase: "Main", previousPhase: "", timeLeft: "" })).toBe("A\nB");
  });

  it("lists the parts, marks the current one and says how to move", () => {
    expect(phasesSection(parts, "warmup")).toBe(
      ["## Parts of this task", PHASES_HOW, "- `warmup` (Warm-up) ← now\n- `main` (Main block)\n- `close` (Close)"].join("\n\n"),
    );
  });

  it("a part's section: its heading and its brief filled; no brief, the heading alone", () => {
    expect(phaseSection(main, { language: "es", previous: "Warm-up", timeLeft: "about 12 minutes" })).toBe(
      "## Part: Main block\n\nTeach in Spanish. We came from Warm-up to Main block. Time left: about 12 minutes",
    );
    expect(phaseSection({ id: "close", label: "Close", brief: "" }, { language: "en" })).toBe("## Part: Close");
  });

  it("a change: the new part, the way back, the time left, the brief, extra sections, the closing line", () => {
    expect(phasePrompt(main, { language: "en", previous: "Close", back: true, timeLeft: "about 5 minutes", extra: ["## Mode: Socratic"] })).toBe(
      [
        'Next part of this task: "Main block" (`main`).',
        "The person went back to this part.",
        "Time left: about 5 minutes.",
        "Teach in English. We came from Close to Main block. Time left: about 5 minutes",
        "## Mode: Socratic",
        "Then continue with the person in this part.",
      ].join("\n\n"),
    );
    // A label is inserted once: "{{phase}}" inside it is never filled again.
    expect(phasePrompt({ id: "x", label: "{{phase}}", brief: "" }, { language: "en" }).split("\n\n")[0]).toBe('Next part of this task: "{{phase}}" (`x`).');
  });

  it("the wrap-up and its fixed start", () => {
    expect(wrapUpPrompt("es")).toBe(WRAP_UP_PROMPT.replace("{{language}}", "Spanish"));
    expect(WRAP_UP_PROMPT.startsWith("Time is almost up:")).toBe(true);
  });

  it("a resumed session carries the parts after the mode; D0 without them", () => {
    const withPart = resumeMessage({ language: "en", notesIndex: "", brief: "# Task: session", mode: "## Mode: Socratic", phase: "## Parts of this task", message: "Hi" });
    expect(withPart.indexOf("## Mode: Socratic")).toBeLessThan(withPart.indexOf("## Parts of this task"));
    expect(resumeMessage({ language: "en", notesIndex: "", brief: "# Task: session", message: "Hi" })).not.toContain("Parts of this task");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm vitest run packages/shell/test/task-prompts.test.ts`
Expected: FAIL (the new exports don't exist).

- [ ] **Step 3: Extend `fillPrompt`**

In `packages/shell/src/main/task-prompts.ts`, change `fillPrompt`'s signature and `values` (the rest of the function stays):

```ts
export function fillPrompt(
  template: string,
  vars: { language: Language; notesIndex: string; question?: string; phase?: string; previousPhase?: string; timeLeft?: string },
): string {
  const values: Record<string, string> = {
    language: languageName(vars.language),
    notesIndex: vars.notesIndex,
    ...(vars.question !== undefined ? { question: vars.question } : {}),
    // A phase's brief (task-phases spec §4.4): its label, the previous one's and the time left. Absent: left as written (D0).
    ...(vars.phase !== undefined ? { phase: vars.phase } : {}),
    ...(vars.previousPhase !== undefined ? { previousPhase: vars.previousPhase } : {}),
    ...(vars.timeLeft !== undefined ? { timeLeft: vars.timeLeft } : {}),
  };
```

Update its doc comment's first line to: "Fills `{{language}}`, `{{notesIndex}}`, `{{question}}` and a phase brief's `{{phase}}`, `{{previousPhase}}`, `{{timeLeft}}` in one pass (inserted text is never filled again)."

- [ ] **Step 4: Add the phase prompts**

Append to `packages/shell/src/main/task-prompts.ts`:

```ts
/** A part as a prompt carries it: its id, its label (one line) and its brief (the file's text, "" without one). */
export interface PhaseText {
  id: string;
  label: string;
  brief: string;
}

/** How the agent moves between parts (task-phases spec §4.1); in the first message and a resumed one. */
export const PHASES_HOW =
  "This task has parts, in order. When the current part is done, call `set_phase` at the end of your answer with the next part's id and a short reason; the app moves the task, and may ask the person first. In the last part, call `set_phase` with its own id when the task is done.";
/** A change's first line (spec §4.4). The mock replay knows a change by this start. */
export const PHASE_PROMPT = 'Next part of this task: "{{label}}" (`{{phase}}`).';
/** Said when the person went back to an earlier part (spec §4.2). */
export const PHASE_BACK = "The person went back to this part.";
/** A change's last line. */
export const PHASE_END = "Then continue with the person in this part.";
/** The time box's wrap-up turn (spec §5). The mock replay knows it by its start. */
export const WRAP_UP_PROMPT =
  "Time is almost up: finish the current point briefly, in {{language}}. Do not start anything new and do not call `show_choices`; the app moves on after your answer.";

interface PhaseVars {
  language: Language;
  /** The label of the part the task comes from. */
  previous?: string;
  /** "about 12 minutes", or "" / absent without a time box. */
  timeLeft?: string;
}

/** A part's brief filled (spec §4.4): the language, its label, the previous one's and the time left. Never the notes index. */
const phaseBrief = (p: PhaseText, vars: PhaseVars): string =>
  fillPrompt(p.brief, { language: vars.language, notesIndex: "", phase: p.label, previousPhase: vars.previous ?? "", timeLeft: vars.timeLeft ?? "" });

/** The list of the task's parts (spec §4.1): ids, labels, the current one marked. Labels come one-lined from the caller. */
export function phasesSection(phases: readonly { id: string; label: string }[], current: string): string {
  const lines = phases.map((p) => `- \`${p.id}\` (${p.label})${p.id === current ? " ← now" : ""}`).join("\n");
  return ["## Parts of this task", PHASES_HOW, lines].join("\n\n");
}

/** The current part's heading and brief: at a task's start and in a resumed session. */
export function phaseSection(p: PhaseText, vars: PhaseVars): string {
  return [`## Part: ${p.label}`, ...(p.brief ? [phaseBrief(p, vars)] : [])].join("\n\n");
}

/**
 * A change's message (spec §4.4): one turn of the same session. `extra`: sections that ride on it (a mode coming back,
 * a recommendation, modes spec §7). Inserted text is never filled again.
 */
export function phasePrompt(p: PhaseText, vars: PhaseVars & { back?: boolean; extra?: readonly string[] }): string {
  return [
    PHASE_PROMPT.replace(/\{\{(label|phase)\}\}/g, (_all, key: string) => (key === "label" ? p.label : p.id)),
    ...(vars.back ? [PHASE_BACK] : []),
    ...(vars.timeLeft ? [`Time left: ${vars.timeLeft}.`] : []),
    ...(p.brief ? [phaseBrief(p, vars)] : []),
    ...(vars.extra ?? []),
    PHASE_END,
  ].join("\n\n");
}

/** The wrap-up's message (spec §5). */
export const wrapUpPrompt = (language: Language): string => fillPrompt(WRAP_UP_PROMPT, { language, notesIndex: "" });
```

- [ ] **Step 5: The resumed session's part**

In `resumeMessage`, add to `vars` (after `mode`):

```ts
  /** The list of parts and the current part's section (task-phases spec §6), after the mode's. */
  phase?: string;
```

and change the `head` line for a brief to:

```ts
      ? [
          fillPrompt(vars.brief, { language: vars.language, notesIndex: vars.notesIndex }),
          ...(vars.mode ? [vars.mode] : []),
          ...(vars.phase ? [vars.phase] : []),
          line,
        ]
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `corepack pnpm vitest run packages/shell/test/task-prompts.test.ts`
Expected: PASS; every existing case unchanged (D0).

- [ ] **Step 7: Verify everything and commit**

Run: `corepack pnpm typecheck` and `corepack pnpm test`
Expected: all green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/shell/src/main/task-prompts.ts packages/shell/test/task-prompts.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(shell): prompts for task phases and the wrap-up

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 4: Task state keeps the phase and the time box; the time arithmetic

**Files:**
- Create: `packages/shell/src/main/time-box.ts`
- Modify: `packages/shell/src/main/task-store.ts`
- Test: `packages/shell/test/task-store.test.ts`, `packages/shell/test/time-box.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Append to `packages/shell/test/task-store.test.ts`:

```ts
describe("TaskStore: task phases and the time box (task-phases spec §6)", () => {
  const write = (folder: string, current: Record<string, unknown>) => {
    const file = path.join(folder, ".harness", "tasks.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 1, actions: {}, current: { id: "t1", action: "session", status: "waiting", startedAt: "", turns: 1, ...current } }));
  };
  const at = "2026-10-26T10:00:00.000Z";

  it("keeps a well-formed phase, its log, a proposal, a time box and a suspended mode", async () => {
    const folder = tmp();
    write(folder, {
      phase: { id: "main", startedAt: at },
      phases: [{ id: "warmup", at, by: "app" }, { id: "main", at, by: "agent" }, { id: "Bad", at, by: "app" }, { id: "close", at, by: "robot" }],
      phaseProposal: { to: "close", reason: "Done" },
      timeBox: { minutes: 30, usedMs: 1000, runningSince: at, wrappedUp: true, ended: "yes" },
      suspendedMode: "socratic",
    });
    expect((await new TaskStore(folder).load()).current).toMatchObject({
      phase: { id: "main", startedAt: at },
      phases: [{ id: "warmup", at, by: "app" }, { id: "main", at, by: "agent" }],
      phaseProposal: { to: "close", reason: "Done" },
      timeBox: { minutes: 30, usedMs: 1000, runningSince: at, wrappedUp: true },
      suspendedMode: "socratic",
    });
  });

  it("drops what is malformed: a time box without minutes, a proposal without a phase, a suspended mode next to a mode", async () => {
    const folder = tmp();
    write(folder, { phaseProposal: { to: "close", reason: "Done" }, timeBox: { usedMs: 3 }, mode: "feynman", suspendedMode: "socratic" });
    const c = (await new TaskStore(folder).load()).current;
    for (const key of ["phase", "phases", "phaseProposal", "timeBox", "suspendedMode"]) expect(c).not.toHaveProperty(key);
    expect(c).toMatchObject({ mode: "feynman" });
  });

  it("drops a phase the action no longer declares", async () => {
    const folder = tmp();
    write(folder, { phase: { id: "main", startedAt: at }, phases: [{ id: "warmup", at, by: "app" }, { id: "main", at, by: "person" }], phaseProposal: { to: "close", reason: "x" } });
    const c = (await new TaskStore(folder, { phases: { session: ["warmup", "close"] } }).load()).current;
    expect(c).not.toHaveProperty("phase");
    expect(c).not.toHaveProperty("phaseProposal");
    expect(c).toMatchObject({ phases: [{ id: "warmup", at, by: "app" }] });
    // An action that has no phases any more keeps none.
    const none = (await new TaskStore(folder, { phases: { quiz: ["a"] } }).load()).current;
    expect(none).not.toHaveProperty("phases");
  });

  it("D0: a task without phases reads with no phase fields", async () => {
    const folder = tmp();
    write(folder, {});
    expect((await new TaskStore(folder, { phases: {} }).load()).current).toEqual({ id: "t1", action: "session", status: "waiting", startedAt: "", turns: 1 });
  });
});
```

Create `packages/shell/test/time-box.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatTimeLeft, nextDue, paused, remainingMs, running, usedMs } from "../src/main/time-box";

const t0 = new Date("2026-10-26T10:00:00.000Z");
const later = (ms: number) => new Date(t0.getTime() + ms);
const MIN = 60_000;

describe("time box arithmetic (task-phases spec §5)", () => {
  it("counts used time while running, and folds it when paused", () => {
    const box = { minutes: 10, usedMs: 2 * MIN, runningSince: t0.toISOString() };
    expect(usedMs(box, later(MIN))).toBe(3 * MIN);
    expect(remainingMs(box, later(MIN))).toBe(7 * MIN);
    const p = paused(box, later(MIN));
    expect(p).toEqual({ minutes: 10, usedMs: 3 * MIN });
    expect(usedMs(p, later(5 * MIN))).toBe(3 * MIN);
    expect(running(p, later(5 * MIN))).toEqual({ minutes: 10, usedMs: 3 * MIN, runningSince: later(5 * MIN).toISOString() });
    expect(remainingMs({ minutes: 1, usedMs: 5 * MIN }, t0)).toBe(0);
  });

  it("the next step: the wrap-up at its share, then the end; nothing once both ran", () => {
    const box = { minutes: 20, usedMs: 0, runningSince: t0.toISOString() };
    expect(nextDue(box, 0.85, t0)).toEqual({ kind: "wrap-up", inMs: 17 * MIN });
    expect(nextDue(box, undefined, t0)).toEqual({ kind: "wrap-up", inMs: 20 * MIN });
    expect(nextDue({ ...box, wrappedUp: true }, 0.85, later(18 * MIN))).toEqual({ kind: "end", inMs: 2 * MIN });
    expect(nextDue({ ...box, wrappedUp: true, ended: true }, 0.85, t0)).toBeNull();
    expect(nextDue(box, 0.5, later(30 * MIN))).toEqual({ kind: "wrap-up", inMs: 0 });
    // A short minute (tests, mock mode).
    expect(nextDue(box, 0.5, t0, 1000)).toEqual({ kind: "wrap-up", inMs: 10_000 });
  });

  it("says the time left in words", () => {
    expect(formatTimeLeft(12 * MIN)).toBe("about 12 minutes");
    expect(formatTimeLeft(30_000)).toBe("about 1 minute");
    expect(formatTimeLeft(0)).toBe("none");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `corepack pnpm vitest run packages/shell/test/task-store.test.ts packages/shell/test/time-box.test.ts`
Expected: FAIL (no phase fields are kept; `time-box.ts` doesn't exist).

- [ ] **Step 3: Create `time-box.ts`**

Create `packages/shell/src/main/time-box.ts`:

```ts
import type { TimeBoxState } from "./task-store";

/** A real minute. Tests and mock mode pass a shorter one (`TaskDeps.minuteMs`). */
export const MINUTE_MS = 60_000;
/** What "+5 min" adds (spec §5 `extendTimeBox`). */
export const EXTEND_MINUTES = 5;

/** Time counted so far: what was folded in, plus the running stretch. */
export function usedMs(t: TimeBoxState, now: Date): number {
  return t.usedMs + (t.runningSince ? Math.max(0, now.getTime() - Date.parse(t.runningSince)) : 0);
}

/** Time left, never below zero. */
export function remainingMs(t: TimeBoxState, now: Date, minute = MINUTE_MS): number {
  return Math.max(0, t.minutes * minute - usedMs(t, now));
}

/** The box with the running stretch folded in and the clock stopped (pause, quit). */
export function paused(t: TimeBoxState, now: Date): TimeBoxState {
  if (!t.runningSince) return t;
  const { runningSince: _since, ...rest } = t;
  return { ...rest, usedMs: usedMs(t, now) };
}

/** The box with the clock running from `now` (resume). */
export function running(t: TimeBoxState, now: Date): TimeBoxState {
  return t.runningSince ? t : { ...t, runningSince: now.toISOString() };
}

/**
 * The next step and how far away it is: the wrap-up at `wrapUpAt` of the time (absent: at the end), then the end.
 * Null once both ran.
 */
export function nextDue(t: TimeBoxState, wrapUpAt: number | undefined, now: Date, minute = MINUTE_MS): { kind: "wrap-up" | "end"; inMs: number } | null {
  const total = t.minutes * minute;
  const used = usedMs(t, now);
  if (!t.wrappedUp) return { kind: "wrap-up", inMs: Math.max(0, (wrapUpAt ?? 1) * total - used) };
  if (!t.ended) return { kind: "end", inMs: Math.max(0, total - used) };
  return null;
}

/** The time left as a prompt says it ("about 12 minutes"). */
export function formatTimeLeft(ms: number, minute = MINUTE_MS): string {
  if (ms <= 0) return "none";
  const m = Math.ceil(ms / minute);
  return m <= 1 ? "about 1 minute" : `about ${m} minutes`;
}
```

- [ ] **Step 4: The state's fields and their checks**

In `packages/shell/src/main/task-store.ts`:

1. Change the SDK import to `import { BLOCK_ID, MODE_ID, PHASE_ID } from "@humanharness/harness-sdk";`
2. Above `CurrentTask`, add:

```ts
/** Who moved the task into a phase (task-phases spec §4.4). */
export type PhaseBy = "agent" | "person" | "app";
/** One entry of the phase log: the phase entered, when, and by whom. */
export interface PhaseLogEntry {
  id: string;
  at: string;
  by: PhaseBy;
}
/** The task's time box (spec §5): minutes chosen, time folded in, and since when the clock runs (absent: paused). */
export interface TimeBoxState {
  minutes: number;
  usedMs: number;
  runningSince?: string;
  /** The wrap-up ran: it never runs again, even after "+5 min". */
  wrappedUp?: true;
  /** The 100% step ran; "+5 min" clears it so it runs again at the new end. */
  ended?: true;
}
```

3. At the end of `CurrentTask`, add:

```ts
  /** The phase the task is in now (task-phases spec §6). Absent: an action without phases (D0). */
  phase?: { id: string; startedAt: string };
  /** Every phase change, oldest first, at most PHASE_LOG_MAX. */
  phases?: PhaseLogEntry[];
  /** The agent asked to move and the person hasn't answered (spec §4.1). */
  phaseProposal?: { to: string; reason: string };
  /** The time box chosen at the start (spec §5). */
  timeBox?: TimeBoxState;
  /** A mode the current phase doesn't allow, kept to come back (modes spec §7). Never next to `mode`. */
  suspendedMode?: string;
```

4. After `MODES_MAX`, add:

```ts
/** How many phase changes tasks.json keeps for a task: a bound on a hand-edited file. */
export const PHASE_LOG_MAX = 200;
/** The longest time box a task can reach with "+5 min": a bound on a hand-edited file. */
const TIME_BOX_MINUTES_MAX = 24 * 60;
const PHASE_BY: readonly string[] = ["agent", "person", "app"];

/** What the manifest declares, when known: mode ids, and each action's phase ids. */
interface Known {
  modes?: ReadonlySet<string>;
  phases?: ReadonlyMap<string, readonly string[]>;
}

function cleanTimeBox(t: unknown): TimeBoxState | undefined {
  if (!isObject(t)) return undefined;
  const { minutes, usedMs, runningSince } = t;
  if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 1 || minutes > TIME_BOX_MINUTES_MAX) return undefined;
  if (typeof usedMs !== "number" || !Number.isFinite(usedMs) || usedMs < 0) return undefined;
  const since = typeof runningSince === "string" && Number.isFinite(Date.parse(runningSince)) ? runningSince : undefined;
  return {
    minutes,
    usedMs,
    ...(since ? { runningSince: since } : {}),
    ...(t.wrappedUp === true ? { wrappedUp: true as const } : {}),
    ...(t.ended === true ? { ended: true as const } : {}),
  };
}
```

(`isObject` is declared above `cleanSession` today; keep `cleanTimeBox` below it.)

5. Change `cleanCurrent`'s signature to `function cleanCurrent(c: unknown, known: Known = {}): CurrentTask | null {`, its mode check to `(!known.modes || known.modes.has(v))`, and add, after the `modes` line:

```ts
  // A phase the action no longer declares is dropped (task-phases spec §6); `known.phases` absent: the shape alone.
  const action = typeof c.action === "string" ? c.action : undefined;
  const declared = known.phases ? ((action !== undefined ? known.phases.get(action) : undefined) ?? []) : undefined;
  const isPhase = (v: unknown): v is string => typeof v === "string" && PHASE_ID.test(v) && (!declared || declared.includes(v));
  const phase = isObject(c.phase) && isPhase(c.phase.id) && typeof c.phase.startedAt === "string" ? { id: c.phase.id, startedAt: c.phase.startedAt } : undefined;
  const log = Array.isArray(c.phases)
    ? c.phases
        .filter((e): e is PhaseLogEntry => isObject(e) && isPhase(e.id) && typeof e.at === "string" && PHASE_BY.includes(e.by as string))
        .map((e) => ({ id: e.id, at: e.at, by: e.by }))
        .slice(-PHASE_LOG_MAX)
    : [];
  const p = c.phaseProposal;
  const proposal = phase && isObject(p) && isPhase(p.to) && typeof p.reason === "string" ? { to: p.to, reason: p.reason.slice(0, 300) } : undefined;
  const timeBox = cleanTimeBox(c.timeBox);
```

and at the end of the returned object:

```ts
    ...(phase ? { phase } : {}),
    ...(log.length > 0 ? { phases: log } : {}),
    ...(proposal ? { phaseProposal: proposal } : {}),
    ...(timeBox ? { timeBox } : {}),
    ...(!mode && isMode(c.suspendedMode) ? { suspendedMode: c.suspendedMode } : {}),
```

6. Change `clean(raw, known?)` to `function clean(raw: unknown, known: Known = {}): TasksFile {`, and `TaskStore`'s field and constructor to:

```ts
  /** The manifest's mode ids and each action's phase ids, when given: what tasks.json names outside them is dropped. */
  private readonly known: Known;

  constructor(folder: string, opts: { modes?: readonly string[]; phases?: Record<string, readonly string[]> } = {}) {
    this.file = tasksFile(folder);
    this.known = {
      ...(opts.modes ? { modes: new Set(opts.modes) } : {}),
      ...(opts.phases ? { phases: new Map(Object.entries(opts.phases)) } : {}),
    };
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/shell/test/task-store.test.ts packages/shell/test/time-box.test.ts`
Expected: PASS; the existing modes cases unchanged.

- [ ] **Step 6: Verify everything and commit**

Run: `corepack pnpm typecheck` and `corepack pnpm test`
Expected: all green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/shell/src/main/task-store.ts packages/shell/src/main/time-box.ts packages/shell/test/task-store.test.ts packages/shell/test/time-box.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(shell): tasks.json keeps the phase and the time box

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 5: Turns carry the phase: usage, system lines, input ids and the history trailer

**Files:**
- Modify: `packages/shell/src/main/usage-log.ts`, `packages/shell/src/main/turn-controller.ts`, `packages/shell/src/main/tasks.ts`, `packages/ui/src/client.ts`, `packages/workspace/src/history.ts`, `packages/shell/src/main/history-view.ts`, `packages/cli/src/record.ts`
- Test: `packages/shell/test/turn-controller.test.ts`, `packages/shell/test/usage-log.test.ts`, `packages/workspace/test/history.test.ts`, `packages/shell/test/history-view.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/shell/test/turn-controller.test.ts` (add `type Event` to its `@humanharness/runtime` import if it isn't there):

```ts
describe("TurnController: phases (task-phases spec §4.4, §5, §6)", () => {
  function phaseSetup(inputBlocks?: string[]) {
    const rt = fakeRuntime();
    const entries: ChatEntry[] = [];
    const metas: UsageMeta[] = [];
    const events: Event[] = [];
    const controller = new TurnController({
      ensureRuntime: async () => rt.runtime,
      chatLog: async () => ({ append: async (e: ChatEntry) => void entries.push(e) }),
      stateBlocks: () => new Set(),
      ...(inputBlocks ? { inputBlocks: () => new Set(inputBlocks) } : {}),
      emit: (e) => void events.push(e),
      recordUsage: async (_entry, meta) => void metas.push(meta),
    });
    return { rt, controller, entries, metas, events };
  }

  it("a phase change's user entry is the separator; usage has the turn kind and the task's phase; the trailer the phase", async () => {
    const t = phaseSetup(["recall"]);
    const sent = t.controller.send("Next part of this task: …", {
      task: "t1",
      action: "session",
      followUp: true,
      display: "— Main block —",
      phase: "phase-change",
      phaseChange: "main",
      taskPhase: "main",
      turn: 2,
    });
    await vi.waitFor(() => expect(t.rt.send).toHaveBeenCalled());
    t.rt.finish([{ type: "block", name: "recall", data: {} }, { type: "done", ok: true }]);
    await sent;
    await t.controller.flush();
    expect(t.entries[0]).toMatchObject({ role: "user", text: "— Main block —", phase: "main", task: "t1" });
    expect(t.metas[0]).toMatchObject({ phase: "phase-change", taskPhase: "main" });
    expect(t.rt.send.mock.calls[0][2]).toEqual({ trailer: { task: "t1", action: "session", phase: "main" } });
    // Input blocks get ids in a phase change turn too.
    expect(t.events.find((e) => e.type === "block")).toMatchObject({ id: "t1:2:0" });
  });

  it("the wrap-up's user entry says the time is up", async () => {
    const t = phaseSetup();
    const sent = t.controller.send("Time is almost up: …", { task: "t1", followUp: true, display: "Time is almost up", phase: "wrap-up", wrapUp: true, taskPhase: "main" });
    await vi.waitFor(() => expect(t.rt.send).toHaveBeenCalled());
    t.rt.finish([{ type: "done", ok: true }]);
    await sent;
    await t.controller.flush();
    expect(t.entries[0]).toMatchObject({ role: "user", text: "Time is almost up", timeUp: true });
    expect(t.metas[0]).toMatchObject({ phase: "wrap-up", taskPhase: "main" });
  });

  it("D0: a turn without a phase has none anywhere", async () => {
    const t = phaseSetup();
    const sent = t.controller.send("Go on", { task: "t1", action: "quiz", followUp: true });
    await vi.waitFor(() => expect(t.rt.send).toHaveBeenCalled());
    t.rt.finish([{ type: "done", ok: true }]);
    await sent;
    await t.controller.flush();
    for (const key of ["phase", "timeUp"]) expect(t.entries[0]).not.toHaveProperty(key);
    expect(t.metas[0]).not.toHaveProperty("taskPhase");
    expect(t.rt.send.mock.calls[0][2]).toEqual({ trailer: { task: "t1", action: "quiz" } });
  });
});
```

Append to `packages/shell/test/usage-log.test.ts` (import `usageRecord` and `compactionRecord` from `../src/main/usage-log` if the file doesn't yet):

```ts
describe("usage lines carry the task's phase (task-phases spec §6)", () => {
  it("records taskPhase and the new turn kinds; D0 without them", () => {
    const entry = {
      id: "a",
      role: "assistant" as const,
      text: "",
      blocks: [],
      activities: [],
      at: "2026-10-26T10:00:00.000Z",
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };
    expect(usageRecord(entry, "claude", { task: "t1", phase: "phase-change", taskPhase: "main" })).toMatchObject({ phase: "phase-change", taskPhase: "main" });
    expect(usageRecord(entry, "claude", { task: "t1", phase: "run" })).not.toHaveProperty("taskPhase");
    expect(compactionRecord("claude", { task: "t1", taskPhase: "close" }, "2026-10-26T10:00:00.000Z")).toMatchObject({ kind: "compaction", taskPhase: "close" });
  });
});
```

In `packages/workspace/test/history.test.ts`, next to the existing `withTrailer` / `parseCommitMessage` cases, add:

```ts
  it("writes and reads the Phase trailer (task-phases spec §6); D0 without it", () => {
    expect(withTrailer("Before message", { task: "t1", action: "session", phase: "main" })).toBe("Before message\n\nTask: t1\nAction: session\nPhase: main");
    expect(withTrailer("x", { task: "t1", phase: "bad phase" })).toBe("x\n\nTask: t1");
    expect(parseCommitMessage("Before message\n\nTask: t1\nAction: session\nPhase: main")).toEqual({ subject: "Before message", task: "t1", action: "session", phase: "main" });
    expect(parseCommitMessage("Note: x\n\nTask: t1\nAction: plan\n")).not.toHaveProperty("phase");
  });
```

Append to `packages/shell/test/history-view.test.ts`:

```ts
describe("historyView: phases (task-phases spec §6)", () => {
  it("passes each entry's phase to the window; D0 without one", () => {
    const date = new Date("2026-10-26T10:00:00.000Z");
    const [view] = historyView([
      {
        taskId: "t1",
        actionId: "session",
        start: null,
        end: "b".repeat(40),
        date,
        changes: [],
        entries: [
          { sha: "b".repeat(40), message: "Turn: x", date, task: "t1", action: "session", phase: "main" },
          { sha: "a".repeat(40), message: "Before message", date, task: "t1", action: "session" },
        ],
      },
    ]);
    expect(view.entries).toEqual([
      { sha: "b".repeat(40), message: "Turn: x", date: date.toISOString(), phase: "main" },
      { sha: "a".repeat(40), message: "Before message", date: date.toISOString() },
    ]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `corepack pnpm vitest run packages/shell/test/turn-controller.test.ts packages/shell/test/usage-log.test.ts packages/workspace/test/history.test.ts packages/shell/test/history-view.test.ts`
Expected: FAIL (type errors on the new options; no `phase`/`timeUp` on entries; no `Phase:` trailer).

- [ ] **Step 3: Usage**

In `packages/shell/src/main/usage-log.ts`:

1. Above `UsageMeta`, add:

```ts
/**
 * What kind of turn it was: `run` (the task's own turns), `close` (the turn that asks for its note), `checkpoint` (the
 * quiet note before the cap), `phase-change` (the brief of the phase the task enters) and `wrap-up` (the time box's
 * last turn before the close phase). Not the task's phase: that is `taskPhase`.
 */
export type TurnKind = "run" | "close" | "checkpoint" | "phase-change" | "wrap-up";
```

2. In `UsageMeta` and `UsageRecord`, change `phase?: "run" | "close" | "checkpoint";` to `phase?: TurnKind;` (`UsageMeta`'s doc comment on it becomes "The turn's kind (TurnKind)."), and add after `mode`:

```ts
  /** The task's phase while the turn ran (task-phases spec §6). Absent without phases. */
  taskPhase?: string;
```

3. In `metaFields`, after the `mode` line, add `...(meta.taskPhase ? { taskPhase: meta.taskPhase } : {}),`.
4. In `packages/shell/src/main/tasks.ts` (what the CLI imports as `@humanharness/shell/tasks`), export the type: `export type { TurnKind } from "./usage-log";`.

- [ ] **Step 4: The turn controller**

In `packages/shell/src/main/turn-controller.ts`:

1. Change the usage import to `import { type TurnKind, type UsageMeta, profileMeta } from "./usage-log";`.
2. In `TurnOptions`, change `phase` to:

```ts
  /** The turn's kind (TurnKind): `run` by default. */
  phase?: TurnKind;
```

and add after `modeSwitch`:

```ts
  /** The task's phase while this turn runs: usage.jsonl and the history trailer record it (task-phases spec §6). */
  taskPhase?: string;
  /** The task enters this phase: the chat's user entry is a separator line naming it, never the brief (spec §4.4). */
  phaseChange?: string;
  /** The time box's wrap-up: the chat's user entry is a system line saying the time is almost up (spec §5). */
  wrapUp?: boolean;
```

3. Above `isHeld`, add:

```ts
/** The task's own work, whose input blocks get ids (input-blocks spec §4): never the closing or checkpoint turn. */
export const takesInputs = (phase: TurnKind | undefined): boolean => phase === undefined || phase === "run" || phase === "phase-change" || phase === "wrap-up";
```

4. In `run`, add `taskPhase, phaseChange, wrapUp` to the destructured options. In the user entry, after the `mode` line, add:

```ts
          // `phaseChange` and `wrapUp` always come with `display`: the chat shows the line, never the prompt.
          ...(phaseChange ? { phase: phaseChange } : {}),
          ...(wrapUp ? { timeUp: true as const } : {}),
```

Change `const inputs = turn !== undefined && task && (phase ?? "run") === "run" ? …` to `const inputs = turn !== undefined && task && takesInputs(phase) ? …`. In `meta()`, after the `mode` line, add `...(taskPhase ? { taskPhase } : {}),`. Change the trailer passed to `rt.send` to:

```ts
        ...(task ? { trailer: { task, ...(action ? { action } : {}), ...(scope ? { scope } : {}), ...(taskPhase ? { phase: taskPhase } : {}) } } : {}),
```

- [ ] **Step 5: The chat entry and the history item**

In `packages/ui/src/client.ts`, in `ChatEntry` after `mode`, add:

```ts
  /** The task entered this phase (task-phases spec §4.4): this user entry is a separator line, and this is the phase's id. */
  phase?: string;
  /** The time box's wrap-up (spec §5): this user entry is a system line. */
  timeUp?: true;
```

and replace `HistoryItem` with:

```ts
export interface HistoryItem {
  sha: string;
  message: string;
  date: string;
  /** The task's phase when the commit was made (its `Phase:` trailer). */
  phase?: string;
}
```

- [ ] **Step 6: The Phase trailer**

In `packages/workspace/src/history.ts`:

1. Add `phase?: string;` to `HistoryEntry` (after `scope`, doc "The task's phase (its `Phase:` trailer), only for an action with phases.") and to `HistoryTrailer` (doc "The task's phase now (task-phases spec §6); only for an action with phases.").
2. In `withTrailer`, after the `Scope:` line, add:

```ts
  if (trailer.phase !== undefined && TRAILER_ID.test(trailer.phase)) lines.push(`Phase: ${trailer.phase}`);
```

3. Change `TRAILER_LINE` to `/^(Task|Action|Scope|Phase): \S+$/` and `parseCommitMessage` to:

```ts
export function parseCommitMessage(raw: string): { subject: string; task: string | null; action: string | null; scope?: string; phase?: string } {
  const text = raw.replace(/\r\n/g, "\n").trim();
  const paragraphs = text.split(/\n{2,}/);
  const last = paragraphs.length > 1 ? paragraphs[paragraphs.length - 1] : "";
  const trailers = last.split("\n").every((line) => TRAILER_LINE.test(line)) ? last : "";
  const value = (key: string): string | null => {
    const m = new RegExp(`^${key}: (.+)$`, "m").exec(trailers);
    return m && TRAILER_ID.test(m[1]) ? m[1] : null;
  };
  const scope = /^Scope: (.+)$/m.exec(trailers)?.[1];
  const phase = value("Phase");
  return {
    subject: text.split("\n")[0],
    task: value("Task"),
    action: value("Action"),
    ...(isScopeDir(scope) ? { scope } : {}),
    ...(phase ? { phase } : {}),
  };
}
```

4. In `listWith`, read and pass it:

```ts
      const { subject, task, action, scope, phase } = parseCommitMessage(e.commit.message);
      return { sha: e.oid, message: subject, date: new Date(e.commit.author.timestamp * 1000), task, action, ...(scope ? { scope } : {}), ...(phase ? { phase } : {}) };
```

In `packages/shell/src/main/history-view.ts`, change the entries line to:

```ts
      entries: g.entries.map((e) => ({ sha: e.sha, message: e.message, date: e.date.toISOString(), ...(e.phase ? { phase: e.phase } : {}) })),
```

- [ ] **Step 7: The recorder's type**

In `packages/cli/src/record.ts`, add `import type { TurnKind } from "@humanharness/shell/tasks";` and change `turnEnded`'s first parameter type to `meta: { action?: string; task?: string; phase?: TurnKind; taskPhase?: string }`. (Its behaviour for the new kinds comes in Task 14.)

- [ ] **Step 8: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/shell/test/turn-controller.test.ts packages/shell/test/usage-log.test.ts packages/workspace/test/history.test.ts packages/shell/test/history-view.test.ts`
Expected: PASS; existing trailer and usage cases unchanged (D0).

- [ ] **Step 9: Verify everything and commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test` and `corepack pnpm app:build`
Expected: all green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/shell packages/ui/src/client.ts packages/workspace packages/cli/src/record.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(shell): turns carry the task's phase into usage, chat and history

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 6: A task moves through its phases: the start, `set_phase`, `setPhase`, the change turn, the resume, the view

**Files:**
- Modify: `packages/shell/src/main/task-manager.ts`, `packages/ui/src/client.ts`
- Test: `packages/shell/test/task-manager-phases.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/shell/test/task-manager-phases.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ModelProfile } from "@humanharness/engines";
import type { HarnessPhase, HarnessTimeBox, SavedNote } from "@humanharness/harness-sdk";
import type { Event } from "@humanharness/runtime";
import type { TaskTurnNotice, TaskView } from "@humanharness/ui/client";
import type { NoteMeta } from "@humanharness/workspace";
import { TaskManager } from "../src/main/task-manager";
import { CLOSE_PROMPT, PHASE_BACK, phasePrompt, phaseSection, phasesSection, resumeMessage } from "../src/main/task-prompts";
import { type TasksFile, emptyTasks } from "../src/main/task-store";
import type { TurnOptions } from "../src/main/turn-controller";

const ok: Event = { type: "done", ok: true };
const NOW = "2026-10-26T10:00:00.000Z";
const NOTE: SavedNote = { title: "Fractions", summary: ["Two halves make a whole."], decisions: [], files: [], open: [] };
const saveNote: Event = { type: "block", name: "save_note", data: NOTE };
const ask = (to: string, reason = "Done here"): Event => ({ type: "block", name: "set_phase", data: { to, reason } });
const PHASES: HarnessPhase[] = [
  { id: "warmup", label: "Warm-up", brief: "phases/warmup.md", auto: true },
  { id: "main", label: "Main block", brief: "phases/main.md" },
  { id: "close", label: "Close", brief: "phases/close.md", close: true },
];
const LIST = [
  { id: "warmup", label: "Warm-up" },
  { id: "main", label: "Main block" },
  { id: "close", label: "Close" },
];
const brief = (phase: string) => `Brief of ${phase} in {{language}}.`;
const text = (id: string, label: string) => ({ id, label, brief: brief(id) });
const profile: ModelProfile = { engine: "claude", tier: "standard", model: "sonnet", effort: "medium", cap: 200_000 };

/** A task manager over memory: `session` has phases (and, when asked, modes and a time box); `quiz` has none. */
export function setup(
  opts: { script?: Event[][]; state?: TasksFile; phases?: HarnessPhase[]; modes?: { modes: string[]; defaultMode?: string }; timeBox?: HarnessTimeBox; gate?: Promise<void> } = {},
) {
  let state = opts.state ?? emptyTasks();
  const script = [...(opts.script ?? [])];
  const turns: { message: string; options: TurnOptions }[] = [];
  const views: TaskView[] = [];
  const notices: TaskTurnNotice[] = [];
  const written: { slug: string; note: SavedNote; meta: NoteMeta }[] = [];
  const emitted: Event[] = [];
  let clock = Date.parse(NOW);
  let busy = false;
  let gate = opts.gate;
  let n = 0;
  const manager = new TaskManager({
    store: {
      load: async () => structuredClone(state),
      save: async (s) => {
        state = structuredClone(s);
      },
    },
    turns: {
      isBusy: () => busy,
      cancel: () => {},
      send: async (message, options) => {
        busy = true;
        turns.push({ message, options });
        // `gate` holds the first turn only.
        const g = gate;
        gate = undefined;
        await g;
        for (const e of script.shift() ?? [ok]) options.onEvent?.(e);
        busy = false;
      },
    },
    actions: {
      session: { label: "Session", phases: opts.phases ?? PHASES, ...(opts.modes ?? {}), ...(opts.timeBox ? { timeBox: opts.timeBox } : {}) },
      quiz: { label: "Quiz" },
    },
    path: ["session", "quiz"],
    readPrompt: async (action) => `# Task: ${action}\n\n{{notesIndex}}`,
    readPhaseBrief: async (_action, phase) => brief(phase),
    taskTurn: (notice) => void notices.push(notice),
    language: async () => "en",
    engine: async () => "claude",
    notes: async () => [],
    writeNote: async (slug, note, meta) => void written.push({ slug, note, meta }),
    endSession: async () => {},
    changed: (v) => views.push(v),
    emit: (e) => void emitted.push(e),
    profileFor: async () => profile,
    ...(opts.modes
      ? {
          modes: { socratic: { label: "Socratic" }, feynman: { label: "Feynman" } },
          readModeBrief: async (mode: string) => `Brief of ${mode}.`,
          modeSettings: async () => [],
          tierOf: async () => "standard" as const,
        }
      : {}),
    minuteMs: 1000,
    now: () => new Date(clock),
    newId: () => `t${++n}`,
  });
  return {
    manager,
    turns,
    views,
    notices,
    written,
    emitted,
    state: () => state,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("TaskManager: phases (task-phases spec §4)", () => {
  it("D0: an action without phases starts and runs exactly as before", async () => {
    const t = setup();
    await t.manager.start("quiz");
    await t.manager.ask("Go on");
    expect(t.turns[0].message).toBe("# Task: quiz");
    for (const turn of t.turns) expect(turn.options).not.toHaveProperty("taskPhase");
    for (const key of ["phase", "phases", "phaseProposal", "timeBox", "suspendedMode"]) expect(t.state().current).not.toHaveProperty(key);
    expect(t.views.at(-1)?.current).toEqual({ id: "t1", action: "quiz", status: "waiting" });
    expect(t.notices).toEqual([]);
  });

  it("a task starts in its first phase: the parts listed, the first part's brief, the phase in state, turns and view", async () => {
    const t = setup();
    await t.manager.start("session");
    expect(t.turns[0].message).toBe(`# Task: session\n\n${phasesSection(LIST, "warmup")}\n\n${phaseSection(text("warmup", "Warm-up"), { language: "en" })}`);
    expect(t.turns[0].options).toMatchObject({ taskPhase: "warmup" });
    expect(t.state().current).toMatchObject({ phase: { id: "warmup", startedAt: NOW }, phases: [{ id: "warmup", at: NOW, by: "app" }] });
    expect(t.views.at(-1)?.current).toMatchObject({ phase: "warmup", phases: [{ id: "warmup", at: NOW, by: "app" }] });
    expect(t.notices).toEqual([]);
  });

  it("auto and the next phase: the app moves right after the turn, in the same operation, and tells the window first", async () => {
    const t = setup({ script: [[ask("main", "Recall done"), ok], [ok]] });
    await t.manager.start("session");
    expect(t.turns).toHaveLength(2);
    expect(t.turns[1].message).toBe(phasePrompt(text("main", "Main block"), { language: "en", previous: "Warm-up" }));
    expect(t.turns[1].options).toMatchObject({ phase: "phase-change", phaseChange: "main", taskPhase: "main", display: "— Main block —", followUp: true });
    expect(t.notices).toEqual([{ task: "t1", kind: "phase", phase: "main", by: "agent" }]);
    expect(t.state().current).toMatchObject({
      status: "waiting",
      turns: 2,
      phase: { id: "main" },
      phases: [
        { id: "warmup", by: "app" },
        { id: "main", by: "agent" },
      ],
    });
  });

  it("a skip (or no auto, or going back): a proposal the person confirms or ignores", async () => {
    const t = setup({ script: [[ask("close"), ok]] });
    await t.manager.start("session");
    expect(t.turns).toHaveLength(1);
    expect(t.state().current).toMatchObject({ phase: { id: "warmup" }, phaseProposal: { to: "close", reason: "Done here" } });
    expect(t.views.at(-1)?.current).toMatchObject({ phaseProposal: { to: "close", reason: "Done here" } });
    // Ignored: anything the person sends drops it.
    await t.manager.ask("Wait, one more question");
    expect(t.state().current).not.toHaveProperty("phaseProposal");
  });

  it("an id this action doesn't have, or a request in the closing turn, is ignored", async () => {
    const t = setup({ script: [[ask("dessert"), ok], [ask("main"), saveNote, ok]] });
    await t.manager.start("session");
    expect(t.state().current).not.toHaveProperty("phaseProposal");
    expect(t.state().current?.phase?.id).toBe("warmup");
    await t.manager.finish();
    expect(t.turns).toHaveLength(2);
    expect(t.turns[1].message).toBe(CLOSE_PROMPT);
    expect(t.turns[1].options).toMatchObject({ phase: "close", taskPhase: "warmup" });
  });

  it("the person moves: forward, back (said so), the same phase; refusals as data", async () => {
    const t = setup();
    await t.manager.start("session");
    let r = t.manager.setPhase("close", "t1");
    expect(await r.accepted).toEqual({ ok: true, changed: "turn" });
    await r.done;
    expect(t.notices.at(-1)).toEqual({ task: "t1", kind: "phase", phase: "close", by: "person" });
    r = t.manager.setPhase("main", "t1");
    expect(await r.accepted).toEqual({ ok: true, changed: "turn" });
    await r.done;
    expect(t.turns.at(-1)!.message).toBe(phasePrompt(text("main", "Main block"), { language: "en", previous: "Close", back: true }));
    expect(t.turns.at(-1)!.message).toContain(PHASE_BACK);
    expect(t.notices.at(-1)).toEqual({ task: "t1", kind: "phase", phase: "main", by: "person", back: true });
    const before = t.turns.length;
    expect(await t.manager.setPhase("main", "t1").accepted).toEqual({ ok: true, changed: "same" });
    expect(await t.manager.setPhase("dessert", "t1").accepted).toEqual({ ok: false, reason: "unknown" });
    expect(await t.manager.setPhase("main", "t9").accepted).toEqual({ ok: false, reason: "no-task" });
    expect(t.turns).toHaveLength(before);
  });

  it("a phase pick never waits for a turn: it is refused while one runs", async () => {
    let open!: () => void;
    const t = setup({ gate: new Promise<void>((resolve) => (open = resolve)) });
    const started = t.manager.start("session");
    await expect(t.manager.setPhase("main", "t1").accepted).rejects.toThrow("A turn is already running");
    open();
    await started;
  });

  it("a phase with no brief changes only the state: no turn, no notice", async () => {
    const t = setup({ phases: [PHASES[0], { id: "main", label: "Main block" }] });
    await t.manager.start("session");
    const r = t.manager.setPhase("main", "t1");
    expect(await r.accepted).toEqual({ ok: true, changed: "quiet" });
    await r.done;
    expect(t.turns).toHaveLength(1);
    expect(t.notices).toEqual([]);
    expect(t.state().current).toMatchObject({ status: "waiting", phase: { id: "main" } });
  });

  it("a resumed session tells the agent the parts and the current part", async () => {
    const current = { id: "t1", action: "session", status: "waiting" as const, startedAt: "", turns: 2, phase: { id: "main", startedAt: NOW }, resume: true as const };
    const t = setup({ state: { version: 1, actions: {}, current } });
    await t.manager.ask("Hi");
    const phase = `${phasesSection(LIST, "main")}\n\n${phaseSection(text("main", "Main block"), { language: "en" })}`;
    expect(t.turns[0].message).toBe(resumeMessage({ language: "en", notesIndex: "", brief: "# Task: session\n\n{{notesIndex}}", phase, message: "Hi" }));
    expect(t.turns[0].options).toMatchObject({ taskPhase: "main" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm vitest run packages/shell/test/task-manager-phases.test.ts`
Expected: FAIL (`setPhase`, `readPhaseBrief`, `taskTurn`, `minuteMs` don't exist; the first message has no parts).

- [ ] **Step 3: The client's types**

In `packages/ui/src/client.ts`:

1. Above `AppState`, add:

```ts
/** A phase as the window shows it (task-phases spec §6): never its brief. */
export interface PhaseView {
  id: string;
  label: string;
  auto?: true;
  close?: true;
  /** The modes allowed in it (modes spec §7): absent or "any", all the action's; "none"; or a list. */
  modes?: "any" | "none" | string[];
}

/**
 * A turn the main process starts on its own is about to run (task-phases spec §4.4, §5): a phase change (`phase`, who
 * moved, `back` when it went back) or the time box's wrap-up. The window draws its line, then the turn's events follow.
 */
export interface TaskTurnNotice {
  task: string;
  kind: "phase" | "wrap-up";
  phase?: string;
  by?: "agent" | "person" | "app";
  back?: true;
}

/**
 * How a phase pick went (spec §4.2): a change turn runs ("turn"), only the state changed ("quiet"), it already was the
 * phase ("same"), or the close phase's Finish closes the task ("closing"). Refusals: no task waits ("no-task"), or the
 * action has no such phase ("unknown").
 */
export type PhaseResult = { ok: true; changed: "turn" | "quiet" | "same" | "closing" } | { ok: false; reason: "no-task" | "unknown" };
```

2. In `CurrentTaskView`, after `belowMinTier`, add:

```ts
  /** Task phases (task-phases spec §6), only for a task whose action has them: the phase now, its log, the agent's proposal. */
  phase?: string;
  phases?: { id: string; at: string; by: "agent" | "person" | "app" }[];
  phaseProposal?: { to: string; reason: string };
```

- [ ] **Step 4: The deps, the start and the turn's phase**

In `packages/shell/src/main/task-manager.ts`:

1. Imports: add `type HarnessPhase`, `type HarnessTimeBox`, `type PhaseRequest`, `setPhaseSchema` to the `@humanharness/harness-sdk` import; `type PhaseResult`, `type TaskTurnNotice` to the `@humanharness/ui/client` import; `type PhaseText`, `phasePrompt`, `phaseSection`, `phasesSection` to the `./task-prompts` import; `PHASE_LOG_MAX`, `type PhaseBy` to the `./task-store` import; change the turn-controller import to `import { type TurnOptions, isHeld, takesInputs } from "./turn-controller";`; and add `import { MINUTE_MS, formatTimeLeft, remainingMs } from "./time-box";`.

2. In `TaskDeps`, change `actions` to:

```ts
  /**
   * The harness's actions: their labels (English strings), where each runs with scopes, their modes (task-modes spec
   * §3), their phases and time box (task-phases spec §3).
   */
  actions: Record<string, { label: string; scope?: ScopeMode; modes?: string[]; defaultMode?: string; phases?: HarnessPhase[]; timeBox?: HarnessTimeBox }>;
```

and add after `tierOf`:

```ts
  /** The text of a phase's brief (its file); only asked for a phase that has one. */
  readPhaseBrief?(action: string, phase: string): Promise<string>;
  /** A turn the app starts on its own is about to run (task-phases spec §4.4, §5): tell the window before its events. */
  taskTurn?(notice: TaskTurnNotice): void;
  /** How long a time-box minute lasts. Absent: a real minute. Tests and mock mode pass a short one. */
  minuteMs?: number;
```

3. Below `SO_FAR_CHARS`, add:

```ts
/**
 * What entering a phase does, worked out before anything changes (a brief that can't be read changes nothing): the change
 * turn's message (null: no turn) and the task's mode fields afterwards (modes spec §7; absent: unchanged).
 */
interface PhasePlan {
  message: string | null;
  modes?: { mode?: string; modes?: string[]; suspendedMode?: string; belowMinTier?: true };
}
```

4. In the class, next to `lastDone`, add:

```ts
  /** The agent's last `set_phase` in the turn that just ran (spec §4.1); `afterRun` reads it once. */
  private lastPhaseAsk: PhaseRequest | null = null;
  /** How long a time-box minute lasts. */
  private readonly minute: number;
```

and in the constructor `this.minute = d.minuteMs ?? MINUTE_MS;`.

5. Add the public `setPhase` after `chooseMode`:

```ts
  /**
   * The person moves the open task to phase `to` (task-phases spec §4.2), only while it waits: unlike a mode pick, it
   * never waits for a turn. `accepted` resolves with a refusal or with how the change goes on, before any turn's events;
   * `done` once its turn ended. Both reject when the operation can't run (a turn runs, the app is closing). `task`: the
   * open task the caller saw.
   */
  setPhase(to: string, task?: string): { accepted: Promise<PhaseResult>; done: Promise<void> } {
    let settled = false;
    let take!: (r: PhaseResult) => void;
    let refuse!: (err: unknown) => void;
    const accepted = new Promise<PhaseResult>((resolve, reject) => {
      take = (r) => {
        settled = true;
        resolve(r);
      };
      refuse = reject;
    });
    const done = this.op(() => this.phaseNow(to, take, task)).then(
      () => {
        if (!settled) refuse(new Error("The phase was not changed"));
      },
      (err: unknown) => {
        if (!settled) refuse(err);
        throw err;
      },
    );
    return { accepted, done };
  }
```

6. In `startNow`, after `const text = …` (the mode brief), add:

```ts
    // The task starts in its first phase (task-phases spec §4.4); read before anything closes, like the mode's brief.
    const first = this.phasesOf(action)[0];
    const firstText = first ? await this.phaseText(action, first) : null;
```

replace the `inMode` line and the `begin` call with:

```ts
    const inMode = start !== null && start !== "recommend" ? { mode: start, modes: [start] } : {};
    const at = this.now().toISOString();
    const inPhase = first ? { phase: { id: first.id, startedAt: at }, phases: [{ id: first.id, at, by: "app" as const }] } : {};
    await this.begin(
      { action, ...inMode, ...inPhase },
      where,
      (notesIndex) => {
        const parts = first && firstText ? [phasesSection(this.phaseList(action), first.id), phaseSection(firstText, { language })] : [];
        return [fillPrompt(template, { language, notesIndex }), ...(section ? [section] : []), ...parts].join("\n\n");
      },
      display ?? this.d.actions[action].label,
      floor,
    );
```

and widen `begin`'s `task` parameter type to:

```ts
    task: {
      action?: string;
      question?: string;
      questionCut?: true;
      mode?: string;
      modes?: string[];
      suspendedMode?: string;
      phase?: { id: string; startedAt: string };
      phases?: { id: string; at: string; by: PhaseBy }[];
      timeBox?: { minutes: number; usedMs: number; runningSince?: string };
    },
```

7. Add the phase helpers after `modeText`:

```ts
  /** The phases of `action`; none for a free question or an action without them (D0). */
  private phasesOf(action: string | undefined): HarnessPhase[] {
    return this.known(action) ? (this.d.actions[action].phases ?? []) : [];
  }

  /** The phase the task is in now, as the manifest declares it. */
  private phaseOf(c: Pick<CurrentTask, "action" | "phase">): HarnessPhase | undefined {
    return this.phasesOf(c.action).find((p) => p.id === c.phase?.id);
  }

  /** The action's phases as the list of parts shows them to the agent. */
  private phaseList(action: string | undefined): { id: string; label: string }[] {
    return this.phasesOf(action).map((p) => ({ id: p.id, label: oneLine(p.label) }));
  }

  /** A phase's id, label and brief text ("" without a brief). */
  private async phaseText(action: string, p: HarnessPhase): Promise<PhaseText> {
    const brief = p.brief && this.d.readPhaseBrief ? await this.d.readPhaseBrief(action, p.id) : "";
    return { id: p.id, label: oneLine(p.label), brief };
  }

  /** The time left, as a prompt says it; "" without a time box. */
  private timeLeft(c: Pick<CurrentTask, "timeBox">): string {
    return c.timeBox ? formatTimeLeft(remainingMs(c.timeBox, this.now(), this.minute), this.minute) : "";
  }
```

8. In `trailerOf`, add the phase:

```ts
    return {
      task: c.id,
      ...(c.action ? { action: c.action } : {}),
      ...(c.scope ? { scope: c.scope } : {}),
      ...(c.phase ? { phase: c.phase.id } : {}),
    };
```

9. In `runTurn`:
   - At its start (before `this.turnTask = task.id;`), add:

```ts
    this.lastPhaseAsk = null;
    const kind = options.phase ?? "run";
    // A proposal the person didn't take goes as soon as they send anything else (spec §4.1 "ignores it").
    if (kind === "run" && task.phaseProposal) await this.dropProposal(task.id);
```

   - In the `send` options, after the `mode` line, add `...(task.phase ? { taskPhase: task.phase.id } : {}),` (a change turn's own `taskPhase` is the task's, already saved), and change the input-ids line to `...(this.hasInputs() && takesInputs(options.phase) ? { turn: task.turns } : {}),`.
   - Widen `seen` to `{ done?: Done; note?: SavedNote; used?: number; size?: number; compacted?: boolean; phaseAsk?: PhaseRequest }` and, in `onEvent`, before the input-block branch, add:

```ts
          } else if (e.type === "block" && e.name === "set_phase") {
            // Acted on only after the turn ends (spec §4.1); the last call of the turn wins.
            const parsed = setPhaseSchema.safeParse(e.data);
            if (parsed.success) seen.phaseAsk = parsed.data;
```

   - After `this.lastDone = result;`, add:

```ts
    // Only the task's own work asks to move: never the closing, checkpoint or wrap-up turn.
    if (seen.phaseAsk && (kind === "run" || kind === "phase-change")) this.lastPhaseAsk = seen.phaseAsk;
```

10. Replace `afterRun` with:

```ts
  private async afterRun(id: string, done: Done, first: boolean): Promise<void> {
    const ask = this.lastPhaseAsk;
    this.lastPhaseAsk = null;
    if (!done.ok && (done.error.code === "cancelled" || first)) return this.endTask(id, "unfinished");
    await this.update((s) => (s.current?.id === id ? { ...s, current: { ...s.current, status: "waiting", turns: s.current.turns + 1 } } : s));
    // The agent asked to move (spec §4.1): acted on now that its turn ended well.
    if (ask && done.ok && !this.cancelRequested) await this.phaseAsked(id, ask);
  }
```

- [ ] **Step 5: Acting on `set_phase`, the person's pick and the change turn**

Add after `afterRun`:

```ts
  /**
   * The agent's `set_phase` (spec §4.1), after its turn ended well. The current phase has `auto` and `to` is the next one:
   * the app moves now. Anything else: a proposal the person confirms or ignores. An id this action doesn't have is
   * ignored (the `ui` server only knows the harness's ids). A failed move is logged: the agent's turn itself went well.
   */
  private async phaseAsked(id: string, ask: PhaseRequest): Promise<void> {
    const c = await this.storedCurrent();
    if (!c || c.id !== id || c.status !== "waiting") return;
    const phases = this.phasesOf(c.action);
    const here = phases.findIndex((p) => p.id === c.phase?.id);
    const to = phases.findIndex((p) => p.id === ask.to);
    if (here < 0 || to < 0) {
      console.error(`The agent asked for a phase this task doesn't have: "${ask.to}"`);
      return;
    }
    if (to === here) return;
    if (phases[here].auto !== true || to !== here + 1) {
      const proposal = { to: ask.to, reason: ask.reason };
      return this.update((s) => (s.current?.id === id ? { ...s, current: { ...s.current, phaseProposal: proposal } } : s));
    }
    try {
      await this.endsInWindow(() => this.movePhase(c, phases[to], "agent"));
    } catch (err) {
      console.error("The phase change the agent asked for failed", err);
    }
  }

  /**
   * Checks, in order: a task waits (the one the caller saw); the action has the phase; it isn't the current one. Then
   * the change: its message read first (a brief that can't be read refuses it), then the state and the turn.
   */
  private async phaseNow(to: string, take: (r: PhaseResult) => void, task?: string): Promise<void> {
    const c = await this.storedCurrent();
    if (!c || c.status !== "waiting" || (task !== undefined && c.id !== task)) return take({ ok: false, reason: "no-task" });
    const phases = this.phasesOf(c.action);
    const target = phases.find((p) => p.id === to);
    if (!target) return take({ ok: false, reason: "unknown" });
    if (c.phase?.id === to) return take({ ok: true, changed: "same" });
    const back = phases.indexOf(target) < phases.findIndex((p) => p.id === c.phase?.id);
    const plan = await this.phasePlan(c, target, back);
    take({ ok: true, changed: plan.message ? "turn" : "quiet" });
    return this.endsInWindow(() => this.enterPhase(c, target, "person", plan, back));
  }

  /** Moves the task forward to `to` (the agent's `auto`, the time box): the plan, then the change. */
  private async movePhase(c: CurrentTask, to: HarnessPhase, by: PhaseBy): Promise<void> {
    const plan = await this.phasePlan(c, to, false);
    await this.enterPhase(c, to, by, plan, false);
  }

  /** The change's message (spec §4.4): the new part, the way back, the time left, its brief. Modes come in Task 7. */
  private async phasePlan(c: CurrentTask, to: HarnessPhase, back: boolean): Promise<PhasePlan> {
    const language = await this.d.language();
    const text = await this.phaseText(c.action!, to);
    const previous = this.phaseOf(c);
    const extra: string[] = [];
    const vars = { language, back, ...(previous ? { previous: oneLine(previous.label) } : {}), ...(c.timeBox ? { timeLeft: this.timeLeft(c) } : {}) };
    return { message: text.brief || extra.length > 0 ? phasePrompt(text, { ...vars, extra }) : null };
  }

  /**
   * Enters phase `to` (spec §4.4), inside the running operation. The state first: the phase, the log, the mode fields, and
   * the proposal goes. Then, when there is a message: the window is told, a due checkpoint runs, and one run turn of the
   * same session carries it; its answer shows, and the chat's line is the separator.
   */
  private async enterPhase(c: CurrentTask, to: HarnessPhase, by: PhaseBy, plan: PhasePlan, back: boolean): Promise<void> {
    const at = this.now().toISOString();
    await this.update((s) => {
      if (s.current?.id !== c.id) return s;
      const { phaseProposal: _proposal, ...rest } = s.current;
      let next: CurrentTask = { ...rest, phase: { id: to.id, startedAt: at }, phases: [...(rest.phases ?? []), { id: to.id, at, by }].slice(-PHASE_LOG_MAX) };
      if (plan.modes) {
        const { mode: _m, modes: _ms, suspendedMode: _s, belowMinTier: _b, ...base } = next;
        next = { ...base, ...plan.modes };
      }
      return { ...s, current: next };
    });
    const now = (await this.d.store.load()).current;
    if (!plan.message || now?.id !== c.id) return;
    this.tellTurn({ task: c.id, kind: "phase", phase: to.id, by, ...(back ? { back: true as const } : {}) });
    if (needsCheckpoint(now) && !(await this.checkpoint(now))) return this.stopped();
    await this.setStatus(c.id, "running");
    // Checked with no await before the send: a Stop while the status was saved.
    if (this.cancelRequested) {
      await this.setStatus(c.id, "waiting");
      return this.stopped();
    }
    let done: Done;
    try {
      done = await this.runTurn(now, plan.message, {
        display: `— ${oneLine(to.label)} —`,
        ...(c.action ? { action: c.action } : {}),
        followUp: true,
        phase: "phase-change",
        phaseChange: to.id,
      });
    } catch (err) {
      if (err instanceof TurnNotStarted) await this.setStatus(c.id, "waiting");
      throw unwrap(err);
    }
    return this.afterRun(c.id, done, false);
  }

  /** Tells the window a turn the app starts on its own is coming; that turn's `done` is the window's to see again. */
  private tellTurn(notice: TaskTurnNotice): void {
    this.windowDone = false;
    try {
      this.d.taskTurn?.(notice);
    } catch (err) {
      console.error("Could not tell the window about the turn", err);
    }
  }

  /** The agent's proposal goes (the person moved, or sent something else). */
  private dropProposal(id: string): Promise<void> {
    return this.update((s) => {
      if (s.current?.id !== id || !s.current.phaseProposal) return s;
      const { phaseProposal: _proposal, ...rest } = s.current;
      return { ...s, current: rest };
    });
  }
```

- [ ] **Step 6: The resumed session and the view**

1. In `resumeMessageFor`, after the mode block, add:

```ts
    // The current part comes back with the task (task-phases spec §6), only with the action's brief.
    let phase: string | undefined;
    const current = this.phaseOf(c);
    if (brief !== undefined && current) {
      try {
        const text = await this.phaseText(c.action!, current);
        phase = [phasesSection(this.phaseList(c.action), current.id), phaseSection(text, { language, timeLeft: this.timeLeft(c) })].join("\n\n");
      } catch (err) {
        console.error("Could not read the phase's brief; the task resumes without it", err);
      }
    }
```

and pass `...(phase ? { phase } : {}),` to `resumeMessage` after `mode`.

2. In the module-level `currentView`, after the `belowMinTier` line, add:

```ts
  ...(c.phase ? { phase: c.phase.id } : {}),
  ...(c.phases ? { phases: c.phases } : {}),
  ...(c.phaseProposal ? { phaseProposal: c.phaseProposal } : {}),
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `corepack pnpm vitest run packages/shell/test/task-manager-phases.test.ts`
Expected: PASS.

- [ ] **Step 8: Verify everything and commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test` and `corepack pnpm app:build`
Expected: all green; `task-manager.test.ts`, `task-manager-modes.test.ts`, `task-manager-input.test.ts` and `task-manager-scopes.test.ts` unchanged (D0).

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/shell/src/main/task-manager.ts packages/ui/src/client.ts packages/shell/test/task-manager-phases.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(shell): tasks move through their phases

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 7: Modes by phase: suspend, restore, recommend later, refuse

**Files:**
- Modify: `packages/shell/src/main/task-manager.ts`, `packages/ui/src/client.ts`
- Test: `packages/shell/test/task-manager-phases.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/shell/test/task-manager-phases.test.ts` (add `modeSection` and `recommendSection` to the `task-prompts` import):

```ts
describe("TaskManager: modes by phase (task-modes spec §7)", () => {
  const modes = { modes: ["socratic", "feynman"], defaultMode: "socratic" };
  const phases: HarnessPhase[] = [
    { id: "warmup", label: "Warm-up", brief: "w.md", auto: true, modes: "none" },
    { id: "main", label: "Main block", brief: "m.md" },
    { id: "close", label: "Close", brief: "c.md", close: true, modes: "none" },
  ];
  const socratic = modeSection({ label: "Socratic", brief: "Brief of socratic.", settings: [] }, "en");

  it("a default mode the first phase forbids starts suspended and comes back with the first phase that allows it", async () => {
    const t = setup({ modes, phases, script: [[ask("main"), ok], [ok]] });
    await t.manager.start("session");
    expect(t.turns[0].message).not.toContain("## Mode:");
    expect(t.turns[0].options).not.toHaveProperty("mode");
    expect(t.turns[1].message).toBe(phasePrompt(text("main", "Main block"), { language: "en", previous: "Warm-up", extra: [socratic] }));
    expect(t.turns[1].options).toMatchObject({ mode: "socratic" });
    expect(t.state().current).toMatchObject({ mode: "socratic", modes: ["socratic"] });
    expect(t.state().current).not.toHaveProperty("suspendedMode");
  });

  it("a phase that forbids the mode suspends it; going back restores it; chooseMode refuses a forbidden one", async () => {
    const t = setup({ modes, phases: phases.slice(1) });
    await t.manager.start("session");
    expect(t.state().current).toMatchObject({ mode: "socratic", phase: { id: "main" } });
    await t.manager.setPhase("close", "t1").done;
    expect(t.state().current).toMatchObject({ suspendedMode: "socratic", modes: ["socratic"] });
    expect(t.state().current).not.toHaveProperty("mode");
    expect(t.turns.at(-1)!.options).not.toHaveProperty("mode");
    expect(await t.manager.chooseMode("feynman").accepted).toEqual({ ok: false, reason: "phase" });
    await t.manager.setPhase("main", "t1").done;
    expect(t.turns.at(-1)!.message).toContain(socratic);
    expect(t.state().current).toMatchObject({ mode: "socratic" });
    expect(t.state().current).not.toHaveProperty("suspendedMode");
  });

  it("recommend waits for the first phase that allows modes, and lists only those", async () => {
    const t = setup({ modes: { modes: ["socratic", "feynman"] }, phases: [phases[0], { ...phases[1], modes: ["feynman"] }, phases[2]], script: [[ask("main"), ok], [ok]] });
    await t.manager.start("session");
    expect(t.turns[0].message).not.toContain("## How to work");
    expect(t.turns[1].message).toContain(recommendSection([{ id: "feynman", label: "Feynman" }]));
    expect(t.state().current).not.toHaveProperty("mode");
  });

  it("an explicit mode the first phase forbids starts suspended too", async () => {
    const t = setup({ modes, phases });
    await t.manager.start("session", undefined, undefined, "feynman");
    expect(t.state().current).toMatchObject({ suspendedMode: "feynman" });
    expect(t.state().current).not.toHaveProperty("mode");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm vitest run packages/shell/test/task-manager-phases.test.ts`
Expected: FAIL (the warm-up's first message carries the mode; no suspend; no `phase` refusal).

- [ ] **Step 3: The refusal's reason**

In `packages/ui/src/client.ts`, add `"phase"` to `ModeResult`'s refusal reasons and to its doc comment ("or the current phase doesn't allow it ("phase")"):

```ts
  | { ok: false; reason: "no-task" | "unknown" | "tier" | "phase"; required?: Tier; current?: Tier };
```

- [ ] **Step 4: Modes on entering a phase**

In `packages/shell/src/main/task-manager.ts`:

1. Add `phaseModes` and `type Language` (already imported) to the SDK import.
2. Add after `phaseList`:

```ts
  /** The modes the task may work in now: its action's, narrowed by its phase (modes spec §7). */
  private allowedModes(c: Pick<CurrentTask, "action" | "phase">): string[] {
    const modes = this.modesOf(c.action);
    const phase = this.phaseOf(c);
    return phase && this.known(c.action) ? phaseModes(this.d.actions[c.action], phase).filter((m) => modes.includes(m)) : modes;
  }

  /**
   * What entering `to` does to the task's mode (modes spec §7), and what the change's message says about it. A mode `to`
   * forbids is suspended. A suspended mode `to` allows comes back, its section riding on the change turn. A task that never
   * worked in a mode gets its `defaultMode` (a mode id) or a recommendation, at the first phase that allows modes.
   */
  private async modesOnEntry(c: CurrentTask, to: HarnessPhase, language: Language): Promise<{ sections: string[]; fields?: PhasePlan["modes"] }> {
    const modes = this.modesOf(c.action);
    if (modes.length === 0 || !this.known(c.action)) return { sections: [] };
    const action = this.d.actions[c.action];
    const allowed = phaseModes(action, to).filter((m) => modes.includes(m));
    const used = c.modes ?? [];
    if (c.mode) return allowed.includes(c.mode) ? { sections: [] } : { sections: [], fields: { suspendedMode: c.mode, ...(used.length > 0 ? { modes: used } : {}) } };
    const fresh = !c.suspendedMode && used.length === 0;
    const preferred = fresh ? defaultModeOf(action) : null;
    const comes = c.suspendedMode && allowed.includes(c.suspendedMode) ? c.suspendedMode : preferred !== null && allowed.includes(preferred) ? preferred : undefined;
    if (comes) {
      const below = await this.belowMinTier(comes, c.profile);
      return {
        sections: [modeSection(await this.modeText(comes), language)],
        fields: { mode: comes, modes: used.includes(comes) ? used : [...used, comes], ...(below ? { belowMinTier: true as const } : {}) },
      };
    }
    if (fresh && allowed.length > 0) return { sections: [recommendSection(allowed.map((id) => this.hintOf(id)))] };
    return { sections: [] };
  }
```

3. In `phasePlan`, replace `const extra: string[] = [];` and the `return` with:

```ts
    const entry = await this.modesOnEntry(c, to, language);
    const extra = entry.sections;
    return {
      message: text.brief || extra.length > 0 ? phasePrompt(text, { ...vars, extra }) : null,
      ...(entry.fields ? { modes: entry.fields } : {}),
    };
```

(`vars` is declared before; keep its line.)

4. In `startNow`, between `const modes = this.modesOf(action);` and the mode-brief read, replace the `const start = …` line with:

```ts
    const first = this.phasesOf(action)[0];
    // The first phase may allow fewer modes (modes spec §7): a mode it forbids starts suspended; "recommend" waits.
    const startable = first ? phaseModes(this.d.actions[action], first).filter((m) => modes.includes(m)) : modes;
    let start = mode ?? this.startMode(action, modes);
    let suspended: string | undefined;
    if (start === "recommend" && startable.length === 0) start = null;
    else if (start !== null && start !== "recommend" && !startable.includes(start)) {
      suspended = start;
      start = null;
    }
```

remove the later `const first = this.phasesOf(action)[0];` line added in Task 6 (it moved up), change the recommendation line to `if (start === "recommend") section = recommendSection(startable.map((id) => this.hintOf(id)));`, and pass the suspended mode to `begin`: `{ action, ...inMode, ...inPhase, ...(suspended ? { suspendedMode: suspended } : {}) }`. Without phases `startable` is `modes` and nothing changes (D0).

5. In `modeNow`, after the `unknown` refusal, add:

```ts
    if (!this.allowedModes(c).includes(mode)) return take({ ok: false, reason: "phase" });
```

6. In `setMode`, drop a suspended mode too:

```ts
      const { belowMinTier: _below, suspendedMode: _suspended, ...rest } = s.current;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `corepack pnpm vitest run packages/shell/test/task-manager-phases.test.ts packages/shell/test/task-manager-modes.test.ts`
Expected: PASS (the modes suite unchanged).

- [ ] **Step 6: Verify everything and commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test` and `corepack pnpm app:build`
Expected: all green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/shell/src/main/task-manager.ts packages/ui/src/client.ts packages/shell/test/task-manager-phases.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(shell): phases suspend and restore the task's mode

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 8: The close phase ends with the core closing turn

**Files:**
- Modify: `packages/shell/src/main/task-manager.ts`
- Test: `packages/shell/test/task-manager-phases.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/shell/test/task-manager-phases.test.ts`:

```ts
describe("TaskManager: the close phase is the core closing (task-phases spec D5)", () => {
  it("the person's Finish in the close phase runs the closing turn and ends the task", async () => {
    const t = setup({ script: [[ok], [ok], [saveNote, ok]] });
    await t.manager.start("session");
    await t.manager.setPhase("close", "t1").done;
    const r = t.manager.setPhase("close", "t1");
    expect(await r.accepted).toEqual({ ok: true, changed: "closing" });
    await r.done;
    expect(t.turns.at(-1)!.message).toBe(CLOSE_PROMPT);
    expect(t.turns.at(-1)!.options).toMatchObject({ phase: "close", taskPhase: "close", quiet: true });
    expect(t.state().current).toBeNull();
    expect(t.state().actions).toEqual({ session: "done" });
    expect(t.written[0].meta).toMatchObject({ action: "session" });
  });

  it("the agent says the close phase is done: closed at once with auto, else a proposal to finish", async () => {
    const auto = setup({ phases: [PHASES[0], { ...PHASES[2], auto: true }], script: [[ask("close"), ok], [ask("close", "All summed up"), ok], [saveNote, ok]] });
    await auto.manager.start("session");
    expect(auto.turns.map((x) => x.options.phase)).toEqual(["run", "phase-change", "close"]);
    expect(auto.state().current).toBeNull();

    const asks = setup({ script: [[ok], [ask("close", "All summed up"), ok]] });
    await asks.manager.start("session");
    await asks.manager.setPhase("close", "t1").done;
    expect(asks.turns).toHaveLength(2);
    expect(asks.state().current).toMatchObject({ phase: { id: "close" }, phaseProposal: { to: "close", reason: "All summed up" } });
  });

  it("the same id in any other phase does nothing", async () => {
    const t = setup({ script: [[ask("warmup"), ok]] });
    await t.manager.start("session");
    expect(t.turns).toHaveLength(1);
    expect(t.state().current).not.toHaveProperty("phaseProposal");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm vitest run packages/shell/test/task-manager-phases.test.ts`
Expected: FAIL (`same` instead of `closing`; the agent's "done" is ignored).

- [ ] **Step 3: Finish in the close phase**

In `packages/shell/src/main/task-manager.ts`:

1. In `phaseNow`, replace `if (c.phase?.id === to) return take({ ok: true, changed: "same" });` with:

```ts
    if (c.phase?.id === to) {
      if (!target.close) return take({ ok: true, changed: "same" });
      // The close phase's Finish (D5): the core closing turn asks for the note and ends the task.
      take({ ok: true, changed: "closing" });
      await this.closeCurrent();
      return;
    }
```

2. In `phaseAsked`, replace `if (to === here) return;` and the `auto` check with:

```ts
    const current = phases[here];
    // Its own id: "this part is done", which means something only in the close phase (D5).
    if (to === here && !current.close) return;
    const auto = current.auto === true && (to === here + 1 || to === here);
    if (!auto) {
      const proposal = { to: ask.to, reason: ask.reason };
      return this.update((s) => (s.current?.id === id ? { ...s, current: { ...s.current, phaseProposal: proposal } } : s));
    }
    try {
      if (to === here) await this.closeCurrent();
      else await this.endsInWindow(() => this.movePhase(c, phases[to], "agent"));
    } catch (err) {
      console.error("The phase change the agent asked for failed", err);
    }
```

and update its doc comment's first sentences to: "The agent's `set_phase` (spec §4.1), after its turn ended well. With the current phase's `auto`: `to` the next phase moves now, and the close phase's own id closes the task (D5). Anything else: a proposal the person confirms or ignores."

- [ ] **Step 4: Run the test to verify it passes**

Run: `corepack pnpm vitest run packages/shell/test/task-manager-phases.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify everything and commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test` and `corepack pnpm app:build`
Expected: all green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/shell/src/main/task-manager.ts packages/shell/test/task-manager-phases.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(shell): the close phase ends with the core closing turn

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 9: The time box: choose, count, wrap up, move to the close phase, pause, resume, add time

**Files:**
- Modify: `packages/shell/src/main/task-manager.ts`, `packages/shell/src/main/task-store.ts`, `packages/ui/src/client.ts`
- Test: `packages/shell/test/task-manager-phases.test.ts`

- [ ] **Step 1: Give the test setup a fake timer**

In `setup` of `packages/shell/test/task-manager-phases.test.ts`, add before `const manager`:

```ts
  const timers: { fn: () => void; ms: number }[] = [];
```

add to the `TaskManager` deps (after `minuteMs`):

```ts
    timer: {
      set: (fn, ms) => {
        const handle = { fn, ms };
        timers.push(handle);
        return handle;
      },
      clear: (handle) => {
        const i = timers.indexOf(handle as (typeof timers)[number]);
        if (i >= 0) timers.splice(i, 1);
      },
    },
```

and return `timers` with the rest, plus a helper that runs the armed timer after its time:

```ts
    /** Moves the clock to the armed timer's moment and fires it. */
    fire: () => {
      const handle = timers.at(-1);
      if (!handle) throw new Error("No timer is armed");
      clock += handle.ms;
      handle.fn();
    },
```

- [ ] **Step 2: Write the failing test**

Append (add `vi` to the vitest import and `wrapUpPrompt` to the `task-prompts` import):

```ts
describe("TaskManager: the time box (task-phases spec §5)", () => {
  const box: HarnessTimeBox = { options: [10, 20], default: null, wrapUpAt: 0.5 };

  it("D0: no time box, no timer, no field", async () => {
    const t = setup({ timeBox: box });
    await t.manager.start("session");
    await t.manager.start("quiz");
    expect(t.timers).toEqual([]);
    expect(t.state().current).not.toHaveProperty("timeBox");
  });

  it("is chosen at the start among the options, counts, and is shown; a length not offered starts nothing", async () => {
    const t = setup({ timeBox: box });
    await expect(t.manager.start("session", undefined, undefined, undefined, { timeBox: 15 })).rejects.toThrow("Unknown time box");
    expect(t.turns).toHaveLength(0);
    await t.manager.start("session", undefined, undefined, undefined, { timeBox: 10 });
    expect(t.state().current?.timeBox).toEqual({ minutes: 10, usedMs: 0, runningSince: NOW });
    // A one-second minute in the test: the wrap-up is due at half of 10 s.
    expect(t.timers.at(-1)?.ms).toBe(5000);
    expect(t.turns[0].message).toContain("about 10 minutes");
    t.advance(2000);
    await t.manager.ask("Go on");
    expect(t.views.at(-1)?.current?.timeBox).toMatchObject({ minutes: 10, totalMs: 10_000, usedMs: 2000, paused: false });
  });

  it("the default applies to a start the window doesn't make itself", async () => {
    const t = setup({ timeBox: { ...box, default: 20 } });
    await t.manager.start("session");
    expect(t.state().current?.timeBox).toMatchObject({ minutes: 20 });
  });

  it("at wrapUpAt: one wrap-up turn, then the close phase by the app; the window hears both first", async () => {
    const t = setup({ timeBox: box });
    await t.manager.start("session", undefined, undefined, undefined, { timeBox: 10 });
    t.fire();
    await vi.waitFor(() => expect(t.turns).toHaveLength(3));
    await t.manager.idle();
    expect(t.turns[1].message).toBe(wrapUpPrompt("en"));
    expect(t.turns[1].options).toMatchObject({ phase: "wrap-up", wrapUp: true, display: "Time is almost up", taskPhase: "warmup" });
    expect(t.turns[2].options).toMatchObject({ phase: "phase-change", phaseChange: "close" });
    expect(t.notices).toEqual([
      { task: "t1", kind: "wrap-up" },
      { task: "t1", kind: "phase", phase: "close", by: "app" },
    ]);
    expect(t.state().current).toMatchObject({ phase: { id: "close" }, timeBox: { wrappedUp: true } });
    // Next: the end, at 100%. It moves nowhere: the close phase already started.
    t.fire();
    await t.manager.idle();
    await vi.waitFor(() => expect(t.state().current?.timeBox).toMatchObject({ ended: true }));
    expect(t.turns).toHaveLength(3);
  });

  it("never cuts a turn: a step due during a turn waits for it", async () => {
    let open!: () => void;
    const t = setup({ timeBox: box });
    await t.manager.start("session", undefined, undefined, undefined, { timeBox: 10 });
    const t2 = setup({ timeBox: box, state: t.state(), gate: new Promise<void>((resolve) => (open = resolve)) });
    const asked = t2.manager.ask("A long question");
    await vi.waitFor(() => expect(t2.turns).toHaveLength(1));
    t2.fire();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(t2.turns).toHaveLength(1);
    open();
    await asked;
    await vi.waitFor(() => expect(t2.turns[1]?.options).toMatchObject({ phase: "wrap-up" }));
  });

  it("pause (only while waiting), resume, a message resumes, +5 min, quitting pauses", async () => {
    const t = setup({ timeBox: box });
    await t.manager.start("session", undefined, undefined, undefined, { timeBox: 10 });
    t.advance(1000);
    expect(await t.manager.pauseTimeBox()).toBe(true);
    expect(t.state().current?.timeBox).toEqual({ minutes: 10, usedMs: 1000 });
    expect(t.timers).toEqual([]);
    expect(t.views.at(-1)?.current?.timeBox).toMatchObject({ paused: true });
    expect(await t.manager.resumeTimeBox()).toBe(true);
    expect(t.timers).toHaveLength(1);
    await t.manager.pauseTimeBox();
    await t.manager.ask("I'm back");
    expect(t.state().current?.timeBox?.runningSince).toBeDefined();
    expect(await t.manager.extendTimeBox()).toBe(true);
    expect(t.state().current?.timeBox?.minutes).toBe(15);
    t.manager.close();
    await vi.waitFor(() => expect(t.state().current?.timeBox).not.toHaveProperty("runningSince"));
  });

  it("without a close phase: the wrap-up, then only the view says the time is up", async () => {
    const t = setup({ timeBox: box, phases: PHASES.slice(0, 2) });
    await t.manager.start("session", undefined, undefined, undefined, { timeBox: 10 });
    t.fire();
    await vi.waitFor(() => expect(t.turns).toHaveLength(2));
    await t.manager.idle();
    expect(t.state().current).toMatchObject({ phase: { id: "warmup" }, timeBox: { wrappedUp: true } });
    expect(t.views.at(-1)?.current?.timeBox).toMatchObject({ wrappedUp: true });
  });
});
```

The "never cuts a turn" case builds a second manager over the first one's saved state so its first `send` is the gated one; if that proves awkward, gate the second turn instead by giving `setup` a `gateTurn` option like the modes suite has.

- [ ] **Step 3: Run it to verify it fails**

Run: `corepack pnpm vitest run packages/shell/test/task-manager-phases.test.ts`
Expected: FAIL (`timer` is not a dep; `start` takes no time box; no wrap-up).

- [ ] **Step 4: The view's type**

In `packages/ui/src/client.ts`, add above `CurrentTaskView`:

```ts
/**
 * The task's time box as the window sees it (task-phases spec §5): minutes chosen, the whole box and the time used in ms
 * (a test minute may be short), measured `at`; the window counts down from there unless `paused`. `wrappedUp`: the
 * wrap-up ran; `ended`: the time is up.
 */
export interface TimeBoxView {
  minutes: number;
  totalMs: number;
  usedMs: number;
  at: string;
  paused: boolean;
  wrappedUp?: true;
  ended?: true;
}
```

and in `CurrentTaskView` after `phaseProposal`: `timeBox?: TimeBoxView;`.

- [ ] **Step 5: The timer and its steps**

In `packages/shell/src/main/task-store.ts`, export the bound: change `const TIME_BOX_MINUTES_MAX` to `export const TIME_BOX_MINUTES_MAX`.

In `packages/shell/src/main/task-manager.ts`:

1. Imports: add `type TimeBoxView` to the ui client import; `TIME_BOX_MINUTES_MAX` to the task-store import; extend the time-box import to `import { EXTEND_MINUTES, MINUTE_MS, formatTimeLeft, nextDue, paused, remainingMs, running, usedMs } from "./time-box";`; add `wrapUpPrompt` to the task-prompts import.

2. In `TaskDeps`, after `minuteMs`, add:

```ts
  /** The time box's timer. Absent: setTimeout and clearTimeout. */
  timer?: { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void };
```

3. Below `SO_FAR_CHARS`, add `const MAX_TIMER_MS = 2_147_483_647;` with the comment "setTimeout's longest delay: a longer wait fires early and is armed again."

4. Change `currentView`'s signature to `const currentView = (c: CurrentTask, tier?: Tier, timeBox?: TimeBoxView): CurrentTaskView => ({` and add `...(timeBox ? { timeBox } : {}),` at its end. Change `currentViewOf` to:

```ts
  /** The open task as the window sees it; its tier only when its action has modes (D0), its time box measured now. */
  private async currentViewOf(c: CurrentTask): Promise<CurrentTaskView> {
    return currentView(c, this.modesOf(c.action).length > 0 ? await this.tierFor(c) : undefined, c.timeBox ? this.timeBoxView(c.timeBox) : undefined);
  }

  private timeBoxView(t: NonNullable<CurrentTask["timeBox"]>): TimeBoxView {
    const now = this.now();
    return {
      minutes: t.minutes,
      totalMs: t.minutes * this.minute,
      usedMs: usedMs(t, now),
      at: now.toISOString(),
      paused: !t.runningSince,
      ...(t.wrappedUp ? { wrappedUp: true as const } : {}),
      ...(t.ended ? { ended: true as const } : {}),
    };
  }
```

5. Fields and constructor:

```ts
  /** The time box's timer for the open task's next step, or null. */
  private timer: unknown = null;
  private readonly timers: { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void };
```

```ts
    this.timers = d.timer ?? { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
```

6. `start` and `startNow` take the time box:

```ts
  start(action: string, display?: string, scope?: string, mode?: string, opts: { timeBox?: number | null } = {}): Promise<void> {
    return this.op(() => this.startNow(action, display, scope, mode, undefined, opts));
  }
```

`startNow(action, display?, scope?, mode?, floor?, opts: { timeBox?: number | null } = {})` (its other caller, the tier floor's new task, passes no `opts`). At its top, after the `Unknown mode` check, add:

```ts
    // The time box (spec §5): the one picked, else the action's default; one it doesn't offer is refused before anything closes.
    const offered = this.d.actions[action].timeBox;
    const minutes = opts.timeBox !== undefined ? opts.timeBox : (offered?.default ?? null);
    if (minutes !== null && !(offered?.options ?? []).includes(minutes)) throw new Error("Unknown time box");
```

pass `...(minutes !== null ? { timeBox: { minutes, usedMs: 0, runningSince: at } } : {})` into `begin`'s task object (next to `inPhase`; `at` is already declared there), and give the first phase's section the time left:

```ts
        const timeLeft = minutes !== null ? formatTimeLeft(minutes * this.minute, this.minute) : "";
        const parts = first && firstText ? [phasesSection(this.phaseList(action), first.id), phaseSection(firstText, { language, timeLeft })] : [];
```

Without phases, a time box adds nothing to the first message.

7. Arm the timer after every write: in `update`, after `await this.d.store.save(after);`, add `this.arm(after.current);`, and add the steps after `dropProposal`:

```ts
  /** Sets the one timer for the open task's next time-box step (spec §5): none while paused, after quit, or when done. */
  private arm(c: CurrentTask | null): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
    const box = c?.timeBox;
    if (!c || !box?.runningSince || this.closed) return;
    const wrapUpAt = this.known(c.action) ? this.d.actions[c.action].timeBox?.wrapUpAt : undefined;
    const due = nextDue(box, wrapUpAt, this.now(), this.minute);
    if (!due) return;
    const id = c.id;
    this.timer = this.timers.set(() => {
      this.timer = null;
      // A step never cuts a turn: it waits until nothing runs (spec §5).
      void this.whenFree(() => this.op(() => this.timeNow(id))).catch((err: unknown) => console.error("The time box's step failed", err));
    }, Math.min(due.inMs, MAX_TIMER_MS));
  }

  /** The step that is due now, if the task is still the one and still waits; early (time was added): armed again. */
  private async timeNow(id: string): Promise<void> {
    const c = await this.storedCurrent();
    if (!c || c.id !== id || !c.timeBox?.runningSince || !this.known(c.action)) return;
    const due = nextDue(c.timeBox, this.d.actions[c.action].timeBox?.wrapUpAt, this.now(), this.minute);
    if (!due) return;
    if (due.inMs > 0) return this.arm(c);
    // Not waiting (a stuck status): the next write arms it again.
    if (c.status !== "waiting") return;
    if (due.kind === "wrap-up") return this.wrapUp(c);
    await this.setTimeBox(c.id, { ...c.timeBox, ended: true });
    await this.toClosePhase(c.id);
  }

  /** The wrap-up (spec §5): once, one turn asking to finish the point, then the close phase if it never started. */
  private async wrapUp(c: CurrentTask): Promise<void> {
    await this.setTimeBox(c.id, { ...c.timeBox!, wrappedUp: true });
    const now = (await this.d.store.load()).current;
    if (!now || now.id !== c.id) return;
    return this.endsInWindow(async () => {
      this.tellTurn({ task: c.id, kind: "wrap-up" });
      if (needsCheckpoint(now) && !(await this.checkpoint(now))) return this.stopped();
      await this.setStatus(c.id, "running");
      if (this.cancelRequested) {
        await this.setStatus(c.id, "waiting");
        return this.stopped();
      }
      let done: Done;
      try {
        done = await this.runTurn(now, wrapUpPrompt(await this.d.language()), {
          display: "Time is almost up",
          ...(c.action ? { action: c.action } : {}),
          followUp: true,
          phase: "wrap-up",
          wrapUp: true,
        });
      } catch (err) {
        if (err instanceof TurnNotStarted) await this.setStatus(c.id, "waiting");
        throw unwrap(err);
      }
      await this.afterRun(c.id, done, false);
      if (done.ok) await this.toClosePhase(c.id);
    });
  }

  /** After the wrap-up or at 100% (spec §5): the close phase, unless the task has been in it already. */
  private async toClosePhase(id: string): Promise<void> {
    const c = await this.storedCurrent();
    if (!c || c.id !== id || c.status !== "waiting") return;
    const close = this.phasesOf(c.action).find((p) => p.close);
    if (!close || (c.phases ?? []).some((e) => e.id === close.id)) return;
    await this.movePhase(c, close, "app");
  }

  private setTimeBox(id: string, timeBox: NonNullable<CurrentTask["timeBox"]>): Promise<void> {
    return this.update((s) => (s.current?.id === id ? { ...s, current: { ...s.current, timeBox } } : s));
  }
```

8. Pause, resume, add time; a message resumes; quitting pauses. Add after `finish`:

```ts
  /** Stops the time box's clock (spec §5), only while the task waits. False when there is nothing to pause. */
  pauseTimeBox(): Promise<boolean> {
    return this.op(async () => {
      const c = (await this.d.store.load()).current;
      if (!c?.timeBox?.runningSince || c.status !== "waiting") return false;
      await this.setTimeBox(c.id, paused(c.timeBox, this.now()));
      return true;
    });
  }

  /** Starts the time box's clock again. False when there is nothing to resume. */
  resumeTimeBox(): Promise<boolean> {
    return this.op(async () => {
      const c = (await this.d.store.load()).current;
      if (!c?.timeBox || c.timeBox.runningSince) return false;
      await this.setTimeBox(c.id, running(c.timeBox, this.now()));
      return true;
    });
  }

  /** "+5 min" (spec §5): the end runs again later, the wrap-up never again. Works during a turn too. */
  async extendTimeBox(minutes = EXTEND_MINUTES): Promise<boolean> {
    let changed = false;
    await this.update((s) => {
      const box = s.current?.timeBox;
      if (!s.current || !box) return s;
      const { ended: _ended, ...rest } = box;
      changed = true;
      return { ...s, current: { ...s.current, timeBox: { ...rest, minutes: Math.min(TIME_BOX_MINUTES_MAX, box.minutes + minutes) } } };
    });
    return changed;
  }
```

In `runTurn`, next to the proposal line added in Task 6, add:

```ts
    // A person who writes is working: a paused time box runs again.
    if (kind === "run" && task.timeBox && !task.timeBox.runningSince) {
      const since = this.now();
      await this.update((s) => (s.current?.id === task.id && s.current.timeBox ? { ...s, current: { ...s.current, timeBox: running(s.current.timeBox, since) } } : s));
    }
```

(The first turn of a task already has its clock running, so this only acts after a pause.)

Replace `close()` with:

```ts
  /** For quitting: every later operation is refused, the running one starts no further turn, and the time box pauses. */
  close(): void {
    this.closed = true;
    this.cancelRequested = true;
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
    const at = this.now();
    void this.update((s) => (s.current?.timeBox?.runningSince ? { ...s, current: { ...s.current, timeBox: paused(s.current.timeBox, at) } } : s)).catch(
      (err: unknown) => console.error("Could not pause the time box", err),
    );
  }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `corepack pnpm vitest run packages/shell/test/task-manager-phases.test.ts`
Expected: PASS.

- [ ] **Step 7: Verify everything and commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test` and `corepack pnpm app:build`
Expected: all green (no other suite arms a timer: D0).

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/shell/src/main/task-manager.ts packages/shell/src/main/task-store.ts packages/ui/src/client.ts packages/shell/test/task-manager-phases.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(shell): the time box wraps up and moves to the close phase

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

## Phase 3 — The window and the wiring (spec §8 slices 2–3: the stepper, the time picker)

### Task 10: Wiring: IPC, the preload, the client, test hooks and mock time

**Files:**
- Create: `packages/shell/src/main/phase-ipc.ts`
- Modify: `packages/shell/src/main/index.ts`, `packages/shell/src/main/test-hooks.ts`, `packages/shell/src/preload/index.ts`, `packages/ui/src/client.ts`, `packages/ui/test/fake-client.ts`, `packages/cli/src/mock-session.ts`
- Test: `packages/shell/test/phase-ipc.test.ts` (new), `packages/shell/test/test-hooks.test.ts`, `packages/cli/test/dev.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/shell/test/phase-ipc.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { PhaseResult } from "@humanharness/ui/client";
import { setPhaseHandler } from "../src/main/phase-ipc";

function setup(opts: { quitting?: boolean; blocked?: string | null; result?: PhaseResult; doneError?: Error } = {}) {
  const calls: { to: string; task: string }[] = [];
  const handler = setPhaseHandler({
    quitting: () => opts.quitting ?? false,
    blocked: () => opts.blocked ?? null,
    setPhase: (to, task) => {
      calls.push({ to, task });
      return { accepted: Promise.resolve(opts.result ?? { ok: true, changed: "turn" }), done: opts.doneError ? Promise.reject(opts.doneError) : Promise.resolve() };
    },
  });
  return { handler, calls };
}

describe("hh:setPhase", () => {
  it("answers the acceptance as data, for the task the window saw", async () => {
    const t = setup({ result: { ok: false, reason: "unknown" } });
    expect(await t.handler("t1", "main")).toEqual({ ok: false, reason: "unknown" });
    expect(t.calls).toEqual([{ to: "main", task: "t1" }]);
  });

  it("only logs a failed change turn", async () => {
    const t = setup({ doneError: new Error("boom") });
    expect(await t.handler("t1", "main")).toEqual({ ok: true, changed: "turn" });
  });

  it("refuses while quitting or blocked, and anything malformed, before asking the task manager", async () => {
    await expect(setup({ quitting: true }).handler("t1", "main")).rejects.toThrow("The app is closing");
    await expect(setup({ blocked: "Finish setting up first" }).handler("t1", "main")).rejects.toThrow("Finish setting up first");
    const t = setup();
    for (const [task, phase] of [["", "main"], ["t1", "Main"], ["t1", 3], [{}, "main"], ["x".repeat(101), "main"]] as const) {
      await expect(t.handler(task, phase)).rejects.toThrow("Invalid phase");
    }
    expect(t.calls).toEqual([]);
  });
});
```

In `packages/shell/test/test-hooks.test.ts`, add to `describe("readTestHooks")`:

```ts
  it("reads a short time-box minute (HH_TEST_MINUTE_MS) between 10 ms and a real minute", () => {
    expect(readTestHooks({ HH_TEST_MINUTE_MS: "1000" }, false)).toEqual({ minuteMs: 1000 });
    for (const v of ["0", "9", "60001", "abc", "1.5"]) expect(readTestHooks({ HH_TEST_MINUTE_MS: v }, false)).toEqual({});
    expect(readTestHooks({ HH_TEST_MINUTE_MS: "1000" }, true)).toEqual({});
  });
```

In `packages/cli/test/dev.test.ts`, in the `--mock` test after `expect(env.HH_TEST_MOCK).toBe("1");`, add:

```ts
    // Mock mode runs a time box fast: a minute is a second.
    expect(env.HH_TEST_MINUTE_MS).toBe("1000");
```

- [ ] **Step 2: Run them to verify they fail**

Run: `corepack pnpm vitest run packages/shell/test/phase-ipc.test.ts packages/shell/test/test-hooks.test.ts packages/cli/test/dev.test.ts`
Expected: FAIL (no `phase-ipc` module; no `minuteMs`; no `HH_TEST_MINUTE_MS`).

- [ ] **Step 3: The handler**

Create `packages/shell/src/main/phase-ipc.ts`:

```ts
import { PHASE_ID } from "@humanharness/harness-sdk";
import type { PhaseResult } from "@humanharness/ui/client";

export interface SetPhaseDeps {
  quitting(): boolean;
  /** Why a new turn can't start now, or null. */
  blocked(): string | null;
  setPhase(to: string, task: string): { accepted: Promise<PhaseResult>; done: Promise<void> };
}

/**
 * The handler of `hh:setPhase` (task-phases spec §4.2). It answers with the acceptance as a value: a refusal's reason
 * survives Electron's IPC, which keeps only a thrown error's message. The change turn reaches the window as events after
 * `hh:taskTurn`; its failure is only logged here, so main never has an unhandled rejection.
 */
export function setPhaseHandler(d: SetPhaseDeps): (task: unknown, phase: unknown) => Promise<PhaseResult> {
  return async (task, phase) => {
    if (d.quitting()) throw new Error("The app is closing");
    const blocked = d.blocked();
    if (blocked) throw new Error(blocked);
    if (typeof task !== "string" || !task || task.length > 100 || typeof phase !== "string" || !PHASE_ID.test(phase)) throw new Error("Invalid phase");
    const { accepted, done } = d.setPhase(phase, task);
    done.catch((err: unknown) => console.error("The phase change's turn failed", err));
    return accepted;
  };
}
```

- [ ] **Step 4: Test hooks and mock mode**

In `packages/shell/src/main/test-hooks.ts`, add to `TestHooks`:

```ts
  /** How long a time-box minute lasts (HH_TEST_MINUTE_MS, 10..60000): tests and mock mode run a time box fast. */
  minuteMs?: number;
```

add `HH_TEST_MINUTE_MS` to `readTestHooks`'s doc comment list, and in its body after the `HH_TEST_MOCK` line:

```ts
  const minute = Number(env.HH_TEST_MINUTE_MS);
  if (env.HH_TEST_MINUTE_MS && Number.isInteger(minute) && minute >= 10 && minute <= 60_000) hooks.minuteMs = minute;
```

In `packages/cli/src/mock-session.ts`, in the returned env after `HH_TEST_MOCK: "1",`, add:

```ts
    // A time box in mock mode runs fast: a minute is a second (task-phases spec §6).
    HH_TEST_MINUTE_MS: "1000",
```

- [ ] **Step 5: The client's calls**

In `packages/ui/src/client.ts`:

1. In `ActionOption`, after `defaultMode`, add:

```ts
  /** Its phases (task-phases spec §3), as the stepper shows them; never a brief. Absent without phases (D0). */
  phases?: PhaseView[];
  /** Its time box: the lengths offered and the one picked when the person picks none. Absent without one (D0). */
  timeBox?: { options: number[]; default: number | null };
```

2. In `SendOptions`, after `mode`, add:

```ts
  /** With `action`: the time box's length in minutes, one of the action's options (task-phases spec §5); null: no limit. */
  timeBox?: number | null;
```

3. In `HarnessClient`, after `onModeSwitch`, add:

```ts
  /**
   * The person moves the open task `taskId` to phase `phaseId` (task-phases spec §4.2): resolves with a refusal or with
   * how the change goes on. A change turn then arrives as an `onTaskTurn` notice and its events.
   */
  setPhase(taskId: string, phaseId: string): Promise<PhaseResult>;
  /** Closes the open task now with the core closing turn (the stepper's Finish). False when it was stopped first. */
  finishTask(): Promise<boolean>;
  /** The time box's clock (spec §5): pause and resume; false when there was nothing to do. */
  pauseTask(): Promise<boolean>;
  resumeTask(): Promise<boolean>;
  /** "+5 min". */
  extendTimeBox(): Promise<boolean>;
  /** A turn the app starts on its own (a phase change, the wrap-up) is about to run: draw its line first. */
  onTaskTurn(listener: (n: TaskTurnNotice) => void): () => void;
```

In `packages/shell/src/preload/index.ts`, add `TaskTurnNotice` to the type import and, after `onModeSwitch`:

```ts
  setPhase: (taskId, phaseId) => ipcRenderer.invoke("hh:setPhase", taskId, phaseId),
  finishTask: () => ipcRenderer.invoke("hh:finishTask"),
  pauseTask: () => ipcRenderer.invoke("hh:pauseTask"),
  resumeTask: () => ipcRenderer.invoke("hh:resumeTask"),
  extendTimeBox: () => ipcRenderer.invoke("hh:extendTimeBox"),
  onTaskTurn: (listener) => subscribe<TaskTurnNotice>("hh:taskTurn", listener),
```

In `packages/ui/test/fake-client.ts`, add `PhaseResult` and `TaskTurnNotice` to the type import and, after `onModeSwitch`:

```ts
  /** What setPhase was asked, in order. */
  phaseCalls: { taskId: string; phaseId: string }[] = [];
  /** What setPhase answers; default: a change turn runs. */
  phaseResult: PhaseResult | null = null;
  async setPhase(taskId: string, phaseId: string): Promise<PhaseResult> {
    this.phaseCalls.push({ taskId, phaseId });
    return this.phaseResult ?? { ok: true, changed: "turn" };
  }
  /** Calls to finishTask, pauseTask, resumeTask and extendTimeBox, in order. */
  taskCalls: string[] = [];
  async finishTask() {
    this.taskCalls.push("finish");
    return true;
  }
  async pauseTask() {
    this.taskCalls.push("pause");
    return true;
  }
  async resumeTask() {
    this.taskCalls.push("resume");
    return true;
  }
  async extendTimeBox() {
    this.taskCalls.push("extend");
    return true;
  }
  taskTurnListeners = new Set<(n: TaskTurnNotice) => void>();
  onTaskTurn(listener: (n: TaskTurnNotice) => void) {
    this.taskTurnListeners.add(listener);
    return () => void this.taskTurnListeners.delete(listener);
  }
  /** Tells the window a phase change or wrap-up turn starts, as main does before its events. */
  emitTaskTurn(n: TaskTurnNotice) {
    for (const l of this.taskTurnListeners) l(n);
  }
```

- [ ] **Step 6: The main process**

In `packages/shell/src/main/index.ts`:

1. Import `setPhaseHandler` from `./phase-ipc`, and `hasPhases` from `@humanharness/harness-sdk`.

2. `taskStoreOptions` (line ~353) keeps the phase ids too:

```ts
const taskStoreOptions = (): { modes?: string[]; phases?: Record<string, string[]> } => ({
  ...(hasModes(harness) ? { modes: Object.keys(harness.modes) } : {}),
  // Each action's own phase ids: a phase another action has is still unknown to this one.
  ...(hasPhases(harness)
    ? { phases: Object.fromEntries(Object.entries(harness.actions).flatMap(([id, a]) => (a.phases ? [[id, a.phases.map((p) => p.id)]] : []))) }
    : {}),
});
```

3. In `appState`'s actions map (line ~309), after `defaultMode`:

```ts
          // What the stepper shows of each phase (never its brief), and the time box's lengths (task-phases D0).
          ...(a.phases
            ? {
                phases: a.phases.map((p) => ({
                  id: p.id,
                  label: p.label,
                  ...(p.auto ? { auto: true as const } : {}),
                  ...(p.close ? { close: true as const } : {}),
                  ...(p.modes !== undefined ? { modes: p.modes } : {}),
                })),
              }
            : {}),
          ...(a.timeBox ? { timeBox: { options: a.timeBox.options, default: a.timeBox.default } } : {}),
```

4. In the `TaskManager` deps (after `readModeBrief`):

```ts
  readPhaseBrief: (action, phase) => {
    const p = Object.hasOwn(harness.actions, action) ? harness.actions[action].phases?.find((x) => x.id === phase) : undefined;
    if (!p?.brief) return Promise.reject(new Error("Unknown phase"));
    return fs.readFile(resolveInHarness(harness, p.brief), "utf8");
  },
  // Before the turn's events: the window draws the change's separator or the wrap-up line (task-phases spec §4.4, §5).
  taskTurn: (notice) => sendToWindow("hh:taskTurn", notice),
  ...(hooks.minuteMs ? { minuteMs: hooks.minuteMs } : {}),
```

and in `recordCompaction`'s meta, after `mode`: `...(task.phase ? { taskPhase: task.phase.id } : {}),`.

5. In `hh:send` (line ~818), after the mode check:

```ts
    // The time box the person picked (task-phases spec §5): one the action doesn't offer is refused before anything closes.
    const offered = action ? harness.actions[action].timeBox?.options : undefined;
    const timeBox = options?.timeBox;
    if (timeBox !== undefined && (timeBox !== null ? !(offered ?? []).includes(timeBox) : !offered)) throw new Error("Unknown time box");
```

and change the start to `tasks.start(action, message, scope, mode, timeBox !== undefined ? { timeBox } : {})`.

6. After the `hh:chooseMode` handler:

```ts
  // The person's pick of a phase (task-phases spec §4.2): the acceptance comes back as data.
  handle("hh:setPhase", setPhaseHandler({ quitting: () => quitting, blocked: turnBlocked, setPhase: (to, task) => tasks.setPhase(to, task) }));
  // The stepper's Finish and the time box's controls.
  handle("hh:finishTask", () => {
    if (quitting) throw new Error("The app is closing");
    const blocked = turnBlocked();
    if (blocked) throw new Error(blocked);
    return tasks.finish();
  });
  handle("hh:pauseTask", () => tasks.pauseTimeBox());
  handle("hh:resumeTask", () => tasks.resumeTimeBox());
  handle("hh:extendTimeBox", () => tasks.extendTimeBox());
```

`before-quit` already calls `tasks.close()`, which now pauses the time box (Task 9).

- [ ] **Step 7: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/shell/test/phase-ipc.test.ts packages/shell/test/test-hooks.test.ts packages/cli/test/dev.test.ts`
Expected: PASS.

- [ ] **Step 8: Verify everything and commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test` and `corepack pnpm app:build`
Expected: all green. D0: `appState` of the demo harness has no `phases` or `timeBox` on any action (`HarnessApp.test.tsx` and the e2e `flow.spec.ts` unchanged).

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/shell/src/main/phase-ipc.ts packages/shell/src/main/index.ts packages/shell/src/main/test-hooks.ts packages/shell/src/preload/index.ts packages/ui/src/client.ts packages/ui/test/fake-client.ts packages/cli/src/mock-session.ts packages/shell/test/phase-ipc.test.ts packages/shell/test/test-hooks.test.ts packages/cli/test/dev.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(shell): wire task phases and the time box to the window

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 11: The PhaseStepper

**Files:**
- Create: `packages/ui/src/phases.ts`, `packages/ui/src/PhaseStepper.tsx`
- Modify: `packages/ui/src/index.ts`, `packages/ui/src/styles.css`, `packages/i18n/src/locales/en.json`
- Test: `packages/ui/test/phase-stepper.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/ui/test/phase-stepper.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CurrentTaskView, PhaseView } from "../src/client";
import { PhaseStepper } from "../src/PhaseStepper";
import { phaseModesOf, timeLeftMs } from "../src/phases";
import { renderIn } from "./render";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const PHASES: PhaseView[] = [
  { id: "warmup", label: "Warm-up", auto: true, modes: "none" },
  { id: "main", label: "Main block" },
  { id: "close", label: "Close", close: true, modes: "none" },
];
const NOW = "2026-10-26T10:00:00.000Z";
const task = (over: Partial<CurrentTaskView> = {}): CurrentTaskView => ({ id: "t1", action: "session", status: "waiting", phase: "main", ...over });

function stepper(current: CurrentTaskView, disabled = false) {
  const calls: string[] = [];
  const props = {
    phases: PHASES,
    task: current,
    disabled,
    onPhase: (id: string) => calls.push(`phase:${id}`),
    onFinish: () => calls.push("finish"),
    onPause: () => calls.push("pause"),
    onResume: () => calls.push("resume"),
    onExtend: () => calls.push("extend"),
  };
  return { calls, props };
}

describe("phases helpers", () => {
  it("phaseModesOf narrows the action's modes by the phase", () => {
    expect(phaseModesOf(["a", "b"], PHASES[0])).toEqual([]);
    expect(phaseModesOf(["a", "b"], PHASES[1])).toEqual(["a", "b"]);
    expect(phaseModesOf(["a", "b"], { id: "x", label: "X", modes: ["b", "z"] })).toEqual(["b"]);
    expect(phaseModesOf(["a", "b"], undefined)).toEqual(["a", "b"]);
  });

  it("timeLeftMs counts from the view's moment unless paused, never below zero", () => {
    const box = { minutes: 10, totalMs: 600_000, usedMs: 60_000, at: NOW, paused: false };
    expect(timeLeftMs(box, Date.parse(NOW) + 30_000)).toBe(510_000);
    expect(timeLeftMs({ ...box, paused: true }, Date.parse(NOW) + 30_000)).toBe(540_000);
    expect(timeLeftMs(box, Date.parse(NOW) + 10 * 600_000)).toBe(0);
  });
});

describe("PhaseStepper", () => {
  it("shows the parts in order, the current one marked, and moves on a click", async () => {
    const s = stepper(task());
    await renderIn("en", <PhaseStepper {...s.props} />);
    const group = screen.getByRole("navigation", { name: "Task parts" });
    expect(group.textContent).toContain("Warm-up");
    expect(screen.getByRole("button", { name: "Main block" }).getAttribute("aria-current")).toBe("step");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(s.calls).toEqual(["phase:close"]);
  });

  it("shows the agent's proposal as a card the person confirms or dismisses", async () => {
    const s = stepper(task({ phaseProposal: { to: "close", reason: "We covered it all." } }));
    await renderIn("en", <PhaseStepper {...s.props} />);
    expect(screen.getByText("The AI proposes to move to Close: We covered it all.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Go to Close" }));
    expect(s.calls).toEqual(["phase:close"]);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByText(/The AI proposes/)).toBeNull();
  });

  it("in the close part: a proposal to finish, and a Finish button", async () => {
    const s = stepper(task({ phase: "close", phaseProposal: { to: "close", reason: "All summed up." } }));
    await renderIn("en", <PhaseStepper {...s.props} />);
    expect(screen.getByText("The AI says this part is done: All summed up.")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Finish" })[0]);
    expect(s.calls).toEqual(["finish"]);
  });

  it("the time left, counting down; pause, resume, +5 min", async () => {
    vi.useFakeTimers({ now: Date.parse(NOW) });
    const s = stepper(task({ timeBox: { minutes: 10, totalMs: 600_000, usedMs: 0, at: NOW, paused: false } }));
    await renderIn("en", <PhaseStepper {...s.props} />);
    expect(screen.getByText("10 min left")).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(61_000);
    });
    expect(screen.getByText("9 min left")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    fireEvent.click(screen.getByRole("button", { name: "+5 min" }));
    expect(s.calls).toEqual(["pause", "extend"]);
  });

  it("time up without a close part: Time is up and Finish", async () => {
    const s = stepper(task({ timeBox: { minutes: 10, totalMs: 600_000, usedMs: 600_000, at: NOW, paused: false, wrappedUp: true, ended: true } }));
    s.props.phases = PHASES.slice(0, 2);
    await renderIn("en", <PhaseStepper {...s.props} />);
    expect(screen.getByText("Time is up")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(s.calls).toEqual(["finish"]);
  });

  it("disabled while a turn runs", async () => {
    const s = stepper(task(), true);
    await renderIn("en", <PhaseStepper {...s.props} />);
    expect((screen.getByRole("button", { name: "Close" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm vitest run packages/ui/test/phase-stepper.test.tsx`
Expected: FAIL (no `PhaseStepper`, no `phases` module).

- [ ] **Step 3: The helpers**

Create `packages/ui/src/phases.ts`:

```ts
import type { AppState, PhaseView, TimeBoxView } from "./client";

/** The phases of `action`, in order; none without phases (D0). */
export function actionPhases(state: Pick<AppState, "actions">, action: string | undefined): PhaseView[] {
  return action !== undefined && Object.hasOwn(state.actions, action) ? (state.actions[action].phases ?? []) : [];
}

/** The modes allowed in `phase` among the action's `modes` (modes spec §7); all of them without a phase. */
export function phaseModesOf(modes: string[], phase: PhaseView | undefined): string[] {
  const allowed = phase?.modes;
  if (allowed === undefined || allowed === "any") return modes;
  if (allowed === "none") return [];
  return modes.filter((m) => allowed.includes(m));
}

/** The time left at `now` (ms since epoch): the view was measured at `at` and counts on unless paused. */
export function timeLeftMs(box: Pick<TimeBoxView, "totalMs" | "usedMs" | "at" | "paused">, now: number): number {
  const used = box.usedMs + (box.paused ? 0 : Math.max(0, now - Date.parse(box.at)));
  return Math.max(0, box.totalMs - used);
}
```

- [ ] **Step 4: The strings**

In `packages/i18n/src/locales/en.json`, after the `modes` object, add:

```json
  "phases": {
    "stepper": "Task parts",
    "proposal": "The AI proposes to move to {{phase}}: {{reason}}",
    "proposalFinish": "The AI says this part is done: {{reason}}",
    "go": "Go to {{phase}}",
    "finish": "Finish",
    "notNow": "Not now",
    "left_one": "{{count}} min left",
    "left_other": "{{count}} min left",
    "lessThanMinute": "Less than a minute left",
    "timeUp": "Time is up",
    "pause": "Pause",
    "resume": "Resume",
    "paused": "Paused",
    "extend": "+5 min",
    "timeTitle": "How long?",
    "noLimit": "No limit",
    "minutes": "{{count}} min",
    "wrapUpLine": "Time is almost up",
    "failed": "That didn't go through. Try again."
  },
```

(Other locales get these keys through the agentic translation flow, like every new core string.)

- [ ] **Step 5: The component**

Create `packages/ui/src/PhaseStepper.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CurrentTaskView, PhaseView } from "./client";
import { timeLeftMs } from "./phases";

/**
 * The open task's parts above the chat (task-phases spec §6): each part in order, the current one marked, a click
 * moves there. Under it, the agent's proposal waiting for the person, and the time box with its controls.
 */
export function PhaseStepper({
  phases,
  task,
  disabled,
  onPhase,
  onFinish,
  onPause,
  onResume,
  onExtend,
}: {
  phases: PhaseView[];
  task: CurrentTaskView;
  disabled: boolean;
  onPhase: (id: string) => void;
  onFinish: () => void;
  onPause: () => void;
  onResume: () => void;
  onExtend: () => void;
}) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  // "Not now" hides the proposal on this screen; a new one (another target or reason) shows again.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const box = task.timeBox;
  useEffect(() => {
    if (!box || box.paused) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [box]);
  const current = phases.find((p) => p.id === task.phase);
  const proposal = task.phaseProposal;
  const proposalKey = proposal ? `${proposal.to}\n${proposal.reason}` : null;
  const target = proposal ? phases.find((p) => p.id === proposal.to) : undefined;
  const hasClose = phases.some((p) => p.close);
  const left = box ? timeLeftMs(box, now) : null;
  const minute = box ? box.totalMs / box.minutes : 60_000;
  return (
    <div className="hh-phase-bar">
      <nav aria-label={t("phases.stepper")}>
        <ol className="hh-phase-steps">
          {phases.map((p) => (
            <li key={p.id}>
              <button type="button" aria-current={p.id === task.phase ? "step" : undefined} disabled={disabled} onClick={() => onPhase(p.id)}>
                {p.label}
              </button>
            </li>
          ))}
        </ol>
      </nav>
      {current?.close && (
        <button type="button" disabled={disabled} onClick={onFinish}>
          {t("phases.finish")}
        </button>
      )}
      {proposal && target && proposalKey !== dismissed && (
        <div className="hh-phase-proposal" role="status">
          <p>
            {target.id === task.phase && target.close
              ? t("phases.proposalFinish", { reason: proposal.reason })
              : t("phases.proposal", { phase: target.label, reason: proposal.reason })}
          </p>
          {target.id === task.phase && target.close ? (
            <button type="button" disabled={disabled} onClick={onFinish}>
              {t("phases.finish")}
            </button>
          ) : (
            <button type="button" disabled={disabled} onClick={() => onPhase(target.id)}>
              {t("phases.go", { phase: target.label })}
            </button>
          )}
          <button type="button" onClick={() => setDismissed(proposalKey)}>
            {t("phases.notNow")}
          </button>
        </div>
      )}
      {box && left !== null && (
        <div className="hh-time-box" role="group" aria-label={t("phases.timeTitle")}>
          <span aria-live="polite">
            {box.ended || left === 0
              ? t("phases.timeUp")
              : box.paused
                ? t("phases.paused")
                : left < minute
                  ? t("phases.lessThanMinute")
                  : t("phases.left", { count: Math.ceil(left / minute) })}
          </span>
          {!box.ended && (box.paused ? (
            <button type="button" onClick={onResume}>
              {t("phases.resume")}
            </button>
          ) : (
            <button type="button" disabled={task.status !== "waiting"} onClick={onPause}>
              {t("phases.pause")}
            </button>
          ))}
          <button type="button" onClick={onExtend}>
            {t("phases.extend")}
          </button>
          {!hasClose && (box.wrappedUp || box.ended) && (
            <button type="button" disabled={disabled} onClick={onFinish}>
              {t("phases.finish")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

The test's "10 min left" after 0 ms: `Math.ceil(600000 / 60000)` is 10; after 61 s, `Math.ceil(539000 / 60000)` is 9.

- [ ] **Step 6: Export and styles**

In `packages/ui/src/index.ts`, add `export { PhaseStepper } from "./PhaseStepper";` (a harness's own UI may show it).

In `packages/ui/src/styles.css`, after `.hh-mode-line`:

```css
.hh-phase-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 16px; border-bottom: 1px solid var(--hh-line); }
.hh-phase-steps { display: flex; flex-wrap: wrap; gap: 4px; list-style: none; margin: 0; padding: 0; }
.hh-phase-steps button { border-radius: 999px; padding: 4px 12px; }
.hh-phase-steps button[aria-current="step"] { background: var(--hh-accent); color: var(--hh-on-accent); }
.hh-phase-proposal { flex-basis: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 12px; border: 1px solid var(--hh-line-strong); border-radius: 8px; background: var(--hh-paper); }
.hh-phase-proposal p { margin: 0; flex: 1 1 240px; }
.hh-time-box { display: flex; align-items: center; gap: 8px; margin-left: auto; color: var(--hh-muted); font-size: 13px; }
```

Check the variable names against the top of `styles.css` (`--hh-accent`, `--hh-on-accent`); `styles.test.ts` fails on an undefined variable — use the ones the mode bar's pressed buttons use if these differ.

- [ ] **Step 7: Run the test to verify it passes**

Run: `corepack pnpm vitest run packages/ui/test/phase-stepper.test.tsx packages/ui/test/styles.test.ts`
Expected: PASS.

- [ ] **Step 8: Verify everything and commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test` and `corepack pnpm app:build`
Expected: all green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/ui/src/phases.ts packages/ui/src/PhaseStepper.tsx packages/ui/src/index.ts packages/ui/src/styles.css packages/i18n/src/locales/en.json packages/ui/test/phase-stepper.test.tsx
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(ui): the phase stepper with the proposal and the time box

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 12: The chat: the stepper, the change's line, the time picker, modes by part, history

**Files:**
- Modify: `packages/ui/src/ChatView.tsx`, `packages/ui/src/state.ts`, `packages/ui/src/Message.tsx`, `packages/ui/src/HistoryPanel.tsx`
- Test: `packages/ui/test/phases.test.tsx` (new), `packages/ui/test/history-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/ui/test/phases.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HarnessApp } from "../src";
import type { CurrentTaskView } from "../src/client";
import { FakeClient } from "./fake-client";

afterEach(cleanup);

const PHASES = [
  { id: "warmup", label: "Warm-up", auto: true as const, modes: "none" as const },
  { id: "main", label: "Main block" },
  { id: "close", label: "Close", close: true as const, modes: "none" as const },
];

function tutorClient(opts: { current?: Partial<CurrentTaskView> | null; timeBox?: boolean; modes?: boolean } = {}) {
  const client = new FakeClient({ language: "en", folder: "/Users/me/Documents/Tutor", engineId: "claude" });
  client.state.actions = {
    session: {
      label: "Session",
      cost: "light",
      phases: PHASES,
      ...(opts.timeBox ? { timeBox: { options: [15, 30], default: null } } : {}),
      ...(opts.modes ? { modes: ["socratic", "feynman"], defaultMode: "socratic" } : {}),
    },
    quiz: { label: "Quiz", cost: "light" },
  };
  client.state.path = ["session", "quiz"];
  if (opts.modes) client.state.modes = { socratic: { label: "Socratic" }, feynman: { label: "Feynman" } };
  if (opts.current !== null) {
    client.chat = [
      { id: "u", role: "user", text: "Session", blocks: [], activities: [], at: "t", action: "session", task: "t1" },
      { id: "a", role: "assistant", text: "What do you remember?", blocks: [], activities: [], at: "t", task: "t1" },
    ];
    client.tasks = { current: { id: "t1", action: "session", status: "waiting", phase: "warmup", ...opts.current }, actions: {}, notes: [] };
  }
  return client;
}

async function open(client: FakeClient, text: string | null = "What do you remember?") {
  render(<HarnessApp client={client} blocks={{}} />);
  const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
  await waitFor(() => expect(start.disabled).toBe(false));
  fireEvent.click(start);
  if (text) await screen.findByText(text);
}

const steps = () => screen.getByRole("navigation", { name: "Task parts" });

describe("task phases in the chat", () => {
  it("D0: an action without phases has no stepper and no time picker", async () => {
    const client = tutorClient({ current: { action: "quiz", phase: undefined } });
    await open(client);
    expect(screen.queryByRole("navigation", { name: "Task parts" })).toBeNull();
    expect(screen.queryByRole("group", { name: "How long?" })).toBeNull();
  });

  it("shows the stepper and moves the task; the change's line comes before its answer", async () => {
    const client = tutorClient();
    await open(client);
    fireEvent.click(within(steps()).getByRole("button", { name: "Main block" }));
    await waitFor(() => expect(client.phaseCalls).toEqual([{ taskId: "t1", phaseId: "main" }]));
    act(() => client.emitTaskTurn({ task: "t1", kind: "phase", phase: "main", by: "person" }));
    expect(await screen.findByText("— Main block —")).toBeTruthy();
  });

  it("a change the app makes on its own (auto, the time box) draws its line too", async () => {
    const client = tutorClient();
    await open(client);
    act(() => client.emitTaskTurn({ task: "t1", kind: "wrap-up" }));
    expect(await screen.findByText("Time is almost up")).toBeTruthy();
  });

  it("asks how long before an action with a time box starts, and sends the pick", async () => {
    const client = tutorClient({ current: null, timeBox: true });
    await open(client, null);
    fireEvent.click(await screen.findByRole("button", { name: /Session/ }));
    const picker = await screen.findByRole("dialog", { name: "How long?" });
    fireEvent.click(within(picker).getByRole("button", { name: "30 min" }));
    await waitFor(() => expect(client.sentOptions.at(-1)).toMatchObject({ action: "session", timeBox: 30 }));
  });

  it("the mode bar lists only the modes the part allows, and hides when it allows none", async () => {
    const client = tutorClient({ modes: true });
    await open(client);
    expect(screen.queryByRole("group", { name: "Task mode" })).toBeNull();
    act(() => client.emitTasks({ ...client.tasks, current: { ...client.tasks.current!, phase: "main", mode: "socratic" } }));
    expect(await screen.findByRole("group", { name: "Task mode" })).toBeTruthy();
  });
});
```

`FakeClient` records the options of each send in `sentOptions` and pushes a tasks view with `emitTasks`. The start button's name comes from the start screen's action card; copy the query `modes.test.tsx` uses for `defaultMode: "ask"` if it differs.

In `packages/ui/test/history-panel.test.tsx`, add a case: an action with `phases` and a history item with `phase: "main"` shows the caption "Main block" next to the entry's text; an item without `phase` shows none.

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm vitest run packages/ui/test/phases.test.tsx packages/ui/test/history-panel.test.tsx`
Expected: FAIL (no stepper; no time picker; the mode bar shows in the warm-up).

- [ ] **Step 3: The chat entry's phase lines**

In `packages/ui/src/state.ts`, widen the `user` action to `{ type: "user"; text: string; at: string; action?: string; mode?: string; phase?: string; timeUp?: true }` and, in its case, after the `mode` line:

```ts
            ...(action.phase ? { phase: action.phase } : {}),
            ...(action.timeUp ? { timeUp: true as const } : {}),
```

In `packages/ui/src/Message.tsx`, change the system-line condition to cover them (task-phases spec §4.4, §5: a line, not the person's message):

```tsx
  // A mode switch, a phase change or the wrap-up: a system line, not the person's message.
  if (entry.role === "user" && (entry.mode || entry.phase || entry.timeUp)) {
```

- [ ] **Step 4: The chat view**

In `packages/ui/src/ChatView.tsx`:

1. Imports: `import { PhaseStepper } from "./PhaseStepper";`, `import { actionPhases, phaseModesOf } from "./phases";`, and `TaskTurnNotice` from `./client`.

2. The initial blocks (line ~99) add the hidden tool, so a `set_phase` call never draws as an unknown block: `initialChat([], [...stateBlocks, "save_note", "set_phase"])`.

3. After `const taskModes = actionModes(state, tasks.current?.action);` (line ~183), narrow the modes by part:

```tsx
  const taskPhases = actionPhases(state, tasks.current?.action);
  const currentPhase = taskPhases.find((p) => p.id === tasks.current?.phase);
  // A part may allow fewer modes, or none (modes spec §7): the bar lists only those, and hides with none.
  const barModes = taskPhases.length > 0 ? taskModes.filter((m) => phaseModesOf(taskModes.map((x) => x.id), currentPhase).includes(m.id)) : taskModes;
  const [timePick, setTimePick] = useState<{ text: string; options: SendOptions } | null>(null);
  const [phaseFailed, setPhaseFailed] = useState(false);
  const tookTurn = useRef<(n: TaskTurnNotice) => void>(() => {});
```

and change the `ModeBar` condition and prop from `taskModes` to `barModes`.

4. Subscribe next to `onModeSwitch` (line ~219):

```tsx
    const offTurns = client.onTaskTurn((n) => tookTurn.current(n));
```

and call `offTurns()` in the cleanup.

5. After `tookSwitch.current = …`, add:

```tsx
  /** A turn the app starts on its own is coming (task-phases spec §4.4, §5): its line first, then its events. */
  tookTurn.current = (n: TaskTurnNotice) => {
    if (n.task !== tasks.current?.id) return;
    busy.current = true;
    stick.current = true;
    pinNext.current = true;
    lastPick.current = null;
    lastAnswer.current = false;
    const at = new Date().toISOString();
    if (n.kind === "wrap-up") {
      dispatch({ type: "user", text: t("phases.wrapUpLine"), at, timeUp: true });
      return;
    }
    const label = taskPhases.find((p) => p.id === n.phase)?.label ?? n.phase ?? "";
    dispatch({ type: "user", text: `— ${label} —`, at, ...(n.phase ? { phase: n.phase } : {}) });
  };
  /** The person moves the task (the stepper or the proposal's button). A refusal shows a short error. */
  const pickPhase = (id: string) => {
    const task = tasks.current;
    if (!task || blocked() || task.status !== "waiting") return;
    setPhaseFailed(false);
    client.setPhase(task.id, id).then(
      (r) => {
        if (!r.ok) setPhaseFailed(true);
      },
      () => setPhaseFailed(true),
    );
  };
  const finishTask = () => {
    if (!tasks.current || blocked()) return;
    client.finishTask().catch(() => setPhaseFailed(true));
  };
```

6. In `send`, before the `defaultMode: "ask"` check, ask for the time box (it comes before the mode question; each answer is sent along with the next):

```tsx
    // An action with a time box (task-phases spec §5): the person picks how long before anything is sent.
    if (options.action && options.timeBox === undefined && Object.hasOwn(state.actions, options.action) && state.actions[options.action].timeBox) {
      questionOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setTimePick({ text: message, options });
      return true;
    }
```

and widen the early guard to `(askPick && !options.mode) || (timePick && options.timeBox === undefined)`.

7. Where the `ModeBar` renders (line ~686), render the stepper above it:

```tsx
          {flow && since !== null && tasks.current && taskPhases.length > 0 && (
            <PhaseStepper
              phases={taskPhases}
              task={tasks.current}
              disabled={blocked() || pending !== null || tasks.current.status !== "waiting" || Boolean(chat.live)}
              onPhase={pickPhase}
              onFinish={finishTask}
              onPause={() => void client.pauseTask().catch(() => setPhaseFailed(true))}
              onResume={() => void client.resumeTask().catch(() => setPhaseFailed(true))}
              onExtend={() => void client.extendTimeBox().catch(() => setPhaseFailed(true))}
            />
          )}
          {phaseFailed && (
            <p className="hh-error" role="alert">
              {t("phases.failed")}
            </p>
          )}
```

and change the mode bar's condition to `barModes.length > 0`.

8. Before the `askPick` dialog (line ~831), the time picker:

```tsx
            {timePick && (
              <div
                className="hh-confirm"
                role="dialog"
                aria-labelledby="hh-time-title"
                onKeyDown={(e) => {
                  if (e.key !== "Escape") return;
                  e.preventDefault();
                  setTimePick(null);
                  refocus();
                }}
              >
                <p id="hh-time-title">
                  <strong>{t("phases.timeTitle")}</strong>
                </p>
                <div className="hh-mode-list" role="group" aria-labelledby="hh-time-title">
                  {[...(state.actions[timePick.options.action!]?.timeBox?.options ?? []), null].map((m) => (
                    <button
                      key={m ?? "none"}
                      type="button"
                      className="hh-choice"
                      onClick={() => {
                        const p = timePick;
                        setTimePick(null);
                        questionOpener.current = null;
                        inputRef.current?.focus();
                        send(p.text, { ...p.options, timeBox: m });
                      }}
                    >
                      {m === null ? t("phases.noLimit") : t("phases.minutes", { count: m })}
                    </button>
                  ))}
                </div>
                <button onClick={() => { setTimePick(null); refocus(); }}>{t("modes.notNow")}</button>
              </div>
            )}
```

The dialog's accessible name is "How long?" (its `aria-labelledby`); the e2e and the unit test query it that way.

9. In `retry`, before the `lastUser?.mode` branch: a change's or a wrap-up's line is never resent as a message:

```tsx
    // A phase change's or wrap-up's line is the app's, not the person's: nothing to resend (task-phases spec §4.4).
    if (lastUser?.phase || lastUser?.timeUp) return undefined;
```

10. In `tookSwitch` and `tookTurn`, close an open time picker like the mode question (`setTimePick(null)`), since it is about the task as it was.

- [ ] **Step 5: History shows the part**

In `packages/ui/src/HistoryPanel.tsx`, in the entries map (line ~342), after `<span>{entryText(e)}</span>`:

```tsx
                              {e.phase && g.actionId && Object.hasOwn(actions, g.actionId) && (
                                <span className="hh-caption">{actions[g.actionId].phases?.find((p) => p.id === e.phase)?.label}</span>
                              )}
```

(`HistoryItem.phase` comes from Task 5; a phase the manifest no longer has shows no caption.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/ui/test/phases.test.tsx packages/ui/test/history-panel.test.tsx packages/ui/test/modes.test.tsx`
Expected: PASS (the modes suite unchanged).

- [ ] **Step 7: Verify everything and commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test` and `corepack pnpm app:build`
Expected: all green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/ui/src/ChatView.tsx packages/ui/src/state.ts packages/ui/src/Message.tsx packages/ui/src/HistoryPanel.tsx packages/ui/test/phases.test.tsx packages/ui/test/history-panel.test.tsx
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(ui): phases in the chat: stepper, change lines, time picker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

## Phase 4 — Authoring tools and mock mode (spec §8 slice 4)

### Task 13: `check` reports a missing or empty phase brief

**Files:**
- Modify: `packages/cli/src/check.ts`
- Test: `packages/cli/test/check.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/cli/test/check.test.ts`, after the mode brief case, add:

```ts
  it("brief-missing: a phase's brief that is missing or empty (task-phases spec §3); a phase without one is fine", async () => {
    const dir = await fixture((d) => {
      replaceIn(
        d,
        "harness.config.ts",
        'cost: "light",',
        'cost: "light",\n      phases: [\n        { id: "warmup", label: "Warm-up", brief: "./agent/phases/warmup.md" },\n        { id: "main", label: "Main", brief: "./agent/phases/empty.md" },\n        { id: "extra", label: "Extra", brief: "./agent/phases/gone.md" },\n        { id: "close", label: "Close", close: true },\n      ],',
      );
      fs.mkdirSync(path.join(d, "agent", "phases"));
      fs.writeFileSync(path.join(d, "agent", "phases", "warmup.md"), "Two recall questions.\n");
      fs.writeFileSync(path.join(d, "agent", "phases", "empty.md"), " \n");
    });
    const r = await checkHarness(dir);
    expect(r.findings.filter((f) => f.rule === "brief-missing").map((f) => `${f.file} ${f.message}`)).toEqual([
      'agent/phases/empty.md Action "example", phase "main": its brief ./agent/phases/empty.md is empty.',
      'harness.config.ts Action "example", phase "extra": its brief ./agent/phases/gone.md does not exist.',
    ]);
    expect(errors(r).filter((f) => f.rule !== "brief-missing")).toEqual([]);
  });
```

(The template's only action is `example`; the first `cost: "light",` in its manifest is that action's.)

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm vitest run packages/cli/test/check.test.ts`
Expected: FAIL (no phase findings).

- [ ] **Step 3: The check**

In `packages/cli/src/check.ts`, after `modeFindings`:

```ts
/** Every phase brief exists and has text (task-phases spec §3); a phase without a brief changes only the state. */
async function phaseFindings(h: LoadedHarness): Promise<Finding[]> {
  const out: Finding[] = [];
  for (const [id, action] of Object.entries(h.actions)) {
    for (const phase of action.phases ?? []) {
      if (!phase.brief) continue;
      const file = resolveInHarness(h, phase.brief);
      const text = await read(file);
      const where = `Action "${id}", phase "${phase.id}": its brief ${phase.brief}`;
      if (text === null) out.push(error("brief-missing", `${where} does not exist.`, MANIFEST));
      else if (!text.trim()) out.push(error("brief-missing", `${where} is empty.`, path.relative(h.root, file)));
    }
  }
  return out;
}
```

and in `checkHarness`, after `findings.push(...(await modeFindings(harness)));`, add `findings.push(...(await phaseFindings(harness)));`.

- [ ] **Step 4: Run it to verify it passes**

Run: `corepack pnpm vitest run packages/cli/test/check.test.ts`
Expected: PASS (D0: the template has no phases, so every other case is unchanged).

- [ ] **Step 5: Verify everything and commit**

Run: `corepack pnpm typecheck` and `corepack pnpm test`
Expected: all green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/cli/src/check.ts packages/cli/test/check.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(cli): check reports missing phase briefs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 14: Mock mode replays phase changes and the wrap-up; `--record` writes them

**Files:**
- Modify: `packages/fake-agent/src/mock.ts`, `packages/fake-agent/src/mock-replay.ts`, `packages/cli/src/record.ts`, `packages/shell/test/task-prompts.test.ts`
- Create: `packages/fake-agent/fixtures/phases-harness/mock/session.json`
- Test: `packages/fake-agent/test/mock-replay.test.ts`, `packages/fake-agent/test/mock.test.ts`, `packages/cli/test/record.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/fake-agent/test/mock.test.ts`, add:

```ts
  it("a turn may carry setPhase (a phase id) or timeUp: true; nothing else", () => {
    const base = { version: 1, action: "session", match: "# Task: session" };
    expect(recordingSchema.safeParse({ ...base, turns: [{ id: "t1" }, { id: "t2", setPhase: "main" }, { id: "t3", timeUp: true }] }).success).toBe(true);
    for (const bad of [{ id: "t2", setPhase: "Main" }, { id: "t2", timeUp: false }, { id: "t2", setPhase: "" }]) {
      expect(recordingSchema.safeParse({ ...base, turns: [{ id: "t1" }, bad] }).success).toBe(false);
    }
  });
```

In `packages/fake-agent/test/mock-replay.test.ts`, extend `promptKind`'s case and add a `describe`:

```ts
    expect(promptKind('Next part of this task: "Main block" (`main`).\n\nTeach.')).toBe("phase");
    expect(promptKind("Time is almost up: finish the current point briefly, in en.")).toBe("wrap-up");
```

```ts
describe("replay: phases (task-phases spec §6)", () => {
  const tutor = recordingSchema.parse({
    version: 1,
    action: "session",
    match: "# Task: session",
    turns: [
      { id: "t1", text: "What do you remember?", blocks: [{ tool: "set_phase", input: { to: "main", reason: "Recall done" } }], next: { "*": "t2" } },
      { id: "t2", text: "Let's start.", setPhase: "main" },
      { id: "t3", text: "Last point, quickly.", timeUp: true },
      { id: "t4", text: "Sum it up.", setPhase: "close" },
    ],
  });
  const at = { action: "session", turn: "t1" };

  it("a phase change plays the turn recorded for that part, wherever the session is", () => {
    const r = replay([tutor], at, 'Next part of this task: "Main block" (`main`).\n\nTeach.', false);
    expect(r.play.text).toBe("Let's start.");
    expect(r.session).toEqual({ action: "session", turn: "t2" });
    expect(replay([tutor], r.session, 'Next part of this task: "Close" (`close`).', false).play.text).toBe("Sum it up.");
  });

  it("the wrap-up plays the timeUp turn; a part or wrap-up not recorded plays the fallback and stays put", () => {
    expect(replay([tutor], at, "Time is almost up: finish the current point briefly, in en.", false).play.text).toBe("Last point, quickly.");
    const none = replay([tutor], at, 'Next part of this task: "Extra" (`extra`).', false);
    expect(none.play.text).toBe(DEFAULT_FALLBACK);
    expect(none.session).toEqual(at);
  });

  it("a setPhase or timeUp turn is never reached by a reply", () => {
    const r = replay([tutor], { action: "session", turn: "t2" }, "Tell me more", false);
    expect(r.play.text).toBe(DEFAULT_FALLBACK);
  });
});
```

In `packages/shell/test/task-prompts.test.ts`, next to the existing `promptKind` pins, add:

```ts
    expect(promptKind(phasePrompt({ id: "main", label: "Main block", brief: "Teach." }, { language: "en" }))).toBe("phase");
    expect(promptKind(wrapUpPrompt("en"))).toBe("wrap-up");
```

In `packages/cli/test/record.test.ts`, add:

```ts
  it("a phase change turn is recorded with setPhase, a wrap-up with timeUp; neither is linked by next", async () => {
    const folder = path.join(root, "rec-phases");
    fs.mkdirSync(folder, { recursive: true });
    const r = new Recorder({ folder, toolFor, matchFor, recordedWith: "claude" });
    await r.begin();
    r.event({ type: "text", delta: "Recall?" });
    await r.turnEnded({ action: "session", task: "t1", phase: "run", taskPhase: "warmup" });
    r.event({ type: "text", delta: "Main now." });
    await r.turnEnded({ action: "session", task: "t1", phase: "phase-change", taskPhase: "main" });
    r.reply("*");
    r.event({ type: "text", delta: "Sure." });
    await r.turnEnded({ action: "session", task: "t1", phase: "run", taskPhase: "main" });
    r.event({ type: "text", delta: "Wrap up." });
    await r.turnEnded({ action: "session", task: "t1", phase: "wrap-up", taskPhase: "main" });
    const [rec] = r.recordings();
    expect(rec.turns.map((t) => ({ id: t.id, setPhase: t.setPhase, timeUp: t.timeUp, next: t.next }))).toEqual([
      { id: "t1", setPhase: undefined, timeUp: undefined, next: undefined },
      { id: "t2", setPhase: "main", timeUp: undefined, next: { "*": "t3" } },
      { id: "t3", setPhase: undefined, timeUp: undefined, next: undefined },
      { id: "t4", setPhase: undefined, timeUp: true, next: undefined },
    ]);
    expect(recordingSchema.safeParse(rec).success).toBe(true);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `corepack pnpm vitest run packages/fake-agent/test packages/cli/test/record.test.ts packages/shell/test/task-prompts.test.ts`
Expected: FAIL (`setPhase`/`timeUp` are unknown keys; `promptKind` has no `phase`/`wrap-up`).

- [ ] **Step 3: The schema**

In `packages/fake-agent/src/mock.ts`, add to `mockTurnSchema` after `respond`:

```ts
  /** The recorded answer to the app's move into this part (task-phases spec §6): played for that phase change turn. */
  setPhase: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/).optional(),
  /** The recorded answer to the time box's wrap-up turn. */
  timeUp: z.literal(true).optional(),
```

(The regex is `PHASE_ID`; the fake-agent package doesn't import the sdk's schema module here, as with `respond.block`.)

- [ ] **Step 4: The replay**

In `packages/fake-agent/src/mock-replay.ts`:

```ts
/**
 * The app's fixed prompts start with these (CLOSE_PROMPT, CHECKPOINT_PROMPT, PHASE_PROMPT and WRAP_UP_PROMPT in the
 * shell's task-prompts.ts; a shell test pins them).
 */
export function promptKind(prompt: string): "close" | "checkpoint" | "phase" | "wrap-up" | "reply" {
  if (prompt.startsWith("We are closing this topic.")) return "close";
  if (prompt.startsWith("Checkpoint:")) return "checkpoint";
  if (prompt.startsWith("Next part of this task:")) return "phase";
  if (prompt.startsWith("Time is almost up:")) return "wrap-up";
  return "reply";
}

/** The phase id a phase change prompt names: its first line ends with (`<id>`). */
const phaseOfPrompt = (prompt: string): string | undefined => /^Next part of this task: .*\(`([a-z][a-z0-9_-]{0,63})`\)/.exec(prompt)?.[1];
```

In `replay`, after the `checkpoint` line:

```ts
  // A phase change or the wrap-up is the app's prompt, not a reply: it plays the turn recorded for it (spec §6).
  if (kind === "phase" || kind === "wrap-up") {
    const id = kind === "phase" ? phaseOfPrompt(prompt) : undefined;
    const turn = rec?.turns.find((t) => (kind === "phase" ? id !== undefined && t.setPhase === id : t.timeUp === true));
    if (turn) return { play: playTurn(turn), session: { ...position, turn: turn.id } };
    return { play: quiet(rec?.fallback?.text ?? DEFAULT_FALLBACK), session: position };
  }
```

A reply never reaches a `setPhase` or `timeUp` turn unless a `next` names it, and `--record` never writes such a `next` (Step 5); `firstTurn` skips them too:

```ts
const firstTurn = (r: Recording) => r.turns.find((t) => t.id !== "close" && !t.setPhase && !t.timeUp);
```

- [ ] **Step 5: The recorder**

In `packages/cli/src/record.ts`, in `turnEnded` (its `meta` type already has `phase?: TurnKind; taskPhase?: string` from Task 5):

1. Replace `const turn: MockTurn = { … };` with:

```ts
    const turn: MockTurn = {
      id,
      text: taken.text,
      blocks: taken.blocks,
      writes,
      ...(taken.usage ? { usage: taken.usage } : {}),
      // The app's own prompts (task-phases spec §6): replayed by what they answer, never by a reply.
      ...(meta.phase === "phase-change" && meta.taskPhase ? { setPhase: meta.taskPhase } : {}),
      ...(meta.phase === "wrap-up" ? { timeUp: true as const } : {}),
    };
```

2. Change the link condition to skip them: `if (meta.phase !== "close" && meta.phase !== "phase-change" && meta.phase !== "wrap-up" && this.lastTurn?.action === action) {`. Before it, for those two kinds, drop the pending reply so the next run turn isn't linked from the turn before the change:

```ts
    if (meta.phase === "phase-change" || meta.phase === "wrap-up") {
      this.replyKey = undefined;
      this.answerKey = undefined;
    }
```

They still become `lastTurn` (the reply after them links from them), as the test expects.

- [ ] **Step 6: The fixture's recording**

Create `packages/fake-agent/fixtures/phases-harness/mock/session.json`:

```json
{
  "version": 1,
  "action": "session",
  "match": "# Task: session",
  "recordedWith": "hand-written",
  "turns": [
    {
      "id": "t1",
      "text": "Before we start: what is a half?",
      "blocks": [{ "tool": "set_phase", "input": { "to": "main", "reason": "The recall is done." } }]
    },
    { "id": "t2", "text": "Main block: let's split a pizza in four.", "setPhase": "main", "next": { "*": "t3" } },
    {
      "id": "t3",
      "text": "Good. I think we covered it.",
      "blocks": [{ "tool": "set_phase", "input": { "to": "close", "reason": "We covered quarters." } }]
    },
    { "id": "t4", "text": "Time is almost up: one last idea, quickly.", "timeUp": true },
    { "id": "t5", "text": "Sum up what you learned in three lines.", "setPhase": "close" },
    { "id": "close", "note": { "title": "Fractions", "summary": ["Halves and quarters"], "decisions": [], "files": [], "open": [] } }
  ]
}
```

The `tool` name is the one `toolFor("set_phase")` gives (Task 2's tool map: `set_phase`); check it against `packages/fake-agent/fixtures/modes-harness`'s recordings if those exist, and against `humanharness check`'s mock findings (`mockFindings`), which must accept it.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/fake-agent/test packages/cli/test/record.test.ts packages/cli/test/mock-replay.test.ts packages/shell/test/task-prompts.test.ts`
Expected: PASS.

- [ ] **Step 8: Verify everything and commit**

Run: `corepack pnpm typecheck` and `corepack pnpm test`
Expected: all green; the demo's recordings in `harnesses/demo/mock` still parse (D0).

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/fake-agent/src/mock.ts packages/fake-agent/src/mock-replay.ts packages/cli/src/record.ts packages/fake-agent/fixtures/phases-harness/mock/session.json packages/fake-agent/test packages/cli/test/record.test.ts packages/shell/test/task-prompts.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(mock): replay and record phase changes and the wrap-up

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 15: `humanharness run`: `--time`, `>phase <id>`, the lines and proposals in the terminal

**Files:**
- Modify: `packages/cli/src/run.ts`, `packages/cli/src/terminal.ts`
- Test: `packages/cli/test/run.test.ts`, `packages/cli/test/terminal.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/cli/test/run.test.ts`, add a `describe` that runs the `tutor` fixture (path like the modes cases' `coach`: `path.resolve(here, "../../fake-agent/fixtures/phases-harness")`):

```ts
describe("run: task phases (task-phases spec §6)", () => {
  const tutor = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/phases-harness");
  const tutorScript: ClaudeScript = {
    steps: [...claudeTextLines("Listo."), result],
    turns: [
      { match: "save_note", steps: [ui("save_note", { title: "Fractions", summary: ["x"], decisions: [], files: [], open: [] }), result] },
      { match: "Next part of this task: \"Close\"", steps: [...claudeTextLines("Sum it up."), result] },
      { match: "Next part of this task: \"Main block\"", steps: [...claudeTextLines("Main now."), ui("set_phase", { to: "close", reason: "Covered." }), result] },
      { match: "# Task: session", steps: [...claudeTextLines("What is a half?"), ui("set_phase", { to: "main", reason: "Recall done." }), result] },
    ],
  };
  const run = (name: string, input: string, extra: { time?: number } = {}) => {
    const out = memoryStream();
    const prompts = path.join(root, `${name}-prompts.jsonl`);
    const folder = path.join(root, name);
    const done = runTask({
      harnessDir: tutor,
      action: "session",
      engine: "claude",
      folder,
      ...extra,
      input: lines(input),
      output: out.stream,
      engineCommand: { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(root, tutorScript), HH_FAKE_PROMPTS: prompts } },
    });
    return { done, out, folder, prompts: () => readJsonl(prompts).map((p) => (p as { prompt: string }).prompt) };
  };

  it("auto moves from the warm-up; a proposal prints with its command; >phase moves; the close part closes on q", { timeout: 60_000 }, async () => {
    const r = run("tutor-phases", ">phase close\nq\n");
    await r.done;
    const text = r.out.text();
    expect(text).toContain("— Main block —");
    expect(text).toContain("The AI proposes to move to Close: Covered. Type >phase close to go there.");
    expect(text).toContain(">phase <id> to change part");
    expect(text).toContain("— Close —");
    const [first, main, close, closing] = r.prompts();
    expect(first).toContain("## Parts of this task");
    expect(main.startsWith('Next part of this task: "Main block" (`main`).')).toBe(true);
    expect(close.startsWith('Next part of this task: "Close" (`close`).')).toBe(true);
    expect(closing).toContain("save_note");
    const usage = readJsonl(path.join(r.folder, ".harness", "usage.jsonl"));
    expect(usage.map((u) => [u.phase, u.taskPhase])).toEqual([
      ["run", "warmup"],
      ["phase-change", "main"],
      ["phase-change", "close"],
      ["close", "close"],
    ]);
  });

  it("--time starts with a time box: the first message says the time; a length not offered is refused", async () => {
    await expect(run("tutor-bad-time", "q\n", { time: 20 }).done).rejects.toThrow('Unknown time box "20" for session. Lengths: 15, 30, 45.');
  });

  it("D0: an action without phases prints no part hint and >phase is a follow-up", { timeout: 60_000 }, async () => {
    // The coach fixture's study action has no phases.
    const r = runCoach("coach-no-phases", ">phase main\nq\n");
    await r.done;
    expect(r.out.text()).not.toContain(">phase <id>");
    expect(r.prompts()[1]).toBe(">phase main");
  });
});
```

`runCoach` is the modes `describe`'s `run` helper; move it to the file's top level (renamed) so both blocks use it. Add `time?: number` to the test's runTask options type through `RunOptions` (Step 3).

In `packages/cli/test/terminal.test.ts`, add: `view.taskTurn({ task: "t1", kind: "phase", phase: "main", by: "agent" }, "Main block")` writes `\n— Main block —\n`; `view.taskTurn({ task: "t1", kind: "wrap-up" })` writes `\nTime is almost up\n`.

- [ ] **Step 2: Run them to verify they fail**

Run: `corepack pnpm vitest run packages/cli/test/run.test.ts packages/cli/test/terminal.test.ts`
Expected: FAIL (no phase lines, no `--time`, no `taskTurn` on the view).

- [ ] **Step 3: The run**

In `packages/cli/src/run.ts`:

1. Import `PHASE_ID` from the sdk. In `RunOptions`, after `mode`:

```ts
  /** Start the task with a time box of this many minutes (task-phases spec §5): one of the action's lengths. */
  time?: number;
```

2. In `runTask`, after the mode check:

```ts
  if (o.time !== undefined && !(action.timeBox?.options ?? []).includes(o.time)) {
    throw new UsageError(`Unknown time box "${o.time}" for ${o.action}. Lengths: ${(action.timeBox?.options ?? []).join(", ") || "(none)"}.`);
  }
  /** The phases the open task's action has: none without phases (task-phases D0). */
  const phasesOf = (id: string | undefined) => (id !== undefined && Object.hasOwn(harness.actions, id) ? (harness.actions[id].phases ?? []) : []);
```

3. The store keeps each action's phase ids, as the app does:

```ts
  const store = new TaskStore(folder, {
    ...(hasModes(harness) ? { modes: Object.keys(harness.modes) } : {}),
    ...(Object.values(harness.actions).some((a) => a.phases)
      ? { phases: Object.fromEntries(Object.entries(harness.actions).flatMap(([id, a]) => (a.phases ? [[id, a.phases.map((p) => p.id)]] : []))) }
      : {}),
  });
```

4. In the `TaskManager` deps, after the modes block:

```ts
    // As the app wires them (packages/shell/src/main/index.ts); the terminal prints the change's line first.
    readPhaseBrief: (id, phase) => {
      const p = phasesOf(id).find((x) => x.id === phase);
      return p?.brief ? fs.readFile(resolveInHarness(harness, p.brief), "utf8") : Promise.reject(new Error("Unknown phase"));
    },
    taskTurn: (n) => view.taskTurn(n, phasesOf(taskAction).find((p) => p.id === n.phase)?.label),
```

5. The start: `await tasks.start(o.action, undefined, scope, o.mode, o.time !== undefined ? { timeBox: o.time } : {});`

6. `promptFor` gains the hint: add a `phases = false` parameter and `const p = phases ? ">phase <id> to change part, " : "";` next to `m`, used the same way (`${m}${p}`); the call passes `phasesOf(current.action).length > 0`.

7. In the loop, after reading `current`, print a proposal once:

```ts
        const proposal = current.phaseProposal;
        if (proposal && proposalKey !== `${proposal.to}\n${proposal.reason}`) {
          proposalKey = `${proposal.to}\n${proposal.reason}`;
          const label = phasesOf(current.action).find((p) => p.id === proposal.to)?.label ?? proposal.to;
          out.write(
            proposal.to === current.phase?.id
              ? `\nThe AI says this part is done: ${proposal.reason}. Type q to finish.\n`
              : `\nThe AI proposes to move to ${label}: ${proposal.reason}. Type >phase ${proposal.to} to go there.\n`,
          );
        }
```

with `let proposalKey: string | undefined;` before the loop.

8. Before the `m <id>` branch:

```ts
        // `>phase <id>`: the person moves the task (task-phases spec §4.2). Only for an action with phases, and only
        // `>phase` and one id: any other line is a follow-up like any other.
        const phaseId = line.slice(7).trim();
        if (phasesOf(current.action).length > 0 && line.startsWith(">phase ") && PHASE_ID.test(phaseId)) {
          const { accepted, done } = tasks.setPhase(phaseId, current.id);
          done.catch(() => undefined);
          const r = await accepted;
          if (!r.ok) out.write(`\nNot moved (${r.reason}). Parts: ${phasesOf(current.action).map((p) => p.id).join(", ")}.\n`);
          else if (r.changed === "same") out.write("\nAlready in that part.\n");
          if (!r.ok || r.changed === "same") view.choices = options;
          await done;
          continue;
        }
```

(A phase change turn is the app's prompt: no `recorder?.reply` — Task 14's recorder writes `setPhase` on it.)

9. `RUN_USAGE` gains `[--time <minutes>]` after `[--mode <id>]`; `runCommand` parses `time: { type: "string" }`, refuses anything that isn't a positive integer with `UsageError("--time takes minutes, such as 30.")`, and passes `...(values.time ? { time: Number(values.time) } : {})`.

A run's time box counts real minutes; `HH_TEST_MINUTE_MS` is the app's hook only. The wrap-up therefore only happens in a long run; the unit tests of Task 9 cover it.

- [ ] **Step 4: The terminal**

In `packages/cli/src/terminal.ts`, import `TaskTurnNotice` from `@humanharness/ui/client` and add to `TerminalView`:

```ts
  /** A turn the app starts on its own (task-phases spec §4.4, §5): its line, before its answer. */
  taskTurn(n: TaskTurnNotice, label?: string): void {
    this.out.write(n.kind === "wrap-up" ? "\nTime is almost up\n" : `\n— ${label ?? n.phase ?? ""} —\n`);
  }
```

(Use the view's existing name for its output stream if it isn't `out`.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/cli/test/run.test.ts packages/cli/test/terminal.test.ts`
Expected: PASS; the modes cases unchanged.

- [ ] **Step 6: Verify everything and commit**

Run: `corepack pnpm typecheck` and `corepack pnpm test`
Expected: all green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/cli/src/run.ts packages/cli/src/terminal.ts packages/cli/test/run.test.ts packages/cli/test/terminal.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(cli): run moves through phases and takes --time

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

## Phase 5 — Docs and the end-to-end check

### Task 16: Docs

**Files:**
- Create: `docs/architecture/phases.md`
- Modify: `docs/architecture/manifest.md`, `docs/architecture/blocks.md`, `docs/architecture/context.md`, `docs/architecture/turn.md`, `docs/architecture/history.md`, `docs/architecture/mock-mode.md`, `docs/architecture/authoring.md`, `docs/architecture/modes.md`, `packages/cli/guide/new-harness.md`

No test: docs only. Each change is plain English, short sections, like `docs/architecture/modes.md`.

- [ ] **Step 1: `docs/architecture/phases.md`**

Write it with these sections and contents:
- **What a phase is**: an ordered part of one task (`actions.<id>.phases`), one session for the whole task; the fields (`id`, `label`, `brief`, `auto`, `close`, `modes`) and the checks (unique ids, one `close` at most and last, `auto` not on the last part).
- **Who moves**: the agent's hidden `set_phase` tool (acted on after its turn: `auto` + next part moves; anything else is a proposal; the close part's own id means "done"); the person (stepper, proposal's "Go", `>phase` in `run`); the app (the first part at start, the close part after the wrap-up).
- **The change turn**: one run turn of the same session; its message is `PHASE_PROMPT` plus the back note, time left, mode section and brief; the chat shows `— <label> —`; usage `phase: "phase-change"`; no turn and no line for a part without a brief.
- **The close part**: entering it is a normal change; Finish (or the agent's "done" with `auto`) runs the core closing turn and ends the task (D5).
- **Modes by part**: suspend, restore, recommend later, `chooseMode` refusal `"phase"` (link to modes.md).
- **The time box**: options/default/wrapUpAt; picked in the "How long?" dialog or `run --time`; the counter (`usedMs`/`runningSince`), pause/resume/+5 min, auto-resume on a message, quit pauses; the wrap-up at `wrapUpAt` and the close part after it; at 100% only `ended`; never cuts a turn; `HH_TEST_MINUTE_MS`.
- **State and records**: the `tasks.json` fields (`phase`, `phases` log, `phaseProposal`, `timeBox`, `suspendedMode`), `usage.jsonl` `taskPhase`, chat `phase`/`timeUp`, the `Phase:` history trailer.
- **D0**: an action without phases or a time box behaves and records exactly as before.
- **Not in v1**: phase-specific blocks (spec §9 Q3); a `{ phase }` option on `choices`.

- [ ] **Step 2: Update the others**

- `manifest.md`: the `phases` and `timeBox` fields with the `tutor` example and the checks; link to phases.md.
- `blocks.md`: `set_phase` in the core block list (hidden, only with phases, reserved name, the `ui` server's error for an unknown id).
- `context.md`: the first message's "Parts of this task" and current part sections; the resume's part; the `{{phase}}`, `{{previousPhase}}`, `{{timeLeft}}` placeholders.
- `turn.md`: the `phase-change` and `wrap-up` turn kinds; input blocks get ids in them; `hh:taskTurn` comes before their events.
- `history.md`: the `Phase:` trailer and the history panel's caption.
- `mock-mode.md`: `setPhase` and `timeUp` on a recorded turn, how `replay` finds them, `run --record` writes them, mock mode's one-second minute.
- `authoring.md`: `check`'s phase brief finding; `run --time` and `>phase`.
- `modes.md`: replace the "phases" known gap with the rules from §7 as built, and link to phases.md.

- [ ] **Step 3: The authoring guide**

In `packages/cli/guide/new-harness.md`, in the part that walks through each action, add two questions after the modes question: "Does this task have parts that always come in the same order (a warm-up, the main block, a close)? If so, list them, say which ones the AI may leave on its own (`auto`), which one closes, and which modes each allows." and "Should the person pick how long it lasts? If so, which lengths, a default, and when to wrap up (0.85 by default)." Then how to write each part's brief file. Update `packages/cli/test/guide.test.ts` only if it pins the guide's text (run it).

- [ ] **Step 4: Verify and commit**

Run: `corepack pnpm test` (the guide test) and read each changed doc once.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add docs/architecture packages/cli/guide/new-harness.md
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "docs: task phases and the time box

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 17: End-to-end: the tutor's session in the built app

**Files:**
- Create: `packages/e2e/tests/phases.spec.ts`
- Modify: `packages/e2e/tests/helpers.ts`

- [ ] **Step 1: `launch` takes extra test env**

In `packages/e2e/tests/helpers.ts`, give `launch` a fourth parameter and pass it through (only `HH_TEST_*` keys, the shell ignores others anyway):

```ts
export async function launch(
  s: Sandbox,
  scripts: { claude: ClaudeScript; codex?: AcpScript },
  app: string = shellDir,
  extraEnv: Record<string, string> = {},
): Promise<{ app: ElectronApplication; page: Page }> {
```

and `env: { ...baseEnv(s), HH_TEST_ENGINES: JSON.stringify(engines), ...extraEnv },`.

- [ ] **Step 2: Write the test**

Create `packages/e2e/tests/phases.spec.ts`, built like `modes.spec.ts` (same `result` and `ui` helpers, same fixture build with `electron-vite build`, `HH_HARNESS_DIR` = the `phases-harness` fixture, `HH_OUT_DIR` = `out/phases`, cleanup in `finally` with `closeAndClean` and removing `outDir`):

```ts
const tutorScript: ClaudeScript = {
  steps: [...claudeTextLines("Listo."), result],
  turns: [
    { match: "save_note", steps: [ui("save_note", { title: "Fractions", summary: ["Halves and quarters"], decisions: [], files: [], open: [] }), result] },
    { match: "Time is almost up:", steps: [...claudeTextLines("One last idea, quickly."), result] },
    { match: 'Next part of this task: "Close"', steps: [...claudeTextLines("Sum it up in three lines."), result] },
    { match: 'Next part of this task: "Main block"', steps: [...claudeTextLines("Let's split a pizza."), ui("set_phase", { to: "close", reason: "We covered quarters." }), result] },
    { match: "# Task: session", steps: [...claudeTextLines("What is a half?"), ui("set_phase", { to: "main", reason: "Recall done." }), result] },
  ],
};

test("a session moves through its parts: auto, a proposal, the time box's wrap-up, Finish", async () => {
  test.setTimeout(300_000);
  // … build the fixture as modes.spec.ts does …
  // A one-second minute: a 15-minute box wraps up at 12.75 s.
  const launched = await launch(s, { claude: tutorScript }, path.join(outDir, "main", "index.js"), { HH_TEST_MINUTE_MS: "1000" });
  const page = launched.page;
  await page.getByRole("button", { name: "Start Tutor" }).click();
  await page.getByRole("button", { name: /Session/ }).first().click();
  // The time box comes first.
  await page.getByRole("dialog", { name: "How long?" }).getByRole("button", { name: "15 min" }).click();
  const steps = page.getByRole("navigation", { name: "Task parts" });
  // The warm-up's auto: the app moved to the main block right after the first answer.
  await expect(page.getByText("— Main block —")).toBeVisible();
  await expect(steps.getByRole("button", { name: "Main block" })).toHaveAttribute("aria-current", "step");
  // No mode in the warm-up; the default mode came back with the main block.
  await expect(page.getByRole("group", { name: "Task mode" })).toContainText("Socratic");
  // The agent's request to skip ahead is a proposal.
  await expect(page.getByText("The AI proposes to move to Close: We covered quarters.")).toBeVisible();
  // The wrap-up, then the app moves to the close part on its own.
  await expect(page.getByText("Time is almost up", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("— Close —")).toBeVisible();
  await expect(page.getByRole("group", { name: "Task mode" })).toHaveCount(0);
  // Finish runs the core closing turn: the note is written and the task is done.
  await page.getByRole("button", { name: "Finish" }).first().click();
  await expect.poll(() => readTasks(s.folder).current).toBeNull();
  expect(fs.existsSync(path.join(s.folder, ".harness", "notes", "session.md"))).toBe(true);
  const usage = readJsonl(usageFile(s.folder));
  expect(usage.map((u) => u.phase)).toEqual(["run", "phase-change", "wrap-up", "phase-change", "close"]);
  expect(usage.map((u) => u.taskPhase)).toEqual(["warmup", "main", "main", "close", "close"]);
});
```

Copy the exact `try`/`finally`, `makeSandbox("phases")`, `readTasks`, and the build lines from `modes.spec.ts`; use the start button's real name ("Start Tutor" follows the harness `name`).

- [ ] **Step 3: Run it**

Run: `corepack pnpm app:build && corepack pnpm --filter @humanharness/e2e exec playwright test tests/phases.spec.ts`
Expected: PASS.

- [ ] **Step 4: D0 on the demo**

Run: `corepack pnpm --filter @humanharness/e2e exec playwright test tests/flow.spec.ts tests/modes.spec.ts tests/mock.spec.ts`
Expected: PASS unchanged (no stepper, no time picker, no new trailer for the demo).

- [ ] **Step 5: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/e2e/tests/phases.spec.ts packages/e2e/tests/helpers.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "test(e2e): a tutor session through its phases and time box

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

## Self-review against the spec

| Spec | Where |
|---|---|
| §3 manifest `phases` (id, label, brief, auto, close, modes) and checks | Task 1 |
| §3 `timeBox` (options, default, wrapUpAt) | Task 1 |
| §4.1 agent's `set_phase`, acted on after the turn; auto vs proposal | Tasks 2, 6, 8 |
| §4.2 the person moves (stepper, proposal, `>phase`) | Tasks 6, 11, 12, 15 |
| §4.3 the app moves (first part, close after wrap-up) | Tasks 6, 9 |
| §4.4 change turn: same session, message, separator, no turn without brief | Tasks 3, 5, 6, 12 |
| D5 close part = core closing | Task 8 |
| §5 time box: pick, count, wrap-up, close part, pause/resume/+5, never cut a turn, quit pauses | Tasks 4, 9, 10, 11, 12 |
| §6 state, usage, chat, history trailer, resume | Tasks 4, 5, 6 |
| §6 stepper and proposal UI | Tasks 11, 12 |
| §6 mock `setPhase`/`timeUp`, record | Task 14 |
| §6 `run` and `check` | Tasks 13, 15 |
| modes spec §7 (suspend/restore/recommend/refuse) | Task 7 |
| §8 four slices | Phases 1–4; docs Task 16; e2e Task 17 |
| §9 Q1 (brief answer shown), Q2 (no `{ phase }` choices option) | Decisions section; nothing built for Q2 |
| §9 Q3 phase-specific blocks | Out of v1 (phases.md says so) |
| D0 everywhere | Each task's verify step; Task 17 Step 4 |

Names used across tasks: `phasesOf`, `phaseOf`, `phaseList`, `phaseText`, `phasePlan`, `enterPhase`, `movePhase`, `phaseAsked`, `phaseNow`, `tellTurn`, `dropProposal`, `allowedModes`, `modesOnEntry`, `arm`, `timeNow`, `wrapUp`, `toClosePhase`, `setTimeBox`, `pauseTimeBox`, `resumeTimeBox`, `extendTimeBox` (TaskManager); `PhaseView`, `PhaseResult`, `TaskTurnNotice`, `TimeBoxView` (client); `setPhase`, `finishTask`, `pauseTask`, `resumeTask`, `extendTimeBox`, `onTaskTurn` (HarnessClient); `hh:setPhase`, `hh:finishTask`, `hh:pauseTask`, `hh:resumeTask`, `hh:extendTimeBox`, `hh:taskTurn` (IPC).
