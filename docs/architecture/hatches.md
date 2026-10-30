# Harness hatches

A hatch is a small, generic extension point: the core adds an option any harness may declare and does nothing harness-specific with it (spec D4). The core validates, passes paths and flags, and shows what the person must approve; it never runs git, a terminal or a harness's business logic. Spec: `docs/superpowers/specs/2026-10-27-harness-hatches-design.md`. Three are built, all on this page: H1 linked folders, H2 a harness backend and H3 engine config per scope.

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

A turn carries a `TurnScope` (`packages/engines/src/contract.ts`): `{ linked: LinkedAccess[] }`, each `{ path, mode, tracked }`, built for **each turn** from the turn's task scope (`TurnDeps.scopeAccess`, L5), never from the open scope or a window argument, and passed through `SlotSendOptions.scope` to `Transport.turn(…, scope)`. Linking or unlinking mid-task reaches the next turn (Decision 4). System tasks (Sidekick, language: `noTools`, `mcpOnly`) never get one; `claudeArgs` throws if they do.

- **Claude** (`claude-cli.ts`, `settingsArgs`). Linked paths join the reference folders in the one `--settings '{"permissions":{"additionalDirectories":[…]}}'` (references first); never `--add-dir`, so a linked folder's `.claude/skills`, `commands` and `agents` are not loaded (`engines.md`; not checked live). A `read` folder gets the references' `Edit`/`Write`/`MultiEdit` deny rules by absolute path. A `write` folder gets explicit allow rules (`Edit(//<path>/**)`, `Write(…)`, `MultiEdit(…)`, only under `edit: "folder"`, Decision 8) and deny rules for `<path>/.claude/**` and `<path>/.git/**`; deny wins. A path no rule can spell makes `claudeArgs` throw.
- **Codex and OpenCode** (`acp.ts`). `initialize` must advertise `sessionCapabilities.additionalDirectories`. Then the `write` folders go in `additionalDirectories` on `session/new` and on every `session/load` (only when there is one; otherwise the params are today's). A changed list reopens the session before the prompt (`reopenWithDirs`): `session/load` with the new list, which replaces the old one (not checked live), or, without `loadSession`, a new session starts and the conversation is lost (Decision 9). `read` folders are never sent (the engine's sandbox would make them writable): they join `decidePermission`'s read roots. The policy's roots are replaced before every prompt. Write roots refuse edits under `<root>/{.git,.codex,.agents,.opencode,.claude}/**` (any case), the root itself, and any path whose real path leads out of the root or into those folders. Without the capability no folder is sent and the policy grants nothing under them; the transport calls `onLinkedUnsupported()` once, and Scope settings says "Linked folders don't work with this version of Codex yet." (Decision 15). OpenCode follows the same rule (Decision 10).

**`AGENTS.md`** (`instructions.ts`, `linkedFolderLines`). In plain and single mode the managed section gains "### Folders of this scope" for the open scope, after the references: one line per folder, `` - `key` (Label, read and write): `path` `` (line breaks and hidden characters folded, a backtick becomes `'`). The rule "Work only inside this folder." becomes "Work only inside this folder and the folders of this scope listed below." only when the section is there. `RuntimeOptions.instructionLinked` is read at create and on every `refreshInstructions`; `LinkedInstructions` marks it stale on a link change or a scope switch, rewrites it once no task is open, and retries in `betweenTasks` when a running turn refused the rewrite.

**Board mode** (Decision 6). Lanes can run in different scopes at once while `AGENTS.md` is shared, so the managed section lists no folders and each task's first message carries the same section for its own scope (`TaskDeps.linkedContext`), shown in the context panel as the "Folders of this scope" item (kind `linked-folders`, `context.md`). A scoped job gets its scope's `TurnScope` and section too (`jobScope`, `JobRunDeps.scopeAccess`).

### History

A **tracked** linked folder (write, no git) has a core history of its own: an isomorphic-git `History` whose gitdir is `<userData>/linked-history/<first 16 hex of sha256(real path)>` (`linkedHistoryDir`, Decision 5), opened by the workspace (`RuntimeOptions.linkedGitdir`) the first time a turn names the folder.

