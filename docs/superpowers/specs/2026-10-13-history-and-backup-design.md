# Plan 3d — History and backup

Date: 2026-10-13. Status: approved design.

## Why

A harness can edit the person's folder, and the person is not technical. Two things can lose their work:

1. **The AI breaks or deletes files.** The local history from plan 1 already records every turn (`docs/architecture/history.md`), but its panel is technical: loose entries ("Before message", "Turn: …"), no grouping by task, no list of changed files.
2. **The computer or disk is lost.** Nothing protects against it today: the history lives in the app's data folder, on the same disk.

Human Harness never handles accounts or credentials, so the core does not integrate cloud services or databases. It leans on what the person already has: a synced folder (Google Drive, iCloud Drive, OneDrive, Dropbox) or a git repository with a remote.

This plan takes "history with undo" from plan 3b. Plan 3b keeps only the Usage tab (plan tiers and estimates).

## 1. History by task

**Recording.** Each history commit carries the task it belongs to as a trailer:

```
Turn: plan the week

Task: <task id>
Action: <action id>
```

The task manager passes the task id and action to the runtime with each turn; "Start", "Before message", "Turn", "Stopped", "Undo" and "Note" commits all carry it when they happen inside a task. A restore commit carries the task it restored to. Commits without a trailer (older history, or outside any task) form one group, "Earlier".

**Reading.** `History.tasks(depth)` in `packages/workspace/src/history.ts` returns groups, newest first:

```ts
interface HistoryTask {
  taskId: string | null;      // null: the "Earlier" group
  actionId: string | null;
  start: string;              // sha of the commit before the task's first turn
  end: string;                // sha of the task's last commit
  date: Date;                 // date of `end`
  changes: FileChange[];      // tree diff between `start` and `end`
  entries: HistoryEntry[];    // the task's commits, newest first
}
interface FileChange { path: string; kind: "added" | "modified" | "deleted" }
```

The changed files come from walking the two trees with isomorphic-git (`git.walk` with two `TREE`s). Only tracked files count (the same filter as `save`).

**Panel.** `HistoryPanel` shows one row per task: the action's label (from the manifest) and, when the task saved a note, the note's title; the date; "N files changed". Rows expand to show:

- the changed files, each with an added, modified or deleted mark;
- the task's entries, each with "Go back to this point".

"Go back to before this task" restores `start`. As today, a restore is recorded as a new commit (so it can be undone), and both buttons are disabled while a turn is live.

**Plain language.** Entry messages are shown through i18n keys, not raw commit subjects: "Started", "Before your message", "The AI finished", "Stopped", "You went back to …", "Note saved: …". The commit subjects stay in English for the raw git data.

## 2. Backup status and moving the folder

### Sync status

`syncStatus(folder)` in `packages/workspace/src/backup.ts` reads only the path and the folder's own `.git/config`:

| Result | When |
|---|---|
| `{ kind: "synced", provider }` | The folder is under `~/Library/CloudStorage/GoogleDrive-*`, `OneDrive-*`, `Dropbox*` (or `~/Dropbox`), or `~/Library/Mobile Documents/com~apple~CloudDocs` |
| `{ kind: "git-remote" }` | The folder (or a parent) holds `.git/config` with at least one `[remote …]` section with a `url` |
| `{ kind: "local" }` | Anything else |

It never reads account files, tokens or the providers' own settings. `syncLocations()` lists the synced roots that exist on this computer, for the folder step and the move button.

**Spike first (task 0 of the plan).** macOS's iCloud "Desktop & Documents" keeps `~/Documents` at the same path. The spike checks whether there is a reliable, credential-free way to tell (for example a file attribute on `~/Documents`). If there isn't, `~/Documents` counts as `local` and the person can dismiss the notice.

### Where the person sees it

- **First launch (`FolderStep`).** When synced locations exist, the step offers them first ("Save it in Google Drive so you don't lose it"), with the harness's `folder.suggested` name inside the chosen root. Picking any other place stays possible.
- **Afterwards.** When the status is `local` and the person hasn't dismissed it, a quiet notice shows on Home and in Settings › General. It has "Move to <provider>" (one button per synced location) or "Choose another place…", and "I already have a copy". Dismissing is saved in the app config (`backupDismissed: true`) and can be undone from Settings › General.

### Moving the folder

`moveFolder(from, to)` in the shell main process, refused while a turn is live:

1. Refuse when `to` already exists, is inside `from`, or `from` is inside `to`.
2. Copy `from` to `to` (`fs.cp`, recursive, keeping timestamps).
3. Verify: same relative file list and same size for every file; hash only files the history tracks.
4. Save `to` as the app's folder in the config.
5. Rename the history data folder from `historyDir(userData, from)` to `historyDir(userData, to)`.
6. Remove `from`.

When any step before 6 fails, the move rolls back what it did (remove the copy, restore the config, rename the history back) and `from` stays untouched. When step 6 fails, the move has succeeded; the app says the old folder could not be removed and shows its path.

Open tasks continue afterwards in a new engine session that starts from the notes (as a profile change does in plan 3c), because engine sessions are tied to the folder's path. Any absolute folder path stored under `.harness/` is rewritten during the move or, better, stored relative to the folder; the plan checks which files hold one. Reference folders (`folder.references`) do not move.

The config already says the folder is fixed once chosen (spec §7). That still holds for the person: the only way to change it is this move, which keeps the history and the files together.

### Errors

Each move failure has its own error card, in plain language: not enough space, the destination already exists, no permission, the copy didn't match. None of them leaves the person without their folder.

## 3. What is out

- Integrations with cloud services or databases (they would mean handling OAuth tokens).
- Pushing to git. The app only detects a remote.
- A size limit for the history. A folder with large media inflates the history in the app's data folder; this stays an open question.
- Windows and Linux sync paths (macOS only, like the rest of the app today).

## Tests

- Unit: `syncStatus` and `syncLocations` against fake home folders; the `.git/config` remote parser; `History.tasks` grouping, the "Earlier" group and the file changes; trailers on every kind of commit.
- Unit: `moveFolder` success, each refusal, a failure at each step (rolling back), and a failure removing the old folder.
- UI: the history rows, expansion and both restore buttons; the backup notice, dismissal and move button; `FolderStep` offering synced locations.
- E2E (fake-agent): a turn edits a file, "Go back to before this task" brings the file back, and the panel then shows the restore.

## Docs

Update `docs/architecture/history.md` (trailers, task groups, backup status, the move). In the roadmap, add row 3d and leave 3b with the Usage tab only.
