# Scopes and Harness Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A harness can declare **scopes** (its unit of work: a topic, a project), and each scope gets its own tasks, notes, notes index, chat, action statuses and guided path. A harness can also declare **data collections** (zod schema + key, per scope or app-wide). They are kept as plain JSON under `.harness/data/`, tracked by the history, and checked on every write (permission, schema, key, harness rules). The agent reads and writes them through a `data` MCP server and gets a compact table of them in each task's first message. The harness UI uses them through `HarnessClient.data` and gets `subscribe` and `dataDiff`. A harness that declares neither works exactly as today (D2).

**Architecture:**
- **Paths.** Every path under `.harness/` comes from one helper module, `packages/workspace/src/layout.ts`, taking a *base* folder. In this plan the base is always the configured folder (spec §7.1). The shell builds the base with one function, `baseOf(c)`, which is the single place the profiles plan will change.
- **Scopes.**
  - Registry: `.harness/scopes.json` (`ScopeStore`, workspace).
  - The open scope and the per-scope action statuses live in `tasks.json`. `main` keeps its statuses in the existing `actions` field, so a migrated folder needs no rewrite.
  - `TaskManager` decides each task's scope (spec §3.3). It builds the session context: the scope's notes index, the app-wide index trimmed, then the data tables. It tags turns with `scope` (usage line, `Scope:` trailer) and `chat` (which chat file the turn writes).
  - `migrateToScopes` moves the flat notes into `notes/main/` on first start.
- **Data.**
  - `DataStore` (workspace) does no caching: every call re-reads the file, so hand edits are seen. It checks permission, schema, key, and then the harness `rules`. It writes atomically, one write at a time, and emits `DataChange`.
  - The person's writes come through IPC `hh:data`. Each one makes a `Data: <collection>` history commit tagged with the open task.
  - The agent's writes come through a new request/answer RPC socket (`openRpc`/`callRpc` in `packages/blocks/src/bridge.ts`) that the new `data` MCP server calls. They are committed by the turn's own commit.
  - `buildDataContext` renders the `context` tables. `dataDiffOf` turns a task's history diff of `.harness/data/` files into records added, changed and removed.

**Tech Stack:**
- Unchanged: TypeScript, pnpm via corepack, Electron 44 + electron-vite 5, React 19, i18next, zod 4 (`z.toJSONSchema` for tool descriptions), isomorphic-git, MCP SDK 1.32, Vitest + happy-dom, and Playwright with the fake agents.
- No new dependency.

Spec: `docs/superpowers/specs/2026-10-25-scopes-and-data-design.md` (source of truth; "§" numbers below refer to it). Related: `2026-10-25-profiles-design.md` (§7.1), `2026-10-25-harness-settings-design.md` (the reserved `settings` collection).

---

## Conventions

**Code**
- Same as plans 1–3f:
  - English everywhere (code, comments, docs);
  - packages export TS source;
  - extensionless imports;
  - tests in `packages/<name>/test/`;
  - one commit per task.
- React tests are `*.test.tsx` with `// @vitest-environment happy-dom` on the first line. Find elements by role and visible text.
- `@humanharness/ui` only imports **types** from other packages. The UI's copies of the scope and data types live in `packages/ui/src/client.ts`.
- Colours only through the existing `--hh-*` tokens.

**Commands and git**
- The worktree is `/Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data`. Implement on a new branch made from it, for example `git -C <worktree> switch -c feat/scopes-data`.
- Run every `corepack pnpm …` command from the worktree root.
- Git: always `git -C <worktree> …`, one simple command per call. Never use bare `git stash`.
- Every commit message ends with these two lines, with a blank line before them:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7
  ```
- Every task ends with `corepack pnpm typecheck` and `corepack pnpm test` green before its commit.
  - Tasks that touch the shell's main process, the preload or the UI also run `corepack pnpm app:build`.
  - Task 26 runs `corepack pnpm e2e`.

**Compliance (core spec §5), restated for this plan**
- Never read `~/.claude`, `~/.codex`, `~/.gemini` or any account, token or credential file.
- The data server, the rules and the migration touch only the person's folder (`<base>/.harness/…`) and the harness's own manifest.
- `rules` is harness code running in the main process. It gets copies of records and no file system, network or process handle (spec §7.4).

**D2 is a hard rule.** A harness with no `scopes` and no `data` must leave the folder, the prompts, `tasks.json`, `usage.jsonl`, the history trailers and the MCP config byte-for-byte as they are today. Tasks 10 and 26 hold the regression tests. Every other task keeps D2 by adding new fields only when they apply (conditional spreads), never by changing defaults.

## Decisions this plan takes where the spec leaves room

**Paths and storage**
- **One path helper, one base (§7.1).** `layout.ts` holds every path under `.harness/`: notes, chats, tasks, usage, scopes, data and data-meta. The shell calls it with `baseOf(c) = c.folder`, and the cli with its run folder. The history stays on the whole folder. The profiles plan changes `baseOf` only.
- **D2 layout.** Without `scopes`, the implicit scope is `main`, but its notes stay flat in `.harness/notes/`. Its chat stays `chats/main.jsonl` (`chatFile(base, "main")` is that file, so nothing moves). `tasks.json` gets no new key.
  - With `scopes`, notes go to `.harness/notes/<scope>/`.
  - Collections declared `scoped: true` in a harness without scopes are stored under `data/main/`.

**Scope ids**
- **Scope ids:** `^[a-z0-9][a-z0-9-]{0,63}$`.
- A slug of the title is cut to 56 characters and gets `-2`, `-3`… when it is taken. It falls back to `scope`.
- `_app` can never be a scope id (the underscore), so it is safe as the app-wide directory.
- A title is 1–120 characters, trimmed and folded to one line.

**Scope state in `tasks.json`**
- `open` holds the open scope id; it is absent when none is open.
- `scopes` holds the action statuses of every scope except `main`, including `_app`.
- `actions` stays `main`'s. A folder migrated into `main` therefore keeps its statuses with no rewrite, and D2 never sees the new keys.
- `CurrentTask.scope` is written only when the harness has scopes.

**Which scope a task runs in (§3.3)**
- With no scopes, `main`.
- An action with `scope: "none"` runs in `_app`.
- Any other action runs in the open scope. With none open it is refused (`ScopeRequired`), before the open task is closed.
- A free question runs in the open scope, or in `_app` when none is open.

**Chats, statuses and switching scope**
- **The chat follows the open scope, not the task.** The window shows one chat per open scope, plus `_app.jsonl` when none is open. An onboarding (`none`) action started while topic X is open shows in X's chat, but its note goes to `_app`.
- The status panel shows the open scope's statuses merged over `_app`'s.
- The guided path is walked with the open scope's statuses.
- **Switching scope closes the open task first** (a closing turn, like picking another action), whatever scope that task ran in. `start`/`ask` take an optional scope and switch first.
- Archiving the open scope closes it first, then archives it. A scope is never deleted (§3.4).

**Manifest checks**
- An action `scope` key in a harness without `scopes` is a schema error.
- A `scope: "none"` action in `path` is a schema error: the path is walked per scope.

**Session context and history**
- **App-wide notes in a scoped session.** `buildNotesIndex` of `_app`, at most 500 tokens, under `## App-wide notes` / `## App-wide decisions`. It is left out of `_app`'s own sessions.
- The "… N older notes in <dir>" line names the notes' own folder.
- **`Scope:` trailer.** The trailer is written only for a scoped task, with its own check (`isScopeDir`), because `TRAILER_ID` would refuse `_app`.
- `parseCommitMessage`, `HistoryEntry` and `HistoryTask` add `scope` / `scopeId` only when present. This keeps today's `toEqual` tests and D2 output unchanged.

**Usage**
- `usage.jsonl` lines carry `scope` for scoped tasks only.
- `summarizeUsage` adds `scopes`, the summed tokens per scope over every turn (close and checkpoint included), only when some line has a scope.

**Migration (§3.2)**
- It runs when the harness declares scopes, `.harness/scopes.json` is missing, and the folder has flat notes or `chats/main.jsonl`.
- It moves the flat notes into `notes/main/` and writes `scopes.json` with `{ id: "main", title: "General" }` **last**, as the done marker. A crash leaves it re-runnable.
- The chat needs no move (`main.jsonl` is `main`'s chat). Statuses need no move (`actions` is `main`'s).
- The shell then opens `main`.
- It runs at startup, after a folder change, and before `humanharness run`.

**Engine switch.** All chat files (one per scope) are archived, not only `main.jsonl`.

**Core scope picker**
- The core UI has no way for a harness to replace Home, so a scoped harness gets a minimal picker in the top bar: a select of active scopes, "No <label>", and "Add <label>".
- The work screen's chat is keyed by the open scope.
- Starting a `required` action with none open shows a notice instead of sending.
- The History panel gets a scope filter. Settings › Uso gets a "per <plural>" list.

**Order of the write checks (§4.3)**
- Permission is checked **first**, then schema, key and rules. The spec lists permission 4th, but the result is the same, and a write the agent may not make never runs harness code.
- Agent reads of `agent: "none"` collections are refused too.

**Data collections**
- **Collection names:** `^[a-z][a-z0-9_]{0,39}$`. `settings` is reserved (harness-settings spec).
- `key` is required unless `single: true`, and must be a field of the schema.
- `context` is refused on `agent: "none"` collections, and its `fields` must be fields of the schema.
- `context.tokens` is 50–4000.

**Storage format (§4.2)**
- A collection file is a JSON array sorted by key: numbers numerically, everything else by string. It is written with `JSON.stringify(…, null, 2)` plus a trailing newline, which puts one record per block.
- A `single` collection holds one object, and deleting it removes the file.
- Records are stored as the schema parsed them: zod drops unknown keys.

**Hand edits (§7.3)**
- There is no cache: every call re-reads the file.
- Reads skip records that fail the schema and report how many as `invalid`.
- Writes are refused while a file is not valid JSON or holds invalid records. The error names the file and says to fix it or go back in History.
- There is no file watcher, so `subscribe` fires for writes made through the app only.

**"Most recently changed" (§4.4).** Records carry no timestamps, so each write stamps the record's key in `.harness/data-meta/<scope>/<collection>.json`. This file is outside `DATA_PREFIX`, so it is never tracked. A record with no stamp counts as oldest.

**Queries**
- `where` takes equality on a field, or `{ in: [...] }`.
- `fields` always keeps the key.
- `limit` defaults to 50 and is capped at 200.
- `total` counts the matches before the limit.

**Where requests act**
- **Agent requests** act on the running task's scope. A scoped collection from an `_app` task is refused ("needs a scope"). In this version the agent tools take no scope argument (the spec's "by default" is left for later).
- **Person requests** act on `options.scope`, or the open scope by default (`_app` when none is open, `main` without scopes).
- App-wide collections ignore the scope.

**`rules`**
- Called as `rules(next, prev, ctx)`. A delete passes `next = null`.
- Both records are `structuredClone` copies.
- `ctx.records(name)` reads a snapshot, taken before the call, of that collection in the same scope (or `_app` for app-wide ones).
- Anything but `true` refuses: a string is the message, and a throw refuses with its message.
- A synchronous function can't be time-boxed in-process (§7.4), so a rule slower than 100 ms is logged with the collection's name and its time.

**History and data diffs**
- **Person data commits.** After each person write the history saves `Data: <collection>` with the open task's trailer (untagged when none is open). Agent writes need no commit of their own: the turn's `Turn:` commit takes them.
- Person writes are refused while turns are blocked (restore, folder move, engine change).
- **`dataDiff(taskId)`** compares each changed `.harness/data/…` file between the task's history `start` and `end`, record by record (by key, or the one record of a `single` collection). A record that only moved counts as unchanged.

**Data context (§4.4)**
- One `## Data: <collection>` Markdown table per collection with `context`, with the key column first.
- Cells longer than 120 characters are cut, line breaks become spaces, and `|` is escaped.
- Each table is cut at `context.tokens` with `… N more in <collection>: use data_query to read them.`
- Rows come in `context.order(records, { action })` order when the harness gives one, else most recently changed first.
- Scoped collections are skipped for `_app` tasks.

**The `data` MCP server**
- It starts only when the manifest declares at least one collection with `agent` other than `"none"` **and** the runtime got a data handler.
- `data_get` and `data_query` list every visible collection.
- `data_put`, `data_patch` and `data_delete` exist only when some collection is `write`, and their `collection` enum lists only those.
- Tool descriptions carry each collection's JSON schema (`z.toJSONSchema`).
- A refusal comes back as a tool error, `Refused: <reason>`.

**Fixture and demo.** The demo harness stays unchanged; the e2e test only checks D2 on it. A new fixture, `packages/fake-agent/fixtures/data-harness` (id `study`), drives the runtime, MCP server and `humanharness run` tests. It is created in Task 14 with scopes, and its data is added in Task 15.

**`humanharness run` with a scoped harness.** It runs the migration, then opens scope `run` (title "Run", created if missing) when the action is `required`, so the task has a scope.

## What in the code conflicts with the spec (and how this plan handles it)

| Conflict | Where | Handling |
|---|---|---|
| `TRAILER_ID` (`^[A-Za-z0-9]…`) refuses `_app` | `workspace/src/history.ts` | The `Scope:` trailer is validated with `isScopeDir` (Task 5) |
| `parseCommitMessage` and `HistoryEntry` are compared with `toEqual` in tests | `workspace/test/history.test.ts`, `shell/test/history-view.test.ts` | `scope` / `scopeId` are added only when present (Task 5) |
| Notes, `relativizeNoteFiles` and the notes index are flat-only; the index hard-codes `.harness/notes/` | `workspace/src/notes.ts`, `notes-index.ts` | A `prefix` parameter (validated) for notes, a walk into scope folders, and index options (Task 3) |
| `ChatLog` and the engine switch know only `chats/main.jsonl` | `shell/src/main/chat-log.ts`, `engine-switch.ts` | `ChatLog(base, engine, scope)`, `ChatLog.scopesIn`, and the switch archives every chat (Task 8) |
| The `ui` bridge is one-way (it answers only `ok`/`error`), and the data tools need answers | `blocks/src/bridge.ts` | A separate request/answer socket, `openRpc`/`callRpc` (Task 20) |
| The history's temp-file filter covers notes only, and the keep list is `[NOTES_PREFIX]` in two places (`humanharness run` goes through the runtime's) | `history.ts`, `runtime.ts`, `shell/src/main/index.ts` | Data temp files are filtered, and every keep list adds `DATA_PREFIX` (Task 17) |
| The core UI has no hook for a harness Home, so a scoped harness would have no way to pick a scope | `ui/src/HarnessApp.tsx` | A core `ScopePicker` in the top bar (Task 12) |
| A synchronous `rules` function can't be time-boxed in-process (§7.4) | — | Slow rules are logged (Task 19) |
| "Most recently changed" needs a time, and records have none | — | The `data-meta` sidecar (Task 16) |
| zod objects drop unknown keys | `harness-sdk` | Records are stored as parsed; this is written in `docs/architecture/data.md` (Task 27) |
| `NOTES_PREFIX` lives in `notes.ts`, and the scope regex would make `notes.ts` ↔ `layout.ts` import each other | `workspace/src/notes.ts` | `NOTES_PREFIX` moves to `layout.ts` (re-exported by the package index) (Task 1) |

## File Structure

```
packages/workspace/src/layout.ts           NEW. Every path under .harness/ from a base folder; scope ids; data paths    (Tasks 1, 16)
packages/workspace/src/notes.ts            prefix parameter on writeNote/readNotes/parseNote; scope folders in relativize (Task 3)
packages/workspace/src/notes-index.ts      heading / decisionsHeading / footer options; "older notes" names their folder  (Task 3)
packages/workspace/src/scopes.ts           NEW. ScopeStore (.harness/scopes.json), scopeSlug, cleanTitle                (Task 4)
packages/workspace/src/history.ts          Scope trailer; HistoryEntry.scope, HistoryTask.scopeId; data temp files;
                                           readFileAt                                                                   (Tasks 5, 17, 24)
packages/workspace/src/migrate.ts          NEW. migrateToScopes                                                         (Task 6)
packages/workspace/src/subjects.ts         DATA_CHANGE_PREFIX                                                           (Task 17)
packages/workspace/src/data.ts             NEW. DataStore, DataError, dataRequestSchema, runDataRequest; rules         (Tasks 16, 19)
packages/workspace/src/data-context.ts     NEW. buildDataContext                                                        (Task 23)
packages/workspace/src/data-diff.ts        NEW. diffCollection, dataDiffOf                                              (Task 24)
packages/workspace/src/index.ts            exports the new modules                                                      (Tasks 1, 4, 6, 16, 23, 24)
packages/harness-sdk/src/index.ts          manifest `scopes`, action `scope`, `actionScope`; manifest `data`           (Tasks 2, 15)
packages/harness-sdk/src/data.ts           NEW. collectionSchema, COLLECTION_NAME, DataRules, RulesContext            (Task 15)
packages/blocks/src/bridge.ts              openRpc, callRpc                                                             (Task 20)
packages/blocks/src/launch.ts              dataServerSpec                                                               (Task 21)
packages/blocks/src/data-server.ts         NEW. createDataServer, agentCollections, hasAgentData                        (Task 21)
packages/blocks/src/data-server-bin.ts     NEW. stdio entry                                                             (Task 21)
packages/runtime/src/runtime.ts            keep DATA_PREFIX; `data` handler → rpc + data server                         (Tasks 17, 22)
packages/shell/src/main/task-store.ts      open, scopes, CurrentTask.scope; statusesIn, withStatus, scopeOfTask        (Task 7)
packages/shell/src/main/chat-log.ts        scope parameter, ChatLog.scopesIn                                            (Task 8)
packages/shell/src/main/engine-switch.ts   archives every scope's chat                                                  (Task 8)
packages/shell/src/main/usage-log.ts       `scope` on lines; summarizeUsage().scopes                                    (Task 8)
packages/shell/src/main/turn-controller.ts TurnOptions.scope / chat; chatLog(chat); Scope trailer                       (Task 9)
packages/shell/src/main/task-manager.ts    scopes (§3.3), contextFor, switchScope, runningTask, trailerNow             (Task 10)
packages/shell/src/main/history-view.ts    scopeId passes through                                                       (Task 13)
packages/shell/src/main/index.ts           baseOf, scopes IPC, migration, data IPC + commits, agent data, dataDiff      (Tasks 11, 18, 22, 23, 24)
packages/shell/src/preload/index.ts        client.scopes, client.data, client.dataDiff                                  (Tasks 11, 18, 24)
packages/shell/electron.vite.config.ts     data-server entry                                                            (Task 22)
packages/ui/src/client.ts                  scope and data types; HarnessClient.scopes / data / dataDiff                 (Tasks 11, 18, 24)
packages/ui/src/ScopePicker.tsx            NEW. The top bar's scope picker                                              (Task 12)
packages/ui/src/HarnessApp.tsx             tracks the open scope; ChatView keyed by it                                  (Task 12)
packages/ui/src/ChatView.tsx               scopeBar, openScope, "pick a scope first"                                    (Task 12)
packages/ui/src/HistoryPanel.tsx           scope filter; Data: entries                                                  (Tasks 13, 17)
packages/ui/src/UsageTab.tsx               usage per scope                                                              (Task 13)
packages/ui/src/index.ts                   exports ScopePicker                                                          (Task 12)
packages/ui/test/fake-client.ts            scopes, data, dataDiff                                                       (Tasks 11, 18, 24)
packages/i18n/src/locales/{es,en}.json     scopes.*, history.allScopes/scopeFilter/entry.data, usage.byScope            (Tasks 12, 13, 17)
packages/fake-agent/fixtures/data-harness/ NEW. The `study` fixture (scopes, then data)                                 (Tasks 14, 15)
packages/cli/src/run.ts                    migration + run scope; agent data; data context                             (Tasks 14, 22, 23)
packages/cli/guide/new-harness.md          Phase 4 asks about scopes and data                                           (Task 25)
packages/e2e/tests/flow.spec.ts            D2 regression on the demo                                                    (Task 26)
docs/architecture/{context,manifest,history}.md, data.md (NEW)                                                          (Task 27)
```

---

## Phase 1 — Scopes (spec §6 slice 1)

### Task 1: One path helper for everything under `.harness/`

**Files:**
- Create: `packages/workspace/src/layout.ts`
- Modify: `packages/workspace/src/notes.ts` (import `NOTES_PREFIX` instead of declaring it), `packages/workspace/src/history.ts` (same import), `packages/workspace/src/index.ts`
- Test: `packages/workspace/test/layout.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/workspace/test/layout.test.ts`:

```ts
import path from "node:path";
import { describe, expect, it } from "vitest";
import { APP_SCOPE, MAIN_SCOPE, NOTES_PREFIX, chatFile, chatsDir, isScopeDir, isScopeId, notesPrefix, scopesFile, tasksFile, usageFile } from "../src";

describe("layout", () => {
  it("keeps today's places for a harness without scopes", () => {
    expect(NOTES_PREFIX).toBe(".harness/notes/");
    expect(notesPrefix(false)).toBe(".harness/notes/");
    expect(notesPrefix(false, "anything-at-all")).toBe(".harness/notes/");
    expect(chatFile("/w", MAIN_SCOPE)).toBe(path.join("/w", ".harness", "chats", "main.jsonl"));
    expect(tasksFile("/w")).toBe(path.join("/w", ".harness", "tasks.json"));
    expect(usageFile("/w")).toBe(path.join("/w", ".harness", "usage.jsonl"));
  });

  it("gives each scope its own notes folder and chat", () => {
    expect(notesPrefix(true, "fracciones")).toBe(".harness/notes/fracciones/");
    expect(notesPrefix(true, APP_SCOPE)).toBe(".harness/notes/_app/");
    expect(notesPrefix(true)).toBe(".harness/notes/main/");
    expect(chatFile("/w", "fracciones")).toBe(path.join("/w", ".harness", "chats", "fracciones.jsonl"));
    expect(chatFile("/w", APP_SCOPE)).toBe(path.join("/w", ".harness", "chats", "_app.jsonl"));
    expect(chatsDir("/w")).toBe(path.join("/w", ".harness", "chats"));
    expect(scopesFile("/w")).toBe(path.join("/w", ".harness", "scopes.json"));
  });

  it("refuses a scope that could leave its folder", () => {
    expect(() => notesPrefix(true, "../x")).toThrow(/scope/);
    expect(() => chatFile("/w", "a/b")).toThrow(/scope/);
    expect(() => chatFile("/w", "")).toThrow(/scope/);
  });

  it("tells scope ids from scope folders", () => {
    expect(isScopeId("fracciones-2")).toBe(true);
    expect(isScopeId(APP_SCOPE)).toBe(false);
    expect(isScopeId("Fracciones")).toBe(false);
    expect(isScopeId("a".repeat(65))).toBe(false);
    expect(isScopeDir(APP_SCOPE)).toBe(true);
    expect(isScopeDir("main")).toBe(true);
    expect(isScopeDir("_other")).toBe(false);
    expect(isScopeDir(3)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/workspace/test/layout.test.ts`
Expected: FAIL (`chatFile` and the others are not exported).

- [ ] **Step 3: Write `layout.ts`**

Create `packages/workspace/src/layout.ts`:

```ts
import path from "node:path";

// Every path under `<base>/.harness/` comes from here. `base` is the configured folder today; the profiles
// plan makes it the active profile's folder (scopes-and-data spec §7.1) by changing only what callers pass.

/** Where notes live, relative to the base (forward slashes, as the history and the index show it). */
export const NOTES_PREFIX = ".harness/notes/";

/** The implicit scope of a harness without scopes (spec D2), and the scope a migration moves old work into. */
export const MAIN_SCOPE = "main";
/** Where app-wide work goes (tasks outside any scope, app-wide collections). Never a scope id. */
export const APP_SCOPE = "_app";
/** A scope id: a slug of its title. */
export const SCOPE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const isScopeId = (v: unknown): v is string => typeof v === "string" && SCOPE_ID.test(v);
/** A scope id or `_app`: the name of a scope's folder or file. */
export const isScopeDir = (v: unknown): v is string => v === APP_SCOPE || isScopeId(v);

/** `scope` when it is a scope id or `_app`; throws otherwise (it names a folder). */
export function scopeDir(scope: string): string {
  if (!isScopeDir(scope)) throw new Error(`Invalid scope: "${scope}"`);
  return scope;
}

/** The notes folder of `scope`, relative to the base: flat without scopes (D2), `notes/<scope>/` with them. */
export function notesPrefix(scoped: boolean, scope: string = MAIN_SCOPE): string {
  return scoped ? `${NOTES_PREFIX}${scopeDir(scope)}/` : NOTES_PREFIX;
}

export const harnessDir = (base: string): string => path.join(base, ".harness");
export const tasksFile = (base: string): string => path.join(base, ".harness", "tasks.json");
export const usageFile = (base: string): string => path.join(base, ".harness", "usage.jsonl");
export const scopesFile = (base: string): string => path.join(base, ".harness", "scopes.json");
export const chatsDir = (base: string): string => path.join(base, ".harness", "chats");
/** One chat per scope; `main.jsonl` for `main`, which is also the chat of a harness without scopes. */
export const chatFile = (base: string, scope: string = MAIN_SCOPE): string => path.join(chatsDir(base), `${scopeDir(scope)}.jsonl`);
```

In `packages/workspace/src/notes.ts`, delete the two lines

```ts
/** Where notes live, relative to the folder (forward slashes, as the history and the index show it). */
export const NOTES_PREFIX = ".harness/notes/";
```

and add this import next to the other imports at the top of the file:

```ts
import { NOTES_PREFIX } from "./layout";
```

In `packages/workspace/src/history.ts`, replace `import { NOTES_PREFIX } from "./notes";` with `import { NOTES_PREFIX } from "./layout";`.

In `packages/workspace/src/index.ts`, add after `export * from "./notes-index";`:

```ts
export * from "./layout";
```

Check that nothing else in the workspace package imports `NOTES_PREFIX` from `./notes`:

Run: `grep -rn 'NOTES_PREFIX.*from "./notes"' packages/workspace/src`
Expected: no output.

- [ ] **Step 4: Run the test to verify it passes**