- Each turn of a scope with tracked folders runs `beginTurn`/`endTurn` on every one of them with the same trailer, main folder first: turns commit both, the crash undo restores both, and attribution runs per folder. Only the main folder's conflicts reach `onAttribution`; a linked folder's are logged (Decision 11).
- A turn fails before any commit when a tracked root overlaps the main folder or another open linked history, or when the folder's real path no longer equals the stored one.
- **"Undo this task"** restores both (`linked-restore.ts`): plain mode inside the same restore guard (`restoreLinkedTask`), board and single mode by paths over every history (`restoreTaskWithLinked`), checking every history before restoring any. Running turns' paths in a linked folder refuse it as they do in the main folder (`linkedRunningPaths`). A linked-only task (its changes only in a linked folder) is found and undone; `hh:historyTasks` gives it a row of its own (`linkedOnlyRows`: no files or entries of the work folder's, its changes under each folder's label, its count including them), so "Undo this task" shows for it. When a later phase still refuses after something was restored, the answer is a partial undo, `UndoRefusal { reason: "partial", workFolder, restored, notRestored, cause }`, and the History panel says "Undone in {folders}. Not undone in {folder}: {cause}".
- **"Go back here"** stays main-folder only (Decision 12).
- An **untracked** folder (git, or a read folder) is never committed or restored: its own git is its history (L7). The History panel says, per such write folder, "Undo doesn't cover this folder: it has its own git.", or, for one with no git now that the app's history doesn't track (it lost its git), "…: it has no git, and the app's history doesn't track it." (`uncovered[].noGit`; git that can't be told keeps the first line), only with no scope filter or the open scope's, and lists a tracked folder's changes under the task rows (`hh:linkedHistory`, `linkedHistoryView`).
- **Unlink** writes `<dir>/unlinked-at` (ISO time) only when no other tracked link to that folder remains in any scope of any profile; a relink, and every open of the history, removes it. At start, before the link channels answer, `pruneUnlinked` puts histories unlinked more than 30 days ago in the system Trash; a failure is logged and the history kept. The prune never follows a link.

**Gaining or losing git** (Decision 13). Checked when the scope opens and when Scope settings opens (`checkGitChanges`, signed write links only). The entry gets `gitChanged: true` and keeps its `tracked` until the person answers in Scope settings: "This folder now has its own git." offers "Leave to its own git"; "This folder no longer has git." offers "Track with the app's history" or "Leave to its own git", the first never for a `history: "own"` key (`hh:scopeConfirmGit`, which refuses tracking a git or read folder, or one of a `history: "own"` key). While marked, turns get the folder untracked (no core history window, no crash restore) and undo leaves it out. The old core history stays either way.

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
| L6 | Unlink takes effect from the next turn (Decision 4); a turn already running keeps its folders until it ends | Claude per turn; ACP reloads the session on a changed list, roots replaced before the prompt | `acp.test.ts` (a changed list reloads the session) |
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
- `packages/engines/src/contract.ts` (`LinkedAccess`, `TurnScope`), `claude/transport.ts` (`settingsArgs`, `ruleUnsafePath`), `acp/client.ts`, `packages/runtime/src/workspace.ts` (linked histories), `runtime.ts` (`instructionLinked`, `linkedGitdir`).
- `packages/shell/src/main/linked-folders.ts`, `linked-history.ts`, `linked-ipc.ts`, `scope-access.ts`, `linked-restore.ts`; wiring in `index.ts`, `turn-controller.ts`, `task-manager.ts`, `board-host.ts`, `jobs/job-runner.ts`.
- `packages/ui/src/hatches/`, `ScopePicker.tsx`, `HistoryPanel.tsx`, `ContextPanel.tsx`; `en.json` `hatches.*`.
- Tests: the D0 and threat-model tables above; `packages/fake-agent/fixtures/hatches-harness`; `packages/e2e/tests/hatches-linked.spec.ts`.

## H2: the harness backend

A harness may declare `backend`: a Node process of its own that the harness UI talks to, for work the window can't do (convert a file, watch a folder, later a terminal). Main launches it once per app start, after setup, keeps it alive within limits and stops it on quit and around a folder move or profile switch. It can answer the window's calls and send it events, nothing else: it has no channel to the history, notes, data, sessions or engines. Spec §4 (4.1–4.3, 4.5), plan `docs/superpowers/plans/2026-10-28-harness-hatches-part2.md`. Native modules (§4.4, `node-pty`) wait for plan 4b.

### The manifest

```ts
backend: "./backend/index.ts",
```

`backendSchema` and `hasBackend` (`packages/harness-sdk/src/hatches.ts`): a relative path to a `.ts`, `.mts`, `.js` or `.mjs` file. `loadHarness` resolves it with `resolveInHarness`, so a path that leaves the harness folder is refused at load; at each start `BackendProcess.start` also takes the entry's real path and refuses it unless it is inside the harness folder's real path ("The backend's entry is outside the harness folder"), so a symlink can't lead out either. `hasBackend(h)` is false without the key: no part-2 code runs (D0, below).

### Launch and trust

The backend is the harness's own code, at the trust level of its MCP servers, which already run arbitrary code (spec §4.1). Nothing asks the person to approve it.

- **Process.** `BackendProcess.start` (`packages/shell/src/main/backend/backend-process.ts`) spawns `launcher.command [...launcher.args, <entry's real path>]` on the MCP servers' launcher, `electronLauncher(process.execPath)`: Electron's own Node (`ELECTRON_RUN_AS_NODE=1`, Node 24), in the app and in `humanharness dev` alike. `cwd` is the harness folder; the environment is the app's (`process.env`) plus the launcher's; stdin and stdout are the protocol, stderr goes to `backend.log`. On macOS and Linux it gets its own process group (`detached`), so a stop reaches whatever it started.
- **TypeScript.** The backend ships and runs as its uncompiled `.ts` source: there is no compile step, and Electron's Node 24 strips the types when it loads the file. So a `.ts` backend may use only erasable syntax (no `enum`, no `namespace`, no parameter properties). From the SDK it may use `import type` only (`BackendInit`, `BackendScope` from `@humanharness/cli/sdk`, which re-exports `packages/harness-sdk/src/harness-backend.ts`): a value import, even of one of the limit constants, fails at load, because the SDK is `.ts` under `node_modules` and Node never strips types there. Copy a constant's value instead.
- **When.** The first time the app is set up in this process (folder chosen, setup done): at start with the jobs' start moment, or when the setup's save finishes it (`backendReady` in `packages/shell/src/main/index.ts`). It doesn't wait for an engine. Never while the app quits.
- **No OS sandbox.** It runs as the same user as the app, so it can read and write whatever the person can. The boundaries below keep it from reaching the app's own state through the app; they don't confine the process.

### The protocol

JSON-RPC 2.0, one JSON message per line (`\n`) on stdin and stdout (`backend-protocol.ts`, pure). The app sends `init` once, right after the spawn, then calls (with an `id`) and the `scopesChanged` notification; the backend answers calls (`result` or `error`, same `id`) and sends notifications, which are events for the window. A sample exchange with the demo's backend:

```
app     {"jsonrpc":"2.0","method":"init","params":{"folder":"/Users/ana/Documents/Human Harness Demo","scopes":[],"language":"en","coreVersion":"0.1.0","dataDir":"/Users/ana/Library/Application Support/Demo/backend-data","mock":false}}
app     {"jsonrpc":"2.0","id":1,"method":"echo","params":{"text":"hi"}}
backend {"jsonrpc":"2.0","id":1,"result":{"echo":{"text":"hi"},"mock":false}}
app     {"jsonrpc":"2.0","id":2,"method":"stream","params":{"n":2}}
backend {"jsonrpc":"2.0","method":"tick","params":{"i":0}}
backend {"jsonrpc":"2.0","method":"tick","params":{"i":1}}
backend {"jsonrpc":"2.0","id":2,"result":{"sent":2}}
backend {"jsonrpc":"2.0","id":"a","method":"notes.write","params":{}}
app     {"jsonrpc":"2.0","id":"a","error":{"code":-32601,"message":"The app takes no requests from a backend"}}
```

- **`init`** (`BackendInit`): exactly `folder` (the base: with profiles, the active profile's folder), `scopes` (the active, unarchived ones, each `{ id, title, linked: [{ key, path, mode }] }`; `[]` in a harness without scopes), `language`, `coreVersion` (`app.getVersion()`), `dataDir` and `mock`. No credential, no engine path (`backendInit` in `backend-ipc.ts`).
- **Links.** A scope's `linked` holds only the links a turn in that scope would use now: the scope access's checks (signed, live nonce, declared key, today's mode, the folder still the one linked, the picker's refusals passed; part 1, "Re-checked at every use") through `usableLinks`. A dropped link is left out (and logged once, as for turns); a harness without `linkedFolders` sends `linked: []`.
- **`scopesChanged`** carries a full `BackendInit` again, not a diff: the same keys with the new scopes. It is sent whenever the scopes are sent to the window again: a scope made, renamed, archived or brought back, a scope opened (`hh:scopeOpen`), after every message sent in a scope, and on every link or unlink. So it can arrive with nothing changed. Scopes that change while the backend starts reach it right after its `init`; a scopes read that a rebase overtook is dropped (`BackendGeneration` in `backend-ipc.ts`, `backendGen` in `index.ts`; `backend-ipc.test.ts`, "a read that a base change overtakes gives null"), and so is a start's or rebase's own `init` read when a later rebase or profile switch began meanwhile (the later one wins). Scopes read from another folder than the running backend's `init` (Settings changed the folder; the rebase comes after) are dropped by the supervisor, neither sent nor remembered.
- **Every line must carry `"jsonrpc":"2.0"`.** A line without it is dropped and logged ("not JSON-RPC 2.0 (every line needs "jsonrpc":"2.0")"): an answer without it never reaches its call, which then times out after 30 s.
- **What the app refuses.** A request from the backend (an `id` and a `method`) is answered `-32601` "The app takes no requests from a backend" and logged, whatever it names: the app has no method a backend may call. A request whose `id` can't be echoed (not an integer, or a string over 200 characters) is logged only, never answered. A response to an id the app never sent (or one that timed out), a line that isn't JSON or isn't an object, an event with an invalid name or params over 64 KB, and a line over 1 MB are dropped and logged. An `error` without a `message` string still rejects the call ("The backend answered with an error").

| Limit | Value | Enforced in |
|---|---|---|
| Call timeout | 30 s, then "The backend didn't answer in time" | `BackendProcess.call` |
| Calls in flight | 64; the 65th is refused at once ("Too many calls to the backend") | `registerBackendIpc` and `BackendProcess.call` |
| Line, either way (a call's params too) | 1 MB | `LineReader`, `hh:backendCall` |
| Event payload | 64 KB | `classifyIncoming` |
| Events | 200 in any rolling second; the rest dropped, "Dropped N backend events" logged once a second | `EventLimiter` |
| Method and event names | `^[a-zA-Z][a-zA-Z0-9_.:-]{0,99}$` (`BACKEND_NAME`) | `isBackendName` |
| Error message to the window | 500 characters | `classifyIncoming`, `hh:backendCall` |

The constants are in `packages/harness-sdk/src/harness-backend.ts`.

### Lifecycle

`BackendSupervisor` (`backend-supervisor.ts`) runs every transition (start, crash restart, rebase, Restart, stop) on one promise chain, so they never interleave; while one is queued or running, calls are refused with "The backend isn't running" and `scopesChanged` waits for the next `init`. States: `stopped`, `starting`, `running`, `failed`.

| Moment | What happens |
|---|---|
| Crash | An unexpected exit, or a start that throws (a spawn error, an entry outside the folder), is a crash. It restarts at once as long as this crash is one of at most 3 in the last 5 minutes; the 4th crash inside 5 minutes leaves it `failed`: the card shows, and the main log gets one line ("[backend] The harness's backend stopped working after crashing too often; see backend.log"). Only the person's Restart (`hh:backendRestart`, which acts only from `failed`) clears the count; a Restart that arrives after a stop was asked (a move or profile switch under way) does nothing, so the old `init` never comes back. A move or profile switch starts a failed backend again but keeps the count, so one more crash in the window fails it again. Calls in flight when it dies reject with "The backend isn't running" |
| Quit | In `before-quit`, after the plugins stop and before the runtime closes: `stop({ quit: true })`, SIGTERM to the process group, SIGKILL after 3 s, and quit waits for it. From then on start, rebase and Restart do nothing: an exit during the stop is never a crash and nothing brings it back, so a quit never restarts it |
| Folder move | Step 2 (`history.md`): in `closeRuntime`, after the runtime and the plugins, the backend stops (from the moment the stop is asked, its events are no longer passed to the window). When the move ends, moved, refused or failed, it starts again with an `init` for whichever folder is the app's now (`rebase`) |
| Another folder in Settings | A rebase with the new folder's `init` |
| Profile switch | It stops after the plugins and before anything reads the new profile (`backendLeaveBase`), then starts there once the profile's scopes are settled (`rebase`): new `folder`, `scopes` and `dataDir` |
| Scopes change | `scopesChanged` to a running backend (above); remembered for the next start otherwise |
| Engine switch | Nothing: `dropRuntime` doesn't touch it, it keeps running (spec §4.3) |
| Harness update | No in-app update path exists yet; the supervisor's `stop()` and `start()` are the hooks for plan 4b. In development only an edit of `harness.config.ts` restarts the app (and with it the backend). An edit of the backend's own files restarts nothing: reopen the app, or kill the backend's process so the crash restart loads the new file |

### The window

`client.backend` (`packages/ui/src/client.ts`, `BackendClient`; preload `packages/shell/src/preload/backend.ts`) has exactly `call(method, params)`, `on(event, cb)` (returns the unsubscribe), `state()`, `onState(cb)` and `restart()`. `state` is a method (Decision 1). Main's channels, registered only under `hasBackend` (`registerBackendIpc` in `backend-ipc.ts`, through `handle()`): `hh:backendCall`, `hh:backendState`, `hh:backendRestart`, and the pushes `hh:backendEvent` (`{ event, data }`) and `hh:backendStateChange`.

A rejected call carries a plain message: the backend's own `error.message` (cut to 500 characters), "The backend didn't answer in time", "The backend isn't running", "Too many calls to the backend", "Invalid backend method", "The call's params can't be sent to the backend", "The call is too large for the backend" or "Too large". The preload strips Electron's "Error invoking remote method '…': Error: " prefix, and for a harness without `backend` (no handler registered) every call rejects with "This harness has no backend".

`useBackend(client)` (`packages/ui/src/hatches/useBackend.ts`, exported from `@humanharness/cli/ui`) gives a harness view `{ state, call, on }` with the state kept fresh. `BackendCard` (`packages/ui/src/hatches/BackendCard.tsx`), mounted by `HarnessApp` only with `state.hatches.backend`, shows only while `failed`: "The harness's helper stopped working." with "Restart" (`role="alert"`), "Restarting…" until the state changes, and the button back if the Restart fails. Nothing shows while it starts after a crash. `AppState.hatches.backend` is `true` only for a harness with `backend` (`hatchesState` in `linked-ipc.ts`).

### Logs

`backend.log` in the app's data folder (`<userData>/backend.log`, `BackendLog` in `backend-log.ts`): one line per entry, `<ISO time> <stream> <text>`, where `stream` is `stderr` (the backend's own stderr, line by line) or `app` (the app's notes: refused requests, dropped lines and events, spawn failures, a failing event listener). Blank lines are skipped and a line is cut at 8 KB. Writes run one at a time. When the next write would take a non-empty file past 5 MB, the file is renamed to `backend.log.1` (replacing the older one), so a noisy backend holds at most two files. It never throws: the first failure to write is reported once to the main log. The file is created only on its first line; a harness without `backend` never gets one.

The file is created with mode `0600`. A symlink at `backend.log` is refused: the log neither writes through it nor rotates it (an `lstat` check, and the file opened with `O_NOFOLLOW` against a link swapped in after it); the write is skipped and reported once like any failure (`backend-log.test.ts`, "never follows a symlink at backend.log: the target is untouched, reported once").

### Mock mode

The backend runs as usual, with `init.mock: true` (`hooks.mock`). A backend that would reach the network or the person's tools checks it and fakes the work if it wants; the demo's echo answers with `mock` in its result (`mock-mode.md`).

### D0

A harness without `backend` runs no part-2 code: no process is spawned, no `backend.log` or `backend-data/` is made, no `hh:backend*` channel is registered and nothing is pushed on them, `AppState.hatches` has no `backend` key (and is absent with no other hatch), there is no card, `client.backend` calls reject ("This harness has no backend"), and quit, folder move, profile switch and engine switch run exactly their earlier steps.

| What stays as before | Pinned by |
|---|---|
| The manifest | `packages/harness-sdk/test/hatches.test.ts` ("D0: no backend key without one") |
| No process, no file | `packages/shell/test/backend/backend-wiring.test.ts` ("D0: a harness without backend never constructs a supervisor") |
| IPC | `packages/shell/test/hatches-surface.test.ts` ("backend channels are registered only under hasBackend (D0)") |
| State | `hatches-surface.test.ts` ("hatchesState carries backend: true only with a backend (D0)") |
| UI | `packages/ui/test/backend-ui.test.tsx` ("D0: no card and no listener without state.hatches.backend") |
| End to end | `packages/e2e/tests/history.spec.ts` (the demo's commit messages) unchanged now that the demo has a backend |

### Threat model (part 2)

The boundaries protect the app and the person from a buggy or noisy backend and keep the window → backend path narrow. They are not a sandbox (B1).

| # | Boundary | What enforces it | Test |
|---|---|---|---|
| B1 | Process isolation | A separate child, never imported in main; `cwd` the harness folder; the entry's real path inside the folder's; stdout protocol only, stderr only to the log; its own process group on POSIX. No OS sandbox: it runs as the same user and can touch whatever the person can | `backend-process.test.ts` ("runs in its own process with the harness folder as cwd and the launcher's env (B1)", "refuses an entry that leads outside the harness folder, through a symlink too", "stop kills its whole process group, grandchildren included (B1)") |
| B2 | Window → backend | `hh:backendCall` through `handle()` (the app's page only); the method must match the name pattern; params must serialise and fit 1 MB; at most 64 in flight | `backend-ipc.test.ts` ("registerBackendIpc (threat model B2)") |
| B3 | Backend → app | Only responses to the app's own ids in flight and notifications; requests refused `-32601` and logged (unechoable ones logged only); an unknown id, non-JSON, a line without `"jsonrpc":"2.0"`, a line over 1 MB, a bad event name or an event over 64 KB dropped and logged | `backend-protocol.test.ts` ("classifyIncoming (B3, B4)", "drops a line over 1 MB and reports it, then goes on (B3)") |
| B4 | No core writes from the backend | The protocol has no method the app answers; `client.backend` has exactly `call`, `on`, `state`, `onState`, `restart` | `backend-protocol.test.ts` ("refusal of history writes: any request from the backend is refused, whatever it names"); `backend-process.test.ts` ("a request from the backend is refused with -32601 and logged (B4)"); `backend-ui.test.tsx` ("client.backend has exactly call, on, state, onState, restart (B4)") |
| B5 | A noisy backend can't freeze the window | 200 events per rolling second, the rest dropped and counted in the log once a second; the log rotated at 5 MB with lines cut at 8 KB | `backend-protocol.test.ts` ("EventLimiter (B5)"); `backend-process.test.ts` ("events over 200 per second are dropped and counted (B5)"); `backend-log.test.ts` ("rotates to backend.log.1 past the limit, keeping one old file") |
| B6 | A crashing backend can't loop | At most 3 restarts in 5 minutes, then `failed` until the person's Restart; nothing restarts after quit | `backend-supervisor.test.ts` ("restarts after a crash, up to 3 times in 5 minutes, then failed", "restart() from failed starts again and clears the count", "after stop({ quit: true }) nothing brings it back") |
| B7 | No secrets reach it from the app | `init` has exactly folder, scopes, language, core version, data folder and mock; the app adds no engine auth variable. But its environment is the app's whole environment, as the MCP servers get: the person's own variables reach it (for example an API key exported in the shell that runs `humanharness dev`) | `backend-process.test.ts` ("sends init first; init has exactly these keys (B7)") |
| B8 | Quit never hangs | SIGTERM, SIGKILL after 3 s; quit waits for the stop | `backend-process.test.ts` ("stop sends SIGTERM; a backend that ignores SIGTERM is killed after 3 s (B8)") |
| B9 | The app never reads `~/.claude` or `~/.codex` for it | No engine path is passed; `init.dataDir` is the app's `backend-data/` | `backend-wiring.test.ts` ("never names an engine home (B9)", a source scan) |

End to end: `packages/e2e/tests/backend.spec.ts` (mock mode) runs the demo's echo backend ("the demo's echo backend answers and streams events in mock mode") and kills it from outside until the card offers Restart ("a backend killed from outside restarts; after three restarts the card offers Restart").

### Decisions

1. `client.backend.state` is a method plus `onState`, not a property: values cross `contextBridge` by copy.
2. The entry may be `.ts`, `.mts`, `.js` or `.mjs`; a `.ts` one uses erasable syntax only, run by Electron's Node, which strips the types. The SDK ships types only (no `defineHarnessBackend` helper): a helper would need a JS build of the SDK to run there. The demo shows the loop instead.
3. `dataDir` is `<userData>/backend-data/` (with profiles `<userData>/backend-data/<profile id>`), made at every start.
4. `init.folder` is the base; `scopes` are the base's active scopes with the links a turn would use. A profile switch is a rebase.
5. It starts the first time the app is set up in this process, with the jobs' start, and doesn't wait for an engine.
6. Harness update: no in-app path yet; the supervisor's `stop()` and `start()` are the hooks for plan 4b.
7. An engine switch keeps it running.
8. A call's errors reach the window as a rejected promise with a plain message (above).
9. The card: "The harness's helper stopped working." with "Restart", only when `failed`; `failed` also writes one main-log line.
10. Mock mode: it runs as usual with `init.mock: true`.
11. The rate limit is a rolling one-second window per event; drops are logged once a second as "Dropped N backend events".

### Known gaps

- **Native modules and packaging** (spec §4.4): no `humanharness build` check of `.node` files, no `--rebuild`, no `node-pty` packaging, signing or Gatekeeper story. Plan 4b. A backend may use only pure JavaScript dependencies until then. The backend runs as uncompiled `.ts` through Node's type stripping, so plan 4b's packaging step must keep the entry outside any asar or compile it to JavaScript.
- **No harness update path.** Nothing in the app updates a harness yet, so nothing stops and starts the backend around one (Decision 6).
- **One backend per app, not per window.** The app has one window per data folder today (spec §10 Q2).
- **No OS sandbox** (B1): the backend runs as the person's user with the app's environment.
- **Windows**: no process group, so a stop kills only the backend itself, not processes it started; and there is no SIGTERM grace there.

### Where to look

- `packages/harness-sdk/src/hatches.ts` (`backendSchema`, `hasBackend`), `harness-backend.ts` (types and limits).
- `packages/shell/src/main/backend/`: `backend-protocol.ts`, `backend-log.ts`, `backend-process.ts`, `backend-supervisor.ts`, `backend-ipc.ts` (`backendFor`, `registerBackendIpc`, `usableLinks`, `backendInit`, `BackendGeneration`); wiring in `index.ts` (`backendReady`, `backendRebase`, `backendScopes`, `backendLeaveBase`, the move's `closeRuntime`, `before-quit`).
- `packages/shell/src/preload/backend.ts`; `packages/ui/src/hatches/useBackend.ts`, `BackendCard.tsx`; `en.json` `hatches.backend*`.
- Tests: `packages/shell/test/backend/` with fixtures in `packages/shell/test/fixtures/backends/`; `packages/ui/test/backend-ui.test.tsx`; `packages/e2e/tests/backend.spec.ts`.
- The demo: `harnesses/demo/backend/index.ts` and its side panel, `harnesses/demo/ui/BackendPanel.tsx`.

## H3: engine config per scope

A harness may declare `enginePresets: true`: then each scope can carry its own engine config in `.harness/engine/<scope>/` (instructions, MCP servers, Claude settings, skills, agents, `codex.toml`, and layers per action). The person approves it in Scope settings, by hash. Until then, and after any change, new tasks of that scope start without it. Approved config reaches the engines only from a snapshot in the app's data folder, never from the live folder, except the files hooks and servers run (those inside `.harness/engine/<scope>/` too): they run in place and are checked again before each turn (Known gaps). Spec §5, plan `docs/superpowers/plans/2026-10-28-harness-hatches-part3.md`.

### The manifest

```ts
scopes: { label: "Project", plural: "Projects" },
enginePresets: true,
```

`enginePresets` is `z.literal(true)`, optional (`packages/harness-sdk/src/index.ts`); `hasEnginePresets` and `hatchProblems` ("enginePresets needs scopes") are in `hatches.ts`. The spec names no manifest key: the opt-in keeps D0 by construction (Decision 1). Without it the core never reads, watches, tracks or creates `.harness/engine/` (D0, below).

### Files

```
.harness/engine/<scope>/
  base                       "isolated" (the default) or "global"
  instructions.md            scope instructions
  mcp.json                   { "mcpServers": { … } }, stdio servers only
  settings.json              Claude settings: hooks and permissions allow/deny/ask only
  skills/<name>/SKILL.md     Claude skills (other files of the skill folder may sit next to it)
  agents/<name>.md           Claude agents
  codex.toml                 Codex keys from an allowlist
  actions/<action id>/       instructions.md, mcp.json, settings.json, added on top for that action's tasks
```

`readEngineConfig` (`packages/shell/src/main/engine-config/read-config.ts`) reads the folder into an `EngineConfig`: what each file says after cleaning, every refusal, the referenced scripts and one hash. Anything else in the folder is refused naming it: an unknown file at the top, a skill folder without `SKILL.md`, an agent that isn't a `.md`, an action layer whose id isn't one of the harness's actions, a file in a layer other than the three above. `.DS_Store` is skipped. An absent folder, or one with no file, is `null`: D0 for that scope (nothing to approve, no notice, the same argv).

- **`base`**: `isolated` or `global` (trimmed); anything else is refused.
- **`instructions.md`**: any text, passed as it is.
- **`mcp.json`** (`cleanMcp`): only the `mcpServers` key; each server `{ type?: "stdio", command, args?, env? }`, nothing else (a `url` server, or `cwd`, is refused, Decision 7). Names follow `^[a-z0-9][a-z0-9-]{0,39}$` and become `scope-<name>` (Decision 8); a renamed server may not equal a reserved name: `ui`, `data`, `translate`, `review` and the harness's own servers (E9). The command can't be empty or start with `-`. No `$` in the command, the arguments or an env value (the engines expand `${VAR}`, which would pull the person's credentials in). An env name that looks like a credential (`TOKEN`, `SECRET`, `PASSWORD`, `API_KEY`, `AUTH`, `COOKIE`, `SESSION`, `PAT`…) is refused. An env name is upper-case letters, digits and `_` (`^[A-Z][A-Z0-9_]*$`), and one that may make a program load other code is refused: ending in `PATH`, `HOME`, `DIR`, `OPTIONS`, `OPTS`, `CONFIG`, `PREFIX`, `RC`, `STARTUP`, `USERBASE`, `PROFILE`, `PRELOAD`, `LIBRARY`, `LIB` or `INCLUDE`; starting with `GIT_`, `NPM_CONFIG_`, `NODE_`, `PYTHON`, `PERL`, `RUBY`, `JAVA_`, `BASH_`, `ZDOTDIR`, `LD_`, `DYLD_`, `PROMPT_COMMAND`, `UV_`, `PIP_` or `LUA_INIT`; or one of `ENV`, `EDITOR`, `VISUAL`, `PAGER`, `SHELL`, `BROWSER`, `LESSOPEN`, `LESSCLOSE`, `SSH_ASKPASS`, `SUDO_ASKPASS`, `PS4`, `IFS` (programs a tool may start on its own). An env value that names an entry in the folder or a linked folder must be a regular file there, and joins the hash (Referenced scripts).
- **`settings.json`** (`cleanSettings`, Decision 5): `hooks` (event → matchers → `{ type: "command", command, timeout? }`; event names `^[A-Za-z0-9_-]{1,64}$`) and `permissions.allow`, `permissions.deny`, `permissions.ask`. `defaultMode` and `permissions.defaultMode` are dropped and shown as ignored (the core sets the mode). Every other key is refused naming it, `env`, `apiKeyHelper` and `permissions.additionalDirectories` among them.
  - Allow rules must be valid rules (`Tool`, `Tool(spec)` or `mcp__<server>…`). Under `permissions.edit: "none"` an edit-tool allow rule (`Edit`, `Write`, `MultiEdit`, `NotebookEdit`) is dropped as ignored. An edit-tool allow rule without a path is refused. A path rule (those tools plus `Read`, `Glob`, `Grep`) must stay inside the folder or a linked folder: `~/…`, a single-slash path (Claude reads it relative to the settings file, which is in the snapshot), `..`, or a glob whose fixed part leads out is refused. Bare `Read`, `Glob`, `Grep` pass.
  - Deny and ask rules are kept as they are: they only narrow.
- **`skills/<name>/SKILL.md`** (`skillFromMarkdown`): frontmatter with a `description`; the name, when given, equals the folder (a plain id); `hooks` is refused (E6). The file is copied as it is.
- **`agents/<name>.md`** (`agentFromMarkdown`, Decision 6): frontmatter as fields, body as the prompt. `description` is required; the name follows `^[a-z0-9][a-z0-9-]{0,39}$`. Kept: `tools`, `disallowedTools`, `model`, `color`, `skills`, `memory` (`project` or `local` only: `user` lives under `~/.claude`). `permissionMode` is dropped and shown as ignored. `hooks`, `mcpServers` and any other key are refused naming it. Two agents with one name are refused.
- **`codex.toml`** (`parseToml`, then `cleanCodex`, Decision 9): only `model_reasoning_summary` (`auto`, `concise`, `detailed`, `none`), `model_verbosity` (`low`, `medium`, `high`), `hide_agent_reasoning`, `show_raw_agent_reasoning`, `hooks` (the shape above), `tools.web_search`, `sandbox_workspace_write.network_access` and `features.web_search_request`. The three last ones reach the network: `true` passes only when the manifest has `permissions.web: true`. Everything else is refused naming the dotted key, among them `instructions` (use `instructions.md`), `model_provider`, `model_providers`, any `*_api_key`, `cli_auth_credentials_store`, `chatgpt_base_url`, `mcp_servers` (use `mcp.json`), `profile`, `profiles`, `model`, `model_reasoning_effort` and `model_auto_compact_token_limit` (the core owns the profile keys). `features` is a named list: a new flag joins once its effect is known.

**The parsers.** No TOML or YAML package is installed (Decision 4). `toml-lite.ts` reads tables, arrays of tables, dotted and quoted keys, basic and literal strings, integers, floats, booleans, arrays and inline tables, up to 256 KB and 32 levels; dates, multi-line strings, hex, exponents, `inf`/`nan` and unsafe integers are parse errors naming the line. `frontmatter.ts` reads flat `key: value`, `key: [a, b]` and `|` blocks up to 256 KB; nesting, anchors, duplicates, control characters and U+2028/2029/FEFF are refused naming the key or line. Neither builds an object through `__proto__`, `constructor` or `prototype`.

**Limits** (E8): every entry is `lstat`ed and opened with `O_NOFOLLOW`, then checked to be the same file (device and inode) with one name only. Symlinks (the engine folder itself too), hard links and anything but a regular file are refused. 256 KB per file, 2 MB for the folder and its scripts together, 200 files, a path of at most 4 parts. A file over its cap is a refusal; the folder over its cap is one refusal for the whole folder (`file: "."`).

**Repeated keys.** `JSON.parse` keeps a repeated key's last value, so the screen could show less than the file says: a JSON file (`mcp.json`, `settings.json`) that repeats a key at any depth is refused naming its dotted path (`mcp.json: mcpServers.tools is repeated`, `duplicateJsonKey` in `clean.ts`). TOML and front matter refuse a repeat already. So one preset server name can't appear twice; both transports' last checks refuse it too (E9).

**Refusals** are collected, never thrown: each is `{ file, message }`, the message leading with the file and the key (`settings.json: env is not allowed`). A config with any refusal can be shown, never approved.

### Referenced scripts and the hash

A hook command, or an MCP server's command or argument, may name a file in the person's folder or a linked folder (`node "$CLAUDE_PROJECT_DIR"/tools/x.js` in a hook, `node tools/x.js` in a server). That file joins the hash, and the screen lists it (`scriptRefs`, `script-refs.ts`; E2). Otherwise an agent could change it after the approval.

- **The grammar** (`commandWords`, `scanScripts`, `script-refs.ts`): a hook or server runs a plain script file, nothing richer. A command outside it is refused, naming the command and why, with `a hook or server must run a plain script file: <interpreter> <script> [args]`. The decision is an allowlist: there is no shell parsing to get wrong.
  - **A hook command** (shell text, `settings.json` or `codex.toml`) is one simple command of plain words, run by the engine under `sh` (bash on macOS): no control character (NUL included), no `;`, `|`, `&`, `<`, `>`, `(`, `)`, `{`, `}`, `#`, backquote, `!`, backslash, `*`, `?`, `[`, `~`, and no `$` except `"$CLAUDE_PROJECT_DIR"/…` or `"${CLAUDE_PROJECT_DIR}"/…` starting a word, taken as the folder (unquoted, sh would split and glob a folder name with a space). No leading `VAR=value`. A word may be wrapped whole in single or double quotes (`"/abs/my tools/x.js"`), never in part (`'n''ode'`, `--x='a b'`). At most 64 words and 4 KB.
  - **A hook's paths are absolute.** Claude spawns a hook in the session's current folder, which follows the agent's `cd`, so a relative path would name whatever the agent chose. The script and every path-like argument part (one with a `/` or starting with `.`, also after `=`, `,`, `:` or a leading `@`) must be absolute; `"$CLAUDE_PROJECT_DIR"/tools/x.js` is. The refusal suggests that form. Codex sets no `CLAUDE_PROJECT_DIR`: in `codex.toml` hooks it is refused, and paths are written absolute.
  - **The shape** is `<interpreter> <script> [args…]` or `<script> [args…]`. The interpreter is `node`, `python3`, `python`, `bash` or `sh` (any case), bare or by an absolute path in `/usr/bin`, `/bin`, `/usr/local/bin` or `/opt/homebrew/bin` (never one inside a root), with no options. On a preset turn the engines get a PATH with no entry an agent could fill (`absoluteSearchPath`, in both transports): only absolute entries whose real path lies outside the folder and the scope's linked folders (compared without case or Unicode form, a folder not there yet placed by its nearest existing parent), and `/usr/bin:/bin` when nothing is left. Their hooks and servers inherit it, so `node`, `npx` (itself `#!/usr/bin/env node`) or a `#!/usr/bin/env` line can't reach a file in a root. ACP starts a new process when the linked folders change. The check looks programs up on that same PATH, built from the one login PATH `engineCommand` gives the engines (`engineSearchPath`, read once; a failed read is tried again), and as defense in depth still refuses a bare interpreter, `npx` (and the `node` it runs), `uvx` (and `python3`/`python`) or a `#!/usr/bin/env` interpreter whose first match lies inside a root. Without a preset the environment is as before (D0) (`node -r x`, `python -m x`, `bash -c …` are refused). Without an interpreter, the script is a path (it has a `/`): a bare word (`npm test`, `make`, `exec …`) is a program on PATH or a shell builtin, whatever file of that name the folder holds. Such a script must start with `#!/usr/bin/env <interpreter>` or `#!<interpreter's system path>`, with no options: the whole line up to its `\n`, which must come within 127 bytes, with no tab or `\r` (the macOS kernel reads 512 bytes of it, so a shorter look could miss a padded argument). The line is judged on the bytes hashed (`coverageRefusals`, `read-config.ts`, reading 1024), never on a read of its own, and again on the snapshot's bytes at each load and pin check. The script must be a regular file in the folder or a linked folder.
  - **A stdio server** (`mcp.json`) takes the same shape, as `command` plus `args`, with relative paths from the folder: both engines are spawned with the folder as their working folder (`claude-cli.ts`, `acp.ts`: `cwd: folder`) and start servers there, whatever the agent `cd`s to in its shell. Or a remote package: `npx [-y|--yes] <npm name>[@version] [args…]` or `uvx <PyPI name>[==version] [args…]`, with no other runner options. `npx` is refused when a `.npmrc` or `node_modules` exists in the folder, a linked folder or any folder above them (npm puts each `node_modules/.bin` ahead of PATH, and an `.npmrc` can set `script-shell` or `node-options`), except the person's own `~/.npmrc`. `uvx` is refused when a `uv.toml`, `pyproject.toml`, `.python-version` or `uv.lock` exists there, or a local `X.py` or `X/` in the folder or a linked folder. These are checked by existence only, never read, at every read, so one created later drops the preset at the next turn. Only these servers may take a root as an argument (a filesystem server's folder). A server's env values follow the arguments' rule below, and may never name a root.
- **What the hash holds is what runs.** Every file a command names is placed by its real path, the spelling on disk: inside the engine folder it must be one of the folder's files (the walk skips `.DS_Store`, so a command naming it is refused), outside it one read into the scripts. The same comparison decides inside or outside and finds the bytes, in the reader, the snapshot load and the pin check, so a path spelled with another case can't skip a check (`engineKey`).
- **On disk.** Only a regular file is hashed, inside the folder or a linked folder after every link is resolved. The script, and any argument (whole, each part between `=`, `,` or `:`, a part after a leading `@`, and a glued flag's value as in `-c./x`) that names an existing entry in a root, must be a regular file there: a symlink, a folder, a FIFO or other non-regular entry, a path through a link, or a link from outside into the folder is refused (`<path>: is a symbolic link, named by "node \"$CLAUDE_PROJECT_DIR\"/run.js"; a command must name a plain script file`). The agent could retarget it, edit what it points to or fill the folder after approval without changing the hash. An argument outside the roots, or not there, is only a word. A script with hard links is refused. Paths compare case- and Unicode-normalization-insensitively, as macOS does.
- **The hash** (`engineHash`) is sha256 over every file of the engine folder, action layers included, sorted by path as `path\0length\0bytes`, then every script outside the folder as `script:<absolute path>\0length\0bytes`. The bytes hashed are kept in memory, so the snapshot writes exactly them (E3).
- **Not covered.** The hash never covers what a script loads in turn: its imports, a package `npx` or `uvx` fetches, a tool's own config. The screen marks such commands and scripts "May load other code not covered by approval" (`outside-code.ts`: package runners, `python -m`, `node_modules/.bin/`, a URL; in a script, a `#!/usr/bin/env` line (the interpreter is found on PATH), `import`, `require`, `from … import`, `source`, `use`, `load`). It is a hint for the person, not a boundary: a script can always load code in ways no pattern sees.

### Approval

**Where it is stored.** `.harness/scopes.json` → the scope's entry gains `engineApproval: { hash, at, tag }` (`ScopeStore.approveEngine`, `packages/workspace/src/scopes.ts`). The file sits in the folder the agent can write and the hash has no secret, so the approval counts only when the app signed it: `tag` is an HMAC-SHA256 with the links' key (`<userData>/linked-key`, `linkedSecret`), over `["hh-engine-v1", profile, scope, hash, at]` while the scope's revoke epoch is 0, and over `["hh-engine-v2", profile, scope, epoch, hash, at]` after a revoke (`engineApprovalTag`, `engine-config/approval.ts`; Revoking, below). The profile is its id (`""` without profiles). An approval without a valid tag counts as none everywhere: no preset, and Scope settings says "not approved". A signed approval pasted back after a revoke no longer verifies, since its tag carries the old epoch. An entry the store can't read as an approval is dropped; an entry without one is written exactly as before (D0).

**Approving.** Only from the window: `hh:engineApprove(scope, hash)` (`engine-ipc.ts`; the backend has no approval path). The scope must pass `isScopeId` and be registered and unarchived; the hash must be 64 lowercase hex characters. Main reads the folder again right then: a hash that differs answers `{ ok: false, reason: "changed" }`, a config with refusals `"refused"`. Otherwise it signs at the scope's current epoch (making the key if there is none yet) and stores, one approval at a time, and answers `{ ok: true, view }` (E10). Approval is per scope, action layers included (one hash); there is no bulk approval (Decision 11).

**Revoking.** Scope settings › Engine config shows "Revoke approval" while the scope is approved. It asks first, in the section ("Revoke the approval? New tasks start without this engine config, and running tasks stop using it from their next turn."), never with a browser dialog; confirmed, `hh:engineRevoke(scope)` runs and the section reads the view again ("Engine config not approved", Approve offered again). Main checks the scope id (`isScopeId`, registered; unlike Approve, an archived scope may be revoked too, so its approval can't come back when it is unarchived), then, one change at a time:
1. bumps the scope's **revoke epoch** (`EngineEpochs.bump`, `engine-config/epochs.ts`), written first, so a clear that fails still leaves the old approval void;
2. clears `engineApproval` from `scopes.json` (`ScopeStore.clearEngineApproval`), when there is one;
3. sends `hh:engineConfigChanged` for the scope and answers the view (`null` without engine config).

The epochs live in `<userData>/engine-epochs.json` (`{ version: 1, floor, epochs: [[profile, scope, epoch]…] }`, mode 0600, written to a temp file and renamed), outside the folder the agent writes. They are kept **per profile and scope id**, not per folder: two folders with a scope of the same id under the same profile share one epoch, so a revoke in one also voids the other's approval (stricter, on purpose). No file or no entry is epoch 0, the tags made before epochs existed, so those approvals keep working. The epoch is folded into both the approval's and the pins' tags, so a revoke ends every approval and every pin made before it, and an old approval pasted back stays void. A damaged or unreadable record verifies nothing (no scope has a preset); the next approve or revoke rewrites it with `floor` set to the current time in milliseconds, above any epoch it could have held, so every scope needs approving again. The file is made only by the first revoke or by repairing a damaged one: never without `enginePresets` (D0).

**Before a new task** (`EngineHost.presetFor`, `engine-host.ts`). The live folder is read with today's cleaning context (the scope's usable linked folders, the manifest's `edit` and `web`, the reserved names, the harness's actions). The task gets the preset only when the scope's approval is the app's and its hash equals the hash computed now, with no refusal. Then the snapshot is written (or kept, when it is already there) and loaded back, and the task stores the hash (`engineHash`) and the app's pin tag (`engineTag`, below). Otherwise the task runs without it and carries `engineNotice`: `"unapproved"` (never approved, changed since, or the snapshot could not be written or loaded) or `"refused"`.

**Before every later turn** (`EngineHost.presetForTask`). Hook and server scripts run in place, so the scope's folder is checked again before each turn (a decision taken during review, stricter than the spec's "running sessions keep the config they started with"):
- A task that started without a preset stays without one, even if the scope is approved meanwhile. A pin the agent writes into `tasks.json` (`engineHash`) doesn't help: **every pin needs a valid `engineTag`**, an HMAC over `["hh-engine-pin-v1", profile, scope, taskId, hash]`, or `["hh-engine-pin-v2", profile, scope, epoch, taskId, hash]` after a revoke (`enginePinTag`), including a pin equal to the approved hash. Pins made before this rule without a tag lose their preset (the turn runs without it, with the notice); a new task gets a tagged pin.
- The scope must still have an approval the app signed at its current epoch. **Revoking (or clearing) an approval stops the preset from the next turn, even in running tasks** (decision): the bumped epoch voids the task's pin tag as well as the approval.
- Pinned to the approved hash: the live folder must hash to it.
- Pinned to an older hash A while the scope now approves B (Decision 2, per task): the pin's tag must check (above); the live folder must hash to A or B; and every file A's commands run, scripts and engine-folder files alike, must still hold A's bytes, read as the reader reads (no link, one name, the same file) (`pinnedScriptsUnchanged`, `snapshot.ts`). So a task on A keeps running under B's approval, but a script only A runs can't be edited and still run.
- On a mismatch the turn runs with no preset and the task shows the "unapproved" notice; a turn that passes again clears it.

**The snapshot** (`snapshot.ts`, E3): `<userData>/engine-config/<hash>/`, written from the bytes that were hashed, into a temp folder and renamed into place:

```
source/files/<rel>            the engine folder's files, verbatim
source/scripts/<sha16>        each referenced script, named by its path's sha256 (for the re-hash only)
source/scripts.json           the scripts' paths, sorted
plugins/scope-<id>/skills/…   the skills as a plugin for --plugin-dir, one per scope that uses this hash
agents.json                   for --agents; absent without agents
```

`loadSnapshot` hashes `source/` again, checks the folder holds exactly what `writeSnapshot` would write (a link, a missing or extra file: "The approved engine config changed on disk"), and derives everything again from the source with today's context (`configFromFiles`): a rule that today's context refuses (a folder unlinked since, `edit: "none"`, a new reserved name) comes back as a refusal, and the task gets the "refused" notice. Settings, servers, Codex keys and instructions reach the engines as arguments built from that, never as files. A damaged snapshot already there is replaced. Engines run a referenced script at its live path; the per-turn check above is what keeps that path's bytes the approved ones.

**Pruning** (Decision 13, `pruneEngineSnapshots` in `engine-config/prune.ts`, then `pruneSnapshots` in `snapshot.ts`). Once at each start, only under `enginePresets` (`pruneEngineConfig` in `index.ts`), in the background. It gathers every base the app knows (the open folder's, and each profile's), and keeps every hash an approval names there (archived scopes too, signed or not) and every live task's `engineHash` (the current task and every board lane, read raw from `tasks.json`). Every other `<userData>/engine-config/<hash>/` folder, and any leftover temp folder, goes to the system Trash once it is more than 30 days old; a younger one waits. A snapshot written or used again for a new task (an old hash approved anew) has its folder's time touched, so its age starts over. Right before each snapshot goes, the in-use set and the folder's age are read again: an approval or task that named it meanwhile keeps it, and a failed read keeps it. **If any scope list or `tasks.json` can't be read, nothing is pruned** (a pin it might hold would be lost); a failure to trash is logged and the folder kept. Without the `engine-config` folder, or with something other than a plain folder there, it does nothing.

### What reaches each engine

`EnginePreset` (`packages/engines/src/contract.ts`) rides on the turn's `TurnScope.engine`, next to the linked folders (`withEngine`, `scope-access.ts`). An action layer is merged on top: its instructions follow the scope's, a server of the same name replaces the scope's, a hook event it sets replaces the scope's, and allow/deny/ask lists are joined (a deny is never lost). Sidekick and language sessions (`noTools`, `mcpOnly`) never get one: both transports throw.

| File | Claude (`claude-cli.ts`) | Codex (`acp.ts`) | OpenCode (`acp.ts`) |
|---|---|---|---|
| `instructions.md` | the first message (below) | the same | the same |
| `mcp.json` | after the core's servers in `--mcp-config` | after the core's in `mcpServers` of `session/new` and `session/load` | the same as Codex |
| `settings.json` | hooks and rules in the one merged `--settings` | not used | not used |
| `skills/` | `--plugin-dir <snapshot>/plugins/scope-<id>`: skills are `/scope-<id>:<name>` | not used | not used |
| `agents/` | `--agents <snapshot>/agents.json` | not used | not used |
| `codex.toml` | not used | merged into `CODEX_CONFIG` | not used |
| `base: global` | `--setting-sources user,project`, no `--strict-mcp-config` | today's behaviour either way | not used |

- **Claude.** `settingsArgs` builds the one `--settings`: part 1's `additionalDirectories` (references, then linked folders), plus the preset's `hooks` and `permissions.allow/deny/ask`; none when it would be empty. An `mcp__` allow rule passes only when it names one of the preset's own servers (`mcp__scope-<name>` or `mcp__scope-<name>__<tool>`): under `global` the CLI also loads the person's own servers, which a preset must not approve. The harness's `--disallowedTools` stays outside and always wins (E5). `--plugin-dir` and `--agents` follow `--settings`. Under `global` the `--settings` also carries `enableAllProjectMcpServers: false` and `enabledMcpjsonServers: []`, and `--disallowedTools` adds `Edit`, `Write`, `MultiEdit` and `NotebookEdit` of `.mcp.json`: without `--strict-mcp-config` the CLI would start the folder's `.mcp.json` servers, which nobody approved (with `exec` the shell can still write the file, but its servers stay off). A last check refuses an unknown base, a server not named `scope-<name>` or named like a core server, and a snapshot path that is relative or reads as a flag.
- **Codex.** The cleaned `codex.toml` is merged deep into the `CODEX_CONFIG` the core builds from the profile (`mergeCodex`): the core's keys win at every depth, and `model`, `model_reasoning_effort`, `model_auto_compact_token_limit` from a preset are refused (last guard). **Only Codex** takes this part: the task workspace marks the engine id `codex` with `profileMethod: "codex-config"`, and the ACP transport merges the codex part only then; Kimi, Gemini, Qwen and OpenCode never get it. As defence in depth behind the shell's allowlist, `mergeCodex` also drops, at any depth, the keys that would widen the sandbox, skip approvals, add servers or pick a provider, a profile or a key, among them `sandbox_mode`, `approval_policy`, `sandbox_workspace_write.writable_roots`, `mcp_servers`, `model_provider`, `model_providers`, `profile`, `profiles`, `projects`, `notify`, `otel`, `chatgpt_base_url`, `cli_auth_credentials_store`, `experimental_instructions_file`, `model_instructions_file`, `instructions`, `shell_environment_policy` and any key ending in `_api_key` (a table only the preset has goes through the same filter). Its hooks go through `CODEX_CONFIG.hooks`. A turn whose preset hash differs from the process's (another hash, or a preset dropped or added) restarts the process with a new session, as a new profile does: on Codex a preset dropped mid-task starts a fresh session.
- **OpenCode** (and any other ACP engine) gets the servers only (and the instructions, which are in the first message): no `CODEX_CONFIG`.
- **Server names.** Both transports' last check refuses a preset server not named `scope-<name>`, named like a core server, or named twice in one preset.
- **Permissions on ACP.** The approved preset's `scope-*` servers join the permission policy's server list for the turns that carry the preset, so **every call to an approved preset server is approved without asking**, as for core servers (decision). On Claude the preset's allow/deny/ask rules apply instead. On Codex a preset deny on its own server's tool has no effect.
- **The Codex limit** (Decision 14). `isolated` can't hold on Codex: the app sets no `CODEX_HOME` and never reads `~/.codex`, so the person's own Codex config and the project's `.codex/` always apply. Scope settings says "On Codex, your own Codex config always applies." whenever the harness's `engines` list `codex`, whatever the active engine.

**Scope instructions** (Decision 3). The task's first message carries `## Scope instructions` (the scope's text, then the action layer's) right after the brief, before the notes index; `AGENTS.md` and its cached prefix don't change. The context panel lists it as one item, kind `scope-instructions`, "Scope instructions" (`withScopeInstructions` in `task-manager.ts`; `context.md`). A task resumed after a folder move gets them again from its pinned snapshot.

**Jobs.** A scoped job run gets no scope instructions and no preset: its `TurnScope` carries the linked folders only (`jobScope`). A job is a `prompt` today or `steps` (a recipe) later; nothing here assumes it is an AI run.

### The window

**Scope settings › Engine config** (`EngineConfig.tsx`, inside the scope's settings dialog, only with `state.hatches.enginePresets`). It shows everything the folder holds, from `hh:engineConfig(scope)` (`engineConfigView`), in this order:
- the status: "Approved {date}", "Changed since you approved it" or "Engine config not approved"; and "Can't be approved: {file}: {reason}" for each refusal (Approve is then disabled);
- the base: "Uses only this scope's config", or "Also uses your global Claude config" with "That brings your own Claude settings too, including your own allow rules and the extra folders you let Claude reach (additionalDirectories)." (the CLI loads them; editable by the agent under `edit: "folder"` and `acceptEdits`);
- the Codex limit (above);
- **"Runs commands on your computer" first**: every hook (event and matcher), Codex hook and server with its command and arguments, its layer and file, a server's environment, and under each server "A rule that allows its tools must name `mcp__scope-<name>`."; then "Scripts it runs" (the absolute paths). Either may carry "May load other code not covered by approval";
- "Permission rules" per layer: allow, deny, ask. An allow rule for a server that isn't one of the preset's own is listed as "Not used: {rule}. A rule for a server's tools must name `mcp__scope-<name>`.";
- the instructions per layer, **rendered** as Markdown, with a "Show source" toggle that shows the exact text the agent gets. When the source holds text the rendering doesn't show (front matter, a link-reference definition such as `[//]: # (…)`, an image, a link whose address or title differs from its text, invisible characters), it says "Has text that doesn't show when rendered. Show source to see all the agent gets." (`hidesText`);
- skills: name, description, `allowed-tools` ("Uses without asking"), `model`, `context: fork`, and the other files of its folder;
- agents: name, description, `tools`, `disallowedTools`, `model`, `skills`, `memory`, and the dropped keys;
- the `codex.toml` keys, each with its value (`tools.web_search = true`);
- the ignored keys;
- Approve, while not approved. A folder that changed while it showed answers "It changed while you looked. Review it again." and the view is read again;
- "Revoke approval", while approved (Revoking, above). Confirmed, focus goes to the Approve that replaces it; cancelled, back to Revoke. A failure says "Couldn't revoke the approval." and keeps the view.

**What the active engine leaves out** (Decision 10). The view carries the active engine's id (`engine`, from the app's config). Each part that engine doesn't use says "Not used on {engine}" (the engine's name from the harness's engine list), next to the part:
- on **Claude**: the `codex.toml` keys, and each hook from a `codex.toml`;
- on **Codex**: the hooks from `settings.json`, the permission rules, skills, agents and the base line (Codex's own config always applies: the Codex limit);
- on **OpenCode** (and any other ACP engine): all of the above, Claude's and Codex's parts alike.
Servers and instructions reach every engine and are never marked. Before an engine is chosen (`engine` absent) nothing is marked. The marks are only shown: the approval still covers the whole folder, one hash, whatever the engine.

**The task notice** (`EngineNotice.tsx`): under the task header, "Engine config not approved · Review" (`unapproved`) or "Engine config not used: it has something the app refuses · Review" (`refused`); Review opens that scope's settings at the section.

**IPC.** Registered only under `hasEnginePresets` (`registerEngineIpc`): `hh:engineConfig(scope)` → the view or `null` (no engine config), `hh:engineApprove(scope, hash)`, `hh:engineRevoke(scope)` → the view afterwards or `null`, and the push `hh:engineConfigChanged` (a scope id, or `null` for any scope). It is sent after an approval or a revoke, and after a history commit that touches `.harness/engine/<scope>/` (or `scopes.json`, or too many paths to list: `null`). `client.engineConfig.get/approve/revoke/onChanged`; `AppState.hatches.enginePresets`. **The scope list sent to the window (`hh:scopes`, `scopesView`) and to the backend (`init`, `scopesChanged`) never carries `engineApproval`**: only the Engine config view says whether a scope is approved.

### History

With `enginePresets`, `.harness/engine/` is kept by the history like notes, data and reviews (`appHistoryKeep(material, enginePresets)` in `packages/workspace/src/history.ts`, a prefix), so undo covers it (Decision 12). Without it, nothing changes (`history.md`).

### D0

A harness without `enginePresets: true` runs no part-3 code: `.harness/engine/` is never read, watched, tracked or created; `claudeArgs`, `CODEX_CONFIG`, `session/new`, the ACP process lifecycle, the first message, `AGENTS.md`, the context items and the history's tracked paths are unchanged; no `engineApproval` in `scopes.json`, no `<userData>/engine-config/`, no `<userData>/engine-epochs.json`, no prune at start, no `hh:engine*` channel, no section and no notice. A scope of an opted-in harness with no engine folder, or an empty one, is D0 for that scope.

| What stays as before | Pinned by |
|---|---|
| The manifest | `packages/harness-sdk/test/hatches.test.ts` ("D0: no enginePresets key without it") |
| Claude argv | `packages/runtime/test/hatches-d0.test.ts` ("D0: no engine preset → part 1's argv", "an empty preset folder changes nothing") |
| ACP | `packages/runtime/test/acp.test.ts` ("D0: CODEX_CONFIG and session/new unchanged without a preset") |
| History | `packages/workspace/test/layout.test.ts` ("D0: .harness/engine is not kept without enginePresets") |
| First message and items | `packages/shell/test/engine-config/engine-host.test.ts` ("D0: no preset, the task's first message and items are unchanged") |
| An empty folder | `packages/shell/test/engine-config/read-config.test.ts` ("an absent or empty folder is null (D0 for the scope)") |
| `scopes.json` | `packages/workspace/test/scopes.test.ts` ("approveEngine stores { hash, at, tag } signed inside the write; D0: no key until then") |
| IPC and state | `packages/shell/test/hatches-surface.test.ts` ("engine channels are registered only under enginePresets", "hatchesState carries enginePresets: true only with enginePresets (D0)") |
| UI | `packages/ui/test/engine-config-ui.test.tsx` ("D0: no Engine config section, no notice") |
| End to end | `packages/e2e/tests/history.spec.ts` and `mock.spec.ts` unchanged; `hatches-engine.spec.ts` ("D0 for the scope: an opted-in harness, no engine folder, no notice and no preset") |

### Threat model (part 3)

Anyone who can write the person's folder can write the engine folder, the agent included. Everything in it can run code (hooks, servers, skills that ask for tools). The approval is the boundary.

| # | Boundary | What enforces it | Test |
|---|---|---|---|
| E1 | Nothing unapproved reaches an engine | A preset only with the app's signed approval of the hash computed now, checked before every turn; every pin needs the app's pin tag, and a pin to an older hash the pinned scripts' bytes; a revoke bumps the epoch both tags carry | `engine-host.test.ts` ("a changed file drops the preset from new sessions and gives the notice", "pinned to A after B was approved: a script only A runs, edited since, drops the preset (E1)", "a pin tasks.json names without the app's tag is none…"); `approval.test.ts` ("a forged approval without a tag or with a wrong one is invalid") |
| E2 | The hash covers referenced scripts | `scriptRefs` adds every file a hook or server command names inside the folder or a linked folder; unplaceable shell forms are refused | `read-config.test.ts` ("a change to a referenced script changes the hash (E2)", "hook and server commands whose paths can't be placed are refused naming the file (E2)") |
| E3 | Snapshot, not the live folder | Written from the hashed bytes; re-hashed and re-derived with today's context on load | `snapshot.test.ts` ("an edit to the live folder after approval is not loaded", "loadSnapshot re-hashes and refuses a snapshot whose files changed") |
| E4 | Refused config keys | The allowlists above, at hash time, naming the key | `clean.test.ts` |
| E5 | The manifest's permissions win | Edit allow rules dropped under `edit: "none"`; path rules outside the folder refused; deny kept; `--disallowedTools` unchanged | `clean.test.ts`; `claude-cli.test.ts` ("manifest denies over a preset allow: --disallowedTools is the harness's, unchanged") |
| E6 | Agents and skills can't add hooks, servers or a mode | Agent `hooks`/`mcpServers` refused, `permissionMode` dropped; skill `hooks` refused | `frontmatter.test.ts` |
| E7 | Never reading an engine home | `global` only changes flags; the reader opens nothing outside the folder, linked folders and the data folder | `read-config.test.ts` ("never names an engine home (E7)", a source scan) |
| E8 | No symlink escape, no size bombs | `lstat` + `O_NOFOLLOW` + same file, no hard links; 256 KB, 2 MB, 200 files, 4 parts | `read-config.test.ts` ("refuses symlinks, files over 256 KB, more than 200 files, depth over 4 (E8)", "refuses hard links…") |
| E9 | Server names can't take core servers | `scope-<name>`, not reserved; checked again in both transports | `clean.test.ts` ("a renamed server can't equal a core or harness server"); `claude-cli.test.ts`, `acp.test.ts` ("refuses a preset server that is not scope-<name> or takes a core server's name") |
| E10 | Approval only of what was shown | `hh:engineApprove` recomputes and approves only an equal hash; ids checked | `engine-ipc.test.ts` ("hh:engineApprove approves only when the hash equals the one computed now", "refuses an unknown scope…") |


**Out of scope.** A skill's `allowed-tools` or a `permissions.allow` rule such as `Bash(./x.sh)` lets the agent run a file the hash doesn't cover without asking. The approval screen shows those rules; the person judges them.
End to end: `packages/e2e/tests/hatches-engine.spec.ts` (mock mode).

### Decisions

1. `enginePresets: true` opt-in, requiring `scopes`.
2. Pinned per task: a task keeps the hash it started with; a task that started without a preset stays without one. Every pin holds only with the app's pin tag; a pin to a hash the scope no longer approves also needs unchanged pinned scripts.
3. Scope instructions in the first message after the brief, as the "Scope instructions" item.
4. No TOML or YAML dependency: `toml-lite.ts` and `frontmatter.ts`.
5. `settings.json` allowlist: `hooks`, `permissions.allow/deny/ask`; `defaultMode` dropped.
6. Agent `hooks` and `mcpServers` refused in v1; `permissionMode` dropped; agent `memory: user` refused.
7. `url` MCP servers refused in v1.
8. Preset servers are `scope-<name>` on every engine.
9. The `codex.toml` allowlist above; `features` a named list.
10. OpenCode: instructions and servers only. The screen marks what the active engine leaves out ("Not used on {engine}").
11. Approval per scope, action layers included; no bulk approval.
12. `.harness/engine/` tracked by the history only with `enginePresets`.
13. Snapshots nothing keeps are trashed after 30 days, at start (`pruneEngineSnapshots`).
14. The Codex limit shows whenever the harness supports Codex.

Taken during review (listed for Marco):
- The approval and the pin are HMAC-signed with the links' key, with the scope's revoke epoch folded in; every pin needs its tag.
- Revoke epochs are per profile and scope id, shared across folders; a damaged epochs file voids every approval.
- The scope's folder is checked again before every turn; a mismatch means no preset and the "unapproved" notice.
- Revoking an approval stops the preset from the next turn, even in running tasks; an old approval pasted back stays void.
- The prune keeps every approval hash and live pin, waits 30 days, and skips entirely when any base can't be read.
- A task pinned to A keeps running after B is approved, under the pin tag and byte check.
- On ACP every call to an approved preset server is approved without asking.
- Approved hooks and servers run commands even with `permissions.exec: false` (the spec accepts it: the person approved them).

### Known gaps

- **Hooks run the live scripts.** The per-turn check runs before a turn: an edit to an approved script during a turn runs in that same turn. The agent can write a script, make a hook run it and restore it within one turn, leaving nothing for the next check to see; and with several board tasks in one folder some turn is nearly always running. So "caught on the next turn" is not guaranteed: the check bounds what a new turn starts with, not what runs mid-turn.
- **Only `<interp> <script> [args]` and npx/uvx remote packages are accepted.** Anything richer (a pipeline, `npm test`, `make`, an interpreter option, an environment assignment) goes in a script file the hook runs (`bash "$CLAUDE_PROJECT_DIR"/tools/run.sh`).
- **Version-manager shims** (pyenv, asdf, mise) for a bare interpreter may read version files (`.python-version`, `.tool-versions`, `.node-version`) from the folder, and so pick another interpreter. Name the interpreter by its system path to avoid it.
- **Hooks run under `sh`** (bash on macOS); the grammar keeps to words both read alike.
- **An argument that doesn't exist yet isn't hashed.** A script must exist at approval, but an argument naming a file not there then is only a word; if the agent creates it afterwards, it is read until the next per-turn check drops the preset (the same class as "Hooks run the live scripts").
- **Without profiles, an approval doesn't bind the folder.** The tag covers profile (`""`), scope, hash and time, not the folder: a signed approval copied into another folder with the same scope id and byte-identical engine config verifies there.
- **No change notice for an outside script.** Editing a referenced script outside the engine folder fires no `hh:engineConfigChanged` until a commit touches the engine folder, so an open Engine config section shows the old status meanwhile. The next turn still drops the preset.
- **The approval doesn't cover** code a script imports, or packages `npx`/`uvx` fetch (above). The outside-code mark is only a hint.
- **Live checks still to do.** S1: whether a trusted linked folder's `.codex/config.toml` loads; the TOML → JSON conversion against Codex. S2: `--plugin-dir` under `--setting-sources project` and `--strict-mcp-config`, and again on `--resume`; an agent's `tools` against `--disallowedTools`; under the `global` base, which server wins when the person's own config has one named `ui`, `data` or `scope-*`; `--agents` with a file needs Claude Code 2.1.281 or later, and there is no version check; that `enableAllProjectMcpServers: false` and `enabledMcpjsonServers: []` in `--settings` keep the folder's `.mcp.json` servers off under `global` (the CLI may merge arrays across setting sources). No real `claude` run checked the preset argv. The hook working folder: hooks are taken to run in the session's current folder (so relative paths are refused); check that, and that MCP servers start in the engine's working folder.
- **v1 refusals**: `url` servers, agent `hooks` and `mcpServers`, no bulk approval.
- **On Codex**, dropping or changing a preset mid-task starts a fresh session (the conversation is lost), and a preset deny on its own server's tool has no effect.
- **A revoke reaches other folders.** The epoch is per profile and scope id, so revoking scope `app` in one folder also voids an approval of a scope `app` in another folder under the same profile (stricter than needed; approve it again there).
- **The prune sees only the folders the app knows now.** It keeps the pins of live tasks in the open folder's bases (each profile's), not in other folders the person used before: a task there pinned to a snapshot older than 30 days loses it, and its next turn runs without the preset, with the notice (fails closed).
- **The marks follow the active engine only.** A scope approved on Claude and run later on Codex shows Codex's marks then; nothing records which engine a task used when it was pinned.

### Where to look

- `packages/harness-sdk/src/hatches.ts` (`hasEnginePresets`, `hatchProblems`); `packages/workspace/src/layout.ts` (`ENGINE_PREFIX`, `engineConfigDir`), `history.ts` (`appHistoryKeep`), `scopes.ts` (`EngineApproval`, `approveEngine`).
- `packages/shell/src/main/engine-config/`: `toml-lite.ts`, `frontmatter.ts`, `clean.ts`, `script-refs.ts`, `read-config.ts`, `snapshot.ts`, `approval.ts`, `epochs.ts`, `prune.ts`, `engine-host.ts`, `engine-ipc.ts`, `outside-code.ts`; wiring in `index.ts` (`engineHost_`, `engineIpcDeps`, `pruneEngineConfig`, `scopesView`), `task-manager.ts` (`withScopeInstructions`, `turnPreset`), `task-store.ts` (`engineHash`, `engineTag`, `engineNotice`), `scope-access.ts` (`withEngine`).
- `packages/engines/src/contract.ts` (`EnginePreset`), `search-path.ts` (`absoluteSearchPath`), `claude/transport.ts` (`settingsArgs`, `presetRules`, `checkPreset`), `acp/client.ts` (`mergeCodex`, `codexConfig`, the policy's `mcpServers`).
- `packages/ui/src/hatches/EngineConfig.tsx`, `EngineNotice.tsx`, `ScopeSettings.tsx`; `en.json` `hatches.engine*`.
- Tests: the tables above; `packages/fake-agent/fixtures/hatches-harness`.
