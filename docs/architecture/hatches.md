# Harness hatches

A hatch is a small, generic extension point: the core adds an option any harness may declare and does nothing harness-specific with it (spec D4). The core validates, passes paths and flags, and shows what the person must approve; it never runs git, a terminal or a harness's business logic. Spec: `docs/superpowers/specs/2026-10-27-harness-hatches-design.md`. Three are planned: H1 linked folders (built, this page), H2 a harness backend and H3 engine config per scope (not built yet).

## H1: linked folders

A harness may declare `linkedFolders`: kinds of folders outside the person's work folder that a scope can link. The person links them one by one through the system picker; the agent of a task in that scope then gets file access to them. A linked folder with git is left to its own git; one without is tracked by a core history of its own (D1). Spec §3, plan `docs/superpowers/plans/2026-10-28-harness-hatches-part1.md`.

### The manifest

```ts
scopes: { label: "Project", plural: "Projects" },
permissions: { edit: "folder", exec: true, web: false },
linkedFolders: {
  repos: { label: "Repos", mode: "write", history: "auto", many: true },
  specs: { label: "Specs", mode: "read" },
},
```

`linkedFolderSchema`, `hasLinkedFolders` and `hatchProblems` (`packages/harness-sdk/src/hatches.ts`). Strict: a typo is refused.

- Keys follow `^[a-z][a-z0-9_-]{0,63}$`; at most 8 (`LINKED_KEYS_MAX`). A key such as `constructor` is valid, so every lookup uses `Object.hasOwn`.
- `label`: 1 to 40 characters, one English string, no hidden characters (Decision 1).
- `mode`: `read` (the agent reads only) or `write`. `history`: `auto` (the default: tracked unless the folder is a git repository) or `own` (the folder must be a git repository). `many`: several folders under the key (at most 16, `LINKED_MANY_MAX`), or one (the default).
- Checks: `linkedFolders` needs `scopes`; a `write` key needs `permissions.edit: "folder"`.

`hasLinkedFolders(h)` is false for an absent or empty `linkedFolders`: no part-1 code runs (D0, below).

### Linking

**Who links.** The person, from Scope settings (a "Settings" button next to the scope picker, shown only with `state.hatches`: `ScopeSettings.tsx`, `LinkedFolders.tsx` in `packages/ui/src/hatches/`), or the harness UI through `client.scopes.linkFolder(scope, key)`. Either way `hh:scopeLinkFolder(scope, key)` takes no path: main always opens `dialog.showOpenDialog` itself (L1). A cancelled picker links nothing. A key that isn't `many` and already has a folder is refused before the picker opens (`one-only`); a full `many` key is `too-many`.

**Refusals** (`linkRefusal`, `checkLink` in `packages/shell/src/main/linked-folders.ts`). Checked on the path as written and again on its real path (links resolved), against a context whose home, work folder, app folder and other links are resolved too. Compared without case, as `validate.ts` does. Each reason has a sentence under `hatches.refused.*` in `en.json`:

| Reason | What |
|---|---|
| `unsafe-name` | A comma, `( ) * ? [ ] { }`, a control or hidden character, a backtick or a backslash: Claude's permission rules couldn't spell it (`ruleUnsafePath`), or `AGENTS.md` couldn't name it on one line |
| `home` | The home folder itself |
| `engine-home` | `~/.claude`, `~/.codex`, every other dot folder in home, and anything inside them |
| `system` | `/`, `/System`, `/usr`, `/Applications`, `C:\Windows`… |
| `protected` | `~/Library` and the other protected places of `validate.ts` |
| `too-broad` | A standard folder such as `~/Documents` (checked before the main-folder rule) |
| `main-folder` | The work folder, a folder inside it, a folder that contains it; with profiles, anything in the app's folder |
| `other-scope-write` | (write links only) another scope's or another profile's write folder, or a folder inside or around it. Read links may overlap |
| `nested` | Inside, or around, another folder this scope links |
| `already-linked` | This scope already links it |
| `not-git` | `history: "own"` and the folder has no git |
| `not-folder` | A file, a missing folder, a relative path |
| `reference` | (write links only) the folder is, or is inside, one of the manifest's reference folders: their read-only rules would win |
| `one-only`, `too-many` | The key's count, above |

