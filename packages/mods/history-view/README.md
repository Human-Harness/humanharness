# History view

The History page of the task view: days with one foldable row per task, the files each changed, its entries, and the
two ways back ("Go back here" and "Undo this task").

History view is a core mod: it ships with the app and is on by default.

## For agents

- `mod.json`: id `history-view`, a `ui` part and no `main` yet.
- `src/ui.tsx`: registers the task page `history` with `ctx.taskPage` (rail entry, title, page).
- `src/HistoryPage.tsx` draws the page; the entry labels and day grouping come from `@humanharness/ui`.
- The page still calls the core's `restore` and `restoreTask` client methods.

## The History panel

The core keeps the history itself, the restore service and the confirm (`docs/architecture/history.md`). This mod draws
the page and calls the service through its own main. With the mod off there is no History entry and no go-back
control: the crash restore and the per-turn snapshots still run, in the core.

- Tasks are grouped under their day ("Today", "Yesterday", "Oct 17"; `byDay` in `HistoryPanel.tsx`). One row per task: the action's label (or "A question"), the time and "N files changed", and a "Note saved" tag when it saved one (the note's title on hover). The newest row starts open. The untagged group is the last row, in a section of its own, "Outside a task": that is where "Start" and the restores show.
- An open row lists the changed files (added, changed, deleted) and the task's entries in plain language as a timeline (i18n keys `history.entry.*`; the commit subjects stay in English). An entry with a `Phase:` trailer shows the part's label as a caption next to it; a part the manifest no longer declares shows nothing.
- With `onOpenFile` (the core's chat passes it), each changed file is a link to its timeline: an existing `.md` opens in the reader with its "File history" drawer, any other file (and a deleted `.md`) in the timeline panel (`timeline.md`). Without it, a harness view that renders the panel gets plain paths. A one-file go-back reads "You went back to an earlier version of <path>" (`history.entry.fileBack`).
- "Go back here" restores one entry; it shows when the entry is hovered or focused. "Undo this task", under the entries, restores the group's `start`. Both ask first (main's native dialog, below), record a new commit (so they can be undone too) and are disabled while a turn is live, with a line saying why; the main process refuses them while a task operation runs or turns are held. With parallel tasks both work differently: see "Undo in board mode" below. A Cancel answers `{ ok: false, reason: "cancelled" }`: the panel stays as it was and the button gets focus back.
- Going back resets every tracked file, `.harness/notes` included, so it also undoes tasks that changed something later, whatever their scope. The dialog says how many ("This also undoes 2 later tasks"; `laterTasks` in `packages/protocol/src/shared.ts`) and lists them with their files (the task being undone first, at most ten names).
- The open task's row says "In progress" (`currentTask`, the id of `TaskView.current`, which is the id in the commits' `Task:` trailer).

## The window side of the go-backs

- `restore` and `restoreTask` are the mod main's own names. The page calls them with `ctx.call` (`client.mods.call`), and
  the mod's main answers through `ctx.app.history` (core mods only; `docs/architecture/mods.md`). The old `hh:restore`
  and `hh:restoreTask` app channels are gone.
- **Undo in board mode, as the page sees it.** `hh:restoreTask`'s answer, now the service's, is `{ refused: { reason,
  path?, by? } }` (`UndoRefusal`, built by `undoRefusalOf` in `tasks-ipc.ts`; `by` is `"task"` or `"outside"` for a later
  change). A refusal is an answer, not an error. The other tasks' ids never reach the window. The page shows the reason in
  the person's language (`parallel.undo*`) as an alert and stays open. The page draws no confirmation of its own.
- **Cancel.** A Cancel answers `{ ok: false, reason: "cancelled" }`; the page treats it as no change and gives the button
  its focus back. Done answers `{ ok: true }`. A folder or task go-back that fails still rejects.
- Why the window draws no confirmation: harness UI code runs in the same realm as the core, so only a native dialog
  main shows can't be answered by it (`history.md`, "Every go-back asks in main").
- Tests: `test/history-page.test.tsx` (the page) and `test/main.test.ts` (the mod's main). The e2e specs answer the
  native dialog with `answerGoBack` (`packages/e2e/tests/helpers.ts`) and read what it was asked with `goBackAsks`.
