# Parallel tasks and jobs, part 1 (slots and history attribution) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship slices 1 and 2 of the parallel-tasks spec (§13): the runtime split into one shared `Workspace` per folder and one `SessionSlot` per open task, and a history that can run several turns at once and still knows which files each turn changed. Nothing in the app uses more than one slot yet. Every harness behaves byte for byte as today.

**Architecture.**

*Slots.* `packages/runtime/src/workspace.ts` adds `createWorkspace(opts)`. It does what `createRuntime` did up to the first turn: `prepareFolder`, `writeInstructions`, `History.init` and the `Start` commit. Then it opens slots with `workspace.openSlot({ key, session, onSession, kind, permissions })`. A slot owns what is per task:
- its transport (`ClaudeCliTransport` or `AcpTransport`);
- its engine session;
- its own block bridge (`openBridge`);
- its own data and material RPC sockets, whose handlers get the slot's identity (`SlotRef`), so a request knows which task asked;
- its `AbortController`.

A slot's `send` keeps today's contract: one turn at a time per slot, and the `"A turn is already running"` error per slot. `createRuntime` stays, with the same signature and the same `HarnessRuntime` shape. It is now a workspace with exactly one slot, `"main"`, so the CLI's `humanharness run` and the shell keep working unchanged.

*Turn windows.* `packages/runtime/src/turn-ledger.ts` keeps one `TurnWindow` per running turn. A window holds:
- `before`: the snapshot it starts from;
- `startDirty`: the working tree's dirty paths when it started, if it started while another turn ran;
- `overlapped`: true once another window existed at any moment of this one;
- `edits`: the folder-relative paths named by the turn's edit events.

`packages/runtime/src/turn-commit.ts` has `beginTurn` and `endTurn`.
- **A window that never overlapped runs exactly today's code:**
  - `history.save(BEFORE_MESSAGE)` before the turn;
  - after it, `history.save(TURN_PREFIX…)`, or `history.restore(before, UNDO_PREFIX…)` on `agent-crashed`, or `history.save(STOPPED_PREFIX…)`.
  This is the D0 path: with one slot no window ever overlaps.
- **An overlapped window** uses attribution:
  - it diffs the working tree against its start;
  - `attribute()` gives each path an owner;
  - it commits only its own paths with `History.commitPaths`, then the shared paths in a second commit (`Shared:` trailers);
  - on `agent-crashed` it restores only its owned paths with `History.restorePaths`, from the queue head.

*Edit events.* `activity` start events gain an optional `edits?: string[]`, filled by the transport parsers:
- Claude: the `file_path` of `Edit`, `Write` and `MultiEdit`, and the `notebook_path` of `NotebookEdit`;
- ACP: `locations` and `diff` content of `edit`/`delete`/`move` calls.

`TurnController` strips `edits` before an event reaches the window or the chat log (`forWindow`), so the window's stream is unchanged.

*History.* `packages/workspace/src/history.ts` gains:
- `saveNow(message, only?)` and `writeEntry`, the same shape plan 16 gives them (see Overlaps);
- `commitPaths`, `restorePaths`, `dirtyState`, `changedSince` and `commitsSince`;
- `Job:` and `Shared:` trailers;
- `tasks(depth, { ownCommits: true })`, where a task's changes come from its own commits.

Every write still goes through the one `serialize` queue, so two commits never interleave (spec §5.1). Attribution itself is pure (`packages/workspace/src/attribution.ts`).

**Tech Stack:** TypeScript, isomorphic-git (`statusMatrix`, `hashBlob`, `add`, `remove`, `commit`, `walk`), Vitest, fake-claude / fake-acp, Playwright e2e, pnpm via corepack.

**Spec:** `docs/superpowers/specs/2026-10-27-parallel-tasks-and-jobs-design.md`: §4 sessions, §5 history, §11 tests, §13 slices 1–2. Parts 2 (parallel tasks and the inbox) and 3 (jobs) build on this part's names. **Branch:** `feat/parallel-tasks`, created from `feat/plugins` HEAD by Task 0.

---

## Conventions

**Code.** Same as plans 1–12:
- English everywhere;
- packages export TS source; extensionless imports;
- tests in `packages/<name>/test/`;
- one commit per task.

Match the surrounding code's comment density and style: doc comments on every exported name, `Object.hasOwn` for lookups by untrusted names, no regex built from untrusted text.