**Git** (`isGitRepo`, Decision 3): `<dir>/.git` is a folder holding `HEAD`, or a regular file of at most 4 KB whose first line starts with `gitdir:` (a worktree or submodule). It is opened with `O_NOFOLLOW`: a link at `.git` counts as no git and is never followed. Nothing else in the folder is read.

**Tracked** (Decision 2): `mode === "write"` and no git at link time. A read folder is never tracked: the agent can't change it.

**Storage.** On the scope's entry in `.harness/scopes.json` (`ScopeStore.link`, `unlink`, `setTracked`, `markGitChanged`; `data.md`): `linked: [{ key, path, mode, tracked, gitChanged?, tag, nonce }]`. `path` is the real path with the case on disk (`fs.realpath.native`). An entry with no links is written exactly as before.

**Signed links** (L10). `scopes.json` sits in the folder the agent can write, so a stored link counts only when the app signed it:
- `tag` is an HMAC-SHA256, with a key in the app's data folder (`<userData>/linked-key`, 0600, made at the first link), over `["hh-link-v2", profile, scope, key, path, mode, tracked, nonce]` (`linkTag`). The profile is its id (`""` without profiles), so the same scope slug in two profiles can't share a link, and moving the folder keeps the links.
- `nonce` is random per link. The live nonces, by (profile, scope, nonce), are kept in `<userData>/linked-live.json` (`LiveLinks`, atomic, 0600). Unlink retires the nonce first, so pasting an earlier signed entry back after an unlink never relinks it.
- A link with a missing or bad tag, or a nonce that isn't live, is ignored everywhere: never in a turn, `AGENTS.md`, a first message, an undo, nor in Scope settings. Linking drops the scope's unsigned entries.
- Link, unlink and the git confirm run one at a time in one queue; `setTracked` signs inside the store's write and refuses when the entry changed on disk meanwhile.

**Unlink** (`hh:scopeUnlinkFolder`) removes only an entry equal to a stored one and never touches the folder. Its core history is kept (below).

**Moving the work folder** keeps linked paths as they are: they are absolute and outside it.

### Re-checked at every use

`createScopeAccess` (`packages/shell/src/main/scope-access.ts`) reads the links afresh for every turn, every `AGENTS.md` write, every first message and every undo. A link counts only when:
- it is signed for this profile and scope and its nonce is live;
- the manifest still declares its key, with the mode the link was made for: a harness update that changes a key's mode (say `read` to `write`) drops its stored links as `mode-changed`, and the person links them again (what they agreed to, and whether the folder is tracked, was decided for the old mode);
- `checkLink` still passes it with today's context (home, the folder, the app's folder, this scope's other links, the other scopes' and profiles' write folders);
- its real path still equals the stored path (a folder swapped for a link, moved or gone is dropped as `moved`);
- a write link isn't inside a reference folder added since.

A dropped link is logged once per folder and reason, and the turn runs without it: a missing folder never fails every turn. Scope settings runs the same checks (`ScopeAccess.dropped`, passed to `hh:scopeLinked`): each dropped link carries `dropped: <reason>` and its row says the agent doesn't get the folder now, and why; the person unlinks it and links it again. A scope with no stored link reads no key, no other profile and no folder.

### To the agent

A turn carries a `TurnScope` (`packages/runtime/src/transport.ts`): `{ linked: LinkedAccess[] }`, each `{ path, mode, tracked }`, built for **each turn** from the turn's task scope (`TurnDeps.scopeAccess`, L5), never from the open scope or a window argument, and passed through `SlotSendOptions.scope` to `Transport.turn(…, scope)`. Linking or unlinking mid-task reaches the next turn (Decision 4). System tasks (Sidekick, language: `noTools`, `mcpOnly`) never get one; `claudeArgs` throws if they do.

