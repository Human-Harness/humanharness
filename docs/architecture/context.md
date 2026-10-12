# Context and memory

Long-term memory belongs to the harness; short-term memory belongs to the engine.

## One session per task

- A task is one topic or unit of work: a manifest action, or a free question.
- The app drives the flow (`packages/shell/src/main/task-manager.ts`): idle → running → waiting → closing → idle. A message while waiting follows up in the same session. Picking "next" or another topic closes the current task.
- Closing sends one quiet last turn in the same session (`CLOSE_PROMPT` in `task-prompts.ts`) asking the agent to call `save_note`. The app validates the note and writes `.harness/notes/<action>.md`, or `.harness/notes/q-<title>.md` for a free question (`q-<title>-2.md`, `-3`… when that name is taken) (`packages/workspace/src/notes.ts`). Then the session is ended: Claude starts the next one with a new `--session-id`, Codex gets `session/close`.
- Cancel, a failed first turn, an engine switch or quitting end the task without a note and mark it unfinished.
- The state lives in `.harness/tasks.json` (`packages/shell/src/main/task-store.ts`).

## What a new session gets

- The stable instructions: `AGENTS.md` with its managed section. It doesn't change between sessions, so the engine can reuse its cached prefix.
- The first message: the task's brief plus the notes index (`buildNotesIndex` in `packages/workspace/src/notes-index.ts`): what was covered and the decisions so far, newest first, about 1,500 tokens at most. Older notes keep only their title and path; the agent opens a note with its read tool when it needs the details.

## Models and context caps

- Each task runs at a level: `light`, `standard` or `deep`. The manifest recommends one per action (`tier`) and for free questions (`questions.tier`); the person can change each task's level, or make it custom, in Settings › Modelos (`config.json` → `models`).
- When a task starts, `resolveProfile` (`packages/shell/src/main/models.ts`) turns its level into a model, an effort and a context cap for the engine in use, from the person's table or the core's (`DEFAULT_TIERS` in `packages/engines/src/models.ts`). The profile is stored with the task in `tasks.json` and never changes until the task ends, so the engine's prompt cache stays valid.
- Claude gets `--model`, `--effort` and `--autocompact` on every call of the task; Codex gets the same through `CODEX_CONFIG` when its adapter starts (a new process when the next task needs another profile).
- A model the plan doesn't include ends the first turn with `model-unavailable`; the task runs again one level down (deep → standard → light → the engine's default model) and the screen says so. On Codex a model missing from its saved list is skipped before the turn.

## Checkpoints

- After each turn the task keeps the context in use (`context` events: Claude's last call, Codex's `usage_update`).
- At 80% of the cap (`CHECKPOINT_AT` in `task-manager.ts`), before the next follow-up, a quiet turn asks the agent for `save_note`: the decisions so far go to the task's note before the engine compacts on its own. The row says "Guardando lo importante…".
- After a compaction (Codex reports it; for Claude the context falls by more than half) the next checkpoint can run again.

## Measuring

`.harness/usage.jsonl` records each turn's tokens with its `task`, `phase` (`run`, `close`, `checkpoint`), level, model, effort and cap, and the model the engine said it ran (`reportedModel`). Compactions are lines of `kind: "compaction"`.

## Engine switch

The chat is archived, the open task ends unfinished, the notes stay: the next task on the new engine gets the same index (`packages/shell/src/main/engine-switch.ts`).