**Hot files** get small, additive edits only:
- `packages/workspace/src/history.ts`: new methods and trailer fields. The two extractions (`saveNow`'s `only`, `writeEntry`) copy plan 16's shape exactly.
- `packages/runtime/src/runtime.ts`: becomes a thin wrapper over `workspace.ts`.
- `packages/runtime/src/events.ts`, `claude-cli.ts`, `acp.ts`: one optional field and two helpers.
- `packages/shell/src/main/turn-controller.ts`: `forWindow`, and a widened `ensureRuntime` type.

**en.json.** Part 1 adds no UI string.

**Commands and git.**
- Worktree: `/Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-sidekick`. `<worktree>` below means that path, written out in full. Never `cd` to the main checkout.
- Run every `corepack pnpm …` from the worktree root. A single test file: `corepack pnpm vitest run <path>`.
- Git: `git -C <worktree> …`, one simple command per call. Never push, never a bare `git stash`, never commit on another branch.
- Every task ends with `corepack pnpm typecheck` and `corepack pnpm test` green. Tasks touching the shell main process also run `corepack pnpm app:build`. Task 12 runs `corepack pnpm e2e`.
- Commit trailer, exactly, after a blank line:

```
Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv
```

**No task changes dependencies or runs an install of any kind** (no `pnpm install`, not even `--offline`; no `npx` that downloads).

**Compliance.**
- No code, test or spike reads `~/.claude`, `~/.codex`, `~/.gemini`, `~/.config/opencode`, `~/.local/share/opencode` or any credential file.
- Tests never touch the real Keychain and use no network beyond `127.0.0.1`.
- The spike (Task 1) runs the real CLIs with tiny prompts in a scratch folder. It lets each CLI read its own login, but nothing in the spike opens those folders.

## D0 is a hard rule

A harness that declares neither `parallel` (this part) nor `jobs` (part 3) behaves byte for byte as today:
- the same history commits (subjects, trailers, trees, order);
- the same prompts and argv to every engine;
- the same events to the window and the same chat log lines;
- the same AGENTS.md;
- the same `ui`, `data` and `material` MCP server specs.

Each item has a regression test:

| D0 item | Test |
|---|---|
| History commits of a run through `createRuntime` (ok turn, stopped turn, crashed turn with a write, a turn with no change) | `packages/runtime/test/runtime-d0.test.ts` (Task 2): golden subjects, trailers and per-commit file lists, written **before** any change and kept green by every later task |
| Engine argv and prompts | the same golden test records fake-claude's argv and prompts |
| Window events and chat log | `turn-controller.test.ts`: `forWindow` returns the same object for events without `edits`; the window and log never see `edits` (Task 3) |
| A manifest without `parallel` parses to the same object as before | `parallel.test.ts` (harness-sdk, Task 2) |
| `withTrailer` without `job`/`shared` writes exactly what it did; `parseCommitMessage` of old messages is unchanged | `history-trailers.test.ts` (Task 5) |
| `tasks()` without `ownCommits` returns exactly what it did | `history.test.ts` stays green; a new test compares both modes on a history with no overlap (Task 10) |
| `createRuntime`'s MCP server specs (names, env) for task slots | `runtime.test.ts` stays green; a test pins that no `HH_JOB` variable reaches a task slot's `ui` server (Task 9) |
| The e2e flow's commits | `packages/e2e/tests/history.spec.ts` gains a golden check of the demo flow's commit subjects (Task 12) |

## Threat model (part 1)

Part 1 adds no new input from the window or the agent. Its risks are about one task's turn damaging another task's files:

| # | Boundary | What enforces it | Test |
|---|---|---|---|
| T1 | A crashed turn restores only the paths it owns, never another running task's in-flight changes | `endTurn` on `agent-crashed` with overlap calls `restorePaths(owned, head)`; shared and others' paths stay | `turn-commit.test.ts` (Task 7) |
| T2 | A partial commit never contains another task's in-flight paths named by that task's edit events | `attribute` leaves them out; `commitPaths` stages only the listed paths | `attribution.test.ts` (Task 6), `turn-commit.test.ts` (Task 7) |
| T3 | Edit paths outside the folder are ignored | `TurnLedger.noteEdits` keeps only paths that resolve inside the folder (or its real path); `..` and absolute outsiders are dropped | `turn-ledger.test.ts` (Task 7) |
| T4 | `restorePaths` never writes through a link, never outside the folder | the same `writeEntry` as `restore`, with the real-path checks before and right after `mkdir`; removals use `rm` (never follows) after `staysInside` | `history-paths.test.ts` (Task 4) |
| T5 | A job slot can only narrow the harness's permissions | `narrowPermissions(base, override)` takes the stricter of each field; `openSlot` uses it | `parallel.test.ts` (harness-sdk, Task 9) |
| T6 | One slot's cancel or crash never touches another | one transport per slot (one `codex-acp` process per slot, spec §4); per-slot `AbortController` | `workspace.test.ts` (Task 8): cancel slot A while B runs, B ends ok |

## Decisions this plan takes where the spec leaves room

1. **`edits`, not `paths`.** Spec §5.2 names the new field `paths`. Plan 17 (context panel) already adds `paths` to `activity` events for **reads** (Read/Grep/Glob, ACP read/search) and pins that an Edit carries nothing new. This plan uses `edits` for edit tools so the two merge without a conflict. Both are stripped by `forWindow` (see Overlaps).
2. **One snapshot path when alone.** A turn that starts with no other turn running takes today's `Before message` snapshot. A turn that starts while another runs takes **no** snapshot: committing then would put the running turn's in-flight files under the new turn's trailer. It records `startDirty` instead (path → blob id of every dirty tracked path), and its `before` is the queue head.
3. **"Changed since start"** is a path that is dirty against HEAD now and, if it was dirty at start, has a different blob id now. A path another turn committed meanwhile (and that didn't change again) is clean against HEAD, so it drops out (spec §5.2 step 1).
4. **Ownership.**
   - A path named by this turn's edit events is owned, even if another turn also named it (the conflict notice covers that case).
   - A path named only by a still-running overlapping turn is left for that turn.
   - The rest is shared with every still-running overlapping turn.
5. **Shared paths get their own commit.** It comes right after the owned commit, with the subject `Shared: <message start>` (new `SHARED_PREFIX`), the same `Task:` trailer, and one `Shared: <task id>` trailer line per other task (at most 8). Then "Undo this task" can tell owned paths (commits without `Shared:` trailers) from shared ones. The spec only says "committed with this turn, with `Shared:` trailers". With no shared path there is no second commit.
6. **Crash restore** (overlap only): the owned paths come back from the queue head (`history.last()`). A path absent there is removed. Shared paths are left alone and logged (`console.error("Crash restore left shared paths", …)`). Its commit subject is today's `Undo: the turn did not finish`, staging only those paths.
7. **Conflicts.** `endTurn` reports a path as a conflict when it is among this turn's owned or shared paths and a commit since `before` with another `Task:` trailer changed it. The slot's `onAttribution` callback receives `{ owned, shared, with, conflicts }`. Part 2 shows it to both tasks.
8. **Slot keys.** `createRuntime`'s single slot is `"main"`. Part 2 keys task slots by task id, part 3 keys job slots `job:<run id>`. Keys are opaque to the runtime.
9. **Per-slot sockets, shared handlers.** The spec's table puts the data RPC server in the shared column. Each slot opens its own RPC socket (and bridge), but every socket's handler is the workspace's one `data` / `material` function, called with the slot's `SlotRef`. A request can't claim another task's identity: the socket decides it. The write lock stays the `DataStore`'s existing `serialize` queue (one store per base, `dataStoreFor` in the shell), which already orders every write (spec §8 "a lock per collection" is met by a stricter global queue; noted in open questions).
10. **Idle ACP adapters.** `slot.sleep()` closes the transport's process (`AcpTransport.close()`) and keeps `session` (`{ id, started: true }`), so the next turn reconnects and `session/load`s it. Claude's `sleep()` does nothing. Part 2 calls it after a task has waited 10 minutes (spec §4).
11. **Job slots.** `openSlot({ kind: "job" })` sets `HH_JOB=1` on that slot's `ui` server spec (part 3 makes the server act on it). `permissions` is narrowed with `narrowPermissions`. A task slot's specs are exactly today's.
12. **Instructions refresh across slots.** `workspace.refreshInstructions()` refuses (returns false) while any slot runs a turn (`ledger.anyRunning()`). Part 2 schedules the retry (spec §10).

## File structure

| File | Change | Responsibility |
|---|---|---|
| `docs/spikes/2026-10-28-parallel-tasks.md` | Create | Spike results (Task 1) |
| `packages/harness-sdk/src/parallel.ts` | Create | `parallel` manifest schema, `isConcurrent`, `narrowPermissions` |
| `packages/harness-sdk/src/index.ts` | Modify | `parallel` key; re-export |
| `packages/runtime/src/events.ts` | Modify | `edits?` on activity |
| `packages/runtime/src/claude-cli.ts`, `acp.ts` | Modify | `editPaths`, `acpEditPaths` |
| `packages/fake-agent/src/script.ts` | Modify | `claudeEditLine` helper |
| `packages/shell/src/main/turn-controller.ts` | Modify | `forWindow`; `ensureRuntime` returns `TurnRunner` |
| `packages/workspace/src/history.ts` | Modify | `saveNow(only)`, `writeEntry`, `commitPaths`, `restorePaths`, `dirtyState`, `changedSince`, `commitsSince`, trailers, `tasks({ ownCommits })` |
| `packages/workspace/src/subjects.ts` | Modify | `SHARED_PREFIX` |
| `packages/workspace/src/attribution.ts` | Create | `attribute`, `conflictsOf` |
| `packages/runtime/src/turn-ledger.ts` | Create | `TurnLedger`, `TurnWindow` |
| `packages/runtime/src/turn-commit.ts` | Create | `beginTurn`, `endTurn` |
| `packages/runtime/src/workspace.ts` | Create | `createWorkspace`, `SessionSlot` |
| `packages/runtime/src/runtime.ts` | Modify | `createRuntime` = workspace + slot `"main"` |
| `packages/runtime/src/index.ts` | Modify | exports |
| `packages/workspace/src/undo-paths.ts` | Create | `ownedPathsOf`, `sharedPathsOf`, `laterTasksSharing` |
| tests | Create/modify | listed per task |
| `docs/architecture/history.md`, `turn.md`, `engines.md` | Modify | Part 1 sections |

## Overlaps with other in-flight plans (read-only; their branches are not under `feat/plugins`)

- **Plan 16 (file timeline)** rewrites `History.saveNow` as `saveNow(message, only?: ReadonlySet<string>)` and extracts `writeEntry` (its Tasks 3 and 5).
  - This plan's Task 4 introduces **the same two signatures with the same bodies** (minus plan 16's index and `committed` hook), so a later merge is a near-identical hunk. Keep plan 16's version when both are present.
  - Plan 16's `restoreFile(file, sha, message)` and this plan's `restorePaths(paths, sha, message, trailer)` both sit on `writeEntry`. They can stay side by side, or `restoreFile` can call `restorePaths([file], …)`.
  - Plan 16's `onCommit` listeners must also fire for `commitPaths` and `restorePaths`: they go through `saveNow`, so they do.
- **Plan 17 (context panel)** adds `activity.paths`/`activity.tool` for reads and `forWindow` in `turn-controller.ts`, which strips them.
  - This plan adds `activity.edits` and its own `forWindow`, which strips `edits`. On merge, keep one `forWindow` that strips all three. Plan 17's D0 test "a Write activity carries nothing new" becomes "carries only `edits`".
  - Plan 17 changes `TaskManager.contextFor`, `begin` and `runTurn`. This part doesn't touch `task-manager.ts`.

## Open questions (each with the default this plan takes)

1. **`edits` instead of the spec's `paths`** (Decision 1). *Default: `edits`.*
2. **Shared paths in a second commit** (Decision 5). *Default: two commits.*
3. **Per-slot sockets** (Decision 9). *Default: per-slot sockets, shared handlers.* The data write lock is the store's existing global queue, not one per collection. *Default: keep it; it is stricter and already correct.*
4. **No `Before message` snapshot for a turn that starts while another runs** (Decision 2). The person's own edits made during another task's turn are then attributed at the next turn end (owned by nobody's edits → shared). *Default: as stated.*
5. **One `codex-acp` process per slot** (spec open question 1). The spike measures its memory and start time. *Default: one per slot; idle ones sleep after 10 minutes (part 2).*

## Standing rules (plan defaults taken; list them for Marco at the end)
All defaults in this plan's Decisions and Open questions stand until Marco answers. All UI labels are English only (plan 5a).
D0 is a hard rule: parallel tasks and jobs are core features a harness opts into with `parallel` or `jobs` in its manifest. Without them, everything behaves byte for byte as today; each D0 item has a regression test.
Compliance: product code, tests, spikes and agents never read ~/.claude, ~/.codex, ~/.gemini, ~/.config/opencode, ~/.local/share/opencode, or any account, token or credential file. No test uses the network beyond 127.0.0.1 or the real Keychain. Install nothing: no `pnpm install` of any kind, not even `--offline`, and no `npx` that downloads.
Worktree: /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-sidekick. Branch: feat/parallel-tasks, stacked on feat/plugins. Keep edits to shared hot files small and additive; en.json only inside the `"parallel"` block (parts 2–3), never prettier an existing file.
Commit trailer, exactly: "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" + "Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv". Reviewers must not flag "(1M context)".

---

### Task 0: Branch and this plan

- [ ] **Step 1: Create the branch** from `feat/plugins` HEAD:

```bash
git -C <worktree> status --short
git -C <worktree> switch -c feat/parallel-tasks
```

`status` must be clean first. If it isn't, stop and report.

- [ ] **Step 2: Copy the plan.** Copy `/private/tmp/claude-501/-Users-marcozanger-Documents-workspace-humanharness--claude-worktrees-plan-scopes-data/e2d9762b-c53e-4c2d-9cc2-c4e0683ef9d2/scratchpad/pt/2026-10-28-parallel-tasks-part1.md` to `docs/superpowers/plans/2026-10-28-parallel-tasks-part1.md`. The spec is already on the branch (`docs/superpowers/specs/2026-10-27-parallel-tasks-and-jobs-design.md`).

- [ ] **Step 3: Commit**

```bash
git -C <worktree> add docs/superpowers/plans/2026-10-28-parallel-tasks-part1.md
git -C <worktree> commit -m "docs(plans): parallel tasks and jobs, part 1

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 1: Spike — several sessions per engine, idle adapters, edit events

**Files:**
- Create: `docs/spikes/2026-10-28-parallel-tasks.md`
- Scratch only (never committed): `$SCRATCH/pt-spike/` (`$SCRATCH` = the session scratchpad)

The spike runs the real CLIs **with tiny prompts only**.
- It installs nothing. Before running `codex-acp`, check that it is already in the npx cache with `npx --no-install @agentclientprotocol/codex-acp@2.2.2 --help`. If that fails, record "not cached: not run" and use fake-acp for S3–S4.
- It never opens `~/.claude`, `~/.codex`, `~/.config/opencode`, `~/.local/share/opencode` or any credential file. The CLIs read their own logins; the spike doesn't.
- Every run happens in a fresh folder under `$SCRATCH/pt-spike/`.
- An engine that is not installed or not logged in is recorded as such and skipped.

- [ ] **Step 1: S1, two Claude turns at once in one folder.** In `$SCRATCH/pt-spike/s1/`, start two `claude -p` processes **concurrently**:
  - each with `--output-format stream-json --verbose --include-partial-messages --session-id <uuid>` (distinct uuids) and `--permission-mode acceptEdits --allowedTools "Edit(./**)" "Write(./**)"`;
  - prompts: `Create the file a.txt containing the word alpha. Reply OK.` and the same with `b.txt` / `beta`.

  Record:
  - both exit 0;
  - both files exist;
  - the `tool_use` lines' `name` and `input.file_path` (absolute? real path or the folder as given, e.g. `/private/var/...` vs `/var/...`?);
  - wall time of each.

  Then `--resume <uuid>` each with `What word did you write? One word.` Record that each answers its own word.

- [ ] **Step 2: S2, Claude permission in `-p`.** Run one turn with `--disallowedTools Bash` and the prompt `Run the shell command echo hi and tell me the output.` Record that the turn ends on its own: no prompt, no hang (timeout 120 s), and what the result line says. This backs spec §8 "a Claude tool that would need confirmation is denied at once".

- [ ] **Step 3: S3, two Codex adapters at once** (only if cached). Spawn two `npx --no-install @agentclientprotocol/codex-acp@2.2.2` processes from a small Node script in `$SCRATCH/pt-spike/s3/run.mjs`. Use `@agentclientprotocol/sdk` from the repo's `node_modules`, the same calls as `AcpTransport`: `initialize`, `session/new { cwd }`, `session/set_mode "workspace-write"`, `session/prompt "Create c.txt containing gamma. Reply OK."` (and `d.txt`/`delta` on the other), at the same time. Record:
  - both `stopReason: end_turn`;
  - both files;
  - for each process, the `tool_call` updates' `kind`, `locations` and any `content[].type === "diff"` `path`;
  - each process's RSS (`ps -o rss= -p <pid>`) after the turn;
  - the time from spawn to `initialize` answered;
  - whether either `session/request_permission` arrived and with what `toolCall.kind` and `locations`.

- [ ] **Step 4: S4, sleep and resume a Codex session.** On one of S3's processes, note `sessionId`, kill the process (SIGTERM to the group, as `AcpTransport.terminate` does), start a new one, `initialize`, then `session/load { sessionId, cwd }` and prompt `Which file did you create? Just the name.` Record:
  - `agentCapabilities.loadSession`;
  - that `session/load` succeeds;
  - the answer (`c.txt`);
  - how long the new process took until the answer.

  If codex-acp is not cached, do the same with fake-acp (`packages/fake-agent`, `loadSession: true`) and say only the protocol path was checked.

- [ ] **Step 5: S5, OpenCode twice at once** (only if `opencode --version` works). Two `opencode acp` processes, the same as S3 (mode `build`). Record:
  - whether both turns finish;
  - any lock or port error on stderr (only the error text; never read its data folder);
  - the edit `tool_call` `locations`.

- [ ] **Step 6: Write `docs/spikes/2026-10-28-parallel-tasks.md`**, with:
  - a summary table (S1–S5, verdict, what later tasks must do differently);
  - per section: the commands run (no tokens or account details), what came back, and the conclusion.

  Name these facts explicitly; later tasks cite them:
  - **PT-S1**: Claude reports `file_path` as given or real path. Task 7's `TurnLedger` must accept both the folder and `fs.realpathSync(folder)` as roots.
  - **PT-S2**: Claude `-p` denies an unlisted tool without asking.
  - **PT-S3**: the Codex edit `locations` and `diff` paths, and the memory per adapter.
  - **PT-S4**: `session/load` after a process restart works, so `slot.sleep()` is safe.
  - **PT-S5**: OpenCode concurrent processes work, or need one shared process (then part 2's cap for OpenCode is forced to 1 and the open question says so).

- [ ] **Step 7: Commit** (the doc only):

```bash
git -C <worktree> add docs/spikes/2026-10-28-parallel-tasks.md
git -C <worktree> commit -m "docs(spikes): parallel sessions per engine, idle adapters, edit events

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 2: D0 golden test first, then the `parallel` manifest key

The golden test pins **today's** behaviour before anything changes, so every later task keeps it green.

**Files:**
- Create: `packages/runtime/test/runtime-d0.test.ts`
- Create: `packages/harness-sdk/src/parallel.ts`
- Modify: `packages/harness-sdk/src/index.ts`
- Test: `packages/harness-sdk/test/parallel.test.ts`

- [ ] **Step 1: Write the golden test (it passes now; that's the point).** It drives `createRuntime` on the notes fixture through four turns:
  - a turn that writes a file;
  - a stopped (cancelled) turn;
  - a turn that writes a file and then crashes;
  - a turn with no change.

```ts
// packages/runtime/test/runtime-d0.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import git from "isomorphic-git";
import { afterAll, describe, expect, it } from "vitest";
import { getEngine } from "@humanharness/engines";
import { type ClaudeScript, claudeResultLine, claudeTextLines, fakeClaudeCommand, writeScript } from "@humanharness/fake-agent";
import { loadHarness } from "@humanharness/harness-sdk";
import type { Event } from "../src/events";
import { createRuntime } from "../src/runtime";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-d0-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/notes-harness/harness.config.ts");

/** Each commit, oldest first: its whole message and the tracked files of its tree. */
async function commits(gitdir: string): Promise<{ message: string; files: string[] }[]> {
  const log = await git.log({ fs, gitdir });
  const out: { message: string; files: string[] }[] = [];
  for (const e of log.reverse()) {
    const files: string[] = [];
    await git.walk({ fs, gitdir, trees: [git.TREE({ ref: e.oid })], map: async (p, [t]) => { if (p !== "." && t && (await t.type()) === "blob") files.push(p); return undefined; } });
    out.push({ message: e.commit.message.trim(), files: files.sort() });
  }
  return out;
}

describe("D0: one runtime, today's commits and prompts (parallel spec D7)", () => {
  it("ok, stopped, crashed and empty turns commit exactly as before", async () => {
    const base = fs.mkdtempSync(path.join(root, "t-"));
    const folder = path.join(base, "Work");
    const gitdir = path.join(base, "history.git");
    const prompts = path.join(base, "prompts.jsonl");
    const script: ClaudeScript = {
      steps: [...claudeTextLines("Nothing to do."), claudeResultLine(true)],
      turns: [
        { match: "^write a", steps: [{ write: { path: "a.md", content: "A" } }, ...claudeTextLines("Wrote a."), claudeResultLine(true)] },
        { match: "^slow", steps: [{ sleep: 5000 }, claudeResultLine(true)] },
        { match: "^crash", steps: [{ write: { path: "b.md", content: "B" } }, { signal: "SIGKILL" }] },
      ],
    };
    const rt = await createRuntime({
      harness: await loadHarness(FIXTURE),
      engine: getEngine("claude"),
      folder,
      gitdir,
      language: "en",
      command: fakeClaudeCommand(),
      env: { HH_FAKE_SCRIPT: writeScript(base, script), HH_FAKE_PROMPTS: prompts },
    });
    const trailer = { task: "t1", action: "intro" };
    const run = async (m: string, cancelAfter?: number) => {
      const events: Event[] = [];
      const turn = rt.send(m, (e) => events.push(e), { trailer });
      if (cancelAfter !== undefined) setTimeout(() => turn.cancel(), cancelAfter);
      await turn.done;
      return events.at(-1);
    };
    expect(await run("write a")).toEqual({ type: "done", ok: true });
    expect(await run("slow", 300)).toMatchObject({ type: "done", ok: false, error: { code: "cancelled" } });
    expect(await run("crash")).toMatchObject({ type: "done", ok: false, error: { code: "agent-crashed" } });
    expect(await run("nothing")).toEqual({ type: "done", ok: true });
    await rt.close();
    const T = "\n\nTask: t1\nAction: intro";
    // The literal expectation is today's output. If the first run shows a different (but current) value, copy that
    // output here once, before Task 3, and say so in the commit: this test pins what the code does now.
    expect(await commits(gitdir)).toEqual([
      { message: "Start", files: ["README.md"] },
      { message: `Before message${T}`, files: ["README.md"] },
      { message: `Turn: write a${T}`, files: ["README.md", "a.md"] },
      { message: `Stopped: slow${T}`, files: ["README.md", "a.md"] },
      { message: `Undo: the turn did not finish${T}`, files: ["README.md", "a.md"] },
      { message: `Turn: nothing${T}`, files: ["README.md", "a.md"] },
    ]);
    const argv = fs.readFileSync(prompts, "utf8").trim().split("\n").map((l) => (JSON.parse(l) as { argv: string[] }).argv);
    expect(argv.map((a) => a.includes("--session-id") || a.includes("--resume"))).toEqual([true, true, true, true]);
  });
});
```

The fixture's seed files decide the `files` lists. Run the test once. Then replace the expected array with the **exact** commits and files it reports today, and keep the structure above:
- `Start`;
- `Before message` only when the person's state changed (the first one, then none: identical snapshots return null);
- `Turn`, `Stopped`, `Undo`, `Turn`.

The test must pass on the unchanged code; that is its job.

- [ ] **Step 2: Run it.** `corepack pnpm vitest run packages/runtime/test/runtime-d0.test.ts`. Expected: PASS (after pinning today's literal output).

- [ ] **Step 3: Write the failing manifest tests.**

```ts
// packages/harness-sdk/test/parallel.test.ts
import { describe, expect, it } from "vitest";
import { defineHarness, isConcurrent, narrowPermissions, parallelCaps } from "../src";

const base = {
  id: "t", name: "T", core: "^0.1.0", engines: ["claude"], folder: { suggested: "Documents/T" }, instructions: "./AGENTS.md",
  permissions: { edit: "folder" as const, exec: false, web: false }, blocks: {}, author: "x",
};

describe("parallel (parallel spec §3)", () => {
  it("D0: a manifest without parallel parses to the same object as before", () => {
    const h = defineHarness(base);
    expect("parallel" in h).toBe(false);
    expect(isConcurrent(h)).toBe(false);
    expect(parallelCaps(h)).toEqual({ tasks: 1, jobs: 1 });
  });
  it("defaults both caps to 1 and accepts 1..8", () => {
    expect(defineHarness({ ...base, parallel: {} }).parallel).toEqual({ tasks: 1, jobs: 1 });
    expect(defineHarness({ ...base, parallel: { tasks: 3, jobs: 2 } }).parallel).toEqual({ tasks: 3, jobs: 2 });
    expect(isConcurrent(defineHarness({ ...base, parallel: { tasks: 1 } }))).toBe(true);
  });
  it.each([{ tasks: 0 }, { tasks: 9 }, { jobs: 1.5 }, { tasks: "2" }])("refuses %j", (p) => {
    expect(() => defineHarness({ ...base, parallel: p as never })).toThrow();
  });
});

describe("narrowPermissions (parallel spec §8, T5)", () => {
  const wide = { edit: "folder" as const, exec: true, web: true };
  it("only narrows", () => {
    expect(narrowPermissions(wide, { edit: "none" })).toEqual({ edit: "none", exec: true, web: true });
    expect(narrowPermissions({ edit: "none", exec: false, web: false }, { edit: "folder", exec: true, web: true })).toEqual({ edit: "none", exec: false, web: false });
    expect(narrowPermissions(wide, undefined)).toEqual(wide);
  });
});
```

- [ ] **Step 4: Run them to see them fail.** `corepack pnpm vitest run packages/harness-sdk/test/parallel.test.ts`. Expected: FAIL, the exports don't exist.

- [ ] **Step 5: Implement.**

```ts
// packages/harness-sdk/src/parallel.ts
import { z } from "zod";

/** The most turns of one kind the person can let run at once (Settings › General, parallel spec §7). */
export const PARALLEL_MAX = 8;

/** `parallel` (spec §3): the harness's suggested caps on running turns; each defaults to 1. */
export const parallelSchema = z.object({
  tasks: z.int().min(1).max(PARALLEL_MAX).default(1),
  jobs: z.int().min(1).max(PARALLEL_MAX).default(1),
});
export type ParallelCaps = z.output<typeof parallelSchema>;

/**
 * Several turns may run at once in this harness's folder: it declares `parallel` (part 3 adds `jobs`). False keeps
 * today's single runtime, single task and whole-folder history (D7).
 */
export function isConcurrent(harness: { parallel?: ParallelCaps }): boolean {
  return harness.parallel !== undefined;
}

/** The manifest's suggested caps; { tasks: 1, jobs: 1 } without `parallel`. */
export function parallelCaps(harness: { parallel?: ParallelCaps }): ParallelCaps {
  return harness.parallel ?? { tasks: 1, jobs: 1 };
}

/** Permissions a job may ask for (spec §8): only ever narrower than the harness's. */
export interface PermissionsOverride {
  edit?: "folder" | "none";
  exec?: boolean;
  web?: boolean;
}

/** The stricter of each field: an override can turn something off, never on. */
export function narrowPermissions(
  base: { edit: "folder" | "none"; exec: boolean; web: boolean },
  override: PermissionsOverride | undefined,
): { edit: "folder" | "none"; exec: boolean; web: boolean } {
  if (!override) return { ...base };
  return {
    edit: base.edit === "none" || override.edit === "none" ? "none" : "folder",
    exec: base.exec && override.exec !== false,
    web: base.web && override.web !== false,
  };
}
```

`packages/harness-sdk/src/index.ts`:
- add `export * from "./parallel";` next to the other re-exports;
- import `parallelSchema` from `./parallel`;
- add to `manifestSchema`, after `slots`:

```ts
  /** Suggested caps on turns running at once (parallel spec §3). Absent: one task at a time, as before (D7). */
  parallel: parallelSchema.optional(),
```

- [ ] **Step 6: Run the tests.** `corepack pnpm vitest run packages/harness-sdk/test/parallel.test.ts packages/runtime/test/runtime-d0.test.ts`. Expected: PASS.

- [ ] **Step 7: Typecheck, test, commit.** `corepack pnpm typecheck && corepack pnpm test`.

```bash
git -C <worktree> add packages/runtime/test/runtime-d0.test.ts packages/harness-sdk/src/parallel.ts packages/harness-sdk/src/index.ts packages/harness-sdk/test/parallel.test.ts
git -C <worktree> commit -m "feat(sdk): parallel caps in the manifest; D0 golden test of today's commits

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 3: Edit paths on activity events, kept out of the window

**Files:**
- Modify: `packages/runtime/src/events.ts`, `packages/runtime/src/claude-cli.ts`, `packages/runtime/src/acp.ts`, `packages/runtime/src/index.ts`
- Modify: `packages/fake-agent/src/script.ts`
- Modify: `packages/shell/src/main/turn-controller.ts`
- Test: `packages/runtime/test/claude-cli.test.ts`, `packages/runtime/test/acp.test.ts`, `packages/shell/test/turn-controller.test.ts`

- [ ] **Step 1: Write the failing tests.**

Append to `packages/runtime/test/claude-cli.test.ts` (import `StreamJsonReader, editPaths` from `../src/claude-cli`):

```ts
describe("edit paths (parallel spec §5.2)", () => {
  it("Edit, Write, MultiEdit and NotebookEdit name their file; nothing else does", () => {
    expect(editPaths("Edit", { file_path: "/w/a.md" })).toEqual(["/w/a.md"]);
    expect(editPaths("Write", { file_path: "/w/b.md" })).toEqual(["/w/b.md"]);
    expect(editPaths("MultiEdit", { file_path: "/w/c.md" })).toEqual(["/w/c.md"]);
    expect(editPaths("NotebookEdit", { notebook_path: "/w/n.ipynb" })).toEqual(["/w/n.ipynb"]);
    expect(editPaths("Read", { file_path: "/w/a.md" })).toEqual([]);
    expect(editPaths("Bash", { command: "rm x" })).toEqual([]);
    expect(editPaths("Edit", { file_path: 3 })).toEqual([]);
  });
  it("puts them on the start event only", () => {
    const events: Event[] = [];
    const reader = new StreamJsonReader((e) => events.push(e), () => {});
    reader.feed(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "w1", name: "Write", input: { file_path: "/w/a.md" } }] } }));
    reader.feed(JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "w1" }] } }));
    expect(events).toEqual([
      { type: "activity", id: "w1", kind: "edit", detail: "a.md", edits: ["/w/a.md"], state: "start" },
      { type: "activity", id: "w1", kind: "edit", detail: "a.md", state: "end", error: false },
    ]);
  });
  it("D0: a Read activity carries nothing new", () => {
    const events: Event[] = [];
    const reader = new StreamJsonReader((e) => events.push(e), () => {});
    reader.feed(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "r1", name: "Read", input: { file_path: "/w/a.md" } }] } }));
    expect(events).toEqual([{ type: "activity", id: "r1", kind: "read", detail: "a.md", state: "start" }]);
  });
});
```

Append to `packages/runtime/test/acp.test.ts` (import `acpEditPaths`; `setup` and `run` are the file's helpers):

```ts
describe("acpEditPaths (parallel spec §5.2)", () => {
  it("edit, delete and move calls: locations and diff paths, deduplicated", () => {
    expect(acpEditPaths({ kind: "edit", locations: [{ path: "/w/a.md" }], content: [{ type: "diff", path: "/w/a.md" }, { type: "diff", path: "/w/b.md" }] })).toEqual(["/w/a.md", "/w/b.md"]);
    expect(acpEditPaths({ kind: "delete", locations: [{ path: "/w/x" }] })).toEqual(["/w/x"]);
    expect(acpEditPaths({ kind: "read", locations: [{ path: "/w/a.md" }] })).toEqual([]);
    expect(acpEditPaths({ kind: "edit", locations: [{ path: "" }, {}, null] })).toEqual([]);
  });
  it("emits them on the tool call's start event", async () => {
    const { transport } = setup({
      turns: [[
        { update: { sessionUpdate: "tool_call", toolCallId: "e1", title: "Edit a.md", kind: "edit", status: "pending", locations: [{ path: "/w/a.md" }] } },
        { update: { sessionUpdate: "tool_call_update", toolCallId: "e1", status: "completed" } },
      ]],
    });
    const events = await run(transport);
    expect(events.filter((e) => e.type === "activity")).toEqual([
      { type: "activity", id: "e1", kind: "edit", detail: "a.md", edits: ["/w/a.md"], state: "start" },
      { type: "activity", id: "e1", kind: "edit", detail: "a.md", state: "end", error: false },
    ]);
  });
});
```

(If `acp.test.ts` names its helpers differently, use the file's own; the assertions stay.)

Append to `packages/shell/test/turn-controller.test.ts` (import `forWindow`):

```ts
describe("edit paths stay in main (parallel spec D7)", () => {
  it("forWindow strips edits and returns any other event as is", () => {
    const start: Event = { type: "activity", id: "e1", kind: "edit", detail: "a.md", state: "start", edits: ["/home/me/w/a.md"] };
    expect(forWindow(start)).toEqual({ type: "activity", id: "e1", kind: "edit", detail: "a.md", state: "start" });
    const plain: Event = { type: "activity", id: "r1", kind: "read", detail: "a.md", state: "start" };
    expect(forWindow(plain)).toBe(plain);
    const text: Event = { type: "text", delta: "hi" };
    expect(forWindow(text)).toBe(text);
  });
  it("the turn's listener gets the edits; the window and the chat log don't", async () => {
    // Use this file's fake runtime and setup helpers (as the other tests here do).
    const fake = fakeRuntime();
    const { controller, entries, events } = setup({ ensureRuntime: async () => fake.runtime });
    const heard: Event[] = [];
    const sent = controller.send("hi", { onEvent: (e) => heard.push(e) });
    await vi.waitFor(() => expect(fake.send).toHaveBeenCalled());
    fake.finish([{ type: "activity", id: "e1", kind: "edit", detail: "a.md", state: "start", edits: ["/home/me/w/a.md"] }, { type: "done", ok: true }]);
    await sent;
    expect(heard[0]).toMatchObject({ edits: ["/home/me/w/a.md"] });
    expect(events.find((e) => e.type === "activity")).toEqual({ type: "activity", id: "e1", kind: "edit", detail: "a.md", state: "start" });
    expect(JSON.stringify(entries)).not.toContain("/home/me");
  });
});
```

If the file has no `fakeRuntime`/`setup` helpers with these names, write the smallest equivalent inline: a runtime whose `send` stores `emit` and resolves `done` when the test calls `finish(events)`.

- [ ] **Step 2: Run them to see them fail.** `corepack pnpm vitest run packages/runtime/test/claude-cli.test.ts packages/runtime/test/acp.test.ts packages/shell/test/turn-controller.test.ts`. Expected: FAIL, missing exports.

- [ ] **Step 3: Implement.**

`packages/runtime/src/events.ts`, the `activity` member:

```ts
  /**
   * `edits`: the files an edit tool named (absolute or as the engine wrote them), on the start event only. For the
   * history's attribution (parallel spec §5.2); the window and the chat log never get them (shell `forWindow`).
   */
  | { type: "activity"; id: string; kind: ActivityKind; detail: string; state: "start" | "end"; error?: boolean; edits?: string[] }