- **Claude** (`claude-cli.ts`, `scopeSettingsArgs`). Linked paths join the reference folders in the one `--settings '{"permissions":{"additionalDirectories":[…]}}'` (references first); never `--add-dir`, so a linked folder's `.claude/skills`, `commands` and `agents` are not loaded (`engines.md`; not checked live). A `read` folder gets the references' `Edit`/`Write`/`MultiEdit` deny rules by absolute path. A `write` folder gets explicit allow rules (`Edit(//<path>/**)`, `Write(…)`, `MultiEdit(…)`, only under `edit: "folder"`, Decision 8) and deny rules for `<path>/.claude/**` and `<path>/.git/**`; deny wins. A path no rule can spell makes `claudeArgs` throw.
- **Codex and OpenCode** (`acp.ts`). `initialize` must advertise `sessionCapabilities.additionalDirectories`. Then the `write` folders go in `additionalDirectories` on `session/new` and on every `session/load` (only when there is one; otherwise the params are today's). A changed list reopens the session before the prompt (`reopenWithDirs`): `session/load` with the new list, which replaces the old one (not checked live), or, without `loadSession`, a new session starts and the conversation is lost (Decision 9). `read` folders are never sent (the engine's sandbox would make them writable): they join `decidePermission`'s read roots. The policy's roots are replaced before every prompt. Write roots refuse edits under `<root>/{.git,.codex,.agents,.opencode,.claude}/**` (any case), the root itself, and any path whose real path leads out of the root or into those folders. Without the capability no folder is sent and the policy grants nothing under them; the transport calls `onLinkedUnsupported()` once, and Scope settings says "Linked folders don't work with this version of Codex yet." (Decision 15). OpenCode follows the same rule (Decision 10).

**`AGENTS.md`** (`instructions.ts`, `linkedFolderLines`). In plain and single mode the managed section gains "### Folders of this scope" for the open scope, after the references: one line per folder, `` - `key` (Label, read and write): `path` `` (line breaks and hidden characters folded, a backtick becomes `'`). The rule "Work only inside this folder." becomes "Work only inside this folder and the folders of this scope listed below." only when the section is there. `RuntimeOptions.instructionLinked` is read at create and on every `refreshInstructions`; `LinkedInstructions` marks it stale on a link change or a scope switch, rewrites it once no task is open, and retries in `betweenTasks` when a running turn refused the rewrite.

**Board mode** (Decision 6). Lanes can run in different scopes at once while `AGENTS.md` is shared, so the managed section lists no folders and each task's first message carries the same section for its own scope (`TaskDeps.linkedContext`), shown in the context panel as the "Folders of this scope" item (kind `linked-folders`, `context.md`). A scoped job gets its scope's `TurnScope` and section too (`jobScope`, `JobRunDeps.scopeAccess`).

### History

A **tracked** linked folder (write, no git) has a core history of its own: an isomorphic-git `History` whose gitdir is `<userData>/linked-history/<first 16 hex of sha256(real path)>` (`linkedHistoryDir`, Decision 5), opened by the workspace (`RuntimeOptions.linkedGitdir`) the first time a turn names the folder.

