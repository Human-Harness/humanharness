# History view

The History page of the task view: days with one foldable row per task, the files each changed, its entries, and the
two ways back ("Go back here" and "Undo this task").

History view is a core mod: it ships with the app and is on by default.

## For agents

- `mod.json`: id `history-view`, a `ui` part and no `main` yet.
- `src/ui.tsx`: registers the task page `history` with `ctx.taskPage` (rail entry, title, page).
- `src/HistoryPage.tsx` draws the page; the entry labels and day grouping come from `@humanharness/ui`.
- The page still calls the core's `restore` and `restoreTask` client methods.