```

`packages/runtime/src/claude-cli.ts`, after `detailOf`:

```ts
/** Claude's tools that change a file, and the input field that names it. */
const EDIT_FIELDS: Record<string, string> = { Edit: "file_path", Write: "file_path", MultiEdit: "file_path", NotebookEdit: "notebook_path" };

/** The file an edit tool call names (parallel spec §5.2); empty for any other tool or a malformed input. */
export function editPaths(tool: string, input: Record<string, unknown>): string[] {
  const field = Object.hasOwn(EDIT_FIELDS, tool) ? EDIT_FIELDS[tool] : undefined;
  const value = field ? input[field] : undefined;
  return typeof value === "string" && value ? [value] : [];
}
```

In `StreamJsonReader.feed`, the `assistant` branch:

```ts
        const activity = { kind: KINDS[b.name] ?? ("other" as const), detail: detailOf(b.name, b.input ?? {}) };
        this.tools.set(b.id, activity);
        const edits = editPaths(String(b.name), b.input ?? {});
        this.emit({ type: "activity", id: b.id, ...activity, ...(edits.length > 0 ? { edits } : {}), state: "start" });
```

`packages/runtime/src/acp.ts`, after `activityDetail`:

```ts
const EDIT_KINDS = new Set(["edit", "delete", "move"]);
/** The most paths kept from one tool call. */
const EDITS_MAX = 50;

/** The files an ACP edit, delete or move call names: its `locations` and its `diff` contents' paths (parallel spec §5.2). */
export function acpEditPaths(call: { kind?: unknown; locations?: unknown; content?: unknown }): string[] {
  if (typeof call.kind !== "string" || !EDIT_KINDS.has(call.kind)) return [];
  const out = new Set<string>();
  const add = (p: unknown) => {
    if (typeof p === "string" && p && out.size < EDITS_MAX) out.add(p);
  };
  if (Array.isArray(call.locations)) for (const l of call.locations) add((l as { path?: unknown } | null)?.path);
  if (Array.isArray(call.content)) for (const c of call.content) if ((c as { type?: unknown } | null)?.type === "diff") add((c as { path?: unknown }).path);
  return [...out];
}
```

In `onUpdate`, the `tool_call` case:

```ts
        const edits = acpEditPaths(u);
        emit({ type: "activity", id: u.toolCallId, ...activity, ...(edits.length > 0 ? { edits } : {}), state: "start" });
```

`packages/runtime/src/index.ts`: add `editPaths` to the `./claude-cli` export list and `acpEditPaths` to the `./acp` one.

`packages/fake-agent/src/script.ts`: a helper the later tests use:

```ts
/** A stream-json line where Claude calls an edit tool on `filePath` (parallel spec §5.2 tests). */
export function claudeEditLine(id: string, filePath: string, tool: "Edit" | "Write" = "Write"): { line: unknown } {
  return { line: { type: "assistant", message: { content: [{ type: "tool_use", id, name: tool, input: { file_path: filePath } }] } } };
}
```

(and export it from `packages/fake-agent/src/index.ts` if that file lists exports explicitly).

`packages/shell/src/main/turn-controller.ts`, after `isHeld`:

```ts
/**
 * An event as the window gets it: an activity's `edits` stay in main (parallel spec §5.2), so engine paths never reach
 * the renderer and the window's events are what they were (D0). Any other event is returned as is.
 */
export function forWindow(e: Event): Event {
  if (e.type !== "activity" || e.edits === undefined) return e;
  const { edits: _edits, ...rest } = e;
  return rest;
}
```

In `run`, inside `rt.send`'s callback, the window gets `forWindow(e)` (`recorder.add` keeps only `kind`/`detail`, so the log never had it):

```ts
          if (pending && (e.type === "limits" || e.type === "usage")) pending.push(e);
          else {
            release();
            this.emit(forWindow(e));
          }