- Each turn of a scope with tracked folders runs `beginTurn`/`endTurn` on every one of them with the same trailer, main folder first: turns commit both, the crash undo restores both, and attribution runs per folder. Only the main folder's conflicts reach `onAttribution`; a linked folder's are logged (Decision 11).
- A turn fails before any commit when a tracked root overlaps the main folder or another open linked history, or when the folder's real path no longer equals the stored one.
- **"Undo this task"** restores both (`linked-restore.ts`): plain mode inside the same restore guard (`restoreLinkedTask`), board and single mode by paths over every history (`restoreTaskWithLinked`), checking every history before restoring any. Running turns' paths in a linked folder refuse it as they do in the main folder (`linkedRunningPaths`). A linked-only task (its changes only in a linked folder) is found and undone. When a later phase still refuses after something was restored, the answer is a partial undo, `UndoRefusal { reason: "partial", workFolder, restored, notRestored, cause }`, and the History panel says "Undone in {folders}. Not undone in {folder}: {cause}".
- **"Go back here"** stays main-folder only (Decision 12).
- An **untracked** folder (git, or a read folder) is never committed or restored: its own git is its history (L7). The History panel says, per such write folder, "Undo doesn't cover this folder: it has its own git." (only with no scope filter or the open scope's), and lists a tracked folder's changes under the task rows (`hh:linkedHistory`, `linkedHistoryView`).
- **Unlink** writes `<dir>/unlinked-at` (ISO time) only when no other tracked link to that folder remains in any scope of any profile; a relink, and every open of the history, removes it. At start, before the link channels answer, `pruneUnlinked` puts histories unlinked more than 30 days ago in the system Trash; a failure is logged and the history kept. The prune never follows a link.

**Gaining or losing git** (Decision 13). Checked when the scope opens and when Scope settings opens (`checkGitChanges`, signed write links only). The entry gets `gitChanged: true` and keeps its `tracked` until the person answers in Scope settings: "This folder now has its own git." offers "Leave to its own git"; "This folder no longer has git." offers "Track with the app's history" or "Leave to its own git", the first never for a `history: "own"` key (`hh:scopeConfirmGit`, which refuses tracking a git or read folder, or one of a `history: "own"` key). While marked, undo leaves the folder out. The old core history stays either way.

### IPC and state

Registered only under `hasLinkedFolders` (`registerLinkedIpc`, `linked-ipc.ts`): `hh:scopeLinked` (the scope's signed links, after the git check), `hh:scopeLinkFolder`, `hh:scopeUnlinkFolder`, `hh:scopeConfirmGit`, `hh:linkedHistory`. Every handler waits for the start's prune. Window input is untrusted (L9): the scope must pass `isScopeId` and be registered and unarchived, the key `Object.hasOwn` of the manifest and at most 64 characters, an unlink's path equal to a stored entry. `hh:scopes` no longer sends `linked`. `AppState.hatches` (`hatchesState`) carries the keys with label, mode, history and `many`; `hh:scopeLinked` answers `{ folders, unsupported }` (a folder the per-use checks drop carries `dropped`), the second being main's flag for an engine without the capability. `client.scopes.linked/linkFolder/unlinkFolder/confirmGit/linkedHistory` in `packages/ui/src/client.ts`.

## D0

A harness without `linkedFolders` runs no part-1 code: the same argv, environment, ACP requests, `AGENTS.md`, `scopes.json`, history commits, IPC channels and UI.

| What stays as before | Pinned by |
|---|---|
| The manifest | `packages/harness-sdk/test/hatches.test.ts` ("D0: a manifest without hatches parses to the same object") |
| Claude argv | `packages/runtime/test/claude-cli.test.ts` goldens; `packages/runtime/test/hatches-d0.test.ts` ("claudeArgs without a scope, or with an empty one, is the golden argv") |
| ACP requests | `hatches-d0.test.ts` ("session/new and session/load carry exactly cwd and mcpServers without linked folders") |
| `AGENTS.md` | `packages/workspace/test/instructions.test.ts` ("D0: no linked folders is exactly today's section") |
| History commits | `packages/runtime/test/runtime-d0.test.ts`; `packages/runtime/test/workspace-linked.test.ts` ("D0: a turn without linked folders opens no linked history") |
| `scopes.json` | `packages/workspace/test/scopes.test.ts` ("D0: an entry without links is written exactly as before") |
| IPC and state | `packages/shell/test/hatches-surface.test.ts`: channels only under `hasLinkedFolders`, no `hatches` in `AppState` |
| No key read | `packages/shell/test/scope-access.test.ts` ("D0: a scope without links reads no key, no other profile and no folder") |
| UI | `packages/ui/test/hatches-ui.test.tsx` (no Settings button, no linked lines without `state.hatches`) |
| End to end | `packages/e2e/tests/history.spec.ts` (the demo's commit messages) |

## Threat model

| # | Boundary | What enforces it | Test |
|---|---|---|---|
| L1 | Nothing is linked without the person choosing it | `hh:scopeLinkFolder` takes no path; main opens the picker | `linked-ipc.test.ts` ("a path argument is ignored; the picker always opens (L1)") |
| L2 | Picker refusals, links resolved | `checkLink` on the path as written and real, the context resolved; re-run at every use | `linked-folders.test.ts` (each refusal through a symlink); `scope-access.test.ts` ("a folder swapped for a link into ~/.claude is refused again (L2)") |
| L3 | The agent can't edit a repo's own config with its file tools | Claude: deny `.claude/**`, `.git/**` in write folders, `additionalDirectories` never `--add-dir`; ACP: write roots refuse `.git`, `.codex`, `.agents`, `.opencode`, `.claude` (any case, through links). Edits only: on Codex a listed write folder's existing `.codex/config.toml` (hooks, MCP) and `.agents/skills` may load (Known gaps) | `claude-cli.test.ts` "linked folders"; `acp.test.ts` "linked folders on ACP", "decidePermission with linked folders" |
| L4 | `read` folders stay read-only | Claude: edit deny rules; ACP: never in `additionalDirectories`, only read roots | the same blocks |
| L5 | Another scope's folders never reach a turn | `TurnScope` from the turn's task scope | `scope-access.test.ts` ("L5: another scope's folders never reach this scope's turn…") |
| L6 | Unlink takes effect at once | Claude per turn; ACP reloads the session on a changed list, roots replaced before the prompt | `acp.test.ts` (a changed list reloads the session) |
| L7 | Undo never writes outside a tracked folder or into a git one | linked histories only for tracked, unmarked write links, git re-checked failing closed; `History.restore`'s link checks | `workspace-linked.test.ts`, `linked-restore.test.ts` |
| L8 | The app never reads `~/.claude`, `~/.codex` | refusals are path comparisons; `isGitRepo` reads only `<linked>/.git` | `linked-folders.test.ts` ("compliance (L8)", a source scan) |
| L9 | Untrusted ids from the window | `isScopeId` + registered; `Object.hasOwn` key ≤ 64; unlink path equal to a stored one | `linked-ipc.test.ts` ("refuses an undeclared key, an unknown or archived scope, a too-long id (L9)") |
| L10 | The agent can't add a link by editing `scopes.json` | HMAC tag over profile, scope, key, path, mode, tracked and nonce; live nonce set in `userData` | `scope-access.test.ts` ("a hand-added link … never reaches the turn", "a signed entry copied into another scope, or pasted back after its unlink, never counts (L1)") |

What the threat model doesn't cover:
- **Bash.** With `exec: true` the agent's shell can write into read folders, reference folders and a write folder's `.git/hooks` or `.claude/`: the deny rules are file-tool rules only. This was already true for reference folders.
- **Codex inside its writable roots.** Whether Codex asks permission for a write inside a folder it was given as writable is unverified (S1 live check). If it doesn't, the `.claude`, `.agents`, `.opencode` refusals never run there and only Codex's own sandbox applies.
- **Case on Claude.** Whether Claude's rule matcher treats `.Claude/**` or `.GIT/**` as `.claude/**`, `.git/**` on a case-insensitive APFS volume is unknown; the deny rules name the lower-case form only. The ACP side compares without case.

## Decisions

1. `label` is one English string.
2. `tracked` = write and no git at link time; a read folder is never tracked; `history: "own"` refuses a non-git folder.
3. Git = `.git` folder with `HEAD`, or a `.git` file starting `gitdir:`; a link at `.git` is no git.
4. The linked list is built per turn from the task's scope; a link made mid-task reaches the next turn.
5. Linked histories live under `<userData>/linked-history/<hash>`; unlink marks them, 30 days later they go to the Trash.
6. Board mode: no folders in `AGENTS.md`; each task's first message carries its scope's section.
7. "Work only inside this folder and the folders of this scope listed below." only when the section is there.
8. Explicit allow rules for write folders on Claude next to `additionalDirectories`; deny rules still win.
9. ACP without `loadSession` and a changed list: a new session, the conversation lost.
10. OpenCode gets linked folders only when its adapter advertises the capability.
11. Attribution runs per tracked folder; only the main folder's conflicts reach the board's notices.
12. "Go back here" stays main-folder only; "Undo this task" and the crash undo cover tracked folders.
13. A folder that gains or loses git is marked at scope open and Scope settings open; the person confirms.
14. Scope settings is a sheet from a "Settings" button next to the scope picker, only with `state.hatches`.
15. Codex without the capability: one flag in main, a line in Scope settings, no folder sent.

PR decision reversed during review: a write link inside or around another scope's (or profile's) write folder is refused (`other-scope-write`), since two core histories would overlap; earlier only the exact folder was.

## Known gaps

- **Live checks still pending.** S1: whether a trusted linked folder's `.codex/config.toml` loads; Codex's `read-only` refusal inside a listed folder; `session/load` with a different list. S2: `permissions.additionalDirectories` under `acceptEdits` together with the deny rules; that a linked folder's `.claude/agents` are not loaded in `-p`.
- **Codex trusts every listed write folder as a project**, so its `.codex/config.toml` (hooks, MCP servers) and `.agents/skills` may load. The core denies edits there but can't see or approve what is already in the repo (spec §3.3).
- **A linked folder's history has no size limit**, as the main one's.
- **An undo over several folders can stop half way.** Board and single mode check every history before restoring any, but a turn already under way can write between the checks and the restores: the work folder may be restored and a linked one refused. In board and single mode the History panel reports the partial undo ("Undone in … Not undone in …"). Plain mode restores the work folder, then each tracked folder, with no check across them; a failure in a linked folder shows only the generic failure, though the work folder was restored. Nothing is rolled back.
- **The file timeline** (plan 16, `timeline.md`) covers only the main folder: a tracked linked folder's files have no timeline, and the "not covered" line shows only in the History panel (spec §3.4 names both).
- **A write link inside a reference folder** is refused at the picker; one that a reference added later now covers is dropped at use (logged, and shown on its row in Scope settings).
- **OpenCode's cost after a reload.** A changed list reopens the session, and a reopen resets OpenCode's cost baseline: the turn after records no cost (`engines.md`, "Cost").
- **Synced drives**: no extra warning for a linked folder in a synced drive (spec §10 Q1).

## Where to look

- `packages/harness-sdk/src/hatches.ts`; `packages/workspace/src/scopes.ts` (`LinkedFolderEntry`), `instructions.ts` (`linkedFolderLines`).
- `packages/runtime/src/transport.ts` (`LinkedAccess`, `TurnScope`), `claude-cli.ts` (`scopeSettingsArgs`, `ruleUnsafePath`), `acp.ts`, `workspace.ts` (linked histories), `runtime.ts` (`instructionLinked`, `linkedGitdir`).
- `packages/shell/src/main/linked-folders.ts`, `linked-history.ts`, `linked-ipc.ts`, `scope-access.ts`, `linked-restore.ts`; wiring in `index.ts`, `turn-controller.ts`, `task-manager.ts`, `board-host.ts`, `jobs/job-runner.ts`.
- `packages/ui/src/hatches/`, `ScopePicker.tsx`, `HistoryPanel.tsx`, `ContextPanel.tsx`; `en.json` `hatches.*`.
- Tests: the D0 and threat-model tables above; `packages/fake-agent/fixtures/hatches-harness`; `packages/e2e/tests/hatches-linked.spec.ts`.
