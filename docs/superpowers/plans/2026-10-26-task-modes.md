# Task Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A harness may declare `modes` in its manifest: ways the AI works inside a task (Socratic, Feynman, "explore", "review"), each with a brief, an optional minimum tier, a recommendation hint and optional settings. An action lists the modes it accepts and how a task starts (`defaultMode`: a mode id, `"recommend"` or `"ask"`). The agent recommends with a new core block, `recommend_mode`; the person always picks. A pick is one turn in the same session carrying the new mode's brief and settings (`MODE_PROMPT`), so the conversation and its cache stay. A mode that asks for more power than the task runs on offers two ways on: continue at the current tier, or close the task and start a new one in that mode at the required tier. The current mode and the modes used are task state (`tasks.json`), every `usage.jsonl` line carries the mode, and the closing note lists the modes used. Mode settings (harness-settings spec §6) live in the same Settings tab and the same `settings` collection, under `modes.<modeId>`. A harness that declares no modes works exactly as today (D0 below).

**Architecture:**
- **Contract (harness-sdk).**
  - `index.ts`: the manifest's `modes` (`modeSchema`), each action's `modes` and `defaultMode`, every structural check in the manifest's `superRefine`, `loadHarness` resolving each mode's brief, and `tierBelow`.
  - New `modes.ts`: `MODE_ID`, `DEFAULT_MODE_WORDS`, `hasModes`, `defaultModeOf`.
  - `core-blocks.ts`: `MODE_CORE_BLOCKS` (`recommend_mode`), offered by `allBlocks` only to a harness with modes, its name reserved for all.
  - `settings.ts`: the per-field checks become `checkSettingFields` (shared by the harness's and the modes' settings); mode settings get keys `"<mode>.<field>"` (`modeSettingKey`), are stored under `modes.<mode>` of the `settings` record, read by `settingsValues`, written by `withSetting`, drawn by `settingsView` as one section per mode, and filled by `modeSentences`.