```

`pending` buffers only `limits`/`usage`, so no other emit site needs it.

- [ ] **Step 4: Run the tests.** `corepack pnpm vitest run packages/runtime/test packages/shell/test/turn-controller.test.ts`. Expected: PASS. If an existing test compares a whole Edit/Write start event, add exactly `edits` to its expectation and nothing else.

- [ ] **Step 5: Typecheck, test, build, commit.** `corepack pnpm typecheck && corepack pnpm test && corepack pnpm app:build`.

```bash
git -C <worktree> add packages/runtime/src/events.ts packages/runtime/src/claude-cli.ts packages/runtime/src/acp.ts packages/runtime/src/index.ts packages/fake-agent/src/script.ts packages/fake-agent/src/index.ts packages/shell/src/main/turn-controller.ts packages/runtime/test/claude-cli.test.ts packages/runtime/test/acp.test.ts packages/shell/test/turn-controller.test.ts
git -C <worktree> commit -m "feat(runtime): edit paths on activity events, kept out of the window

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 4: History — commits and restores of chosen paths

**Files:**
- Modify: `packages/workspace/src/history.ts`
- Test: `packages/workspace/test/history-paths.test.ts`

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/workspace/test/history-paths.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import git from "isomorphic-git";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { History } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-hpaths-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
let folder: string;
let gitdir: string;
let history: History;
const write = (rel: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(folder, rel)), { recursive: true });
  fs.writeFileSync(path.join(folder, rel), content);
};
const read = (rel: string) => fs.readFileSync(path.join(folder, rel), "utf8");
const treeOf = async (sha: string) => {
  const files: Record<string, string> = {};
  await git.walk({ fs, gitdir, trees: [git.TREE({ ref: sha })], map: async (p, [t]) => {
    if (p !== "." && t && (await t.type()) === "blob") files[p] = Buffer.from((await t.content())!).toString("utf8");
    return undefined;
  } });
  return files;
};

beforeEach(async () => {
  const base = fs.mkdtempSync(path.join(root, "t-"));
  folder = path.join(base, "work");
  gitdir = path.join(base, "history.git");
  fs.mkdirSync(folder);
  history = new History(folder, gitdir, [".harness/"]);
  await history.init();
  write("a.md", "a0");
  write("b.md", "b0");
  await history.save("Start");
});

describe("History.commitPaths (parallel spec §5.2 step 4)", () => {
  it("commits only the listed paths; the rest stay dirty in the folder", async () => {
    write("a.md", "a1");
    write("b.md", "b1");
    write("c.md", "c1");
    const sha = (await history.commitPaths(["a.md", "c.md"], "Turn: one", { task: "t1" }))!;
    expect(await treeOf(sha)).toEqual({ "a.md": "a1", "b.md": "b0", "c.md": "c1" });
    expect(read("b.md")).toBe("b1");
    // The next whole save picks b.md up.
    const next = (await history.save("Turn: two", { task: "t2" }))!;
    expect(await treeOf(next)).toEqual({ "a.md": "a1", "b.md": "b1", "c.md": "c1" });
  });
  it("a deleted path is removed; nothing changed among the paths: no commit", async () => {
    fs.rmSync(path.join(folder, "a.md"));
    const sha = (await history.commitPaths(["a.md"], "Turn: rm"))!;
    expect(await treeOf(sha)).toEqual({ "b.md": "b0" });
    expect(await history.commitPaths(["b.md"], "Turn: same")).toBeNull();
    expect(await history.commitPaths([], "Turn: none")).toBeNull();
  });
  it("an untracked path is never staged", async () => {
    write(".harness/tasks.json", "{}");
    expect(await history.commitPaths([".harness/tasks.json"], "Turn: app")).toBeNull();
  });
});

describe("History.restorePaths (parallel spec §5.3, T4)", () => {
  it("brings only the listed paths back to `sha`; others keep their in-flight content", async () => {
    const start = (await history.last())!;
    write("a.md", "a1");
    write("b.md", "b1");
    write("n.md", "new");
    const r = await history.restorePaths(["a.md", "n.md"], start, "Undo: the turn did not finish", { task: "t1" });
    expect(read("a.md")).toBe("a0");
    expect(fs.existsSync(path.join(folder, "n.md"))).toBe(false);
    expect(read("b.md")).toBe("b1");
    expect(r.skipped).toEqual([]);
    // The restore's commit stages only those paths: b.md is still dirty.
    expect(await treeOf(r.sha ?? (await history.last())!)).toEqual({ "a.md": "a0", "b.md": "b0" });
  });
  it("never writes through a link that leads out of the folder", async () => {
    const start = (await history.last())!;
    const outside = fs.mkdtempSync(path.join(root, "out-"));
    fs.rmSync(path.join(folder, "a.md"));
    fs.mkdirSync(path.join(folder, "d"));
    write("d/x.md", "x0");
    const withX = (await history.save("x"))!;
    fs.rmSync(path.join(folder, "d"), { recursive: true });
    fs.symlinkSync(outside, path.join(folder, "d"));
    const r = await history.restorePaths(["d/x.md"], withX, "Undo");
    expect(r.skipped).toEqual(["d/x.md"]);
    expect(fs.readdirSync(outside)).toEqual([]);
    void start;
  });
});
```

- [ ] **Step 2: Run them to see them fail.** `corepack pnpm vitest run packages/workspace/test/history-paths.test.ts`. Expected: FAIL, `commitPaths is not a function`.

- [ ] **Step 3: Implement.** Three changes in `packages/workspace/src/history.ts`.

(a) `saveNow` gains `only`, **plan 16's signature and filter** (without its index hook):

```ts
  private async saveNow(message: string, only?: ReadonlySet<string>): Promise<string | null> {
    const filter = only ? (file: string) => only.has(file) && this.tracked(file) : this.tracked;
    const matrix = await git.statusMatrix({ ...this.repo(), filter });
    let changed = false;
    for (const [file, head, workdir, stage] of matrix) {
      if (head === 1 && workdir === 1 && stage === 1 && !(await this.differsFromHead(file))) continue;
      changed = true;
      if (workdir === 0) await git.remove({ ...this.repo(), filepath: file });
      else await git.add({ ...this.repo(), filepath: file });
    }
    if (!changed && (await this.last()) !== null) return null;
    const sha = await git.commit({ ...this.repo(), message, author: AUTHOR });
    await this.refreshHeadTime();
    return sha;
  }
```

Existing callers pass nothing, so what each commit stages is unchanged (the D0 golden test checks it). Two facts:
- `git.commit` writes the tree from the index;
- every other path's index entry still equals HEAD's, because every `add` is followed by its commit inside the same queued operation.

So a partial commit contains HEAD plus only the listed paths. An empty `only` set has an empty matrix, so `changed` stays false and there is no commit (unless the history is empty, which `commitPaths` never meets after `Start`).

(b) Extract the second loop of `restoreNow` into `writeEntry`, **exactly as plan 16 Task 5 writes it** (same name, parameters and body), and call it from `restoreNow`:

```ts
    for (const [file, entry] of target) await this.writeEntry(root, file, entry, staysInside, (dir) => inside.delete(dir), skip);
```

(Copy plan 16's `writeEntry` body: it is today's loop body with `continue` → `return false`, success → `return true`. The existing restore tests must stay green.)

(c) The two new methods:

```ts
  /**
   * Commits only `paths` (tracked ones) as they are in the folder now; every other path keeps HEAD's content (parallel
   * spec §5.2 step 4: a turn's partial commit). Null when none of them changed.
   */
  commitPaths(paths: readonly string[], message: string, trailer?: HistoryTrailer): Promise<string | null> {
    return this.serialize(() => this.saveNow(withTrailer(message, trailer), new Set(paths)));
  }

  /**
   * Brings only `paths` back to how they were at `sha` (a path absent there is removed) and commits just them (spec
   * §5.3: a crashed turn's own paths, a task's undo). The same link checks as `restore`: never through a link, never
   * outside the folder. The paths it couldn't write safely are skipped and reported.
   */
  restorePaths(paths: readonly string[], sha: string, message: string, trailer?: HistoryTrailer): Promise<RestoreResult> {
    return this.serialize(async () => {
      const wanted = new Set(paths.filter((p) => this.tracked(p)));
      const target = await this.entriesAt(sha);
      const root = await fs.promises.realpath(this.folder);
      const skipped: string[] = [];
      const skip = (file: string, why: unknown) => {
        console.error(`Restore skipped ${file}`, why);
        skipped.push(file);
      };
      for (const file of wanted) {
        const entry = target.get(file);
        if (entry) {
          await this.writeEntry(root, file, entry, (dir) => resolvesInside(root, dir), () => undefined, skip);
          continue;
        }
        const absolute = path.join(this.folder, file);
        if (!(await resolvesInside(root, path.dirname(absolute)))) {
          skip(file, "its folder leads outside the folder");
          continue;
        }
        try {
          // rm never follows a link: it removes the link itself.
          await fs.promises.rm(absolute, { force: true });
        } catch (err) {
          skip(file, err);
          continue;
        }
        await this.pruneEmptyParents(path.dirname(file));
      }
      return { sha: await this.saveNow(withTrailer(message, trailer), wanted), skipped };
    });
  }
```

- [ ] **Step 4: Run the tests.** `corepack pnpm vitest run packages/workspace/test packages/runtime/test/runtime-d0.test.ts`. Expected: PASS (the D0 golden included).

- [ ] **Step 5: Typecheck, test, commit.**

```bash
git -C <worktree> add packages/workspace/src/history.ts packages/workspace/test/history-paths.test.ts
git -C <worktree> commit -m "feat(workspace): commit and restore chosen paths only

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 5: History — dirty state, changes since a start, commits since, `Job:` and `Shared:` trailers

**Files:**
- Modify: `packages/workspace/src/history.ts`, `packages/workspace/src/subjects.ts`
- Test: `packages/workspace/test/history-dirty.test.ts`, `packages/workspace/test/history-trailers.test.ts`

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/workspace/test/history-trailers.test.ts
import { describe, expect, it } from "vitest";
import { SHARED_PREFIX, parseCommitMessage, withTrailer } from "../src";

describe("Job: and Shared: trailers (parallel spec §5.1, §5.2)", () => {
  it("D0: without job or shared, exactly as before", () => {
    expect(withTrailer("Turn: x", { task: "t1", action: "a" })).toBe("Turn: x\n\nTask: t1\nAction: a");
    expect(parseCommitMessage("Turn: x\n\nTask: t1\nAction: a")).toEqual({ subject: "Turn: x", task: "t1", action: "a" });
  });
  it("writes Job: and one Shared: line per task, at most 8, valid ids only", () => {
    const shared = ["t2", "t3", "bad id", ...Array.from({ length: 10 }, (_, i) => `x${i}`)];
    const m = withTrailer("Shared: x", { task: "t1", job: "sync-jira", shared });
    expect(m.split("\n").filter((l) => l.startsWith("Shared: ") && !l.startsWith("Shared: x"))).toHaveLength(8);
    expect(m).toContain("\nJob: sync-jira");
    expect(m).not.toContain("bad id");
    const parsed = parseCommitMessage(m);
    expect(parsed.job).toBe("sync-jira");
    expect(parsed.shared?.slice(0, 2)).toEqual(["t2", "t3"]);
  });
  it("SHARED_PREFIX is the shared commit's subject start", () => {
    expect(SHARED_PREFIX).toBe("Shared: ");
  });
});
```

```ts
// packages/workspace/test/history-dirty.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { History } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-hdirty-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
let folder: string;
let history: History;
const write = (rel: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(folder, rel)), { recursive: true });
  fs.writeFileSync(path.join(folder, rel), content);
};

beforeEach(async () => {
  const base = fs.mkdtempSync(path.join(root, "t-"));
  folder = path.join(base, "work");
  fs.mkdirSync(folder);
  history = new History(folder, path.join(base, "history.git"), [".harness/"]);
  await history.init();
  write("a.md", "a0");
  await history.save("Start");
});

describe("dirtyState and changedSince (parallel spec §5.2 step 1, Decision 3)", () => {
  it("null start: every dirty path; a start: only paths whose content moved since", async () => {
    write("b.md", "b1");
    const start = await history.dirtyState();
    expect([...start.keys()]).toEqual(["b.md"]);
    expect(await history.changedSince(null)).toEqual(["b.md"]);
    expect(await history.changedSince(start)).toEqual([]);
    write("b.md", "b2");
    write("c.md", "c1");
    fs.rmSync(path.join(folder, "a.md"));
    expect(await history.changedSince(start)).toEqual(["a.md", "b.md", "c.md"]);
  });
  it("a path another turn committed meanwhile drops out unless it changed again", async () => {
    const start = await history.dirtyState();
    write("b.md", "b1");
    await history.commitPaths(["b.md"], "Turn: other", { task: "t2" });
    expect(await history.changedSince(start)).toEqual([]);
    write("b.md", "b2");
    expect(await history.changedSince(start)).toEqual(["b.md"]);
  });
});

