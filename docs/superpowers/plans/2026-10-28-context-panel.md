# Context Panel Implementation Plan (plan 17)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The person can see what the agent takes into account in the open task and change it. A panel beside the chat, opened from the context meter, lists what the app put in the task's first message ("At the start", each item with an approximate size, the total, and the real first-turn tokens), the files, notes and tools the agent used during the task ("During the task", newest first, with counts, faint after a compaction), the scope's and the app's pinned files ("Pinned", with what is over the budget marked "title only"), and the excluded notes ("Excluded", with "Include again"). Three actions: **Add now** (the open task gets one turn asking it to read a file), **Pin** (a file enters the first message of every new task in the scope, within a token budget) and **Exclude** (a note leaves the notes index of new tasks without being deleted). Harness views get `client.context` and `<ContextPanel client taskId />`.

**Architecture:**
- **Recording at the start (`packages/shell/src/main/task-manager.ts`).** `contextFor` returns the text it returned before plus `ContextItem[]` (instructions, notes indexes with the notes they list, one item per data collection, material, pins). `begin` and `resumeMessageFor` add the brief item and store `start` on the task in `tasks.json`. A mode switch or a phase change adds a `brief` item with the time it arrived.
- **Recording during the task.** `activity` events gain optional `paths` (Claude `Read`/`Grep`/`Glob`, Codex read/search `locations`) and `tool` (`{ server, name }` for MCP calls but `ui`), filled by the transport parsers. `runTurn` turns them into `ContextRead` entries (pure helpers in `packages/shell/src/main/context-record.ts`) and merges them into the task's `reads` once the turn ends. The first turn's `usage` gives `startTokens`; a compaction marks every earlier item `compacted`. `TurnController` strips `paths` and `tool` before an event reaches the window, so the window's event stream and the chat log are byte for byte what they were.
- **Pins and exclusions (`packages/workspace/src/context.ts`).** `.harness/context/<scope>.json` (`{ pinned: [{ path, at }], excluded: [{ note, at }] }`, scope `main` without scopes, `_app` for app-wide), validated field by field, written atomically, tracked by the history (`CONTEXT_PREFIX` joins `appHistoryKeep`). `pinsLayout` decides which pins enter whole within the budget; `pinnedSection` writes the "Pinned by the person" section. `buildNotesIndex` gains `exclude`.
- **Main (`packages/shell/src/main/context.ts`, `context-pins.ts`, `context-ipc.ts`).** `ContextService` reads pinned files with `locate` + `readPrefix`/`readCapped` (no links, inside the person's folder), answers `get`, `pin`, `unpin`, `exclude`, `include`, `pick` and `add` as data (`ContextResult`), commits each change as `Context: …` with the open task's trailer, and hands the task manager `personContext(scope)` for new tasks. `TaskManager.addContext` runs the "Add now" turn.
- **Window (`packages/ui`).** `ContextPanel` (four sections, "Add…", per-item actions), the context meter as a button (flow side and, without actions, the top bar), the panel in the reader's slot, items opening in the reader or the file timeline panel, Settings › Models' "Pinned files budget", and the History panel's `Context:` entries.
- **Mock.** Recordings gain `reads` (the fake prints `Read` tool calls); the fake answers the "Add now" prompt by reading the path it names; the demo's recordings read `README.md`.

**Tech Stack:** TypeScript, pnpm via corepack, Electron 44 + electron-vite 5, React 19, i18next, isomorphic-git, zod 4, Vitest + happy-dom, Playwright with the fake agents in mock mode. No new dependency.

Spec: `docs/superpowers/specs/2026-10-27-context-panel-design.md` (on `origin/master`, not yet on this branch; Task 0 brings it over). "§" and "D" numbers below refer to it. It builds on context and memory (`docs/architecture/context.md`), scopes and data (`docs/architecture/data.md`), the document reader (plan 10) and the file timeline (plan 16, `docs/architecture/timeline.md`).

---

## Conventions

**Code**
- Same as plans 1–16:
  - English everywhere (code, comments, docs, UI strings; the spec's Spanish strings are Marco's mockup copy and become English strings under `context.*` in `packages/i18n/src/locales/en.json`: "Al empezar" → "At the start", "Durante la tarea" → "During the task", "Fijado" → "Pinned", "Excluidas" → "Excluded", "Agregar…" → "Add…", "Para esta tarea" → "For this task", "Fijar en `<scope>`" → "Pin in {{scope}}", "Excluir" → "Exclude", "Volver a incluir" → "Include again", "Quitar" → "Remove", "solo título" → "title only", "puede estar resumido" → "may be summarized", "aprox." → "approx.", "Aplica desde la próxima tarea" → "Applies from the next task", "En espera" → "Waiting", "Solo archivos de texto" → "Text files only", "Solo archivos de tu carpeta" → "Only files in your folder", "Cerrar" → "Close");
  - packages export TS source; extensionless imports; tests in `packages/<name>/test/`; one commit per task.
- React tests are `*.test.tsx` with `// @vitest-environment happy-dom` on the first line. Find elements by role and visible text. Use `renderIn("en", …)` from `packages/ui/test/render.tsx`.
- `packages/ui/src/client.ts` imports nothing but types (plus the existing subject re-export). The new context types live there, because both the shell (`task-store.ts`, `task-manager.ts`) and the window use them, like `CurrentTaskView`.
- Colours only through existing `--hh-*` tokens. **CSS classes are new and unique:** every new class starts with `hh-ctxp` (grep: `grep -c "hh-ctxp" packages/ui/src/styles.css` is `0` before Task 13). `hh-context-meter` keeps its rules; the button that wraps it gets `hh-ctxp-meter`.
- **No regex that can backtrack on untrusted text.** Tool names (`mcp__server__tool`), paths, note paths and pinned file text are scanned with `startsWith`, `indexOf`, `slice` and loops. The only regexes added are anchored single-class checks on short ids that already exist (`isScopeDir`). The fence around a pinned file is sized by a loop that counts backtick runs.
- **The CSP is not loosened.** `packages/shell/src/renderer/index.html` keeps its policy. The panel draws React text nodes only; pinned file text never reaches the window.
- **Errors over IPC travel as data.** Every `hh:context*` handler answers `{ ok: true, … } | { ok: false, reason }` (`ContextRefusal`); a throw inside is a bug, logged, answered `{ ok: false, reason: "failed" }` (the `fileHandlers` pattern of `file-ipc.ts`).
- **File access only in the person's folder.** A pinned or added path reaches the file system only after `refusedShape`, the app-folder rule (`.harness/` only under `.harness/notes/`, never `.claude/`) and `locate(rel, [base])` (real path inside the folder, no link out). Reads use `readPrefix` / `readCapped` (`O_NOFOLLOW`, no hard links). Reference folders are refused. Engine read paths are only ever turned into folder-relative strings for display; nothing is read from them.
- **Never read credential or account files**, in tests or product code: not `~/.claude`, `~/.codex`, `~/.gemini`, `~/.config/opencode`, `~/.local/share/opencode`. **Usage and context numbers come only from the engine's own protocol output** (the `usage`, `context` and `compaction` events the transports already parse from stream-json and ACP), never from an engine's folders or logs. Tests use temp folders only.

**Commands and git**
- The worktree is `/Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data`. `<worktree>` below means that path, written out in full.
- Run every `corepack pnpm …` command from the worktree root. A single test file: `corepack pnpm vitest run <path>`.
- Git: always `git -C <worktree> …`, one simple command per call. Never use bare `git stash`. Never push.
- Every commit message ends with these two lines, with a blank line before them:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7
  ```
- Every task ends with `corepack pnpm typecheck` and `corepack pnpm test` green before its commit.
  - Tasks that touch the shell's main process, the preload or the UI also run `corepack pnpm app:build`.
  - Task 16 runs `corepack pnpm e2e`.

**D0 is a hard rule.** A harness or engine that never pins, never excludes and never uses "Add now" behaves exactly as before, byte for byte:
- every first message the agent gets (new task, resumed task, review task, question): `contextFor`'s text is unchanged when there are no pins and no exclusions (the pinned section and the `exclude` filter only exist when there is something to pin or exclude);
- `AGENTS.md`, the engine's instructions file and the `ui`, `data` and `material` MCP servers' tool lists (nothing is added for the agent);
- the folder and every commit: no `.harness/context/` file exists until the person pins or excludes; `appHistoryKeep` gains a prefix that matches no file;
- the chat log and the window's event stream (`TurnController` strips `paths` and `tool`; `ChatLog` keeps `{ kind, detail }` as before);
- `usage.jsonl` (the new turn kind `context-add` appears only when "Add now" runs);
- the CLI's output (`humanharness run` wires the same hooks; with no pins its messages are unchanged);
- a manifest without `context` validates and resolves as before.

What changes for every harness, on purpose, because the panel is core UI like the file timeline: `tasks.json`'s open task gains `start`, `startTokens` and `reads` (app-private, never tracked); `ModelsView` gains `pinnedTokens`; the context meter becomes a button; a harness without actions gets a meter button in the top bar while a task is open. Tasks 2, 3, 4, 5, 7 and 15 hold the D0 regression tests.

## Decisions this plan takes where the spec leaves room

**Recording (§3)**
- `ContextItem` is the spec's type plus optional `at` (a brief that arrived later), `count` (notes in an index, rows of a collection), `notes` (the notes an index lists, `{ path, title }`, at most 50, newest first: the panel's "Exclude" buttons), `scope` (a pin's scope) and `compacted`. `id`s: `instructions`, `brief`, `brief:<n>`, `notes`, `app-notes`, `data:<collection>`, `material`, `pin:<scope>:<path>`.
- `label` is English data for harness views and logs ("Harness instructions", "Notes (6)", "App-wide notes (2)", "Data · tickets (12 rows)", "Material", "Pinned · conventions.md"). The window draws its own text from `kind`, `count`, `path` and `scope` through `context.item.*` keys.
- Estimates: `approxTokens(chars)` = characters / 4 rounded to the nearest 100, at least 100 for any non-empty text, 0 for none. The brief item is the whole message's estimate minus the other items' (never below 0), so the items add up to the message.
- `instructions` is `AGENTS.md` in the task's working folder (its size in bytes / 4, rounded the same way), one item, path `AGENTS.md`. A missing file gives no item.
- The real total is the first turn's `usage` event: `inputTokens + cacheReadTokens + cacheWriteTokens` (what the engine read to answer it). It is shown as "First turn: N tokens (real)"; with tool calls in that turn it counts every call, and the label says "first turn", not "first message" (see Q2).
- A resumed task (after a folder move) replaces `start` with its resume message's items and clears `startTokens`; the resumed turn's `usage` sets it again.
- Reads are recorded once per turn, when it ends (one `tasks.json` write per turn, not per tool call). An entry is keyed by its folder-relative path, or for a tool by `tool:<server> · <name>`. A read outside the person's folder (a reference folder) is recorded by its file name only, with no `path`, so it never opens. At most 20 paths per event, 500 entries per task.
- MCP tools of every server but `ui` are recorded, the core's `data` and `material` included ("data · data_query"): that is what the agent used.
- A compaction (reported, or Claude's context falling by more than half, as `track` already detects) marks every `start` item and every read `compacted: true`; a read after it clears that read's flag. The task view's `TaskContext.compacted` is true after any compaction.

**Pins and exclusions (§4)**
- File: `.harness/context/<scope>.json`, `{ "version": 1, "pinned": [{ "path", "at" }], "excluded": [{ "note", "at" }] }`. At most 50 pins and 200 exclusions per scope (`full` past that). A file that is not JSON or has the wrong shape reads as empty for the agent and the panel; the next write replaces it.
- Order in a new task's first message: the scope's notes index, the app-wide notes, the data tables, **the pinned section**, then the material (material stays last, as `material.md` says). Scope pins come first, then `_app` pins, one shared budget, each list in pin order.
- Budget: `config.json` → `models.pinnedTokens` (Settings › Models), else the manifest's `context.pinnedTokens`, else 3,000. Settings offers 1,000 / 3,000 / 6,000 / 12,000 plus the manifest's value. A pin's size is its bytes / 4 (the same number for the panel and the message). Pins enter whole in order while they fit; the first that doesn't fit, and every pin after it, enters as title and path only (strict order, no packing). A file over 1 MB is always title only. A missing file, a binary file, or a file whose link now leads out is skipped and shown struck through.
- A whole pin is written as `### <path>` and the file's text in a fence of backticks one longer than its longest backtick run (at least 3). Title-only pins are listed under `### Also pinned` as `- <title> → <path>` (the title is the first `# ` heading in the first 2 KB, else the file name), followed by "Open these with your read tool when you need them."
- Allowed paths: relative, inside the person's folder after `locate`, not under `.claude/`, and under `.harness/` only inside `.harness/notes/`. Binary is the file timeline's `isBinary` (an extension in its list, or a NUL in the first 8 KB). Refusals: `outside` ("Only files in your folder"), `binary` ("Text files only"), `missing`.
- Exclusion: the note path must sit directly in that scope's notes folder (`notesPrefix(scoped, scope)` + `<slug>.md`, no further `/`). `buildNotesIndex(notes, { exclude })` filters before anything else; an empty or absent set changes nothing.
- Each pin, unpin, exclusion and inclusion is one commit, `Context: pinned <path>` / `Context: unpinned <path>` / `Context: excluded <note>` / `Context: included <note>`, with the open task's trailer (so undoing that task undoes it, §6), one write at a time, refused while turns are held (`turnBlocked()`), like the person's data writes.
- Without scopes the only scope is `main` and "Pin in…" has no `_app` choice. With scopes the panel offers "Pin in <scope label>" and "Pin for the whole app".

**Add now (§4.1)**
- Picker: "Add…" opens a small menu with "Choose a file…" (the system dialog at the folder, `hh:contextPick`, checked like a pin) and the open scope's notes (from `TaskView.notes`). The picked path then offers "For this task" and "Pin in <scope>".
- The turn's prompt: ``The person wants you to take `<path>` into account. Read it now and say in one line what changes for this task.`` (`CONTEXT_ADD_PROMPT`). A path with a backtick, a newline or a control character is refused (`outside`) before any turn.
- The turn is a visible turn of kind `context-add` (usage.jsonl): the chat shows "Take <path> into account" as the person's line and the agent's one-line answer. It runs through the task manager's operation queue: while another turn runs it waits there; the panel shows "Waiting" until it starts (see Conflicts 1). A checkpoint due before it runs first, as before any follow-up. Lines kept for the task's next message (`withNotices`) go with it.
- Refused with `no-task` when no task is open or the id is another task's, and with `busy` when the task is closing or saving a checkpoint.

**UI (§5)**
- The panel is a `<section aria-label="Context">` in the reader's slot (`flex: 0 0 55%`, like `.hh-reader`). Opening the panel closes the reader and the file timeline panel; opening an item from the panel closes the panel and opens the reader (a `.md`, a note) or the file timeline panel (any other file). Under 900 px wide it covers the chat (fixed, full width) and its "Close" button stays first in the tab order.
- Sections are `<section aria-labelledby>` with `<h3>`: "At the start", "During the task", "Pinned", "Excluded" (the last two only when they have entries, with an empty line otherwise: "Nothing pinned yet. Pin a file every new task here should start from.").
- "During the task" shows reads and tools newest first by `firstAt`, each with "×N" when N > 1; a compacted item is faint (`hh-ctxp-faint`) with "may be summarized".
- "Exclude" sits next to each note listed under a notes index item; "Pin" next to each read with a `path`; "Remove" next to each pin; "Include again" next to each exclusion. An exclusion of a note the open task's index listed shows "Applies from the next task" under it.
- The meter: `ContextMeter` gains an optional `onOpen`; with it, it renders inside `<button class="hh-ctxp-meter" aria-label="What the AI takes into account">`. A harness without actions has no flow side, so ChatView draws the same meter button in the top bar while a task with a context reading is open.
- The live update: main sends `hh:context` with `{ task, context }` whenever the task's start, reads, pins or exclusions change; `client.context.onChange(taskId, cb)` filters by task.

## Conflicts with the spec

1. **Parallel tasks and jobs are not built** (`2026-10-27-parallel-tasks-and-jobs-design.md` has no plan). There is one open task and no cap: "the turn follows the cap and the queue" becomes the task manager's existing operation queue (`op`), which already runs one operation at a time; "En espera" is shown while `client.context.add` is pending and the task is not waiting. "It works only on an open task that is not a job" becomes "only on the open task"; there are no jobs, so no job refusal and no read-only job panel (the component keeps a `readOnly` prop, unused by the core). Edit paths on `activity` (parallel spec §5.2) are not filled here: only reads are; the field is the same `paths`, so the parallel plan only adds edits.
2. **Hatches are not built** (`instructions.md` per scope, linked folders). No `scope-instructions` item is produced (the kind exists in the type). A pin is `{ path, at }` only; `{ link, path }` pins, unlinking, and "pins in a linked folder" are not built. A path in a reference folder is refused as `outside`, which is what the spec asks for reference folders.
3. **Task modes and phases briefs** are recorded when the switch or change turn is sent, as `brief` items with `at`; the first phase's brief and a starting mode's section are part of the first message, so they are inside the `brief` item's estimate, not separate items.
4. **Errors as data.** `client.context.add`, `pin`, `unpin`, `exclude` and `include` answer `ContextResult` (`{ ok: true } | { ok: false, reason }`) instead of `void`; `get` answers `ContextGetResult` (`{ ok: true, context } | { ok: false, reason }`) instead of `TaskContext`. `client.context.pick()` is added (the system file dialog, scoped to the folder): the spec's picker needs a way to choose a file that a harness view can call too.
5. **SDK component takes the client**, like `MaterialPanel` and `FileTimeline`: `<ContextPanel client taskId onOpen? />`, exported from `@humanharness/ui`.
6. **The meter is in the flow side, not a "task header".** There is no task header today; the meter lives in `FlowSide` (next to the running step and the free question). It becomes the button there; harnesses without actions get the button in the top bar (Decisions, UI).
7. **The window's events stay as they were.** The spec adds `paths` to `activity` events; this plan adds them (and `tool`) on the runtime's events, which the task manager reads, and strips both before an event reaches the window or the chat log, so engine paths (absolute, with the home folder) never reach the renderer and the chat log does not change.
8. **Sidekick and plugins** are not built; "the agent proposing pins" (§10.3) is not built, as decided.
9. **"Each item opens … in the file timeline view when that spec is in"**: plan 16 is on this branch, so non-`.md` files open in `FileTimelinePanel`.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `packages/ui/src/client.ts` | modify | Context types; `HarnessClient.context`; `TaskTurnNotice.kind` gains `"context"` and `path` |
| `packages/runtime/src/events.ts` | modify | `activity` gains `paths?` and `tool?` |
| `packages/runtime/src/claude-cli.ts` | modify | `activityExtras` (Read/Grep/Glob paths, `mcp__server__tool`) |
| `packages/runtime/src/acp.ts` | modify | `acpExtras` (read/search `locations`, trusted MCP server and tool) |
| `packages/shell/src/main/turn-controller.ts` | modify | `forWindow`: strips `paths`/`tool` before the window |
| `packages/shell/src/main/usage-log.ts` | modify | `TurnKind` gains `"context-add"` |
| `packages/workspace/src/notes-index.ts` | modify | `exclude` option |
| `packages/workspace/src/data-context.ts` | modify | `buildDataContextParts`; `buildDataContext` joins them |
| `packages/workspace/src/layout.ts` | modify | `CONTEXT_PREFIX`, `contextFile` |
| `packages/workspace/src/subjects.ts` | modify | `CONTEXT_CHANGE_PREFIX` |
| `packages/workspace/src/history.ts` | modify | `appHistoryKeep` gains `CONTEXT_PREFIX` |
| `packages/workspace/src/context.ts` | create | Pins file: clean, load, save; `pinsLayout`; `pinnedSection`; `fenceFor`; `titleOf` |
| `packages/workspace/src/index.ts` | modify | Export `./context` |
| `packages/shell/src/main/context-record.ts` | create | Pure: `approxTokens`, `folderPath`, `readsOf`, `mergeReads`, `markCompacted`, bounds |
| `packages/shell/src/main/task-store.ts` | modify | `start`, `startTokens`, `reads` on `CurrentTask`, cleaned |
| `packages/shell/src/main/task-prompts.ts` | modify | `CONTEXT_ADD_PROMPT`, `contextAddPrompt` |
| `packages/shell/src/main/task-manager.ts` | modify | Items at the start, pins and exclusions, reads, first-turn tokens, compaction marks, brief items, `addContext`, `contextOf` |
| `packages/harness-sdk/src/index.ts` | modify | Manifest `context.pinnedTokens` |
| `packages/engines/src/models.ts` | modify | `ModelsConfig.pinnedTokens`, `PINNED_OPTIONS`, `DEFAULT_PINNED_TOKENS` |
| `packages/shell/src/main/models.ts` | modify | `cleanModels` keeps `pinnedTokens`; `pinnedBudget` |
| `packages/shell/src/main/context-pins.ts` | create | Reading pins safely: `checkPinPath`, `readPins`, `pinnedContext` |
| `packages/shell/src/main/context.ts` | create | `ContextService`: get, pin, unpin, exclude, include, pick, add; `personContext` |
| `packages/shell/src/main/context-ipc.ts` | create | `hh:context*` handlers |
| `packages/shell/src/main/index.ts` | modify | Wiring; `hh:context` events; `ModelsView.pinnedTokens` |
| `packages/shell/src/preload/index.ts` | modify | `context` on `window.hh` |
| `packages/ui/src/ContextPanel.tsx` | create | The panel (SDK component) |
| `packages/ui/src/FlowSide.tsx` | modify | `ContextMeter` as a button |
| `packages/ui/src/ChatView.tsx` | modify | Panel slot, opening items, top-bar meter, "Take … into account" line |
| `packages/ui/src/ModelsTab.tsx` | modify | "Pinned files budget" |
| `packages/ui/src/HistoryPanel.tsx` | modify | `Context:` entries |
| `packages/ui/src/styles.css`, `index.ts` | modify | `hh-ctxp*` styles; export |
| `packages/i18n/src/locales/en.json` | modify | `context.*`, `models.pinned*`, `history.entry.context` |
| `packages/cli/src/run.ts` | modify | Same hooks as the app |
| `packages/fake-agent/src/mock.ts`, `mock-replay.ts`, `mock-claude.ts` | modify | `reads`; the "Add now" reply |
| `harnesses/demo/mock/manifest.json` | modify | `reads: ["README.md"]` |
| Tests (each task lists its own) | create/modify | Unit, UI, e2e |
| `docs/architecture/context.md`, `mock-mode.md`, `manifest.md`, `settings.md` | modify | Docs |
| `docs/superpowers/specs/2026-10-27-context-panel-design.md` | add (Task 0), modify (Task 17) | Spec on the branch; status |
| `docs/superpowers/plans/2026-10-28-context-panel.md` | add (Task 0) | This plan |

---

### Task 0: Branch, spec and this plan

**Files:**
- Add: `docs/superpowers/specs/2026-10-27-context-panel-design.md` (from `origin/master`)
- Add: `docs/superpowers/plans/2026-10-28-context-panel.md` (this file)

- [ ] **Step 1: Check the branch**

Run: `git -C <worktree> branch --show-current`
Expected: `feat/context-panel` (stacked on `feat/file-timeline` at `df091b4`). If it is not, run `git -C <worktree> switch -c feat/context-panel feat/file-timeline`.

- [ ] **Step 2: Bring the spec over**

Run: `git -C <worktree> fetch origin`
Run: `git -C <worktree> checkout origin/master -- docs/superpowers/specs/2026-10-27-context-panel-design.md`
Expected: the file exists.

- [ ] **Step 3: Put this plan in place**

Copy this file to `<worktree>/docs/superpowers/plans/2026-10-28-context-panel.md`.

- [ ] **Step 4: Commit**

```bash
git -C <worktree> add docs/superpowers/specs/2026-10-27-context-panel-design.md docs/superpowers/plans/2026-10-28-context-panel.md
git -C <worktree> commit -m "docs(plan): context panel (plan 17)"
```

---
### Task 1: Context types and the pure recording helpers

**Files:**
- Modify: `packages/ui/src/client.ts`
- Create: `packages/shell/src/main/context-record.ts`
- Test: `packages/shell/test/context-record.test.ts`

- [ ] **Step 1: Add the types to `packages/ui/src/client.ts`**

After `TaskTurnNotice`, change it and add the context types:

```ts
export interface TaskTurnNotice {
  task: string;
  /** `context`: an "Add now" turn (context-panel spec §4.1), with the path it asks the agent to read. */
  kind: "phase" | "wrap-up" | "context";
  phase?: string;
  by?: "agent" | "person" | "app";
  back?: true;
  /** `kind: "context"` only: the folder-relative path. */
  path?: string;
}

/** What one part of a task's first message is (context-panel spec §3.1). `scope-instructions` waits for the hatches spec. */
export type ContextItemKind =
  | "instructions"
  | "scope-instructions"
  | "brief"
  | "notes-index"
  | "app-notes-index"
  | "data"
  | "material"
  | "pinned"
  | "pinned-title";

/** One part of what the app loaded into a task, with its approximate size. */
export interface ContextItem {
  /** `instructions`, `brief`, `brief:<n>`, `notes`, `app-notes`, `data:<collection>`, `material`, `pin:<scope>:<path>`. */
  id: string;
  kind: ContextItemKind;
  /** English, for harness views and logs; the core's panel draws its own text from the other fields. */
  label: string;
  /** Relative to the folder, forward slashes, when the item is a file. */
  path?: string;
  /** Estimate: characters / 4, rounded to 100. */
  tokens: number;
  /** A brief that arrived after the start (a mode switch, a phase change). */
  at?: string;
  /** Notes in an index; rows of a collection. */
  count?: number;
  /** The notes an index lists, newest first (at most 50): what "Exclude" acts on. */
  notes?: { path: string; title: string }[];
  /** A pin's scope (`_app` for the whole app). */
  scope?: string;
  /** Before a compaction: the engine may have summarized it. */
  compacted?: true;
}

/** A file, note or tool the agent used during the task (§3.2): one entry per path or tool. */
export interface ContextRead {
  kind: "read" | "tool";
  /** The relative path, a file name (outside the folder) or "<server> · <tool>". */
  label: string;
  /** Relative to the folder; absent for tools and for files outside it. */
  path?: string;
  firstAt: string;
  count: number;
  compacted?: true;
}

/** A pinned file as the panel shows it (§4.2). */
export interface PinView {
  scope: string;
  path: string;
  at: string;
  /** Enters whole, as title only (over the budget or over 1 MB), or is skipped. */
  state: "full" | "title" | "missing" | "binary";
  tokens: number;
}

/** An excluded note (§4.3). `title` when the note is still there. */
export interface ExcludedView {
  scope: string;
  note: string;
  at: string;
  title?: string;
}

/** What the panel shows for the open task (§5.1). */
export interface TaskContext {
  task: string;
  /** The task's scope: `main` without scopes. */
  scope: string;
  scoped: boolean;
  start: ContextItem[];
  /** The first turn's real input tokens, once it ended. */
  startTokens?: number;
  reads: ContextRead[];
  compacted: boolean;
  pins: PinView[];
  excluded: ExcludedView[];
  /** Tokens of pinned text a new task gets whole. */
  budget: number;
}

export type ContextRefusal = "no-task" | "busy" | "outside" | "binary" | "missing" | "unknown-scope" | "not-a-note" | "full" | "not-ready" | "failed";
export type ContextResult = { ok: true } | { ok: false; reason: ContextRefusal };
export type ContextGetResult = { ok: true; context: TaskContext } | { ok: false; reason: ContextRefusal };
export type ContextPick = { ok: true; path: string } | { ok: false; reason: "cancelled" | ContextRefusal };

/** `client.context` (§5.2). Every answer is data. */
export interface ContextClient {
  get(taskId: string): Promise<ContextGetResult>;
  onChange(taskId: string, listener: (context: TaskContext) => void): () => void;
  /** §4.1: the open task reads `path` now. */
  add(taskId: string, path: string): Promise<ContextResult>;
  /** The system file dialog at the folder; the path comes back checked like a pin's. */
  pick(): Promise<ContextPick>;
  pin(scope: string, path: string): Promise<ContextResult>;
  unpin(scope: string, path: string): Promise<ContextResult>;
  exclude(scope: string, notePath: string): Promise<ContextResult>;
  include(scope: string, notePath: string): Promise<ContextResult>;
}
```

In `HarnessClient`, after `material: MaterialClient;`, add:

```ts
  /** What the agent takes into account (context-panel spec §5.2). */
  context: ContextClient;
```

This breaks `packages/shell/src/preload/index.ts` and `packages/ui/test/fake-client.ts` until Task 12. To keep this task green, add a stub to both now (Task 12 replaces them):

`packages/shell/src/preload/index.ts`, after `material: { … },`:

```ts
  context: {
    get: async () => ({ ok: false, reason: "not-ready" }),
    onChange: () => () => {},
    add: async () => ({ ok: false, reason: "not-ready" }),
    pick: async () => ({ ok: false, reason: "not-ready" }),
    pin: async () => ({ ok: false, reason: "not-ready" }),
    unpin: async () => ({ ok: false, reason: "not-ready" }),
    exclude: async () => ({ ok: false, reason: "not-ready" }),
    include: async () => ({ ok: false, reason: "not-ready" }),
  },
```

`packages/ui/test/fake-client.ts`, a field of `FakeClient` next to `files`:

```ts
  context: HarnessClient["context"] = {
    get: async () => ({ ok: false, reason: "not-ready" }),
    onChange: () => () => {},
    add: async () => ({ ok: false, reason: "not-ready" }),
    pick: async () => ({ ok: false, reason: "not-ready" }),
    pin: async () => ({ ok: false, reason: "not-ready" }),
    unpin: async () => ({ ok: false, reason: "not-ready" }),
    exclude: async () => ({ ok: false, reason: "not-ready" }),
    include: async () => ({ ok: false, reason: "not-ready" }),
  };
```

- [ ] **Step 2: Write the failing tests**

Create `packages/shell/test/context-record.test.ts`:

```ts
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Event } from "@humanharness/runtime";
import { READS_MAX, approxTokens, folderPath, markCompacted, mergeReads, readsOf } from "../src/main/context-record";

const base = path.resolve("/work/folder");
const activity = (over: Partial<Extract<Event, { type: "activity" }>>): Extract<Event, { type: "activity" }> => ({
  type: "activity",
  id: "a1",
  kind: "read",
  detail: "x.md",
  state: "start",
  ...over,
});

describe("approxTokens", () => {
  it("is characters / 4 rounded to 100, at least 100 for any text", () => {
    expect(approxTokens(0)).toBe(0);
    expect(approxTokens(4)).toBe(100);
    expect(approxTokens(1000)).toBe(300);
    expect(approxTokens(25_000)).toBe(6300);
  });
});

describe("folderPath", () => {
  it("relative with forward slashes inside the folder, null outside", () => {
    expect(folderPath(base, path.join(base, "docs", "a.md"))).toBe("docs/a.md");
    expect(folderPath(base, "notes/b.md")).toBe("notes/b.md");
    expect(folderPath(base, base)).toBeNull();
    expect(folderPath(base, path.resolve("/work/other/c.md"))).toBeNull();
    expect(folderPath(base, path.join(base, "..", "folder-x", "d.md"))).toBeNull();
  });
});

describe("readsOf", () => {
  it("turns read and search paths into folder paths, outside files into their name", () => {
    expect(readsOf(activity({ paths: [path.join(base, "a.md"), "/elsewhere/ref.pdf"] }), base)).toEqual([
      { kind: "read", label: "a.md", path: "a.md" },
      { kind: "read", label: "ref.pdf" },
    ]);
    expect(readsOf(activity({ kind: "search", paths: [path.join(base, "src")] }), base)).toEqual([{ kind: "read", label: "src", path: "src" }]);
  });

  it("records a tool by server and name; ignores ends, edits and plain activities", () => {
    expect(readsOf(activity({ kind: "other", tool: { server: "atlassian", name: "getJiraIssue" } }), base)).toEqual([{ kind: "tool", label: "atlassian · getJiraIssue" }]);
    expect(readsOf(activity({ kind: "other", tool: { server: "notes", name: "" } }), base)).toEqual([{ kind: "tool", label: "notes" }]);
    expect(readsOf(activity({ state: "end", paths: [path.join(base, "a.md")] }), base)).toEqual([]);
    expect(readsOf(activity({ kind: "edit", paths: [path.join(base, "a.md")] }), base)).toEqual([]);
    expect(readsOf(activity({}), base)).toEqual([]);
  });

  it("takes at most 20 paths of one event", () => {
    const many = Array.from({ length: 30 }, (_, i) => path.join(base, `f${i}.md`));
    expect(readsOf(activity({ paths: many }), base)).toHaveLength(20);
  });
});

describe("mergeReads", () => {
  it("one entry per path or tool, with the first time and a count; a new read clears compacted", () => {
    const first = mergeReads([], [{ kind: "read", label: "a.md", path: "a.md" }, { kind: "tool", label: "data · data_query" }, { kind: "read", label: "a.md", path: "a.md" }], "T1");
    expect(first).toEqual([
      { kind: "read", label: "a.md", path: "a.md", firstAt: "T1", count: 2 },
      { kind: "tool", label: "data · data_query", firstAt: "T1", count: 1 },
    ]);
    const after = mergeReads(markCompacted(first), [{ kind: "read", label: "a.md", path: "a.md" }], "T2");
    expect(after[0]).toEqual({ kind: "read", label: "a.md", path: "a.md", firstAt: "T1", count: 3 });
    expect(after[1].compacted).toBe(true);
  });

  it("keeps at most READS_MAX entries; counts of known ones still grow", () => {
    const full = Array.from({ length: READS_MAX }, (_, i) => ({ kind: "read" as const, label: `f${i}`, path: `f${i}`, firstAt: "T0", count: 1 }));
    const next = mergeReads(full, [{ kind: "read", label: "new", path: "new" }, { kind: "read", label: "f0", path: "f0" }], "T1");
    expect(next).toHaveLength(READS_MAX);
    expect(next[0].count).toBe(2);
    expect(next.some((r) => r.path === "new")).toBe(false);
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `corepack pnpm vitest run packages/shell/test/context-record.test.ts`
Expected: FAIL, "Cannot find module '../src/main/context-record'" (and `paths`/`tool` type errors until Task 2; vitest does not type-check, so only the module error shows).

- [ ] **Step 4: Write `packages/shell/src/main/context-record.ts`**

Task 2 adds `paths` and `tool` to the `activity` event; this file reads them through a local type so it compiles before and after.

```ts
import path from "node:path";
import type { Event } from "@humanharness/runtime";
import type { ContextItem, ContextRead } from "@humanharness/ui/client";

/** How many start items tasks.json keeps for a task: a bound on a hand-edited file. */
export const START_ITEMS_MAX = 100;
/** How many reads and tools tasks.json keeps for a task (context-panel spec §3.2). */
export const READS_MAX = 500;
/** How many paths of one activity are recorded. */
export const PATHS_PER_EVENT = 20;
/** How many notes a notes-index item lists. */
export const INDEX_NOTES_MAX = 50;

/** The panel's estimate (§3.1, "aprox."): characters / 4, rounded to 100; at least 100 for any text, 0 for none. */
export function approxTokens(chars: number): number {
  if (!(chars > 0)) return 0;
  return Math.max(100, Math.round(chars / 4 / 100) * 100);
}

/** `p` relative to `base`, forward slashes; a relative `p` is taken from `base`. Null for `base` itself and anything outside. */
export function folderPath(base: string, p: string): string | null {
  const rel = path.relative(base, path.resolve(base, p));
  if (rel === "" || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

/** One read or tool a turn showed, before it is merged into the task's list. */
export type SeenRead = { kind: "read" | "tool"; label: string; path?: string };

type Activity = Extract<Event, { type: "activity" }> & { paths?: string[]; tool?: { server: string; name: string } };

/** What an activity's start says the agent read (Read, Grep, Glob; Codex read and search) or which MCP tool it used. */
export function readsOf(e: Activity, base: string | null): SeenRead[] {
  if (e.state !== "start") return [];
  if (e.tool) return [{ kind: "tool", label: e.tool.name ? `${e.tool.server} · ${e.tool.name}` : e.tool.server }];
  if ((e.kind !== "read" && e.kind !== "search") || !e.paths) return [];
  return e.paths.slice(0, PATHS_PER_EVENT).map((p): SeenRead => {
    const rel = base ? folderPath(base, p) : null;
    return rel ? { kind: "read", label: rel, path: rel } : { kind: "read", label: path.basename(p) || p };
  });
}

const keyOf = (r: { kind: string; label: string; path?: string }): string => (r.path !== undefined ? `path:${r.path}` : `${r.kind}:${r.label}`);

/** The task's reads with `seen` (one turn's) merged in at `at`: counts grow, a read again is no longer compacted. */
export function mergeReads(reads: readonly ContextRead[], seen: readonly SeenRead[], at: string): ContextRead[] {
  const out = reads.map((r) => ({ ...r }));
  const index = new Map(out.map((r, i) => [keyOf(r), i]));
  for (const s of seen) {
    const i = index.get(keyOf(s));
    if (i !== undefined) {
      const { compacted: _c, ...rest } = out[i];
      out[i] = { ...rest, count: rest.count + 1 };
    } else if (out.length < READS_MAX) {
      index.set(keyOf(s), out.length);
      out.push({ kind: s.kind, label: s.label, ...(s.path !== undefined ? { path: s.path } : {}), firstAt: at, count: 1 });
    }
  }
  return out;
}

/** Everything recorded so far, marked as possibly summarized (§3.2 "Compaction"). */
export function markCompacted<T extends ContextItem | ContextRead>(items: readonly T[]): T[] {
  return items.map((i) => ({ ...i, compacted: true as const }));
}
```

- [ ] **Step 5: Run the tests**

Run: `corepack pnpm vitest run packages/shell/test/context-record.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, test, build, commit**

Run: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm app:build`
Expected: green.

```bash
git -C <worktree> add packages/ui/src/client.ts packages/shell/src/preload/index.ts packages/ui/test/fake-client.ts packages/shell/src/main/context-record.ts packages/shell/test/context-record.test.ts
git -C <worktree> commit -m "feat(context): context types and the recording helpers"
```

---

### Task 2: Read paths and MCP tools on `activity` events

**Files:**
- Modify: `packages/runtime/src/events.ts`, `packages/runtime/src/claude-cli.ts`, `packages/runtime/src/acp.ts`
- Test: `packages/runtime/test/claude-cli.test.ts`, `packages/runtime/test/acp.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/runtime/test/claude-cli.test.ts` (add `StreamJsonReader, activityExtras` to the import from `../src/claude-cli`):

```ts
describe("activity extras (context-panel spec §3.2)", () => {
  it("reads: Read's file_path, Grep's and Glob's path; MCP tools by server and name", () => {
    expect(activityExtras("Read", { file_path: "/w/a.md" })).toEqual({ paths: ["/w/a.md"] });
    expect(activityExtras("Grep", { pattern: "x", path: "/w/src" })).toEqual({ paths: ["/w/src"] });
    expect(activityExtras("Glob", { pattern: "*.md" })).toEqual({});
    expect(activityExtras("mcp__atlassian__getJiraIssue", {})).toEqual({ tool: { server: "atlassian", name: "getJiraIssue" } });
    expect(activityExtras("mcp__data__data_query", {})).toEqual({ tool: { server: "data", name: "data_query" } });
    expect(activityExtras("mcp__broken", {})).toEqual({});
    expect(activityExtras("Edit", { file_path: "/w/a.md" })).toEqual({});
  });

  it("puts them on the start event only; the end event is as before", () => {
    const events: Event[] = [];
    const reader = new StreamJsonReader((e) => events.push(e), () => {});
    reader.feed(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "r1", name: "Read", input: { file_path: "/w/notes/a.md" } }] } }));
    reader.feed(JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "r1" }] } }));
    expect(events).toEqual([
      { type: "activity", id: "r1", kind: "read", detail: "a.md", paths: ["/w/notes/a.md"], state: "start" },
      { type: "activity", id: "r1", kind: "read", detail: "a.md", state: "end", error: false },
    ]);
  });

  it("D0: a Bash or Write activity carries nothing new", () => {
    const events: Event[] = [];
    const reader = new StreamJsonReader((e) => events.push(e), () => {});
    reader.feed(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "w1", name: "Write", input: { file_path: "/w/a.md" } }] } }));
    expect(events).toEqual([{ type: "activity", id: "w1", kind: "edit", detail: "a.md", state: "start" }]);
  });
});
```

Append to `packages/runtime/test/acp.test.ts` (add `acpExtras` to the import from `../src/acp`; `setup` and `run` are the file's helpers):

```ts
describe("acpExtras (context-panel spec §3.2)", () => {
  it("read and search locations; a trusted MCP server with its tool", () => {
    expect(acpExtras({ kind: "read", locations: [{ path: "/w/a.md" }, { path: "" }, {}] }, undefined)).toEqual({ paths: ["/w/a.md"] });
    expect(acpExtras({ kind: "search", locations: [] }, undefined)).toEqual({});
    expect(acpExtras({ kind: "edit", locations: [{ path: "/w/a.md" }] }, undefined)).toEqual({});
    expect(acpExtras({ kind: "execute", rawInput: { server: "notes", tool: "search" } }, "notes")).toEqual({ tool: { server: "notes", name: "search" } });
    expect(acpExtras({ kind: "execute", rawInput: { server: "notes" } }, "notes")).toEqual({ tool: { server: "notes", name: "" } });
  });

  it("emits them on the tool call's start event", async () => {
    const { transport } = setup({
      turns: [[
        { update: { sessionUpdate: "tool_call", toolCallId: "r1", title: "Read a.md", kind: "read", status: "pending", locations: [{ path: "/w/a.md" }] } },
        { update: { sessionUpdate: "tool_call_update", toolCallId: "r1", status: "completed" } },
      ]],
    });
    const events = await run(transport);
    expect(events.filter((e) => e.type === "activity")).toEqual([
      { type: "activity", id: "r1", kind: "read", detail: "a.md", paths: ["/w/a.md"], state: "start" },
      { type: "activity", id: "r1", kind: "read", detail: "a.md", state: "end", error: false },
    ]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/runtime/test/claude-cli.test.ts packages/runtime/test/acp.test.ts`
Expected: FAIL, `activityExtras` / `acpExtras` are not exported.

- [ ] **Step 3: Implement**

`packages/runtime/src/events.ts`, the `activity` member of `Event`:

```ts
  /**
   * `paths`: what a read or search tool named (absolute, as the engine reported them), on the start event only.
   * `tool`: an MCP tool's server and name (never the core's `ui`), on the start event only. Both are for the task
   * manager's context record (context-panel spec §3.2); the window never gets them.
   */
  | { type: "activity"; id: string; kind: ActivityKind; detail: string; state: "start" | "end"; error?: boolean; paths?: string[]; tool?: { server: string; name: string } }
```

`packages/runtime/src/claude-cli.ts`, after `detailOf`:

```ts
/** Longest server or tool name kept. */
const NAME_MAX = 100;

/**
 * What a tool call adds to its start event for the context panel (spec §3.2): the path a Read, Grep or Glob names,
 * or an MCP tool's server and name (`mcp__<server>__<tool>`, split with indexOf).
 */
export function activityExtras(tool: string, input: Record<string, unknown>): { paths?: string[]; tool?: { server: string; name: string } } {
  const str = (key: string) => (typeof input[key] === "string" && input[key] ? (input[key] as string) : undefined);
  if (tool === "Read") {
    const p = str("file_path");
    return p ? { paths: [p] } : {};
  }
  if (tool === "Grep" || tool === "Glob") {
    const p = str("path");
    return p ? { paths: [p] } : {};
  }
  if (tool.startsWith("mcp__")) {
    const rest = tool.slice("mcp__".length);
    const cut = rest.indexOf("__");
    if (cut > 0 && cut + 2 < rest.length) return { tool: { server: rest.slice(0, cut).slice(0, NAME_MAX), name: rest.slice(cut + 2).slice(0, NAME_MAX) } };
  }
  return {};
}
```

In `StreamJsonReader.feed`, the `assistant` branch:

```ts
        const activity = { kind: KINDS[b.name] ?? ("other" as const), detail: detailOf(b.name, b.input ?? {}) };
        this.tools.set(b.id, activity);
        this.emit({ type: "activity", id: b.id, ...activity, ...activityExtras(String(b.name), b.input ?? {}), state: "start" });
```

`packages/runtime/src/acp.ts`, after `activityDetail`:

```ts
const NAME_MAX = 100;

/**
 * What an ACP tool call adds to its start event (context-panel spec §3.2): a read or search call's `locations`, or the
 * trusted MCP server (only from Codex's own marker, as `server` is passed) with `rawInput.tool`.
 */
export function acpExtras(call: { kind?: unknown; locations?: unknown; rawInput?: unknown }, server: string | undefined): { paths?: string[]; tool?: { server: string; name: string } } {
  if (server !== undefined) {
    const name = (call.rawInput as { tool?: unknown } | null | undefined)?.tool;
    return { tool: { server: server.slice(0, NAME_MAX), name: typeof name === "string" ? name.slice(0, NAME_MAX) : "" } };
  }
  if (call.kind !== "read" && call.kind !== "search") return {};
  const paths = Array.isArray(call.locations)
    ? call.locations.map((l) => (l as { path?: unknown } | null)?.path).filter((p): p is string => typeof p === "string" && p.length > 0)
    : [];
  return paths.length > 0 ? { paths: paths.slice(0, 20) } : {};
}
```

In `onUpdate`, the `tool_call` case:

```ts
        emit({ type: "activity", id: u.toolCallId, ...activity, ...acpExtras(u, server), state: "start" });
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run packages/runtime/test`
Expected: PASS. Existing tests that compare whole activity start events for Read/Grep/Glob or MCP calls now see the new fields: update only those expectations, adding exactly `paths` / `tool` (the D0 test above pins that nothing else changed).

- [ ] **Step 5: Typecheck, test, commit**

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: green.

```bash
git -C <worktree> add packages/runtime/src/events.ts packages/runtime/src/claude-cli.ts packages/runtime/src/acp.ts packages/runtime/test/claude-cli.test.ts packages/runtime/test/acp.test.ts
git -C <worktree> commit -m "feat(runtime): read paths and MCP tools on activity events"
```

---

### Task 3: The window and the chat log never see them; the `context-add` turn kind

**Files:**
- Modify: `packages/shell/src/main/turn-controller.ts`, `packages/shell/src/main/usage-log.ts`
- Test: `packages/shell/test/turn-controller.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/shell/test/turn-controller.test.ts` (add `forWindow` to the import from `../src/main/turn-controller`):

```ts
describe("context record fields stay in main (context-panel spec, D0)", () => {
  it("forWindow strips paths and tool, and leaves every other event as it is", () => {
    const start: Event = { type: "activity", id: "r1", kind: "read", detail: "a.md", state: "start", paths: ["/home/me/w/a.md"], tool: { server: "x", name: "y" } };
    expect(forWindow(start)).toEqual({ type: "activity", id: "r1", kind: "read", detail: "a.md", state: "start" });
    const plain: Event = { type: "activity", id: "e1", kind: "edit", detail: "a.md", state: "start" };
    expect(forWindow(plain)).toBe(plain);
    const text: Event = { type: "text", delta: "hi" };
    expect(forWindow(text)).toBe(text);
  });

  it("the turn's listener gets the paths; the window and the chat log don't", async () => {
    const fake = fakeRuntime();
    const { controller, entries, events } = setup({ ensureRuntime: async () => fake.runtime });
    const heard: Event[] = [];
    const sent = controller.send("hi", { onEvent: (e) => heard.push(e) } as TurnOptions);
    await vi.waitFor(() => expect(fake.send).toHaveBeenCalled());
    fake.finish([{ type: "activity", id: "r1", kind: "read", detail: "a.md", state: "start", paths: ["/home/me/w/a.md"] }, { type: "done", ok: true }]);
    await sent;
    expect(heard[0]).toMatchObject({ paths: ["/home/me/w/a.md"] });
    expect(events.find((e) => e.type === "activity")).toEqual({ type: "activity", id: "r1", kind: "read", detail: "a.md", state: "start" });
    expect(JSON.stringify(entries)).not.toContain("/home/me");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/shell/test/turn-controller.test.ts`
Expected: FAIL, `forWindow` is not exported.

- [ ] **Step 3: Implement**

`packages/shell/src/main/turn-controller.ts`, after `isHeld`:

```ts
/**
 * An event as the window gets it: an activity's `paths` and `tool` stay in main (context-panel spec §3.2), so engine
 * paths never reach the renderer and the window's events are what they were (D0). Any other event is returned as is.
 */
export function forWindow(e: Event): Event {
  if (e.type !== "activity" || (e.paths === undefined && e.tool === undefined)) return e;
  const { paths: _paths, tool: _tool, ...rest } = e;
  return rest;
}
```

In `run`, inside `rt.send`'s callback, the window gets `forWindow(e)`:

```ts
          if (pending && (e.type === "limits" || e.type === "usage")) pending.push(e);
          else {
            release();
            this.emit(forWindow(e));
          }
```

`packages/shell/src/main/usage-log.ts`:

```ts
/** `context-add`: the "Add now" turn of the context panel (context-panel spec §4.1). */
export type TurnKind = "run" | "close" | "checkpoint" | "phase-change" | "wrap-up" | "material" | "context-add";
```

If `usage-log.ts` validates `phase` against a list when reading `usage.jsonl` back (search it for `"wrap-up"`), add `"context-add"` to that list too.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run packages/shell/test/turn-controller.test.ts packages/shell/test/usage-log.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, test, build, commit**

Run: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm app:build`

```bash
git -C <worktree> add packages/shell/src/main/turn-controller.ts packages/shell/src/main/usage-log.ts packages/shell/test/turn-controller.test.ts
git -C <worktree> commit -m "feat(shell): keep context record fields out of the window; context-add turn kind"
```

---
### Task 4: Exclusions in the notes index; data tables one by one

**Files:**
- Modify: `packages/workspace/src/notes-index.ts`, `packages/workspace/src/data-context.ts`
- Test: `packages/workspace/test/notes-index.test.ts`, `packages/workspace/test/data-context.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/workspace/test/notes-index.test.ts`:

```ts
describe("buildNotesIndex exclude (context-panel spec §4.3)", () => {
  it("skips excluded notes before anything else; the rest is the same index", () => {
    const notes = [note(1), note(2), note(3)];
    const without = buildNotesIndex([note(1), note(3)]);
    expect(buildNotesIndex(notes, { exclude: new Set([".harness/notes/n2.md"]) })).toBe(without);
  });

  it("D0: an empty or absent set changes nothing; excluding every note gives an empty index", () => {
    const notes = [note(1), note(2)];
    expect(buildNotesIndex(notes, { exclude: new Set() })).toBe(buildNotesIndex(notes));
    expect(buildNotesIndex(notes, { exclude: new Set(notes.map((n) => n.path)) })).toBe("");
  });
});
```

Append to `packages/workspace/test/data-context.test.ts` (add `buildDataContextParts` to the import from `../src`; `setup` and `person` are the file's):

```ts
describe("buildDataContextParts (context-panel spec §3.1)", () => {
  it("one part per collection with the rows it loaded; joined, they are buildDataContext", async () => {
    const { store, data } = setup();
    await store.put("concepts", { id: "c1", name: "Halves", state: "new", notes: "" }, person);
    await store.put("concepts", { id: "c2", name: "Thirds", state: "new", notes: "" }, person);
    await store.put("profile", { name: "Ana", level: "6" }, { who: "person", scope: "_app" });
    const parts = await buildDataContextParts(store, data, "fracciones", "study");
    expect(parts.map((p) => [p.collection, p.rows])).toEqual([
      ["concepts", 2],
      ["profile", 1],
    ]);
    expect(parts.map((p) => p.text).join("\n\n")).toBe(await buildDataContext(store, data, "fracciones", "study"));
  });
});
```

(If `store.put`'s signature in `data.ts` differs, use the call the file's existing tests use to add records; the assertion is what matters.)

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/workspace/test/notes-index.test.ts packages/workspace/test/data-context.test.ts`
Expected: FAIL (the `exclude` option is ignored; `buildDataContextParts` is not exported).

- [ ] **Step 3: Implement**

`packages/workspace/src/notes-index.ts`, in `IndexOptions`:

```ts
  /** Note paths the person excluded (context-panel spec §4.3): left out before anything else. Absent or empty: none (D0). */
  exclude?: ReadonlySet<string>;
```

and the start of `buildNotesIndex`:

```ts
export function buildNotesIndex(all: Note[], opts: IndexOptions = {}): string {
  const notes = opts.exclude && opts.exclude.size > 0 ? all.filter((n) => !opts.exclude!.has(n.path)) : all;
  if (notes.length === 0) return "";
```

(the rest of the function is unchanged and keeps using `notes`).

`packages/workspace/src/data-context.ts`: rename the loop into `buildDataContextParts` and keep `buildDataContext` as the join:

```ts
/** One collection's table in a first message (context-panel spec §3.1 `data`): its name, the rows it loaded, its text. */
export interface DataContextPart {
  collection: string;
  rows: number;
  text: string;
}

/**
 * The data part of a new session's first message (spec §4.4), one table per collection with `context`, cut at its
 * `tokens` (the "more" line included). Empty when no collection has `context` (D2).
 */
export async function buildDataContextParts(store: DataStore, collections: Record<string, Collection>, scope: string, action: string | undefined): Promise<DataContextPart[]> {
  const parts: DataContextPart[] = [];
  for (const [name, c] of Object.entries(collections)) {
    // … the existing body of the loop, unchanged, down to `if (shown < records.length) lines.push(…)` …
    parts.push({ collection: name, rows: shown, text: lines.join("\n") });
  }
  return parts;
}

/** The tables joined: exactly the text the first message carried before (D0). */
export async function buildDataContext(store: DataStore, collections: Record<string, Collection>, scope: string, action: string | undefined): Promise<string> {
  return (await buildDataContextParts(store, collections, scope, action)).map((p) => p.text).join("\n\n");
}
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run packages/workspace/test`
Expected: PASS (every existing `buildDataContext` test still passes: D0).

- [ ] **Step 5: Typecheck, test, commit**

Run: `corepack pnpm typecheck && corepack pnpm test`

```bash
git -C <worktree> add packages/workspace/src/notes-index.ts packages/workspace/src/data-context.ts packages/workspace/test/notes-index.test.ts packages/workspace/test/data-context.test.ts
git -C <worktree> commit -m "feat(workspace): exclusions in the notes index; data tables one by one"
```

---

### Task 5: The pins file, the budget and the pinned section

**Files:**
- Create: `packages/workspace/src/context.ts`
- Modify: `packages/workspace/src/layout.ts`, `packages/workspace/src/subjects.ts`, `packages/workspace/src/history.ts`, `packages/workspace/src/index.ts`
- Test: `packages/workspace/test/context.test.ts`, `packages/workspace/test/history.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/workspace/test/context.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  CONTEXT_PREFIX,
  PIN_INLINE_MAX_BYTES,
  PINS_MAX,
  cleanContext,
  contextFile,
  fenceFor,
  loadContext,
  pinBlock,
  pinTitleLine,
  pinnedSection,
  pinsLayout,
  saveContext,
  titleOf,
} from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-ctx-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const AT = "2026-10-28T10:00:00.000Z";

describe("the context file", () => {
  it("lives at .harness/context/<scope>.json", () => {
    expect(CONTEXT_PREFIX).toBe(".harness/context/");
    expect(contextFile("/b", "main")).toBe(path.join("/b", ".harness", "context", "main.json"));
    expect(contextFile("/b", "_app")).toBe(path.join("/b", ".harness", "context", "_app.json"));
    expect(() => contextFile("/b", "../x")).toThrow();
  });

  it("is cleaned field by field: bad shapes, duplicates and the overflow are dropped", () => {
    const raw = {
      version: 1,
      pinned: [{ path: "a.md", at: AT }, { path: "a.md", at: AT }, { path: "../out.md", at: AT }, { path: "b.md", at: "never" }, { path: 3 }, "x"],
      excluded: [{ note: ".harness/notes/q-x.md", at: AT }, { note: "/abs.md", at: AT }],
    };
    expect(cleanContext(raw)).toEqual({ version: 1, pinned: [{ path: "a.md", at: AT }], excluded: [{ note: ".harness/notes/q-x.md", at: AT }] });
    expect(cleanContext({ version: 2 })).toEqual({ version: 1, pinned: [], excluded: [] });
    const many = { version: 1, pinned: Array.from({ length: PINS_MAX + 5 }, (_, i) => ({ path: `f${i}.md`, at: AT })), excluded: [] };
    expect(cleanContext(many).pinned).toHaveLength(PINS_MAX);
  });

  it("missing or broken reads as empty; save writes atomically and an empty file is removed", async () => {
    const base = fs.mkdtempSync(path.join(root, "b-"));
    expect(await loadContext(base, "main")).toEqual({ version: 1, pinned: [], excluded: [] });
    fs.mkdirSync(path.join(base, ".harness", "context"), { recursive: true });
    fs.writeFileSync(contextFile(base, "main"), "{not json");
    expect(await loadContext(base, "main")).toEqual({ version: 1, pinned: [], excluded: [] });
    await saveContext(base, "main", { version: 1, pinned: [{ path: "a.md", at: AT }], excluded: [] });
    expect(await loadContext(base, "main")).toEqual({ version: 1, pinned: [{ path: "a.md", at: AT }], excluded: [] });
    expect(fs.readdirSync(path.join(base, ".harness", "context"))).toEqual(["main.json"]);
    await saveContext(base, "main", { version: 1, pinned: [], excluded: [] });
    expect(fs.existsSync(contextFile(base, "main"))).toBe(false);
  });
});

describe("pinsLayout (§4.2 budget)", () => {
  const pin = (p: string, size: number | null, binary = false) => ({ scope: "main", path: p, at: AT, size, binary });

  it("whole in pin order while they fit; the first that doesn't fit and every later one are title only", () => {
    const views = pinsLayout([pin("a.md", 4000), pin("b.md", 12_000), pin("c.md", 400)], 3000);
    expect(views.map((v) => [v.path, v.state, v.tokens])).toEqual([
      ["a.md", "full", 1000],
      ["b.md", "title", 3000],
      ["c.md", "title", 100],
    ]);
  });

  it("missing and binary are skipped; over 1 MB is always title only and spends nothing", () => {
    const views = pinsLayout([pin("gone.md", null), pin("img.png", 10, true), pin("big.log", PIN_INLINE_MAX_BYTES + 1), pin("a.md", 400)], 3000);
    expect(views.map((v) => v.state)).toEqual(["missing", "binary", "title", "full"]);
  });
});

describe("the pinned section", () => {
  it("fences a file one backtick longer than its longest run", () => {
    expect(fenceFor("plain")).toBe("```");
    expect(fenceFor("a ```` b ``` c")).toBe("`````");
  });

  it("titles a file by its first # heading in 2 KB, else its name", () => {
    expect(titleOf("intro\n# Conventions\nbody", "docs/conv.md")).toBe("Conventions");
    expect(titleOf("## Not a title", "docs/conv.md")).toBe("conv.md");
    expect(titleOf(`${"x".repeat(3000)}\n# Late`, "a/late.md")).toBe("late.md");
  });

  it("writes whole pins under their path, then the titles with how to open them; nothing for nothing", () => {
    const text = pinnedSection([pinBlock("conventions.md", "Use pnpm.")], [pinTitleLine("Architecture", "docs/arch.md")]);
    expect(text).toBe(
      [
        "## Pinned by the person",
        "",
        "### conventions.md",
        "",
        "```",
        "Use pnpm.",
        "```",
        "",
        "### Also pinned",
        "- Architecture → docs/arch.md",
        "",
        "Open these with your read tool when you need them.",
      ].join("\n"),
    );
    expect(pinnedSection([], [])).toBe("");
  });
});
```

Append to `packages/workspace/test/history.test.ts` (add `CONTEXT_PREFIX` to the import from `../src`):

```ts
describe("appHistoryKeep and the context folder (context-panel spec §4.2)", () => {
  it("tracks .harness/context/, still not tasks.json; D0: nothing else changes", () => {
    expect(appHistoryKeep(false)).toEqual([NOTES_PREFIX, DATA_PREFIX, ".harness/reviews/", CONTEXT_PREFIX]);
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "hh-keep-"));
    const history = new History(folder, `${folder}.git`, [".harness/"], appHistoryKeep(false));
    expect(history.tracks(".harness/context/main.json")).toBe(true);
    expect(history.tracks(".harness/tasks.json")).toBe(false);
  });
});
```

(Use the imports the file already has for `fs`, `os` and `path`; add them if missing.)

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/workspace/test/context.test.ts packages/workspace/test/history.test.ts`
Expected: FAIL, the exports do not exist.

- [ ] **Step 3: Implement the layout, subject and keep**

`packages/workspace/src/layout.ts`, after `REVIEWS_PREFIX`:

```ts
/** Pins and exclusions per scope (context-panel spec §4.2): `.harness/context/<scope>.json`, tracked by the history. */
export const CONTEXT_PREFIX = ".harness/context/";
export const contextFile = (base: string, scope: string): string => path.join(base, ".harness", "context", `${scopeDir(scope)}.json`);
```

`packages/workspace/src/subjects.ts`, at the end:

```ts
/** The person pinned, unpinned, excluded or included something (context-panel spec §4): `Context: pinned <path>`. */
export const CONTEXT_CHANGE_PREFIX = "Context: ";
```

`packages/workspace/src/history.ts`: import `CONTEXT_PREFIX` from `./layout` and

```ts
export const appHistoryKeep = (material: boolean): HistoryKeep[] => [NOTES_PREFIX, DATA_PREFIX, REVIEWS_PREFIX, CONTEXT_PREFIX, ...(material ? [MATERIAL_KEEP] : [])];
```

Update the doc comment above it: "…the notes, the data, the review records and the context pins; …A harness whose person never pins has no file under `CONTEXT_PREFIX`, so its commits don't change."

- [ ] **Step 4: Write `packages/workspace/src/context.ts`**

```ts
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { refusedShape } from "@humanharness/harness-sdk/documents";
import { contextFile } from "./layout";

/** Most pins and exclusions one scope keeps (a bound on a hand-edited file; `full` past it). */
export const PINS_MAX = 50;
export const EXCLUDED_MAX = 200;
/** Over this a pinned file never enters whole (spec §6). */
export const PIN_INLINE_MAX_BYTES = 1024 * 1024;
/** The budget when neither the person nor the manifest set one (spec §4.2). */
export const DEFAULT_PINNED_TOKENS = 3000;
/** How far into a file its title is looked for. */
const TITLE_SCAN = 2048;
const TITLE_MAX = 120;

export interface Pin {
  path: string;
  at: string;
}
export interface Exclusion {
  note: string;
  at: string;
}
/** `.harness/context/<scope>.json`. */
export interface ContextFile {
  version: 1;
  pinned: Pin[];
  excluded: Exclusion[];
}

export const emptyContext = (): ContextFile => ({ version: 1, pinned: [], excluded: [] });

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isTime = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));

/** Built field by field: a path of the wrong shape, a bad time or a duplicate is dropped; the lists are bounded. */
export function cleanContext(raw: unknown): ContextFile {
  if (!isObject(raw) || raw.version !== 1) return emptyContext();
  const pinned: Pin[] = [];
  const seen = new Set<string>();
  for (const p of Array.isArray(raw.pinned) ? raw.pinned : []) {
    if (!isObject(p) || refusedShape(p.path) || !isTime(p.at) || seen.has(p.path as string)) continue;
    seen.add(p.path as string);
    pinned.push({ path: p.path as string, at: p.at });
    if (pinned.length === PINS_MAX) break;
  }
  const excluded: Exclusion[] = [];
  const notes = new Set<string>();
  for (const e of Array.isArray(raw.excluded) ? raw.excluded : []) {
    if (!isObject(e) || refusedShape(e.note) || !isTime(e.at) || notes.has(e.note as string)) continue;
    notes.add(e.note as string);
    excluded.push({ note: e.note as string, at: e.at });
    if (excluded.length === EXCLUDED_MAX) break;
  }
  return { version: 1, pinned, excluded };
}

/** A scope's pins and exclusions; a missing, unreadable or broken file reads as empty (the next write replaces it). */
export async function loadContext(base: string, scope: string): Promise<ContextFile> {
  let text: string;
  try {
    text = await fs.readFile(contextFile(base, scope), "utf8");
  } catch {
    return emptyContext();
  }
  try {
    return cleanContext(JSON.parse(text));
  } catch {
    return emptyContext();
  }
}

/** Atomic: temp file + rename. A file with nothing in it is removed, so a scope back to none leaves no file (D0). */
export async function saveContext(base: string, scope: string, file: ContextFile): Promise<void> {
  const target = contextFile(base, scope);
  const clean = cleanContext(file);
  if (clean.pinned.length === 0 && clean.excluded.length === 0) {
    await fs.rm(target, { force: true });
    return;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(clean, null, 2));
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

/** What is known of a pinned file before the budget is applied. `size` null: missing (or no longer safe to read). */
export interface PinFacts {
  scope: string;
  path: string;
  at: string;
  size: number | null;
  binary: boolean;
}

/** A pin's state for the next task (spec §4.2, §6), in the order given (the scope's pins, then the app's). */
export interface PinLayout {
  scope: string;
  path: string;
  at: string;
  state: "full" | "title" | "missing" | "binary";
  /** bytes / 4: the same number for the panel and the message. */
  tokens: number;
}

/**
 * Pins enter whole in order while they fit `budget`; the first that doesn't fit and every pin after it enter as title
 * only. A file over 1 MB is always title only and spends nothing. Missing and binary pins are skipped.
 */
export function pinsLayout(pins: readonly PinFacts[], budget: number): PinLayout[] {
  let used = 0;
  let spent = false;
  return pins.map((p): PinLayout => {
    const base = { scope: p.scope, path: p.path, at: p.at };
    if (p.size === null) return { ...base, state: "missing", tokens: 0 };
    if (p.binary) return { ...base, state: "binary", tokens: 0 };
    const tokens = Math.ceil(p.size / 4);
    if (p.size > PIN_INLINE_MAX_BYTES) return { ...base, state: "title", tokens };
    if (!spent && used + tokens <= budget) {
      used += tokens;
      return { ...base, state: "full", tokens };
    }
    spent = true;
    return { ...base, state: "title", tokens };
  });
}

/** A fence one backtick longer than the longest backtick run in `text` (at least three). A loop, never a regex. */
export function fenceFor(text: string): string {
  let longest = 0;
  let run = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 96) {
      run++;
      if (run > longest) longest = run;
    } else run = 0;
  }
  return "`".repeat(Math.max(3, longest + 1));
}

/** The first `# ` heading in the first 2 KB, else the file's name (spec §4.2 "title and path"). */
export function titleOf(text: string, file: string): string {
  const head = text.slice(0, TITLE_SCAN);
  let start = 0;
  while (start <= head.length) {
    const end = head.indexOf("\n", start);
    const line = head.slice(start, end === -1 ? head.length : end);
    // A line cut by the 2 KB edge is not trusted as a title.
    if (end === -1 && text.length > TITLE_SCAN) break;
    if (line.startsWith("# ")) {
      const title = line.slice(2).trim();
      if (title) return title.slice(0, TITLE_MAX);
    }
    if (end === -1) break;
    start = end + 1;
  }
  return file.slice(file.lastIndexOf("/") + 1);
}

/** One whole pin: its path as a heading and its text in a fence. */
export function pinBlock(file: string, text: string): string {
  const fence = fenceFor(text);
  return [`### ${file}`, "", fence, text.endsWith("\n") ? text.slice(0, -1) : text, fence].join("\n");
}

/** One title-only pin. */
export const pinTitleLine = (title: string, file: string): string => `- ${title} → ${file}`;

/** The section after the data tables (spec §4.2); "" without pins (D0). */
export function pinnedSection(blocks: readonly string[], titles: readonly string[]): string {
  if (blocks.length === 0 && titles.length === 0) return "";
  const parts = ["## Pinned by the person"];
  for (const b of blocks) parts.push("", b);
  if (titles.length > 0) parts.push("", "### Also pinned", ...titles, "", "Open these with your read tool when you need them.");
  return parts.join("\n");
}
```

`packages/workspace/src/index.ts`: add `export * from "./context";`.

`DEFAULT_PINNED_TOKENS` lives here (the workspace is shared by the shell and the CLI); Task 10 re-uses it.

- [ ] **Step 5: Run the tests**

Run: `corepack pnpm vitest run packages/workspace/test`
Expected: PASS. If an existing history test compares `appHistoryKeep(…)` exactly, add `CONTEXT_PREFIX` in the same position.

- [ ] **Step 6: Typecheck, test, commit**

Run: `corepack pnpm typecheck && corepack pnpm test`

```bash
git -C <worktree> add packages/workspace/src/context.ts packages/workspace/src/layout.ts packages/workspace/src/subjects.ts packages/workspace/src/history.ts packages/workspace/src/index.ts packages/workspace/test/context.test.ts packages/workspace/test/history.test.ts
git -C <worktree> commit -m "feat(workspace): pins and exclusions per scope, the budget and the pinned section"
```

---

### Task 6: The task keeps its start, its first-turn tokens and its reads

**Files:**
- Modify: `packages/shell/src/main/task-store.ts`
- Test: `packages/shell/test/task-store.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/shell/test/task-store.test.ts` (it already writes raw JSON to a temp folder and loads it through `TaskStore`; reuse its helper for that, here called `roundTrip(raw)`; if the file has none, write `tasks.json` with `fs.writeFileSync(path.join(folder, ".harness", "tasks.json"), JSON.stringify(raw))` and `await new TaskStore(folder).load()`):

```ts
describe("the context record (context-panel spec §3)", () => {
  const current = (extra: Record<string, unknown>) => ({
    version: 1,
    actions: {},
    current: { id: "t1", status: "waiting", startedAt: "2026-10-28T10:00:00.000Z", turns: 1, ...extra },
  });

  it("keeps well-formed start items, the first-turn tokens and the reads", async () => {
    const start = [
      { id: "instructions", kind: "instructions", label: "Harness instructions", path: "AGENTS.md", tokens: 1200 },
      { id: "notes", kind: "notes-index", label: "Notes (2)", tokens: 300, count: 2, notes: [{ path: ".harness/notes/a.md", title: "A" }], compacted: true },
      { id: "brief:1", kind: "brief", label: "Mode brief", tokens: 200, at: "2026-10-28T10:05:00.000Z" },
    ];
    const reads = [{ kind: "read", label: "a.md", path: "a.md", firstAt: "2026-10-28T10:01:00.000Z", count: 2 }, { kind: "tool", label: "data · data_query", firstAt: "2026-10-28T10:02:00.000Z", count: 1, compacted: true }];
    const loaded = await roundTrip(current({ start, startTokens: 6312, reads }));
    expect(loaded.current).toMatchObject({ start, startTokens: 6312, reads });
  });

  it("drops what has the wrong shape and bounds the lists", async () => {
    const loaded = await roundTrip(
      current({
        start: [{ id: "x", kind: "nope", label: "x", tokens: 1 }, { id: "y", kind: "brief", label: "y", tokens: -1 }, { id: "z", kind: "data", label: "z", tokens: 5, path: "../out" }, "junk"],
        startTokens: "many",
        reads: [{ kind: "read", label: "a", firstAt: "T", count: 0 }, ...Array.from({ length: 600 }, (_, i) => ({ kind: "read", label: `f${i}`, path: `f${i}`, firstAt: "2026-10-28T10:00:00.000Z", count: 1 }))],
      }),
    );
    expect(loaded.current?.start).toEqual([]);
    expect(loaded.current?.startTokens).toBeUndefined();
    expect(loaded.current?.reads).toHaveLength(500);
  });

  it("D0: a task without them has none", async () => {
    const loaded = await roundTrip(current({}));
    expect(loaded.current).not.toHaveProperty("start");
    expect(loaded.current).not.toHaveProperty("reads");
    expect(loaded.current).not.toHaveProperty("startTokens");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/shell/test/task-store.test.ts`
Expected: FAIL (the fields are dropped by `cleanCurrent`).

- [ ] **Step 3: Implement**

`packages/shell/src/main/task-store.ts`: import the types and bounds:

```ts
import { refusedShape } from "@humanharness/harness-sdk";
import type { ContextItem, ContextItemKind, ContextRead } from "@humanharness/ui/client";
import { INDEX_NOTES_MAX, READS_MAX, START_ITEMS_MAX } from "./context-record";
```

(`refusedShape` joins the existing import from `@humanharness/harness-sdk`.)

In `CurrentTask`, after `notices`:

```ts
  /** What the app loaded into the task's first message (context-panel spec §3.1), plus briefs that came later. */
  start?: ContextItem[];
  /** The first turn's real input tokens (its `usage`), once it ended. */
  startTokens?: number;
  /** Files, notes and tools the agent used (spec §3.2). */
  reads?: ContextRead[];
```

Cleaners, after `cleanPending`:

```ts
const ITEM_KINDS: readonly string[] = ["instructions", "scope-instructions", "brief", "notes-index", "app-notes-index", "data", "material", "pinned", "pinned-title"];
const LABEL_MAX = 300;
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isTokens = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const isRel = (v: unknown): v is string => !refusedShape(v);

function cleanItem(raw: unknown): ContextItem | null {
  if (!isObject(raw) || typeof raw.id !== "string" || !raw.id || raw.id.length > 1100 || !ITEM_KINDS.includes(raw.kind as string)) return null;
  if (typeof raw.label !== "string" || !isTokens(raw.tokens)) return null;
  if (raw.path !== undefined && !isRel(raw.path)) return null;
  const notes = Array.isArray(raw.notes)
    ? raw.notes
        .filter((n): n is { path: string; title: string } => isObject(n) && isRel(n.path) && typeof n.title === "string")
        .slice(0, INDEX_NOTES_MAX)
        .map((n) => ({ path: n.path, title: n.title.slice(0, LABEL_MAX) }))
    : undefined;
  return {
    id: raw.id,
    kind: raw.kind as ContextItemKind,
    label: raw.label.slice(0, LABEL_MAX),
    ...(raw.path !== undefined ? { path: raw.path as string } : {}),
    tokens: raw.tokens,
    ...(typeof raw.at === "string" && Number.isFinite(Date.parse(raw.at)) ? { at: raw.at } : {}),
    ...(isCount(raw.count) ? { count: raw.count } : {}),
    ...(notes ? { notes } : {}),
    ...(isScopeDir(raw.scope) ? { scope: raw.scope } : {}),
    ...(raw.compacted === true ? { compacted: true as const } : {}),
  };
}

function cleanRead(raw: unknown): ContextRead | null {
  if (!isObject(raw) || (raw.kind !== "read" && raw.kind !== "tool") || typeof raw.label !== "string" || !raw.label) return null;
  if (typeof raw.firstAt !== "string" || !Number.isFinite(Date.parse(raw.firstAt)) || !isCount(raw.count) || raw.count < 1) return null;
  if (raw.path !== undefined && !isRel(raw.path)) return null;
  return {
    kind: raw.kind,
    label: raw.label.slice(0, LABEL_MAX),
    ...(raw.path !== undefined ? { path: raw.path as string } : {}),
    firstAt: raw.firstAt,
    count: raw.count,
    ...(raw.compacted === true ? { compacted: true as const } : {}),
  };
}

const cleanList = <T>(raw: unknown, clean: (v: unknown) => T | null, max: number): T[] | undefined =>
  Array.isArray(raw) ? raw.map(clean).filter((v): v is T => v !== null).slice(0, max) : undefined;
```

In `cleanCurrent`, before the `return`:

```ts
  const start = cleanList(c.start, cleanItem, START_ITEMS_MAX);
  const reads = cleanList(c.reads, cleanRead, READS_MAX);
```

and at the end of the returned object:

```ts
    ...(start ? { start } : {}),
    ...(isCount(c.startTokens) ? { startTokens: c.startTokens } : {}),
    ...(reads ? { reads } : {}),
```

(An empty array that was stored stays an empty array: `start: []` means "recorded, nothing loaded", which the panel shows as such.)

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run packages/shell/test/task-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, test, commit**

Run: `corepack pnpm typecheck && corepack pnpm test`

```bash
git -C <worktree> add packages/shell/src/main/task-store.ts packages/shell/test/task-store.test.ts
git -C <worktree> commit -m "feat(shell): tasks.json keeps the task's context record"
```

---
### Task 7: The task manager records the start; pins and exclusions reach new tasks

**Files:**
- Modify: `packages/shell/src/main/task-manager.ts`
- Test: `packages/shell/test/task-manager-context.test.ts` (create)

- [ ] **Step 1: Write the failing tests**

Create `packages/shell/test/task-manager-context.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Event } from "@humanharness/runtime";
import type { ContextItem } from "@humanharness/ui/client";
import type { Note } from "@humanharness/workspace";
import { approxTokens } from "../src/main/context-record";
import { emptyTasks } from "../src/main/task-store";
import { setup } from "./task-manager-fixture";

const note = (slug: string, date: string): Note => ({
  slug,
  path: `.harness/notes/${slug}.md`,
  title: `Note ${slug}`,
  date,
  engine: "claude",
  summary: [`about ${slug}`],
  decisions: [],
  files: [],
  open: [],
});
const NOTES = [note("a", "2026-10-20T10:00:00.000Z"), note("b", "2026-10-21T10:00:00.000Z")];
const TABLE = "## Data: tickets\n\n| id |\n|---|\n| T-1 |\n| T-2 |";
const PIN = "## Pinned by the person\n\n### conventions.md\n\n```\nUse pnpm.\n```";
const pinItem: ContextItem = { id: "pin:main:conventions.md", kind: "pinned", label: "Pinned · conventions.md", path: "conventions.md", tokens: 100, scope: "main" };

describe("the start of a task (context-panel spec §3.1)", () => {
  it("records instructions, brief, notes, data and material, in the message's order; they add up to the message", async () => {
    const t = setup({
      extra: {
        notes: async () => NOTES,
        instructionsSize: async () => 4800,
        dataContext: async () => [{ collection: "tickets", rows: 2, text: TABLE }],
        materialContext: async () => "## Material\n\nsheet",
      },
    });
    await t.manager.start("quiz");
    const start = t.state().current?.start ?? [];
    expect(start.map((i) => [i.id, i.kind])).toEqual([
      ["instructions", "instructions"],
      ["brief", "brief"],
      ["notes", "notes-index"],
      ["data:tickets", "data"],
      ["material", "material"],
    ]);
    expect(start[0]).toMatchObject({ path: "AGENTS.md", tokens: approxTokens(4800) });
    expect(start[2]).toMatchObject({ label: "Notes (2)", count: 2, notes: [{ path: ".harness/notes/b.md", title: "Note b" }, { path: ".harness/notes/a.md", title: "Note a" }] });
    expect(start[3]).toMatchObject({ label: "Data · tickets (2 rows)", count: 2 });
    // The brief is what the message holds beyond the other items, so the items add up to the message's estimate.
    const others = start.slice(2).reduce((n, i) => n + i.tokens, 0);
    expect(start[1].tokens).toBe(Math.max(0, approxTokens(t.turns[0].message.length) - others));
  });

  it("D0: no hooks, or hooks with nothing pinned or excluded, give the same first message", async () => {
    const plain = setup({ extra: { notes: async () => NOTES } });
    await plain.manager.start("quiz");
    const hooked = setup({ extra: { notes: async () => NOTES, personContext: async () => ({ pinned: "", items: [], excluded: new Set<string>() }) } });
    await hooked.manager.start("quiz");
    expect(hooked.turns[0].message).toBe(plain.turns[0].message);
  });

  it("pins go after the data and before the material; excluded notes leave the index", async () => {
    const t = setup({
      extra: {
        notes: async () => NOTES,
        dataContext: async () => TABLE,
        materialContext: async () => "## Material\n\nsheet",
        personContext: async () => ({ pinned: PIN, items: [pinItem], excluded: new Set([".harness/notes/a.md"]) }),
      },
    });
    await t.manager.start("quiz");
    const m = t.turns[0].message;
    expect(m.indexOf(TABLE)).toBeLessThan(m.indexOf(PIN));
    expect(m.indexOf(PIN)).toBeLessThan(m.indexOf("## Material"));
    expect(m).not.toContain(".harness/notes/a.md");
    expect(m).toContain(".harness/notes/b.md");
    const start = t.state().current?.start ?? [];
    expect(start.map((i) => i.id)).toEqual(["brief", "notes", "data", "pin:main:conventions.md", "material"]);
    expect(start.find((i) => i.id === "notes")).toMatchObject({ count: 1 });
  });

  it("a question's brief is the question; a failing hook loads nothing and the task still starts", async () => {
    const t = setup({ extra: { personContext: async () => Promise.reject(new Error("disk")) } });
    await t.manager.ask("What is a fraction?");
    expect(t.state().current?.start?.[0]).toMatchObject({ id: "brief", label: "Question" });
    expect(t.turns).toHaveLength(1);
  });

  it("a resumed task records its resume message instead, and forgets the old first-turn tokens", async () => {
    const state = emptyTasks();
    state.current = {
      id: "t9",
      action: "quiz",
      status: "waiting",
      startedAt: "2026-10-26T09:00:00.000Z",
      turns: 2,
      resume: true,
      start: [{ id: "brief", kind: "brief", label: "Task brief", tokens: 900 }],
      startTokens: 5000,
    };
    const t = setup({ state, extra: { notes: async () => NOTES } });
    await t.manager.ask("Go on");
    const c = t.state().current;
    expect(c?.start?.map((i) => i.id)).toEqual(["brief", "notes"]);
    expect(c?.start?.[0].tokens).not.toBe(900);
  });
});
```

(`ok` events come from the fixture's default script. The last test's `startTokens` is checked again in Task 8, once the resumed turn's usage sets it.)

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/shell/test/task-manager-context.test.ts`
Expected: FAIL (`start` is undefined; `instructionsSize` and `personContext` are unknown deps, a type error vitest does not report).

- [ ] **Step 3: Add the deps**

`packages/shell/src/main/task-manager.ts`: imports.

```ts
import type { ContextItem } from "@humanharness/ui/client";
import { type DataContextPart } from "@humanharness/workspace";
import { INDEX_NOTES_MAX, START_ITEMS_MAX, approxTokens } from "./context-record";
```

(`ContextItem` joins the existing type import from `@humanharness/ui/client`; `DataContextPart` joins the existing import from `@humanharness/workspace`.)

After `ScopeRequired`:

```ts
/** The person's pins and exclusions for a new task (context-panel spec §4): what the first message gets from them. */
export interface PersonContext {
  /** The pinned section ("" for none) and one item per pin it names. */
  pinned: string;
  items: ContextItem[];
  /** Note paths left out of both notes indexes. */
  excluded: ReadonlySet<string>;
}
```

In `TaskDeps`, change `dataContext` and add three hooks:

```ts
  /**
   * The data tables a new session's first message carries after the notes (spec §4.4): "" for none, or one part per
   * collection (context-panel spec §3.1: one item each). The text is the same either way.
   */
  dataContext?(scope: string, action: string | undefined): Promise<string | DataContextPart[]>;
  /** AGENTS.md's size in bytes in the agent's working folder (context-panel spec §3.1); null when missing. Absent: no item. */
  instructionsSize?(): Promise<number | null>;
  /** Pins and exclusions for a new task in `scope` (context-panel spec §4). Absent: none (D0). */
  personContext?(scope: string): Promise<PersonContext>;
  /** The open task's context record changed (its start, reads or compaction): the panel refreshes. */
  contextChanged?(taskId: string): void;
```

- [ ] **Step 4: `contextFor` returns the text and the items**

Replace `contextFor`:

```ts
  /**
   * A new session's context (spec §3.3, §4.4): the scope's notes index; in a scope, the app-wide one, trimmed; the data
   * tables; the person's pins (context-panel spec §4.2); the material. Without scopes, data, pins or material, exactly
   * the notes index as before (D2, D0). `items` say what each part is (context-panel spec §3.1).
   */
  private async contextFor(scope: string, action: string | undefined): Promise<{ text: string; items: ContextItem[] }> {
    const person = this.d.personContext
      ? await this.d.personContext(scope).catch((err: unknown) => {
          console.error("Could not load the pins and exclusions for the task", err);
          return null;
        })
      : null;
    const exclude = person && person.excluded.size > 0 ? { exclude: person.excluded } : {};
    const items: ContextItem[] = [];
    const ownNotes = await this.d.notes(this.d.scoped ? scope : undefined).catch(() => [] as Note[]);
    const own = buildNotesIndex(ownNotes, exclude);
    const parts = [own];
    if (own) items.push(indexItem("notes", "notes-index", "Notes", own, ownNotes, person?.excluded));
    if (this.d.scoped && scope !== APP_SCOPE) {
      const app = await this.d.notes(APP_SCOPE).catch(() => [] as Note[]);
      // The own index ends with the "open a note" line; the app-wide one says it only when it stands alone.
      const appIndex = buildNotesIndex(app, {
        budgetTokens: APP_INDEX_TOKENS,
        heading: "## App-wide notes",
        decisionsHeading: "## App-wide decisions",
        ...(own ? { footer: null } : {}),
        ...exclude,
      });
      parts.push(appIndex);
      if (appIndex) items.push(indexItem("app-notes", "app-notes-index", "App-wide notes", appIndex, app, person?.excluded));
    }
    if (this.d.dataContext) {
      const data = await this.d.dataContext(scope, action).catch((err: unknown) => {
        console.error("Could not load the data for the task", err);
        return "";
      });
      if (typeof data === "string") {
        parts.push(data);
        if (data) items.push({ id: "data", kind: "data", label: "Data", tokens: approxTokens(data.length) });
      } else {
        for (const p of data) {
          parts.push(p.text);
          items.push({ id: `data:${p.collection}`, kind: "data", label: `Data · ${p.collection} (${p.rows} rows)`, tokens: approxTokens(p.text.length), count: p.rows });
        }
      }
    }
    if (person?.pinned) {
      parts.push(person.pinned);
      items.push(...person.items);
    }
    if (this.d.materialContext) {
      const material = await this.d.materialContext(scope).catch((err: unknown) => {
        console.error("Could not load the material for the task", err);
        return "";
      });
      parts.push(material);
      if (material) items.push({ id: "material", kind: "material", label: "Material", tokens: approxTokens(material.length) });
    }
    return { text: parts.filter(Boolean).join("\n\n"), items };
  }

  /** The whole start (spec §3.1): the instructions, the brief (what the message holds beyond the other items), the items. */
  private async startItems(message: string, items: ContextItem[], briefLabel: string): Promise<ContextItem[]> {
    const size = this.d.instructionsSize ? await this.d.instructionsSize().catch(() => null) : null;
    const others = items.reduce((n, i) => n + i.tokens, 0);
    const brief: ContextItem = { id: "brief", kind: "brief", label: briefLabel, tokens: Math.max(0, approxTokens(message.length) - others) };
    const instructions: ContextItem[] = size ? [{ id: "instructions", kind: "instructions", label: "Harness instructions", path: "AGENTS.md", tokens: approxTokens(size) }] : [];
    return [...instructions, brief, ...items].slice(0, START_ITEMS_MAX);
  }
```

At module level, after `noteView`:

```ts
/** A notes index as an item: how many notes it covers and, newest first, the ones "Exclude" can act on. */
function indexItem(id: string, kind: "notes-index" | "app-notes-index", label: string, text: string, notes: Note[], excluded: ReadonlySet<string> | undefined): ContextItem {
  const listed = (excluded ? notes.filter((n) => !excluded.has(n.path)) : notes).slice().sort((a, b) => b.date.localeCompare(a.date));
  return {
    id,
    kind,
    label: `${label} (${listed.length})`,
    tokens: approxTokens(text.length),
    count: listed.length,
    notes: listed.slice(0, INDEX_NOTES_MAX).map((n) => ({ path: n.path, title: n.title })),
  };
}
```

- [ ] **Step 5: `begin` and `resumeMessageFor` store the start**

In `begin`, replace `const context = await this.contextFor(scope, task.action);` and the message use:

```ts
    const { text: context, items } = await this.contextFor(scope, task.action);
    const first = message(context);
    const briefLabel = task.review !== undefined ? "Review round" : task.action !== undefined ? "Task brief" : "Question";
    const start = await this.startItems(first, items, briefLabel);
```

add `start` to the new `current` (after `...(below ? … : {})`):

```ts
      start,
```

and send `first`:

```ts
      done = await this.firstTurn(current, first, { display, ...(task.action ? { action: task.action } : {}) });
```

After `await this.update((s) => ({ ...s, engine, current }));` add `this.changedContext(current.id);`.

In `resumeMessageFor`, replace the `return resumeMessage({ … notesIndex: await this.contextFor(scopeOfTask(c), c.action), … })` with:

```ts
    const { text: notesIndex, items } = await this.contextFor(scopeOfTask(c), c.action);
    const message = resumeMessage({
      language,
      notesIndex,
      ...(brief !== undefined ? { brief } : {}),
      ...(mode ? { mode } : {}),
      ...(phase ? { phase } : {}),
      ...(c.timeBox ? { timeLeft: this.timeLeft(c) } : {}),
      ...(c.question ? { question: c.question, ...(c.questionCut ? { questionCut: true } : {}) } : {}),
      message: text,
    });
    // A resumed task starts a new session (context-panel spec §3.1): its record is this message's, and the first-turn
    // tokens are the resumed turn's.
    const start = await this.startItems(message, items, brief !== undefined ? "Task brief" : "Question");
    await this.update((s) => {
      if (s.current?.id !== c.id) return s;
      const { startTokens: _old, ...rest } = s.current;
      return { ...s, current: { ...rest, start } };
    });
    this.changedContext(c.id);
    return message;
```

Add the notifier near `tellTurn`:

```ts
  /** The panel refreshes (context-panel spec §5.2). A failing listener never breaks the task. */
  private changedContext(id: string): void {
    try {
      this.d.contextChanged?.(id);
    } catch (err) {
      console.error("Could not tell the window about the task's context", err);
    }
  }
```

- [ ] **Step 6: Run the tests**

Run: `corepack pnpm vitest run packages/shell/test`
Expected: PASS. Every existing task-manager test passes unchanged: the messages are byte for byte the same (D0). `task-manager-scopes.test.ts`'s `data` option still returns a string; the union keeps it working.

- [ ] **Step 7: Typecheck, test, commit**

Run: `corepack pnpm typecheck && corepack pnpm test`

```bash
git -C <worktree> add packages/shell/src/main/task-manager.ts packages/shell/test/task-manager-context.test.ts
git -C <worktree> commit -m "feat(shell): record what a task starts with; pins and exclusions reach new tasks"
```

---

### Task 8: During the task — reads, tools, first-turn tokens, compaction, later briefs

**Files:**
- Modify: `packages/shell/src/main/task-manager.ts`
- Test: `packages/shell/test/task-manager-context.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/shell/test/task-manager-context.test.ts`:

```ts
const read = (id: string, p: string): Event => ({ type: "activity", id, kind: "read", detail: p, state: "start", paths: [`/w/${p}`] });
const usage = (input: number, cacheRead = 0): Event => ({ type: "usage", inputTokens: input, outputTokens: 10, cacheReadTokens: cacheRead, cacheWriteTokens: 0 });
const ok: Event = { type: "done", ok: true };

describe("during the task (context-panel spec §3.2)", () => {
  it("records reads by folder path and tools by name, with counts, once per turn; the first turn's real tokens", async () => {
    const changed: string[] = [];
    const t = setup({
      script: [
        [read("r1", "docs/a.md"), { type: "activity", id: "m1", kind: "other", detail: "", state: "start", tool: { server: "atlassian", name: "getJiraIssue" } }, usage(6000, 300), ok],
        [read("r2", "docs/a.md"), { type: "activity", id: "r3", kind: "read", detail: "x.pdf", state: "start", paths: ["/refs/x.pdf"] }, usage(100), ok],
      ],
      extra: { folder: async () => "/w", contextChanged: (id: string) => void changed.push(id) },
    });
    await t.manager.start("quiz");
    await t.manager.ask("more");
    const c = t.state().current;
    expect(c?.startTokens).toBe(6300);
    expect(c?.reads?.map((r) => [r.kind, r.label, r.path, r.count])).toEqual([
      ["read", "docs/a.md", "docs/a.md", 2],
      ["tool", "atlassian · getJiraIssue", undefined, 1],
      ["read", "x.pdf", undefined, 1],
    ]);
    expect(changed.length).toBeGreaterThanOrEqual(3);
  });

  it("a compaction marks everything before it; a read after it is fresh again", async () => {
    const t = setup({
      script: [[read("r1", "a.md"), ok], [{ type: "compaction" }, { type: "context", used: 1000 }, ok], [read("r2", "a.md"), ok]],
      extra: { folder: async () => "/w" },
    });
    await t.manager.start("quiz");
    await t.manager.ask("one");
    expect(t.state().current?.start?.every((i) => i.compacted === true)).toBe(true);
    expect(t.state().current?.reads?.[0].compacted).toBe(true);
    await t.manager.ask("two");
    expect(t.state().current?.reads?.[0]).not.toHaveProperty("compacted");
  });

  it("a mode switch and a phase change add their brief with the time it arrived", async () => {
    // No phases, so the switch is a plain mode turn; the task starts in its default mode.
    const t = setup({ phases: [], modes: { modes: ["socratic", "feynman"], defaultMode: "socratic" } });
    await t.manager.start("session");
    await t.manager.chooseMode("feynman").done;
    const briefs = (t.state().current?.start ?? []).filter((i) => i.kind === "brief");
    expect(briefs.length).toBeGreaterThanOrEqual(2);
    expect(briefs.at(-1)).toMatchObject({ id: expect.stringMatching(/^brief:\d+$/), label: "Mode brief · Feynman", at: expect.any(String) });
  });

  it("D0: no reads, no tools and no usage write nothing new", async () => {
    const t = setup({ script: [[ok]] });
    await t.manager.start("quiz");
    expect(t.state().current).not.toHaveProperty("reads");
    expect(t.state().current).not.toHaveProperty("startTokens");
  });
});
```

Add one more test to the same `describe`:

```ts
it("the resumed turn's usage is the new first-turn total", async () => {
  const state = emptyTasks();
  state.current = { id: "t9", action: "quiz", status: "waiting", startedAt: "2026-10-26T09:00:00.000Z", turns: 2, resume: true, startTokens: 5000 };
  const t = setup({ state, script: [[usage(700), ok]] });
  await t.manager.ask("Go on");
  expect(t.state().current?.startTokens).toBe(700);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/shell/test/task-manager-context.test.ts`
Expected: FAIL (no `reads`, no `startTokens`, no compaction marks, no later briefs).

- [ ] **Step 3: Implement**

`packages/shell/src/main/task-manager.ts`: extend the imports from `./context-record`:

```ts
import { INDEX_NOTES_MAX, START_ITEMS_MAX, type SeenRead, approxTokens, markCompacted, mergeReads, readsOf } from "./context-record";
```

`TaskDeps`:

```ts
  /** The folder the agent works in, to turn read paths into folder paths (context-panel spec §3.2). Absent: file names only. */
  folder?(): Promise<string | null>;
```

A field on `TaskManager`, next to `turnTask`:

```ts
  /** The task whose next turn's `usage` is its first-turn total (a first turn, or a resumed one): context-panel spec §3.1. */
  private recordStart: string | null = null;
```

In `begin`, right before `done = await this.firstTurn(current, first, …)`: `this.recordStart = current.id;`.
In `askNow`, in the `c.resume` branch, right before the `done = c.resume ? … : …` line: `if (c.resume) this.recordStart = c.id;`.

In `runTurn`, extend `seen` and the listener:

```ts
    const seen: { done?: Done; note?: SavedNote; used?: number; size?: number; compacted?: boolean; phaseAsk?: PhaseRequest; reads: SeenRead[]; input?: number } = { reads: [] };
    const base = this.d.folder ? await this.d.folder().catch(() => null) : null;
```

and in `onEvent`, before the `context` branch:

```ts
          } else if (e.type === "activity") {
            seen.reads.push(...readsOf(e, base));
          } else if (e.type === "usage") {
            seen.input = e.inputTokens + e.cacheReadTokens + e.cacheWriteTokens;
```

After `if (seen.used !== undefined || seen.compacted) await this.track(task.id, seen);` add:

```ts
    const startTokens = this.recordStart === task.id && seen.input !== undefined ? seen.input : undefined;
    if (startTokens !== undefined) this.recordStart = null;
    if (seen.reads.length > 0 || startTokens !== undefined) await this.recordTurn(task.id, seen.reads, startTokens);
```

New methods, after `track`:

```ts
  /** One turn's reads and tools, merged once it ended (context-panel spec §3.2), and the first-turn total. */
  private async recordTurn(id: string, reads: SeenRead[], startTokens: number | undefined): Promise<void> {
    const at = this.now().toISOString();
    await this.update((s) => {
      if (s.current?.id !== id) return s;
      return {
        ...s,
        current: {
          ...s.current,
          ...(reads.length > 0 ? { reads: mergeReads(s.current.reads ?? [], reads, at) } : {}),
          ...(startTokens !== undefined ? { startTokens } : {}),
        },
      };
    });
    this.changedContext(id);
  }

  /** A brief that reached the session after its start (a mode switch, a phase change): one more `brief` item (§3.1). */
  private async addBrief(id: string, label: string, message: string): Promise<void> {
    const at = this.now().toISOString();
    await this.update((s) => {
      if (s.current?.id !== id) return s;
      const start = s.current.start ?? [];
      const n = start.filter((i) => i.kind === "brief").length;
      const item: ContextItem = { id: `brief:${n}`, kind: "brief", label, tokens: approxTokens(message.length), at };
      return { ...s, current: { ...s.current, start: [...start, item].slice(0, START_ITEMS_MAX) } };
    });
    this.changedContext(id);
  }
```

In `track`, the compaction marks ride on the same update:

```ts
    await this.update((s) => {
      if (s.current?.id !== id) return s;
      const marks = compacted
        ? { ...(s.current.start ? { start: markCompacted(s.current.start) } : {}), ...(s.current.reads ? { reads: markCompacted(s.current.reads) } : {}) }
        : {};
      return { ...s, current: { ...s.current, ...(context ? { context } : {}), ...(compacted ? { checkpointed: false } : {}), ...marks } };
    });
    if (compacted) this.changedContext(id);
    if (!compacted) return;
```

In `modeNow`, right before `done = await this.runTurn(c, message, { display: \`Switched to ${text.label}\`, … })`:

```ts
      await this.addBrief(c.id, `Mode brief · ${text.label}`, message);
```

In `enterPhase`, right before `done = await this.runTurn(now, message, { display: \`— ${oneLine(to.label)} —\`, … })`:

```ts
    await this.addBrief(c.id, `Phase brief · ${oneLine(to.label)}`, message);
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run packages/shell/test`
Expected: PASS. Existing tests that compare `state().current` with `toEqual` now also see `start` (and, with usage events in their scripts, `startTokens`): update those expectations by adding exactly those fields, or switch them to `toMatchObject`; never change any message assertion.

- [ ] **Step 5: Typecheck, test, commit**

Run: `corepack pnpm typecheck && corepack pnpm test`

```bash
git -C <worktree> add packages/shell/src/main/task-manager.ts packages/shell/test
git -C <worktree> commit -m "feat(shell): record reads, tools, first-turn tokens, compactions and later briefs"
```

---

### Task 9: "Add now" — one turn that reads a file

**Files:**
- Modify: `packages/shell/src/main/task-prompts.ts`, `packages/shell/src/main/task-manager.ts`
- Test: `packages/shell/test/task-prompts.test.ts`, `packages/shell/test/task-manager-context.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/shell/test/task-prompts.test.ts` (add `CONTEXT_ADD_PROMPT, addablePath, contextAddPrompt` to the import from `../src/main/task-prompts`):

```ts
describe("the Add now prompt (context-panel spec §4.1)", () => {
  it("names the path in backticks; the mock replay knows it by its start", () => {
    expect(contextAddPrompt("docs/conventions.md")).toBe(
      "The person wants you to take `docs/conventions.md` into account. Read it now and say in one line what changes for this task.",
    );
    expect(CONTEXT_ADD_PROMPT.startsWith("The person wants you to take `")).toBe(true);
  });

  it("only takes a path that can't break out of its backticks or its line", () => {
    expect(addablePath("docs/a b.md")).toBe(true);
    expect(addablePath("a`b.md")).toBe(false);
    expect(addablePath("a\nb.md")).toBe(false);
    expect(addablePath("a\u0007.md")).toBe(false);
    expect(addablePath("")).toBe(false);
  });
});
```

Append to `packages/shell/test/task-manager-context.test.ts`:

```ts
describe("Add now (context-panel spec §4.1)", () => {
  it("runs one visible turn of kind context-add on the waiting task, told to the window first", async () => {
    const t = setup({ script: [[ok], [read("r1", "docs/conv.md"), ok]], extra: { folder: async () => "/w" } });
    await t.manager.start("quiz");
    const { accepted, done } = t.manager.addContext("t1", "docs/conv.md");
    expect(await accepted).toEqual({ ok: true });
    await done;
    expect(t.notices.at(-1)).toEqual({ task: "t1", kind: "context", path: "docs/conv.md" });
    expect(t.turns[1].message).toContain("take `docs/conv.md` into account");
    expect(t.turns[1].options).toMatchObject({ phase: "context-add", display: "Take docs/conv.md into account", followUp: true, task: "t1" });
    expect(t.state().current?.status).toBe("waiting");
    expect(t.state().current?.reads?.[0]).toMatchObject({ path: "docs/conv.md" });
  });

  it("refuses with no open task, another task's id, a path that breaks the prompt", async () => {
    const t = setup();
    expect(await t.manager.addContext("t1", "a.md").accepted).toEqual({ ok: false, reason: "no-task" });
    await t.manager.start("quiz");
    expect(await t.manager.addContext("t7", "a.md").accepted).toEqual({ ok: false, reason: "no-task" });
    expect(await t.manager.addContext("t1", "a`b.md").accepted).toEqual({ ok: false, reason: "outside" });
    expect(t.turns).toHaveLength(1);
  });

  it("waits behind a running turn instead of failing", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const t = setup({ gate });
    const starting = t.manager.start("quiz");
    await Promise.resolve();
    const { accepted, done } = t.manager.addContext("t1", "a.md");
    release();
    await starting;
    expect(await accepted).toEqual({ ok: true });
    await done;
    expect(t.turns).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/shell/test/task-prompts.test.ts packages/shell/test/task-manager-context.test.ts`
Expected: FAIL (`contextAddPrompt`, `addablePath`, `addContext` do not exist).

- [ ] **Step 3: The prompt**

`packages/shell/src/main/task-prompts.ts`, after `CHECKPOINT_PROMPT`:

```ts
/** The "Add now" turn (context-panel spec §4.1). The mock replay knows it by its start. */
export const CONTEXT_ADD_PROMPT = "The person wants you to take `{{path}}` into account. Read it now and say in one line what changes for this task.";

/** The prompt for `file` (a folder-relative path the shell already checked). */
export const contextAddPrompt = (file: string): string => CONTEXT_ADD_PROMPT.replace("{{path}}", () => file);

/** A path that can sit inside the prompt's backticks: no backtick, no control character, at most 1,000 characters. */
export function addablePath(file: string): boolean {
  if (file.length === 0 || file.length > 1000) return false;
  for (let i = 0; i < file.length; i++) {
    const code = file.charCodeAt(i);
    if (code === 96 || code < 0x20 || code === 0x7f) return false;
  }
  return true;
}
```

- [ ] **Step 4: `TaskManager.addContext`**

Imports: `contextAddPrompt` and `addablePath` from `./task-prompts`; `ContextResult` joins the type import from `@humanharness/ui/client`.

After `chooseMode`:

```ts
  /**
   * "Add now" (context-panel spec §4.1): the open task reads `file` in one turn of kind `context-add`. Like a mode pick
   * it waits behind a running turn (the window shows "Waiting"), never cancels it. `accepted` resolves with a refusal or
   * `{ ok: true }` before the turn's events; `done` once the turn ended. `taskId`: the open task the caller saw.
   */
  addContext(taskId: string, file: string): { accepted: Promise<ContextResult>; done: Promise<void> } {
    let settled = false;
    let take!: (r: ContextResult) => void;
    let refuse!: (err: unknown) => void;
    const accepted = new Promise<ContextResult>((resolve, reject) => {
      take = (r) => {
        settled = true;
        resolve(r);
      };
      refuse = reject;
    });
    const run = () => this.op(() => this.addNow(taskId, file, take));
    const done = (this.isBusy() ? this.whenFree(run) : run()).then(
      () => {
        if (!settled) refuse(new Error("The file was not added"));
      },
      (err: unknown) => {
        if (!settled) refuse(err);
        throw err;
      },
    );
    return { accepted, done };
  }
```

After `modeNow`:

```ts
  private async addNow(taskId: string, file: string, take: (r: ContextResult) => void): Promise<void> {
    const c = await this.storedCurrent();
    if (!c || c.id !== taskId) return take({ ok: false, reason: "no-task" });
    if (!addablePath(file)) return take({ ok: false, reason: "outside" });
    if (c.status !== "waiting") return take({ ok: false, reason: "busy" });
    take({ ok: true });
    this.tellTurn({ task: c.id, kind: "context", path: file });
    return this.endsInWindow(async () => {
      if (needsCheckpoint(c) && !(await this.checkpoint(c))) return this.stopped();
      // Lines kept for the task's next message go with it (review spec §5.4); a lost session resumes as askNow does.
      const said = await this.withNotices(c, contextAddPrompt(file));
      const message = c.resume ? await this.resumeMessageFor(c, said) : said;
      await this.setStatus(c.id, "running");
      if (this.cancelRequested) {
        await this.setStatus(c.id, "waiting");
        return this.stopped();
      }
      const options = { display: `Take ${file} into account`, ...(c.action ? { action: c.action } : {}), followUp: true, phase: "context-add" as const };
      let done: Done;
      try {
        if (c.resume) this.recordStart = c.id;
        done = c.resume ? await this.firstTurn(c, message, options) : await this.runTurn(c, message, options);
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
    });
  }
```

Also add a public reader the main process uses for the panel (after `runningTask`):

```ts
  /** The open task's context record (context-panel spec §5.1), or null when `taskId` is not the open task. */
  async contextRecord(taskId: string): Promise<Pick<CurrentTask, "id" | "start" | "startTokens" | "reads"> & { scope: string } | null> {
    const c = (await this.d.store.load()).current;
    if (!c || c.id !== taskId) return null;
    return { id: c.id, scope: scopeOfTask(c), start: c.start ?? [], ...(c.startTokens !== undefined ? { startTokens: c.startTokens } : {}), reads: c.reads ?? [] };
  }
```

- [ ] **Step 5: Run the tests**

Run: `corepack pnpm vitest run packages/shell/test`
Expected: PASS.

- [ ] **Step 6: Typecheck, test, commit**

Run: `corepack pnpm typecheck && corepack pnpm test`

```bash
git -C <worktree> add packages/shell/src/main/task-prompts.ts packages/shell/src/main/task-manager.ts packages/shell/test/task-prompts.test.ts packages/shell/test/task-manager-context.test.ts
git -C <worktree> commit -m "feat(shell): Add now runs one turn that reads a file"
```

---
### Task 10: The pinned budget — manifest suggestion and the person's setting

**Files:**
- Modify: `packages/harness-sdk/src/index.ts`, `packages/engines/src/models.ts`, `packages/shell/src/main/models.ts`
- Test: `packages/harness-sdk/test/harness.test.ts`, `packages/shell/test/models.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/harness-sdk/test/harness.test.ts` (`minimal` is the file's smallest manifest):

```ts
describe("context.pinnedTokens (context-panel spec §4.2)", () => {
  it("suggests the pinned budget; absent, there is no key (D0)", () => {
    expect(defineHarness({ ...minimal, context: { pinnedTokens: 6000 } }).context).toEqual({ pinnedTokens: 6000 });
    expect(defineHarness({ ...minimal, context: {} }).context).toEqual({ pinnedTokens: 3000 });
    expect(defineHarness(minimal).context).toBeUndefined();
  });

  it("refuses a budget that is not a whole number from 0 to 50,000", () => {
    expect(() => defineHarness({ ...minimal, context: { pinnedTokens: -1 } })).toThrow();
    expect(() => defineHarness({ ...minimal, context: { pinnedTokens: 60_000 } })).toThrow();
    expect(() => defineHarness({ ...minimal, context: { pinnedTokens: 1.5 } })).toThrow();
  });
});
```

Append to `packages/shell/test/models.test.ts` (add `pinnedBudget` to the import from `../src/main/models`):

```ts
describe("the pinned budget (context-panel spec §4.2)", () => {
  it("cleanModels keeps a whole pinnedTokens from 0 to 50,000 and drops anything else", () => {
    expect(cleanModels({ pinnedTokens: 6000 })).toEqual({ pinnedTokens: 6000 });
    expect(cleanModels({ pinnedTokens: "6000" })).toEqual({});
    expect(cleanModels({ pinnedTokens: 70_000 })).toEqual({});
    expect(cleanModels({})).toEqual({});
  });

  it("the person's value, else the manifest's, else 3,000", () => {
    expect(pinnedBudget({ pinnedTokens: 1000 }, { pinnedTokens: 6000 })).toBe(1000);
    expect(pinnedBudget({}, { pinnedTokens: 6000 })).toBe(6000);
    expect(pinnedBudget({}, undefined)).toBe(3000);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/harness-sdk/test/harness.test.ts packages/shell/test/models.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`packages/harness-sdk/src/index.ts`, in `manifestSchema` after `documents`:

```ts
  /** How much pinned text a new task gets whole, suggested to the person (context-panel spec §4.2). Absent: the core's 3,000 (D0). */
  context: z.object({ pinnedTokens: z.number().int().min(0).max(50_000).default(3000) }).optional(),
```

`packages/engines/src/models.ts`, in `ModelsConfig`:

```ts
  /** The person's pinned-files budget in tokens (context-panel spec §4.2, Settings › Models). Absent: the manifest's. */
  pinnedTokens?: number;
```

and after `CAP_OPTIONS`:

```ts
/** The pinned-files budgets Settings offers (context-panel spec §4.2); the manifest's own value is offered too. */
export const PINNED_OPTIONS = [1000, 3000, 6000, 12_000] as const;
export const PINNED_MAX = 50_000;
```

`packages/shell/src/main/models.ts`: import `PINNED_MAX` from `@humanharness/engines` and `DEFAULT_PINNED_TOKENS` from `@humanharness/workspace`. In `cleanModels`, the return:

```ts
  const pinned = raw.pinnedTokens;
  const pinnedTokens = typeof pinned === "number" && Number.isInteger(pinned) && pinned >= 0 && pinned <= PINNED_MAX ? pinned : undefined;
  return {
    ...(Object.keys(tasks).length > 0 ? { tasks } : {}),
    ...(Object.keys(tiers).length > 0 ? { tiers } : {}),
    ...(pinnedTokens !== undefined ? { pinnedTokens } : {}),
  };
```

and a new export:

```ts
/** Tokens of pinned text a new task gets whole: the person's, else the manifest's, else the core's (context-panel spec §4.2). */
export function pinnedBudget(models: ModelsConfig, manifest: { pinnedTokens: number } | undefined): number {
  return models.pinnedTokens ?? manifest?.pinnedTokens ?? DEFAULT_PINNED_TOKENS;
}
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run packages/harness-sdk/test packages/shell/test/models.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, test, commit**

Run: `corepack pnpm typecheck && corepack pnpm test`

```bash
git -C <worktree> add packages/harness-sdk/src/index.ts packages/engines/src/models.ts packages/shell/src/main/models.ts packages/harness-sdk/test/harness.test.ts packages/shell/test/models.test.ts
git -C <worktree> commit -m "feat(context): the pinned budget in the manifest and in Settings' models config"
```

---

### Task 11: Main — pins read safely, and the `ContextService`

**Files:**
- Create: `packages/shell/src/main/context-pins.ts`, `packages/shell/src/main/context.ts`
- Test: `packages/shell/test/context-pins.test.ts`, `packages/shell/test/context-service.test.ts`

- [ ] **Step 1: Write the failing tests for the pins**

Create `packages/shell/test/context-pins.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { PIN_INLINE_MAX_BYTES, saveContext } from "@humanharness/workspace";
import { checkPinPath, pinShapeOk, pinnedContext } from "../src/main/context-pins";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-pins-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const AT = "2026-10-28T10:00:00.000Z";

function folder(files: Record<string, string | Buffer>): string {
  const base = fs.mkdtempSync(path.join(root, "b-"));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
    fs.writeFileSync(path.join(base, rel), content);
  }
  return base;
}

describe("where a pin may point (§4.2)", () => {
  it("the folder, and under .harness/ only the notes; never .claude/ or a shape the reader refuses", () => {
    expect(pinShapeOk("docs/conventions.md")).toBe(true);
    expect(pinShapeOk(".harness/notes/q-x.md")).toBe(true);
    expect(pinShapeOk(".harness/tasks.json")).toBe(false);
    expect(pinShapeOk(".claude/settings.json")).toBe(false);
    expect(pinShapeOk("../out.md")).toBe(false);
    expect(pinShapeOk("/etc/hosts")).toBe(false);
  });

  it("checks the file: inside, there, text; a link out is outside", async () => {
    const outside = folder({ "secret.md": "s" });
    const base = folder({ "a.md": "hello", "img.png": Buffer.from([1, 2, 3]), "nul.txt": Buffer.from([65, 0, 66]) });
    fs.symlinkSync(path.join(outside, "secret.md"), path.join(base, "link.md"));
    expect(await checkPinPath(base, "a.md", { text: true })).toMatchObject({ ok: true, size: 5 });
    expect(await checkPinPath(base, "gone.md", { text: true })).toEqual({ ok: false, reason: "missing" });
    expect(await checkPinPath(base, "img.png", { text: true })).toEqual({ ok: false, reason: "binary" });
    expect(await checkPinPath(base, "nul.txt", { text: true })).toEqual({ ok: false, reason: "binary" });
    expect(await checkPinPath(base, "img.png", { text: false })).toMatchObject({ ok: true });
    expect(await checkPinPath(base, "link.md", { text: true })).toEqual({ ok: false, reason: "outside" });
    expect(await checkPinPath(base, "../x.md", { text: true })).toEqual({ ok: false, reason: "outside" });
  });
});

describe("pinnedContext (§4.2, §6)", () => {
  it("scope pins then app pins, whole within the budget, the rest as titles; missing and binary skipped; exclusions joined", async () => {
    const base = folder({ "conv.md": "Use pnpm.", "arch.md": `# Architecture\n${"x".repeat(20_000)}`, "img.png": Buffer.from([0]) });
    await saveContext(base, "fracciones", { version: 1, pinned: [{ path: "conv.md", at: AT }, { path: "gone.md", at: AT }], excluded: [{ note: ".harness/notes/fracciones/a.md", at: AT }] });
    await saveContext(base, "_app", { version: 1, pinned: [{ path: "arch.md", at: AT }, { path: "img.png", at: AT }], excluded: [{ note: ".harness/notes/_app/b.md", at: AT }] });
    const ctx = await pinnedContext(base, ["fracciones", "_app"], 3000);
    expect(ctx.pinned).toContain("### conv.md");
    expect(ctx.pinned).toContain("Use pnpm.");
    expect(ctx.pinned).toContain("- Architecture → arch.md");
    expect(ctx.pinned).not.toContain("xxxxx");
    expect(ctx.items.map((i) => [i.id, i.kind, i.scope])).toEqual([
      ["pin:fracciones:conv.md", "pinned", "fracciones"],
      ["pin:_app:arch.md", "pinned-title", "_app"],
    ]);
    expect([...ctx.excluded]).toEqual([".harness/notes/fracciones/a.md", ".harness/notes/_app/b.md"]);
  });

  it("a file over 1 MB enters as its title whatever the budget", async () => {
    const base = folder({ "big.log": `# Big\n${"y".repeat(PIN_INLINE_MAX_BYTES)}` });
    await saveContext(base, "main", { version: 1, pinned: [{ path: "big.log", at: AT }], excluded: [] });
    const ctx = await pinnedContext(base, ["main"], 1_000_000);
    expect(ctx.items[0].kind).toBe("pinned-title");
    expect(ctx.pinned).toContain("- Big → big.log");
  });

  it("D0: no file, nothing at all", async () => {
    const ctx = await pinnedContext(folder({}), ["main"], 3000);
    expect(ctx).toEqual({ pinned: "", items: [], excluded: new Set() });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/shell/test/context-pins.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Write `packages/shell/src/main/context-pins.ts`**

```ts
import { refusedShape } from "@humanharness/harness-sdk/documents";
import type { ContextItem } from "@humanharness/ui/client";
import {
  PIN_INLINE_MAX_BYTES,
  type Pin,
  type PinFacts,
  type PinLayout,
  isBinary,
  loadContext,
  pinBlock,
  pinTitleLine,
  pinnedSection,
  pinsLayout,
  readCapped,
  readPrefix,
  titleOf,
} from "@humanharness/workspace";
import { approxTokens } from "./context-record";
import { locate } from "./documents";
import { stillSafe } from "./open-path";
import type { PersonContext } from "./task-manager";

/** Bytes looked at for a NUL (the file timeline's rule) and for a title. */
const SNIFF_BYTES = 8 * 1024;
const TITLE_BYTES = 2 * 1024;

/**
 * Where a pin or an "Add now" may point (context-panel spec §4.2): a plain relative path, never under `.claude/`, and
 * under `.harness/` only inside `.harness/notes/`. Prefix checks only.
 */
export function pinShapeOk(rel: unknown): rel is string {
  if (refusedShape(rel)) return false;
  const p = rel as string;
  if (p === ".claude" || p.startsWith(".claude/")) return false;
  if (p === ".harness" || p.startsWith(".harness/")) return p.startsWith(".harness/notes/");
  return true;
}

export type PinCheck = { ok: true; file: string; size: number } | { ok: false; reason: "outside" | "missing" | "binary" };

/** The file `rel` names in `base`: inside it after links, there, and (with `text`) not binary. Reads at most 8 KB. */
export async function checkPinPath(base: string, rel: unknown, opts: { text: boolean }): Promise<PinCheck> {
  if (!pinShapeOk(rel)) return { ok: false, reason: "outside" };
  const at = await locate(rel, [base]);
  if (!at.ok) return at;
  const head = await readPrefix(at.file, SNIFF_BYTES, () => stillSafe(at.file, [base]));
  if (!head) return { ok: false, reason: "outside" };
  if (opts.text && isBinary(rel, head.bytes)) return { ok: false, reason: "binary" };
  return { ok: true, file: at.file, size: head.size };
}

/** What is known of each pin before the budget (sizes only: nothing past 8 KB is read). */
export async function pinFacts(base: string, scope: string, pins: readonly Pin[]): Promise<PinFacts[]> {
  return Promise.all(
    pins.map(async (p): Promise<PinFacts> => {
      const check = await checkPinPath(base, p.path, { text: true });
      if (check.ok) return { scope, path: p.path, at: p.at, size: check.size, binary: false };
      return { scope, path: p.path, at: p.at, size: check.reason === "binary" ? 0 : null, binary: check.reason === "binary" };
    }),
  );
}

/** The layout of `scopes`' pins (in that order) for `budget`, as the panel and the next task see it. */
export async function pinsOf(base: string, scopes: readonly string[], budget: number): Promise<PinLayout[]> {
  const facts: PinFacts[] = [];
  for (const scope of scopes) facts.push(...(await pinFacts(base, scope, (await loadContext(base, scope)).pinned)));
  return pinsLayout(facts, budget);
}

/** A whole pin's text, read again right before it enters (no links, at most 1 MB); null when it can't be read now. */
async function wholeText(base: string, rel: string): Promise<string | null> {
  const at = await locate(rel, [base]);
  if (!at.ok) return null;
  const got = await readCapped(at.file, PIN_INLINE_MAX_BYTES, () => stillSafe(at.file, [base]));
  return got && "bytes" in got ? got.bytes.toString("utf8") : null;
}

async function titleText(base: string, rel: string): Promise<string | null> {
  const at = await locate(rel, [base]);
  if (!at.ok) return null;
  const head = await readPrefix(at.file, TITLE_BYTES, () => stillSafe(at.file, [base]));
  return head ? head.bytes.toString("utf8") : null;
}

/**
 * What a new task in `scopes[0]` gets from the person (context-panel spec §4): the pinned section, one item per pin it
 * names, and the excluded notes of every scope given. Nothing pinned or excluded: `{ pinned: "", items: [], excluded: ∅ }`.
 */
export async function pinnedContext(base: string, scopes: readonly string[], budget: number): Promise<PersonContext> {
  const excluded = new Set<string>();
  for (const scope of scopes) for (const e of (await loadContext(base, scope)).excluded) excluded.add(e.note);
  const blocks: string[] = [];
  const titles: string[] = [];
  const items: ContextItem[] = [];
  for (const pin of await pinsOf(base, scopes, budget)) {
    const id = `pin:${pin.scope}:${pin.path}`;
    if (pin.state === "full") {
      const text = await wholeText(base, pin.path);
      if (text === null) continue;
      const block = pinBlock(pin.path, text);
      blocks.push(block);
      items.push({ id, kind: "pinned", label: `Pinned · ${pin.path}`, path: pin.path, tokens: approxTokens(block.length), scope: pin.scope });
    } else if (pin.state === "title") {
      const head = await titleText(base, pin.path);
      if (head === null) continue;
      const line = pinTitleLine(titleOf(head, pin.path), pin.path);
      titles.push(line);
      items.push({ id, kind: "pinned-title", label: `Pinned · ${pin.path}`, path: pin.path, tokens: approxTokens(line.length), scope: pin.scope });
    }
  }
  return { pinned: pinnedSection(blocks, titles), items, excluded };
}
```

Note: `titleOf` scans 2 KB of the head it is given; `titleText` reads exactly that, and a title line cut by the edge falls back to the name.

- [ ] **Step 4: Run the pins tests**

Run: `corepack pnpm vitest run packages/shell/test/context-pins.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing tests for the service**

Create `packages/shell/test/context-service.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ContextItem, ContextRead } from "@humanharness/ui/client";
import { loadContext } from "@humanharness/workspace";
import { ContextService, type ContextDeps } from "../src/main/context";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-ctxs-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function setup(opts: { scoped?: boolean; files?: Record<string, string>; blocked?: string | null; picked?: string | null } = {}) {
  const base = fs.mkdtempSync(path.join(root, "b-"));
  for (const [rel, content] of Object.entries(opts.files ?? { "conv.md": "Use pnpm." })) {
    fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
    fs.writeFileSync(path.join(base, rel), content);
  }
  const commits: { message: string; trailer: unknown }[] = [];
  const changed: string[] = [];
  const added: [string, string][] = [];
  const start: ContextItem[] = [{ id: "brief", kind: "brief", label: "Task brief", tokens: 300, compacted: true }];
  const reads: ContextRead[] = [{ kind: "read", label: "conv.md", path: "conv.md", firstAt: "2026-10-28T10:00:00.000Z", count: 1 }];
  const scoped = opts.scoped ?? false;
  const deps: ContextDeps = {
    base: async () => base,
    scoped: () => scoped,
    scopeExists: async (id) => id === "fracciones",
    budget: async () => 3000,
    record: async (taskId) => (taskId === "t1" ? { id: "t1", scope: scoped ? "fracciones" : "main", start, startTokens: 6300, reads } : null),
    openTask: async () => "t1",
    noteTitles: async () => new Map([[".harness/notes/q-a.md", "A"]]),
    history: async () => ({ save: async (message: string, trailer?: unknown) => void commits.push({ message, trailer }) }),
    trailer: async () => ({ task: "t1" }),
    blocked: () => opts.blocked ?? null,
    add: async (taskId, file) => {
      added.push([taskId, file]);
      return { ok: true };
    },
    pickFile: async () => (opts.picked === undefined ? path.join(base, "conv.md") : opts.picked),
    changed: (id) => void changed.push(id),
  };
  return { service: new ContextService(deps), base, commits, changed, added };
}

describe("ContextService (context-panel spec §4, §5.2)", () => {
  it("get: the task's record with its pins, exclusions, budget and compaction", async () => {
    const t = setup();
    await t.service.pin("main", "conv.md");
    await t.service.exclude("main", ".harness/notes/q-a.md");
    const got = await t.service.get("t1");
    expect(got).toMatchObject({
      ok: true,
      context: {
        task: "t1",
        scope: "main",
        scoped: false,
        startTokens: 6300,
        compacted: true,
        budget: 3000,
        pins: [{ scope: "main", path: "conv.md", state: "full" }],
        excluded: [{ scope: "main", note: ".harness/notes/q-a.md", title: "A" }],
      },
    });
    expect(await t.service.get("t7")).toEqual({ ok: false, reason: "no-task" });
  });

  it("pin: checked, stored once, committed with the open task's trailer, told to the panel", async () => {
    const t = setup({ files: { "conv.md": "x", "img.png": "\u0000" } });
    expect(await t.service.pin("main", "conv.md")).toEqual({ ok: true });
    expect(await t.service.pin("main", "conv.md")).toEqual({ ok: true });
    expect((await loadContext(t.base, "main")).pinned.map((p) => p.path)).toEqual(["conv.md"]);
    expect(t.commits).toEqual([{ message: "Context: pinned conv.md", trailer: { task: "t1" } }]);
    expect(t.changed).toContain("t1");
    expect(await t.service.pin("main", "img.png")).toEqual({ ok: false, reason: "binary" });
    expect(await t.service.pin("main", "../x.md")).toEqual({ ok: false, reason: "outside" });
    expect(await t.service.pin("main", "gone.md")).toEqual({ ok: false, reason: "missing" });
    expect(await t.service.pin("_app", "conv.md")).toEqual({ ok: false, reason: "unknown-scope" });
  });

  it("unpin, exclude, include: each one commit; a note must be in that scope's notes folder", async () => {
    const t = setup({ scoped: true });
    expect(await t.service.pin("fracciones", "conv.md")).toEqual({ ok: true });
    expect(await t.service.unpin("fracciones", "conv.md")).toEqual({ ok: true });
    expect(await t.service.exclude("fracciones", ".harness/notes/fracciones/a.md")).toEqual({ ok: true });
    expect(await t.service.exclude("fracciones", ".harness/notes/decimales/a.md")).toEqual({ ok: false, reason: "not-a-note" });
    expect(await t.service.exclude("_app", ".harness/notes/_app/b.md")).toEqual({ ok: true });
    expect(await t.service.include("fracciones", ".harness/notes/fracciones/a.md")).toEqual({ ok: true });
    expect(await t.service.exclude("nope", ".harness/notes/nope/a.md")).toEqual({ ok: false, reason: "unknown-scope" });
    expect(t.commits.map((c) => c.message)).toEqual([
      "Context: pinned conv.md",
      "Context: unpinned conv.md",
      "Context: excluded .harness/notes/fracciones/a.md",
      "Context: excluded .harness/notes/_app/b.md",
      "Context: included .harness/notes/fracciones/a.md",
    ]);
    expect(fs.existsSync(path.join(t.base, ".harness", "context", "fracciones.json"))).toBe(false);
  });

  it("refuses writes while turns are held", async () => {
    const t = setup({ blocked: "A restore is running" });
    expect(await t.service.pin("main", "conv.md")).toEqual({ ok: false, reason: "busy" });
    expect(t.commits).toEqual([]);
  });

  it("pick: the dialog's file as a folder path; a file outside is refused, a cancel is data", async () => {
    expect(await setup().service.pick()).toEqual({ ok: true, path: "conv.md" });
    expect(await setup({ picked: "/etc/hosts" }).service.pick()).toEqual({ ok: false, reason: "outside" });
    expect(await setup({ picked: null }).service.pick()).toEqual({ ok: false, reason: "cancelled" });
  });

  it("add: any file inside the folder goes to the task manager; outside never does", async () => {
    const t = setup();
    expect(await t.service.add("t1", "conv.md")).toEqual({ ok: true });
    expect(await t.service.add("t1", "../x.md")).toEqual({ ok: false, reason: "outside" });
    expect(t.added).toEqual([["t1", "conv.md"]]);
  });

  it("personContext: the scope's and the app's pins for a scoped task; only main without scopes", async () => {
    const t = setup();
    await t.service.pin("main", "conv.md");
    const ctx = await t.service.personContext("main");
    expect(ctx.items.map((i) => i.id)).toEqual(["pin:main:conv.md"]);
  });
});
```

- [ ] **Step 6: Run them to see them fail**

Run: `corepack pnpm vitest run packages/shell/test/context-service.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 7: Write `packages/shell/src/main/context.ts`**

```ts
import { refusedShape } from "@humanharness/harness-sdk/documents";
import type { ContextGetResult, ContextPick, ContextRefusal, ContextResult, ExcludedView, TaskContext } from "@humanharness/ui/client";
import {
  APP_SCOPE,
  CONTEXT_CHANGE_PREFIX,
  EXCLUDED_MAX,
  type HistoryTrailer,
  MAIN_SCOPE,
  PINS_MAX,
  isScopeId,
  loadContext,
  notesPrefix,
  saveContext,
} from "@humanharness/workspace";
import { folderPath } from "./context-record";
import { checkPinPath, pinnedContext, pinsOf } from "./context-pins";
import type { CurrentTask } from "./task-store";
import type { PersonContext } from "./task-manager";

export interface ContextDeps {
  /** The agent's working folder (the active profile's); null when the app isn't set up. */
  base(): Promise<string | null>;
  scoped(): boolean;
  /** A registered, open scope. */
  scopeExists(id: string): Promise<boolean>;
  /** Tokens of pinned text a new task gets whole (`pinnedBudget`). */
  budget(): Promise<number>;
  /** The open task's record (`TaskManager.contextRecord`). */
  record(taskId: string): Promise<(Pick<CurrentTask, "id" | "start" | "startTokens" | "reads"> & { scope: string }) | null>;
  /** The open task's id, to refresh its panel after a pin changes. */
  openTask(): Promise<string | null>;
  /** Note path → title, for the excluded notes still there. */
  noteTitles(scope: string): Promise<Map<string, string>>;
  history(): Promise<{ save(message: string, trailer?: HistoryTrailer): Promise<unknown> } | null>;
  trailer(): Promise<HistoryTrailer | undefined>;
  /** Why writes can't run now (a restore, a move, an engine change), or null. */
  blocked(): string | null;
  /** `TaskManager.addContext(...).accepted`. */
  add(taskId: string, file: string): Promise<ContextResult>;
  /** The system dialog at `base`: the absolute file picked, or null. */
  pickFile(base: string): Promise<string | null>;
  /** The task's panel must refresh (`hh:context`). */
  changed(taskId: string): void;
}

const no = (reason: ContextRefusal): { ok: false; reason: ContextRefusal } => ({ ok: false, reason });

/**
 * The person's side of the context panel (context-panel spec §4, §5.2). Every answer is data. Writes run one at a time,
 * each with one `Context: …` commit carrying the open task's trailer, and are refused while turns are held.
 */
export class ContextService {
  private writes: Promise<unknown> = Promise.resolve();

  constructor(private readonly d: ContextDeps) {}

  /** The scopes whose pins a task in `scope` gets: its own, then `_app` (scoped harnesses, outside `_app`). */
  private scopesFor(scope: string): string[] {
    return this.d.scoped() && scope !== APP_SCOPE ? [scope, APP_SCOPE] : [scope];
  }

  /** `main` without scopes; `_app` or an open scope with them. */
  private async scopeOk(scope: unknown): Promise<scope is string> {
    if (!this.d.scoped()) return scope === MAIN_SCOPE;
    if (scope === APP_SCOPE) return true;
    return isScopeId(scope) && (await this.d.scopeExists(scope));
  }

  async get(taskId: unknown): Promise<ContextGetResult> {
    if (typeof taskId !== "string") return no("no-task");
    const base = await this.d.base();
    if (!base) return no("not-ready");
    const record = await this.d.record(taskId);
    if (!record) return no("no-task");
    const scopes = this.scopesFor(record.scope);
    const budget = await this.d.budget();
    const excluded: ExcludedView[] = [];
    for (const scope of scopes) {
      const titles = await this.d.noteTitles(scope).catch(() => new Map<string, string>());
      for (const e of (await loadContext(base, scope)).excluded) {
        const title = titles.get(e.note);
        excluded.push({ scope, note: e.note, at: e.at, ...(title !== undefined ? { title } : {}) });
      }
    }
    const start = record.start ?? [];
    const reads = record.reads ?? [];
    const context: TaskContext = {
      task: record.id,
      scope: record.scope,
      scoped: this.d.scoped(),
      start,
      ...(record.startTokens !== undefined ? { startTokens: record.startTokens } : {}),
      reads,
      compacted: start.some((i) => i.compacted) || reads.some((r) => r.compacted),
      pins: await pinsOf(base, scopes, budget),
      excluded,
      budget,
    };
    return { ok: true, context };
  }

  /** What a new task in `scope` gets from the person (the task manager's `personContext`). */
  async personContext(scope: string): Promise<PersonContext> {
    const base = await this.d.base();
    if (!base) return { pinned: "", items: [], excluded: new Set() };
    return pinnedContext(base, this.scopesFor(scope), await this.d.budget());
  }

  pin(scope: unknown, rel: unknown): Promise<ContextResult> {
    return this.write(scope, async (base, s) => {
      const check = await checkPinPath(base, rel, { text: true });
      if (!check.ok) return no(check.reason);
      const file = await loadContext(base, s);
      if (file.pinned.some((p) => p.path === rel)) return null;
      if (file.pinned.length >= PINS_MAX) return no("full");
      file.pinned.push({ path: rel as string, at: new Date().toISOString() });
      return { file, message: `pinned ${rel as string}` };
    });
  }

  unpin(scope: unknown, rel: unknown): Promise<ContextResult> {
    return this.write(scope, async (base, s) => {
      if (refusedShape(rel)) return no("outside");
      const file = await loadContext(base, s);
      const kept = file.pinned.filter((p) => p.path !== rel);
      if (kept.length === file.pinned.length) return null;
      return { file: { ...file, pinned: kept }, message: `unpinned ${rel as string}` };
    });
  }

  exclude(scope: unknown, note: unknown): Promise<ContextResult> {
    return this.write(scope, async (base, s) => {
      if (!this.isNoteOf(s, note)) return no("not-a-note");
      const file = await loadContext(base, s);
      if (file.excluded.some((e) => e.note === note)) return null;
      if (file.excluded.length >= EXCLUDED_MAX) return no("full");
      file.excluded.push({ note, at: new Date().toISOString() });
      return { file, message: `excluded ${note}` };
    });
  }

  include(scope: unknown, note: unknown): Promise<ContextResult> {
    return this.write(scope, async (base, s) => {
      if (!this.isNoteOf(s, note)) return no("not-a-note");
      const file = await loadContext(base, s);
      const kept = file.excluded.filter((e) => e.note !== note);
      if (kept.length === file.excluded.length) return null;
      return { file: { ...file, excluded: kept }, message: `included ${note}` };
    });
  }

  /** The system dialog at the folder; the picked file comes back as a folder path, checked like an "Add now". */
  async pick(): Promise<ContextPick> {
    const base = await this.d.base();
    if (!base) return no("not-ready");
    const abs = await this.d.pickFile(base);
    if (abs === null) return { ok: false, reason: "cancelled" };
    const rel = folderPath(base, abs);
    if (rel === null) return no("outside");
    const check = await checkPinPath(base, rel, { text: false });
    return check.ok ? { ok: true, path: rel } : no(check.reason);
  }

  /** "Add now" (§4.1): any file inside the folder (an image or a PDF too: the agent may read it); then the task manager. */
  async add(taskId: unknown, rel: unknown): Promise<ContextResult> {
    if (typeof taskId !== "string") return no("no-task");
    const base = await this.d.base();
    if (!base) return no("not-ready");
    const check = await checkPinPath(base, rel, { text: false });
    if (!check.ok) return no(check.reason);
    return this.d.add(taskId, rel as string);
  }

  /** A note directly in `scope`'s notes folder: `<prefix><slug>.md`, nothing deeper. */
  private isNoteOf(scope: string, note: unknown): note is string {
    if (refusedShape(note)) return false;
    const prefix = notesPrefix(this.d.scoped(), scope);
    const n = note as string;
    if (!n.startsWith(prefix) || !n.endsWith(".md")) return false;
    const name = n.slice(prefix.length);
    return name.length > 3 && !name.includes("/");
  }

  /**
   * One write: the scope checked, turns not held, then `change` (null: nothing to do, still `ok`), the file saved, one
   * commit, the panel told. Serial, like the person's data writes.
   */
  private write(
    scope: unknown,
    change: (base: string, scope: string) => Promise<{ file: Awaited<ReturnType<typeof loadContext>>; message: string } | { ok: false; reason: ContextRefusal } | null>,
  ): Promise<ContextResult> {
    const run = async (): Promise<ContextResult> => {
      if (!(await this.scopeOk(scope))) return no("unknown-scope");
      if (this.d.blocked()) return no("busy");
      const base = await this.d.base();
      if (!base) return no("not-ready");
      const trailer = await this.d.trailer();
      const history = await this.d.history();
      const result = await change(base, scope);
      if (result === null) return { ok: true };
      if ("ok" in result) return result;
      await saveContext(base, scope, result.file);
      try {
        await history?.save(`${CONTEXT_CHANGE_PREFIX}${result.message}`, trailer);
      } catch (err) {
        console.error("Could not record the context change in the history", err);
      }
      const open = await this.d.openTask().catch(() => null);
      if (open) this.d.changed(open);
      return { ok: true };
    };
    const next = this.writes.then(run, run);
    this.writes = next.catch(() => undefined);
    return next;
  }
}
```

- [ ] **Step 8: Run the tests**

Run: `corepack pnpm vitest run packages/shell/test/context-pins.test.ts packages/shell/test/context-service.test.ts`
Expected: PASS.

- [ ] **Step 9: Typecheck, test, commit**

Run: `corepack pnpm typecheck && corepack pnpm test`

```bash
git -C <worktree> add packages/shell/src/main/context-pins.ts packages/shell/src/main/context.ts packages/shell/test/context-pins.test.ts packages/shell/test/context-service.test.ts
git -C <worktree> commit -m "feat(shell): pins read safely and the context service"
```

---
### Task 12: IPC, main wiring, preload, the fake client and the History panel's entries

**Files:**
- Create: `packages/shell/src/main/context-ipc.ts`
- Modify: `packages/shell/src/main/index.ts`, `packages/shell/src/preload/index.ts`, `packages/ui/src/client.ts`, `packages/ui/test/fake-client.ts`, `packages/ui/src/HistoryPanel.tsx`, `packages/i18n/src/locales/en.json`
- Test: `packages/shell/test/context-ipc.test.ts`, `packages/ui/test/history-panel.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/shell/test/context-ipc.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { CONTEXT_CHANNELS, contextHandlers } from "../src/main/context-ipc";
import type { ContextService } from "../src/main/context";

describe("hh:context* handlers (context-panel spec §5.2)", () => {
  it("pass their arguments through and answer the service's data", async () => {
    const svc = {
      get: vi.fn(async () => ({ ok: false, reason: "no-task" })),
      add: vi.fn(async () => ({ ok: true })),
      pick: vi.fn(async () => ({ ok: false, reason: "cancelled" })),
      pin: vi.fn(async () => ({ ok: true })),
      unpin: vi.fn(async () => ({ ok: true })),
      exclude: vi.fn(async () => ({ ok: true })),
      include: vi.fn(async () => ({ ok: true })),
    } as unknown as ContextService;
    const h = contextHandlers(svc);
    expect(Object.keys(h).sort()).toEqual([...CONTEXT_CHANNELS].sort());
    expect(await h["hh:contextGet"]("t1")).toEqual({ ok: false, reason: "no-task" });
    expect(await h["hh:contextPin"]("main", "a.md")).toEqual({ ok: true });
    expect(svc.pin).toHaveBeenCalledWith("main", "a.md");
    expect(await h["hh:contextAdd"]("t1", "a.md")).toEqual({ ok: true });
    expect(svc.add).toHaveBeenCalledWith("t1", "a.md");
  });

  it("a throw is a bug: logged, answered as data", async () => {
    const svc = { pin: vi.fn(async () => Promise.reject(new Error("boom"))) } as unknown as ContextService;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await contextHandlers(svc)["hh:contextPin"]("main", "a.md")).toEqual({ ok: false, reason: "failed" });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
```

Append to `packages/ui/test/history-panel.test.tsx` (`entryLabel` is already imported):

```ts
describe("context changes in the history (context-panel spec §4.2)", () => {
  it("a Context: commit reads as one", () => {
    expect(entryLabel("Context: pinned docs/conv.md")).toEqual({ key: "history.entry.context", values: { change: "pinned docs/conv.md" } });
  });
});
```

(If `entryLabel` takes more arguments than the message, pass what the file's other `entryLabel` calls pass.)

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/shell/test/context-ipc.test.ts packages/ui/test/history-panel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Write `packages/shell/src/main/context-ipc.ts`**

```ts
import type { ContextService } from "./context";

export const CONTEXT_CHANNELS = ["hh:contextGet", "hh:contextAdd", "hh:contextPick", "hh:contextPin", "hh:contextUnpin", "hh:contextExclude", "hh:contextInclude"] as const;
export type ContextChannel = (typeof CONTEXT_CHANNELS)[number];

const failed = { ok: false as const, reason: "failed" as const };

/** The `hh:context*` handlers (context-panel spec §5.2). Every answer is data; a throw is a bug, logged, answered `failed`. */
export function contextHandlers(svc: ContextService): Record<ContextChannel, (...args: unknown[]) => Promise<unknown>> {
  const call = (fn: () => unknown): Promise<unknown> =>
    Promise.resolve()
      .then(fn)
      .catch((err: unknown) => {
        console.error("A context panel call failed", err);
        return failed;
      });
  return {
    "hh:contextGet": (task) => call(() => svc.get(task)),
    "hh:contextAdd": (task, file) => call(() => svc.add(task, file)),
    "hh:contextPick": () => call(() => svc.pick()),
    "hh:contextPin": (scope, file) => call(() => svc.pin(scope, file)),
    "hh:contextUnpin": (scope, file) => call(() => svc.unpin(scope, file)),
    "hh:contextExclude": (scope, note) => call(() => svc.exclude(scope, note)),
    "hh:contextInclude": (scope, note) => call(() => svc.include(scope, note)),
  };
}
```

- [ ] **Step 4: Wire main (`packages/shell/src/main/index.ts`)**

Imports:

```ts
import { ContextService } from "./context";
import { contextHandlers } from "./context-ipc";
```

and `pinnedBudget` joins the import from `./models`; `buildDataContextParts`, `DEFAULT_PINNED_TOKENS` and `notesPrefix` (if not imported yet) join the import from `@humanharness/workspace`.

In the `TaskManager` deps:
- `dataContext`'s inner function returns `buildDataContextParts(dataStoreFor(baseOf(c)), harness.data, scope, action)` and `[]` when not set up (the text the agent gets is the same: Task 7 joins the parts);
- add:

```ts
  // Context panel (context-panel spec §3.1): the size of AGENTS.md in the agent's working folder.
  instructionsSize: async () => {
    const c = await validConfig();
    if (!c) return null;
    const stat = await fs.stat(path.join(baseOf(c), "AGENTS.md")).catch(() => null);
    return stat?.isFile() ? stat.size : null;
  },
  // Pins and exclusions for a new task (spec §4); `contextSvc` is built below, before any task can start.
  personContext: (scope) => contextSvc.personContext(scope),
  contextChanged: (id) => void sendContext(id),
  folder: async () => {
    const c = await validConfig();
    return c ? baseOf(c) : null;
  },
```

After `fileTimelines`:

```ts
/** The context panel (context-panel spec): the person's pins and exclusions and the open task's record. */
const contextSvc = new ContextService({
  base: async () => {
    const c = await validConfig();
    return c ? baseOf(c) : null;
  },
  scoped,
  scopeExists: (id) => activeScope(id),
  budget: async () => pinnedBudget(cleanModels((await config.load()).models), harness.context),
  record: (id) => tasks.contextRecord(id),
  openTask: async () => (await tasks.runningTask())?.id ?? null,
  noteTitles: async (scope) => {
    const c = await validConfig();
    if (!c) return new Map<string, string>();
    const notes = await readNotes(baseOf(c), notesPrefix(scoped(), scope)).catch(() => []);
    return new Map(notes.map((n) => [n.path, n.title]));
  },
  history: () => currentHistory(),
  trailer: () => tasks.trailerNow(),
  blocked: () => (quitting ? "The app is closing" : turnBlocked()),
  add: (taskId, file) => {
    const { accepted, done } = tasks.addContext(taskId, file);
    done.catch((err: unknown) => console.error("The Add now turn failed", err));
    return accepted;
  },
  pickFile: async (base) => {
    const result = await dialog.showOpenDialog(window!, { defaultPath: base, properties: ["openFile"] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  },
  changed: (task) => void sendContext(task),
});

/** The task's panel refreshes (`hh:context`); a task that is no longer open sends nothing. */
async function sendContext(task: string): Promise<void> {
  const got = await contextSvc.get(task).catch(() => null);
  if (got?.ok) sendToWindow("hh:context", { task, context: got.context });
}
```

In `registerIpc`, next to the file handlers:

```ts
  for (const [channel, fn] of Object.entries(contextHandlers(contextSvc))) handle(channel, fn);
```

Where `appState` builds the models view (`recommended`, `defaults`, `offered`), add:

```ts
    pinnedTokens: harness.context?.pinnedTokens ?? DEFAULT_PINNED_TOKENS,
```

and in `packages/ui/src/client.ts`'s `ModelsView`:

```ts
  /** The pinned-files budget the harness suggests (context-panel spec §4.2); Settings › Models offers it. */
  pinnedTokens: number;
```

Also re-export the new subject from `client.ts` (line with `export { BEFORE_MESSAGE, … } from "@humanharness/workspace/subjects"`): add `CONTEXT_CHANGE_PREFIX`.

If any test builds a `ModelsView` literal (search `offered:` under `packages/ui/test`), add `pinnedTokens: 3000` to it.

- [ ] **Step 5: The preload**

`packages/shell/src/preload/index.ts`: add `TaskContext` to the type import, and replace Task 1's stub:

```ts
  context: {
    get: (taskId) => ipcRenderer.invoke("hh:contextGet", taskId),
    onChange: (taskId, listener) =>
      subscribe<{ task?: unknown; context?: TaskContext }>("hh:context", (m) => {
        if (m?.task === taskId && m.context) listener(m.context);
      }),
    add: (taskId, file) => ipcRenderer.invoke("hh:contextAdd", taskId, file),
    pick: () => ipcRenderer.invoke("hh:contextPick"),
    pin: (scope, file) => ipcRenderer.invoke("hh:contextPin", scope, file),
    unpin: (scope, file) => ipcRenderer.invoke("hh:contextUnpin", scope, file),
    exclude: (scope, note) => ipcRenderer.invoke("hh:contextExclude", scope, note),
    include: (scope, note) => ipcRenderer.invoke("hh:contextInclude", scope, note),
  },
```

- [ ] **Step 6: The fake client**

`packages/ui/test/fake-client.ts`: add `ContextPick`, `ContextResult`, `TaskContext` to the type import and replace Task 1's stub with a fake the UI tests drive:

```ts
  /** What `context.get` answers, by task. */
  contexts: Record<string, TaskContext> = {};
  contextCalls: { op: "add" | "pick" | "pin" | "unpin" | "exclude" | "include"; args: unknown[] }[] = [];
  /** What every context write answers; `contextGate` holds `add` until it resolves (the panel's "Waiting"). */
  contextAnswer: ContextResult = { ok: true };
  contextGate: Promise<void> | null = null;
  pickAnswer: ContextPick = { ok: false, reason: "cancelled" };
  private contextListeners = new Set<{ task: string; listener: (c: TaskContext) => void }>();

  /** As main's `hh:context`: the task's panel gets `c`. */
  emitContext(task: string, c: TaskContext): void {
    this.contexts[task] = c;
    for (const l of [...this.contextListeners]) if (l.task === task) l.listener(c);
  }

  context: HarnessClient["context"] = {
    get: async (taskId) => (Object.hasOwn(this.contexts, taskId) ? { ok: true, context: this.contexts[taskId] } : { ok: false, reason: "no-task" }),
    onChange: (task, listener) => {
      const entry = { task, listener };
      this.contextListeners.add(entry);
      return () => void this.contextListeners.delete(entry);
    },
    add: async (...args) => {
      this.contextCalls.push({ op: "add", args });
      if (this.contextGate) await this.contextGate;
      return this.contextAnswer;
    },
    pick: async () => {
      this.contextCalls.push({ op: "pick", args: [] });
      return this.pickAnswer;
    },
    pin: async (...args) => (this.contextCalls.push({ op: "pin", args }), this.contextAnswer),
    unpin: async (...args) => (this.contextCalls.push({ op: "unpin", args }), this.contextAnswer),
    exclude: async (...args) => (this.contextCalls.push({ op: "exclude", args }), this.contextAnswer),
    include: async (...args) => (this.contextCalls.push({ op: "include", args }), this.contextAnswer),
  };
```

If the fake builds an `AppState` with a `models` view, add `pinnedTokens: 3000` there.

- [ ] **Step 7: The History panel's `Context:` entries**

`packages/ui/src/HistoryPanel.tsx`: import `CONTEXT_CHANGE_PREFIX` with the other subjects from `./client`, and next to the `DATA_CHANGE_PREFIX` line:

```ts
  if (message.startsWith(CONTEXT_CHANGE_PREFIX)) return { key: "history.entry.context", values: { change: message.slice(CONTEXT_CHANGE_PREFIX.length) } };
```

`packages/i18n/src/locales/en.json`, under `history.entry`:

```json
"context": "Context: {{change}}"
```

- [ ] **Step 8: Run the tests**

Run: `corepack pnpm vitest run packages/shell/test/context-ipc.test.ts packages/ui/test`
Expected: PASS.

- [ ] **Step 9: Typecheck, test, build, commit**

Run: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm app:build`

```bash
git -C <worktree> add packages/shell/src/main/context-ipc.ts packages/shell/src/main/index.ts packages/shell/src/preload/index.ts packages/ui/src/client.ts packages/ui/test/fake-client.ts packages/ui/src/HistoryPanel.tsx packages/i18n/src/locales/en.json packages/shell/test/context-ipc.test.ts packages/ui/test/history-panel.test.tsx
git -C <worktree> commit -m "feat(context): IPC, main wiring, client.context and History entries"
```

---
### Task 13: The panel — `<ContextPanel>`

**Files:**
- Create: `packages/ui/src/ContextPanel.tsx`
- Modify: `packages/ui/src/styles.css`, `packages/ui/src/index.ts`, `packages/i18n/src/locales/en.json`
- Test: `packages/ui/test/context-panel.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/test/context-panel.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskContext } from "../src/client";
import { ContextPanel } from "../src/ContextPanel";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const AT = "2026-10-28T10:00:00.000Z";
const CTX: TaskContext = {
  task: "t1",
  scope: "main",
  scoped: false,
  start: [
    { id: "instructions", kind: "instructions", label: "Harness instructions", path: "AGENTS.md", tokens: 1200 },
    { id: "brief", kind: "brief", label: "Task brief", tokens: 300 },
    { id: "notes", kind: "notes-index", label: "Notes (1)", tokens: 400, count: 1, notes: [{ path: ".harness/notes/q-redux.md", title: "We use Redux" }], compacted: true },
    { id: "data:tickets", kind: "data", label: "Data · tickets (12 rows)", tokens: 800, count: 12 },
  ],
  startTokens: 6312,
  reads: [
    { kind: "read", label: "docs/old.md", path: "docs/old.md", firstAt: "2026-10-28T10:01:00.000Z", count: 1, compacted: true },
    { kind: "read", label: "src/app.ts", path: "src/app.ts", firstAt: "2026-10-28T10:05:00.000Z", count: 3 },
    { kind: "tool", label: "atlassian · getJiraIssue", firstAt: "2026-10-28T10:03:00.000Z", count: 1 },
  ],
  compacted: true,
  pins: [
    { scope: "main", path: "conventions.md", at: AT, state: "full", tokens: 500 },
    { scope: "main", path: "docs/arch.md", at: AT, state: "title", tokens: 9000 },
    { scope: "main", path: "gone.md", at: AT, state: "missing", tokens: 0 },
  ],
  excluded: [{ scope: "main", note: ".harness/notes/q-old.md", at: AT, title: "Old idea" }],
  budget: 3000,
};

async function show(props: Partial<Parameters<typeof ContextPanel>[0]> = {}, ctx: TaskContext = CTX) {
  const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
  client.contexts.t1 = ctx;
  const onOpen = vi.fn();
  await renderIn("en", <ContextPanel client={client} taskId="t1" usage={{ used: 40_000, cap: 200_000 }} onOpen={onOpen} onClose={() => {}} {...props} />);
  const panel = await screen.findByRole("region", { name: "What the AI takes into account" });
  await within(panel).findByRole("heading", { name: "At the start" });
  return { client, panel, onOpen };
}

describe("ContextPanel (context-panel spec §5.1)", () => {
  it("shows the start with sizes, the total, the real first turn and the meter's numbers", async () => {
    const { panel } = await show();
    const start = within(panel).getByRole("region", { name: "At the start" });
    expect(within(start).getByText("Harness instructions")).toBeTruthy();
    expect(within(start).getByText("approx. 1,200 tokens")).toBeTruthy();
    expect(within(start).getByText("Data · tickets (12 rows)")).toBeTruthy();
    expect(within(start).getByText("Total: approx. 2,700 tokens")).toBeTruthy();
    expect(within(start).getByText("First turn: 6,312 tokens (real)")).toBeTruthy();
    expect(within(panel).getByText("In use now: 40,000 of 200,000 tokens")).toBeTruthy();
  });

  it("lists reads and tools newest first with counts; what came before a compaction is faint", async () => {
    const { panel } = await show();
    const during = within(panel).getByRole("region", { name: "During the task" });
    const rows = within(during).getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(rows[0]).toContain("src/app.ts");
    expect(rows[0]).toContain("×3");
    expect(rows[1]).toContain("atlassian · getJiraIssue");
    expect(rows[2]).toContain("docs/old.md");
    expect(rows[2]).toContain("may be summarized");
  });

  it("pins over the budget say title only; a missing one is struck through with Remove", async () => {
    const { panel, client } = await show();
    const pinned = within(panel).getByRole("region", { name: "Pinned" });
    expect(within(pinned).getByText("title only")).toBeTruthy();
    expect(within(pinned).getByText("gone.md").closest(".hh-ctxp-gone")).toBeTruthy();
    fireEvent.click(within(pinned).getByRole("button", { name: "Remove gone.md" }));
    await waitFor(() => expect(client.contextCalls).toContainEqual({ op: "unpin", args: ["main", "gone.md"] }));
  });

  it("Exclude a listed note, Pin a read, Include again an excluded note", async () => {
    const { panel, client } = await show();
    const start = within(panel).getByRole("region", { name: "At the start" });
    fireEvent.click(within(start).getByRole("button", { name: "Exclude We use Redux" }));
    const during = within(panel).getByRole("region", { name: "During the task" });
    fireEvent.click(within(during).getByRole("button", { name: "Pin src/app.ts" }));
    const excluded = within(panel).getByRole("region", { name: "Excluded" });
    fireEvent.click(within(excluded).getByRole("button", { name: "Include again Old idea" }));
    await waitFor(() =>
      expect(client.contextCalls).toEqual([
        { op: "exclude", args: ["main", ".harness/notes/q-redux.md"] },
        { op: "pin", args: ["main", "src/app.ts"] },
        { op: "include", args: ["main", ".harness/notes/q-old.md"] },
      ]),
    );
  });

  it("a note already excluded says it applies from the next task", async () => {
    const { panel } = await show({}, { ...CTX, excluded: [{ scope: "main", note: ".harness/notes/q-redux.md", at: AT, title: "We use Redux" }] });
    const start = within(panel).getByRole("region", { name: "At the start" });
    expect(within(start).getByText("Applies from the next task")).toBeTruthy();
    expect(within(start).queryByRole("button", { name: "Exclude We use Redux" })).toBeNull();
  });

  it("Add…: a picked file goes to this task, Waiting while it waits; a refused pin says why", async () => {
    const { panel, client } = await show();
    client.pickAnswer = { ok: true, path: "docs/conv.md" };
    let release!: () => void;
    client.contextGate = new Promise<void>((r) => (release = r));
    fireEvent.click(within(panel).getByRole("button", { name: "Add…" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Choose a file…" }));
    await within(panel).findByText("docs/conv.md");
    fireEvent.click(within(panel).getByRole("button", { name: "For this task" }));
    expect(await within(panel).findByText("Waiting for the current turn to end…")).toBeTruthy();
    await act(async () => release());
    await waitFor(() => expect(within(panel).queryByText("Waiting for the current turn to end…")).toBeNull());
    expect(client.contextCalls).toContainEqual({ op: "add", args: ["t1", "docs/conv.md"] });

    client.contextGate = null;
    client.contextAnswer = { ok: false, reason: "binary" };
    fireEvent.click(within(panel).getByRole("button", { name: "Add…" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Choose a file…" }));
    await within(panel).findByText("docs/conv.md");
    fireEvent.click(within(panel).getByRole("button", { name: "Pin for every new task" }));
    expect(await within(panel).findByText("Text files only")).toBeTruthy();
  });

  it("Add… offers the scope's notes too", async () => {
    const notes = [{ slug: "q-a", title: "Fractions so far", date: AT, summary: [], decisions: [], path: ".harness/notes/q-a.md" }];
    const { panel } = await show({ notes });
    fireEvent.click(within(panel).getByRole("button", { name: "Add…" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Fractions so far" }));
    expect(await within(panel).findByText(".harness/notes/q-a.md")).toBeTruthy();
  });

  it("opens an item's file; read-only has no action; a live change replaces the view", async () => {
    const { panel, onOpen, client } = await show();
    fireEvent.click(within(panel).getByRole("button", { name: "conventions.md" }));
    expect(onOpen).toHaveBeenCalledWith("conventions.md");
    act(() => client.emitContext("t1", { ...CTX, reads: [] }));
    await waitFor(() => expect(within(panel).queryByText("src/app.ts")).toBeNull());
    cleanup();
    const ro = await show({ readOnly: true });
    expect(within(ro.panel).queryByRole("button", { name: "Add…" })).toBeNull();
    expect(within(ro.panel).queryByRole("button", { name: /^Pin / })).toBeNull();
  });

  it("says when there is no open task", async () => {
    const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
    await renderIn("en", <ContextPanel client={client} taskId="t9" />);
    expect(await screen.findByText("No task is open.")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/ui/test/context-panel.test.tsx`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: The strings**

`packages/i18n/src/locales/en.json`, a new top-level `context` object:

```json
"context": {
  "title": "What the AI takes into account",
  "open": "What the AI takes into account",
  "close": "Close",
  "noTask": "No task is open.",
  "loadFailed": "I couldn't read what this task loaded. Try again in a moment.",
  "inUse": "In use now: {{used}} of {{cap}} tokens",
  "compactedNote": "The conversation was summarized. Faint items may be summarized.",
  "start": "At the start",
  "during": "During the task",
  "pinned": "Pinned",
  "excluded": "Excluded",
  "approx": "approx. {{tokens}} tokens",
  "total": "Total: approx. {{tokens}} tokens",
  "realFirst": "First turn: {{tokens}} tokens (real)",
  "times": "×{{count}}",
  "faint": "may be summarized",
  "nothingRead": "Nothing read yet.",
  "nothingPinned": "Nothing pinned yet. Pin a file every new task here should start from.",
  "titleOnly": "title only",
  "missing": "not found",
  "binary": "not a text file",
  "wholeApp": "whole app",
  "appliesNext": "Applies from the next task",
  "add": "Add…",
  "chooseFile": "Choose a file…",
  "notes": "Notes",
  "forTask": "For this task",
  "pinIn": "Pin in {{scope}}",
  "pinEvery": "Pin for every new task",
  "pinApp": "Pin for the whole app",
  "waiting": "Waiting for the current turn to end…",
  "pin": "Pin",
  "pinName": "Pin {{name}}",
  "remove": "Remove",
  "removeName": "Remove {{name}}",
  "exclude": "Exclude",
  "excludeName": "Exclude {{name}}",
  "include": "Include again",
  "includeName": "Include again {{name}}",
  "addLine": "Take {{path}} into account",
  "item": {
    "instructions": "Harness instructions",
    "scope-instructions": "Instructions of this scope",
    "brief": "What the task is about",
    "briefLater": "Brief added at {{time}}",
    "notes-index": "Notes ({{count}})",
    "app-notes-index": "App-wide notes ({{count}})",
    "data": "Data",
    "dataNamed": "Data · {{name}} ({{count}} rows)",
    "material": "Material",
    "pinned": "Pinned · {{path}}",
    "pinned-title": "Pinned · {{path}} (title only)"
  },
  "refused": {
    "no-task": "This task is no longer open.",
    "busy": "Not now: wait until the current step ends.",
    "outside": "Only files in your folder",
    "binary": "Text files only",
    "missing": "That file is not there anymore.",
    "unknown-scope": "That place doesn't exist anymore.",
    "not-a-note": "Only notes can be excluded.",
    "full": "There are too many already. Remove one first.",
    "not-ready": "The app is not set up yet.",
    "failed": "Something went wrong. Try again."
  }
},
```

(The pin buttons use `pinName`/`removeName`/`excludeName`/`includeName` as their accessible names and show the short label; the tests above find them by those names.)

- [ ] **Step 4: Write `packages/ui/src/ContextPanel.tsx`**

```tsx
import { type ReactNode, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { CloseIcon } from "./chrome";
import type { ContextItem, ContextRead, ContextRefusal, ContextResult, HarnessClient, NoteView, TaskContext } from "./client";
import { shownLanguage } from "./language";

export interface ContextPanelProps {
  client: HarnessClient;
  taskId: string;
  /** The context in use and the task's cap (the meter's numbers), shown on top. */
  usage?: { used: number; cap: number };
  /** The open scope's notes, offered by "Add…". */
  notes?: NoteView[];
  /** Opens a file or a note (the core: the reader or the file timeline). Absent: items are plain text. */
  onOpen?: (path: string) => void;
  onClose?: () => void;
  /** The record only, with no action (for a job's run, once jobs exist). */
  readOnly?: boolean;
}

const fileName = (p: string): string => p.slice(p.lastIndexOf("/") + 1);

/**
 * What the agent takes into account in a task (context-panel spec §5.1): what the app loaded at the start, what the
 * agent used since, the pinned files and the excluded notes, with "Add…", "Pin", "Exclude", "Remove", "Include again".
 */
export function ContextPanel({ client, taskId, usage, notes = [], onOpen, onClose, readOnly = false }: ContextPanelProps) {
  const { t, i18n } = useTranslation();
  const startId = useId();
  const duringId = useId();
  const pinnedId = useId();
  const excludedId = useId();
  const [ctx, setCtx] = useState<TaskContext | null>(null);
  const [failed, setFailed] = useState<ContextRefusal | null>(null);
  const [menu, setMenu] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [scopeTitle, setScopeTitle] = useState<string | null>(null);
  const fmt = (n: number) => n.toLocaleString(shownLanguage(i18n));

  useEffect(() => {
    let live = true;
    client.context.get(taskId).then(
      (r) => {
        if (!live) return;
        if (r.ok) {
          setCtx(r.context);
          setFailed(null);
        } else setFailed(r.reason);
      },
      () => live && setFailed("failed"),
    );
    const off = client.context.onChange(taskId, (c) => {
      if (live) setCtx(c);
    });
    return () => {
      live = false;
      off();
    };
  }, [client, taskId]);

  const scoped = ctx?.scoped === true;
  const scope = ctx?.scope;
  useEffect(() => {
    if (!scoped || !scope) return;
    let live = true;
    client.scopes.list().then(
      (list) => {
        if (live) setScopeTitle(list.find((s) => s.id === scope)?.title ?? null);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [client, scoped, scope]);

  const refresh = () =>
    client.context.get(taskId).then(
      (r) => {
        if (r.ok) setCtx(r.context);
      },
      () => {},
    );
  const act = async (call: () => Promise<ContextResult>, after?: () => void) => {
    setNotice(null);
    const r = await call().catch((): ContextResult => ({ ok: false, reason: "failed" }));
    if (!r.ok) {
      setNotice(t(`context.refused.${r.reason}`));
      return;
    }
    after?.();
    await refresh();
  };

  const head = (
    <div className="hh-ctxp-head">
      <h2>{t("context.title")}</h2>
      {onClose && (
        <button type="button" className="hh-icon-button" aria-label={t("context.close")} onClick={onClose}>
          <CloseIcon />
        </button>
      )}
    </div>
  );
  if (!ctx) {
    return (
      <section className="hh-ctxp" aria-label={t("context.title")} onKeyDown={(e) => e.key === "Escape" && onClose?.()}>
        {head}
        {failed && <p className="hh-caption">{t(failed === "no-task" ? "context.noTask" : "context.loadFailed")}</p>}
      </section>
    );
  }

  const open = (path: string, label: ReactNode = path) =>
    onOpen ? (
      <button type="button" className="hh-link-button" onClick={() => onOpen(path)}>
        {label}
      </button>
    ) : (
      <span>{label}</span>
    );
  const excludedNotes = new Set(ctx.excluded.map((e) => e.note));
  const itemText = (i: ContextItem): string => {
    if (i.kind === "brief" && i.at) return t("context.item.briefLater", { time: new Date(i.at).toLocaleTimeString(shownLanguage(i18n), { hour: "2-digit", minute: "2-digit" }) });
    if (i.kind === "data" && i.id.startsWith("data:")) return t("context.item.dataNamed", { name: i.id.slice("data:".length), count: i.count ?? 0 });
    return t(`context.item.${i.kind}`, { count: i.count ?? 0, path: i.path ?? "" });
  };
  const total = ctx.start.reduce((n, i) => n + i.tokens, 0);
  const reads = [...ctx.reads].sort((a, b) => b.firstAt.localeCompare(a.firstAt));
  const readRow = (r: ContextRead) => (
    <li key={`${r.kind}:${r.path ?? r.label}`} className={r.compacted ? "hh-ctxp-row hh-ctxp-faint" : "hh-ctxp-row"}>
      {r.path ? open(r.path) : <span>{r.label}</span>}
      {r.count > 1 && <span className="hh-ctxp-size">{t("context.times", { count: r.count })}</span>}
      {r.compacted && <span className="hh-caption">{t("context.faint")}</span>}
      {!readOnly && r.path && (
        <button type="button" aria-label={t("context.pinName", { name: r.path })} onClick={() => void act(() => client.context.pin(ctx.scope, r.path!))}>
          {t("context.pin")}
        </button>
      )}
    </li>
  );
  const pinLabel = scoped ? t("context.pinIn", { scope: scopeTitle ?? ctx.scope }) : t("context.pinEvery");

  return (
    <section className="hh-ctxp" aria-label={t("context.title")} onKeyDown={(e) => e.key === "Escape" && onClose?.()}>
      {head}
      {usage && <p className="hh-caption">{t("context.inUse", { used: fmt(usage.used), cap: fmt(usage.cap) })}</p>}
      {ctx.compacted && <p className="hh-caption">{t("context.compactedNote")}</p>}
      {!readOnly && (
        <div className="hh-ctxp-add">
          <button type="button" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            {t("context.add")}
          </button>
          {menu && (
            <div className="hh-ctxp-menu">
              <button
                type="button"
                onClick={async () => {
                  setMenu(false);
                  const r = await client.context.pick().catch(() => ({ ok: false as const, reason: "failed" as const }));
                  if (r.ok) setPicked(r.path);
                  else if (r.reason !== "cancelled") setNotice(t(`context.refused.${r.reason}`));
                }}
              >
                {t("context.chooseFile")}
              </button>
              {notes.length > 0 && <p className="hh-caption">{t("context.notes")}</p>}
              {notes.map((n) => (
                <button
                  key={n.path}
                  type="button"
                  onClick={() => {
                    setMenu(false);
                    setPicked(n.path);
                  }}
                >
                  {n.title}
                </button>
              ))}
            </div>
          )}
          {picked && (
            <div className="hh-ctxp-picked">
              <span>{picked}</span>
              <button
                type="button"
                disabled={waiting}
                onClick={async () => {
                  setWaiting(true);
                  await act(() => client.context.add(taskId, picked), () => setPicked(null));
                  setWaiting(false);
                }}
              >
                {t("context.forTask")}
              </button>
              <button type="button" disabled={waiting} onClick={() => void act(() => client.context.pin(ctx.scope, picked), () => setPicked(null))}>
                {pinLabel}
              </button>
              {scoped && ctx.scope !== "_app" && (
                <button type="button" disabled={waiting} onClick={() => void act(() => client.context.pin("_app", picked), () => setPicked(null))}>
                  {t("context.pinApp")}
                </button>
              )}
            </div>
          )}
          {waiting && <p role="status">{t("context.waiting")}</p>}
        </div>
      )}
      {notice && (
        <p className="hh-caption" role="alert">
          {notice}
        </p>
      )}

      <section className="hh-ctxp-section" aria-labelledby={startId}>
        <h3 id={startId}>{t("context.start")}</h3>
        <ul className="hh-ctxp-list">
          {ctx.start.map((i) => (
            <li key={i.id} className={i.compacted ? "hh-ctxp-faint" : undefined}>
              <div className="hh-ctxp-row">
                {i.path && i.kind !== "instructions" ? open(i.path, itemText(i)) : <span>{itemText(i)}</span>}
                <span className="hh-ctxp-size">{t("context.approx", { tokens: fmt(i.tokens) })}</span>
                {i.compacted && <span className="hh-caption">{t("context.faint")}</span>}
              </div>
              {i.notes && i.notes.length > 0 && (
                <ul className="hh-ctxp-notes">
                  {i.notes.map((n) => (
                    <li key={n.path} className="hh-ctxp-row">
                      {open(n.path, n.title)}
                      {excludedNotes.has(n.path) ? (
                        <span className="hh-caption">{t("context.appliesNext")}</span>
                      ) : (
                        !readOnly && (
                          <button
                            type="button"
                            aria-label={t("context.excludeName", { name: n.title })}
                            onClick={() => void act(() => client.context.exclude(i.kind === "app-notes-index" ? "_app" : ctx.scope, n.path))}
                          >
                            {t("context.exclude")}
                          </button>
                        )
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
        <p className="hh-caption">{t("context.total", { tokens: fmt(total) })}</p>
        {ctx.startTokens !== undefined && <p className="hh-caption">{t("context.realFirst", { tokens: fmt(ctx.startTokens) })}</p>}
      </section>

      <section className="hh-ctxp-section" aria-labelledby={duringId}>
        <h3 id={duringId}>{t("context.during")}</h3>
        {reads.length === 0 ? <p className="hh-caption">{t("context.nothingRead")}</p> : <ul className="hh-ctxp-list">{reads.map(readRow)}</ul>}
      </section>

      <section className="hh-ctxp-section" aria-labelledby={pinnedId}>
        <h3 id={pinnedId}>{t("context.pinned")}</h3>
        {ctx.pins.length === 0 ? (
          <p className="hh-caption">{t("context.nothingPinned")}</p>
        ) : (
          <ul className="hh-ctxp-list">
            {ctx.pins.map((p) => {
              const gone = p.state === "missing" || p.state === "binary";
              return (
                <li key={`${p.scope}:${p.path}`} className="hh-ctxp-row">
                  {gone ? <span className="hh-ctxp-gone">{p.path}</span> : open(p.path)}
                  {p.scope === "_app" && scoped && <span className="hh-caption">{t("context.wholeApp")}</span>}
                  {p.state === "title" && <span className="hh-caption">{t("context.titleOnly")}</span>}
                  {gone && <span className="hh-caption">{t(p.state === "missing" ? "context.missing" : "context.binary")}</span>}
                  {!gone && <span className="hh-ctxp-size">{t("context.approx", { tokens: fmt(p.tokens) })}</span>}
                  {!readOnly && (
                    <button type="button" aria-label={t("context.removeName", { name: p.path })} onClick={() => void act(() => client.context.unpin(p.scope, p.path))}>
                      {t("context.remove")}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {ctx.excluded.length > 0 && (
        <section className="hh-ctxp-section" aria-labelledby={excludedId}>
          <h3 id={excludedId}>{t("context.excluded")}</h3>
          <ul className="hh-ctxp-list">
            {ctx.excluded.map((e) => (
              <li key={`${e.scope}:${e.note}`} className="hh-ctxp-row">
                {e.title ? open(e.note, e.title) : <span className="hh-ctxp-gone">{fileName(e.note)}</span>}
                {!readOnly && (
                  <button type="button" aria-label={t("context.includeName", { name: e.title ?? fileName(e.note) })} onClick={() => void act(() => client.context.include(e.scope, e.note))}>
                    {t("context.include")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
```

Two details the tests pin:
- The row buttons show a short label ("Remove") and carry the item in their accessible name ("Remove gone.md").
- The "Exclude" button of an app-wide index excludes in `_app`, every other in the task's scope.

If `hh-link-button` does not exist in `styles.css` (grep it), use the class the reader's links use for button-styled links, or add `.hh-ctxp-link` with the rules below.

- [ ] **Step 5: Styles**

Run: `grep -c "hh-ctxp" packages/ui/src/styles.css`
Expected: `0`.

Append to `packages/ui/src/styles.css` (after the timeline panel's rules):

```css
/* The context panel (context-panel spec §5.1): the reader's slot; over the chat on narrow windows. */
.hh-ctxp { display: flex; flex-direction: column; gap: 12px; min-width: 0; flex: 0 0 55%; box-sizing: border-box; padding: 12px 16px 24px; overflow-y: auto; border-left: 1px solid var(--hh-line); background: var(--hh-surface); }
.hh-ctxp-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.hh-ctxp-head h2 { margin: 0; font-family: var(--hh-display); font-size: 17px; font-weight: 600; }
.hh-ctxp-section h3 { margin: 8px 0 4px; font-size: 13px; color: var(--hh-slate); }
.hh-ctxp-list, .hh-ctxp-notes { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
.hh-ctxp-notes { margin: 2px 0 6px 16px; }
.hh-ctxp-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; font-size: 13px; overflow-wrap: anywhere; }
.hh-ctxp-size { margin-left: auto; color: var(--hh-muted); font-size: 12px; white-space: nowrap; }
.hh-ctxp-faint { opacity: 0.55; }
.hh-ctxp-gone { text-decoration: line-through; color: var(--hh-muted); }
.hh-ctxp-add { display: flex; flex-direction: column; gap: 6px; }
.hh-ctxp-menu { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 8px; border: 1px solid var(--hh-line); border-radius: 8px; background: var(--hh-surface); }
.hh-ctxp-picked { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; overflow-wrap: anywhere; }
.hh-ctxp-meter { display: inline-flex; padding: 2px; border: 0; border-radius: 50%; background: none; cursor: pointer; }
.hh-ctxp-meter:focus-visible { outline: 2px solid var(--hh-slate); outline-offset: 1px; }
@media (max-width: 899px) { .hh-ctxp { position: fixed; inset: 52px 0 0 0; z-index: 5; border-left: 0; } }
```

(Only existing tokens; none needs a dark-mode override. If `packages/ui/test/styles.test.ts` checks that every `var(--hh-*)` is defined, it passes as is.)

- [ ] **Step 6: Export**

`packages/ui/src/index.ts`:

```ts
export { ContextPanel, type ContextPanelProps } from "./ContextPanel";
```

- [ ] **Step 7: Run the tests**

Run: `corepack pnpm vitest run packages/ui/test/context-panel.test.tsx packages/ui/test/styles.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck, test, build, commit**

Run: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm app:build`

```bash
git -C <worktree> add packages/ui/src/ContextPanel.tsx packages/ui/src/styles.css packages/ui/src/index.ts packages/i18n/src/locales/en.json packages/ui/test/context-panel.test.tsx
git -C <worktree> commit -m "feat(ui): the context panel"
```

---

### Task 14: The panel in the app — the meter opens it; items open; Settings' budget

**Files:**
- Modify: `packages/ui/src/FlowSide.tsx`, `packages/ui/src/ChatView.tsx`, `packages/ui/src/ModelsTab.tsx`, `packages/i18n/src/locales/en.json`
- Test: `packages/ui/test/context-chat.test.tsx` (create), `packages/ui/test/models-tab.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/test/context-chat.test.tsx` (helpers copied from `flow.test.tsx`: `flowClient`, `startWork`, `tasks`):

```tsx
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HarnessApp } from "../src";
import type { TaskContext } from "../src/client";
import { FakeClient } from "./fake-client";

afterEach(cleanup);

const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };
const CTX: TaskContext = {
  task: "t1",
  scope: "main",
  scoped: false,
  start: [{ id: "brief", kind: "brief", label: "Task brief", tokens: 300 }],
  reads: [{ kind: "read", label: "docs/plan.md", path: "docs/plan.md", firstAt: "2026-10-28T10:00:00.000Z", count: 1 }, { kind: "read", label: "src/a.ts", path: "src/a.ts", firstAt: "2026-10-28T10:01:00.000Z", count: 1 }],
  compacted: false,
  pins: [],
  excluded: [],
  budget: 3000,
};

async function openApp(actions = true) {
  const client = new FakeClient(ready);
  if (actions) {
    client.state.actions = { manifest: { label: "The manifest", cost: "medium" } };
    client.state.path = ["manifest"];
  }
  client.contexts.t1 = CTX;
  render(<HarnessApp client={client} locales={{ en: {} }} />);
  const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
  await waitFor(() => expect(start.disabled).toBe(false));
  fireEvent.click(start);
  await act(() => client.emitTasks({ ...client.tasks, current: { id: "t1", ...(actions ? { action: "manifest" } : {}), status: "waiting", context: { used: 40_000, cap: 200_000 } } }));
  return client;
}

describe("the context panel in the app (context-panel spec §5.1)", () => {
  it("the meter is a button that opens the panel; Close closes it", async () => {
    await openApp();
    fireEvent.click(await screen.findByRole("button", { name: "What the AI takes into account" }));
    const panel = await screen.findByRole("region", { name: "What the AI takes into account" });
    fireEvent.click(within(panel).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "What the AI takes into account" })).toBeNull());
  });

  it("a .md opens in the reader, any other file in the file timeline panel", async () => {
    await openApp();
    fireEvent.click(await screen.findByRole("button", { name: "What the AI takes into account" }));
    let panel = await screen.findByRole("region", { name: "What the AI takes into account" });
    fireEvent.click(await within(panel).findByRole("button", { name: "docs/plan.md" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "What the AI takes into account" })).toBeNull());
    expect(await screen.findByRole("complementary", { name: "Document" })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "What the AI takes into account" }));
    panel = await screen.findByRole("region", { name: "What the AI takes into account" });
    fireEvent.click(await within(panel).findByRole("button", { name: "src/a.ts" }));
    expect(await screen.findByRole("heading", { name: /a\.ts/ })).toBeTruthy();
  });

  it("without actions the meter sits in the top bar", async () => {
    await openApp(false);
    expect(await screen.findByRole("button", { name: "What the AI takes into account" })).toBeTruthy();
  });

  it("an Add now turn shows its line in the chat", async () => {
    const client = await openApp();
    act(() => client.emitTaskTurn({ task: "t1", kind: "context", path: "docs/plan.md" }));
    expect(await screen.findByText("Take docs/plan.md into account")).toBeTruthy();
  });
});
```

(The reader is the `complementary` landmark named "Document", as `packages/e2e/tests/reader.spec.ts` finds it. `FileTimelinePanel`'s heading names the file, as in `file-timeline-panel.test.tsx`; the fake client's `readDocument` answers `docs/plan.md` once `client.documents["docs/plan.md"]` is set in `openApp`, following `document-reader.test.tsx`.)

Append to `packages/ui/test/models-tab.test.tsx` a test in the style of its existing ones (they render `ModelsTab` with a `FakeClient` state and check `client.saved`): the Tasks part shows a select "Pinned files budget" with 1,000 / 3,000 / 6,000 / 12,000 tokens, selected at `state.models.pinnedTokens` when `config.models.pinnedTokens` is absent; picking 6,000 saves `{ models: { …, pinnedTokens: 6000 } }`.

```tsx
it("sets the pinned files budget (context-panel spec §4.2)", async () => {
  const { client } = await renderModels(); // the file's helper that renders ModelsTab on the Tasks part
  const select = (await screen.findByLabelText("Pinned files budget")) as HTMLSelectElement;
  expect(select.value).toBe("3000");
  fireEvent.change(select, { target: { value: "6000" } });
  await waitFor(() => expect(client.savedConfigs.at(-1)?.models?.pinnedTokens).toBe(6000));
});
```

(Use the names the file already uses for its render helper and for the saved configs; the two assertions are what matter.)

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/ui/test/context-chat.test.tsx packages/ui/test/models-tab.test.tsx`
Expected: FAIL.

- [ ] **Step 3: The meter as a button (`packages/ui/src/FlowSide.tsx`)**

```tsx
/** A small ring: the context the task's session uses against its cap, the exact tokens on hover (spec §6). With `onOpen`, a button that opens the context panel. */
export function ContextMeter({ used, cap, onOpen }: { used: number; cap: number; onOpen?: () => void }) {
  const { t, i18n } = useTranslation();
  if (!(cap > 0)) return null;
  const pct = Math.max(0, Math.min(100, Math.round((used / cap) * 100)));
  const fmt = (n: number) => n.toLocaleString(shownLanguage(i18n));
  const ring = (
    <span
      className={pct >= 80 ? "hh-context-meter warn" : "hh-context-meter"}
      role="meter"
      aria-label={t("models.context")}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={`${pct}%`}
      title={t("models.contextTitle", { used: fmt(used), cap: fmt(cap) })}
    >
      <svg viewBox="0 0 18 18" aria-hidden="true">
        <circle cx="9" cy="9" r="7" pathLength={100} />
        <circle cx="9" cy="9" r="7" pathLength={100} strokeDasharray={`${pct} 100`} />
      </svg>
    </span>
  );
  if (!onOpen) return ring;
  return (
    <button type="button" className="hh-ctxp-meter" aria-label={t("context.open")} onClick={onOpen}>
      {ring}
    </button>
  );
}
```

`FlowSide` gains a prop `onContext?: () => void` (documented "opens the context panel from the meter") and passes it to both `ContextMeter`s: `<ContextMeter {...tasks.current.context} onOpen={onContext} />`.

- [ ] **Step 4: ChatView**

`packages/ui/src/ChatView.tsx`:

Imports: `import { ContextPanel } from "./ContextPanel";` and `ContextMeter` from `./FlowSide` (with `FlowSide`); `isMarkdownPath` is already imported for the History panel.

State, next to `timelineFile`:

```tsx
  /** The context panel is open (context-panel spec §5.1); it shares the reader's slot. */
  const [contextOpen, setContextOpen] = useState(false);
```

In `showReader` (the function that sets `reader`), add `setContextOpen(false);` so opening a document closes the panel. Add:

```tsx
  /** One side panel at a time: the reader, the timeline, the History and notes panels close. */
  const openContext = () => {
    closeReader();
    setTimelineFile(null);
    setShowHistory(false);
    setNotesPanel(null);
    setContextOpen(true);
  };
  /** An item of the panel opens like a History link: a `.md` in the reader, anything else in the timeline panel. */
  const openFromContext = (file: string) => {
    setContextOpen(false);
    if (isMarkdownPath(file) && !slim) showReader({ path: file });
    else setTimelineFile(file);
  };
  // The panel belongs to the open task: it closes when the task ends.
  useEffect(() => {
    if (!tasks.current) setContextOpen(false);
  }, [tasks.current]);
```

(`closeReader` is the existing function at the `setReader(null); setReaderFull(false);` lines; if it is declared after this point, place these helpers after it.)

`FlowSide` gets `onContext={tasks.current ? openContext : undefined}`.

In the `TopBar`, before the `UsageMeter`:

```tsx
            {!flow && tasks.current?.context && <ContextMeter {...tasks.current.context} onOpen={openContext} />}
```

In `.hh-body`, after the `DocumentReader` block:

```tsx
          {contextOpen && tasks.current && !slim && (
            <ContextPanel
              client={client}
              taskId={tasks.current.id}
              {...(tasks.current.context ? { usage: tasks.current.context } : {})}
              notes={tasks.notes}
              onOpen={openFromContext}
              onClose={() => setContextOpen(false)}
            />
          )}
```

In `tookTurn.current`, before the wrap-up branch:

```tsx
    if (n.kind === "context") {
      dispatch({ type: "user", text: t("context.addLine", { path: n.path ?? "" }), at });
      return;
    }
```

- [ ] **Step 5: Settings › Models (`packages/ui/src/ModelsTab.tsx`)**

Import `PINNED_OPTIONS` from `@humanharness/engines` if the UI already imports engine constants there (it uses `CAPS`; follow how `CAPS` is imported — if it is a local copy, add a local `const PINNED = [1000, 3000, 6000, 12_000];` with a comment pointing at `PINNED_OPTIONS`). In the Tasks part, after `<TaskList … />`:

```tsx
          <PinnedBudget
            value={models.pinnedTokens ?? state.models?.pinnedTokens ?? 3000}
            suggested={state.models?.pinnedTokens ?? 3000}
            onChange={(n) => update((m) => ({ ...m, pinnedTokens: n }))}
          />
```

and the component, after `SpecFields`:

```tsx
/** How much pinned text a new task gets whole (context-panel spec §4.2); the harness's suggestion is offered too. */
function PinnedBudget({ value, suggested, onChange }: { value: number; suggested: number; onChange: (n: number) => void }) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const options = [...new Set([...PINNED, suggested, value])].sort((a, b) => a - b);
  return (
    <div className="hh-rows">
      <label htmlFor={id}>{t("models.pinned")}</label>
      <select id={id} value={String(value)} onChange={(e) => onChange(Number(e.target.value))}>
        {options.map((n) => (
          <option key={n} value={String(n)}>
            {t("models.pinnedOption", { tokens: n.toLocaleString(shownLanguage(i18n)) })}
          </option>
        ))}
      </select>
      <p className="hh-caption">{t("models.pinnedHint")}</p>
    </div>
  );
}
```

(`update` is the tab's existing save function; `models` its current `ModelsConfig`. Import `useId` and `shownLanguage` if missing.)

`en.json`, under `models`:

```json
"pinned": "Pinned files budget",
"pinnedOption": "{{tokens}} tokens",
"pinnedHint": "How much of the files you pin every new task gets whole. The rest go in as their title, and the AI opens them when it needs them."
```

- [ ] **Step 6: Run the tests**

Run: `corepack pnpm vitest run packages/ui/test`
Expected: PASS. `flow.test.tsx`'s meter tests still find the meter by its role and name (the ring keeps `role="meter"`).

- [ ] **Step 7: Typecheck, test, build, commit**

Run: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm app:build`

```bash
git -C <worktree> add packages/ui/src/FlowSide.tsx packages/ui/src/ChatView.tsx packages/ui/src/ModelsTab.tsx packages/i18n/src/locales/en.json packages/ui/test/context-chat.test.tsx packages/ui/test/models-tab.test.tsx
git -C <worktree> commit -m "feat(ui): the meter opens the context panel; Settings' pinned budget"
```

---
### Task 15: The CLI and mock mode — recorded reads, the "Add now" reply

**Files:**
- Modify: `packages/fake-agent/src/mock.ts`, `packages/fake-agent/src/mock-replay.ts`, `packages/fake-agent/src/mock-claude.ts`, `packages/cli/src/run.ts`, `harnesses/demo/mock/manifest.json`
- Test: `packages/fake-agent/test/mock.test.ts`, `packages/fake-agent/test/mock-replay.test.ts`, `packages/cli/test/run.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/fake-agent/test/mock.test.ts`, inside `describe("recordingSchema", …)`:

```ts
  it("a turn may record reads: folder-relative paths, never outside (context-panel spec §7)", () => {
    const base = { version: 1, action: "a", match: "m" };
    const ok = recordingSchema.parse({ ...base, turns: [{ id: "t1", reads: ["README.md", "docs/a.md"] }] });
    expect(ok.turns[0].reads).toEqual(["README.md", "docs/a.md"]);
    expect(recordingSchema.parse({ ...base, turns: [{ id: "t1" }] }).turns[0].reads).toEqual([]);
    for (const bad of ["../x.md", "/etc/passwd", "C:\\x", "", "."]) {
      expect(recordingSchema.safeParse({ ...base, turns: [{ id: "t1", reads: [bad] }] }).success).toBe(false);
    }
  });
```

Append to `packages/fake-agent/test/mock-replay.test.ts` (it already imports `replay`, `promptKind` and builds recordings with a local helper; use that helper's name for `rec` below):

```ts
describe("the Add now prompt (context-panel spec §5.2)", () => {
  const ADD = "The person wants you to take `docs/conv.md` into account. Read it now and say in one line what changes for this task.";

  it("is known by its start", () => {
    expect(promptKind(ADD)).toBe("context-add");
    expect(promptKind("Please take `x` into account")).toBe("reply");
  });

  it("plays a built-in reply that reads the named file and keeps the session where it was", () => {
    const position = { action: "a", turn: "t1" };
    const { play, session } = replay([rec], position, ADD, false);
    expect(play.reads).toEqual(["docs/conv.md"]);
    expect(play.text).toBe("I read docs/conv.md and will take it into account.");
    expect(session).toEqual(position);
  });

  it("a path that leaves the folder is not read", () => {
    const { play } = replay([rec], { action: "a", turn: "t1" }, ADD.replace("docs/conv.md", "../secret"), false);
    expect(play.reads).toEqual([]);
  });
});
```

And a test that a recorded turn's `reads` reach `play.reads` (first-turn replay of a recording whose `t1` has `reads: ["README.md"]`).

Append to `packages/cli/test/run.test.ts`, in the style of `"runs the task, follows a picked choice, closes on q …"` (same helpers; the demo harness and its mock recordings):

```ts
  it("records the start and the turn's reads in tasks.json; no context file without a pin (D0)", { timeout: 60_000 }, async () => {
    // Run the demo's manifest action in mock mode as the neighbouring test does, then press q.
    const { folder } = await runDemo(["manifest"], ["q"]); // the file's helper that runs the CLI against the demo
    const tasks = JSON.parse(fs.readFileSync(path.join(folder, ".harness", "tasks.json"), "utf8"));
    const done = tasks.history.at(-1);
    expect(done.start.map((i: { kind: string }) => i.kind)).toContain("brief");
    expect(done.reads).toEqual([expect.objectContaining({ kind: "read", path: "README.md", count: 1 })]);
    expect(fs.existsSync(path.join(folder, ".harness", "context"))).toBe(false);
  });
```

(Use the name the file gives its "run the demo" helper; the three assertions are what matter. If finished tasks are kept under a different key than `history` in `tasks.json`, use the key `task-store.ts` writes.)

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/fake-agent/test packages/cli/test/run.test.ts`
Expected: FAIL (`reads` is an unknown key; `promptKind` never answers `context-add`; the CLI records no `reads`).

- [ ] **Step 3: The schema (`packages/fake-agent/src/mock.ts`)**

`writeSchema` already checks a folder-relative path; reuse its path check. If it is inline, extract it first:

```ts
/** A path inside the work folder: relative, no `..`, no drive or UNC, not the folder itself. */
const folderRelative = z
  .string()
  .min(1)
  .refine((p) => {
    if (p.startsWith("/") || p.startsWith("\\") || /^[A-Za-z]:/.test(p)) return false;
    const parts = p.split(/[\\/]/);
    return !parts.includes("..") && parts.some((s) => s !== "" && s !== ".");
  }, "must be a path inside the work folder");
```

(`/^[A-Za-z]:/` is anchored and has no repetition: no backtracking on recorded text.) `writeSchema`'s `path` becomes `folderRelative`; its existing tests must still pass. In `mockTurnSchema`, after `writes`:

```ts
  /** Files the turn reads (context-panel spec §7): printed as Read tool calls, so the app records them. */
  reads: z.array(folderRelative).max(20).default([]),
```

- [ ] **Step 4: The replay (`packages/fake-agent/src/mock-replay.ts`)**

`Play` gains `reads: string[]`. `playTurn(turn)` copies `turn.reads`; `quiet(…)` sets `reads: []`.

```ts
const CONTEXT_ADD_START = "The person wants you to take `";

export function promptKind(prompt: string): "close" | "checkpoint" | "phase" | "wrap-up" | "context-add" | "reply" {
  if (prompt.startsWith("We are closing this topic.")) return "close";
  if (prompt.startsWith("Checkpoint:")) return "checkpoint";
  if (phasePrompt(prompt) !== undefined) return "phase";
  if (prompt.startsWith("Time is almost up:")) return "wrap-up";
  if (prompt.startsWith(CONTEXT_ADD_START)) return "context-add";
  return "reply";
}

/** The path the Add now prompt names (task-prompts.ts `CONTEXT_ADD_PROMPT`): up to the next backtick, one line. */
function addedPath(prompt: string): string | undefined {
  const rest = prompt.slice(CONTEXT_ADD_START.length);
  const end = rest.indexOf("`");
  const p = end > 0 ? rest.slice(0, end) : "";
  return p && !p.includes("\n") && mockTurnSchema.shape.reads.element.safeParse(p).success ? p : undefined;
}
```

In `replay`, after the checkpoint branch:

```ts
  // "Add now" (context-panel spec §5.2) is the app's prompt: a built-in reply that reads the file; the session stays.
  if (kind === "context-add") {
    const p = addedPath(prompt);
    return { play: { ...quiet(p ? `I read ${p} and will take it into account.` : rec?.fallback?.text ?? DEFAULT_FALLBACK), reads: p ? [p] : [] }, session: position };
  }
```

(If `mockTurnSchema.shape.reads` is wrapped by `.default`, export `folderRelative` from `mock.ts` and use `folderRelative.safeParse(p)` instead.)

- [ ] **Step 5: Printing the reads (`packages/fake-agent/src/mock-claude.ts`)**

`safeTarget` refuses an app-owned folder for writes; a read of `.harness/notes/…` is fine, so add a read check next to it:

```ts
/** The absolute path of a recorded read; throws outside the work folder (symlinks included). The file may not exist. */
function readTarget(cwd: string, p: string): string {
  const target = path.resolve(cwd, p);
  const rel = path.relative(cwd, target);
  if (rel === "" || rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) throw new Error(`refused to read "${p}": outside the work folder`);
  let ancestor = target;
  while (!existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const real = path.relative(realpathSync(cwd), realpathSync(ancestor));
  if (real === ".." || real.startsWith(".." + path.sep) || path.isAbsolute(real)) throw new Error(`refused to read "${p}": a symlink leads outside the work folder`);
  return target;
}
```

In `playTurn`, after the writes and before the text:

```ts
  // Recorded reads (context-panel spec §7): a Read tool call and its result, as Claude prints them. Nothing is read.
  play.reads.forEach((p, i) => {
    const id = `mock-read-${i + 1}`;
    print({ type: "assistant", session_id: sessionId, message: { content: [{ type: "tool_use", id, name: "Read", input: { file_path: readTarget(cwd, p) } }] } });
    print({ type: "user", session_id: sessionId, message: { content: [{ type: "tool_result", tool_use_id: id, content: "" }] } });
  });
```

ACP mock mode (`fake-acp.ts`), if it replays recordings too: emit a `tool_call` with `kind: "read"` and `locations: [{ path }]`, then a `tool_call_update` `completed`, the shape Task 2's `acpExtras` reads. If `fake-acp.ts` does not replay recordings, leave it.

- [ ] **Step 6: The demo's recording**

`harnesses/demo/mock/manifest.json`, turn `t1`: add `"reads": ["README.md"]` after its `blocks`. (The demo seeds `README.md` into the work folder.)

- [ ] **Step 7: The CLI (`packages/cli/src/run.ts`)**

In the `TaskManager` deps (next to `dataContext`, line ~384):

```ts
    ...(Object.values(harness.data).some((c) => c.context !== false)
      ? { dataContext: (scope: string, action: string | undefined) => buildDataContextParts(dataStore, harness.data, scope, action) }
      : {}),
    // Context panel (context-panel spec): pins and exclusions as the app applies them; the CLI has no panel to set them.
    personContext: (scope: string) => pinnedContext(folder, scoped ? [scope, "_app"] : ["main"], pinnedBudget({}, harness.context)),
    instructionsSize: async () => {
      const stat = await fs.stat(path.join(folder, "AGENTS.md")).catch(() => null);
      return stat?.isFile() ? stat.size : null;
    },
    folder: async () => folder,
```

Imports: `buildDataContextParts` replaces `buildDataContext` from the same module (drop the old import if unused); `pinnedContext` from `@humanharness/shell/context-pins` if the CLI already imports from the shell package that way — otherwise move `pinsOf`/`pinnedContext` (Task 11) into `packages/workspace/src/context.ts`, which both import, and re-export from `context-pins.ts`. `pinnedBudget` from `@humanharness/engines`. `{}` for the models: the CLI keeps no person settings (it already passes `models: {}`, line ~420).

- [ ] **Step 8: Run the tests**

Run: `corepack pnpm vitest run packages/fake-agent/test packages/cli/test`
Expected: PASS.

- [ ] **Step 9: Typecheck, test, build, commit**

Run: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm app:build`

```bash
git -C <worktree> add packages/fake-agent packages/cli/src/run.ts packages/cli/test/run.test.ts harnesses/demo/mock/manifest.json
git -C <worktree> commit -m "feat(mock): recorded reads and the Add now reply; the CLI records the context"
```

---

### Task 16: End to end — the panel in the real app

**Files:**
- Create: `packages/e2e/tests/context.spec.ts`

- [ ] **Step 1: Write the test**

```ts
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { closeAndClean, launchMock, makeSandbox } from "./helpers";

const START = "Which part do you want to understand?";
const PANEL = "What the AI takes into account";

test("the context panel: what the task loaded and read, Add now, a pin and an exclusion for the next task", async () => {
  const s = makeSandbox("context");
  fs.writeFileSync(path.join(s.folder, "conventions.md"), "# Conventions\n\nWe write in English.\n");
  const { app, page } = await launchMock(s);
  try {
    await page.getByRole("button", { name: "Start Demo" }).click();
    await page.getByRole("region", { name: START }).getByRole("button", { name: /The manifest/ }).click();
    await expect(page.getByRole("main").getByText("El manifiesto declara todo el harness.")).toBeVisible();

    // The meter opens the panel: the start and the recorded read.
    await page.getByRole("button", { name: PANEL }).click();
    const panel = page.getByRole("region", { name: PANEL });
    const start = panel.getByRole("region", { name: "At the start" });
    await expect(start.getByText("What the task is about")).toBeVisible();
    await expect(start.getByText(/^Total: approx\. [\d,]+ tokens$/)).toBeVisible();
    await expect(start.getByText(/^First turn: [\d,]+ tokens \(real\)$/)).toBeVisible();
    await expect(panel.getByRole("region", { name: "During the task" }).getByText("README.md")).toBeVisible();

    // Add now: a picked file goes to this task; its line shows in the chat and the read in the panel.
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, path.join(s.folder, "conventions.md"));
    await panel.getByRole("button", { name: "Add…" }).click();
    await panel.getByRole("button", { name: "Choose a file…" }).click();
    await panel.getByRole("button", { name: "For this task" }).click();
    await expect(page.getByRole("main").getByText("Take conventions.md into account")).toBeVisible();
    await expect(panel.getByRole("region", { name: "During the task" }).getByText("conventions.md")).toBeVisible();

    // Pin it: one commit, the person's file.
    await panel.getByRole("region", { name: "During the task" }).getByRole("button", { name: "Pin conventions.md" }).click();
    await expect(panel.getByRole("region", { name: "Pinned" }).getByText("conventions.md")).toBeVisible();
    const pins = JSON.parse(fs.readFileSync(path.join(s.folder, ".harness", "context", "main.json"), "utf8"));
    expect(pins.pinned.map((p: { path: string }) => p.path)).toEqual(["conventions.md"]);

    // Finish the task as flow.spec.ts does; its note is listed.
    await panel.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "Seguir el recorrido →" }).click();
    await expect(page.getByRole("list", { name: "What's clear so far" }).getByRole("button", { name: "El manifiesto" })).toBeVisible();

    // The next task starts with the pin and the notes index; exclude the note.
    await page.getByRole("region", { name: START }).getByRole("button", { name: /The manifest/ }).click();
    await page.getByRole("button", { name: PANEL }).click();
    const next = page.getByRole("region", { name: PANEL }).getByRole("region", { name: "At the start" });
    await expect(next.getByText("Pinned · conventions.md")).toBeVisible();
    await next.getByRole("button", { name: "Exclude El manifiesto" }).click();
    await expect(next.getByText("Applies from the next task")).toBeVisible();
    const excluded = JSON.parse(fs.readFileSync(path.join(s.folder, ".harness", "context", "main.json"), "utf8"));
    expect(excluded.excluded.map((e: { note: string }) => e.note)).toEqual([".harness/notes/manifest.md"]);

    // Neither the window's chat log nor the engine's own files were read for any of this (D0).
    const tasks = JSON.parse(fs.readFileSync(path.join(s.folder, ".harness", "tasks.json"), "utf8"));
    expect(JSON.stringify(tasks)).not.toContain(s.folder);
  } finally {
    await closeAndClean(app, s);
  }
});

test("D0: a task without pins or exclusions writes no context file", async () => {
  const s = makeSandbox("context-d0");
  const { app, page } = await launchMock(s);
  try {
    await page.getByRole("button", { name: "Start Demo" }).click();
    await page.getByRole("region", { name: START }).getByRole("button", { name: /The manifest/ }).click();
    await expect(page.getByRole("main").getByText("El manifiesto declara todo el harness.")).toBeVisible();
    expect(fs.existsSync(path.join(s.folder, ".harness", "context"))).toBe(false);
  } finally {
    await closeAndClean(app, s);
  }
});
```

Notes for the implementer:
- `makeSandbox(name)` gives `s.folder`, the work folder; check its README.md is seeded by the demo (as `flow.spec.ts` expects).
- If the manifest topic's note is not titled "El manifiesto" in the recording, use the title `flow.spec.ts` line 89 waits for.
- The "Exclude …" name uses the note's title, as `ContextPanel` labels it.
- If the second "The manifest" start reuses the closed task's recording position, start any other topic from the same region; the assertions are about "At the start".
- `tasks.json` must never hold an absolute path: reads are folder-relative (Task 8).

- [ ] **Step 2: Run it**

Run: `corepack pnpm app:build && corepack pnpm e2e -- context.spec.ts`
Expected: PASS. Then the whole suite: `corepack pnpm e2e`. Expected: PASS (no other spec finds a second button named "What the AI takes into account": the meter keeps its `role="meter"`).

- [ ] **Step 3: Commit**

```bash
git -C <worktree> add packages/e2e/tests/context.spec.ts
git -C <worktree> commit -m "test(e2e): the context panel, Add now, a pin and an exclusion"
```

---

### Task 17: Docs

**Files:**
- Modify: `docs/architecture/context.md`, `docs/architecture/mock-mode.md`, `docs/architecture/manifest.md`, `docs/architecture/settings.md`, `docs/architecture/turn.md`, `docs/superpowers/specs/2026-10-27-context-panel-design.md`

- [ ] **Step 1: `docs/architecture/context.md`** — add a section "## What the person sees and steers (context panel)":
  - What the app records and where: `CurrentTask.start` (items with approximate sizes, `approxTokens` = bytes ÷ 4 rounded up), `startTokens` (the first turn's input + cache read + cache write, the engine's own report), `reads` (Read/Grep/Glob and MCP tools, from the runtime's `activity` events, made folder-relative, once per turn, capped at 500), the `compacted` marks.
  - The person's file `.harness/context/<scope>.json`: `pinned` `{path, at}`, `excluded` `{note, at}`, removed when empty; written only by the panel, one commit `Context: …` each, refused while the app's history is busy.
  - The order of a new task's first message: notes index (minus exclusions), app notes, data tables, pinned section, material; the pinned budget and title-only pins over it, strict order.
  - "Add now": one turn with `CONTEXT_ADD_PROMPT`, queued behind the running turn (`whenFree`), its chat line "Take X into account".
  - D0: no pin and no exclusion → no file, no section, the first message byte for byte as before.
  - Never read: `~/.claude`, `~/.codex` or any engine account file; usage and paths come only from the engine's protocol output.
- [ ] **Step 2: `docs/architecture/mock-mode.md`** — `reads` on a turn (folder-relative, at most 20, printed as Read tool calls); the built-in reply to the Add now prompt (it reads the named path, keeps the session's turn).
- [ ] **Step 3: `docs/architecture/manifest.md`** — `context.pinnedTokens` (0–50,000, default 3,000): the harness's suggestion for the pinned budget.
- [ ] **Step 4: `docs/architecture/settings.md`** — Models › Tasks: "Pinned files budget" (`models.pinnedTokens`), options 1,000 / 3,000 / 6,000 / 12,000 plus the harness's suggestion.
- [ ] **Step 5: `docs/architecture/turn.md`** — the `context-add` turn kind and the `context` task turn notice; `paths`/`tool` on runtime `activity` events, stripped before the window.
- [ ] **Step 6: the spec** — under its title: `Status: implemented in plan 17 (docs/superpowers/plans/2026-10-28-context-panel.md); see its "Conflicts with the spec".`
- [ ] **Step 7: Commit**

```bash
git -C <worktree> add docs
git -C <worktree> commit -m "docs: the context panel"
```

---
## Self-review against the spec

| Spec | Where |
|---|---|
| §2 decisions (record what the app put in, what the agent used; estimates labelled; one real total) | Tasks 1, 7, 8, 13 |
| §3.1 at the start: instructions, brief, notes index, app notes, data per table, material, pins, with estimates | Task 4 (data parts), Task 7 (`startItems`, `indexItem`), Task 11 (pin items); `scope-instructions` not produced (Conflict 2) |
| §3.1 the real first-message total from `usage` | Task 8 (`startTokens` = input + cache read + cache write of the first turn); Q1 |
| §3.1 mode and phase briefs added later | Task 8 (`addBrief`, `at`); Conflict 3 |
| §3.2 reads from Claude and Codex, MCP tool calls, no duplicates, counts | Task 2 (runtime), Task 1 (`readsOf`, `mergeReads`), Task 8 (`recordTurn`) |
| §3.2 the compaction flag | Task 8 (`markCompacted` in `track`); Task 13 shows it faint |
| §3.2 stored in `tasks.json` | Task 6 |
| §4.1 "Add now": one quiet turn, queued behind the running one, "Waiting" | Task 9 (`addContext`, `whenFree`), Task 11 (`ContextService.add`), Task 13 (`waiting`), Task 14 (chat line); Conflict 1 |
| §4.2 pins per scope and app-wide, the budget, title only over it, 1 MB rule, pin order | Task 5 (`pinsLayout`), Task 10 (budget), Task 11 (`pinnedContext`, `checkPinPath`), Task 14 (Settings) |
| §4.3 exclusions in `buildNotesIndex` for the scope and `_app` | Task 4 (`IndexOptions.exclude`), Task 7 (passes them), Task 11 (`exclude`/`include`) |
| §4 `.harness/context/` in the history, one commit per change, undone with the task | Task 5 (`appHistoryKeep`), Task 11 (serial `write` with trailer), Task 12 (History panel entry) |
| §5.1 the four sections, opening items, the meter as a button | Tasks 13, 14 |
| §5.2 `client.context` and `<ContextPanel>` | Tasks 1, 12, 13; Conflicts 4, 5 |
| §6 deleted pin struck through with Remove | Task 11 (`state: "missing"`), Task 13 (`hh-ctxp-gone`) |
| §6 outside the folder or a reference folder refused | Task 11 (`checkPinPath` → `outside`) |
| §6 unlinked folder | Not built (Conflict 2) |
| §6 excluding a note already in the open task's index | Task 13 ("Applies from the next task") |
| §6 pinned file also read: listed in both | Task 8 records reads independently of pins |
| §6 Add now while the cap is full | Conflict 1: queued behind the running turn |
| §6 over 1 MB | Task 5 (`PIN_INLINE_MAX_BYTES`) |
| §7 unit tests | Tasks 1–12, 15 |
| §7 e2e: open from the meter, add, pin for the next task, exclude for the next task | Task 16 |
| §8 C5 and the dev harness's needs | Covered by §3–§5 above |
| §9 slices 1–5 | 1 → Tasks 1–3, 6–8; 2 → Tasks 13–14; 3 → Tasks 4, 5, 9–11; 4 → Tasks 12–13; 5 → Task 15 |
| §10.1 estimates per item, one real total | Task 13 ("approx.", "(real)") |
| §10.2 pin order, no reordering | Task 5 (strict order) |
| §10.3 the agent proposing pins | Not built (Conflict 8) |
| D0 | Task 5 (empty file removed), Task 7 (no pins → first message byte for byte), Task 15 (CLI), Task 16 (no context file) |

Placeholder scan: every code step shows its code; where a test reuses a file's existing helper the plan names what the helper does and the assertions that matter. Type names were checked across tasks (`ContextItem`, `ContextRead`, `PinView`, `TaskContext`, `ContextResult`, `PersonContext`, `pinnedContext`, `pinnedBudget`, `buildDataContextParts`, `CONTEXT_ADD_PROMPT`).

## Open questions

Marco is away; each default is what the plan does.

- **Q1. What the "real" total counts.** The engine reports one usage for the whole first turn (every model call in it, tool calls included), not for the first message alone. **Default:** show it as "First turn: N tokens (real)", not as the first message's size.
- **Q2. Live or at turn end.** Reads are recorded when the turn ends, not as each tool call happens. **Default:** at turn end (one write to `tasks.json` per turn; the panel updates then).
- **Q3. The "Add now" chat line.** **Default:** stored in English as the app's own line, "Take X into account", like "Time is almost up".
- **Q4. Budget options in Settings.** **Default:** 1,000 / 3,000 / 6,000 / 12,000 tokens, plus the harness's suggestion if it is another value.
- **Q5. Core MCP tools (data, material, ui).** **Default:** recorded like any other MCP tool ("data · data_query", "ui · show_diagram"); the app's own servers are not filtered out.
- **Q6. Where the panel shows.** **Default:** in the reader's slot, one side panel at a time; opening an item closes the panel and opens the reader or the file timeline.
- **Q7. Budget packing.** **Default:** strict pin order: once one pin does not fit, it and every later pin go in as title only (no skipping ahead to smaller ones).
- **Q8. "Add now" on a binary file.** **Default:** allowed (the agent decides what it can read); pins refuse binary files.
- **Q9. Harnesses without actions.** **Default:** the meter (and so the panel button) shows in the top bar when there is no flow side.
- **Q10. An emptied pins file.** **Default:** deleted, so a folder that pinned and unpinned looks like one that never did (D0), in one commit.
- **Q11. The pinned section's format.** **Default:** each pin as `### <path>` and a backtick fence one longer than any run in the file; title-only pins as one line `- <title> → <path>`.
