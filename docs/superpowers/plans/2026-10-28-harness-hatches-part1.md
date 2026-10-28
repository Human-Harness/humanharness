# Harness hatches, part 1 (H1: linked folders) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship delivery slice 3 of the harness hatches spec (§9): a harness may declare `linkedFolders`. The person links folders that live outside their work folder to a scope, through a picker that refuses unsafe places. The agent gets file access to them (Claude through `--settings` `permissions.additionalDirectories`, Codex through ACP `additionalDirectories`), with deny rules for a repo's own config. A linked folder with no git is tracked by a core history of its own; one with git is left to its own git. A harness that declares no hatch is byte for byte today's app.

**Architecture.**

*Manifest.* `packages/harness-sdk/src/hatches.ts` adds `linkedFolders` (label, `mode`, `history`, `many`) and its checks (spec §3.1). Parts 2 and 3 add `backend` and `enginePresets` to the same file.

*Storage.* A scope's links live on its entry in `.harness/scopes.json`: `linked: [{ key, path, mode, tracked }]` (`ScopeStore.link`, `unlink`, `setTracked`, `markGitChanged`). An entry with no links is written exactly as today.

*Linking.* `packages/shell/src/main/linked-folders.ts` is pure plus thin I/O:
- `linkRefusal(real, ctx)` decides every refusal of spec §3.2 on real paths (links resolved);
- `isGitRepo(dir)` reads only `lstat` of `<dir>/.git` and, for a `.git` file, its first line;
- the IPC handler always opens the system picker itself: a harness can never pass a path.

*To the agent.* A turn carries a `TurnScope` (`packages/runtime/src/transport.ts`): `{ linked: LinkedAccess[] }`, built by the shell from the task's scope for **each turn** (`TurnDeps.scopeAccess`), passed through `SlotSendOptions.scope` to `Transport.turn(…, scope)`.
- **Claude** (`claude-cli.ts`): linked paths join the reference folders in the one `--settings {"permissions":{"additionalDirectories":[…]}}` that the references fix (f2363fe, in the base) introduced; never `--add-dir` (spec §3.5). `read` folders get the references' edit deny rules; `write` folders get explicit edit allow rules plus deny rules for `<path>/.claude/**` and `<path>/.git/**`.
- **Codex / ACP** (`acp.ts`): `initialize` must advertise `sessionCapabilities.additionalDirectories`. `write` folders go in `additionalDirectories` on `session/new` and on every `session/load`; a changed list reloads the session. `read` folders stay out of that list and join the permission policy's read roots. The policy gains write roots, and edits under `<write root>/{.git,.codex,.agents,.opencode,.claude}/**` are refused. Without the capability no folder is sent and the scope shows a line.

*AGENTS.md.* The managed section gains "Folders of this scope" (key, mode, path) of the open scope, written between tasks as today (`RuntimeOptions.instructionLinked`, read at create and on every `refreshInstructions`). Board mode puts the same section in each task's first message instead (Decision 6).

*History.* The workspace opens one `History` + `TurnLedger` per tracked (`tracked: true`, write, no git) linked folder, its gitdir in the app's data folder (`linkedHistoryDir`). Each turn of a scope with such folders runs `beginTurn`/`endTurn` on every one of them with the same trailer, so turns commit both, the crash undo restores both, and attribution runs per folder. "Undo this task" restores both. An untracked (git) folder is never committed or restored; the History panel says so.

**Tech Stack:** TypeScript, zod 4, isomorphic-git (`History`), ACP SDK 1.8 (`additionalDirectories`), Electron `dialog`, React 19, Vitest, fake-claude / fake-acp, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-27-harness-hatches-design.md` (the spike-updated version from 699b954, copied by Task 0): §2 D1, §3, §3.5, §6 S1/S2, §7 H1 tests, §9 slice 3. The references fix (§9 slice 2) is f2363fe, already in the base: origin/master (b9529a5, PR #53) is merged into `feat/parallel-tasks` before this plan runs, together with the file timeline (plan 16), the context panel (plan 17), language on demand and document review. This part builds H1's Claude path on `referenceSettingsArgs`. **Branch:** `feat/harness-hatches`, created by Task 0 from `feat/parallel-tasks` after that merge. Parts 2 (H2) and 3 (H3) continue on it.

---

## Conventions

**Code.** As plans 1–17 and parallel tasks parts 1–3:
- English everywhere (code, comments, docs, UI strings in `en.json`);
- packages export TS source; extensionless imports;
- tests in `packages/<name>/test/`; one behaviour per `it`, named after what it pins;
- match the surrounding style and comment density; no reformatting of existing code.

**Commands** (from the worktree root, never `cd` elsewhere):
- one file: `corepack pnpm vitest run <path>`;
- all: `corepack pnpm typecheck` and `corepack pnpm test`;
- shell main, preload, resources or UI touched: `corepack pnpm app:build`;
- e2e when the task says so: `corepack pnpm e2e` (or `corepack pnpm --filter @humanharness/e2e exec playwright test <file>`).

**Install nothing.** No `pnpm install` of any kind, no `npx` that downloads. Every library this plan uses is already in the lockfile.

**Git.** `git -C <worktree> …`, one simple command per call, never push, never a bare `git stash` (shared stack: a WIP commit instead), never commit on another branch. Stage only your own hunks. Trailer:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv
```

**i18n.** New strings go in `packages/i18n/src/locales/en.json`, in a new top-level `"hatches"` block (created by Task 9); edit nothing outside it. English UI strings (plan 5a); the spec's Spanish strings are design copy.

**Hot files.** Keep edits to `index.ts` (shell main), `task-manager.ts`, `turn-controller.ts`, `workspace.ts`, `runtime.ts`, `claude-cli.ts`, `acp.ts`, `client.ts`, preload, `HarnessApp.tsx`, `HistoryPanel.tsx`, `ScopePicker.tsx` small and additive.

## D0 is a hard rule

A harness that declares none of `linkedFolders`, `backend` or `enginePresets` behaves byte for byte as today: the same argv, environment, ACP requests, `AGENTS.md`, `scopes.json`, history commits, IPC channels and UI.

Concretely, without `linkedFolders`:
- `defineHarness` output has no `linkedFolders` key;
- no `TurnScope` is built (`TurnDeps.scopeAccess` is absent), so `claudeArgs` and ACP `session/new|load` params are today's;
- a scope entry is serialised without `linked`;
- the managed section of `AGENTS.md` has no "Folders of this scope" and keeps the rule "Work only inside this folder.";
- no linked history is opened, no `linked-history/` folder is created;
- no `hh:scopeLink*`/`hh:linked*` channel is registered; `AppState` has no `hatches` key; the scope picker shows no settings button.

| D0 item | Pinned by |
|---|---|
| Manifest | `packages/harness-sdk/test/hatches.test.ts` "D0: a manifest without hatches parses to the same object" (Task 1) |
| Claude argv | existing `claude-cli.test.ts` goldens as the merge left them (Sidekick's "D0: without noTools the argv is exactly the old one", the references fix's "passes no --settings and no --add-dir without reference folders (D0)") + new `packages/runtime/test/hatches-d0.test.ts` "claudeArgs without a scope, or with an empty one, is the golden argv" (Task 5) |
| ACP requests | `hatches-d0.test.ts` "session/new and session/load carry exactly cwd and mcpServers without linked folders" (Task 6) |
| AGENTS.md | existing `packages/workspace/test/instructions.test.ts` D0 cases + new "D0: no linked folders is exactly today's section" (Task 7) |
| History commits | existing `packages/runtime/test/runtime-d0.test.ts` unchanged; new `workspace-linked.test.ts` "D0: a turn without linked folders opens no linked history" (Task 8) |
| scopes.json | `packages/workspace/test/scopes.test.ts` "D0: an entry without links is written exactly as before" (Task 2) |
| IPC and state | `packages/shell/test/hatches-surface.test.ts` (Task 9): channels registered only under `hasLinkedFolders`; `appState` without `hatches` |
| UI | `packages/ui/test/hatches-ui.test.tsx` "D0: no settings button and no linked lines without state.hatches" (Tasks 11, 12) |
| E2E | existing `packages/e2e/tests/history.spec.ts` (demo commit messages) stays green unchanged |

Never edit the expectations of `runtime-d0.test.ts`, the e2e golden, or a D0 test once pinned. If the merge left the Sidekick golden still naming `--add-dir` for references (a semantic conflict git can't flag), that is a merge bug: report it to the coordinator, don't fix it inside a hatches task.

## Threat model (part 1)

| # | Boundary | What enforces it | Test |
|---|---|---|---|
| L1 | Nothing is linked without the person choosing it | `hh:scopeLinkFolder(scope, key)` takes no path; main opens `dialog.showOpenDialog` itself; the key must be `Object.hasOwn(harness.linkedFolders, key)`, the scope a registered, unarchived one | `linked-ipc.test.ts` "a path argument is ignored; the picker always opens" (Task 9) |
| L2 | Picker refusals, links resolved | `linkRefusal` on the **real** path (and on the path as written): `~/.claude`, `~/.codex` and every protected engine/credential home (validate.ts `PROTECTED`, dot-folders in home), the home folder, system folders, the main folder / inside it / containing it, the app root with profiles, another scope's `write` folder, nested with a same-scope link, `history: "own"` without git, a comma in the path | `linked-folders.test.ts` table, each through a symlink too (Task 3) |
| L3 | A repo's own config can't run unapproved code | Claude: `write` folders deny `Edit/Write/MultiEdit(//<path>/.claude/**)` and `(//<path>/.git/**)`; access goes through `permissions.additionalDirectories`, never `--add-dir`, so the folder's `.claude/{skills,commands,agents}` are not loaded (S2). ACP: `decidePermission` refuses edits under `<root>/{.git,.codex,.agents,.opencode,.claude}/**` | `claude-cli.test.ts` "linked folders" block (Task 5); `acp.test.ts` "linked folders" block (Task 6) |
| L4 | `read` folders stay read-only | Claude: edit deny rules by absolute path; ACP: never in `additionalDirectories` (the sandbox would make them writable), only in `readRoots` | Tasks 5, 6 |
| L5 | Another scope's folders never reach a turn | `TurnScope` is built from the **turn's** task scope (`scopeOfTask`), never from the open scope or a window argument | `scope-access.test.ts` (Task 10) |
| L6 | Unlink takes effect at once | Claude gets the list per turn; ACP reloads the session when the list changes (`session/load` with the new list replaces the old one) and the policy's roots are replaced before the prompt | `acp.test.ts` "a changed list reloads the session" (Task 6) |
| L7 | Undo never writes outside a tracked folder or into a git one | linked histories only for `tracked: true`; `History.restore` keeps its link checks inside that folder; untracked folders are never passed to `History` | `workspace-linked.test.ts`, `linked-restore.test.ts` (Tasks 8, 11) |
| L8 | The app never reads `~/.claude`, `~/.codex` | refusals are path comparisons only (`folderProblem`, `homeOrDotFolder`); `isGitRepo` reads only `<linked>/.git` | source scan in `linked-folders.test.ts` (Task 3) |
| L9 | Untrusted ids from the window | `scope`: `isScopeId` + `scopeExists`; `key`: `Object.hasOwn`, ≤ 64; `path` for unlink must equal a stored entry (`find`), never used to build a regex | `linked-ipc.test.ts` (Task 9) |

## Decisions this plan takes where the spec leaves room

1. **`label` is one English string**, not `{ es, en }`: every manifest text is one English string (plan 5a), as the jobs' labels.
2. **`tracked` = `mode === "write"` and the folder is not a git repository** at link time. A `read` folder is never tracked: the agent can't change it, so a history would record only the person's own edits. `history: "own"` refuses a non-git folder.
3. **Git detection**: `<dir>/.git` is a directory holding `HEAD`, or a regular file whose first line starts with `gitdir:` (a worktree or submodule). A link at `.git` counts as no git (and is never followed).
4. **The linked list is built per turn** from the task's scope (Claude per turn; ACP compares with the open session's list and reloads it on change, L6). Linking mid-task therefore reaches the next turn.
5. **Linked histories** live under `<userData>/linked-history/<sha256(real path) first 16 hex>`. Unlink writes `<dir>/unlinked-at` (ISO time); a relink of the same path removes it and continues the history; at app start, dirs whose `unlinked-at` is older than 30 days go to the system Trash; when the Trash fails they are kept and the failure is logged.
6. **AGENTS.md vs board mode.** In plain and `single` mode the managed section lists the open scope's linked folders (spec §3.3). In board mode lanes can run in different scopes at once while `AGENTS.md` is shared, so the managed section lists none and each task's first message carries the same "Folders of this scope" section for its own scope (`TaskDeps.linkedContext`). Open question 1.
7. **The rule "Work only inside this folder."** becomes "Work only inside this folder and the folders of this scope listed below." only when the section is present.
8. **Explicit allow rules for `write` folders on Claude** (`Edit(//<path>/**)`, `Write(…)`, `MultiEdit(…)`) next to `additionalDirectories`. They are harmless if `acceptEdits` already covers additional directories and make the access hold if it doesn't (S2 live check pending). Deny rules beat them, so `.claude/**` and `.git/**` stay denied.
9. **ACP without `loadSession`** and a changed list: the session ends and a new one starts with the new list (the conversation is lost; the task shows the existing "Couldn't resume" notice in board mode). Codex advertises `loadSession`, so this is a fallback.
10. **OpenCode** gets linked folders only when its adapter advertises the capability (same rule as Codex); `.opencode/**` is in the ACP deny list for write roots.
11. **Attribution in linked folders** runs per tracked folder (spec §3.4) but only the main folder's result reaches `onAttribution` (board conflict notices). Linked-folder conflicts are logged. Open question 4.
12. **"Go back here"** (whole-folder restore of one entry) stays main-folder only. "Undo this task" and the crash undo cover tracked linked folders. Open question 3.
13. **A folder that gains or loses git** is checked when the scope opens (`scopeOpen`) and when Scope settings opens. The entry gets `gitChanged: true` and keeps its old `tracked` until the person confirms in Scope settings ("Track with the app's history" / "Leave to its own git"); the old core history stays either way.
14. **Scope settings UI**: a sheet opened from a "Settings" button next to the scope picker, shown only with `state.hatches`. Part 3 adds the "Engine config" section to the same sheet.
15. **Codex without the capability**: the transport calls `onLinkedUnsupported()` once per process; main keeps the flag in memory (`linkedUnsupported`) and Scope settings shows "Linked folders don't work with this version of Codex yet." No folder is sent, and the policy grants nothing under them.

