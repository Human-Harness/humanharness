# Folder, history and backup

## The folder

- The person's folder is visible and theirs. The app prepares it (`prepareFolder` in `packages/workspace/src/folder.ts`), writes the instructions there and keeps its own files under `.harness/`: chats, usage, tasks and notes.
- The folder is chosen once, at first launch. The only way to change it afterwards is to move it from the app ("Move to …", below), which moves the files and the history together. Settings › General says so: don't move or rename it by hand.

## History

- Every change is recorded in an invisible local git history kept outside the folder (`packages/workspace/src/history.ts`, built on isomorphic-git). Its data lives in the app's data folder, one per folder (`historyDir` in `packages/shell/src/main/config.ts`), so cloud sync never touches it.
- The runtime (`packages/runtime/src/runtime.ts`) commits when it starts ("Start"), before each message ("Before message") and after the turn ("Turn: …", or "Stopped: …" when it didn't finish). If the agent crashes mid-turn, it restores the point before the message ("Undo: …"). A saved note is committed as "Note: …". A person's data write is committed as "Data: <collection>" (see `data.md`).
- The history skips `.harness/` except `.harness/notes/` and `.harness/data/`, and skips the generated `AGENTS.md` and the engine's own instructions file.
- Symlinks are recorded as links (git mode 120000, the blob is the target path), never as what they point to. A restore never writes through a link: it removes a link in its way (the link, not its target), recreates a link entry as a link, writes regular files with `O_NOFOLLOW` where the OS has it, and skips (and logs) any entry whose parent folder resolves outside the folder through a linked folder. It checks the parent's real path before and again right after creating it, just before the write. An entry it can't write safely (outside the folder, a folder in its place, a link the OS won't create, such as on Windows without Developer Mode) is skipped and the rest of the restore goes on; `History.restoreReport` returns the skipped paths with the new commit.

### Commits belong to tasks

- Every commit made inside a task carries git trailers under its one-line subject:

  ```
  Turn: plan the week

  Task: <task id>
  Action: <action id>
  ```

  In a harness with scopes the trailers also carry `Scope: <scope id>`.

  The task manager passes the task id and action with each turn (`TurnOptions.task`/`action` → `HarnessRuntime.send(…, { trailer })`) and with each note (`TaskDeps.saveHistory(message, trailer)`).
- Untagged: "Start" (it records changes made outside the app) and every restore ("Go back to …" commits). A restore is not part of the task it undid, so it never changes that task's own row.
- `History.tasks(depth)` groups commits by `Task:` (not by adjacency), newest first. Each group has `start` (its first "Before message" snapshot when its first commit is one, so the person's own edits before the task stay; else the parent of its first commit), `end`, the tree diff between them (`FileChange[]`, tracked files only, from `git.walk` over two trees) and its entries. Untagged commits form the "Other changes" group, always last, whose changes are the union of its commits' own changes.

An answer's `saveTo` write has no commit of its own: it lands in the follow-up turn's "Before message" commit, which carries the task's trailer, so undoing the task undoes it too. A write whose follow-up turn then never starts (a Stop, or the send fails before it begins) stays, and the question reopens (see `blocks.md`).

### The History panel

- One row per task: the action's label (or "A question"), the title of the note it saved, the date and "N files changed". The newest row starts open. The untagged group is the last row, "Other changes": that is where "Start" and the restores show.
- An open row lists the changed files (added, changed, deleted) and the task's entries in plain language (i18n keys `history.entry.*`; the commit subjects stay in English).
- "Go back to before this task" restores the group's `start`; "Go back to this point" restores one entry. Both ask first, record a new commit (so they can be undone too) and are disabled while a turn is live; the main process refuses them while a task operation runs or turns are held.
- Going back resets every tracked file, so it also undoes tasks that changed something later. The confirmation says how many ("This also undoes 2 later tasks"; `laterTasks` in `HistoryPanel.tsx`).

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
2. If a task is open, waiting, and has no note of its own yet nor a checkpoint note written after its last turn (tasks.json keeps `checkpointTurns`, the turn count when that note was written; an older file without it counts as stale), run the plan 3c checkpoint turn (`TaskManager.checkpointBeforeMove`: one quiet turn asking for `save_note`), because the move ends its engine session. A failed checkpoint is logged and the move goes on; the task then resumes from the notes there are. Quitting cancels the checkpoint, and the move then stops before copying (`busy`); so does an engine update or sign-out that started meanwhile. Then turns and restores are held off until the move ends (so is an engine change, and an update or sign-out of the engine in use), the last turn's writes are flushed and the runtime is closed.
3. Write the journal (`move-journal.json` in the app's data folder: `from`, `to`, the temporary place and the stage), then make the temporary place `<to>.hh-moving-<random>` next to the new place with a non-recursive `mkdir` (so it is never someone else's) and copy the folder inside it under its own name (`fs.cp`, keeping timestamps and links, never overwriting). Parent folders the move creates are removed again if it fails. A name clash inside the copy (two names the disk takes as one, by case or NFC/NFD) is `failed`, not `exists`.
4. Verify the copy there: same relative files and sizes (links by target); same bytes for the files the history tracks, hashed as streams (a tracked path the listing names differently, NFC against NFD, is hashed directly). A file that can't be read is `failed`, a difference is `mismatch`. Then the notes' `files:` entries that name the old place become relative (`relativizeNoteFiles`; a note it can't read or rewrite is skipped and logged).
5. Rename the copy to `to`, unless something took that place meanwhile (`exists`).
6. Save the new folder in the config (`ConfigStore.replaceFolder`).
7. Move the history data folder to the new folder's. A history the new place already has is set aside first as `<history>.replaced-<ms>` (whether or not the folder has a history yet); set-aside histories older than 30 days are pruned.
8. List the old folder again and compare with the listing from step 1. If anything was added, removed or changed (size or time), the old folder is kept and the window says where it is. Otherwise it goes to the system Trash (Electron's `shell.trashItem`); if that fails it is kept too, never deleted instead.

A failure before step 6 removes the temporary place (or the copy, once renamed) and the parents the move made, and the old folder stays the app's folder. A failure at step 7 (also a journal that can't record that the history moved) puts the config back on the old folder, then the history (when it had moved already) and a set-aside history, then removes the copy. If the config can't be put back, the copy stays the folder (the person never loses it): the move answers success with the old folder kept and, when the history hadn't moved yet, `historyLeftBehind`; it keeps its journal so the next start moves the history after it.

The journal is written before each step (`copying`, `renaming`, `copied`, `config-saved`, `history-moved`) and cleared at the end. At startup, before anything opens the folder or its history, `recoverMove` settles a move a quit or crash cut short. The config decides: when it names the new place, the history is moved after it (a stale one set aside); when it names the old place, the copy the move made is removed (only once it was renamed into place, and only while the old folder is still there) and the history and a set-aside one are put back. The temporary place the journal names is removed; another `*.hh-moving-*` is left alone. The old folder is never removed at startup: it is logged as kept. A journal that can't be read is dropped without touching anything; while the config names no folder (or can't be read), nothing is touched and the journal stays for a later start.

While a move runs, quitting waits for it. From the moment turns are held (after the checkpoint turn, whose "Note: …" commit still goes in) until it ends, `hh:historyTasks` answers an empty list and no history is opened or created (`currentHistory` answers none); the tracked files are read only from a history that already exists.

One app runs per data folder: the app takes Electron's single-instance lock once its data folder is set (the lock is tied to it), so a second start can't run `recoverMove` under a move the first one is making. A second start quits and the running window comes to the front. Apps with other data folders (other harnesses, the end-to-end tests' sandboxes) run side by side.

### The open task after a move

Engine sessions are tied to the folder's path, and the runtime closes before every move attempt, so right after it closes (before the copy, so a crash during the move can't leave the old session id behind) `TaskManager.resumeFromNotes` drops the open task's session and context and marks it `resume`, whether or not the move then goes through. The task stays open. Its next message (typed or a follow-up option) starts a new session whose first message says what the task is (`resumeMessage` in `task-prompts.ts`). For an action's task: the action's brief, filled as when the task started (language, notes index), then a neutral resume line ("The earlier conversation of this topic is not available; continue from the notes…", which never claims the folder moved), then the person's message. A brief that can't be read is logged and left out: the task resumes from the notes alone. For a free question: the resume line, the notes index, "The question that opened this topic" and the person's message. `tasks.json` keeps the question whole up to 20,000 characters (`QUESTION_MAX`); a longer one is cut, marked `questionCut`, and the resumed message says it was cut. That turn runs like a first turn, so a model the plan lacks falls back to the next profile down. A failed resumed turn keeps `resume`, and the next message carries the brief again; a cancelled one ends the task as unfinished. Closing a task still marked `resume` skips the closing turn (its session holds no conversation); after one resumed turn went through, closing works as usual.

What under `.harness/` names a place: only notes' `files:` (agent-provided paths, stored relative since plan 3d and rewritten by the move). `tasks.json` holds the engine session id (dropped by the move); chats keep their text as it was said.

## Known gaps

- No size limit for the history yet: a folder with large media inflates it in the app's data folder.
- A restore's skipped paths (`RestoreResult.skipped`) are only logged: the History panel doesn't tell the person yet.
- A restore checks a file's parent folder right before writing, but another process could still swap that folder for a link between the check and the write. Where the OS has no `O_NOFOLLOW` (Windows), the last path part isn't protected that way either; only the `lstat` check before the write is.
- A move whose history couldn't follow and whose config couldn't be put back leaves its journal, and the app runs on the copy until the next start. History writes meanwhile go to a new history at the new place, which `recoverMove` then sets aside (`<history>.replaced-<ms>`, kept 30 days) to move the old one in: those commits are only in the set-aside history.
- iCloud "Desktop & Documents" keeps `~/Documents` at the same path. The plan 3d spike found no credential-free signal for it (only `com.apple.macl` on `~/Documents`, on a Mac with the feature off), so `~/Documents` counts as `local` and the person can dismiss the notice. Re-check on a Mac with the feature on.
- Listing `~/Library/CloudStorage` and copying into a File Provider folder (Google Drive, OneDrive, Dropbox) may make macOS ask the person for permission the first time. Not verified yet: check on a real Mac with each provider before release.