Run: `corepack pnpm vitest run packages/workspace/test/layout.test.ts packages/workspace/test/notes.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, full tests, commit**

Run: `corepack pnpm typecheck` then `corepack pnpm test`
Expected: both green. `@humanharness/workspace` still exports `NOTES_PREFIX`, now from `layout`.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/workspace/src/layout.ts packages/workspace/src/notes.ts packages/workspace/src/history.ts packages/workspace/src/index.ts packages/workspace/test/layout.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(workspace): one path helper for everything under .harness/" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 2: Manifest `scopes` and the action `scope` key

**Files:**
- Modify: `packages/harness-sdk/src/index.ts`
- Test: `packages/harness-sdk/test/harness.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/harness-sdk/test/harness.test.ts`, add `actionScope` to the import from `../src`, and add at the end of the file:

```ts
describe("scopes", () => {
  const topics = { label: { es: "tema", en: "topic" }, plural: { es: "temas", en: "topics" } };
  const action = (extra: Record<string, unknown> = {}) => ({ label: { es: "A", en: "A" }, prompt: "./a.md", cost: "light" as const, ...extra });

  it("takes a label and a plural, and an action says where it runs", () => {
    const h = defineHarness({
      ...base,
      languages: [...base.languages],
      scopes: topics,
      actions: { study: action(), onboarding: action({ scope: "none" }) },
      path: ["study"],
    });
    expect(h.scopes).toEqual(topics);
    expect(actionScope(h, "study")).toBe("required");
    expect(actionScope(h, "onboarding")).toBe("none");
  });

  it("has no scopes by default (spec D2)", () => {
    const h = defineHarness({ ...base, languages: [...base.languages], actions: { study: action() } });
    expect(h.scopes).toBeUndefined();
    expect(actionScope(h, "study")).toBeNull();
  });

  it("refuses an action scope in a harness without scopes", () => {
    expect(() => defineHarness({ ...base, languages: [...base.languages], actions: { study: action({ scope: "none" }) } })).toThrow(/declares scopes/);
  });

  it("refuses an app-wide action in the guided path", () => {
    expect(() =>
      defineHarness({ ...base, languages: [...base.languages], scopes: topics, actions: { onboarding: action({ scope: "none" }) }, path: ["onboarding"] }),
    ).toThrow(/can't be in the path/);
  });

  it("refuses an unknown action scope", () => {
    expect(() => defineHarness({ ...base, languages: [...base.languages], scopes: topics, actions: { study: action({ scope: "sometimes" }) } })).toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run packages/harness-sdk/test/harness.test.ts`
Expected: FAIL (`actionScope` is not exported; `scopes` is stripped).

- [ ] **Step 3: Implement**

In `packages/harness-sdk/src/index.ts`, after the `TIERS` block, add:

```ts
/** Where an action runs in a harness with scopes: inside the open scope, or app-wide (spec §3.3). */
export const SCOPE_MODES = ["required", "none"] as const;
export type ScopeMode = (typeof SCOPE_MODES)[number];
```

In `actionSchema`, after the `tier` field, add:

```ts
  /** Harnesses with `scopes` only: "required" (default) runs in the open scope, "none" app-wide (`_app`). */
  scope: z.enum(SCOPE_MODES).optional(),
```

In `manifestSchema`, after the `questions` field, add:

```ts
  /** The harness's unit of work (a topic, a project): what the app calls it. Absent: one implicit scope (spec D2). */
  scopes: z.object({ label: localizedText, plural: localizedText }).optional(),
```

In the `superRefine`, before `const seen = new Set<string>();`, add:

```ts
  for (const [id, a] of Object.entries(m.actions)) {
    if (a.scope !== undefined && !m.scopes) {
      ctx.addIssue({ code: "custom", path: ["actions", id, "scope"], message: "Only a harness that declares scopes can set where an action runs" });
    }
  }
```

and inside the `for (const id of m.path ?? [])` loop, after the "Unknown action in path" check, add:

```ts
    if (m.actions[id]?.scope === "none") ctx.addIssue({ code: "custom", path: ["path"], message: `"${id}" runs outside any scope: it can't be in the path` });
```

After `defineHarness`, add:

```ts
/** Where `action` runs: null when the harness has no scopes, else its `scope` ("required" when not set). */
export function actionScope(harness: Pick<Harness, "scopes" | "actions">, action: string): ScopeMode | null {
  if (!harness.scopes) return null;
  return harness.actions[action]?.scope ?? "required";
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/harness-sdk/test/harness.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, full tests, commit**

Run: `corepack pnpm typecheck` then `corepack pnpm test`
Expected: both green (`harnesses/demo/test/manifest.test.ts` doesn't compare the whole manifest).

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/harness-sdk/src/index.ts packages/harness-sdk/test/harness.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(sdk): manifest scopes and where each action runs" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 3: Notes per scope, and index options

**Files:**
- Modify: `packages/workspace/src/notes.ts`, `packages/workspace/src/notes-index.ts`
- Test: `packages/workspace/test/notes.test.ts`, `packages/workspace/test/notes-index.test.ts`

- [ ] **Step 1: Write the failing tests**

At the end of `packages/workspace/test/notes.test.ts`, add:

```ts
describe("notes per scope", () => {
  it("writes and reads a scope's notes in its own folder", async () => {
    const folder = tmp();
    expect(await writeNote(folder, "turn", note, meta, ".harness/notes/fracciones/")).toBe(".harness/notes/fracciones/turn.md");
    await writeNote(folder, "other", { ...note, title: "App-wide" }, meta, ".harness/notes/_app/");
    expect(await readNotes(folder, ".harness/notes/fracciones/")).toEqual([{ slug: "turn", path: ".harness/notes/fracciones/turn.md", ...note, ...meta }]);
    expect((await readNotes(folder, ".harness/notes/_app/")).map((n) => n.title)).toEqual(["App-wide"]);
    // The flat folder doesn't list a scope's folder.
    expect(await readNotes(folder)).toEqual([]);
    expect(parseNote("x", renderNote(note, meta), ".harness/notes/_app/")?.path).toBe(".harness/notes/_app/x.md");
  });

  it("refuses a notes folder outside .harness/notes/", async () => {
    await expect(writeNote(tmp(), "a", note, meta, ".harness/notes/../../x/")).rejects.toThrow(/notes folder/);
    await expect(writeNote(tmp(), "a", note, meta, "elsewhere/")).rejects.toThrow(/notes folder/);
    await expect(readNotes(tmp(), ".harness/notes/Bad/")).rejects.toThrow(/notes folder/);
  });

  it("rewrites the files line of the notes in every scope's folder after a move", async () => {
    const folder = tmp();
    const old = "/Users/me/Work";
    for (const dir of ["", "main/", "_app/"]) {
      fs.mkdirSync(path.join(folder, ".harness/notes", dir), { recursive: true });
      fs.writeFileSync(path.join(folder, ".harness/notes", dir, "a.md"), `---\ntitle: "A"\nfiles: ["${old}/plan.md"]\n---\n`);
    }
    fs.mkdirSync(path.join(folder, ".harness/notes/Not-a-scope"), { recursive: true });
    fs.writeFileSync(path.join(folder, ".harness/notes/Not-a-scope/a.md"), `---\ntitle: "A"\nfiles: ["${old}/plan.md"]\n---\n`);
    expect(await relativizeNoteFiles(folder, old)).toBe(3);
    expect(fs.readFileSync(path.join(folder, ".harness/notes/_app/a.md"), "utf8")).toContain('files: ["plan.md"]');
    expect(fs.readFileSync(path.join(folder, ".harness/notes/Not-a-scope/a.md"), "utf8")).toContain(`${old}/plan.md`);
  });
});
```

At the end of the `describe("buildNotesIndex", …)` block in `packages/workspace/test/notes-index.test.ts`, add:

```ts
  it("takes its own headings and footer, and names the notes' own folder", () => {
    const scoped = (i: number) => note(i, { path: `.harness/notes/_app/n${i}.md`, title: `A rather long topic title number ${i}` });
    const index = buildNotesIndex(Array.from({ length: 40 }, (_, i) => scoped(i)), {
      budgetTokens: 120,
      heading: "## App-wide notes",
      decisionsHeading: "## App-wide decisions",
      footer: null,
    });
    expect(index.startsWith("## App-wide notes\n")).toBe(true);
    expect(index).toMatch(/- … \d+ older notes in \.harness\/notes\/_app\//);
    expect(index).not.toContain("Open a note with your read tool");
    expect(buildNotesIndex([note(1)], { decisionsHeading: "## App-wide decisions", footer: null })).toBe(
      ["## What we already covered", "- Topic 1 (t1): point 1a; point 1b → .harness/notes/n1.md", "", "## App-wide decisions", "- decision 1"].join("\n"),
    );
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run packages/workspace/test/notes.test.ts packages/workspace/test/notes-index.test.ts`
Expected: FAIL (the extra parameters are ignored; the headings are fixed).

- [ ] **Step 3: Implement the notes changes**

In `packages/workspace/src/notes.ts`:

1. Change the layout import to `import { NOTES_PREFIX, isScopeDir } from "./layout";`.
2. After the `SLUG` constant, add:

```ts
/** `.harness/notes/` or `.harness/notes/<scope>/`: anything else could write outside the notes. */
function checkPrefix(prefix: string): string {
  if (prefix === NOTES_PREFIX) return prefix;
  const scope = prefix.startsWith(NOTES_PREFIX) && prefix.endsWith("/") ? prefix.slice(NOTES_PREFIX.length, -1) : "";
  if (!isScopeDir(scope)) throw new Error(`Invalid notes folder: "${prefix}"`);
  return prefix;
}
```

3. Replace the start of `writeNote` (its doc comment, signature and the `dir` line) with:

```ts
/** Writes `<prefix><slug>.md` atomically (temp file + rename). Returns its path relative to the folder. */
export async function writeNote(folder: string, slug: string, note: SavedNote, meta: NoteMeta, prefix: string = NOTES_PREFIX): Promise<string> {
  if (!SLUG.test(slug)) throw new Error(`Invalid note slug: "${slug}"`);
  const dir = path.join(folder, checkPrefix(prefix));
```

and replace its last line `` return `${NOTES_PREFIX}${slug}.md`; `` with `` return `${prefix}${slug}.md`; ``.

4. Make `relativizeNoteFiles` walk the flat folder and every scope folder under it. Replace its doc comment and its first lines, up to and including `let rewritten = 0;`, with:

```ts
/**
 * After the folder moved from `oldFolder`: `files:` entries in the notes' front matter that name the old
 * place become relative, in `.harness/notes/` and in each scope's folder under it. Nothing else in a note
 * changes (BOM and line ends included). A note that can't be read or rewritten is skipped and logged: it only
 * keeps naming the old place, which must not undo a move. Returns how many notes were rewritten.
 */
export async function relativizeNoteFiles(folder: string, oldFolder: string): Promise<number> {
  const root = path.join(folder, NOTES_PREFIX);
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const dirs = [root, ...entries.filter((e) => e.isDirectory() && isScopeDir(e.name)).map((e) => path.join(root, e.name))];
  let rewritten = 0;
  for (const dir of dirs) rewritten += await relativizeIn(dir, oldFolder);
  return rewritten;
}

async function relativizeIn(dir: string, oldFolder: string): Promise<number> {
  const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".md"));
  let rewritten = 0;
```

The rest of the old body, from `for (const name of names) {` to `return rewritten;` and its closing brace, stays as it is and becomes the body of `relativizeIn`.

The test "skips a note it can't read" makes `broken.md` a directory. `isScopeDir("broken.md")` is false, so it is still only skipped as a note.

5. `parseNote` takes the prefix:

```ts
export function parseNote(slug: string, text: string, prefix: string = NOTES_PREFIX): Note | null {
```

and its returned `path` becomes `` `${prefix}${slug}.md` ``.

6. `readNotes` takes the prefix. Replace its doc comment, signature and `dir` line with:

```ts
/** Every readable note in `prefix` (the flat notes folder by default), newest first. Sub-folders are not read. */
export async function readNotes(folder: string, prefix: string = NOTES_PREFIX): Promise<Note[]> {
  const dir = path.join(folder, checkPrefix(prefix));
```

Inside its loop, change the call to `parseNote(slug, await fs.readFile(path.join(dir, file), "utf8").catch(() => ""), prefix)`.

- [ ] **Step 4: Implement the index options**

In `packages/workspace/src/notes-index.ts`:

1. After `INDEX_BUDGET_TOKENS`, add:

```ts
export interface IndexOptions {
  budgetTokens?: number;
  /** Default "## What we already covered". */
  heading?: string;
  /** Default "## Decisions so far". */
  decisionsHeading?: string;
  /** The closing line; null leaves it out. Default "Open a note with your read tool when you need its details." */
  footer?: string | null;
}

const FOOTER = "Open a note with your read tool when you need its details.";

/** The folder a note path is in, with its trailing slash. */
const dirOf = (p: string): string => p.slice(0, p.lastIndexOf("/") + 1);
```

2. Replace `renderIndex` with:

```ts
function renderIndex(sorted: Note[], shape: Shape, o: IndexOptions): string {
  const covered = sorted.slice(0, shape.shown).map((n, i) => {
    const title =
      i === 0 && shape.titleMax !== undefined && n.title.length > shape.titleMax ? `${n.title.slice(0, shape.titleMax)}…` : n.title;
    const head = `- ${title}${n.action ? ` (${n.action})` : ""}`;
    return i < shape.summaries && n.summary.length > 0 ? `${head}: ${n.summary.join("; ")} → ${n.path}` : `${head} → ${n.path}`;
  });
  if (shape.shown < sorted.length) covered.push(`- … ${sorted.length - shape.shown} older notes in ${dirOf(sorted[shape.shown].path)}`);
  const decisions = sorted
    .slice(0, Math.min(shape.decisions, shape.shown))
    .flatMap((n) => n.decisions)
    .map((d) => `- ${d}`);
  const footer = o.footer === undefined ? FOOTER : o.footer;
  return [
    o.heading ?? "## What we already covered",
    ...covered,
    ...(decisions.length ? ["", o.decisionsHeading ?? "## Decisions so far", ...decisions] : []),
    ...(footer === null ? [] : ["", footer]),
  ].join("\n");
}
```

3. In `buildNotesIndex`, change the signature to `export function buildNotesIndex(notes: Note[], opts: IndexOptions = {}): string`. Pass `opts` as the third argument of every `renderIndex(…)` call; there are five of them.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/workspace/test/notes.test.ts packages/workspace/test/notes-index.test.ts`
Expected: PASS. The older index tests still pass, because their notes live in `.harness/notes/`.

- [ ] **Step 6: Typecheck, full tests, commit**

Run: `corepack pnpm typecheck` then `corepack pnpm test`
Expected: both green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/workspace/src/notes.ts packages/workspace/src/notes-index.ts packages/workspace/test/notes.test.ts packages/workspace/test/notes-index.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(workspace): notes per scope folder and notes index options" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 4: The scope registry

**Files:**
- Create: `packages/workspace/src/scopes.ts`
- Modify: `packages/workspace/src/index.ts`
- Test: `packages/workspace/test/scopes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/workspace/test/scopes.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ScopeStore, cleanTitle, scopeSlug } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const tmp = () => fs.mkdtempSync(path.join(root, "t-"));
const at = () => new Date("2026-10-25T10:00:00.000Z");

describe("scopeSlug", () => {
  it("slugs the title and numbers it when taken", () => {
    expect(scopeSlug("Fracciones", new Set())).toBe("fracciones");
    expect(scopeSlug("Fracciones", new Set(["fracciones"]))).toBe("fracciones-2");
    expect(scopeSlug("Fracciones", new Set(["fracciones", "fracciones-2"]))).toBe("fracciones-3");
    expect(scopeSlug("¿Qué es π?", new Set())).toBe("que-es");
    expect(scopeSlug("!!!", new Set())).toBe("scope");
    expect(scopeSlug("a".repeat(100), new Set())).toHaveLength(56);
  });

  it("keeps a title to one line of at most 120 characters", () => {
    expect(cleanTitle("  Dos\n líneas ")).toBe("Dos líneas");
    expect(() => cleanTitle("   ")).toThrow(/title/);
    expect(() => cleanTitle("x".repeat(121))).toThrow(/title/);
    expect(() => cleanTitle(3)).toThrow(/title/);
  });
});

describe("ScopeStore", () => {
  it("creates, renames and archives scopes; the id never changes", async () => {
    const store = new ScopeStore(tmp(), at);
    expect(await store.exists()).toBe(false);
    expect(await store.list()).toEqual([]);
    const a = await store.create("Fracciones");
    const b = await store.create("Fracciones");
    expect([a.id, b.id]).toEqual(["fracciones", "fracciones-2"]);
    expect(a).toEqual({ id: "fracciones", title: "Fracciones", createdAt: "2026-10-25T10:00:00.000Z", archived: false });
    expect(await store.rename("fracciones", "Fracciones y decimales")).toMatchObject({ id: "fracciones", title: "Fracciones y decimales" });
    await store.setArchived("fracciones-2", true);
    expect((await store.list()).map((s) => [s.id, s.archived])).toEqual([
      ["fracciones", false],
      ["fracciones-2", true],
    ]);
    expect(await store.exists()).toBe(true);
    await expect(store.rename("nope", "x")).rejects.toThrow(/Unknown scope/);
  });

  it("adds an entry with a given id once", async () => {
    const store = new ScopeStore(tmp(), at);
    await store.add({ id: "main", title: "General", createdAt: "c", archived: false });
    await store.add({ id: "main", title: "Other", createdAt: "c", archived: false });
    expect(await store.list()).toEqual([{ id: "main", title: "General", createdAt: "c", archived: false }]);
  });

  it("keeps creates in order when they race", async () => {
    const store = new ScopeStore(tmp(), at);
    const made = await Promise.all([store.create("X"), store.create("X"), store.create("X")]);
    expect(made.map((s) => s.id)).toEqual(["x", "x-2", "x-3"]);
  });

  it("sets a broken registry aside and skips bad entries", async () => {
    const base = tmp();
    fs.mkdirSync(path.join(base, ".harness"), { recursive: true });
    fs.writeFileSync(path.join(base, ".harness", "scopes.json"), "{not json");
    const store = new ScopeStore(base, at);
    expect(await store.list()).toEqual([]);
    expect(fs.readdirSync(path.join(base, ".harness")).some((f) => f.startsWith("scopes.json.corrupt-"))).toBe(true);
    fs.writeFileSync(
      path.join(base, ".harness", "scopes.json"),
      JSON.stringify([{ id: "ok", title: "Ok", createdAt: "c", archived: false }, { id: "../x", title: "Bad" }, { id: "_app", title: "App" }, "x"]),
    );
    expect((await store.list()).map((s) => s.id)).toEqual(["ok"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/workspace/test/scopes.test.ts`
Expected: FAIL (`ScopeStore` is not exported).

- [ ] **Step 3: Implement**

Create `packages/workspace/src/scopes.ts`:

```ts
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { isScopeId, scopesFile } from "./layout";

/** One entry of `.harness/scopes.json` (spec §3.2). The id never changes; renaming changes only the title. */
export interface ScopeEntry {
  id: string;
  title: string;
  createdAt: string;
  archived: boolean;
}

export const SCOPE_TITLE_MAX = 120;

/** The title as stored: one line, trimmed, 1–120 characters. Throws otherwise. */
export function cleanTitle(title: unknown): string {
  const t = typeof title === "string" ? title.replace(/\s*\n\s*/g, " ").trim() : "";
  if (!t || t.length > SCOPE_TITLE_MAX) throw new Error(`A scope title is 1–${SCOPE_TITLE_MAX} characters`);
  return t;
}

/** A slug of `title` (`fracciones`), numbered when `taken` holds it (`fracciones-2`); "scope" when nothing is left. */
export function scopeSlug(title: string, taken: ReadonlySet<string>): string {
  const base =
    title
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 56)
      .replace(/-+$/, "") || "scope";
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  return id;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function cleanEntry(v: unknown): ScopeEntry | null {
  if (!isObject(v) || !isScopeId(v.id) || typeof v.title !== "string" || !v.title.trim()) return null;
  return { id: v.id, title: v.title, createdAt: typeof v.createdAt === "string" ? v.createdAt : "", archived: v.archived === true };
}

/** The scope registry of a base folder. Writes are atomic and one at a time. */
export class ScopeStore {
  private readonly file: string;
  private writes: Promise<unknown> = Promise.resolve();

  constructor(
    base: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.file = scopesFile(base);
  }

  /** Whether the registry file is there (the migration's done marker). */
  exists(): Promise<boolean> {
    return fs.access(this.file).then(
      () => true,
      () => false,
    );
  }

  /** In creation order. A missing file is empty; one that isn't JSON is set aside as `scopes.json.corrupt-<time>`. */
  async list(): Promise<ScopeEntry[]> {
    let text: string;
    try {
      text = await fs.readFile(this.file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      await fs.rename(this.file, `${this.file}.corrupt-${Date.now()}`);
      return [];
    }
    const seen = new Set<string>();
    const out: ScopeEntry[] = [];
    for (const v of Array.isArray(raw) ? raw : []) {
      const e = cleanEntry(v);
      if (e && !seen.has(e.id)) {
        seen.add(e.id);
        out.push(e);
      }
    }
    return out;
  }

  create(title: unknown): Promise<ScopeEntry> {
    const clean = cleanTitle(title);
    return this.change((list) => {
      const entry: ScopeEntry = { id: scopeSlug(clean, new Set(list.map((s) => s.id))), title: clean, createdAt: this.now().toISOString(), archived: false };
      return [[...list, entry], entry];
    });
  }

  /** Adds `entry` under its own id, unless that id is registered already (the migration's `main`). */
  add(entry: ScopeEntry): Promise<ScopeEntry> {
    return this.change((list) => {
      const there = list.find((s) => s.id === entry.id);
      return there ? [list, there] : [[...list, entry], entry];
    });
  }

  rename(id: string, title: unknown): Promise<ScopeEntry> {
    const clean = cleanTitle(title);
    return this.update(id, (s) => ({ ...s, title: clean }));
  }

  setArchived(id: string, archived: boolean): Promise<ScopeEntry> {
    return this.update(id, (s) => ({ ...s, archived }));
  }

  private update(id: string, fn: (s: ScopeEntry) => ScopeEntry): Promise<ScopeEntry> {
    return this.change((list) => {
      const i = list.findIndex((s) => s.id === id);
      if (i < 0) throw new Error(`Unknown scope: "${id}"`);
      const next = fn(list[i]);
      return [list.map((s, j) => (j === i ? next : s)), next];
    });
  }

  private change<T>(fn: (list: ScopeEntry[]) => [ScopeEntry[], T]): Promise<T> {
    const run = this.writes.then(async () => {
      const [list, result] = fn(await this.list());
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(tmp, `${JSON.stringify(list, null, 2)}\n`);
        await fs.rename(tmp, this.file);
      } catch (err) {
        await fs.rm(tmp, { force: true });
        throw err;
      }
      return result;
    });
    this.writes = run.catch(() => undefined);
    return run;
  }
}
```

In `packages/workspace/src/index.ts`, add `export * from "./scopes";`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `corepack pnpm vitest run packages/workspace/test/scopes.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, full tests, commit**

Run: `corepack pnpm typecheck` then `corepack pnpm test`
Expected: both green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/workspace/src/scopes.ts packages/workspace/src/index.ts packages/workspace/test/scopes.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(workspace): the scope registry" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 5: The `Scope:` history trailer

**Files:**
- Modify: `packages/workspace/src/history.ts`
- Test: `packages/workspace/test/history.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/workspace/test/history.test.ts`, the import from `../src` already has `History`, `parseCommitMessage` and `withTrailer`. Add at the end of the file; it uses the file's own `history`, `write`, `git`, `fs` and `gitdir`, as the trailer tests do:

```ts
describe("Scope trailer", () => {
  it("writes the scope after the task and reads it back", async () => {
    write("a.md", "scoped-1");
    const sha = (await history.save("Turn: fracciones", { task: "t-9", action: "study", scope: "fracciones" }))!;
    const { commit } = await git.readCommit({ fs, gitdir, oid: sha });
    expect(commit.message.trim()).toBe("Turn: fracciones\n\nTask: t-9\nAction: study\nScope: fracciones");
    expect((await history.list())[0]).toMatchObject({ task: "t-9", action: "study", scope: "fracciones" });
    expect((await history.tasks()).find((g) => g.taskId === "t-9")?.scopeId).toBe("fracciones");
  });

  it("takes _app, drops an invalid scope, and adds no field without one", () => {
    expect(withTrailer("Note: x", { task: "t1", scope: "_app" })).toBe("Note: x\n\nTask: t1\nScope: _app");
    expect(withTrailer("Note: x", { task: "t1", scope: "Bad Scope" })).toBe("Note: x\n\nTask: t1");
    expect(parseCommitMessage("Note: x\n\nTask: t1\nScope: _app")).toEqual({ subject: "Note: x", task: "t1", action: null, scope: "_app" });
    expect(parseCommitMessage("Note: x\n\nTask: t1\nScope: ../x")).toEqual({ subject: "Note: x", task: "t1", action: null });
    expect(parseCommitMessage("Note: x\n\nTask: t1")).toEqual({ subject: "Note: x", task: "t1", action: null });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run packages/workspace/test/history.test.ts`
Expected: FAIL (no `Scope:` line).

- [ ] **Step 3: Implement**

In `packages/workspace/src/history.ts`:

1. Change the layout import to `import { NOTES_PREFIX, isScopeDir } from "./layout";`.
2. In `HistoryEntry`, after `action`, add:

```ts
  /** The task's scope (its `Scope:` trailer), only for a harness with scopes. */
  scope?: string;
```

3. In `HistoryTrailer`, after `action?: string;`, add:

```ts
  /** The task's scope, `_app` included; only for a harness with scopes (spec §3.3). */
  scope?: string;
```

4. In `HistoryTask`, after `actionId`, add:

```ts
  /** The scope the task ran in, when the harness has scopes. */
  scopeId?: string;
```

5. In `withTrailer`, after the `Action` line, add:

```ts
  // Checked on its own: `_app` is a scope folder, but not a valid TRAILER_ID.
  if (trailer.scope !== undefined && isScopeDir(trailer.scope)) lines.push(`Scope: ${trailer.scope}`);
```

6. Replace `TRAILER_LINE` and `parseCommitMessage` with:

```ts
/** A trailer line as `withTrailer` writes it. */
const TRAILER_LINE = /^(Task|Action|Scope): \S+$/;

/**
 * A commit message's subject and its trailers (null when absent or not a valid id; `scope` only when present).
 * Only a last paragraph made entirely of trailer lines counts.
 */
export function parseCommitMessage(raw: string): { subject: string; task: string | null; action: string | null; scope?: string } {
  const text = raw.replace(/\r\n/g, "\n").trim();
  const paragraphs = text.split(/\n{2,}/);
  const last = paragraphs.length > 1 ? paragraphs[paragraphs.length - 1] : "";
  const trailers = last.split("\n").every((line) => TRAILER_LINE.test(line)) ? last : "";
  const value = (key: string): string | null => {
    const m = new RegExp(`^${key}: (.+)$`, "m").exec(trailers);
    return m && TRAILER_ID.test(m[1]) ? m[1] : null;
  };
  const scope = /^Scope: (.+)$/m.exec(trailers)?.[1];
  return { subject: text.split("\n")[0], task: value("Task"), action: value("Action"), ...(isScopeDir(scope) ? { scope } : {}) };
}
```

7. In `listWith`, replace the `map` body with:

```ts
      const { subject, task, action, scope } = parseCommitMessage(e.commit.message);
      return { sha: e.oid, message: subject, date: new Date(e.commit.author.timestamp * 1000), task, action, ...(scope ? { scope } : {}) };
```

8. In `tasks()`, change the pushed object so it carries the scope only when there is one:

```ts
      const scopeId = entries.find((e) => e.scope !== undefined)?.scope;
      out.push({
        taskId,
        actionId: entries.find((e) => e.action !== null)?.action ?? null,
        ...(scopeId ? { scopeId } : {}),
        start,
        end: end.sha,
        date: end.date,
        changes: taskId === null ? await this.unionOfChanges(entries, cache) : await this.diff(start, end.sha, cache),
        entries,
      });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/workspace/test/history.test.ts packages/shell/test/history-view.test.ts`
Expected: PASS. The older `toEqual` tests are unchanged, because `scope` / `scopeId` appear only when present.

- [ ] **Step 5: Typecheck, full tests, commit**

Run: `corepack pnpm typecheck` then `corepack pnpm test`
Expected: both green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/workspace/src/history.ts packages/workspace/test/history.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(workspace): Scope trailer on history commits" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 6: The migration into `main`

**Files:**
- Create: `packages/workspace/src/migrate.ts`
- Modify: `packages/workspace/src/index.ts`
- Test: `packages/workspace/test/migrate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/workspace/test/migrate.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ScopeStore, migrateToScopes, readNotes, writeNote } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const tmp = () => fs.mkdtempSync(path.join(root, "t-"));
const at = () => new Date("2026-10-25T10:00:00.000Z");
const note = { title: "T", summary: ["s"], decisions: [], files: [], open: [] };
const meta = { date: "2026-10-20T10:00:00.000Z", engine: "claude" };
const chat = (base: string) => {
  fs.mkdirSync(path.join(base, ".harness", "chats"), { recursive: true });
  fs.writeFileSync(path.join(base, ".harness", "chats", "main.jsonl"), '{"id":"1"}\n');
};

describe("migrateToScopes", () => {
  it("moves the flat notes into main and registers main last; the chat stays main's", async () => {
    const base = tmp();
    await writeNote(base, "manifest", note, meta);
    await writeNote(base, "q-hello", note, meta);
    chat(base);
    expect(await migrateToScopes(base, at)).toBe(true);
    expect(await readNotes(base)).toEqual([]);
    expect((await readNotes(base, ".harness/notes/main/")).map((n) => n.slug).sort()).toEqual(["manifest", "q-hello"]);
    expect(fs.readFileSync(path.join(base, ".harness", "chats", "main.jsonl"), "utf8")).toBe('{"id":"1"}\n');
    expect(await new ScopeStore(base).list()).toEqual([{ id: "main", title: "General", createdAt: "2026-10-25T10:00:00.000Z", archived: false }]);
    // Done once: the registry is the marker.
    expect(await migrateToScopes(base, at)).toBe(false);
  });

  it("migrates a folder that has only a chat", async () => {
    const base = tmp();
    chat(base);
    expect(await migrateToScopes(base, at)).toBe(true);
    expect((await new ScopeStore(base).list()).map((s) => s.id)).toEqual(["main"]);
  });

  it("does nothing in a fresh folder, or one with only tasks.json", async () => {
    const base = tmp();
    expect(await migrateToScopes(base, at)).toBe(false);
    fs.mkdirSync(path.join(base, ".harness"), { recursive: true });
    fs.writeFileSync(path.join(base, ".harness", "tasks.json"), '{"version":1,"current":null,"actions":{}}');
    expect(await migrateToScopes(base, at)).toBe(false);
    expect(fs.existsSync(path.join(base, ".harness", "scopes.json"))).toBe(false);
  });

  it("finishes a migration a crash cut short", async () => {
    const base = tmp();
    await writeNote(base, "a", note, meta);
    await writeNote(base, "b", note, meta, ".harness/notes/main/");
    expect(await migrateToScopes(base, at)).toBe(true);
    expect((await readNotes(base, ".harness/notes/main/")).map((n) => n.slug).sort()).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/workspace/test/migrate.test.ts`
Expected: FAIL (`migrateToScopes` is not exported).

- [ ] **Step 3: Implement**

Create `packages/workspace/src/migrate.ts`:

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { MAIN_SCOPE, NOTES_PREFIX, chatFile } from "./layout";
import { ScopeStore } from "./scopes";

/** The title of the scope that receives a folder's earlier work. */
export const MIGRATED_TITLE = "General";

/**
 * The first start of a harness that declares scopes, in a folder used without them (spec §3.2): the flat notes
 * move into `notes/main/` and `main` is registered, so nothing is lost. The chat needs no move (`main.jsonl` is
 * `main`'s chat) and neither do the statuses (`tasks.json` `actions` are `main`'s). The registry is written last:
 * it marks the migration done, and a crash before it leaves the migration to run again. False when there was
 * nothing to do (registry already there, or no earlier notes or chat).
 */
export async function migrateToScopes(base: string, now: () => Date = () => new Date()): Promise<boolean> {
  const store = new ScopeStore(base, now);
  if (await store.exists()) return false;
  const dir = path.join(base, NOTES_PREFIX);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const flat = entries.filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => e.name);
  const hasMain = entries.some((e) => e.isDirectory() && e.name === MAIN_SCOPE);
  const hasChat = await fs.access(chatFile(base, MAIN_SCOPE)).then(
    () => true,
    () => false,
  );
  if (flat.length === 0 && !hasChat && !hasMain) return false;
  const target = path.join(dir, MAIN_SCOPE);
  await fs.mkdir(target, { recursive: true });
  for (const name of flat) await fs.rename(path.join(dir, name), path.join(target, name));
  await store.add({ id: MAIN_SCOPE, title: MIGRATED_TITLE, createdAt: now().toISOString(), archived: false });
  return true;
}
```

In `packages/workspace/src/index.ts`, add `export * from "./migrate";`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `corepack pnpm vitest run packages/workspace/test/migrate.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, full tests, commit**

Run: `corepack pnpm typecheck` then `corepack pnpm test`
Expected: both green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/workspace/src/migrate.ts packages/workspace/src/index.ts packages/workspace/test/migrate.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(workspace): migrate a folder's earlier work into the main scope" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 7: `tasks.json` keeps the open scope and each scope's statuses

**Files:**
- Modify: `packages/shell/src/main/task-store.ts`
- Test: `packages/shell/test/task-store.test.ts`

- [ ] **Step 1: Write the failing tests**

At the end of `packages/shell/test/task-store.test.ts`, add (merge the imports into the file's existing ones):

```ts
import { type TasksFile, TaskStore, emptyTasks, interrupted, scopeOfTask, statusesIn, withStatus } from "../src/main/task-store";

describe("scopes in tasks.json", () => {
  it("keeps the open scope, each scope's statuses and the task's scope; drops what is malformed", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
    fs.mkdirSync(path.join(dir, ".harness"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".harness", "tasks.json"),
      JSON.stringify({
        version: 1,
        open: "fracciones",
        current: { id: "t1", action: "study", status: "waiting", startedAt: "s", turns: 1, scope: "fracciones" },
        actions: { study: "done" },
        scopes: { fracciones: { study: "unsaved", bad: "nope" }, _app: { onboarding: "done" }, main: { x: "done" }, "../x": { y: "done" } },
      }),
    );
    const s = await new TaskStore(dir).load();
    expect(s.open).toBe("fracciones");
    expect(s.current?.scope).toBe("fracciones");
    expect(s.actions).toEqual({ study: "done" });
    expect(s.scopes).toEqual({ fracciones: { study: "unsaved" }, _app: { onboarding: "done" } });
    fs.writeFileSync(path.join(dir, ".harness", "tasks.json"), JSON.stringify({ version: 1, open: "_app", current: { id: "t1", status: "waiting", scope: "../x" }, actions: {} }));
    const bad = await new TaskStore(dir).load();
    expect(bad.open).toBeUndefined();
    expect(bad.current?.scope).toBeUndefined();
    expect(bad).not.toHaveProperty("scopes");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reads and writes a scope's statuses; main's are the old `actions`", () => {
    const s: TasksFile = { ...emptyTasks(), actions: { study: "done" } };
    expect(statusesIn(s, "main")).toEqual({ study: "done" });
    expect(statusesIn(s, "fracciones")).toEqual({});
    const t = withStatus(s, "fracciones", "study", "unsaved");
    expect(t.scopes).toEqual({ fracciones: { study: "unsaved" } });
    expect(t.actions).toEqual({ study: "done" });
    expect(withStatus(s, "main", "review", "done").actions).toEqual({ study: "done", review: "done" });
    expect(scopeOfTask({})).toBe("main");
    expect(scopeOfTask({ scope: "_app" })).toBe("_app");
  });

  it("marks an interrupted task's action in its own scope", () => {
    const s: TasksFile = { ...emptyTasks(), current: { id: "t1", action: "study", status: "waiting", startedAt: "s", turns: 1, scope: "fracciones" } };
    const after = interrupted(s);
    expect(after.current).toBeNull();
    expect(after.scopes).toEqual({ fracciones: { study: "unfinished" } });
    expect(after.actions).toEqual({});
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run packages/shell/test/task-store.test.ts`
Expected: FAIL (`statusesIn` is not exported; `open` and `scopes` are dropped).

- [ ] **Step 3: Implement**

In `packages/shell/src/main/task-store.ts`:

1. Add the import:

```ts
import { MAIN_SCOPE, isScopeDir, isScopeId, tasksFile } from "@humanharness/workspace";
```

2. In `CurrentTask`, after `resume?: boolean;`, add:

```ts
  /** The scope the task runs in (`_app` for app-wide work). Absent in a harness without scopes (spec D2). */
  scope?: string;
```

3. Replace `TasksFile` with:

```ts
/** `<folder>/.harness/tasks.json`: the current task and how each action ended. Replaces the runtime's session.json. */
export interface TasksFile {
  version: 1;
  /** The engine that ran the last task. */
  engine?: string;
  current: CurrentTask | null;
  /** How each action ended in `main`: every action of a harness without scopes (spec D2). */
  actions: Record<string, ActionStatus>;
  /** Harnesses with scopes: the open scope; absent when none is open. */
  open?: string;
  /** Harnesses with scopes: how each action ended in every scope other than `main` (`_app` included). */
  scopes?: Record<string, Record<string, ActionStatus>>;
}
```

4. In `cleanCurrent`, after the `resume` line, add:

```ts
    ...(isScopeDir(c.scope) ? { scope: c.scope } : {}),
```

5. Replace `clean` with:

```ts
function statuses(raw: unknown): Record<string, ActionStatus> {
  const out: Record<string, ActionStatus> = {};
  if (isObject(raw)) {
    for (const [id, status] of Object.entries(raw)) {
      if (typeof status === "string" && ACTION_STATUSES.includes(status)) out[id] = status as ActionStatus;
    }
  }
  return out;
}

/** Keeps what has the right shape; anything else reads as "nothing". */
function clean(raw: unknown): TasksFile {
  if (!isObject(raw) || raw.version !== 1) return emptyTasks();
  let scopes: Record<string, Record<string, ActionStatus>> | undefined;
  if (isObject(raw.scopes)) {
    scopes = {};
    for (const [id, v] of Object.entries(raw.scopes)) if (isScopeDir(id) && id !== MAIN_SCOPE) scopes[id] = statuses(v);
  }
  return {
    version: 1,
    ...(typeof raw.engine === "string" ? { engine: raw.engine } : {}),
    current: cleanCurrent(raw.current),
    actions: statuses(raw.actions),
    ...(isScopeId(raw.open) ? { open: raw.open } : {}),
    ...(scopes ? { scopes } : {}),
  };
}

/** The scope a task runs in: `main` when it has none (a harness without scopes). */
export const scopeOfTask = (c: Pick<CurrentTask, "scope">): string => c.scope ?? MAIN_SCOPE;

/** How each action ended in `scope`; `main`'s are the `actions` field. */
export function statusesIn(s: TasksFile, scope: string): Record<string, ActionStatus> {
  return scope === MAIN_SCOPE ? s.actions : (s.scopes?.[scope] ?? {});
}

/** `s` with `action` marked `status` in `scope`. */
export function withStatus(s: TasksFile, scope: string, action: string, status: ActionStatus): TasksFile {
  if (scope === MAIN_SCOPE) return { ...s, actions: { ...s.actions, [action]: status } };
  return { ...s, scopes: { ...s.scopes, [scope]: { ...statusesIn(s, scope), [action]: status } } };
}
```

6. Replace the body of `interrupted` with:

```ts
  const c = state.current;
  if (!c) return state;
  if (!c.action) return { ...state, current: null };
  const scope = scopeOfTask(c);
  const status: ActionStatus = c.noteSaved || c.checkpointNote || statusesIn(state, scope)[c.action] === "done" ? "done" : outcome;
  return { ...withStatus(state, scope, c.action, status), current: null };
```

7. In the `TaskStore` constructor, replace `this.file = path.join(folder, ".harness", "tasks.json");` with `this.file = tasksFile(folder);`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/shell/test/task-store.test.ts packages/shell/test/task-manager.test.ts`
Expected: PASS. The task manager's tests are unchanged, because a task without `scope` reads and writes `actions` as before.

- [ ] **Step 5: Typecheck, full tests, commit**

Run: `corepack pnpm typecheck` then `corepack pnpm test`
Expected: both green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/shell/src/main/task-store.ts packages/shell/test/task-store.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(shell): tasks.json keeps the open scope and each scope's statuses" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 8: One chat per scope, the engine switch archives them all, usage per scope

**Files:**
- Modify: `packages/shell/src/main/chat-log.ts`, `packages/shell/src/main/engine-switch.ts`, `packages/shell/src/main/usage-log.ts`, `packages/ui/src/client.ts` (`UsageSummary.scopes`)
- Test: `packages/shell/test/chat-log.test.ts`, `packages/shell/test/engine-switch.test.ts`, `packages/shell/test/usage-log.test.ts`

- [ ] **Step 1: Write the failing tests**

At the end of `packages/shell/test/chat-log.test.ts`, add (add any missing `fs`, `os`, `path` and `ChatLog` imports at the top):

```ts
describe("a chat per scope", () => {
  it("writes each scope's chat to its own file and lists them", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
    const entry = (id: string) => ({ id, role: "user" as const, text: id, blocks: [], activities: [], at: "t" });
    await new ChatLog(folder).append(entry("m"));
    await new ChatLog(folder, "claude", "fracciones").append(entry("f"));
    await new ChatLog(folder, undefined, "_app").append(entry("a"));
    expect((await new ChatLog(folder, undefined, "fracciones").load()).map((e) => e.id)).toEqual(["f"]);
    expect((await new ChatLog(folder).load()).map((e) => e.id)).toEqual(["m"]);
    expect(fs.existsSync(path.join(folder, ".harness", "chats", "fracciones.jsonl"))).toBe(true);
    expect(await ChatLog.scopesIn(folder)).toEqual(["_app", "fracciones", "main"]);
    expect(await new ChatLog(folder, undefined, "fracciones").archive("claude")).toMatch(/-fracciones-claude\.jsonl$/);
    expect(await ChatLog.scopesIn(folder)).toEqual(["_app", "main"]);
    expect(() => new ChatLog(folder, undefined, "../x")).toThrow(/scope/);
    fs.rmSync(folder, { recursive: true, force: true });
  });
});
```

In `packages/shell/test/engine-switch.test.ts`, add inside `describe("startNewChatIfEngineChanged", …)`:

```ts
  it("archives every scope's chat", async () => {
    const folder = await folderWith("claude", true);
    await new ChatLog(folder, undefined, "fracciones").append({ id: "2", role: "user", text: "x", blocks: [], activities: [], at: "t" });
    expect(await startNewChatIfEngineChanged(folder, "codex")).toBe("claude");
    expect(await ChatLog.scopesIn(folder)).toEqual([]);
    expect(fs.readdirSync(path.join(folder, ".harness", "chats", "archive"))).toHaveLength(2);
  });

  it("finds the previous engine in any scope's chat", async () => {
    const folder = await folderWith(null, false);
    await new ChatLog(folder, "claude", "fracciones").append({ id: "2", role: "user", text: "x", blocks: [], activities: [], at: "t" });
    expect(await startNewChatIfEngineChanged(folder, "codex")).toBe("claude");
  });
```

At the end of `packages/shell/test/usage-log.test.ts`, add (merge `summarizeUsage`, `usageRecord` and `UsageRecord` into the existing imports):

```ts
describe("usage per scope", () => {
  const usage = (tokens: number) => ({ inputTokens: tokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
  it("tags a scoped turn's line with its scope, and only then", () => {
    const entry = { id: "1", role: "assistant" as const, text: "", blocks: [], activities: [], at: "t", usage: usage(10) };
    expect(usageRecord(entry, "claude", { task: "t1", scope: "fracciones" })).toMatchObject({ task: "t1", scope: "fracciones" });
    expect(usageRecord(entry, "claude", { task: "t1" })).not.toHaveProperty("scope");
  });

  it("sums the tokens per scope, and adds nothing when no line has one", () => {
    const line = (scope: string | undefined, tokens: number, phase: "run" | "close" = "run"): UsageRecord => ({
      at: "2026-10-25T10:00:00.000Z",
      engine: "claude",
      ok: true,
      task: `t-${scope}-${tokens}`,
      phase,
      ...(scope ? { scope } : {}),
      usage: usage(tokens),
    });
    expect(summarizeUsage([line("a", 100), line("a", 50, "close"), line("b", 10), line(undefined, 7)], undefined).scopes).toEqual({ a: 150, b: 10 });
    expect(summarizeUsage([line(undefined, 7)], undefined)).not.toHaveProperty("scopes");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run packages/shell/test/chat-log.test.ts packages/shell/test/engine-switch.test.ts packages/shell/test/usage-log.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the chat log and the engine switch**

In `packages/shell/src/main/chat-log.ts`:

1. Add the import `import { MAIN_SCOPE, chatFile, chatsDir, isScopeDir } from "@humanharness/workspace";`.
2. Replace the field and constructor with:

```ts
  private readonly file: string;

  /**
   * `engine`, when given, is stamped on every appended entry (used to notice an engine switch). `scope` picks the
   * scope's chat (`chats/<scope>.jsonl`); `main`, the default, is also the chat of a harness without scopes.
   */
  constructor(
    folder: string,
    private readonly engine?: string,
    private readonly scope: string = MAIN_SCOPE,
  ) {
    this.file = chatFile(folder, scope);
  }

  /** The scopes that have a chat file in `folder` (`_app` included), sorted. */
  static async scopesIn(folder: string): Promise<string[]> {
    const names = await fs.readdir(chatsDir(folder)).catch(() => [] as string[]);
    return names
      .filter((n) => n.endsWith(".jsonl"))
      .map((n) => n.slice(0, -".jsonl".length))
      .filter((s) => isScopeDir(s))
      .sort();
  }
```

3. In `archive`, replace the `target` line with:

```ts
    const scope = this.scope === MAIN_SCOPE ? "" : `${this.scope}-`;
    const target = path.join(dir, `${stamp}-${scope}${label.replace(/[^a-z0-9-]/gi, "")}.jsonl`);
```

In `packages/shell/src/main/engine-switch.ts`, replace the body of `startNewChatIfEngineChanged`, from `const session = …` to the `return`, with:

```ts
  const session = await sessionEngine(folder);
  const chats = await ChatLog.scopesIn(folder);
  const engineInChats = async (): Promise<string | null> => {
    for (const scope of chats) {
      const other = (await new ChatLog(folder, undefined, scope).load()).find((e) => e.engine && e.engine !== engineId)?.engine;
      if (other) return other;
    }
    return null;
  };
  const previous = (session && session !== engineId ? session : null) ?? (await engineInChats());
  if (!previous || previous === engineId) return null;
  // Every scope's chat belongs to the old engine's conversations (spec §3.2: one chat per scope).
  let archived = false;
  for (const scope of chats) if (await new ChatLog(folder, undefined, scope).archive(previous)) archived = true;
  await fs.rm(sessionFile(folder), { force: true });
  // The open task can't continue on another engine; the notes stay.
  await new TaskStore(folder).forgetEngine();
  return archived ? previous : null;
```

- [ ] **Step 4: Implement usage per scope**

In `packages/shell/src/main/usage-log.ts`:

1. Add `import { usageFile } from "@humanharness/workspace";`. In the `UsageLog` constructor, replace the `path.join(…, ".harness", "usage.jsonl")` expression with `usageFile(folder)`, and drop the `path` import if nothing else uses it.
2. In `UsageMeta` and in `UsageRecord`, after `task?: string;`, add:

```ts
  /** The task's scope (`_app` included); only for a harness with scopes. */
  scope?: string;
```

3. In `metaFields`, after the `task` line, add `...(meta.scope ? { scope: meta.scope } : {}),`.
4. In `summarizeUsage`, before the `return`, add:

```ts
  // Settings › Uso per scope (spec §3.3): every turn's tokens, close and checkpoint turns included.
  const perScope = new Map<string, number>();
  for (const r of records) if (r.scope) perScope.set(r.scope, (perScope.get(r.scope) ?? 0) + (r.usage ? turnTokens(r.usage) : 0));
```

and add `...(perScope.size ? { scopes: Object.fromEntries(perScope) } : {}),` to the returned object, after `tokens`.

In `packages/ui/src/client.ts`, in `UsageSummary`, add:

```ts
  /** Harnesses with scopes: tokens used per scope id, over the whole log. */
  scopes?: Record<string, number>;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/shell/test/chat-log.test.ts packages/shell/test/engine-switch.test.ts packages/shell/test/usage-log.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, full tests, commit**

Run: `corepack pnpm typecheck` then `corepack pnpm test`
Expected: both green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/shell/src/main/chat-log.ts packages/shell/src/main/engine-switch.ts packages/shell/src/main/usage-log.ts packages/ui/src/client.ts packages/shell/test/chat-log.test.ts packages/shell/test/engine-switch.test.ts packages/shell/test/usage-log.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(shell): a chat per scope, usage per scope; the engine switch archives every chat" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 9: Turns carry their scope and their chat

**Files:**
- Modify: `packages/shell/src/main/turn-controller.ts`
- Test: `packages/shell/test/turn-scope.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shell/test/turn-scope.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Event, HarnessRuntime } from "@humanharness/runtime";
import type { ChatEntry } from "@humanharness/ui";
import { TurnController } from "../src/main/turn-controller";
import type { UsageMeta } from "../src/main/usage-log";

/** A controller over a runtime whose turns end at once. */
function setup() {
  const chats: (string | undefined)[] = [];
  const metas: UsageMeta[] = [];
  const sends: unknown[] = [];
  const runtime = {
    send: (_m: string, emit: (e: Event) => void, options?: unknown) => {
      sends.push(options);
      emit({ type: "done", ok: true });
      return { cancel: () => {}, done: Promise.resolve() };
    },
    history: {},
    close: async () => {},
  } as unknown as HarnessRuntime;
  const controller = new TurnController({
    ensureRuntime: async () => runtime,
    chatLog: async (chat) => {
      chats.push(chat);
      return { append: async (_e: ChatEntry) => {} };
    },
    stateBlocks: () => new Set(),
    emit: () => {},
    recordUsage: async (_entry, meta) => void metas.push(meta),
  });
  return { controller, chats, metas, sends };
}

describe("turns in a scope", () => {
  it("write the open scope's chat, and tag usage and history with the task's scope", async () => {
    const t = setup();
    await t.controller.send("hi", { task: "t1", action: "onboarding", scope: "_app", chat: "fracciones" });
    expect(t.chats).toEqual(["fracciones"]);
    expect(t.metas[0]).toMatchObject({ task: "t1", action: "onboarding", scope: "_app" });
    expect(t.sends[0]).toEqual({ trailer: { task: "t1", action: "onboarding", scope: "_app" } });
  });

  it("keep today's chat, usage and trailer without a scope (spec D2)", async () => {
    const t = setup();
    await t.controller.send("hi", { task: "t1" });
    expect(t.chats).toEqual([undefined]);
    expect(t.metas[0]).not.toHaveProperty("scope");
    expect(t.sends[0]).toEqual({ trailer: { task: "t1" } });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/shell/test/turn-scope.test.ts`
Expected: FAIL (TypeScript-wise `scope`/`chat` are unknown options; at runtime the chat argument is `undefined` and no scope is tagged).

- [ ] **Step 3: Implement**

In `packages/shell/src/main/turn-controller.ts`:

1. In `TurnOptions`, after `task?: string;`, add:

```ts
  /** The task's scope (`_app` included), for usage.jsonl and the history trailer. Harnesses with scopes only. */
  scope?: string;
  /** Which scope's chat the turn writes (the open scope's). Absent: `main`, the only chat without scopes. */
  chat?: string;
```

2. In `TurnDeps`, replace the `chatLog` line with:

```ts
  /** The chat log of the configured folder (`chat`: the scope whose chat it is; absent: `main`), or null when the app isn't configured yet. */
  chatLog: (chat?: string) => Promise<ChatLogLike | null>;
```

3. In `run`, add `scope, chat` to the destructured options, and change `const log = await this.deps.chatLog();` to `const log = await this.deps.chatLog(chat);`.
4. In `meta()`, after the `task` line, add `...(scope ? { scope } : {}),`.
5. In the `rt.send(…)` options, replace `...(task ? { trailer: { task, ...(action ? { action } : {}) } } : {})` with:

```ts
...(task ? { trailer: { task, ...(action ? { action } : {}), ...(scope ? { scope } : {}) } } : {})
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `corepack pnpm vitest run packages/shell/test/turn-scope.test.ts packages/shell/test/turn-controller.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, full tests, commit**

Run: `corepack pnpm typecheck` then `corepack pnpm test`
Expected: both green. `chatLog: async () => …` in `main/index.ts` and `cli/src/run.ts` still matches the type, and ignores the argument until Tasks 11 and 14.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/shell/src/main/turn-controller.ts packages/shell/test/turn-scope.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(shell): turns carry their scope and their chat" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 10: The task manager runs tasks in scopes

**Files:**
- Modify: `packages/shell/src/main/task-manager.ts`, `packages/ui/src/client.ts` (`TaskView.scope`, `CurrentTaskView.scope`)
- Test: `packages/shell/test/task-manager-scopes.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/shell/test/task-manager-scopes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { SavedNote } from "@humanharness/harness-sdk";
import type { Event } from "@humanharness/runtime";
import { type Note, type NoteMeta, buildNotesIndex } from "@humanharness/workspace";
import { ScopeRequired, TaskManager } from "../src/main/task-manager";
import { type TasksFile, emptyTasks } from "../src/main/task-store";
import type { TurnOptions } from "../src/main/turn-controller";

const label = (en: string) => ({ es: en, en });
const saved: SavedNote = { title: "Fractions", summary: ["halves"], decisions: ["use pizzas"], files: [], open: [] };
const ok: Event = { type: "done", ok: true };
const saveNote: Event = { type: "block", name: "save_note", data: saved };
const note = (slug: string, dir: string): Note => ({
  slug,
  path: `.harness/notes/${dir}${slug}.md`,
  title: `Note ${slug}`,
  date: "2026-10-20T10:00:00.000Z",
  engine: "claude",
  summary: [`about ${slug}`],
  decisions: [`decided ${slug}`],
  files: [],
  open: [],
});

/** A task manager over memory for a harness with scopes (or without, `scoped: false`). Notes are kept per scope; "flat" is the folder without scopes. */
function setup(opts: { scoped?: boolean; state?: TasksFile; notes?: Record<string, Note[]>; script?: Event[][]; data?: (scope: string, action?: string) => string } = {}) {
  let state = opts.state ?? emptyTasks();
  const notes: Record<string, Note[]> = structuredClone(opts.notes ?? {});
  const script = [...(opts.script ?? [])];
  const turns: { message: string; options: TurnOptions }[] = [];
  const written: { slug: string; scope?: string; args: number }[] = [];
  const trailers: unknown[] = [];
  let busy = false;
  let n = 0;
  const manager = new TaskManager({
    store: { load: async () => structuredClone(state), save: async (s) => void (state = structuredClone(s)) },
    turns: {
      isBusy: () => busy,
      cancel: () => {},
      send: async (message, options) => {
        busy = true;
        turns.push({ message, options });
        for (const e of script.shift() ?? [ok]) options.onEvent?.(e);
        busy = false;
      },
    },
    actions: { study: { label: label("Study") }, review: { label: label("Review") }, onboarding: { label: label("Welcome"), scope: "none" } },
    path: ["study", "review"],
    scoped: opts.scoped ?? true,
    scopeExists: async (id) => ["fracciones", "decimales"].includes(id),
    readPrompt: async (action) => `# Task: ${action}\n\n{{notesIndex}}`,
    language: async () => "en",
    engine: async () => "claude",
    notes: async (scope?: string) => [...(notes[scope ?? "flat"] ?? [])],
    writeNote: async (...args: [string, SavedNote, NoteMeta, string?]) => {
      const [slug, note, meta, scope] = args;
      written.push({ slug, ...(scope ? { scope } : {}), args: args.length });
      (notes[scope ?? "flat"] ??= []).unshift({ slug, path: `.harness/notes/${scope ? `${scope}/` : ""}${slug}.md`, ...note, ...meta });
    },
    endSession: async () => {},
    saveHistory: async (_message, trailer) => void trailers.push(trailer),
    changed: () => {},
    ...(opts.data ? { dataContext: async (scope: string, action?: string) => opts.data!(scope, action) } : {}),
    now: () => new Date("2026-10-25T10:00:00.000Z"),
    newId: () => `t${++n}`,
  });
  return { manager, turns, written, trailers, notes, state: () => state };
}

describe("TaskManager with scopes", () => {
  it("refuses a required action with no scope open, and starts nothing", async () => {
    const t = setup();
    await expect(t.manager.start("study")).rejects.toBeInstanceOf(ScopeRequired);
    expect(t.turns).toEqual([]);
    expect(t.state().current).toBeNull();
  });

  it("runs a task in the open scope: its note, its status, its trailer and its chat", async () => {
    const t = setup({ script: [[ok], [saveNote, ok]] });
    expect(await t.manager.switchScope("fracciones")).toBe(true);
    await t.manager.start("study");
    expect(t.turns[0].options).toMatchObject({ task: "t1", action: "study", scope: "fracciones", chat: "fracciones" });
    expect(t.state().current).toMatchObject({ id: "t1", action: "study", scope: "fracciones", status: "waiting" });
    await t.manager.start("review");
    expect(t.turns[1].options).toMatchObject({ phase: "close", scope: "fracciones" });
    expect(t.written).toEqual([{ slug: "study", scope: "fracciones", args: 4 }]);
    expect(t.trailers).toEqual([{ task: "t1", action: "study", scope: "fracciones" }]);
    expect(t.state().scopes).toEqual({ fracciones: { study: "done" } });
    expect(t.state().actions).toEqual({});
  });

  it("gives a new session its scope's notes, the app-wide notes trimmed, then the data", async () => {
    const t = setup({
      notes: { fracciones: [note("f1", "fracciones/")], decimales: [note("d1", "decimales/")], _app: [note("a1", "_app/")] },
      data: (scope, action) => `## Data: concepts\n(${scope}, ${action})`,
    });
    await t.manager.switchScope("fracciones");
    await t.manager.start("study");
    const first = t.turns[0].message;
    expect(first).toContain("→ .harness/notes/fracciones/f1.md");
    expect(first).toContain("## App-wide notes\n- Note a1: about a1 → .harness/notes/_app/a1.md");
    expect(first).toContain("## App-wide decisions\n- decided a1");
    expect(first).not.toContain("d1");
    expect(first.indexOf("## What we already covered")).toBeLessThan(first.indexOf("## App-wide notes"));
    expect(first.indexOf("## App-wide notes")).toBeLessThan(first.indexOf("## Data: concepts\n(fracciones, study)"));
  });

  it("runs an app-wide action in _app while the chat stays the open scope's", async () => {
    const t = setup({ script: [[ok], [saveNote, ok]] });
    await t.manager.switchScope("fracciones");
    await t.manager.start("onboarding");
    expect(t.turns[0].options).toMatchObject({ scope: "_app", chat: "fracciones" });
    expect(await t.manager.runningTask()).toEqual({ id: "t1", action: "onboarding", scope: "_app" });
    expect(await t.manager.trailerNow()).toEqual({ task: "t1", action: "onboarding", scope: "_app" });
    expect(await t.manager.finish()).toBe(true);
    expect(t.written).toEqual([{ slug: "onboarding", scope: "_app", args: 4 }]);
    expect(t.state().scopes).toEqual({ _app: { onboarding: "done" } });
  });

  it("runs a free question in _app when no scope is open, and in the open scope otherwise", async () => {
    const t = setup();
    await t.manager.ask("What is a fraction?");
    expect(t.turns[0].options).toMatchObject({ scope: "_app", chat: "_app" });
    expect(await t.manager.chatScope()).toBe("_app");
    await t.manager.ask("Another one", undefined, "decimales");
    expect(t.turns.at(-1)?.options).toMatchObject({ scope: "decimales", chat: "decimales" });
    expect(t.state().open).toBe("decimales");
  });

  it("closes the open task before switching scope, and refuses an unknown scope", async () => {
    const t = setup({ script: [[ok], [saveNote, ok]] });
    await t.manager.switchScope("fracciones");
    await t.manager.start("study");
    expect(await t.manager.switchScope("decimales")).toBe(true);
    expect(t.turns[1].options.phase).toBe("close");
    expect(t.state().current).toBeNull();
    expect(t.state().open).toBe("decimales");
    expect(await t.manager.currentScope()).toBe("decimales");
    await expect(t.manager.switchScope("nope")).rejects.toThrow(/Unknown scope/);
    expect(await t.manager.switchScope(null)).toBe(true);
    expect(t.state()).not.toHaveProperty("open");
  });

  it("walks the guided path with the open scope's statuses", async () => {
    const t = setup({ state: { ...emptyTasks(), open: "decimales", scopes: { fracciones: { study: "done" } } } });
    expect((await t.manager.view()).actions).toEqual({});
    expect((await t.manager.view()).scope).toBe("decimales");
    await t.manager.switchScope("fracciones");
    expect((await t.manager.view()).actions).toEqual({ study: "done" });
    await t.manager.start("study");
    await t.manager.choose({ label: "Next", next: true }, "t1");
    // study is done in fracciones: the path goes on to review.
    expect(t.turns.at(-1)?.message.startsWith("# Task: review")).toBe(true);
  });

  it("starts with a scope argument after switching to it", async () => {
    const t = setup();
    await t.manager.start("study", undefined, "fracciones");
    expect(t.state().open).toBe("fracciones");
    expect(t.turns[0].options).toMatchObject({ scope: "fracciones" });
  });
});

describe("TaskManager without scopes (spec D2)", () => {
  it("runs exactly as before: flat notes, no scope anywhere, the plain notes index", async () => {
    const flat = [note("manifest", "")];
    const t = setup({ scoped: false, notes: { flat }, script: [[ok], [saveNote, ok]] });
    await t.manager.start("study");
    expect(t.turns[0].message).toBe(`# Task: study\n\n${buildNotesIndex(flat)}`);
    expect(t.turns[0].options).not.toHaveProperty("scope");
    expect(t.turns[0].options).not.toHaveProperty("chat");
    expect(t.state().current).not.toHaveProperty("scope");
    expect(await t.manager.finish()).toBe(true);
    expect(t.written).toEqual([{ slug: "study", args: 3 }]);
    expect(t.trailers).toEqual([{ task: "t1", action: "study" }]);
    expect(t.state()).toEqual({ version: 1, engine: "claude", current: null, actions: { study: "done" } });
    expect(await t.manager.view()).not.toHaveProperty("scope");
    expect(await t.manager.chatScope()).toBe("main");
  });

  it("ignores the scope of actions and refuses to switch scope", async () => {
    const t = setup({ scoped: false });
    await t.manager.start("onboarding");
    expect(t.turns[0].options).not.toHaveProperty("scope");
    await expect(t.manager.switchScope("fracciones")).rejects.toThrow(/no scopes/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run packages/shell/test/task-manager-scopes.test.ts`
Expected: FAIL (`ScopeRequired` and `switchScope` don't exist).

- [ ] **Step 3: Add the view fields to the client types**

In `packages/ui/src/client.ts`, in `CurrentTaskView` add:

```ts
  /** The scope the task runs in (harnesses with scopes). */
  scope?: string;
```

and in `TaskView` add:

```ts
  /** Harnesses with scopes: the open scope (null when none is open). Absent without scopes. */
  scope?: string | null;
```

- [ ] **Step 4: Implement in the task manager**

In `packages/shell/src/main/task-manager.ts`:

1. Imports. Change the workspace import to:

```ts
import { APP_SCOPE, type HistoryTrailer, MAIN_SCOPE, NOTE_PREFIX, type Note, type NoteMeta, buildNotesIndex, isScopeId, noteSlug } from "@humanharness/workspace";
```

and the task-store import to:

```ts
import { type CurrentTask, type TasksFile, interrupted, keptQuestion, scopeOfTask, statusesIn, withStatus } from "./task-store";
```

2. In `TaskDeps`, replace the `actions`, `notes`, `writeNote` and `noteExists` members with:

```ts
  /** The harness's actions: their labels, by language, and where each runs when the harness has scopes. */
  actions: Record<string, { label: LocalizedText; scope?: "required" | "none" }>;
  /** The harness declares scopes (spec D1). Absent or false: one implicit `main` scope and today's layout (D2). */
  scoped?: boolean;
  /** Whether `id` is a registered scope. Absent: any valid id is taken. */
  scopeExists?(id: string): Promise<boolean>;
  /** The notes of `scope` (the flat notes folder in a harness without scopes), newest first. */
  notes(scope?: string): Promise<Note[]>;
  /** Writes a note; `scope` is passed only in a harness with scopes. */
  writeNote(slug: string, note: SavedNote, meta: NoteMeta, scope?: string): Promise<void>;
  /** Whether the note `<slug>.md` exists in `scope`'s notes (readable or not). Defaults to the slugs of `notes(scope)`. */
  noteExists?(slug: string, scope?: string): Promise<boolean>;
  /** The data tables a new session's first message carries after the notes (spec §4.4); "" for none. */
  dataContext?(scope: string, action: string | undefined): Promise<string>;
```

3. After the `TurnNotStarted` class, add:

```ts
/** A `required` action was started with no scope open (spec §3.3): nothing was closed or started. */
export class ScopeRequired extends Error {
  constructor() {
    super("Open a scope first");
    this.name = "ScopeRequired";
  }
}

/** How much the app-wide notes index may take in a scope's session (spec §3.3 "trimmed"). */
export const APP_INDEX_TOKENS = 500;
```

4. `currentView` carries the scope. Add after its `action` line:

```ts
  ...(c.scope ? { scope: c.scope } : {}),
```

5. Replace `view()` with:

```ts
  async view(): Promise<TaskView> {
    const state = await this.d.store.load();
    const c = state.current;
    if (!this.d.scoped) {
      const notes = await this.d.notes().catch(() => [] as Note[]);
      return { current: c ? currentView(c) : null, actions: state.actions, notes: notes.map(noteView) };
    }
    const scope = this.chatOf(state);
    const own = await this.d.notes(scope).catch(() => [] as Note[]);
    const app = scope === APP_SCOPE ? [] : await this.d.notes(APP_SCOPE).catch(() => [] as Note[]);
    return {
      current: c ? currentView(c) : null,
      // The open scope's statuses, over the app-wide actions' own.
      actions: { ...statusesIn(state, APP_SCOPE), ...statusesIn(state, scope) },
      notes: [...own, ...app].map(noteView),
      scope: state.open ?? null,
    };
  }
```

6. Replace `start` and `ask` with versions that take a scope, and add the scope methods after `choose`:

```ts
  /**
   * Starts a manifest action as a new task, closing the current one first. `display` is what the chat shows.
   * `scope`, in a harness with scopes, is opened first (closing the open task, spec §3.3).
   */
  start(action: string, display?: string, scope?: string): Promise<void> {
    return this.op(() => this.startNow(action, display, scope));
  }

  /** A message from the person: a follow-up of the waiting task, or a new free-question task. `scope` as in `start`. */
  ask(text: string, display?: string, scope?: string): Promise<void> {
    return this.op(async () => {
      if (scope !== undefined && !(await this.switchNow(scope))) return this.stopped();
      return this.askNow(text, display);
    });
  }

  /**
   * Opens scope `id` (null: none). The open task is closed first, like picking another action (spec §3.3).
   * False when that closing turn was stopped (the scope didn't change). Throws in a harness without scopes.
   */
  switchScope(id: string | null): Promise<boolean> {
    return this.op(() => this.switchNow(id));
  }

  /** The open scope, or null (always null without scopes). */
  async currentScope(): Promise<string | null> {
    return this.d.scoped ? ((await this.d.store.load()).open ?? null) : null;
  }

  /** The scope whose chat the window shows: the open one, `_app` when none is open; `main` without scopes. */
  async chatScope(): Promise<string> {
    return this.chatOf(await this.d.store.load());
  }

  /** The open task and the scope it runs in (`main` without scopes), for requests made on its behalf. */
  async runningTask(): Promise<{ id: string; action?: string; scope: string } | null> {
    const c = (await this.d.store.load()).current;
    return c ? { id: c.id, ...(c.action ? { action: c.action } : {}), scope: scopeOfTask(c) } : null;
  }

  /** The open task's history trailer, for commits made on its behalf (the person's data writes); none without a task. */
  async trailerNow(): Promise<HistoryTrailer | undefined> {
    const c = (await this.d.store.load()).current;
    return c ? this.trailerOf(c) : undefined;
  }
```

7. Add these private helpers before `startNow`:

```ts
  /** Where a new task runs (spec §3.3). Throws ScopeRequired for a required action with no open scope. */
  private scopeFor(state: TasksFile, action: string | undefined): string {
    if (!this.d.scoped) return MAIN_SCOPE;
    if (action !== undefined && this.d.actions[action]?.scope === "none") return APP_SCOPE;
    if (state.open) return state.open;
    if (action !== undefined) throw new ScopeRequired();
    return APP_SCOPE;
  }

  /** The chat the window shows: the open scope's, `_app`'s when none is open; `main` without scopes. */
  private chatOf(state: TasksFile): string {
    return this.d.scoped ? (state.open ?? APP_SCOPE) : MAIN_SCOPE;
  }

  /** The history trailer of a task's commits; `scope` only in a harness with scopes (D2). */
  private trailerOf(c: CurrentTask): HistoryTrailer {
    return { task: c.id, ...(c.action ? { action: c.action } : {}), ...(c.scope ? { scope: c.scope } : {}) };
  }

  /** What a scoped task's turns carry: its scope (usage, trailer) and the chat on screen. Nothing without scopes (D2). */
  private async scopeOptions(task: CurrentTask): Promise<{ scope?: string; chat?: string }> {
    if (!this.d.scoped) return {};
    return { scope: scopeOfTask(task), chat: this.chatOf(await this.d.store.load()) };
  }

  /**
   * A new session's context (spec §3.3, §4.4): the scope's notes index; in a scope, the app-wide one, trimmed;
   * then the data tables. Without scopes or data, exactly the notes index as before (D2).
   */
  private async contextFor(scope: string, action: string | undefined): Promise<string> {
    const own = buildNotesIndex(await this.d.notes(this.d.scoped ? scope : undefined).catch(() => [] as Note[]));
    const parts = [own];
    if (this.d.scoped && scope !== APP_SCOPE) {
      const app = await this.d.notes(APP_SCOPE).catch(() => [] as Note[]);
      // The own index ends with the "open a note" line; the app-wide one says it only when it stands alone.
      parts.push(buildNotesIndex(app, { budgetTokens: APP_INDEX_TOKENS, heading: "## App-wide notes", decisionsHeading: "## App-wide decisions", ...(own ? { footer: null } : {}) }));
    }
    if (this.d.dataContext) {
      parts.push(
        await this.d.dataContext(scope, action).catch((err: unknown) => {
          console.error("Could not load the data for the task", err);
          return "";
        }),
      );
    }
    return parts.filter(Boolean).join("\n\n");
  }

  private async switchNow(id: string | null): Promise<boolean> {
    if (!this.d.scoped) throw new Error("This harness has no scopes");
    if (id !== null && (!isScopeId(id) || !((await this.d.scopeExists?.(id)) ?? true))) throw new Error("Unknown scope");
    if (((await this.d.store.load()).open ?? null) === id) return true;
    if (!(await this.closeCurrent())) return false;
    await this.update((s) => {
      const { open: _open, ...rest } = s;
      return id === null ? rest : { ...rest, open: id };
    });
    return true;
  }
```

8. Replace `startNow` with:

```ts
  private async startNow(action: string, display?: string, scope?: string): Promise<void> {
    if (!this.known(action)) throw new Error("Unknown action");
    if (scope !== undefined && !(await this.switchNow(scope))) return this.stopped();
    // Checked before anything closes: a required action with no open scope starts nothing.
    const where = this.scopeFor(await this.d.store.load(), action);
    if (!(await this.closeCurrent())) return this.stopped();
    const template = await this.d.readPrompt(action);
    const language = await this.d.language();
    await this.begin({ action }, where, (notesIndex) => fillPrompt(template, { language, notesIndex }), display ?? this.d.actions[action].label[language]);
  }
```

9. In `askNow`, replace the closing lines (from `if (c) await this.endTask(c.id, "unfinished");` to the end of the method) with:

```ts
    if (c) await this.endTask(c.id, "unfinished");
    const language = await this.d.language();
    await this.begin(
      keptQuestion(text),
      this.scopeFor(await this.d.store.load(), undefined),
      (notesIndex) => fillPrompt(QUESTION_PROMPT, { language, notesIndex, question: text }),
      display ?? text,
    );
```

10. In `resumeMessageFor`, delete the line `const notes = await this.d.notes().catch(() => [] as Note[]);`, and replace `notesIndex: buildNotesIndex(notes),` with:

```ts
      notesIndex: await this.contextFor(scopeOfTask(c), c.action),
```

11. In `chooseNow`, replace the `target` line with:

```ts
    // The path is walked with the open scope's statuses: each scope walks its own (spec §3.3).
    const target = action ?? nextInPath(this.d.path, state.current?.action, statusesIn(state, this.chatOf(state)));
```

12. Replace `begin`'s signature and its first lines up to the `current` constant with:

```ts
  /** A new task in a fresh session, in `scope`; its first message is built from the session context. */
  private async begin(
    task: { action?: string; question?: string; questionCut?: true },
    scope: string,
    message: (notesIndex: string) => string,
    display: string,
  ): Promise<void> {
    // Cancelled or quitting since the operation began (e.g. right after the closing turn): start nothing.
    if (this.cancelRequested) return this.stopped();
    await this.endSession();
    const context = await this.contextFor(scope, task.action);
    const engine = await this.d.engine();
    // Resolved once: the task keeps its model, effort and cap to the end (spec D2).
    const profile = await this.d.profileFor?.(task.action);
    const current: CurrentTask = {
      id: this.newId(),
      ...task,
      status: "running",
      startedAt: this.now().toISOString(),
      turns: 0,
      ...(profile ? { profile } : {}),
      ...(this.d.scoped ? { scope } : {}),
    };
```

Further down in `begin`, replace `message(buildNotesIndex(notes))` with `message(context)`.

13. In `runTurn`, add the scope options to the `send` call. Replace

```ts
      await this.d.turns.send(message, {
        phase: "run",
        ...options,
```

with

```ts
      const scoped = await this.scopeOptions(task);
      await this.d.turns.send(message, {
        phase: "run",
        ...options,
        ...scoped,
```

14. In `endTask`, replace the `done` branch's last line with:

```ts
      return { ...withStatus(s, scopeOfTask(c), c.action, "done"), current: null };
```

15. In `saveNote`, replace the body of the `try` block up to and including the `saveHistory` call with:

```ts
      const scope = scopeOfTask(task);
      const slug = task.action ?? (await this.questionSlug(task.id, note.title, scope));
      const meta: NoteMeta = { ...(task.action ? { action: task.action } : {}), date: this.now().toISOString(), engine: await this.d.engine() };
      // Without scopes the call is exactly today's (D2).
      if (this.d.scoped) await this.d.writeNote(slug, note, meta, scope);
      else await this.d.writeNote(slug, note, meta);
      // A checkpoint's note is provisional: the closing turn still runs and updates the same file.
      await this.update((s) =>
        s.current?.id === task.id
          ? { ...s, current: { ...s.current, ...(final ? { noteSaved: true } : { checkpointNote: true, checkpointTurns: s.current.turns }) } }
          : s,
      );
      await this.d.saveHistory?.(`${NOTE_PREFIX}${note.title.slice(0, 60)}`, this.trailerOf(task));
```

16. Replace `questionSlug` with a version that looks in the task's scope:

```ts
  /** `q-<title slug>`, numbered (`-2`, `-3`…) when another note of the scope already has that name. */
  private async questionSlug(taskId: string, title: string, scope: string): Promise<string> {
    const own = this.questionSlugs.get(taskId);
    if (own) return own;
    const where = this.d.scoped ? scope : undefined;
    const exists = this.d.noteExists
      ? (slug: string) => this.d.noteExists!(slug, where)
      : await this.d.notes(where).then(
          (notes) => (slug: string) => Promise.resolve(notes.some((n) => n.slug === slug)),
          () => () => Promise.resolve(false),
        );
    const base = `q-${noteSlug(title)}`;
    let slug = base;
    for (let i = 2; await exists(slug); i++) slug = `${base}-${i}`;
    this.questionSlugs.clear();
    this.questionSlugs.set(taskId, slug);
    return slug;
  }
```

The `buildNotesIndex` import is still used by `contextFor`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/shell/test/task-manager-scopes.test.ts packages/shell/test/task-manager.test.ts`
Expected: PASS. The older suite is the regression net. Its fakes are unchanged: `scoped` is absent, `notes()` ignores its argument, and the trailer, `writeNote` arguments and prompts are as before.

- [ ] **Step 6: Typecheck, full tests, commit**

Run: `corepack pnpm typecheck` then `corepack pnpm test`
Expected: both green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/shell/src/main/task-manager.ts packages/ui/src/client.ts packages/shell/test/task-manager-scopes.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(shell): tasks run in scopes with their own notes, statuses, path and context" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 11: The scopes reach the window (client, IPC, preload, main wiring)

**Files:**
- Modify: `packages/ui/src/client.ts`, `packages/ui/test/fake-client.ts`, `packages/shell/src/main/index.ts`, `packages/shell/src/preload/index.ts`
- Test: `packages/ui/test/client.test.ts`

The main process has no unit tests of its own (as in plans 3c–3d). Its wiring is checked here by the type checker and `app:build`, by the `humanharness run` integration test in Task 14 (the same `TaskManager` deps over a real folder), and by the e2e test in Task 26.

- [ ] **Step 1: Write the failing test (the client contract)**

In `packages/ui/test/client.test.ts`, add `import { FakeClient } from "./fake-client";` to the imports, and at the end of the file add:

```ts
describe("the scopes contract", () => {
  it("lists, creates, opens and archives scopes, and tells listeners", async () => {
    const client = new FakeClient();
    const seen: (string | null)[] = [];
    const off = client.scopes.onChange((v) => seen.push(v.open));
    const s = await client.scopes.create("Fractions");
    expect(await client.scopes.open(s.id)).toBe(true);
    expect(await client.scopes.current()).toBe(s.id);
    await client.scopes.archive(s.id);
    expect(await client.scopes.current()).toBeNull();
    expect((await client.scopes.list())[0]).toMatchObject({ id: s.id, archived: true });
    off();
    expect(seen).toEqual([null, s.id, null]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/ui/test/client.test.ts`
Expected: FAIL (`client.scopes` is undefined).

- [ ] **Step 3: Extend the client types**

In `packages/ui/src/client.ts`:

1. In `ActionOption`, after `tier`, add:

```ts
  /** Harnesses with scopes: "none" runs app-wide; anything else needs an open scope. */
  scope?: "required" | "none";
```

2. In `AppState`, after `path`, add:

```ts
  /** The harness's unit of work (manifest `scopes`): what to call it. Absent: no scopes (spec D2). */
  scopes?: { label: LocalizedText; plural: LocalizedText };
```

3. In `SendOptions`, after `action`, add:

```ts
  /** Harnesses with scopes: run in this scope (it opens first). Default: the open one. */
  scope?: string;
```

4. Before `HarnessClient`, add:

```ts
/** A scope as the window sees it (spec §3.4). */
export interface ScopeView {
  id: string;
  title: string;
  createdAt: string;
  archived: boolean;
}

/** The open scope and the registry, sent whenever either changes. */
export interface ScopesView {
  open: string | null;
  list: ScopeView[];
}
```

5. In `HarnessClient`, before `onTextSize`, add:

```ts
  /** Harnesses with scopes (spec §3.4). There is no delete: archive instead. */
  scopes: {
    list(): Promise<ScopeView[]>;
    create(title: string): Promise<ScopeView>;
    rename(id: string, title: string): Promise<ScopeView>;
    /** Archiving the open scope closes it first. */
    archive(id: string): Promise<void>;
    unarchive(id: string): Promise<void>;
    /** Opens a scope (null: none), closing the open task first; false when that close was stopped. */
    open(id: string | null): Promise<boolean>;
    current(): Promise<string | null>;
    onChange(listener: (view: ScopesView) => void): () => void;
  };
```

- [ ] **Step 4: The fake client**

In `packages/ui/test/fake-client.ts`, add `ScopeView` and `ScopesView` to the type import, and add these members to `FakeClient` (after `onTextSize`):

```ts
  /** The scope registry the fake answers with. */
  scopeList: ScopeView[] = [];
  /** The open scope. */
  openScope: string | null = null;
  private scopeListeners = new Set<(v: ScopesView) => void>();
  emitScopes() {
    const view = { open: this.openScope, list: this.scopeList };
    for (const l of this.scopeListeners) l(view);
  }
  private changeScope(id: string, change: Partial<ScopeView>): ScopeView {
    const i = this.scopeList.findIndex((s) => s.id === id);
    if (i < 0) throw new Error(`Unknown scope: "${id}"`);
    const next = { ...this.scopeList[i], ...change };
    this.scopeList = this.scopeList.map((s, j) => (j === i ? next : s));
    return next;
  }
  scopes = {
    list: async () => this.scopeList,
    create: async (title: string) => {
      const s: ScopeView = { id: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"), title, createdAt: "2026-10-25T10:00:00.000Z", archived: false };
      this.scopeList = [...this.scopeList, s];
      this.emitScopes();
      return s;
    },
    rename: async (id: string, title: string) => {
      const s = this.changeScope(id, { title });
      this.emitScopes();
      return s;
    },
    archive: async (id: string) => {
      if (this.openScope === id) this.openScope = null;
      this.changeScope(id, { archived: true });
      this.emitScopes();
    },
    unarchive: async (id: string) => {
      this.changeScope(id, { archived: false });
      this.emitScopes();
    },
    open: async (id: string | null) => {
      this.openScope = id;
      this.emitScopes();
      return true;
    },
    current: async () => this.openScope,
    onChange: (listener: (v: ScopesView) => void) => {
      this.scopeListeners.add(listener);
      return () => {
        this.scopeListeners.delete(listener);
      };
    },
  };
```

- [ ] **Step 5: The preload**

In `packages/shell/src/preload/index.ts`, add `ScopesView` to the type import from the client, and add to the `client` object (before `onTextSize`):

```ts
  scopes: {
    list: () => ipcRenderer.invoke("hh:scopes"),
    create: (title) => ipcRenderer.invoke("hh:scopeCreate", title),
    rename: (id, title) => ipcRenderer.invoke("hh:scopeRename", id, title),
    archive: (id) => ipcRenderer.invoke("hh:scopeArchive", id, true),
    unarchive: (id) => ipcRenderer.invoke("hh:scopeArchive", id, false),
    open: (id) => ipcRenderer.invoke("hh:scopeOpen", id),
    current: () => ipcRenderer.invoke("hh:scopeCurrent"),
    onChange: (listener) => subscribe<ScopesView>("hh:scopes", listener),
  },
```

- [ ] **Step 6: The main process**

In `packages/shell/src/main/index.ts`:

1. Extend the workspace import with `MAIN_SCOPE, ScopeStore, isScopeId, migrateToScopes, notesPrefix`, and add `type ScopesView` to the import from `@humanharness/ui/client`.

2. After `validConfig()`, add:

```ts
/**
 * The folder every path under `.harness/` starts from (packages/workspace/src/layout.ts): the configured folder.
 * The profiles plan makes it the active profile's folder by changing only this function (scopes spec §7.1).
 */
const baseOf = (c: { folder: string }): string => c.folder;

/** The harness declares scopes (spec D1); without them everything stays as before (D2). */
const scoped = (): boolean => harness.scopes !== undefined;

/** One registry per base, so its write queue orders every change. */
const scopeStores = new Map<string, ScopeStore>();
function scopeStoreFor(base: string): ScopeStore {
  let store = scopeStores.get(base);
  if (!store) {
    store = new ScopeStore(base);
    scopeStores.set(base, store);
  }
  return store;
}

async function scopesView(): Promise<ScopesView> {
  const c = await validConfig();
  if (!c || !scoped()) return { open: null, list: [] };
  return { open: await tasks.currentScope(), list: await scopeStoreFor(baseOf(c)).list() };
}

async function scopesChanged(): Promise<void> {
  try {
    sendToWindow("hh:scopes", await scopesView());
  } catch (err) {
    console.error("Could not send the scopes to the window", err);
  }
}

async function scopeStore(): Promise<ScopeStore> {
  const c = await validConfig();
  if (!c) throw new Error("The app is not set up yet");
  if (!scoped()) throw new Error("This harness has no scopes");
  return scopeStoreFor(baseOf(c));
}

/** A harness with scopes in a folder used without them (spec §3.2): earlier work moves into `main`, which opens. */
async function settleScopes(): Promise<void> {
  const c = await validConfig();
  if (!c || !scoped()) return;
  if (await migrateToScopes(baseOf(c))) await tasks.switchScope(MAIN_SCOPE);
}
```

3. In `appState()`, in the `actions` mapping, add `...(a.scope ? { scope: a.scope } : {})` after the `tier` spread. After `path: harness.path ?? [],` add:

```ts
    ...(harness.scopes ? { scopes: harness.scopes } : {}),
```

4. Every `new ChatLog(c.folder…)`, `new TaskStore(c.folder)` and `new UsageLog(c.folder)` becomes `…(baseOf(c)…)`. So do the `c.folder` passed to `archiveStaleChat` and `startNewChatIfEngineChanged`. The history keeps `c.folder`. In the `TurnController` deps, replace the `chatLog` member with:

```ts
  chatLog: async (chat) => {
    const c = await config.load();
    if (!isConfigured(c)) return null;
    // An invalid saved config still runs the turn, so the runtime start fails with the reason;
    // nothing is written into a folder that didn't pass validation.
    return (await configProblem(c, validation())) === null ? new ChatLog(baseOf(c), c.engineId, chat) : { append: async () => {} };
  },
```

5. In the `TaskManager` deps, replace `notes`, `writeNote` and `noteExists` with the following, and add `scoped` and `scopeExists`:

```ts
  get scoped() {
    return scoped();
  },
  scopeExists: async (id) => {
    const c = await validConfig();
    return c ? (await scopeStoreFor(baseOf(c)).list()).some((s) => s.id === id && !s.archived) : false;
  },
  notes: async (scope) => {
    const c = await validConfig();
    return c ? readNotes(baseOf(c), notesPrefix(scoped(), scope)) : [];
  },
  writeNote: async (slug, note, meta, scope) => {
    const c = await validConfig();
    if (!c) throw new Error("The app is not set up yet");
    await writeNote(baseOf(c), slug, note, meta, notesPrefix(scoped(), scope));
  },
  noteExists: async (slug, scope) => {
    const c = await validConfig();
    return c ? fs.access(path.join(baseOf(c), notesPrefix(scoped(), scope), `${slug}.md`)).then(() => true, () => false) : false;
  },
```

6. `hh:loadChat` loads the open scope's chat: replace its last line with:

```ts
    return { entries: await new ChatLog(baseOf(c), undefined, await tasks.chatScope()).load(), ...(switchedFrom ? { switchedFrom } : {}) };
```

7. `hh:send` passes the scope. Replace its last two lines with:

```ts
    const scope = typeof options?.scope === "string" && isScopeId(options.scope) ? options.scope : undefined;
    // A message with an action starts that task (the message is what the chat shows); any other follows up or asks.
    const sent = action ? tasks.start(action, message, scope) : tasks.ask(message, undefined, scope);
    return scope === undefined ? sent : sent.finally(() => void scopesChanged());
```

8. In `registerIpc()`, after `hh:getTasks`, add:

```ts
  handle("hh:scopes", async () => (await scopesView()).list);
  handle("hh:scopeCurrent", () => tasks.currentScope());
  handle("hh:scopeCreate", async (title: unknown) => {
    const created = await (await scopeStore()).create(title);
    await scopesChanged();
    return created;
  });
  handle("hh:scopeRename", async (id: unknown, title: unknown) => {
    if (!isScopeId(id)) throw new Error("Unknown scope");
    const renamed = await (await scopeStore()).rename(id, title);
    await scopesChanged();
    return renamed;
  });
  handle("hh:scopeArchive", async (id: unknown, archived: unknown) => {
    if (!isScopeId(id) || typeof archived !== "boolean") throw new Error("Invalid scope change");
    const store = await scopeStore();
    if (archived && (await tasks.currentScope()) === id) {
      const blocked = turnBlocked();
      if (blocked) throw new Error(blocked);
      if (!(await tasks.switchScope(null))) throw new Error("The open task is still closing");
    }
    await store.setArchived(id, archived);
    await scopesChanged();
  });
  handle("hh:scopeOpen", async (id: unknown) => {
    if (quitting) throw new Error("The app is closing");
    const blocked = turnBlocked();
    if (blocked) throw new Error(blocked);
    if (id !== null && !isScopeId(id)) throw new Error("Unknown scope");
    const opened = await tasks.switchScope(id);
    await scopesChanged();
    return opened;
  });
```

9. Run the migration at startup and after a folder change. At startup, replace

```ts
    void tasks.interrupt().catch((err: unknown) => console.error("Could not settle the last task", err));
```

with

```ts
    void tasks.interrupt().catch((err: unknown) => console.error("Could not settle the last task", err));
    // After the interrupt (queued behind it): a scoped harness's earlier work moves into `main`.
    void settleScopes()
      .then(scopesChanged)
      .catch((err: unknown) => console.error("Could not prepare the scopes", err));
```

In `hh:saveConfig`, after the `saveWithFolderChange(…)` call, add:

```ts
    if (patch.folder !== undefined && patch.folder !== before.folder) {
      await settleScopes()
        .then(scopesChanged)
        .catch((err: unknown) => console.error("Could not prepare the scopes", err));
    }
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `corepack pnpm vitest run packages/ui/test/client.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck, full tests, build, commit**

Run: `corepack pnpm typecheck`, then `corepack pnpm test`, then `corepack pnpm app:build`
Expected: all green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/ui/src/client.ts packages/ui/test/fake-client.ts packages/ui/test/client.test.ts packages/shell/src/main/index.ts packages/shell/src/preload/index.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(shell): scopes over IPC, the migration at startup, paths through baseOf" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 12: The scope picker in the top bar

**Files:**
- Create: `packages/ui/src/ScopePicker.tsx`
- Modify: `packages/ui/src/HarnessApp.tsx`, `packages/ui/src/ChatView.tsx`, `packages/ui/src/index.ts`, `packages/ui/src/styles.css`, `packages/i18n/src/locales/es.json`, `packages/i18n/src/locales/en.json`
- Test: `packages/ui/test/scopes.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/test/scopes.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { HarnessApp } from "../src";
import { FakeClient } from "./fake-client";

afterEach(cleanup);
const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };

async function startWork(ui: ReactElement) {
  const result = render(ui);
  const start = (await screen.findByRole("button", { name: /^(Start|Iniciar) Demo$/ })) as HTMLButtonElement;
  await waitFor(() => expect(start.disabled).toBe(false));
  fireEvent.click(start);
  return result;
}

function scopedClient() {
  const client = new FakeClient(ready);
  client.state.scopes = { label: { es: "tema", en: "topic" }, plural: { es: "temas", en: "topics" } };
  client.state.actions = { study: { label: { es: "Estudiar", en: "Study" }, cost: "light" } };
  client.scopeList = [
    { id: "fracciones", title: "Fractions", createdAt: "c", archived: false },
    { id: "old", title: "Old", createdAt: "c", archived: true },
  ];
  return client;
}

describe("scopes in the window", () => {
  it("picks an active scope from the top bar", async () => {
    const client = scopedClient();
    await startWork(<HarnessApp client={client} />);
    const select = (await screen.findByRole("combobox", { name: "Choose a topic" })) as HTMLSelectElement;
    await waitFor(() => expect([...select.options].map((o) => o.textContent)).toEqual(["No topic", "Fractions"]));
    fireEvent.change(select, { target: { value: "fracciones" } });
    await waitFor(() => expect(client.openScope).toBe("fracciones"));
    await waitFor(() => expect((screen.getByRole("combobox", { name: "Choose a topic" }) as HTMLSelectElement).value).toBe("fracciones"));
  });

  it("adds a scope and opens it", async () => {
    const client = scopedClient();
    await startWork(<HarnessApp client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add a topic" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Algebra" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(client.openScope).toBe("algebra"));
    expect(client.scopeList.map((s) => s.id)).toContain("algebra");
  });

  it("asks for a scope before a required action and sends nothing", async () => {
    const client = scopedClient();
    await startWork(<HarnessApp client={client} renderSide={(_s, send) => <button onClick={() => send("Study", { action: "study" })}>go</button>} />);
    fireEvent.click(await screen.findByRole("button", { name: "go" }));
    expect((await screen.findAllByText("First choose which topic to work on.")).length).toBeGreaterThan(0);
    expect(client.sent).toEqual([]);
  });

  it("shows no picker for a harness without scopes (spec D2)", async () => {
    const client = new FakeClient(ready);
    await startWork(<HarnessApp client={client} />);
    await screen.findByRole("button", { name: "Settings" });
    expect(screen.queryByRole("combobox", { name: /^Choose a/ })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run packages/ui/test/scopes.test.tsx`
Expected: FAIL (no picker).

- [ ] **Step 3: The strings**

In `packages/i18n/src/locales/en.json`, add a top-level key:

```json
  "scopes": {
    "pick": "Choose a {{label}}",
    "none": "No {{label}}",
    "add": "Add a {{label}}",
    "titleLabel": "Name",
    "create": "Create",
    "cancel": "Cancel",
    "pickFirst": "First choose which {{label}} to work on.",
    "failed": "That didn't work. Try again."
  },
```

In `packages/i18n/src/locales/es.json`:

```json
  "scopes": {
    "pick": "Elegir {{label}}",
    "none": "Sin {{label}}",
    "add": "Agregar {{label}}",
    "titleLabel": "Nombre",
    "create": "Crear",
    "cancel": "Cancelar",
    "pickFirst": "Primero elegí en qué {{label}} trabajar.",
    "failed": "No se pudo. Probá de nuevo."
  },
```

- [ ] **Step 4: The picker**

Create `packages/ui/src/ScopePicker.tsx`:

```tsx
import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient, ScopeView } from "./client";

/**
 * The top bar's scope picker (spec §3.4): the active scopes, "none", and a new one. The minimum a harness with
 * scopes needs to work; a harness can build its own (a topics home, a map) on `client.scopes`.
 */
export function ScopePicker({
  client,
  label,
  open,
  disabled = false,
}: {
  client: HarnessClient;
  /** What the harness calls a scope (manifest `scopes.label`). */
  label: { es: string; en: string };
  open: string | null;
  disabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [list, setList] = useState<ScopeView[]>([]);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    client.scopes.list().then(
      (l) => {
        if (live) setList(l);
      },
      () => undefined,
    );
    const off = client.scopes.onChange((v) => setList(v.list));
    return () => {
      live = false;
      off();
    };
  }, [client]);
  const name = i18n.language.startsWith("es") ? label.es : label.en;
  // An archived scope still shows while it is the open one, so the select never lies.
  const shown = list.filter((s) => !s.archived || s.id === open);
  const pick = (id: string | null) => {
    setFailed(false);
    client.scopes.open(id).catch(() => setFailed(true));
  };
  const create = async (e: FormEvent) => {
    e.preventDefault();
    const clean = title.trim();
    if (!clean) return;
    setFailed(false);
    try {
      const made = await client.scopes.create(clean);
      setTitle("");
      setAdding(false);
      await client.scopes.open(made.id);
    } catch {
      setFailed(true);
    }
  };
  return (
    <div className="hh-scope-picker">
      <select aria-label={t("scopes.pick", { label: name })} value={open ?? ""} disabled={disabled} onChange={(e) => pick(e.target.value || null)}>
        <option value="">{t("scopes.none", { label: name })}</option>
        {shown.map((s) => (
          <option key={s.id} value={s.id}>
            {s.title}
          </option>
        ))}
      </select>
      {adding ? (
        <form onSubmit={(e) => void create(e)}>
          <input aria-label={t("scopes.titleLabel")} value={title} maxLength={120} autoFocus onChange={(e) => setTitle(e.target.value)} />
          <button type="submit" disabled={disabled || !title.trim()}>
            {t("scopes.create")}
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setTitle("");
            }}
          >
            {t("scopes.cancel")}
          </button>
        </form>
      ) : (
        <button disabled={disabled} onClick={() => setAdding(true)}>
          {t("scopes.add", { label: name })}
        </button>
      )}
      {failed && <p role="alert">{t("scopes.failed")}</p>}
    </div>
  );
}
```

In `packages/ui/src/index.ts`, add `export { ScopePicker } from "./ScopePicker";`.

In `packages/ui/src/styles.css`, add:

```css
.hh-scope-picker {
  display: flex;
  align-items: center;
  gap: 8px;
}
.hh-scope-picker form {
  display: flex;
  gap: 6px;
}
```

- [ ] **Step 5: HarnessApp and ChatView**

In `packages/ui/src/HarnessApp.tsx`:

1. Import `{ ScopePicker } from "./ScopePicker"`.
2. With the other `useState` hooks (before any early return), add:

```tsx
  /** Harnesses with scopes: the open scope; the work screen's chat is that scope's. */
  const [openScope, setOpenScope] = useState<string | null>(null);
  const hasScopes = Boolean(state?.scopes);
  useEffect(() => {
    if (!hasScopes) return;
    let live = true;
    client.scopes.current().then(
      (id) => {
        if (live) setOpenScope(id);
      },
      () => undefined,
    );
    const off = client.scopes.onChange((v) => setOpenScope(v.open));
    return () => {
      live = false;
      off();
    };
  }, [client, hasScopes]);
```

3. In the `<ChatView … />` element, replace `key={engineId}` with ``key={`${engineId}:${openScope ?? ""}`}`` and add the props:

```tsx
            openScope={openScope}
            scopeBar={state.scopes ? <ScopePicker client={client} label={state.scopes.label} open={openScope} /> : undefined}
```

In `packages/ui/src/ChatView.tsx`:

1. Add to the destructured props and their types:

```tsx
  scopeBar,
  openScope = null,
```

```tsx
  /** Harnesses with scopes: the picker shown first in the top bar. */
  scopeBar?: ReactNode;
  /** Harnesses with scopes: the open scope (its chat is the one on screen). */
  openScope?: string | null;
```

2. In the `<TopBar …>` children, put `{scopeBar}` first.
3. In `send`, right after `if (!message || blocked() || (pending && !confirmed)) return false;`, add:

```tsx
    // A `required` action needs an open scope (spec §3.3); the main process would refuse it.
    if (options.action && state.scopes && state.actions[options.action]?.scope !== "none" && !openScope) {
      const text = t("scopes.pickFirst", { label: state.scopes.label[lang] });
      dispatch({ type: "notice", text, at: new Date().toISOString() });
      setNotice(text);
      return false;
    }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/ui/test/scopes.test.tsx packages/ui/test/HarnessApp.test.tsx packages/i18n`
Expected: PASS (the i18n test checks that `es` and `en` have the same keys).

- [ ] **Step 7: Typecheck, full tests, build, commit**

Run: `corepack pnpm typecheck`, then `corepack pnpm test`, then `corepack pnpm app:build`
Expected: all green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/ui/src/ScopePicker.tsx packages/ui/src/HarnessApp.tsx packages/ui/src/ChatView.tsx packages/ui/src/index.ts packages/ui/src/styles.css packages/i18n/src/locales/es.json packages/i18n/src/locales/en.json packages/ui/test/scopes.test.tsx
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(ui): a scope picker in the top bar; the chat follows the open scope" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 13: History filtered by scope, usage per scope

**Files:**
- Modify: `packages/shell/src/main/history-view.ts`, `packages/ui/src/client.ts` (`HistoryTaskView.scopeId`), `packages/ui/src/HistoryPanel.tsx`, `packages/ui/src/UsageTab.tsx`, `packages/i18n/src/locales/es.json`, `packages/i18n/src/locales/en.json`
- Test: `packages/shell/test/history-view.test.ts`, `packages/ui/test/history-panel.test.tsx`, `packages/ui/test/usage-tab.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `packages/shell/test/history-view.test.ts`, add inside `describe("historyView", …)`:

```ts
  it("passes the task's scope through, only when there is one", () => {
    const g = (scopeId?: string): HistoryTask => ({
      taskId: "t1",
      actionId: null,
      ...(scopeId ? { scopeId } : {}),
      start: null,
      end: "b".repeat(40),
      date: at("2026-10-13T10:00:00.000Z"),
      changes: [],
      entries: [entry("b".repeat(40), "Turn: x")],
    });
    expect(historyView([g("fracciones")])[0].scopeId).toBe("fracciones");
    expect(historyView([g()])[0]).not.toHaveProperty("scopeId");
  });
```

In `packages/ui/test/history-panel.test.tsx`, add inside `describe("HistoryPanel", …)`:

```tsx
  it("filters the tasks by scope when the history has scopes", async () => {
    const client = new FakeClient();
    client.scopeList = [{ id: "fracciones", title: "Fractions", createdAt: "c", archived: false }];
    const group = (taskId: string, scopeId?: string) => ({
      taskId,
      actionId: null,
      ...(scopeId ? { scopeId } : {}),
      start: "s0",
      end: `e-${taskId}`,
      date: "2026-10-10T12:00:00.000Z",
      changes: [],
      entries: [{ sha: `e-${taskId}`, message: `Turn: ${taskId}`, date: "2026-10-10T12:00:00.000Z" }],
    });
    client.historyGroups = [group("t1", "fracciones"), group("t2", "_app"), group("t3")];
    await renderIn("en", <HistoryPanel client={client} actions={{}} lang="en" onClose={() => {}} />);
    const filter = (await screen.findByRole("combobox", { name: "Show" })) as HTMLSelectElement;
    await waitFor(() => expect([...filter.options].map((o) => o.textContent)).toEqual(["All", "Fractions", "App-wide"]));
    expect(screen.getAllByRole("button", { name: /A question/ })).toHaveLength(3);
    fireEvent.change(filter, { target: { value: "fracciones" } });
    expect(screen.getAllByRole("button", { name: /A question/ })).toHaveLength(1);
  });

  it("shows no filter for a history without scopes", async () => {
    await renderIn("en", <HistoryPanel client={new FakeClient()} actions={{}} lang="en" onClose={() => {}} />);
    await screen.findByRole("heading", { name: "History" });
    expect(screen.queryByRole("combobox", { name: "Show" })).toBeNull();
  });
```

(A free question's row is labelled `history.question`, "A question" in English. The file already imports `fireEvent`, `screen`, `waitFor`, `FakeClient` and `renderIn`.)

At the end of `packages/ui/test/usage-tab.test.tsx`, add:

```tsx
describe("usage per scope", () => {
  it("lists the scopes by tokens used, most first", async () => {
    const client = new FakeClient({ language: "en", folder: "/f", engineId: "claude" });
    client.state.scopes = { label: { es: "tema", en: "topic" }, plural: { es: "temas", en: "topics" } };
    client.scopeList = [{ id: "fracciones", title: "Fractions", createdAt: "c", archived: false }];
    client.usage = { limits: null, estimates: {}, tokens: {}, scopes: { _app: 300, fracciones: 12_000 } };
    await renderIn("en", <UsageTab client={client} state={client.state} />);
    const list = await screen.findByRole("list", { name: "Usage by topics" });
    await waitFor(() => expect([...list.querySelectorAll("li")].map((li) => li.firstChild?.textContent)).toEqual(["Fractions", "App-wide"]));
  });
});
```

(Add `import { UsageTab } from "../src/UsageTab";`, and add `waitFor` to the file's `@testing-library/react` import.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run packages/shell/test/history-view.test.ts packages/ui/test/history-panel.test.tsx packages/ui/test/usage-tab.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Strings**

In `en.json`, add under `history`: `"scopeFilter": "Show"`, `"allScopes": "All"`, `"appScope": "App-wide"`; under `usage`: `"byScope": "Usage by {{plural}}"`, `"scopeTokens": "{{tokens}} tokens"`, `"appScope": "App-wide"`.

In `es.json`, add under `history`: `"scopeFilter": "Mostrar"`, `"allScopes": "Todo"`, `"appScope": "De toda la app"`; under `usage`: `"byScope": "Uso por {{plural}}"`, `"scopeTokens": "{{tokens}} tokens"`, `"appScope": "De toda la app"`.

- [ ] **Step 4: Implement**

In `packages/ui/src/client.ts`, in `HistoryTaskView`, after `actionId`, add:

```ts
  /** The scope the task ran in (harnesses with scopes). */
  scopeId?: string;
```

In `packages/shell/src/main/history-view.ts`, add after `actionId: g.actionId,`:

```ts
      ...(g.scopeId ? { scopeId: g.scopeId } : {}),
```

In `packages/ui/src/HistoryPanel.tsx`:

1. After the `restoring` state, add:

```tsx
  /** Harnesses with scopes: the scope whose tasks show ("" for all), and the scopes' titles. */
  const [filter, setFilter] = useState("");
  const [titles, setTitles] = useState<Record<string, string>>({});
  const scopeIds = [...new Set((groups ?? []).flatMap((g) => (g.scopeId ? [g.scopeId] : [])))];
  const hasScopes = scopeIds.length > 0;
  useEffect(() => {
    if (!hasScopes) return;
    client.scopes.list().then(
      (list) => setTitles(Object.fromEntries(list.map((s) => [s.id, s.title]))),
      () => undefined,
    );
  }, [client, hasScopes]);
  const shown = filter ? (groups ?? []).filter((g) => g.scopeId === filter) : groups;
```

2. Just before `<ol className="hh-history-tasks">`, add:

```tsx
      {hasScopes && (
        <label className="hh-history-filter">
          {t("history.scopeFilter")}{" "}
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">{t("history.allScopes")}</option>
            {scopeIds.map((id) => (
              <option key={id} value={id}>
                {id === "_app" ? t("history.appScope") : (titles[id] ?? id)}
              </option>
            ))}
          </select>
        </label>
      )}
```

3. In the list, replace `{groups?.map((g) => {` with `{shown?.map((g) => {`. `laterTasks(groups, …)` keeps using every group: going back still undoes tasks of other scopes.

In `packages/ui/src/UsageTab.tsx`:

1. After the `TopicTable` line in `UsageTab`'s JSX, add:

```tsx
      {usage?.scopes && state.scopes && <ScopeUsage client={client} tokens={usage.scopes} plural={state.scopes.plural} />}
```

2. Add at the end of the file:

```tsx
/** Settings › Uso per scope (spec §3.3): tokens per scope over the whole log, most first. */
function ScopeUsage({ client, tokens, plural }: { client: HarnessClient; tokens: Record<string, number>; plural: { es: string; en: string } }) {
  const { t, i18n } = useTranslation();
  const [titles, setTitles] = useState<Record<string, string>>({});
  useEffect(() => {
    client.scopes.list().then(
      (list) => setTitles(Object.fromEntries(list.map((s) => [s.id, s.title]))),
      () => undefined,
    );
  }, [client]);
  const heading = t("usage.byScope", { plural: i18n.language.startsWith("es") ? plural.es : plural.en });
  const rows = Object.entries(tokens).sort((a, b) => b[1] - a[1]);
  return (
    <>
      <h3>{heading}</h3>
      <ul className="hh-rows" aria-label={heading}>
        {rows.map(([id, n]) => (
          <li key={id} className="hh-row">
            <span>{id === "_app" ? t("usage.appScope") : (titles[id] ?? id)}</span>
            <span className="hh-caption">{t("usage.scopeTokens", { tokens: compactTokens(n, i18n.language) })}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
```

(`HarnessClient` comes from `./client`; add it to the type import if missing.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/shell/test/history-view.test.ts packages/ui/test/history-panel.test.tsx packages/ui/test/usage-tab.test.tsx packages/i18n`
Expected: PASS.

- [ ] **Step 6: Typecheck, full tests, build, commit**

Run: `corepack pnpm typecheck`, then `corepack pnpm test`, then `corepack pnpm app:build`
Expected: all green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/shell/src/main/history-view.ts packages/ui/src/client.ts packages/ui/src/HistoryPanel.tsx packages/ui/src/UsageTab.tsx packages/i18n/src/locales/es.json packages/i18n/src/locales/en.json packages/shell/test/history-view.test.ts packages/ui/test/history-panel.test.tsx packages/ui/test/usage-tab.test.tsx
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(ui): history filtered by scope and usage per scope" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 14: The `study` fixture, and `humanharness run` with scopes

**Files:**
- Create: `packages/fake-agent/fixtures/data-harness/harness.config.ts`, `packages/fake-agent/fixtures/data-harness/agent/AGENTS.md`, `packages/fake-agent/fixtures/data-harness/agent/tasks/study.md`, `packages/fake-agent/fixtures/data-harness/agent/tasks/onboarding.md`
- Modify: `packages/cli/src/run.ts`
- Test: `packages/cli/test/run.test.ts`

- [ ] **Step 1: The fixture**

Create `packages/fake-agent/fixtures/data-harness/harness.config.ts`:

```ts
// Test fixture for scopes and harness data: a tiny study harness with topics and an app-wide welcome.
import { z } from "zod";
import { defineBlock, defineHarness } from "@humanharness/harness-sdk";

const card = defineBlock({
  description: "Shows a card with a title to the person.",
  visible: true,
  schema: z.object({ title: z.string().min(1) }),
  example: { title: "Card" },
});

export default defineHarness({
  id: "study",
  name: { es: "Estudio", en: "Study" },
  core: "^0.1.0",
  languages: ["es", "en"],
  engines: ["claude", "codex"],
  folder: { suggested: "Documents/Human Harness Study" },
  instructions: "./agent/AGENTS.md",
  permissions: { edit: "folder", exec: false, web: false },
  blocks: { card },
  scopes: { label: { es: "tema", en: "topic" }, plural: { es: "temas", en: "topics" } },
  actions: {
    study: { label: { es: "Estudiar", en: "Study" }, prompt: "./agent/tasks/study.md", cost: "light" },
    onboarding: { label: { es: "Bienvenida", en: "Welcome" }, prompt: "./agent/tasks/onboarding.md", cost: "light", scope: "none" },
  },
  path: ["study"],
  author: "Human Harness tests",
});
```

Create `packages/fake-agent/fixtures/data-harness/agent/AGENTS.md`:

```markdown
# Study (test fixture)

Help the person study the open topic. Keep answers short.
```

Create `packages/fake-agent/fixtures/data-harness/agent/tasks/study.md`:

```markdown
# Task: study

Study the open topic with the person. Answer in {{language}}.

{{notesIndex}}
```

Create `packages/fake-agent/fixtures/data-harness/agent/tasks/onboarding.md`:

```markdown
# Task: onboarding

Ask the person what they want to study. Answer in {{language}}.

{{notesIndex}}
```

- [ ] **Step 2: Write the failing test**

In `packages/cli/test/run.test.ts`, add `import { fileURLToPath } from "node:url";` at the top. Inside `describe("runTask", …)`, add:

```ts
  it("runs a scoped harness's action in a `run` scope: its note, chat, usage and statuses are the scope's", { timeout: 60_000 }, async () => {
    const study = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/data-harness");
    const folder = path.join(root, "study-work");
    const scoped: ClaudeScript = {
      steps: [...claudeTextLines("Done."), result],
      turns: [
        {
          match: "save_note",
          steps: [ui("save_note", { title: "Halves", summary: ["A half is one of two parts"], decisions: [], files: [], open: [] }), ...claudeTextLines("Saved."), result],
        },
        { match: "# Task: study", steps: [...claudeTextLines("Let's study."), result] },
      ],
    };
    const out = memoryStream();
    await runTask({
      harnessDir: study,
      action: "study",
      engine: "claude",
      folder,
      input: lines("q\n"),
      output: out.stream,
      engineCommand: { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(root, scoped) } },
    });
    expect(out.text()).toContain("Let's study.");
    expect(fs.readFileSync(path.join(folder, ".harness", "notes", "run", "study.md"), "utf8")).toContain('title: "Halves"');
    expect(JSON.parse(fs.readFileSync(path.join(folder, ".harness", "scopes.json"), "utf8"))).toEqual([expect.objectContaining({ id: "run", title: "Run" })]);
    expect(fs.existsSync(path.join(folder, ".harness", "chats", "run.jsonl"))).toBe(true);
    expect(readJsonl(path.join(folder, ".harness", "usage.jsonl")).every((r) => r.scope === "run")).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(folder, ".harness", "tasks.json"), "utf8"))).toMatchObject({ open: "run", actions: {}, scopes: { run: { study: "done" } } });
  });
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/cli/test/run.test.ts -t "scoped harness"`
Expected: FAIL (`ScopeRequired`: no scope is open).

- [ ] **Step 4: Implement**

In `packages/cli/src/run.ts`:

1. Extend the imports:

```ts
import { LANGUAGES, type Language, TIERS, type Tier, actionScope, allBlocks, blockToolName, loadHarness, resolveInHarness } from "@humanharness/harness-sdk";
import { MAIN_SCOPE, ScopeStore, generatedFiles, migrateToScopes, notesPrefix, readNotes, writeNote } from "@humanharness/workspace";
```

2. Before `runTask`, add:

```ts
/** The scope `humanharness run` opens for a `required` action when none is open. */
export const RUN_SCOPE = "run";

/**
 * A harness with scopes (spec §3.2–3.3): earlier work in the folder moves into `main`, which opens, like the
 * app does. A `required` action with no open scope runs in `run` (registered when missing). Undefined: keep the
 * open scope.
 */
async function runScope(folder: string, required: boolean, open: string | undefined): Promise<string | undefined> {
  if (await migrateToScopes(folder)) return MAIN_SCOPE;
  if (!required || open) return undefined;
  const entry = await new ScopeStore(folder).add({ id: RUN_SCOPE, title: "Run", createdAt: new Date().toISOString(), archived: false });
  return entry.id;
}
```

3. After `const store = new TaskStore(folder);`, add:

```ts
  const scoped = harness.scopes !== undefined;
  const scopes = new ScopeStore(folder);
```

4. In the `TurnController` deps, replace `chatLog: async () => new ChatLog(folder, engine.id),` with:

```ts
    chatLog: async (chat) => new ChatLog(folder, engine.id, chat),
```

5. In the `TaskManager` deps, replace `notes` and `writeNote` with the following, and add `scoped` and `scopeExists`:

```ts
    scoped,
    scopeExists: async (id) => (await scopes.list()).some((s) => s.id === id && !s.archived),
    notes: (scope) => readNotes(folder, notesPrefix(scoped, scope)),
    writeNote: async (slug, note, meta, scope) => {
      recorder?.note(note as MockNote);
      lastNote = path.join(folder, await writeNote(folder, slug, note, meta, notesPrefix(scoped, scope)));
      notesWritten++;
    },
```

6. Replace `await tasks.start(o.action);` with:

```ts
      const scope = scoped ? await runScope(folder, actionScope(harness, o.action) === "required", (await store.load()).open) : undefined;
      await tasks.start(o.action, undefined, scope);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/cli/test/run.test.ts`
Expected: PASS. The template harness has no scopes, so the older tests run as before.

- [ ] **Step 6: Typecheck, full tests, commit**

Run: `corepack pnpm typecheck` then `corepack pnpm test`
Expected: both green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/fake-agent/fixtures/data-harness packages/cli/src/run.ts packages/cli/test/run.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(cli): run a scoped harness's action in its scope; study fixture" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

## Phase 2 — Data store (spec §6 slice 2)

### Task 15: Manifest `data` collections

**Files:**
- Create: `packages/harness-sdk/src/data.ts`
- Modify: `packages/harness-sdk/src/index.ts`, `packages/fake-agent/fixtures/data-harness/harness.config.ts`
- Test: `packages/harness-sdk/test/data.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/harness-sdk/test/data.test.ts`:

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COLLECTION_NAME, dataSchema, defineHarness, loadHarness, z } from "../src";

const base = {
  id: "test",
  name: { es: "Prueba", en: "Test" },
  core: "^0.1.0",
  languages: ["es", "en"] as ("es" | "en")[],
  engines: ["claude"],
  folder: { suggested: "Documents/Test" },
  instructions: "./AGENTS.md",
  permissions: { edit: "folder" as const, exec: false, web: false },
  blocks: {},
  author: "Someone",
};
const concept = z.object({ id: z.string(), name: z.string(), state: z.enum(["seen", "mastered"]) });

describe("data collections", () => {
  it("parses a collection with its defaults", () => {
    const data = dataSchema.parse({ concepts: { scoped: true, key: "id", schema: concept, agent: "write" } });
    expect(data.concepts).toMatchObject({ scoped: true, single: false, key: "id", agent: "write", context: false });
    expect(data.concepts.schema).toBe(concept);
  });

  it("is empty by default, so a harness without data is unchanged (spec D2)", () => {
    expect(defineHarness(base).data).toEqual({});
  });

  it("takes a single record with no key, a context with fields, and rules", () => {
    const rules = () => true as const;
    const data = dataSchema.parse({
      profile: { scoped: false, single: true, schema: z.object({ name: z.string() }), agent: "read", context: { fields: "all", tokens: 300 } },
      concepts: { scoped: true, key: "id", schema: concept, agent: "write", context: { fields: ["id", "state"], tokens: 400 }, rules },
    });
    expect(data.profile.context).toEqual({ fields: "all", tokens: 300 });
    expect(data.concepts.rules).toBe(rules);
  });

  it("refuses what can't work", () => {
    const bad = (collection: Record<string, unknown>, name = "concepts") => () => defineHarness({ ...base, data: { [name]: { scoped: true, schema: concept, agent: "write", ...collection } } as never });
    expect(bad({})).toThrow(/needs a key/);
    expect(bad({ key: "nope" })).toThrow(/not a field/);
    expect(bad({ key: "id", agent: "none", context: { fields: ["id"], tokens: 100 } })).toThrow(/hidden from the agent/);
    expect(bad({ key: "id", context: { fields: ["nope"], tokens: 100 } })).toThrow(/not a field/);
    expect(bad({ key: "id", context: { fields: ["id"], tokens: 10 } })).toThrow();
    expect(bad({ key: "id", schema: z.string() })).toThrow(/z\.object/);
    expect(bad({ key: "id" }, "settings")).toThrow(/reserved/);
    expect(bad({ key: "id" }, "Bad-Name")).toThrow();
    expect(COLLECTION_NAME.test("flash_cards")).toBe(true);
  });

  it("loads the study fixture's collections", async () => {
    const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/data-harness/harness.config.ts");
    const h = await loadHarness(fixture);
    expect(Object.keys(h.data)).toEqual(["concepts", "flashcards", "profile", "secrets"]);
    expect(h.data.profile.single).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/harness-sdk/test/data.test.ts`
Expected: FAIL (`dataSchema` is not exported).

- [ ] **Step 3: Implement**

Create `packages/harness-sdk/src/data.ts`:

```ts
import { z } from "zod";

/** A collection's name: it names a file (`<collection>.json`) and appears in the agent's tools. */
export const COLLECTION_NAME = /^[a-z][a-z0-9_]{0,39}$/;
/** Names the core keeps for itself: `settings` is the harness-settings collection (harness-settings spec). */
export const RESERVED_COLLECTIONS: readonly string[] = ["settings"];
/** What the agent may do with a collection (spec §4.1). */
export const DATA_AGENT = ["write", "read", "none"] as const;
export type DataAgent = (typeof DATA_AGENT)[number];

export type DataKey = string | number;
export type DataRecord = Record<string, unknown>;
/** Who makes a request: the agent (its tools), the person (the harness UI) or the app itself. */
export type DataWho = "agent" | "person" | "app";

/** What a collection's `rules` get besides the records (spec §4.3). */
export interface RulesContext {
  /** The running task's action, when the write comes from one. */
  action?: string;
  /** The scope the write is made in (`_app` for app-wide work). */
  scope: string;
  who: DataWho;
  /** A copy of another collection's records (same scope, or app-wide), taken before the rule ran. */
  records(collection: string): DataRecord[];
}

/**
 * A pure function: `true` accepts, a string refuses with that message (the agent gets it as its tool's error).
 * `next` is null for a delete; `prev` is null for a new record.
 */
export type DataRules = (next: DataRecord | null, prev: DataRecord | null, ctx: RulesContext) => true | string;

/** Orders records for the first message: the most related to the action first (spec §4.4). */
export type DataOrder = (records: DataRecord[], ctx: { action?: string }) => DataRecord[];

const contextSchema = z.union([
  z.literal(false),
  z.object({
    fields: z.union([z.literal("all"), z.array(z.string().min(1)).min(1)]),
    tokens: z.number().int().min(50).max(4000),
    order: z.custom<DataOrder>((f) => typeof f === "function", { message: "Expected a function" }).optional(),
  }),
]);

export const collectionSchema = z
  .object({
    /** One file per scope; false: one app-wide file. */
    scoped: z.boolean(),
    /** The collection holds one record (a profile, settings). */
    single: z.boolean().default(false),
    /** The field that identifies a record; required unless `single`. */
    key: z.string().min(1).optional(),
    schema: z.custom<z.ZodObject>((s) => s instanceof z.ZodObject, { message: "Expected a z.object(...) schema" }),
    agent: z.enum(DATA_AGENT),
    /** What goes into a task's first message; false: nothing. */
    context: contextSchema.default(false),
    rules: z.custom<DataRules>((f) => typeof f === "function", { message: "Expected a function" }).optional(),
  })
  .superRefine((c, ctx) => {
    const shape = c.schema instanceof z.ZodObject ? c.schema.shape : {};
    if (!c.single && c.key === undefined) ctx.addIssue({ code: "custom", path: ["key"], message: "A collection needs a key (or single: true)" });
    if (c.key !== undefined && !Object.hasOwn(shape, c.key)) ctx.addIssue({ code: "custom", path: ["key"], message: `"${c.key}" is not a field of the schema` });
    if (c.context !== false && c.agent === "none") {
      ctx.addIssue({ code: "custom", path: ["context"], message: 'A collection hidden from the agent (agent: "none") can\'t go into its context' });
    }
    if (c.context !== false && Array.isArray(c.context.fields)) {
      for (const f of c.context.fields) if (!Object.hasOwn(shape, f)) ctx.addIssue({ code: "custom", path: ["context", "fields"], message: `"${f}" is not a field of the schema` });
    }
  });

export type Collection = z.output<typeof collectionSchema>;
export type CollectionInput = z.input<typeof collectionSchema>;

/** The manifest's `data` (spec §4.1): collections by name. Empty by default (D2). */
export const dataSchema = z
  .record(z.string().regex(COLLECTION_NAME), collectionSchema)
  .default({})
  .superRefine((d, ctx) => {
    for (const name of Object.keys(d)) {
      if (RESERVED_COLLECTIONS.includes(name)) ctx.addIssue({ code: "custom", path: [name], message: `"${name}" is reserved by the core` });
    }
  });
```

In `packages/harness-sdk/src/index.ts`:

1. Add `export * from "./data";` after `export * from "./core-blocks";`, and `import { dataSchema } from "./data";` with the other imports.
2. In `manifestSchema`, after `scopes`, add:

```ts
  /** Structured records the harness keeps (spec §4): collections by name. */
  data: dataSchema,
```

- [ ] **Step 4: The fixture's collections**

In `packages/fake-agent/fixtures/data-harness/harness.config.ts`, add before `export default`:

```ts
const LEVELS = ["unseen", "seen", "practising", "mastered"];
const concept = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  state: z.enum(["unseen", "seen", "practising", "mastered"]),
  evidence: z.array(z.object({ kind: z.string(), date: z.string(), detail: z.string() })),
});
```

and after `path: ["study"],` add:

```ts
  data: {
    concepts: {
      scoped: true,
      key: "id",
      schema: concept,
      agent: "write",
      context: { fields: ["id", "name", "state"], tokens: 400 },
      // The student example (spec §4.3): the state rises only with a new evidence entry.
      rules: (next, prev) => {
        if (!next || !prev) return true;
        const rises = LEVELS.indexOf(String(next.state)) > LEVELS.indexOf(String(prev.state));
        const more = (next.evidence as unknown[]).length > (prev.evidence as unknown[]).length;
        return !rises || more ? true : "The state can rise only with a new evidence entry";
      },
    },
    flashcards: { scoped: true, key: "id", schema: z.object({ id: z.string(), front: z.string(), back: z.string() }), agent: "read" },
    profile: { scoped: false, single: true, schema: z.object({ name: z.string(), level: z.string() }), agent: "read", context: { fields: "all", tokens: 300 } },
    secrets: { scoped: false, key: "id", schema: z.object({ id: z.string(), note: z.string() }), agent: "none" },
  },
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `corepack pnpm vitest run packages/harness-sdk/test/data.test.ts packages/harness-sdk/test/harness.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, full tests, commit**

Run: `corepack pnpm typecheck` then `corepack pnpm test`
Expected: both green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/harness-sdk/src/data.ts packages/harness-sdk/src/index.ts packages/harness-sdk/test/data.test.ts packages/fake-agent/fixtures/data-harness/harness.config.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(sdk): manifest data collections" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 16: The data store

**Files:**
- Create: `packages/workspace/src/data.ts`
- Modify: `packages/workspace/src/layout.ts`, `packages/workspace/src/index.ts`
- Test: `packages/workspace/test/data.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/workspace/test/data.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { dataSchema, z } from "@humanharness/harness-sdk";
import { type DataChange, DataError, DataStore, dataPath, parseDataPath, runDataRequest } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const tmp = () => fs.mkdtempSync(path.join(root, "t-"));

const data = dataSchema.parse({
  concepts: { scoped: true, key: "id", schema: z.object({ id: z.string(), name: z.string(), state: z.enum(["seen", "mastered"]) }), agent: "write" },
  cards: { scoped: true, key: "n", schema: z.object({ n: z.number(), front: z.string() }), agent: "read" },
  profile: { scoped: false, single: true, schema: z.object({ name: z.string() }), agent: "read" },
  secrets: { scoped: false, key: "id", schema: z.object({ id: z.string() }), agent: "none" },
});
const person = { who: "person" as const, scope: "fracciones" };
const agent = { who: "agent" as const, scope: "fracciones" };
const file = (base: string, rel: string) => path.join(base, ...rel.split("/"));

describe("data paths", () => {
  it("puts each collection in its scope's folder", () => {
    expect(dataPath("fracciones", "concepts")).toBe(".harness/data/fracciones/concepts.json");
    expect(dataPath("_app", "profile")).toBe(".harness/data/_app/profile.json");
    expect(() => dataPath("../x", "concepts")).toThrow(/scope/);
    expect(() => dataPath("main", "../x")).toThrow(/collection/);
    expect(parseDataPath(".harness/data/fracciones/concepts.json")).toEqual({ scope: "fracciones", collection: "concepts" });
    expect(parseDataPath(".harness/notes/x.md")).toBeNull();
    expect(parseDataPath(".harness/data/Bad/concepts.json")).toBeNull();
  });
});

describe("DataStore", () => {
  it("stores records sorted by key, one block each, and reads them back", async () => {
    const base = tmp();
    const store = new DataStore(base, data);
    await store.put("concepts", { id: "b", name: "B", state: "seen", extra: "dropped" }, person);
    await store.put("concepts", { id: "a", name: "A", state: "seen" }, person);
    await store.put("concepts", { id: "b", name: "B2", state: "mastered" }, person);
    expect(fs.readFileSync(file(base, ".harness/data/fracciones/concepts.json"), "utf8")).toBe(
      `${JSON.stringify(
        [
          { id: "a", name: "A", state: "seen" },
          { id: "b", name: "B2", state: "mastered" },
        ],
        null,
        2,
      )}\n`,
    );
    expect(await store.get("concepts", "b", person)).toEqual({ id: "b", name: "B2", state: "mastered" });
    expect(await store.get("concepts", "zz", person)).toBeNull();
    // Another scope has its own file.
    expect(await store.get("concepts", "b", { who: "person", scope: "decimales" })).toBeNull();
  });

  it("sorts numeric keys as numbers", async () => {
    const store = new DataStore(tmp(), data);
    for (const n of [10, 2, 1]) await store.put("cards", { n, front: `f${n}` }, person);
    expect((await store.query("cards", {}, person)).records.map((r) => r.n)).toEqual([1, 2, 10]);
  });

  it("refuses an invalid record, a missing key, an unknown collection, and a scoped one without a scope", async () => {
    const store = new DataStore(tmp(), data);
    await expect(store.put("concepts", { id: "a", name: "A", state: "nope" }, person)).rejects.toThrow(/state/);
    await expect(store.put("concepts", { name: "A", state: "seen" }, person)).rejects.toThrow(/id/);
    await expect(store.put("nope", {}, person)).rejects.toMatchObject({ code: "unknown-collection" });
    await expect(store.put("concepts", { id: "a", name: "A", state: "seen" }, { who: "person", scope: "_app" })).rejects.toMatchObject({ code: "no-scope" });
  });

  it("lets the agent write only `write` collections and read none of the `none` ones", async () => {
    const store = new DataStore(tmp(), data);
    await expect(store.put("cards", { n: 1, front: "x" }, agent)).rejects.toMatchObject({ code: "refused" });
    await expect(store.put("profile", { name: "Ana" }, agent)).rejects.toMatchObject({ code: "refused" });
    await expect(store.query("secrets", {}, agent)).rejects.toMatchObject({ code: "refused" });
    await store.put("cards", { n: 1, front: "x" }, person);
    expect(await store.get("cards", 1, agent)).toEqual({ n: 1, front: "x" });
    expect(await store.put("concepts", { id: "a", name: "A", state: "seen" }, agent)).toEqual({ id: "a", name: "A", state: "seen" });
  });

  it("patches a record, keeps its key, and deletes", async () => {
    const store = new DataStore(tmp(), data);
    await store.put("concepts", { id: "a", name: "A", state: "seen" }, person);
    expect(await store.patch("concepts", "a", { state: "mastered" }, person)).toEqual({ id: "a", name: "A", state: "mastered" });
    await expect(store.patch("concepts", "a", { id: "b" }, person)).rejects.toThrow(/can't change/);
    await expect(store.patch("concepts", "zz", { state: "seen" }, person)).rejects.toMatchObject({ code: "not-found" });
    await expect(store.patch("concepts", "a", { state: "nope" }, person)).rejects.toMatchObject({ code: "invalid" });
    expect(await store.delete("concepts", "a", person)).toBe(true);
    expect(await store.delete("concepts", "a", person)).toBe(false);
    expect((await store.query("concepts", {}, person)).records).toEqual([]);
  });

  it("keeps a single record app-wide, whatever the scope, and removes its file on delete", async () => {
    const base = tmp();
    const store = new DataStore(base, data);
    await store.put("profile", { name: "Ana" }, person);
    expect(await store.get("profile", undefined, { who: "person", scope: "_app" })).toEqual({ name: "Ana" });
    expect(JSON.parse(fs.readFileSync(file(base, ".harness/data/_app/profile.json"), "utf8"))).toEqual({ name: "Ana" });
    expect(await store.patch("profile", undefined, { name: "Ana B" }, person)).toEqual({ name: "Ana B" });
    expect(await store.delete("profile", undefined, person)).toBe(true);
    expect(fs.existsSync(file(base, ".harness/data/_app/profile.json"))).toBe(false);
  });

  it("queries with equality, `in`, fields (the key always comes) and a bounded limit", async () => {
    const store = new DataStore(tmp(), data);
    for (const [id, state] of [["a", "seen"], ["b", "mastered"], ["c", "seen"]]) await store.put("concepts", { id, name: id.toUpperCase(), state }, person);
    expect(await store.query("concepts", { where: { state: "seen" }, fields: ["name"] }, person)).toEqual({
      records: [
        { id: "a", name: "A" },
        { id: "c", name: "C" },
      ],
      total: 2,
      invalid: 0,
    });
    expect((await store.query("concepts", { where: { id: { in: ["b", "c"] } } }, person)).total).toBe(2);
    expect((await store.query("concepts", { limit: 1 }, person)).records).toHaveLength(1);
    expect((await store.query("concepts", { limit: 1 }, person)).total).toBe(3);
    expect((await store.query("concepts", { limit: 10_000 }, person)).records).toHaveLength(3);
  });

  it("reads a hand-edited file again on every call, skips invalid records and refuses writes until it is fixed (spec §7.3)", async () => {
    const base = tmp();
    const store = new DataStore(base, data);
    await store.put("concepts", { id: "a", name: "A", state: "seen" }, person);
    const f = file(base, ".harness/data/fracciones/concepts.json");
    fs.writeFileSync(f, JSON.stringify([{ id: "a", name: "A", state: "seen" }, { id: "b", name: "B", state: "broken" }]));
    expect(await store.query("concepts", {}, person)).toMatchObject({ total: 1, invalid: 1 });
    await expect(store.put("concepts", { id: "c", name: "C", state: "seen" }, person)).rejects.toMatchObject({ code: "broken-file" });
    fs.writeFileSync(f, "{not json");
    await expect(store.put("concepts", { id: "c", name: "C", state: "seen" }, person)).rejects.toThrow(/\.harness\/data\/fracciones\/concepts\.json/);
    fs.writeFileSync(f, JSON.stringify([{ id: "a", name: "A by hand", state: "seen" }]));
    expect(await store.get("concepts", "a", person)).toMatchObject({ name: "A by hand" });
    await store.put("concepts", { id: "c", name: "C", state: "seen" }, person);
  });

  it("serializes writes, stamps when each record changed, and tells listeners", async () => {
    const base = tmp();
    let t = 0;
    const store = new DataStore(base, data, { now: () => new Date(Date.UTC(2026, 9, 25, 10, 0, t++)) });
    const changes: DataChange[] = [];
    const off = store.onChange((c) => changes.push(c));
    await Promise.all(["a", "b", "c"].map((id) => store.put("concepts", { id, name: id, state: "seen" }, agent)));
    expect((await store.query("concepts", {}, person)).total).toBe(3);
    expect(Object.keys(await store.changedAt("concepts", "fracciones")).sort()).toEqual(["a", "b", "c"]);
    expect(fs.readdirSync(file(base, ".harness/data/fracciones")).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(changes[0]).toEqual({ collection: "concepts", scope: "fracciones", who: "agent", op: "put", key: "a" });
    off();
    await store.delete("concepts", "a", person);
    expect(changes).toHaveLength(3);
    expect(Object.keys(await store.changedAt("concepts", "fracciones")).sort()).toEqual(["b", "c"]);
  });
});

describe("runDataRequest", () => {
  it("runs a request from the tools or the client, and refuses one that isn't", async () => {
    const store = new DataStore(tmp(), data);
    expect(await runDataRequest(store, { op: "put", collection: "concepts", record: { id: "a", name: "A", state: "seen" } }, agent)).toMatchObject({ id: "a" });
    expect(await runDataRequest(store, { op: "get", collection: "concepts", key: "a" }, agent)).toMatchObject({ id: "a" });
    expect(await runDataRequest(store, { op: "query", collection: "concepts", where: { state: "seen" } }, agent)).toMatchObject({ total: 1 });
    expect(await runDataRequest(store, { op: "patch", collection: "concepts", key: "a", patch: { name: "A2" } }, agent)).toMatchObject({ name: "A2" });
    expect(await runDataRequest(store, { op: "delete", collection: "concepts", key: "a" }, agent)).toBe(true);
    await expect(runDataRequest(store, { op: "drop", collection: "concepts" }, agent)).rejects.toBeInstanceOf(DataError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/workspace/test/data.test.ts`
Expected: FAIL (`DataStore` is not exported).

- [ ] **Step 3: Data paths in the layout**

In `packages/workspace/src/layout.ts`, add the import `import { COLLECTION_NAME } from "@humanharness/harness-sdk";` at the top and, at the end:

```ts
/** Where harness data lives, relative to the base: `<scope>/<collection>.json`. Tracked by the history (spec D4). */
export const DATA_PREFIX = ".harness/data/";
/** When each record last changed (for "most recently changed", spec §4.4). Never tracked. */
export const DATA_META_PREFIX = ".harness/data-meta/";

function collectionName(name: string): string {
  if (!COLLECTION_NAME.test(name)) throw new Error(`Invalid collection: "${name}"`);
  return name;
}

/** A collection file's path relative to the base (forward slashes, as the history shows it). */
export const dataPath = (scope: string, collection: string): string => `${DATA_PREFIX}${scopeDir(scope)}/${collectionName(collection)}.json`;
export const dataFile = (base: string, scope: string, collection: string): string => path.join(base, ...dataPath(scope, collection).split("/"));
export const dataMetaFile = (base: string, scope: string, collection: string): string =>
  path.join(base, ".harness", "data-meta", scopeDir(scope), `${collectionName(collection)}.json`);

/** The scope and collection of a `.harness/data/<scope>/<collection>.json` path; null for anything else. */
export function parseDataPath(rel: string): { scope: string; collection: string } | null {
  const m = /^\.harness\/data\/([^/]+)\/([^/]+)\.json$/.exec(rel);
  return m && isScopeDir(m[1]) && COLLECTION_NAME.test(m[2]) ? { scope: m[1], collection: m[2] } : null;
}
```

- [ ] **Step 4: The store**

Create `packages/workspace/src/data.ts`:

```ts
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { type Collection, type DataKey, type DataRecord, type DataWho, z } from "@humanharness/harness-sdk";
import { APP_SCOPE, dataFile, dataMetaFile, dataPath } from "./layout";

export type DataErrorCode = "unknown-collection" | "refused" | "invalid" | "not-found" | "broken-file" | "no-scope";

/** A refused data request; its message goes back to whoever asked (the agent's tool error, the harness UI). */
export class DataError extends Error {
  constructor(
    readonly code: DataErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DataError";
  }
}

/** Who asks, and in which scope (the running task's for the agent; the open one for the person). */
export interface DataContext {
  who: DataWho;
  scope: string;
  action?: string;
}

export interface DataQuery {
  /** Equality (`{ state: "seen" }`) or membership (`{ id: { in: ["a", "b"] } }`) only (spec §4.4). */
  where?: Record<string, unknown>;
  /** The fields to return; the key always comes. */
  fields?: string[];
  limit?: number;
}

export interface DataQueryResult {
  records: DataRecord[];
  /** Matches before the limit. */
  total: number;
  /** Records in the file that fail the schema (a hand edit): skipped. */
  invalid: number;
}

export interface DataChange {
  collection: string;
  scope: string;
  who: DataWho;
  op: "put" | "patch" | "delete";
  key?: DataKey;
}

export const QUERY_LIMIT = 50;
export const QUERY_MAX = 200;

interface Loaded {
  records: DataRecord[];
  invalid: number;
  /** Not JSON, or not the shape of the collection (an array, or one object for `single`). */
  broken: boolean;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isKey = (v: unknown): v is DataKey => (typeof v === "string" && v.length > 0) || (typeof v === "number" && Number.isFinite(v));
const issues = (e: z.ZodError): string => e.issues.map((i) => `${i.path.join(".") || "(record)"}: ${i.message}`).join("; ");

function byKey(key: string) {
  return (a: DataRecord, b: DataRecord): number => {
    const x = a[key];
    const y = b[key];
    if (typeof x === "number" && typeof y === "number") return x - y;
    const s = String(x);
    const t = String(y);
    return s < t ? -1 : s > t ? 1 : 0;
  };
}

async function writeAtomic(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, text);
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

/**
 * The harness's data (spec §4): one JSON file per collection and scope under `<base>/.harness/data/`. Nothing is
 * cached: every call reads the file again, so a hand edit is seen at once (§7.3). Writes are checked (permission,
 * schema, key, and from Task 19 the harness's rules), atomic, and one at a time.
 */
export class DataStore {
  private writes: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<(change: DataChange) => void>();

  constructor(
    private readonly base: string,
    private readonly collections: Record<string, Collection>,
    private readonly opts: { now?: () => Date; log?: (message: string) => void } = {},
  ) {}

  /** Called after every write, from any writer (spec §4.5 `subscribe`). */
  onChange(listener: (change: DataChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  collection(name: string): Collection {
    if (!Object.hasOwn(this.collections, name)) throw new DataError("unknown-collection", `There is no collection "${name}"`);
    return this.collections[name];
  }

  /** The scope folder a request made in `scope` acts on: `_app` for app-wide collections. */
  scopeFor(name: string, scope: string): string {
    const c = this.collection(name);
    if (!c.scoped) return APP_SCOPE;
    if (scope === APP_SCOPE) throw new DataError("no-scope", `"${name}" belongs to a scope: open one first`);
    return scope;
  }

  /** Every valid record of a collection in a scope folder, with no permission check (context, rules, diffs). */
  async readAll(name: string, scope: string): Promise<{ records: DataRecord[]; invalid: number }> {
    const { records, invalid } = await this.load(name, this.collection(name), scope);
    return { records, invalid };
  }

  async get(name: string, key: DataKey | undefined, ctx: DataContext): Promise<DataRecord | null> {
    const c = this.readable(name, ctx);
    const { records } = await this.load(name, c, this.scopeFor(name, ctx.scope));
    if (c.single) return records[0] ?? null;
    return records.find((r) => r[c.key!] === key) ?? null;
  }

  async query(name: string, q: DataQuery, ctx: DataContext): Promise<DataQueryResult> {
    const c = this.readable(name, ctx);
    const { records, invalid } = await this.load(name, c, this.scopeFor(name, ctx.scope));
    const where = Object.entries(q.where ?? {});
    const matches = records.filter((r) =>
      where.every(([field, cond]) => (isObject(cond) && Array.isArray(cond.in) ? cond.in.includes(r[field]) : r[field] === cond)),
    );
    const limit = Math.min(Math.max(1, Math.trunc(q.limit ?? QUERY_LIMIT)), QUERY_MAX);
    const fields = q.fields?.length ? [...new Set([...(c.key ? [c.key] : []), ...q.fields])] : null;
    const pick = (r: DataRecord): DataRecord => (fields ? Object.fromEntries(fields.filter((f) => Object.hasOwn(r, f)).map((f) => [f, r[f]])) : r);
    return { records: matches.slice(0, limit).map(pick), total: matches.length, invalid };
  }

  /** Creates the record, or replaces the one with the same key (spec §4.3). */
  put(name: string, record: unknown, ctx: DataContext): Promise<DataRecord> {
    return this.serialize(async () => {
      const c = this.writable(name, ctx);
      const scope = this.scopeFor(name, ctx.scope);
      const next = this.parse(name, c, record);
      const key = c.single ? undefined : this.keyOf(c, next);
      const file = await this.loadForWrite(name, c, scope);
      const records = c.single ? [next] : [...file.records.filter((r) => r[c.key!] !== key), next];
      await this.save(name, c, scope, records);
      await this.touch(name, scope, key, true);
      this.emit({ collection: name, scope, who: ctx.who, op: "put", ...(key !== undefined ? { key } : {}) });
      return next;
    });
  }

  /** Merges `patch` into the record with `key` (the one record of a `single` collection); the key can't change. */
  patch(name: string, key: DataKey | undefined, patch: unknown, ctx: DataContext): Promise<DataRecord> {
    return this.serialize(async () => {
      const c = this.writable(name, ctx);
      const scope = this.scopeFor(name, ctx.scope);
      if (!isObject(patch)) throw new DataError("invalid", "A patch is an object of fields");
      const file = await this.loadForWrite(name, c, scope);
      const prev = c.single ? file.records[0] : file.records.find((r) => r[c.key!] === key);
      if (!prev) throw new DataError("not-found", c.single ? `"${name}" has no record yet` : `"${name}" has no record "${String(key)}"`);
      if (!c.single && Object.hasOwn(patch, c.key!) && patch[c.key!] !== key) throw new DataError("invalid", `The key "${c.key}" can't change`);
      const next = this.parse(name, c, { ...prev, ...patch });
      const records = c.single ? [next] : file.records.map((r) => (r[c.key!] === key ? next : r));
      await this.save(name, c, scope, records);
      await this.touch(name, scope, key, true);
      this.emit({ collection: name, scope, who: ctx.who, op: "patch", ...(key !== undefined && !c.single ? { key } : {}) });
      return next;
    });
  }

  /** False when there was no such record. Deleting a `single` collection's record removes its file. */
  delete(name: string, key: DataKey | undefined, ctx: DataContext): Promise<boolean> {
    return this.serialize(async () => {
      const c = this.writable(name, ctx);
      const scope = this.scopeFor(name, ctx.scope);
      const file = await this.loadForWrite(name, c, scope);
      const prev = c.single ? file.records[0] : file.records.find((r) => r[c.key!] === key);
      if (!prev) return false;
      if (c.single) await fs.rm(dataFile(this.base, scope, name), { force: true });
      else await this.save(name, c, scope, file.records.filter((r) => r[c.key!] !== key));
      await this.touch(name, scope, c.single ? undefined : key, false);
      this.emit({ collection: name, scope, who: ctx.who, op: "delete", ...(key !== undefined && !c.single ? { key } : {}) });
      return true;
    });
  }

  /** When each record last changed, by key (`""` for a `single` record). Best effort: {} when unknown. */
  async changedAt(name: string, scope: string): Promise<Record<string, string>> {
    try {
      const raw: unknown = JSON.parse(await fs.readFile(dataMetaFile(this.base, scope, name), "utf8"));
      return isObject(raw) ? Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === "string")) : {};
    } catch {
      return {};
    }
  }

  /** The agent reads every collection except `none` ones (spec §4.1). */
  private readable(name: string, ctx: DataContext): Collection {
    const c = this.collection(name);
    if (ctx.who === "agent" && c.agent === "none") throw new DataError("refused", `"${name}" is not available to the agent`);
    return c;
  }

  /** Checked first (spec §4.3, check 4): the agent writes only `write` collections. */
  private writable(name: string, ctx: DataContext): Collection {
    const c = this.collection(name);
    if (ctx.who === "agent" && c.agent !== "write") throw new DataError("refused", `The agent may not change "${name}": it is ${c.agent === "read" ? "read-only" : "hidden"} for the agent`);
    return c;
  }

  private parse(name: string, c: Collection, record: unknown): DataRecord {
    const parsed = c.schema.safeParse(record);
    if (!parsed.success) throw new DataError("invalid", `Not a valid "${name}" record: ${issues(parsed.error)}`);
    return parsed.data as DataRecord;
  }

  private keyOf(c: Collection, record: DataRecord): DataKey {
    const key = record[c.key!];
    if (!isKey(key)) throw new DataError("invalid", `The key "${c.key}" is missing`);
    return key;
  }

  private async load(name: string, c: Collection, scope: string): Promise<Loaded> {
    let text: string;
    try {
      text = await fs.readFile(dataFile(this.base, scope, name), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { records: [], invalid: 0, broken: false };
      throw err;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return { records: [], invalid: 0, broken: true };
    }
    const list = c.single ? [raw] : Array.isArray(raw) ? raw : null;
    if (!list) return { records: [], invalid: 0, broken: true };
    const records: DataRecord[] = [];
    let invalid = 0;
    for (const item of list) {
      const parsed = c.schema.safeParse(item);
      if (parsed.success && (c.single || isKey((parsed.data as DataRecord)[c.key!]))) records.push(parsed.data as DataRecord);
      else invalid++;
    }
    return { records, invalid, broken: false };
  }

  /** A file a person broke by hand is never overwritten: they fix it, or go back in History (§7.3). */
  private async loadForWrite(name: string, c: Collection, scope: string): Promise<Loaded> {
    const file = await this.load(name, c, scope);
    if (file.broken || file.invalid > 0) {
      throw new DataError("broken-file", `${dataPath(scope, name)} was changed by hand and no longer matches "${name}": fix it, or go back in History`);
    }
    return file;
  }

  /** Sorted by key, two-space indented, one record per block, so history diffs stay readable (spec §4.2). */
  private async save(name: string, c: Collection, scope: string, records: DataRecord[]): Promise<void> {
    const value = c.single ? records[0] : [...records].sort(byKey(c.key!));
    await writeAtomic(dataFile(this.base, scope, name), `${JSON.stringify(value, null, 2)}\n`);
  }

  private async touch(name: string, scope: string, key: DataKey | undefined, changed: boolean): Promise<void> {
    try {
      const stamps = await this.changedAt(name, scope);
      const id = key === undefined ? "" : String(key);
      if (changed) stamps[id] = (this.opts.now?.() ?? new Date()).toISOString();
      else delete stamps[id];
      await writeAtomic(dataMetaFile(this.base, scope, name), `${JSON.stringify(stamps)}\n`);
    } catch (err) {
      this.log(`Could not stamp the change in "${name}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private emit(change: DataChange): void {
    for (const l of this.listeners) {
      try {
        l(change);
      } catch (err) {
        this.log(`A data listener failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private log(message: string): void {
    (this.opts.log ?? console.error)(message);
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writes.then(fn, fn);
    this.writes = run.catch(() => undefined);
    return run;
  }
}

const key = z.union([z.string().min(1), z.number()]);
const fields = z.record(z.string(), z.unknown());

/** A request from the agent's tools (over the RPC socket) or the harness UI (over IPC). */
export const dataRequestSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("get"), collection: z.string(), key: key.optional() }),
  z.object({ op: z.literal("query"), collection: z.string(), where: fields.optional(), fields: z.array(z.string()).optional(), limit: z.number().optional() }),
  z.object({ op: z.literal("put"), collection: z.string(), record: fields }),
  z.object({ op: z.literal("patch"), collection: z.string(), key: key.optional(), patch: fields }),
  z.object({ op: z.literal("delete"), collection: z.string(), key: key.optional() }),
]);
export type DataRequest = z.output<typeof dataRequestSchema>;

export const isDataWrite = (request: unknown): boolean =>
  isObject(request) && (request.op === "put" || request.op === "patch" || request.op === "delete");

/** Runs one request against the store, as `ctx` (who asks, in which scope). */
export async function runDataRequest(store: DataStore, request: unknown, ctx: DataContext): Promise<unknown> {
  const parsed = dataRequestSchema.safeParse(request);
  if (!parsed.success) throw new DataError("invalid", `Not a data request: ${issues(parsed.error)}`);
  const r = parsed.data;
  switch (r.op) {
    case "get":
      return store.get(r.collection, r.key, ctx);
    case "query":
      return store.query(r.collection, { ...(r.where ? { where: r.where } : {}), ...(r.fields ? { fields: r.fields } : {}), ...(r.limit !== undefined ? { limit: r.limit } : {}) }, ctx);
    case "put":
      return store.put(r.collection, r.record, ctx);
    case "patch":
      return store.patch(r.collection, r.key, r.patch, ctx);
    case "delete":
      return store.delete(r.collection, r.key, ctx);
  }
}
```

In `packages/workspace/src/index.ts`, add `export * from "./data";`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `corepack pnpm vitest run packages/workspace/test/data.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, full tests, commit**

Run: `corepack pnpm typecheck` then `corepack pnpm test`
Expected: both green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/workspace/src/data.ts packages/workspace/src/layout.ts packages/workspace/src/index.ts packages/workspace/test/data.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(workspace): the data store with permission, schema and key checks" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 17: The history tracks `.harness/data/`

**Files:**
- Modify: `packages/workspace/src/history.ts`, `packages/workspace/src/subjects.ts`, `packages/runtime/src/runtime.ts`, `packages/shell/src/main/index.ts` (`standaloneHistory`), `packages/ui/src/client.ts` (subject re-export), `packages/ui/src/HistoryPanel.tsx`, `packages/i18n/src/locales/es.json`, `packages/i18n/src/locales/en.json`
- Test: `packages/workspace/test/history.test.ts`, `packages/ui/test/history-panel.test.tsx`

- [ ] **Step 1: Write the failing tests**

At the end of `packages/workspace/test/history.test.ts`, add (add `DATA_PREFIX` and `NOTES_PREFIX` to the import from `../src`, and `os`/`path` if missing):

```ts
describe("data in the history", () => {
  it("tracks .harness/data/ like the notes, never its temp files or the data-meta stamps", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
    const folder = path.join(dir, "Work");
    fs.mkdirSync(path.join(folder, ".harness", "data", "main"), { recursive: true });
    fs.mkdirSync(path.join(folder, ".harness", "data-meta", "main"), { recursive: true });
    fs.writeFileSync(path.join(folder, ".harness", "data", "main", "concepts.json"), "[]\n");
    fs.writeFileSync(path.join(folder, ".harness", "data", "main", "concepts.json.0a1b2c3d-1111-2222-3333-444455556666.tmp"), "[");
    fs.writeFileSync(path.join(folder, ".harness", "data-meta", "main", "concepts.json"), "{}\n");
    fs.writeFileSync(path.join(folder, ".harness", "tasks.json"), "{}");
    const h = new History(folder, path.join(dir, "git"), [".harness/"], [NOTES_PREFIX, DATA_PREFIX]);
    await h.init();
    await h.save("Data: concepts");
    expect(await h.trackedFiles()).toEqual([".harness/data/main/concepts.json"]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
```

In `packages/ui/test/history-panel.test.tsx`, add to the `entryLabel` tests (or as a new `it` in the file):

```ts
  it("tells a data change in plain words", () => {
    expect(entryLabel("Data: concepts")).toEqual({ key: "history.entry.data", values: { collection: "concepts" } });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run packages/workspace/test/history.test.ts packages/ui/test/history-panel.test.tsx`
Expected: FAIL (the temp file is tracked; `entryLabel` returns null).

- [ ] **Step 3: Implement**

In `packages/workspace/src/subjects.ts`, add at the end:

```ts
/** A change the person made to the harness's data; the collection's name follows. */
export const DATA_CHANGE_PREFIX = "Data: ";
```

In `packages/workspace/src/history.ts`:

1. Change the layout import to `import { DATA_PREFIX, NOTES_PREFIX, isScopeDir } from "./layout";`.
2. Replace `isNoteTempFile` with:

```ts
/**
 * The temp files `writeNote` and the data store rename into place (`<file>.md.<uuid>.tmp`, `<file>.json.<uuid>.tmp`);
 * the person's own `.tmp` files stay tracked.
 */
const isAppTempFile = (file: string): boolean =>
  (file.startsWith(NOTES_PREFIX) && /\.md\.[0-9a-f-]+\.tmp$/.test(file.slice(NOTES_PREFIX.length))) ||
  (file.startsWith(DATA_PREFIX) && /\.json\.[0-9a-f-]+\.tmp$/.test(file.slice(DATA_PREFIX.length)));
```

and in `tracked` replace `!isNoteTempFile(file) &&` with `!isAppTempFile(file) &&`.

In `packages/runtime/src/runtime.ts`, add `DATA_PREFIX` to the workspace import and replace the history line with:

```ts
  // The history skips the app's files under .harness/ (except the notes and the data) and the generated instructions.
  const history = new History(folder, opts.gitdir, [".harness/", ...generated], [NOTES_PREFIX, DATA_PREFIX]);
```

In `packages/shell/src/main/index.ts`, add `DATA_PREFIX` to the workspace import and, in `standaloneHistory`, replace `[NOTES_PREFIX]` with `[NOTES_PREFIX, DATA_PREFIX]`.

In `packages/ui/src/client.ts`, add `DATA_CHANGE_PREFIX` to the subjects re-export line.

In `packages/ui/src/HistoryPanel.tsx`, import `DATA_CHANGE_PREFIX` from `./client` and, in `entryLabel`, before the `NOTE` check, add:

```ts
  if (message.startsWith(DATA_CHANGE_PREFIX)) return { key: "history.entry.data", values: { collection: message.slice(DATA_CHANGE_PREFIX.length) } };
```

In `en.json`, under `history.entry`, add `"data": "Changed {{collection}}"`; in `es.json`, `"data": "Cambió {{collection}}"`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/workspace/test/history.test.ts packages/ui/test/history-panel.test.tsx packages/runtime packages/i18n`
Expected: PASS.

- [ ] **Step 5: Typecheck, full tests, build, commit**

Run: `corepack pnpm typecheck`, then `corepack pnpm test`, then `corepack pnpm app:build`
Expected: all green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/workspace/src/history.ts packages/workspace/src/subjects.ts packages/runtime/src/runtime.ts packages/shell/src/main/index.ts packages/ui/src/client.ts packages/ui/src/HistoryPanel.tsx packages/i18n/src/locales/es.json packages/i18n/src/locales/en.json packages/workspace/test/history.test.ts packages/ui/test/history-panel.test.tsx
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(workspace): the history tracks the harness data" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 18: `HarnessClient.data` and the person's writes

**Files:**
- Create: `packages/shell/src/main/data-requests.ts`
- Modify: `packages/ui/src/client.ts`, `packages/ui/test/fake-client.ts`, `packages/shell/src/main/index.ts`, `packages/shell/src/preload/index.ts`
- Test: `packages/shell/test/data-requests.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shell/test/data-requests.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { dataSchema, z } from "@humanharness/harness-sdk";
import { DataStore, type HistoryTrailer } from "@humanharness/workspace";
import { type PersonDataDeps, personDataRequest } from "../src/main/data-requests";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const data = dataSchema.parse({
  concepts: { scoped: true, key: "id", schema: z.object({ id: z.string(), name: z.string() }), agent: "write" },
  profile: { scoped: false, single: true, schema: z.object({ name: z.string() }), agent: "read" },
});

function setup(opts: { blocked?: string; trailer?: HistoryTrailer; open?: string } = {}) {
  const store = new DataStore(fs.mkdtempSync(path.join(root, "t-")), data);
  const commits: { message: string; trailer?: HistoryTrailer }[] = [];
  const deps: PersonDataDeps = {
    store: async () => store,
    chatScope: async () => opts.open ?? "fracciones",
    trailer: async () => opts.trailer,
    saveHistory: async (message, trailer) => void commits.push({ message, ...(trailer ? { trailer } : {}) }),
    blocked: () => opts.blocked ?? null,
  };
  return { store, deps, commits };
}

describe("personDataRequest", () => {
  it("writes in the open scope and records a Data commit tagged with the open task", async () => {
    const t = setup({ trailer: { task: "t1", action: "study", scope: "fracciones" } });
    await personDataRequest(t.deps, { op: "put", collection: "concepts", record: { id: "a", name: "A" } }, undefined);
    expect(await t.store.get("concepts", "a", { who: "person", scope: "fracciones" })).toEqual({ id: "a", name: "A" });
    expect(t.commits).toEqual([{ message: "Data: concepts", trailer: { task: "t1", action: "study", scope: "fracciones" } }]);
  });

  it("takes another scope when asked, reads with no commit, and writes read-only collections as the person", async () => {
    const t = setup();
    await personDataRequest(t.deps, { op: "put", collection: "concepts", record: { id: "a", name: "A" } }, { scope: "decimales" });
    expect(await t.store.get("concepts", "a", { who: "person", scope: "decimales" })).not.toBeNull();
    expect(await personDataRequest(t.deps, { op: "get", collection: "concepts", key: "a" }, { scope: "decimales" })).toMatchObject({ id: "a" });
    await personDataRequest(t.deps, { op: "put", collection: "profile", record: { name: "Ana" } }, undefined);
    expect(t.commits.map((c) => c.message)).toEqual(["Data: concepts", "Data: profile"]);
    expect(t.commits[0]).not.toHaveProperty("trailer");
  });

  it("refuses writes while turns are blocked, and a bad scope", async () => {
    const t = setup({ blocked: "A restore is running" });
    await expect(personDataRequest(t.deps, { op: "put", collection: "concepts", record: { id: "a", name: "A" } }, undefined)).rejects.toThrow(/restore/);
    expect(await personDataRequest(t.deps, { op: "query", collection: "concepts" }, undefined)).toMatchObject({ total: 0 });
    await expect(personDataRequest(setup().deps, { op: "get", collection: "concepts", key: "a" }, { scope: "../x" })).rejects.toThrow(/scope/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/shell/test/data-requests.test.ts`
Expected: FAIL (the module doesn't exist).

- [ ] **Step 3: Implement the request handler**

Create `packages/shell/src/main/data-requests.ts`:

```ts
import { DATA_CHANGE_PREFIX, type DataStore, type HistoryTrailer, isDataWrite, isScopeDir, runDataRequest } from "@humanharness/workspace";

export interface PersonDataDeps {
  /** The configured folder's data store; null when the app isn't set up. */
  store(): Promise<DataStore | null>;
  /** The open scope's (`_app` when none is open; `main` without scopes): the default for the person's requests. */
  chatScope(): Promise<string>;
  /** The open task's history trailer, if a task is open. */
  trailer(): Promise<HistoryTrailer | undefined>;
  saveHistory(message: string, trailer?: HistoryTrailer): Promise<void>;
  /** Why writes can't run now (a restore, a folder move, an engine change), or null. */
  blocked(): string | null;
}

/**
 * A request from the harness UI (spec §4.5): it runs as the person, in `options.scope` or the open scope, through
 * the same checks as the agent's. Each write is recorded in the history as `Data: <collection>`, with the open
 * task's trailer, so it is undone with that task. Writes are refused while turns are blocked.
 */
export async function personDataRequest(d: PersonDataDeps, request: unknown, options: unknown): Promise<unknown> {
  const write = isDataWrite(request);
  if (write) {
    const blocked = d.blocked();
    if (blocked) throw new Error(blocked);
  }
  const asked = typeof options === "object" && options !== null ? (options as { scope?: unknown }).scope : undefined;
  if (asked !== undefined && !isScopeDir(asked)) throw new Error("Unknown scope");
  const store = await d.store();
  if (!store) throw new Error("The app is not set up yet");
  const scope = asked ?? (await d.chatScope());
  const result = await runDataRequest(store, request, { who: "person", scope });
  if (write) {
    const collection = String((request as { collection: unknown }).collection);
    try {
      await d.saveHistory(`${DATA_CHANGE_PREFIX}${collection}`, await d.trailer());
    } catch (err) {
      console.error("Could not record the data change in the history", err);
    }
  }
  return result;
}
```

(`DATA_CHANGE_PREFIX` comes from `@humanharness/workspace`, which re-exports `subjects`.)

- [ ] **Step 4: The client contract**

In `packages/ui/src/client.ts`, add before `HarnessClient`:

```ts
export type DataKey = string | number;
export type DataRecord = Record<string, unknown>;
export interface DataQuery {
  /** Equality (`{ state: "seen" }`) or membership (`{ id: { in: ["a", "b"] } }`). */
  where?: Record<string, unknown>;
  /** The fields to return; the key always comes. */
  fields?: string[];
  /** Default 50, at most 200. */
  limit?: number;
}
export interface DataQueryResult {
  records: DataRecord[];
  total: number;
  /** Records a hand edit broke: skipped. */
  invalid: number;
}
/** A write to the harness's data, from anyone (spec §4.5). */
export interface DataChangeView {
  collection: string;
  scope: string;
  who: "agent" | "person" | "app";
  op: "put" | "patch" | "delete";
  key?: DataKey;
}
/** Default: the open scope. App-wide collections ignore it. */
export interface DataOptions {
  scope?: string;
}
```

and in `HarnessClient`, after `scopes`, add:

```ts
  /** The harness's data (spec §4.5), as the person: the same checks as the agent's tools. */
  data: {
    get(collection: string, key?: DataKey, options?: DataOptions): Promise<DataRecord | null>;
    query(collection: string, query?: DataQuery, options?: DataOptions): Promise<DataQueryResult>;
    put(collection: string, record: DataRecord, options?: DataOptions): Promise<DataRecord>;
    patch(collection: string, key: DataKey | undefined, patch: DataRecord, options?: DataOptions): Promise<DataRecord>;
    delete(collection: string, key?: DataKey, options?: DataOptions): Promise<boolean>;
    /** Every write to `collection` (in `scope`; null: any scope), from any writer. */
    subscribe(collection: string, scope: string | null, listener: (change: DataChangeView) => void): () => void;
  };
```

In `packages/ui/test/fake-client.ts`, add `DataChangeView`, `DataKey`, `DataQuery` and `DataRecord` to the type import and these members:

```ts
  /** The fake's data: records by collection, in the order they were put; `key` names the key field. */
  records: Record<string, DataRecord[]> = {};
  dataKey = "id";
  private dataListeners = new Set<(c: DataChangeView) => void>();
  private dataChanged(change: DataChangeView) {
    for (const l of this.dataListeners) l(change);
  }
  data = {
    get: async (collection: string, key?: DataKey) => (this.records[collection] ?? []).find((r) => key === undefined || r[this.dataKey] === key) ?? null,
    query: async (collection: string, query: DataQuery = {}) => {
      const all = (this.records[collection] ?? []).filter((r) => Object.entries(query.where ?? {}).every(([f, v]) => r[f] === v));
      return { records: all.slice(0, query.limit ?? 50), total: all.length, invalid: 0 };
    },
    put: async (collection: string, record: DataRecord) => {
      const key = record[this.dataKey] as DataKey | undefined;
      this.records[collection] = [...(this.records[collection] ?? []).filter((r) => key === undefined || r[this.dataKey] !== key), record];
      this.dataChanged({ collection, scope: this.openScope ?? "main", who: "person", op: "put", ...(key !== undefined ? { key } : {}) });
      return record;
    },
    patch: async (collection: string, key: DataKey | undefined, patch: DataRecord) => {
      const prev = (this.records[collection] ?? []).find((r) => key === undefined || r[this.dataKey] === key);
      if (!prev) throw new Error("not found");
      const next = { ...prev, ...patch };
      this.records[collection] = (this.records[collection] ?? []).map((r) => (r === prev ? next : r));
      this.dataChanged({ collection, scope: this.openScope ?? "main", who: "person", op: "patch", ...(key !== undefined ? { key } : {}) });
      return next;
    },
    delete: async (collection: string, key?: DataKey) => {
      const before = this.records[collection] ?? [];
      this.records[collection] = before.filter((r) => key !== undefined && r[this.dataKey] !== key);
      this.dataChanged({ collection, scope: this.openScope ?? "main", who: "person", op: "delete", ...(key !== undefined ? { key } : {}) });
      return before.length !== this.records[collection].length;
    },
    subscribe: (collection: string, scope: string | null, listener: (c: DataChangeView) => void) => {
      const l = (c: DataChangeView) => {
        if (c.collection === collection && (scope === null || c.scope === scope)) listener(c);
      };
      this.dataListeners.add(l);
      return () => {
        this.dataListeners.delete(l);
      };
    },
  };
  /** A write the agent made (for tests of harness UIs that subscribe). */
  emitDataChange(change: DataChangeView) {
    this.dataChanged(change);
  }
```

- [ ] **Step 5: Preload and main**

In `packages/shell/src/preload/index.ts`, add `DataChangeView` to the type import and, after `scopes`, add:

```ts
  data: {
    get: (collection, key, options) => ipcRenderer.invoke("hh:data", { op: "get", collection, ...(key !== undefined ? { key } : {}) }, options),
    query: (collection, query = {}, options) => ipcRenderer.invoke("hh:data", { op: "query", collection, ...query }, options),
    put: (collection, record, options) => ipcRenderer.invoke("hh:data", { op: "put", collection, record }, options),
    patch: (collection, key, patch, options) => ipcRenderer.invoke("hh:data", { op: "patch", collection, ...(key !== undefined ? { key } : {}), patch }, options),
    delete: (collection, key, options) => ipcRenderer.invoke("hh:data", { op: "delete", collection, ...(key !== undefined ? { key } : {}) }, options),
    subscribe: (collection, scope, listener) =>
      subscribe<DataChangeView>("hh:dataChange", (change) => {
        if (change.collection === collection && (scope === null || change.scope === scope)) listener(change);
      }),
  },
```

In `packages/shell/src/main/index.ts`:

1. Add `DataStore` to the workspace import and `import { personDataRequest } from "./data-requests";`.
2. After `scopeStoreFor`, add:

```ts
/** One data store per base, so its write queue orders every write (the person's and the agent's). */
const dataStores = new Map<string, DataStore>();
function dataStoreFor(base: string): DataStore {
  let store = dataStores.get(base);
  if (!store) {
    store = new DataStore(base, harness.data);
    // Spec §4.5 `subscribe`: every write, from any writer, reaches the window.
    store.onChange((change) => sendToWindow("hh:dataChange", change));
    dataStores.set(base, store);
  }
  return store;
}
```

3. In `registerIpc()`, after the scope handlers, add:

```ts
  handle("hh:data", (request: unknown, options: unknown) =>
    personDataRequest(
      {
        store: async () => {
          const c = await validConfig();
          return c ? dataStoreFor(baseOf(c)) : null;
        },
        chatScope: () => tasks.chatScope(),
        trailer: () => tasks.trailerNow(),
        saveHistory: async (message, trailer) => {
          await (await currentHistory())?.save(message, trailer);
        },
        blocked: () => (quitting ? "The app is closing" : turnBlocked()),
      },
      request,
      options,
    ),
  );
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/shell/test/data-requests.test.ts packages/ui`
Expected: PASS.

- [ ] **Step 7: Typecheck, full tests, build, commit**

Run: `corepack pnpm typecheck`, then `corepack pnpm test`, then `corepack pnpm app:build`
Expected: all green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/shell/src/main/data-requests.ts packages/shell/test/data-requests.test.ts packages/ui/src/client.ts packages/ui/test/fake-client.ts packages/shell/src/main/index.ts packages/shell/src/preload/index.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(shell): HarnessClient.data with subscribe; the person's writes are recorded in the history" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

## Phase 3 — Agent access (spec §6 slice 3)

### Task 19: The harness's `rules`

**Files:**
- Modify: `packages/workspace/src/data.ts`
- Test: `packages/workspace/test/data-rules.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/workspace/test/data-rules.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type DataRules, type RulesContext, dataSchema, z } from "@humanharness/harness-sdk";
import { DataStore } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const LEVELS = ["unseen", "seen", "mastered"];
const concept = z.object({ id: z.string(), state: z.enum(["unseen", "seen", "mastered"]), evidence: z.array(z.string()) });
// The student example (spec §4.3): the state rises only with a new evidence entry.
const rises: DataRules = (next, prev) => {
  if (!next || !prev) return true;
  const up = LEVELS.indexOf(String(next.state)) > LEVELS.indexOf(String(prev.state));
  return !up || (next.evidence as unknown[]).length > (prev.evidence as unknown[]).length ? true : "The state can rise only with a new evidence entry";
};

function store(rules: DataRules, log: string[] = [], slowMs?: number) {
  const data = dataSchema.parse({
    concepts: { scoped: true, key: "id", schema: concept, agent: "write", rules },
    profile: { scoped: false, single: true, schema: z.object({ name: z.string() }), agent: "read" },
  });
  return new DataStore(fs.mkdtempSync(path.join(root, "t-")), data, { log: (m) => void log.push(m), ...(slowMs !== undefined ? { rulesSlowMs: slowMs } : {}) });
}
const agent = { who: "agent" as const, scope: "fracciones", action: "study" };

describe("rules", () => {
  it("refuses with the harness's message, after the schema, on put and patch", async () => {
    const s = store(rises);
    await s.put("concepts", { id: "a", state: "seen", evidence: ["quiz"] }, agent);
    await expect(s.put("concepts", { id: "a", state: "mastered", evidence: ["quiz"] }, agent)).rejects.toMatchObject({ code: "refused", message: "The state can rise only with a new evidence entry" });
    await expect(s.patch("concepts", "a", { state: "mastered" }, agent)).rejects.toThrow(/new evidence/);
    expect(await s.patch("concepts", "a", { state: "mastered", evidence: ["quiz", "exam"] }, agent)).toMatchObject({ state: "mastered" });
    await expect(s.put("concepts", { id: "b", state: "nope", evidence: [] }, agent)).rejects.toMatchObject({ code: "invalid" });
  });

  it("gives the task, the writer and a copy of the other collections; a delete passes next = null", async () => {
    const seen: { next: unknown; prev: unknown; ctx: Omit<RulesContext, "records">; profile: unknown }[] = [];
    const s = store((next, prev, ctx) => {
      seen.push({ next, prev, ctx: { action: ctx.action, scope: ctx.scope, who: ctx.who }, profile: ctx.records("profile") });
      ctx.records("profile").pop();
      return true;
    });
    await s.put("profile", { name: "Ana" }, { who: "person", scope: "fracciones" });
    await s.put("concepts", { id: "a", state: "seen", evidence: [] }, agent);
    await s.delete("concepts", "a", agent);
    expect(seen).toEqual([
      { next: { id: "a", state: "seen", evidence: [] }, prev: null, ctx: { action: "study", scope: "fracciones", who: "agent" }, profile: [{ name: "Ana" }] },
      { next: null, prev: { id: "a", state: "seen", evidence: [] }, ctx: { action: "study", scope: "fracciones", who: "agent" }, profile: [{ name: "Ana" }] },
    ]);
    expect(await s.get("profile", undefined, agent)).toEqual({ name: "Ana" });
  });

  it("can't change the record it checks", async () => {
    const s = store((next) => {
      if (next) next.state = "mastered";
      return true;
    });
    expect(await s.put("concepts", { id: "a", state: "seen", evidence: [] }, agent)).toMatchObject({ state: "seen" });
    expect(await s.get("concepts", "a", agent)).toMatchObject({ state: "seen" });
  });

  it("refuses when the rules throw or answer something else, and logs slow rules (spec §7.4)", async () => {
    const log: string[] = [];
    await expect(
      store(() => {
        throw new Error("bug");
      }).put("concepts", { id: "a", state: "seen", evidence: [] }, agent),
    ).rejects.toThrow(/rules of "concepts" failed: bug/);
    await expect(store((() => 1) as unknown as DataRules).put("concepts", { id: "a", state: "seen", evidence: [] }, agent)).rejects.toMatchObject({ code: "refused" });
    const slow = store(
      () => {
        const until = Date.now() + 5;
        while (Date.now() < until);
        return true;
      },
      log,
      1,
    );
    await slow.put("concepts", { id: "a", state: "seen", evidence: [] }, agent);
    expect(log.some((m) => /rules of "concepts" took \d+ ms/.test(m))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/workspace/test/data-rules.test.ts`
Expected: FAIL (the rules never run).

- [ ] **Step 3: Implement**

In `packages/workspace/src/data.ts`:

1. Add `import { performance } from "node:perf_hooks";` and `type RulesContext` to the harness-sdk import.
2. After `QUERY_MAX`, add:

```ts
/** Rules slower than this are logged (spec §7.4: a synchronous function can't be stopped, only reported). */
export const RULES_SLOW_MS = 100;
```

3. Change the constructor's `opts` type to `{ now?: () => Date; log?: (message: string) => void; rulesSlowMs?: number }`.
4. In `put`, replace the line `const records = c.single ? [next] : [...file.records.filter((r) => r[c.key!] !== key), next];` with:

```ts
      const prev = (c.single ? file.records[0] : file.records.find((r) => r[c.key!] === key)) ?? null;
      await this.checkRules(name, c, scope, next, prev, ctx);
      const records = c.single ? [next] : [...file.records.filter((r) => r[c.key!] !== key), next];
```

5. In `patch`, after `const next = this.parse(name, c, { ...prev, ...patch });`, add:

```ts
      await this.checkRules(name, c, scope, next, prev, ctx);
```

6. In `delete`, after `if (!prev) return false;`, add:

```ts
      await this.checkRules(name, c, scope, null, prev, ctx);
```

7. Add this private method after `keyOf`:

```ts
  /**
   * Check 3 (spec §4.3): the harness's `rules`, a pure synchronous function. It gets copies: of the records, and
   * of the other collections in the same scope (app-wide ones too), read before it runs.
   */
  private async checkRules(name: string, c: Collection, scope: string, next: DataRecord | null, prev: DataRecord | null, ctx: DataContext): Promise<void> {
    if (!c.rules) return;
    const snapshot = new Map<string, DataRecord[]>();
    for (const [other, oc] of Object.entries(this.collections)) {
      const folder = oc.scoped ? scope : APP_SCOPE;
      snapshot.set(other, oc.scoped && scope === APP_SCOPE ? [] : (await this.load(other, oc, folder)).records);
    }
    const rulesCtx: RulesContext = {
      ...(ctx.action !== undefined ? { action: ctx.action } : {}),
      scope,
      who: ctx.who,
      records: (other) => structuredClone(snapshot.get(other) ?? []),
    };
    const started = performance.now();
    let verdict: unknown;
    try {
      verdict = c.rules(structuredClone(next), structuredClone(prev), rulesCtx);
    } catch (err) {
      throw new DataError("refused", `The rules of "${name}" failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      const ms = performance.now() - started;
      if (ms > (this.opts.rulesSlowMs ?? RULES_SLOW_MS)) this.log(`The rules of "${name}" took ${Math.round(ms)} ms: keep them small and pure`);
    }
    if (verdict === true) return;
    throw new DataError("refused", typeof verdict === "string" && verdict.trim() ? verdict : `The rules of "${name}" refused the change`);
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/workspace/test/data-rules.test.ts packages/workspace/test/data.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, full tests, commit**

Run: `corepack pnpm typecheck` then `corepack pnpm test`
Expected: both green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/workspace/src/data.ts packages/workspace/test/data-rules.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(workspace): data writes pass the harness's rules" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 20: A request/answer socket

**Files:**
- Modify: `packages/blocks/src/bridge.ts`
- Test: `packages/blocks/test/rpc.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/blocks/test/rpc.test.ts`:

```ts
import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { type Rpc, RpcRefused, callRpc, openRpc } from "../src";

let rpc: Rpc | undefined;
afterEach(async () => {
  await rpc?.close();
  rpc = undefined;
});

describe("rpc", () => {
  it("answers each request with the handler's result", async () => {
    const seen: unknown[] = [];
    rpc = await openRpc(async (request) => {
      seen.push(request);
      return { echo: request, big: "x".repeat(200_000) };
    });
    const [a, b] = await Promise.all([callRpc(rpc, { op: "get", n: 1 }), callRpc(rpc, { op: "get", n: 2 })]);
    expect(a).toMatchObject({ echo: { op: "get", n: 1 } });
    expect((b as { big: string }).big).toHaveLength(200_000);
    expect(seen).toHaveLength(2);
  });

  it("passes the handler's refusal back as RpcRefused", async () => {
    rpc = await openRpc(async () => {
      throw new Error("not allowed");
    });
    const err = await callRpc(rpc, {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RpcRefused);
    expect((err as Error).message).toBe("not allowed");
  });

  it("refuses a caller without the token, and cleans up on close", async () => {
    let calls = 0;
    rpc = await openRpc(async () => ++calls);
    await expect(callRpc({ path: rpc.path, token: "wrong" }, {})).rejects.toThrow(/token/);
    expect(calls).toBe(0);
    const where = rpc.path;
    await rpc.close();
    rpc = undefined;
    if (process.platform !== "win32") expect(fs.existsSync(where)).toBe(false);
    await expect(callRpc({ path: where, token: "x" }, {}, 500)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/blocks/test/rpc.test.ts`
Expected: FAIL (`openRpc` is not exported).

- [ ] **Step 3: Implement**

In `packages/blocks/src/bridge.ts`:

1. Give `makePrivateDir` the socket's name: change its signature to `function makePrivateDir(socket: string): string`, replace `path.join(dir, "bridge.sock")` inside it with `path.join(dir, socket)`, and in `openBridge` call `makePrivateDir("bridge.sock")`.
2. Add at the end:

```ts
/** A local request/answer channel: the `data` MCP server asks, the app answers (the `ui` bridge only says ok). */
export interface Rpc {
  path: string;
  token: string;
  close(): Promise<void>;
}

/** The app refused the request; the message says why and goes back to the agent. */
export class RpcRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RpcRefused";
  }
}

/**
 * Opens a socket in a private directory. Each line is `{ token, request }`; each answer is one line,
 * `{ ok: true, result }` or `{ ok: false, error }`, written when `handler` settles.
 */
export async function openRpc(handler: (request: unknown) => Promise<unknown>): Promise<Rpc> {
  const token = randomBytes(16).toString("hex");
  const dir = process.platform === "win32" ? undefined : makePrivateDir("rpc.sock");
  const rpcPath = dir ? path.join(dir, "rpc.sock") : `\\\\.\\pipe\\hh-rpc-${randomUUID().slice(0, 8)}`;
  const cleanup = () => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  };
  const answer = async (line: string): Promise<string> => {
    let parsed: { token?: unknown; request?: unknown };
    try {
      parsed = JSON.parse(line);
    } catch {
      return JSON.stringify({ ok: false, error: "Not JSON" });
    }
    if (!parsed || typeof parsed !== "object" || parsed.token !== token) return JSON.stringify({ ok: false, error: "Bad token" });
    try {
      return JSON.stringify({ ok: true, result: (await handler(parsed.request)) ?? null });
    } catch (e) {
      return JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  };
  const server = net.createServer((socket) => {
    let rest = "";
    socket.setEncoding("utf8");
    socket.on("error", () => {});
    socket.on("data", (chunk: string) => {
      rest += chunk;
      let i: number;
      while ((i = rest.indexOf("\n")) >= 0) {
        const line = rest.slice(0, i);
        rest = rest.slice(i + 1);
        void answer(line).then((a) => {
          if (!socket.destroyed) socket.write(`${a}\n`);
        });
      }
      if (rest.length > MAX_BUFFERED_CHARS) socket.destroy();
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(rpcPath, () => resolve());
    });
  } catch (e) {
    cleanup();
    throw e;
  }
  return {
    path: rpcPath,
    token,
    close: () =>
      new Promise<void>((resolve) =>
        server.close(() => {
          cleanup();
          resolve();
        }),
      ),
  };
}

/** Sends one request and waits for its answer. Rejects with RpcRefused when the app refused it. */
export function callRpc(rpc: { path: string; token: string }, request: unknown, timeoutMs = 10_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(rpc.path);
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      fn();
    };
    const timer = setTimeout(() => settle(() => reject(new Error("The app did not answer in time"))), timeoutMs);
    let answer = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${JSON.stringify({ token: rpc.token, request })}\n`));
    socket.on("data", (chunk: string) => {
      answer += chunk;
      const i = answer.indexOf("\n");
      if (i < 0) return;
      settle(() => {
        try {
          const a = JSON.parse(answer.slice(0, i)) as { ok?: unknown; result?: unknown; error?: unknown };
          if (a.ok === true) resolve(a.result);
          else if (a.error === "Bad token") reject(new Error("The app refused the token"));
          else reject(new RpcRefused(typeof a.error === "string" ? a.error : "Refused"));
        } catch {
          reject(new Error("The app sent an answer that is not JSON"));
        }
      });
    });
    socket.on("close", () => settle(() => reject(new Error("The app closed without an answer"))));
    socket.on("error", (e) => settle(() => reject(e)));
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/blocks`
Expected: PASS (the bridge tests too).

- [ ] **Step 5: Typecheck, commit**

Run: `corepack pnpm typecheck`
Expected: green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/blocks/src/bridge.ts packages/blocks/test/rpc.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(blocks): a request/answer socket for MCP servers that need the app's answer" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 21: The `data` MCP server

**Files:**
- Create: `packages/blocks/src/data-server.ts`, `packages/blocks/src/data-server-bin.ts`
- Modify: `packages/blocks/src/launch.ts`, `packages/blocks/src/index.ts`
- Test: `packages/blocks/test/data-server.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/blocks/test/data-server.test.ts`:

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";
import { loadHarness } from "@humanharness/harness-sdk";
import { type Rpc, agentCollections, dataServerSpec, devLauncher, hasAgentData, openRpc } from "../src";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures");
const STUDY = path.join(fixtures, "data-harness", "harness.config.ts");

let rpc: Rpc | undefined;
let client: Client | undefined;
afterEach(async () => {
  await client?.close();
  await rpc?.close();
  client = undefined;
  rpc = undefined;
});

async function connect(handler: (request: unknown) => Promise<unknown>) {
  rpc = await openRpc(handler);
  const spec = dataServerSpec({ harnessConfig: STUDY, rpc: { path: rpc.path, token: rpc.token }, launcher: devLauncher() });
  expect(spec.name).toBe("data");
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(new StdioClientTransport({ command: spec.command, args: spec.args, env: { ...(process.env as Record<string, string>), ...spec.env } }));
  return client;
}

describe("agentCollections", () => {
  it("lists what the agent may see; a harness without data has none (D2)", async () => {
    expect(agentCollections(await loadHarness(STUDY)).map(([n]) => n)).toEqual(["concepts", "flashcards", "profile"]);
    expect(hasAgentData(await loadHarness(path.join(fixtures, "notes-harness", "harness.config.ts")))).toBe(false);
  });
});

describe("data MCP server", () => {
  it("offers reads for every visible collection and writes only for `write` ones", async () => {
    const c = await connect(async () => null);
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["data_delete", "data_get", "data_patch", "data_put", "data_query"]);
    const enumOf = (name: string) => (tools.find((t) => t.name === name)?.inputSchema.properties?.collection as { enum: string[] }).enum;
    expect(enumOf("data_query")).toEqual(["concepts", "flashcards", "profile"]);
    expect(enumOf("data_put")).toEqual(["concepts"]);
    const query = tools.find((t) => t.name === "data_query")!.description!;
    expect(query).toContain("concepts");
    expect(query).not.toContain("secrets");
  });

  it("sends each call to the app as a request and returns its answer", async () => {
    const seen: unknown[] = [];
    const c = await connect(async (request) => {
      seen.push(request);
      return { id: "halves", name: "Halves", state: "seen" };
    });
    const record = { id: "halves", name: "Halves", state: "seen", evidence: [] };
    const put = await c.callTool({ name: "data_put", arguments: { collection: "concepts", record } });
    expect(put.isError).toBeFalsy();
    expect((put.content as { text: string }[])[0].text).toContain('"halves"');
    await c.callTool({ name: "data_query", arguments: { collection: "concepts", where: { state: "seen" }, limit: 5 } });
    expect(seen).toEqual([
      { op: "put", collection: "concepts", record },
      { op: "query", collection: "concepts", where: { state: "seen" }, limit: 5 },
    ]);
  });

  it("returns the app's refusal as a tool error", async () => {
    const c = await connect(async () => {
      throw new Error("The state can rise only with a new evidence entry");
    });
    const r = await c.callTool({ name: "data_patch", arguments: { collection: "concepts", key: "halves", patch: { state: "mastered" } } });
    expect(r.isError).toBe(true);
    expect((r.content as { text: string }[])[0].text).toBe("Refused: The state can rise only with a new evidence entry");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/blocks/test/data-server.test.ts`
Expected: FAIL (`dataServerSpec` is not exported).

- [ ] **Step 3: Implement**

Create `packages/blocks/src/data-server.ts`:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type Collection, type LoadedHarness, loadHarness, z } from "@humanharness/harness-sdk";
import { RpcRefused, callRpc } from "./bridge";

/** The collections the agent may see (spec §4.1: everything but `agent: "none"`), in manifest order. */
export const agentCollections = (harness: Pick<LoadedHarness, "data">): [string, Collection][] =>
  Object.entries(harness.data).filter(([, c]) => c.agent !== "none");

/** The `data` MCP server starts only when there is something for the agent to see (D2). */
export const hasAgentData = (harness: Pick<LoadedHarness, "data">): boolean => agentCollections(harness).length > 0;

function fieldsOf(c: Collection): string {
  try {
    return JSON.stringify(z.toJSONSchema(c.schema));
  } catch {
    return Object.keys(c.schema.shape).join(", ");
  }
}

/** One line per collection: how it is keyed, where it lives, what the agent may do, and its fields. */
function catalogue(collections: [string, Collection][]): string {
  return collections
    .map(([name, c]) =>
      [
        `- ${name}:`,
        c.single ? "one record (no key)," : `key "${c.key}",`,
        c.scoped ? "in the task's scope," : "app-wide,",
        c.agent === "write" ? "read and write." : "read only.",
        `Fields: ${fieldsOf(c)}`,
      ].join(" "),
    )
    .join("\n");
}

const names = (list: [string, Collection][]) => list.map(([n]) => n) as [string, ...string[]];
const key = z.union([z.string(), z.number()]);
const fields = z.record(z.string(), z.unknown());

/**
 * The agent's data tools (spec §4.4). Each call goes to the app over `rpc`, which runs it as the agent in the
 * running task's scope, with every check; a refusal comes back as a tool error.
 */
export async function createDataServer(harnessConfig: string, rpc: { path: string; token: string }): Promise<McpServer> {
  const harness = await loadHarness(harnessConfig);
  const visible = agentCollections(harness);
  if (visible.length === 0) throw new Error("No collection is available to the agent");
  const writable = visible.filter(([, c]) => c.agent === "write");
  const server = new McpServer({ name: "data", version: "0.1.0" });

  const call = (op: string) => async (args: Record<string, unknown>) => {
    try {
      const result = await callRpc(rpc, { op, ...args });
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const text = e instanceof RpcRefused ? `Refused: ${message}` : `Could not reach the app (${message}). Nothing was read or saved; do not retry in a loop.`;
      return { isError: true, content: [{ type: "text" as const, text }] };
    }
  };

  const readDoc = `The harness's records. Collections:\n${catalogue(visible)}`;
  server.registerTool(
    "data_get",
    { description: `Reads one record by its key (no key for a one-record collection). ${readDoc}`, inputSchema: { collection: z.enum(names(visible)), key: key.optional() } },
    call("get"),
  );
  server.registerTool(
    "data_query",
    {
      description: `Lists records. \`where\` takes equality ({"state":"seen"}) or membership ({"id":{"in":["a","b"]}}) only; \`fields\` picks fields (the key always comes); \`limit\` defaults to 50, at most 200. The answer says the total. ${readDoc}`,
      inputSchema: { collection: z.enum(names(visible)), where: fields.optional(), fields: z.array(z.string()).optional(), limit: z.number().int().optional() },
    },
    call("query"),
  );
  if (writable.length > 0) {
    const writeDoc = `Every write is checked against the collection's schema and rules; a refusal says why. Collections you may change:\n${catalogue(writable)}`;
    server.registerTool(
      "data_put",
      { description: `Creates a record, or replaces the one with the same key. ${writeDoc}`, inputSchema: { collection: z.enum(names(writable)), record: fields } },
      call("put"),
    );
    server.registerTool(
      "data_patch",
      { description: `Changes some fields of a record; its key can't change. ${writeDoc}`, inputSchema: { collection: z.enum(names(writable)), key: key.optional(), patch: fields } },
      call("patch"),
    );
    server.registerTool(
      "data_delete",
      { description: `Deletes a record. ${writeDoc}`, inputSchema: { collection: z.enum(names(writable)), key: key.optional() } },
      call("delete"),
    );
  }
  return server;
}
```

Create `packages/blocks/src/data-server-bin.ts`:

```ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDataServer } from "./data-server";

try {
  const harnessConfig = process.env.HH_HARNESS;
  const rpcPath = process.env.HH_RPC;
  const token = process.env.HH_RPC_TOKEN;
  if (!harnessConfig || !rpcPath || !token) {
    console.error("HH_HARNESS, HH_RPC and HH_RPC_TOKEN are required");
    process.exit(2);
  }
  const server = await createDataServer(harnessConfig, { path: rpcPath, token });
  await server.connect(new StdioServerTransport());
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
```

In `packages/blocks/src/launch.ts`, add at the end:

```ts
/** The `data` MCP server (spec §4.4): its tools ask the app over `rpc`. */
export function dataServerSpec(opts: {
  harnessConfig: string;
  rpc: { path: string; token: string };
  launcher: Launcher;
  /** Built entry for the data server (app); defaults to the TS source (dev). */
  entry?: string;
}): McpServerSpec {
  const entry = opts.entry ?? fileURLToPath(new URL("./data-server-bin.ts", import.meta.url));
  return {
    name: "data",
    command: opts.launcher.command,
    args: [...opts.launcher.args, entry],
    env: { ...opts.launcher.env, HH_HARNESS: opts.harnessConfig, HH_RPC: opts.rpc.path, HH_RPC_TOKEN: opts.rpc.token },
  };
}
```

In `packages/blocks/src/index.ts`, add `export { agentCollections, createDataServer, hasAgentData } from "./data-server";`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/blocks`
Expected: PASS.

- [ ] **Step 5: Typecheck, commit**

Run: `corepack pnpm typecheck`
Expected: green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/blocks/src/data-server.ts packages/blocks/src/data-server-bin.ts packages/blocks/src/launch.ts packages/blocks/src/index.ts packages/blocks/test/data-server.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(blocks): the data MCP server" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 22: The agent's data requests reach the store

**Files:**
- Modify: `packages/runtime/src/runtime.ts`, `packages/shell/src/main/data-requests.ts`, `packages/shell/src/main/tasks.ts`, `packages/shell/src/main/index.ts`, `packages/shell/electron.vite.config.ts`, `packages/cli/src/run.ts`
- Test: `packages/runtime/test/runtime.test.ts`, `packages/shell/test/data-requests.test.ts`, `packages/cli/test/run.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/runtime/test/runtime.test.ts`, add after `FIXTURE`:

```ts
const STUDY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/data-harness/harness.config.ts");
const mcpServers = (argv: string[]) => Object.keys((JSON.parse(argv[argv.indexOf("--mcp-config") + 1]) as { mcpServers: object }).mcpServers);
```

and at the end of `describe("createRuntime", …)`:

```ts
  it("starts no data server without data, or without a handler (D2)", async () => {
    const { runtime, args } = await setup({ steps: [claudeResultLine(true)] });
    await send(runtime);
    expect(mcpServers(args())).toEqual(["ui"]);
  });

  it("starts the data server next to ui and sends the agent's data calls to the handler", async () => {
    const seen: unknown[] = [];
    const folder = path.join(fs.mkdtempSync(path.join(root, "t-")), "Work");
    const { runtime, args } = await setup(
      { steps: [{ mcp: { server: "data", tool: "data_put", args: { collection: "concepts", record: { id: "halves", name: "Halves", state: "seen", evidence: [] } } } }, claudeResultLine(true)] },
      folder,
      {
        harness: await loadHarness(STUDY),
        data: async (request) => {
          seen.push(request);
          return request;
        },
      },
    );
    await send(runtime);
    expect(mcpServers(args())).toEqual(["ui", "data"]);
    expect(seen).toEqual([{ op: "put", collection: "concepts", record: { id: "halves", name: "Halves", state: "seen", evidence: [] } }]);
  });
```

In `packages/shell/test/data-requests.test.ts`, add `agentDataRequest` to the import from `../src/main/data-requests` and at the end:

```ts
describe("agentDataRequest", () => {
  it("runs as the agent in the running task's scope, with the task's action", async () => {
    const t = setup();
    const deps = { store: t.deps.store, runningTask: async () => ({ id: "t1", action: "study", scope: "fracciones" }) };
    await agentDataRequest(deps, { op: "put", collection: "concepts", record: { id: "a", name: "A" } });
    expect(await t.store.get("concepts", "a", { who: "person", scope: "fracciones" })).toEqual({ id: "a", name: "A" });
    await expect(agentDataRequest(deps, { op: "put", collection: "profile", record: { name: "Ana" } })).rejects.toMatchObject({ code: "refused" });
    // A free question with no scope open runs in `_app`: a scoped collection is refused.
    await expect(agentDataRequest({ ...deps, runningTask: async () => ({ id: "t2", scope: "_app" }) }, { op: "query", collection: "concepts" })).rejects.toMatchObject({ code: "no-scope" });
    await expect(agentDataRequest({ ...deps, runningTask: async () => null }, { op: "query", collection: "concepts" })).rejects.toThrow(/No task/);
  });
});
```

In `packages/cli/test/run.test.ts`, add inside `describe("runTask", …)`:

```ts
  it("lets the agent write the scope's data through the data tools", { timeout: 60_000 }, async () => {
    const study = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/data-harness");
    const folder = path.join(root, "study-data");
    const record = { id: "halves", name: "Halves", state: "seen", evidence: [] };
    const script: ClaudeScript = {
      steps: [...claudeTextLines("Done."), result],
      turns: [
        { match: "save_note", steps: [ui("save_note", { title: "Halves", summary: ["x"], decisions: [], files: [], open: [] }), result] },
        { match: "# Task: study", steps: [{ mcp: { server: "data", tool: "data_put", args: { collection: "concepts", record } } }, ...claudeTextLines("Saved it."), result] },
      ],
    };
    await runTask({
      harnessDir: study,
      action: "study",
      engine: "claude",
      folder,
      input: lines("q\n"),
      output: memoryStream().stream,
      engineCommand: { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(root, script) } },
    });
    expect(JSON.parse(fs.readFileSync(path.join(folder, ".harness", "data", "run", "concepts.json"), "utf8"))).toEqual([record]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run packages/runtime/test/runtime.test.ts packages/shell/test/data-requests.test.ts packages/cli/test/run.test.ts`
Expected: FAIL (`data` is not a runtime option; `agentDataRequest` is not exported; no data file).

- [ ] **Step 3: The runtime**

In `packages/runtime/src/runtime.ts`:

1. Change the blocks import to:

```ts
import { type Bridge, type Launcher, type McpServerSpec, type Rpc, dataServerSpec, devLauncher, hasAgentData, openBridge, openRpc, uiServerSpec } from "@humanharness/blocks";
```

2. In `RuntimeOptions`, after `uiServerEntry`, add:

```ts
  /** Built `data` MCP server entry (app). Defaults to the TS source (dev). */
  dataServerEntry?: string;
  /**
   * Answers the agent's data tools (spec §4.4): the caller runs each request as the agent, in the running task's
   * scope. Without it, or without collections the agent may see, there is no `data` server (D2).
   */
  data?: (request: unknown) => Promise<unknown>;
```

3. Replace the block from `const bridge: Bridge = await openBridge(` to the end of its `try … catch` with:

```ts
  const bridge: Bridge = await openBridge((m) => emitCurrent?.({ type: "block", name: m.name, data: m.data }));
  let rpc: Rpc | null = null;
  try {
    if (opts.data && hasAgentData(harness)) rpc = await openRpc(opts.data);
    return await buildRuntime(bridge, rpc);
  } catch (err) {
    await rpc?.close().catch(() => {});
    await bridge.close().catch(() => {});
    throw err;
  }
```

4. Change `async function buildRuntime(bridge: Bridge)` to `async function buildRuntime(bridge: Bridge, rpc: Rpc | null)` and its `mcp` line to:

```ts
      mcp: [
        uiServerSpec({ harnessConfig: harness.configPath, bridge, launcher, entry: opts.uiServerEntry }),
        ...(rpc ? [dataServerSpec({ harnessConfig: harness.configPath, rpc, launcher, entry: opts.dataServerEntry })] : []),
        ...harnessMcpServers(harness, launcher),
      ],
```

5. In `close()`, replace `await bridge.close();` with:

```ts
          await bridge.close();
          await rpc?.close();
```

- [ ] **Step 4: The agent's requests in the shell and the CLI**

In `packages/shell/src/main/data-requests.ts`, add:

```ts
export interface AgentDataDeps {
  store(): Promise<DataStore | null>;
  /** The open task and the scope it runs in. */
  runningTask(): Promise<{ id: string; action?: string; scope: string } | null>;
}

/**
 * A request from the agent's `data` tools (spec §4.4): it runs as the agent, in the running task's scope. The
 * agent's writes need no commit of their own: the turn's commit records them, under the task's trailer.
 */
export async function agentDataRequest(d: AgentDataDeps, request: unknown): Promise<unknown> {
  const task = await d.runningTask();
  if (!task) throw new Error("No task is running");
  const store = await d.store();
  if (!store) throw new Error("The app is not set up yet");
  return runDataRequest(store, request, { who: "agent", scope: task.scope, ...(task.action ? { action: task.action } : {}) });
}
```

In `packages/shell/src/main/tasks.ts`, add `export * from "./data-requests";`.

In `packages/shell/src/main/index.ts`:

1. Import `agentDataRequest` with `personDataRequest`.
2. In the `createRuntime({…})` call, after `uiServerEntry`, add:

```ts
    dataServerEntry: path.join(here, "data-server.js"),
    data: (request) => agentDataRequest({ store: async () => dataStoreFor(baseOf(c)), runningTask: () => tasks.runningTask() }, request),
```

In `packages/shell/electron.vite.config.ts`, add to `lib.entry` after `"ui-server"`:

```ts
          "data-server": path.join(__dirname, "../blocks/src/data-server-bin.ts"),
```

In `packages/cli/src/run.ts`:

1. Add `DataStore` to the `@humanharness/workspace` import and `agentDataRequest` to the `@humanharness/shell/tasks` import.
2. Before `const runtime = memoise(`, add:

```ts
  // One store for the run: its queue orders the agent's writes.
  const dataStore = new DataStore(folder, harness.data);
```

3. In the `createRuntime({…})` call, after `onSession`, add:

```ts
      data: (request) => agentDataRequest({ store: async () => dataStore, runningTask: () => tasks.runningTask() }, request),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/runtime/test/runtime.test.ts packages/shell/test/data-requests.test.ts packages/cli/test/run.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, full tests, build, commit**

Run: `corepack pnpm typecheck`, then `corepack pnpm test`, then `corepack pnpm app:build`
Expected: all green, and `packages/shell/out/main/data-server.js` exists after the build.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/runtime/src/runtime.ts packages/runtime/test/runtime.test.ts packages/shell/src/main/data-requests.ts packages/shell/src/main/tasks.ts packages/shell/src/main/index.ts packages/shell/electron.vite.config.ts packages/shell/test/data-requests.test.ts packages/cli/src/run.ts packages/cli/test/run.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(runtime): the agent reads and writes harness data through the data server" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 23: Data in the task's first message

**Files:**
- Create: `packages/workspace/src/data-context.ts`
- Modify: `packages/workspace/src/index.ts`, `packages/shell/src/main/index.ts`, `packages/cli/src/run.ts`
- Test: `packages/workspace/test/data-context.test.ts`, `packages/cli/test/run.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/workspace/test/data-context.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { dataSchema, z } from "@humanharness/harness-sdk";
import { DataStore, buildDataContext } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const concept = z.object({ id: z.string(), name: z.string(), state: z.string(), notes: z.string() });
const person = { who: "person" as const, scope: "fracciones" };

function setup(extra: Record<string, unknown> = {}) {
  let t = 0;
  const data = dataSchema.parse({
    concepts: { scoped: true, key: "id", schema: concept, agent: "write", context: { fields: ["name", "state"], tokens: 120 }, ...extra },
    profile: { scoped: false, single: true, schema: z.object({ name: z.string(), level: z.string() }), agent: "read", context: { fields: "all", tokens: 100 } },
    secrets: { scoped: false, key: "id", schema: z.object({ id: z.string() }), agent: "none" },
    cards: { scoped: true, key: "id", schema: z.object({ id: z.string() }), agent: "read" },
  });
  const store = new DataStore(fs.mkdtempSync(path.join(root, "t-")), data, { now: () => new Date(Date.UTC(2026, 9, 25, 10, 0, t++)) });
  return { store, data };
}

describe("buildDataContext", () => {
  it("is empty with no data, so the first message is unchanged (D2)", async () => {
    const { store, data } = setup();
    expect(await buildDataContext(store, data, "fracciones", "study")).toBe("");
    expect(await buildDataContext(store, {}, "main", undefined)).toBe("");
  });

  it("writes one table per collection with context, key first, the most recently changed first", async () => {
    const { store, data } = setup();
    await store.put("profile", { name: "Ana", level: "6th grade" }, person);
    await store.put("concepts", { id: "a", name: "Halves", state: "seen", notes: "x" }, person);
    await store.put("concepts", { id: "b", name: "Thirds | sixths", state: "unseen", notes: "y" }, person);
    expect(await buildDataContext(store, data, "fracciones", "study")).toBe(
      [
        "## Data: concepts",
        "",
        "| id | name | state |",
        "|---|---|---|",
        "| b | Thirds \\| sixths | unseen |",
        "| a | Halves | seen |",
        "",
        "## Data: profile",
        "",
        "| name | level |",
        "|---|---|",
        "| Ana | 6th grade |",
      ].join("\n"),
    );
  });

  it("cuts a table at its tokens and says how many rows are left out", async () => {
    const { store, data } = setup();
    for (let i = 0; i < 40; i++) await store.put("concepts", { id: `c${String(i).padStart(2, "0")}`, name: `Concept number ${i}`, state: "seen", notes: "" }, person);
    const text = await buildDataContext(store, data, "fracciones", "study");
    const rows = text.split("\n").filter((l) => l.startsWith("| c"));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(40);
    expect(text).toContain(`… ${40 - rows.length} more in concepts: use data_query to read them.`);
  });

  it("follows the harness's order, and skips scoped collections outside a scope", async () => {
    const { store, data } = setup({ context: { fields: ["name"], tokens: 400, order: (records: { name: string }[], ctx: { action?: string }) => [...records].sort((a, b) => a.name.localeCompare(b.name)).map((r) => ({ ...r, name: `${r.name} (${ctx.action})` })) } });
    await store.put("concepts", { id: "b", name: "B", state: "seen", notes: "" }, person);
    await store.put("concepts", { id: "a", name: "A", state: "seen", notes: "" }, person);
    expect(await buildDataContext(store, data, "fracciones", "study")).toContain("| a | A (study) |\n| b | B (study) |");
    expect(await buildDataContext(store, data, "_app", undefined)).toBe("");
  });
});
```

In `packages/cli/test/run.test.ts`, in the test "lets the agent write the scope's data through the data tools", before `await runTask(`, add:

```ts
    fs.mkdirSync(path.join(folder, ".harness", "data", "_app"), { recursive: true });
    fs.writeFileSync(path.join(folder, ".harness", "data", "_app", "profile.json"), JSON.stringify({ name: "Ana", level: "6th grade" }));
    const prompts = path.join(root, "study-data-prompts.jsonl");
```

change its `env` to `{ HH_FAKE_SCRIPT: writeScript(root, script), HH_FAKE_PROMPTS: prompts }`, and at the end add:

```ts
    const first = readJsonl(prompts)[0] as { prompt: string };
    expect(first.prompt).toContain("## Data: profile\n\n| name | level |\n|---|---|\n| Ana | 6th grade |");
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run packages/workspace/test/data-context.test.ts packages/cli/test/run.test.ts`
Expected: FAIL (`buildDataContext` is not exported; the prompt has no table).

- [ ] **Step 3: Implement**

Create `packages/workspace/src/data-context.ts`:

```ts
import type { Collection, DataRecord } from "@humanharness/harness-sdk";
import type { DataStore } from "./data";
import { APP_SCOPE } from "./layout";
import { estimateTokens } from "./notes-index";

const CELL_CHARS = 120;

function cell(value: unknown): string {
  const text = value === undefined || value === null ? "" : typeof value === "string" ? value : JSON.stringify(value);
  const flat = text.replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|");
  return flat.length > CELL_CHARS ? `${flat.slice(0, CELL_CHARS - 1)}…` : flat;
}

const row = (values: unknown[]): string => `| ${values.map(cell).join(" | ")} |`;

/** The records the harness's `order` picks first, else the most recently changed (spec §4.4). */
async function ordered(store: DataStore, name: string, c: Collection, folder: string, records: DataRecord[], action: string | undefined): Promise<DataRecord[]> {
  if (c.context !== false && c.context.order) return c.context.order(records, { ...(action !== undefined ? { action } : {}) });
  const stamps = await store.changedAt(name, folder);
  const when = (r: DataRecord) => stamps[c.key ? String(r[c.key]) : ""] ?? "";
  // A stable sort: records with no stamp keep their key order, after the stamped ones.
  return [...records].sort((a, b) => (when(a) < when(b) ? 1 : when(a) > when(b) ? -1 : 0));
}

/**
 * The data part of a new session's first message (spec §4.4): one Markdown table per collection with `context`,
 * cut at its `tokens`, saying how many rows were left out. Empty when no collection has `context` (D2).
 */
export async function buildDataContext(store: DataStore, collections: Record<string, Collection>, scope: string, action: string | undefined): Promise<string> {
  const tables: string[] = [];
  for (const [name, c] of Object.entries(collections)) {
    if (c.context === false || c.agent === "none") continue;
    if (c.scoped && scope === APP_SCOPE) continue;
    const folder = c.scoped ? scope : APP_SCOPE;
    const { records } = await store.readAll(name, folder);
    if (records.length === 0) continue;
    const listed = c.context.fields === "all" ? Object.keys(c.schema.shape) : c.context.fields;
    const fields = c.key ? [c.key, ...listed.filter((f) => f !== c.key)] : listed;
    const head = [`## Data: ${name}`, "", row(fields), `|${fields.map(() => "---").join("|")}|`];
    const lines = [...head];
    const sorted = await ordered(store, name, c, folder, records, action);
    let shown = 0;
    for (const r of sorted) {
      const line = row(fields.map((f) => r[f]));
      if (shown > 0 && estimateTokens([...lines, line].join("\n")) > c.context.tokens) break;
      lines.push(line);
      shown++;
    }
    if (shown < sorted.length) lines.push("", `… ${sorted.length - shown} more in ${name}: use data_query to read them.`);
    tables.push(lines.join("\n"));
  }
  return tables.join("\n\n");
}
```

(The first row always shows, so a table never comes out empty.)

In `packages/workspace/src/index.ts`, add `export * from "./data-context";`.

In `packages/shell/src/main/index.ts`, add `buildDataContext` to the workspace import and, in the `TaskManager` deps, add:

```ts
  // Spec §4.4: only a harness with a collection that goes into the context gets the hook (D2).
  ...(Object.values(harness.data).some((c) => c.context !== false)
    ? {
        dataContext: async (scope: string, action: string | undefined) => {
          const c = await validConfig();
          return c ? buildDataContext(dataStoreFor(baseOf(c)), harness.data, scope, action) : "";
        },
      }
    : {}),
```

In `packages/cli/src/run.ts`, add `buildDataContext` to the workspace import and, in the `TaskManager` deps, add:

```ts
    ...(Object.values(harness.data).some((c) => c.context !== false)
      ? { dataContext: (scope: string, action: string | undefined) => buildDataContext(dataStore, harness.data, scope, action) }
      : {}),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/workspace/test/data-context.test.ts packages/cli/test/run.test.ts packages/shell`
Expected: PASS.

- [ ] **Step 5: Typecheck, full tests, commit**

Run: `corepack pnpm typecheck` then `corepack pnpm test`
Expected: both green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/workspace/src/data-context.ts packages/workspace/src/index.ts packages/workspace/test/data-context.test.ts packages/shell/src/main/index.ts packages/cli/src/run.ts packages/cli/test/run.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(workspace): a task's first message carries its data tables within budget" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 24: `dataDiff(taskId)`

**Files:**
- Create: `packages/workspace/src/data-diff.ts`
- Modify: `packages/workspace/src/history.ts`, `packages/workspace/src/index.ts`, `packages/ui/src/client.ts`, `packages/ui/test/fake-client.ts`, `packages/shell/src/main/index.ts`, `packages/shell/src/preload/index.ts`
- Test: `packages/workspace/test/data-diff.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/workspace/test/data-diff.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { dataSchema, z } from "@humanharness/harness-sdk";
import { DATA_PREFIX, History, NOTES_PREFIX, dataDiffOf, diffCollection } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

describe("diffCollection", () => {
  it("finds records added, changed and removed by key", () => {
    const before = json([{ id: "a", s: 1 }, { id: "b", s: 1 }]);
    const after = json([{ id: "b", s: 2 }, { id: "c", s: 1 }]);
    expect(diffCollection(before, after, "id")).toEqual({
      added: [{ id: "c", s: 1 }],
      changed: [{ before: { id: "b", s: 1 }, after: { id: "b", s: 2 } }],
      removed: [{ id: "a", s: 1 }],
    });
  });

  it("treats a missing or broken file as empty, and a single record by itself", () => {
    expect(diffCollection(null, json([{ id: "a" }]), "id").added).toEqual([{ id: "a" }]);
    expect(diffCollection("{nope", null, "id")).toEqual({ added: [], changed: [], removed: [] });
    expect(diffCollection(json({ name: "Ana" }), json({ name: "Ana B" }), undefined).changed).toEqual([{ before: { name: "Ana" }, after: { name: "Ana B" } }]);
    expect(diffCollection(json({ b: 1, a: 2 }), json({ a: 2, b: 1 }), undefined).changed).toEqual([]);
  });
});

describe("dataDiffOf", () => {
  it("reads a task's data changes from the history, per collection and scope", async () => {
    const dir = fs.mkdtempSync(path.join(root, "t-"));
    const folder = path.join(dir, "Work");
    const file = path.join(folder, ".harness", "data", "fracciones", "concepts.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, json([{ id: "a", state: "seen" }]));
    const history = new History(folder, path.join(dir, "git"), [".harness/"], [NOTES_PREFIX, DATA_PREFIX]);
    await history.init();
    await history.save("Start");
    fs.writeFileSync(file, json([{ id: "a", state: "mastered" }, { id: "b", state: "seen" }]));
    await history.save("Turn: study", { task: "t1", action: "study", scope: "fracciones" });
    const data = dataSchema.parse({ concepts: { scoped: true, key: "id", schema: z.object({ id: z.string(), state: z.string() }), agent: "write" } });
    expect(await dataDiffOf(history, "t1", data)).toEqual([
      {
        collection: "concepts",
        scope: "fracciones",
        added: [{ id: "b", state: "seen" }],
        changed: [{ before: { id: "a", state: "seen" }, after: { id: "a", state: "mastered" } }],
        removed: [],
      },
    ]);
    expect(await dataDiffOf(history, "nope", data)).toEqual([]);
    expect(await history.readFileAt(null, ".harness/data/fracciones/concepts.json")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/workspace/test/data-diff.test.ts`
Expected: FAIL (`diffCollection` is not exported).

- [ ] **Step 3: Implement**

In `packages/workspace/src/history.ts`, add after `trackedFiles()`:

```ts
  /** A file's content at commit `sha` (relative path, forward slashes); null when the commit or the file isn't there. */
  async readFileAt(sha: string | null, file: string): Promise<string | null> {
    if (sha === null) return null;
    try {
      const { blob } = await git.readBlob({ fs, gitdir: this.gitdir, oid: sha, filepath: file });
      return Buffer.from(blob).toString("utf8");
    } catch (err) {
      if ((err as { code?: string }).code === "NotFoundError") return null;
      throw err;
    }
  }
```

Create `packages/workspace/src/data-diff.ts`:

```ts
import type { Collection, DataRecord } from "@humanharness/harness-sdk";
import type { History } from "./history";
import { parseDataPath } from "./layout";

export interface RecordDiff {
  added: DataRecord[];
  changed: { before: DataRecord; after: DataRecord }[];
  removed: DataRecord[];
}

/** What a task changed in one collection of one scope (spec §4.5 `dataDiff`). */
export interface CollectionDiff extends RecordDiff {
  collection: string;
  scope: string;
}

const isObject = (v: unknown): v is DataRecord => typeof v === "object" && v !== null && !Array.isArray(v);

/** JSON with object keys sorted, so two records compare equal whatever their key order. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (isObject(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

/** A collection file's records by key (`""` for a `single` record); a missing or broken file has none. */
function recordsOf(text: string | null, key: string | undefined): Map<string, DataRecord> {
  const out = new Map<string, DataRecord>();
  if (text === null) return out;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return out;
  }
  if (key === undefined) {
    if (isObject(raw)) out.set("", raw);
    return out;
  }
  if (!Array.isArray(raw)) return out;
  for (const r of raw) if (isObject(r) && r[key] !== undefined) out.set(String(r[key]), r);
  return out;
}

/** Records added, changed and removed between two versions of a collection file. */
export function diffCollection(before: string | null, after: string | null, key: string | undefined): RecordDiff {
  const a = recordsOf(before, key);
  const b = recordsOf(after, key);
  const diff: RecordDiff = { added: [], changed: [], removed: [] };
  for (const [k, r] of b) {
    const prev = a.get(k);
    if (!prev) diff.added.push(r);
    else if (stable(prev) !== stable(r)) diff.changed.push({ before: prev, after: r });
  }
  for (const [k, r] of a) if (!b.has(k)) diff.removed.push(r);
  return diff;
}

/** What task `taskId` changed in the harness's data, from its history diff (start → end). */
export async function dataDiffOf(history: History, taskId: string, collections: Record<string, Collection>): Promise<CollectionDiff[]> {
  const task = (await history.tasks()).find((t) => t.taskId === taskId);
  if (!task) return [];
  const out: CollectionDiff[] = [];
  for (const change of task.changes) {
    const at = parseDataPath(change.path);
    if (!at || !Object.hasOwn(collections, at.collection)) continue;
    const c = collections[at.collection];
    const diff = diffCollection(await history.readFileAt(task.start, change.path), await history.readFileAt(task.end, change.path), c.single ? undefined : c.key);
    if (diff.added.length || diff.changed.length || diff.removed.length) out.push({ collection: at.collection, scope: at.scope, ...diff });
  }
  return out;
}
```

In `packages/workspace/src/index.ts`, add `export * from "./data-diff";`.

- [ ] **Step 4: The client**

In `packages/ui/src/client.ts`, add after `DataOptions`:

```ts
/** What a task changed in one collection of one scope. */
export interface DataDiffView {
  collection: string;
  scope: string;
  added: DataRecord[];
  changed: { before: DataRecord; after: DataRecord }[];
  removed: DataRecord[];
}
```

and in `HarnessClient`, after `data`:

```ts
  /** What a task changed in the harness's data ("what changed in this session", spec §4.5). */
  dataDiff(taskId: string): Promise<DataDiffView[]>;
```

In `packages/ui/test/fake-client.ts`, add `DataDiffView` to the type import and:

```ts
  dataDiffs: Record<string, DataDiffView[]> = {};
  dataDiff = async (taskId: string) => this.dataDiffs[taskId] ?? [];
```

In `packages/shell/src/preload/index.ts`, after `data`, add:

```ts
  dataDiff: (taskId) => ipcRenderer.invoke("hh:dataDiff", taskId),
```

In `packages/shell/src/main/index.ts`, add `dataDiffOf` to the workspace import and, in `registerIpc()` after `hh:data`:

```ts
  handle("hh:dataDiff", async (taskId: unknown) => {
    if (typeof taskId !== "string" || taskId.length === 0 || taskId.length > 200) return [];
    const history = await currentHistory();
    return history ? dataDiffOf(history, taskId, harness.data) : [];
  });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/workspace/test/data-diff.test.ts packages/ui`
Expected: PASS.

- [ ] **Step 6: Typecheck, full tests, build, commit**

Run: `corepack pnpm typecheck`, then `corepack pnpm test`, then `corepack pnpm app:build`
Expected: all green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/workspace/src/data-diff.ts packages/workspace/src/history.ts packages/workspace/src/index.ts packages/workspace/test/data-diff.test.ts packages/ui/src/client.ts packages/ui/test/fake-client.ts packages/shell/src/main/index.ts packages/shell/src/preload/index.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(workspace): dataDiff reads what a task changed in the harness data" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

## Phase 4 — Authoring, regression and docs

### Task 25: `check` and the `/new-harness` guide know scopes and data

**Files:**
- Modify: `packages/cli/guide/new-harness.md`
- Test: `packages/cli/test/check.test.ts`, `packages/cli/test/guide.test.ts`

- [ ] **Step 1: Write the tests**

In `packages/cli/test/check.test.ts`, add inside `describe("check: errors", …)`:

```ts
  it("schema: a data collection with no key, and an action scope without scopes", async () => {
    const data = await checkHarness(
      await fixture((d) =>
        replaceIn(d, "harness.config.ts", '  questions: { tier: "light" },', '  questions: { tier: "light" },\n  data: { cards: { scoped: false, schema: z.object({ front: z.string() }), agent: "write" } },'),
      ),
    );
    expect(data.findings.filter((f) => f.rule === "schema").map((f) => f.message.split(":")[0])).toEqual(["data.cards.key"]);
    const scope = await checkHarness(await fixture((d) => replaceIn(d, "harness.config.ts", 'cost: "light"', 'cost: "light", scope: "none"')));
    expect(scope.findings.filter((f) => f.rule === "schema").map((f) => f.message.split(":")[0])).toEqual(["actions.example.scope"]);
  });

  it("finds no error in a template with scopes and data (D2: both optional)", async () => {
    const r = await checkHarness(
      await fixture((d) =>
        replaceIn(
          d,
          "harness.config.ts",
          '  questions: { tier: "light" },',
          '  questions: { tier: "light" },\n  scopes: { label: { es: "tema", en: "topic" }, plural: { es: "temas", en: "topics" } },\n  data: { cards: { scoped: true, key: "id", schema: z.object({ id: z.string() }), agent: "read" } },',
        ),
      ),
    );
    expect(errors(r)).toEqual([]);
  });
```

In `packages/cli/test/guide.test.ts`, add inside the `describe`:

```ts
  it("asks about scopes and data in the Context phase", () => {
    const context = phases(guide).find((p) => p.name === "Context")!;
    for (const word of ["`scopes`", '`scope: "none"`', "`data`", "`agent`", "`context`", "`rules`"]) expect(context.body).toContain(word);
  });
```

- [ ] **Step 2: Run the tests**

Run: `corepack pnpm vitest run packages/cli/test/check.test.ts packages/cli/test/guide.test.ts`
Expected: the two check tests PASS already (Tasks 2 and 15 did the work: they guard it); the guide test FAILS (the guide doesn't mention scopes).

- [ ] **Step 3: The guide**

In `packages/cli/guide/new-harness.md`, in `## Phase 4 — Context`, replace the line `- what must never be lost.` with:

```markdown
- what must never be lost;
- whether the work splits into scopes the person opens one at a time (a topic, a project). If it does, declare `scopes` with its label and plural; each scope then gets its own tasks, notes, chat and data. Every action runs inside the open scope, except the ones marked `scope: "none"`, which run app-wide (a welcome, a profile);
- which structured records the harness keeps besides the notes, in `data`. For each collection: its zod schema and key (or `single: true`), whether it belongs to a scope (`scoped`), what the agent may do with it (`agent`: `write`, `read` or `none`), which fields go into a task's first message and in how many tokens (`context`), and the `rules` every write must pass (a pure function that returns `true` or the reason it refuses).
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/cli`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/cli/guide/new-harness.md packages/cli/test/check.test.ts packages/cli/test/guide.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(cli): the /new-harness guide asks about scopes and data; check covers them" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 26: The demo is unchanged (e2e)

**Files:**
- Modify: `packages/e2e/tests/flow.spec.ts`

- [ ] **Step 1: Add the D2 assertions**

In `packages/e2e/tests/flow.spec.ts`, in the first test, after `expect(note).toContain("- defineHarness valida el manifiesto");`, add:

```ts
    // Spec D2: a harness with neither scopes nor data keeps today's layout, chat, usage lines and MCP servers.
    expect(fs.existsSync(path.join(s.folder, ".harness", "scopes.json"))).toBe(false);
    expect(fs.existsSync(path.join(s.folder, ".harness", "data"))).toBe(false);
    expect(fs.readdirSync(path.join(s.folder, ".harness", "notes")).every((f) => f.endsWith(".md"))).toBe(true);
    expect(fs.readdirSync(path.join(s.folder, ".harness", "chats")).filter((f) => f.endsWith(".jsonl"))).toEqual(["main.jsonl"]);
```

and after the `expect.poll(…phase…)` line, add:

```ts
    expect(readJsonl<Record<string, unknown>>(usageFile(s)).some((r) => "scope" in r)).toBe(false);
    expect(Object.keys(readTasks(s.folder))).not.toContain("open");
    const servers = Object.keys((JSON.parse(first.argv[first.argv.indexOf("--mcp-config") + 1]) as { mcpServers: object }).mcpServers);
    expect(servers).not.toContain("data");
```

- [ ] **Step 2: Run the e2e suite**

Run: `corepack pnpm app:build` then `corepack pnpm e2e`
Expected: all green. (Archived chats live in `chats/archive/`, a folder, so the `.jsonl` filter on `chats/` sees only `main.jsonl`.)

- [ ] **Step 3: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/e2e/tests/flow.spec.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "test(e2e): the demo keeps its layout without scopes or data" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 27: Architecture docs

**Files:**
- Create: `docs/architecture/data.md`
- Modify: `docs/architecture/context.md`, `docs/architecture/manifest.md`, `docs/architecture/history.md`

- [ ] **Step 1: `data.md`**

Create `docs/architecture/data.md`:

```markdown
# Scopes and harness data

Spec: `docs/superpowers/specs/2026-10-25-scopes-and-data-design.md`.

## Scopes

- A harness that declares `scopes` (a label and a plural) splits the work into scopes the person opens one at a time: a topic, a project. Each scope has its own tasks, notes, notes index, chat, action statuses and data.
- The registry is `.harness/scopes.json` (`ScopeStore` in `packages/workspace/src/scopes.ts`): id, title, creation date, archived. Ids are slugs of the title (`^[a-z0-9][a-z0-9-]{0,63}$`). Scopes are archived, never deleted.
- Paths come from one place, `packages/workspace/src/layout.ts`, relative to a base folder. In the shell the base is `baseOf(config)`, the configured folder today; profiles will change only that function.
- Where a task runs (`TaskManager.scopeFor`): an action marked `scope: "none"` runs in `_app`, the app-wide folder; any other action needs an open scope; a free question runs in the open scope, or in `_app` when none is open.
- What changes per scope: notes go to `.harness/notes/<scope>/`, the chat to `.harness/chats/<scope>.jsonl`, the action statuses to `tasks.json` → `scopes.<scope>`, usage lines carry `scope`, and the history commits carry a `Scope:` trailer. A task in a scope starts from its scope's notes index plus a short app-wide one.
- Without `scopes` nothing changes (spec D2): notes stay flat, the chat is `chats/main.jsonl`, `tasks.json` and the usage lines get no new fields.
- Migration: when a harness adds `scopes`, the first start moves the flat notes into `notes/main/` and registers `main` ("General") (`migrateToScopes` in `packages/workspace/src/migrate.ts`). `humanharness run` opens a `run` scope for actions that need one.

## Data

- The manifest's `data` declares collections (`packages/harness-sdk/src/data.ts`): a zod object schema, a `key` (or `single: true`), `scoped`, what the agent may do (`agent`: `write`, `read`, `none`), what goes into the first message (`context`), and optional `rules`. `settings` is reserved.
- Storage (`DataStore` in `packages/workspace/src/data.ts`): one JSON file per collection and scope, `.harness/data/<scope>/<collection>.json` (`_app` for app-wide ones), records sorted by key, two-space indented. Writes are atomic and one at a time; nothing is cached, so a hand edit is seen at once. A file a hand edit broke is never overwritten: reads skip its invalid records, writes are refused until it is fixed or restored.
- Records are stored as the schema parses them: zod drops fields the schema doesn't name.
- Every write is checked in this order: permission (the agent writes only `write` collections), schema, key, then the harness's `rules(next, prev, ctx)`. `rules` gets copies and a snapshot of the other collections; it must be pure and fast: one slower than 100 ms is logged.
- When each record last changed is kept in `.harness/data-meta/` (never in the history); the context uses it for "most recently changed first".
- The history tracks `.harness/data/`, so undo covers data. The agent's writes land in its turn's commit; the person's writes are committed as `Data: <collection>` under the open task's trailer.

## How the agent and the harness UI reach it

- The `data` MCP server (`packages/blocks/src/data-server.ts`) starts next to `ui` only when a collection is visible to the agent. Its tools (`data_get`, `data_query`, and for `write` collections `data_put`, `data_patch`, `data_delete`) ask the app over a private request/answer socket (`openRpc` in `packages/blocks/src/bridge.ts`); the app runs them as the agent in the running task's scope (`agentDataRequest` in `packages/shell/src/main/data-requests.ts`). A refusal comes back as `Refused: <why>`.
- A new session's first message gets one table per collection with `context`, after the notes index, cut at its `tokens` (`buildDataContext` in `packages/workspace/src/data-context.ts`).
- The harness UI uses `HarnessClient.data` (`get`, `query`, `put`, `patch`, `delete`, `subscribe`), which runs as the person in the open scope with the same checks, and `dataDiff(taskId)`, which reads a task's record changes from the history (`packages/workspace/src/data-diff.ts`).

## Known gaps

- One file per collection is meant for hundreds of records (spec §7.2); measure before using it for thousands.
- A hand edit is noticed on the next read, not as it happens: there is no file watcher.
```

- [ ] **Step 2: The other docs**

In `docs/architecture/context.md`, in `## What a new session gets`, add after the "The first message: …" bullet:

```markdown
- In a harness with scopes, the notes index is the open scope's, followed by a short app-wide one (about 500 tokens). Collections with `context` add their tables after it (`docs/architecture/data.md`).
```

In `docs/architecture/manifest.md`, add two rows at the end of the field table:

```markdown
| `scopes` | Optional. The label and plural of the harness's unit of work (a topic, a project); actions may set `scope: "none"` to run app-wide (`docs/architecture/data.md`) |
| `data` | Optional. Collections of records with a schema, key, agent permission, context budget and rules (`docs/architecture/data.md`) |
```

and in `## Checks`, add:

```markdown
- An action may set `scope` only when the harness declares `scopes`, and a `scope: "none"` action can't be in `path`. A collection needs a key that is a field of its schema (or `single: true`); its `context` fields must be fields too, and a collection hidden from the agent can't have a `context`. `settings` is a reserved collection name.
```

In `docs/architecture/history.md`, replace the line `- The history skips \`.harness/\` except \`.harness/notes/\`, and skips the generated \`AGENTS.md\` and the engine's own instructions file.` with:

```markdown
- The history skips `.harness/` except `.harness/notes/` and `.harness/data/`, and skips the generated `AGENTS.md` and the engine's own instructions file. A person's data write is committed as "Data: …"; commits in a harness with scopes carry a `Scope:` trailer next to `Task:` and `Action:`.
```

- [ ] **Step 3: Full verification**

Run: `corepack pnpm typecheck`, then `corepack pnpm test`, then `corepack pnpm app:build`, then `corepack pnpm e2e`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add docs/architecture/data.md docs/architecture/context.md docs/architecture/manifest.md docs/architecture/history.md
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "docs: scopes and harness data in the architecture docs" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

## Spec coverage

| Spec point | Where |
|---|---|
| D1 A scope is the core's unit of work | Tasks 2, 4, 7, 10 |
| D2 Harnesses without scopes keep working | Tasks 1, 3, 7, 8, 9, 10 (regression test), 15 (`data` defaults to `{}`), 21–23 (no server, no tables), 25, 26 (e2e on the demo) |
| D3 Collections declared in the manifest | Task 15 |
| D4 Plain JSON, tracked by the history, survives an engine switch | Tasks 16, 17, 24 |
| D5 Every write is checked | Tasks 16 (permission, schema, key), 19 (rules), 18 and 22 (one path for person and agent) |
| D6 Data reaches the agent compactly | Tasks 21, 23 |
| §3.1 Manifest `scopes`, action `scope` | Task 2 |
| §3.2 Storage: registry, per-scope notes, chats, statuses | Tasks 1, 3, 4, 7, 8 |
| §3.3 Tasks inside a scope, free questions, app-wide index | Tasks 9, 10 |
| §3.4 Client: list, create, rename, archive, open; picker; history filter; usage per scope | Tasks 11, 12, 13 |
| §3 `Scope:` trailer, `usage.jsonl` field, migration into `main` | Tasks 5, 8, 6 + 11 (startup and folder change) + 14 (`run`) |
| §4.1 Collection fields, `single`, `agent`, `context`, `rules` | Task 15 |
| §4.2 One file per collection and scope, sorted, atomic, serialized | Task 16 |
| §4.3 Checks: schema, key, rules, permission | Tasks 16, 19 |
| §4.4 Tables at task start, order, "N more" | Task 23 |
| §4.4 `data` MCP server and its five tools, writes only for `write` | Tasks 20, 21, 22 |
| §4.4 Checkpoint and close unchanged | No change: Task 10 keeps `CLOSE_PROMPT` and the checkpoint as they are |
| §4.5 `HarnessClient.data` and `subscribe` | Task 18 |
| §4.5 `dataDiff(taskId)` | Task 24 |
| §5 #3b person-context file | Tasks 15 + 23 (the fixture's `profile`: app-wide, `single`, `context`) |
| §5 #6/#7 concept map, evidence rules | Tasks 15 + 19 (the fixture's `concepts` rule) |
| §5 #13 what changed in the session | Task 24 |
| §5 #14/#15 home, flashcards | The client API (Task 18); the harness logic is out of scope |
| §5 Material `items` names a collection | Out of scope: the material plan |
| §6 Slices 1, 2, 3 | Phases 1, 2, 3 |
| §7.1 Paths relative to the profile folder | Task 1 (`layout.ts`) + Task 11 (`baseOf`), the one swap point |
| §7.1 `settings` reserved | Task 15 |
| §7.2 Big collections | Not built; written as a known gap (Task 27) |
| §7.3 Hand edits | Task 16 (re-read on every call, invalid records skipped and counted, writes refused while broken) |
| §7.4 `rules` trusted, pure, time-boxed | Task 19 (copies, slow-rule log); the time box is a log, see the conflicts table |

## Self-review

- **Spec coverage.** Every section of the spec maps to a task above. Three points are left out on purpose, and each is named: the material `items` link, big collections, and a hard time box for `rules`.
- **Placeholder scan.** No step says "TBD", "add error handling" or "similar to Task N" without the code; every test and implementation step carries its code and its command.
- **Type consistency.**
  - `MAIN_SCOPE`, `APP_SCOPE`, `isScopeId`, `isScopeDir` and `scopeDir` come from `layout.ts` (Task 1). They are used by name in Tasks 3–10, 16, 23 and 24.
  - `TaskManager.runningTask()` returns `{ id, action?, scope }` (Task 10), the shape `AgentDataDeps.runningTask` expects (Task 22).
  - `chatScope()` and `trailerNow()` (Task 10) are what `PersonDataDeps` uses (Task 18).
  - `TaskDeps.dataContext(scope, action)` (Task 10) is what Task 23 passes.
  - `DataContext` (workspace: `who`, `scope`, `action?`) maps onto `RulesContext` (SDK: plus `records`) in Task 19.
  - `DataRecord` and `DataKey` exist twice on purpose:
    - in the SDK, for harness code and the store;
    - in `ui/src/client.ts`, which imports no SDK runtime.

    The shapes are the same.
  - `Rpc` and `RpcRefused` (Task 20) are what Tasks 21 and 22 import.
  - `dataServerSpec` takes `{ harnessConfig, rpc, launcher, entry? }` in Tasks 21 and 22.
