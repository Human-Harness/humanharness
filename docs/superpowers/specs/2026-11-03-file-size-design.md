# File size limit — design

Date: 2026-11-03
Status: written, waiting for Marco's review
Source: the herdr comparison (https://claude.ai/artifact/9rsD7WqQSYDPyPKQqyGci8), improvement 1. herdr keeps every source file under 32 KB, with a hard cap of 48 KB, because agent read tools stop near 50 KB (`herdr-core/AGENTS.md`).

## 1. Goal

Every file an agent works on can be read whole in one call.

- Today 8 source files are over 48 KB. The biggest is `shell/src/main/index.ts` at 194 KB, about four reads.
- An agent that reads a file in parts misses what sits in the other parts. It then edits from a partial picture.
- It also spends context on reading again what it read before.

This spec covers three things:
- a limit;
- a test that stops oversized files from growing;
- the order in which today's oversized files are split.

It changes no behaviour.

## 2. The limit

| | Bytes | Meaning |
|---|---|---|
| Target | 32 KB (32,768) | A new file aims to stay below it. |
| Cap | 48 KB (49,152) | No file may be over it. The only exceptions are the files in the baseline (§3), and only until they are split. |

**What counts.**
- Every `.ts`, `.tsx` and `.css` file under `packages/*/src` and `packages/*/test`, and every `.md` file under `docs/architecture`.
- Size is the file's bytes on disk.
- Tests count because agents read them as well: `sidekick-controller.test.ts` is 139 KB.

**What does not count.**
- Generated or vendored files: `dist`, `out` and `node_modules`.
- `*.d.ts` files.
- Fixtures under `test/fixtures`.
- Specs and plans under `docs/superpowers`. They are read once per plan, and splitting them would break their links.

## 3. The ratchet test

The test is `packages/protocol/test/file-size.test.ts`. It sits next to `boundary.test.ts`, the other repo-wide rule.

- **The baseline** is `packages/protocol/test/file-size-baseline.json`. It maps each file that is over the cap today to its size in bytes, rounded up to the next KB.
- The test fails when:
  - a file that is **not** in the baseline is over 48 KB;
  - a file in the baseline is **bigger** than its baseline size;
  - a baseline entry names a file that no longer exists, or that is now at or under the cap. The fix is to delete that entry.
- **The baseline only goes down.**
  - The script `pnpm size-baseline` rewrites each entry to the file's current size. It never raises an entry and never adds one.
  - A PR that shrinks a baseline file runs the script and commits the new number.
  - Raising an entry by hand is a review flag: it needs a line in the PR saying why.
- **The failure message** names the file, its size, the limit, and what to do: split the file, or run `pnpm size-baseline` after a shrink.

**Headroom for the style guide.**
- The style-guide plan (`docs/superpowers/plans/2026-11-03-style-guide.md`) is in flight. It edits `ui/src/ChatView.tsx`, `ui/src/styles.css` and `protocol/src/views.ts`.
- These three files go into the baseline at their current size plus 8 KB, so that plan is not blocked.
- When the style-guide plan merges, `pnpm size-baseline` takes the headroom away.

## 4. Today's oversized files

These are the files over 48 KB on master at f7216827.

**Source** — split by this spec, in this order (§5):

| File | KB |
|---|---|
| `shell/src/main/index.ts` | 194 |
| `shell/src/main/task-manager.ts` | 132 |
| `shell/src/main/sidekick.ts` | 95 |
| `shell/src/main/plugins.ts` | 82 |
| `workspace/src/history.ts` | 52 |
| `engines/src/acp/client.ts` | 49 |

**Source** — split later:

| File | KB | Why later |
|---|---|---|
| `ui/src/styles.css` | 110 | After the style guide (§3). |
| `ui/src/ChatView.tsx` | 106 | After the style guide (§3). |
| `protocol/src/views.ts` | 68 | After the style guide (§3). |

**Tests** — in the baseline, and split when the module they test is split:

| File | KB |
|---|---|
| `shell/test/sidekick-controller.test.ts` | 139 |
| `engines/test/acp.test.ts` | 90 |
| `shell/test/task-manager.test.ts` | 78 |
| `ui/test/fake-client.ts` | 75 |
| `engines/test/claude-cli.test.ts` | 61 |
| `ui/test/HarnessApp.test.tsx` | 55 |
| `cli/test/run.test.ts` | 52 |
| `shell/test/move-folder.test.ts` | 49 |

**Docs** — in the baseline; each is split into one file per topic in the PR that splits the matching code (`plugins.md` with `plugins.ts`), or in its own small PR (`hatches.md`, `tools.md`). Each split leaves the old file as an index of links, so existing links still land:

| File | KB |
|---|---|
| `docs/architecture/tools.md` | 91 |
| `docs/architecture/hatches.md` | 91 |
| `docs/architecture/plugins.md` | 80 |

Files between 32 and 48 KB pass the test and are not split by this spec. There are 16 source and test files, for example `cli/src/check.ts` (45) and `cli/src/run.ts` (38).

## 5. How each file is split

Every split follows three rules:
- **It moves code without changing it.** No renames and no behaviour change.
- **It keeps the public imports.** Anything that imported a symbol from the old file still finds it there, through a re-export, until a later PR moves the importers.
- **It goes in its own PR**, with the full test suite green and the baseline lowered.

### 5.1 `shell/src/main/index.ts` (194 KB → target under 48 KB)

**Today.** The file holds:
- 125 top-level `let`/`const` values, which are main's state;
- `registerIpc()`, which is 700 lines and 90 `handle*` calls;
- `taskDeps` (238 lines);
- `appState()` (134 lines);
- the window setup (`createWindow`, the `if (loaded)` block of 366 lines, the `if (primary)` block);
- the service builders: `buildTranslation`, `buildMaterial` and `linkedIpcDeps`.

**The seam already exists.**
- `mode-ipc.ts`, `material-ipc.ts`, `context-ipc.ts`, `sidekick-ipc.ts`, `linked-ipc.ts` and others each export a handler that takes a `*Deps` interface. `index.ts` builds the deps and registers the handler.
- The split carries that pattern through the rest of `registerIpc`.

**Steps.**
1. **IPC by domain.** Move each group of handlers out of `registerIpc` into a `*-ipc.ts` module, or into the one that already exists for that domain.
   - The domains, by channel group: setup (8), scopes (5), profiles (5), settings (3), tasks (4), jobs (2), data (2), files and reveal, and history (restore, undo).
   - `registerIpc` keeps only the `handle(...)` lines that join a channel to its handler.
2. **`taskDeps`** moves to `task-deps.ts`, as a function that takes what it reads from main's state.
3. **`appState()`** moves to `app-state.ts`, the same way.
4. **The service builders** (`buildTranslation`, `buildMaterial`, `linkedIpcDeps`) move next to the services they build.
5. **Window lifecycle.** `createWindow` and the `loaded` and `primary` blocks move to `window.ts` and `app-lifecycle.ts`.

**Main's state stays in `index.ts`.**
- Moving the 125 values into a state object would touch every line that reads them. That would be a behaviour-risky change, which this spec does not make.
- The moved modules get the state through their deps, as the `*-ipc.ts` modules already do.

### 5.2 `shell/src/main/task-manager.ts` (132 KB)

**Today.** The class is 2,759 lines. Its biggest methods are:
- the constructor (143 lines);
- `changed` (139);
- `begin` (120);
- `contextFor` (108);
- `runTurn` (97);
- `modeNow` (71);
- `resumeMessageFor` (69).

**The split.** Each concern moves into a module of functions that take the `CurrentTask` and the `TaskDeps`. The class keeps its public methods, and each one forwards to its module.

| Module | What moves |
|---|---|
| `task-context.ts` | `contextFor`, `startItems`, `resumeMessageFor`, the notes-index items, `needsCheckpoint` |
| `task-phases.ts` | `enterPhase`, `phaseAsked`, `wrapUp`, the time box's `arm` |
| `task-modes.ts` | `modeNow`, `modesOnEntry`, `chooseMode` |
| `task-notes.ts` | `saveNote`, `writeNote` |
| `task-types.ts` | `TaskDeps`, `PrepareAnswer`, `PhaseMoved`, `TurnEnd`, `PersonContext`, the error classes |

**What stays in the class:**
- the turn queue: `whenIdle`, `runTurn`, `begin`, `startNow`, `askNow`, `respondNow`, `addNow`, `closeCurrent`;
- `changed`.

**Boundary test.** The checks in `boundary.test.ts` for `task-manager.ts` (no `CHECKPOINT_AT`, no cap literal) also run on the new `task-*.ts` files.

### 5.3 `shell/src/main/sidekick.ts` (95 KB)

- The split follows what already exists: `sidekick-ipc.ts`, `sidekick-route.ts`, `sidekick-store.ts`, `sidekick-turns.ts` and `sidekick-import.ts`.
- The sections of `sidekick.ts` that match one of these modules move into it.
- What stays in `sidekick.ts` is the controller.
- The plan names the exact cut after reading the file.

### 5.4 `shell/src/main/plugins.ts` (82 KB)

- The split follows the existing `plugin-*.ts` modules: host, load, scheduler, panels, state, data and others.
- What stays in `plugins.ts` is the controller.

### 5.5 `workspace/src/history.ts` (52 KB) and `engines/src/acp/client.ts` (49 KB)

**These are small cuts.**
- `history.ts`: the parallel-turn code (`beginTurn`, `endTurn`, attribution) moves to `history-turns.ts`.
- `acp/client.ts`: the update parsing (tool calls, locations, diffs) moves to `acp/updates.ts`.

## 6. Order and PRs

1. **PR 1: the ratchet test, the baseline and the script.**
   - It needs no split.
   - From this PR on, oversized files stop growing.
2. **PRs 2–6: one PR per step of §5.1.**
   - `index.ts` comes first because it is the biggest and the most edited. Most PRs touch it, so it causes the most merge conflicts.
3. **PR 7: `task-manager.ts`.**
   - Queued items 2 (the CLI on the shared contract) and 6 (docs that check themselves) wait for it.
4. **PR 8: `sidekick.ts`.**
5. **PR 9: `plugins.ts`.**
6. **PR 10: `history.ts` and `acp/client.ts`.** Then one small PR each for `hatches.md` and `tools.md`.
7. **Not in this spec:**
   - the split of `ChatView.tsx`, `views.ts` and `styles.css` waits until the style guide merges, and gets a short plan of its own;
   - a test file is split when its module is split, in the same PR.

The PRs can run one after another, each in its own worktree. Two of them must not run in parallel when both touch `index.ts`.

## 7. What this spec does not do

- It does not rename anything, change behaviour, or move main's state into an object.
- It does not split files that are between 32 and 48 KB.
- It does not set a limit on lines or functions. Bytes are what the read tools cut on.

## 8. Docs

- `docs/architecture/replaceable-parts.md` gets one line under "Rules": the size limit and where its test lives.
- `docs/architecture/turn.md` names `index.ts` as the IPC handler. Each split PR updates any doc that names a moved symbol's file.
