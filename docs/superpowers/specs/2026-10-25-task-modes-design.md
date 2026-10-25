# Task modes — design

Status: approved by Marco on 2026-10-25, with every open question resolved by its proposal (where a question had none, the simplest option, noted in place). Not in the roadmap yet. Comes from the student-vs-core gap analysis (`docs/discovery/2026-10-25-student-vs-core.md`, gap #8). Related specs:
- `2026-10-25-harness-settings-design.md` (mode settings);
- `2026-10-25-task-phases-design.md` (phases that allow or forbid modes);
- `2026-10-25-input-blocks-design.md`;
- `2026-10-25-scopes-and-data-design.md`.

## 1. Why

An action decides **what** a task is about. Some harnesses also need to choose **how** the AI works inside the task, and to change that midway:
- **Student:** the 7 study methods (Socratic, Feynman, retrieval practice, worked examples, elaboration, interleaving, problem-based). The AI recommends one; the learner chooses and may switch at any moment.
- **Dev:** modes such as "explore", "plan", "implement" and "review" inside one ticket.

Today a task has one brief: the action's `prompt`, filled once by `fillPrompt` in `packages/shell/src/main/task-prompts.ts`. Nothing in the core changes the strategy inside a running task. Each harness would invent its own convention ("send this text when the button is pressed"), with no record of which mode ran, and no answer to the tier problem below.

## 2. Decisions (proposed)

- **D1. Modes are declared in the manifest:** id, label, description, a brief, an optional minimum tier, optional settings and recommendation hints. Actions say which modes they accept.
- **D2. The AI recommends, the person decides.** The agent recommends through a core block, `recommend_mode`, which gives the reasons and is drawn with choices. Picking a mode is always the person's act. The agent never switches on its own.
- **D3. A switch is a quiet turn in the same session.** It carries the new mode's brief, filled, plus its settings. There is no new session, and the conversation and its cache are kept.
- **D4. The tier never changes mid-task** (the 3c rule: a model switch rewrites the whole history into the new model's cache).
  - A mode may declare `minTier`.
  - Switching to a mode whose `minTier` is above the task's tier says so, and offers two ways on:
    - continue at the current tier;
    - close this task and start a new one in that mode at the required tier. The new task starts from the notes, so the decisions so far are kept: the switch runs a checkpoint first.
- **D5. The current mode is task state.**
  - It is stored in `tasks.json` and shown in the UI.
  - Every `usage.jsonl` line carries it.
  - The closing note lists the modes used.
- **D6. Phases can restrict modes** (`2026-10-25-task-phases-design.md`). A phase may list the modes allowed in it, for example modes only in the main block and none in the warm-up or the close.

## 3. Manifest

```ts
modes: {
  socratic: {
    label: { es: "Socrático", en: "Socratic" },
    description: { es: "Primero un ejercicio, después preguntas…", en: … },
    brief: "modes/socratic.md",            // resolved with resolveInHarness, like an action's prompt
    minTier: "standard",                    // optional
    recommend: { es: "Bueno cuando el tema tiene una idea clave que se puede descubrir…", en: … },
    settings: {                             // optional; fields as in the harness-settings spec
      steps: { schema: z.array(z.enum(["pre", "questions", "concept", "check"])), default: [...], control: "select", … ,
               agent: { es: "Usá estos pasos: {{value:label}}.", en: … } },
    },
  },
  feynman: { … },
  worked:  { … },
},
actions: {
  session: { …, modes: ["socratic", "feynman", "worked", "retrieval", "elaboration", "interleaved", "problem"],
             defaultMode: "recommend" },   // a mode id | "recommend" | "ask"
}
```

- **`brief`** is a file in the harness folder. It is filled with the same variables as an action's prompt (`{{language}}`). It holds no `{{notesIndex}}`: the session already has it.
- **`recommend`** is the hint the agent reads to recommend, gathered into the recommendation instructions (§4). It is not shown to the person.
- **`defaultMode`** decides how the task starts:
  - a mode id: start in that mode;
  - `"recommend"`: the first turn ends with `recommend_mode`;
  - `"ask"`: the UI asks before the first turn, with no model call.
- An action with no `modes` behaves as today.
- **`check`** (plan 4a):
  - mode ids follow the action id pattern;
  - every brief exists;
  - `minTier` is a tier;
  - every action's `modes` names declared modes;
  - a `defaultMode` mode id is in the action's list;
  - mode settings pass the harness-settings checks.

## 4. Recommending

- **The block.** A core block `recommend_mode`, visible, is added only when the manifest declares `modes`. Its arguments:
  `{ recommended: modeId, reasons: string[] (≤3), alternatives: { mode: modeId, why: string }[] (≤2) }`
- **How it is drawn.** Like `choices`: the recommended mode first, marked "Recomendado", with its reasons, then the alternatives, then "Ver todos los métodos", which opens the list of the action's modes with their descriptions.
  - A pick goes back through `client.chooseMode(modeId)`.
  - With `defaultMode: "recommend"`, the task's first message asks the agent to recommend before any teaching, using the `recommend` hints of the action's modes. This list is added to that first message only, so it never weighs on later turns.
- **The person can switch at any time** from the mode control in the task header. That is the harness's UI, using `client.chooseMode`. The agent may suggest a switch with `recommend_mode` mid-task. Nothing switches until the person picks.

## 5. Switching

`client.chooseMode(modeId)` in the main process (`TaskManager`):

1. **Refused** when no task is current, when the mode is not in the action's list, or when the current phase does not allow it. The UI disables those modes, so a refusal means a stale UI.
2. **While a turn is running,** the switch waits until the turn ends. It does not cancel the turn.
3. **If the mode's `minTier` is above the task's resolved tier** (`profile.tier` from `resolveProfile` in `packages/shell/src/main/models.ts`; a `custom` profile counts as its model's nearest tier), the UI asks:
   - **"Seguir con el modelo actual"** switches anyway, and records `belowMinTier: true`.
   - **"Empezar una tarea nueva con <mode>"** runs a checkpoint (`CHECKPOINT_PROMPT`), closes the task, and starts a new task of the same action and scope in that mode, at the required tier. The person's tier choice in Settings › Modelos still wins: the required tier is the floor, and it is never lowered.
4. **Otherwise,** the app sends a quiet turn, `MODE_PROMPT`, filled. It is shown in the chat as a system line, "Cambiaste a Feynman", not as the person's message:
   ```
   From now on work in the mode "{{label}}". Keep everything decided so far in this conversation.
   {{brief}}
   {{modeSettings}}
   Then continue with the person in this mode.
   ```
5. **State.** `tasks.json` `current.mode` is set, and `current.modes` gets the mode appended (the list of modes used). The UI gets a `task` event.

## 6. Task state, usage and notes

- **`CurrentTask`** (`packages/shell/src/main/task-store.ts`) gets three fields:
  - `mode?: string`;
  - `modes?: string[]`;
  - `belowMinTier?: boolean`.

  `cleanCurrent` validates them against the manifest, and drops a mode that no longer exists.
- **`UsageMeta`** (`usage-log.ts`) gets `mode?: string`, so Settings › Uso can compare the cost of each mode.
- **The closing note.** `CLOSE_PROMPT` gets one sentence when the task used modes: "List the modes used ({{modes}}) and what each was good for." `save_note` keeps them in a `modes` field of the note.
- **Resumed sessions.** `resumeMessage` puts the current mode's brief after the action's brief, so a lost session comes back in the same mode.

## 7. Phases

`2026-10-25-task-phases-design.md` defines phases inside a task. A phase may declare:
- `modes: "any" | "none" | modeId[]`. Student example: warm-up `none` (the core's recall prompt), main block `any`, close `none`.
- On entering a phase:
  - if the current mode is not allowed, the mode is suspended (`mode` cleared, the last one kept);
  - when a later phase allows it again, it is restored with a `MODE_PROMPT` turn.

## 8. What this closes from the gap analysis

| Gap | How |
|---|---|
| #8 Seven methods, recommended, switchable mid-session | Modes, `recommend_mode`, `chooseMode` |
| #8 Per-method settings | Mode settings (harness-settings spec §6) |
| #9 (part) Methods only in the main block | Phase `modes` restriction |
| Dev modes inside a ticket | The same mechanism |

## 9. Delivery slices

1. **Modes and switching.** The manifest field and its checks, `defaultMode` (mode id / ask), `chooseMode` with `MODE_PROMPT`, task state, the usage field, and the closing note.
2. **Recommending.** The `recommend_mode` block and component, `defaultMode: "recommend"`, and the mid-task suggestion.
3. **Tier floor.** `minTier`, the two-way prompt, and checkpoint + new task.
4. **Phases.** Restrictions, suspend and restore (lands with task phases).

## 10. Open questions

1. **Should a switch carry a short "what we did so far" line?** It would help the new mode start well. It costs a model-written summary unless it is taken from the last checkpoint note. Proposed: use the checkpoint note when there is one, otherwise nothing.
2. **The `minTier` default.** When a mode declares none, it fits any tier. Should the student's Socratic mode really require `standard`? Decide in the student harness, not in the core.
3. **Mode-level `edit` permissions.** For example, dev "review" as read-only. Permissions are fixed per engine process today, so this would need a new session. Proposed: not now; a harness that needs it uses separate actions.