- **Task state, prompts and turns (shell main).**
  - `task-prompts.ts`: `modePrompt` (the switch), `modeSection` (a task that starts or resumes in a mode), `recommendSection` (the first message asks for a recommendation) and `closePrompt` (the closing turn lists the modes used); `resumeMessage` takes the mode's section.
  - `task-store.ts`: `CurrentTask.mode`, `modes`, `belowMinTier`; `TaskStore` drops a mode the manifest no longer declares.
  - `usage-log.ts` / `turn-controller.ts`: `UsageMeta.mode`; `TurnOptions.mode` and `modeSwitch` (the chat's user entry is a system line, `ChatEntry.mode`).
  - `models.ts`: `nearestTier` (what a custom profile counts as) and `resolveProfile`'s `floor`.
  - `task-manager.ts`: `start(…, mode)`, a task that starts in a mode or asks for a recommendation, `chooseMode(mode, choice)` (`{ accepted, done }`, like `respond`), the tier check and its two ways on, the close prompt and the note's `modes`, the resumed session's mode, and the view's `mode`, `modes`, `tier`, `belowMinTier`.
  - `settings.ts` (`SettingsController`): `set` takes a mode setting's key.
  - New `mode-ipc.ts`: the `hh:chooseMode` handler. `index.ts` wires the deps, `AppState.modes`, the actions' `modes`/`defaultMode`, `hh:send`'s `mode`, and the settings view with modes.
- **The window (ui).** `RecommendModeBlock` (the recommended mode first, marked "Recommended", with its reasons, then the alternatives, then "See all modes"); `ModeList` and `ModeBar` (the task's mode under the top bar, "Change mode"); `ChatView` draws the switch as a system line, asks the two-way tier question, and asks for a mode before a `defaultMode: "ask"` task. The harness's own UI can switch with `client.chooseMode`.
- **Authoring tools (cli).** `check` reports a missing or empty mode brief (`brief-missing`); structural rules are manifest schema errors. `humanharness run <action> --mode <id>` starts in a mode, `m <id>` at the prompt switches, and the terminal draws `recommend_mode`. A new fixture, `packages/fake-agent/fixtures/modes-harness` (id `coach`), drives the run and e2e tests.

**Tech Stack:**
- Unchanged: TypeScript, pnpm via corepack, Electron 44 + electron-vite 5, React 19, i18next, zod 4 (`instanceof z.ZodType`, `.optional()`, `safeParse`), Vitest + happy-dom, and Playwright with the fake agents.
- No new dependency.

Spec: `docs/superpowers/specs/2026-10-25-task-modes-design.md` (source of truth; "§" and "D" numbers below refer to it). Mode settings come from `2026-10-25-harness-settings-design.md` §6. It builds on plans 1–3 (`2026-10-25-scopes-and-data.md`, `2026-10-25-input-blocks.md`, `2026-10-26-harness-settings.md`), all merged into master at 47c8503, and on plan 5a (English-only core).

---

## Conventions

**Code**
- Same as plans 1–3:
  - English everywhere (code, comments, docs, UI strings, manifest texts);
  - packages export TS source;
  - extensionless imports;
  - tests in `packages/<name>/test/`;
  - one commit per task.
- React tests are `*.test.tsx` with `// @vitest-environment happy-dom` on the first line. Find elements by role and visible text.
- `@humanharness/ui` only imports **types** from other packages (`import type`). The UI's own small helpers live in `packages/ui/src/` (`modes.ts` keeps its own tier order for that reason).
- Colours only through the existing `--hh-*` tokens.
- Every lookup by a name that comes from a person, a harness, the agent or IPC (`modes[id]`, `actions[id]`, stored record keys, a block's `recommended`) goes through `Object.hasOwn` (or a list's `includes`) first.
- Errors over IPC travel as data where the window needs a reason (`ModeResult`), never as thrown errors (plan 2's lesson: Electron flattens thrown errors).

**Commands and git**
- The worktree is `/Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data`, already on branch `feat/task-modes` (from master 47c8503). Implement there.
- Run every `corepack pnpm …` command from the worktree root. A single test file: `corepack pnpm vitest run <path>`.
- Git: always `git -C <worktree> …`, one simple command per call. Never use bare `git stash`. Never push.
- Every commit message ends with these two lines, with a blank line before them:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7
  ```
- Every task ends with `corepack pnpm typecheck` and `corepack pnpm test` green before its commit.
  - Tasks that touch the shell's main process, the preload or the UI also run `corepack pnpm app:build`.
  - Task 17 runs `corepack pnpm e2e`.

**Compliance (core spec §5), restated for this plan**
- Never read `~/.claude`, `~/.codex`, `~/.gemini` or any account, token or credential file.
- Modes touch only the person's folder: `.harness/tasks.json`, `.harness/usage.jsonl`, the chats, the notes and `.harness/data/_app/settings.json`.
- A mode's brief, hints and settings are harness data read in the main process; no harness function runs for modes.

**D0 is a hard rule (like plan 1's D2, plan 2's D0 and plan 3's D0).** A harness that declares no `modes` must keep, byte for byte:
- `tasks.json` (no `mode`, `modes` or `belowMinTier`);
- `AGENTS.md` and the engine's own instructions file (no `show_recommend_mode` tool);
- the MCP tool list of the `ui` server (`allBlocks` returns what it returns today);
- every prompt: a task's first message, follow-ups, the checkpoint, the closing turn (`CLOSE_PROMPT` exactly) and a resumed session's first message;
- the chat log (no `mode` on any entry), `usage.jsonl` (no `mode`) and the notes (no `modes:` line in the front matter);
- `TaskView` (no `mode`, `modes`, `tier`, `belowMinTier`), `AppState` (no `modes`; actions without `modes`/`defaultMode`) and the window (no mode bar, no system lines, no ask picker);
- the `settings` collection's schema and values, and the Settings tab (no mode sections);
- `check`'s findings for the untouched template and every existing fixture;
- `humanharness run` output and prompts (no `m <mode>` hint) without `--mode`.

Tasks 1, 2, 3, 4, 5, 6, 8, 10, 13, 14, 15 and 17 hold the regression tests. Every other task keeps D0 by adding fields only when modes exist (conditional spreads), never by changing a default.

## Decisions this plan takes where the spec leaves room, or where the code moved

**Manifest (§3), English-only (plan 5a)**
- Every text is one English string: a mode's `label`, `description` and `recommend`. The spec's `{ es, en }` pairs no longer exist in the core.
- `modes` is optional and defaults to `{}` (as `actions` and `data`). Mode ids follow the action id pattern, `^[a-z][a-z0-9_-]{0,63}$` (`MODE_ID`). `"recommend"` and `"ask"` can't be mode ids: `defaultMode` would be ambiguous.
- A mode: `label` (≤ 80), `description` (≤ 300, optional, shown in "See all modes"), `brief` (a file, resolved with `resolveInHarness` at load like an action's `prompt`), `minTier` (optional, one of `TIERS`), `recommend` (≤ 400, optional, read by the agent only) and `settings` (optional).
- An action: `modes` (optional, ≥ 1 declared ids, no repeats) and `defaultMode` (optional, only with `modes`): a mode id of that list, `"recommend"` or `"ask"`. **Absent means `"recommend"`** (D2: the AI recommends, the person decides).
- A mode the manifest declares but no action lists is allowed (no finding): a harness may keep a mode for later.
- Every structural rule of §3 `check` is in the manifest schema's `superRefine`, so `defineHarness`/`loadHarness` refuse a broken declaration and `check` reports them as `schema` findings with their paths (plan 3's choice). `check`'s own finding is a missing or empty mode brief (`brief-missing`).

**Mode settings (§3 `settings`, harness-settings §6)**
- A mode's `settings` is a record of fields with exactly the harness settings' field shape, checked by the same code (`checkSettingFields`), except that `section` is refused (fields are grouped by their mode).
- They are drawn in the harness's Settings tab, so **a mode with settings needs the manifest's `settings`** (for the tab's name). `settings.fields` may then be empty: "Declare at least one setting" moves to the manifest and counts mode settings.
- **Keys.** A mode setting's key is `"<mode>.<field>"` (`modeSettingKey`): field names and mode ids never contain a dot, so a dotted key is always a mode setting. `SettingsState.values`, `client.settings.set(key, value)` and `SettingFieldView.name` use it; no client signature changes.
- **Storage** (D2 of the settings spec, unchanged): the `settings` record gets an optional `modes: { <mode>: { <field>: value } }`, holding only what the person changed; empty objects are pruned.
- **Drawing.** `settingsView` appends one section per mode with settings, id `mode:<modeId>` (a colon never appears in a declared section id), labelled with the mode's label; its fields carry `section: "mode:<id>"` and `mode`. The tab's grouping code draws them with no change. The spec's "which the harness may mark `advanced`" is the fields' own `advanced` flag: they go under "More options", still grouped by mode. No new manifest key.
- **Reaching the agent.** Never in `AGENTS.md`. `modeSentences` fills them (as `settingSentence`, `onlyWhenChanged` included) into the mode's brief at the task's start in that mode, at a switch, and in a resumed session. A changed mode setting reaches the agent the next time that mode starts; it is never marked "Pending" (only `AGENTS.md` sentences are).
- **Controls.** The core's five controls only. The spec's example (`z.array(z.enum(...))` drawn as `select`) is a multi-select the core doesn't have; that waits for a sixth control.

**Recommending (§4)**
- The block is `recommend_mode`, visible, tool `show_recommend_mode` (the default name of a visible block). Arguments: `{ recommended: modeId, reasons: string[1..3], alternatives?: { mode, why }[0..2] }`. `alternatives` is optional so the agent can recommend alone.
- It is added to `allBlocks` only when the manifest declares at least one mode (D0); its name is reserved for every harness, like `annotate`.
- **The first message asks for it** when the task starts with no mode: `recommendSection` lists the action's modes as `` - `id` (Label): hint `` and tells the agent to end with `show_recommend_mode` instead of `show_choices`, before any teaching. It is added to that first message only.
- **Drawing.** Like `choices`: the recommended mode first (a button with a "Recommended" badge and its reasons), then the alternatives (with their `why`), then a "See all modes" disclosure with the action's modes and descriptions. Ids the action doesn't list are dropped; a block whose `recommended` isn't listed draws nothing. A block of an earlier task (or once the conversation moved on) is drawn disabled.

**Starting a task (§3 `defaultMode`)**
- A mode id: the first message is the action's brief (as today), then `modeSection`: `## Mode: <label>`, "Work in this mode.", the mode's filled brief, its settings' sentences.
- `"recommend"` (or absent): the brief, then `recommendSection`. The task has no mode until the person picks one.
- `"ask"`: the window shows the action's modes before sending anything (no model call) and sends `SendOptions.mode`. **A start the window doesn't make itself** (a `choices` option with `action`, the path's `next: true`, `humanharness run` without `--mode`) can't ask, so it falls back to `"recommend"`.
- An explicit mode (`SendOptions.mode`, `run --mode`) wins over `defaultMode`; one the action doesn't list is refused before anything closes.

**Switching (§5)**
- `TaskManager.chooseMode(mode, choice)` returns `{ accepted, done }` like `respond`: `accepted` resolves with a `ModeResult` (a refusal, or how the switch goes on) before any turn's events; `done` once the turn ended. `hh:chooseMode` answers `accepted`.
- **Refusals** (`ok: false`): `no-task` (no task, or it isn't waiting), `unknown` (not in the action's list), `tier` (below; with `required` and `current`). A Stop after the switch was taken ends it like any stopped operation (`stopped()`), not as a refusal. A switch to the current mode answers `{ ok: true, switched: "same" }` and runs nothing.
- **A running turn** (spec §5.2): `chooseMode` waits until no operation or turn runs, then switches. It never cancels the turn. (The window only offers a switch while the task waits; this is for a harness UI's own `client.chooseMode`.)
- **The switch turn** is a run turn of the same session (not `quiet`): the agent's answer in the new mode shows in the chat. Its user entry is a system line, "Switched to <label>", never the person's message (`TurnOptions.modeSwitch`, `ChatEntry.mode`). It runs a due checkpoint first, exactly as a follow-up does.
- **State follows the turn.** `mode`, `modes` (appended once, in first-use order) and `belowMinTier` are written only when the switch turn ends well, so a failed switch can be picked again ("Try again" picks the same mode). A cancelled switch ends the task, as any cancelled follow-up does today.
- **A lost session** (`resume`, after a folder move): no turn runs; the mode is set (`switched: "quiet"`) and the resumed session's first message carries it.
- **Spec §10.1 (proposed, approved):** when the task has a checkpoint note, the switch carries one line, "What is clear so far (the last checkpoint): …", the note's summary points. Otherwise nothing.
- **Phases (§7, slice 4) wait for task phases**, which aren't implemented. Nothing here refuses a mode by phase; the refusal reason list is ready for it.

**The tier floor (§5.3, D4)**
- The task's tier is `nearestTier(profile)`: its own tier; a `custom` profile counts as the tier whose model it runs on this engine (deep, then standard, then light), else by its effort (low → light, medium → standard, higher → deep).
- **"Continue with the current model"** switches and records `belowMinTier: true` (cleared by a later switch to a mode that fits).
- **"Start a new task with <mode>"** closes the task with its normal closing turn (`save_note`) and starts a new task of the same action, in the same scope, in that mode, with `profileFor(action, floor)`. **The spec says "runs a checkpoint first"; the closing turn already asks for `save_note` into the same note, which the new task starts from, so a separate checkpoint turn would only repeat it. This plan runs the closing turn alone** (listed for Marco).
- `resolveProfile`'s `floor` raises a tier below it and never lowers one above it ("the person's choice still wins"). A `custom` profile stays as the person set it; when it still counts below the mode's `minTier`, the new task records `belowMinTier: true`.
- A task that *starts* in a mode below its `minTier` (`defaultMode`, `--mode`, "ask") just records `belowMinTier: true`; the two-way question only comes with a switch, as the spec says.

**Task state, usage, notes (§6)**
- `CurrentTask.mode`, `modes`, `belowMinTier` are checked in `cleanCurrent` (shape: `MODE_ID`, ≤ 50 distinct ids). "Validates them against the manifest": `TaskStore` takes the declared mode ids (`new TaskStore(folder, { modes })`, given by the app and `run`); an unknown mode is dropped from both fields, and `belowMinTier` goes with a dropped `mode`.
- `UsageMeta.mode` / `UsageRecord.mode`: every turn of a task in a mode, the closing and checkpoint turns included, and compaction lines. Settings › Usage doesn't break costs down by mode yet (known gap); the field is there for it.
- **The closing note.** `closePrompt(labels)` appends "Also list the modes used (Socratic, Feynman) and what each was good for, as summary points." to `CLOSE_PROMPT`. **The `save_note` schema is not changed** (it is a core tool every harness has, so a new field would break D0): the agent writes what each mode was good for in the summary, and the app writes the ids it knows into the note's front matter, `modes: ["socratic","feynman"]` (`NoteMeta.modes`).

**The window**
- **Where the person switches.** The spec calls the mode control "the harness's UI". The core draws one anyway, so every harness with modes is usable: a mode bar between the top bar and the chat ("Mode: Socratic" or "No mode chosen yet", "Change mode", and a note when the task runs below the mode's level). A harness's UI may also call `client.chooseMode`.
- The two-way question is an `alertdialog` like the pre-flight one: "<mode> asks for more power", the levels, "Continue with the current model", "Start a new task with <mode>", "Not now" (Escape).
- The ask picker is a `dialog` region over the chat: "How do you want to work?", the action's modes, "Not now".
- English strings: "How do we work?", "Recommended", "See all modes", "Switched to {{mode}}", "Mode: {{mode}}", "No mode chosen yet", "Change mode", "Running below the level this mode asks for", "How do you want to work?", "{{mode}} asks for more power", "Continue with the current model", "Start a new task with {{mode}}", "Not now", and "That didn't go through. Pick a mode again." (the spec's "Recomendado", "Ver todos los métodos", "Cambiaste a Feynman", "Seguir con el modelo actual", "Empezar una tarea nueva con <mode>").
- `CurrentTaskView.tier` is sent only for a task whose action has modes, so the window can ask the tier question before calling (the main process checks again and refuses with `tier` when the window was stale).

**Authoring**
- `humanharness run <action> --mode <id>` starts in that mode (refused, exit 2, when the action doesn't list it). At the prompt, `m <id>` switches; a tier refusal prints why and switches anyway with "continue" (a run can't change its tier mid-task; it says to rerun with `--tier`). The prompt line mentions `m <mode>` only for an action with modes.
- `--set` stays top-level only: mode settings use their defaults in `run` (known gap).
- `--record` records a switch turn as a typed follow-up; mock replay of switch turns is a known gap.

## What in the code conflicts with the spec (and how this plan handles it)

| Conflict | Where | Handling |
|---|---|---|
| The spec's texts are `{ es, en }` pairs; the core is English-only since plan 5a | `harness-sdk/src/index.ts` (`text` = one string) | Plain English strings (Task 1) |
| §5.4 says "a quiet turn", and also "Then continue with the person in this mode" and a system line in the chat | `TurnOptions.quiet` hides the turn's answer | A run turn whose user entry is a system line (`modeSwitch`), so the answer shows (Tasks 6, 9) |
| §6 "`save_note` keeps them in a `modes` field of the note" | `saveNoteSchema` is a core tool in every harness (D0) | The schema stays; the app writes `modes:` into the note's front matter, the agent writes what each was good for in the summary (Tasks 5, 8) |
| §6 "`cleanCurrent` validates them against the manifest" | `cleanCurrent` has no manifest; `TaskStore(folder)` | `TaskStore(folder, { modes })`; shape always checked (Task 5) |
| §5.3 "runs a checkpoint, closes the task" | `closeCurrent` already asks for `save_note` | The closing turn alone (Task 9; open question for Marco) |
| §5.3 the required tier is a floor, but the person's choice wins | `resolveProfile` has no floor; `custom` has no tier | `floor` on `resolveProfile`, `nearestTier` (Task 7) |
| §5.2 "the switch waits until the turn ends" | `TaskManager.op` rejects while busy | `chooseMode` waits for idle first (Task 9) |
| §7 phases may refuse modes | Task phases are not implemented | Slice 4 deferred; documented (Task 16) |
| harness-settings §6: mode settings "in a section per mode, which the harness may mark advanced" | Settings sections are declared in `settings.sections` | Generated `mode:<id>` sections; each field's own `advanced` (Task 3) |
| harness-settings §3 needs at least one setting | `settingsSchema` refuses empty `fields` | The rule moves to the manifest and counts mode settings (Task 1) |
| A harness UI reads `client.settings` values by field name | `SettingsState.values` is flat | Mode settings appear under dotted keys (`socratic.questions`) (Task 3) |
| Electron flattens thrown errors | `shell/src/main/index.ts` `handle()` | `ModeResult` as data (Tasks 9, 11) |

**Reuse, and why.**
- **Reused:**
  - the settings field shape, checks, sentences and tab (one mechanism for every knob the person sets);
  - `respond`'s `{ accepted, done }` shape and IPC handler pattern for a person's act that starts a turn;
  - `closeCurrent` + `startNow` for "start a new task" (the same path as picking another topic);
  - `checkpoint`, `needsCheckpoint`, `afterRun` for the switch turn (it is a follow-up in every way but its text);
  - the pre-flight `alertdialog` pattern and `choices`' look for the new UI.
- **Not reused:**
  - `askNow` for the switch: it takes the person's text and would write the mode before the turn; the switch writes its state after the turn ends well;
  - `save_note`'s schema (D0).

## File Structure

```
packages/harness-sdk/src/modes.ts          NEW. MODE_ID, DEFAULT_MODE_WORDS, hasModes, defaultModeOf             (Task 1)
packages/harness-sdk/src/index.ts          modeSchema, HarnessMode, action modes/defaultMode, checks, tierBelow,
                                           loadHarness briefs, exports                                            (Task 1)
packages/harness-sdk/src/settings.ts       settingFieldSchema, checkSettingFields (1); ModesWithSettings,
                                           modeSettingKey, modeSettingFields, settingRef, withSetting,
                                           modeSentences, settingsCollection/dataCollections/settingsValues/
                                           settingsView with modes (3)                                            (Tasks 1, 3)
packages/harness-sdk/src/core-blocks.ts    recommendModeSchema, MODE_CORE_BLOCKS, allBlocks, reserved names       (Task 2)
packages/shell/src/main/task-prompts.ts    modePrompt, modeSection, recommendSection, closePrompt, resumeMessage  (Task 4)
packages/workspace/src/notes.ts            NoteMeta.modes, renderNote                                             (Task 5)
packages/shell/src/main/task-store.ts      CurrentTask mode fields, cleanCurrent, TaskStore known modes           (Task 5)
packages/shell/src/main/usage-log.ts       UsageMeta.mode, UsageRecord.mode                                       (Task 6)
packages/shell/src/main/turn-controller.ts TurnOptions.mode, modeSwitch                                           (Task 6)
packages/ui/src/client.ts                  ChatEntry.mode (6); CurrentTaskView fields, ModeResult, ModeChoice,
                                           ModeView, AppState.modes, ActionOption, SendOptions.mode,
                                           HarnessClient.chooseMode (8, 11)                                       (Tasks 6, 8, 11)
packages/shell/src/main/models.ts          nearestTier, resolveProfile floor                                      (Task 7)
packages/shell/src/main/task-manager.ts    deps, start in a mode, recommend, close prompt, note modes, resume,
                                           view (8); chooseMode (9)                                               (Tasks 8, 9)
packages/shell/src/main/settings.ts        SettingsController: modes, set by key                                  (Task 10)
packages/shell/src/main/mode-ipc.ts        NEW. chooseModeHandler                                                 (Task 11)
packages/shell/src/main/index.ts           deps, TaskStore modes, appState, hh:send mode, hh:chooseMode,
                                           settings view, compaction mode                                         (Task 11)
packages/shell/src/main/tasks.ts           exports nearestTier                                                    (Task 11)
packages/shell/src/preload/index.ts        chooseMode                                                             (Task 11)
packages/ui/test/fake-client.ts            chooseMode                                                             (Task 11)
packages/ui/src/modes.ts                   NEW. tierBelow, actionModes, readRecommendation                        (Task 12)
packages/ui/src/ModeList.tsx               NEW. ModeList, ModeBar                                                 (Task 12)
packages/ui/src/RecommendModeBlock.tsx     NEW. The recommend_mode block                                          (Task 12)
packages/ui/src/Message.tsx                BlockProps.chooseMode/modes, the system line                           (Tasks 12, 13)
packages/ui/src/state.ts                   the user action's mode                                                 (Task 13)
packages/ui/src/ChatView.tsx               mode bar, switch, tier question, ask picker, block wiring              (Task 13)
packages/ui/src/styles.css                 mode bar, list, recommend, system line                                 (Task 12)
packages/i18n/src/locales/en.json          modes.*                                                                (Task 12)
packages/cli/src/check.ts                  mode briefs                                                            (Task 14)
packages/fake-agent/fixtures/modes-harness/  NEW. The `coach` fixture                                             (Task 15)
packages/cli/src/run.ts                    --mode, m <id>, TaskStore modes, deps                                  (Task 15)
packages/cli/src/terminal.ts               recommend_mode                                                         (Task 15)
docs/architecture/modes.md                 NEW                                                                    (Task 16)
docs/architecture/{manifest,blocks,context,settings,authoring,mock-mode}.md                                       (Task 16)
packages/cli/guide/new-harness.md          Phase 3 asks about modes                                               (Task 16)
packages/e2e/tests/modes.spec.ts           NEW. Recommend, switch, tier question, mode settings                   (Task 17)
packages/e2e/tests/flow.spec.ts            D0 on the demo                                                         (Task 17)
```

---

## Phase 1 — Contract (spec §9 slices 1 and 2, manifest part)

### Task 1: The manifest declares modes

**Files:**
- Create: `packages/harness-sdk/src/modes.ts`
- Modify: `packages/harness-sdk/src/index.ts`, `packages/harness-sdk/src/settings.ts`
- Test: `packages/harness-sdk/test/modes.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/harness-sdk/test/modes.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type HarnessInput, DEFAULT_MODE_WORDS, MODE_ID, TIERS, defaultModeOf, defineHarness, hasModes, loadHarness, tierBelow, z } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-modes-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const base: HarnessInput = {
  id: "coach",
  name: "Coach",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Coach" },
  instructions: "./AGENTS.md",
  permissions: { edit: "none", exec: false, web: false },
  blocks: {},
  author: "t",
};
const modes = {
  socratic: { label: "Socratic", description: "Questions first.", brief: "modes/socratic.md", recommend: "One key idea to discover." },
  feynman: { label: "Feynman", brief: "modes/feynman.md" },
  worked: { label: "Worked examples", brief: "modes/worked.md", minTier: "deep" as const },
};
const study = { label: "Study", prompt: "tasks/study.md", cost: "medium" as const, modes: ["socratic", "feynman", "worked"] };
const quiz = { label: "Quiz", prompt: "tasks/quiz.md", cost: "light" as const };
const questions = {
  schema: z.enum(["few", "many"]),
  default: "few",
  control: "segmented" as const,
  label: "Questions",
  options: { few: "Few", many: "Many" },
  agent: "Ask {{value:label}} questions before explaining.",
};

const issues = (input: HarnessInput): string[] => {
  try {
    defineHarness(input);
    return [];
  } catch (err) {
    return (err as { issues: { path: PropertyKey[]; message: string }[] }).issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`);
  }
};

describe("modes in the manifest", () => {
  it("declares modes and the actions that accept them; without them, modes is {} (D0)", () => {
    const h = defineHarness({ ...base, modes, actions: { study: { ...study, defaultMode: "feynman" }, quiz } });
    expect(h.modes.worked).toEqual({ label: "Worked examples", brief: "modes/worked.md", minTier: "deep" });
    expect(h.actions.study.modes).toEqual(["socratic", "feynman", "worked"]);
    expect(h.actions.quiz).not.toHaveProperty("modes");
    expect(hasModes(h)).toBe(true);
    const plain = defineHarness(base);
    expect(plain.modes).toEqual({});
    expect(hasModes(plain)).toBe(false);
  });

  it("starts with a recommendation by default; null without modes", () => {
    expect(defaultModeOf(study)).toBe("recommend");
    expect(defaultModeOf({ ...study, defaultMode: "ask" })).toBe("ask");
    expect(defaultModeOf({ ...study, defaultMode: "worked" })).toBe("worked");
    expect(defaultModeOf(quiz)).toBeNull();
    expect(DEFAULT_MODE_WORDS).toEqual(["recommend", "ask"]);
    expect(MODE_ID.test("worked_2")).toBe(true);
    expect(MODE_ID.test("Worked")).toBe(false);
  });

  it("compares tiers in their order", () => {
    expect(TIERS).toEqual(["light", "standard", "deep"]);
    expect(tierBelow("standard", "deep")).toBe(true);
    expect(tierBelow("deep", "deep")).toBe(false);
    expect(tierBelow("deep", "light")).toBe(false);
  });

  it("refuses broken declarations, with their paths", () => {
    expect(issues({ ...base, modes: { ...modes, recommend: { label: "R", brief: "r.md" } } })).toEqual([
      'modes.recommend: "recommend" is a defaultMode word: use another mode id',
    ]);
    expect(issues({ ...base, modes, actions: { study: { ...study, modes: ["socratic", "nope"] } } })).toEqual(['actions.study.modes: Unknown mode "nope"']);
    expect(issues({ ...base, modes, actions: { study: { ...study, modes: ["socratic", "socratic"] } } })).toEqual(['actions.study.modes: "socratic" is listed twice']);
    expect(issues({ ...base, modes, actions: { quiz: { ...quiz, defaultMode: "socratic" } } })).toEqual(["actions.quiz.defaultMode: Only an action with modes has a defaultMode"]);
    expect(issues({ ...base, modes, actions: { study: { ...study, modes: ["socratic"], defaultMode: "feynman" } } })).toEqual([
      'actions.study.defaultMode: "feynman" is not one of this action\'s modes: use one of them, "recommend" or "ask"',
    ]);
    expect(issues({ ...base, modes, actions: { study: { ...study, defaultMode: "ask" } } })).toEqual([]);
    expect(issues({ ...base, modes: { ...modes, worked: { ...modes.worked, minTier: "huge" as "deep" } } })[0]).toMatch(/^modes\.worked\.minTier: /);
    expect(issues({ ...base, modes: { Bad: modes.feynman } })[0]).toMatch(/^modes/);
    expect(issues({ ...base, modes, actions: { study: { ...study, modes: [] } } })[0]).toMatch(/^actions\.study\.modes: /);
  });

  it("mode settings use the settings' field checks, need the harness's Settings tab, and have no sections", () => {
    const tab = { tab: "How I learn", fields: {} };
    const socratic = (field: object) => ({ ...modes, socratic: { ...modes.socratic, settings: { questions: field } } });
    expect(issues({ ...base, settings: tab, modes: socratic(questions) })).toEqual([]);
    expect(issues({ ...base, modes: socratic(questions) })).toEqual([
      "modes.socratic.settings: Mode settings are drawn in the harness's Settings tab: declare settings with its tab",
    ]);
    expect(issues({ ...base, settings: tab, modes: socratic({ ...questions, section: "voice" }) })).toEqual([
      "modes.socratic.settings.questions.section: Mode settings are grouped by their mode: drop section",
    ]);
    expect(issues({ ...base, settings: tab, modes: socratic({ ...questions, default: "lots" }) })).toEqual([
      "modes.socratic.settings.questions.default: The default does not match the schema",
    ]);
    // Without any mode setting, an empty tab is still refused (harness-settings spec §3).
    expect(issues({ ...base, settings: tab, modes })).toEqual(["settings.fields: Declare at least one setting"]);
  });
});

describe("loadHarness and mode briefs", () => {
  it("refuses a mode brief outside the harness folder", async () => {
    const dir = fs.mkdtempSync(path.join(root, "t-"));
    const file = path.join(dir, "harness.config.mjs");
    const manifest = { ...base, modes: { far: { label: "Far", brief: "../../outside.md" } } };
    fs.writeFileSync(file, `export default ${JSON.stringify(manifest)};`);
    await expect(loadHarness(file)).rejects.toThrow("Path escapes the harness folder: ../../outside.md");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm vitest run packages/harness-sdk/test/modes.test.ts`
Expected: FAIL (`hasModes`, `defaultModeOf`, `tierBelow` are not exported; `modes` is stripped from the manifest).

- [ ] **Step 3: Create `modes.ts`**

Create `packages/harness-sdk/src/modes.ts`:

```ts
import type { HarnessAction } from "./index";

/** A mode id (task-modes spec §3): the action id pattern. Never a dot, so `<mode>.<field>` names a mode setting. */
export const MODE_ID = /^[a-z][a-z0-9_-]{0,63}$/;

/** What an action's `defaultMode` may say besides one of its modes. No mode may take these ids. */
export const DEFAULT_MODE_WORDS: readonly string[] = ["recommend", "ask"];

/** The harness declares at least one mode. False: everything stays as before (D0). */
export const hasModes = (h: { modes?: Record<string, unknown> }): boolean => Object.keys(h.modes ?? {}).length > 0;

/**
 * How a task of `action` starts (spec §3 `defaultMode`): one of its modes, "recommend" (the default: D2, the AI
 * recommends, the person decides) or "ask". Null when the action has no modes (D0).
 */
export function defaultModeOf(action: Pick<HarnessAction, "modes" | "defaultMode">): string | null {
  if (!action.modes || action.modes.length === 0) return null;
  return action.defaultMode ?? "recommend";
}
```

- [ ] **Step 4: Share the settings' field checks**

In `packages/harness-sdk/src/settings.ts`:

1. Rename `const fieldSchema = z.object({` to an exported schema, with this doc comment above it:

```ts
/** One setting's declaration (spec §3). The harness's `settings.fields` and a mode's `settings` share it. */
export const settingFieldSchema = z.object({
```

and in `settingsSchema` change `fields: z.record(z.string().regex(SETTING_NAME), fieldSchema),` to `fields: z.record(z.string().regex(SETTING_NAME), settingFieldSchema),`.

2. Replace the whole `.superRefine((s, ctx) => { … })` of `settingsSchema` with:

```ts
  .superRefine((s, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
    const sections = new Set<string>();
    for (const [i, section] of s.sections.entries()) {
      if (sections.has(section.id)) issue(["sections", i, "id"], `Section "${section.id}" is declared twice`);
      sections.add(section.id);
    }
    // "Declare at least one setting" is the manifest's: a mode's settings count too (task-modes spec §3).
    checkSettingFields(s.fields, sections, (path, message) => issue(["fields", ...path], message));
  });
```

3. Add, right after `inferSetting`:

```ts
/**
 * The checks every declared setting gets (spec §3 `check`), for the harness's fields and a mode's alike. `sections`
 * is the declared section ids, or null for a mode's settings, which are grouped by their mode. Paths start at the
 * field's name.
 */
export function checkSettingFields(
  fields: Record<string, z.output<typeof settingFieldSchema>>,
  sections: ReadonlySet<string> | null,
  issue: (path: (string | number)[], message: string) => void,
): void {
  for (const [name, f] of Object.entries(fields)) {
    const at = (...rest: (string | number)[]) => [name, ...rest];
    if (RESERVED_SETTINGS.includes(name)) issue(at(), `"${name}" is reserved for mode settings`);
    if (f.section !== undefined) {
      if (sections === null) issue(at("section"), "Mode settings are grouped by their mode: drop section");
      else if (!sections.has(f.section)) issue(at("section"), `Section "${f.section}" is not declared in sections`);
    }
    if (!(f.schema instanceof z.ZodType)) continue;
    const inferred = inferSetting(f.schema);
    if (!CONTROL_KINDS[f.control].includes(inferred.kind ?? "")) {
      issue(at("control"), `The ${f.control} control needs ${CONTROL_TYPES[f.control]} schema`);
      continue;
    }
    // A schema that takes undefined (.default(), .optional()) would let the store fill its own default, not `default`.
    if (f.schema.safeParse(undefined).success) issue(at("schema"), "Give the default in default, not on the schema (no .default() or .optional())");
    else if (f.default === undefined) issue(at("default"), "Give a default value");
    else if (!f.schema.safeParse(f.default).success) issue(at("default"), "The default does not match the schema");
    if (f.options !== undefined) {
      if (!LABELLED.includes(f.control)) issue(at("options"), "Only a segmented, select or toggle control has options");
      else {
        const toggle = f.control === "toggle";
        const values = toggle ? ["true", "false"] : (inferred.options ?? []);
        for (const key of Object.keys(f.options)) {
          if (!values.includes(key)) issue(at("options", key), `"${key}" is not a value of the schema${toggle ? ' (a toggle\'s are "true" and "false")' : ""}`);
        }
      }
    }
    const template = agentText(f.agent);
    if (template === null) continue;
    let fillsValue = false;
    for (const m of template.matchAll(SETTING_PLACEHOLDER)) {
      if (m[1] !== "value" && m[1] !== "value:label") issue(at("agent"), `Unknown placeholder {{${m[1]}}}: use {{value}} or {{value:label}}`);
      else if (m[1] === "value:label" && !LABELLED.includes(f.control)) issue(at("agent"), "{{value:label}} needs a segmented, select or toggle control: use {{value}}");
      else fillsValue = true;
    }
    // An uncapped text would let a value of any length into AGENTS.md or a mode's brief.
    if (fillsValue && f.control === "text" && inferred.max === undefined) issue(at("schema"), "The agent reads this text: cap its length with .max(n)");
  }
}
```

(`agentText` is a function declaration further down the file: hoisted, so the call is fine.)

- [ ] **Step 5: The manifest's `modes`, the actions' `modes` and `defaultMode`, the checks**

In `packages/harness-sdk/src/index.ts`:

1. Replace the imports and re-exports at the top:

```ts
import { CORE_BLOCKS, INPUT_CORE_BLOCKS, RESERVED_BLOCK_NAMES } from "./core-blocks";
import { dataSchema } from "./data";
import { settingsSchema } from "./settings";
```

with:

```ts
import { CORE_BLOCKS, INPUT_CORE_BLOCKS, RESERVED_BLOCK_NAMES } from "./core-blocks";
import { dataSchema } from "./data";
import { DEFAULT_MODE_WORDS, MODE_ID } from "./modes";
import { SETTING_NAME, checkSettingFields, settingFieldSchema, settingsSchema } from "./settings";
```

and add `export * from "./modes";` after `export * from "./settings";`.

2. After `export type Tier = (typeof TIERS)[number];`, add:

```ts
/** `a` is a lower tier than `b` (task-modes spec §5.3: a mode's `minTier` against the task's). */
export const tierBelow = (a: Tier, b: Tier): boolean => TIERS.indexOf(a) < TIERS.indexOf(b);
```

3. In `actionSchema`, after `scope: z.enum(SCOPE_MODES).optional(),`, add:

```ts
  /** The modes a task of this action may work in (task-modes spec §3); absent: none (D0). */
  modes: z.array(z.string().regex(MODE_ID)).min(1).optional(),
  /** How its task starts: one of `modes`, "recommend" (the default) or "ask". Only with `modes`. */
  defaultMode: z.string().min(1).optional(),
```

4. After `export type HarnessAction = z.output<typeof actionSchema>;`, add:

```ts
/** A way the AI works inside a task (task-modes spec §3). The person picks it; the agent may recommend it. */
const modeSchema = z.object({
  label: text.max(80),
  /** One line in the list of modes ("See all modes"). */
  description: text.max(300).optional(),
  /** The mode's brief: a file in the harness folder, filled like an action's prompt ({{language}}). */
  brief: z.string().min(1),
  /** The least tier the mode works well at; absent: any. */
  minTier: z.enum(TIERS).optional(),
  /** What the agent reads to recommend this mode; never shown to the person. */
  recommend: text.max(400).optional(),
  /** The person's knobs for this mode (harness-settings spec §6), drawn in the harness's Settings tab. */
  settings: z.record(z.string().regex(SETTING_NAME), settingFieldSchema).optional(),
});
export type HarnessMode = z.output<typeof modeSchema>;
```

5. In `manifestSchema`, after the `settings: settingsSchema.optional(),` line, add:

```ts
  /** Ways the AI works inside a task, by id (task-modes spec). Absent: none, and nothing changes (D0). */
  modes: z.record(z.string().regex(MODE_ID), modeSchema).default({}),
```

6. At the end of the `superRefine` (after the `saveTo` loop), add:

```ts
  // Modes (task-modes spec §3).
  for (const [id, mode] of Object.entries(m.modes)) {
    if (DEFAULT_MODE_WORDS.includes(id)) ctx.addIssue({ code: "custom", path: ["modes", id], message: `"${id}" is a defaultMode word: use another mode id` });
    if (mode.settings === undefined) continue;
    if (!m.settings) {
      ctx.addIssue({ code: "custom", path: ["modes", id, "settings"], message: "Mode settings are drawn in the harness's Settings tab: declare settings with its tab" });
    }
    checkSettingFields(mode.settings, null, (path, message) => ctx.addIssue({ code: "custom", path: ["modes", id, "settings", ...path], message }));
  }
  for (const [id, a] of Object.entries(m.actions)) {
    if (a.defaultMode !== undefined && !a.modes) {
      ctx.addIssue({ code: "custom", path: ["actions", id, "defaultMode"], message: "Only an action with modes has a defaultMode" });
    }
    if (!a.modes) continue;
    const listed = new Set<string>();
    for (const mode of a.modes) {
      if (!Object.hasOwn(m.modes, mode)) ctx.addIssue({ code: "custom", path: ["actions", id, "modes"], message: `Unknown mode "${mode}"` });
      if (listed.has(mode)) ctx.addIssue({ code: "custom", path: ["actions", id, "modes"], message: `"${mode}" is listed twice` });
      listed.add(mode);
    }
    if (a.defaultMode !== undefined && !DEFAULT_MODE_WORDS.includes(a.defaultMode) && !listed.has(a.defaultMode)) {
      ctx.addIssue({
        code: "custom",
        path: ["actions", id, "defaultMode"],
        message: `"${a.defaultMode}" is not one of this action's modes: use one of them, "recommend" or "ask"`,
      });
    }
  }
  // A Settings tab needs something to draw: its own fields or a mode's (harness-settings spec §3, §6).
  const modeSettings = Object.values(m.modes).some((mode) => Object.keys(mode.settings ?? {}).length > 0);
  if (m.settings && Object.keys(m.settings.fields).length === 0 && !modeSettings) {
    ctx.addIssue({ code: "custom", path: ["settings", "fields"], message: "Declare at least one setting" });
  }
```

7. In `loadHarness`, after `for (const action of Object.values(loaded.actions)) resolveInHarness(loaded, action.prompt);`, add:

```ts
  // So must every mode's brief (task-modes spec §3).
  for (const mode of Object.values(loaded.modes)) resolveInHarness(loaded, mode.brief);
```

- [ ] **Step 6: Run the tests**

Run: `corepack pnpm vitest run packages/harness-sdk/test`
Expected: PASS, `settings.test.ts`'s "no fields at all" case included (the message and path didn't change).

- [ ] **Step 7: Verify and commit**

Run: `corepack pnpm typecheck` and `corepack pnpm test`
Expected: both green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/harness-sdk/src/modes.ts packages/harness-sdk/src/index.ts packages/harness-sdk/src/settings.ts packages/harness-sdk/test/modes.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(sdk): the manifest declares task modes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 2: The `recommend_mode` core block

**Files:**
- Modify: `packages/harness-sdk/src/core-blocks.ts`, `packages/harness-sdk/src/index.ts`
- Test: `packages/harness-sdk/test/modes.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/harness-sdk/test/modes.test.ts` (add `CORE_BLOCKS`, `MODE_CORE_BLOCKS`, `RESERVED_BLOCK_NAMES`, `allBlocks`, `blockToolName`, `defineBlock` and `recommendModeSchema` to the import from `"../src"`):

```ts
describe("the recommend_mode block", () => {
  const withModes = () => defineHarness({ ...base, modes, actions: { study } });

  it("is offered only to a harness with modes (D0), as show_recommend_mode", () => {
    expect(Object.keys(allBlocks(defineHarness(base)))).toEqual(Object.keys(CORE_BLOCKS));
    expect(Object.keys(allBlocks(withModes()))).toEqual([...Object.keys(CORE_BLOCKS), "recommend_mode"]);
    expect(blockToolName("recommend_mode", MODE_CORE_BLOCKS.recommend_mode)).toBe("show_recommend_mode");
    expect(MODE_CORE_BLOCKS.recommend_mode.visible).toBe(true);
  });

  it("checks a recommendation: a mode id, 1 to 3 reasons, at most 2 alternatives", () => {
    const ok = { recommended: "socratic", reasons: ["One key idea"], alternatives: [{ mode: "feynman", why: "You explain it back" }] };
    expect(recommendModeSchema.safeParse(ok).success).toBe(true);
    expect(recommendModeSchema.safeParse({ recommended: "socratic", reasons: ["a"] }).success).toBe(true);
    expect(recommendModeSchema.safeParse({ ...ok, reasons: [] }).success).toBe(false);
    expect(recommendModeSchema.safeParse({ ...ok, reasons: ["a", "b", "c", "d"] }).success).toBe(false);
    expect(recommendModeSchema.safeParse({ ...ok, alternatives: [ok.alternatives[0], ok.alternatives[0], ok.alternatives[0]] }).success).toBe(false);
    expect(recommendModeSchema.safeParse({ ...ok, recommended: "Bad Id" }).success).toBe(false);
  });

  it("its name is reserved for every harness, and so is its tool", () => {
    expect(RESERVED_BLOCK_NAMES).toContain("recommend_mode");
    const block = defineBlock({ description: "x", visible: true, schema: z.object({ a: z.string() }), example: { a: "x" } });
    expect(issues({ ...base, blocks: { recommend_mode: block } })).toEqual(['blocks.recommend_mode: "recommend_mode" is a core block name']);
    expect(issues({ ...base, blocks: { pick: { ...block, tool: "show_recommend_mode" } } })).toEqual([
      'blocks.pick: Tool "show_recommend_mode" is already used by block "recommend_mode"',
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm vitest run packages/harness-sdk/test/modes.test.ts`
Expected: FAIL (`MODE_CORE_BLOCKS` and `recommendModeSchema` are not exported).

- [ ] **Step 3: Add the block**

In `packages/harness-sdk/src/core-blocks.ts`:

1. Add the import: `import { MODE_ID, hasModes } from "./modes";`
2. Before `/** Every core block name, offered or not: no harness block may take one. */`, add:

```ts
/** The agent's recommendation of a mode (task-modes spec §4). The person picks; the app switches. */
export const recommendModeSchema = z.object({
  recommended: z.string().regex(MODE_ID),
  reasons: z.array(z.string().min(1).max(300)).min(1).max(3),
  alternatives: z
    .array(z.object({ mode: z.string().regex(MODE_ID), why: z.string().min(1).max(300) }))
    .max(2)
    .optional(),
});
export type ModeRecommendation = z.infer<typeof recommendModeSchema>;

/** Core blocks only a harness with modes gets (spec §4). Their names are reserved for all. */
export const MODE_CORE_BLOCKS = {
  recommend_mode: defineBlock({
    description:
      "Recommends how to work in this task: `recommended` is one of this task's mode ids, with up to 3 short `reasons`, and up to 2 `alternatives` (`mode`, `why`). The person picks a mode; never switch on your own. Use it when the app asks you to recommend, or when another mode would clearly help now; then end your answer and wait.",
    visible: true,
    schema: recommendModeSchema,
    example: { recommended: "socratic", reasons: ["The topic has one key idea you can discover"], alternatives: [{ mode: "worked", why: "If you prefer to see it solved first" }] },
  }),
} satisfies Record<string, Block>;
```

3. Replace the reserved names and `allBlocks`:

```ts
/** Every core block name, offered or not: no harness block may take one. */
export const RESERVED_BLOCK_NAMES: readonly string[] = [...CORE_BLOCK_NAMES, ...Object.keys(INPUT_CORE_BLOCKS), ...Object.keys(MODE_CORE_BLOCKS)];
```

```ts
/**
 * The core blocks plus the harness's own: what the agent gets as tools. `annotate` only with input blocks (input-blocks
 * D0), `recommend_mode` only with modes (task-modes D0).
 */
export function allBlocks(harness: { blocks: Record<string, Block>; modes?: Record<string, unknown> }): Record<string, Block> {
  return {
    ...CORE_BLOCKS,
    ...(hasInputBlocks(harness.blocks) ? INPUT_CORE_BLOCKS : {}),
    ...(hasModes(harness) ? MODE_CORE_BLOCKS : {}),
    ...harness.blocks,
  };
}
```

4. In `packages/harness-sdk/src/index.ts`, change the core-blocks import to `import { CORE_BLOCKS, INPUT_CORE_BLOCKS, MODE_CORE_BLOCKS, RESERVED_BLOCK_NAMES } from "./core-blocks";` and, in the `superRefine`, the tool map line to:

```ts
  const tools = new Map<string, string>(
    Object.entries({ ...CORE_BLOCKS, ...INPUT_CORE_BLOCKS, ...MODE_CORE_BLOCKS }).map(([name, b]) => [blockToolName(name, b), name]),
  );
```

`modes.ts` imports only a type from `index.ts`, so `core-blocks.ts` importing `modes.ts` adds no runtime cycle.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run packages/harness-sdk/test`
Expected: PASS. `harness.test.ts` and `input.test.ts` still list the same blocks for harnesses without modes (D0).

- [ ] **Step 5: Verify and commit**

Run: `corepack pnpm typecheck` and `corepack pnpm test`
Expected: both green. `packages/runtime/test/runtime.test.ts` (AGENTS.md from `allBlocks(harness)`) and the workspace instructions tests stay green: no fixture declares modes.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/harness-sdk/src/core-blocks.ts packages/harness-sdk/src/index.ts packages/harness-sdk/test/modes.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(sdk): recommend_mode core block for harnesses with modes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 3: Mode settings: keys, storage, values, sentences and the view

**Files:**
- Modify: `packages/harness-sdk/src/settings.ts`
- Test: `packages/harness-sdk/test/mode-settings.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/harness-sdk/test/mode-settings.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  type HarnessInput,
  SETTINGS_COLLECTION,
  dataCollections,
  defineHarness,
  modeSentences,
  modeSettingKey,
  settingRef,
  settingsCollection,
  settingsSentences,
  settingsValues,
  settingsView,
  withSetting,
  z,
} from "../src";

const base: HarnessInput = {
  id: "coach",
  name: "Coach",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Coach" },
  instructions: "./AGENTS.md",
  permissions: { edit: "none", exec: false, web: false },
  blocks: {},
  author: "t",
};
const tone = { schema: z.enum(["patient", "neutral"]), default: "patient", control: "segmented" as const, label: "Tone", agent: "Use a {{value}} tone." };
const questions = {
  schema: z.enum(["few", "many"]),
  default: "few",
  control: "segmented" as const,
  label: "Questions",
  options: { few: "Few", many: "Many" },
  agent: "Ask {{value:label}} questions before explaining.",
};
const steps = { schema: z.number().int().min(1).max(5), default: 3, control: "number" as const, label: "Steps", advanced: true, agent: "Use {{value}} steps." };
const h = defineHarness({
  ...base,
  settings: { tab: "How I learn", fields: { tone } },
  modes: {
    socratic: { label: "Socratic", brief: "s.md", settings: { questions, steps } },
    feynman: { label: "Feynman", brief: "f.md" },
  },
});

describe("mode settings", () => {
  it("are keyed <mode>.<field> and found by key; a top-level name or an unknown key is not a mode setting", () => {
    expect(modeSettingKey("socratic", "questions")).toBe("socratic.questions");
    expect(settingRef(h.settings!, h.modes, "socratic.questions")).toMatchObject({ key: "socratic.questions", mode: "socratic", name: "questions" });
    expect(settingRef(h.settings!, h.modes, "tone")).toMatchObject({ key: "tone", name: "tone" });
    expect(settingRef(h.settings!, h.modes, "tone")).not.toHaveProperty("mode");
    for (const bad of ["feynman.questions", "socratic.nope", "nope", "socratic", "constructor", "socratic.constructor", "a.b.c"]) {
      expect(settingRef(h.settings!, h.modes, bad)).toBeNull();
    }
  });

  it("are stored under modes.<mode>, only when changed; a default removes the key and empty objects go", () => {
    const q = settingRef(h.settings!, h.modes, "socratic.questions")!;
    const t = settingRef(h.settings!, h.modes, "tone")!;
    const one = withSetting({ tone: "neutral" }, q, "many");
    expect(one).toEqual({ tone: "neutral", modes: { socratic: { questions: "many" } } });
    expect(withSetting(one, q, "few")).toEqual({ tone: "neutral" });
    expect(withSetting(null, t, "neutral")).toEqual({ tone: "neutral" });
    expect(withSetting({ tone: "neutral" }, t, "patient")).toEqual({});
  });

  it("read with their defaults under dotted keys; a bad stored value falls back field by field", () => {
    expect(settingsValues(h.settings!, null, h.modes)).toEqual({ tone: "patient", "socratic.questions": "few", "socratic.steps": 3 });
    expect(settingsValues(h.settings!, { modes: { socratic: { questions: "many", steps: 99 } } }, h.modes)).toEqual({
      tone: "patient",
      "socratic.questions": "many",
      "socratic.steps": 3,
    });
    // D0: without modes, exactly as before.
    expect(settingsValues(h.settings!, { tone: "neutral" })).toEqual({ tone: "neutral" });
  });

  it("never reach AGENTS.md; a mode's own sentences are filled for its brief", () => {
    const values = settingsValues(h.settings!, { modes: { socratic: { questions: "many" } } }, h.modes);
    expect(settingsSentences(h.settings!, values)).toEqual(["Use a patient tone."]);
    expect(modeSentences(h.modes, "socratic", values)).toEqual(["Ask Many questions before explaining.", "Use 3 steps."]);
    expect(modeSentences(h.modes, "feynman", values)).toEqual([]);
    expect(modeSentences(h.modes, "nope", values)).toEqual([]);
  });

  it("add a modes key to the settings collection only when some mode has settings (D0)", () => {
    const store = settingsCollection(h.settings!, h.modes);
    expect(store.schema.safeParse({ tone: "neutral", modes: { socratic: { questions: "many" } } }).success).toBe(true);
    expect(store.schema.safeParse({ modes: { socratic: { questions: "lots" } } }).success).toBe(false);
    expect(Object.keys(dataCollections(h))).toEqual([SETTINGS_COLLECTION]);
    const plain = defineHarness({ ...base, settings: { tab: "Mine", fields: { tone } } });
    expect(Object.keys((settingsCollection(plain.settings!, plain.modes).schema as z.ZodObject).shape)).toEqual(["tone"]);
  });

  it("are drawn in one section per mode, after the harness's own", () => {
    const view = settingsView(h.settings!, h.modes);
    expect(view.sections).toEqual([{ id: "mode:socratic", label: "Socratic" }]);
    expect(view.fields.map((f) => [f.name, f.section ?? null, f.mode ?? null])).toEqual([
      ["tone", null, null],
      ["socratic.questions", "mode:socratic", "socratic"],
      ["socratic.steps", "mode:socratic", "socratic"],
    ]);
    expect(view.fields[2]).toMatchObject({ advanced: true, min: 1, max: 5, agent: true });
    // D0: without modes the view is exactly as before.
    expect(settingsView(h.settings!)).toEqual({ tab: "How I learn", sections: [], fields: [view.fields[0]] });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm vitest run packages/harness-sdk/test/mode-settings.test.ts`
Expected: FAIL (`modeSettingKey`, `settingRef`, `withSetting`, `modeSentences` are not exported).

- [ ] **Step 3: Implement**

In `packages/harness-sdk/src/settings.ts`:

1. After `export type SettingField = HarnessSettings["fields"][string];`, add:

```ts
/** What mode settings need of the manifest's modes: their label and settings (task-modes spec §3). */
export type ModesWithSettings = Record<string, { label: string; settings?: Record<string, SettingField> }>;

/** A mode setting's key in values, views and `client.settings.set` (harness-settings spec §6). */
export const modeSettingKey = (mode: string, field: string): string => `${mode}.${field}`;

/** Every mode setting, in manifest order: its key, mode, field name and declaration. */
export function modeSettingFields(modes: ModesWithSettings | undefined): [key: string, mode: string, name: string, field: SettingField][] {
  return Object.entries(modes ?? {}).flatMap(([mode, m]) =>
    Object.entries(m.settings ?? {}).map(([name, f]): [string, string, string, SettingField] => [modeSettingKey(mode, name), mode, name, f]),
  );
}

/** One setting found by its key: a harness field (`tone`) or a mode's (`socratic.questions`). */
export interface SettingRef {
  key: string;
  name: string;
  /** The mode a mode setting belongs to. */
  mode?: string;
  field: SettingField;
}

/** The setting `key` names, or null. Own keys only: `constructor` or `socratic.constructor` find nothing. */
export function settingRef(settings: HarnessSettings, modes: ModesWithSettings | undefined, key: string): SettingRef | null {
  const dot = key.indexOf(".");
  if (dot < 0) return Object.hasOwn(settings.fields, key) ? { key, name: key, field: settings.fields[key] } : null;
  const mode = key.slice(0, dot);
  const name = key.slice(dot + 1);
  const own = modes && Object.hasOwn(modes, mode) ? modes[mode].settings : undefined;
  return own && Object.hasOwn(own, name) ? { key, name, mode, field: own[name] } : null;
}
```

2. Replace `settingsCollection` and `dataCollections` with:

```ts
/**
 * The `settings` collection: app-wide, one record, hidden from the agent (it gets sentences: D3). Its fields are
 * optional: the record holds only what the person changed, and `settingsValues` fills the defaults on read. Mode
 * settings, when a mode has any, sit under `modes.<mode>` (spec §6).
 */
export function settingsCollection(settings: HarnessSettings, modes?: ModesWithSettings): Collection {
  const optional = (fields: Record<string, SettingField>) => Object.fromEntries(Object.entries(fields).map(([name, f]) => [name, f.schema.optional()]));
  const shape: Record<string, z.ZodType> = optional(settings.fields);
  const own = Object.entries(modes ?? {}).filter(([, m]) => Object.keys(m.settings ?? {}).length > 0);
  if (own.length > 0) shape.modes = z.object(Object.fromEntries(own.map(([id, m]) => [id, z.object(optional(m.settings!)).optional()]))).optional();
  return collectionSchema.parse({ scoped: false, single: true, schema: z.object(shape), agent: "none" });
}

/** Every collection the data store keeps: the harness's, plus `settings` when it declares settings (D0: `data` itself). */
export function dataCollections(h: { data: Record<string, Collection>; settings?: HarnessSettings; modes?: ModesWithSettings }): Record<string, Collection> {
  return h.settings ? { ...h.data, [SETTINGS_COLLECTION]: settingsCollection(h.settings, h.modes) } : h.data;
}
```

3. Replace `settingsValues` with:

```ts
/** A field's value from `record`: the stored one when it is valid, else the default (a hand edit falls back field by field). */
function valueIn(record: Record<string, unknown>, name: string, f: SettingField): unknown {
  if (Object.hasOwn(record, name)) {
    const parsed = f.schema.safeParse(record[name]);
    if (parsed.success && parsed.data !== undefined) return parsed.data;
  }
  return structuredClone(f.default);
}

/** Every field's value, by key; mode settings under `<mode>.<field>` when `modes` is given (spec §6). */
export function settingsValues(settings: HarnessSettings, stored: unknown, modes?: ModesWithSettings): Record<string, unknown> {
  const record = isRecord(stored) ? stored : {};
  const values: Record<string, unknown> = Object.fromEntries(Object.entries(settings.fields).map(([name, f]) => [name, valueIn(record, name, f)]));
  const byMode = isRecord(record.modes) ? record.modes : {};
  for (const [key, mode, name, f] of modeSettingFields(modes)) {
    const own = Object.hasOwn(byMode, mode) && isRecord(byMode[mode]) ? byMode[mode] : {};
    values[key] = valueIn(own, name, f);
  }
  return values;
}

/**
 * The stored record with `ref` set to `value`: a value back at its default is removed, and so is a mode's object
 * (and `modes`) left empty. Only what the person changed is stored (spec D2).
 */
export function withSetting(stored: unknown, ref: SettingRef, value: unknown): Record<string, unknown> {
  const record: Record<string, unknown> = isRecord(stored) ? { ...stored } : {};
  const set = (into: Record<string, unknown>) => {
    if (sameSetting(value, ref.field.default)) delete into[ref.name];
    else into[ref.name] = value;
  };
  if (ref.mode === undefined) {
    set(record);
    return record;
  }
  const modes: Record<string, unknown> = isRecord(record.modes) ? { ...record.modes } : {};
  const own: Record<string, unknown> = Object.hasOwn(modes, ref.mode) && isRecord(modes[ref.mode]) ? { ...(modes[ref.mode] as Record<string, unknown>) } : {};
  set(own);
  if (Object.keys(own).length > 0) modes[ref.mode] = own;
  else delete modes[ref.mode];
  if (Object.keys(modes).length > 0) record.modes = modes;
  else delete record.modes;
  return record;
}
```

`sameSetting` and `isRecord` are declared above `settingsValues`; keep `withSetting` below them.

4. After `settingsSentences`, add:

```ts
/** A mode's sentences, appended to its brief when it starts (spec §6): never part of AGENTS.md. */
export function modeSentences(modes: ModesWithSettings | undefined, mode: string, values: Record<string, unknown>): string[] {
  const own = modes && Object.hasOwn(modes, mode) ? (modes[mode].settings ?? {}) : {};
  return Object.entries(own).flatMap(([name, f]) => {
    const key = modeSettingKey(mode, name);
    const sentence = settingSentence(f, Object.hasOwn(values, key) ? values[key] : f.default);
    return sentence ? [sentence] : [];
  });
}
```

5. In `SettingFieldView`, after `section?: string;`, add:

```ts
  /** A mode setting: the mode it belongs to (its `name` is `<mode>.<field>`). */
  mode?: string;
```

6. Replace `settingsView` with:

```ts
function fieldView(name: string, f: SettingField, extra: Pick<SettingFieldView, "section" | "mode"> = {}): SettingFieldView {
  const inferred = inferSetting(f.schema);
  const choice = f.control === "segmented" || f.control === "select";
  const section = extra.section ?? f.section;
  return {
    name,
    control: f.control,
    label: f.label,
    ...(f.help ? { help: f.help } : {}),
    ...(f.unit ? { unit: f.unit } : {}),
    ...(section ? { section } : {}),
    ...(extra.mode ? { mode: extra.mode } : {}),
    ...(f.advanced ? { advanced: true as const } : {}),
    default: structuredClone(f.default),
    ...(choice ? { options: (inferred.options ?? []).map((value) => ({ value, label: labelOf(f, value) })) } : {}),
    ...(inferred.min !== undefined ? { min: inferred.min } : {}),
    ...(inferred.max !== undefined ? { max: inferred.max } : {}),
    ...(agentText(f.agent) !== null ? { agent: true as const } : {}),
  };
}

/** The tab's data: the harness's fields, then one section per mode with settings (`mode:<id>`, spec §6). */
export function settingsView(settings: HarnessSettings, modes?: ModesWithSettings): SettingsView {
  const own = Object.entries(modes ?? {}).filter(([, m]) => Object.keys(m.settings ?? {}).length > 0);
  return {
    tab: settings.tab,
    sections: [...settings.sections.map((s) => ({ id: s.id, label: s.label })), ...own.map(([id, m]) => ({ id: `mode:${id}`, label: m.label }))],
    fields: [
      ...Object.entries(settings.fields).map(([name, f]) => fieldView(name, f)),
      ...modeSettingFields(modes).map(([key, mode, , f]) => fieldView(key, f, { section: `mode:${mode}`, mode })),
    ],
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run packages/harness-sdk/test`
Expected: PASS, `settings.test.ts` unchanged and green (D0).

- [ ] **Step 5: Verify and commit**

Run: `corepack pnpm typecheck` and `corepack pnpm test`
Expected: both green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/harness-sdk/src/settings.ts packages/harness-sdk/test/mode-settings.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(sdk): mode settings keyed per mode, stored under modes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

## Phase 2 — Task state, prompts and turns (spec §9 slices 1 and 3: the main process)

### Task 4: The prompts: switch, start in a mode, recommend, close, resume

**Files:**
- Modify: `packages/shell/src/main/task-prompts.ts`
- Test: `packages/shell/test/task-prompts.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/shell/test/task-prompts.test.ts` (add `CLOSE_PROMPT`, `closePrompt`, `modePrompt`, `modeSection`, `recommendSection` and `resumeMessage` to its import from `"../src/main/task-prompts"` if they aren't there yet):

```ts
describe("mode prompts (task-modes spec §4, §5.4, §6)", () => {
  const feynman = { label: "Feynman", brief: "Explain it back in {{language}}.\n\n{{notesIndex}}", settings: ["Use 3 steps."] };

  it("the switch: the mode's name, its filled brief, its settings, then go on", () => {
    expect(modePrompt(feynman, { language: "es" })).toBe(
      [
        'From now on work in the mode "Feynman". Keep everything decided so far in this conversation.',
        "Explain it back in Spanish.",
        "- Use 3 steps.",
        "Then continue with the person in this mode.",
      ].join("\n\n"),
    );
  });

  it("the switch carries the last checkpoint's summary when there is one (spec §10.1); a label is never filled again", () => {
    const text = modePrompt({ label: "A $& {{language}}", brief: "Go.", settings: [] }, { language: "en", soFar: ["Halves make a whole.", "Thirds too."] });
    expect(text).toBe(
      [
        'From now on work in the mode "A $& {{language}}". Keep everything decided so far in this conversation.',
        "What is clear so far (the last checkpoint): Halves make a whole. Thirds too.",
        "Go.",
        "Then continue with the person in this mode.",
      ].join("\n\n"),
    );
  });

  it("a task that starts or resumes in a mode gets its section", () => {
    expect(modeSection(feynman, "en")).toBe(["## Mode: Feynman", "Work in this mode.", "Explain it back in English.", "- Use 3 steps."].join("\n\n"));
    expect(modeSection({ ...feynman, settings: [] }, "en")).toBe(["## Mode: Feynman", "Work in this mode.", "Explain it back in English."].join("\n\n"));
  });

  it("the first message asks for a recommendation with the modes' hints", () => {
    expect(recommendSection([{ id: "socratic", label: "Socratic", recommend: "One key idea to discover." }, { id: "worked", label: "Worked examples" }])).toBe(
      [
        "## How to work",
        "Before you start the work, recommend how to work in this task: call `show_recommend_mode` with the mode that fits best, up to 3 short reasons and up to 2 alternatives, then end your answer and wait for the person's pick. Do not call `show_choices` in this answer.",
        "- `socratic` (Socratic): One key idea to discover.\n- `worked` (Worked examples)",
      ].join("\n\n"),
    );
  });

  it("the closing turn lists the modes used; without any, it is CLOSE_PROMPT exactly (D0)", () => {
    expect(closePrompt([])).toBe(CLOSE_PROMPT);
    expect(closePrompt(["Socratic", "Feynman"])).toBe(`${CLOSE_PROMPT} Also list the modes used (Socratic, Feynman) and what each was good for, as summary points.`);
  });

  it("a resumed session gets the mode's section after the action's brief; without one, as before (D0)", () => {
    const vars = { language: "en" as const, notesIndex: "", brief: "# Task: study", message: "Hi" };
    const section = modeSection(feynman, "en");
    const line = fillPrompt(RESUME_PROMPT, { language: "en", notesIndex: "" });
    expect(resumeMessage({ ...vars, mode: section })).toBe(["# Task: study", section, line, "## The person's message\nHi"].join("\n\n"));
    expect(resumeMessage(vars)).toBe(["# Task: study", line, "## The person's message\nHi"].join("\n\n"));
  });
});
```

(Add `RESUME_PROMPT` and `fillPrompt` to the same import.)

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm vitest run packages/shell/test/task-prompts.test.ts`
Expected: FAIL (`modePrompt` and the others are not exported).

- [ ] **Step 3: Implement**

In `packages/shell/src/main/task-prompts.ts`:

1. After `CLOSE_PROMPT`, add:

```ts
/** What the closing turn adds when the task used modes (task-modes spec §6): the note's summary says what each was good for. */
export const CLOSE_MODES = "Also list the modes used ({{modes}}) and what each was good for, as summary points.";

/** The closing turn's prompt: CLOSE_PROMPT, plus the modes used (their labels) when there were any (D0: exactly CLOSE_PROMPT). */
export function closePrompt(modes: readonly string[]): string {
  return modes.length === 0 ? CLOSE_PROMPT : `${CLOSE_PROMPT} ${CLOSE_MODES.replace("{{modes}}", () => modes.join(", "))}`;
}
```

2. At the end of the file, add:

```ts
/** A mode as a prompt carries it: its label, its brief (the file's text, not filled yet) and its settings' sentences. */
export interface ModeText {
  label: string;
  brief: string;
  settings: readonly string[];
}

/** The switch's first line (task-modes spec §5.4); `{{label}}` is the mode's label. */
export const MODE_PROMPT = 'From now on work in the mode "{{label}}". Keep everything decided so far in this conversation.';
/** The switch's last line. */
export const MODE_END = "Then continue with the person in this mode.";
/** The first message's ask for a recommendation (spec §4), with the action's modes after it. */
export const RECOMMEND_PROMPT =
  "Before you start the work, recommend how to work in this task: call `show_recommend_mode` with the mode that fits best, up to 3 short reasons and up to 2 alternatives, then end your answer and wait for the person's pick. Do not call `show_choices` in this answer.";

/** A mode's brief filled like an action's (`{{language}}`); it never gets the notes index: the session has it. */
const modeBrief = (brief: string, language: Language): string => fillPrompt(brief, { language, notesIndex: "" });
const settingLines = (settings: readonly string[]): string[] => (settings.length > 0 ? [settings.map((s) => `- ${s}`).join("\n")] : []);

/**
 * The switch's message (spec §5.4): one turn in the same session with the new mode's brief and settings. `soFar`: the
 * last checkpoint note's summary, when the task has one (spec §10.1). Inserted text is never filled again.
 */
export function modePrompt(mode: ModeText, vars: { language: Language; soFar?: readonly string[] }): string {
  return [
    MODE_PROMPT.replace("{{label}}", () => mode.label),
    ...(vars.soFar && vars.soFar.length > 0 ? [`What is clear so far (the last checkpoint): ${vars.soFar.join(" ")}`] : []),
    modeBrief(mode.brief, vars.language),
    ...settingLines(mode.settings),
    MODE_END,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** What a task that starts (or resumes) in a mode carries after the action's brief (spec §3 `defaultMode`, §6). */
export function modeSection(mode: ModeText, language: Language): string {
  return [`## Mode: ${mode.label}`, "Work in this mode.", modeBrief(mode.brief, language), ...settingLines(mode.settings)].filter(Boolean).join("\n\n");
}

/** The first message's ask for a recommendation (spec §4): the action's modes with their hints, in this message only. */
export function recommendSection(modes: readonly { id: string; label: string; recommend?: string }[]): string {
  return ["## How to work", RECOMMEND_PROMPT, modes.map((m) => `- \`${m.id}\` (${m.label})${m.recommend ? `: ${m.recommend}` : ""}`).join("\n")].join("\n\n");
}
```

3. In `resumeMessage`, add `mode?: string;` to the `vars` type (doc: `/** The current mode's section (modeSection), after the action's brief (task-modes spec §6). */`) and change the `head` for an action:

```ts
  const head =
    vars.brief !== undefined
      ? [fillPrompt(vars.brief, { language: vars.language, notesIndex: vars.notesIndex }), ...(vars.mode ? [vars.mode] : []), line]
      : [line, ...(vars.notesIndex ? [vars.notesIndex] : []), ...(question ? [question] : [])];
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run packages/shell/test/task-prompts.test.ts`
Expected: PASS, the existing cases unchanged.

- [ ] **Step 5: Verify and commit**

Run: `corepack pnpm typecheck` and `corepack pnpm test`
Expected: both green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/shell/src/main/task-prompts.ts packages/shell/test/task-prompts.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(shell): prompts for mode switches, starts, recommendations and closing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 5: Task state and the note keep the modes

**Files:**
- Modify: `packages/shell/src/main/task-store.ts`, `packages/workspace/src/notes.ts`
- Test: `packages/shell/test/task-store.test.ts`, `packages/workspace/test/notes.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/shell/test/task-store.test.ts` (add `fs`, `os`, `path` and `TaskStore` imports if the file lacks them):

```ts
describe("TaskStore: task modes (task-modes spec §5.5, §6)", () => {
  const write = (folder: string, current: Record<string, unknown>) => {
    const file = path.join(folder, ".harness", "tasks.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 1, actions: {}, current: { id: "t1", status: "waiting", startedAt: "", turns: 1, ...current } }));
  };

  it("keeps a well-formed mode, the modes used (distinct, in order) and belowMinTier", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "hh-modes-store-"));
    try {
      write(folder, { mode: "socratic", modes: ["socratic", "feynman", "socratic", "Bad Id", 3], belowMinTier: true });
      expect((await new TaskStore(folder).load()).current).toMatchObject({ mode: "socratic", modes: ["socratic", "feynman"], belowMinTier: true });
      write(folder, { mode: "../x", modes: "socratic", belowMinTier: "yes" });
      const bad = (await new TaskStore(folder).load()).current;
      expect(bad).not.toHaveProperty("mode");
      expect(bad).not.toHaveProperty("modes");
      expect(bad).not.toHaveProperty("belowMinTier");
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });

  it("drops a mode the manifest no longer declares; belowMinTier goes with its mode", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "hh-modes-store-"));
    try {
      write(folder, { mode: "socratic", modes: ["socratic", "feynman"], belowMinTier: true });
      const current = (await new TaskStore(folder, { modes: ["feynman"] }).load()).current;
      expect(current).toMatchObject({ modes: ["feynman"] });
      expect(current).not.toHaveProperty("mode");
      expect(current).not.toHaveProperty("belowMinTier");
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });

  it("D0: a task without modes reads with no mode fields", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "hh-modes-store-"));
    try {
      write(folder, {});
      expect((await new TaskStore(folder).load()).current).toEqual({ id: "t1", status: "waiting", startedAt: "", turns: 1 });
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});
```

In `packages/workspace/test/notes.test.ts`, inside its `describe` for `renderNote` (or a new `describe("renderNote: modes", …)`), add:

```ts
  it("writes the modes a task used into the front matter; none, no line (task-modes D0)", () => {
    const text = renderNote(note, { action: "study", date: "d", engine: "claude", modes: ["socratic", "feynman"] });
    expect(text).toContain('engine: "claude"\nmodes: ["socratic","feynman"]\nfiles: ');
    expect(renderNote(note, { date: "d", engine: "claude" })).not.toContain("modes:");
    expect(parseNote("x", text)?.summary).toEqual(note.summary);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `corepack pnpm vitest run packages/shell/test/task-store.test.ts packages/workspace/test/notes.test.ts`
Expected: FAIL (the mode fields are dropped; `TaskStore` takes one argument; `NoteMeta` has no `modes`).

- [ ] **Step 3: Implement the task state**

In `packages/shell/src/main/task-store.ts`:

1. Change the sdk import to `import { BLOCK_ID, MODE_ID } from "@humanharness/harness-sdk";`.
2. In `CurrentTask`, after `pendingInput?: PendingInput;`, add:

```ts
  /** The mode the task works in now (task-modes spec §5.5). Absent: none picked yet, or a harness without modes (D0). */
  mode?: string;
  /** Every mode the task used, in first-use order: the closing note lists them. */
  modes?: string[];
  /** The task runs below its mode's `minTier`: the person chose to continue (spec §5.3). */
  belowMinTier?: true;
```

3. After `QUESTION_MAX`'s `keptQuestion`, add:

```ts
/** How many modes tasks.json keeps for a task: a bound on a hand-edited file. */
export const MODES_MAX = 50;
```

4. Change `function cleanCurrent(c: unknown): CurrentTask | null {` to `function cleanCurrent(c: unknown, known?: ReadonlySet<string>): CurrentTask | null {`, and after the `ctx` line add:

```ts
  // A mode the manifest no longer declares is dropped (task-modes spec §6); `known` absent: the shape alone.
  const isMode = (v: unknown): v is string => typeof v === "string" && MODE_ID.test(v) && (!known || known.has(v));
  const mode = isMode(c.mode) ? c.mode : undefined;
  const modes = Array.isArray(c.modes) ? [...new Set(c.modes.filter(isMode))].slice(0, MODES_MAX) : [];
```

and at the end of the returned object (after the `pendingInput` spread):

```ts
    ...(mode ? { mode } : {}),
    ...(modes.length > 0 ? { modes } : {}),
    ...(mode && c.belowMinTier === true ? { belowMinTier: true as const } : {}),
```

5. Change `function clean(raw: unknown): TasksFile {` to `function clean(raw: unknown, known?: ReadonlySet<string>): TasksFile {` and its `current: cleanCurrent(raw.current),` to `current: cleanCurrent(raw.current, known),`.
6. In `TaskStore`, replace the field and constructor with:

```ts
  readonly file: string;
  /** The manifest's mode ids, when given: a mode tasks.json names that isn't one of them is dropped. */
  private readonly known?: ReadonlySet<string>;

  constructor(folder: string, opts: { modes?: readonly string[] } = {}) {
    this.file = tasksFile(folder);
    if (opts.modes) this.known = new Set(opts.modes);
  }
```

and in `load`, `return clean(raw);` becomes `return clean(raw, this.known);`.

- [ ] **Step 4: Implement the note's modes**

In `packages/workspace/src/notes.ts`:

1. In `NoteMeta`, after `engine: string;`, add:

```ts
  /** The modes the task used, in first-use order (task-modes spec §6). Absent without modes (D0). */
  modes?: string[];
```

2. In `renderNote`, after the `engine:` line, add:

```ts
    ...(meta.modes && meta.modes.length > 0 ? [`modes: ${JSON.stringify(meta.modes)}`] : []),
```

- [ ] **Step 5: Run the tests**

Run: `corepack pnpm vitest run packages/shell/test/task-store.test.ts packages/workspace/test/notes.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify and commit**

Run: `corepack pnpm typecheck` and `corepack pnpm test`
Expected: both green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/shell/src/main/task-store.ts packages/shell/test/task-store.test.ts packages/workspace/src/notes.ts packages/workspace/test/notes.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(shell): tasks.json and notes keep the task's modes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 6: Turns carry the mode: usage.jsonl and the switch's system line

**Files:**
- Modify: `packages/shell/src/main/usage-log.ts`, `packages/shell/src/main/turn-controller.ts`, `packages/ui/src/client.ts`
- Test: `packages/shell/test/usage-log.test.ts`, `packages/shell/test/turn-controller.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/shell/test/usage-log.test.ts`:

```ts
describe("usage.jsonl: the task's mode (task-modes spec §5.5)", () => {
  const entry: ChatEntry = {
    id: "e",
    role: "assistant",
    text: "",
    blocks: [],
    activities: [],
    at: "t",
    usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
  };
  it("every line of a task in a mode carries it; none without (D0)", () => {
    expect(usageRecord(entry, "claude", { task: "t1", action: "study", mode: "socratic", phase: "close" })).toMatchObject({ mode: "socratic", phase: "close" });
    expect(usageRecord(entry, "claude", { task: "t1" })).not.toHaveProperty("mode");
    expect(compactionRecord("claude", { task: "t1", mode: "feynman" }, "t")).toMatchObject({ kind: "compaction", mode: "feynman" });
  });
});
```

Append to `packages/shell/test/turn-controller.test.ts`:

```ts
describe("TurnController: modes (task-modes spec §5.4, §5.5)", () => {
  function modeSetup() {
    const rt = fakeRuntime();
    const entries: ChatEntry[] = [];
    const metas: UsageMeta[] = [];
    const controller = new TurnController({
      ensureRuntime: async () => rt.runtime,
      chatLog: async () => ({ append: async (e: ChatEntry) => void entries.push(e) }),
      stateBlocks: () => new Set(),
      emit: () => {},
      recordUsage: async (_entry, meta) => void metas.push(meta),
    });
    return { rt, controller, entries, metas };
  }

  it("a switch's user entry is a system line naming the mode; usage carries the turn's mode", async () => {
    const t = modeSetup();
    const sent = t.controller.send("From now on work in the mode…", {
      task: "t1",
      action: "study",
      followUp: true,
      display: "Switched to Feynman",
      mode: "feynman",
      modeSwitch: true,
    });
    await vi.waitFor(() => expect(t.rt.send).toHaveBeenCalled());
    t.rt.finish([{ type: "done", ok: true }]);
    await sent;
    await t.controller.flush();
    expect(t.entries[0]).toMatchObject({ role: "user", text: "Switched to Feynman", mode: "feynman", task: "t1" });
    expect(t.metas[0]).toMatchObject({ task: "t1", mode: "feynman" });
  });

  it("a turn in a mode that isn't a switch: the mode in usage only; D0 without one", async () => {
    const t = modeSetup();
    const sent = t.controller.send("Go on", { task: "t1", followUp: true, mode: "feynman" });
    await vi.waitFor(() => expect(t.rt.send).toHaveBeenCalled());
    t.rt.finish([{ type: "done", ok: true }]);
    await sent;
    await t.controller.flush();
    expect(t.entries[0]).not.toHaveProperty("mode");
    expect(t.metas[0]).toMatchObject({ mode: "feynman" });

    const plain = modeSetup();
    const again = plain.controller.send("Go on", { task: "t1", followUp: true });
    await vi.waitFor(() => expect(plain.rt.send).toHaveBeenCalled());
    plain.rt.finish([{ type: "done", ok: true }]);
    await again;
    await plain.controller.flush();
    expect(plain.entries[0]).not.toHaveProperty("mode");
    expect(plain.metas[0]).not.toHaveProperty("mode");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `corepack pnpm vitest run packages/shell/test/usage-log.test.ts packages/shell/test/turn-controller.test.ts`
Expected: FAIL (no `mode` on records, metas or entries; type errors on `mode`/`modeSwitch`).

- [ ] **Step 3: Implement**

`packages/ui/src/client.ts`, in `ChatEntry`, after `task?: string;`, add:

```ts
  /** A mode switch the person picked (task-modes spec §5.4): this user entry is a system line, and this is the mode's id. */
  mode?: string;
```

`packages/shell/src/main/usage-log.ts`:
- In `UsageMeta`, after `scope?: string;`, add:

```ts
  /** The task's mode while the turn ran (task-modes spec §5.5). Absent without one. */
  mode?: string;
```

- In `UsageRecord`, after `scope?: string;`, add the same field with the same comment.
- In `metaFields`, after the `scope` spread, add `...(meta.mode ? { mode: meta.mode } : {}),`.

`packages/shell/src/main/turn-controller.ts`:
- In `TurnOptions`, after `skipUserEntry?: boolean;`, add:

```ts
  /** The task's mode while this turn runs: usage.jsonl records it (task-modes spec §5.5). */
  mode?: string;
  /** The person picked `mode`: the chat's user entry is a system line naming it, never their message (spec §5.4). */
  modeSwitch?: boolean;
```

- In `run`, add `mode, modeSwitch` to the destructured options.
- In the user entry written when `!quiet && !skipUserEntry`, after the `task` spread, add `...(modeSwitch && mode ? { mode } : {}),`.
- In `meta`, after the `scope` spread, add `...(mode ? { mode } : {}),`.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run packages/shell/test/usage-log.test.ts packages/shell/test/turn-controller.test.ts`
Expected: PASS, the existing cases unchanged (D0).

- [ ] **Step 5: Verify and commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test` and `corepack pnpm app:build`
Expected: all green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/shell/src/main/usage-log.ts packages/shell/src/main/turn-controller.ts packages/ui/src/client.ts packages/shell/test/usage-log.test.ts packages/shell/test/turn-controller.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(shell): turns record the task's mode; a switch is a system line

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 7: The tier a task counts as, and the floor a mode sets

**Files:**
- Modify: `packages/shell/src/main/models.ts`
- Test: `packages/shell/test/models.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/shell/test/models.test.ts` (add `nearestTier` and `resolveProfile` to its import from `"../src/main/models"` if needed):

```ts
describe("tiers for modes (task-modes spec §5.3)", () => {
  const custom = (model: string | undefined, effort: "low" | "medium" | "high") => ({ engine: "claude", tier: "custom" as const, ...(model ? { model } : {}), effort, cap: 200_000 });

  it("a tier profile counts as its tier; a custom one as the tier whose model it runs, else by its effort", () => {
    expect(nearestTier({ engine: "claude", tier: "light", model: "haiku", effort: "low", cap: 100_000 }, {})).toBe("light");
    expect(nearestTier(custom("opus", "low"), {})).toBe("deep");
    expect(nearestTier(custom("sonnet", "high"), {})).toBe("standard");
    // The person's own table counts: their deep tier runs sonnet here.
    expect(nearestTier(custom("sonnet", "high"), { tiers: { claude: { deep: { model: "sonnet", effort: "high", cap: 400_000 } } } })).toBe("deep");
    expect(nearestTier(custom("some-model", "low"), {})).toBe("light");
    expect(nearestTier(custom(undefined, "medium"), {})).toBe("standard");
    expect(nearestTier(custom("some-model", "max"), {})).toBe("deep");
  });

  it("a floor raises a lower tier, never lowers a higher one, and leaves a custom choice alone", () => {
    expect(resolveProfile({ engine: "claude", action: "study", models: {}, floor: "deep" })).toMatchObject({ tier: "deep", model: "opus" });
    expect(resolveProfile({ engine: "claude", action: "study", manifestTier: "deep", models: {}, floor: "standard" })).toMatchObject({ tier: "deep" });
    expect(resolveProfile({ engine: "claude", action: "study", models: { tasks: { study: "light" } }, floor: "standard" })).toMatchObject({ tier: "standard" });
    const own = { tasks: { study: { custom: { engine: "claude", model: "haiku", effort: "low" as const, cap: 100_000 } } } };
    expect(resolveProfile({ engine: "claude", action: "study", models: own, floor: "deep" })).toMatchObject({ tier: "custom", model: "haiku" });
    // No floor: exactly as before.
    expect(resolveProfile({ engine: "claude", action: "study", models: {} })).toMatchObject({ tier: "standard", model: "sonnet" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm vitest run packages/shell/test/models.test.ts`
Expected: FAIL (`nearestTier` is not exported; `floor` is ignored).

- [ ] **Step 3: Implement**

In `packages/shell/src/main/models.ts`:

1. Change the sdk import to `import { TIERS, type Tier, tierBelow } from "@humanharness/harness-sdk";`.
2. Replace `resolveProfile` with:

```ts
/**
 * The task's profile (spec §5): the user's custom setting for this engine, else the user's tier for the
 * task, else the manifest's, else "standard", through the user's table, else the core's. `floor` (a mode's
 * `minTier`, task-modes spec §5.3) raises a lower tier to it and never lowers one; a custom setting stays.
 */
export function resolveProfile(o: { engine: string; action?: string; manifestTier?: Tier; models: ModelsConfig; floor?: Tier }): ModelProfile {
  const choice = o.models.tasks?.[taskKey(o.action)];
  if (typeof choice === "object" && choice.custom.engine === o.engine) {
    const { engine: _engine, ...spec } = choice.custom;
    return { engine: o.engine, tier: "custom", ...spec };
  }
  const chosen: Tier = typeof choice === "string" ? choice : (o.manifestTier ?? "standard");
  const tier = o.floor !== undefined && tierBelow(chosen, o.floor) ? o.floor : chosen;
  return { engine: o.engine, tier, ...tierSpec(o.engine, tier, o.models) };
}

/**
 * The tier a profile counts as (task-modes spec §5.3): its own; a custom one, the highest tier whose model it runs on
 * this engine (the user's table, else the core's), else by its effort (low → light, medium → standard, more → deep).
 */
export function nearestTier(p: ModelProfile, models: ModelsConfig): Tier {
  if (p.tier !== "custom") return p.tier;
  if (p.model !== undefined) {
    for (const tier of [...TIERS].reverse()) if (tierSpec(p.engine, tier, models).model === p.model) return tier;
  }
  return p.effort === "low" ? "light" : p.effort === "medium" ? "standard" : "deep";
}
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run packages/shell/test/models.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify and commit**

Run: `corepack pnpm typecheck` and `corepack pnpm test`
Expected: both green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/shell/src/main/models.ts packages/shell/test/models.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(shell): nearest tier of a profile and a tier floor for modes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 8: A task starts in a mode or asks for a recommendation; the close, the note, the resume and the view know its modes

**Files:**
- Modify: `packages/shell/src/main/task-manager.ts`, `packages/ui/src/client.ts`
- Test: `packages/shell/test/task-manager-modes.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/shell/test/task-manager-modes.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { ModelProfile } from "@humanharness/engines";
import type { SavedNote, Tier } from "@humanharness/harness-sdk";
import type { Event } from "@humanharness/runtime";
import type { TaskView } from "@humanharness/ui/client";
import type { Note, NoteMeta } from "@humanharness/workspace";
import { TaskManager } from "../src/main/task-manager";
import { CLOSE_PROMPT, closePrompt, modePrompt, modeSection, recommendSection, resumeMessage } from "../src/main/task-prompts";
import { type TasksFile, emptyTasks } from "../src/main/task-store";
import type { TurnOptions } from "../src/main/turn-controller";

const ok: Event = { type: "done", ok: true };
const NOW = "2026-10-26T10:00:00.000Z";
const NOTE: SavedNote = { title: "Halves", summary: ["Two halves make a whole."], decisions: [], files: [], open: [] };
const saveNote: Event = { type: "block", name: "save_note", data: NOTE };
const MODES = {
  socratic: { label: "Socratic", recommend: "One key idea to discover." },
  feynman: { label: "Feynman" },
  worked: { label: "Worked examples", minTier: "deep" as const },
};
const profileOf = (tier: Tier): ModelProfile => ({ engine: "claude", tier, model: tier === "deep" ? "opus" : tier === "light" ? "haiku" : "sonnet", effort: "medium", cap: 200_000 });
const brief = (mode: string) => `Brief of ${mode}, in {{language}}.`;

/** A task manager over memory, for a harness whose `study` action has three modes and whose `quiz` has none. */
export function setup(opts: { script?: Event[][]; state?: TasksFile; modes?: false; defaultMode?: string; notes?: Note[]; gate?: Promise<void> } = {}) {
  let state = opts.state ?? emptyTasks();
  const script = [...(opts.script ?? [])];
  const turns: { message: string; options: TurnOptions }[] = [];
  const views: TaskView[] = [];
  const written: { slug: string; note: SavedNote; meta: NoteMeta }[] = [];
  const floors: (Tier | undefined)[] = [];
  let busy = false;
  let gate = opts.gate;
  let n = 0;
  const manager = new TaskManager({
    store: {
      load: async () => structuredClone(state),
      save: async (s) => {
        state = structuredClone(s);
      },
    },
    turns: {
      isBusy: () => busy,
      cancel: () => {},
      send: async (message, options) => {
        busy = true;
        turns.push({ message, options });
        const g = gate;
        gate = undefined;
        await g;
        for (const e of script.shift() ?? [ok]) options.onEvent?.(e);
        busy = false;
      },
    },
    actions: {
      study: { label: "Study", modes: ["socratic", "feynman", "worked"], ...(opts.defaultMode ? { defaultMode: opts.defaultMode } : {}) },
      quiz: { label: "Quiz" },
    },
    path: ["study", "quiz"],
    readPrompt: async (action) => `# Task: ${action}\n\n{{notesIndex}}`,
    language: async () => "en",
    engine: async () => "claude",
    notes: async () => opts.notes ?? [],
    writeNote: async (slug, note, meta) => void written.push({ slug, note, meta }),
    endSession: async () => {},
    changed: (v) => views.push(v),
    profileFor: async (_action, floor) => {
      floors.push(floor);
      return profileOf(floor ?? "standard");
    },
    ...(opts.modes === false
      ? {}
      : {
          modes: MODES,
          readModeBrief: async (mode: string) => brief(mode),
          modeSettings: async (mode: string) => (mode === "socratic" ? ["Ask many questions before explaining."] : []),
          tierOf: async (p: ModelProfile) => (p.tier === "custom" ? "standard" : p.tier),
        }),
    now: () => new Date(NOW),
    newId: () => `t${++n}`,
  });
  return { manager, turns, views, written, floors, state: () => state };
}

const socratic = { label: "Socratic", brief: brief("socratic"), settings: ["Ask many questions before explaining."] };

describe("TaskManager: how a task starts (task-modes spec §3 defaultMode, §4)", () => {
  it("D0: an action without modes, or a harness without them, starts exactly as before", async () => {
    const t = setup();
    await t.manager.start("quiz");
    expect(t.turns[0].message).toBe("# Task: quiz");
    expect(t.turns[0].options).not.toHaveProperty("mode");
    for (const key of ["mode", "modes", "belowMinTier"]) expect(t.state().current).not.toHaveProperty(key);
    expect(t.views.at(-1)?.current).toEqual({ id: "t1", action: "quiz", status: "waiting" });
    const plain = setup({ modes: false });
    await plain.manager.start("study");
    expect(plain.turns[0].message).toBe("# Task: study");
    expect(plain.views.at(-1)?.current).toEqual({ id: "t1", action: "study", status: "waiting" });
  });

  it("recommend (the default): the first message lists the action's modes with their hints, that message only", async () => {
    const t = setup();
    await t.manager.start("study");
    await t.manager.ask("Go on");
    expect(t.turns[0].message).toBe(
      `# Task: study\n\n${recommendSection([
        { id: "socratic", label: "Socratic", recommend: "One key idea to discover." },
        { id: "feynman", label: "Feynman" },
        { id: "worked", label: "Worked examples" },
      ])}`,
    );
    expect(t.turns[1].message).toBe("Go on");
    expect(t.state().current).not.toHaveProperty("mode");
    expect(t.views.at(-1)?.current).toEqual({ id: "t1", action: "study", status: "waiting", tier: "standard" });
  });

  it("a mode id as defaultMode: its section after the action's brief; the task and its turns carry the mode", async () => {
    const t = setup({ defaultMode: "socratic" });
    await t.manager.start("study");
    await t.manager.ask("Go on");
    expect(t.turns[0].message).toBe(`# Task: study\n\n${modeSection(socratic, "en")}`);
    expect(t.turns[0].message).toContain("Brief of socratic, in English.");
    expect(t.turns[0].options.mode).toBe("socratic");
    expect(t.turns[1].options.mode).toBe("socratic");
    expect(t.state().current).toMatchObject({ mode: "socratic", modes: ["socratic"] });
    expect(t.views.at(-1)?.current).toMatchObject({ mode: "socratic", modes: ["socratic"], tier: "standard" });
  });

  it("an explicit mode wins; 'ask' with none picked falls back to a recommendation; an unknown one is refused before anything closes", async () => {
    const t = setup({ defaultMode: "ask" });
    await t.manager.start("study");
    expect(t.turns[0].message).toContain("## How to work");
    await t.manager.start("study", undefined, undefined, "feynman");
    expect(t.turns.at(-1)!.message).toBe(`# Task: study\n\n${modeSection({ label: "Feynman", brief: brief("feynman"), settings: [] }, "en")}`);
    const before = t.turns.length;
    await expect(t.manager.start("study", undefined, undefined, "nope")).rejects.toThrow("Unknown mode");
    await expect(t.manager.start("quiz", undefined, undefined, "socratic")).rejects.toThrow("Unknown mode");
    expect(t.turns).toHaveLength(before);
    expect(t.state().current?.mode).toBe("feynman");
  });

  it("a task that starts in a mode above its tier starts anyway, marked below", async () => {
    const t = setup({ defaultMode: "worked" });
    await t.manager.start("study");
    expect(t.state().current).toMatchObject({ mode: "worked", belowMinTier: true });
    expect(t.views.at(-1)?.current).toMatchObject({ mode: "worked", tier: "standard", belowMinTier: true });
  });

  it("the closing turn lists the modes used and the note keeps their ids; D0: CLOSE_PROMPT and no modes", async () => {
    const t = setup({ defaultMode: "socratic", script: [[ok], [saveNote, ok], [ok], [saveNote, ok]] });
    await t.manager.start("study");
    await t.manager.finish();
    expect(t.turns[1].message).toBe(closePrompt(["Socratic"]));
    expect(t.turns[1].options).toMatchObject({ phase: "close", mode: "socratic" });
    expect(t.written[0].meta).toEqual({ action: "study", date: NOW, engine: "claude", modes: ["socratic"] });
    await t.manager.start("quiz");
    await t.manager.finish();
    expect(t.turns[3].message).toBe(CLOSE_PROMPT);
    expect(t.written[1].meta).toEqual({ action: "quiz", date: NOW, engine: "claude" });
  });

  it("a resumed session comes back in the same mode", async () => {
    const current = { id: "t1", action: "study", status: "waiting" as const, startedAt: "", turns: 2, mode: "feynman", modes: ["feynman"], resume: true as const };
    const t = setup({ state: { version: 1, actions: {}, current } });
    await t.manager.ask("Hi");
    const section = modeSection({ label: "Feynman", brief: brief("feynman"), settings: [] }, "en");
    expect(t.turns[0].message).toBe(resumeMessage({ language: "en", notesIndex: "", brief: "# Task: study\n\n{{notesIndex}}", mode: section, message: "Hi" }));
    expect(t.turns[0].options.mode).toBe("feynman");
  });
});
```

(`vi` and `modePrompt` are used by Task 9's cases in the same file.)

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm vitest run packages/shell/test/task-manager-modes.test.ts`
Expected: FAIL (type errors on the new deps; no mode section, no tier in the view).

- [ ] **Step 3: The view's fields**

In `packages/ui/src/client.ts`, in `CurrentTaskView`, after `pendingInput?: string;`, add:

```ts
  /** Task modes (task-modes spec §5.5), only for a task whose action has them: the mode now and those used. */
  mode?: string;
  modes?: string[];
  /** The tier the task counts as (a custom profile: its nearest), so the window can ask before a switch (§5.3). */
  tier?: Tier;
  /** It runs below its mode's `minTier`: the person chose to continue. */
  belowMinTier?: true;
```

- [ ] **Step 4: Implement in the task manager**

In `packages/shell/src/main/task-manager.ts`:

1. Add `type Tier`, `defaultModeOf` and `tierBelow` to the `@humanharness/harness-sdk` import, and change the prompts import to:

```ts
import {
  CHECKPOINT_PROMPT,
  type ModeText,
  QUESTION_PROMPT,
  closePrompt,
  fillPrompt,
  modePrompt,
  modeSection,
  recommendSection,
  resumeMessage,
} from "./task-prompts";
```

2. In `TaskDeps`, replace the `actions` line and `profileFor` with:

```ts
  /** The harness's actions: their labels (English strings), where each runs with scopes, and their modes (task-modes spec §3). */
  actions: Record<string, { label: string; scope?: ScopeMode; modes?: string[]; defaultMode?: string }>;
```

```ts
  /**
   * The model profile a new task runs on, resolved once when it starts (resources spec §5). `floor`: a mode's `minTier`
   * the new task must reach (task-modes spec §5.3). Absent: the engine's defaults.
   */
  profileFor?(action: string | undefined, floor?: Tier): Promise<ModelProfile>;
```

and, after `betweenTasks?(): Promise<void>;`, add:

```ts
  /** The harness's modes (task-modes spec §3): label, least tier, the agent's hint. Absent or empty: none (D0). */
  modes?: Record<string, { label: string; minTier?: Tier; recommend?: string }>;
  /** The text of a mode's brief (its file). */
  readModeBrief?(mode: string): Promise<string>;
  /** A mode's settings as sentences with the person's values (harness-settings spec §6). Absent: none. */
  modeSettings?(mode: string): Promise<string[]>;
  /** The tier a profile counts as (a custom one: its nearest, spec §5.3). Absent: tiers are never compared. */
  tierOf?(profile: ModelProfile): Promise<Tier>;
```

3. Replace the module-level `currentView` with:

```ts
/** The open task as the window sees it: no session, no prompt, just what the screen shows. `tier` only for a task with modes. */
const currentView = (c: CurrentTask, tier?: Tier): CurrentTaskView => ({
  id: c.id,
  ...(c.action ? { action: c.action } : {}),
  ...(c.scope ? { scope: c.scope } : {}),
  status: c.status,
  ...(c.profile && c.context ? { context: { used: c.context.used, cap: c.profile.cap } } : {}),
  ...(c.profile?.fallbackFrom
    ? { fallback: { model: c.profile.fallbackFrom, ...(c.profile.model !== undefined && c.profile.tier !== "custom" ? { tier: c.profile.tier } : {}) } }
    : {}),
  ...(c.pendingInput ? { pendingInput: c.pendingInput.blockId } : {}),
  ...(c.mode ? { mode: c.mode } : {}),
  ...(c.modes ? { modes: c.modes } : {}),
  ...(tier ? { tier } : {}),
  ...(c.belowMinTier ? { belowMinTier: true as const } : {}),
});
```

4. In `view()`, change both `current: c ? currentView(c) : null,` to:

```ts
      current: c ? currentView(c, this.modesOf(c.action).length > 0 ? await this.tierFor(c) : undefined) : null,
```

5. Change `start`:

```ts
  /**
   * Starts a manifest action as a new task, closing the current one first. `display` is what the chat shows.
   * `scope`, in a harness with scopes, is opened first (closing the open task, spec §3.3). `mode`: the mode the
   * person picked for it (task-modes "ask"); one the action doesn't list is refused before anything closes.
   */
  start(action: string, display?: string, scope?: string, mode?: string): Promise<void> {
    return this.op(() => this.startNow(action, display, scope, mode));
  }
```

6. Replace `startNow` with:

```ts
  private async startNow(action: string, display?: string, scope?: string, mode?: string, floor?: Tier): Promise<void> {
    if (!this.known(action)) throw new Error("Unknown action");
    const modes = this.modesOf(action);
    // Checked before anything closes, like the scope below.
    if (mode !== undefined && !modes.includes(mode)) throw new Error("Unknown mode");
    if (scope !== undefined && !(await this.switchNow(scope))) return this.stopped();
    // Checked before anything closes: a required action with no open scope starts nothing.
    const where = this.scopeFor(await this.d.store.load(), action);
    if (!(await this.closeCurrent())) return this.stopped();
    const template = await this.d.readPrompt(action);
    const language = await this.d.language();
    // How the task starts (spec §3 `defaultMode`): in a mode, asking for a recommendation, or as before (D0).
    const start = mode ?? this.startMode(action, modes);
    let section = "";
    if (start === "recommend") section = recommendSection(modes.map((id) => this.hintOf(id)));
    else if (start !== null) section = modeSection(await this.modeText(start), language);
    const inMode = start !== null && start !== "recommend" ? { mode: start, modes: [start] } : {};
    await this.begin(
      { action, ...inMode },
      where,
      (notesIndex) => {
        const brief = fillPrompt(template, { language, notesIndex });
        return section ? `${brief}\n\n${section}` : brief;
      },
      display ?? this.d.actions[action].label,
      floor,
    );
  }

  /** The modes a task of `action` may work in: the action's list, those the harness declares (none: D0). */
  private modesOf(action: string | undefined): string[] {
    const modes = this.d.modes;
    if (!this.known(action) || !modes) return [];
    return (this.d.actions[action].modes ?? []).filter((m) => Object.hasOwn(modes, m));
  }

  /** How a task of `action` starts with no mode picked: its default mode, else "recommend" ("ask" can't ask from here). */
  private startMode(action: string, modes: string[]): string | null {
    if (modes.length === 0) return null;
    const d = defaultModeOf(this.d.actions[action]);
    return d !== null && modes.includes(d) ? d : "recommend";
  }

  /** A mode as the recommendation's list shows it to the agent. */
  private hintOf(id: string): { id: string; label: string; recommend?: string } {
    const m = this.d.modes![id];
    return { id, label: m.label, ...(m.recommend ? { recommend: m.recommend } : {}) };
  }

  /** A mode's label, brief and settings' sentences; settings that can't be read leave it with none. */
  private async modeText(mode: string): Promise<ModeText> {
    const brief = this.d.readModeBrief ? await this.d.readModeBrief(mode) : "";
    let settings: string[] = [];
    try {
      settings = (await this.d.modeSettings?.(mode)) ?? [];
    } catch (err) {
      console.error("Could not read the mode's settings; it starts with none", err);
    }
    return { label: this.d.modes![mode].label, brief, settings };
  }

  /** The tier the task counts as, or undefined when it can't be told. */
  private async tierFor(c: Pick<CurrentTask, "profile">): Promise<Tier | undefined> {
    if (!c.profile || !this.d.tierOf) return undefined;
    return this.d.tierOf(c.profile).catch(() => undefined);
  }

  /** `profile` counts below `mode`'s `minTier` (spec §5.3). */
  private async belowMinTier(mode: string, profile: ModelProfile | undefined): Promise<boolean> {
    const min = this.d.modes && Object.hasOwn(this.d.modes, mode) ? this.d.modes[mode].minTier : undefined;
    const tier = min !== undefined ? await this.tierFor({ profile }) : undefined;
    return min !== undefined && tier !== undefined && tierBelow(tier, min);
  }

  /** The labels of the modes the task used, for the closing turn. */
  private modeLabels(c: CurrentTask): string[] {
    const modes = this.d.modes;
    return (c.modes ?? []).map((id) => (modes && Object.hasOwn(modes, id) ? modes[id].label : id));
  }
```

7. Replace `begin`'s signature, its profile line and its `current` with:

```ts
  private async begin(
    task: { action?: string; question?: string; questionCut?: true; mode?: string; modes?: string[] },
    scope: string,
    message: (notesIndex: string) => string,
    display: string,
    floor?: Tier,
  ): Promise<void> {
```

```ts
    // Resolved once: the task keeps its model, effort and cap to the end (spec D2). A floor only from a mode (task-modes §5.3).
    const profile = floor !== undefined ? await this.d.profileFor?.(task.action, floor) : await this.d.profileFor?.(task.action);
    const below = task.mode !== undefined && (await this.belowMinTier(task.mode, profile));
    const current: CurrentTask = {
      id: this.newId(),
      ...task,
      status: "running",
      startedAt: this.now().toISOString(),
      turns: 0,
      ...(profile ? { profile } : {}),
      ...(this.d.scoped ? { scope } : {}),
      ...(below ? { belowMinTier: true as const } : {}),
    };
```

8. In `runTurn`, in the object passed to `this.d.turns.send`, add `...(task.mode ? { mode: task.mode } : {}),` right before `...options,` (the switch's own `mode` in `options` wins).

9. In `closeCurrent`, change the closing turn's prompt from `CLOSE_PROMPT` to `closePrompt(this.modeLabels(c))`. Remove `CLOSE_PROMPT` from the imports if nothing else uses it.

10. In `saveNote`, change the `meta` line to:

```ts
      const meta: NoteMeta = {
        ...(task.action ? { action: task.action } : {}),
        date: this.now().toISOString(),
        engine: await this.d.engine(),
        // The modes the task used (task-modes spec §6); none: as before (D0).
        ...(task.modes && task.modes.length > 0 ? { modes: task.modes } : {}),
      };
```

11. In `resumeMessageFor`, after the `brief` try/catch, add:

```ts
    // The current mode comes back with the task (task-modes spec §6); a missing brief leaves it out.
    let mode: string | undefined;
    if (c.mode && this.modesOf(c.action).includes(c.mode)) {
      try {
        mode = modeSection(await this.modeText(c.mode), language);
      } catch (err) {
        console.error("Could not read the mode's brief; the task resumes without it", err);
      }
    }
```

and pass `...(mode ? { mode } : {}),` to `resumeMessage` right after the `brief` spread.

- [ ] **Step 5: Run the tests**

Run: `corepack pnpm vitest run packages/shell/test/task-manager-modes.test.ts packages/shell/test/task-manager.test.ts packages/shell/test/task-manager-input.test.ts packages/shell/test/task-manager-scopes.test.ts`
Expected: PASS. The three existing files are unchanged and green: no `profileFor` call gains an argument, every view is the same (D0).

- [ ] **Step 6: Verify and commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test` and `corepack pnpm app:build`
Expected: all green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/shell/src/main/task-manager.ts packages/ui/src/client.ts packages/shell/test/task-manager-modes.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(shell): tasks start in a mode or ask for a recommendation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 9: `chooseMode`: switch, refusals, the tier floor's two ways on

**Files:**
- Modify: `packages/shell/src/main/task-manager.ts`, `packages/ui/src/client.ts`
- Test: `packages/shell/test/task-manager-modes.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/shell/test/task-manager-modes.test.ts` (add `type ModeChoice` to the `@humanharness/ui/client` type import):

```ts
const pick = async (t: ReturnType<typeof setup>, mode: string, choice?: ModeChoice) => {
  const { accepted, done } = t.manager.chooseMode(mode, choice);
  const r = await accepted;
  await done;
  return r;
};

describe("TaskManager.chooseMode (task-modes spec §5)", () => {
  it("switches in one turn of the same session: the mode's brief and settings, a system line, then the state", async () => {
    const t = setup();
    await t.manager.start("study");
    expect(await pick(t, "socratic")).toEqual({ ok: true, switched: "turn" });
    expect(t.turns[1].message).toBe(modePrompt(socratic, { language: "en" }));
    expect(t.turns[1].options).toMatchObject({ display: "Switched to Socratic", modeSwitch: true, mode: "socratic", action: "study", followUp: true });
    expect(t.turns[1].options).not.toHaveProperty("quiet");
    expect(t.state().current).toMatchObject({ mode: "socratic", modes: ["socratic"], status: "waiting", turns: 2 });
    await pick(t, "feynman");
    await pick(t, "socratic");
    expect(t.state().current).toMatchObject({ mode: "socratic", modes: ["socratic", "feynman"] });
  });

  it("refuses with no waiting task, a mode the action doesn't list, and does nothing for the current mode", async () => {
    const t = setup();
    expect(await pick(t, "socratic")).toEqual({ ok: false, reason: "no-task" });
    await t.manager.start("quiz");
    expect(await pick(t, "socratic")).toEqual({ ok: false, reason: "unknown" });
    await t.manager.start("study");
    expect(await pick(t, "nope")).toEqual({ ok: false, reason: "unknown" });
    await pick(t, "socratic");
    const before = t.turns.length;
    expect(await pick(t, "socratic")).toEqual({ ok: true, switched: "same" });
    expect(t.turns).toHaveLength(before);
  });

  it("a failed switch turn leaves the mode as it was, so it can be picked again", async () => {
    const t = setup({ script: [[ok], [{ type: "done", ok: false, error: { code: "agent-crashed" } }]] });
    await t.manager.start("study");
    expect(await pick(t, "feynman")).toEqual({ ok: true, switched: "turn" });
    expect(t.state().current).not.toHaveProperty("mode");
    expect(t.state().current?.status).toBe("waiting");
  });

  it("below the mode's minTier: refused with the tiers; 'continue' switches and marks it; a fitting mode clears the mark", async () => {
    const t = setup();
    await t.manager.start("study");
    expect(await pick(t, "worked")).toEqual({ ok: false, reason: "tier", required: "deep", current: "standard" });
    expect(t.turns).toHaveLength(1);
    expect(await pick(t, "worked", { belowTier: "continue" })).toEqual({ ok: true, switched: "turn" });
    expect(t.state().current).toMatchObject({ mode: "worked", belowMinTier: true });
    await pick(t, "feynman");
    expect(t.state().current).not.toHaveProperty("belowMinTier");
  });

  it("'new-task' closes the task (its note) and starts the same action in that mode at the mode's tier", async () => {
    const t = setup({ defaultMode: "socratic", script: [[ok], [saveNote, ok], [ok]] });
    await t.manager.start("study");
    expect(await pick(t, "worked", { belowTier: "new-task" })).toEqual({ ok: true, switched: "new-task" });
    expect(t.turns[1].message).toBe(closePrompt(["Socratic"]));
    expect(t.turns[2].message).toContain("## Mode: Worked examples");
    expect(t.floors.at(-1)).toBe("deep");
    expect(t.state().actions.study).toBe("done");
    expect(t.state().current).toMatchObject({ id: "t2", action: "study", mode: "worked", modes: ["worked"], profile: { tier: "deep" } });
    expect(t.state().current).not.toHaveProperty("belowMinTier");
  });

  it("waits for a running turn to end, never cancelling it (spec §5.2)", async () => {
    let release!: () => void;
    const t = setup({ gate: new Promise<void>((r) => (release = r)) });
    const started = t.manager.start("study");
    await vi.waitFor(() => expect(t.turns).toHaveLength(1));
    const { accepted, done } = t.manager.chooseMode("feynman");
    await new Promise((r) => setTimeout(r, 30));
    expect(t.turns).toHaveLength(1);
    release();
    await started;
    expect(await accepted).toEqual({ ok: true, switched: "turn" });
    await done;
    expect(t.turns[1].options.mode).toBe("feynman");
  });

  it("a task whose session was lost switches quietly; its resumed session carries the mode", async () => {
    const current = { id: "t1", action: "study", status: "waiting" as const, startedAt: "", turns: 1, resume: true as const };
    const t = setup({ state: { version: 1, actions: {}, current } });
    expect(await pick(t, "feynman")).toEqual({ ok: true, switched: "quiet" });
    expect(t.turns).toHaveLength(0);
    expect(t.state().current).toMatchObject({ mode: "feynman", modes: ["feynman"], resume: true });
  });

  it("carries the last checkpoint's summary when the task has one (spec §10.1)", async () => {
    const note: Note = { slug: "study", title: "Halves", action: "study", date: NOW, engine: "claude", ...NOTE, path: ".harness/notes/study.md" };
    const current = { id: "t1", action: "study", status: "waiting" as const, startedAt: "", turns: 3, checkpointNote: true, checkpointTurns: 3, profile: profileOf("standard") };
    const t = setup({ notes: [note], state: { version: 1, actions: {}, current } });
    await pick(t, "feynman");
    expect(t.turns[0].message).toContain("What is clear so far (the last checkpoint): Two halves make a whole.");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm vitest run packages/shell/test/task-manager-modes.test.ts`
Expected: FAIL (`chooseMode` doesn't exist; `ModeChoice` isn't exported).

- [ ] **Step 3: The result types**

In `packages/ui/src/client.ts`, after `TaskView`, add:

```ts
/**
 * How the person's pick of a mode for the open task went (task-modes spec §5). `switched`: a turn in the new mode runs
 * now ("turn"), the mode was set with no turn because the session is gone ("quiet"), the task closes and a new one
 * starts in that mode ("new-task"), or it already was the mode ("same"). Refusals: no task waits ("no-task"), the action
 * doesn't list the mode ("unknown"), or the mode asks for more than the task's tier ("tier", with both tiers).
 */
export type ModeResult =
  | { ok: true; switched: "turn" | "quiet" | "new-task" | "same" }
  | { ok: false; reason: "no-task" | "unknown" | "tier"; required?: Tier; current?: Tier };

/** The answer to the tier question (spec §5.3): continue at the task's tier, or start a new task at the mode's. */
export interface ModeChoice {
  belowTier?: "continue" | "new-task";
}
```

- [ ] **Step 4: Implement `chooseMode`**

In `packages/shell/src/main/task-manager.ts`:

1. Add `type ModeChoice` and `type ModeResult` to the `@humanharness/ui/client` import.
2. After `respond(…)`, add:

```ts
  /**
   * The person picks `mode` for the open task (task-modes spec §5). It waits for a running turn to end and never cancels
   * it (§5.2). `accepted` resolves with a refusal or with how the switch goes on, before any turn's events; `done` once
   * its turn has ended. Both reject when the operation can't run (closing, another operation just started).
   */
  chooseMode(mode: string, choice: ModeChoice = {}): { accepted: Promise<ModeResult>; done: Promise<void> } {
    let settled = false;
    let take!: (r: ModeResult) => void;
    let refuse!: (err: unknown) => void;
    const accepted = new Promise<ModeResult>((resolve, reject) => {
      take = (r) => {
        settled = true;
        resolve(r);
      };
      refuse = reject;
    });
    const done = this.whenIdle()
      .then(() => this.op(() => this.modeNow(mode, choice, take)))
      .then(
        () => {
          if (!settled) refuse(new Error("The mode was not switched"));
        },
        (err: unknown) => {
          if (!settled) refuse(err);
          throw err;
        },
      );
    return { accepted, done };
  }
```

3. After `whenNoTask`, add:

```ts
  /** Resolves once no operation or turn runs, or the app is closing (a mode switch waits for the turn, spec §5.2). */
  private async whenIdle(): Promise<void> {
    while (this.isBusy() && !this.closed) {
      await this.idle();
      // A turn the window started outside an operation: look again shortly.
      if (this.isBusy()) await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
```

4. After `startNow` and its helpers, add:

```ts
  /**
   * Checks, in order: a task waits; the action lists the mode; it isn't the current one; the task's tier reaches the
   * mode's `minTier`, or the person chose how to go on (spec §5.3). Then: a new task at the mode's tier, a quiet switch
   * for a lost session, or one turn in the same session. The state changes only once that turn ended well.
   */
  private async modeNow(mode: string, choice: ModeChoice, take: (r: ModeResult) => void): Promise<void> {
    const c = await this.storedCurrent();
    if (!c || c.status !== "waiting") return take({ ok: false, reason: "no-task" });
    if (!this.modesOf(c.action).includes(mode)) return take({ ok: false, reason: "unknown" });
    if (c.mode === mode) return take({ ok: true, switched: "same" });
    const required = this.d.modes![mode].minTier;
    const current = await this.tierFor(c);
    const below = required !== undefined && current !== undefined && tierBelow(current, required);
    if (below && choice.belowTier === undefined) return take({ ok: false, reason: "tier", required, current });
    if (below && choice.belowTier === "new-task") {
      take({ ok: true, switched: "new-task" });
      // The closing turn saves the note the new task starts from: one turn, where the spec has a checkpoint and a close.
      if (!(await this.closeCurrent())) return this.stopped();
      return this.startNow(c.action!, undefined, undefined, mode, required);
    }
    // Read before anything is taken: a brief that can't be read refuses the switch.
    const text = await this.modeText(mode);
    if (c.resume) {
      // The session is gone (a folder move): nothing to tell now; the resumed session's first message carries the mode.
      await this.setMode(c.id, mode, below);
      return take({ ok: true, switched: "quiet" });
    }
    take({ ok: true, switched: "turn" });
    if (needsCheckpoint(c) && !(await this.checkpoint(c))) return this.stopped();
    const language = await this.d.language();
    const soFar = c.checkpointNote ? await this.checkpointSummary(c) : undefined;
    const message = modePrompt(text, { language, ...(soFar ? { soFar } : {}) });
    await this.setStatus(c.id, "running");
    // Checked with no await before the send: a Stop while the status was saved.
    if (this.cancelRequested) {
      await this.setStatus(c.id, "waiting");
      return this.stopped();
    }
    let done: Done;
    try {
      done = await this.runTurn(c, message, {
        display: `Switched to ${text.label}`,
        ...(c.action ? { action: c.action } : {}),
        followUp: true,
        mode,
        modeSwitch: true,
      });
    } catch (err) {
      if (err instanceof TurnNotStarted) await this.setStatus(c.id, "waiting");
      throw unwrap(err);
    }
    // The mode is the task's once the agent got it: a failed switch can be picked again.
    if (done.ok) await this.setMode(c.id, mode, below);
    return this.afterRun(c.id, done, false);
  }

  /** The task works in `mode` now: it joins the modes used (once), and `belowMinTier` says whether it runs below it. */
  private setMode(id: string, mode: string, below: boolean): Promise<void> {
    return this.update((s) => {
      if (s.current?.id !== id) return s;
      const { belowMinTier: _below, ...rest } = s.current;
      const modes = rest.modes?.includes(mode) ? rest.modes : [...(rest.modes ?? []), mode];
      return { ...s, current: { ...rest, mode, modes, ...(below ? { belowMinTier: true as const } : {}) } };
    });
  }

  /** The summary of the task's checkpoint note (spec §10.1), or undefined when it can't be found. */
  private async checkpointSummary(c: CurrentTask): Promise<string[] | undefined> {
    const notes = await this.d.notes(this.d.scoped ? scopeOfTask(c) : undefined).catch(() => [] as Note[]);
    return notes.find((n) => n.slug === c.action)?.summary;
  }
```

- [ ] **Step 5: Run the tests**

Run: `corepack pnpm vitest run packages/shell/test`
Expected: PASS.

- [ ] **Step 6: Verify and commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test` and `corepack pnpm app:build`
Expected: all green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/shell/src/main/task-manager.ts packages/ui/src/client.ts packages/shell/test/task-manager-modes.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(shell): chooseMode switches in the same session, with a tier floor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 10: `SettingsController` saves and reads mode settings

**Files:**
- Modify: `packages/shell/src/main/settings.ts`
- Test: `packages/shell/test/settings.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/shell/test/settings.test.ts`:

```ts
describe("SettingsController: mode settings (harness-settings spec §6)", () => {
  const modes = {
    socratic: {
      label: "Socratic",
      settings: {
        questions: { schema: z.enum(["few", "many"]), default: "few", control: "segmented" as const, label: "Questions", agent: "Ask {{value}} questions." },
      },
    },
    feynman: { label: "Feynman" },
  };
  function modeSetup() {
    const base = fs.mkdtempSync(path.join(root, "m-"));
    const store = new DataStore(base, dataCollections({ data: {}, settings, modes }));
    const ctl = new SettingsController({
      settings,
      modes,
      store: async () => store,
      write: (request) => runDataRequest(store, request, { who: "person", scope: APP_SCOPE }),
      taskOpen: async () => true,
      whenNoTask: async () => false,
      refresh: async () => true,
      changed: () => {},
    });
    const file = path.join(base, ".harness", "data", "_app", "settings.json");
    return { ctl, file, stored: () => JSON.parse(fs.readFileSync(file, "utf8")) as unknown };
  }

  it("saves one under modes.<mode>, reads it under its key, fills the mode's sentences, and is never pending", async () => {
    const t = modeSetup();
    expect(await t.ctl.set("socratic.questions", "many")).toMatchObject({ ok: true, state: { values: { tone: "patient", "socratic.questions": "many" }, pending: [] } });
    expect(t.stored()).toEqual({ modes: { socratic: { questions: "many" } } });
    expect(await t.ctl.modeSentences("socratic")).toEqual(["Ask many questions."]);
    expect(await t.ctl.modeSentences("feynman")).toEqual([]);
    await t.ctl.set("socratic.questions", "few");
    expect(fs.existsSync(t.file)).toBe(false);
  });

  it("refuses an unknown key and a value its schema refuses", async () => {
    const t = modeSetup();
    expect(await t.ctl.set("socratic.nope", "x")).toEqual({ ok: false, message: "Unknown setting" });
    expect(await t.ctl.set("feynman.questions", "few")).toEqual({ ok: false, message: "Unknown setting" });
    expect((await t.ctl.set("socratic.questions", "lots")).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm vitest run packages/shell/test/settings.test.ts`
Expected: FAIL (`modes` isn't a dep; `socratic.questions` is an unknown setting; `modeSentences` doesn't exist).

- [ ] **Step 3: Implement**

In `packages/shell/src/main/settings.ts`:

1. Change the sdk import to:

```ts
import {
  type HarnessSettings,
  type ModesWithSettings,
  SETTINGS_COLLECTION,
  agentSettings,
  modeSentences,
  sameSetting,
  settingRef,
  settingsSentences,
  settingsValues,
  withSetting,
} from "@humanharness/harness-sdk";
```

2. In `SettingsDeps`, after `settings: HarnessSettings;`, add:

```ts
  /** The manifest's modes: their settings are keyed `<mode>.<field>` (harness-settings spec §6). Absent: none (D0). */
  modes?: ModesWithSettings;
```

3. In `values()`, change the return to `return settingsValues(this.d.settings, stored, this.d.modes);`.
4. After `sentences()`, add:

```ts
  /** A mode's sentences with the person's values now, for its brief (spec §6): they never go into AGENTS.md. */
  async modeSentences(mode: string): Promise<string[]> {
    return modeSentences(this.d.modes, mode, await this.values());
  }
```

5. Replace the body of `set`'s `serial` callback with:

```ts
    return this.serial(async () => {
      const ref = typeof field === "string" ? settingRef(this.d.settings, this.d.modes, field) : null;
      if (!ref) return { ok: false, message: "Unknown setting" };
      const parsed = ref.field.schema.safeParse(value);
      if (!parsed.success) return { ok: false, message: parsed.error.issues.map((i) => i.message).join("; ") };
      const store = await this.d.store().catch(() => null);
      if (!store) return { ok: false, message: "The app is not set up yet" };
      const stored = (await store.get(SETTINGS_COLLECTION, undefined, PERSON).catch(() => null)) ?? {};
      const next = withSetting(stored, ref, parsed.data);
      if (sameSetting(next, stored)) return { ok: true, state: await this.state() };
      return this.save(Object.keys(next).length > 0 ? { op: "put", collection: SETTINGS_COLLECTION, record: next } : { op: "delete", collection: SETTINGS_COLLECTION });
    });
```

and update `set`'s doc comment: `/** The person changed one setting (a field name, or \`<mode>.<field>\`); the tab saves each change at once. Back to its default, it is removed. */`.

`state()` is unchanged: `agentSettings` lists only the harness's own fields, so a mode setting is never pending.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run packages/shell/test/settings.test.ts`
Expected: PASS, the existing cases unchanged.

- [ ] **Step 5: Verify and commit**

Run: `corepack pnpm typecheck` and `corepack pnpm test`
Expected: both green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/shell/src/main/settings.ts packages/shell/test/settings.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(shell): settings controller saves and reads mode settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 11: Wire it: the deps, the app state, `hh:send`'s mode, `hh:chooseMode`, the preload and the fake client

**Files:**
- Create: `packages/shell/src/main/mode-ipc.ts`
- Modify: `packages/shell/src/main/index.ts`, `packages/shell/src/main/tasks.ts`, `packages/shell/src/preload/index.ts`, `packages/ui/src/client.ts`, `packages/ui/test/fake-client.ts`
- Test: `packages/shell/test/mode-ipc.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/shell/test/mode-ipc.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { ModeChoice, ModeResult } from "@humanharness/ui/client";
import { chooseModeHandler } from "../src/main/mode-ipc";

function setup(opts: { quitting?: boolean; blocked?: string | null; result?: ModeResult; doneError?: Error } = {}) {
  const calls: { mode: string; choice: ModeChoice }[] = [];
  const handler = chooseModeHandler({
    quitting: () => opts.quitting ?? false,
    blocked: () => opts.blocked ?? null,
    choose: (mode, choice) => {
      calls.push({ mode, choice });
      return { accepted: Promise.resolve(opts.result ?? { ok: true, switched: "turn" }), done: opts.doneError ? Promise.reject(opts.doneError) : Promise.resolve() };
    },
  });
  return { handler, calls };
}

describe("hh:chooseMode", () => {
  it("answers the acceptance as data and passes the person's tier answer", async () => {
    const t = setup({ result: { ok: false, reason: "tier", required: "deep", current: "standard" } });
    expect(await t.handler("worked", {})).toEqual({ ok: false, reason: "tier", required: "deep", current: "standard" });
    await t.handler("worked", { belowTier: "new-task" });
    expect(t.calls).toEqual([
      { mode: "worked", choice: {} },
      { mode: "worked", choice: { belowTier: "new-task" } },
    ]);
  });

  it("refuses while quitting or blocked, and anything malformed, before asking the task manager", async () => {
    await expect(setup({ quitting: true }).handler("worked", {})).rejects.toThrow("The app is closing");
    await expect(setup({ blocked: "A restore is running" }).handler("worked", {})).rejects.toThrow("A restore is running");
    const t = setup();
    for (const [mode, choice] of [[3, {}], ["Bad Mode", {}], ["../x", {}], ["worked", { belowTier: "later" }]] as const) {
      await expect(t.handler(mode, choice)).rejects.toThrow("Invalid mode");
    }
    expect(t.calls).toHaveLength(0);
  });

  it("logs a failed turn instead of leaving an unhandled rejection", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = setup({ doneError: new Error("boom") });
    expect(await t.handler("feynman", undefined)).toEqual({ ok: true, switched: "turn" });
    await new Promise((r) => setTimeout(r, 0));
    expect(error).toHaveBeenCalledWith("The mode switch's turn failed", expect.any(Error));
    error.mockRestore();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm vitest run packages/shell/test/mode-ipc.test.ts`
Expected: FAIL (`../src/main/mode-ipc` doesn't exist).

- [ ] **Step 3: The handler**

Create `packages/shell/src/main/mode-ipc.ts`:

```ts
import { MODE_ID } from "@humanharness/harness-sdk";
import type { ModeChoice, ModeResult } from "@humanharness/ui/client";

export interface ChooseModeDeps {
  quitting(): boolean;
  /** Why a new turn can't start now, or null. */
  blocked(): string | null;
  choose(mode: string, choice: ModeChoice): { accepted: Promise<ModeResult>; done: Promise<void> };
}

/**
 * The handler of `hh:chooseMode` (task-modes spec §5). It answers with the acceptance as a value: a refusal's reason
 * and tiers survive Electron's IPC, which keeps only a thrown error's message. The switch's turn reaches the window as
 * events; its failure is only logged here, so main never has an unhandled rejection.
 */
export function chooseModeHandler(d: ChooseModeDeps): (mode: unknown, choice: unknown) => Promise<ModeResult> {
  return async (mode, choice) => {
    if (d.quitting()) throw new Error("The app is closing");
    const blocked = d.blocked();
    if (blocked) throw new Error(blocked);
    if (typeof mode !== "string" || !MODE_ID.test(mode)) throw new Error("Invalid mode");
    const below = typeof choice === "object" && choice !== null ? (choice as { belowTier?: unknown }).belowTier : undefined;
    if (below !== undefined && below !== "continue" && below !== "new-task") throw new Error("Invalid mode");
    const { accepted, done } = d.choose(mode, below ? { belowTier: below } : {});
    done.catch((err: unknown) => console.error("The mode switch's turn failed", err));
    return accepted;
  };
}
```

- [ ] **Step 4: The client's types**

In `packages/ui/src/client.ts`:

1. In `ActionOption`, after `scope?: ScopeMode;`, add:

```ts
  /** The modes its task may work in, and how it starts (task-modes spec §3). Absent without modes (D0). */
  modes?: string[];
  defaultMode?: string;
```

2. Before `AppState`, add:

```ts
/** A mode as the window shows it (task-modes spec §3): never its brief or the agent's hint. */
export interface ModeView {
  label: string;
  description?: string;
  minTier?: Tier;
}
```

3. In `AppState`, after `settings?: SettingsView;`, add:

```ts
  /** The harness's modes, by id (task-modes spec). Absent: none (D0). */
  modes?: Record<string, ModeView>;
```

4. In `SendOptions`, after `scope?: string;`, add:

```ts
  /** With `action`: the mode the person picked for the new task (`defaultMode: "ask"`, task-modes spec §3). */
  mode?: string;
```

5. In `HarnessClient`, after `respond(…)`, add:

```ts
  /**
   * The person picks a mode for the open task (task-modes spec §5): resolves with a refusal (with the tiers when the
   * mode asks for more) or with how the switch goes on; the switch's turn then arrives as events. `choice` answers the
   * tier question.
   */
  chooseMode(mode: string, choice?: ModeChoice): Promise<ModeResult>;
```

- [ ] **Step 5: The preload and the fake client**

`packages/shell/src/preload/index.ts`, after the `respond` line:

```ts
  chooseMode: (mode, choice) => ipcRenderer.invoke("hh:chooseMode", mode, choice ?? {}),
```

`packages/ui/test/fake-client.ts`: add `ModeChoice` and `ModeResult` to the type import, and after `respond(…)`'s block:

```ts
  /** What chooseMode was asked, in order. */
  modeChoices: { mode: string; choice: ModeChoice }[] = [];
  /** What chooseMode answers; default: a switch turn runs. */
  modeResult: ModeResult | null = null;
  /** When set, chooseMode rejects with it. */
  modeError: Error | null = null;
  async chooseMode(mode: string, choice: ModeChoice = {}): Promise<ModeResult> {
    this.modeChoices.push({ mode, choice });
    if (this.modeError) throw this.modeError;
    return this.modeResult ?? { ok: true, switched: "turn" };
  }
```

- [ ] **Step 6: The main process**

In `packages/shell/src/main/index.ts`:

1. Add `hasModes` to the `@humanharness/harness-sdk` import; add `nearestTier` to the `./models` import; add `import { chooseModeHandler } from "./mode-ipc";`; add `type ModeView` to the `@humanharness/ui/client` import.
2. After `const scoped = (): boolean => harness.scopes !== undefined;`, add:

```ts
/** tasks.json is read knowing the manifest's modes, so a mode it no longer declares is dropped (task-modes spec §6). */
const taskStoreOptions = (): { modes?: string[] } => (hasModes(harness) ? { modes: Object.keys(harness.modes) } : {});
```

and change both `new TaskStore(baseOf(c))` in the `tasks` store to `new TaskStore(baseOf(c), taskStoreOptions())`.

3. In `appState`:
- in the action map, after the `scope` spread, add:

```ts
          ...(a.modes ? { modes: a.modes } : {}),
          ...(a.defaultMode ? { defaultMode: a.defaultMode } : {}),
```

- change the settings line to `...(harness.settings ? { settings: settingsView(harness.settings, harness.modes) } : {}),`
- after it, add:

```ts
    // Only a harness with modes sends them (task-modes D0): what the window shows, never a brief or a hint.
    ...(hasModes(harness)
      ? {
          modes: Object.fromEntries(
            Object.entries(harness.modes).map(([id, m]): [string, ModeView] => [
              id,
              { label: m.label, ...(m.description ? { description: m.description } : {}), ...(m.minTier ? { minTier: m.minTier } : {}) },
            ]),
          ),
        }
      : {}),
```

4. In the `TaskManager` deps:
- after the `betweenTasks` getter, add:

```ts
  // Getters, because the harness is loaded after this object is built. Undefined without modes (task-modes D0).
  get modes() {
    return hasModes(harness) ? harness.modes : undefined;
  },
  readModeBrief: (mode) => {
    if (!Object.hasOwn(harness.modes, mode)) throw new Error("Unknown mode");
    return fs.readFile(resolveInHarness(harness, harness.modes[mode].brief), "utf8");
  },
  // Mode settings live in the settings controller (harness-settings spec §6); without settings there are none.
  modeSettings: async (mode) => (settingsCtl ? settingsCtl.modeSentences(mode) : []),
  tierOf: async (profile) => nearestTier(profile, cleanModels((await config.load()).models)),
```

- replace `profileFor` with:

```ts
  profileFor: async (action, floor) => {
    const c = await config.load();
    const engine = c.engineId ?? "";
    const models = cleanModels(c.models);
    const manifestTier = action !== undefined ? harness.actions[action]?.tier : harness.questions?.tier;
    // `floor`: the mode's minTier when a task restarts in that mode (task-modes spec §5.3).
    const profile = resolveProfile({ engine, action, manifestTier, models, ...(floor ? { floor } : {}) });
    // Codex: a model its saved list lacks falls back before the turn (spec §5.3).
    const saved = await savedOffer(engine);
    return supportedEffort(firstOffered(profile, models, saved.models), saved);
  },
```

- in `recordCompaction`, add `...(task.mode ? { mode: task.mode } : {}),` after the `task: task.id,` part of the meta.

5. In `hh:send`, replace the line that starts the task:

```ts
    const action = typeof options?.action === "string" && Object.hasOwn(harness.actions, options.action) ? options.action : undefined;
    // The mode the person picked for a new task ("ask"); one the action doesn't list is refused.
    const mode = action && typeof options?.mode === "string" && (harness.actions[action].modes ?? []).includes(options.mode) ? options.mode : undefined;
    if (options?.mode !== undefined && mode === undefined) throw new Error("Unknown mode");
```

(keeping the `scope` lines that follow), and change `const sent = action ? tasks.start(action, message, scope) : …` to `const sent = action ? tasks.start(action, message, scope, mode) : tasks.ask(message, undefined, scope);`.

6. After the `hh:respond` handler, add:

```ts
  // The person's pick of a mode (task-modes spec §5): the acceptance comes back as data.
  handle("hh:chooseMode", chooseModeHandler({ quitting: () => quitting, blocked: turnBlocked, choose: (mode, choice) => tasks.chooseMode(mode, choice) }));
```

7. In `new SettingsController({ … })`, after `settings: harness.settings,`, add `modes: harness.modes,`.

`packages/shell/src/main/tasks.ts`: change the models export to `export { nearestTier, nextFallback, resolveProfile } from "./models";`.

- [ ] **Step 7: Run the tests**

Run: `corepack pnpm vitest run packages/shell/test packages/ui/test`
Expected: PASS.

- [ ] **Step 8: Verify and commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test` and `corepack pnpm app:build`
Expected: all green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/shell/src/main/mode-ipc.ts packages/shell/src/main/index.ts packages/shell/src/main/tasks.ts packages/shell/src/preload/index.ts packages/ui/src/client.ts packages/ui/test/fake-client.ts packages/shell/test/mode-ipc.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(shell): wire task modes: app state, hh:send mode, hh:chooseMode

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

## Phase 3 — The window (spec §4, §5.3, §5.4; slice 1 and 3, the UI part)

### Task 12: The UI pieces: the `recommend_mode` block, the mode list and the mode bar

**Files:**
- Create: `packages/ui/src/modes.ts`, `packages/ui/src/ModeList.tsx`, `packages/ui/src/RecommendModeBlock.tsx`
- Modify: `packages/ui/src/Message.tsx` (`BlockProps`), `packages/i18n/src/locales/en.json`, `packages/ui/src/styles.css`
- Test: `packages/ui/test/recommend-mode.test.tsx` (new), `packages/ui/test/harness-settings.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/test/recommend-mode.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlockProps } from "../src/Message";
import { ModeBar } from "../src/ModeList";
import { RecommendModeBlock } from "../src/RecommendModeBlock";
import { actionModes, readRecommendation, tierBelow } from "../src/modes";
import { renderIn } from "./render";

afterEach(cleanup);

const views = {
  socratic: { label: "Socratic", description: "Questions that lead you to the idea." },
  feynman: { label: "Feynman" },
  worked: { label: "Worked examples", minTier: "deep" as const },
};
const allowed = ["socratic", "feynman", "worked"];
const data = {
  recommended: "socratic",
  reasons: ["One key idea to discover.", "You like to reason it out."],
  alternatives: [{ mode: "worked", why: "If you want to see it solved first." }],
};
const props = (over: Partial<BlockProps> = {}): BlockProps => ({
  data,
  respond: () => true,
  choose: () => true,
  open: async () => true,
  reveal: async () => true,
  active: true,
  chooseMode: vi.fn(() => true),
  modes: { views, allowed },
  ...over,
});

describe("RecommendModeBlock (task-modes spec §4)", () => {
  it("shows the recommended mode first with its badge and reasons, then the alternatives; a pick goes to chooseMode", async () => {
    const p = props();
    await renderIn("en", <RecommendModeBlock {...p} />);
    const group = screen.getByRole("group", { name: "How do we work?" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toBe("SocraticRecommendedOne key idea to discover.You like to reason it out.");
    expect(buttons[1].textContent).toBe("Worked examplesIf you want to see it solved first.");
    fireEvent.click(buttons[0]);
    expect(p.chooseMode).toHaveBeenCalledWith("socratic");
    expect(buttons[0].getAttribute("aria-pressed")).toBe("true");
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(true);
  });

  it("'See all modes' lists the action's modes with their descriptions", async () => {
    const p = props();
    await renderIn("en", <RecommendModeBlock {...p} />);
    const more = screen.getByRole("button", { name: "See all modes" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    const list = screen.getByRole("group", { name: "See all modes" });
    expect(within(list).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "SocraticQuestions that lead you to the idea.",
      "Feynman",
      "Worked examples",
    ]);
    fireEvent.click(within(list).getByRole("button", { name: "Feynman" }));
    expect(p.chooseMode).toHaveBeenCalledWith("feynman");
  });

  it("stays unpicked when the switch isn't sent; is disabled once the conversation moved on; draws nothing when malformed", async () => {
    const refused = props({ chooseMode: vi.fn(() => false) });
    const { unmount } = await renderIn("en", <RecommendModeBlock {...refused} />);
    fireEvent.click(screen.getAllByRole("button")[0]);
    expect(screen.getAllByRole("button")[0].getAttribute("aria-pressed")).toBe("false");
    unmount();
    await renderIn(
      "en",
      <>
        <RecommendModeBlock {...props({ active: false })} />
        <RecommendModeBlock {...props({ data: { recommended: "nope", reasons: ["x"] } })} />
        <RecommendModeBlock {...props({ modes: undefined })} />
      </>,
    );
    expect(screen.getAllByRole("group")).toHaveLength(1);
    expect(screen.getAllByRole("button").filter((b) => b.textContent !== "See all modes").every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });
});

describe("readRecommendation", () => {
  it("keeps only listed modes, well-formed reasons (at most 3) and alternatives (at most 2, never the recommended one)", () => {
    expect(
      readRecommendation(
        {
          recommended: "socratic",
          reasons: ["a", "", 3, "b", "c", "d"],
          alternatives: [{ mode: "socratic", why: "x" }, { mode: "nope", why: "x" }, { mode: "feynman" }, { mode: "worked", why: "w" }, { mode: "worked", why: "again" }],
        },
        allowed,
      ),
    ).toEqual({ recommended: "socratic", reasons: ["a", "b", "c"], alternatives: [{ mode: "worked", why: "w" }] });
    expect(readRecommendation({ recommended: "nope", reasons: ["a"] }, allowed)).toBeNull();
    expect(readRecommendation({ recommended: "socratic", reasons: [] }, allowed)).toBeNull();
    expect(readRecommendation(null, allowed)).toBeNull();
  });
});

describe("the mode helpers and the bar", () => {
  it("tierBelow and actionModes", () => {
    expect(tierBelow("standard", "deep")).toBe(true);
    expect(tierBelow("deep", "deep")).toBe(false);
    const state = { actions: { study: { label: "Study", modes: ["worked", "gone", "socratic"] }, quiz: { label: "Quiz" } }, modes: views };
    expect(actionModes(state, "study")).toEqual([
      { id: "worked", label: "Worked examples", minTier: "deep" },
      { id: "socratic", label: "Socratic", description: "Questions that lead you to the idea." },
    ]);
    expect(actionModes(state, "quiz")).toEqual([]);
    expect(actionModes({ actions: state.actions }, "study")).toEqual([]);
  });

  it("names the mode, offers to change it, and says when the task runs below the mode's level", async () => {
    const onPick = vi.fn();
    const modes = actionModes({ actions: { study: { label: "Study", modes: allowed } }, modes: views }, "study");
    await renderIn("en", <ModeBar modes={modes} current="worked" below disabled={false} onPick={onPick} />);
    const bar = screen.getByRole("group", { name: "Task mode" });
    expect(bar.textContent).toContain("Mode: Worked examples");
    expect(bar.textContent).toContain("Running below the level this mode asks for");
    fireEvent.click(within(bar).getByRole("button", { name: "Change mode" }));
    const list = within(bar).getByRole("group", { name: "Change mode" });
    expect(within(list).getByRole("button", { name: "Worked examples" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(list).getByRole("button", { name: "Feynman" }));
    expect(onPick).toHaveBeenCalledWith("feynman");
    cleanup();
    await renderIn("en", <ModeBar modes={modes} disabled onPick={onPick} />);
    expect(screen.getByRole("group", { name: "Task mode" }).textContent).toContain("No mode chosen yet");
    expect((screen.getByRole("button", { name: "Change mode" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
```

Append to `packages/ui/test/harness-settings.test.tsx`:

```tsx
describe("HarnessSettingsTab: mode settings (harness-settings spec §6)", () => {
  it("draws each mode's settings as a section named after the mode, and saves them under their key", async () => {
    const client = new FakeClient();
    const withModes: SettingsView = {
      ...view,
      sections: [...view.sections, { id: "mode:socratic", label: "Socratic" }],
      fields: [
        ...view.fields,
        {
          name: "socratic.questions",
          control: "segmented",
          label: "Questions",
          section: "mode:socratic",
          mode: "socratic",
          default: "few",
          options: [
            { value: "few", label: "Few" },
            { value: "many", label: "Many" },
          ],
        },
      ],
    };
    client.state.settings = withModes;
    client.settingsState = { values: { ...defaults, "socratic.questions": "few" }, pending: [] };
    await renderIn("en", <HarnessSettingsTab client={client} view={withModes} />);
    await screen.findByRole("group", { name: "Questions" });
    expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual(["How the AI talks", "Help", "Socratic"]);
    fireEvent.click(within(screen.getByRole("group", { name: "Questions" })).getByRole("button", { name: "Many" }));
    expect(client.settingsSets).toEqual([{ field: "socratic.questions", value: "many" }]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `corepack pnpm vitest run packages/ui/test/recommend-mode.test.tsx packages/ui/test/harness-settings.test.tsx`
Expected: FAIL (the modules don't exist). The settings case may already pass: the tab draws sections by id, and Task 3 made the view; it stays as the regression test of that path.

- [ ] **Step 3: The helpers**

Create `packages/ui/src/modes.ts`:

```ts
import type { Tier } from "@humanharness/harness-sdk";
import type { AppState } from "./client";

/** The window's own copy of the tier order (the sdk's `tierBelow` lives on the main side of the bundle). */
const ORDER: Tier[] = ["light", "standard", "deep"];

/** `a` is a lower tier than `b`. */
export const tierBelow = (a: Tier, b: Tier): boolean => ORDER.indexOf(a) < ORDER.indexOf(b);

/** A mode as the window lists it. */
export interface ModeOption {
  id: string;
  label: string;
  description?: string;
  minTier?: Tier;
}

/** The modes a task of `action` may work in, in the action's order; none without modes (D0). */
export function actionModes(state: Pick<AppState, "actions" | "modes">, action: string | undefined): ModeOption[] {
  const modes = state.modes;
  if (!modes || action === undefined || !Object.hasOwn(state.actions, action)) return [];
  return (state.actions[action].modes ?? []).flatMap((id) => (Object.hasOwn(modes, id) ? [{ id, ...modes[id] }] : []));
}

/** A `recommend_mode` block's data, as the window may trust it. */
export interface Recommendation {
  recommended: string;
  reasons: string[];
  alternatives: { mode: string; why: string }[];
}

/**
 * The block's data, keeping only well-formed fields (the agent wrote them) and modes in `allowed` (the action's).
 * Null when the recommended mode isn't one of them or there is no reason left.
 */
export function readRecommendation(data: unknown, allowed: string[]): Recommendation | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { recommended?: unknown; reasons?: unknown; alternatives?: unknown };
  if (typeof d.recommended !== "string" || !allowed.includes(d.recommended)) return null;
  const reasons = (Array.isArray(d.reasons) ? d.reasons : []).filter((r): r is string => typeof r === "string" && r.length > 0).slice(0, 3);
  if (reasons.length === 0) return null;
  const seen = new Set([d.recommended]);
  const alternatives: Recommendation["alternatives"] = [];
  for (const a of Array.isArray(d.alternatives) ? d.alternatives : []) {
    const x = (a ?? {}) as { mode?: unknown; why?: unknown };
    if (typeof x.mode !== "string" || !allowed.includes(x.mode) || seen.has(x.mode)) continue;
    if (typeof x.why !== "string" || !x.why) continue;
    seen.add(x.mode);
    alternatives.push({ mode: x.mode, why: x.why });
    if (alternatives.length === 2) break;
  }
  return { recommended: d.recommended, reasons, alternatives };
}
```

- [ ] **Step 4: The list and the bar**

Create `packages/ui/src/ModeList.tsx`:

```tsx
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ModeOption } from "./modes";

/** The modes as buttons, each with its description; the current one pressed. */
export function ModeList({
  modes,
  current,
  disabled,
  onPick,
  labelledBy,
}: {
  modes: ModeOption[];
  current?: string;
  disabled: boolean;
  onPick: (id: string) => void;
  /** The id of the text that names the list. */
  labelledBy: string;
}) {
  return (
    <div className="hh-mode-list" role="group" aria-labelledby={labelledBy}>
      {modes.map((m) => (
        <button key={m.id} type="button" className="hh-choice" aria-pressed={m.id === current} disabled={disabled} onClick={() => onPick(m.id)}>
          <strong>{m.label}</strong>
          {m.description && <span className="hh-mode-reasons">{m.description}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * The open task's mode, above the chat (task-modes spec §5): its name, "Change mode", and a note when the task runs
 * below the level the mode asks for. Only for a task whose action has modes.
 */
export function ModeBar({
  modes,
  current,
  below,
  disabled,
  onPick,
}: {
  modes: ModeOption[];
  current?: string;
  below?: boolean;
  disabled: boolean;
  onPick: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const changeId = useId();
  const label = modes.find((m) => m.id === current)?.label;
  return (
    <div className="hh-mode-bar" role="group" aria-label={t("modes.bar")}>
      <span>{label ? t("modes.current", { mode: label }) : t("modes.none")}</span>
      {below && label && <span className="hh-caption">{t("modes.belowTier")}</span>}
      <button type="button" id={changeId} aria-expanded={open} disabled={disabled} onClick={() => setOpen((o) => !o)}>
        {t("modes.change")}
      </button>
      {open && !disabled && (
        <ModeList
          modes={modes}
          current={current}
          disabled={disabled}
          labelledBy={changeId}
          onPick={(id) => {
            setOpen(false);
            onPick(id);
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5: The block**

In `packages/ui/src/Message.tsx`, add `type ModeView` to the `./client` import, and in `BlockProps`, after `answerOf?`, add:

```ts
  /**
   * Task modes (task-modes spec §5): picks a mode for the open task. True only when the switch was sent (not while
   * the tier question waits, nor when refused). Absent without modes (D0), and on a block of an earlier task.
   */
  chooseMode?: (mode: string) => boolean;
  /** The harness's modes as the window shows them, the action's modes (`allowed`), and the task's mode now. */
  modes?: { views: Record<string, ModeView>; allowed: string[]; current?: string };
```

Create `packages/ui/src/RecommendModeBlock.tsx`:

```tsx
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { BlockProps } from "./Message";
import { ModeList } from "./ModeList";
import { readRecommendation } from "./modes";

/**
 * The core `recommend_mode` block (task-modes spec §4): the agent's recommendation first, with its reasons, then the
 * alternatives, then every mode of the action. A pick goes to the app, which switches the task's mode.
 */
export function RecommendModeBlock({ data, chooseMode, modes, active }: BlockProps) {
  const { t } = useTranslation();
  const id = useId();
  const allId = useId();
  const [picked, setPicked] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  if (!modes) return null;
  const r = readRecommendation(data, modes.allowed);
  if (!r) return null;
  const usable = active && chooseMode !== undefined && picked === null;
  const label = (m: string) => modes.views[m]?.label ?? m;
  const pick = (m: string) => {
    // Marked only once sent: a switch waiting for the tier answer (or refused) leaves every mode usable.
    if (chooseMode?.(m)) setPicked(m);
  };
  return (
    <section className="hh-recommend">
      <h3 id={id}>{t("modes.recommendTitle")}</h3>
      <div className="hh-choice-list" role="group" aria-labelledby={id}>
        <button type="button" className="hh-choice hh-recommended" aria-pressed={picked === r.recommended} disabled={!usable} onClick={() => pick(r.recommended)}>
          <strong>{label(r.recommended)}</strong>
          <span className="hh-badge">{t("modes.recommended")}</span>
          <span className="hh-mode-reasons">
            {r.reasons.map((reason, i) => (
              <span key={i}>{reason}</span>
            ))}
          </span>
        </button>
        {r.alternatives.map((a) => (
          <button key={a.mode} type="button" className="hh-choice" aria-pressed={picked === a.mode} disabled={!usable} onClick={() => pick(a.mode)}>
            <strong>{label(a.mode)}</strong>
            <span className="hh-mode-reasons">
              <span>{a.why}</span>
            </span>
          </button>
        ))}
      </div>
      <button type="button" id={allId} className="hh-link" aria-expanded={all} onClick={() => setAll((x) => !x)}>
        {t("modes.seeAll")}
      </button>
      {all && (
        <ModeList
          modes={modes.allowed.filter((m) => Object.hasOwn(modes.views, m)).map((m) => ({ id: m, ...modes.views[m] }))}
          current={modes.current}
          disabled={!usable}
          labelledBy={allId}
          onPick={pick}
        />
      )}
    </section>
  );
}
```

- [ ] **Step 6: The strings and the styles**

In `packages/i18n/src/locales/en.json`, after the `"choices"` object, add:

```json
  "modes": {
    "recommendTitle": "How do we work?",
    "recommended": "Recommended",
    "seeAll": "See all modes",
    "switched": "Switched to {{mode}}",
    "bar": "Task mode",
    "current": "Mode: {{mode}}",
    "none": "No mode chosen yet",
    "change": "Change mode",
    "belowTier": "Running below the level this mode asks for",
    "askTitle": "How do you want to work?",
    "tierTitle": "{{mode}} asks for more power",
    "tierText": "It works best at the {{required}} level; this task runs at {{current}}.",
    "keepTier": "Continue with the current model",
    "newTask": "Start a new task with {{mode}}",
    "notNow": "Not now",
    "failed": "That didn't go through. Pick a mode again."
  },
```

In `packages/ui/src/styles.css`, after the `.hh-choice.next, .hh-choice[aria-pressed="true"]` rule, add:

```css
.hh-recommend { display: grid; gap: 8px; }
.hh-recommend .hh-choice, .hh-mode-list .hh-choice { flex-direction: column; align-items: flex-start; gap: 4px; }
.hh-badge { display: inline-block; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--hh-line-strong); font-size: 12px; color: var(--hh-muted); }
.hh-choice[aria-pressed="true"] .hh-badge, .hh-choice[aria-pressed="true"] .hh-mode-reasons { color: var(--hh-on-ink); border-color: var(--hh-on-ink); }
.hh-mode-reasons { display: grid; gap: 2px; color: var(--hh-muted); font-size: 13px; line-height: 1.4; }
.hh-mode-list { display: flex; flex-wrap: wrap; gap: 8px; }
.hh-mode-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 16px; border-bottom: 1px solid var(--hh-line); }
.hh-mode-bar .hh-mode-list { flex-basis: 100%; }
.hh-mode-line { margin: 0; text-align: center; color: var(--hh-muted); font-size: 13px; }
```

(If `.hh-link` doesn't exist in the stylesheet, add `.hh-link { height: auto; padding: 0; border: none; background: transparent; color: var(--hh-ink); text-decoration: underline; }`.)

- [ ] **Step 7: Run the tests**

Run: `corepack pnpm vitest run packages/ui/test`
Expected: PASS (`styles.test.ts` included: the new rules use tokens only).

- [ ] **Step 8: Verify and commit**

Run: `corepack pnpm typecheck` and `corepack pnpm test`
Expected: both green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/ui/src/modes.ts packages/ui/src/ModeList.tsx packages/ui/src/RecommendModeBlock.tsx packages/ui/src/Message.tsx packages/i18n/src/locales/en.json packages/ui/src/styles.css packages/ui/test/recommend-mode.test.tsx packages/ui/test/harness-settings.test.tsx
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(ui): recommend_mode block, mode list and mode bar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 13: The chat: the mode bar, the switch, the tier question, the "ask" picker and the system line

**Files:**
- Modify: `packages/ui/src/state.ts`, `packages/ui/src/Message.tsx`, `packages/ui/src/ChatView.tsx`
- Test: `packages/ui/test/modes.test.tsx` (new), `packages/ui/test/state.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/ui/test/state.test.ts`:

```ts
describe("reduceChat: a mode switch's line (task-modes spec §5.4)", () => {
  it("keeps the mode on the user entry; D0: no mode, no field", () => {
    const s = reduceChat(initialChat([]), { type: "user", text: "Switched to Socratic", at: "t", mode: "socratic" });
    expect(s.entries[0]).toMatchObject({ role: "user", text: "Switched to Socratic", mode: "socratic" });
    expect(reduceChat(initialChat([]), { type: "user", text: "Hi", at: "t" }).entries[0]).not.toHaveProperty("mode");
  });
});
```

Create `packages/ui/test/modes.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HarnessApp } from "../src";
import type { CurrentTaskView } from "../src/client";
import { FakeClient } from "./fake-client";

afterEach(cleanup);

const MODES = {
  socratic: { label: "Socratic", description: "Questions that lead you to the idea." },
  feynman: { label: "Feynman" },
  worked: { label: "Worked examples", minTier: "deep" as const },
};
const RECOMMEND = {
  name: "recommend_mode",
  id: "t1:0:0",
  data: { recommended: "socratic", reasons: ["One key idea to discover."], alternatives: [{ mode: "feynman", why: "To explain it back." }] },
};

function coachClient(opts: { modes?: boolean; current?: Partial<CurrentTaskView> | null; defaultMode?: string } = {}) {
  const client = new FakeClient({ language: "en", folder: "/Users/me/Documents/Coach", engineId: "claude" });
  client.state.actions = {
    study: { label: "Study", cost: "light", ...(opts.modes === false ? {} : { modes: ["socratic", "feynman", "worked"], defaultMode: opts.defaultMode ?? "recommend" }) },
    quiz: { label: "Quiz", cost: "light" },
  };
  client.state.path = ["study", "quiz"];
  if (opts.modes !== false) client.state.modes = MODES;
  if (opts.current !== null) {
    client.chat = [
      { id: "u", role: "user", text: "Study", blocks: [], activities: [], at: "t", action: "study", task: "t1" },
      { id: "a", role: "assistant", text: "Let's pick a way.", blocks: (opts.modes === false ? [] : [RECOMMEND]) as never, activities: [], at: "t", task: "t1" },
    ];
    client.tasks = {
      current: { id: "t1", action: "study", status: "waiting", ...(opts.modes === false ? {} : { tier: "standard" as const }), ...opts.current },
      actions: {},
      notes: [],
    };
  }
  return client;
}

async function open(client: FakeClient, text = "Let's pick a way.") {
  render(<HarnessApp client={client} blocks={{}} />);
  const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
  await waitFor(() => expect(start.disabled).toBe(false));
  fireEvent.click(start);
  if (text) await screen.findByText(text);
}

const bar = () => screen.getByRole("group", { name: "Task mode" });

describe("task modes in the chat", () => {
  it("D0: an action without modes has no mode bar and no recommendation block", async () => {
    await open(coachClient({ modes: false }));
    expect(screen.queryByRole("group", { name: "Task mode" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Change mode" })).toBeNull();
  });

  it("the recommended mode switches the task: a system line, then the mode bar names it", async () => {
    const client = coachClient();
    await open(client);
    expect(bar().textContent).toContain("No mode chosen yet");
    fireEvent.click(within(screen.getByRole("group", { name: "How do we work?" })).getAllByRole("button")[0]);
    await waitFor(() => expect(client.modeChoices).toEqual([{ mode: "socratic", choice: {} }]));
    const line = await screen.findByText("Switched to Socratic");
    expect(line.className).toBe("hh-mode-line");
    act(() => {
      client.emit({ type: "text", delta: "What do you think a half is?" });
      client.emit({ type: "done", ok: true });
      client.emitTasks({ ...client.tasks, current: { ...client.tasks.current!, mode: "socratic", modes: ["socratic"] } });
    });
    await waitFor(() => expect(bar().textContent).toContain("Mode: Socratic"));
  });

  it("a mode above the task's tier asks first: continue, or a new task in that mode", async () => {
    const client = coachClient();
    await open(client);
    fireEvent.click(within(bar()).getByRole("button", { name: "Change mode" }));
    fireEvent.click(within(bar()).getByRole("button", { name: "Worked examples" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Worked examples asks for more power");
    expect(dialog.textContent).toContain("It works best at the Deep level; this task runs at Standard.");
    expect(client.modeChoices).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue with the current model" }));
    await waitFor(() => expect(client.modeChoices).toEqual([{ mode: "worked", choice: { belowTier: "continue" } }]));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("'Start a new task' puts the new task on screen", async () => {
    const client = coachClient();
    client.modeResult = { ok: true, switched: "new-task" };
    await open(client);
    fireEvent.click(within(bar()).getByRole("button", { name: "Change mode" }));
    fireEvent.click(within(bar()).getByRole("button", { name: "Worked examples" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Start a new task with Worked examples" }));
    await waitFor(() => expect(client.modeChoices).toEqual([{ mode: "worked", choice: { belowTier: "new-task" } }]));
    await waitFor(() => expect(screen.queryByText("Let's pick a way.")).toBeNull());
  });

  it("a refusal the window didn't foresee says so and leaves the block usable", async () => {
    const client = coachClient();
    client.modeResult = { ok: false, reason: "unknown" };
    await open(client);
    fireEvent.click(within(screen.getByRole("group", { name: "How do we work?" })).getAllByRole("button")[1]);
    expect((await screen.findByRole("alert")).textContent).toBe("That didn't go through. Pick a mode again.");
    const again = within(screen.getByRole("group", { name: "How do we work?" })).getAllByRole("button")[1] as HTMLButtonElement;
    expect(again.disabled).toBe(false);
  });

  it("the main process's tier refusal opens the same question", async () => {
    const client = coachClient({ current: { tier: undefined } });
    client.modeResult = { ok: false, reason: "tier", required: "deep", current: "light" };
    await open(client);
    fireEvent.click(within(bar()).getByRole("button", { name: "Change mode" }));
    fireEvent.click(within(bar()).getByRole("button", { name: "Worked examples" }));
    expect((await screen.findByRole("alertdialog")).textContent).toContain("this task runs at Light.");
  });

  it("'ask': starting the action shows its modes first and sends the pick with it", async () => {
    const client = coachClient({ current: null, defaultMode: "ask" });
    await open(client, "");
    fireEvent.click((await screen.findAllByRole("button", { name: "Study" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "How do you want to work?" });
    expect(client.sent).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Feynman" }));
    await waitFor(() => expect(client.sentOptions.at(-1)).toEqual({ action: "study", mode: "feynman" }));
    expect(screen.queryByRole("dialog", { name: "How do you want to work?" })).toBeNull();
  });

  it("a saved switch shows as a system line, never as the person's message", async () => {
    const client = coachClient();
    client.chat.push({ id: "s", role: "user", text: "Switched to Feynman", blocks: [], activities: [], at: "t", task: "t1", mode: "feynman" });
    await open(client);
    const line = screen.getByText("Switched to Feynman");
    expect(line.className).toBe("hh-mode-line");
    expect(line.closest("article")?.querySelector(".hh-who")).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `corepack pnpm vitest run packages/ui/test/modes.test.tsx packages/ui/test/state.test.ts`
Expected: FAIL (no mode bar, no `recommend_mode` component, `mode` not on the user action).

- [ ] **Step 3: The reducer and the line**

`packages/ui/src/state.ts`:
- change the action to `| { type: "user"; text: string; at: string; action?: string; mode?: string }`;
- in `case "user":`, after the `action` spread, add `...(action.mode ? { mode: action.mode } : {}),`.

`packages/ui/src/Message.tsx`:
- change `entry`'s type to `Pick<ChatEntry, "role" | "text" | "blocks" | "activities" | "parts" | "mode">`;
- before `return (`, add:

```tsx
  // A mode switch the person picked (task-modes spec §5.4): a system line, not their message.
  if (entry.role === "user" && entry.mode) {
    return (
      <article className="hh-message system">
        <p className="hh-mode-line">{entry.text}</p>
      </article>
    );
  }
```

- [ ] **Step 4: The chat view**

In `packages/ui/src/ChatView.tsx`:

1. Imports: add `type ModeChoice` to the `./client` import; add

```ts
import { ModeBar, ModeList } from "./ModeList";
import { actionModes, tierBelow } from "./modes";
import { RecommendModeBlock } from "./RecommendModeBlock";
```

and add `type Tier` from `@humanharness/harness-sdk` (type-only).

2. After `StaleChoices`, add:

```tsx
/** A `recommend_mode` block of an earlier task, or once the conversation moved on: drawn, never usable. */
const StaleRecommend = (props: BlockProps) => <RecommendModeBlock {...props} active={false} chooseMode={undefined} />;
```

3. After `const [pickResets, setPickResets] = useState(0);`, add:

```tsx
  /** The tier question (task-modes spec §5.3): the mode asks for more than the task's tier. */
  const [tierAsk, setTierAsk] = useState<{ mode: string; task: string; required: Tier; current: Tier } | null>(null);
  /** `defaultMode: "ask"`: the start waits for the person's mode (no model call before it). */
  const [askPick, setAskPick] = useState<{ text: string; options: SendOptions } | null>(null);
  /** The last mode pick was refused or failed (shown until the next pick or message). */
  const [modeFailed, setModeFailed] = useState(false);
  /** The last thing sent was a mode switch: Try again picks it again. */
  const lastMode = useRef<{ mode: string; task: string; belowTier?: ModeChoice["belowTier"] } | null>(null);
  const tierRef = useRef<HTMLDivElement>(null);
```

4. Change `all` and `stale`:

```tsx
  const all = useMemo(
    () => ({
      ...components,
      choices: ChoicesBlock as ComponentType<BlockProps>,
      ...(state.inputs ? { annotate: AnnotateBlock } : {}),
      // Only a harness with modes has the block (task-modes D0).
      ...(state.modes ? { recommend_mode: RecommendModeBlock } : {}),
    }),
    [components, state.inputs, state.modes],
  );
  const stale = useMemo(() => ({ ...all, choices: StaleChoices, ...(state.modes ? { recommend_mode: StaleRecommend } : {}) }), [all, state.modes]);
```

5. In `send`, change the first guard and add the ask picker before the pre-flight check:

```tsx
    if (!message || blocked() || (pending && !confirmed) || (askPick && !options.mode)) return false;
```

```tsx
    // `defaultMode: "ask"` (task-modes spec §3): the person picks how to work before anything is sent.
    if (options.action && !options.mode && state.actions[options.action]?.defaultMode === "ask" && actionModes(state, options.action).length > 0) {
      setAskPick({ text: message, options });
      return true;
    }
```

and after `setPickFailed(false);` in `send`, add `setModeFailed(false);` and `lastMode.current = null;`. Do the same two lines in `choose` (after its `setPickFailed(false);`) and in `respondTo` (after its `setPickFailed(false);`).

6. After `choose`, add:

```tsx
  /**
   * The person picks a mode for task `task` (task-modes spec §5). Above the task's tier, the question comes first;
   * `belowTier` is its answer. True only when the switch was sent.
   */
  const chooseMode = (mode: string, task: string | undefined, belowTier?: ModeChoice["belowTier"]): boolean => {
    if (blocked() || pending) return false;
    const current = tasks.current;
    if (!task || task !== current?.id || current.status !== "waiting" || mode === current.mode) return false;
    const view = state.modes?.[mode];
    if (!view) return false;
    if (!belowTier && view.minTier && current.tier && tierBelow(current.tier, view.minTier)) {
      setTierAsk({ mode, task, required: view.minTier, current: current.tier });
      return false;
    }
    busy.current = true;
    stick.current = true;
    lastPick.current = null;
    lastAnswer.current = false;
    lastMode.current = { mode, task, ...(belowTier ? { belowTier } : {}) };
    setPickFailed(false);
    setModeFailed(false);
    const failed = () => {
      busy.current = false;
      setModeFailed(true);
      // The blocks are drawn afresh, so the mode can be picked again.
      setPickResets((n) => n + 1);
    };
    client
      .chooseMode(mode, belowTier ? { belowTier } : {})
      .then((r) => {
        const at = new Date().toISOString();
        if (r.ok && r.switched === "turn") {
          pinNext.current = true;
          dispatch({ type: "user", text: t("modes.switched", { mode: view.label }), at, mode });
        } else if (r.ok && r.switched === "new-task") {
          pinNext.current = true;
          showNewTask();
          dispatch({ type: "user", text: labelOf(current.action!), at, action: current.action });
        } else if (r.ok) {
          // "quiet" or "same": nothing runs; the tasks view brings the mode.
          busy.current = false;
        } else if (r.reason === "tier" && r.required && r.current) {
          busy.current = false;
          setTierAsk({ mode, task, required: r.required, current: r.current });
        } else failed();
      })
      .catch(failed);
    return true;
  };
  /** The tier question's answer (or "Not now"): the question closes first. */
  const answerTier = (belowTier?: ModeChoice["belowTier"]) => {
    const ask = tierAsk;
    setTierAsk(null);
    if (ask && belowTier) chooseMode(ask.mode, ask.task, belowTier);
    else inputRef.current?.focus();
  };
```

7. In `blockActions`, add after `active,`:

```tsx
    ...(state.modes
      ? {
          chooseMode: (mode: string) => chooseMode(mode, task),
          modes: {
            views: state.modes,
            // The open task's action's modes; a block of another task is drawn disabled anyway.
            allowed: task === tasks.current?.id ? actionModes(state, tasks.current?.action).map((m) => m.id) : Object.keys(state.modes),
            ...(task === tasks.current?.id && tasks.current?.mode ? { current: tasks.current.mode } : {}),
          },
        }
      : {}),
```

8. In `retry`, before the `pick` lines, add:

```tsx
    const mode = lastMode.current;
    if (mode && mode.task === tasks.current?.id) return () => void chooseMode(mode.mode, mode.task, mode.belowTier);
```

9. In the JSX, as the first child of `<main className="hh-main">`, add:

```tsx
          {flow && since !== null && tasks.current && taskModes.length > 0 && (
            <ModeBar
              modes={taskModes}
              current={tasks.current.mode}
              below={tasks.current.belowMinTier === true}
              disabled={blocked() || tasks.current.status !== "waiting"}
              onPick={(mode) => void chooseMode(mode, tasks.current?.id)}
            />
          )}
```

with, before `return (`: `const taskModes = actionModes(state, tasks.current?.action);`.

10. After the `pickFailed` paragraph, add:

```tsx
            {modeFailed && (
              <p className="hh-error" role="alert">
                {t("modes.failed")}
              </p>
            )}
```

11. After the pre-flight `alertdialog`, add the two questions:

```tsx
            {tierAsk && (
              <div
                ref={tierRef}
                className="hh-confirm"
                role="alertdialog"
                aria-labelledby="hh-tier-title"
                aria-describedby="hh-tier-text"
                onKeyDown={(e) => {
                  if (e.key !== "Escape") return;
                  e.preventDefault();
                  answerTier();
                }}
              >
                <p id="hh-tier-title">
                  <strong className="hh-warn">{t("modes.tierTitle", { mode: state.modes?.[tierAsk.mode]?.label ?? tierAsk.mode })}</strong>
                </p>
                <p id="hh-tier-text">
                  {t("modes.tierText", { required: t(`models.tier.${tierAsk.required}`), current: t(`models.tier.${tierAsk.current}`) })}
                </p>
                <button className="hh-primary" onClick={() => answerTier("continue")}>
                  {t("modes.keepTier")}
                </button>
                <button onClick={() => answerTier("new-task")}>{t("modes.newTask", { mode: state.modes?.[tierAsk.mode]?.label ?? tierAsk.mode })}</button>
                <button onClick={() => answerTier()}>{t("modes.notNow")}</button>
              </div>
            )}
            {askPick && (
              <div
                className="hh-confirm"
                role="dialog"
                aria-labelledby="hh-ask-title"
                onKeyDown={(e) => {
                  if (e.key !== "Escape") return;
                  e.preventDefault();
                  setAskPick(null);
                }}
              >
                <p id="hh-ask-title">
                  <strong>{t("modes.askTitle")}</strong>
                </p>
                <ModeList
                  modes={actionModes(state, askPick.options.action)}
                  disabled={false}
                  labelledBy="hh-ask-title"
                  onPick={(mode) => {
                    const p = askPick;
                    setAskPick(null);
                    send(p.text, { ...p.options, mode });
                  }}
                />
                <button onClick={() => setAskPick(null)}>{t("modes.notNow")}</button>
              </div>
            )}
```

12. Focus: in the effect that focuses the pre-flight question when `pending` opens (search for `notNowRef.current?.focus()`), add a sibling effect:

```tsx
  // The tier question takes focus when it opens, like the pre-flight one.
  useEffect(() => {
    if (tierAsk) tierRef.current?.querySelector("button")?.focus();
  }, [tierAsk]);
```

- [ ] **Step 5: Run the tests**

Run: `corepack pnpm vitest run packages/ui/test`
Expected: PASS, every existing UI test unchanged (D0: no `state.modes`, nothing new is drawn or offered).

- [ ] **Step 6: Verify and commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test` and `corepack pnpm app:build`
Expected: all green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/ui/src/state.ts packages/ui/src/Message.tsx packages/ui/src/ChatView.tsx packages/ui/test/modes.test.tsx packages/ui/test/state.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(ui): mode bar, mode switch, tier question and ask picker in the chat

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

## Phase 4 — Authoring, docs and end to end (spec §3 `check`, plan 4a)

### Task 14: `humanharness check` reads the mode briefs

**Files:**
- Modify: `packages/cli/src/check.ts`
- Test: `packages/cli/test/check.test.ts`

The structural checks of spec §3 (`check`) are schema errors from Task 1 (`check` reports them as `schema` findings with their path). What `defineHarness` can't see is the brief files: `loadHarness` only checks that their paths stay in the harness folder.

- [ ] **Step 1: Write the failing test**

In `packages/cli/test/check.test.ts`, inside `describe("check: errors", …)`, after the `"brief-missing: a missing or empty brief"` case, add:

```ts
  it("brief-missing: a mode's brief that is missing or empty (task-modes spec §3); D0: the template has no modes", async () => {
    const dir = await fixture((d) => {
      replaceIn(d, "harness.config.ts", 'cost: "light",', 'cost: "light",\n      modes: ["plain", "empty", "gone"],');
      replaceIn(
        d,
        "harness.config.ts",
        'questions: { tier: "light" },',
        'questions: { tier: "light" },\n  modes: {\n    plain: { label: "Plain", brief: "./agent/modes/plain.md" },\n    empty: { label: "Empty", brief: "./agent/modes/empty.md" },\n    gone: { label: "Gone", brief: "./agent/modes/gone.md" },\n  },',
      );
      fs.mkdirSync(path.join(d, "agent", "modes"));
      fs.writeFileSync(path.join(d, "agent", "modes", "plain.md"), "Work plainly, in {{language}}.\n");
      fs.writeFileSync(path.join(d, "agent", "modes", "empty.md"), " \n");
    });
    const r = await checkHarness(dir);
    expect(r.findings.filter((f) => f.rule === "brief-missing").map((f) => `${f.file} ${f.message}`)).toEqual([
      "agent/modes/empty.md Mode \"empty\": its brief ./agent/modes/empty.md is empty.",
      "harness.config.ts Mode \"gone\": its brief ./agent/modes/gone.md does not exist.",
    ]);
    expect(errors(r).filter((f) => f.rule !== "brief-missing")).toEqual([]);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm vitest run packages/cli/test/check.test.ts`
Expected: FAIL (no `brief-missing` finding for modes).

- [ ] **Step 3: Implement**

In `packages/cli/src/check.ts`, after `briefFindings`, add:

```ts
/** Every mode's brief exists and says something (task-modes spec §3 `check`). No modes: nothing (D0). */
async function modeFindings(h: LoadedHarness): Promise<Finding[]> {
  const out: Finding[] = [];
  for (const [id, mode] of Object.entries(h.modes)) {
    const file = resolveInHarness(h, mode.brief);
    const text = await read(file);
    if (text === null) out.push(error("brief-missing", `Mode "${id}": its brief ${mode.brief} does not exist.`, MANIFEST));
    else if (!text.trim()) out.push(error("brief-missing", `Mode "${id}": its brief ${mode.brief} is empty.`, path.relative(h.root, file)));
  }
  return out;
}
```

and in `checkHarness`, right after `findings.push(...briefFindings(harness, briefs));`, add `findings.push(...(await modeFindings(harness)));`.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run packages/cli/test/check.test.ts`
Expected: PASS; "finds no error in the untouched template" still passes (D0).

- [ ] **Step 5: Verify and commit**

Run: `corepack pnpm typecheck` and `corepack pnpm test`
Expected: both green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/cli/src/check.ts packages/cli/test/check.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(cli): check reports missing or empty mode briefs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 15: `humanharness run --mode`, `m <id>`, the terminal's `recommend_mode`, and the `coach` fixture

**Files:**
- Create: `packages/fake-agent/fixtures/modes-harness/harness.config.ts`, `…/ui/App.tsx`, `…/agent/AGENTS.md`, `…/agent/tasks/study.md`, `…/agent/tasks/quiz.md`, `…/agent/modes/socratic.md`, `…/agent/modes/feynman.md`, `…/agent/modes/worked.md`
- Modify: `packages/cli/src/run.ts`, `packages/cli/src/terminal.ts`
- Test: `packages/cli/test/run.test.ts`, `packages/cli/test/terminal.test.ts`

- [ ] **Step 1: The fixture**

`packages/fake-agent/fixtures/modes-harness/harness.config.ts`:

```ts
// Test fixture for task modes: a tiny coach whose Study task works in one of three modes, and a Quiz with none.
import { z } from "zod";
import { defineHarness } from "@humanharness/harness-sdk";

export default defineHarness({
  id: "coach",
  name: "Coach",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Human Harness Coach" },
  instructions: "./agent/AGENTS.md",
  permissions: { edit: "none", exec: false, web: false },
  blocks: {},
  actions: {
    study: { label: "Study", prompt: "./agent/tasks/study.md", cost: "light", modes: ["socratic", "feynman", "worked"], defaultMode: "recommend" },
    quiz: { label: "Quiz", prompt: "./agent/tasks/quiz.md", cost: "light" },
  },
  path: ["study", "quiz"],
  modes: {
    socratic: {
      label: "Socratic",
      description: "Questions that lead you to the idea.",
      brief: "./agent/modes/socratic.md",
      recommend: "Good when the topic has one key idea to discover.",
      settings: {
        questions: {
          schema: z.enum(["few", "many"]),
          default: "few",
          control: "segmented",
          label: "Questions",
          options: { few: "Few", many: "Many" },
          agent: "Ask {{value}} questions before explaining.",
        },
      },
    },
    feynman: { label: "Feynman", description: "You explain it back in plain words.", brief: "./agent/modes/feynman.md" },
    worked: { label: "Worked examples", description: "See it solved, then try one.", brief: "./agent/modes/worked.md", minTier: "deep" },
  },
  // Mode settings are drawn in the harness's Settings tab: it needs one, even with no field of its own.
  settings: { tab: "How I learn", fields: {} },
  author: "Human Harness tests",
});
```

`…/ui/App.tsx`:

```tsx
import { type HarnessClient, HarnessApp } from "@humanharness/ui";

// Only the core screens: the mode bar, the recommendation and the Settings tab come from the manifest.
export default function App({ client }: { client: HarnessClient }) {
  return <HarnessApp client={client} />;
}
```

`…/agent/AGENTS.md`:

```md
# Coach

You help the person learn one small idea at a time, in the way of working they pick.
```

`…/agent/tasks/study.md`:

```md
# Task: study

Help the person understand one idea about fractions. Answer in {{language}}.

{{notesIndex}}
```

`…/agent/tasks/quiz.md`:

```md
# Task: quiz

Ask three short questions about what was studied, then offer the next step with `show_choices`. Answer in {{language}}.

{{notesIndex}}
```

`…/agent/modes/socratic.md`: `Lead with questions; let the person find the idea before you name it. Answer in {{language}}.`
`…/agent/modes/feynman.md`: `Ask the person to explain the idea back in plain words, then fix the gaps. Answer in {{language}}.`
`…/agent/modes/worked.md`: `Solve one example step by step, then give the person a similar one. Answer in {{language}}.`

- [ ] **Step 2: Write the failing tests**

Append to `packages/cli/test/run.test.ts`:

```ts
describe("run: task modes", () => {
  const coach = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/modes-harness");
  const coachScript: ClaudeScript = {
    steps: [...claudeTextLines("Done."), result],
    turns: [
      { match: "save_note", steps: [ui("save_note", { title: "Halves", summary: ["x"], decisions: [], files: [], open: [] }), result] },
      { match: 'From now on work in the mode "Worked examples"', steps: [...claudeTextLines("Step one."), result] },
      { match: 'From now on work in the mode "Feynman"', steps: [...claudeTextLines("Explain it to me."), result] },
      {
        match: "# Task: study",
        steps: [
          ...claudeTextLines("Let's pick a way."),
          ui("show_recommend_mode", { recommended: "socratic", reasons: ["One key idea."], alternatives: [{ mode: "feynman", why: "To say it back." }] }),
          result,
        ],
      },
    ],
  };
  const run = (name: string, input: string, extra: { mode?: string } = {}) => {
    const out = memoryStream();
    const prompts = path.join(root, `${name}-prompts.jsonl`);
    const folder = path.join(root, name);
    const done = runTask({
      harnessDir: coach,
      action: "study",
      engine: "claude",
      folder,
      ...extra,
      input: lines(input),
      output: out.stream,
      engineCommand: { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(root, coachScript), HH_FAKE_PROMPTS: prompts } },
    });
    return { done, out, folder, prompts: () => readJsonl(prompts).map((p) => (p as { prompt: string }).prompt) };
  };

  it("recommends first, then `m <id>` switches in the same session; a tier refusal says so and goes on", { timeout: 60_000 }, async () => {
    const r = run("coach-switch", "m feynman\nm worked\nq\n");
    await r.done;
    const text = r.out.text();
    expect(text).toContain("Recommended mode: socratic");
    expect(text).toContain("Or:\n    feynman: To say it back.");
    expect(text).toContain("Type m <mode> to pick one.");
    expect(text).toContain("m <mode> to switch mode");
    expect(text).toContain("Worked examples asks for the deep tier; this run is at standard. Switching anyway; rerun with --tier deep --mode worked for it.");
    const [first, feynman, worked] = r.prompts();
    expect(first).toContain("## How to work");
    expect(feynman).toContain('From now on work in the mode "Feynman"');
    expect(worked).toContain('From now on work in the mode "Worked examples"');
    const usage = readJsonl(path.join(r.folder, ".harness", "usage.jsonl"));
    expect(usage.map((u) => u.mode)).toEqual([undefined, "feynman", "worked", "worked"]);
    const note = fs.readFileSync(path.join(r.folder, ".harness", "notes", "study.md"), "utf8");
    expect(note).toContain('modes: ["feynman","worked"]');
  });

  it("--mode starts in that mode, its brief and default settings after the action's", { timeout: 60_000 }, async () => {
    const r = run("coach-mode", "q\n", { mode: "socratic" });
    await r.done;
    expect(r.prompts()[0]).toContain("## Mode: Socratic\n\nWork in this mode.\n\nLead with questions; let the person find the idea before you name it. Answer in English.\n\n- Ask few questions before explaining.");
    expect(JSON.parse(fs.readFileSync(path.join(r.folder, ".harness", "tasks.json"), "utf8")).actions).toEqual({ study: "done" });
  });

  it("refuses a mode the action doesn't list, before anything runs", async () => {
    await expect(run("coach-bad", "q\n", { mode: "nope" }).done).rejects.toThrow('Unknown mode "nope" for study. Modes: socratic, feynman, worked.');
    expect(fs.existsSync(path.join(root, "coach-bad"))).toBe(false);
  });

  it("humanharness run parses --mode", async () => {
    const m = memoryIo(root);
    expect(await main(["run", "study", "--mode", "Bad Mode", "--harness", coach], m.io)).toBe(2);
    expect(m.err()).toContain('Invalid mode "Bad Mode": use a mode id from the manifest.');
  });
});
```

Inside `describe("TerminalView", …)` in `packages/cli/test/terminal.test.ts`, add (like `choices`, the block starts on a fresh line after an empty one):

```ts
it("draws recommend_mode as text with how to pick; malformed data draws nothing", () => {
  const out = memoryStream();
  const view = new TerminalView(out.stream, "Claude", false, {});
  view.event({ type: "block", name: "recommend_mode", data: { recommended: "socratic", reasons: ["One key idea."], alternatives: [{ mode: "feynman", why: "To say it back." }] } });
  view.event({ type: "block", name: "recommend_mode", data: { recommended: "Bad Id", reasons: [] } });
  expect(out.text()).toBe("\n  Recommended mode: socratic\n    - One key idea.\n  Or:\n    feynman: To say it back.\n  Type m <mode> to pick one.\n");
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `corepack pnpm vitest run packages/cli/test/run.test.ts packages/cli/test/terminal.test.ts`
Expected: FAIL (`mode` isn't a run option; `recommend_mode` prints as raw JSON).

- [ ] **Step 4: The terminal**

In `packages/cli/src/terminal.ts`, add `recommendModeSchema` to the sdk import, and in `block()`, after the `choices` branch, add:

```ts
    if (name === "recommend_mode") {
      const parsed = recommendModeSchema.safeParse(data);
      if (!parsed.success) return;
      this.newline();
      this.write("\n");
      this.line(`  Recommended mode: ${parsed.data.recommended}`);
      for (const reason of parsed.data.reasons) this.line(`    - ${reason}`);
      const alternatives = parsed.data.alternatives ?? [];
      if (alternatives.length > 0) {
        this.line("  Or:");
        for (const a of alternatives) this.line(`    ${a.mode}: ${a.why}`);
      }
      this.line("  Type m <mode> to pick one.");
      return;
    }
```

- [ ] **Step 5: `run`**

In `packages/cli/src/run.ts`:

1. Imports: add `MODE_ID`, `hasModes` and `modeSentences` to the `@humanharness/harness-sdk` import; add `nearestTier` to the `@humanharness/shell/tasks` import.
2. In `RunOptions`, after `tier?: Tier;`, add:

```ts
  /** Start the task in this mode (task-modes spec §3); one the action doesn't list is refused. Default: its defaultMode. */
  mode?: string;
```

3. Replace `promptFor` with:

```ts
const promptFor = (options: number, answerable = false, modes = false) => {
  // `m <mode>` only for a task whose action has modes (task-modes D0: the line is as before otherwise).
  const m = modes ? "m <mode> to switch mode, " : "";
  return options > 0
    ? `\nPick 1–${options}, ${answerable ? "a to answer, " : ""}${m}type a follow-up, or q to close the task: `
    : `\n${answerable ? `a to answer, ${m}or t` : modes ? `${m}or t` : "T"}ype a follow-up, or q to close the task: `;
};
```

4. In `runTask`, right after the unknown-action check, add:

```ts
  if (o.mode !== undefined && !(action.modes ?? []).includes(o.mode)) {
    throw new UsageError(`Unknown mode "${o.mode}" for ${o.action}. Modes: ${(action.modes ?? []).join(", ") || "(none)"}.`);
  }
```

5. Change `const store = new TaskStore(folder);` to:

```ts
  // tasks.json is read knowing the manifest's modes (task-modes spec §6), as the app does.
  const store = new TaskStore(folder, hasModes(harness) ? { modes: Object.keys(harness.modes) } : {});
```

6. In the `TaskManager` deps, after `fallbackFor`, add:

```ts
    // As the app wires them; undefined without modes (task-modes D0).
    ...(hasModes(harness)
      ? {
          modes: harness.modes,
          readModeBrief: (mode: string) => fs.readFile(resolveInHarness(harness, harness.modes[mode].brief), "utf8"),
          // Mode settings with the folder's stored values (run's --set covers the harness's own fields only).
          modeSettings: async (mode: string) =>
            harness.settings
              ? modeSentences(
                  harness.modes,
                  mode,
                  settingsValues(harness.settings, await dataStore.get(SETTINGS_COLLECTION, undefined, person).catch(() => null), harness.modes),
                )
              : [],
          tierOf: async (p: ModelProfile) => nearestTier(p, {}),
        }
      : {}),
```

(add `type ModelProfile` to the `@humanharness/engines` import) and change `profileFor` to take the floor:

```ts
    profileFor: async (id, floor) =>
      resolveProfile({
        engine: engine.id,
        action: id,
        manifestTier: id === undefined ? harness.questions?.tier : id === o.action && o.tier ? o.tier : harness.actions[id]?.tier,
        models: {},
        ...(floor ? { floor } : {}),
      }),
```

7. Change the start to `await tasks.start(o.action, undefined, scope, o.mode);`.
8. In the loop, compute the task's modes after `const options = view.choices;`:

```ts
        const modeIds = current.action && Object.hasOwn(harness.actions, current.action) && hasModes(harness) ? (harness.actions[current.action].modes ?? []) : [];
```

and pass them to the prompt: `out.write(promptFor(options.length, current.pendingInput !== undefined, modeIds.length > 0));`.

9. Before `const pick = Number(line);`, add:

```ts
        // `m <id>`: the person picks a mode (task-modes spec §5). A run can't change its tier mid-task, so a mode that
        // asks for more says so and switches anyway.
        if (modeIds.length > 0 && line.startsWith("m ")) {
          const mode = line.slice(2).trim();
          const label = Object.hasOwn(harness.modes, mode) ? harness.modes[mode].label : mode;
          recorder?.reply("*");
          let { accepted, done } = tasks.chooseMode(mode);
          done.catch(() => undefined);
          let r = await accepted;
          if (!r.ok && r.reason === "tier") {
            out.write(`\n${label} asks for the ${r.required} tier; this run is at ${r.current}. Switching anyway; rerun with --tier ${r.required} --mode ${mode} for it.\n`);
            await done;
            ({ accepted, done } = tasks.chooseMode(mode, { belowTier: "continue" }));
            done.catch(() => undefined);
            r = await accepted;
          }
          if (!r.ok) out.write(`\nNot switched (${r.reason}). Modes: ${modeIds.join(", ")}.\n`);
          else if (r.switched === "same") out.write(`\nAlready in ${label}.\n`);
          await done;
          continue;
        }
```

10. `RUN_USAGE`: insert `[--mode <id>] ` after `[--tier light|standard|deep] `.
11. In `runCommand`: add `mode: { type: "string" },` to the parsed options; after the tier check, add

```ts
  if (values.mode !== undefined && !MODE_ID.test(values.mode)) throw new UsageError(`Invalid mode "${values.mode}": use a mode id from the manifest.`);
```

and pass `...(values.mode ? { mode: values.mode } : {}),` after the `tier` spread.

- [ ] **Step 6: Run the tests**

Run: `corepack pnpm vitest run packages/cli/test`
Expected: PASS, every existing run case unchanged (D0: the template has no modes, the prompt line is as before).

- [ ] **Step 7: Verify and commit**

Run: `corepack pnpm typecheck` and `corepack pnpm test`
Expected: both green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/fake-agent/fixtures/modes-harness packages/cli/src/run.ts packages/cli/src/terminal.ts packages/cli/test/run.test.ts packages/cli/test/terminal.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(cli): run --mode and m <id>; terminal draws recommend_mode

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 16: Docs

**Files:**
- Create: `docs/architecture/modes.md`
- Modify: `docs/architecture/manifest.md`, `docs/architecture/blocks.md`, `docs/architecture/context.md`, `docs/architecture/settings.md`, `docs/architecture/authoring.md`, `docs/architecture/mock-mode.md`, `packages/cli/guide/new-harness.md`

- [ ] **Step 1: `docs/architecture/modes.md`**

```md
# Task modes

A mode is a way of working inside a task (Socratic, Feynman, worked examples; for a dev harness: plan, implement, review). The manifest declares the modes and which actions accept them; the agent recommends one, the person picks, and the app switches in the same engine session. Spec: `docs/superpowers/specs/2026-10-25-task-modes-design.md`.

## Declaring them

- `modes` in the manifest, by id (the action id pattern; `recommend` and `ask` are taken): `label`, optional `description` (shown), `brief` (a file in the harness folder, filled with `{{language}}`, never `{{notesIndex}}`), optional `minTier`, optional `recommend` (a hint only the agent reads), optional `settings` (fields as in `settings.md`).
- An action lists its `modes` and may set `defaultMode`: a mode id, `"recommend"` (the default) or `"ask"`. An action without `modes` works as before.

## How a task starts

| `defaultMode` | First message |
|---|---|
| a mode id | The action's brief, then `## Mode: <label>`, "Work in this mode.", the mode's brief and its settings' sentences |
| `"recommend"` | The action's brief, then `## How to work`: ask for `show_recommend_mode` before any work, with each mode's id, label and hint. That message only. |
| `"ask"` | The window lists the modes first (no model call) and starts in the one picked. A start the window doesn't make (a `choices` option, the path's next, `run` without `--mode`) falls back to `"recommend"`. |

## Recommending

`recommend_mode` is a core block offered only to a harness with modes (`show_recommend_mode`): `{ recommended, reasons (1–3), alternatives? (≤ 2, { mode, why }) }`. The window draws it like `choices`: the recommended mode with a "Recommended" badge and its reasons, the alternatives, and "See all modes". The agent may also call it mid-task to suggest a switch; nothing switches until the person picks.

## Switching

`client.chooseMode(mode, choice?)` → `TaskManager.chooseMode`. It waits for a running turn and never cancels it. Refusals: `no-task`, `unknown`, `tier`. A switch is one turn of the same session: `MODE_PROMPT` with the mode's brief and settings (and, when the task has a checkpoint note, "What is clear so far"), shown in the chat as "Switched to <label>". The task's `mode` and `modes` change only once that turn ends well. A task whose session was lost switches quietly; its resumed session carries the mode.

## The tier floor

A mode's `minTier` above the task's tier (a custom profile counts as its nearest tier) asks first: "Continue with the current model" (the task records `belowMinTier`) or "Start a new task with <mode>" (the closing turn saves the note, and a new task of the same action and scope starts in that mode with the tier raised to the floor; a higher tier the person chose stays).

## Where it shows

- `tasks.json`: `current.mode`, `current.modes`, `current.belowMinTier`. Modes the manifest no longer declares are dropped when it is read.
- `usage.jsonl`: `mode` on every turn of a task in a mode.
- The closing turn lists the modes used; the note's front matter keeps their ids (`modes: [...]`).
- The window: the mode bar above the chat (the mode, "Change mode", the below-tier note).

## Known gaps

- Phases (spec §7) wait for task phases: no mode is refused by phase yet.
- Settings › Usage doesn't break costs down by mode yet.
- `run --set` covers the harness's own settings only; mode settings use their stored values or defaults.
- Mock replay doesn't play switch turns.

## Where to look

- `packages/harness-sdk/src/modes.ts`, `index.ts` (schema and checks), `core-blocks.ts` (`recommend_mode`), `settings.ts` (mode settings).
- `packages/shell/src/main/task-manager.ts` (`startNow`, `chooseMode`), `task-prompts.ts`, `models.ts` (`nearestTier`, the floor).
- `packages/ui/src/RecommendModeBlock.tsx`, `ModeList.tsx`, `ChatView.tsx`.
```

- [ ] **Step 2: The other docs**

`docs/architecture/manifest.md`:
- in the field table, change the `actions` row to: `| \`actions\` | Tasks: \`label\`, optional \`description\`, \`prompt\` (the brief that opens the task's session), \`cost\` (\`light\`, \`medium\`, \`heavy\`), and optional \`modes\` and \`defaultMode\` (\`docs/architecture/modes.md\`) |`;
- after the `settings` row, add: `| \`modes\` | Optional. Ways of working inside a task: label, description, brief, \`minTier\`, a hint for the agent's recommendation and mode settings (\`docs/architecture/modes.md\`) |`;
- in Checks, change the first bullet's ending to "`choices`, `save_note` and `recommend_mode` are reserved: every harness gets the first two as core blocks, and a harness with modes gets `recommend_mode` (`allBlocks`)." and add the bullet: "- Modes: ids follow the action id pattern and aren't `recommend` or `ask`; an action's `modes` name declared modes, once each; `defaultMode` is one of them, `recommend` or `ask`, and only on an action with modes; mode settings pass the settings checks (no `section`) and need the harness's `settings` (its tab draws them). `humanharness check` also reports a mode brief that is missing or empty (`brief-missing`)."
- In the Settings bullet, change "Settings: at least one field;" to "Settings: at least one field, of its own or of a mode;".

`docs/architecture/blocks.md`: in the core blocks list, add: "`recommend_mode` (`show_recommend_mode`), only for a harness with modes: the agent's recommendation of a mode, drawn by the core like `choices` (`docs/architecture/modes.md`)."

`docs/architecture/context.md`: where the first message of a task is described, add: "In an action with modes, the first message adds the mode's section (or, with `defaultMode: \"recommend\"`, the list of modes to recommend from); a switch is one more turn of the same session with the new mode's brief (`docs/architecture/modes.md`). A resumed session's first message carries the current mode."

`docs/architecture/settings.md`: replace the Known gaps line "- Mode settings (spec §6) wait for task modes." with: "- Mode settings (spec §6) are stored under `modes.<mode>` of the same record, keyed `<mode>.<field>` in the tab, drawn as one section per mode, and sent only in that mode's brief, never in `AGENTS.md`, so they never wait for the next task. `run --set` doesn't cover them."

`docs/architecture/authoring.md`: in the `humanharness run` section, add: "`--mode <id>` starts the task in that mode. At the prompt, `m <id>` switches modes (shown only for an action with modes); a mode that asks for a higher tier says so and switches anyway, since a run keeps its tier: rerun with `--tier` for it."

`docs/architecture/mock-mode.md`: in its gaps, add: "- A mode switch (`m <id>` under `--record`) is recorded as a typed follow-up; replay doesn't play switch turns yet."

`packages/cli/guide/new-harness.md`, Phase 3 — Flow, after the `choices` bullet, add:

```md
- Ask whether a task has ways of working the person should pick between (task modes: Socratic or worked examples, plan or review). If so, declare `modes` (label, description, a brief in `agent/modes/<id>.md`, an optional `minTier` and a `recommend` hint) and list them on the action with a `defaultMode` (`recommend` lets the AI suggest one; `ask` asks the person first). See docs/architecture/modes.md.
```

- [ ] **Step 3: Verify and commit**

Run: `corepack pnpm test` (the guide test reads `new-harness.md`)
Expected: green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add docs/architecture packages/cli/guide/new-harness.md
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "docs: task modes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 17: End to end: recommend, switch, mode settings, the tier question; D0 on the demo

**Files:**
- Create: `packages/e2e/tests/modes.spec.ts`
- Modify: `packages/e2e/tests/flow.spec.ts`

- [ ] **Step 1: The D0 assertions on the demo**

In `packages/e2e/tests/flow.spec.ts`, after `expect(agents).not.toContain("### How to work with this person");`, add:

```ts
    // Task modes D0: the demo declares none, so there is no recommend_mode tool, no mode bar and no mode anywhere.
    expect(agents).not.toContain("show_recommend_mode");
    await expect(page.getByRole("button", { name: "Change mode" })).toHaveCount(0);
    expect(readTasks(s.folder).current).not.toHaveProperty("mode");
    expect(readJsonl<Record<string, unknown>>(usageFile(s)).some((r) => "mode" in r)).toBe(false);
    expect(close.prompt).not.toContain("modes used");
```

- [ ] **Step 2: The modes spec**

Create `packages/e2e/tests/modes.spec.ts`:

```ts
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { type ClaudeScript, claudeTextLines } from "@humanharness/fake-agent";
import { closeAndClean, launch, makeSandbox, readJsonl, shellDir, usageFile } from "./helpers";

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/modes-harness");
const result = {
  line: {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "",
    session_id: "fake-session",
    usage: { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 },
  },
};
const ui = (tool: string, args: Record<string, unknown>) => ({ mcp: { server: "ui", tool, args } });
// First match wins: the switch prompts before the task's brief, which the first message alone carries.
const coachScript: ClaudeScript = {
  steps: [...claudeTextLines("Listo."), result],
  turns: [
    { match: "save_note", steps: [ui("save_note", { title: "Halves", summary: ["Two halves make a whole"], decisions: [], files: [], open: [] }), ...claudeTextLines("Guardé."), result] },
    { match: 'From now on work in the mode "Worked examples"', steps: [...claudeTextLines("Paso uno: partimos la pizza."), result] },
    { match: 'From now on work in the mode "Socratic"', steps: [...claudeTextLines("¿Qué es una mitad?"), result] },
    {
      match: "# Task: study",
      steps: [
        ...claudeTextLines("Elijamos cómo trabajar."),
        ui("show_recommend_mode", { recommended: "socratic", reasons: ["Hay una idea clave para descubrir."], alternatives: [{ mode: "feynman", why: "Para explicarlo con tus palabras." }] }),
        result,
      ],
    },
  ],
};
const readTasks = (folder: string) => JSON.parse(fs.readFileSync(path.join(folder, ".harness", "tasks.json"), "utf8"));

test("the agent recommends, the person picks, the switch carries the mode's settings; a mode above the tier asks first", async () => {
  // A full app build of the fixture before the app starts.
  test.setTimeout(300_000);
  const s = makeSandbox("modes");
  const outDir = path.join(shellDir, "out", "modes");
  // electron-vite directly: `humanharness dev --build` would first run `check`, which a test fixture has no HARNESS.md for.
  const env: NodeJS.ProcessEnv = { ...process.env, HH_HARNESS_DIR: fixture, HH_OUT_DIR: outDir };
  delete env.ELECTRON_RUN_AS_NODE;
  execFileSync(path.join(shellDir, "node_modules", ".bin", "electron-vite"), ["build"], { cwd: shellDir, env, stdio: "inherit" });

  const settingsFile = path.join(s.folder, ".harness", "data", "_app", "settings.json");
  const { app, page } = await launch(s, { claude: coachScript }, path.join(outDir, "main", "index.js"));
  try {
    // Mode settings: a section of the harness's tab, stored under modes.<mode>.
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("tab", { name: "How I learn" }).click();
    const tab = page.getByRole("tabpanel", { name: "How I learn" });
    await expect(tab.getByRole("heading", { name: "Socratic" })).toBeVisible();
    await tab.getByRole("group", { name: "Questions" }).getByRole("button", { name: "Many" }).click();
    await expect.poll(() => (fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, "utf8")) : null)).toEqual({ modes: { socratic: { questions: "many" } } });
    await page.getByRole("button", { name: "Done", exact: true }).click();

    // The task starts asking for a recommendation; the block draws it.
    await page.getByRole("button", { name: "Start Coach" }).click();
    await page.getByRole("button", { name: /Study/ }).first().click();
    const recommend = page.getByRole("group", { name: "How do we work?" });
    await expect(recommend.getByRole("button", { name: /Socratic/ })).toContainText("Recommended");
    await expect(page.getByRole("group", { name: "Task mode" })).toContainText("No mode chosen yet");
    // The managed AGENTS.md section lists the block's tool (only a harness with modes has it).
    expect(fs.readFileSync(path.join(s.folder, "AGENTS.md"), "utf8")).toContain("show_recommend_mode");

    // The pick switches in the same session: a system line, the agent's answer in the new mode.
    await recommend.getByRole("button", { name: /Socratic/ }).click();
    await expect(page.getByRole("main").getByText("Switched to Socratic")).toBeVisible();
    await expect(page.getByRole("main").getByText("¿Qué es una mitad?")).toBeVisible();
    await expect(page.getByRole("group", { name: "Task mode" })).toContainText("Mode: Socratic");
    const prompts = () => readJsonl<{ prompt: string; argv: string[] }>(s.claudePrompts);
    const [first, socratic] = prompts();
    expect(first.prompt).toContain("## How to work");
    expect(socratic.prompt).toContain('From now on work in the mode "Socratic"');
    expect(socratic.prompt).toContain("- Ask many questions before explaining.");
    expect(socratic.argv).toContain("--resume");
    await expect.poll(() => readTasks(s.folder).current).toMatchObject({ action: "study", mode: "socratic", modes: ["socratic"], status: "waiting" });
    await expect.poll(() => readJsonl<{ mode?: string }>(usageFile(s)).map((r) => r.mode)).toEqual([undefined, "socratic"]);
    // Mode settings never go into AGENTS.md.
    expect(fs.readFileSync(path.join(s.folder, "AGENTS.md"), "utf8")).not.toContain("questions before explaining");

    // Worked examples asks for the deep tier; the task runs at standard: the question comes first.
    await page.getByRole("group", { name: "Task mode" }).getByRole("button", { name: "Change mode" }).click();
    await page.getByRole("group", { name: "Task mode" }).getByRole("button", { name: "Worked examples" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("Worked examples asks for more power");
    await dialog.getByRole("button", { name: "Continue with the current model" }).click();
    await expect(page.getByRole("main").getByText("Paso uno: partimos la pizza.")).toBeVisible();
    await expect.poll(() => readTasks(s.folder).current).toMatchObject({ mode: "worked", modes: ["socratic", "worked"], belowMinTier: true });
    await expect(page.getByRole("group", { name: "Task mode" })).toContainText("Running below the level this mode asks for");
  } finally {
    await closeAndClean(app, s);
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run the end-to-end suite**

Run: `corepack pnpm app:build` and `corepack pnpm e2e`
Expected: every spec green, `modes.spec.ts` and the D0 lines of `flow.spec.ts` included.

- [ ] **Step 4: Verify everything and commit**

Run: `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm app:build`, `corepack pnpm e2e`
Expected: all green.

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/e2e/tests/modes.spec.ts packages/e2e/tests/flow.spec.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "test(e2e): task modes end to end; D0 on the demo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

## Self-review against the spec

| Spec | Where |
|---|---|
| D1, §3 manifest: modes, label, description, brief, `minTier`, `recommend`, settings; action `modes` and `defaultMode` | Task 1 (schema, checks), Task 3 (mode settings) |
| §3 `check`: ids, briefs exist, `minTier` a tier, action lists, `defaultMode`, mode settings pass the settings checks | Task 1 (schema errors), Task 14 (brief files) |
| §3 `defaultMode`: mode id / recommend / ask | Task 8 (main), Task 13 (ask picker) |
| D2, §4 `recommend_mode` block, drawn like `choices`, "See all modes", hints in the first message only | Task 2, Task 4 (`recommendSection`), Task 8, Task 12 |
| §4 mid-task suggestion | The block is available on every turn of a harness with modes (Task 2's description); the window draws it whenever it comes (Task 13) |
| §4 / §5 switch at any time from a mode control | Task 12 (`ModeBar`), Task 13 |
| D3, §5.4 the switch turn, `MODE_PROMPT`, system line | Task 4, Task 6, Task 9, Task 13 |
| §5.1 refusals | Task 9 (`no-task`, `unknown`; phases deferred) |
| §5.2 waits for a running turn | Task 9 (`whenIdle`) |
| D4, §5.3 tier floor: continue / new task, floor never lowers | Task 7, Task 9, Task 11, Task 13 |
| D5, §5.5, §6 task state, `cleanCurrent` against the manifest, UI event | Task 5, Task 8 (view), Task 11 |
| §6 usage `mode` | Task 6, Task 11 (compaction) |
| §6 closing note lists the modes | Task 4 (`closePrompt`), Task 5 (`NoteMeta.modes`), Task 8 |
| §6 resumed sessions | Task 4 (`resumeMessage`), Task 8 |
| D6, §7 phases | Deferred: task phases aren't implemented (Decisions; Task 16 known gap) |
| §10.1 "what we did so far" | Task 9 (`checkpointSummary`) |
| §10.2 `minTier` default | None means any tier (Task 1) |
| §10.3 mode-level permissions | Not now, as proposed |
| harness-settings §6 mode settings | Task 3, Task 10, Task 12, Task 17 |
| D0 | The regression cases listed under Conventions; Task 17 on the demo |
