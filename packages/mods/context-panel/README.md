# Context panel

What a task's first message carries beyond the notes, and what the person can change about it: the files they pin
(whole, up to a token budget, or by title) and the notes they leave out of the notes index. The context meter and the
chip stay in the core, as do the per-task record and the "Add now" turn.

The context panel is a core mod: it ships with the app and is on by default. It has a main side and a `ui` part: the
panel is the block `context-panel/panel`, which the task view draws in the reader's slot. With the mod off the task
view has no "Open context" and no panel.

## For agents

- `mod.json`: id `context-panel`, a `main` and a `ui`.
- `src/ui.tsx` registers the `panel` block (`src/ContextPanel.tsx`, the panel itself); `ChatView` gives it `taskId`, `usage`,
  `notes`, `onOpen`, `onClose` as block props.
- `src/main.ts` registers the `on.firstMessage` hook (the pinned section, its items and the excluded notes), the seven
  `hh:context*` app channels and the `hh:context` push, all under their existing names. It reads the task's record, the
  "Add now" turn and the record's changes through `ctx.app.tasks`, and the folder, the scopes, the budget, the history
  and the file dialog through `ctx.app.context`.
- `src/service.ts` is `ContextService` (the panel's data and the writes: pin, unpin, exclude, include, add, pick).
  `src/pins.ts` checks pin paths and builds the pinned section (`pinnedContext`, which `humanharness run` also uses).
  `src/store.ts` reads and writes `.harness/context/<scope>.json` and lays out the pins within the budget.
  `src/ipc.ts` maps the channels to the service.
- Config is the harness's `context` key (`pinnedTokens`) until the manifest key moves under `mods.context-panel`.
- Design: `docs/superpowers/specs/2026-10-27-context-panel-design.md`; `docs/architecture/context.md`.
