# Folder, history and backup

## The folder

- The person's folder is visible and theirs. The app prepares it (`prepareFolder` in `packages/workspace/src/folder.ts`), writes the instructions there and keeps its own files under `.harness/`: chats, usage, tasks and notes.
- The folder is chosen once, at first launch. The only way to change it afterwards is to move it from the app ("Move to …", below), which moves the files and the history together. Settings › General says so: don't move or rename it by hand.

## History

- Every change is recorded in an invisible local git history kept outside the folder (`packages/workspace/src/history.ts`, built on isomorphic-git). Its data lives in the app's data folder, one per folder (`historyDir` in `packages/shell/src/main/config.ts`), so cloud sync never touches it. In a harness with profiles each profile has its own (`historyDir(userData, <folder>/<profile>)`) and none tracks the root; deleting a profile puts its history in the system Trash after its folder (`docs/architecture/profiles.md`).
- The runtime (`packages/runtime/src/runtime.ts`, a workspace with one slot, see `turn.md`) commits when it starts ("Start"), before each message ("Before message") and after the turn ("Turn: …", or "Stopped: …" when it didn't finish). If the agent crashes mid-turn, it restores the point before the message ("Undo: …", committed only when the restore changed something; see "Parallel turns" below). A saved note is committed as "Note: …". A person's data write is committed as "Data: <collection>" (see `data.md`). In a document review (`reviews.md`), the person's answer to a question is committed as "Answer: <path> · <question>" and an approval as "Approved: <path>". Each waits until no turn runs and carries the open task's trailer, so undoing the task undoes it. A comment draft and a round's state changes make no commit of their own: they go with the next one.
- The history skips `.harness/` except `.harness/notes/`, `.harness/data/` and `.harness/reviews/` (document reviews, `reviews.md`; a harness that never reviews has no file there, so its commits don't change). With `enginePresets` it also keeps `.harness/engine/` (the scopes' engine config, `hatches.md` H3; `appHistoryKeep` in `packages/workspace/src/history.ts`), so undo covers it; a commit that touches a scope's engine folder tells Scope settings to read it again. Without `enginePresets` the kept paths are as before (D0). It also skips the generated `AGENTS.md` and the engine's own instructions file, and the temp files the app renames into place: a note's, a data file's, a review record's, and the hidden `.<name>.md.<uuid>.tmp` an answer renames over a document, left behind only by a crash.
- Symlinks are recorded as links (git mode 120000, the blob is the target path), never as what they point to. A restore never writes through a link: it removes a link in its way (the link, not its target), recreates a link entry as a link, writes regular files with `O_NOFOLLOW` where the OS has it, and skips (and logs) any entry whose parent folder resolves outside the folder through a linked folder. It checks the parent's real path before and again right after creating it, just before the write. An entry it can't write safely (outside the folder, a folder in its place, a link the OS won't create, such as on Windows without Developer Mode) is skipped and the rest of the restore goes on; `History.restoreReport` returns the skipped paths with the new commit.

### Commits belong to tasks

- Every commit made inside a task carries git trailers under its one-line subject:

  ```
  Turn: plan the week

  Task: <task id>
  Action: <action id>
  ```

  In a harness with scopes the trailers also carry `Scope: <scope id>`. A task whose action has phases adds `Phase: <phase id>`, the part it is in when the commit is made (a change turn's commits carry the new part), on every commit it makes: "Before message", the turn, its notes and the person's data writes (`docs/architecture/phases.md`). `parseCommitMessage` reads it back as the entry's `phase`.

  The task manager passes the task id and action with each turn (`TurnOptions.task`/`action` → `HarnessRuntime.send(…, { trailer })`) and with each note (`TaskDeps.saveHistory(message, trailer)`).
- Untagged: "Start" (it records changes made outside the app) and every restore ("Went back to an earlier point", "Went back to before the task", and "Go back: <path> to <target>" for one file). A restore is not part of the task it undid, so it never changes that task's own row.
- `History.tasks(depth)` groups commits by `Task:` (not by adjacency), newest first. Each group has `start` (its first "Before message" snapshot when its first commit is one, so the person's own edits before the task stay; else the parent of its first commit), `end`, the tree diff between them (`FileChange[]`, tracked files only, from `git.walk` over two trees) and its entries. Untagged commits form the "Outside a task" group, always last, whose changes are the union of its commits' own changes.

### One file

- Each file's timeline (`timeline.md`) comes from a per-file index, `hh-file-index.json`, kept in the history's data folder beside the repository's own files, so it moves and is set aside with the history and never enters the folder or a commit. Each commit advances the copy `History` holds in memory; the file is written a second after the last commit, off the commit path (`History.flush()` writes it at once: the runtime's close, the app's quit, a folder move). `History.onCommit` tells listeners which paths the commit touched (main sends them to the window as `hh:fileCommits`, or null past 200 paths). The index is never a source of truth: a read catches up on it or rebuilds it from the log.
- "Go back to this version" restores one file (`History.restoreFile`) with the same link checks as a restore, and commits `Go back: <path> to <target>` (`v2` for an approval, else `the version of <ISO time>`), untagged. That commit stages only that path, so the person's other edits wait for the next commit.

`History.readBlob(oid, max?)` reads one blob by its id (null when the history doesn't have it, when the id is a commit's or a tree's, or when it is over `max` bytes). "See what changed" uses it to read an approved version: the `Approved:` commit includes the document, so its blob is always there (`reviews.md`).

After a successful turn the runtime reads `History.changes(before, after)`, the tree diff between the turn's "Before message" commit and its "Turn: …" commit, to make the turn's document cards: every `.md` added or changed outside `.harness/` (`docs/architecture/documents.md`).

An answer's `saveTo` write has no commit of its own: it lands in the follow-up turn's "Before message" commit, which carries the task's trailer, so undoing the task undoes it too. A write whose follow-up turn then never starts (a Stop, or the send fails before it begins) stays, and the question reopens (see `blocks.md`).

### The History panel

- Tasks are grouped under their day ("Today", "Yesterday", "Oct 17"; `byDay` in `HistoryPanel.tsx`). One row per task: the action's label (or "A question"), the time and "N files changed", and a "Note saved" tag when it saved one (the note's title on hover). The newest row starts open. The untagged group is the last row, in a section of its own, "Outside a task": that is where "Start" and the restores show.
- An open row lists the changed files (added, changed, deleted) and the task's entries in plain language as a timeline (i18n keys `history.entry.*`; the commit subjects stay in English). An entry with a `Phase:` trailer shows the part's label as a caption next to it; a part the manifest no longer declares shows nothing.
- With `onOpenFile` (the core's chat passes it), each changed file is a link to its timeline: an existing `.md` opens in the reader with its "File history" drawer, any other file (and a deleted `.md`) in the timeline panel (`timeline.md`). Without it, a harness view that renders the panel gets plain paths. A one-file go-back reads "You went back to an earlier version of <path>" (`history.entry.fileBack`).
- "Go back here" restores one entry; it shows when the entry is hovered or focused. "Undo this task", under the entries, restores the group's `start`. Both ask first (main's native dialog, below), record a new commit (so they can be undone too) and are disabled while a turn is live, with a line saying why; the main process refuses them while a task operation runs or turns are held. With parallel tasks both work differently: see "Undo in board mode" below. A Cancel answers `{ ok: false, reason: "cancelled" }`: the panel stays as it was and the button gets focus back.
- Going back resets every tracked file, `.harness/notes` included, so it also undoes tasks that changed something later, whatever their scope. The dialog says how many ("This also undoes 2 later tasks"; `laterTasks` in `packages/ui/src/client.ts`) and lists them with their files (the task being undone first, at most ten names).
- The open task's row says "In progress" (`currentTask`, the id of `TaskView.current`, which is the id in the commits' `Task:` trailer).

### Parallel turns

Spec: `docs/superpowers/specs/2026-10-27-parallel-tasks-and-jobs-design.md` §5. Part 1 builds the history side; part 2 runs several tasks' turns at once in a harness that declares `parallel` (`parallel.md`).

**Turn windows.**
- Each running turn has a `TurnWindow` in the folder's `TurnLedger` (`packages/runtime/src/turn-ledger.ts`).
- A window opens before the turn's first await. Two turns that start together never both think they are alone.
- A window is `alone` when no other window is open as it starts.
- A window becomes `overlapped` once another window is open at any moment of its life.
- `beginTurn` and `endTurn` (`packages/runtime/src/turn-commit.ts`) wrap every turn of a slot.

**The alone path is today's.**
- A window that never overlapped runs exactly the code the runtime ran before.
- It snapshots "Before message" at the start.
- At the end it commits "Turn: …" or "Stopped: …". On `agent-crashed` it restores its "Before message" point.
- With one runtime no window ever overlaps.
- With one runtime a crashed turn usually makes no "Undo: …" commit. Its restore point is its "Before message" snapshot. When nothing else committed during the turn, that snapshot is the last commit. The restored tree then equals it, and there is nothing to commit.

**A turn that starts beside another.**
- It takes no "Before message" snapshot. That commit would put the running turn's in-flight files under the new turn's trailer.
- Its `before` is the queue head (`history.last()`), read before anything else.
- It records `startDirty` instead: each dirty tracked path and its blob id (`History.dirtyState`).
- An overlapped window stays in the ledger until its own commits are done. A turn that starts meanwhile is then not alone either.

**Ownership by edit events.**
- Activity start events carry `edits`: the paths the turn's edit tools named (see `turn.md`).
- `TurnLedger.noteEdits` keeps only paths inside the folder. It accepts the folder as given and its real path. It stores folder-relative paths in NFC form.
- `edits` is only a hint. An engine can change a file without naming it, for example Codex through the shell.
- At the end, `History.changedSince(startDirty)` lists the paths that changed during the turn. A path dirty at the start counts only if its blob id changed.
- `attribute()` (`packages/workspace/src/attribution.ts`) gives each changed path an owner:
  - a path this turn named is owned, even when another turn named it too;
  - a path only another running turn named is left for that turn;
  - every other changed path is shared, including paths no turn named.
- The ending turn's own task never counts among the others.
- Paths compare in NFC form, so a macOS NFD name matches its edit event.

**Commits of an overlapped turn.**
- `History.commitPaths(paths, message, trailer)` commits only the listed paths on top of the queue head. It returns null when nothing changed.
- The owned paths go first, as "Turn: …" or "Stopped: …".
- The shared paths follow in a second commit, "Shared: …" (`SHARED_PREFIX`). It carries the same `Task:` trailer and one `Shared: <task id>` line per other running task, at most 8.
- No shared path means no second commit.
- Other tasks' in-flight changes stay in the working tree, uncommitted.

**Crash restore with overlap.**
- `History.restorePaths(paths, sha, message, trailer)` puts back only the listed paths from `sha`. It uses the same `writeEntry` and link checks as `restore`. It ignores non-canonical paths. It deletes a path absent at `sha` only when the folder has that exact name.
- A crashed overlapped turn restores from "HEAD", resolved inside the restore's own queue entry. A commit another turn made meanwhile is kept.
- It restores only owned paths that no other running window named and that were not dirty at its start.
- Owned paths it keeps are logged ("Crash restore left paths others also hold"). Shared paths are left alone and logged too.
- A crashed turn may therefore leave partial edits on shared or start-dirty paths.

**Conflicts.**
- After its commits, `endTurn` looks at the commits since `before` (at most 200, `History.commitsSince`).
- The turn's paths for the check: the ones it committed (owned and shared), plus the paths it surely wrote. An edit event names its paths at its start; `TurnLedger.noteEditEnd` moves them to the window's `wrote` set only when that edit ends without an error (`workspace.ts`, on the activity's end). A denied or failed edit only named its path, so it never makes a conflict. `wrote` catches a turn whose change another task already committed (the same text), which leaves it nothing to commit.
- A path is a conflict when it is one of those paths and another task's commit changed it in that span.
- Both sides are compared in one spelling (`samePath`, NFC) and deduplicated: edit paths are NFC, git keeps the file's own name (NFD on macOS).
- The check is best effort. A failure is logged ("Conflict check failed") and reports no conflict.
- The slot's `onAttribution` gets `{ owned, shared, with, conflicts }`. It is called only for an overlapped turn. Board mode turns the conflicts into notices in both tasks' chats (`parallel.md`, "Conflict notices and tokens").

**One queue.**
- Every new method goes through `History`'s one `serialize` queue: `commitPaths`, `restorePaths`, `dirtyState`, `changedSince`, `commitsSince`.
- `changedSince`, the commits and `commitsSince` are separate queue entries. Another turn's commit can land between them.
- `commitChanges` and `tasks` are not queued: they only read commits already written. A commit landing meanwhile may or may not be in what `tasks` returns.

**Trailers.**
- A job run's commit carries `Task: <run id>` and adds `Job: <job id>` (`jobs.md`). `parseCommitMessage` reads it into the entry's `job`.
- `withTrailer` drops a `Shared:` line naming the commit's own task, and duplicates.
- Without `job` and `shared`, `withTrailer` writes exactly what it did before.

**A task's own changes.**
- `History.tasks(depth)` without options is unchanged.
- `History.tasks(depth, { ownCommits: true })` builds each task's changes from its own commits only. Changes other tasks committed between them don't count.
- It combines the commits oldest first: added then changed is added, added then deleted is nothing, deleted then added is changed.
- It skips the task's opening "Before message" commit. That commit holds the person's edits, not the task's.
- On a history with no overlap, both modes return the same changes.

**Undo by paths.**
- `packages/workspace/src/undo-paths.ts` has helpers for "Undo this task" with parallel tasks. Board mode uses them (below).
- A task's owned paths come from its commits without `Shared:` lines. Its shared paths come from its `Shared:` commits.
- Both skip the task's start commit and non-canonical paths.
- `laterChangesSharing(commits, task, paths)` finds later changes to the same paths. It is pure.
- It decides by commit order, not by dates.
- It counts every commit that is not the task's own and touches one of the paths.
- It returns `{ tasks, outside }`. `outside` lists the commits outside any task.
- `laterChangesOf(history, task, paths)` runs it over `commitsSince(task.start)`.
- It doesn't see uncommitted changes in the working tree; the board-mode undo checks those itself.

### Undo in board mode

Spec §5.3, Decision 12. In a harness that declares `parallel` (`parallel.md`):

- **"Undo this task"** (`hh:restoreTask`) restores by paths: `restoreTaskByPaths` (`packages/shell/src/main/restore-paths.ts`) puts the task's own paths (`ownedPathsOf`; a path both owned and shared counts as owned) back to the group's `start` with `History.restorePaths(paths, start, RESTORE_TASK, { task })`, in one commit. Its shared paths go too only with `includeShared`; the window never sends it today, so they stay and come back as `sharedLeft`.
- It is refused, with the file named, when:
  - another running turn touched one of the paths (`runningPaths`: the ledger's edits and `changedSince`; P2): "Another task is changing <path>. Undo this one once that task waits.";
  - a path has changes the history hasn't saved: "<path> has changes not saved in the history yet, so this task can't be undone now.";
  - a later task, or a commit outside any task, changed one of the paths after this task began (`laterChangesSharing` over the same commits the window check read): "A later task also changed <path>, so this task can't be undone by itself." or "<path> was changed after this task, so it can't be undone by itself.";
  - the task began further back than 500 commits, or, with a full window, its start is in the older half of it or isn't its own "Before message": "This task is too far back to undo by its files.";
  - the task has no start or no paths of its own: "This task has no files of its own to take back.".
- **What the window sees.** A refusal is an answer, not an error: `hh:restoreTask` returns `{ refused: { reason, path?, by? } }` (`UndoRefusal`, built by `undoRefusalOf` in `tasks-ipc.ts`; `by` is `"task"` or `"outside"` for a later change). The other tasks' ids never reach the window. The History panel shows the reason in the person's language (`parallel.undo*`) as an alert and stays open.
- **The confirm is for the task alone.** "Undo this task" asks with main's native dialog, as every go-back does ("Every go-back asks in main" below), before the by-paths restore runs: `confirmGoBack(sender, { kind: "task", task, later: [] })` in the `hh:restoreTask` handler (`packages/shell/src/main/index.ts`). It lists no later tasks: undo by paths never takes back another task's changes, and main refuses instead when a later change touched the task's files. The History panel draws no confirmation of its own; a Cancel answers `{ ok: false, reason: "cancelled" }`. A quitting app or held turns refuse it before the dialog. Plain mode keeps `goBackHandlers`' task go-back, which counts the later tasks it undoes.
- The checks run in that order: later changes first, then running turns and unsaved changes right before the restore. A turn already running can still write between those reads and the restore; new turns wait while an undo runs (`checkTurn` polls the `RestoreGuard`).
- Only the task's own lane being busy blocks it (`RestoreGuard.run`'s `busy` option); other tasks go on.
- **"Go back here"** (`hh:restore`) stays a whole-folder restore, so it undoes every task's later changes. It is refused while any open task runs an operation (`busy` is the board's `isBusy`, every lane): "A turn is running".
- Edits a task swept into its "Before message" mid-task count as its own and are undone with it (PR decision).
- **The app's own commits hold their own files only.** A task's note (`Note: …`), the person's data write (`Data: <collection>`), Sidekick's learning and decision note, and a material change (`Material: …`) commit just the files that change wrote (`saveAppChange`, `packages/shell/src/main/app-change.ts`; `History.commitPaths`). Plain mode keeps the whole-folder `save` (D0). So another running task's work never gets this task's trailer, and undoing this task never takes it back (`packages/shell/test/app-change.test.ts`).

**D0.**
- A harness without `parallel` or `jobs` writes the same commits as before: subjects, trailers, trees and order.
- `packages/runtime/test/runtime-d0.test.ts` pins them through `createRuntime`: ok, stopped, crashed and no-change turns, with every tree as path → content.
- `packages/e2e/tests/history.spec.ts` pins the demo flow's commit messages end to end.

### Linked folders

In a harness with `linkedFolders` (`docs/architecture/hatches.md`), a scope may link folders outside the work folder:

- A **tracked** one (write, no git) has a history of its own in the app's data folder (`<userData>/linked-history/<hash>`). Each turn of that scope commits both histories with the same trailer, and the crash undo restores both.
- An **untracked** one (it has git, or it is read only) is never committed or restored: its own git is its history. The History panel says "Undo doesn't cover this folder: it has its own git." for each such write folder (or that it has no git and isn't tracked, once it lost its git). A task that changed only tracked linked folders gets a row of its own, so it can be undone.
- **"Undo this task"** covers the work folder and every tracked linked folder. Board and single mode check every history before restoring any; a refusal between the checks and the restores is reported as a partial undo ("Undone in … Not undone in …"). A task that changed only a linked folder can be undone too.
- **"Go back here"** stays main-folder only.
- An unlinked folder's history is kept 30 days, so a relink continues it.

### Every go-back asks in main

Every go-back is confirmed by a native dialog that main shows before it does anything (Marco, 2026-10-28): the whole folder (`hh:restore`), one task (`hh:restoreTask`) and one file from its timeline (`hh:fileRestore`, `timeline.md`). Harness UI code runs in the same window and JS realm as the core, so a confirmation drawn in the window could be answered by harness code; a native dialog can't. The window draws no confirmation of its own, so the person is asked once.

- `goBackHandlers` in `packages/shell/src/main/go-back.ts` checks the input first, then asks, then goes back through the existing `RestoreGuard`. These ask nothing: a bad commit id or task id, a commit id no listed point has, a task with nothing before it, a refused file go-back, and a folder or task go-back while it is blocked (`blocked()`: quitting, a turn or task operation, or a hold).
- One dialog at a time: a go-back asked while one is open answers cancelled. After a yes, main reads the later tasks again; if more appeared while the dialog was open, the answer is cancelled, so nothing the person didn't see is undone.
- File names, task names and author labels pass through `dialogSafe`: controls, line and paragraph separators and bidi marks become U+FFFD, and a path past 160 characters or a label past 80 loses its middle to "…".
- `dialog.showMessageBox` is a sheet on the window that asked (modal on macOS), app-modal when there is no window. The message says what goes back: "Go back the whole folder to this point?", "Undo “<task>”?" (the task's name as its row shows it) or "Go back to this version?". The detail says what else changes: "Files changed after it will be undone." or "Everything it changed in your files will be undone.", with the later tasks it undoes too, or for a file "The rest of the folder doesn't change." The buttons are "Go back" and "Cancel"; Cancel is the default and the cancel id (Esc).
- The words are the core's (`goBack.*`, `history.confirm*`, `history.laterTasks`, `timeline.confirm*` in `en.json`), in the person's language: main builds an i18n instance from the saved language and the cached translation (`TranslationService.strings`), else English.
- A Cancel, or any failure to ask, is a no: `hh:restore` and `hh:restoreTask` answer `{ ok: false, reason: "cancelled" }` (`GoBackResult`), `hh:fileRestore` the same (the client's `"cancelled"`). The UI treats it as no change, without a message. Done, they answer `{ ok: true }`. A folder or task go-back that fails still rejects, as before; the file go-back answers every failure as data.
- Tests: `goBackHandlers` takes the confirmation as a dependency (`packages/shell/test/go-back.test.ts`: confirmed goes back, cancelled doesn't, for each channel). The e2e tests answer the dialog with `answerGoBack` (`packages/e2e/tests/helpers.ts`), which replaces `dialog.showMessageBox` in main, as `context.spec.ts` does for the open dialog, and records what it was asked (`goBackAsks`).

## Backup

### What the app looks at

`syncStatus(folder)` and `syncLocations()` in `packages/workspace/src/backup.ts` decide from paths and folder names only:

- `synced`: the folder (resolved through links) is inside iCloud Drive (`~/Library/Mobile Documents/com~apple~CloudDocs`, or an app's own folder next to it under `~/Library/Mobile Documents`), inside a folder under `~/Library/CloudStorage` whose name starts with `GoogleDrive-`, `OneDrive` or `Dropbox`, or inside an old Dropbox root in the home folder (`~/Dropbox`, `~/Dropbox (Personal)`, `~/Dropbox (Acme Inc)`).
- `git-remote`: the nearest git repository at or above the folder has a `[remote "…"]` section with a `url` in its `.git/config`. The walk stops below the home folder (a dotfiles repository there doesn't back the folder up). A `.git` that is a link or a worktree's file is skipped and the walk goes on up; a config that isn't a plain file under 256 KB counts as no remote.
- `local`: anything else, `~/Documents` included.
- `syncLocations()` lists the synced places on this computer: the folders under `~/Library/CloudStorage` (for Google Drive, its `My Drive`/`Mi unidad` folder; a drive without one isn't offered), the old Dropbox roots in the home folder and iCloud Drive. Two names for one place (`~/Dropbox` linking into CloudStorage) are listed once. A place carries the account from its folder name (`GoogleDrive-ana@example.com`, `Dropbox (Personal)`) when the name says, so two accounts of one provider can be told apart on screen.

Compliance: the module reads only paths (realpath, stat/lstat), the names in the home folder and in `~/Library/CloudStorage`, whether the synced roots exist, and the folder's own (or a parent's) `.git/config`. It never reads account, token or credential files, a provider's own settings, or anything under `~/.claude`, `~/.codex` or `~/.gemini`, and never runs a provider's CLI. Account names come only from folder names; the app shows them in the window to tell places apart, and `backup.ts` logs nothing.

### What the person sees

- First launch (`FolderStep`) offers the synced places first, as radios with the account under each, then "Only on this computer".
- Afterwards a quiet notice on Home and in Settings › General shows while the folder is `local` (`BackupNotice.tsx`): "Move to <provider>" (with the account when there is one) for each synced place, "Choose another place…" or "I already have a copy". The folder keeps its name inside the place chosen. "I already have a copy" sets `backupDismissed` in the app config (a failed save shows a message; afterwards focus goes to a line saying the notice won't come back); Settings › General shows the status row ("Kept in Google Drive", "Kept in a git repository that's copied online", "Only on this computer", "You keep your own copy") and "Remind me again" brings the notice back.
- Settings › General always offers "Move folder…" next to the folder (when the notice isn't showing): the same synced places, without any the folder is already inside, and "Choose another place…". So the caption "the app moves it for you" holds whatever the backup status.
- The move is the app's (`useFolderMove`, held by `HarnessApp`), not one view's: closing Settings or changing tab keeps it on screen, and Home shows how it went. One status line is always there (`role="status"`, its text changes): while the folder moves it says not to close the app, and the buttons stay, disabled, with `aria-busy`. A failed move shows its own card in Spanish or English (`backup.moveError.*`: busy (a turn, a restore, a setup step or another move is running), exists, inside, unsuitable, no-space, no-permission, mismatch, failed; `pick` when the place picker can't open) and gives focus back to the button that started it, or to the card when that button is gone; the folder stays where it was. The window gets the app state after every attempt, failed or not.
- After a move the status line says where the folder is now (`backup.moved`), also when the new place is still only on this computer; when the old folder was kept (below), where it is (`backup.leftBehind`); and when the history stayed behind, that it follows at the next start (`backup.historyLeftBehind`).

### Moving the folder

`guardedMove`, `precheckMove`, `moveFolder` and `recoverMove` (`packages/shell/src/main/move-folder.ts`, IPC `hh:moveFolder`). The person's work is at stake, so every step keeps `from` intact until the end, removes only what the move itself made, and never deletes anything for good.

0. Refuse while a turn, a task operation, a restore, an engine update or sign-out (a setup step that blocks turns) or another move runs (`busy`), or while the app quits.
1. Refuse the new place before anything else, touching nothing (`precheckMove`, run before the checkpoint turn so a bad place costs no turn, and again by `moveFolder`): a place inside the folder or containing it, compared as written and with links resolved (`inside`); a folder that is itself a link, or an earlier move not settled yet (its journal is still there) (`failed`); a place that exists (`exists`); one `checkFolder` refuses (`unsuitable`); less free space than the folder plus 5 % (at least 100 MB) (`no-space`). The folder's listing (relative paths, sizes, modification times, link targets) is taken here.
2. If a task is open, waiting, and has no note of its own yet nor a checkpoint note written after its last turn (tasks.json keeps `checkpointTurns`, the turn count when that note was written; an older file without it counts as stale), run the plan 3c checkpoint turn (`TaskManager.checkpointBeforeMove`: one quiet turn asking for `save_note`), because the move ends its engine session. A failed checkpoint is logged and the move goes on; the task then resumes from the notes there are. Quitting cancels the checkpoint, and the move then stops before copying (`busy`); so does an engine update or sign-out that started meanwhile. Then turns and restores are held off until the move ends (so is an engine change, and an update or sign-out of the engine in use), the last turn's writes are flushed and the runtime is closed. A harness backend stops with it (SIGTERM, SIGKILL after 3 s) and starts again once the move ends, moved, refused or failed, with an `init` for whichever folder is the app's then (`hatches.md`, H2); a harness without `backend` runs no extra step.
3. Write the journal (`move-journal.json` in the app's data folder: `from`, `to`, the temporary place and the stage), then make the temporary place `<to>.hh-moving-<random>` next to the new place with a non-recursive `mkdir` (so it is never someone else's) and copy the folder inside it under its own name (`fs.cp`, keeping timestamps and links, never overwriting). Parent folders the move creates are removed again if it fails. A name clash inside the copy (two names the disk takes as one, by case or NFC/NFD) is `failed`, not `exists`.
4. Verify the copy there: same relative files and sizes (links by target); same bytes for the files the history tracks, hashed as streams (a tracked path the listing names differently, NFC against NFD, is hashed directly). A file that can't be read is `failed`, a difference is `mismatch`. Then the notes' `files:` entries that name the old place become relative (`relativizeNoteFiles`; a note it can't read or rewrite is skipped and logged).
5. Rename the copy to `to`, unless something took that place meanwhile (`exists`).
6. Save the new folder in the config (`ConfigStore.replaceFolder`).
7. Move the history data folder to the new folder's. A history the new place already has is set aside first as `<history>.replaced-<ms>` (whether or not the folder has a history yet); set-aside histories older than 30 days are pruned.
8. List the old folder again and compare with the listing from step 1. If anything was added, removed or changed (size or time), the old folder is kept and the window says where it is. Otherwise it goes to the system Trash (Electron's `shell.trashItem`); if that fails it is kept too, never deleted instead.

A failure before step 6 removes the temporary place (or the copy, once renamed) and the parents the move made, and the old folder stays the app's folder. A failure at step 7 (also a journal that can't record that the history moved) puts the config back on the old folder, then the history (when it had moved already) and a set-aside history, then removes the copy. If the config can't be put back, the copy stays the folder (the person never loses it): the move answers success with the old folder kept and, when the history hadn't moved yet, `historyLeftBehind`; it keeps its journal so the next start moves the history after it.

In a harness with profiles (`MoveDeps.subfolders`: the registry's ids, archived ones included) steps 4 and 7 run once per profile: each profile's tracked files are compared (prefixed with its id), its notes made relative and its history moved, and a failure at step 7 puts every moved history back. The journal then lists them from the start, `histories: [{ rel, setAside? }]`, and `recoverMove` settles each one; without profiles the journal is as before, and an older journal is read as before. In a profiles app with no active profile a move is refused as not set up: switch to a profile first.

The journal is written before each step (`copying`, `renaming`, `copied`, `config-saved`, `history-moved`) and cleared at the end. At startup, before anything opens the folder or its history, `recoverMove` settles a move a quit or crash cut short. The config decides: when it names the new place, the history is moved after it (a stale one set aside); when it names the old place, the copy the move made is removed (only once it was renamed into place, and only while the old folder is still there) and the history and a set-aside one are put back. The temporary place the journal names is removed; another `*.hh-moving-*` is left alone. The old folder is never removed at startup: it is logged as kept. A journal that can't be read is dropped without touching anything; while the config names no folder (or can't be read), nothing is touched and the journal stays for a later start.

While a move runs, quitting waits for it. From the moment turns are held (after the checkpoint turn, whose "Note: …" commit still goes in) until it ends, `hh:historyTasks` answers an empty list and no history is opened or created (`currentHistory` answers none); the tracked files are read only from a history that already exists.

One app runs per data folder: the app takes Electron's single-instance lock once its data folder is set (the lock is tied to it), so a second start can't run `recoverMove` under a move the first one is making. A second start quits and the running window comes to the front. Apps with other data folders (other harnesses, the end-to-end tests' sandboxes) run side by side.

### The open task after a move

Engine sessions are tied to the folder's path, and the runtime closes before every move attempt, so right after it closes (before the copy, so a crash during the move can't leave the old session id behind) `TaskManager.resumeFromNotes` drops the open task's session and context and marks it `resume`, whether or not the move then goes through. The task stays open. Its next message (typed or a follow-up option) starts a new session whose first message says what the task is (`resumeMessage` in `task-prompts.ts`). For an action's task: the action's brief, filled as when the task started (language, notes index), then a neutral resume line ("The earlier conversation of this topic is not available; continue from the notes…", which never claims the folder moved), then the person's message. A brief that can't be read is logged and left out: the task resumes from the notes alone. For a free question: the resume line, the notes index, "The question that opened this topic" and the person's message. `tasks.json` keeps the question whole up to 20,000 characters (`QUESTION_MAX`); a longer one is cut, marked `questionCut`, and the resumed message says it was cut. That turn runs like a first turn, so a model the plan lacks falls back to the next profile down. A failed resumed turn keeps `resume`, and the next message carries the brief again; a cancelled one ends the task as unfinished. Closing a task still marked `resume` skips the closing turn (its session holds no conversation); after one resumed turn went through, closing works as usual.

What under `.harness/` names a place: only notes' `files:` (agent-provided paths, stored relative since plan 3d and rewritten by the move). `tasks.json` holds the engine session id (dropped by the move); chats keep their text as it was said.

## Known gaps

- A history the root kept before the harness added profiles is not moved by a folder move: no history tracks the root any more.
- No size limit for the history yet: a folder with large media inflates it in the app's data folder. The same holds for a tracked linked folder's history (`hatches.md`).
- Board-mode undo can't undo a task's shared paths from the window: the confirm offering them (open question 5) isn't built.
- Parallel turns: a turn's `edits` set has no size limit. A turn that reverts another running turn's change to HEAD drops it from that turn's `changedSince` with no conflict. `saveNow` still throws if a file vanishes between `statusMatrix` and `git.add`.
- A restore's skipped paths (`RestoreResult.skipped`) are only logged: the History panel doesn't tell the person yet.
- A restore checks a file's parent folder right before writing, but another process could still swap that folder for a link between the check and the write. Where the OS has no `O_NOFOLLOW` (Windows), the last path part isn't protected that way either; only the `lstat` check before the write is.
- A move whose history couldn't follow and whose config couldn't be put back leaves its journal, and the app runs on the copy until the next start. History writes meanwhile go to a new history at the new place, which `recoverMove` then sets aside (`<history>.replaced-<ms>`, kept 30 days) to move the old one in: those commits are only in the set-aside history.
- iCloud "Desktop & Documents" keeps `~/Documents` at the same path. The plan 3d spike found no credential-free signal for it (only `com.apple.macl` on `~/Documents`, on a Mac with the feature off), so `~/Documents` counts as `local` and the person can dismiss the notice. Re-check on a Mac with the feature on.
- Listing `~/Library/CloudStorage` and copying into a File Provider folder (Google Drive, OneDrive, Dropbox) may make macOS ask the person for permission the first time. Not verified yet: check on a real Mac with each provider before release.