## File structure

| File | Change | Responsibility |
|---|---|---|
| `packages/harness-sdk/src/hatches.ts` | Create | `linkedFoldersSchema`, `hasLinkedFolders`, `hatchProblems` (parts 2–3 extend) |
| `packages/harness-sdk/src/index.ts` | Modify | `linkedFolders` key, superRefine, re-export |
| `packages/workspace/src/scopes.ts` | Modify | `LinkedFolderEntry`, `link`, `unlink`, `setTracked`, `markGitChanged` |
| `packages/workspace/src/instructions.ts` | Modify | "Folders of this scope" in the managed section |
| `packages/runtime/src/transport.ts` | Modify | `LinkedAccess`, `TurnScope`, `Transport.turn(…, scope?)` |
| `packages/runtime/src/claude-cli.ts` | Modify | `scopeSettingsArgs`, linked allow/deny rules |
| `packages/runtime/src/acp.ts` | Modify | capability, `additionalDirectories`, reload on change, write roots, deny list |
| `packages/runtime/src/workspace.ts`, `runtime.ts` | Modify | `SlotSendOptions.scope`, `instructionLinked`, linked histories |
| `packages/fake-agent/src/fake-acp.ts`, `script.ts` | Modify | `additionalDirectories` capability flag |
| `packages/shell/src/main/linked-folders.ts` | Create | refusals, git detection, `checkLink` |
| `packages/shell/src/main/linked-history.ts` | Create | gitdirs, unlink marker, 30-day prune |
| `packages/shell/src/main/linked-ipc.ts` | Create | `registerLinkedIpc(handle, deps)` |
| `packages/shell/src/main/scope-access.ts` | Create | `TurnScope` for a task's scope; linked lines for AGENTS.md and first messages |
| `packages/shell/src/main/linked-restore.ts` | Create | "Undo this task" over tracked linked folders; `linkedHistoryView` |
| `packages/shell/src/main/turn-controller.ts`, `task-manager.ts`, `jobs/job-runner.ts`, `index.ts` | Modify | wiring (one optional dep each) |
| `packages/shell/src/preload/index.ts`, `packages/ui/src/client.ts`, `packages/ui/test/fake-client.ts` | Modify | `client.scopes.linked/linkFolder/unlinkFolder/confirmGit/linkedHistory`, `AppState.hatches` |
| `packages/ui/src/hatches/ScopeSettings.tsx`, `LinkedFolders.tsx` | Create | the sheet and its section |
| `packages/ui/src/ScopePicker.tsx`, `HistoryPanel.tsx` | Modify | settings button; linked lines |
| `packages/i18n/src/locales/en.json` | Modify | `"hatches"` block |
| `packages/fake-agent/fixtures/hatches-harness/` | Create | scopes + `linkedFolders` fixture |
| `packages/e2e/tests/hatches-linked.spec.ts` | Create | e2e |
| docs | Modify | `docs/architecture/hatches.md` (new), `manifest.md`, `engines.md`, `history.md`, `data.md` |

## Overlaps with code from parallel tasks parts 1–3 and earlier plans

- **The origin/master merge (in the base).** References fix f2363fe: `referenceSettingsArgs` becomes `scopeSettingsArgs(references, scope)` in Task 5, which keeps the no-scope output identical. Language on demand: `claudeArgs`' `mcpOnly` (system tasks, no file tools) refuses a linked folder like `noTools`; system tasks never get a `TurnScope`. Context panel (plan 17): `contextFor` returns `{ text, items }`, so the board-mode linked section (Task 10) adds a `ContextItem`; part 3's scope instructions fill the reserved `scope-instructions` kind. File timeline (plan 16): it covers only the main folder's tracked files, so a linked folder's files have no timeline; the History panel carries the "not covered" line (Task 12; Known gap in `hatches.md`). Document review: unchanged (reviews act on the main folder only).
- **Sidekick `noTools`** (`claudeArgs`): a no-tools session refuses a non-empty `scope.linked` exactly as it refuses references.
- **Parallel part 1** (`workspace.ts`, `turn-commit.ts`, `TurnLedger`): linked histories reuse `beginTurn`/`endTurn` unchanged; the slot's existing per-key window rules apply per ledger.
- **Parallel part 2** (board mode): `restoreTaskByPaths` runs per tracked linked history in Task 11; lanes get `TurnScope` through the shared `turnDeps`.
- **Parallel part 3** (jobs): a scoped job run gets the scope's `TurnScope` through `JobRunner`'s send (Task 10). Its `Job:` trailer reaches the linked commits too.
- **Plugins** (`index.ts` `handle`, `ipc-surface.test.ts`): new channels go through `handle()`; the B5 source scan stays green.

## Open questions (each with the default this plan takes)

1. Board mode and `AGENTS.md`: the section goes in each task's first message (Decision 6).
2. A `read` linked folder is never tracked (Decision 2).
3. "Go back here" stays main-folder only (Decision 12).
4. Linked-folder conflicts in board mode are logged, not shown (Decision 11).
5. OpenCode linked folders follow the capability (Decision 10).
6. Synced drives (spec §10 Q1): no extra warning in v1.

## Standing rules

As in parallel tasks parts 1–3. English UI strings: "Linked folders", "Link a folder…", "Unlink", "Read only", "Read and write", "Tracked by the app's history", "Has its own git", "Undo doesn't cover this folder: it has its own git.", "This folder now has its own git.", "This folder no longer has git.", "Track with the app's history", "Leave to its own git", "Linked folders don't work with this version of Codex yet.", and the refusal reasons of Task 9.

## Self-review (done while writing)

- Spec coverage:
  - §3.1 manifest + checks: Task 1.
  - §3.2 who links, picker, refusals, storage, unlink, 30-day history, moving the main folder: Tasks 2, 3, 4, 9 (moving: paths are absolute; nothing to do, pinned in Task 9).
  - §3.3 Claude access + deny rules: Task 5; Codex: Task 6; managed section: Tasks 7, 10.
  - §3.4 history tracked/untracked, both histories, undo, crash undo, attribution, "no cubre", gain/lose git: Tasks 8, 10, 11, 12.
  - §3.5 never `--add-dir`: in the base for references (f2363fe), Task 5 for linked folders.
  - §7 H1 tests: Tasks 3, 5, 6, 8, 11, 13.
  - §7 E2E "link a git folder and a plain one": Task 13.
- Types defined once: `LinkedFolderDecl` (Task 1), `LinkedFolderEntry` (Task 2), `LinkRefusal`, `LinkContext` (Task 3), `linkedHistoryDir` (Task 4), `LinkedAccess`, `TurnScope` (Task 5), `LinkedFolderLine` (Task 7), `LinkedView`, `HatchesState` (Task 9), `ScopeAccessDeps` (Task 10), `LinkedHistoryView` (Task 11).

---

### Task 0: Branch, spec and plans

