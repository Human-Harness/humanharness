# Human Harness — Plan 3d: History and backup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The person can undo what the AI did one task at a time ("Go back to before this task", changed files listed, plain-language entries), and the app tells them when their folder is only on this computer: it offers synced places (Google Drive, iCloud Drive, OneDrive, Dropbox) at first launch and later, and moves the folder there with its history, rolling back on any failure.

**Architecture:** Every history commit made inside a task carries `Task:` and `Action:` git trailers; the task manager hands them to the turn controller, which hands them to the runtime (turn commits) and to the history directly (note commits). `History.tasks()` (`packages/workspace/src/history.ts`) groups commits by trailer and diffs each task's start and end trees with `git.walk`. The shell serves the groups over IPC (`hh:historyTasks`, `hh:restoreTask`) and the rewritten `HistoryPanel` shows one row per task. A new path-only module `packages/workspace/src/backup.ts` answers `syncStatus` and `syncLocations`; `AppState.backup` carries both to the window, where `FolderStep` offers the synced places and a `BackupNotice` (Home and Settings › General) offers "Move to …". `moveFolder` (`packages/shell/src/main/move-folder.ts`) refuses, copies, verifies, saves the config, renames the history data folder and removes the old folder, undoing each step on failure. The open task survives the move: its next turn starts a fresh engine session from the notes (`TaskManager.resumeFromNotes`).

**Tech Stack:** unchanged from plan 3c (TypeScript, pnpm via corepack, Electron 44 + electron-vite 5, React 19, i18next 26, isomorphic-git 1.43, Vitest + happy-dom, Playwright 1.63.0 with the fake agents). No new dependency.

Spec: `docs/superpowers/specs/2026-10-13-history-and-backup-design.md` (source of truth; "§" numbers below refer to it). Previous plan: `docs/superpowers/plans/2026-10-12-03c-resources.md`.

---

## Conventions

- Same as plans 1–3c: English everywhere (code, comments, docs); packages export TS source; extensionless imports; tests in `packages/<name>/test/`; one commit per task.
- The worktree is `/Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-core` (branch `plan-3d-data-safety`). Run every `corepack pnpm …` command from the worktree root. Git: always `git -C <worktree> …` with one simple command per call; never `git stash`.
- Every commit message ends with these two lines (a blank line before them):
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_019d45XaZQ8kSgiVYs5kCgGp
  ```
- Every task ends with `corepack pnpm typecheck` and `corepack pnpm test` green before its commit. Tasks that touch the shell's main process, the preload or the UI also run `corepack pnpm app:build`. Task 15 runs `corepack pnpm e2e`.
- React tests are `*.test.tsx` with `// @vitest-environment happy-dom` on the first line; elements are found by role and visible text.
- `@humanharness/ui` only imports **types** from other packages; the UI's copies of the backup and history types live in `packages/ui/src/client.ts` (as `HistoryItem` already mirrors `HistoryEntry`).
- Colours only through the existing `--hh-*` tokens in `packages/ui/src/styles.css`.
- **Compliance (core spec §5), restated for this plan:** never read `~/.claude`, `~/.codex`, `~/.gemini` or any account, token or credential file, and never a sync provider's own settings or databases. Sync detection (`backup.ts`) reads only **paths** (folder names under `~/Library/CloudStorage`, the existence of the iCloud Drive and `~/Dropbox` folders, `realpath`) and the folder's own `.git/config` (or that of a folder above it, below the home folder). It never runs `brctl`, `defaults`, or any provider CLI. The folder names under `~/Library/CloudStorage` (e.g. `GoogleDrive-<account>`) are never shown, logged or sent anywhere; the window gets the provider kind and the path of the place.

## Decisions this plan takes where the spec leaves room

- **"Start" stays untagged.** It is committed when the runtime is created, before any task's turn, and records edits the person made outside the app, so it belongs to "Earlier". Every other kind ("Before message", "Turn", "Stopped", "Undo", "Note", both restores) carries the trailer of its task.
- **Trailer values are checked** (`^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$`, the task's UUID and the manifest's action id) and every commit subject is folded to one line, so a person's message can't forge a `Task:` line.
- **Grouping is by task id, not by adjacency.** A restore tagged with task X joins X's group, so after "Go back to before this task" X's row moves to the top, shows the restore entry and "0 files changed". `start` is the parent of the group's oldest commit; `end` its newest commit.
- **`start` is `string | null`.** Null only when a group begins at the very first commit (in practice the "Earlier" group); the panel then shows no "Go back to before this task".
- **The "Earlier" group's changes** are the union of its commits' own changes (newest kind wins), because its commits are not contiguous and a start..end diff would include other tasks' work. It is always listed last.
- **A task that changed nothing has no commit and no row.** "Before message" commits only when the folder changed; when it didn't, the task's first commit is its "Turn", whose parent is still the state before the task.
- **Restore messages** (raw git data, English): `Went back to an earlier point` (one entry) and `Went back to before the task` (a whole task). A point restore carries the trailer of the commit it went back to; a task restore carries that task's.
- **Note title on a row:** the newest `Note: <title>` entry of the task.
- **Sync detection details.** Google Drive's own files live in `GoogleDrive-<account>/My Drive` (`Mi unidad` in Spanish); a Google drive without one of those folders is not offered (its top level can't hold files). A git repository found in the home folder itself (dotfiles) does not count: the walk up stops below home. `~/Documents` counts as `local` (Task 0).
- **Where a moved folder goes:** "Move to <provider>" moves it to `<place>/<the folder's current name>`; "Choose another place…" asks for the place (a parent folder) and moves it to `<picked>/<name>`. The target is checked with `checkFolder` (as a first-launch folder is). `FolderStep` suggests `<place>/<basename of folder.suggested>`.
- **Both "Move to …" buttons and "Choose another place…" always show** (the spec's "or" read as "and also"): an external disk is a valid copy too.
- **Move errors travel as data.** IPC rejects lose custom fields, so `hh:moveFolder` resolves `{ ok: false, error }` with a `MoveError` code (`busy`, `exists`, `inside`, `unsuitable`, `no-space`, `no-permission`, `mismatch`, `failed`), each with its own card text.
- **Space is checked before copying** (`fs.statfs` on the nearest existing parent) and `ENOSPC`/`EDQUOT` during the copy also map to `no-space`.
- **A stale history for the target path** (from a folder that once lived there) is renamed aside to `<dir>.replaced-<ms>` and put back if the move rolls back.
- **The open task after a move.** There is no mid-task profile switch in the code (plan 3c left it out), so this plan adds the mechanism: `TaskManager.resumeFromNotes()` drops the stored session and context and sets `resume: true`; the task's next follow-up ends the session and sends `RESUME_PROMPT` (notes index + the person's message); closing such a task skips the closing turn (its session holds no conversation). It runs after every move attempt, since the runtime is closed before moving.

## Absolute folder paths under `.harness/` (checked in the code)

