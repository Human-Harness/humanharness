# Task phases and time box — design

Status: approved by Marco on 2026-10-25, with every open question resolved by its proposal (where a question had none, the simplest option, noted in place). Not in the roadmap yet. Comes from the student-vs-core gap analysis (`docs/discovery/2026-10-25-student-vs-core.md`, gaps #9 and #10) and from the dev harness's "phase stepper" candidate. It refers to `2026-10-25-task-modes-design.md` for modes.

## 1. Why

A task today is one session with one brief:

- `TaskManager` (`packages/shell/src/main/task-manager.ts`) moves it through `running`, `waiting`, `closing` and `checkpoint`.
- The manifest's `path` orders **actions**, never steps inside one.

Harnesses need structure inside a task:

- **Student.** A session has three parts:
  1. warm-up: recall over due items;
  2. main block, with the chosen method;
  3. close: the learner's summary and flashcards.

  It can also be time-boxed to 15, 30 or 45 minutes, and wraps up on its own when the time ends.
- **Dev.** A ticket moves through stages (investigate, plan, implement, review), with a visible "waiting for you" state.

Without a core feature, each harness would prompt the agent with "now do part 2" and hope it keeps track, and nothing on screen would know where the task is. Splitting the parts into separate actions would cost a new session each time, and the context of the previous part would be lost.

## 2. Decisions (proposed)

- **D1. An action may declare `phases`.** They are ordered steps inside the same task and the same engine session. An action without phases behaves as today.
- **D2. A phase change is a quiet turn** in the same session, carrying that phase's brief. It works like the checkpoint (`CHECKPOINT_PROMPT`, `quiet: true`). The prompt cache and the conversation stay; only the instructions for the new step are added.
- **D3. Three ways to advance:**
  - the agent, through a core hidden block;
  - the person, through the UI;
  - the app, when the time box ends.

  The app always carries out the change. The agent only asks for it.
- **D4. The phase is stored with the task** (`tasks.json`) and shown through the client, so any harness can draw a stepper.
- **D5. The last phase can be the closing turn.** A phase marked `close: true` runs the core closing (`CLOSE_PROMPT` → `save_note`) at its end, so "close" in the harness and in the core is one moment, not two.
- **D6. Time box.**
  - It is optional and chosen at task start, from options the manifest offers.
  - The timer runs in the main process.
  - It never cuts a turn: at the end it waits for the turn to finish, then runs a quiet wrap-up turn and moves to the close phase.
- **D7. Phases and tiers.** The tier stays fixed per task (spec 3c, D2): a phase never changes the model. A harness that needs another model for a step uses another action.

## 3. Manifest

```ts
actions: {
  session: {
    label: …, prompt: "prompts/session.md", cost: "medium", tier: "standard",
    phases: [
      { id: "warmup", label: { es: "Calentamiento", en: "Warm-up" }, brief: "prompts/phase-warmup.md", auto: true },
      { id: "main",   label: { es: "Bloque principal", en: "Main block" }, brief: "prompts/phase-main.md", modes: ["socratic", "feynman", "worked"] },
      { id: "close",  label: { es: "Cierre", en: "Close" }, brief: "prompts/phase-close.md", close: true },
    ],
    timeBox: { options: [15, 30, 45], default: null, wrapUpAt: 0.85 },
  },
}
```

- **`id`.** The same pattern as action ids, unique within the action.
- **`brief`** (optional). A prompt file, resolved with `resolveInHarness` like `prompt`. A phase with no brief changes only the shown state; no quiet turn runs.
- **`auto: true`.** The agent may advance from this phase on its own (§4). Without it, an agent request waits for the person's OK.
- **`modes`** (optional). The modes allowed in this phase (task modes spec). Absent means all the action's modes.
- **`close: true`.** Only allowed on the last phase (D5).
- **`timeBox.wrapUpAt`.** The share of the time at which the wrap-up starts. 0.85 means the last 15% is left for the close phase. Absent: the wrap-up starts when the time is up.
- **`check`** (plan 4a) checks:
  - unique ids;
  - `close` only on the last phase;
  - the brief files exist;
  - the modes exist in the action.

## 4. Advancing

### 4.1 The agent: core block `set_phase`

```ts
set_phase: hidden, schema { to: string /* phase id */, reason: string }
```

- **Reserved name.** It is a core block, so it lands in `CORE_BLOCKS` (`packages/harness-sdk/src/core-blocks.ts`) next to `choices` and `save_note`. It is offered only to tasks whose action has phases.
- **When the app acts on it.** The call is recorded during the turn. The app acts only after the turn ends (`done`), never in the middle.
- **Who decides:**
  - **Current phase has `auto: true` and `to` is the next phase:** the app advances right away.
  - **Otherwise** (a skip, going back, or no `auto`): the task goes to `waiting` with a proposal ("La IA propone pasar a Cierre: <reason>"). The person confirms or ignores it. This is dev's "waiting for you" state.
- **Unknown id:** the tool answers with an error and the list of valid ids. The bridge already returns tool errors to the agent.

### 4.2 The person: `client.setPhase(taskId, phaseId)`

- **When it is allowed:** only while the task is `waiting`. While a turn runs, the stepper is disabled, as `choices` is.
- **Which phases:** any phase, forward or back. Going back runs the brief of the phase it goes to, with a line "La persona volvió a esta parte".

### 4.3 The app: time box (§5)

### 4.4 What a phase change does

1. Inside `op()`, so it is serialized with the other task operations.
2. If `needsCheckpoint(c)`, run the checkpoint first, as `askNow` does.
3. Store `phase: { id, startedAt }` and append the change to `phases[]`, the log of changes with who made each one.
4. If the new phase has a brief, run a quiet turn with it: `phase: "phase-change"` in the turn metadata, `quiet: true`.
   - The brief is filled with `fillPrompt` (`task-prompts.ts`), plus `{phase}`, `{previousPhase}` and the time left.
   - The quiet turn's answer is shown, because it usually opens the new phase. "Quiet" only means the trigger is not shown as the person's message. The chat shows a separator instead: "— Bloque principal —".
5. If the new phase is `close: true`, run its brief turn. Then, when the agent signals the end (`set_phase` to the same phase, or the person pressing "Terminar"), run the core closing turn, `closeCurrent()`.

## 5. Time box

- **Choosing it.** At task start (`start(action, display, { timeBox })`), the harness UI offers the manifest's options. `null` means no limit. The choice is stored with the task.
- **Timer.** It runs in the main process.
  - It counts only while the task is open and the app is running.
  - Pause (`client.pauseTask`) stops it. Quitting the app pauses it.
  - Pause is offered only while `waiting`.
- **The person sees** the time left through the client (`timeBox: { minutes, usedMs, paused }`).
- **When `wrapUpAt` is reached:**
  - **If a turn is running,** the app waits for it to finish. A turn is never cut.
  - **Then it runs a quiet wrap-up turn,** `WRAP_UP_PROMPT`: "Time is almost up; finish the current point briefly", in the same session.
  - **Then it moves to the `close: true` phase,** if there is one. Otherwise it offers the person to close the task.
  - **The wrap-up runs once.** The person can add time (+5 min, `client.extendTimeBox`), and the wrap-up does not run again.
- **At 100% of the time:** if the close phase has not started yet, the app starts it after the current turn. The close phase itself is never cut off by time.

## 6. State, client, usage

- **`CurrentTask`** (`task-store.ts`) gets:
  - `phase?: { id, startedAt }`;
  - `phases?: { id, at, by: "agent" | "person" | "app" }[]`;
  - `phaseProposal?: { to, reason }`;
  - `timeBox?: { minutes, usedMs, runningSince?, wrappedUp?: boolean }`.
- **`CurrentTaskView`** shows the phase, the action's phase list with labels, the proposal and the time box. The core ships `PhaseStepper` in `@humanharness/ui`: a row of pills for done, current and pending phases, a "waiting for you" proposal card, and the time left. A harness may restyle it or replace it.
- **Resuming.** A resumed session (`resumeFromNotes`, an engine switch) tells the agent the current phase, through `RESUME_PROMPT`.
- **`usage.jsonl`.** Every turn line gets `taskPhase: <phase id>`. The existing `phase` field already means `run` / `close` / `checkpoint` (`usage-log.ts`), so the names must not clash. The new turn kinds `phase-change` and `wrap-up` are added to that existing field.
- **History.** Commits get one more trailer, `Phase: <id>`. The History panel can show which part of a session changed what.
- **Mock mode (3e).**
  - A recording's turn may carry `setPhase` or `timeUp: true`, to replay a phase change.
  - `run` prints the phase changes and accepts `>phase <id>` at the prompt.

## 7. What this closes from the gap analysis

| Gap | How |
|---|---|
| #9 Session frame: warm-up, main, close | `phases` with briefs; `close: true` on the last |
| #10 Time box with automatic wrap-up | `timeBox` + the wrap-up turn + a move to the close phase |
| Dev phase stepper with "waiting for you" | `phases` without `auto` + `phaseProposal` + `PhaseStepper` |

The live evidence panel of #9 comes from the data store (scopes-and-data spec), not from this spec.

## 8. Delivery slices

1. **Phases.**
   - Manifest, `check` and state.
   - `set_phase` with `auto` and proposals.
   - `client.setPhase`, the quiet brief turn and the chat separator.
   - `RESUME_PROMPT`, `usage.jsonl` and history trailers.
2. **Close phase = core closing** (D5), and `PhaseStepper`.
3. **Time box.** Timer, pause, extend, the wrap-up turn, and its view.
4. **Mock and terminal.**

## 9. Open questions

1. **The brief turn's answer.** Should it always be shown? For a warm-up the answer is the first question, which is useful. For a "silent" phase it may be noise. Option: `quiet: "hidden"` on the phase.
2. **Phases in the guided `path`.** Should a phase be reachable directly from a `choices` option (`{ phase: "close" }`)? It would be useful for the student's "Ir al cierre", which today could be `client.setPhase` from the harness UI.
3. **Time box per phase.** Example: warm-up at most 3 minutes. Not in v1. The `wrapUpAt` of the whole task covers the student case.
4. ~~Interaction with task modes.~~ Settled by the task modes spec. When a phase does not allow the current mode, the mode is suspended. It comes back when a later phase allows it.