describe("commitsSince (parallel spec §5.3 conflicts)", () => {
  it("lists newer commits with their task and changed paths, newest first", async () => {
    const from = (await history.last())!;
    write("a.md", "a1");
    await history.save("Turn: one", { task: "t1" });
    write("b.md", "b1");
    await history.save("Turn: two", { task: "t2" });
    const since = await history.commitsSince(from);
    expect(since.map((c) => ({ task: c.task, paths: c.paths }))).toEqual([
      { task: "t2", paths: ["b.md"] },
      { task: "t1", paths: ["a.md"] },
    ]);
    expect(await history.commitsSince(since[0].sha)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to see them fail.** Expected: FAIL (`SHARED_PREFIX`, `dirtyState`, `job` missing).

- [ ] **Step 3: Implement.**

`packages/workspace/src/subjects.ts`, after `UNDO_PREFIX`:

```ts
/** A turn's paths it shares with other running tasks (parallel spec §5.2): committed right after its own; the message's start follows. */
export const SHARED_PREFIX = "Shared: ";
```

`packages/workspace/src/history.ts`:

`HistoryTrailer` gains:

```ts
  /** The job this run is (parallel spec §8); only for job runs. */
  job?: string;
  /** Other running tasks that may also have changed this commit's paths (spec §5.2); only on a shared commit. */
  shared?: string[];
```

`HistoryEntry` gains `job?: string; shared?: string[];`.

In `withTrailer`, after the plugin line:

```ts
  if (trailer.job !== undefined && TRAILER_ID.test(trailer.job)) lines.push(`Job: ${trailer.job}`);
  for (const other of (trailer.shared ?? []).filter((t) => TRAILER_ID.test(t)).slice(0, SHARED_MAX)) lines.push(`Shared: ${other}`);
```

with `const SHARED_MAX = 8;` near `TRAILER_ID`.

`TRAILER_LINE` becomes `/^(Task|Action|Scope|Phase|Plugin|Job|Shared): \S+$/`.

`parseCommitMessage` adds:

```ts
  const job = value("Job");
  const shared = [...trailers.matchAll(/^Shared: (.+)$/gm)].map((m) => m[1]).filter((t) => TRAILER_ID.test(t));
  // … in the returned object:
    ...(job ? { job } : {}),
    ...(shared.length > 0 ? { shared } : {}),
```

Update its return type to include `job?: string; shared?: string[]`. In `listWith`, copy `job` and `shared` into each entry the same way as `plugin`.

The dirty state and the commits since:

```ts
/** The tracked paths that differ from HEAD, each with its working blob id (null: deleted). */
export type DirtyState = ReadonlyMap<string, string | null>;
```

```ts
  /** The folder's dirty tracked paths now (parallel spec Decision 2: a turn that starts while another runs). */
  dirtyState(): Promise<DirtyState> {
    return this.serialize(() => this.dirtyNow());
  }

  /**
   * The tracked paths whose content moved since `start` (null: every dirty path), sorted. A path committed by another
   * turn meanwhile is clean against HEAD and drops out, unless it changed again (spec §5.2 step 1).
   */
  changedSince(start: DirtyState | null): Promise<string[]> {
    return this.serialize(async () => {
      const now = await this.dirtyNow();
      return [...now].filter(([file, oid]) => !start || !start.has(file) || start.get(file) !== oid).map(([file]) => file).sort();
    });
  }

  private async dirtyNow(): Promise<Map<string, string | null>> {
    const matrix = await git.statusMatrix({ ...this.repo(), filter: this.tracked });
    const out = new Map<string, string | null>();
    for (const [file, head, workdir, stage] of matrix) {
      if (head === 1 && workdir === 1 && stage === 1 && !(await this.differsFromHead(file))) continue;
      out.set(file, workdir === 0 ? null : await this.workOid(file));
    }
    return out;
  }

  /** The blob id of a file as it is in the folder (a link: of its target path, as git stores it). */
  private async workOid(file: string): Promise<string> {
    const absolute = path.join(this.folder, file);
    const stats = await fs.promises.lstat(absolute);
    const object = stats.isSymbolicLink() ? await fs.promises.readlink(absolute, { encoding: "buffer" }) : await fs.promises.readFile(absolute);
    return (await git.hashBlob({ object })).oid;
  }

  /** The commits after `sha` (exclusive), newest first, each with its task and the paths it changed (spec §5.3). */
  async commitsSince(sha: string | null, depth = 200): Promise<{ sha: string; task: string | null; paths: string[] }[]> {
    const cache = {};
    const out: { sha: string; task: string | null; paths: string[] }[] = [];
    for (const e of await this.listWith(depth, cache)) {
      if (e.sha === sha) break;
      out.push({ sha: e.sha, task: e.task, paths: (await this.diff(await this.parentOf(e.sha, cache), e.sha, cache)).map((c) => c.path) });
    }
    return out;
  }
```

`packages/workspace/src/index.ts` already re-exports `./history` and `./subjects`.

- [ ] **Step 4: Run the tests.** `corepack pnpm vitest run packages/workspace/test packages/runtime/test/runtime-d0.test.ts`. Expected: PASS.

- [ ] **Step 5: Typecheck, test, commit.**

```bash
git -C <worktree> add packages/workspace/src/history.ts packages/workspace/src/subjects.ts packages/workspace/test/history-dirty.test.ts packages/workspace/test/history-trailers.test.ts
git -C <worktree> commit -m "feat(workspace): dirty state, changes since a start, Job and Shared trailers

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 6: Attribution, pure

**Files:**
- Create: `packages/workspace/src/attribution.ts`
- Modify: `packages/workspace/src/index.ts`
- Test: `packages/workspace/test/attribution.test.ts`

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/workspace/test/attribution.test.ts
import { describe, expect, it } from "vitest";
import { attribute, conflictsOf } from "../src";

const set = (...p: string[]) => new Set(p);

describe("attribute (parallel spec §5.2, Decision 4, T2)", () => {
  it("no overlap: every changed path is owned", () => {
    expect(attribute({ changed: ["a", "b"], overlapped: false, ownEdits: set(), others: [] })).toEqual({ owned: ["a", "b"], shared: [], with: [], left: [] });
  });
  it("overlap: own edits owned; another running turn's edits left; the rest shared with every running turn", () => {
    const r = attribute({
      changed: ["a", "b", "c"],
      overlapped: true,
      ownEdits: set("a"),
      others: [{ task: "t2", edits: set("b") }, { task: "t3", edits: set() }],
    });
    expect(r).toEqual({ owned: ["a"], shared: ["c"], with: ["t2", "t3"], left: ["b"] });
  });
  it("a path both turns named belongs to the one ending (its conflict is reported apart)", () => {
    expect(attribute({ changed: ["a"], overlapped: true, ownEdits: set("a"), others: [{ task: "t2", edits: set("a") }] }).owned).toEqual(["a"]);
  });
  it("overlapped but every other turn already ended: nothing left to share with, all owned", () => {
    expect(attribute({ changed: ["a", "c"], overlapped: true, ownEdits: set("a"), others: [] })).toEqual({ owned: ["a", "c"], shared: [], with: [], left: [] });
  });
});

describe("conflictsOf (parallel spec §5.3)", () => {
  it("a path another task's commit changed since the turn's start", () => {
    const commits = [
      { sha: "2", task: "t2", paths: ["spec.md", "x.md"] },
      { sha: "1", task: "t1", paths: ["spec.md"] },
      { sha: "0", task: null, paths: ["y.md"] },
    ];
    expect(conflictsOf(["spec.md", "y.md", "z.md"], commits, "t1")).toEqual([{ path: "spec.md", tasks: ["t2"] }]);
    expect(conflictsOf(["spec.md"], commits, undefined)).toEqual([{ path: "spec.md", tasks: ["t2", "t1"] }]);
  });
});
```

- [ ] **Step 2: Run them to see them fail.** Expected: FAIL.

- [ ] **Step 3: Implement.**

```ts
// packages/workspace/src/attribution.ts

/** Who a turn's changed paths belong to (parallel spec §5.2). Every list is sorted. */
export interface Attribution {
  /** This turn's: committed with it, restored on its crash, undone with its task. */
  owned: string[];
  /** Nobody's edit events named them: committed with this turn in a shared commit. */
  shared: string[];
  /** The running tasks the shared paths are shared with (the `Shared:` trailers). */
  with: string[];
  /** Named only by another running turn: left uncommitted for that turn's own end. */
  left: string[];
}

/**
 * Splits the paths a turn changed. Without overlap, all are its own (D7: today's commit). With overlap: a path its own
 * edit events named is its own; a path only another still-running turn named is left for that turn; the rest is
 * shared with every still-running turn. When no other turn runs any more, there is nobody to share with: all its own.
 */
export function attribute(o: {
  changed: readonly string[];
  overlapped: boolean;
  ownEdits: ReadonlySet<string>;
  others: readonly { task: string; edits: ReadonlySet<string> }[];
}): Attribution {
  const sorted = [...o.changed].sort();
  if (!o.overlapped || o.others.length === 0) return { owned: sorted, shared: [], with: [], left: [] };
  const owned: string[] = [];
  const shared: string[] = [];
  const left: string[] = [];
  for (const p of sorted) {
    if (o.ownEdits.has(p)) owned.push(p);
    else if (o.others.some((x) => x.edits.has(p))) left.push(p);
    else shared.push(p);
  }
  const withTasks = shared.length > 0 ? [...new Set(o.others.map((x) => x.task))].sort() : [];
  return { owned, shared, with: withTasks, left };
}

/**
 * The turn's paths another task's commit changed since the turn started (spec §5.3): both tasks get a notice. `commits`
 * is `History.commitsSince(before)`; commits of `ownTask` and those outside any task don't count.
 */
export function conflictsOf(
  paths: readonly string[],
  commits: readonly { task: string | null; paths: readonly string[] }[],
  ownTask: string | undefined,
): { path: string; tasks: string[] }[] {
  const out: { path: string; tasks: string[] }[] = [];
  for (const p of [...paths].sort()) {
    const tasks = [...new Set(commits.filter((c) => c.task !== null && c.task !== ownTask && c.paths.includes(p)).map((c) => c.task as string))];
    if (tasks.length > 0) out.push({ path: p, tasks });
  }
  return out;
}
```

`packages/workspace/src/index.ts`: `export * from "./attribution";`.

- [ ] **Step 4: Run the tests.** Expected: PASS.

- [ ] **Step 5: Typecheck, test, commit.**

```bash
git -C <worktree> add packages/workspace/src/attribution.ts packages/workspace/src/index.ts packages/workspace/test/attribution.test.ts
git -C <worktree> commit -m "feat(workspace): attribute a turn's changed paths

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 7: Turn windows and the turn's commits

**Files:**
- Create: `packages/runtime/src/turn-ledger.ts`, `packages/runtime/src/turn-commit.ts`
- Test: `packages/runtime/test/turn-ledger.test.ts`, `packages/runtime/test/turn-commit.test.ts`

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/runtime/test/turn-ledger.test.ts
import { describe, expect, it } from "vitest";
import { TurnLedger } from "../src/turn-ledger";

describe("TurnLedger (parallel spec §5.2, T3)", () => {
  it("a window alone stays not overlapped; a second one marks both", () => {
    const l = new TurnLedger(["/w"]);
    const a = l.open("A", "t1");
    expect(a.alone).toBe(true);
    const b = l.open("B", "t2");
    expect(b.alone).toBe(false);
    expect(a.overlapped && b.overlapped).toBe(true);
    expect(l.close("A").map((w) => w.key)).toEqual(["B"]);
    expect(l.anyRunning()).toBe(true);
    l.close("B");
    expect(l.anyRunning()).toBe(false);
    expect(l.open("C").alone).toBe(true);
  });
  it("a key can't hold two windows", () => {
    const l = new TurnLedger(["/w"]);
    l.open("A");
    expect(() => l.open("A")).toThrow("already");
  });
  it("edits: folder-relative with forward slashes; the real path counts; outsiders and .. dropped (PT-S1)", () => {
    const l = new TurnLedger(["/w", "/private/w"]);
    const a = l.open("A");
    l.noteEdits("A", ["/w/a.md", "/private/w/sub/b.md", "rel/c.md", "/etc/passwd", "/w/../x", "/w"]);
    expect([...a.edits].sort()).toEqual(["a.md", "rel/c.md", "sub/b.md"]);
    l.noteEdits("nobody", ["/w/z.md"]);
  });
});
```

```ts
// packages/runtime/test/turn-commit.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import git from "isomorphic-git";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { History } from "@humanharness/workspace";
import { beginTurn, endTurn } from "../src/turn-commit";
import { TurnLedger } from "../src/turn-ledger";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-tcommit-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
let folder: string;
let gitdir: string;
let history: History;
let ledger: TurnLedger;
const write = (rel: string, c: string) => fs.writeFileSync(path.join(folder, rel), c);
const read = (rel: string) => fs.readFileSync(path.join(folder, rel), "utf8");
const subjects = async () => (await git.log({ fs, gitdir })).map((e) => e.commit.message.trim()).reverse();
const ok = { type: "done", ok: true } as const;
const crashed = { type: "done", ok: false, error: { code: "agent-crashed" } } as const;

beforeEach(async () => {
  const base = fs.mkdtempSync(path.join(root, "t-"));
  folder = path.join(base, "work");
  gitdir = path.join(base, "history.git");
  fs.mkdirSync(folder);
  history = new History(folder, gitdir, [".harness/"]);
  await history.init();
  write("seed.md", "s");
  await history.save("Start");
  ledger = new TurnLedger([folder, fs.realpathSync(folder)]);
});

describe("one turn alone: today's commits (D7)", () => {
  it("Before message, then Turn", async () => {
    write("person.md", "p");
    const w = await beginTurn(history, ledger, "A", { task: "t1" });
    write("a.md", "a");
    expect(await endTurn(history, ledger, w, ok, "write a", { task: "t1" })).toBeNull();
    expect(await subjects()).toEqual(["Start", "Before message\n\nTask: t1", "Turn: write a\n\nTask: t1"]);
  });
  it("a crash restores the whole folder to before, as today", async () => {
    const w = await beginTurn(history, ledger, "A", { task: "t1" });
    write("a.md", "a");
    await endTurn(history, ledger, w, crashed, "crash", { task: "t1" });
    expect(fs.existsSync(path.join(folder, "a.md"))).toBe(false);
    expect((await subjects()).at(-1)).toBe("Undo: the turn did not finish\n\nTask: t1");
  });
});

describe("two turns at once (parallel spec §5.2, T1, T2)", () => {
  it("different files: each commit holds only its own; no shared commit", async () => {
    const a = await beginTurn(history, ledger, "A", { task: "t1" });
    const b = await beginTurn(history, ledger, "B", { task: "t2" });
    write("a.md", "a");
    ledger.noteEdits("A", [path.join(folder, "a.md")]);
    write("b.md", "b");
    ledger.noteEdits("B", [path.join(folder, "b.md")]);
    const ra = await endTurn(history, ledger, a, ok, "A", { task: "t1" });
    expect(ra).toEqual({ owned: ["a.md"], shared: [], with: [], conflicts: [] });
    const rb = await endTurn(history, ledger, b, ok, "B", { task: "t2" });
    expect(rb).toEqual({ owned: ["b.md"], shared: [], with: [], conflicts: [] });
    const log = await git.log({ fs, gitdir });
    const files = async (oid: string) => {
      const out: string[] = [];
      await git.walk({ fs, gitdir, trees: [git.TREE({ ref: oid })], map: async (p, [t]) => { if (p !== "." && t && (await t.type()) === "blob") out.push(p); return undefined; } });
      return out.sort();
    };
    expect(await files(log[1].oid)).toEqual(["a.md", "seed.md"]);
    expect(await files(log[0].oid)).toEqual(["a.md", "b.md", "seed.md"]);
  });
  it("a path nobody named is shared in a second commit with Shared: trailers", async () => {
    const a = await beginTurn(history, ledger, "A", { task: "t1" });
    const b = await beginTurn(history, ledger, "B", { task: "t2" });
    write("a.md", "a");
    ledger.noteEdits("A", [path.join(folder, "a.md")]);
    write("loose.md", "?");
    const ra = await endTurn(history, ledger, a, ok, "A", { task: "t1" });
    expect(ra).toMatchObject({ owned: ["a.md"], shared: ["loose.md"], with: ["t2"] });
    expect((await subjects()).slice(-2)).toEqual(["Turn: A\n\nTask: t1", "Shared: A\n\nTask: t1\nShared: t2"]);
    await endTurn(history, ledger, b, ok, "B", { task: "t2" });
  });
  it("a crash with overlap restores only its own paths, from the queue head", async () => {
    write("both.md", "0");
    await history.save("seed both");
    const a = await beginTurn(history, ledger, "A", { task: "t1" });
    const b = await beginTurn(history, ledger, "B", { task: "t2" });
    write("a.md", "a");
    ledger.noteEdits("A", [path.join(folder, "a.md")]);
    write("b.md", "b");
    ledger.noteEdits("B", [path.join(folder, "b.md")]);
    await endTurn(history, ledger, a, crashed, "A", { task: "t1" });
    expect(fs.existsSync(path.join(folder, "a.md"))).toBe(false);
    expect(read("b.md")).toBe("b");
    expect((await subjects()).at(-1)).toBe("Undo: the turn did not finish\n\nTask: t1");
    await endTurn(history, ledger, b, ok, "B", { task: "t2" });
  });
  it("the same file: the second turn reports a conflict with the first's task", async () => {
    write("spec.md", "0");
    await history.save("seed spec");
    const a = await beginTurn(history, ledger, "A", { task: "t1" });
    const b = await beginTurn(history, ledger, "B", { task: "t2" });
    write("spec.md", "from A");
    ledger.noteEdits("A", [path.join(folder, "spec.md")]);
    await endTurn(history, ledger, a, ok, "A", { task: "t1" });
    write("spec.md", "from B");
    ledger.noteEdits("B", [path.join(folder, "spec.md")]);
    const rb = await endTurn(history, ledger, b, ok, "B", { task: "t2" });
    expect(rb?.conflicts).toEqual([{ path: "spec.md", tasks: ["t1"] }]);
    expect(read("spec.md")).toBe("from B");
  });
});
```

- [ ] **Step 2: Run them to see them fail.** Expected: FAIL (modules missing).

- [ ] **Step 3: Implement.**

```ts
// packages/runtime/src/turn-ledger.ts
import path from "node:path";
import type { DirtyState } from "@humanharness/workspace";

/** One running turn's window (parallel spec §5.2). */
export interface TurnWindow {
  readonly key: string;
  /** The task the turn belongs to (its trailer's `task`), when it has one. */
  readonly task: string | undefined;
  /** No other turn ran when it opened: it takes today's `Before message` snapshot (Decision 2). */
  readonly alone: boolean;
  /** Another turn existed at some moment of this one. */
  overlapped: boolean;
  /** The snapshot it starts from: its `Before message` commit, or the queue head. */
  before: string | null;
  /** Opened beside another turn: the dirty paths then. Null for a window that was alone (its snapshot covers them). */
  startDirty: DirtyState | null;
  /** Folder-relative paths its edit events named. */
  readonly edits: Set<string>;
}

/** The turns running in one folder now (parallel spec §5.2). Opening and closing are synchronous: no await between check and mark. */
export class TurnLedger {
  private readonly open_ = new Map<string, TurnWindow>();

  /** `roots`: the folder as given and its real path (spike PT-S1: engines may report either). */
  constructor(private readonly roots: readonly string[]) {}

  open(key: string, task?: string): TurnWindow {
    if (this.open_.has(key)) throw new Error(`A turn is already open for ${key}`);
    const alone = this.open_.size === 0;
    for (const w of this.open_.values()) w.overlapped = true;
    const w: TurnWindow = { key, task, alone, overlapped: !alone, before: null, startDirty: null, edits: new Set() };
    this.open_.set(key, w);
    return w;
  }

  /** Closes `key`'s window; returns the windows still running (they may own or share its paths). */
  close(key: string): TurnWindow[] {
    this.open_.delete(key);
    return [...this.open_.values()];
  }

  anyRunning(): boolean {
    return this.open_.size > 0;
  }

  running(): TurnWindow[] {
    return [...this.open_.values()];
  }

  /** Records the paths an edit event of `key`'s turn named; only paths inside the folder count (T3). */
  noteEdits(key: string, paths: readonly string[]): void {
    const w = this.open_.get(key);
    if (!w) return;
    for (const p of paths) {
      const rel = this.relative(p);
      if (rel !== null) w.edits.add(rel);
    }
  }

  private relative(p: string): string | null {
    for (const root of this.roots) {
      const abs = path.resolve(root, p);
      const rel = path.relative(root, abs);
      if (rel === "" || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) continue;
      return rel.split(path.sep).join("/");
    }
    return null;
  }
}
```

(A relative `p` resolves against the first root, which is the folder: `rel/c.md` stays `rel/c.md`.)

```ts
// packages/runtime/src/turn-commit.ts
import { type Attribution, BEFORE_MESSAGE, type History, type HistoryTrailer, SHARED_PREFIX, STOPPED_PREFIX, TURN_PREFIX, UNDO_PREFIX, attribute, conflictsOf } from "@humanharness/workspace";
import type { Event } from "./events";
import type { TurnLedger, TurnWindow } from "./turn-ledger";

type Done = Extract<Event, { type: "done" }>;

/** What a turn that overlapped others committed (parallel spec §5.2–5.3); null for a turn that ran alone (D7). */
export type TurnAttribution = Pick<Attribution, "owned" | "shared" | "with"> & { conflicts: { path: string; tasks: string[] }[] };

/**
 * Opens `key`'s window and its start point. Alone: today's `Before message` snapshot. Beside another turn: no snapshot
 * (Decision 2), the dirty paths and the queue head instead. The window opens before any await, so two turns that start
 * together never both think they are alone.
 */
export async function beginTurn(history: History, ledger: TurnLedger, key: string, trailer?: HistoryTrailer): Promise<TurnWindow> {
  const w = ledger.open(key, trailer?.task);
  try {
    if (w.alone) w.before = (await history.save(BEFORE_MESSAGE, trailer)) ?? (await history.last());
    else {
      w.startDirty = await history.dirtyState();
      w.before = await history.last();
    }
  } catch (err) {
    ledger.close(key);
    throw err;
  }
  return w;
}

/**
 * Commits the turn's end. A window that never overlapped: exactly today's code (Turn / Undo by whole restore / Stopped).
 * Overlapped: its own paths in one commit, the shared ones in a second (Decision 5); a crash restores only its own paths
 * from the queue head (Decision 6), never another task's.
 */
export async function endTurn(history: History, ledger: TurnLedger, w: TurnWindow, done: Done, message: string, trailer?: HistoryTrailer): Promise<TurnAttribution | null> {
  const others = ledger.close(w.key);
  const crashed = !done.ok && done.error.code === "agent-crashed";
  const subject = (done.ok ? TURN_PREFIX : STOPPED_PREFIX) + message.slice(0, 60);
  if (!w.overlapped) {
    if (done.ok) await history.save(`${TURN_PREFIX}${message.slice(0, 60)}`, trailer);
    else if (crashed && w.before) await history.restore(w.before, `${UNDO_PREFIX}the turn did not finish`, trailer);
    else await history.save(`${STOPPED_PREFIX}${message.slice(0, 60)}`, trailer);
    return null;
  }
  const changed = await history.changedSince(w.startDirty);
  const a = attribute({ changed, overlapped: true, ownEdits: w.edits, others: others.map((o) => ({ task: o.task ?? o.key, edits: o.edits })) });
  const conflicts = conflictsOf([...a.owned, ...a.shared], await history.commitsSince(w.before), trailer?.task);
  if (crashed) {
    const head = await history.last();
    if (head) await history.restorePaths(a.owned, head, `${UNDO_PREFIX}the turn did not finish`, trailer);
    if (a.shared.length > 0) console.error("Crash restore left shared paths", a.shared);
  } else {
    await history.commitPaths(a.owned, subject, trailer);
    if (a.shared.length > 0) await history.commitPaths(a.shared, `${SHARED_PREFIX}${message.slice(0, 60)}`, { ...(trailer ?? { task: w.key }), shared: a.with });
  }
  return { owned: a.owned, shared: a.shared, with: a.with, conflicts };
}
```

The two `history` calls on the D0 branch are character-for-character today's `runtime.ts` lines (`message.slice(0, 60)`, the same prefixes and trailer), and the D0 golden test pins them. In the not-overlapped branch, `w.before` is always set for a window that was alone, because it took the snapshot.

- [ ] **Step 4: Run the tests.** `corepack pnpm vitest run packages/runtime/test/turn-ledger.test.ts packages/runtime/test/turn-commit.test.ts`. Expected: PASS.

- [ ] **Step 5: Typecheck, test, commit.**

```bash
git -C <worktree> add packages/runtime/src/turn-ledger.ts packages/runtime/src/turn-commit.ts packages/runtime/test/turn-ledger.test.ts packages/runtime/test/turn-commit.test.ts
git -C <worktree> commit -m "feat(runtime): turn windows and attributed commits

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 8: `Workspace` and `SessionSlot`; `createRuntime` on top

**Files:**
- Create: `packages/runtime/src/workspace.ts`
- Modify: `packages/runtime/src/runtime.ts`, `packages/runtime/src/index.ts`
- Test: `packages/runtime/test/workspace.test.ts` (new); `runtime.test.ts` and `runtime-d0.test.ts` stay green **unchanged**

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/runtime/test/workspace.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import git from "isomorphic-git";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { getEngine } from "@humanharness/engines";
import { type ClaudeScript, claudeEditLine, claudeResultLine, claudeTextLines, fakeClaudeCommand, writeScript } from "@humanharness/fake-agent";
import { loadHarness } from "@humanharness/harness-sdk";
import type { Event } from "../src/events";
import { type HarnessWorkspace, createWorkspace } from "../src/workspace";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-ws-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/notes-harness/harness.config.ts");
let ws: HarnessWorkspace | undefined;
afterEach(async () => {
  await ws?.close();
  ws = undefined;
});

async function setup(script: ClaudeScript, extra: { data?: (r: unknown, slot: { key: string }) => Promise<unknown> } = {}) {
  const base = fs.mkdtempSync(path.join(root, "t-"));
  const folder = path.join(base, "Work");
  ws = await createWorkspace({
    harness: await loadHarness(FIXTURE),
    engine: getEngine("claude"),
    folder,
    gitdir: path.join(base, "history.git"),
    language: "en",
    command: fakeClaudeCommand(),
    env: { HH_FAKE_SCRIPT: writeScript(base, script), HH_FAKE_PROMPTS: path.join(base, "prompts.jsonl") },
    ...extra,
  });
  return { ws, folder, gitdir: path.join(base, "history.git") };
}

const turn = (slot: { send: HarnessWorkspace extends { openSlot(o: never): Promise<infer S> } ? S extends { send: infer F } ? F : never : never }, m: string) => slot;
void turn;

describe("Workspace and slots (parallel spec §4)", () => {
  it("two slots run turns at once; each slot keeps one turn at a time", async () => {
    const script: ClaudeScript = {
      steps: [claudeResultLine(true)],
      turns: [
        { match: "^one", steps: [claudeEditLine("e1", "a.md"), { write: { path: "a.md", content: "a" } }, { sleep: 400 }, ...claudeTextLines("A"), claudeResultLine(true)] },
        { match: "^two", steps: [claudeEditLine("e2", "b.md"), { write: { path: "b.md", content: "b" } }, ...claudeTextLines("B"), claudeResultLine(true)] },
      ],
    };
    const { ws, gitdir } = await setup(script);
    const a = await ws.openSlot({ key: "t1" });
    const b = await ws.openSlot({ key: "t2" });
    const ea: Event[] = [];
    const eb: Event[] = [];
    const ta = a.send("one", (e) => ea.push(e), { trailer: { task: "t1" } });
    expect(() => a.send("again", () => {})).toThrow("A turn is already running");
    const tb = b.send("two", (e) => eb.push(e), { trailer: { task: "t2" } });
    await Promise.all([ta.done, tb.done]);
    expect(ea.at(-1)).toEqual({ type: "done", ok: true });
    expect(eb.at(-1)).toEqual({ type: "done", ok: true });
    const subjects = (await git.log({ fs, gitdir })).map((e) => e.commit.message.split("\n")[0]);
    expect(subjects.filter((s) => s.startsWith("Turn: "))).toEqual(["Turn: one", "Turn: two"]);
  });

  it("cancelling one slot's turn never touches the other's (T6)", async () => {
    const script: ClaudeScript = { steps: [claudeResultLine(true)], turns: [{ match: "^slow", steps: [{ sleep: 3000 }, claudeResultLine(true)] }] };
    const { ws } = await setup(script);
    const a = await ws.openSlot({ key: "A" });
    const b = await ws.openSlot({ key: "B" });
    const ea: Event[] = [];
    const eb: Event[] = [];
    const ta = a.send("slow", (e) => ea.push(e));
    const tb = b.send("quick", (e) => eb.push(e));
    ta.cancel();
    await Promise.all([ta.done, tb.done]);
    expect(ea.at(-1)).toMatchObject({ ok: false, error: { code: "cancelled" } });
    expect(eb.at(-1)).toEqual({ type: "done", ok: true });
  });

  it("a slot's data requests carry that slot's key (Decision 9)", async () => {
    const seen: string[] = [];
    // The notes fixture has no agent collection: this asserts only that openSlot passes the ref through when there is a handler.
    const { ws } = await setup({ steps: [claudeResultLine(true)] }, { data: async (_r, slot) => (seen.push(slot.key), null) });
    await ws.openSlot({ key: "t9" });
    expect(seen).toEqual([]);
  });

  it("refreshInstructions refuses while any slot runs (Decision 12)", async () => {
    const { ws } = await setup({ steps: [{ sleep: 500 }, claudeResultLine(true)] });
    const a = await ws.openSlot({ key: "A" });
    const t = a.send("x", () => {});
    await new Promise((r) => setTimeout(r, 100));
    expect(await ws.refreshInstructions()).toBe(false);
    await t.done;
  });
});
```

(Delete the `turn` helper placeholder lines if TypeScript complains. They are only there to show the slot type, and the tests don't need them.)

The data-ref assertion is weak on the notes fixture: it has no agent collection, so no data server starts. Strengthen it: switch the setup to `../../fake-agent/fixtures/data-harness/harness.config.ts`, then use a fake-claude `mcp` step calling the `data` server's query tool (`{ mcp: { server: "data", tool: "<the data server's query tool name>", args: { collection: "<a collection of data-harness>" } } }`) and expect `seen` to equal `["t9"]`. Read `packages/blocks/src/data-server.ts` for the tool name, and the fixture's manifest for a collection.

- [ ] **Step 2: Run them to see them fail.** Expected: FAIL (`createWorkspace` missing).

- [ ] **Step 3: Implement `workspace.ts`.** Move `createRuntime`'s body here, split at the first turn.

```ts
// packages/runtime/src/workspace.ts
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { type Bridge, type Launcher, type McpServerSpec, type Rpc, dataServerSpec, devLauncher, hasAgentData, openBridge, openRpc, uiServerSpec } from "@humanharness/blocks";
import type { ModelProfile } from "@humanharness/engines";
import { type LoadedHarness, type Permissions, type PermissionsOverride, allBlocks, hasMaterial, narrowPermissions, resolveInHarness } from "@humanharness/harness-sdk";
import { materialServerSpec } from "@humanharness/material/light";
import { History, type HistoryTrailer, START, appHistoryKeep, prepareFolder, refreshInstructions, writeInstructions } from "@humanharness/workspace";
import { realpathSync } from "node:fs";
import { AcpTransport } from "./acp";
import { ClaudeCliTransport } from "./claude-cli";
import type { Event } from "./events";
import type { RunningTurn, RuntimeOptions } from "./runtime";
import { type TurnAttribution, beginTurn, endTurn } from "./turn-commit";
import { TurnLedger } from "./turn-ledger";
import { type Session, type Transport, type TransportOptions, acpFields } from "./transport";

/** Which slot a data or material request came from: decided by the socket it arrived on, never by the request (Decision 9). */
export interface SlotRef {
  key: string;
}

export interface WorkspaceOptions extends Omit<RuntimeOptions, "session" | "onSession" | "data" | "material"> {
  /** Answers the agent's data tools; `slot` is the slot whose socket the request came on. */
  data?: (request: unknown, slot: SlotRef) => Promise<unknown>;
  material?: { request: (request: unknown, slot: SlotRef) => Promise<unknown>; entry?: string };
}

export interface SlotOptions {
  /** Opaque: `"main"` for createRuntime's slot, the task id for a task (part 2), `job:<run>` for a job (part 3). */
  key: string;
  /** The engine session to continue. Default: a new one. */
  session?: Session;
  onSession?: (session: Session) => void;
  /** A job's slot (Decision 11): its `ui` server gets `HH_JOB=1`. Default: a task's, exactly today's specs. */
  kind?: "task" | "job";
  /** A job's own permissions: only ever narrower than the harness's (spec §8, T5). */
  permissions?: PermissionsOverride;
}

export interface SlotSendOptions {
  profile?: ModelProfile;
  trailer?: HistoryTrailer;
  /** After an overlapped turn's commits: what it owned, shared and collided with (spec §5.3). Not called for a turn that ran alone. */
  onAttribution?: (a: TurnAttribution) => void;
}

/** One open task's (or job run's) engine connection (spec §4). One turn at a time. */
export interface SessionSlot {
  readonly key: string;
  send(message: string, emit: (e: Event) => void, options?: SlotSendOptions): RunningTurn;
  isBusy(): boolean;
  /** Ends the engine session; the next turn starts a new one. Not while a turn runs. */
  endSession(): Promise<void>;
  /** Idle (Decision 10): closes an ACP adapter process, keeping the session id; the next turn reconnects and loads it. Claude: nothing. */
  sleep(): Promise<void>;
  /** Cancels a running turn, waits for it, and closes the transport and sockets. */
  close(): Promise<void>;
}

/** The folder shared by every slot: prepared once, one history and one ledger (spec §4 table). */
export interface HarnessWorkspace {
  history: History;
  openSlot(o: SlotOptions): Promise<SessionSlot>;
  /** A turn runs in some slot. */
  anyRunning(): boolean;
  /** Rewrites AGENTS.md when its text changed, only while no slot runs a turn (spec §10, Decision 12). */
  refreshInstructions(): Promise<boolean>;
  close(): Promise<void>;
}

function harnessMcpServers(harness: LoadedHarness, launcher: Launcher): McpServerSpec[] {
  return harness.mcp.map((rel, i) => ({
    name: i === 0 ? harness.id : `${harness.id}-${i + 1}`,
    command: launcher.command,
    args: [...launcher.args, resolveInHarness(harness, rel)],
    env: { ...launcher.env },
  }));
}

export async function createWorkspace(opts: WorkspaceOptions): Promise<HarnessWorkspace> {
  const { harness, engine, folder } = opts;
  const launcher = opts.launcher ?? devLauncher();
  const references = opts.references ?? [];
  await prepareFolder(folder, harness.folder.seed ? resolveInHarness(harness, harness.folder.seed) : undefined);
  const base = await fs.readFile(resolveInHarness(harness, harness.instructions), "utf8");
  const blocks = allBlocks(harness);
  const settings = await opts.instructionSettings?.();
  const material = opts.material && hasMaterial(harness) ? opts.material : undefined;
  const withMaterial = material ? { material: true } : {};
  const generated = await writeInstructions({ folder, base, language: opts.language, blocks, references, engine, ...(settings ? { settings } : {}), ...withMaterial });
  const history = new History(folder, opts.gitdir, [".harness/", ...generated], appHistoryKeep(material !== undefined));
  await history.init();
  await history.save(START);
  const ledger = new TurnLedger([folder, realpathSync(folder)]);
  const slots = new Map<string, SessionSlot>();
  let closing = false;
  let refreshing: Promise<boolean> = Promise.resolve(false);

  async function openSlot(o: SlotOptions): Promise<SessionSlot> {
    if (closing) throw new Error("The workspace is closing");
    if (slots.has(o.key)) throw new Error(`A slot is already open for ${o.key}`);
    const ref: SlotRef = { key: o.key };
    const session: Session = o.session ?? { id: randomUUID(), started: false };
    let emitCurrent: ((e: Event) => void) | null = null;
    const bridge: Bridge = await openBridge((m) => emitCurrent?.({ type: "block", name: m.name, data: m.data }));
    let rpc: Rpc | null = null;
    let materialRpc: Rpc | null = null;
    try {
      const data = opts.data;
      if (data && (hasAgentData(harness) || opts.extraData)) rpc = await openRpc((r) => data(r, ref));
      if (material) materialRpc = await openRpc((r) => material.request(r, ref));
    } catch (err) {
      await materialRpc?.close().catch(() => {});
      await rpc?.close().catch(() => {});
      await bridge.close().catch(() => {});
      throw err;
    }
    const permissions: Permissions = o.kind === "job" ? narrowPermissions(harness.permissions, o.permissions) : harness.permissions;
    const ui = uiServerSpec({ harnessConfig: harness.configPath, bridge, launcher, entry: opts.uiServerEntry });
    const transportOptions: TransportOptions = {
      folder,
      session,
      mcp: [
        o.kind === "job" ? { ...ui, env: { ...ui.env, HH_JOB: "1" } } : ui,
        ...(rpc ? [dataServerSpec({ harnessConfig: harness.configPath, rpc, launcher, entry: opts.dataServerEntry, ...(opts.extraData ? { extra: opts.extraData.catalogue } : {}) })] : []),
        ...(materialRpc ? [materialServerSpec({ rpc: materialRpc, launcher, mode: "person", entry: material?.entry })] : []),
        ...harnessMcpServers(harness, launcher),
      ],
      permissions,
      references: references.map((r) => r.path),
      ...acpFields(engine, permissions.edit),
      command: opts.command ?? (engine.transport.kind === "claude-cli" ? [engine.transport.binary] : engine.transport.command),
      env: opts.env,
      onModels: opts.onModels,
      onSessionStarted: (s) => {
        try {
          o.onSession?.(s);
        } catch (err) {
          console.error("Could not record the engine session", err);
        }
      },
    };
    const transport: Transport = engine.transport.kind === "claude-cli" ? new ClaudeCliTransport(transportOptions) : new AcpTransport(transportOptions);
    let busy = false;
    let current: { controller: AbortController; done: Promise<void> } | null = null;

    const slot: SessionSlot = {
      key: o.key,
      isBusy: () => busy,
      send(message, emit, options = {}) {
        if (busy) throw new Error("A turn is already running");
        busy = true;
        const controller = new AbortController();
        let doneEmitted = false;
        const emitOnce = (e: Event) => {
          if (e.type === "done") {
            if (doneEmitted) return;
            doneEmitted = true;
          }
          emit(e);
        };
        const done = (async () => {
          try {
            const w = await beginTurn(history, ledger, o.key, options.trailer);
            let final: Event | undefined;
            emitCurrent = emitOnce;
            try {
              await transport.turn(
                message,
                (e) => {
                  if (final) return;
                  if (e.type === "done") final = e;
                  else {
                    if (e.type === "activity" && e.edits) ledger.noteEdits(o.key, e.edits);
                    emitOnce(e);
                  }
                },
                controller.signal,
                options.profile,
              );
            } finally {
              emitCurrent = null;
            }
            const f = (final ?? { type: "done", ok: false, error: { code: "agent-crashed" } }) as Extract<Event, { type: "done" }>;
            const a = await endTurn(history, ledger, w, f, message, options.trailer);
            if (a && options.onAttribution) {
              try {
                options.onAttribution(a);
              } catch (err) {
                console.error("An attribution listener failed", err);
              }
            }
            emitOnce(f);
          } catch (err) {
            ledger.close(o.key);
            emitOnce({ type: "done", ok: false, error: { code: "agent-crashed", detail: err instanceof Error ? err.message : String(err) } });
          } finally {
            emitCurrent = null;
            busy = false;
          }
        })();
        current = { controller, done };
        return { cancel: () => controller.abort(), done };
      },
      async endSession() {
        if (busy) throw new Error("A turn is already running");
        busy = true;
        try {
          await transport.endSession();
        } finally {
          busy = false;
        }
      },
      async sleep() {
        if (busy || engine.transport.kind !== "acp") return;
        busy = true;
        try {
          // AcpTransport.close() keeps `o.session` ({ id, started: true }): the next turn connects and session/loads it (spike PT-S4).
          await transport.close();
        } finally {
          busy = false;
        }
      },
      async close() {
        if (current) {
          current.controller.abort();
          await current.done;
        }
        slots.delete(o.key);
        try {
          await transport.close();
        } finally {
          try {
            await bridge.close();
          } finally {
            try {
              await rpc?.close();
            } finally {
              await materialRpc?.close();
            }
          }
        }
      },
    };
    slots.set(o.key, slot);
    return slot;
  }

  return {
    history,
    openSlot,
    anyRunning: () => ledger.anyRunning(),
    refreshInstructions() {
      if (closing || ledger.anyRunning()) return Promise.resolve(false);
      const run = async () => {
        if (ledger.anyRunning()) return false;
        const now = await opts.instructionSettings?.();
        return refreshInstructions({ folder, base, language: opts.language, blocks, references, ...(now ? { settings: now } : {}), ...withMaterial });
      };
      refreshing = refreshing.catch(() => false).then(run);
      return refreshing;
    },
    async close() {
      closing = true;
      await refreshing.catch(() => {});
      const all = [...slots.values()];
      const results = await Promise.allSettled(all.map((s) => s.close()));
      const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (failed) throw failed.reason;
    },
  };
}
```

`ledger.close` inside the `catch` is a no-op when `endTurn` already closed it. Check this edge case: when `beginTurn` throws, its own `catch` already closed the window, which is also fine.

**Order matters for D0:**
- `createRuntime` used to open the bridge and the RPC sockets **before** the transport, and fail cleanly when they failed. `openSlot` keeps that order.
- `runtime.test.ts` counts closes through its `openBridge`/`openRpc` mocks. Its failure cases ("bridge close fails, rpc still closes") must keep passing. `slot.close` closes in the same order as the old `close`.

- [ ] **Step 4: `createRuntime` on top.** Replace the body of `createRuntime` in `packages/runtime/src/runtime.ts`. Keep the `RuntimeOptions`, `RunningTurn` and `HarnessRuntime` interfaces as they are, and widen `HarnessRuntime.send`'s options to `SlotSendOptions`, a superset:

```ts
export async function createRuntime(opts: RuntimeOptions): Promise<HarnessRuntime> {
  const { data, material, session, onSession, ...rest } = opts;
  const ws = await createWorkspace({
    ...rest,
    ...(data ? { data: (request: unknown) => data(request) } : {}),
    ...(material ? { material: { request: (request: unknown) => material.request(request), entry: material.entry } } : {}),
  });
  let slot: SessionSlot;
  try {
    slot = await ws.openSlot({ key: "main", ...(session ? { session } : {}), ...(onSession ? { onSession } : {}) });
  } catch (err) {
    await ws.close().catch(() => {});
    throw err;
  }
  return {
    history: ws.history,
    send: (message, emit, options) => slot.send(message, emit, options),
    endSession: () => slot.endSession(),
    refreshInstructions: () => ws.refreshInstructions(),
    close: () => ws.close(),
  };
}
```

Remove the old body and the helpers that moved (`harnessMcpServers`). Then check two edge cases:
- **The old `refreshInstructions`** ran even while a turn ran. The shell only calls it between tasks (its comment says so), so refusing during a turn changes nothing observable. If a `runtime.test.ts` case refreshes during a turn, it shows here: stop and report instead of changing the test.
- **A `send` after `close`:** the old code didn't guard it either.

`packages/runtime/src/index.ts`: add

```ts
export { createWorkspace, type HarnessWorkspace, type SessionSlot, type SlotOptions, type SlotRef, type SlotSendOptions, type WorkspaceOptions } from "./workspace";
export { TurnLedger, type TurnWindow } from "./turn-ledger";
export { beginTurn, endTurn, type TurnAttribution } from "./turn-commit";
```

- [ ] **Step 5: Run the tests.** `corepack pnpm vitest run packages/runtime/test`. Expected: PASS, with `runtime.test.ts` and `runtime-d0.test.ts` **unchanged**.

- [ ] **Step 6: Typecheck, test, build, commit.** `corepack pnpm typecheck && corepack pnpm test && corepack pnpm app:build` (the shell imports `createRuntime`).

```bash
git -C <worktree> add packages/runtime/src/workspace.ts packages/runtime/src/runtime.ts packages/runtime/src/index.ts packages/runtime/test/workspace.test.ts
git -C <worktree> commit -m "feat(runtime): split into a shared workspace and per-task session slots

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 9: Idle ACP slots, job slots, narrowed permissions

**Files:**
- Modify: `packages/runtime/src/workspace.ts` (only if a test shows a gap)
- Test: `packages/runtime/test/workspace-slots.test.ts`

- [ ] **Step 1: Write the tests.**

```ts
// packages/runtime/test/workspace-slots.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { getEngine } from "@humanharness/engines";
import { type AcpScript, type ClaudeScript, claudeResultLine, fakeAcpCommand, fakeClaudeCommand, writeScript } from "@humanharness/fake-agent";
import { loadHarness } from "@humanharness/harness-sdk";
import { createWorkspace } from "../src/workspace";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-wss-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/notes-harness/harness.config.ts");
const readLog = (f: string) => fs.readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { method?: string; params?: Record<string, unknown> });

describe("idle ACP slot (parallel spec §4, Decision 10)", () => {
  it("sleep() closes the adapter; the next turn starts a new process and loads the same session", async () => {
    const base = fs.mkdtempSync(path.join(root, "t-"));
    const log = path.join(base, "acp.jsonl");
    const script: AcpScript = { loadSession: true, turns: [[{ stop: "end_turn" }], [{ stop: "end_turn" }]] };
    const ws = await createWorkspace({
      harness: await loadHarness(FIXTURE), engine: getEngine("codex"), folder: path.join(base, "Work"), gitdir: path.join(base, "h.git"),
      language: "en", command: fakeAcpCommand(), env: { HH_FAKE_SCRIPT: writeScript(base, script), HH_FAKE_LOG: log },
    });
    try {
      const slot = await ws.openSlot({ key: "t1" });
      await slot.send("one", () => {}).done;
      await slot.sleep();
      await slot.send("two", () => {}).done;
      const methods = readLog(log).map((r) => r.method);
      expect(methods.filter((m) => m === "initialize")).toHaveLength(2);
      expect(methods).toContain("session/load");
    } finally {
      await ws.close();
    }
  });
  it("Claude: sleep() does nothing", async () => {
    const base = fs.mkdtempSync(path.join(root, "t-"));
    const ws = await createWorkspace({
      harness: await loadHarness(FIXTURE), engine: getEngine("claude"), folder: path.join(base, "Work"), gitdir: path.join(base, "h.git"),
      language: "en", command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(base, { steps: [claudeResultLine(true)] } as ClaudeScript) },
    });
    try {
      const slot = await ws.openSlot({ key: "t1" });
      await expect(slot.sleep()).resolves.toBeUndefined();
    } finally {
      await ws.close();
    }
  });
});

describe("job slots (Decision 11, T5)", () => {
  it("a job slot's ui server gets HH_JOB=1 and narrowed permissions; a task slot's specs are today's", async () => {
    const base = fs.mkdtempSync(path.join(root, "t-"));
    const args = path.join(base, "args.json");
    const ws = await createWorkspace({
      harness: { ...(await loadHarness(FIXTURE)), permissions: { edit: "folder", exec: true, web: true } },
      engine: getEngine("claude"), folder: path.join(base, "Work"), gitdir: path.join(base, "h.git"),
      language: "en", command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(base, { steps: [claudeResultLine(true)] } as ClaudeScript), HH_FAKE_ARGS: args },
    });
    const mcp = () => {
      const argv = JSON.parse(fs.readFileSync(args, "utf8")) as string[];
      return { servers: JSON.parse(argv[argv.indexOf("--mcp-config") + 1]).mcpServers as Record<string, { env: Record<string, string> }>, argv };
    };
    try {
      const task = await ws.openSlot({ key: "t1" });
      await task.send("x", () => {}).done;
      expect(mcp().servers.ui.env.HH_JOB).toBeUndefined();
      expect(mcp().argv.join(" ")).toContain("Bash");
      const job = await ws.openSlot({ key: "job:r1", kind: "job", permissions: { edit: "none", exec: false } });
      await job.send("y", () => {}).done;
      expect(mcp().servers.ui.env.HH_JOB).toBe("1");
      const disallowed = mcp().argv[mcp().argv.indexOf("--disallowedTools") + 1];
      expect(disallowed).toContain("Edit");
      expect(disallowed).toContain("Bash");
    } finally {
      await ws.close();
    }
  });
});
```

(If `HH_FAKE_ARGS` keeps only the last run, the order of the assertions above works as written. `--mcp-config` is the JSON argument `claudeArgs` builds.)

- [ ] **Step 2: Run them.** `corepack pnpm vitest run packages/runtime/test/workspace-slots.test.ts`. Expected: PASS if Task 8 is complete. If not, fix `workspace.ts` until it passes, without changing the tests. If fake-acp doesn't log `initialize`, assert on whatever its log records per connection and say so.

- [ ] **Step 3: Typecheck, test, commit.**

```bash
git -C <worktree> add packages/runtime/test/workspace-slots.test.ts packages/runtime/src/workspace.ts
git -C <worktree> commit -m "test(runtime): idle ACP slots reload their session; job slots narrow and mark the ui server

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 10: History by own commits; undo by paths (pure helpers)

**Files:**
- Modify: `packages/workspace/src/history.ts`
- Create: `packages/workspace/src/undo-paths.ts`
- Modify: `packages/workspace/src/index.ts`
- Test: `packages/workspace/test/undo-paths.test.ts`

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/workspace/test/undo-paths.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { History, laterTasksSharing, ownedPathsOf, sharedPathsOf } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-undo-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
let folder: string;
let history: History;
const write = (rel: string, c: string) => fs.writeFileSync(path.join(folder, rel), c);

beforeEach(async () => {
  const base = fs.mkdtempSync(path.join(root, "t-"));
  folder = path.join(base, "w");
  fs.mkdirSync(folder);
  history = new History(folder, path.join(base, "h.git"), [".harness/"]);
  await history.init();
  write("seed.md", "s");
  await history.save("Start");
});

describe("tasks({ ownCommits }) (parallel spec §5.3)", () => {
  it("D0: without the option, exactly as before; with it, a task's changes are its own commits'", async () => {
    write("a.md", "1");
    await history.commitPaths(["a.md"], "Turn: A", { task: "t1" });
    write("b.md", "1");
    await history.commitPaths(["b.md"], "Turn: B", { task: "t2" });
    write("a2.md", "1");
    await history.commitPaths(["a2.md"], "Turn: A2", { task: "t1" });
    const plain = await history.tasks();
    const t1Plain = plain.find((g) => g.taskId === "t1")!;
    // Today's grouping: start → end tree diff, so t2's b.md shows up under t1.
    expect(t1Plain.changes.map((c) => c.path)).toEqual(["a.md", "a2.md", "b.md"]);
    const own = await history.tasks(200, { ownCommits: true });
    expect(own.find((g) => g.taskId === "t1")!.changes.map((c) => c.path)).toEqual(["a.md", "a2.md"]);
    expect(own.find((g) => g.taskId === "t1")!.start).toBe(t1Plain.start);
  });
});

describe("owned and shared paths of a task", () => {
  it("shared commits (Shared: trailers) are told apart", async () => {
    write("a.md", "1");
    await history.commitPaths(["a.md"], "Turn: A", { task: "t1" });
    write("loose.md", "1");
    await history.commitPaths(["loose.md"], "Shared: A", { task: "t1", shared: ["t2"] });
    const g = (await history.tasks(200, { ownCommits: true })).find((x) => x.taskId === "t1")!;
    expect(await ownedPathsOf(history, g)).toEqual(["a.md"]);
    expect(await sharedPathsOf(history, g)).toEqual(["loose.md"]);
  });
});

describe("laterTasksSharing", () => {
  it("only later tasks that changed one of the same paths", () => {
    const groups = [
      { taskId: "t3", date: "2026-10-28T10:03:00Z", changes: [{ path: "x.md", kind: "modified" as const }] },
      { taskId: "t2", date: "2026-10-28T10:02:00Z", changes: [{ path: "a.md", kind: "modified" as const }] },
      { taskId: "t1", date: "2026-10-28T10:01:00Z", changes: [{ path: "a.md", kind: "added" as const }] },
    ];
    expect(laterTasksSharing(groups, "t1", "2026-10-28T10:01:00Z", ["a.md"]).map((g) => g.taskId)).toEqual(["t2"]);
  });
});
```

- [ ] **Step 2: Run them to see them fail.** Expected: FAIL.

- [ ] **Step 3: Implement.**

`History.tasks` gains an options argument. Without it the output is what it was:

```ts
  async tasks(depth = 200, opts: { ownCommits?: boolean } = {}): Promise<HistoryTask[]> {
    // … unchanged until the `changes` line:
        changes: taskId === null || opts.ownCommits ? await this.unionOfChanges(entries, cache) : await this.diff(start, end.sha, cache),
```

Update `HistoryTask.changes`' doc comment: "with `ownCommits`: the union of its own commits' changes (parallel spec §5.3)".

`HistoryEntry` already carries `shared` (Task 5).

```ts
// packages/workspace/src/undo-paths.ts
import type { FileChange, History, HistoryTask } from "./history";

/** The paths a task's own commits changed (commits without `Shared:` trailers), sorted. */
export async function ownedPathsOf(history: History, task: HistoryTask): Promise<string[]> {
  return pathsOf(history, task, false);
}

/** The paths its shared commits changed (spec §5.3: undone only after the person confirms), sorted. */
export async function sharedPathsOf(history: History, task: HistoryTask): Promise<string[]> {
  return pathsOf(history, task, true);
}

async function pathsOf(history: History, task: HistoryTask, shared: boolean): Promise<string[]> {
  const out = new Set<string>();
  for (const e of task.entries) {
    if ((e.shared !== undefined && e.shared.length > 0) !== shared) continue;
    for (const c of await history.commitChanges(e.sha)) out.add(c.path);
  }
  return [...out].sort();
}

/**
 * The tasks after `after` (an ISO date) other than `own` whose changes touch one of `paths`: what undoing `own` by
 * paths would also undo (spec §5.3 "it counts only later tasks that changed the same paths"). Newest first, as given.
 */
export function laterTasksSharing<G extends { taskId: string | null; date: string; changes: readonly Pick<FileChange, "path">[] }>(
  groups: readonly G[],
  own: string | null,
  after: string,
  paths: readonly string[],
): G[] {
  const mine = new Set(paths);
  return groups.filter((g) => g.taskId !== null && g.taskId !== own && Date.parse(g.date) > Date.parse(after) && g.changes.some((c) => mine.has(c.path)));
}
```

`History` gains a public reader for one commit's own changes:

```ts
  /** The tracked files commit `sha` changed against its parent. */
  async commitChanges(sha: string): Promise<FileChange[]> {
    const cache = {};
    return this.diff(await this.parentOf(sha, cache), sha, cache);
  }
```

`packages/workspace/src/index.ts`: `export * from "./undo-paths";`.

- [ ] **Step 4: Run the tests.** `corepack pnpm vitest run packages/workspace/test`. Expected: PASS, the old `history.test.ts` included.

- [ ] **Step 5: Typecheck, test, commit.**

```bash
git -C <worktree> add packages/workspace/src/history.ts packages/workspace/src/undo-paths.ts packages/workspace/src/index.ts packages/workspace/test/undo-paths.test.ts
git -C <worktree> commit -m "feat(workspace): a task's changes from its own commits; owned and shared paths for undo

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 11: `TurnController` runs on a slot type

The shell (part 2) hands each task's `TurnController` a slot instead of the whole runtime. Widen the type now so part 2 doesn't touch this file's logic.

**Files:**
- Modify: `packages/shell/src/main/turn-controller.ts`
- Test: `packages/shell/test/turn-controller.test.ts`

- [ ] **Step 1: Write the failing test.** Append:

```ts
it("ensureRuntime may return anything with send (a session slot, parallel spec §4)", async () => {
  const sent: string[] = [];
  const runner = {
    send: (message: string, emit: (e: Event) => void) => {
      sent.push(message);
      const done = Promise.resolve().then(() => emit({ type: "done", ok: true }));
      return { cancel: () => {}, done };
    },
  };
  const { controller } = setup({ ensureRuntime: async () => runner });
  await controller.send("hi");
  expect(sent).toEqual(["hi"]);
});
```

- [ ] **Step 2: Run it.** Expected: a **typecheck** failure (`corepack pnpm typecheck`): `ensureRuntime` wants a `HarnessRuntime`.

- [ ] **Step 3: Implement.** In `turn-controller.ts`:

```ts
/** What a turn needs from the engine side: today's runtime, or one session slot (parallel spec §4). */
export type TurnRunner = Pick<HarnessRuntime, "send">;
```

`TurnDeps.ensureRuntime: () => Promise<TurnRunner | null>`. In `run`, `let rt: TurnRunner | null;`. Nothing else changes: `run` only calls `rt.send`.

- [ ] **Step 4: Run.** `corepack pnpm typecheck && corepack pnpm vitest run packages/shell/test/turn-controller.test.ts`. Expected: PASS. `index.ts` still passes the memoised runtime, which satisfies `TurnRunner`.

- [ ] **Step 5: Test, build, commit.** `corepack pnpm test && corepack pnpm app:build`.

```bash
git -C <worktree> add packages/shell/src/main/turn-controller.ts packages/shell/test/turn-controller.test.ts
git -C <worktree> commit -m "refactor(shell): a turn runs on anything with send

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 12: D0 end to end, and the docs

**Files:**
- Modify: `packages/e2e/tests/history.spec.ts`
- Modify: `docs/architecture/history.md`, `docs/architecture/turn.md`, `docs/architecture/engines.md`

- [ ] **Step 1: Pin the demo flow's commits end to end.** Read `packages/e2e/tests/history.spec.ts`. In its main test, right after the existing assertions on the History panel, read the commit subjects and trailers from the history git dir and compare them with a literal list. The git dir is under `userData`; derive it the way `historyDir(userData, folder)` does, by importing `historyDir` from `@humanharness/shell/...` if the e2e package can, else by globbing `userData/history/*`.

```ts
import git from "isomorphic-git";
// …
const gitdir = /* the folder's history dir under s.userData */;
const subjects = (await git.log({ fs, gitdir })).map((e) => e.commit.message.trim()).reverse();
// D0 (parallel spec D7): the demo harness declares no `parallel`, so its commits are exactly today's.
expect(subjects).toEqual(PRE_PART_SUBJECTS); // the literal list from feat/plugins, pasted as a const above
```

To get the literal list, check out `feat/plugins` (the commit before Task 2) into a temporary worktree, **never this one**:

```bash
git -C <worktree> worktree add $SCRATCH/pt-d0-base feat/plugins
```

Run this e2e test there once with a `console.log(subjects)`. Paste the printed list. Then remove the temporary worktree (`git -C <worktree> worktree remove $SCRATCH/pt-d0-base`).

If that's too slow, take the list from this branch and compare it **by eye** with the subjects the `history.spec.ts` assertions already imply. Say which way you used in the commit message.

The temporary worktree needs `node_modules`. If it has none, don't install: use the second way.

- [ ] **Step 2: Run the e2e.** `corepack pnpm app:build && corepack pnpm e2e`. Expected: green, the new assertion included.

- [ ] **Step 3: Docs.**
- `history.md`, a "Parallel turns" section:
  - turn windows;
  - the alone path = today's;
  - `startDirty`;
  - ownership by edit events, shared commits (`Shared:` subject and trailers);
  - crash restore by owned paths from the head;
  - `commitPaths` / `restorePaths`;
  - `tasks({ ownCommits })`;
  - conflicts;
  - the D0 golden test.
- `turn.md`: the workspace and its slots, which parts are shared and which are per slot (spec §4 table), per-slot sockets with shared handlers, `edits` on activity events, and `forWindow`.
- `engines.md`: one transport per slot, `sleep()` for ACP, and the spike's facts (PT-S1…S5).

- [ ] **Step 4: Commit.**

```bash
git -C <worktree> add packages/e2e/tests/history.spec.ts docs/architecture/history.md docs/architecture/turn.md docs/architecture/engines.md
git -C <worktree> commit -m "test(e2e): the demo flow's commits are today's; docs for slots and attribution

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

## Self-review (done while writing)

- Spec coverage, slices 1–2:
  - §4 table: Task 8; Codex one adapter per slot: Task 8 (one transport each); idle adapters: Tasks 8–9; `endSession` per slot: Task 8.
  - §5.1 one queue: History's existing `serialize`, every new method uses it (Tasks 4–5); `Job:` trailer: Task 5.
  - §5.2: Tasks 3, 5, 6, 7.
  - §5.3:
    - crash: Task 7;
    - undo by paths and refusal: helpers in Task 10, wiring in part 2;
    - `tasks()` by own commits: Task 10;
    - conflicts: Tasks 6–7 (notices shown in part 2).
  - §5.4: the D0 golden tests (Tasks 2, 12).
- Placeholders:
  - Task 2's literal arrays and Task 12's subject list are deliberately pinned from a run. Their steps say exactly how.
  - Task 8's data-ref test names the change needed to make it strong.
- Types:
  - `TurnAttribution` is defined in Task 7 and used in Task 8;
  - `SlotRef`, `SlotOptions` and `SessionSlot` in Task 8, used by parts 2–3;
  - `DirtyState` in Task 5, used in Tasks 7–8;
  - `narrowPermissions` in Task 2, used in Task 8.