| File | Absolute path of the folder? | Handling |
|---|---|---|
| `.harness/tasks.json` (`task-store.ts`) | No. It holds the engine **session id**, which the engine ties to the folder's path | `resumeFromNotes()` drops the session; the next turn starts a new one (Task 11) |
| `.harness/usage.jsonl` (`usage-log.ts`) | No (engine, action, task, tokens, model) | Nothing |
| `.harness/chats/main.jsonl` and `chats/archive/` (`chat-log.ts`) | Activity details are basenames (`claude-cli.ts` `detailOf`, `acp.ts` `activityDetail`), except a shell command's first line and the conversation text, which may quote any path | Left as they are: display-only words of the conversation, never used to open anything |
| `.harness/notes/<slug>.md` (`notes.ts`) | **Yes, possibly**: front matter `files:` holds the paths the agent passed to `save_note`, which can be absolute inside the folder | From now on `writeNote` stores in-folder paths relative (Task 10); the move rewrites the existing notes' `files:` entries that name the old folder (`relativizeNoteFiles`, Tasks 10 and 12) |
| `.harness/session.json` (plan 2 leftover, `engine-switch.ts`) | No (engine id) | Nothing |
| `AGENTS.md`, `CLAUDE.md` (outside `.harness/`) | No (reference folders only; they don't move) | Regenerated by the next runtime |
| `config.json` and `history/<hash>` (app data, outside the folder) | Yes (`folder`, and the history dir is named by the folder's hash) | Moved by `moveFolder` steps 4 and 5 |

## Scope

In: everything in spec §1, §2 and Tests/Docs. Out (spec §3): cloud or database integrations, pushing to git, a size limit for the history, Windows and Linux sync paths. The roadmap already has row 3d (commit `e1f2bae`), so Task 16 only updates `docs/architecture/history.md`.

## File Structure

```
packages/workspace/src/history.ts          Trailers (withTrailer, parseCommitMessage), HistoryEntry.task/action,
                                           History.tasks() + FileChange tree diff, trailerOf(), trackedFiles()     (Tasks 1–2)
packages/workspace/src/backup.ts           NEW. syncStatus, syncLocations, providerOf, cloudProvider, hasRemote,
                                           hasGitRemote — paths and .git/config only                              (Task 7)
packages/workspace/src/notes.ts            folderRelative, writeNote stores relative files, relativizeNoteFiles      (Task 10)
packages/workspace/src/index.ts            exports backup                                                           (Task 7)
packages/runtime/src/runtime.ts            send(…, { trailer }) tags Before message / Turn / Stopped / Undo        (Task 3)
packages/shell/src/main/turn-controller.ts passes { task, action } as the runtime's trailer                          (Task 4)
packages/shell/src/main/task-manager.ts    Note commit trailer; resumeFromNotes(); resume follow-up and close       (Tasks 4, 11)
packages/shell/src/main/task-prompts.ts    RESUME_PROMPT                                                            (Task 11)
packages/shell/src/main/task-store.ts      CurrentTask.resume                                                       (Task 11)
packages/shell/src/main/history-view.ts    NEW. historyView(), isSha, RESTORE_POINT, RESTORE_TASK                   (Task 5)
packages/shell/src/main/config.ts          ConfigStore.replaceFolder                                                (Task 8)
packages/shell/src/main/validate.ts        backupDismissed must be a boolean                                        (Task 8)
packages/shell/src/main/move-folder.ts     NEW. moveFolder, MoveFailed, sameContents, failureOf                     (Task 12)
packages/shell/src/main/index.ts           saveHistory trailer, hh:historyTasks, hh:restoreTask, restoreWith,
                                           AppState.backup, closeRuntime, hh:moveFolder                              (Tasks 4, 5, 6, 8, 13)
packages/shell/src/preload/index.ts        historyTasks, restoreTask, moveFolder                                    (Tasks 5, 6, 13)
packages/cli/src/run.ts                    saveHistory passes the trailer                                           (Task 4)
packages/ui/src/client.ts                  HistoryTaskView, HistoryFileChange, SyncProvider/SyncStatus,
                                           SyncLocationView, AppState.backup, AppConfig.backupDismissed,
                                           MoveError, MoveResult, HarnessClient methods                             (Tasks 5, 6, 8, 13)
packages/ui/src/HistoryPanel.tsx           Rewritten: rows per task, expand, files, both restores, entryLabel       (Task 6)
packages/ui/src/ChatView.tsx               HistoryPanel gets actions and lang                                       (Task 6)
packages/ui/src/FolderStep.tsx             Synced places first                                                      (Task 9)
packages/ui/src/BackupNotice.tsx           NEW. Notice, move buttons, move error cards, needsBackupNotice           (Task 14)
packages/ui/src/Home.tsx                   Shows BackupNotice (new props client, onChange)                          (Task 14)
packages/ui/src/HarnessApp.tsx             Passes client and onChange to Home                                       (Task 14)
packages/ui/src/SettingsSheet.tsx          General: backup row, "Remind me again", BackupNotice                     (Task 14)
packages/ui/src/styles.css                 History rows, places, backup notice                                      (Tasks 6, 9, 14)
packages/i18n/src/locales/{es,en}.json     history.*, backup.*, settings.folderFixed                                (Tasks 6, 9, 14)
packages/ui/test/fake-client.ts            historyGroups, restoredTasks, moved, moveResult                          (Tasks 5, 6, 13)
packages/e2e/tests/history.spec.ts         NEW. Turn edits a file, "Go back to before this task" restores it        (Task 15)
packages/e2e/tests/scripts.ts              historyScript                                                            (Task 15)
docs/architecture/history.md               Trailers, task groups, backup status, the move                           (Task 16)
```

Tests: `packages/workspace/test/{history,backup,notes}.test.ts`, `packages/runtime/test/runtime.test.ts`, `packages/shell/test/{turn-controller,task-manager,task-store,history-view,config,validate,move-folder}.test.ts`, `packages/ui/test/{history-panel,folder-step,backup-notice,HarnessApp,settings}.test.tsx`.

---

## Phase 0 — Spike

### Task 0: Can the app tell that iCloud "Desktop & Documents" syncs `~/Documents`, without reading account state?

Timebox: 20 minutes. Allowed: file attributes and path existence of `~/Documents`, `~/Desktop` and the iCloud Drive folder. Not allowed: `brctl` (it talks to the iCloud daemon and reports account state), `defaults read MobileMeAccounts`, anything under `~/Library/Application Support/CloudDocs`, `~/Library/Preferences`, or any account, token or credential file.

- [ ] **Step 1: Look at the attributes of `~/Documents` and `~/Desktop`**

Run (one command per call):
```bash
xattr /Users/marcozanger/Documents
stat -f "%N %HT %Sf" /Users/marcozanger/Documents /Users/marcozanger/Desktop
```

- [ ] **Step 2: Check whether iCloud Drive holds Desktop and Documents folders (existence only, no listing)**

```bash
test -d "/Users/marcozanger/Library/Mobile Documents/com~apple~CloudDocs/Documents" && echo documents-in-icloud || echo no
test -d "/Users/marcozanger/Library/Mobile Documents/com~apple~CloudDocs/Desktop" && echo desktop-in-icloud || echo no
```

- [ ] **Step 3: Record the result below and apply the decision rule**

Decision rule: only a signal that (a) is a file attribute or a path, (b) appears exactly when "Desktop & Documents" is on, and (c) was observed on a Mac with it on, may mark `~/Documents` as `synced/icloud`. Anything less keeps the spec's fallback.

**Spike result (run while writing this plan, 2026-10-13, macOS 27):**

| Check | Observed |
|---|---|
| `xattr ~/Documents` | only `com.apple.macl` (the sandbox access-control list every app-touched folder gets; nothing about iCloud) |
| `stat` of `~/Documents`, `~/Desktop` | plain directories, no file flags |
| iCloud Drive `Documents` / `Desktop` folders | absent (the only top-level entry in iCloud Drive was the person's own `Downloads` folder) |

"Desktop & Documents" is off on this Mac, so no positive signal could be observed, and none of the attributes seen is iCloud-specific. The existence of `com~apple~CloudDocs/Documents` is not reliable on its own either: a person can create a folder named `Documents` in iCloud Drive by hand.

**Decision:** no reliable, credential-free signal → `~/Documents` (and anything not under a synced root) counts as `local`, and the person dismisses the notice with "I already have a copy". `backup.ts` does not special-case `~/Documents`. If a later run on a Mac with "Desktop & Documents" on finds an attribute that meets the rule, it becomes a follow-up (listed under "Open questions" in `docs/architecture/history.md`, Task 16). No code and no commit in this task.

---

## Phase 1 — History by task

### Task 1: Trailers on history commits

**Files:**
- Modify: `packages/workspace/src/history.ts`
- Test: `packages/workspace/test/history.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/workspace/test/history.test.ts`, change the import line to:

```ts
import { History, parseCommitMessage, withTrailer } from "../src";
```

and add at the end of the file:

```ts
describe("History trailers", () => {
  it("writes the task and the action as trailers and reads them back", async () => {
    write("a.md", "1");
    const sha = (await history.save("Turn: plan the week", { task: "t-1", action: "plan" }))!;
    const { commit } = await git.readCommit({ fs, gitdir, oid: sha });
    expect(commit.message.trim()).toBe("Turn: plan the week\n\nTask: t-1\nAction: plan");
    const [entry] = await history.list();
    expect(entry).toMatchObject({ sha, message: "Turn: plan the week", task: "t-1", action: "plan" });
  });

  it("leaves commits outside a task without trailers", async () => {
    write("a.md", "1");
    await history.save("Start");
    expect((await history.list())[0]).toMatchObject({ message: "Start", task: null, action: null });
  });

  it("tags a restore with the task it went back to", async () => {
    write("a.md", "1");
    const before = (await history.save("Start"))!;
    write("a.md", "2");
    await history.save("Turn: edit", { task: "t-1" });
    await history.restore(before, "Went back to before the task", { task: "t-1" });
    expect((await history.list())[0]).toMatchObject({ message: "Went back to before the task", task: "t-1", action: null });
    expect(read("a.md")).toBe("1");
  });

  it("keeps the subject on one line and refuses ids that could forge a trailer", async () => {
    write("a.md", "1");
    await history.save("Turn: hi\n\nTask: forged", { task: "bad id\nAction: x" });
    expect((await history.list())[0]).toMatchObject({ message: "Turn: hi Task: forged", task: null, action: null });
  });

  it("builds and parses messages", () => {
    expect(withTrailer("Note: x", { task: "t1" })).toBe("Note: x\n\nTask: t1");
    expect(withTrailer("Start")).toBe("Start");
    expect(parseCommitMessage("Note: x\n\nTask: t1\nAction: plan\n")).toEqual({ subject: "Note: x", task: "t1", action: "plan" });
    expect(parseCommitMessage("Start")).toEqual({ subject: "Start", task: null, action: null });
    expect(parseCommitMessage("Turn: a\n\nTask: two words")).toEqual({ subject: "Turn: a", task: null, action: null });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run packages/workspace/test/history.test.ts`
Expected: FAIL — `withTrailer` and `parseCommitMessage` are not exported; `save` ignores its second argument.

- [ ] **Step 3: Implement**

In `packages/workspace/src/history.ts`, replace the `HistoryEntry` interface with:

```ts
export interface HistoryEntry {
  sha: string;
  /** The commit's subject (its first line). */
  message: string;
  date: Date;
  /** The task the commit belongs to (its `Task:` trailer); null outside any task. */
  task: string | null;
  /** The task's manifest action (its `Action:` trailer); null for a free question or outside any task. */
  action: string | null;
}

/** The task a history commit belongs to, written as git trailers under its subject. */
export interface HistoryTrailer {
  task: string;
  action?: string;
}

/** Ids a trailer may carry (task UUIDs, manifest action ids): no spaces or line breaks. */
const TRAILER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

/** `message` folded to one line, plus `Task:` and `Action:` trailers when `trailer` holds valid ids. */
export function withTrailer(message: string, trailer?: HistoryTrailer): string {
  const subject = message.replace(/\s*\n\s*/g, " ").trim();
  if (!trailer || !TRAILER_ID.test(trailer.task)) return subject;
  const lines = [`Task: ${trailer.task}`];
  if (trailer.action !== undefined && TRAILER_ID.test(trailer.action)) lines.push(`Action: ${trailer.action}`);
  return `${subject}\n\n${lines.join("\n")}`;
}

/** A commit message's subject and its trailers (null when absent or not a valid id). */
export function parseCommitMessage(raw: string): { subject: string; task: string | null; action: string | null } {
  const text = raw.replace(/\r\n/g, "\n").trim();
  const paragraphs = text.split(/\n{2,}/);
  const trailers = paragraphs.length > 1 ? paragraphs[paragraphs.length - 1] : "";
  const value = (key: string): string | null => {
    const m = new RegExp(`^${key}: (.+)$`, "m").exec(trailers);
    return m && TRAILER_ID.test(m[1]) ? m[1] : null;
  };
  return { subject: text.split("\n")[0], task: value("Task"), action: value("Action") };
}
```

Replace `save` and `restore` (the public methods only; `saveNow` and `restoreNow` stay as they are):

```ts
  /** Commits the current state; `trailer` names the task it belongs to. Returns the new sha, or null when nothing changed. */
  save(message: string, trailer?: HistoryTrailer): Promise<string | null> {
    return this.serialize(() => this.saveNow(withTrailer(message, trailer)));
  }

  /** Makes the folder look exactly like `sha` (tracked files only) and records that as a new commit, tagged with `trailer`. */
  restore(sha: string, message: string, trailer?: HistoryTrailer): Promise<string | null> {
    return this.serialize(() => this.restoreNow(sha, withTrailer(message, trailer)));
  }
```

Replace the body of `list`'s mapping:

```ts
  async list(depth = 50): Promise<HistoryEntry[]> {
    if ((await this.last()) === null) return [];
    const log = await git.log({ ...this.repo(), depth });
    return log.map((e) => {
      const { subject, task, action } = parseCommitMessage(e.commit.message);
      return { sha: e.oid, message: subject, date: new Date(e.commit.author.timestamp * 1000), task, action };
    });
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/workspace/test/history.test.ts`
Expected: PASS (the older tests too: their subjects are one line).

- [ ] **Step 5: Typecheck, full tests, commit**

Run: `corepack pnpm typecheck` then `corepack pnpm test`
Expected: both green (`hh:history` in the shell spreads the entry, so the two new fields pass through untouched).

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-core add packages/workspace/src/history.ts packages/workspace/test/history.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-core commit -m "feat(workspace): task and action trailers on history commits" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019d45XaZQ8kSgiVYs5kCgGp"
```

### Task 2: `History.tasks()` — groups, changed files and the "Earlier" group

**Files:**
- Modify: `packages/workspace/src/history.ts`
- Test: `packages/workspace/test/history.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/workspace/test/history.test.ts`:

```ts
describe("History.tasks", () => {
  const withNotes = () => new History(folder, gitdir, [".harness/", "AGENTS.md"], [".harness/notes/"]);

  it("groups commits by task, newest task first, with the files each task changed; Earlier last", async () => {
    const h = withNotes();
    await h.init();
    write("a.md", "1");
    write("b.md", "b");
    const base = (await h.save("Start"))!;
    write("a.md", "2");
    write("c.md", "new");
    await h.save("Turn: first", { task: "t1", action: "plan" });
    write(".harness/notes/plan.md", "note");
    write(".harness/chats/main.jsonl", "chat");
    await h.save("Note: The plan", { task: "t1", action: "plan" });
    fs.rmSync(path.join(folder, "b.md"));
    const t2end = (await h.save("Turn: second", { task: "t2" }))!;

    const groups = await h.tasks();
    expect(groups.map((g) => g.taskId)).toEqual(["t2", "t1", null]);
    const [t2, t1, earlier] = groups;
    expect(t2).toMatchObject({ actionId: null, end: t2end, changes: [{ path: "b.md", kind: "deleted" }] });
    expect(t2.date).toBeInstanceOf(Date);
    expect(t1.start).toBe(base);
    expect(t1.actionId).toBe("plan");
    expect(t1.changes).toEqual([
      { path: ".harness/notes/plan.md", kind: "added" },
      { path: "a.md", kind: "modified" },
      { path: "c.md", kind: "added" },
    ]);
    expect(t1.entries.map((e) => e.message)).toEqual(["Note: The plan", "Turn: first"]);
    expect(earlier).toMatchObject({ taskId: null, actionId: null, start: null, end: base });
    expect(earlier.changes).toEqual([
      { path: "a.md", kind: "added" },
      { path: "b.md", kind: "added" },
    ]);
  });

  it("puts a restore in the group of the task it went back to, which then changed nothing", async () => {
    write("a.md", "1");
    const base = (await history.save("Start"))!;
    write("a.md", "2");
    await history.save("Turn: edit", { task: "t1" });
    write("b.md", "b");
    await history.save("Turn: other", { task: "t2" });
    const t1 = (await history.tasks()).find((g) => g.taskId === "t1")!;
    expect(t1.start).toBe(base);
    await history.restore(t1.start!, "Went back to before the task", { task: "t1" });

    const groups = await history.tasks();
    expect(groups.map((g) => g.taskId)).toEqual(["t1", "t2", null]);
    expect(groups[0].entries[0].message).toBe("Went back to before the task");
    expect(groups[0].changes).toEqual([]);
    expect(read("a.md")).toBe("1");
    expect(fs.existsSync(path.join(folder, "b.md"))).toBe(false);
  });

  it("reads a commit's trailer", async () => {
    write("a.md", "1");
    const tagged = (await history.save("Turn: x", { task: "t1", action: "plan" }))!;
    write("a.md", "2");
    const plain = (await history.save("Start"))!;
    expect(await history.trailerOf(tagged)).toEqual({ task: "t1", action: "plan" });
    expect(await history.trailerOf(plain)).toBeNull();
  });

  it("lists the files it tracks now", async () => {
    const h = withNotes();
    await h.init();
    write("a.md", "1");
    write("dir/b.md", "b");
    write(".harness/notes/n.md", "n");
    write(".harness/chats/main.jsonl", "c");
    write("AGENTS.md", "generated");
    expect((await h.trackedFiles()).sort()).toEqual([".harness/notes/n.md", "a.md", "dir/b.md"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run packages/workspace/test/history.test.ts`
Expected: FAIL — `tasks`, `trailerOf` and `trackedFiles` don't exist.

- [ ] **Step 3: Implement**

In `packages/workspace/src/history.ts`, after the `HistoryTrailer` interface add:

```ts
/** A file a task added, changed or deleted (tracked files only). */
export interface FileChange {
  path: string;
  kind: "added" | "modified" | "deleted";
}

/** The history commits of one task, as the History panel shows them. */
export interface HistoryTask {
  /** Null: the "Earlier" group (commits outside any task). */
  taskId: string | null;
  actionId: string | null;
  /** The commit before the group's first commit; null when the group starts at the very first commit. */
  start: string | null;
  /** The group's newest commit. */
  end: string;
  /** The date of `end`. */
  date: Date;
  /** Tasks: the tree diff from `start` to `end`. Earlier: the union of its commits' own changes. */
  changes: FileChange[];
  /** Newest first. */
  entries: HistoryEntry[];
}

const byPath = (a: FileChange, b: FileChange) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
```

Inside the class, after `list`, add:

```ts
  /** The commits of the last `depth`, grouped by task, newest task first; the "Earlier" group always last. */
  async tasks(depth = 200): Promise<HistoryTask[]> {
    const groups = new Map<string | null, HistoryEntry[]>();
    for (const e of await this.list(depth)) {
      const list = groups.get(e.task);
      if (list) list.push(e);
      else groups.set(e.task, [e]);
    }
    // A Map keeps the order of first insertion: each group's newest commit, newest first.
    const out: HistoryTask[] = [];
    for (const [taskId, entries] of groups) {
      const start = await this.parentOf(entries[entries.length - 1].sha);
      const end = entries[0];
      out.push({
        taskId,
        actionId: entries.find((e) => e.action !== null)?.action ?? null,
        start,
        end: end.sha,
        date: end.date,
        changes: taskId === null ? await this.unionOfChanges(entries) : await this.diff(start, end.sha),
        entries,
      });
    }
    return [...out.filter((g) => g.taskId !== null), ...out.filter((g) => g.taskId === null)];
  }

  /** The task a commit belongs to, from its trailers; null outside any task. */
  async trailerOf(sha: string): Promise<HistoryTrailer | null> {
    const { commit } = await git.readCommit({ fs, gitdir: this.gitdir, oid: sha });
    const { task, action } = parseCommitMessage(commit.message);
    return task ? { task, ...(action ? { action } : {}) } : null;
  }

  /** The files the history tracks in the folder now (relative, forward slashes). */
  trackedFiles(): Promise<string[]> {
    return this.serialize(async () => {
      const matrix = await git.statusMatrix({ ...this.repo(), filter: this.tracked });
      return matrix.filter(([, , workdir]) => workdir !== 0).map(([file]) => file);
    });
  }

  private async parentOf(sha: string): Promise<string | null> {
    const { commit } = await git.readCommit({ fs, gitdir: this.gitdir, oid: sha });
    return commit.parent[0] ?? null;
  }

  /** Tracked files that differ between two commits; with no `from`, every file of `to` is added. */
  private async diff(from: string | null, to: string): Promise<FileChange[]> {
    const changes: FileChange[] = [];
    const trees = from === null ? [git.TREE({ ref: to })] : [git.TREE({ ref: from }), git.TREE({ ref: to })];
    await git.walk({
      fs,
      gitdir: this.gitdir,
      trees,
      map: async (filepath, entries) => {
        if (filepath === ".") return undefined;
        const [a, b] = from === null ? [null, entries[0]] : entries;
        const types = await Promise.all([a?.type(), b?.type()]);
        // A folder: returning undefined walks into it.
        if (types.includes("tree")) return undefined;
        if (!this.tracked(filepath)) return undefined;
        const [oa, ob] = await Promise.all([a?.oid(), b?.oid()]);
        if (oa === ob) return undefined;
        changes.push({ path: filepath, kind: !a ? "added" : !b ? "deleted" : "modified" });
        return undefined;
      },
    });
    return changes.sort(byPath);
  }

  /** Each commit's own changes, merged: the newest kind of each file wins. */
  private async unionOfChanges(entries: HistoryEntry[]): Promise<FileChange[]> {
    const seen = new Map<string, FileChange>();
    for (const e of entries) {
      for (const c of await this.diff(await this.parentOf(e.sha), e.sha)) if (!seen.has(c.path)) seen.set(c.path, c);
    }
    return [...seen.values()].sort(byPath);
  }
```

(`git.walk` calls `map` with `null` for a side where the path is absent; returning `undefined` keeps walking into folders, returning `null` would prune them — verified in `isomorphic-git/index.js` `_walk`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/workspace/test/history.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck, full tests, commit**

Run: `corepack pnpm typecheck` then `corepack pnpm test`
Expected: both green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-core add packages/workspace/src/history.ts packages/workspace/test/history.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-core commit -m "feat(workspace): history grouped by task with the files each task changed" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019d45XaZQ8kSgiVYs5kCgGp"
```

### Task 3: The runtime tags a turn's commits

**Files:**
- Modify: `packages/runtime/src/runtime.ts`
- Test: `packages/runtime/test/runtime.test.ts`

- [ ] **Step 1: Write the failing tests**

Add inside `describe("createRuntime", …)` in `packages/runtime/test/runtime.test.ts`:

```ts
  it("tags the turn's commits with the task it belongs to", async () => {
    const { runtime, folder } = await setup({ steps: [{ write: { path: "plan.md", content: "x" } }, ...claudeTextLines("ok"), claudeResultLine(true)] });
    fs.writeFileSync(path.join(folder, "mine.md"), "user edit");
    await runtime.send("plan the week", () => {}, { trailer: { task: "t1", action: "plan" } }).done;
    const [turn, before, start] = await runtime.history.list();
    expect(turn).toMatchObject({ message: "Turn: plan the week", task: "t1", action: "plan" });
    expect(before).toMatchObject({ message: "Before message", task: "t1", action: "plan" });
    expect(start).toMatchObject({ message: "Start", task: null });
  });

  it("tags a stopped turn's commit", async () => {
    const { runtime, folder } = await setup({ steps: [{ write: { path: "kept.md", content: "x" } }, { sleep: 10_000 }] });
    const turn = runtime.send("hi", () => {}, { trailer: { task: "t1" } });
    while (!fs.existsSync(path.join(folder, "kept.md"))) await new Promise((r) => setTimeout(r, 50));
    turn.cancel();
    await turn.done;
    expect((await runtime.history.list())[0]).toMatchObject({ message: "Stopped: hi", task: "t1", action: null });
  }, 10_000);
```

(The "Undo" restore gets the same trailer, but it rarely makes a commit: it puts back the state of the last commit, so there is usually nothing new to record. The code change below covers it.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run packages/runtime/test/runtime.test.ts`
Expected: FAIL — typecheck error on `trailer`, and the entries have `task: null`.

- [ ] **Step 3: Implement**

In `packages/runtime/src/runtime.ts`, change the workspace import to:

```ts
import { History, type HistoryTrailer, NOTES_PREFIX, type ReferenceFolder, prepareFolder, writeInstructions } from "@humanharness/workspace";
```

In `HarnessRuntime`, replace the `send` declaration with:

```ts
  /**
   * Runs one turn; `options.profile` is the task's model profile (every turn of a task gets the same one) and
   * `options.trailer` the task its history commits belong to.
   */
  send(message: string, emit: (e: Event) => void, options?: { profile?: ModelProfile; trailer?: HistoryTrailer }): RunningTurn;
```

In `send`'s `done` body, replace the four history calls:

```ts
            const before = (await history.save("Before message", options.trailer)) ?? (await history.last())!;
```

```ts
            if (f.type === "done" && f.ok) await history.save(`Turn: ${message.slice(0, 60)}`, options.trailer);
            else if (f.type === "done" && f.error.code === "agent-crashed") await history.restore(before, "Undo: the turn did not finish", options.trailer);
            else await history.save(`Stopped: ${message.slice(0, 60)}`, options.trailer);
```

The `"Start"` commit in `createRuntime` stays untagged (see Decisions).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/runtime/test/runtime.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck, full tests, commit**

Run: `corepack pnpm typecheck` then `corepack pnpm test`
Expected: both green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-core add packages/runtime/src/runtime.ts packages/runtime/test/runtime.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-core commit -m "feat(runtime): tag a turn's history commits with its task" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019d45XaZQ8kSgiVYs5kCgGp"
```

### Task 4: Turns and notes carry the task from the task manager

**Files:**
- Modify: `packages/shell/src/main/turn-controller.ts`, `packages/shell/src/main/task-manager.ts`, `packages/shell/src/main/index.ts`, `packages/cli/src/run.ts`
- Test: `packages/shell/test/turn-controller.test.ts`, `packages/shell/test/task-manager.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/shell/test/turn-controller.test.ts`, add inside `describe("TurnController for tasks", …)`:

```ts
  it("hands the runtime the task and action its history commits belong to", async () => {
    const fake = fakeRuntime();
    const { controller } = setup({ ensureRuntime: async () => fake.runtime });
    const sent = controller.send("And the blocks?", { action: "engines", task: "t1", followUp: true });
    await vi.waitFor(() => expect(fake.send).toHaveBeenCalled());
    fake.finish([{ type: "done", ok: true }]);
    await sent;
    expect(fake.send.mock.calls[0][2]).toEqual({ trailer: { task: "t1", action: "engines" } });
  });

  it("sends no trailer for a turn outside any task", async () => {
    const fake = fakeRuntime();
    const { controller } = setup({ ensureRuntime: async () => fake.runtime });
    const sent = controller.send("hi");
    await vi.waitFor(() => expect(fake.send).toHaveBeenCalled());
    fake.finish([{ type: "done", ok: true }]);
    await sent;
    expect(fake.send.mock.calls[0][2]).toEqual({});
  });
```

In `packages/shell/test/task-manager.test.ts`, inside `setup`:
- add `const trailers: unknown[] = [];` next to `const emitted: Event[] = [];`
- replace the `saveHistory` line with:
  ```ts
      saveHistory: async (message, trailer) => {
        log.push(`history:${message}`);
        trailers.push(trailer);
      },
  ```
- return it: `return { manager, turns, views, log, emitted, trailers, state: () => state };`

Then add inside `describe("TaskManager", …)`:

```ts
  it("tags the note's history commit with its task and action", async () => {
    const t = setup({ script: [[ok], [saveNote(), ok]], path: ["manifest"] });
    await t.manager.start("manifest");
    await pick(t, { label: "Done", next: true });
    expect(t.log).toContain("history:Note: The manifest");
    expect(t.trailers).toEqual([{ task: "t1", action: "manifest" }]);
  });

  it("tags a free question's note with its task only", async () => {
    const t = setup({ script: [[ok], [saveNote(), ok]] });
    await t.manager.ask("Where are chats saved?");
    await t.manager.finish();
    expect(t.trailers).toEqual([{ task: "t1" }]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run packages/shell/test/turn-controller.test.ts packages/shell/test/task-manager.test.ts`
Expected: FAIL — the runtime gets `undefined` as options; `saveHistory` gets no trailer.

- [ ] **Step 3: Implement**

`packages/shell/src/main/turn-controller.ts` — in `run`, replace the last argument of `rt.send(…)` (`profile ? { profile } : undefined`) with:

```ts
      }, { ...(profile ? { profile } : {}), ...(task ? { trailer: { task, ...(action ? { action } : {}) } } : {}) });
```

`packages/shell/src/main/task-manager.ts`:
- change the workspace import to `import { type HistoryTrailer, type Note, type NoteMeta, buildNotesIndex, noteSlug } from "@humanharness/workspace";`
- in `TaskDeps`, replace the `saveHistory` member with:
  ```ts
  /** Records the folder in the local history (a note was written), tagged with the task it belongs to. */
  saveHistory?(message: string, trailer?: HistoryTrailer): Promise<void>;
  ```
- in `saveNote`, replace the `saveHistory` call with:
  ```ts
      await this.d.saveHistory?.(`Note: ${note.title.slice(0, 60)}`, { task: task.id, ...(task.action ? { action: task.action } : {}) });
  ```

`packages/shell/src/main/index.ts` — replace the `saveHistory` dep of `new TaskManager({ … })`:

```ts
  saveHistory: async (message, trailer) => {
    await (await currentHistory())?.save(message, trailer);
  },
```

`packages/cli/src/run.ts` — replace its `saveHistory` dep:

```ts
    saveHistory: async (message, trailer) => {
      const rt = await runtime.peek()?.catch(() => null);
      await rt?.history.save(message, trailer);
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/shell/test/turn-controller.test.ts packages/shell/test/task-manager.test.ts`
Expected: PASS (the existing "runs the turn on the task's profile" test still gets `{ profile }`: it sends no task).

- [ ] **Step 5: Typecheck, full tests, build, commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm app:build`
Expected: all green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-core add packages/shell/src/main/turn-controller.ts packages/shell/src/main/task-manager.ts packages/shell/src/main/index.ts packages/cli/src/run.ts packages/shell/test/turn-controller.test.ts packages/shell/test/task-manager.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-core commit -m "feat(shell): turns and notes record their task in the history" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019d45XaZQ8kSgiVYs5kCgGp"
```

### Task 5: Task groups and "restore to start" over IPC

**Files:**
- Create: `packages/shell/src/main/history-view.ts`, `packages/shell/test/history-view.test.ts`
- Modify: `packages/ui/src/client.ts`, `packages/shell/src/main/index.ts`, `packages/shell/src/preload/index.ts`, `packages/ui/test/fake-client.ts`

- [ ] **Step 1: Write the failing test**

`packages/shell/test/history-view.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { HistoryTask } from "@humanharness/workspace";
import { RESTORE_POINT, RESTORE_TASK, historyView, isSha } from "../src/main/history-view";

const at = (iso: string) => new Date(iso);
const entry = (sha: string, message: string, task: string | null = "t1") => ({ sha, message, date: at("2026-10-13T10:00:00.000Z"), task, action: null });

describe("historyView", () => {
  it("sends dates as ISO strings and the title of the note the task saved", () => {
    const groups: HistoryTask[] = [
      {
        taskId: "t1",
        actionId: "plan",
        start: "a".repeat(40),
        end: "b".repeat(40),
        date: at("2026-10-13T10:00:00.000Z"),
        changes: [{ path: "plan.md", kind: "modified" }],
        entries: [entry("b".repeat(40), "Note: The week"), entry("c".repeat(40), "Turn: plan it")],
      },
      {
        taskId: null,
        actionId: null,
        start: null,
        end: "a".repeat(40),
        date: at("2026-10-13T09:00:00.000Z"),
        changes: [],
        entries: [entry("a".repeat(40), "Note: old untagged note", null)],
      },
    ];
    expect(historyView(groups)).toEqual([
      {
        taskId: "t1",
        actionId: "plan",
        start: "a".repeat(40),
        end: "b".repeat(40),
        date: "2026-10-13T10:00:00.000Z",
        noteTitle: "The week",
        changes: [{ path: "plan.md", kind: "modified" }],
        entries: [
          { sha: "b".repeat(40), message: "Note: The week", date: "2026-10-13T10:00:00.000Z" },
          { sha: "c".repeat(40), message: "Turn: plan it", date: "2026-10-13T10:00:00.000Z" },
        ],
      },
      {
        taskId: null,
        actionId: null,
        start: null,
        end: "a".repeat(40),
        date: "2026-10-13T09:00:00.000Z",
        changes: [],
        entries: [{ sha: "a".repeat(40), message: "Note: old untagged note", date: "2026-10-13T10:00:00.000Z" }],
      },
    ]);
  });

  it("accepts only full commit ids from the window", () => {
    expect(isSha("a".repeat(40))).toBe(true);
    expect(isSha("abc")).toBe(false);
    expect(isSha(`${"a".repeat(39)}Z`)).toBe(false);
    expect(isSha(42)).toBe(false);
  });

  it("names the two restores in English (the raw git data)", () => {
    expect(RESTORE_POINT).toBe("Went back to an earlier point");
    expect(RESTORE_TASK).toBe("Went back to before the task");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/shell/test/history-view.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the types and the view**

In `packages/ui/src/client.ts`, after `HistoryItem` add:

```ts
/** A file a task added, changed or deleted. */
export interface HistoryFileChange {
  path: string;
  kind: "added" | "modified" | "deleted";
}

/** One row of the History panel: a task's commits, or the "Earlier" group (`taskId: null`). */
export interface HistoryTaskView {
  taskId: string | null;
  actionId: string | null;
  /** What "Go back to before this task" restores; null when there is nothing before it. */
  start: string | null;
  end: string;
  /** ISO date of the task's last commit. */
  date: string;
  /** The title of the note the task saved, if any. */
  noteTitle?: string;
  changes: HistoryFileChange[];
  /** Newest first. */
  entries: HistoryItem[];
}
```

In `HarnessClient`, after `restore(sha: string): Promise<void>;` add:

```ts
  /** The history grouped by task, newest first; the "Earlier" group last. */
  historyTasks(): Promise<HistoryTaskView[]>;
  /** Makes the folder look as it did before the task started; recorded as a new entry of that task. */
  restoreTask(taskId: string): Promise<void>;
```

`packages/shell/src/main/history-view.ts`:

```ts
import type { HistoryTaskView } from "@humanharness/ui/client";
import type { HistoryTask } from "@humanharness/workspace";

/** The commit messages of the two restores (raw git data; the panel shows them through i18n keys). */
export const RESTORE_POINT = "Went back to an earlier point";
export const RESTORE_TASK = "Went back to before the task";

const NOTE = /^Note: (.+)$/;

/** A commit id from the window: 40 lowercase hex characters. */
export const isSha = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{40}$/.test(v);

/** What the History panel gets of each group: ISO dates, and the title of the note a task saved. */
export function historyView(groups: HistoryTask[]): HistoryTaskView[] {
  return groups.map((g) => {
    const note = g.taskId === null ? undefined : g.entries.map((e) => NOTE.exec(e.message)?.[1]).find((title) => title !== undefined);
    return {
      taskId: g.taskId,
      actionId: g.actionId,
      start: g.start,
      end: g.end,
      date: g.date.toISOString(),
      ...(note ? { noteTitle: note } : {}),
      changes: g.changes,
      entries: g.entries.map((e) => ({ sha: e.sha, message: e.message, date: e.date.toISOString() })),
    };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `corepack pnpm vitest run packages/shell/test/history-view.test.ts`
Expected: PASS

- [ ] **Step 5: Wire the IPC, the preload and the fake client**

`packages/shell/src/main/index.ts`:
- add the import `import { RESTORE_POINT, RESTORE_TASK, historyView, isSha } from "./history-view";`
- add, above `registerIpc`:

```ts
/**
 * Runs a restore: refused while quitting, while a task operation runs or turns are held (engine change,
 * folder move); one at a time; a runtime starting meanwhile waits for it (`restoring`).
 */
async function restoreWith(run: (history: History) => Promise<unknown>): Promise<void> {
  if (quitting) throw new Error("The app is closing");
  if (restorePending) throw new Error("Already going back");
  if (tasks.isBusy() || guards.turnBlocked()) throw new Error("A turn is running");
  restorePending = true;
  try {
    const history = await currentHistory();
    if (!history) throw new Error("The app is not set up yet");
    if (quitting || tasks.isBusy()) throw new Error("A turn is running");
    const done = run(history);
    restoring = done.catch(() => undefined);
    await done;
  } finally {
    restorePending = false;
  }
}
```

- replace the whole `handle("hh:restore", …)` registration with:

```ts
  handle("hh:restore", (sha: unknown) =>
    restoreWith(async (history) => {
      if (!isSha(sha)) throw new Error("Invalid point");
      // The entry it goes back to names the task the restore belongs to.
      await history.restore(sha, RESTORE_POINT, (await history.trailerOf(sha)) ?? undefined);
    }),
  );
  handle("hh:historyTasks", async () => {
    const history = await currentHistory();
    return history ? historyView(await history.tasks()) : [];
  });
  handle("hh:restoreTask", (taskId: unknown) =>
    restoreWith(async (history) => {
      if (typeof taskId !== "string" || !taskId || taskId.length > 200) throw new Error("Invalid task");
      const group = (await history.tasks()).find((g) => g.taskId === taskId);
      if (!group?.start) throw new Error("Nothing to go back to");
      await history.restore(group.start, RESTORE_TASK, { task: taskId, ...(group.actionId ? { action: group.actionId } : {}) });
    }),
  );
```

`packages/shell/src/preload/index.ts` — after the `restore` line add:

```ts
  historyTasks: () => ipcRenderer.invoke("hh:historyTasks"),
  restoreTask: (taskId) => ipcRenderer.invoke("hh:restoreTask", taskId),
```

`packages/ui/test/fake-client.ts`:
- add `HistoryTaskView` to the type import list;
- after `restored: string[] = [];` add:

```ts
  /** What historyTasks answers: one task, newest first. */
  historyGroups: HistoryTaskView[] = [
    {
      taskId: "t1",
      actionId: null,
      start: "s0",
      end: "abc",
      date: "2026-10-10T12:00:00.000Z",
      changes: [{ path: "notes.md", kind: "modified" }],
      entries: [{ sha: "abc", message: "Turn: hi", date: "2026-10-10T12:00:00.000Z" }],
    },
  ];
  /** Tasks restoreTask was asked to go back before. */
  restoredTasks: string[] = [];
```

- after the `restore` method add:

```ts
  async historyTasks() {
    return this.historyGroups;
  }
  async restoreTask(taskId: string) {
    if (this.restoreError) throw this.restoreError;
    this.restoredTasks.push(taskId);
  }
```

- [ ] **Step 6: Typecheck, full tests, build, commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm app:build`
Expected: all green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-core add packages/shell/src/main/history-view.ts packages/shell/test/history-view.test.ts packages/ui/src/client.ts packages/shell/src/main/index.ts packages/shell/src/preload/index.ts packages/ui/test/fake-client.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-core commit -m "feat(shell): history task groups and going back to before a task over IPC" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019d45XaZQ8kSgiVYs5kCgGp"
```

### Task 6: The History panel, by task

**Files:**
- Modify: `packages/ui/src/HistoryPanel.tsx` (rewrite), `packages/ui/src/ChatView.tsx`, `packages/ui/src/styles.css`, `packages/i18n/src/locales/en.json`, `packages/i18n/src/locales/es.json`, `packages/ui/src/client.ts`, `packages/shell/src/main/index.ts`, `packages/shell/src/preload/index.ts`, `packages/ui/test/fake-client.ts`, `packages/ui/test/HarnessApp.test.tsx`
- Create: `packages/ui/test/history-panel.test.tsx`

- [ ] **Step 1: Add the strings**

In `packages/i18n/src/locales/en.json`, inside `"history"`, after `"restoreFailed"` add:

```json
    "restoreTask": "Go back to before this task",
    "confirmTask": "Go back to before this task? Everything it changed in your files will be undone.",
    "earlier": "Earlier",
    "question": "A question",
    "filesChanged_one": "{{count}} file changed",
    "filesChanged_other": "{{count}} files changed",
    "changedFiles": "Changed files",
    "change": { "added": "Added", "modified": "Changed", "deleted": "Deleted" },
    "entry": {
      "start": "Started",
      "before": "Before your message",
      "turn": "The AI finished",
      "stopped": "Stopped",
      "undo": "The AI didn't finish, so its changes were undone",
      "restored": "You went back to an earlier point",
      "restoredTask": "You went back to before this task",
      "note": "Note saved: {{title}}"
    }
```

In `packages/i18n/src/locales/es.json`, inside `"history"`, after `"restoreFailed"` add:

```json
    "restoreTask": "Volver a antes de esta tarea",
    "confirmTask": "¿Volver a antes de esta tarea? Se deshace todo lo que cambió en tus archivos.",
    "earlier": "Antes",
    "question": "Una pregunta",
    "filesChanged_one": "{{count}} archivo cambiado",
    "filesChanged_other": "{{count}} archivos cambiados",
    "changedFiles": "Archivos cambiados",
    "change": { "added": "Nuevo", "modified": "Cambiado", "deleted": "Borrado" },
    "entry": {
      "start": "Inicio",
      "before": "Antes de tu mensaje",
      "turn": "La IA terminó",
      "stopped": "Se detuvo",
      "undo": "La IA no terminó, así que se deshicieron sus cambios",
      "restored": "Volviste a un punto anterior",
      "restoredTask": "Volviste a antes de esta tarea",
      "note": "Resumen guardado: {{title}}"
    }
```

- [ ] **Step 2: Write the failing tests**

`packages/ui/test/history-panel.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HistoryTaskView } from "../src/client";
import { HistoryPanel, entryLabel } from "../src/HistoryPanel";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const actions = { plan: { label: { es: "Planear la semana", en: "Plan the week" }, cost: "medium" as const } };
const date = "2026-10-13T10:00:00.000Z";
const groups: HistoryTaskView[] = [
  {
    taskId: "t2",
    actionId: "plan",
    start: "s1",
    end: "e2",
    date,
    noteTitle: "The week",
    changes: [
      { path: "old.md", kind: "deleted" },
      { path: "plan.md", kind: "modified" },
    ],
    entries: [
      { sha: "e2", message: "Note: The week", date },
      { sha: "m2", message: "Turn: plan it", date },
      { sha: "b2", message: "Before message", date },
    ],
  },
  { taskId: "t1", actionId: null, start: "s0", end: "e1", date, changes: [{ path: "q.md", kind: "added" }], entries: [{ sha: "e1", message: "Went back to before the task", date }] },
  { taskId: null, actionId: null, start: null, end: "s0", date, changes: [], entries: [{ sha: "s0", message: "Start", date }] },
];

async function open(opts: { disabled?: boolean; language?: "en" | "es" } = {}) {
  const client = new FakeClient();
  client.historyGroups = groups;
  const onRestored = vi.fn();
  const onClose = vi.fn();
  const lang = opts.language ?? "en";
  await renderIn(lang, <HistoryPanel client={client} actions={actions} lang={lang} disabled={opts.disabled} onClose={onClose} onRestored={onRestored} />);
  return { client, onRestored, onClose };
}

describe("HistoryPanel", () => {
  it("shows one row per task with its action, note, date and files changed; the newest starts open", async () => {
    await open();
    const newest = await screen.findByRole("button", { name: /Plan the week.*The week.*2 files changed/ });
    expect(newest.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: /A question.*1 file changed/ }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: /Earlier.*0 files changed/ }).getAttribute("aria-expanded")).toBe("false");
    const files = screen.getByRole("list", { name: "Changed files" });
    expect(within(files).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Deletedold.md", "Changedplan.md"]);
    expect(screen.getByText("Note saved: The week")).toBeTruthy();
    expect(screen.getByText("The AI finished")).toBeTruthy();
    expect(screen.getByText("Before your message")).toBeTruthy();
  });

  it("opens a row on click and shows its entries in plain language", async () => {
    await open();
    fireEvent.click(await screen.findByRole("button", { name: /A question/ }));
    expect(screen.getByText("You went back to before this task")).toBeTruthy();
  });

  it("goes back to before a task after a confirmation", async () => {
    const { client, onRestored, onClose } = await open();
    fireEvent.click(await screen.findByRole("button", { name: "Go back to before this task" }));
    expect(screen.getByText("Go back to before this task? Everything it changed in your files will be undone.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Yes, go back" }));
    await waitFor(() => expect(client.restoredTasks).toEqual(["t2"]));
    expect(onRestored).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("goes back to one point", async () => {
    const { client } = await open();
    fireEvent.click((await screen.findAllByRole("button", { name: "Go back to this point" }))[1]);
    fireEvent.click(screen.getByRole("button", { name: "Yes, go back" }));
    await waitFor(() => expect(client.restored).toEqual(["m2"]));
  });

  it("disables both kinds of going back while a turn is live", async () => {
    await open({ disabled: true });
    expect(((await screen.findByRole("button", { name: "Go back to before this task" })) as HTMLButtonElement).disabled).toBe(true);
    for (const b of screen.getAllByRole("button", { name: "Go back to this point" })) expect((b as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers no 'before this task' for the Earlier group", async () => {
    await open();
    fireEvent.click(await screen.findByRole("button", { name: /Earlier/ }));
    expect(screen.getByText("Started")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Go back to before this task" })).toHaveLength(1);
  });

  it("speaks Spanish", async () => {
    await open({ language: "es" });
    expect(await screen.findByRole("button", { name: /Planear la semana.*2 archivos cambiados/ })).toBeTruthy();
    expect(screen.getByText("Resumen guardado: The week")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Volver a antes de esta tarea" })).toBeTruthy();
  });

  it("keeps an unknown subject as it is", () => {
    expect(entryLabel("Something else")).toBeNull();
    expect(entryLabel("Note: A title")).toEqual({ key: "history.entry.note", values: { title: "A title" } });
    expect(entryLabel("Stopped: hi")).toEqual({ key: "history.entry.stopped" });
  });
});
```

In `packages/ui/test/HarnessApp.test.tsx`, replace every `await screen.findByText("Turn: hi");` with `await screen.findByText("The AI finished");` (three tests: "lists history and restores a point", "tells the user when going back failed", "disables restore while a turn is live, …"). Nothing else changes there: the fake client's one task starts open, so "Go back to this point" is on screen.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `corepack pnpm vitest run packages/ui/test/history-panel.test.tsx packages/ui/test/HarnessApp.test.tsx`
Expected: FAIL — `entryLabel` is not exported; the panel lists raw subjects.

- [ ] **Step 4: Rewrite the panel**

`packages/ui/src/HistoryPanel.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Language } from "@humanharness/harness-sdk";
import type { ActionOption, HarnessClient, HistoryItem, HistoryTaskView } from "./client";

/** The i18n key (and its values) that tells a history entry in plain language; null keeps the commit subject. */
export function entryLabel(message: string): { key: string; values?: Record<string, string> } | null {
  if (message === "Start") return { key: "history.entry.start" };
  if (message === "Before message") return { key: "history.entry.before" };
  if (message.startsWith("Turn: ")) return { key: "history.entry.turn" };
  if (message.startsWith("Stopped: ")) return { key: "history.entry.stopped" };
  if (message.startsWith("Undo: ")) return { key: "history.entry.undo" };
  if (message === "Went back to before the task") return { key: "history.entry.restoredTask" };
  if (message === "Went back to an earlier point") return { key: "history.entry.restored" };
  const note = /^Note: (.+)$/.exec(message);
  if (note) return { key: "history.entry.note", values: { title: note[1] } };
  return null;
}

const keyOf = (g: HistoryTaskView) => g.taskId ?? "earlier";

type Restore = { kind: "task" | "point"; id: string };

/** History (spec 3d §1): one row per task, with the files it changed, its entries and both ways back. */
export function HistoryPanel({
  client,
  actions,
  lang,
  onClose,
  onRestored,
  disabled = false,
}: {
  client: HarnessClient;
  /** The harness's actions: a task's row shows its action's label. */
  actions: Record<string, ActionOption>;
  lang: Language;
  onClose: () => void;
  /** Called after a restore succeeded, before the panel closes. */
  onRestored?: () => void;
  /** Going back is not allowed while a turn is live. */
  disabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [groups, setGroups] = useState<HistoryTaskView[] | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState<Restore | null>(null);
  const [failed, setFailed] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  /** What had focus when the panel opened: it gets focus back when the panel closes. */
  const opener = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Reads only refs, so the Escape listener added on the first render can call it.
  const close = () => {
    const back = opener.current;
    onCloseRef.current();
    if (back?.isConnected) back.focus();
  };
  useEffect(() => {
    client.historyTasks().then(
      (g) => {
        setGroups(g);
        // The newest task starts open: it is what the person most likely wants to undo.
        if (g[0]) setOpen(new Set([keyOf(g[0])]));
      },
      () => setGroups([]),
    );
  }, [client]);
  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // A dialog above it (the pre-flight question) handled this Escape itself.
      if (e.key === "Escape" && !e.defaultPrevented) close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const restore = (r: Restore) => {
    setFailed(false);
    (r.kind === "task" ? client.restoreTask(r.id) : client.restore(r.id)).then(
      () => {
        onRestored?.();
        close();
      },
      () => {
        setConfirming(null);
        setFailed(true);
      },
    );
  };

  /** The button, or its confirmation while it waits for a yes. */
  const goBack = (r: Restore, label: string) =>
    confirming?.kind === r.kind && confirming.id === r.id && !disabled ? (
      <div className="hh-confirm">
        <p>{t(r.kind === "task" ? "history.confirmTask" : "history.confirm")}</p>
        <button onClick={() => restore(r)}>{t("history.confirmYes")}</button>
        <button onClick={() => setConfirming(null)}>{t("history.cancel")}</button>
      </div>
    ) : (
      <button disabled={disabled} onClick={() => setConfirming(r)}>
        {label}
      </button>
    );

  const rowLabel = (g: HistoryTaskView) =>
    g.taskId === null ? t("history.earlier") : g.actionId && actions[g.actionId] ? actions[g.actionId].label[lang] : t("history.question");
  const entryText = (e: HistoryItem) => {
    const label = entryLabel(e.message);
    return label ? t(label.key, label.values ?? {}) : e.message;
  };
  const when = (iso: string) => new Date(iso).toLocaleString(i18n.language);

  return (
    <aside className="hh-history" role="dialog" aria-modal="true" aria-label={t("history.title")}>
      <header>
        <h2>{t("history.title")}</h2>
        <button ref={closeRef} onClick={close}>
          {t("history.close")}
        </button>
      </header>
      {failed && <p role="alert">{t("history.restoreFailed")}</p>}
      {groups?.length === 0 && <p>{t("history.empty")}</p>}
      <ol className="hh-history-tasks">
        {groups?.map((g) => {
          const key = keyOf(g);
          const expanded = open.has(key);
          const bodyId = `hh-history-${key}`;
          return (
            <li key={key}>
              <button className="hh-history-row" aria-expanded={expanded} aria-controls={bodyId} onClick={() => toggle(key)}>
                <span className="hh-history-label">{rowLabel(g)}</span>
                {g.noteTitle && <span>{g.noteTitle}</span>}
                <time dateTime={g.date}>{when(g.date)}</time>
                <span className="hh-caption">{t("history.filesChanged", { count: g.changes.length })}</span>
              </button>
              {expanded && (
                <div id={bodyId} className="hh-history-body">
                  {g.changes.length > 0 && (
                    <ul className="hh-history-files" aria-label={t("history.changedFiles")}>
                      {g.changes.map((c) => (
                        <li key={c.path}>
                          <span className={`hh-change ${c.kind}`}>{t(`history.change.${c.kind}`)}</span>
                          <code>{c.path}</code>
                        </li>
                      ))}
                    </ul>
                  )}
                  {g.taskId !== null && g.start !== null && goBack({ kind: "task", id: g.taskId }, t("history.restoreTask"))}
                  <ol className="hh-history-entries">
                    {g.entries.map((e) => (
                      <li key={e.sha}>
                        <span>{entryText(e)}</span>
                        <time dateTime={e.date}>{when(e.date)}</time>
                        {goBack({ kind: "point", id: e.sha }, t("history.restore"))}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
```

In `packages/ui/src/ChatView.tsx`, replace the `<HistoryPanel` opening props:

```tsx
        <HistoryPanel
          client={client}
          actions={state.actions}
          lang={lang}
          disabled={Boolean(chat.live) || closing || checkpoint}
```

(the `onClose` and `onRestored` props stay as they are).

In `packages/ui/src/styles.css`, after the `.hh-history time` rule add:

```css
.hh-history-tasks, .hh-history-entries, .hh-history-files { list-style: none; margin: 0; padding: 0; }
.hh-history-row { width: 100%; height: auto; display: grid; justify-items: start; gap: 2px; padding: 8px 10px; text-align: left; }
.hh-history-label { font-weight: 600; }
.hh-history-body { display: grid; gap: 8px; padding: 6px 10px 0; }
.hh-history .hh-history-files li { display: flex; align-items: baseline; gap: 8px; margin: 0; }
.hh-change { flex: none; font-size: 12px; color: var(--hh-muted); }
.hh-change.added { color: var(--hh-ok); }
.hh-change.deleted { color: var(--hh-warn); }
```

- [ ] **Step 5: Drop the flat history call**

- `packages/ui/src/client.ts`: delete `history(): Promise<HistoryItem[]>;` from `HarnessClient` (`HistoryItem` stays: it is the entry type).
- `packages/shell/src/preload/index.ts`: delete `history: () => ipcRenderer.invoke("hh:history"),`.
- `packages/shell/src/main/index.ts`: delete the `handle("hh:history", …)` registration.
- `packages/ui/test/fake-client.ts`: delete the `items` field and the `history()` method.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/ui/test/history-panel.test.tsx packages/ui/test/HarnessApp.test.tsx packages/ui/test/flow.test.tsx packages/i18n/test/i18n.test.ts`
Expected: PASS

- [ ] **Step 7: Typecheck, full tests, build, commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm app:build`
Expected: all green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-core add packages/ui/src/HistoryPanel.tsx packages/ui/src/ChatView.tsx packages/ui/src/styles.css packages/ui/src/client.ts packages/i18n/src/locales/en.json packages/i18n/src/locales/es.json packages/shell/src/main/index.ts packages/shell/src/preload/index.ts packages/ui/test/fake-client.ts packages/ui/test/HarnessApp.test.tsx packages/ui/test/history-panel.test.tsx
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-core commit -m "feat(ui): history panel by task, with changed files and going back to before a task" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019d45XaZQ8kSgiVYs5kCgGp"
```

---

## Phase 2 — Backup status

### Task 7: `syncStatus` and `syncLocations` (paths and `.git/config` only)

**Files:**
- Create: `packages/workspace/src/backup.ts`, `packages/workspace/test/backup.test.ts`
- Modify: `packages/workspace/src/index.ts`

- [ ] **Step 1: Write the failing tests**

`packages/workspace/test/backup.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { cloudProvider, hasRemote, providerOf, syncLocations, syncStatus } from "../src";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hh-")));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());

/** A fake home folder with these directories. */
function home(...dirs: string[]): string {
  const h = fs.mkdtempSync(path.join(root, "home-"));
  for (const d of dirs) fs.mkdirSync(path.join(h, d), { recursive: true });
  return h;
}
const gitConfig = (dir: string, text: string) => {
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".git", "config"), text);
};
const REMOTE = '[core]\n\tbare = false\n[remote "origin"]\n\turl = git@example.com:me/work.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n';

describe("providerOf", () => {
  const h = "/Users/ana";
  it("knows the synced roots by their path", () => {
    expect(providerOf("/Users/ana/Library/CloudStorage/GoogleDrive-ana@example.com/My Drive/Demo", h)).toBe("google-drive");
    expect(providerOf("/Users/ana/Library/CloudStorage/OneDrive-Personal/Demo", h)).toBe("onedrive");
    expect(providerOf("/Users/ana/Library/CloudStorage/Dropbox/Demo", h)).toBe("dropbox");
    expect(providerOf("/Users/ana/Dropbox/Demo", h)).toBe("dropbox");
    expect(providerOf("/Users/ana/Library/Mobile Documents/com~apple~CloudDocs/Demo", h)).toBe("icloud");
    expect(providerOf("/users/ANA/library/cloudstorage/googledrive-x/My Drive/Demo", h)).toBe("google-drive");
  });

  it("counts everything else as not synced, ~/Documents included (spike, Task 0)", () => {
    expect(providerOf("/Users/ana/Documents/Demo", h)).toBeNull();
    expect(providerOf("/Users/ana/Library/CloudStorage/Box-Box/Demo", h)).toBeNull();
    expect(providerOf("/Users/ana/Library/Mobile Documents/com~apple~CloudDocs", h)).toBeNull();
    expect(providerOf("/Volumes/Disk/Demo", h)).toBeNull();
  });

  it("reads provider folder names", () => {
    expect(cloudProvider("GoogleDrive-ana@example.com")).toBe("google-drive");
    expect(cloudProvider("OneDrive-Personal")).toBe("onedrive");
    expect(cloudProvider("OneDrive")).toBe("onedrive");
    expect(cloudProvider("Dropbox-Team")).toBe("dropbox");
    expect(cloudProvider("Box-Box")).toBeNull();
  });
});

describe("hasRemote", () => {
  it("needs a remote section with a url", () => {
    expect(hasRemote(REMOTE)).toBe(true);
    expect(hasRemote('[Remote "o"]\nurl=https://example.com/x.git\n')).toBe(true);
    expect(hasRemote('[remote "origin"]\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n')).toBe(false);
    expect(hasRemote('[remote "origin"]\n[branch "main"]\n\turl = nope\n')).toBe(false);
    expect(hasRemote('# [remote "origin"]\n; url = x\n[core]\n')).toBe(false);
    expect(hasRemote("")).toBe(false);
  });
});

describe("syncStatus", () => {
  it("synced: under a provider's root", async () => {
    const h = home("Library/CloudStorage/GoogleDrive-ana@example.com/My Drive/Demo");
    expect(await syncStatus(path.join(h, "Library/CloudStorage/GoogleDrive-ana@example.com/My Drive/Demo"), h)).toEqual({ kind: "synced", provider: "google-drive" });
  });

  it("git-remote: the folder or a folder above it has a remote", async () => {
    const h = home("Work/Repo/Demo", "Other/Demo");
    gitConfig(path.join(h, "Work/Repo"), REMOTE);
    expect(await syncStatus(path.join(h, "Work/Repo/Demo"), h)).toEqual({ kind: "git-remote" });
    gitConfig(path.join(h, "Other/Demo"), "[core]\n\tbare = false\n");
    expect(await syncStatus(path.join(h, "Other/Demo"), h)).toEqual({ kind: "local" });
  });

  it("local: a dotfiles repository in the home folder doesn't back the folder up", async () => {
    const h = home("Documents/Demo");
    gitConfig(h, REMOTE);
    expect(await syncStatus(path.join(h, "Documents/Demo"), h)).toEqual({ kind: "local" });
  });

  it("reads nothing but .git/config files", async () => {
    const h = home("Documents/Demo", ".claude");
    fs.writeFileSync(path.join(h, ".claude", "secret.json"), "{}");
    const read = vi.spyOn(fs.promises, "readFile");
    await syncStatus(path.join(h, "Documents/Demo"), h);
    await syncLocations(h);
    for (const [file] of read.mock.calls) expect(String(file)).toMatch(/\/\.git\/config$/);
  });
});

describe("syncLocations", () => {
  it("lists the synced places on this computer, by folder names only", async () => {
    const h = home(
      "Library/CloudStorage/GoogleDrive-ana@example.com/My Drive",
      "Library/CloudStorage/GoogleDrive-work@example.com/Shared drives",
      "Library/CloudStorage/OneDrive-Personal",
      "Library/CloudStorage/Dropbox",
      "Library/CloudStorage/Box-Box",
      "Library/Mobile Documents/com~apple~CloudDocs",
    );
    expect(await syncLocations(h)).toEqual([
      { provider: "dropbox", path: path.join(h, "Library/CloudStorage/Dropbox") },
      { provider: "google-drive", path: path.join(h, "Library/CloudStorage/GoogleDrive-ana@example.com/My Drive") },
      { provider: "onedrive", path: path.join(h, "Library/CloudStorage/OneDrive-Personal") },
      { provider: "icloud", path: path.join(h, "Library/Mobile Documents/com~apple~CloudDocs") },
    ]);
  });

  it("finds Google Drive's Spanish folder and the old ~/Dropbox", async () => {
    const h = home("Library/CloudStorage/GoogleDrive-ana@example.com/Mi unidad", "Dropbox");
    expect(await syncLocations(h)).toEqual([
      { provider: "google-drive", path: path.join(h, "Library/CloudStorage/GoogleDrive-ana@example.com/Mi unidad") },
      { provider: "dropbox", path: path.join(h, "Dropbox") },
    ]);
  });

  it("is empty when nothing syncs", async () => {
    expect(await syncLocations(home("Documents"))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run packages/workspace/test/backup.test.ts`
Expected: FAIL — the exports don't exist.

- [ ] **Step 3: Implement**

`packages/workspace/src/backup.ts`:

```ts
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Backup status of the person's folder (spec 3d §2). Compliance: this module reads only paths (folder names
 * under ~/Library/CloudStorage, whether the iCloud Drive and ~/Dropbox folders exist, realpath) and
 * `.git/config` files. It never reads account, token or credential files, nor a provider's own settings.
 */

export type SyncProvider = "google-drive" | "onedrive" | "dropbox" | "icloud";
export type SyncStatus = { kind: "synced"; provider: SyncProvider } | { kind: "git-remote" } | { kind: "local" };

/** A synced place on this computer where a folder can live. */
export interface SyncLocation {
  provider: SyncProvider;
  path: string;
}

const ICLOUD = ["Library", "Mobile Documents", "com~apple~CloudDocs"];
const CLOUD_STORAGE = ["Library", "CloudStorage"];
/** Google Drive keeps the person's files in this folder of its drive (its top level only holds "My Drive", "Shared drives"…). */
const GOOGLE_MY_DRIVE = ["My Drive", "Mi unidad"];

// macOS file systems are usually case-insensitive: compare without case.
const lower = (p: string) => path.resolve(p).toLowerCase();
/** `child` is strictly inside `parent`. */
const strictlyInside = (child: string, parent: string) => lower(child).startsWith(lower(parent) + path.sep);
const isDir = (p: string) => fs.stat(p).then((s) => s.isDirectory(), () => false);

/** The provider of a folder name under ~/Library/CloudStorage. */
export function cloudProvider(name: string): SyncProvider | null {
  if (/^GoogleDrive-/i.test(name)) return "google-drive";
  if (/^OneDrive(-|$)/i.test(name)) return "onedrive";
  if (/^Dropbox(-|$)/i.test(name)) return "dropbox";
  return null;
}

/** The synced provider `folder` is in, judged by its path alone. */
export function providerOf(folder: string, home: string): SyncProvider | null {
  if (strictlyInside(folder, path.join(home, ...ICLOUD))) return "icloud";
  if (strictlyInside(folder, path.join(home, "Dropbox"))) return "dropbox";
  const cloud = path.join(home, ...CLOUD_STORAGE);
  if (!strictlyInside(folder, cloud)) return null;
  return cloudProvider(path.relative(lower(cloud), lower(folder)).split(path.sep)[0]);
}

/** Whether a git config has a `[remote "…"]` section with a `url`. */
export function hasRemote(config: string): boolean {
  let inRemote = false;
  for (const raw of config.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const section = /^\[\s*([A-Za-z0-9.-]+)(\s+"[^"]*")?\s*\]/.exec(line);
    if (section) {
      inRemote = section[1].toLowerCase() === "remote" && section[2] !== undefined;
      continue;
    }
    if (inRemote && /^url\s*=\s*\S/i.test(line)) return true;
  }
  return false;
}

/**
 * Whether `folder`, or a folder above it, is a git repository with a remote. Reads only `<dir>/.git/config`,
 * and stops below the home folder: a dotfiles repository there doesn't back the folder up.
 */
export async function hasGitRemote(folder: string, home: string): Promise<boolean> {
  let dir = path.resolve(folder);
  for (;;) {
    if (lower(dir) === lower(home)) return false;
    const config = await fs.readFile(path.join(dir, ".git", "config"), "utf8").catch(() => null);
    if (config !== null) return hasRemote(config);
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/** How the folder is protected against losing the computer: a synced drive, a git remote, or nothing. */
export async function syncStatus(folder: string, home: string = os.homedir()): Promise<SyncStatus> {
  const real = await fs.realpath(folder).catch(() => folder);
  const provider = providerOf(real, home) ?? providerOf(folder, home);
  if (provider) return { kind: "synced", provider };
  return (await hasGitRemote(real, home)) ? { kind: "git-remote" } : { kind: "local" };
}

/** The synced places on this computer, found by folder names only. */
export async function syncLocations(home: string = os.homedir()): Promise<SyncLocation[]> {
  const found: SyncLocation[] = [];
  const cloud = path.join(home, ...CLOUD_STORAGE);
  const names = (await fs.readdir(cloud).catch(() => [] as string[])).sort();
  for (const name of names) {
    const provider = cloudProvider(name);
    const root = path.join(cloud, name);
    if (!provider || !(await isDir(root))) continue;
    if (provider !== "google-drive") {
      found.push({ provider, path: root });
      continue;
    }
    for (const mine of GOOGLE_MY_DRIVE) {
      if (await isDir(path.join(root, mine))) {
        found.push({ provider, path: path.join(root, mine) });
        break;
      }
    }
  }
  const dropbox = path.join(home, "Dropbox");
  if (!found.some((l) => l.provider === "dropbox") && (await isDir(dropbox))) found.push({ provider: "dropbox", path: dropbox });
  const icloud = path.join(home, ...ICLOUD);
  if (await isDir(icloud)) found.push({ provider: "icloud", path: icloud });
  return found;
}
```

In `packages/workspace/src/index.ts` add `export * from "./backup";`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/workspace/test/backup.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck, full tests, commit**

Run: `corepack pnpm typecheck` then `corepack pnpm test`
Expected: both green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-core add packages/workspace/src/backup.ts packages/workspace/src/index.ts packages/workspace/test/backup.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-core commit -m "feat(workspace): backup status and synced places from paths only" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019d45XaZQ8kSgiVYs5kCgGp"
```

### Task 8: `backupDismissed`, `replaceFolder` and `AppState.backup`

**Files:**
- Modify: `packages/ui/src/client.ts`, `packages/shell/src/main/validate.ts`, `packages/shell/src/main/config.ts`, `packages/shell/src/main/index.ts`
- Test: `packages/shell/test/validate.test.ts`, `packages/shell/test/config.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/shell/test/validate.test.ts`, inside `describe("configProblem", …)`:

```ts
  it("accepts backupDismissed only as a boolean", async () => {
    expect(await configProblem({ backupDismissed: true }, ctx)).toBeNull();
    expect(await configProblem({ backupDismissed: false }, ctx)).toBeNull();
    expect(await configProblem({ backupDismissed: "yes" as never }, ctx)).toBe("invalid");
  });
```

In `packages/shell/test/config.test.ts`, inside `describe("ConfigStore", …)`:

```ts
  it("replaces the folder only through replaceFolder, keeping everything else", async () => {
    const dir = fs.mkdtempSync(path.join(root, "c-"));
    const store = new ConfigStore(dir);
    await store.save({ folder: "/first", language: "es", backupDismissed: true });
    expect(await store.replaceFolder("/second")).toEqual({ folder: "/second", language: "es", backupDismissed: true });
    expect(await new ConfigStore(dir).load()).toEqual({ folder: "/second", language: "es", backupDismissed: true });
    await store.save({ folder: "/third" });
    expect((await store.load()).folder).toBe("/second");
    expect(fs.readdirSync(dir)).toEqual(["config.json"]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run packages/shell/test/validate.test.ts packages/shell/test/config.test.ts`
Expected: FAIL — `backupDismissed` is not in `AppConfig`; `replaceFolder` doesn't exist.

- [ ] **Step 3: Implement**

`packages/ui/src/client.ts`:
- in `AppConfig`, after `models?`:
  ```ts
  /** The person said they keep their own copy of the folder: the backup notice stays hidden (Settings › General undoes it). */
  backupDismissed?: boolean;
  ```
- after `ReferenceView` add:
  ```ts
  /** A synced drive (spec 3d §2). */
  export type SyncProvider = "google-drive" | "onedrive" | "dropbox" | "icloud";
  /** How the folder is kept if the computer is lost. */
  export type SyncStatus = { kind: "synced"; provider: SyncProvider } | { kind: "git-remote" } | { kind: "local" };
  /** A synced place on this computer, and the harness's folder inside it. */
  export interface SyncLocationView {
    provider: SyncProvider;
    path: string;
    /** `<path>/<the harness's suggested folder name>`: what the first-launch step offers. */
    suggested: string;
  }
  ```
- in `AppState`, after `models?`:
  ```ts
  /** The configured folder's backup status (null before a folder is chosen) and the synced places. */
  backup?: { status: SyncStatus | null; locations: SyncLocationView[] };
  ```

`packages/shell/src/main/validate.ts` — in `configProblem`, after the `models` check:

```ts
  if (c.backupDismissed !== undefined && typeof c.backupDismissed !== "boolean") return "invalid";
```

`packages/shell/src/main/config.ts` — replace `saveNow` with `saveNow` plus `replaceFolder` and `write`:

```ts
  private async saveNow(patch: AppConfig): Promise<AppConfig> {
    const current = await this.load();
    return this.write({ ...current, ...patch, ...(current.folder ? { folder: current.folder } : {}) });
  }

  /** Moving the folder (moveFolder) is the one way the fixed folder changes; queued with the other saves. */
  replaceFolder(folder: string): Promise<AppConfig> {
    const run = this.queue.then(async () => this.write({ ...(await this.load()), folder }));
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Atomic: temp file + rename. */
  private async write(next: AppConfig): Promise<AppConfig> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify(next, null, 2));
      await fs.rename(tmp, this.file);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
    return next;
  }
```

`packages/shell/src/main/index.ts`:
- extend the workspace import: `import { History, NOTES_PREFIX, readNotes, syncLocations, syncStatus, writeNote } from "@humanharness/workspace";`
- add above `appState`:

```ts
/** The folder's backup status and the synced places, each with the harness's folder name inside. Paths only (backup.ts). */
async function backupView(folder: string | undefined): Promise<NonNullable<AppState["backup"]>> {
  const home = os.homedir();
  const name = path.basename(harness.folder.suggested);
  try {
    const [status, locations] = await Promise.all([folder ? syncStatus(folder, home) : Promise.resolve(null), syncLocations(home)]);
    return { status, locations: locations.map((l) => ({ ...l, suggested: path.join(l.path, name) })) };
  } catch (err) {
    console.error("Could not read the backup status", err);
    return { status: null, locations: [] };
  }
}
```

- in `appState()`, after `models: await modelsView(),` add `backup: await backupView(saved.folder),`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/shell/test/validate.test.ts packages/shell/test/config.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck, full tests, build, commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm app:build`
Expected: all green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-core add packages/ui/src/client.ts packages/shell/src/main/validate.ts packages/shell/src/main/config.ts packages/shell/src/main/index.ts packages/shell/test/validate.test.ts packages/shell/test/config.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-core commit -m "feat(shell): backup status in the app state, backupDismissed and replaceFolder" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019d45XaZQ8kSgiVYs5kCgGp"
```

### Task 9: The first-launch step offers synced places first

**Files:**
- Modify: `packages/ui/src/FolderStep.tsx`, `packages/ui/src/styles.css`, `packages/i18n/src/locales/en.json`, `packages/i18n/src/locales/es.json`
- Create: `packages/ui/test/folder-step.test.tsx`

- [ ] **Step 1: Add the strings**

In `packages/i18n/src/locales/en.json`, add a top-level section after `"history"` (before `"app"`):

```json
  "backup": {
    "placesLabel": "Where to keep your work",
    "saveIn": "Save it in {{provider}} so you don't lose it",
    "thisComputer": "Only on this computer",
    "placesHint": "A synced folder keeps a copy in the cloud: if something happens to this computer, your work is still there.",
    "provider": { "google-drive": "Google Drive", "onedrive": "OneDrive", "dropbox": "Dropbox", "icloud": "iCloud Drive" }
  },
```

In `packages/i18n/src/locales/es.json`, the same place:

```json
  "backup": {
    "placesLabel": "Dónde guardar tu trabajo",
    "saveIn": "Guardarlo en {{provider}} para no perderlo",
    "thisComputer": "Solo en esta compu",
    "placesHint": "Una carpeta sincronizada guarda una copia en la nube: si le pasa algo a esta compu, tu trabajo sigue ahí.",
    "provider": { "google-drive": "Google Drive", "onedrive": "OneDrive", "dropbox": "Dropbox", "icloud": "iCloud Drive" }
  },
```

- [ ] **Step 2: Write the failing tests**

`packages/ui/test/folder-step.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FolderStep } from "../src/FolderStep";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const drive = "/Users/me/Library/CloudStorage/GoogleDrive-me@example.com/My Drive";
const icloud = "/Users/me/Library/Mobile Documents/com~apple~CloudDocs";

function withPlaces() {
  const client = new FakeClient();
  client.state.backup = {
    status: null,
    locations: [
      { provider: "google-drive", path: drive, suggested: `${drive}/Demo` },
      { provider: "icloud", path: icloud, suggested: `${icloud}/Demo` },
    ],
  };
  return client;
}

describe("FolderStep", () => {
  it("offers the synced places first and starts on the first one", async () => {
    const client = withPlaces();
    const onSaved = vi.fn();
    await renderIn("en", <FolderStep client={client} state={client.state} onSaved={onSaved} />);
    const places = screen.getByRole("group", { name: "Where to keep your work" });
    expect(places.textContent).toContain("Save it in Google Drive so you don't lose it");
    expect(screen.getByRole("button", { name: "Save it in Google Drive so you don't lose it" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(`${drive}/Demo`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use this folder" }));
    await waitFor(() => expect(client.state.config.folder).toBe(`${drive}/Demo`));
  });

  it("lets the person pick iCloud, this computer only, or any other folder", async () => {
    const client = withPlaces();
    await renderIn("en", <FolderStep client={client} state={client.state} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Save it in iCloud Drive so you don't lose it" }));
    expect(screen.getByText(`${icloud}/Demo`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Only on this computer" }));
    expect(screen.getByText("/Users/me/Documents/Demo")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Choose another folder" }));
    expect(await screen.findByText("/Users/me/Elsewhere")).toBeTruthy();
  });

  it("shows no places when nothing syncs on this computer", async () => {
    const client = new FakeClient();
    await renderIn("es", <FolderStep client={client} state={client.state} onSaved={() => {}} />);
    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.getByText("/Users/me/Documents/Demo")).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `corepack pnpm vitest run packages/ui/test/folder-step.test.tsx`
Expected: FAIL — no "Where to keep your work" group.

- [ ] **Step 4: Implement**

In `packages/ui/src/FolderStep.tsx`, inside `FolderStep`:
- replace `const [folder, setFolder] = useState(state.suggestedFolder);` with:
  ```tsx
  const locations = state.backup?.locations ?? [];
  // A synced place comes first (spec 3d §2): the folder survives losing the computer.
  const [folder, setFolder] = useState(locations[0]?.suggested ?? state.suggestedFolder);
  const choose = (next: string) => {
    setFolder(next);
    setProblem(null);
  };
  ```
- in the JSX, between the `folderHint` caption and `<div className="hh-rows">`, add:
  ```tsx
      {locations.length > 0 && (
        <>
          <div className="hh-places" role="group" aria-label={t("backup.placesLabel")}>
            {locations.map((l) => (
              <button key={l.path} type="button" aria-pressed={folder === l.suggested} onClick={() => choose(l.suggested)}>
                {t("backup.saveIn", { provider: t(`backup.provider.${l.provider}`) })}
              </button>
            ))}
            <button type="button" aria-pressed={folder === state.suggestedFolder} onClick={() => choose(state.suggestedFolder)}>
              {t("backup.thisComputer")}
            </button>
          </div>
          <p className="hh-caption">{t("backup.placesHint")}</p>
        </>
      )}
  ```

In `packages/ui/src/styles.css`, after the `.hh-onboarding pre` rule:

```css
.hh-places { display: grid; gap: 6px; width: 100%; }
.hh-places button { justify-content: flex-start; text-align: left; }
.hh-places button[aria-pressed="true"] { border-color: var(--hh-ink); font-weight: 600; }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/ui/test/folder-step.test.tsx packages/ui/test/settings.test.tsx packages/i18n/test/i18n.test.ts`
Expected: PASS

- [ ] **Step 6: Typecheck, full tests, build, commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm app:build`
Expected: all green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-core add packages/ui/src/FolderStep.tsx packages/ui/src/styles.css packages/i18n/src/locales/en.json packages/i18n/src/locales/es.json packages/ui/test/folder-step.test.tsx
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-core commit -m "feat(ui): first launch offers synced places for the folder" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019d45XaZQ8kSgiVYs5kCgGp"
```

---

## Phase 3 — Moving the folder

### Task 10: Notes keep in-folder paths relative

**Files:**
- Modify: `packages/workspace/src/notes.ts`
- Test: `packages/workspace/test/notes.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/workspace/test/notes.test.ts`, change the import to:

```ts
import { folderRelative, noteSlug, parseNote, readNotes, relativizeNoteFiles, renderNote, writeNote } from "../src";
```

and add:

```ts
describe("note files", () => {
  it("stores paths inside the folder relative to it", async () => {
    const folder = tmp();
    await writeNote(folder, "turn", { ...note, files: [path.join(folder, "plan", "week.md"), "/elsewhere/x.md", "rel.md"] }, meta);
    const [saved] = await readNotes(folder);
    expect(saved.files).toEqual(["plan/week.md", "/elsewhere/x.md", "rel.md"]);
  });

  it("makes paths into a folder relative and leaves everything else", () => {
    expect(folderRelative("/a/Work", "/a/Work/x/y.md")).toBe("x/y.md");
    expect(folderRelative("/a/Work", "/a/Workshop/y.md")).toBe("/a/Workshop/y.md");
    expect(folderRelative("/a/Work", "/a/Work")).toBe("/a/Work");
    expect(folderRelative("/a/Work", "y.md")).toBe("y.md");
  });

  it("rewrites only the files line of notes that name the old folder", async () => {
    const folder = tmp();
    const dir = path.join(folder, ".harness/notes");
    fs.mkdirSync(dir, { recursive: true });
    const old = "/Users/me/Documents/Work";
    fs.writeFileSync(path.join(dir, "a.md"), `---\ntitle: "A"\nfiles: ["${old}/plan.md", "/other/x.md"]\n---\n## Summary\n- ${old}/plan.md stays in the text\n`);
    fs.writeFileSync(path.join(dir, "b.md"), `---\ntitle: "B"\nfiles: ["plan.md"]\n---\n`);
    fs.writeFileSync(path.join(dir, "c.md"), "no front matter\n");
    expect(await relativizeNoteFiles(folder, old)).toBe(1);
    expect(fs.readFileSync(path.join(dir, "a.md"), "utf8")).toBe(
      `---\ntitle: "A"\nfiles: ["plan.md","/other/x.md"]\n---\n## Summary\n- ${old}/plan.md stays in the text\n`,
    );
    expect(fs.readFileSync(path.join(dir, "b.md"), "utf8")).toBe(`---\ntitle: "B"\nfiles: ["plan.md"]\n---\n`);
    expect(fs.readdirSync(dir).sort()).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("does nothing when there are no notes", async () => {
    expect(await relativizeNoteFiles(tmp(), "/old")).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run packages/workspace/test/notes.test.ts`
Expected: FAIL — `folderRelative` and `relativizeNoteFiles` don't exist.

- [ ] **Step 3: Implement**

In `packages/workspace/src/notes.ts`, before `writeNote` add:

```ts
/** A path inside `folder`, made relative to it (forward slashes); anything else stays as given. */
export function folderRelative(folder: string, file: string): string {
  if (!path.isAbsolute(file)) return file;
  const rel = path.relative(folder, file);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel.split(path.sep).join("/") : file;
}
```

In `writeNote`, replace `await fs.writeFile(tmp, renderNote(note, meta));` with:

```ts
    // A note outlives the folder's place (it can move): paths inside the folder are kept relative.
    await fs.writeFile(tmp, renderNote({ ...note, files: note.files.map((f) => folderRelative(folder, f)) }, meta));
```

After `writeNote` add:

```ts
/**
 * After the folder moved from `oldFolder`: `files:` entries in the notes' front matter that name the old
 * place become relative. Nothing else in a note changes. Returns how many notes were rewritten.
 */
export async function relativizeNoteFiles(folder: string, oldFolder: string): Promise<number> {
  const dir = path.join(folder, NOTES_PREFIX);
  const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".md"));
  let rewritten = 0;
  for (const name of names) {
    const file = path.join(dir, name);
    const text = await fs.readFile(file, "utf8");
    const front = /^﻿?---\r?\n[\s\S]*?\r?\n---/.exec(text);
    if (!front) continue;
    let changed = false;
    const head = front[0].replace(/^files: (.*)$/m, (line, raw: string) => {
      let files: unknown;
      try {
        files = JSON.parse(raw);
      } catch {
        return line;
      }
      if (!Array.isArray(files)) return line;
      const list: unknown[] = files;
      const next = list.map((f) => (typeof f === "string" ? folderRelative(oldFolder, f) : f));
      if (next.every((f, i) => f === list[i])) return line;
      changed = true;
      return `files: ${JSON.stringify(next)}`;
    });
    if (!changed) continue;
    const tmp = `${file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, head + text.slice(front[0].length));
      await fs.rename(tmp, file);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
    rewritten++;
  }
  return rewritten;
}
```

(The temp name `<slug>.md.<uuid>.tmp` is the one the history already skips.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/workspace/test/notes.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck, full tests, commit**

Run: `corepack pnpm typecheck` then `corepack pnpm test`
Expected: both green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-core add packages/workspace/src/notes.ts packages/workspace/test/notes.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-core commit -m "feat(workspace): notes keep paths inside the folder relative" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019d45XaZQ8kSgiVYs5kCgGp"
```

### Task 11: The open task continues from the notes in a fresh session

**Files:**
- Modify: `packages/shell/src/main/task-store.ts`, `packages/shell/src/main/task-prompts.ts`, `packages/shell/src/main/task-manager.ts`
- Test: `packages/shell/test/task-store.test.ts`, `packages/shell/test/task-manager.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/shell/test/task-store.test.ts`, inside `describe("TaskStore", …)`:

```ts
  it("keeps the resume flag only as true", async () => {
    const folder = tmp();
    const store = new TaskStore(folder);
    await store.save({ ...waiting, current: { ...waiting.current!, resume: true } });
    expect((await store.load()).current?.resume).toBe(true);
    fs.writeFileSync(store.file, JSON.stringify({ ...waiting, current: { ...waiting.current, resume: "yes" } }));
    expect((await store.load()).current?.resume).toBeUndefined();
  });
```

In `packages/shell/test/task-manager.test.ts`, inside `describe("TaskManager", …)`:

```ts
  it("after the folder moved, the open task's next message starts a fresh session from the notes", async () => {
    const t = setup();
    await t.manager.start("manifest");
    await t.manager.resumeFromNotes();
    expect(t.state().current).toMatchObject({ id: "t1", status: "waiting", resume: true });
    expect(t.state().current?.session).toBeUndefined();
    await t.manager.ask("And the blocks?");
    expect(t.turns[1].message).toContain("This topic continues in a new conversation");
    expect(t.turns[1].message).toContain("## The person's message\nAnd the blocks?");
    expect(t.turns[1].options).toMatchObject({ task: "t1", action: "manifest", display: "And the blocks?", followUp: true });
    expect(t.log.filter((l) => l === "endSession")).toHaveLength(2);
    expect(t.state().current?.resume).toBeUndefined();
    await t.manager.ask("More?");
    expect(t.turns[2].message).toBe("More?");
  });

  it("keeps resuming from the notes when that first turn failed", async () => {
    const t = setup({ script: [[ok], [crashed]] });
    await t.manager.start("manifest");
    await t.manager.resumeFromNotes();
    await t.manager.ask("And the blocks?");
    expect(t.state().current?.resume).toBe(true);
  });

  it("closes a moved task without a closing turn: its new session holds no conversation", async () => {
    const t = setup({ path: ["manifest", "engines"] });
    await t.manager.start("manifest");
    await t.manager.resumeFromNotes();
    await pick(t, { label: "Next", next: true });
    expect(t.turns.map((x) => x.options.phase)).toEqual(["run", "run"]);
    expect(t.state()).toMatchObject({ actions: { manifest: "unfinished" }, current: { action: "engines", status: "waiting" } });
  });

  it("does nothing on resumeFromNotes when no task is open", async () => {
    const t = setup();
    await t.manager.resumeFromNotes();
    expect(t.state().current).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run packages/shell/test/task-store.test.ts packages/shell/test/task-manager.test.ts`
Expected: FAIL — `resume` is not in `CurrentTask`; `resumeFromNotes` doesn't exist.

- [ ] **Step 3: Implement**

`packages/shell/src/main/task-store.ts`:
- in `CurrentTask`, after `checkpointNote?`:
  ```ts
  /** The engine session was lost (the folder moved): the next turn starts a new one from the notes. */
  resume?: boolean;
  ```
- in `cleanCurrent`'s returned object, after the `checkpointNote` line:
  ```ts
    ...(c.resume === true ? { resume: true } : {}),
  ```

`packages/shell/src/main/task-prompts.ts` — append:

```ts
/** A follow-up of a task whose engine session was lost (the folder moved): the new session starts from the notes. */
export const RESUME_PROMPT = [
  "This topic continues in a new conversation: the person's folder moved to a new place, so the earlier conversation is not available. Start from the notes below and the files in the folder, answer in {{language}}, then end with `show_choices`.",
  "",
  "{{notesIndex}}",
  "",
  "## The person's message",
  "{{question}}",
].join("\n");
```

`packages/shell/src/main/task-manager.ts`:
- import: `import { CHECKPOINT_PROMPT, CLOSE_PROMPT, QUESTION_PROMPT, RESUME_PROMPT, fillPrompt } from "./task-prompts";`
- after `interrupt()` add:

```ts
  /**
   * The open task's engine session is gone (the folder moved, spec 3d §2): the task stays open, its stored
   * session and context are dropped, and its next follow-up starts a new session from the notes.
   */
  resumeFromNotes(): Promise<void> {
    return this.queue(() =>
      this.update((s) => {
        if (!s.current) return s;
        const { session: _session, context: _context, checkpointed: _checkpointed, ...rest } = s.current;
        return { ...s, current: { ...rest, resume: true } };
      }),
    );
  }
```

- in `askNow`, replace the whole `if (c?.status === "waiting") { … }` block with:

```ts
    if (c?.status === "waiting") {
      if (needsCheckpoint(c) && !(await this.checkpoint(c))) return this.stopped();
      // After a move the session is new: it starts from the notes, and the chat still shows what was typed.
      let message = text;
      if (c.resume) {
        await this.endSession();
        const notes = await this.d.notes().catch(() => [] as Note[]);
        message = fillPrompt(RESUME_PROMPT, { language: await this.d.language(), notesIndex: buildNotesIndex(notes), question: text });
      }
      await this.setStatus(c.id, "running");
      // Checked with no await before the send: a Stop while the status was saved.
      if (this.cancelRequested) {
        await this.setStatus(c.id, "waiting");
        return this.stopped();
      }
      let done: Done;
      try {
        done = await this.runTurn(c, message, {
          ...(display || c.resume ? { display: display ?? text } : {}),
          ...(c.action ? { action: c.action } : {}),
          followUp: true,
        });
      } catch (err) {
        if (err instanceof TurnNotStarted) await this.setStatus(c.id, "waiting");
        throw unwrap(err);
      }
      if (c.resume && done.ok) {
        await this.update((s) => {
          if (s.current?.id !== c.id) return s;
          const { resume: _resume, ...rest } = s.current;
          return { ...s, current: rest };
        });
      }
      return this.afterRun(c.id, done, false);
    }
```

- in `closeCurrent`, after the `if (c.noteSaved) { … }` block add:

```ts
    // A moved task's new session holds no conversation to sum up (a checkpoint's note still counts).
    if (c.resume) {
      await this.endTask(c.id, "unfinished");
      return !this.cancelRequested;
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/shell/test/task-store.test.ts packages/shell/test/task-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck, full tests, commit**

Run: `corepack pnpm typecheck` then `corepack pnpm test`
Expected: both green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-core add packages/shell/src/main/task-store.ts packages/shell/src/main/task-prompts.ts packages/shell/src/main/task-manager.ts packages/shell/test/task-store.test.ts packages/shell/test/task-manager.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-core commit -m "feat(shell): an open task continues from the notes after its session is lost" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019d45XaZQ8kSgiVYs5kCgGp"
```

### Task 12: `moveFolder` — refuse, copy, verify, config, history, remove; roll back at each step

**Files:**
- Create: `packages/shell/src/main/move-folder.ts`, `packages/shell/test/move-folder.test.ts`
- Modify: `packages/ui/src/client.ts` (the `MoveError` type)

- [ ] **Step 1: Add the error type**

In `packages/ui/src/client.ts`, after `SyncLocationView` add:

```ts
/** Why moving the folder failed; each has its own card (spec 3d §2 "Errors"). */
export type MoveError = "busy" | "exists" | "inside" | "unsuitable" | "no-space" | "no-permission" | "mismatch" | "failed";
```

- [ ] **Step 2: Write the failing tests**

`packages/shell/test/move-folder.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ConfigStore, historyDir } from "../src/main/config";
import { type MoveDeps, type MoveOps, MoveFailed, failureOf, moveFolder, sameContents } from "../src/main/move-folder";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hh-")));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const errno = (code: string) => Object.assign(new Error(code), { code });
const OLD_TIME = new Date("2026-01-02T03:04:05Z");

/** A folder with files, a note naming its absolute path, a history and a config pointing at it. */
async function setup(ops: Partial<MoveOps> = {}, extra: Partial<MoveDeps> = {}) {
  const base = fs.mkdtempSync(path.join(root, "t-"));
  const from = path.join(base, "home", "Documents", "Work");
  const to = path.join(base, "home", "Drive", "Work");
  const userData = path.join(base, "userData");
  fs.mkdirSync(path.join(from, "sub"), { recursive: true });
  fs.mkdirSync(path.join(from, ".harness", "notes"), { recursive: true });
  fs.mkdirSync(path.join(base, "home", "Drive"), { recursive: true });
  fs.writeFileSync(path.join(from, "a.md"), "1");
  fs.utimesSync(path.join(from, "a.md"), OLD_TIME, OLD_TIME);
  fs.writeFileSync(path.join(from, "sub", "b.md"), "b");
  fs.writeFileSync(path.join(from, ".harness", "notes", "n.md"), `---\ntitle: "N"\nfiles: ["${from}/a.md"]\n---\n`);
  fs.writeFileSync(path.join(from, ".harness", "tasks.json"), "{}");
  const oldHistory = historyDir(userData, from);
  const newHistory = historyDir(userData, to);
  fs.mkdirSync(oldHistory, { recursive: true });
  fs.writeFileSync(path.join(oldHistory, "HEAD"), "ref: refs/heads/main\n");
  const config = new ConfigStore(userData);
  await config.save({ folder: from, language: "es" });
  const deps: MoveDeps = {
    check: async () => null,
    tracked: async () => ["a.md", "sub/b.md", ".harness/notes/n.md"],
    saveFolder: async (folder) => void (await config.replaceFolder(folder)),
    historyDir: (folder) => historyDir(userData, folder),
    ops,
    now: () => 1234,
    ...extra,
  };
  return { from, to, config, oldHistory, newHistory, deps };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    return err instanceof MoveFailed ? err.code : `not a MoveFailed: ${String(err)}`;
  }
  return "no error";
};

/** Nothing changed: `from` and its history are where they were, `to` doesn't exist, the config names `from`. */
async function untouched(t: Awaited<ReturnType<typeof setup>>) {
  expect(fs.readFileSync(path.join(t.from, "a.md"), "utf8")).toBe("1");
  expect(fs.existsSync(t.to)).toBe(false);
  expect(fs.existsSync(path.join(t.oldHistory, "HEAD"))).toBe(true);
  expect((await t.config.load()).folder).toBe(t.from);
}

describe("moveFolder", () => {
  it("moves the folder with its history and makes the notes' old paths relative", async () => {
    const t = await setup();
    expect(await moveFolder(t.from, t.to, t.deps)).toEqual({ oldRemoved: true });
    expect(fs.existsSync(t.from)).toBe(false);
    expect(fs.readFileSync(path.join(t.to, "sub", "b.md"), "utf8")).toBe("b");
    expect(fs.statSync(path.join(t.to, "a.md")).mtime.getTime()).toBe(OLD_TIME.getTime());
    expect(fs.readFileSync(path.join(t.to, ".harness", "notes", "n.md"), "utf8")).toContain('files: ["a.md"]');
    expect(fs.existsSync(path.join(t.to, ".harness", "tasks.json"))).toBe(true);
    expect(await t.config.load()).toEqual({ folder: t.to, language: "es" });
    expect(fs.existsSync(path.join(t.newHistory, "HEAD"))).toBe(true);
    expect(fs.existsSync(t.oldHistory)).toBe(false);
  });

  it("refuses a place inside the folder, or one the folder is inside", async () => {
    const t = await setup();
    expect(await code(moveFolder(t.from, path.join(t.from, "Inner"), t.deps))).toBe("inside");
    expect(await code(moveFolder(t.from, path.dirname(t.from), t.deps))).toBe("inside");
    await untouched(t);
  });

  it("refuses a place that already exists", async () => {
    const t = await setup();
    fs.mkdirSync(t.to);
    expect(await code(moveFolder(t.from, t.to, t.deps))).toBe("exists");
    expect(fs.readdirSync(t.to)).toEqual([]);
    expect((await t.config.load()).folder).toBe(t.from);
  });

  it("refuses a place the folder can't be (the first-launch check)", async () => {
    const t = await setup({}, { check: async () => "protected" });
    expect(await code(moveFolder(t.from, t.to, t.deps))).toBe("unsuitable");
    await untouched(t);
  });

  it("refuses when there isn't enough space, before copying anything", async () => {
    const t = await setup({ freeBytes: async () => 1 });
    expect(await code(moveFolder(t.from, t.to, t.deps))).toBe("no-space");
    await untouched(t);
  });

  it("removes a half-made copy when copying fails", async () => {
    for (const [errCode, expected] of [["ENOSPC", "no-space"], ["EACCES", "no-permission"], ["EIO", "failed"]] as const) {
      const t = await setup({
        cp: async (src, dest, opts) => {
          await fs.promises.cp(src, dest, opts);
          throw errno(errCode);
        },
      });
      expect(await code(moveFolder(t.from, t.to, t.deps))).toBe(expected);
      await untouched(t);
    }
  });

  it("removes the copy when it doesn't match", async () => {
    const t = await setup({
      cp: async (src, dest, opts) => {
        await fs.promises.cp(src, dest, opts);
        fs.writeFileSync(path.join(String(dest), "a.md"), "X");
      },
    });
    expect(await code(moveFolder(t.from, t.to, t.deps))).toBe("mismatch");
    await untouched(t);
  });

  it("removes the copy when the config can't be saved", async () => {
    const t = await setup({}, { saveFolder: async () => Promise.reject(errno("EACCES")) });
    expect(await code(moveFolder(t.from, t.to, t.deps))).toBe("failed");
    await untouched(t);
  });

  it("puts the config back and removes the copy when the history can't follow", async () => {
    const t = await setup({ rename: async () => Promise.reject(errno("EPERM")) });
    expect(await code(moveFolder(t.from, t.to, t.deps))).toBe("failed");
    await untouched(t);
  });

  it("sets a stale history of the new place aside, and puts it back on a rollback", async () => {
    const t = await setup();
    fs.mkdirSync(t.newHistory, { recursive: true });
    fs.writeFileSync(path.join(t.newHistory, "stale"), "x");
    let renames = 0;
    const failing = await setup({
      rename: async (a, b) => {
        if (++renames === 2) throw errno("EPERM");
        return fs.promises.rename(a, b);
      },
    });
    fs.mkdirSync(failing.newHistory, { recursive: true });
    fs.writeFileSync(path.join(failing.newHistory, "stale"), "x");
    expect(await code(moveFolder(failing.from, failing.to, failing.deps))).toBe("failed");
    expect(fs.readFileSync(path.join(failing.newHistory, "stale"), "utf8")).toBe("x");
    await untouched(failing);

    expect(await moveFolder(t.from, t.to, t.deps)).toEqual({ oldRemoved: true });
    expect(fs.existsSync(path.join(`${t.newHistory}.replaced-1234`, "stale"))).toBe(true);
    expect(fs.existsSync(path.join(t.newHistory, "HEAD"))).toBe(true);
  });

  it("still succeeds when the old folder can't be removed", async () => {
    const t = await setup({
      rm: async (p, opts) => {
        if (String(p) === t.from) throw errno("EBUSY");
        return fs.promises.rm(p, opts);
      },
    });
    expect(await moveFolder(t.from, t.to, t.deps)).toEqual({ oldRemoved: false });
    expect((await t.config.load()).folder).toBe(t.to);
    expect(fs.existsSync(path.join(t.to, "a.md"))).toBe(true);
    expect(fs.existsSync(path.join(t.from, "a.md"))).toBe(true);
  });
});

describe("sameContents", () => {
  it("compares names and sizes of every file, and the bytes of tracked ones", async () => {
    const base = fs.mkdtempSync(path.join(root, "s-"));
    const a = path.join(base, "a");
    const b = path.join(base, "b");
    for (const d of [a, b]) {
      fs.mkdirSync(d);
      fs.writeFileSync(path.join(d, "x.md"), "1");
      fs.writeFileSync(path.join(d, "big.bin"), "AAAA");
    }
    expect(await sameContents(a, b, ["x.md"])).toBe(true);
    fs.writeFileSync(path.join(b, "big.bin"), "BBBB");
    expect(await sameContents(a, b, ["x.md"])).toBe(true);
    expect(await sameContents(a, b, ["x.md", "big.bin"])).toBe(false);
    fs.writeFileSync(path.join(b, ".DS_Store"), "finder");
    fs.writeFileSync(path.join(b, "big.bin"), "AAAA");
    expect(await sameContents(a, b, ["x.md"])).toBe(true);
    fs.writeFileSync(path.join(b, "extra.md"), "");
    expect(await sameContents(a, b, [])).toBe(false);
  });

  it("names each failure", () => {
    expect(failureOf(errno("ENOSPC"))).toBe("no-space");
    expect(failureOf(errno("EDQUOT"))).toBe("no-space");
    expect(failureOf(errno("EROFS"))).toBe("no-permission");
    expect(failureOf(errno("ERR_FS_CP_EEXIST"))).toBe("exists");
    expect(failureOf(new Error("?"))).toBe("failed");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `corepack pnpm vitest run packages/shell/test/move-folder.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

`packages/shell/src/main/move-folder.ts`:

```ts
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { FolderProblem, MoveError } from "@humanharness/ui/client";
import { relativizeNoteFiles } from "@humanharness/workspace";

/** A move that failed with the reason the window shows. The old folder is untouched and still the app's folder. */
export class MoveFailed extends Error {
  constructor(
    readonly code: MoveError,
    cause?: unknown,
  ) {
    super(`The folder could not be moved: ${code}`, { cause });
  }
}

/** The file operations a move uses (tests make each one fail). */
export interface MoveOps {
  cp: typeof fs.cp;
  rm: typeof fs.rm;
  rename: typeof fs.rename;
  /** Free bytes on the disk that holds `dir`; null when unknown. */
  freeBytes(dir: string): Promise<number | null>;
}

const realOps: MoveOps = {
  cp: (...args) => fs.cp(...args),
  rm: (...args) => fs.rm(...args),
  rename: (...args) => fs.rename(...args),
  freeBytes: async (dir) => {
    try {
      const s = await fs.statfs(dir);
      return s.bavail * s.bsize;
    } catch {
      return null;
    }
  },
};

export interface MoveDeps {
  /** Why the new place can't be the folder (`checkFolder`, as at first launch); null when it can. */
  check(folder: string): Promise<FolderProblem | null>;
  /** The files the history tracks, relative to the folder: their bytes are compared after the copy. */
  tracked(): Promise<string[]>;
  /** Saves `folder` as the app's folder (`ConfigStore.replaceFolder`). */
  saveFolder(folder: string): Promise<void>;
  /** Where the hidden history of a folder lives (`historyDir`). */
  historyDir(folder: string): string;
  ops?: Partial<MoveOps>;
  now?: () => number;
}

export interface MoveDone {
  /** False when the old folder could not be removed; the move itself succeeded. */
  oldRemoved: boolean;
}

// macOS file systems are usually case-insensitive: compare without case.
const isInside = (child: string, parent: string) => {
  const c = child.toLowerCase();
  const p = parent.toLowerCase();
  return c === p || c.startsWith(p + path.sep);
};
const exists = (p: string) => fs.lstat(p).then(() => true, () => false);

/** The reason the window shows for a failed file operation. */
export function failureOf(err: unknown, fallback: MoveError = "failed"): MoveError {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOSPC" || code === "EDQUOT") return "no-space";
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") return "no-permission";
  if (code === "EEXIST" || code === "ERR_FS_CP_EEXIST") return "exists";
  return fallback;
}

interface Item {
  size: number;
  /** A link's target; null for a file. */
  link: string | null;
}

/** Every file and link under `dir`, by relative path (Finder's `.DS_Store` files left out). */
async function listing(dir: string): Promise<Map<string, Item>> {
  const out = new Map<string, Item>();
  const walk = async (rel: string): Promise<void> => {
    for (const entry of await fs.readdir(path.join(dir, rel), { withFileTypes: true })) {
      if (entry.name === ".DS_Store") continue;
      const child = rel ? path.join(rel, entry.name) : entry.name;
      const full = path.join(dir, child);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isSymbolicLink()) out.set(child, { size: 0, link: await fs.readlink(full) });
      else out.set(child, { size: (await fs.stat(full)).size, link: null });
    }
  };
  await walk("");
  return out;
}

const hash = async (file: string) => createHash("sha256").update(await fs.readFile(file)).digest("hex");

/** Same relative files with the same sizes (and links with the same targets), and the same bytes for the tracked files. */
export async function sameContents(from: string, to: string, tracked: string[]): Promise<boolean> {
  const [a, b] = await Promise.all([listing(from), listing(to)]);
  if (a.size !== b.size) return false;
  for (const [rel, item] of a) {
    const other = b.get(rel);
    if (!other || other.size !== item.size || other.link !== item.link) return false;
  }
  for (const rel of tracked) {
    if (!a.has(path.normalize(rel))) continue;
    if ((await hash(path.join(from, rel))) !== (await hash(path.join(to, rel)))) return false;
  }
  return true;
}

async function nearestExisting(dir: string): Promise<string> {
  let d = dir;
  while (!(await exists(d)) && path.dirname(d) !== d) d = path.dirname(d);
  return d;
}

/**
 * Moves the person's folder to `to` with its history (spec 3d §2): refuse, copy, verify, save the config,
 * move the history, remove the old folder. A failure before the last step undoes what was done, so `from`
 * stays as it was and stays the app's folder. A failure removing `from` leaves the move done.
 * The caller refuses it while a turn runs and holds turns off meanwhile.
 */
export async function moveFolder(from: string, to: string, d: MoveDeps): Promise<MoveDone> {
  const ops: MoveOps = { ...realOps, ...d.ops };
  const source = path.resolve(from);
  const target = path.resolve(to);
  const removeCopy = (): Promise<void> =>
    ops.rm(target, { recursive: true, force: true }).catch((err: unknown) => console.error("Could not remove the copy", err));

  // 1. Refusals: nothing has been touched yet.
  if (isInside(target, source) || isInside(source, target)) throw new MoveFailed("inside");
  if (await exists(target)) throw new MoveFailed("exists");
  if (await d.check(target)) throw new MoveFailed("unsuitable");
  const need = [...(await listing(source)).values()].reduce((n, item) => n + item.size, 0);
  const free = await ops.freeBytes(await nearestExisting(path.dirname(target)));
  if (free !== null && free < need) throw new MoveFailed("no-space");

  // 2. Copy, keeping timestamps; links stay links.
  try {
    await ops.cp(source, target, { recursive: true, preserveTimestamps: true, errorOnExist: true, force: false, verbatimSymlinks: true });
  } catch (err) {
    const reason = failureOf(err);
    // Something else created the place meanwhile: it isn't ours to remove.
    if (reason !== "exists") await removeCopy();
    throw new MoveFailed(reason, err);
  }

  // 3. Verify; then the notes stop naming the old place.
  try {
    if (!(await sameContents(source, target, await d.tracked()))) throw new MoveFailed("mismatch");
    await relativizeNoteFiles(target, source);
  } catch (err) {
    await removeCopy();
    throw err instanceof MoveFailed ? err : new MoveFailed(failureOf(err, "mismatch"), err);
  }

  // 4. The app's folder.
  try {
    await d.saveFolder(target);
  } catch (err) {
    await removeCopy();
    throw new MoveFailed("failed", err);
  }

  // 5. The history follows the folder; a stale history of the new place is set aside.
  const oldHistory = d.historyDir(source);
  const newHistory = d.historyDir(target);
  let setAside: string | null = null;
  try {
    if (await exists(oldHistory)) {
      if (await exists(newHistory)) {
        setAside = `${newHistory}.replaced-${(d.now ?? Date.now)()}`;
        await ops.rename(newHistory, setAside);
      }
      await ops.rename(oldHistory, newHistory);
    }
  } catch (err) {
    if (setAside) await ops.rename(setAside, newHistory).catch((e: unknown) => console.error("Could not put the old history back", e));
    const restored = await d.saveFolder(source).then(
      () => true,
      (e: unknown) => {
        console.error("Could not put the folder back in the config", e);
        return false;
      },
    );
    // The config still names the copy: keep it, so the person never loses their folder.
    if (restored) await removeCopy();
    throw new MoveFailed("failed", err);
  }

  // 6. The old folder. The move is done even when this fails.
  try {
    await ops.rm(source, { recursive: true, force: true });
    return { oldRemoved: true };
  } catch (err) {
    console.error("Could not remove the old folder", err);
    return { oldRemoved: false };
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/shell/test/move-folder.test.ts`
Expected: PASS

- [ ] **Step 6: Typecheck, full tests, commit**

Run: `corepack pnpm typecheck` then `corepack pnpm test`
Expected: both green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-core add packages/shell/src/main/move-folder.ts packages/shell/test/move-folder.test.ts packages/ui/src/client.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-core commit -m "feat(shell): move the folder with its history, rolling back on failure" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019d45XaZQ8kSgiVYs5kCgGp"
```

### Task 13: Moving over IPC

**Files:**
- Modify: `packages/ui/src/client.ts`, `packages/shell/src/main/index.ts`, `packages/shell/src/preload/index.ts`, `packages/ui/test/fake-client.ts`

- [ ] **Step 1: Types and the client method**

In `packages/ui/src/client.ts`, after `MoveError` add:

```ts
/** How a move ended: the new app state (and the old folder when it could not be removed), or why it failed. */
export type MoveResult = { ok: true; state: AppState; leftBehind?: string } | { ok: false; error: MoveError };
```

In `HarnessClient`, after `revealFolder()` add:

```ts
  /** Moves the folder and its history to `to` (an absolute path that doesn't exist yet). Refused while a turn runs. */
  moveFolder(to: string): Promise<MoveResult>;
```

`packages/shell/src/preload/index.ts` — after `revealFolder` add:

```ts
  moveFolder: (to) => ipcRenderer.invoke("hh:moveFolder", to),
```

`packages/ui/test/fake-client.ts`:
- add `MoveResult` to the type import list;
- add fields after `revealed = 0;`:
  ```ts
  /** Places moveFolder was asked to move to. */
  moved: string[] = [];
  /** What moveFolder answers; default: success with the current state. */
  moveResult: MoveResult | null = null;
  ```
- add the method after `revealFolder()`:
  ```ts
  async moveFolder(to: string) {
    this.moved.push(to);
    return this.moveResult ?? { ok: true as const, state: this.state };
  }
  ```

- [ ] **Step 2: Wire the main process**

`packages/shell/src/main/index.ts`:
- add the imports `import { type MoveDone, MoveFailed, moveFolder } from "./move-folder";` and add `type MoveResult` to the `@humanharness/ui/client` import list.
- replace `dropRuntime` with:

```ts
/** Closes the running runtime and keeps the open task; the next turn starts a new runtime (and engine session). */
async function closeRuntime() {
  const rt = await runtime.peek()?.catch(() => null);
  runtime.clear();
  await rt?.close();
}

/** Ends the open task, then closes the running runtime (e.g. the engine changed); the next turn starts a new one. */
async function dropRuntime() {
  await tasks.interrupt().catch((err: unknown) => console.error("Could not end the task", err));
  await closeRuntime();
}
```

- in `registerIpc`, after `hh:revealFolder`, add:

```ts
  // Spec 3d §2: refused while a turn runs; turns and restores are held off until it is over.
  handle("hh:moveFolder", async (to: unknown): Promise<MoveResult> => {
    if (quitting) throw new Error("The app is closing");
    if (typeof to !== "string" || !path.isAbsolute(to) || to.length > 1000 || to.includes("\0")) return { ok: false, error: "unsuitable" };
    const c = await validConfig();
    if (!c) throw new Error("The app is not set up yet");
    try {
      guards.beginFolderChange(() => tasks.isBusy() || restorePending);
    } catch {
      return { ok: false, error: "busy" };
    }
    let done: MoveDone;
    try {
      await turns.flush();
      // The runtime works on the old folder. The open task stays open and continues from its notes.
      await closeRuntime();
      await restoring;
      const history = await currentHistory();
      done = await moveFolder(c.folder, to, {
        check: (folder) => checkFolder(folder, os.homedir()),
        tracked: async () => (await history?.trackedFiles()) ?? [],
        saveFolder: async (folder) => void (await config.replaceFolder(folder)),
        historyDir: (folder) => historyDir(app.getPath("userData"), folder),
      });
    } catch (err) {
      if (err instanceof MoveFailed) return { ok: false, error: err.code };
      console.error("Could not move the folder", err);
      return { ok: false, error: "failed" };
    } finally {
      // The runtime was closed either way: the engine session is gone.
      await tasks.resumeFromNotes().catch((err: unknown) => console.error("Could not keep the open task", err));
      guards.endFolderChange();
    }
    return { ok: true, state: await appState(), ...(done.oldRemoved ? {} : { leftBehind: c.folder }) };
  });
```

- [ ] **Step 3: Typecheck, full tests, build, commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm app:build`
Expected: all green (the logic is covered by Tasks 11 and 12; this task is wiring).

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-core add packages/ui/src/client.ts packages/shell/src/main/index.ts packages/shell/src/preload/index.ts packages/ui/test/fake-client.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-core commit -m "feat(shell): move the folder from the window, keeping the open task" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019d45XaZQ8kSgiVYs5kCgGp"
```

### Task 14: The backup notice on Home and in Settings › General

**Files:**
- Create: `packages/ui/src/BackupNotice.tsx`, `packages/ui/test/backup-notice.test.tsx`
- Modify: `packages/ui/src/Home.tsx`, `packages/ui/src/HarnessApp.tsx`, `packages/ui/src/SettingsSheet.tsx`, `packages/ui/src/styles.css`, `packages/i18n/src/locales/en.json`, `packages/i18n/src/locales/es.json`, `packages/ui/test/settings.test.tsx`

- [ ] **Step 1: Add the strings**

In `packages/i18n/src/locales/en.json`, inside `"backup"` (after `"provider"`) add:

```json
    "title": "Backup",
    "notice": "Your folder is only on this computer. If something happens to it, your work is lost. Keep it in a synced folder.",
    "moveTo": "Move to {{provider}}",
    "chooseAnother": "Choose another place…",
    "dismiss": "I already have a copy",
    "moving": "Moving your folder… Don't close the app.",
    "leftBehind": "Your folder moved, but I couldn't remove the old one at {{path}}. You can delete it yourself.",
    "showAgain": "Remind me again",
    "status": {
      "synced": "Kept in {{provider}}",
      "git-remote": "Kept in a git repository with a remote",
      "local": "Only on this computer",
      "dismissed": "You keep your own copy"
    },
    "moveError": {
      "busy": "Wait until the AI finishes, then try again.",
      "exists": "There's already a folder with that name there. Choose another place.",
      "inside": "Your folder can't go inside itself. Choose another place.",
      "unsuitable": "Your folder can't go there. Choose another place, for example a synced folder.",
      "no-space": "There isn't enough space there. Free some space or choose another place.",
      "no-permission": "The app isn't allowed to write there. Choose another place.",
      "mismatch": "The copy didn't come out the same, so I left your folder where it was.",
      "failed": "I couldn't move your folder. It's still where it was."
    }
```

and replace `"folderFixed"` in `"settings"` with:

```json
    "folderFixed": "Don't move or rename it by hand: the app moves it for you, with its history.",
```

In `packages/i18n/src/locales/es.json`, inside `"backup"`:

```json
    "title": "Copia de seguridad",
    "notice": "Tu carpeta está solo en esta compu. Si le pasa algo, perdés tu trabajo. Guardala en una carpeta sincronizada.",
    "moveTo": "Mover a {{provider}}",
    "chooseAnother": "Elegir otro lugar…",
    "dismiss": "Ya tengo una copia",
    "moving": "Moviendo tu carpeta… No cierres la app.",
    "leftBehind": "Tu carpeta se movió, pero no pude borrar la vieja en {{path}}. Podés borrarla vos.",
    "showAgain": "Volver a avisarme",
    "status": {
      "synced": "Guardada en {{provider}}",
      "git-remote": "Guardada en un repositorio git con remoto",
      "local": "Solo en esta compu",
      "dismissed": "Tenés tu propia copia"
    },
    "moveError": {
      "busy": "Esperá a que la IA termine y probá de nuevo.",
      "exists": "Ya hay una carpeta con ese nombre ahí. Elegí otro lugar.",
      "inside": "Tu carpeta no puede ir adentro de sí misma. Elegí otro lugar.",
      "unsuitable": "Tu carpeta no puede ir ahí. Elegí otro lugar, por ejemplo una carpeta sincronizada.",
      "no-space": "No hay suficiente espacio ahí. Liberá espacio o elegí otro lugar.",
      "no-permission": "La app no tiene permiso para escribir ahí. Elegí otro lugar.",
      "mismatch": "La copia no salió igual, así que dejé tu carpeta donde estaba.",
      "failed": "No pude mover tu carpeta. Sigue donde estaba."
    }
```

and in `"settings"`:

```json
    "folderFixed": "No la muevas ni la renombres a mano: la app la mueve por vos, con su historial.",
```

In `packages/ui/test/settings.test.tsx`, replace `expect(screen.getByText("Chosen at setup; it can't be changed.")).toBeTruthy();` with `expect(screen.getByText("Don't move or rename it by hand: the app moves it for you, with its history.")).toBeTruthy();`.

- [ ] **Step 2: Write the failing tests**

`packages/ui/test/backup-notice.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackupNotice, needsBackupNotice } from "../src/BackupNotice";
import type { AppState } from "../src/client";
import { Home } from "../src/Home";
import { type SettingsTab, SettingsSheet } from "../src/SettingsSheet";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const folder = "/Users/me/Documents/Demo";
const drive = "/Users/me/Library/CloudStorage/GoogleDrive-me@example.com/My Drive";
const ready = { language: "en" as const, folder, engineId: "claude" };

function localClient() {
  const client = new FakeClient(ready);
  client.state.backup = { status: { kind: "local" }, locations: [{ provider: "google-drive", path: drive, suggested: `${drive}/Demo` }] };
  return client;
}

/** The notice with its state kept, as Home and Settings keep it. */
function Notice({ client }: { client: FakeClient }) {
  const [state, setState] = useState<AppState>(client.state);
  return <BackupNotice client={client} state={state} onChange={setState} />;
}

describe("BackupNotice", () => {
  it("shows for a local folder: move to each synced place, choose another place, or say there is a copy", async () => {
    await renderIn("en", <Notice client={localClient()} />);
    expect(screen.getByRole("region", { name: "Backup" }).textContent).toContain("Your folder is only on this computer.");
    expect(screen.getByRole("button", { name: "Move to Google Drive" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choose another place…" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "I already have a copy" })).toBeTruthy();
  });

  it("moves the folder, keeping its name, and goes away once it is synced", async () => {
    const client = localClient();
    client.moveResult = { ok: true, state: { ...client.state, config: { ...ready, folder: `${drive}/Demo` }, backup: { status: { kind: "synced", provider: "google-drive" }, locations: [] } } };
    await renderIn("en", <Notice client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Move to Google Drive" }));
    await waitFor(() => expect(client.moved).toEqual([`${drive}/Demo`]));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Backup" })).toBeNull());
  });

  it("moves into another place the person picks", async () => {
    const client = localClient();
    client.pickResult = { folder: "/Volumes/Disk", problem: "too-broad" };
    await renderIn("en", <Notice client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose another place…" }));
    await waitFor(() => expect(client.moved).toEqual(["/Volumes/Disk/Demo"]));
  });

  it("shows each failure in plain language and keeps the buttons", async () => {
    const client = localClient();
    client.moveResult = { ok: false, error: "no-space" };
    await renderIn("en", <Notice client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Move to Google Drive" }));
    expect((await screen.findByRole("alert")).textContent).toBe("There isn't enough space there. Free some space or choose another place.");
    expect(screen.getByRole("button", { name: "Move to Google Drive" })).toBeTruthy();
  });

  it("says where the old folder stayed when it couldn't be removed", async () => {
    const client = localClient();
    client.moveResult = { ok: true, leftBehind: folder, state: { ...client.state, backup: { status: { kind: "synced", provider: "google-drive" }, locations: [] } } };
    await renderIn("es", <Notice client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Mover a Google Drive" }));
    // "Moviendo tu carpeta…" is a status too while the move runs.
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe(`Tu carpeta se movió, pero no pude borrar la vieja en ${folder}. Podés borrarla vos.`));
  });

  it("hides when the person already has a copy", async () => {
    const client = localClient();
    await renderIn("en", <Notice client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "I already have a copy" }));
    await waitFor(() => expect(client.state.config.backupDismissed).toBe(true));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Backup" })).toBeNull());
  });

  it("shows only for a local folder that wasn't dismissed", () => {
    const state = localClient().state;
    expect(needsBackupNotice(state)).toBe(true);
    expect(needsBackupNotice({ ...state, config: { ...state.config, backupDismissed: true } })).toBe(false);
    expect(needsBackupNotice({ ...state, backup: { status: { kind: "git-remote" }, locations: [] } })).toBe(false);
    expect(needsBackupNotice({ ...state, backup: { status: { kind: "synced", provider: "icloud" }, locations: [] } })).toBe(false);
    expect(needsBackupNotice({ ...state, backup: undefined })).toBe(false);
  });

  it("appears on Home", async () => {
    const client = localClient();
    await renderIn(
      "en",
      <Home state={client.state} client={client} onChange={() => {}} status={null} limits={null} onStart={() => {}} onSettings={() => {}} onEngine={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Move to Google Drive" })).toBeTruthy();
  });
});

describe("Settings › General backup row", () => {
  function Sheet({ client }: { client: FakeClient }) {
    const [state, setState] = useState<AppState>(client.state);
    const [tab, setTab] = useState<SettingsTab>("general");
    return <SettingsSheet client={client} state={state} tab={tab} onTab={setTab} onChange={setState} onClose={vi.fn()} />;
  }

  it("shows the status and the notice, and brings a dismissed notice back", async () => {
    const client = localClient();
    client.state.config = { ...client.state.config, backupDismissed: true };
    await renderIn("en", <Sheet client={client} />);
    expect(screen.getByText("You keep your own copy")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Move to Google Drive" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remind me again" }));
    await waitFor(() => expect(client.state.config.backupDismissed).toBe(false));
    expect(await screen.findByRole("button", { name: "Move to Google Drive" })).toBeTruthy();
  });

  it("names the provider of a synced folder", async () => {
    const client = new FakeClient(ready);
    client.state.backup = { status: { kind: "synced", provider: "icloud" }, locations: [] };
    await renderIn("en", <Sheet client={client} />);
    expect(screen.getByText("Kept in iCloud Drive")).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `corepack pnpm vitest run packages/ui/test/backup-notice.test.tsx packages/ui/test/settings.test.tsx`
Expected: FAIL — `BackupNotice` doesn't exist and Home has no `client` prop (the settings test already passes with the new `folderFixed` text from Step 1).

- [ ] **Step 4: Implement the notice**

`packages/ui/src/BackupNotice.tsx`:

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppState, HarnessClient, MoveError } from "./client";

/** The folder's own name (its last path segment): it keeps it when it moves. */
const folderName = (folder: string) => folder.replace(/\/+$/, "").split("/").pop() || folder;
const parentOf = (folder: string) => folder.replace(/\/+$/, "").replace(/\/[^/]*$/, "") || "/";

/** The notice shows when the folder is only on this computer and the person hasn't said they keep a copy. */
export function needsBackupNotice(state: AppState): boolean {
  return Boolean(state.config.folder) && state.backup?.status?.kind === "local" && state.config.backupDismissed !== true;
}

/**
 * The quiet backup notice (spec 3d §2): move the folder to a synced place or another place the person picks,
 * or say there is already a copy. Each failed move shows its own message; the folder stays where it was.
 */
export function BackupNotice({ client, state, onChange }: { client: HarnessClient; state: AppState; onChange: (s: AppState) => void }) {
  const { t } = useTranslation();
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<MoveError | null>(null);
  const [leftBehind, setLeftBehind] = useState<string | null>(null);
  const folder = state.config.folder;

  if (!folder) return null;
  if (!needsBackupNotice(state)) {
    return leftBehind ? (
      <p className="hh-backup-notice" role="status">
        {t("backup.leftBehind", { path: leftBehind })}
      </p>
    ) : null;
  }

  const move = async (to: string) => {
    setMoving(true);
    setError(null);
    try {
      const result = await client.moveFolder(to);
      if (result.ok) {
        if (result.leftBehind) setLeftBehind(result.leftBehind);
        onChange(result.state);
      } else setError(result.error);
    } catch {
      setError("failed");
    } finally {
      setMoving(false);
    }
  };
  // The person picks the place; the folder goes inside it with its own name (the main process checks the place).
  const chooseAnother = async () => {
    const picked = await client.pickFolder(parentOf(folder)).catch(() => null);
    if (picked) await move(`${picked.folder.replace(/\/+$/, "")}/${folderName(folder)}`);
  };
  const dismiss = () => void client.saveConfig({ backupDismissed: true }).then(onChange, () => {});

  return (
    <section className="hh-backup-notice" aria-label={t("backup.title")}>
      <p>{t("backup.notice")}</p>
      {error && (
        <div className="hh-error" role="alert">
          <p>{t(`backup.moveError.${error}`)}</p>
        </div>
      )}
      {moving ? (
        <p role="status">{t("backup.moving")}</p>
      ) : (
        <div className="hh-backup-actions">
          {(state.backup?.locations ?? []).map((l) => (
            <button key={l.path} onClick={() => void move(`${l.path}/${folderName(folder)}`)}>
              {t("backup.moveTo", { provider: t(`backup.provider.${l.provider}`) })}
            </button>
          ))}
          <button onClick={() => void chooseAnother()}>{t("backup.chooseAnother")}</button>
          <button onClick={dismiss}>{t("backup.dismiss")}</button>
        </div>
      )}
    </section>
  );
}
```

(The `alert`'s text is the `<p>` inside it, so `textContent` is exactly the message.)

`packages/ui/src/Home.tsx`:
- imports: `import { BackupNotice } from "./BackupNotice";` and change the client import to `import { type AppState, type EngineStatus, type HarnessClient, type LimitWindow, engineProblem } from "./client";`
- add to the props (destructuring and type): `client: HarnessClient;` and `/** The app state changed (the folder moved, the notice was dismissed). */ onChange: (state: AppState) => void;`
- inside `<main className="hh-home-main">`, after the engine pill/`noEngine` block, add `<BackupNotice client={client} state={state} onChange={onChange} />`.

`packages/ui/src/HarnessApp.tsx` — in `<Home …>`, add `client={client}` and `onChange={setState}`.

`packages/ui/src/SettingsSheet.tsx`:
- import `import { BackupNotice } from "./BackupNotice";`
- in `GeneralTab`, before `return`, add:

```tsx
  const backup = state.backup?.status;
  const backupText = !backup
    ? null
    : backup.kind === "synced"
      ? t("backup.status.synced", { provider: t(`backup.provider.${backup.provider}`) })
      : backup.kind === "local" && state.config.backupDismissed
        ? t("backup.status.dismissed")
        : t(`backup.status.${backup.kind}`);
```

- inside the first `hh-rows`, after the folder row, add:

```tsx
        {state.config.folder && backupText && (
          <div className="hh-row">
            <span className="hh-row-label">{t("backup.title")}</span>
            <span>{backupText}</span>
            {backup?.kind === "local" && state.config.backupDismissed && (
              <button onClick={() => void save({ backupDismissed: false })}>{t("backup.showAgain")}</button>
            )}
          </div>
        )}
```

- after the `folderFixed` / `FolderStep` conditional, add `<BackupNotice client={client} state={state} onChange={onChange} />`.

`packages/ui/src/styles.css`, after the `.hh-places` rules:

```css
.hh-backup-notice { display: grid; gap: 8px; max-width: 460px; padding: 12px 14px; border: 1px solid var(--hh-line); border-radius: 10px; background: var(--hh-surface); color: var(--hh-slate); font-size: 13px; }
.hh-backup-notice p { margin: 0; }
.hh-backup-actions { display: flex; flex-wrap: wrap; gap: 6px; }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/ui/test/backup-notice.test.tsx packages/ui/test/settings.test.tsx packages/ui/test/HarnessApp.test.tsx packages/i18n/test/i18n.test.ts`
Expected: PASS

- [ ] **Step 6: Typecheck, full tests, build, commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm app:build`
Expected: all green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-core add packages/ui/src/BackupNotice.tsx packages/ui/src/Home.tsx packages/ui/src/HarnessApp.tsx packages/ui/src/SettingsSheet.tsx packages/ui/src/styles.css packages/i18n/src/locales/en.json packages/i18n/src/locales/es.json packages/ui/test/backup-notice.test.tsx packages/ui/test/settings.test.tsx
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-core commit -m "feat(ui): backup notice on Home and in Settings, with move and its error cards" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019d45XaZQ8kSgiVYs5kCgGp"
```

---

## Phase 4 — End to end and docs

### Task 15: E2E — a turn edits a file and "Go back to before this task" brings it back

**Files:**
- Modify: `packages/e2e/tests/scripts.ts`
- Create: `packages/e2e/tests/history.spec.ts`

- [ ] **Step 1: The script**

Append to `packages/e2e/tests/scripts.ts`:

```ts
/** Claude: the manifest topic rewrites plan.md in the person's folder (history by task). */
export const historyScript: ClaudeScript = {
  steps: [...claudeTextLines("Listo."), result],
  turns: [
    {
      match: "# Topic: the manifest",
      steps: [{ write: { path: "plan.md", content: "cambiado por la IA\n" } }, ...claudeTextLines("Cambié tu plan."), choices, result],
    },
  ],
};
```

- [ ] **Step 2: The test**

`packages/e2e/tests/history.spec.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { closeAndClean, launch, makeSandbox } from "./helpers";
import { historyScript } from "./scripts";

const START = "¿Qué parte querés entender?";
const readTasks = (folder: string) => JSON.parse(fs.readFileSync(path.join(folder, ".harness", "tasks.json"), "utf8"));
const plan = (folder: string) => fs.readFileSync(path.join(folder, "plan.md"), "utf8");

test("a turn edits a file; going back to before the task brings it back, and the panel shows the restore", async () => {
  const s = makeSandbox("history");
  fs.writeFileSync(path.join(s.folder, "plan.md"), "mi plan original\n");
  const { app, page } = await launch(s, { claude: historyScript });
  try {
    await page.getByRole("button", { name: "Iniciar Demo" }).click();
    await page.getByRole("region", { name: START }).getByRole("button", { name: /El manifiesto/ }).click();
    await expect(page.getByRole("main").getByText("Cambié tu plan.")).toBeVisible();
    // The text shows before the turn ends: wait until the task waits (its commit is made by then).
    await expect.poll(() => readTasks(s.folder).current?.status).toBe("waiting");
    expect(plan(s.folder)).toBe("cambiado por la IA\n");

    await page.getByRole("button", { name: "Historial" }).click();
    const panel = page.getByRole("dialog", { name: "Historial" });
    await expect(panel.getByRole("button", { name: /El manifiesto.*1 archivo cambiado/ })).toHaveAttribute("aria-expanded", "true");
    await expect(panel.getByRole("list", { name: "Archivos cambiados" }).getByText("plan.md")).toBeVisible();
    await panel.getByRole("button", { name: "Volver a antes de esta tarea" }).click();
    await panel.getByRole("button", { name: "Sí, volver" }).click();
    await expect(panel).toBeHidden();
    await expect.poll(() => plan(s.folder)).toBe("mi plan original\n");

    await page.getByRole("button", { name: "Historial" }).click();
    const again = page.getByRole("dialog", { name: "Historial" });
    await expect(again.getByRole("button", { name: /El manifiesto.*0 archivos cambiados/ })).toHaveAttribute("aria-expanded", "true");
    await expect(again.getByText("Volviste a antes de esta tarea")).toBeVisible();
  } finally {
    await closeAndClean(app, s);
  }
});
```

- [ ] **Step 3: Run it**

Run: `corepack pnpm e2e`
Expected: every spec passes, `history.spec.ts` included (it builds the shell first). If the row's accessible name differs because of the date format, keep the regex anchored on the label and the files count only, as written.

- [ ] **Step 4: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-core add packages/e2e/tests/scripts.ts packages/e2e/tests/history.spec.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-core commit -m "test(e2e): going back to before a task brings the file back" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019d45XaZQ8kSgiVYs5kCgGp"
```

### Task 16: Docs — `docs/architecture/history.md`

**Files:**
- Modify: `docs/architecture/history.md`

- [ ] **Step 1: Rewrite the page**

Replace the whole file with:

```markdown
# Folder, history and backup

## The folder

- The person's folder is visible and theirs. The app prepares it (`prepareFolder` in `packages/workspace/src/folder.ts`), writes the instructions there and keeps its own files under `.harness/`: chats, usage, tasks and notes.
- The folder is chosen once. The only way to change it afterwards is "Move to …" (below), which moves the files and the history together.

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

  The task manager passes the task id and action with each turn (`TurnOptions.task`/`action` → `HarnessRuntime.send(…, { trailer })`) and with each note (`TaskDeps.saveHistory(message, trailer)`). A restore carries the task it went back to. "Start" stays untagged: it records changes made outside the app.
- `History.tasks(depth)` groups commits by `Task:` (not by adjacency), newest first. Each group has `start` (the parent of its first commit), `end`, the tree diff between them (`FileChange[]`, tracked files only, from `git.walk` over two trees) and its entries. Untagged commits form the "Earlier" group, always last, whose changes are the union of its commits' own changes.

### The History panel

- One row per task: the action's label (or "A question"), the title of the note it saved, the date and "N files changed". The newest row starts open.
- An open row lists the changed files (added, changed, deleted) and the task's entries in plain language (i18n keys `history.entry.*`; the commit subjects stay in English).
- "Go back to before this task" restores the group's `start`; "Go back to this point" restores one entry. Both ask first, record a new commit (so they can be undone too) and are disabled while a turn is live; the main process refuses them while a task operation runs or turns are held.

## Backup

- `syncStatus(folder)` in `packages/workspace/src/backup.ts` reads only the path and `.git/config`: `synced` (under `~/Library/CloudStorage/GoogleDrive-*`, `OneDrive-*`, `Dropbox*`, `~/Dropbox`, or iCloud Drive), `git-remote` (the folder or a folder above it, below home, has a `[remote "…"]` with a `url`), or `local`. `syncLocations()` lists the synced places on this computer by folder names (Google Drive's `My Drive`/`Mi unidad`).
- It never reads `~/.claude`, `~/.codex`, `~/.gemini`, account or token files, or a provider's own settings, and never runs a provider CLI. The CloudStorage folder names (which can contain an account name) are never shown or logged.
- First launch offers the synced places first. Afterwards a quiet notice on Home and in Settings › General says when the folder is `local`: "Move to <provider>", "Choose another place…" or "I already have a copy" (`backupDismissed` in the app config; Settings › General brings it back).

### Moving the folder

`moveFolder` (`packages/shell/src/main/move-folder.ts`), refused while a turn runs, with turns and restores held off meanwhile:

1. Refuse a place inside the folder (or containing it), one that exists, one `checkFolder` refuses, or one without enough free space.
2. Copy (`fs.cp`, recursive, keeping timestamps and links).
3. Verify: same relative files and sizes; same bytes for the files the history tracks. Then the notes' `files:` entries that name the old place become relative.
4. Save the new folder in the config (`ConfigStore.replaceFolder`).
5. Rename the history data folder to the new folder's (a stale one is set aside).
6. Remove the old folder.

A failure before step 6 undoes what was done and the old folder stays the app's folder; a failure at step 6 leaves the move done and the app says where the old folder is. Each failure has its own message (`backup.moveError.*`). The runtime is closed before moving; the open task stays open and its next message starts a new engine session from the notes (`TaskManager.resumeFromNotes`, `RESUME_PROMPT`), because engine sessions are tied to the folder's path.

What under `.harness/` names a place: only notes' `files:` (agent-provided paths, stored relative since plan 3d and rewritten by the move). `tasks.json` holds the engine session id (dropped by the move); chats keep their text as it was said.

## Open questions

- iCloud "Desktop & Documents" keeps `~/Documents` at the same path. The plan 3d spike found no credential-free signal for it (only `com.apple.macl` on `~/Documents`, on a Mac with the feature off), so `~/Documents` counts as `local` and the person can dismiss the notice. Re-check on a Mac with the feature on.
- No size limit for the history yet: a folder with large media inflates it in the app's data folder.
```

- [ ] **Step 2: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-core add docs/architecture/history.md
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-core commit -m "docs: history by task, backup status and moving the folder" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019d45XaZQ8kSgiVYs5kCgGp"
```

---

## Spec coverage

| Spec point | Task |
|---|---|
| §1 Recording: trailers on Before message / Turn / Stopped / Undo / Note / restore | 1, 3, 4, 5 (Start: see Decisions) |
| §1 Reading: `History.tasks(depth)`, `HistoryTask`, `FileChange` via `git.walk`, tracked only, "Earlier" | 2 |
| §1 Panel: rows, note title, date, N files, expand, files with marks, entries, both restores, new commit, disabled while live | 5, 6 |
| §1 Plain language entries | 6 |
| §2 `syncStatus`, `syncLocations`, `.git/config` remote, compliance | 7 |
| §2 Spike for iCloud Desktop & Documents | 0 |
| §2 FolderStep offers synced places with `folder.suggested` | 8, 9 |
| §2 Notice on Home and Settings › General, Move / Choose another / I already have a copy, `backupDismissed`, undo in Settings | 8, 14 |
| §2 `moveFolder` steps 1–6, rollback, step-6 failure message, refused while a turn runs | 12, 13, 14 |
| §2 Open tasks continue in a new session from the notes | 11, 13 |
| §2 Absolute paths under `.harness/` | 10, 12 (table above) |
| §2 Errors: own card per failure, es/en | 14 |
| Tests: unit, UI, E2E | 1–15 |
| Docs: `history.md` (roadmap row 3d already present) | 16 |