The base already holds the references fix: Marco merged origin/master (b9529a5, which contains PR #53 = f2363fe, plus the file timeline, the context panel, language on demand and document review) into `feat/parallel-tasks` before this plan runs. **Do not cherry-pick f2363fe.**

**Files:**
- Create: branch `feat/harness-hatches`
- Modify: `docs/superpowers/specs/2026-10-27-harness-hatches-design.md` (replaced by the 699b954 version)
- Create: `docs/superpowers/plans/2026-10-28-harness-hatches-part1.md`, `-part2.md`, `-part3.md`

- [ ] **Step 1: Check the base.** The worktree must be on `feat/parallel-tasks` with origin/master merged in, clean.

```bash
git -C <worktree> status --short
git -C <worktree> branch --show-current
git -C <worktree> merge-base --is-ancestor origin/master HEAD
git -C <worktree> merge-base --is-ancestor f2363fe HEAD
grep -n "referenceSettingsArgs\|add-dir" <worktree>/packages/runtime/src/claude-cli.ts
```
Expected: no status output; `feat/parallel-tasks`; both `merge-base` calls exit 0; `referenceSettingsArgs` defined and used in `claudeArgs`, no `--add-dir` call (only comments). If either ancestor check fails, stop and report to the coordinator: the merge has not happened yet.

Also note, for later tasks, what the merge brought into the files this plan touches (read them now, they are the truth):
- `packages/runtime/src/claude-cli.ts`: `claudeArgs` takes both `mcpOnly` (language on demand, master) and `noTools` (Sidekick, this stack); `allowedTools(permissions, mcp, mcpOnly)` and `disallowedTools(permissions, references, mcpOnly)` take a third argument. Task 5 adds its linked-folder parameter **after** the existing ones.
- `packages/shell/src/main/task-manager.ts`: `contextFor(scope, action)` returns `{ text, items: ContextItem[] }` (context panel); `startItems` builds the panel's start items. Tasks 10 (here) and part 3 add items there.
- `packages/ui/src/client.ts`: `ContextItemKind` already reserves `"scope-instructions"` for part 3.
- `docs/architecture/timeline.md`, `context.md`, `documents.md`, `reviews.md`, `language.md` exist.

- [ ] **Step 2: Branch.**

```bash
git -C <worktree> switch -c feat/harness-hatches
```

- [ ] **Step 3: Spec and plans.** The spec on this branch is the pre-spike version; replace it with the one from 699b954 (identical to `SCRATCH/../spec.md`). Copy the three plans (they sit one level above `part1/`).

```bash
git -C <worktree> show 699b954:docs/superpowers/specs/2026-10-27-harness-hatches-design.md > <worktree>/docs/superpowers/specs/2026-10-27-harness-hatches-design.md
cp SCRATCH/../2026-10-28-harness-hatches-part1.md SCRATCH/../2026-10-28-harness-hatches-part2.md SCRATCH/../2026-10-28-harness-hatches-part3.md <worktree>/docs/superpowers/plans/
git -C <worktree> add docs/superpowers/specs/2026-10-27-harness-hatches-design.md docs/superpowers/plans/2026-10-28-harness-hatches-part1.md docs/superpowers/plans/2026-10-28-harness-hatches-part2.md docs/superpowers/plans/2026-10-28-harness-hatches-part3.md
git -C <worktree> commit -m "docs: harness hatches spec after spikes S1-S3, and its plans" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```
(If the merge already brought the 699b954 spec, `git status` shows no change for it: commit the plans alone.)

- [ ] **Step 4: Full run.** `corepack pnpm typecheck` and `corepack pnpm test` green (known flakes: see carry notes). Write the base line in `carry-notes.md`: HEAD SHA, test count, and that `claudeArgs` already sends references through `--settings`.

---

### Task 1: `linkedFolders` in the manifest

**Files:**
- Create: `packages/harness-sdk/src/hatches.ts`
- Modify: `packages/harness-sdk/src/index.ts`
- Test: `packages/harness-sdk/test/hatches.test.ts`

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/harness-sdk/test/hatches.test.ts
import { describe, expect, it } from "vitest";
import { defineHarness, hasLinkedFolders, hatchProblems } from "../src";

const base = {
  id: "t", name: "T", core: "^0.1.0", engines: ["claude"], folder: { suggested: "Documents/T" }, instructions: "./AGENTS.md",
  permissions: { edit: "folder" as const, exec: true, web: false }, blocks: {}, author: "x",
  actions: { implement: { label: "Implement", prompt: "./prompts/implement.md" } },
};
const scoped = { ...base, scopes: { label: "Project", plural: "Projects" } };
const repos = { label: "Repos", mode: "write" as const, history: "auto" as const, many: true };

describe("linkedFolders (hatches spec §3.1)", () => {
  it("D0: a manifest without hatches parses to the same object", () => {
    const h = defineHarness(scoped);
    expect("linkedFolders" in h).toBe(false);
    expect(hasLinkedFolders(h)).toBe(false);
    expect(hatchProblems(h)).toEqual([]);
  });

  it("parses a declaration and fills the defaults", () => {
    const h = defineHarness({ ...scoped, linkedFolders: { repos, manuscript: { label: "Manuscript", mode: "read" } } });
    expect(h.linkedFolders?.repos).toEqual(repos);
    expect(h.linkedFolders?.manuscript).toEqual({ label: "Manuscript", mode: "read", history: "auto", many: false });
    expect(hasLinkedFolders(h)).toBe(true);
  });

  it.each([
    ["without scopes", { ...base, linkedFolders: { repos } }, "scopes"],
    ["write without permissions.edit folder", { ...scoped, permissions: { edit: "none", exec: false, web: false }, linkedFolders: { repos } }, "edit"],
    ["a key outside the action-id pattern", { ...scoped, linkedFolders: { "Bad Key": repos } }, undefined],
    ["an unknown field (strict)", { ...scoped, linkedFolders: { repos: { ...repos, path: "/x" } } }, undefined],
    ["a label over 40 characters", { ...scoped, linkedFolders: { repos: { ...repos, label: "x".repeat(41) } } }, undefined],
    ["more than 8 keys", { ...scoped, linkedFolders: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, repos])) }, undefined],
  ])("refuses %s", (_name, manifest, message) => {
    const run = () => defineHarness(manifest as never);
    if (message) expect(run).toThrow(message);
    else expect(run).toThrow();
  });

  it("an empty declaration counts as none", () => {
    expect(hasLinkedFolders(defineHarness({ ...scoped, linkedFolders: {} }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to see them fail.** `corepack pnpm vitest run packages/harness-sdk/test/hatches.test.ts`. Expected: FAIL (`hasLinkedFolders` is not exported).

- [ ] **Step 3: Implement** `packages/harness-sdk/src/hatches.ts`:

```ts
import { z } from "zod";

/** A linked folder's key: the action id pattern (spec §3.1). */
export const LINKED_KEY = /^[a-z][a-z0-9_-]{0,63}$/;
/** The most keys a harness may declare. */
export const LINKED_KEYS_MAX = 8;
/** The most folders one scope may link under one `many` key. */
export const LINKED_MANY_MAX = 16;

/** One kind of folder a scope may link (hatches spec §3.1). Strict: a typo is refused. */
export const linkedFolderSchema = z.strictObject({
  /** What Scope settings calls it: one English string (plan 5a). */
  label: z.string().min(1).max(40),
  /** `read`: the agent reads only; `write`: it may change files there. */
  mode: z.enum(["read", "write"]),
  /** `auto`: tracked by the core history unless it is a git repository (D1); `own`: must be a git repository. */
  history: z.enum(["auto", "own"]).default("auto"),
  /** Several folders under this key, or one. */
  many: z.boolean().default(false),
});
export type LinkedFolderDecl = z.output<typeof linkedFolderSchema>;

export const linkedFoldersSchema = z
  .record(z.string().regex(LINKED_KEY), linkedFolderSchema)
  .refine((r) => Object.keys(r).length <= LINKED_KEYS_MAX, { message: `At most ${LINKED_KEYS_MAX} linked folder keys` });

/** The harness declares at least one kind of linked folder. False: no part-1 code runs (D0). */
export const hasLinkedFolders = (h: { linkedFolders?: Record<string, unknown> }): boolean =>
  !!h.linkedFolders && Object.keys(h.linkedFolders).length > 0;

/** Each problem of the hatches a manifest declares (spec §3.1 checks), for `superRefine`. */
export function hatchProblems(h: {
  scopes?: unknown;
  permissions: { edit: "folder" | "none" };
  linkedFolders?: Record<string, LinkedFolderDecl>;
}): { path: (string | number)[]; message: string }[] {
  const out: { path: (string | number)[]; message: string }[] = [];
  if (hasLinkedFolders(h) && !h.scopes) out.push({ path: ["linkedFolders"], message: "Linked folders belong to a scope: declare scopes" });
  for (const [key, f] of Object.entries(h.linkedFolders ?? {})) {
    if (f.mode === "write" && h.permissions.edit !== "folder") {
      out.push({ path: ["linkedFolders", key, "mode"], message: 'mode "write" needs permissions.edit: "folder"' });
    }
  }
  return out;
}
```

In `index.ts`:
- import `{ hatchProblems, linkedFoldersSchema }` from `./hatches`; `export * from "./hatches";`;
- in `manifestSchema`, after `inbox`: `/** Folders outside the person's folder, linked per scope (hatches spec §3). Absent: none (D0). */ linkedFolders: linkedFoldersSchema.optional(),`;
- at the end of `superRefine`: `for (const p of hatchProblems(m)) ctx.addIssue({ code: "custom", path: p.path, message: p.message });`.

- [ ] **Step 4: Run.** `corepack pnpm vitest run packages/harness-sdk/test`. Expected: PASS (every existing SDK test too).

- [ ] **Step 5: Typecheck, test, commit.**

```bash
git -C <worktree> add packages/harness-sdk/src/hatches.ts packages/harness-sdk/src/index.ts packages/harness-sdk/test/hatches.test.ts
git -C <worktree> commit -m "feat(sdk): linkedFolders in the manifest, with their checks" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 2: Links on the scope entry

**Files:**
- Modify: `packages/workspace/src/scopes.ts`
- Test: `packages/workspace/test/scopes.test.ts` (append)

- [ ] **Step 1: Write the failing tests** (append to `scopes.test.ts`):

```ts
describe("ScopeStore links (hatches spec §3.2)", () => {
  const file = (base: string) => path.join(base, ".harness", "scopes.json");

  it("D0: an entry without links is written exactly as before", async () => {
    const base = tmp();
    const store = new ScopeStore(base, at);
    await store.create("Fracciones");
    expect(fs.readFileSync(file(base), "utf8")).toBe(
      `${JSON.stringify([{ id: "fracciones", title: "Fracciones", createdAt: "2026-10-25T10:00:00.000Z", archived: false }], null, 2)}\n`,
    );
  });

  it("links, lists and unlinks; unlinking the last link removes the key", async () => {
    const base = tmp();
    const store = new ScopeStore(base, at);
    await store.create("App");
    const e = { key: "repos", path: "/Users/me/code/app", mode: "write" as const, tracked: false };
    await store.link("app", e);
    expect((await store.list())[0].linked).toEqual([e]);
    await store.unlink("app", "repos", "/Users/me/code/app");
    expect("linked" in (await store.list())[0]).toBe(false);
    expect(fs.readFileSync(file(base), "utf8")).not.toContain("linked");
  });

  it("refuses the same path twice in one scope, and an unknown scope", async () => {
    const store = new ScopeStore(tmp(), at);
    await store.create("App");
    const e = { key: "repos", path: "/a", mode: "write" as const, tracked: true };
    await store.link("app", e);
    await expect(store.link("app", { ...e, key: "other" })).rejects.toThrow(/already linked/);
    await expect(store.link("nope", e)).rejects.toThrow(/Unknown scope/);
  });

  it("setTracked flips tracked and clears gitChanged; markGitChanged sets it", async () => {
    const store = new ScopeStore(tmp(), at);
    await store.create("App");
    await store.link("app", { key: "repos", path: "/a", mode: "write", tracked: true });
    await store.markGitChanged("app", "repos", "/a");
    expect((await store.list())[0].linked?.[0].gitChanged).toBe(true);
    await store.setTracked("app", "repos", "/a", false);
    expect((await store.list())[0].linked?.[0]).toEqual({ key: "repos", path: "/a", mode: "write", tracked: false });
  });

  it("drops a hand-edited link entry that isn't valid, keeping the scope", async () => {
    const base = tmp();
    fs.mkdirSync(path.join(base, ".harness"), { recursive: true });
    fs.writeFileSync(file(base), JSON.stringify([
      { id: "app", title: "App", createdAt: "", archived: false, linked: [{ key: "repos", path: "relative", mode: "write", tracked: false }, { key: "Bad", path: "/b", mode: "x", tracked: 1 }, { key: "repos", path: "/ok", mode: "read", tracked: false }] },
    ]));
    const [s] = await new ScopeStore(base, at).list();
    expect(s.linked).toEqual([{ key: "repos", path: "/ok", mode: "read", tracked: false }]);
  });
});
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement** in `scopes.ts`:

```ts
/** A folder linked to a scope (hatches spec §3.2). `path` is absolute and real (links resolved at link time). */
export interface LinkedFolderEntry {
  key: string;
  path: string;
  mode: "read" | "write";
  /** True: the core history tracks it (no git, D1). False: its own git is its history. */
  tracked: boolean;
  /** The folder gained or lost git since it was linked; the person hasn't confirmed the change yet (Decision 13). */
  gitChanged?: true;
}

/** One entry of `.harness/scopes.json` … */
export interface ScopeEntry {
  id: string;
  title: string;
  createdAt: string;
  archived: boolean;
  /** Linked folders (hatches spec §3.2). Absent when there are none, so the file is today's (D0). */
  linked?: LinkedFolderEntry[];
}

const LINK_KEY = /^[a-z][a-z0-9_-]{0,63}$/;
const LINK_PATH_MAX = 4096;

function cleanLink(v: unknown): LinkedFolderEntry | null {
  if (!isObject(v) || typeof v.key !== "string" || !LINK_KEY.test(v.key)) return null;
  if (typeof v.path !== "string" || v.path.length > LINK_PATH_MAX || !path.isAbsolute(v.path)) return null;
  if (v.mode !== "read" && v.mode !== "write") return null;
  if (typeof v.tracked !== "boolean") return null;
  return { key: v.key, path: v.path, mode: v.mode, tracked: v.tracked, ...(v.gitChanged === true ? { gitChanged: true as const } : {}) };
}
```

`cleanEntry` adds, after the four fields: the valid, de-duplicated (by path) links, and the `linked` key only when at least one is left:

```ts
  const links: LinkedFolderEntry[] = [];
  for (const l of Array.isArray(v.linked) ? v.linked : []) {
    const c = cleanLink(l);
    if (c && !links.some((x) => x.path === c.path)) links.push(c);
  }
  return { id: v.id, title: v.title, createdAt: …, archived: …, ...(links.length > 0 ? { linked: links } : {}) };
```

New methods (all through `update`, so one write at a time):

```ts
  /** Adds a link to scope `id`. Refuses a path the scope already links. The caller checked every refusal (L2). */
  link(id: string, entry: LinkedFolderEntry): Promise<ScopeEntry> {
    const clean = cleanLink(entry);
    if (!clean) throw new Error("Invalid linked folder");
    return this.update(id, (s) => {
      if ((s.linked ?? []).some((l) => l.path === clean.path)) throw new Error(`${clean.path} is already linked to this scope`);
      return { ...s, linked: [...(s.linked ?? []), clean] };
    });
  }

  /** Removes the link; never touches the folder. The last link removes the key (D0 shape). */
  unlink(id: string, key: string, folder: string): Promise<ScopeEntry> {
    return this.update(id, (s) => {
      const rest = (s.linked ?? []).filter((l) => !(l.key === key && l.path === folder));
      const { linked: _old, ...plain } = s;
      return rest.length > 0 ? { ...plain, linked: rest } : plain;
    });
  }

  setTracked(id: string, key: string, folder: string, tracked: boolean): Promise<ScopeEntry> {
    return this.updateLink(id, key, folder, (l) => ({ key: l.key, path: l.path, mode: l.mode, tracked }));
  }

  markGitChanged(id: string, key: string, folder: string): Promise<ScopeEntry> {
    return this.updateLink(id, key, folder, (l) => ({ ...l, gitChanged: true }));
  }

  private updateLink(id: string, key: string, folder: string, fn: (l: LinkedFolderEntry) => LinkedFolderEntry): Promise<ScopeEntry> {
    return this.update(id, (s) => {
      const i = (s.linked ?? []).findIndex((l) => l.key === key && l.path === folder);
      if (i < 0) throw new Error("Unknown linked folder");
      return { ...s, linked: s.linked!.map((l, j) => (j === i ? fn(l) : l)) };
    });
  }
```

`rename` and `setArchived` keep `linked` through their spread (check with the existing tests).

- [ ] **Step 4: Run.** `corepack pnpm vitest run packages/workspace/test/scopes.test.ts packages/workspace/test/migrate.test.ts`. Expected: PASS.

- [ ] **Step 5: Typecheck, test, commit.**

```bash
git -C <worktree> add packages/workspace/src/scopes.ts packages/workspace/test/scopes.test.ts
git -C <worktree> commit -m "feat(workspace): linked folders on the scope entry" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 3: Picker refusals and git detection

**Files:**
- Create: `packages/shell/src/main/linked-folders.ts`
- Test: `packages/shell/test/linked-folders.test.ts`

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/shell/test/linked-folders.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkLink, isGitRepo, linkRefusal } from "../src/main/linked-folders";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hh-link-")));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const home = path.join(root, "home");
const work = path.join(home, "Documents", "Work");
const mk = (p: string) => (fs.mkdirSync(p, { recursive: true }), p);
mk(work);
const ctx = (over: Partial<Parameters<typeof linkRefusal>[1]> = {}) => ({
  home, folder: work, root: undefined, sameScope: [], otherScopesWrite: [], mode: "write" as const, history: "auto" as const, isGit: false, ...over,
});

describe("linkRefusal (hatches spec §3.2)", () => {
  it.each([
    ["~/.claude", path.join(home, ".claude"), "engine-home"],
    ["inside ~/.codex", path.join(home, ".codex", "x"), "engine-home"],
    ["~/.gemini", path.join(home, ".gemini"), "engine-home"],
    ["~/.config/opencode", path.join(home, ".config", "opencode"), "engine-home"],
    ["a dot folder in home (~/.ssh)", path.join(home, ".ssh"), "engine-home"],
    ["the home folder", home, "home"],
    ["the main folder", work, "main-folder"],
    ["inside the main folder", path.join(work, "sub"), "main-folder"],
    ["a folder that contains the main folder", path.join(home, "Documents"), "too-broad"],
    ["a folder above the main folder", path.join(home, "Documents", "x", ".."), "too-broad"],
    ["/", "/", "system"],
    ["/usr", "/usr/local/x", "system"],
    ["/System", "/System/Library", "system"],
    ["/Applications", "/Applications/X.app", "system"],
    ["a comma in the path", path.join(home, "code", "a,b"), "comma"],
  ])("refuses %s", (_n, p, why) => {
    expect(linkRefusal(p, ctx())).toBe(why);
  });

  it("refuses a folder that contains the main folder but is not a standard one", () => {
    expect(linkRefusal(path.join(home, "Documents", "Work", ".."), ctx({ folder: path.join(home, "proj", "Work") }))).toBeNull();
    expect(linkRefusal(path.join(home, "proj"), ctx({ folder: path.join(home, "proj", "Work") }))).toBe("main-folder");
  });

  it("refuses another scope's write folder, but not its read folder", () => {
    const repo = path.join(home, "code", "app");
    expect(linkRefusal(repo, ctx({ otherScopesWrite: [repo] }))).toBe("other-scope-write");
    expect(linkRefusal(repo, ctx())).toBeNull();
  });

  it("refuses nesting with a link of the same scope, both ways", () => {
    const repo = path.join(home, "code", "app");
    expect(linkRefusal(path.join(repo, "pkg"), ctx({ sameScope: [repo] }))).toBe("nested");
    expect(linkRefusal(path.join(home, "code"), ctx({ sameScope: [repo] }))).toBe("nested");
    expect(linkRefusal(repo, ctx({ sameScope: [repo] }))).toBe("already-linked");
  });

  it("refuses with profiles a folder inside the app root", () => {
    expect(linkRefusal(path.join(home, "Documents", "App", "ana"), ctx({ folder: path.join(home, "Documents", "App", "bo"), root: path.join(home, "Documents", "App") }))).toBe("main-folder");
  });

  it('history "own" needs git', () => {
    const repo = path.join(home, "code", "app");
    expect(linkRefusal(repo, ctx({ history: "own" }))).toBe("not-git");
    expect(linkRefusal(repo, ctx({ history: "own", isGit: true }))).toBeNull();
  });

  it("compares without case (macOS file systems)", () => {
    expect(linkRefusal(path.join(home, ".CLAUDE"), ctx())).toBe("engine-home");
    expect(linkRefusal(work.toUpperCase(), ctx())).toBe("main-folder");
  });
});

describe("checkLink (real paths)", () => {
  it("refuses through a symlink: a link to ~/.claude is refused as ~/.claude", async () => {
    mk(path.join(home, ".claude"));
    const link = path.join(home, "innocent");
    fs.symlinkSync(path.join(home, ".claude"), link);
    expect(await checkLink(link, { ...ctx(), mode: "write", history: "auto" })).toEqual({ refused: "engine-home" });
  });

  it("refuses through a symlink into the main folder", async () => {
    const link = path.join(home, "shortcut");
    fs.symlinkSync(work, link);
    expect(await checkLink(link, ctx())).toEqual({ refused: "main-folder" });
  });

  it("accepts a plain folder, stores its real path and tracks it (write, no git)", async () => {
    const plain = mk(path.join(home, "notes"));
    const link = path.join(home, "notes-link");
    fs.symlinkSync(plain, link);
    expect(await checkLink(link, ctx())).toEqual({ path: plain, tracked: true });
  });

  it("does not track a git folder, nor a read folder", async () => {
    const repo = mk(path.join(home, "code", "repo"));
    mk(path.join(repo, ".git"));
    fs.writeFileSync(path.join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
    expect(await checkLink(repo, ctx())).toEqual({ path: repo, tracked: false });
    expect(await checkLink(mk(path.join(home, "plain2")), ctx({ mode: "read" }))).toEqual({ path: path.join(home, "plain2"), tracked: false });
  });

  it("refuses a file and a missing folder", async () => {
    const f = path.join(home, "file.txt");
    fs.writeFileSync(f, "x");
    expect(await checkLink(f, ctx())).toEqual({ refused: "not-folder" });
    expect(await checkLink(path.join(home, "missing"), ctx())).toEqual({ refused: "not-folder" });
  });
});

describe("isGitRepo (Decision 3)", () => {
  it("a .git folder with HEAD, or a gitdir file, is git; a link at .git is not; nothing else is read", async () => {
    const a = mk(path.join(root, "g1"));
    mk(path.join(a, ".git"));
    fs.writeFileSync(path.join(a, ".git", "HEAD"), "ref: refs/heads/main\n");
    const b = mk(path.join(root, "g2"));
    fs.writeFileSync(path.join(b, ".git"), "gitdir: /elsewhere/.git/worktrees/b\n");
    const c = mk(path.join(root, "g3"));
    fs.symlinkSync(path.join(a, ".git"), path.join(c, ".git"));
    const d = mk(path.join(root, "g4"));
    mk(path.join(d, ".git"));
    expect([await isGitRepo(a), await isGitRepo(b), await isGitRepo(c), await isGitRepo(d)]).toEqual([true, true, false, false]);
  });
});

describe("compliance (L8)", () => {
  it("the module never builds a path into an engine home to read it", async () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../src/main/linked-folders.ts"), "utf8");
    expect(src).not.toMatch(/readFile[^)]*\.(claude|codex)/);
    expect(src).not.toMatch(/homedir\(\)/);
  });
});
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement** `packages/shell/src/main/linked-folders.ts`:

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { homeOrDotFolder } from "./references";
import { folderProblem, realFolder } from "./validate";

/** Why a folder can't be linked (hatches spec §3.2). Each has a sentence in en.json `hatches.refused.<reason>`. */
export type LinkRefusal =
  | "engine-home" | "home" | "system" | "too-broad" | "protected" | "main-folder" | "other-scope-write"
  | "nested" | "already-linked" | "not-git" | "not-folder" | "comma";

export interface LinkContext {
  /** The home folder, real. */
  home: string;
  /** The main (work) folder, real: the base. */
  folder: string;
  /** With profiles: the app's folder (every profile's folder is inside it). */
  root?: string;
  /** The real paths this scope already links (any key). */
  sameScope: string[];
  /** The real paths other scopes link in `write` mode. */
  otherScopesWrite: string[];
  mode: "read" | "write";
  history: "auto" | "own";
  isGit: boolean;
}

// macOS file systems are usually case-insensitive: compare without case to stay on the safe side (as validate.ts).
const norm = (p: string) => path.resolve(p).toLowerCase();
const inside = (child: string, parent: string) => {
  const c = norm(child);
  const p = norm(parent);
  return c === p || c.startsWith(p + path.sep);
};

/** The first refusal for the real path `dir`, or null. Pure: path comparisons only, never a read (L8). */
export function linkRefusal(dir: string, ctx: LinkContext): LinkRefusal | null {
  if (dir.includes(",")) return "comma";
  if (norm(dir) === norm(ctx.home)) return "home";
  // ~/.claude, ~/.codex, every other dot folder in home (credentials, engine config) and what's inside them.
  if (homeOrDotFolder(dir, ctx.home)) return "engine-home";
  if (inside(dir, ctx.folder) || inside(ctx.folder, dir)) return "main-folder";
  if (ctx.root && (inside(dir, ctx.root) || inside(ctx.root, dir))) return "main-folder";
  const problem = folderProblem(dir, ctx.home);
  if (problem === "root") return "system";
  if (problem === "protected") return isSystemPath(dir) ? "system" : "engine-home";
  if (problem === "too-broad") return "too-broad";
  if (problem) return "protected";
  if (ctx.sameScope.some((p) => norm(p) === norm(dir))) return "already-linked";
  if (ctx.sameScope.some((p) => inside(dir, p) || inside(p, dir))) return "nested";
  if (ctx.otherScopesWrite.some((p) => norm(p) === norm(dir))) return "other-scope-write";
  if (ctx.history === "own" && !ctx.isGit) return "not-git";
  return null;
}

const SYSTEM_ROOTS = ["/System", "/usr", "/bin", "/sbin", "/etc", "/private", "/var", "/Applications", "/Library", "/opt", "/Volumes"];
const isSystemPath = (dir: string) => SYSTEM_ROOTS.some((s) => inside(dir, s) || inside(s, dir)) || /^[a-z]:\\windows/i.test(dir);

/**
 * Whether `dir` is a git repository (Decision 3): `<dir>/.git` is a folder holding `HEAD`, or a file whose first line
 * starts with `gitdir:`. A link at `.git` is never followed. Reads nothing else.
 */
export async function isGitRepo(dir: string): Promise<boolean> {
  const dot = path.join(dir, ".git");
  const st = await fs.lstat(dot).catch(() => null);
  if (!st || st.isSymbolicLink()) return false;
  if (st.isDirectory()) return (await fs.lstat(path.join(dot, "HEAD")).catch(() => null))?.isFile() === true;
  if (!st.isFile() || st.size > 4096) return false;
  const first = (await fs.readFile(dot, "utf8").catch(() => "")).split("\n")[0];
  return first.startsWith("gitdir:");
}

/**
 * Checks a picked folder: as written and where it really is (links resolved), then git. Answers the real path and
 * whether the core history tracks it (Decision 2), or why it is refused.
 */
export async function checkLink(
  picked: string,
  ctx: Omit<LinkContext, "isGit">,
): Promise<{ path: string; tracked: boolean } | { refused: LinkRefusal }> {
  if (!path.isAbsolute(picked)) return { refused: "not-folder" };
  const asWritten = linkRefusal(path.resolve(picked), { ...ctx, isGit: true });
  if (asWritten && asWritten !== "not-git") return { refused: asWritten };
  let real: string;
  try {
    real = await realFolder(picked);
    if (!(await fs.stat(real)).isDirectory()) return { refused: "not-folder" };
  } catch {
    return { refused: "not-folder" };
  }
  const isGit = await isGitRepo(real);
  const refused = linkRefusal(real, { ...ctx, isGit });
  if (refused) return { refused };
  return { path: real, tracked: ctx.mode === "write" && !isGit };
}
```

(`realFolder` resolves a missing tail through its parent; the `stat` after it turns a missing folder into `not-folder`. If the "a folder above the main folder" case trips on `..` not being resolved, compare `path.resolve(dir)` first, as `norm` does.)

- [ ] **Step 4: Run.** `corepack pnpm vitest run packages/shell/test/linked-folders.test.ts packages/shell/test/references.test.ts packages/shell/test/validate.test.ts`. Expected: PASS.

- [ ] **Step 5: Typecheck, test, commit.**

```bash
git -C <worktree> add packages/shell/src/main/linked-folders.ts packages/shell/test/linked-folders.test.ts
git -C <worktree> commit -m "feat(shell): linked folder refusals on real paths, and git detection" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 4: Linked histories in the app's data folder

**Files:**
- Create: `packages/shell/src/main/linked-history.ts`
- Test: `packages/shell/test/linked-history.test.ts`

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/shell/test/linked-history.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { LINKED_KEEP_DAYS, linkedHistoryDir, markRelinked, markUnlinked, pruneUnlinked } from "../src/main/linked-history";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-lh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const day = 86_400_000;

describe("linked histories (hatches spec §3.2, Decision 5)", () => {
  it("one gitdir per real path, under linked-history/", () => {
    const a = linkedHistoryDir(root, "/Users/me/notes");
    expect(path.dirname(a)).toBe(path.join(root, "linked-history"));
    expect(path.basename(a)).toMatch(/^[0-9a-f]{16}$/);
    expect(linkedHistoryDir(root, "/Users/me/notes")).toBe(a);
    expect(linkedHistoryDir(root, "/Users/me/other")).not.toBe(a);
  });

  it("an unlink marks the history; a relink clears the mark", async () => {
    const dir = linkedHistoryDir(root, "/x");
    fs.mkdirSync(dir, { recursive: true });
    await markUnlinked(dir, new Date("2026-10-01T00:00:00Z"));
    expect(fs.readFileSync(path.join(dir, "unlinked-at"), "utf8")).toBe("2026-10-01T00:00:00.000Z");
    await markRelinked(dir);
    expect(fs.existsSync(path.join(dir, "unlinked-at"))).toBe(false);
  });

  it("prunes histories unlinked more than 30 days ago, keeps the others", async () => {
    const now = new Date("2026-11-30T00:00:00Z");
    const old = linkedHistoryDir(root, "/old");
    const fresh = linkedHistoryDir(root, "/fresh");
    const live = linkedHistoryDir(root, "/live");
    for (const d of [old, fresh, live]) fs.mkdirSync(d, { recursive: true });
    await markUnlinked(old, new Date(now.getTime() - (LINKED_KEEP_DAYS + 1) * day));
    await markUnlinked(fresh, new Date(now.getTime() - 2 * day));
    const trashed: string[] = [];
    await pruneUnlinked(root, now, async (p) => void trashed.push(p));
    expect(trashed).toEqual([old]);
  });

  it("a mark that isn't a date is left alone and logged, never pruned", async () => {
    const d = linkedHistoryDir(root, "/weird");
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "unlinked-at"), "not a date");
    const trashed: string[] = [];
    await pruneUnlinked(root, new Date(), async (p) => void trashed.push(p));
    expect(trashed).not.toContain(d);
  });
});
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement** `packages/shell/src/main/linked-history.ts`:

```ts
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/** How long an unlinked folder's core history is kept (hatches spec §3.2). */
export const LINKED_KEEP_DAYS = 30;
const MARK = "unlinked-at";

/** The gitdir of a tracked linked folder's history: one per real path, in the app's data folder (Decision 5). */
export function linkedHistoryDir(userData: string, realPath: string): string {
  return path.join(userData, "linked-history", createHash("sha256").update(realPath).digest("hex").slice(0, 16));
}

export async function markUnlinked(dir: string, now: Date): Promise<void> {
  await fs.writeFile(path.join(dir, MARK), now.toISOString()).catch((err: unknown) => {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; // never had a history: nothing to keep
  });
}

export async function markRelinked(dir: string): Promise<void> {
  await fs.rm(path.join(dir, MARK), { force: true });
}

/** Moves histories unlinked more than 30 days ago to the system Trash (`trash`); a failure is logged and kept. */
export async function pruneUnlinked(userData: string, now: Date, trash: (dir: string) => Promise<void>): Promise<void> {
  const base = path.join(userData, "linked-history");
  const names = await fs.readdir(base).catch(() => [] as string[]);
  for (const name of names) {
    if (!/^[0-9a-f]{16}$/.test(name)) continue;
    const dir = path.join(base, name);
    const text = await fs.readFile(path.join(dir, MARK), "utf8").catch(() => null);
    if (text === null) continue;
    const at = Date.parse(text);
    if (!Number.isFinite(at)) {
      console.error(`A linked history's unlink mark isn't a date: ${dir}`);
      continue;
    }
    if (now.getTime() - at > LINKED_KEEP_DAYS * 86_400_000) {
      await trash(dir).catch((err: unknown) => console.error(`Could not move an old linked history to the Trash: ${dir}`, err));
    }
  }
}
```

- [ ] **Step 4: Run.** Expected: PASS.

- [ ] **Step 5: Typecheck, test, commit.**

```bash
git -C <worktree> add packages/shell/src/main/linked-history.ts packages/shell/test/linked-history.test.ts
git -C <worktree> commit -m "feat(shell): linked histories kept 30 days after an unlink" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 5: Claude gets the scope's linked folders

**Files:**
- Modify: `packages/runtime/src/transport.ts`, `packages/runtime/src/claude-cli.ts`, `packages/runtime/src/workspace.ts` (pass `options.scope` to `transport.turn`), `packages/runtime/src/index.ts` (export the types)
- Test: `packages/runtime/test/claude-cli.test.ts` (append), `packages/runtime/test/hatches-d0.test.ts` (create)

- [ ] **Step 1: Write the failing tests.**

Append to `claude-cli.test.ts`:

```ts
describe("linked folders (hatches spec §3.3, §3.5)", () => {
  const base = { session: { id: "a", started: false }, mcp: [], permissions };
  const scope = { linked: [
    { path: "/Users/me/code/app", mode: "write" as const, tracked: false },
    { path: "/Users/me/manuscript", mode: "read" as const, tracked: false },
  ] };
  const settingsOf = (args: string[]) => JSON.parse(args[args.indexOf("--settings") + 1]);
  const denied = (args: string[]) => args[args.indexOf("--disallowedTools") + 1].split(",");
  const allowed = (args: string[]) => args[args.indexOf("--allowedTools") + 1].split(",");

  it("gives every linked folder file access through one --settings, after the references, never --add-dir", () => {
    const args = claudeArgs({ ...base, references: ["/opt/docs"], scope });
    expect(args).not.toContain("--add-dir");
    expect(args.filter((a) => a === "--settings")).toHaveLength(1);
    expect(settingsOf(args)).toEqual({ permissions: { additionalDirectories: ["/opt/docs", "/Users/me/code/app", "/Users/me/manuscript"] } });
  });

  it("denies edits in a read folder, as in a reference folder", () => {
    expect(denied(claudeArgs({ ...base, scope }))).toEqual(
      expect.arrayContaining(["Edit(//Users/me/manuscript/**)", "Write(//Users/me/manuscript/**)", "MultiEdit(//Users/me/manuscript/**)"]),
    );
    expect(allowed(claudeArgs({ ...base, scope }))).not.toContain("Edit(//Users/me/manuscript/**)");
  });

  it("allows edits in a write folder but denies its .claude and .git", () => {
    const args = claudeArgs({ ...base, scope });
    expect(allowed(args)).toEqual(expect.arrayContaining(["Edit(//Users/me/code/app/**)", "Write(//Users/me/code/app/**)", "MultiEdit(//Users/me/code/app/**)"]));
    for (const sub of [".claude", ".git"]) {
      for (const tool of ["Edit", "Write", "MultiEdit"]) expect(denied(args)).toContain(`${tool}(//Users/me/code/app/${sub}/**)`);
    }
    expect(denied(args)).not.toContain("Edit(//Users/me/code/app/**)");
  });

  it("a write folder under edit: none gets no allow rule (the manifest wins)", () => {
    const args = claudeArgs({ ...base, permissions: { edit: "none", exec: false, web: false }, scope });
    expect(allowed(args).some((t) => t.includes("/Users/me/code/app"))).toBe(false);
    expect(denied(args)).toContain("Edit");
  });

  it("a no-tools or MCP-only session refuses linked folders", () => {
    expect(() => claudeArgs({ ...base, noTools: true, scope })).toThrow(/linked/);
    expect(() => claudeArgs({ ...base, mcpOnly: true, scope })).toThrow(/linked/);
  });
});
```

Create `packages/runtime/test/hatches-d0.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { claudeArgs } from "../src/claude-cli";

const permissions = { edit: "folder" as const, exec: false, web: false };
const uiServer = { name: "ui", command: "node", args: ["ui.js"], env: { HH_BRIDGE: "/tmp/x.sock" } };

describe("D0 (hatches): no linked folders, no change", () => {
  it("claudeArgs without a scope, or with an empty one, is the golden argv", () => {
    const o = { session: { id: "abc", started: false }, mcp: [uiServer], permissions, references: ["/r"] };
    const golden = claudeArgs(o);
    expect(claudeArgs({ ...o, scope: undefined })).toEqual(golden);
    expect(claudeArgs({ ...o, scope: { linked: [] } })).toEqual(golden);
    expect(claudeArgs({ ...o, references: [], scope: { linked: [] } })).not.toContain("--settings");
  });
});
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**

`transport.ts`:

```ts
/** A folder of the turn's scope the agent may reach (hatches spec §3.3). `path` is absolute and real. */
export interface LinkedAccess {
  path: string;
  mode: "read" | "write";
  /** The core history tracks it (no git): the workspace commits and restores it with the folder (§3.4). */
  tracked: boolean;
}

/** What a turn gets from its task's scope (hatches spec §3, §5). Absent: nothing, as before (D0). Part 3 adds `engine`. */
export interface TurnScope {
  linked: LinkedAccess[];
}
```

and `Transport.turn(message, emit, signal, profile?, scope?: TurnScope)` with a doc line "`scope`: the task's scope's linked folders (hatches); absent for a harness without them (D0)."

`claude-cli.ts`:
- `claudeArgs` takes `& { profile?: ModelProfile; scope?: TurnScope }`;
- the `noTools` guard counts `(o.scope?.linked ?? []).length > 0` too ("A no-tools session takes no MCP servers, reference or linked folders"); an `mcpOnly` session (language on demand) throws "An MCP-only session takes no linked folders" when given a non-empty `scope.linked`;
- replace `...referenceSettingsArgs(o.references ?? [])` with `...scopeSettingsArgs(o.references ?? [], o.scope)`;
- `allowedTools(o.permissions, o.mcp, o.mcpOnly, o.scope?.linked ?? [])` and `disallowedTools(o.permissions, o.references ?? [], o.mcpOnly, o.scope?.linked ?? [])`.

```ts
/**
 * The one `--settings` for the reference and linked folders, or nothing without any (D0). Linked folders follow the
 * references, so a turn without a scope gets exactly `referenceSettingsArgs`'s value. Part 3 merges the scope's
 * approved settings into the same object.
 */
export function scopeSettingsArgs(references: string[], scope?: TurnScope): string[] {
  const dirs = [...references, ...(scope?.linked ?? []).map((l) => l.path)];
  if (dirs.length === 0) return [];
  return ["--settings", JSON.stringify({ permissions: { additionalDirectories: dirs } })];
}
```

Keep `referenceSettingsArgs` (the references fix's tests import it); make it `return scopeSettingsArgs(references)`.

`allowedTools(permissions, mcp, mcpOnly = false, linked: LinkedAccess[] = [])` (the merged signature plus one parameter at the end): when `permissions.edit === "folder"`, after the `./**` rules, for each `write` folder push `Edit(/${referenceRulePath(l.path)}/**)`, `Write(…)`, `MultiEdit(…)` (Decision 8).

`disallowedTools(permissions, references = [], mcpOnly = false, linked: LinkedAccess[] = [])`: after the references loop,

```ts
  // A linked folder (hatches spec §3.3): read-only like a reference; a write folder's own settings and git hooks are
  // denied, as `.claude/**` is in the main folder.
  for (const l of linked) {
    const dir = referenceRulePath(l.path);
    const subs = l.mode === "read" ? [""] : ["/.claude", "/.git"];
    for (const sub of subs) tools.push(`Edit(/${dir}${sub}/**)`, `Write(/${dir}${sub}/**)`, `MultiEdit(/${dir}${sub}/**)`);
  }
```

`ClaudeCliTransport.turn(message, emit, signal, profile, scope)` passes `scope` into `claudeArgs`.

`workspace.ts`, `SlotSendOptions`: `/** The task's scope: linked folders (hatches). Absent: none (D0). */ scope?: TurnScope;` and in `send`, `transport.turn(message, …, controller.signal, options.profile, options.scope)`. `AcpTransport.turn` gets the parameter in Task 6; until then it accepts and ignores it (add `_scope?: TurnScope` to its signature).

- [ ] **Step 4: Run.** `corepack pnpm vitest run packages/runtime/test`. Expected: PASS (the Task 0 golden unchanged).

- [ ] **Step 5: Typecheck, test, commit.**

```bash
git -C <worktree> add packages/runtime/src/transport.ts packages/runtime/src/claude-cli.ts packages/runtime/src/acp.ts packages/runtime/src/workspace.ts packages/runtime/src/index.ts packages/runtime/test/claude-cli.test.ts packages/runtime/test/hatches-d0.test.ts
git -C <worktree> commit -m "feat(runtime): Claude reaches a scope's linked folders through --settings, with deny rules" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 6: Codex (ACP) gets the scope's linked folders

**Files:**
- Modify: `packages/runtime/src/acp.ts`, `packages/runtime/src/transport.ts` (`onLinkedUnsupported`), `packages/fake-agent/src/fake-acp.ts`, `packages/fake-agent/src/script.ts`
- Test: `packages/runtime/test/acp.test.ts` (append), `packages/runtime/test/hatches-d0.test.ts` (append)

- [ ] **Step 1: Write the failing tests.**

`script.ts`: `AcpScript.additionalDirectories?: boolean` ("advertise `sessionCapabilities.additionalDirectories`"). `fake-acp.ts` adds it to `sessionCapabilities` next to `close` (merge both into one object). The fake already logs every request's params to `HH_FAKE_LOG`.

Append to `acp.test.ts` (reuse the file's existing helpers that start an `AcpTransport` over the fake and read its log; name them as they are there):

```ts
describe("linked folders on ACP (hatches spec §3.3, S1)", () => {
  const scope = { linked: [
    { path: "/Users/me/code/app", mode: "write" as const, tracked: false },
    { path: "/Users/me/manuscript", mode: "read" as const, tracked: false },
  ] };

  it("sends only write folders as additionalDirectories on session/new", async () => {
    // script: { additionalDirectories: true, loadSession: true, … }
    // await transport.turn("hi", emit, signal, undefined, scope)
    // expect(logOf("session/new").params.additionalDirectories).toEqual(["/Users/me/code/app"])
  });

  it("sends the list again on every session/load (it replaces the old one)", async () => {
    // a started session + loadSession: true → turn with scope after sleep/close
    // expect(logOf("session/load").params.additionalDirectories).toEqual(["/Users/me/code/app"])
  });

  it("a changed list reloads the open session before the prompt (L6)", async () => {
    // turn 1 with scope; turn 2 with { linked: [] } on the same transport
    // the log has, between the two session/prompt calls, one session/load with no additionalDirectories key
  });

  it("an adapter without the capability gets no folder and reports it once", async () => {
    // script without additionalDirectories; onLinkedUnsupported spy
    // expect("additionalDirectories" in logOf("session/new").params).toBe(false); expect(spy).toHaveBeenCalledTimes(1)
  });
});

describe("decidePermission with linked folders", () => {
  const policy = (extra = {}) => ({ folder: "/w", permissions: { edit: "folder" as const, exec: false, web: false }, mcpServers: ["ui"], lookup: () => undefined, ...extra });
  const req = (kind: string, p: string) => ({
    sessionId: "s", toolCall: { toolCallId: "1", kind, locations: [{ path: p }] },
    options: [{ optionId: "y", kind: "allow_once", name: "Allow" }, { optionId: "n", kind: "reject_once", name: "Reject" }],
  });
  const pick = (r: ReturnType<typeof decidePermission>) => (r.outcome.outcome === "selected" ? r.outcome.optionId : "cancelled");

  it("allows edits under a write root, refuses them under a read root", () => {
    const p = policy({ writeRoots: ["/code/app"], readRoots: ["/code/app", "/manuscript"] });
    expect(pick(decidePermission(req("edit", "/code/app/src/a.ts") as never, p))).toBe("y");
    expect(pick(decidePermission(req("edit", "/manuscript/ch1.md") as never, p))).toBe("n");
    expect(pick(decidePermission(req("read", "/manuscript/ch1.md") as never, p))).toBe("y");
  });

  it.each([".git/hooks/pre-commit", ".codex/config.toml", ".agents/skills/x/SKILL.md", ".opencode/x", ".claude/settings.json"])(
    "refuses an edit to <write root>/%s (L3)",
    (sub) => {
      expect(pick(decidePermission(req("edit", `/code/app/${sub}`) as never, policy({ writeRoots: ["/code/app"] })))).toBe("n");
    },
  );

  it("D0: without roots, today's answers", () => {
    expect(pick(decidePermission(req("edit", "/w/a.md") as never, policy()))).toBe("y");
    expect(pick(decidePermission(req("edit", "/elsewhere/a.md") as never, policy()))).toBe("n");
  });
});
```

The four transport tests above are outlines: write them in full with the file's existing fake-acp helpers. Each assertion named in the comments must be there.

Append to `hatches-d0.test.ts`:

```ts
  it("session/new and session/load carry exactly cwd and mcpServers without linked folders", async () => {
    // fake-acp with { additionalDirectories: true, loadSession: true }; a turn with no scope, a sleep, a second turn:
    // expect(Object.keys(logOf("session/new").params).sort()).toEqual(["cwd", "mcpServers"]);
    // expect(Object.keys(logOf("session/load").params).sort()).toEqual(["cwd", "mcpServers", "sessionId"]);
  });
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**

`PermissionPolicy` gains `/** Linked write folders (hatches §3.3): edits allowed there, except in their own config (L3). */ writeRoots?: string[];`.

```ts
/** A write root's own config and git: never edited by the agent (hatches spec §3.3, L3). */
const ROOT_CONFIG = [".git", ".codex", ".agents", ".opencode", ".claude"];

function editAllowed(policy: PermissionPolicy, target: string): boolean {
  if (inside(policy.folder, target)) return true;
  const root = (policy.writeRoots ?? []).find((r) => inside(r, target));
  if (!root) return false;
  const rel = path.relative(path.resolve(root), path.resolve(root, target));
  return !ROOT_CONFIG.includes(rel.split(path.sep)[0]);
}
```

In `decidePermission`, the edit case becomes `allow = policy.permissions.edit === "folder" && (locations ?? []).length > 0 && (locations ?? []).every((l) => editAllowed(policy, l.path));`. Without `writeRoots` it is exactly `allInside` (D0); keep `allInside` only if still used elsewhere.

`AcpTransport`:
- fields `private dirsCap = false; private linked: LinkedAccess[] = []; private sessionDirs: string | null = null; private warnedLinked = false;` and the `policy` object kept as a field (`this.policy`), so its roots can be replaced;
- `connect`: `this.dirsCap = Boolean((init.agentCapabilities?.sessionCapabilities as { additionalDirectories?: unknown } | undefined)?.additionalDirectories);`, and the policy's `readRoots: [...(this.o.references ?? [])]`;
- a helper:

```ts
  /** The write folders the session is opened with: none without the capability (hatches spec §3.3). */
  private writeDirs(): string[] {
    if (!this.dirsCap) return [];
    return this.linked.filter((l) => l.mode === "write").map((l) => l.path);
  }
  /** `session/new|load` params: today's, plus `additionalDirectories` only when there is one (D0). */
  private dirsParam(): { additionalDirectories?: string[] } {
    const dirs = this.writeDirs();
    return dirs.length > 0 ? { additionalDirectories: dirs } : {};
  }
```

- `openSession`: spread `...this.dirsParam()` into both `session/load` and `session/new` params; after the session is open, `this.sessionDirs = this.writeDirs().join("\n")`;
- `turn(message, emit, signal, profile, scope)`: before the connect block, `this.linked = scope?.linked ?? [];` then replace the policy roots (`this.policy.readRoots = [...references, ...this.linked.map((l) => l.path)]`, `this.policy.writeRoots = this.permissions edit folder ? write paths : []`). Read roots get both modes; write roots only `write` folders and only when the capability is there (without it, the engine sandbox can't reach them, and the policy grants nothing either: `writeRoots = []`, `readRoots` keep the references only). After connect: if `this.linked.length > 0 && !this.dirsCap && !this.warnedLinked` → `this.warnedLinked = true; this.o.onLinkedUnsupported?.()`.
- **Reload on change (L6):** after `if (!this.conn || !this.sessionId) {…}`, add: when the session is open and `this.writeDirs().join("\n") !== this.sessionDirs`, then if `this.loadable` call `session/load` with the same params as `openSession` (sessionId, cwd, mcpServers, dirs), then `session/set_mode` as `openSession` does; else `await this.close(); this.o.session = { id: randomUUID(), started: false };` and `openSession()` (Decision 9). Errors go through the same `catch` as the connect block.

`TransportOptions`: `/** ACP: the adapter can't take linked folders (hatches §3.3); called once per process. */ onLinkedUnsupported?: () => void;` — passed through by `workspace.ts` from a new `WorkspaceOptions.onLinkedUnsupported` (Task 10 wires the shell).

- [ ] **Step 4: Run.** `corepack pnpm vitest run packages/runtime/test packages/fake-agent`. Expected: PASS.

- [ ] **Step 5: Typecheck, test, commit.**

```bash
git -C <worktree> add packages/runtime/src/acp.ts packages/runtime/src/transport.ts packages/runtime/src/workspace.ts packages/fake-agent/src/fake-acp.ts packages/fake-agent/src/script.ts packages/runtime/test/acp.test.ts packages/runtime/test/hatches-d0.test.ts
git -C <worktree> commit -m "feat(runtime): ACP sessions get a scope's write folders as additionalDirectories" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 7: "Folders of this scope" in AGENTS.md

**Files:**
- Modify: `packages/workspace/src/instructions.ts`, `packages/runtime/src/runtime.ts` (`instructionLinked` option), `packages/runtime/src/workspace.ts` (read it at create and refresh)
- Test: `packages/workspace/test/instructions.test.ts` (append), `packages/runtime/test/workspace.test.ts` (append)

- [ ] **Step 1: Write the failing tests.**

```ts
// instructions.test.ts
describe("linked folders (hatches spec §3.3)", () => {
  const blocks = {};
  it("D0: no linked folders is exactly today's section", () => {
    expect(managedSection({ language: "en", blocks, linked: [] })).toBe(managedSection({ language: "en", blocks }));
  });

  it("lists each folder by key, mode and path, and widens the folder rule", () => {
    const s = managedSection({ language: "en", blocks, linked: [
      { key: "repos", label: "Repos", path: "/Users/me/code/app", mode: "write" },
      { key: "manuscript", label: "Manuscript", path: "/Users/me/book", mode: "read" },
    ] });
    expect(s).toContain("### Folders of this scope");
    expect(s).toContain("- `repos` (Repos, read and write): `/Users/me/code/app`");
    expect(s).toContain("- `manuscript` (Manuscript, read only): `/Users/me/book`");
    expect(s).toContain("Work only inside this folder and the folders of this scope listed below.");
    expect(s).not.toContain("- Work only inside this folder. Keep");
  });

  it("a label or path can't break out of its line", () => {
    const s = managedSection({ language: "en", blocks, linked: [{ key: "repos", label: "A\n### Evil", path: "/x\n- y", mode: "write" }] });
    expect(s).not.toContain("\n### Evil");
    expect(s).not.toContain("\n- y");
  });
});
```

`workspace.test.ts`: a workspace created with `instructionLinked: async () => [{ key: "repos", label: "Repos", path: "/r", mode: "write" }]` writes the section into `AGENTS.md`; `refreshInstructions()` with a changed answer rewrites it (and returns true), with the same answer returns false.

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**

`instructions.ts`:

```ts
/** A linked folder as the managed section names it (hatches spec §3.3). */
export interface LinkedFolderLine {
  key: string;
  label: string;
  path: string;
  mode: "read" | "write";
}
```

`TEXT` gains:
```ts
  linked: "### Folders of this scope",
  linkedIntro: "Besides this folder you may read these folders, and change the ones marked read and write. Each has its own history: don't commit, push or change branches unless the person asks.",
  linkedRule: "Work only inside this folder and the folders of this scope listed below. Keep messages short and clear.",
```
`rules(language, linked)` swaps its last line for `linkedRule` only when `linked` is true. `managedSection(opts & { linked?: LinkedFolderLine[] })` adds, right after the references part (find where references are rendered and follow it):

```ts
  const linked = opts.linked ?? [];
  if (linked.length > 0) {
    lines.push("", t.linked, "", t.linkedIntro, "");
    for (const l of linked) lines.push(`- \`${oneLine(l.key)}\` (${oneLine(l.label)}, ${l.mode === "write" ? "read and write" : "read only"}): \`${oneLine(l.path)}\``);
  }
```
with `const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ")`. `writeInstructions` and `refreshInstructions` pass `linked` through to `managedSection`.

`runtime.ts` `RuntimeOptions`: `/** The open scope's linked folders for AGENTS.md (hatches §3.3), asked at start and on every refreshInstructions. Absent: none (D0). */ instructionLinked?: () => Promise<LinkedFolderLine[]>;`. `workspace.ts`: read it next to `instructionSettings` at create and inside `refreshInstructions`' `run`, and pass `...(linked.length ? { linked } : {})` to both writes.

- [ ] **Step 4: Run.** `corepack pnpm vitest run packages/workspace/test/instructions.test.ts packages/runtime/test/workspace.test.ts packages/runtime/test/runtime-d0.test.ts`. Expected: PASS.

- [ ] **Step 5: Typecheck, test, commit.**

```bash
git -C <worktree> add packages/workspace/src/instructions.ts packages/runtime/src/runtime.ts packages/runtime/src/workspace.ts packages/workspace/test/instructions.test.ts packages/runtime/test/workspace.test.ts
git -C <worktree> commit -m "feat: AGENTS.md lists the open scope's linked folders" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 8: Tracked linked folders get a history of their own

**Files:**
- Modify: `packages/runtime/src/workspace.ts`, `packages/runtime/src/runtime.ts` (`linkedGitdir` option)
- Test: `packages/runtime/test/workspace-linked.test.ts` (create)

- [ ] **Step 1: Write the failing tests.** Use the fake-claude helpers of `workspace-slots.test.ts` (copy its setup function: a harness fixture, `createWorkspace` with `command: fakeClaudeCommand()`, a script with `write` steps). A script's `write.path` may be absolute: point one write into the linked folder.

```ts
// packages/runtime/test/workspace-linked.test.ts — outline; write each in full
describe("tracked linked folders (hatches spec §3.4)", () => {
  it("D0: a turn without linked folders opens no linked history", async () => {
    // linkedGitdir spy: never called; the main history's commits equal runtime-d0's for an ok turn
  });

  it("a turn commits both histories with the same trailers", async () => {
    // linked = plain folder L (tracked: true); script writes <folder>/a.md and <L>/b.md
    // after send(..., { trailer: { task: "t1", action: "implement", scope: "app" }, scope: { linked: [{ path: L, mode: "write", tracked: true }] } })
    // main log: ["Start", "Before message…", "Turn: …"]; linked log: ["Start", "Before message…", "Turn: …"]
    // both Turn commits carry "Task: t1\nAction: implement\nScope: app"; the linked Turn's tree has b.md
  });

  it("an untracked (git) linked folder is never committed", async () => {
    // linked = { path: G, mode: "write", tracked: false }; script writes <G>/c.md → linkedGitdir never called for G; c.md stays
  });

  it("a crashed turn restores the linked folder too", async () => {
    // script writes <L>/b.md then crashes (no result line) → done agent-crashed; b.md is gone from L, main restored as today
  });

  it("the linked history keeps its link checks: a restore never writes outside L", async () => {
    // L/sub is a symlink to a folder outside L; a crash restore skips it (History.restoreReport skipped), outside file untouched
  });

  it("two slots in the same scope share one linked history and ledger (attribution per folder)", async () => {
    // slot a writes <L>/a.md, slot b writes <L>/b.md at once (fake-claude `sleepMs` or the turn-ledger test pattern);
    // linked log has a "Turn" for each task, each with only its own file (owned), no lost change
  });
});
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement** in `workspace.ts`.

`WorkspaceOptions` / `RuntimeOptions`: `/** The gitdir of a tracked linked folder's history (hatches §3.4), from its real path. Absent: linked folders are never tracked. */ linkedGitdir?: (realPath: string) => string;`

```ts
  /** One history and ledger per tracked linked folder, opened on the first turn that names it (hatches spec §3.4). */
  const linkedRepos = new Map<string, Promise<{ history: History; ledger: TurnLedger }>>();
  function linkedRepo(dir: string): Promise<{ history: History; ledger: TurnLedger }> {
    let repo = linkedRepos.get(dir);
    if (!repo) {
      repo = (async () => {
        const h = new History(dir, opts.linkedGitdir!(dir), [], []);
        await h.init();
        await h.save(START);
        return { history: h, ledger: TurnLedger.forFolder(dir) };
      })();
      linkedRepos.set(dir, repo);
      // A failed open is retried by the next turn.
      repo.catch(() => linkedRepos.delete(dir));
    }
    return repo;
  }
```

In `send`, compute `const tracked = opts.linkedGitdir ? (options.scope?.linked ?? []).filter((l) => l.tracked && l.mode === "write") : [];` before the async block. Inside it, after the main `beginTurn`:

```ts
            // Tracked linked folders: the same windows, the same trailer (§3.4). Opened before the engine runs.
            const linkedWindows: { repo: { history: History; ledger: TurnLedger }; w: TurnWindow }[] = [];
            for (const l of tracked) {
              const repo = await linkedRepo(l.path);
              linkedWindows.push({ repo, w: await beginTurn(repo.history, repo.ledger, o.key, options.trailer) });
            }
```

In the event callback, after `ledger.noteEdits(o.key, e.edits, e.id)`, also `for (const { repo } of linkedWindows) repo.ledger.noteEdits(o.key, e.edits, e.id);` and likewise `noteEditEnd` (each ledger keeps only paths inside its folder). After the main `endTurn`:

```ts
            for (const { repo, w: lw } of linkedWindows) {
              try {
                const la = await endTurn(repo.history, repo.ledger, lw, f, message, options.trailer);
                if (la?.conflicts.length) console.error("Conflicting changes in a linked folder", la.conflicts.length);
              } catch (err) {
                console.error("Could not record a linked folder's turn", err);
              }
            }
```

In the `catch` path, close each linked window still open (`if (repo.ledger.running().includes(lw)) repo.ledger.close(o.key)`). Order: main first, then linked, both at begin and end, so a crash restore of the main folder never waits on a linked one.

`HarnessWorkspace` gains `linkedHistory(realPath: string): Promise<History | null>` (the open repo's history, or null when it was never opened in this workspace), used by Task 11.

- [ ] **Step 4: Run.** `corepack pnpm vitest run packages/runtime/test`. Expected: PASS; `runtime-d0.test.ts` unchanged.

- [ ] **Step 5: Typecheck, test, commit.**

```bash
git -C <worktree> add packages/runtime/src/workspace.ts packages/runtime/src/runtime.ts packages/runtime/test/workspace-linked.test.ts
git -C <worktree> commit -m "feat(runtime): tracked linked folders commit and restore with the turn" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 9: Linking from the window

**Files:**
- Create: `packages/shell/src/main/linked-ipc.ts`
- Modify: `packages/shell/src/main/index.ts` (register under `hasLinkedFolders`, `appState.hatches`), `packages/shell/src/preload/index.ts`, `packages/ui/src/client.ts`, `packages/ui/test/fake-client.ts`, `packages/i18n/src/locales/en.json` (new `"hatches"` block)
- Test: `packages/shell/test/linked-ipc.test.ts`, `packages/shell/test/hatches-surface.test.ts`, `packages/shell/test/preload.test.ts` (append)

- [ ] **Step 1: Write the failing tests.**

`linked-ipc.ts` exports `registerLinkedIpc(handle, deps: LinkedIpcDeps)` so it is unit-tested without Electron. `deps`: `harness` (its `linkedFolders`), `store()` (the base's `ScopeStore`), `scopeExists(id)`, `context()` (home, folder, root), `pick(): Promise<string | null>` (the dialog), `userData`, `isGitRepo`, `now()`, `changed()` (sends `hh:scopes` + refreshes AGENTS.md), `unsupported()` (Decision 15's flag).

```ts
// packages/shell/test/linked-ipc.test.ts — each in full with an in-memory `handle` map and a temp base
describe("linked folders IPC (hatches spec §3.2)", () => {
  it("a path argument is ignored; the picker always opens (L1)", async () => {
    // call("hh:scopeLinkFolder", "app", "repos", "/etc") → pick spy called once; the stored path is the picked one
  });
  it("refuses an undeclared key, an unknown or archived scope, a too-long id (L9)", async () => {
    // "nope" key → throws /Unknown linked folder kind/; "__proto__" key → throws; scope "x".repeat(65) → throws; pick never called
  });
  it("answers the refusal reason, linking nothing", async () => {
    // pick answers <home>/.claude → { refused: "engine-home" }; scopes.json unchanged
  });
  it("a cancelled picker links nothing and answers null", async () => {});
  it("one folder per key unless many: a second pick replaces? no: refused 'one-only'", async () => {
    // many: false and a link exists → { refused: "one-only" } before the picker opens
  });
  it("links: stores { key, path (real), mode, tracked }, relinks an old history, calls changed()", async () => {
    // markRelinked removes unlinked-at in linkedHistoryDir(userData, real)
  });
  it("other scopes' write folders are refused; their read folders are not", async () => {});
  it("unlink removes only a stored entry, marks its history unlinked, never touches the folder", async () => {
    // unlink of a path not stored → throws /Unknown linked folder/; the folder and its files still exist
  });
  it("confirmGit sets tracked from the folder's git state now and clears gitChanged", async () => {});
  it("hh:linkedState answers the scope's links, the declaration labels and the unsupported flag", async () => {});
});
```

`hatches-surface.test.ts` (source scans, as `ipc-surface.test.ts` does):
```ts
  it("linked-folder channels are registered only under hasLinkedFolders (D0)", async () => {
    // index.ts: the only call of registerLinkedIpc sits inside `if (hasLinkedFolders(harness))` (use the `group` helper pattern)
  });
  it("appState carries hatches only when a hatch is declared (D0)", async () => {
    // index.ts appState: `...(hatchesState(harness) ? { hatches: … } : {})`; unit test hatchesState(defineHarness(plain)) === undefined
  });
```

`preload.test.ts`: `window.hh.scopes.linkFolder("app", "repos")` invokes `hh:scopeLinkFolder` with exactly `("app", "repos")`.

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**

`client.ts`:

```ts
/** A scope's linked folder as the window sees it (hatches spec §3.2). */
export interface LinkedView {
  key: string;
  label: string;
  path: string;
  mode: "read" | "write";
  tracked: boolean;
  gitChanged?: true;
}
/** Why a link was refused: a key of en.json `hatches.refused`. */
export type LinkRefusalView = "engine-home" | "home" | "system" | "too-broad" | "protected" | "main-folder" | "other-scope-write" | "nested" | "already-linked" | "not-git" | "not-folder" | "comma" | "one-only";
/** The hatches a harness declares (hatches spec). Absent from AppState without any (D0). */
export interface HatchesState {
  linkedFolders?: Record<string, { label: string; mode: "read" | "write"; history: "auto" | "own"; many: boolean }>;
}
```
`AppState.hatches?: HatchesState`. `HarnessClient.scopes` gains (doc: "Harnesses with `linkedFolders` only; the others reject"):
```ts
    linked(scope: string): Promise<{ folders: LinkedView[]; unsupported: boolean }>;
    /** Opens the system picker; nothing is linked without the person choosing it. Null: cancelled. */
    linkFolder(scope: string, key: string): Promise<{ linked: LinkedView } | { refused: LinkRefusalView } | null>;
    unlinkFolder(scope: string, key: string, path: string): Promise<void>;
    /** After a folder gained or lost git (Decision 13): keep it tracked or leave it to its git. */
    confirmGit(scope: string, key: string, path: string, tracked: boolean): Promise<void>;
```
Preload: `hh:scopeLinked`, `hh:scopeLinkFolder`, `hh:scopeUnlinkFolder`, `hh:scopeConfirmGit`. Fake client: an in-memory map with `linkedSet(scope, folders)` and a `pickAnswer` field.

`linked-ipc.ts`: each handler validates `scope` (`isScopeId`, `await deps.scopeExists(scope)`, not archived), `key` (`typeof === "string"`, ≤ 64, `Object.hasOwn(deps.harness.linkedFolders, key)`), and for unlink/confirm the `path` must match a stored entry exactly (`find`). `hh:scopeLinkFolder` ignores any third argument, refuses `one-only` before picking when `!decl.many` and the scope already has a link under `key`, then `const picked = await deps.pick()`; builds `LinkContext` from every scope's entries (`sameScope`: this scope's paths; `otherScopesWrite`: other scopes' `write` paths) and `checkLink`; on success `store.link`, `markRelinked(linkedHistoryDir(userData, real))`, `deps.changed()`. Unlink: `store.unlink`, `markUnlinked(…, deps.now())` when the entry was tracked, `deps.changed()`. Never `fs.rm` anything under the linked folder.

`index.ts`: `if (hasLinkedFolders(harness)) registerLinkedIpc(handle, { … pick: async () => { const r = await dialog.showOpenDialog(window!, { properties: ["openDirectory"] }); return r.canceled ? null : r.filePaths[0] ?? null; }, … })`. `appState`: `...(hatchesState(harness) ? { hatches: hatchesState(harness) } : {})` where `hatchesState` (in `linked-ipc.ts`, extended by parts 2–3) returns `undefined` without hatches. At startup (after the folder is set): `void pruneUnlinked(app.getPath("userData"), new Date(), (d) => shell.trashItem(d))` only with `hasLinkedFolders`.

en.json — create the `"hatches"` block (add it after `"parallel"`, without touching other blocks):
```json
  "hatches": {
    "scopeSettings": "{{scope}} settings",
    "linkedTitle": "Linked folders",
    "link": "Link a folder…",
    "unlink": "Unlink",
    "modeRead": "Read only",
    "modeWrite": "Read and write",
    "tracked": "Tracked by the app's history",
    "ownGit": "Has its own git",
    "gainedGit": "This folder now has its own git.",
    "lostGit": "This folder no longer has git.",
    "keepTracked": "Track with the app's history",
    "leaveToGit": "Leave to its own git",
    "notCovered": "Undo doesn't cover this folder: it has its own git.",
    "codexUnsupported": "Linked folders don't work with this version of Codex yet.",
    "refused": {
      "engine-home": "This folder holds an app's settings or keys, so it can't be linked.",
      "home": "Your whole home folder can't be linked. Choose a folder inside it.",
      "system": "System folders can't be linked.",
      "too-broad": "This folder is too broad to link. Choose a folder inside it.",
      "protected": "This folder can't be linked.",
      "main-folder": "This is your work folder, or inside or around it. Link a folder outside it.",
      "other-scope-write": "Another {{scope}} already changes this folder.",
      "nested": "This folder is inside, or contains, another folder linked here.",
      "already-linked": "This folder is already linked here.",
      "not-git": "This needs a git repository.",
      "not-folder": "That isn't a folder.",
      "comma": "A folder whose name has a comma can't be linked yet.",
      "one-only": "Only one folder can be linked here. Unlink it first."
    }
  }
```

- [ ] **Step 4: Run.** `corepack pnpm vitest run packages/shell/test/linked-ipc.test.ts packages/shell/test/hatches-surface.test.ts packages/shell/test/ipc-surface.test.ts packages/shell/test/preload.test.ts packages/ui/test/client.test.ts`. Expected: PASS.

- [ ] **Step 5: Typecheck, test, build, commit.**

```bash
git -C <worktree> add packages/shell/src/main/linked-ipc.ts packages/shell/src/main/index.ts packages/shell/src/preload/index.ts packages/ui/src/client.ts packages/ui/test/fake-client.ts packages/i18n/src/locales/en.json packages/shell/test/linked-ipc.test.ts packages/shell/test/hatches-surface.test.ts packages/shell/test/preload.test.ts
git -C <worktree> commit -m "feat(shell): link and unlink a scope's folders through the system picker" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 10: Turns get their scope's folders

**Files:**
- Create: `packages/shell/src/main/scope-access.ts`
- Modify: `packages/shell/src/main/turn-controller.ts` (optional `TurnDeps.scopeAccess`), `packages/shell/src/main/jobs/job-runner.ts` (same dep), `packages/shell/src/main/task-manager.ts` (optional `TaskDeps.linkedContext`, board mode only), `packages/shell/src/main/index.ts` (wiring: `scopeAccess`, `instructionLinked`, `linkedGitdir`, `onLinkedUnsupported`, refresh on scope open and link change, git check on scope open)
- Test: `packages/shell/test/scope-access.test.ts`, `packages/shell/test/turn-controller.test.ts` (append), `packages/shell/test/task-manager-scopes.test.ts` (append)

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/shell/test/scope-access.test.ts
import { describe, expect, it } from "vitest";
import { linkedLines, scopeAccessFor } from "../src/main/scope-access";

const entries = [
  { id: "app", title: "App", createdAt: "", archived: false, linked: [
    { key: "repos", path: "/code/app", mode: "write" as const, tracked: false },
    { key: "notes", path: "/notes", mode: "write" as const, tracked: true, gitChanged: true as const },
  ] },
  { id: "other", title: "Other", createdAt: "", archived: false, linked: [{ key: "repos", path: "/code/other", mode: "write" as const, tracked: false }] },
];
const decl = { repos: { label: "Repos", mode: "write" as const, history: "auto" as const, many: true }, notes: { label: "Notes", mode: "write" as const, history: "auto" as const, many: false } };

describe("scopeAccessFor (L5)", () => {
  it("only the turn's scope's folders", () => {
    expect(scopeAccessFor(entries, "app", decl)).toEqual({ linked: [
      { path: "/code/app", mode: "write", tracked: false },
      { path: "/notes", mode: "write", tracked: true },
    ] });
  });
  it("_app, an unknown scope and no links give undefined (no TurnScope at all)", () => {
    expect(scopeAccessFor(entries, "_app", decl)).toBeUndefined();
    expect(scopeAccessFor(entries, "nope", decl)).toBeUndefined();
    expect(scopeAccessFor([{ id: "x", title: "X", createdAt: "", archived: false }], "x", decl)).toBeUndefined();
  });
  it("a key the manifest no longer declares is left out", () => {
    expect(scopeAccessFor(entries, "app", { repos: decl.repos })?.linked.map((l) => l.path)).toEqual(["/code/app"]);
  });
  it("the mode comes from the manifest now, not the stored entry", () => {
    expect(scopeAccessFor(entries, "app", { ...decl, repos: { ...decl.repos, mode: "read" } })?.linked[0].mode).toBe("read");
  });
});

describe("linkedLines", () => {
  it("the managed section's lines, with the manifest's labels", () => {
    expect(linkedLines(entries, "app", decl)).toEqual([
      { key: "repos", label: "Repos", path: "/code/app", mode: "write" },
      { key: "notes", label: "Notes", path: "/notes", mode: "write" },
    ]);
    expect(linkedLines(entries, null, decl)).toEqual([]);
  });
});
```

Notes on the rules above: a stored `tracked` with a manifest mode now `read` gives `tracked: false` in the access (a read folder is never committed, Decision 2).

`turn-controller.test.ts`: with `scopeAccess: async (scope) => (scope === "app" ? { linked: [...] } : undefined)`, a send with `options.scope = "app"` calls `runtime.send` with `{ …, scope: { linked: [...] } }`; without the dep, the options object passed to `runtime.send` has exactly today's keys (D0).

`task-manager-scopes.test.ts`: with `linkedContext: async (scope) => "### Folders of this scope\n…"` a new session's first message carries it after the data tables and its context record's `start` has a `linked-folders` item; without the dep, the first message and the `start` items are today's.

Also one test (in `scope-access.test.ts`, with a fake store and `isGitRepo` stub) for `checkGitChanges(store, scope, isGitRepo)`: a write entry `tracked: true` whose folder now has git gets `gitChanged`; one already `gitChanged` is left alone; a read entry is skipped.

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**

`scope-access.ts`:

```ts
import type { LinkedFolderDecl } from "@humanharness/harness-sdk";
import type { TurnScope } from "@humanharness/runtime";
import { type LinkedFolderEntry, type ScopeEntry, type ScopeStore, isScopeId } from "@humanharness/workspace";
import type { LinkedFolderLine } from "@humanharness/workspace";

/** The entries of `scope` whose key the manifest still declares, with today's mode. */
function current(entries: ScopeEntry[], scope: string | null, decl: Record<string, LinkedFolderDecl>): (LinkedFolderEntry & { label: string })[] {
  if (scope === null || !isScopeId(scope)) return [];
  const s = entries.find((e) => e.id === scope && !e.archived);
  return (s?.linked ?? [])
    .filter((l) => Object.hasOwn(decl, l.key))
    .map((l) => ({ ...l, mode: decl[l.key].mode, label: decl[l.key].label }));
}

/** What a turn of a task in `scope` reaches (L5): undefined when nothing, so the turn's options are today's (D0). */
export function scopeAccessFor(entries: ScopeEntry[], scope: string, decl: Record<string, LinkedFolderDecl>): TurnScope | undefined {
  const linked = current(entries, scope, decl).map((l) => ({ path: l.path, mode: l.mode, tracked: l.mode === "write" && l.tracked }));
  return linked.length > 0 ? { linked } : undefined;
}

export function linkedLines(entries: ScopeEntry[], scope: string | null, decl: Record<string, LinkedFolderDecl>): LinkedFolderLine[] {
  return current(entries, scope, decl).map((l) => ({ key: l.key, label: l.label, path: l.path, mode: l.mode }));
}

/** The first-message section for board mode (Decision 6): the same lines the managed section would show. */
export function linkedSection(lines: LinkedFolderLine[]): string { /* uses the workspace's exported formatter */ }

/** Marks write entries whose git state no longer matches `tracked` (Decision 13). */
export async function checkGitChanges(store: ScopeStore, scope: string, isGit: (dir: string) => Promise<boolean>): Promise<boolean> { … }
```

Export the managed section's linked-lines formatter from `instructions.ts` (`linkedFolderLines(lines): string[]`, the lines Task 7 builds) so `linkedSection` and `managedSection` print the same text.

`turn-controller.ts`: `TurnDeps.scopeAccess?: (scope: string) => Promise<TurnScope | undefined>`. In `send`, when `deps.scopeAccess && scope`, `const access = await deps.scopeAccess(scope).catch((err) => (console.error("Could not read the scope's folders", err), undefined));` before `rt.send`, and spread `...(access ? { scope: access } : {})` into the options. Same in `JobRunner` for a run with a scope.

`task-manager.ts`: `TaskDeps.linkedContext?: (scope: string) => Promise<string>`, appended in `contextFor` (which returns `{ text, items }` since the context panel) after the material part, with the same error handling, and with a context item `{ id: "linked", kind: "linked-folders", label: "Folders of this scope", tokens: approxTokens(text.length) }` when the text is not empty. Add `"linked-folders"` to `ContextItemKind` in `client.ts` and its label to the context panel's item labels (find where `"material"` gets its text and add the same for it, in the `"hatches"` en.json block: `"contextLinked": "Folders of this scope"`). Only passed by `index.ts` in board mode (`host` set).

`index.ts` (only `if (hasLinkedFolders(harness))`):
- `turnDeps.scopeAccess = async (scope) => scopeAccessFor(await scopeStoreFor(currentBase()).list(), scope, harness.linkedFolders!)`;
- `runtimeOptions(...)`: `linkedGitdir: (p) => linkedHistoryDir(app.getPath("userData"), p)`, `onLinkedUnsupported: () => (linkedUnsupported = true)`, and, not in board mode, `instructionLinked: async () => linkedLines(await store.list(), await tasks.currentScope(), harness.linkedFolders!)`;
- after `hh:scopeOpen` succeeds and after `changed()` from `linked-ipc`: `await checkGitChanges(...)` (scope open only), then refresh AGENTS.md through the existing settings refresh path (`refreshInstructions` of the runtime or board, which returns false while a turn runs; the next runtime start reads it fresh anyway).

- [ ] **Step 4: Run.** `corepack pnpm vitest run packages/shell/test/scope-access.test.ts packages/shell/test/turn-controller.test.ts packages/shell/test/task-manager-scopes.test.ts packages/shell/test/jobs`. Expected: PASS.

- [ ] **Step 5: Typecheck, test, build, commit.**

```bash
git -C <worktree> add packages/shell/src/main/scope-access.ts packages/shell/src/main/turn-controller.ts packages/shell/src/main/jobs/job-runner.ts packages/shell/src/main/task-manager.ts packages/shell/src/main/index.ts packages/workspace/src/instructions.ts packages/ui/src/client.ts packages/ui/src packages/i18n/src/locales/en.json packages/shell/test/scope-access.test.ts packages/shell/test/turn-controller.test.ts packages/shell/test/task-manager-scopes.test.ts
git -C <worktree> commit -m "feat(shell): each turn reaches its own scope's linked folders" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 11: Undo over both histories; what the History panel says

**Files:**
- Create: `packages/shell/src/main/linked-restore.ts`
- Modify: `packages/shell/src/main/index.ts` (`hh:restoreTask` both paths; `hh:linkedHistory`), `packages/shell/src/main/linked-ipc.ts` (register `hh:linkedHistory`), preload, `client.ts`, fake client
- Test: `packages/shell/test/linked-restore.test.ts`

- [ ] **Step 1: Write the failing tests** (real `History` objects over temp folders, as `restore-paths.test.ts` does):

```ts
describe("Undo this task over linked folders (hatches spec §3.4)", () => {
  it("restores each tracked linked folder to the task's start there", async () => {
    // main M and linked L histories, each: Start, Before message (task t1), Turn (t1) changing a file
    // restoreLinkedTask([{ key: "notes", history: L }], "t1", RESTORE_TASK) → L's file back; one new commit in L, untagged
  });
  it("a task with no commits in a linked history leaves it alone", async () => {});
  it("board mode: restoreTaskByPaths per linked history, refusals reported with the folder's key", async () => {
    // a later task changed the same file in L → { refused: { reason: "later", path: "notes/x.md" } } and nothing restored anywhere
  });
  it("an untracked folder is never given to History (L7)", async () => {
    // linkedHistoriesFor(entries, scope) returns only tracked write entries
  });
});

describe("linkedHistoryView", () => {
  it("lists each task's changes per tracked folder, and the untracked folders for the 'not covered' line", async () => {
    // → { uncovered: [{ key: "repos", label: "Repos" }], tasks: { t1: [{ key: "notes", label: "Notes", changes: [{ path: "x.md", kind: "changed" }] }] } }
  });
});
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**
- `linkedHistoriesFor(entries, scope, decl, open: (path) => Promise<History>)`: the open scope's tracked write entries → `{ key, label, history }` (opening a `History` over the folder with `linkedHistoryDir` when the workspace has none open; `init()` only if its gitdir exists, never creating one for a read).
- `restoreLinkedTask(histories, taskId, message)`: for each, `(await h.tasks()).find((g) => g.task === taskId)`; when found and it has a `start`, `h.restore(group.start, message)`.
- Plain/single `hh:restoreTask`: after the main restore succeeds, run `restoreLinkedTask` for the task's scope (the scope comes from the main group's entries' `scope` trailer, else the open scope), inside the same `restores.run` guard. A linked failure is logged and the window gets the existing generic failure.
- Board `hh:restoreTask`: run `restoreTaskByPaths` on each linked history first as a dry check is not available, so: call `restoreTaskByPaths` on the main history; on `ok`, call it on each linked history; a linked refusal is returned as `{ refused: undoRefusalOf(r) }` with `path` prefixed `<key>/`. (Main may then be restored while a linked one refused: log "Undo covered the work folder but not <key>" and return the refusal; the window shows it.) Open question: a two-phase check across histories is a follow-up.
- `hh:linkedHistory` (registered in `registerLinkedIpc`): `linkedHistoryView(...)` for the open scope; `client.scopes.linkedHistory(): Promise<LinkedHistoryView>`.

```ts
export interface LinkedHistoryView {
  /** Untracked (git) folders of the open scope: the panel says undo doesn't cover them. */
  uncovered: { key: string; label: string }[];
  /** Per task id: what it changed in each tracked folder. */
  tasks: Record<string, { key: string; label: string; changes: HistoryFileChange[] }[]>;
}
```

- [ ] **Step 4: Run.** `corepack pnpm vitest run packages/shell/test/linked-restore.test.ts packages/shell/test/restore-paths.test.ts packages/shell/test/tasks-ipc.test.ts`. Expected: PASS.

- [ ] **Step 5: Typecheck, test, build, commit.**

```bash
git -C <worktree> add packages/shell/src/main/linked-restore.ts packages/shell/src/main/linked-ipc.ts packages/shell/src/main/index.ts packages/shell/src/preload/index.ts packages/ui/src/client.ts packages/ui/test/fake-client.ts packages/shell/test/linked-restore.test.ts
git -C <worktree> commit -m "feat(shell): undoing a task restores its tracked linked folders too" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 12: Scope settings and the History panel lines

**Files:**
- Create: `packages/ui/src/hatches/ScopeSettings.tsx`, `packages/ui/src/hatches/LinkedFolders.tsx`
- Modify: `packages/ui/src/ScopePicker.tsx` (a "Settings" button when `state.hatches`), `packages/ui/src/HistoryPanel.tsx` (linked lines when `state.hatches?.linkedFolders`), `packages/ui/src/index.ts` (export `ScopeSettings` for harness UIs), en.json `"hatches"`
- Test: `packages/ui/test/hatches-ui.test.tsx`

- [ ] **Step 1: Write the failing tests** (the fake client, `render` helper from `ui/test/render.tsx`):

```tsx
describe("Scope settings › Linked folders (hatches spec §3.2)", () => {
  it("D0: no settings button and no linked lines without state.hatches", async () => {
    // render ScopePicker and HistoryPanel with a plain state: no button named /settings/i; no "Undo doesn't cover"
  });
  it("lists the scope's links with their kind, mode and history", async () => {
    // fake linkedSet("app", [{ key: "repos", label: "Repos", path: "/code/app", mode: "write", tracked: false }])
    // the sheet shows "Repos", "/code/app", "Read and write", "Has its own git", and an "Unlink" button described by the row
  });
  it("Link a folder… per declared key; a refusal shows its sentence and focuses it", async () => {
    // pickAnswer = { refused: "engine-home" } → role=alert with "This folder holds an app's settings or keys, so it can't be linked."
  });
  it("a one-only key hides its link button once linked", async () => {});
  it("a git change asks: Track with the app's history / Leave to its own git", async () => {
    // gitChanged: true, tracked: true → "This folder now has its own git." and both buttons; Leave → confirmGit(…, false)
  });
  it("shows the Codex line when the engine can't take linked folders", async () => {
    // linked() answers unsupported: true → "Linked folders don't work with this version of Codex yet."
  });
});

describe("History panel with linked folders", () => {
  it("says undo doesn't cover an untracked folder, and lists a task's linked changes under the folder's label", async () => {
    // linkedHistory → { uncovered: [{ key: "repos", label: "Repos" }], tasks: { t1: [{ key: "notes", label: "Notes", changes: [...] }] } }
    // "Repos: Undo doesn't cover this folder: it has its own git." once at the top; the t1 row lists "Notes" and the file
  });
});
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.** `ScopeSettings` is a dialog (`role="dialog"`, labelled by its title "<scope title> settings", the existing sheet/dialog pattern of `SettingsSheet.tsx`: focus trap, Escape closes, focus returns to the button). It renders `LinkedFolders` when `state.hatches.linkedFolders` (part 3 adds the engine section). `LinkedFolders` loads `client.scopes.linked(scope)` on open and after each action; one "Link a folder…" button per declared key (its label in the button text: "Link a folder… (Repos)"), hidden for a `many: false` key that has a link. Refusals show in a `role="alert"` region next to the button that started it. `ScopePicker` shows a "Settings" button (`aria-label` "<scope title> settings") next to the select, only when `state.hatches` is set and a scope is open. `HistoryPanel` calls `client.scopes.linkedHistory()` when it opens and `state.hatches?.linkedFolders` is set; a failure shows nothing extra. A linked folder's changed files are plain text, not timeline links: the file timeline (plan 16, `timeline.md`) reads only the main folder's history (Known gap).

- [ ] **Step 4: Run.** `corepack pnpm vitest run packages/ui/test/hatches-ui.test.tsx packages/ui/test/scopes.test.tsx packages/ui/test/history-panel.test.tsx`. Expected: PASS.

- [ ] **Step 5: Typecheck, test, build, commit.**

```bash
git -C <worktree> add packages/ui/src/hatches packages/ui/src/ScopePicker.tsx packages/ui/src/HistoryPanel.tsx packages/ui/src/index.ts packages/i18n/src/locales/en.json packages/ui/test/hatches-ui.test.tsx
git -C <worktree> commit -m "feat(ui): scope settings with linked folders; the History panel says what undo covers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 13: A fixture and the end-to-end test

**Files:**
- Create: `packages/fake-agent/fixtures/hatches-harness/` (`harness.config.ts`, `agent/AGENTS.md`, `agent/tasks/implement.md`, `ui/App.tsx` only if the fixture needs one — prefer the core UI), `packages/e2e/tests/hatches-linked.spec.ts`
- Test: the spec file; `packages/harness-sdk/test/hatches.test.ts` (append: the fixture loads)

- [ ] **Step 1: The fixture.** Copy the shape of `packages/fake-agent/fixtures/parallel-harness/harness.config.ts`, then: `id: "hatches"`, `name: "Hatches"`, `scopes: { label: "Project", plural: "Projects" }`, `permissions: { edit: "folder", exec: false, web: false }`, one action `implement` (`prompt: "./agent/tasks/implement.md"`), `linkedFolders: { repos: { label: "Repos", mode: "write", history: "auto", many: true } }`. No `parallel`, no `jobs` (plain mode).

- [ ] **Step 2: Write the e2e test** (pattern of `jobs.spec.ts`: build the shell with `HH_HARNESS_DIR`/`HH_OUT_DIR` into `out/hatches`, launch with a fake-claude script written at test time):

```ts
test("link a git folder and a plain one; a turn edits both; undo restores only the plain one", async () => {
  // sandbox: repo/ with .git/HEAD (git) and notes/ (plain), both outside s.folder
  // start the app, create a project "App" (scope picker), open its Settings, stub dialog.showOpenDialog to answer repo, click "Link a folder… (Repos)", then notes
  // the sheet lists both: repo "Has its own git", notes "Tracked by the app's history"
  // fake-claude script for the task: writes <repo>/a.txt and <notes>/b.txt, then a result line
  // run the task: argv (HH_FAKE_ARGS) has one --settings whose additionalDirectories equal [repo, notes] (real paths), no --add-dir
  // denied tools include Edit(/<repo>/.git/**) and Edit(/<repo>/.claude/**)
  // AGENTS.md has "### Folders of this scope" with both paths
  // History: "Repos: Undo doesn't cover this folder…" shows; Undo this task → b.txt is gone from notes, a.txt stays in repo
  // the linked history's gitdir exists under <userData>/linked-history/
});

test("the picker refuses ~/.claude through a link, linking nothing", async () => {
  // a link in the sandbox pointing at <sandbox home>/.claude (the sandbox sets HOME? if not, use the main folder instead:
  // a link pointing into s.folder → "This is your work folder…"); scopes.json has no linked key
});
```
Never touch the real home: if the app reads `os.homedir()`, make the refusal case use the work folder (main-folder refusal) through a symlink instead of `~/.claude`.

- [ ] **Step 3: Run.** `corepack pnpm app:build` then `corepack pnpm --filter @humanharness/e2e exec playwright test tests/hatches-linked.spec.ts tests/history.spec.ts`. Expected: PASS (history.spec unchanged: D0).

- [ ] **Step 4: Full run.** `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm e2e`.

- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/fake-agent/fixtures/hatches-harness packages/e2e/tests/hatches-linked.spec.ts packages/harness-sdk/test/hatches.test.ts
git -C <worktree> commit -m "test(e2e): link a git folder and a plain one; undo covers only the plain one" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 14: Docs

**Files:**
- Create: `docs/architecture/hatches.md`
- Modify: `docs/architecture/manifest.md` (a `linkedFolders` row and a Checks line), `docs/architecture/engines.md` (linked folders on Claude and on ACP, next to the references bullets f2363fe added), `docs/architecture/context.md` (the board-mode `linked-folders` start item), `docs/architecture/timeline.md` (one Known-gaps line), `docs/architecture/history.md` (tracked linked folders, undo over both, "Go back here" main only), `docs/architecture/data.md` (`scopes.json` `linked`), `docs/architecture/authoring.md` (a short "Linked folders" paragraph), `packages/cli/src/guide.ts` / template if they list manifest fields (check with `grep -n "inbox\|parallel" packages/cli/src/guide.ts packages/cli/src/template.ts`)

- [ ] **Step 1: Write `hatches.md`** in the style of `jobs.md`: what a hatch is (D4), H1 end to end (manifest, linking and refusals table, storage, to the agent per engine, AGENTS.md vs board first message, history tracked/untracked, undo, gain/lose git), the D0 table, the threat-model table L1–L9 with their tests, Decisions 1–15 in one line each, Known gaps:
  - live checks still pending (S1: a trusted linked folder's `.codex/config.toml` loading, `read-only` refusal in a listed folder, `session/load` with a different list; S2: `permissions.additionalDirectories` under `acceptEdits` with the deny rules, a linked folder's `.claude/agents` not loaded in `-p`);
  - Codex marks every listed write folder as a trusted project, so its `.codex/config.toml` (hooks, MCP) and `.agents/skills` may load; the core denies edits there but cannot see or approve what is already in the repo (spec §3.3);
  - a linked folder's history has no size limit;
  - board-mode undo can restore the work folder and then refuse a linked one (no two-phase check);
  - the file timeline (plan 16) covers only the main folder: a tracked linked folder's files have no timeline, and the "not covered" line shows only in the History panel (spec §3.4 names both).
- [ ] **Step 2: The other docs** as listed: one paragraph or row each, linking to `hatches.md`.
- [ ] **Step 3: Check links.** `grep -rn "hatches.md" docs/architecture` lists each new link; every path you name exists (`ls`).
- [ ] **Step 4: Commit.**

```bash
git -C <worktree> add docs/architecture packages/cli/src/guide.ts packages/cli/src/template.ts
git -C <worktree> commit -m "docs: linked folders (hatches H1)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

## Parallel execution

After Task 0, these touch disjoint files and can run at once:

| Wave | Tasks | Notes |
|---|---|---|
| A | 1, 2, 3, 4, 5 | SDK / scopes.ts / linked-folders.ts / linked-history.ts / runtime claude-cli + transport + a one-line workspace.ts change (5 owns workspace.ts in this wave) |
| B | 6, 7 | 6: acp.ts, fake-acp, and one `onLinkedUnsupported` pass-through line in workspace.ts; 7: instructions.ts + workspace.ts/runtime.ts options. Both touch workspace.ts in different functions: run them in parallel only in separate worktrees and merge, or run 6 then 7 |
| C | 8, 9 | 8: workspace.ts (runtime); 9: shell IPC, preload, client, en.json |
| D | 10 | needs 5–9 |
| E | 11, then 12 | 11 adds the IPC 12's panel calls |
| F | 13, then 14 | |
