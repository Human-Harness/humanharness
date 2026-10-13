# Folder, history and backup

## The folder

- The person's folder is visible and theirs. The app prepares it (`prepareFolder` in `packages/workspace/src/folder.ts`), writes the instructions there and keeps its own files under `.harness/`: chats, usage, tasks and notes.
- The folder is chosen once, at first launch. The only way to change it afterwards is to move it from the app ("Move to …", below), which moves the files and the history together. Settings › General says so: don't move or rename it by hand.

## History

- Every change is recorded in an invisible local git history kept outside the folder (`packages/workspace/src/history.ts`, built on isomorphic-git). Its data lives in the app's data folder, one per folder (`historyDir` in `packages/shell/src/main/config.ts`), so cloud sync never touches it.
- The runtime (`packages/runtime/src/runtime.ts`) commits when it starts ("Start"), before each message ("Before message") and after the turn ("Turn: …", or "Stopped: …" when it didn't finish). If the agent crashes mid-turn, it restores the point before the message ("Undo: …"). A saved note is committed as "Note: …".
- The history skips `.harness/` except `.harness/notes/`, and skips the generated `AGENTS.md` and the engine's own instructions file.

### Commits belong to tasks

- Every commit made inside a task carries git trailers under its one-line subject:

  ```
  Turn: plan the week

  Task: <task id>
  Action: <action id>
  ```

  The task manager passes the task id and action with each turn (`TurnOptions.task`/`action` → `HarnessRuntime.send(…, { trailer })`) and with each note (`TaskDeps.saveHistory(message, trailer)`).
- Untagged: "Start" (it records changes made outside the app) and every restore ("Go back to …" commits). A restore is not part of the task it undid, so it never changes that task's own row.
- `History.tasks(depth)` groups commits by `Task:` (not by adjacency), newest first. Each group has `start` (the parent of its first commit), `end`, the tree diff between them (`FileChange[]`, tracked files only, from `git.walk` over two trees) and its entries. Untagged commits form the "Earlier" group, always last, whose changes are the union of its commits' own changes.

### The History panel

- One row per task: the action's label (or "A question"), the title of the note it saved, the date and "N files changed". The newest row starts open. The untagged group is the last row, "Other changes": that is where "Start" and the restores show.
- An open row lists the changed files (added, changed, deleted) and the task's entries in plain language (i18n keys `history.entry.*`; the commit subjects stay in English).
- "Go back to before this task" restores the group's `start`; "Go back to this point" restores one entry. Both ask first, record a new commit (so they can be undone too) and are disabled while a turn is live; the main process refuses them while a task operation runs or turns are held.
- Going back resets every tracked file, so it also undoes tasks that changed something later. The confirmation says how many ("This also undoes 2 later tasks"; `laterTasks` in `HistoryPanel.tsx`).

## Backup

### What the app looks at

`syncStatus(folder)` and `syncLocations()` in `packages/workspace/src/backup.ts` decide from paths and folder names only:

- `synced`: the folder (resolved through links) is inside iCloud Drive (`~/Library/Mobile Documents/com~apple~CloudDocs`, or an app's own folder next to it under `~/Library/Mobile Documents`), inside a folder under `~/Library/CloudStorage` whose name starts with `GoogleDrive-`, `OneDrive` or `Dropbox`, or inside an old Dropbox root in the home folder (`~/Dropbox`, `~/Dropbox (Personal)`, `~/Dropbox (Acme Inc)`).
- `git-remote`: the nearest git repository at or above the folder has a `[remote "…"]` section with a `url` in its `.git/config`. The walk stops below the home folder (a dotfiles repository there doesn't back the folder up); a `.git` that is a link or a worktree's file, or a config that isn't a plain file under 256 KB, counts as no remote.
- `local`: anything else, `~/Documents` included.
- `syncLocations()` lists the synced places on this computer: the folders under `~/Library/CloudStorage` (for Google Drive, its `My Drive`/`Mi unidad` folder; a drive without one isn't offered), the old Dropbox roots in the home folder and iCloud Drive. Two names for one place (`~/Dropbox` linking into CloudStorage) are listed once. A place carries the account from its folder name (`GoogleDrive-ana@example.com`, `Dropbox (Personal)`) when the name says, so two accounts of one provider can be told apart on screen.

Compliance: the module reads only paths (realpath, stat/lstat), the names in the home folder and in `~/Library/CloudStorage`, whether the synced roots exist, and the folder's own (or a parent's) `.git/config`. It never reads account, token or credential files, a provider's own settings, or anything under `~/.claude`, `~/.codex` or `~/.gemini`, and never runs a provider's CLI. Account names come only from folder names; the app shows them in the window to tell places apart, and `backup.ts` logs nothing.

### What the person sees

- First launch (`FolderStep`) offers the synced places first, as radios with the account under each, then "Only on this computer".
- Afterwards a quiet notice on Home and in Settings › General shows while the folder is `local` (`BackupNotice.tsx`): "Move to <provider>" (with the account when there is one) for each synced place, "Choose another place…" or "I already have a copy". The folder keeps its name inside the place chosen. "I already have a copy" sets `backupDismissed` in the app config; Settings › General shows the status row ("Kept in Google Drive", "Kept in a git repository with a remote", "Only on this computer", "You keep your own copy") and "Remind me again" brings the notice back.
- While the folder moves the notice says not to close the app. A failed move shows its own card in Spanish or English (`backup.moveError.*`: busy, exists, inside, unsuitable, no-space, no-permission, mismatch, failed) and keeps the buttons; the folder stays where it was.

### Moving the folder

`guardedMove` and `moveFolder` (`packages/shell/src/main/move-folder.ts`, IPC `hh:moveFolder`):

0. Refuse while a turn, a task operation or a restore runs (`busy`). If a task is open, waiting, and has no note of its own yet, run the plan 3c checkpoint turn first (`TaskManager.checkpointBeforeMove`: one quiet turn asking for `save_note`), because the move ends its engine session. A failed or cancelled checkpoint is logged and the move goes on; the task then resumes from the notes there are. Then turns and restores are held off until the move ends, the last turn's writes are flushed and the runtime is closed.
1. Refuse a place inside the folder (or containing it), one that exists, one `checkFolder` refuses, or one without enough free space.
2. Copy (`fs.cp`, recursive, keeping timestamps and links).
3. Verify: same relative files and sizes (links by target); same bytes for the files the history tracks. Then the notes' `files:` entries that name the old place become relative (`relativizeNoteFiles`; a note it can't read or rewrite is skipped and logged rather than undoing the move).
4. Save the new folder in the config (`ConfigStore.replaceFolder`).
5. Rename the history data folder to the new folder's (a stale one is set aside).
6. Remove the old folder.

A failure before step 6 undoes what was done and the old folder stays the app's folder; a failure at step 6 leaves the move done and the app says where the old folder is.

### The open task after a move

Engine sessions are tied to the folder's path, and the runtime closes before every move attempt, so after any attempt (also a failed one) `TaskManager.resumeFromNotes` drops the open task's session and context and marks it `resume`. The task stays open. Its next message (typed or a follow-up option) starts a new session whose first message tells it what the task is: the action's brief, filled as when the task started (language, notes index), or for a free question "The question that opened this topic"; then a neutral line ("The earlier conversation of this topic is not available; continue from the notes…", which never claims the folder moved) and the person's message (`resumeMessage` in `task-prompts.ts`). That turn runs like a first turn, so a model the plan lacks falls back to the next profile down. A failed resumed turn keeps `resume`, and the next message carries the brief again; a cancelled one ends the task as unfinished. Closing a task still marked `resume` skips the closing turn (its session holds no conversation); after one resumed turn went through, closing works as usual.

What under `.harness/` names a place: only notes' `files:` (agent-provided paths, stored relative since plan 3d and rewritten by the move). `tasks.json` holds the engine session id (dropped by the move); chats keep their text as it was said.

## Known gaps

- No size limit for the history yet: a folder with large media inflates it in the app's data folder.
- iCloud "Desktop & Documents" keeps `~/Documents` at the same path. The plan 3d spike found no credential-free signal for it (only `com.apple.macl` on `~/Documents`, on a Mac with the feature off), so `~/Documents` counts as `local` and the person can dismiss the notice. Re-check on a Mac with the feature on.
- Listing `~/Library/CloudStorage` and copying into a File Provider folder (Google Drive, OneDrive, Dropbox) may make macOS ask the person for permission the first time. Not verified yet: check on a real Mac with each provider before release.
