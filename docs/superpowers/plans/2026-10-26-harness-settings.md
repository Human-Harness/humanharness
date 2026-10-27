# Harness Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A harness may declare `settings` in its manifest: fields with a zod schema, a default, one of the core's controls, labels, and an English sentence template for the agent. The core draws them in a Settings tab of their own, saves every change at once through the data store (the reserved app-wide `settings` collection, as the person, with a history commit), and writes the filled sentences into the managed section of `AGENTS.md` under "### How to work with this person". A change made while a task is open waits: `AGENTS.md` is rewritten only between tasks, and an identical rewrite is skipped so the engine's cached prefix survives. `check` validates the declaration and warns on a long section; `humanharness run --set` tries a harness with other values. A harness that declares no settings works exactly as today (D0 below).

**Architecture:**
- **Contract (harness-sdk).** A new module, `settings.ts`, holds the manifest schema (`settingsSchema`, wired as the manifest's optional `settings`) and every pure helper the other packages share:
  - `settingsCollection` / `dataCollections`: the reserved collection, added to the data store's collections only when settings exist.
  - `settingsValues`: stored record → every field's value (the stored one when valid, else the default).
  - `settingSentence` / `settingsSentences`: the filled templates (`{{value}}`, `{{value:label}}`).
  - `settingsView`: the plain data the window draws from, built with plan 2's `inputFields` inference (options, bounds).
- **Agent instructions (workspace, runtime).**
  - `managedSection` takes `settings` (sentences) and writes them after the core rules, before the interface tools.
  - `refreshInstructions` rewrites `AGENTS.md` atomically, and only when its text changed.
  - The runtime asks `instructionSettings()` when it starts and on `HarnessRuntime.refreshInstructions()`.
- **When it is rewritten (shell main).**
  - `TaskManager` gets a `betweenTasks` hook, called after a task ends and before a new task's first turn, plus `whenNoTask(fn)`, which runs `fn` after the running operation only if no task is open then.
  - A new `SettingsController` (`packages/shell/src/main/settings.ts`) owns the deferral: the data store's change event marks the settings stale and asks `whenNoTask` to apply them; `betweenTasks` applies whatever is still stale. It also answers the window (values, which fields are pending) and writes the person's changes through the existing `hh:data` handler (`personDataRequests`), so each change gets the store's checks and a `Data: settings` history commit.
- **The window (ui).** `AppState.settings` (a `SettingsView`) adds a tab after General. `HarnessSettingsTab` draws each field with the core's controls (the existing `Segmented`, a select, a switch, number and text inputs), shows "Changes apply from the next task." while a task is open, a "Pending" mark on fields that wait, a "More options" disclosure, and a reset.
- **Authoring tools (cli).** Structural checks are manifest schema errors (so `check` reports them as `schema`); `check` adds `settings-tokens`. `run --set name=value` stores values before the task. A new fixture, `packages/fake-agent/fixtures/settings-harness` (id `tutor`), drives the run and e2e tests.

**Tech Stack:**
- Unchanged: TypeScript, pnpm via corepack, Electron 44 + electron-vite 5, React 19, i18next, zod 4 (`instanceof z.ZodType`, `.optional()`, `safeParse`), isomorphic-git (the history), Vitest + happy-dom, and Playwright with the fake agents.
- No new dependency.

Spec: `docs/superpowers/specs/2026-10-25-harness-settings-design.md` (source of truth; "§" and "D" numbers below refer to it). It builds on `2026-10-25-scopes-and-data-design.md` (plan `2026-10-25-scopes-and-data.md`, branch `feat/scopes-data`) and `2026-10-25-input-blocks-design.md` (plan `2026-10-25-input-blocks.md`, branch `feat/input-blocks`), both implemented on this branch, and on master's plan 5a (English-only core).

---

## Conventions

**Code**
- Same as the scopes-and-data and input-blocks plans:
  - English everywhere (code, comments, docs, UI strings, manifest texts);
  - packages export TS source;
  - extensionless imports;
  - tests in `packages/<name>/test/`;
  - one commit per task.
- React tests are `*.test.tsx` with `// @vitest-environment happy-dom` on the first line. Find elements by role and visible text.
- `@humanharness/ui` only imports **types** from other packages (`import type`). The UI's own small helpers live in `packages/ui/src/`.
- Colours only through the existing `--hh-*` tokens.
- Every lookup by a name that comes from a person, a harness or IPC (`settings.fields[name]`, `options[value]`, stored record keys) goes through `Object.hasOwn` first.

**Commands and git**
- The worktree is `/Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data`, already on branch `feat/harness-settings` (stacked on `feat/input-blocks`, itself on `feat/scopes-data`). Implement there.
- Run every `corepack pnpm …` command from the worktree root. A single test file: `corepack pnpm vitest run <path>`.
- Git: always `git -C <worktree> …`, one simple command per call. Never use bare `git stash`.
- Every commit message ends with these two lines, with a blank line before them:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7
  ```
- Every task ends with `corepack pnpm typecheck` and `corepack pnpm test` green before its commit.
  - Tasks that touch the shell's main process, the preload or the UI also run `corepack pnpm app:build`.
  - Task 13 runs `corepack pnpm e2e`.

**Compliance (core spec §5), restated for this plan**
- Never read `~/.claude`, `~/.codex`, `~/.gemini` or any account, token or credential file.
- Settings touch only the person's folder: `<base>/.harness/data/_app/settings.json` (tracked by the history like any data) and `AGENTS.md` (generated, not tracked).
- The settings' schemas and templates are harness data read in the main process; no harness function runs for settings.

**D0 is a hard rule (like plan 1's D2 and plan 2's D0).** A harness that declares no `settings` must keep, byte for byte:
- the folder (no `.harness/data/_app/settings.json`, no `.harness/data/` at all when it has no data either);
- `AGENTS.md` and the engine's own instructions file (no "How to work with this person" heading);
- the prompts, `tasks.json`, the chat log and `usage.jsonl` (settings never touch them);
- the MCP tool list and the `data` server's presence (the settings collection is hidden from the agent and isn't part of `harness.data`);
- the data store's collections (`dataCollections(h)` returns `h.data` itself);
- `AppState` (no `settings`) and the Settings sheet's tabs;
- `check`'s findings for the untouched template and every existing fixture;
- `humanharness run` without `--set`.

Tasks 1, 2, 3, 4, 5, 9, 10, 11 and 13 hold the regression tests. Every other task keeps D0 by adding fields only when settings exist (conditional spreads), never by changing a default.

## Decisions this plan takes where the spec leaves room, or where the code moved

**Manifest shape (§3), English-only (plan 5a)**
- Every text is one English string: `tab`, section `label`, field `label`, `help`, `unit`, `options` values and the `agent` template. The spec's `{ es, en }` pairs no longer exist in the core; the app will translate screens on demand (language-on-demand spec), and the agent always reads English (`instructions.ts`: "The managed section is English whatever the person's language"). So `{{value:label}}` is the option's English label.
- **The i18n parity check (§3 `check`) is dropped**: there is one language in a manifest.
- `agent` is `string | false | { text, onlyWhenChanged? }`. A string is the template; `false` or absent makes the field UI-only.
- `onlyWhenChanged` defaults to `false` (spec §9.3: measure first).
- `sections` is optional (default `[]`), and so is each field's `section`. Fields with no section are drawn first, ungrouped; sections follow in manifest order.
- **Field names:** `^[a-z][a-zA-Z0-9]{0,39}$` (camelCase, as the spec's `hintAfter`). `modes` is reserved for mode settings (§6, below). Section ids: `^[a-z][a-z0-9-]{0,39}$`, unique.
- **Controls and types.** Each control needs its zod type, read with plan 2's `inputFields` inference so both features agree:
  - `segmented` and `select`: a `z.enum([...])`;
  - `toggle`: `z.boolean()`;
  - `number`: `z.number()` (its `min`/`max` become the input's bounds);
  - `text`: `z.string()` (its max length becomes `maxLength`).
- **`options`** labels the values of a `segmented`/`select` enum. As a small extension, a `toggle` may label `"true"` and `"false"`, so `{{value:label}}` works on it. Any other key is an error. A value with no label shows as itself.
- **Placeholders:** `{{value}}` and `{{value:label}}` only (spaces inside the braces allowed). `{{value:label}}` only on `segmented`, `select` and `toggle`. `{{value}}` of a boolean reads `on`/`off`.
- **A filled sentence** has its whitespace folded to single spaces: one sentence is one list line in `AGENTS.md`.
- **Where the structural checks live.** Every rule of §3 `check` (default matches schema, `options` keys, sections exist, placeholders) is in the manifest schema's `superRefine`. `defineHarness`/`loadHarness` refuse a broken declaration, because the app relies on it at run time (a default that fails its schema would break the tab and the sentences). `check` reports them as `schema` findings with their paths, as it does every other manifest rule. `check`'s own rule is `settings-tokens` (§5 "Measuring").

**Storage (D2)**
- **The collection:** `settings`, `scoped: false`, `single: true`, `context: false`, schema `z.object({ <field>: <schema>.optional() })`. It is added to the data store's collections by `dataCollections(harness)`, never to `harness.data`. So `hasAgentData`, `buildDataContext`, the data MCP server and `dataDiff` don't change.
- **Only what the person changed is stored.** The spec says "the collection's object schema … with their defaults". With zod defaults in the stored schema, the first write would pin every other field at the default of that day, and a harness update that changes a default would never reach that person. Instead the schema fields are `.optional()`. `settingsValues` fills the defaults on read, field by field: an invalid stored value falls back to its default. A change back to the default removes the key. When nothing is left, the record (and its file) is deleted. A person who never changes anything has no file (D0-like for the folder).
- **`agent: "none"`, not the spec's `"read"`.** The spec also says a field with no `agent` template is "UI-only: … the agent never sees it", and D3 says values reach the agent "never as raw JSON". With `"read"` the agent's `data_get` would read every field as raw JSON, UI-only ones included, and a harness with settings but no data would suddenly get a `data` MCP server. The agent still never changes a setting (D2); it can suggest one in plain text or `choices`.
- **Writes go through the person's data path.** `SettingsController.set` merges the field into the stored record and sends a `put` (or `delete`) through `personDataRequests` (`hh:data`'s handler), in scope `_app`. It gets the store's checks, the turns-blocked refusal and a `Data: settings` history commit, tagged with the open task like any person write. "Undo this task" therefore also undoes settings changed during it, like any file. Writes are serialized in the controller, so two quick changes never read the same old record.
- **Hand edits and restores.** A record broken by hand reads as defaults and refuses writes (the store's `broken-file` error, shown inline). A restore (`hh:restore`, `hh:restoreTask`) can change the file without a data event, so both handlers call `SettingsController.changed()` when they succeed. There is no file watcher (same known gap as data).
- **Profiles.** The base is `baseOf(c)` as for all data, so each profile will have its own settings with no change here.

**How values reach the agent (§5, D3, D4)**
- **Placement:** `### How to work with this person`, then one `- <sentence>` per field, right after the core rules and before `### Interface tools`. No sentences, no heading (D0, and a harness whose sentences are all `onlyWhenChanged` at their defaults).
- **When `AGENTS.md` is written.** The spec says "`writeInstructions` runs today when the engine or the folder changes". In the code it runs once, in `createRuntime`, and the runtime is recreated after an engine or folder change. So:
  - `RuntimeOptions.instructionSettings?(): Promise<string[]>` is asked at start (the first `AGENTS.md` carries the current settings);
  - `HarnessRuntime.refreshInstructions(): Promise<boolean>` rewrites it later.
  - Without a runtime there is nothing to refresh: the next runtime writes the current settings.
- **Deferral (`instructionsStale`).** `SettingsController` keeps `stale`:
  1. Any write to `settings` (the data store's `onChange`, from any writer, including a harness UI's own `client.data`) and any restore call `changed()`. It sets `stale` and asks `TaskManager.whenNoTask(apply)`. That runs after the running task operation, only when no task is open then, so it can never race a session start: new sessions start inside operations.
  2. `TaskManager` calls `betweenTasks()` after `endTask` (closed, unsaved, interrupted, failed first turn) and in `begin` right after the previous session ended and before the new task's first turn. Both apply a stale value.
- **Identical-content skip.** `refreshInstructions` (workspace) compares the new text with the file and writes nothing when equal. It writes a temp file under `.harness/` (ignored by the history), then renames it over `AGENTS.md`, so neither a session nor a history commit made meanwhile ever sees half a file or the temp file.
- **A session that starts mid-task** (after a folder move, the task resumes in a new session) reads `AGENTS.md` as it is then. That is a new session, never a rewrite under a running one; it is written as a known gap.

**What the window shows (§4)**
- **Tab order:** General, the harness's tab (labelled with `settings.tab`), Engine, Models, Usage. Before the app is configured the tab shows the "set up first" card, like Engine, Models and Usage (there is no folder to store into).
- **Saving.** Segmented, select and switch save on change. Number and text inputs keep a draft and save on blur or Enter, so typing "12" never saves "1" first. An empty number reverts to the saved value.
- **"An invalid value cannot be entered":** the choices come from the enum, numbers carry `min`/`max`, texts `maxLength`. A value the store still refuses (an integer field given 2.5, a number out of range typed by hand) shows the store's message under the field.
- **Errors over IPC** travel as data (`SettingsResult`), never as thrown errors (plan 2's lesson: Electron flattens thrown errors). A `DataError`'s message is shown; any other failure is logged in main and the window shows "That didn't save. Try again."
- **The running-task line** ("Changes apply from the next task.", `role="status"`) shows while a task is open (`TaskView.current !== null`), not only while a turn runs: an open task's session keeps the `AGENTS.md` it started with.
- **The "Pending" mark** is computed in main, so it survives the sheet closing: a field is pending when a task is open, it has an agent sentence, and its current value differs from the value the current `AGENTS.md` was written with (`applied`, recorded each time `instructionSettings()` runs). UI-only fields are never pending: the harness's screens read them at once.
- **"More options"** is a button with `aria-expanded` and `aria-controls` (the app's own disclosure pattern, as in General's "Move folder"), closed by default. It holds the `advanced` fields, grouped by section like the rest.
- **The reset** ("Back to the app's defaults") resets **every** field of the tab by deleting the stored record. The spec's sentence can be read as advanced-only; one reset for the whole tab is simpler and covers both. It shows only when some value differs from its default.
- **English strings:** "More options", "Back to the app's defaults", "Changes apply from the next task.", "Pending" (the spec's "Más opciones", "Volver a los valores de la app", "Los cambios se aplican desde la próxima tarea.", "pendiente").

**`HarnessClient.settings`**
- `get()` answers `{ values, pending }`, every field's value resolved. That is what a harness's own screens use to read UI-only fields; `client.data.get("settings")` still works but holds only the changed fields.
- `set(field, value)`, `reset()` and `onChange(listener)` complete it. A harness that declares no settings gets `{ values: {}, pending: [] }` and a refused `set`.

**Mode settings (§6, slice 3) are not in this plan.** Task modes aren't implemented. This plan reserves the field name `modes` so their future `settings.modes.<modeId>` key can't collide, and docs say so.

**Authoring**
- **`check`:** `settings-tokens` (a warning) measures `settingsLines` of every sentence at the defaults, `onlyWhenChanged` ones included, with `estimateTokens`, against `SETTINGS_TOKENS_WARN` (400).
- **`humanharness run --set name=value`** (repeatable). Each value is read as JSON when the field's schema takes it (`4`, `true`), else as the text (`patient`). Values are checked before the engine or the folder, and stored like the window would (defaults dropped). `run` prints `Settings: name=value, …`. Without `--set`, `run` is unchanged.
- **Mock mode** needs no change: the Settings tab and `AGENTS.md` work as in the real app. Recordings don't vary by settings (a known gap in `mock-mode.md`).

## What in the code conflicts with the spec (and how this plan handles it)

| Conflict | Where | Handling |
|---|---|---|
| The spec's texts are `{ es, en }` pairs; the core is English-only since plan 5a | `harness-sdk/src/index.ts` (`text` = one string), `i18n` (only `en.json`) | Plain English strings; `{{value:label}}` is English; the i18n parity check is dropped (Task 1) |
| D2 says `agent: "read"`, §3 says UI-only fields are never seen and D3 forbids raw JSON | `workspace/src/data.ts` readable(), `blocks/src/data-server.ts` | `agent: "none"`: the agent gets sentences only (Task 2) |
| "The core builds the collection's schema with their defaults": a first write would pin every default | spec §3 | Optional fields, defaults filled on read (`settingsValues`); only changes are stored (Tasks 2, 6) |
| `settings` is reserved but nothing creates it | `harness-sdk/src/data.ts` `RESERVED_COLLECTIONS` | `dataCollections(harness)` adds it to the store only (Task 2); every `new DataStore` uses it (Tasks 7, 11) |
| "`writeInstructions` runs when the engine or folder changes": it runs once, in `createRuntime` | `runtime/src/runtime.ts` | `instructionSettings` + `HarnessRuntime.refreshInstructions()` (Task 4) |
| `writeInstructions` always overwrites; a reader could see half a file | `workspace/src/instructions.ts` | `refreshInstructions`: skip when equal, temp file under `.harness/` + rename (Task 3) |
| No hook runs between tasks, and a change event can't know whether a session is about to start | `shell/src/main/task-manager.ts` | `betweenTasks` in `endTask` and `begin`, and `whenNoTask` on the operation queue (Task 5) |
| Restores change tracked files without a data event | `shell/src/main/index.ts` `hh:restore`, `hh:restoreTask` | They call `SettingsController.changed()` (Task 7) |
| Electron flattens thrown errors | `shell/src/main/index.ts` `handle()` | `SettingsResult` as data (Tasks 6, 7) |
| `InputForm` is a submit form for answers (drafts by block id, field errors from `respond`), with no segmented, select or switch | `ui/src/InputForm.tsx` | Not reused for drawing; the tab reuses `Segmented` (`chrome.tsx`), the row and error CSS, and `inputFields` for options and bounds (Tasks 2, 8) |
| Mode settings need task modes, which don't exist yet | spec §6 | Deferred; `modes` reserved as a field name (Task 1) |

**Reuse, and why.**
- **Reused:**
  - zod schemas checked by the store (D2 asks for the data store);
  - `DataStore` with its write queue, `broken-file` refusal and `onChange` (the deferral hangs on it);
  - `personDataRequests` for the person's writes and their history commit;
  - `inputFields` for enum options and number/length bounds (one inference for both features);
  - `Segmented` and the Settings row styles.
- **Not reused:**
  - `InputForm`: its semantics (one submit, drafts, `respond` errors) don't fit save-on-change.
  - The `data` MCP server: the agent must not read settings as JSON.

## File Structure

```
packages/harness-sdk/src/settings.ts       NEW. SETTING_CONTROLS, settingsSchema, HarnessSettings, SettingField,
                                           SETTINGS_COLLECTION, SETTINGS_TOKENS_WARN, settingsCollection,
                                           dataCollections, settingsValues, sameSetting, settingSentence,
                                           settingsSentences, agentSettings, settingsView, SettingsView,
                                           SettingFieldView                                                 (Tasks 1, 2)
packages/harness-sdk/src/index.ts          manifest `settings`; exports                                      (Task 1)
packages/workspace/src/instructions.ts     settingsLines, managedSection `settings`, writeInstructions
                                           `settings`, refreshInstructions                                   (Task 3)
packages/runtime/src/runtime.ts            instructionSettings, HarnessRuntime.refreshInstructions           (Task 4)
packages/shell/src/main/task-manager.ts    betweenTasks dep, whenNoTask                                      (Task 5)
packages/shell/src/main/settings.ts        NEW. SettingsController                                           (Task 6)
packages/ui/src/client.ts                  SettingsState, SettingsResult (6); AppState.settings,
                                           HarnessClient.settings, view types (7)                            (Tasks 6, 7)
packages/shell/src/main/index.ts           store collections, controller, runtime option, hooks, IPC,
                                           restores, appState                                                (Task 7)
packages/shell/src/preload/index.ts        client.settings                                                   (Task 7)
packages/ui/test/fake-client.ts            settings                                                          (Task 7)
packages/ui/src/HarnessSettingsTab.tsx     NEW. The harness's tab                                            (Task 8)
packages/ui/src/styles.css                 .hh-setting-pending, .hh-settings-group                           (Task 8)
packages/i18n/src/locales/en.json          settings.harness.*                                                (Task 8)
packages/ui/src/SettingsSheet.tsx          the fifth tab                                                     (Task 9)
packages/cli/src/check.ts                  settings-tokens                                                   (Task 10)
packages/fake-agent/fixtures/settings-harness/  NEW. The `tutor` fixture                                     (Task 11)
packages/cli/src/run.ts                    --set, settings collection, instructionSettings                   (Task 11)
docs/architecture/settings.md              NEW                                                               (Task 12)
docs/architecture/{manifest,context,data,authoring,mock-mode}.md                                             (Task 12)
packages/cli/guide/new-harness.md          Phase 4 asks about settings                                       (Task 12)
packages/e2e/tests/settings.spec.ts        NEW. The tab, the deferral, AGENTS.md                             (Task 13)
packages/e2e/tests/flow.spec.ts            D0 on the demo                                                    (Task 13)
```

---

## Phase 1 — Contract (spec §8 slice 1, manifest part)

### Task 1: The manifest declares settings

**Files:**
- Create: `packages/harness-sdk/src/settings.ts`
- Modify: `packages/harness-sdk/src/index.ts`
- Test: `packages/harness-sdk/test/settings.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/harness-sdk/test/settings.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { type HarnessInput, defineHarness, z } from "../src";

const base: HarnessInput = {
  id: "tutor",
  name: "Tutor",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Tutor" },
  instructions: "./AGENTS.md",
  permissions: { edit: "none", exec: false, web: false },
  blocks: {},
  author: "t",
};

export const tone = {
  schema: z.enum(["patient", "neutral", "demanding"]),
  default: "patient",
  section: "voice",
  control: "segmented" as const,
  label: "Tone",
  options: { patient: "Patient", neutral: "Neutral", demanding: "Demanding" },
  agent: "Use a {{value:label}} tone.",
};
export const hintAfter = {
  schema: z.number().int().min(1).max(5),
  default: 2,
  section: "help",
  control: "number" as const,
  label: "Hint after",
  unit: "tries",
  agent: "Give a hint after {{value}} failed tries, not before.",
  advanced: true,
};
export const examples = {
  schema: z.boolean(),
  default: true,
  section: "help",
  control: "toggle" as const,
  label: "Show worked examples",
  agent: { text: "Do not show worked examples.", onlyWhenChanged: true },
};
export const nickname = { schema: z.string().max(40), default: "", control: "text" as const, label: "What the app calls you", help: "Only the app's screens use it." };
export const declared = {
  tab: "How I learn",
  sections: [
    { id: "voice", label: "How the AI talks" },
    { id: "help", label: "Help" },
  ],
  fields: { tone, hintAfter, examples, nickname },
};

/** The manifest issues of `settings`, as "path: message". */
function issues(settings: unknown): string[] {
  try {
    defineHarness({ ...base, settings: settings as HarnessInput["settings"] });
    return [];
  } catch (err) {
    return (err as z.ZodError).issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  }
}
const withField = (name: string, field: Record<string, unknown>) => ({ ...declared, fields: { ...declared.fields, [name]: field } });

describe("manifest settings", () => {
  it("keeps a valid declaration: tab, sections and fields in order", () => {
    const h = defineHarness({ ...base, settings: declared });
    expect(h.settings?.tab).toBe("How I learn");
    expect(h.settings?.sections.map((s) => s.id)).toEqual(["voice", "help"]);
    expect(Object.keys(h.settings?.fields ?? {})).toEqual(["tone", "hintAfter", "examples", "nickname"]);
    expect(h.settings?.fields.tone.schema).toBeInstanceOf(z.ZodEnum);
  });

  it("D0: a harness with no settings has none", () => {
    expect(defineHarness(base).settings).toBeUndefined();
  });

  it("sections are optional; a field with no section is fine", () => {
    expect(issues({ tab: "Mine", fields: { nickname } })).toEqual([]);
  });

  it("refuses a default that doesn't match its schema", () => {
    expect(issues(withField("tone", { ...tone, default: "loud" }))).toEqual(["settings.fields.tone.default: The default does not match the schema"]);
  });

  it("refuses a section that isn't declared, and a section declared twice", () => {
    expect(issues(withField("tone", { ...tone, section: "nope" }))).toEqual(['settings.fields.tone.section: Section "nope" is not declared in sections']);
    expect(issues({ ...declared, sections: [...declared.sections, { id: "help", label: "Again" }] })).toEqual(['settings.sections.2.id: Section "help" is declared twice']);
  });

  it("refuses a control whose type doesn't fit", () => {
    expect(issues(withField("tone", { ...tone, control: "number" }))).toEqual(["settings.fields.tone.control: The number control needs a z.number() schema"]);
    expect(issues(withField("examples", { ...examples, control: "segmented" }))).toEqual(["settings.fields.examples.control: The segmented control needs a z.enum([...]) schema"]);
    expect(issues(withField("nickname", { ...nickname, control: "toggle" }))).toEqual(["settings.fields.nickname.control: The toggle control needs a z.boolean() schema"]);
  });

  it("refuses an options key that is not a value", () => {
    expect(issues(withField("tone", { ...tone, options: { ...tone.options, loud: "Loud" } }))).toEqual(['settings.fields.tone.options.loud: "loud" is not a value of the schema']);
    expect(issues(withField("examples", { ...examples, options: { yes: "Yes" } }))).toEqual([
      'settings.fields.examples.options.yes: "yes" is not a value of the schema (a toggle\'s are "true" and "false")',
    ]);
    expect(issues(withField("hintAfter", { ...hintAfter, options: { "2": "Two" } }))).toEqual(["settings.fields.hintAfter.options: Only a segmented, select or toggle control has options"]);
  });

  it("refuses a placeholder other than {{value}} and {{value:label}}, and a label where there are no options", () => {
    expect(issues(withField("tone", { ...tone, agent: "Use a {{tone}} tone." }))).toEqual(["settings.fields.tone.agent: Unknown placeholder {{tone}}: use {{value}} or {{value:label}}"]);
    expect(issues(withField("hintAfter", { ...hintAfter, agent: "After {{ value:label }} tries." }))).toEqual([
      "settings.fields.hintAfter.agent: {{value:label}} needs a segmented, select or toggle control: use {{value}}",
    ]);
    expect(issues(withField("tone", { ...tone, agent: "Use a {{ value }} tone." }))).toEqual([]);
  });

  it("refuses a bad field name, the reserved `modes`, and no fields at all", () => {
    expect(issues(withField("Bad-name", nickname))[0]).toMatch(/^settings\.fields\.Bad-name/);
    expect(issues(withField("modes", nickname))).toEqual(['settings.fields.modes: "modes" is reserved for mode settings']);
    expect(issues({ tab: "Mine", fields: {} })).toEqual(["settings.fields: Declare at least one setting"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/harness-sdk/test/settings.test.ts`
Expected: FAIL (`settings` is not a key of `HarnessInput`; the valid declaration's `h.settings` is undefined because zod strips the unknown key).

- [ ] **Step 3: Implement**

Create `packages/harness-sdk/src/settings.ts`:

```ts
import { z } from "zod";
import { inputFields } from "./input";

/** The core's controls for a setting (harness-settings spec §3). */
export const SETTING_CONTROLS = ["segmented", "select", "toggle", "number", "text"] as const;
export type SettingControl = (typeof SETTING_CONTROLS)[number];

/** A setting's name: a key of the stored record (camelCase, as `hintAfter`). */
export const SETTING_NAME = /^[a-z][a-zA-Z0-9]{0,39}$/;
/** Names the core keeps: `modes` will hold mode settings (spec §6, with task modes). */
export const RESERVED_SETTINGS: readonly string[] = ["modes"];
const SECTION_ID = /^[a-z][a-z0-9-]{0,39}$/;
/** A placeholder in an agent sentence: `{{value}}` or `{{value:label}}`, spaces allowed inside the braces. */
export const SETTING_PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/g;
/** The controls whose values have labels (`options`), so `{{value:label}}` means something. */
const LABELLED: readonly SettingControl[] = ["segmented", "select", "toggle"];
/** What each control needs, as the core form infers it from the zod type (input-blocks `inputFields`). */
const CONTROL_KINDS: Record<SettingControl, readonly string[]> = {
  segmented: ["choice"],
  select: ["choice"],
  toggle: ["boolean"],
  number: ["number"],
  text: ["text", "longText"],
};
const CONTROL_TYPES: Record<SettingControl, string> = {
  segmented: "a z.enum([...])",
  select: "a z.enum([...])",
  toggle: "a z.boolean()",
  number: "a z.number()",
  text: "a z.string()",
};

const text = z.string().min(1);

const agentSchema = z.union([z.literal(false), text.max(300), z.object({ text: text.max(300), onlyWhenChanged: z.boolean().optional() })]);

const fieldSchema = z.object({
  /** A zod type: z.enum (segmented, select), z.boolean (toggle), z.number (number) or z.string (text). */
  schema: z.custom<z.ZodType>((s) => s instanceof z.ZodType, { message: "Expected a zod schema" }),
  /** The value until the person changes it; it must match `schema`. */
  default: z.unknown(),
  /** A section id from `sections`; absent: drawn first, outside any section. */
  section: z.string().optional(),
  control: z.enum(SETTING_CONTROLS),
  label: text.max(80),
  /** One line under the control. */
  help: text.max(200).optional(),
  /** Shown after a number ("tries"). */
  unit: text.max(40).optional(),
  /** Labels of the values (segmented, select; "true"/"false" for a toggle). A value with none shows as itself. */
  options: z.record(z.string(), text.max(80)).optional(),
  /**
   * The agent's sentence (spec §5): `{{value}}`, and `{{value:label}}` for the value's label. Absent or false:
   * UI-only, the agent never sees it. `onlyWhenChanged`: left out while the value is the default.
   */
  agent: agentSchema.optional(),
  /** Under "More options", closed by default. */
  advanced: z.boolean().optional(),
});

/** What a control would draw for `schema`: its kind, enum options and bounds (the input-blocks inference). */
export function inferSetting(schema: z.ZodType) {
  return inputFields({ input: z.object({ value: schema }), schema: z.object({}) })[0];
}

/** The manifest's `settings` (harness-settings spec §3). */
export const settingsSchema = z
  .object({
    /** The name of the Settings tab, in English. */
    tab: text.max(40),
    sections: z.array(z.object({ id: z.string().regex(SECTION_ID), label: text.max(80) })).default([]),
    fields: z.record(z.string().regex(SETTING_NAME), fieldSchema),
  })
  .superRefine((s, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
    if (Object.keys(s.fields).length === 0) issue(["fields"], "Declare at least one setting");
    const sections = new Set<string>();
    for (const [i, section] of s.sections.entries()) {
      if (sections.has(section.id)) issue(["sections", i, "id"], `Section "${section.id}" is declared twice`);
      sections.add(section.id);
    }
    for (const [name, f] of Object.entries(s.fields)) {
      const at = (...rest: (string | number)[]) => ["fields", name, ...rest];
      if (RESERVED_SETTINGS.includes(name)) issue(at(), `"${name}" is reserved for mode settings`);
      if (f.section !== undefined && !sections.has(f.section)) issue(at("section"), `Section "${f.section}" is not declared in sections`);
      if (!(f.schema instanceof z.ZodType)) continue;
      const inferred = inferSetting(f.schema);
      if (!CONTROL_KINDS[f.control].includes(inferred.kind ?? "")) {
        issue(at("control"), `The ${f.control} control needs ${CONTROL_TYPES[f.control]} schema`);
        continue;
      }
      if (!f.schema.safeParse(f.default).success) issue(at("default"), "The default does not match the schema");
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
      for (const m of template.matchAll(SETTING_PLACEHOLDER)) {
        if (m[1] !== "value" && m[1] !== "value:label") issue(at("agent"), `Unknown placeholder {{${m[1]}}}: use {{value}} or {{value:label}}`);
        else if (m[1] === "value:label" && !LABELLED.includes(f.control)) issue(at("agent"), "{{value:label}} needs a segmented, select or toggle control: use {{value}}");
      }
    }
  });

export type HarnessSettings = z.output<typeof settingsSchema>;
export type HarnessSettingsInput = z.input<typeof settingsSchema>;
export type SettingField = HarnessSettings["fields"][string];

/** A field's sentence template, or null for a UI-only field. */
export function agentText(agent: SettingField["agent"]): string | null {
  if (agent === undefined || agent === false) return null;
  return typeof agent === "string" ? agent : agent.text;
}
```

In `packages/harness-sdk/src/index.ts`:

1. Next to the other imports, add:

```ts
import { settingsSchema } from "./settings";
```

2. Next to `export * from "./answer";`, add:

```ts
export * from "./settings";
```

3. In `manifestSchema`, right after the `data: dataSchema,` line, add:

```ts
  /** Knobs the person sets in a Settings tab of the harness's own (harness-settings spec). Absent: no tab (D0). */
  settings: settingsSchema.optional(),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/harness-sdk/test/settings.test.ts`
Expected: PASS.

Then: `corepack pnpm typecheck` and `corepack pnpm test`
Expected: both green.

- [ ] **Step 5: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/harness-sdk/src/settings.ts packages/harness-sdk/src/index.ts packages/harness-sdk/test/settings.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(sdk): the manifest declares harness settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 2: Values, sentences, the collection and the view

**Files:**
- Modify: `packages/harness-sdk/src/settings.ts`
- Test: `packages/harness-sdk/test/settings-values.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/harness-sdk/test/settings-values.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  SETTINGS_COLLECTION,
  agentSettings,
  dataCollections,
  settingSentence,
  settingsSchema,
  settingsSentences,
  settingsValues,
  settingsView,
  z,
} from "../src";
import { declared } from "./settings.test";

const settings = settingsSchema.parse(declared);

describe("settingsValues", () => {
  it("fills every field: the stored value when valid, else the default", () => {
    expect(settingsValues(settings, null)).toEqual({ tone: "patient", hintAfter: 2, examples: true, nickname: "" });
    expect(settingsValues(settings, { tone: "demanding", hintAfter: 9, other: 1 })).toEqual({ tone: "demanding", hintAfter: 2, examples: true, nickname: "" });
    expect(settingsValues(settings, ["not", "a", "record"])).toEqual(settingsValues(settings, {}));
  });

  it("never reads an inherited key as a stored value", () => {
    const stored = Object.create({ tone: "demanding" }) as Record<string, unknown>;
    expect(settingsValues(settings, stored).tone).toBe("patient");
  });
});

describe("settingsSentences", () => {
  it("fills {{value}} and {{value:label}}; skips UI-only fields and unchanged onlyWhenChanged ones", () => {
    expect(settingsSentences(settings, settingsValues(settings, null))).toEqual(["Use a patient tone.", "Give a hint after 2 failed tries, not before."]);
    expect(settingsSentences(settings, settingsValues(settings, { tone: "demanding", examples: false, hintAfter: 4 }))).toEqual([
      "Use a demanding tone.",
      "Give a hint after 4 failed tries, not before.",
      "Do not show worked examples.",
    ]);
  });

  it("{ all: true } keeps the onlyWhenChanged ones (check measures the longest section)", () => {
    expect(settingsSentences(settings, settingsValues(settings, null), { all: true })).toContain("Do not show worked examples.");
  });

  it("a value with no label shows as itself; a boolean reads on/off; whitespace folds", () => {
    const field = { ...settings.fields.tone, options: {}, agent: "Tone:\n  {{value:label}}." };
    expect(settingSentence(field, "neutral")).toBe("Tone: neutral.");
    const toggle = settingsSchema.parse({ tab: "x", fields: { on: { schema: z.boolean(), default: false, control: "toggle", label: "On", agent: "Switch is {{value}}." } } });
    expect(settingSentence(toggle.fields.on, true)).toBe("Switch is on.");
  });

  it("agentSettings lists the fields the agent reads", () => {
    expect(agentSettings(settings)).toEqual(["tone", "hintAfter", "examples"]);
  });
});

describe("dataCollections", () => {
  it("D0: without settings it is the harness's own collections, the same object", () => {
    const data = {};
    expect(dataCollections({ data })).toBe(data);
  });

  it("adds the reserved collection: app-wide, one record, hidden from the agent, optional fields", () => {
    const all = dataCollections({ data: {}, settings });
    const c = all[SETTINGS_COLLECTION];
    expect(c).toMatchObject({ scoped: false, single: true, agent: "none", context: false });
    expect(c.schema.safeParse({}).success).toBe(true);
    expect(c.schema.safeParse({ tone: "loud" }).success).toBe(false);
    expect(c.schema.parse({ tone: "neutral", extra: 1 })).toEqual({ tone: "neutral" });
  });
});

describe("settingsView", () => {
  it("is plain data in manifest order: options with labels, bounds, advanced, agent", () => {
    const view = settingsView(settings);
    expect(view.tab).toBe("How I learn");
    expect(view.sections).toEqual(declared.sections);
    expect(view.fields.map((f) => f.name)).toEqual(["tone", "hintAfter", "examples", "nickname"]);
    expect(view.fields[0]).toEqual({
      name: "tone",
      control: "segmented",
      label: "Tone",
      section: "voice",
      default: "patient",
      options: [
        { value: "patient", label: "Patient" },
        { value: "neutral", label: "Neutral" },
        { value: "demanding", label: "Demanding" },
      ],
      agent: true,
    });
    expect(view.fields[1]).toMatchObject({ control: "number", unit: "tries", advanced: true, min: 1, max: 5, default: 2 });
    expect(view.fields[3]).toEqual({ name: "nickname", control: "text", label: "What the app calls you", help: "Only the app's screens use it.", default: "", max: 40 });
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/harness-sdk/test/settings-values.test.ts`
Expected: FAIL (`settingsValues`, `dataCollections`, … are not exported).

- [ ] **Step 3: Implement**

At the top of `packages/harness-sdk/src/settings.ts`, add the import:

```ts
import { type Collection, collectionSchema } from "./data";
```

Append to `packages/harness-sdk/src/settings.ts`:

```ts
/** The reserved data collection that holds the person's settings (spec D2). */
export const SETTINGS_COLLECTION = "settings";
/** `check` warns when the settings' section of AGENTS.md is longer than this (spec §5 "Measuring"). */
export const SETTINGS_TOKENS_WARN = 400;

/**
 * The `settings` collection: app-wide, one record, hidden from the agent (it gets sentences: D3). Its fields are
 * optional: the record holds only what the person changed, and `settingsValues` fills the defaults on read.
 */
export function settingsCollection(settings: HarnessSettings): Collection {
  const shape = Object.fromEntries(Object.entries(settings.fields).map(([name, f]) => [name, f.schema.optional()]));
  return collectionSchema.parse({ scoped: false, single: true, schema: z.object(shape), agent: "none" });
}

/** Every collection the data store keeps: the harness's, plus `settings` when it declares settings (D0: `data` itself). */
export function dataCollections(h: { data: Record<string, Collection>; settings?: HarnessSettings }): Record<string, Collection> {
  return h.settings ? { ...h.data, [SETTINGS_COLLECTION]: settingsCollection(h.settings) } : h.data;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Two setting values are the same: they are plain JSON values. */
export const sameSetting = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Every field's value: the stored one when it is valid, else the default (a hand edit falls back field by field). */
export function settingsValues(settings: HarnessSettings, stored: unknown): Record<string, unknown> {
  const record = isRecord(stored) ? stored : {};
  return Object.fromEntries(
    Object.entries(settings.fields).map(([name, f]) => {
      if (Object.hasOwn(record, name)) {
        const parsed = f.schema.safeParse(record[name]);
        if (parsed.success && parsed.data !== undefined) return [name, parsed.data];
      }
      return [name, structuredClone(f.default)];
    }),
  );
}

const shown = (v: unknown): string => (typeof v === "boolean" ? (v ? "on" : "off") : typeof v === "string" || typeof v === "number" ? String(v) : JSON.stringify(v));

function labelOf(f: SettingField, value: unknown): string {
  const key = String(value);
  return f.options && Object.hasOwn(f.options, key) ? f.options[key] : shown(value);
}

/**
 * The agent's sentence for one field (spec §5), or null: a UI-only field, or an `onlyWhenChanged` one at its default
 * (unless `all`). Whitespace folds to single spaces: one sentence is one line of AGENTS.md.
 */
export function settingSentence(f: SettingField, value: unknown, opts: { all?: boolean } = {}): string | null {
  const template = agentText(f.agent);
  if (template === null) return null;
  const onlyWhenChanged = typeof f.agent === "object" && f.agent.onlyWhenChanged === true;
  if (onlyWhenChanged && !opts.all && sameSetting(value, f.default)) return null;
  const filled = template.replace(SETTING_PLACEHOLDER, (_m, p: string) => (p === "value:label" ? labelOf(f, value) : shown(value)));
  return filled.replace(/\s+/g, " ").trim() || null;
}

/** The sentences for AGENTS.md, in manifest order. */
export function settingsSentences(settings: HarnessSettings, values: Record<string, unknown>, opts: { all?: boolean } = {}): string[] {
  return Object.entries(settings.fields).flatMap(([name, f]) => {
    const sentence = settingSentence(f, Object.hasOwn(values, name) ? values[name] : f.default, opts);
    return sentence ? [sentence] : [];
  });
}

/** The fields the agent reads (they have a sentence): their changes wait for the next task (D4). */
export function agentSettings(settings: HarnessSettings): string[] {
  return Object.entries(settings.fields)
    .filter(([, f]) => agentText(f.agent) !== null)
    .map(([name]) => name);
}

/** One field as the window draws it: plain data, sent with the app state. */
export interface SettingFieldView {
  name: string;
  control: SettingControl;
  label: string;
  help?: string;
  unit?: string;
  section?: string;
  advanced?: true;
  default: unknown;
  /** segmented and select: the values in order, with their labels. */
  options?: { value: string; label: string }[];
  /** number: value bounds. text: length bounds. */
  min?: number;
  max?: number;
  /** The agent reads it: a change waits for the next task. */
  agent?: true;
}

/** What the harness's Settings tab draws (spec §4). */
export interface SettingsView {
  tab: string;
  sections: { id: string; label: string }[];
  fields: SettingFieldView[];
}

export function settingsView(settings: HarnessSettings): SettingsView {
  return {
    tab: settings.tab,
    sections: settings.sections.map((s) => ({ id: s.id, label: s.label })),
    fields: Object.entries(settings.fields).map(([name, f]): SettingFieldView => {
      const inferred = inferSetting(f.schema);
      const choice = f.control === "segmented" || f.control === "select";
      return {
        name,
        control: f.control,
        label: f.label,
        ...(f.help ? { help: f.help } : {}),
        ...(f.unit ? { unit: f.unit } : {}),
        ...(f.section ? { section: f.section } : {}),
        ...(f.advanced ? { advanced: true as const } : {}),
        default: structuredClone(f.default),
        ...(choice ? { options: (inferred.options ?? []).map((value) => ({ value, label: labelOf(f, value) })) } : {}),
        ...(inferred.min !== undefined ? { min: inferred.min } : {}),
        ...(inferred.max !== undefined ? { max: inferred.max } : {}),
        ...(agentText(f.agent) !== null ? { agent: true as const } : {}),
      };
    }),
  };
}
```

Note: `labelOf` for an option with no label returns the value itself (`shown` of a string), which is what the view test expects.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/harness-sdk/test/settings-values.test.ts packages/harness-sdk/test/settings.test.ts`
Expected: PASS.

Then: `corepack pnpm typecheck` and `corepack pnpm test`
Expected: both green.

- [ ] **Step 5: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/harness-sdk/src/settings.ts packages/harness-sdk/test/settings-values.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(sdk): settings values, sentences, collection and view

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

## Phase 2 — The agent's instructions (spec §8 slice 2, files part)

### Task 3: The managed section carries the sentences; a rewrite skips identical text

**Files:**
- Modify: `packages/workspace/src/instructions.ts`
- Test: `packages/workspace/test/instructions.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/workspace/test/instructions.test.ts` (and add `refreshInstructions, settingsLines` to the `../src` import):

```ts
describe("managedSection: settings", () => {
  it("writes the sentences after the core rules and before the interface tools", () => {
    const s = managedSection({ language: "en", blocks, settings: ["Use a patient tone.", "Give a hint after 2 failed tries, not before."] });
    const rules = s.indexOf("Work only inside this folder.");
    const heading = s.indexOf("### How to work with this person\n\n- Use a patient tone.\n- Give a hint after 2 failed tries, not before.\n");
    const tools = s.indexOf("### Interface tools");
    expect(rules).toBeGreaterThan(0);
    expect(heading).toBeGreaterThan(rules);
    expect(tools).toBeGreaterThan(heading);
  });

  it("D0: no settings, or none to say, is exactly today's section", () => {
    const today = managedSection({ language: "en", blocks });
    expect(managedSection({ language: "en", blocks, settings: [] })).toBe(today);
    expect(managedSection({ language: "en", blocks, settings: undefined })).toBe(today);
    expect(today).not.toContain("How to work with this person");
    expect(settingsLines(undefined)).toEqual([]);
  });
});

describe("refreshInstructions", () => {
  const opts = (folder: string, settings?: string[]) => ({ folder, base: "x", language: "en" as const, blocks, ...(settings ? { settings } : {}) });

  it("writes nothing when the text is the same, and rewrites AGENTS.md when it changed", async () => {
    const folder = tmp();
    await writeInstructions({ ...opts(folder, ["Use a patient tone."]), engine: getEngine("codex") });
    const file = path.join(folder, "AGENTS.md");
    const before = fs.statSync(file).mtimeMs;
    expect(await refreshInstructions(opts(folder, ["Use a patient tone."]))).toBe(false);
    expect(fs.statSync(file).mtimeMs).toBe(before);
    expect(await refreshInstructions(opts(folder, ["Use a demanding tone."]))).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toContain("- Use a demanding tone.");
    expect(fs.readFileSync(file, "utf8")).not.toContain("patient");
  });

  it("leaves no temp file in the folder or under .harness/", async () => {
    const folder = tmp();
    await refreshInstructions(opts(folder, ["Use a patient tone."]));
    expect(fs.readdirSync(folder).sort()).toEqual([".harness", "AGENTS.md"]);
    expect(fs.readdirSync(path.join(folder, ".harness"))).toEqual([]);
  });

  it("writes the same text as writeInstructions", async () => {
    const a = tmp();
    const b = tmp();
    await writeInstructions({ ...opts(a, ["Use a patient tone."]), engine: getEngine("codex") });
    await refreshInstructions(opts(b, ["Use a patient tone."]));
    expect(fs.readFileSync(path.join(b, "AGENTS.md"), "utf8")).toBe(fs.readFileSync(path.join(a, "AGENTS.md"), "utf8"));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/workspace/test/instructions.test.ts`
Expected: FAIL (`settingsLines` and `refreshInstructions` are not exported; `settings` is not an option).

- [ ] **Step 3: Implement**

In `packages/workspace/src/instructions.ts`:

1. Add `import { randomUUID } from "node:crypto";` to the imports.

2. In `TEXT`, after `rules: …,`, add:

```ts
  settings: "### How to work with this person",
```

3. Replace `managedSection`'s signature and first line with:

```ts
/** The settings' lines of the managed section (harness-settings spec §5): none without sentences (D0). */
export function settingsLines(sentences: readonly string[] | undefined): string[] {
  return sentences && sentences.length > 0 ? ["", TEXT.settings, "", ...sentences.map((s) => `- ${s}`)] : [];
}

export function managedSection(opts: { language: Language; blocks: Record<string, Block>; references?: ReferenceFolder[]; settings?: readonly string[] }): string {
  const t = TEXT;
  const lines = [MANAGED_START, t.title, "", ...t.rules(opts.language).map((r) => `- ${r}`), ...settingsLines(opts.settings)];
```

(The rest of `managedSection` is unchanged.)

4. Replace `writeInstructions` with the following, which adds `settings`, shares the text with the new `refreshInstructions`, and leaves the written bytes unchanged for every existing caller:

```ts
/** What AGENTS.md holds: the harness's base, then the managed section. */
export interface InstructionsText {
  base: string;
  language: Language;
  blocks: Record<string, Block>;
  references?: ReferenceFolder[];
  /** The harness's settings as sentences (harness-settings spec §5). Absent or empty: no section (D0). */
  settings?: readonly string[];
}

function agentsText(opts: InstructionsText): string {
  return `${opts.base.trimEnd()}\n\n${managedSection({ language: opts.language, blocks: opts.blocks, references: opts.references, settings: opts.settings })}`;
}

/** Writes AGENTS.md (harness base + managed section) and the engine's own file. Returns the relative paths written. */
export async function writeInstructions(opts: InstructionsText & { folder: string; engine: EngineDef }): Promise<string[]> {
  const extraPath = opts.engine.instructionsFile?.path;
  if (extraPath !== undefined && path.basename(extraPath) !== extraPath) {
    throw new Error(`Engine instructions file must be a plain file name, got "${extraPath}"`);
  }
  await fs.mkdir(opts.folder, { recursive: true });
  await fs.writeFile(path.join(opts.folder, "AGENTS.md"), agentsText(opts));
  const extra = opts.engine.instructionsFile;
  if (extra) await fs.writeFile(path.join(opts.folder, extra.path), extra.content);
  return generatedFiles(opts.engine);
}

/**
 * Rewrites AGENTS.md between tasks when its text changed (harness-settings spec §5). Identical text is left alone,
 * so the engine's cached prefix survives. The new text goes to a temp file under `.harness/` (which the history
 * ignores) and is renamed over AGENTS.md: a session or a commit made meanwhile never sees half a file. True when it wrote.
 */
export async function refreshInstructions(opts: InstructionsText & { folder: string }): Promise<boolean> {
  const file = path.join(opts.folder, "AGENTS.md");
  const text = agentsText(opts);
  const current = await fs.readFile(file, "utf8").catch(() => null);
  if (current === text) return false;
  const dir = path.join(opts.folder, ".harness");
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `AGENTS.md.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(tmp, text);
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
  return true;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/workspace/test/instructions.test.ts`
Expected: PASS, including every existing `managedSection` and `writeInstructions` test (their output is unchanged).

Then: `corepack pnpm typecheck` and `corepack pnpm test`
Expected: both green.

- [ ] **Step 5: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/workspace/src/instructions.ts packages/workspace/test/instructions.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(workspace): settings in the managed section; refresh skips identical text

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 4: The runtime writes the settings and can rewrite AGENTS.md

**Files:**
- Modify: `packages/runtime/src/runtime.ts`
- Test: `packages/runtime/test/runtime.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/runtime/test/runtime.test.ts`, extend the imports:

```ts
import { allBlocks, loadHarness, resolveInHarness } from "@humanharness/harness-sdk";
import { managedSection } from "@humanharness/workspace";
```

(replacing the existing `import { loadHarness } from "@humanharness/harness-sdk";`), then add inside `describe("createRuntime", …)`:

```ts
  it("puts the settings' sentences in AGENTS.md, and rewrites it only when they change (harness-settings §5)", async () => {
    let sentences = ["Use a patient tone."];
    const { runtime, folder } = await setup({ steps: [] }, undefined, { instructionSettings: async () => sentences });
    const agents = () => fs.readFileSync(path.join(folder, "AGENTS.md"), "utf8");
    expect(agents()).toContain("### How to work with this person\n\n- Use a patient tone.\n");
    expect(await runtime.refreshInstructions()).toBe(false);
    sentences = ["Use a demanding tone."];
    expect(await runtime.refreshInstructions()).toBe(true);
    expect(agents()).toContain("- Use a demanding tone.");
    expect(agents()).not.toContain("patient");
  });

  it("D0: without settings, AGENTS.md is the base and today's managed section, and a refresh writes nothing", async () => {
    const { runtime, folder } = await setup({ steps: [] });
    const harness = await loadHarness(FIXTURE);
    const base = fs.readFileSync(resolveInHarness(harness, harness.instructions), "utf8");
    expect(fs.readFileSync(path.join(folder, "AGENTS.md"), "utf8")).toBe(`${base.trimEnd()}\n\n${managedSection({ language: "en", blocks: allBlocks(harness) })}`);
    expect(await runtime.refreshInstructions()).toBe(false);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/runtime/test/runtime.test.ts`
Expected: FAIL (`instructionSettings` is not an option; `refreshInstructions` is not a method).

- [ ] **Step 3: Implement**

In `packages/runtime/src/runtime.ts`:

1. Add `refreshInstructions` to the `@humanharness/workspace` import list.

2. In `RuntimeOptions`, after `references?: ReferenceFolder[];`, add:

```ts
  /**
   * The harness's settings as sentences for AGENTS.md (harness-settings spec §5), asked when the runtime starts and
   * on every `refreshInstructions`. Absent: no settings section (D0).
   */
  instructionSettings?: () => Promise<string[]>;
```

3. In `HarnessRuntime`, after `endSession(): Promise<void>;`, add:

```ts
  /**
   * Rewrites AGENTS.md with the settings as they are now, when its text changed (spec §5). Only between tasks: the
   * next session reads it, a running one keeps what it started with (D4). True when it wrote.
   */
  refreshInstructions(): Promise<boolean>;
```

4. In `createRuntime`, replace the two lines that read the base and write the instructions with:

```ts
  const base = await fs.readFile(resolveInHarness(harness, harness.instructions), "utf8");
  const blocks = allBlocks(harness);
  const settings = await opts.instructionSettings?.();
  const generated = await writeInstructions({ folder, base, language: opts.language, blocks, references, engine, ...(settings ? { settings } : {}) });
```

5. In the object `buildRuntime` returns, after the `endSession` method, add:

```ts
      async refreshInstructions() {
        const now = await opts.instructionSettings?.();
        return refreshInstructions({ folder, base, language: opts.language, blocks, references, ...(now ? { settings: now } : {}) });
      },
```

(Inside the object literal the call resolves to the imported `refreshInstructions`: a method name never shadows an outer binding.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/runtime/test/runtime.test.ts`
Expected: PASS.

Then: `corepack pnpm typecheck` and `corepack pnpm test`
Expected: both green. (Test doubles of `HarnessRuntime` in `packages/shell/test/*.ts` are cast with `as unknown as HarnessRuntime`, so the new method needs no change there.)

- [ ] **Step 5: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/runtime/src/runtime.ts packages/runtime/test/runtime.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(runtime): settings sentences in AGENTS.md and refreshInstructions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

## Phase 3 — The main process (spec §8 slices 1 and 2: storage, deferral)

### Task 5: The task manager says when no session runs

**Files:**
- Modify: `packages/shell/src/main/task-manager.ts`
- Test: `packages/shell/test/task-manager.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/shell/test/task-manager.test.ts`:

1. In `setup`'s `opts` type, after `recordCompaction?: …;`, add:

```ts
    /** betweenTasks: logged as "between", then this runs. */
    betweenTasks?: () => void;
```

2. In the `new TaskManager({ … })` call, after the `recordCompaction` spread, add:

```ts
    ...(opts.betweenTasks
      ? {
          betweenTasks: async () => {
            log.push("between");
            opts.betweenTasks!();
          },
        }
      : {}),
```

3. Append a new `describe` block:

```ts
describe("TaskManager: between tasks (harness-settings D4)", () => {
  const sessions = (log: string[]) => log.filter((l) => l === "endSession" || l === "between" || l.startsWith("turn:"));

  it("runs betweenTasks after a task ends and before the next task's first turn", async () => {
    const t = setup({ betweenTasks: () => {} });
    await t.manager.start("manifest");
    await pick(t, { label: "Next", next: true });
    expect(sessions(t.log)).toEqual(["endSession", "between", "turn:run", "turn:close", "endSession", "between", "endSession", "between", "turn:run"]);
  });

  it("runs it when the open task is interrupted, and when a first turn fails", async () => {
    const t = setup({ betweenTasks: () => {} });
    await t.manager.start("manifest");
    await t.manager.interrupt();
    expect(t.log.at(-1)).toBe("between");
    const u = setup({ betweenTasks: () => {}, script: [[crashed]] });
    await u.manager.start("manifest");
    expect(u.state().current).toBeNull();
    expect(u.log.at(-1)).toBe("between");
  });

  it("a failing betweenTasks is logged and never stops the task", async () => {
    const t = setup({
      betweenTasks: () => {
        throw new Error("disk full");
      },
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await t.manager.start("manifest");
    expect(t.state().current).toMatchObject({ status: "waiting" });
    expect(errors).toHaveBeenCalledWith("Could not prepare the next session", expect.any(Error));
    errors.mockRestore();
  });

  it("whenNoTask runs after the running operation, and only when no task is open then", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const t = setup({ gate });
    const order: string[] = [];
    const started = t.manager.start("manifest").then(() => void order.push("started"));
    const ran = t.manager.whenNoTask(async () => void order.push("fn"));
    release();
    expect(await ran).toBe(false);
    await started;
    expect(order).toEqual(["started"]);

    await t.manager.interrupt();
    expect(await t.manager.whenNoTask(async () => void order.push("fn"))).toBe(true);
    expect(order).toEqual(["started", "fn"]);
  });

  it("D0: without betweenTasks nothing new runs", async () => {
    const t = setup();
    await t.manager.start("manifest");
    await pick(t, { label: "Next", next: true });
    expect(t.log).not.toContain("between");
  });
});
```

(The `started` promise resolves after `ran`, because `whenNoTask` was queued while the start operation ran and resolves within that queue position; the order check therefore only asserts that `fn` didn't run.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/shell/test/task-manager.test.ts`
Expected: FAIL (`betweenTasks` isn't a dep; `whenNoTask` isn't a method).

- [ ] **Step 3: Implement**

In `packages/shell/src/main/task-manager.ts`:

1. In `TaskDeps`, after `saveAnswer?(…): Promise<void>;`, add:

```ts
  /**
   * No task's session runs now: one just ended (closed, interrupted, failed), or a new one is about to start. The
   * harness's settings rewrite AGENTS.md here (harness-settings spec D4). Failures are logged. Absent: nothing (D0).
   */
  betweenTasks?(): Promise<void>;
```

2. After the public `sessionStarted` method, add:

```ts
  /**
   * Runs `fn` after the running task operation, if no task is open then (harness-settings spec D4): true when it ran.
   * Queued like `interrupt`, so a new session never starts while `fn` runs.
   */
  whenNoTask(fn: () => Promise<void>): Promise<boolean> {
    return this.queue(async () => {
      if ((await this.d.store.load()).current) return false;
      await fn();
      return true;
    });
  }
```

3. Next to the private `endSession` method, add:

```ts
  private async between(): Promise<void> {
    try {
      await this.d.betweenTasks?.();
    } catch (err) {
      console.error("Could not prepare the next session", err);
    }
  }
```

4. In `begin`, right after `await this.endSession();`, add:

```ts
    await this.between();
```

5. In `endTask`, right after `await this.endSession();`, add:

```ts
    await this.between();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/shell/test/task-manager.test.ts packages/shell/test/task-manager-input.test.ts packages/shell/test/task-manager-scopes.test.ts`
Expected: PASS (the earlier tests pass no `betweenTasks`, so their logs are unchanged).

Then: `corepack pnpm typecheck` and `corepack pnpm test`
Expected: both green.

- [ ] **Step 5: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/shell/src/main/task-manager.ts packages/shell/test/task-manager.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(shell): betweenTasks hook and whenNoTask on the task manager

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 6: `SettingsController`: values, saving, pending, the deferred rewrite

**Files:**
- Create: `packages/shell/src/main/settings.ts`
- Modify: `packages/ui/src/client.ts` (two types)
- Test: `packages/shell/test/settings.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/shell/test/settings.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SETTINGS_COLLECTION, dataCollections, settingsSchema, z } from "@humanharness/harness-sdk";
import type { SettingsState } from "@humanharness/ui/client";
import { APP_SCOPE, DataStore, runDataRequest } from "@humanharness/workspace";
import { SettingsController } from "../src/main/settings";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-settings-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const settings = settingsSchema.parse({
  tab: "How I learn",
  fields: {
    tone: { schema: z.enum(["patient", "demanding"]), default: "patient", control: "segmented", label: "Tone", agent: "Use a {{value}} tone." },
    hintAfter: { schema: z.number().int().min(1).max(5), default: 2, control: "number", label: "Hint after", agent: "Hint after {{value}} tries." },
    nickname: { schema: z.string().max(40), default: "", control: "text", label: "Nickname" },
  },
});

function setup(opts: { taskOpen?: boolean } = {}) {
  const base = fs.mkdtempSync(path.join(root, "s-"));
  const store = new DataStore(base, dataCollections({ data: {}, settings }));
  let taskOpen = opts.taskOpen ?? false;
  let failRefresh = false;
  const log: string[] = [];
  const pushed: SettingsState[] = [];
  const ctl: SettingsController = new SettingsController({
    settings,
    store: async () => store,
    write: (request) => runDataRequest(store, request, { who: "person", scope: APP_SCOPE }),
    taskOpen: async () => taskOpen,
    whenNoTask: async (fn) => {
      if (taskOpen) return false;
      await fn();
      return true;
    },
    // A runtime's refresh asks the controller for the sentences, as createRuntime and refreshInstructions do.
    refresh: async () => {
      log.push("refresh");
      if (failRefresh) throw new Error("disk full");
      await ctl.sentences();
      return true;
    },
    changed: (s) => void pushed.push(s),
    log: (message) => void log.push(`log:${message}`),
  });
  store.onChange((c) => {
    if (c.collection === SETTINGS_COLLECTION) void ctl.changed();
  });
  const file = path.join(base, ".harness", "data", "_app", "settings.json");
  return {
    ctl,
    log,
    pushed,
    file,
    stored: () => JSON.parse(fs.readFileSync(file, "utf8")) as unknown,
    task: (open: boolean) => void (taskOpen = open),
    failRefresh: (fail: boolean) => void (failRefresh = fail),
  };
}

describe("SettingsController", () => {
  it("answers every field's value, the defaults when nothing is stored, nothing pending", async () => {
    const t = setup();
    expect(await t.ctl.state()).toEqual({ values: { tone: "patient", hintAfter: 2, nickname: "" }, pending: [] });
    expect(fs.existsSync(t.file)).toBe(false);
  });

  it("stores only what differs from the default; back to the default removes it, and the file when empty", async () => {
    const t = setup();
    expect(await t.ctl.set("tone", "demanding")).toEqual({ ok: true, state: { values: { tone: "demanding", hintAfter: 2, nickname: "" }, pending: [] } });
    expect(t.stored()).toEqual({ tone: "demanding" });
    await t.ctl.set("hintAfter", 4);
    expect(t.stored()).toEqual({ tone: "demanding", hintAfter: 4 });
    await t.ctl.set("tone", "patient");
    expect(t.stored()).toEqual({ hintAfter: 4 });
    await t.ctl.set("hintAfter", 2);
    expect(fs.existsSync(t.file)).toBe(false);
  });

  it("refuses an unknown or inherited name and an invalid value, as data", async () => {
    const t = setup();
    expect(await t.ctl.set("nope", 1)).toEqual({ ok: false, message: "Unknown setting" });
    expect(await t.ctl.set("toString", 1)).toEqual({ ok: false, message: "Unknown setting" });
    const r = await t.ctl.set("hintAfter", 9);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.message).toMatch(/5/);
    expect(fs.existsSync(t.file)).toBe(false);
  });

  it("a file broken by hand reads as the defaults and refuses writes with the store's message", async () => {
    const t = setup();
    fs.mkdirSync(path.dirname(t.file), { recursive: true });
    fs.writeFileSync(t.file, "{");
    expect((await t.ctl.state()).values.tone).toBe("patient");
    const r = await t.ctl.set("tone", "demanding");
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining("changed by hand") });
  });

  it("reset deletes the stored record", async () => {
    const t = setup();
    await t.ctl.set("tone", "demanding");
    expect(await t.ctl.reset()).toEqual({ ok: true, state: { values: { tone: "patient", hintAfter: 2, nickname: "" }, pending: [] } });
    expect(fs.existsSync(t.file)).toBe(false);
  });

  it("with no task open, a change rewrites AGENTS.md at once and tells the window", async () => {
    const t = setup();
    await t.ctl.set("tone", "demanding");
    await t.ctl.idle();
    expect(t.log).toEqual(["refresh"]);
    expect(t.pushed.at(-1)).toEqual({ values: { tone: "demanding", hintAfter: 2, nickname: "" }, pending: [] });
  });

  it("with a task open, it waits: agent fields are pending until betweenTasks applies them (D4)", async () => {
    const t = setup({ taskOpen: true });
    // The runtime started with the defaults.
    expect(await t.ctl.sentences()).toEqual(["Use a patient tone.", "Hint after 2 tries."]);
    const r = await t.ctl.set("hintAfter", 4);
    expect(r).toMatchObject({ ok: true, state: { pending: ["hintAfter"] } });
    // A UI-only field applies at once: never pending.
    expect(await t.ctl.set("nickname", "Ana")).toMatchObject({ ok: true, state: { pending: ["hintAfter"] } });
    await t.ctl.idle();
    expect(t.log).toEqual([]);
    t.task(false);
    await t.ctl.betweenTasks();
    expect(t.log).toEqual(["refresh"]);
    expect(t.pushed.at(-1)?.pending).toEqual([]);
    // Nothing stale any more: the next session's start rewrites nothing.
    await t.ctl.betweenTasks();
    expect(t.log).toEqual(["refresh"]);
  });

  it("a failed rewrite stays stale and is tried again between tasks", async () => {
    const t = setup();
    t.failRefresh(true);
    await t.ctl.set("tone", "demanding");
    await t.ctl.idle();
    expect(t.log).toEqual(["refresh", "log:Could not rewrite AGENTS.md with the settings"]);
    t.failRefresh(false);
    await t.ctl.betweenTasks();
    expect(t.log.filter((l) => l === "refresh")).toHaveLength(2);
  });

  it("the sentences follow the stored values; forget drops what the last AGENTS.md held", async () => {
    const t = setup({ taskOpen: true });
    await t.ctl.set("tone", "demanding");
    expect(await t.ctl.sentences()).toEqual(["Use a demanding tone.", "Hint after 2 tries."]);
    await t.ctl.set("hintAfter", 3);
    expect((await t.ctl.state()).pending).toEqual(["hintAfter"]);
    t.ctl.forget();
    expect((await t.ctl.state()).pending).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/shell/test/settings.test.ts`
Expected: FAIL (`../src/main/settings` does not exist; `SettingsState` is not exported by the client).

- [ ] **Step 3: Implement**

In `packages/ui/src/client.ts`, after the `DataOptions` interface, add:

```ts
/** The harness's settings as the window sees them (harness-settings spec §4). */
export interface SettingsState {
  /** Every field's value: the stored one, else its default. */
  values: Record<string, unknown>;
  /** Fields the agent reads whose new value waits for the next task (D4). */
  pending: string[];
}

/** How a settings change ended: the new state, or why it was refused (`message` absent: something went wrong). */
export type SettingsResult = { ok: true; state: SettingsState } | { ok: false; message?: string };
```

Create `packages/shell/src/main/settings.ts`:

```ts
import { type HarnessSettings, SETTINGS_COLLECTION, agentSettings, sameSetting, settingsSentences, settingsValues } from "@humanharness/harness-sdk";
import type { SettingsResult, SettingsState } from "@humanharness/ui/client";
import { APP_SCOPE, type DataContext, DataError, type DataRequest, type DataStore } from "@humanharness/workspace";

/** The person, app-wide: settings belong to no scope (spec D2). */
const PERSON: DataContext = { who: "person", scope: APP_SCOPE };

export interface SettingsDeps {
  settings: HarnessSettings;
  /** The configured folder's data store; null before the app is set up. */
  store(): Promise<DataStore | null>;
  /** Writes as the person: `hh:data`'s handler, with its checks and its `Data: settings` history commit. */
  write(request: DataRequest): Promise<unknown>;
  /** A task is open: its session keeps the AGENTS.md it started with. */
  taskOpen(): Promise<boolean>;
  /** TaskManager.whenNoTask: runs `fn` after the running operation, if no task is open then. */
  whenNoTask(fn: () => Promise<void>): Promise<boolean>;
  /** Rewrites AGENTS.md when its text changed (the running runtime); false when no runtime runs: the next one writes it. */
  refresh(): Promise<boolean>;
  /** Tells the window. */
  changed(state: SettingsState): void;
  log?(message: string, err?: unknown): void;
}

/**
 * The harness's settings in the main process (harness-settings spec §4, §5). Values live in the data store's reserved
 * `settings` collection, holding only what the person changed. A change reaches AGENTS.md between tasks, never under a
 * running session (D4): `changed` marks the settings stale and asks for a rewrite once no task is open, and the task
 * manager's `betweenTasks` applies whatever is still stale before the next session starts.
 */
export class SettingsController {
  /** The values the current AGENTS.md was written with (null: none written yet, or the runtime went). */
  private applied: Record<string, unknown> | null = null;
  private stale = false;
  private writes: Promise<unknown> = Promise.resolve();
  private work: Promise<void> = Promise.resolve();

  constructor(private readonly d: SettingsDeps) {}

  /** Every field's value: stored, else the default. A store that can't be read gives the defaults. */
  async values(): Promise<Record<string, unknown>> {
    const store = await this.d.store().catch(() => null);
    const stored = store ? await store.get(SETTINGS_COLLECTION, undefined, PERSON).catch(() => null) : null;
    return settingsValues(this.d.settings, stored);
  }

  /** The sentences for AGENTS.md, as they are now; remembered as what the agent was told. */
  async sentences(): Promise<string[]> {
    const values = await this.values();
    this.applied = values;
    return settingsSentences(this.d.settings, values);
  }

  async state(): Promise<SettingsState> {
    const values = await this.values();
    const applied = this.applied;
    const open = applied !== null && (await this.d.taskOpen());
    const pending = open ? agentSettings(this.d.settings).filter((name) => !sameSetting(applied[name], values[name])) : [];
    return { values, pending };
  }

  /** The person changed one field (the tab saves each change at once). Back to its default, it is removed. */
  set(field: unknown, value: unknown): Promise<SettingsResult> {
    return this.serial(async () => {
      if (typeof field !== "string" || !Object.hasOwn(this.d.settings.fields, field)) return { ok: false, message: "Unknown setting" };
      const f = this.d.settings.fields[field];
      const parsed = f.schema.safeParse(value);
      if (!parsed.success) return { ok: false, message: parsed.error.issues.map((i) => i.message).join("; ") };
      const store = await this.d.store();
      if (!store) return { ok: false, message: "The app is not set up yet" };
      const stored = (await store.get(SETTINGS_COLLECTION, undefined, PERSON).catch(() => null)) ?? {};
      const next: Record<string, unknown> = { ...stored };
      if (sameSetting(parsed.data, f.default)) delete next[field];
      else next[field] = parsed.data;
      if (sameSetting(next, stored)) return { ok: true, state: await this.state() };
      return this.save(Object.keys(next).length > 0 ? { op: "put", collection: SETTINGS_COLLECTION, record: next } : { op: "delete", collection: SETTINGS_COLLECTION });
    });
  }

  /** "Back to the app's defaults": the stored record goes. */
  reset(): Promise<SettingsResult> {
    return this.serial(() => this.save({ op: "delete", collection: SETTINGS_COLLECTION }));
  }

  /**
   * The stored settings changed (any writer, or a restore): the window hears it, and AGENTS.md follows once no task is
   * open (D4). A task open now keeps them stale until `betweenTasks`.
   */
  changed(): Promise<void> {
    this.stale = true;
    const run = (async () => {
      await this.push();
      try {
        await this.d.whenNoTask(() => this.apply());
      } catch (err) {
        this.log("Could not apply the settings", err);
      }
    })();
    this.work = Promise.all([this.work, run]).then(() => undefined);
    return run;
  }

  /** TaskManager's `betweenTasks`: no session runs; a stale change reaches AGENTS.md now. */
  betweenTasks(): Promise<void> {
    return this.apply();
  }

  /** The runtime went (engine change, folder change, quit): the next one writes AGENTS.md afresh. */
  forget(): void {
    this.applied = null;
    this.stale = false;
  }

  /** Resolves once every `changed` started so far has finished (tests). */
  idle(): Promise<void> {
    return this.work;
  }

  private async apply(): Promise<void> {
    if (!this.stale) return;
    this.stale = false;
    try {
      await this.d.refresh();
    } catch (err) {
      this.stale = true;
      this.log("Could not rewrite AGENTS.md with the settings", err);
      return;
    }
    await this.push();
  }

  private async save(request: DataRequest): Promise<SettingsResult> {
    try {
      await this.d.write(request);
    } catch (err) {
      if (err instanceof DataError) return { ok: false, message: err.message };
      this.log("Could not save the settings", err);
      return { ok: false };
    }
    return { ok: true, state: await this.state() };
  }

  private async push(): Promise<void> {
    try {
      this.d.changed(await this.state());
    } catch (err) {
      this.log("Could not send the settings to the window", err);
    }
  }

  private log(message: string, err?: unknown): void {
    if (this.d.log) this.d.log(message, err);
    else console.error(message, err);
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writes.then(fn, fn);
    this.writes = run.catch(() => undefined);
    return run;
  }
}
```

Notes for the implementer:
- `state()` checks `applied !== null` first: before any `AGENTS.md` was written there is nothing to be pending against.
- The test's `whenNoTask` runs `fn` inline. The real one queues it behind the running operation; both only run it with no task open.
- `set` → `write` → the store emits → the listener calls `changed()` without awaiting it. `set` answers with the state right after the write, which already lists the pending field.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/shell/test/settings.test.ts`
Expected: PASS.

Then: `corepack pnpm typecheck` and `corepack pnpm test`
Expected: both green.

- [ ] **Step 5: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/shell/src/main/settings.ts packages/shell/test/settings.test.ts packages/ui/src/client.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(shell): SettingsController saves settings and defers AGENTS.md

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 7: Wire it: the store, the runtime, the hooks, IPC, the preload, the client

**Files:**
- Modify: `packages/shell/src/main/index.ts`, `packages/shell/src/preload/index.ts`, `packages/ui/src/client.ts`, `packages/ui/test/fake-client.ts`
- Test: `packages/ui/test/client.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/ui/test/client.test.ts`:

```ts
import { FakeClient } from "./fake-client";

describe("FakeClient settings", () => {
  it("answers values, saves, resets to the view's defaults and tells listeners", async () => {
    const client = new FakeClient();
    client.state.settings = {
      tab: "Mine",
      sections: [],
      fields: [{ name: "tone", control: "segmented", label: "Tone", default: "patient", options: [{ value: "patient", label: "Patient" }, { value: "demanding", label: "Demanding" }], agent: true }],
    };
    client.settingsState = { values: { tone: "patient" }, pending: [] };
    const heard: unknown[] = [];
    const off = client.settings.onChange((s) => heard.push(s.values.tone));
    expect(await client.settings.set("tone", "demanding")).toEqual({ ok: true, state: { values: { tone: "demanding" }, pending: [] } });
    expect(await client.settings.reset()).toEqual({ ok: true, state: { values: { tone: "patient" }, pending: [] } });
    off();
    expect(heard).toEqual(["demanding", "patient"]);
    expect(client.settingsSets).toEqual([{ field: "tone", value: "demanding" }]);
    expect(client.settingsResets).toBe(1);
  });
});
```

(Merge the `FakeClient` import with the file's existing imports if it already has one.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/ui/test/client.test.ts`
Expected: FAIL (`AppState` has no `settings`; `FakeClient` has no `settings`).

- [ ] **Step 3: Implement**

**`packages/ui/src/client.ts`:**

1. Add `SettingFieldView` and `SettingsView` to the `import type { … } from "@humanharness/harness-sdk";` list.

2. In `AppState`, after `inputs?: …;`, add:

```ts
  /** The harness's settings (manifest `settings`): its own Settings tab. Absent: no tab (harness-settings D0). */
  settings?: SettingsView;
```

3. In `HarnessClient`, after `dataDiff(taskId: string): Promise<DataDiffView[]>;`, add:

```ts
  /** The harness's settings (harness-settings spec §4). A harness with none answers no values and refuses changes. */
  settings: {
    /** Every field's value (the default when unchanged) and the fields waiting for the next task. */
    get(): Promise<SettingsState>;
    /** Saves one field now, as the person. Refusals come back as data. */
    set(field: string, value: unknown): Promise<SettingsResult>;
    /** Every field back to its default. */
    reset(): Promise<SettingsResult>;
    onChange(listener: (state: SettingsState) => void): () => void;
  };
```

4. Add `SettingFieldView` and `SettingsView` to the final `export type { … }` list.

**`packages/ui/test/fake-client.ts`:**

1. Add `SettingsResult` and `SettingsState` to the type imports from `../src/client`.

2. After `openResult = true;`, add:

```ts
  /** What settings.get answers. */
  settingsState: { values: Record<string, unknown>; pending: string[] } = { values: {}, pending: [] };
  /** What settings.set was asked, in order. */
  settingsSets: { field: string; value: unknown }[] = [];
  settingsResets = 0;
  /** When set, settings.set and reset answer it instead of saving. */
  settingsFailure: SettingsResult | null = null;
  private settingsListeners = new Set<(s: SettingsState) => void>();
```

3. Before the closing brace of the class, add:

```ts
  /** The main process sent new settings (a pending field applied, another window's change). */
  emitSettings(state: SettingsState) {
    this.settingsState = state;
    for (const l of this.settingsListeners) l(state);
  }
  settings = {
    get: async () => this.settingsState,
    set: async (field: string, value: unknown): Promise<SettingsResult> => {
      this.settingsSets.push({ field, value });
      if (this.settingsFailure) return this.settingsFailure;
      this.emitSettings({ ...this.settingsState, values: { ...this.settingsState.values, [field]: value } });
      return { ok: true, state: this.settingsState };
    },
    reset: async (): Promise<SettingsResult> => {
      this.settingsResets++;
      if (this.settingsFailure) return this.settingsFailure;
      const defaults = Object.fromEntries((this.state.settings?.fields ?? []).map((f) => [f.name, f.default]));
      this.emitSettings({ values: defaults, pending: [] });
      return { ok: true, state: this.settingsState };
    },
    onChange: (listener: (s: SettingsState) => void) => {
      this.settingsListeners.add(listener);
      return () => {
        this.settingsListeners.delete(listener);
      };
    },
  };
```

**`packages/shell/src/preload/index.ts`:**

1. Add `SettingsState` to the type import from `@humanharness/ui/client`.

2. After the `dataDiff` line, add:

```ts
  settings: {
    get: () => ipcRenderer.invoke("hh:settings"),
    set: (field, value) => ipcRenderer.invoke("hh:settingsSet", field, value),
    reset: () => ipcRenderer.invoke("hh:settingsReset"),
    onChange: (listener) => subscribe<SettingsState>("hh:settings", listener),
  },
```

**`packages/shell/src/main/index.ts`:**

1. Imports:
   - add `SETTINGS_COLLECTION, dataCollections, settingsView` to the `@humanharness/harness-sdk` import;
   - add `APP_SCOPE` to the `@humanharness/workspace` import;
   - add `import { SettingsController } from "./settings";` next to the other local imports.

2. Below `let references: …`, add:

```ts
/** The harness's settings (harness-settings spec); null when it declares none (D0). Set once the harness is loaded. */
let settingsCtl: SettingsController | null = null;
```

3. In `appState()`, after the `inputs` spread, add:

```ts
    // Only a harness with settings gets its tab (harness-settings D0).
    ...(harness.settings ? { settings: settingsView(harness.settings) } : {}),
```

4. In `dataStoreFor`, replace the two lines that build the store and its listener with:

```ts
    // The harness's collections, plus the reserved `settings` one when it declares settings (D0: harness.data itself).
    const store = new DataStore(base, dataCollections(harness));
    // Spec §4.5 `subscribe`: every write, from any writer, reaches the window. A settings write also reaches AGENTS.md (D4).
    entry = {
      store,
      off: store.onChange((change) => {
        sendToWindow("hh:dataChange", change);
        if (change.collection === SETTINGS_COLLECTION) void settingsCtl?.changed();
      }),
    };
```

5. In the `runtime` memo's `createRuntime({ … })` call, after the `references` line, add:

```ts
    // The settings' sentences, read now and on every refresh (harness-settings spec §5).
    ...(settingsCtl ? { instructionSettings: () => settingsCtl!.sentences() } : {}),
```

6. In `closeRuntime`, after `runtime.clear();`, add:

```ts
  // The next runtime writes AGENTS.md afresh: nothing is pending against this one's.
  settingsCtl?.forget();
```

7. In the `new TaskManager({ … })` deps, after the `dataContext` getter, add:

```ts
  // A getter, because the harness is loaded after this object is built. Undefined without settings (D0).
  get betweenTasks() {
    const ctl = settingsCtl;
    return ctl ? () => ctl.betweenTasks() : undefined;
  },
```

8. In `registerIpc()`, after the `hh:dataDiff` handler, add:

```ts
  // The harness's Settings tab (harness-settings spec §4). Refusals come back as data: Electron flattens thrown errors.
  handle("hh:settings", () => (settingsCtl ? settingsCtl.state() : { values: {}, pending: [] }));
  handle("hh:settingsSet", (field: unknown, value: unknown) =>
    settingsCtl ? settingsCtl.set(field, value) : { ok: false, message: "This harness has no settings" },
  );
  handle("hh:settingsReset", () => (settingsCtl ? settingsCtl.reset() : { ok: false, message: "This harness has no settings" }));
```

9. Replace the `hh:restore` and `hh:restoreTask` handlers with versions that tell the settings (a restore changes tracked files with no data event):

```ts
  handle("hh:restore", (sha: unknown) => {
    if (!isSha(sha)) throw new Error("Invalid point");
    return restoreWith((history) => history.restore(sha, RESTORE_POINT)).then(() => void settingsCtl?.changed());
  });
```

```ts
  handle("hh:restoreTask", (taskId: unknown) =>
    restoreWith(async (history) => {
      if (typeof taskId !== "string" || !taskId || taskId.length > 200) throw new Error("Invalid task");
      const group = (await history.tasks()).find((g) => g.taskId === taskId);
      if (!group?.start) throw new Error("Nothing to go back to");
      await history.restore(group.start, RESTORE_TASK);
    }).then(() => void settingsCtl?.changed()),
  );
```

(Keep the `hh:historyTasks` handler between them as it is.)

10. In the `if (loaded) { … }` block, after `app.setPath("userData", …);`, add:

```ts
  if (harness.settings) {
    settingsCtl = new SettingsController({
      settings: harness.settings,
      store: async () => {
        const c = await validConfig();
        return c ? dataStoreFor(baseOf(c)) : null;
      },
      // As the person, app-wide: the store's checks, turns-blocked refusals and a `Data: settings` commit.
      write: (request) => personData(request, { scope: APP_SCOPE }),
      taskOpen: async () => (await tasks.runningTask()) !== null,
      whenNoTask: (fn) => tasks.whenNoTask(fn),
      refresh: async () => {
        const rt = await runtime.peek()?.catch(() => null);
        return rt ? rt.refreshInstructions() : false;
      },
      changed: (state) => sendToWindow("hh:settings", state),
    });
  }
```

`hh:dataDiff` keeps `harness.data`: settings are not a task's output, so "what changed in this session" leaves them out (written in `docs/architecture/settings.md`, Task 12).

- [ ] **Step 4: Run the tests and the build**

Run: `corepack pnpm vitest run packages/ui/test/client.test.ts`
Expected: PASS.

Then: `corepack pnpm typecheck`, `corepack pnpm test` and `corepack pnpm app:build`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/shell/src/main/index.ts packages/shell/src/preload/index.ts packages/ui/src/client.ts packages/ui/test/fake-client.ts packages/ui/test/client.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(shell): wire harness settings into the store, runtime, tasks and IPC

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

## Phase 4 — The window (spec §4)

### Task 8: The harness's Settings tab

**Files:**
- Create: `packages/ui/src/HarnessSettingsTab.tsx`
- Modify: `packages/i18n/src/locales/en.json`, `packages/ui/src/styles.css`
- Test: `packages/ui/test/harness-settings.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/ui/test/harness-settings.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SettingsView } from "../src/client";
import { HarnessSettingsTab } from "../src/HarnessSettingsTab";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const view: SettingsView = {
  tab: "How I learn",
  sections: [
    { id: "voice", label: "How the AI talks" },
    { id: "help", label: "Help" },
  ],
  fields: [
    { name: "nickname", control: "text", label: "What the app calls you", help: "Only the app's screens use it.", default: "", max: 40 },
    {
      name: "tone",
      control: "segmented",
      label: "Tone",
      section: "voice",
      default: "patient",
      options: [
        { value: "patient", label: "Patient" },
        { value: "demanding", label: "Demanding" },
      ],
      agent: true,
    },
    { name: "level", control: "select", label: "Level", section: "voice", default: "6", options: [{ value: "5", label: "5th grade" }, { value: "6", label: "6th grade" }], agent: true },
    { name: "examples", control: "toggle", label: "Show worked examples", section: "help", default: true, agent: true },
    { name: "hintAfter", control: "number", label: "Hint after", unit: "tries", section: "help", advanced: true, default: 2, min: 1, max: 5, agent: true },
  ],
};
const defaults = { nickname: "", tone: "patient", level: "6", examples: true, hintAfter: 2 };

async function draw(client = new FakeClient()) {
  client.state.settings = view;
  client.settingsState = { values: { ...defaults }, pending: [] };
  await renderIn("en", <HarnessSettingsTab client={client} view={view} />);
  await screen.findByRole("group", { name: "Tone" });
  return client;
}

describe("HarnessSettingsTab", () => {
  it("draws the unsectioned fields first, then each section with its controls", async () => {
    await draw();
    expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual(["How the AI talks", "Help"]);
    expect(within(screen.getByRole("group", { name: "Tone" })).getByRole("button", { name: "Patient" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByLabelText("Level") as HTMLSelectElement).value).toBe("6");
    expect((screen.getByRole("switch", { name: "Show worked examples" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("Only the app's screens use it.")).toBeTruthy();
  });

  it("saves segmented, select and switch changes at once", async () => {
    const client = await draw();
    fireEvent.click(screen.getByRole("button", { name: "Demanding" }));
    fireEvent.change(screen.getByLabelText("Level"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("switch", { name: "Show worked examples" }));
    await screen.findByRole("button", { name: "Back to the app's defaults" });
    expect(client.settingsSets).toEqual([
      { field: "tone", value: "demanding" },
      { field: "level", value: "5" },
      { field: "examples", value: false },
    ]);
    expect(screen.getByRole("button", { name: "Demanding" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps advanced fields under More options; a number saves on blur, as a number", async () => {
    const client = await draw();
    expect(screen.queryByLabelText("Hint after")).toBeNull();
    const more = screen.getByRole("button", { name: "More options" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    const input = screen.getByLabelText("Hint after") as HTMLInputElement;
    expect([input.min, input.max]).toEqual(["1", "5"]);
    fireEvent.change(input, { target: { value: "4" } });
    expect(client.settingsSets).toEqual([]);
    fireEvent.blur(input);
    await screen.findByRole("button", { name: "Back to the app's defaults" });
    expect(client.settingsSets).toEqual([{ field: "hintAfter", value: 4 }]);
  });

  it("an empty number goes back to the saved value; text saves on Enter", async () => {
    const client = await draw();
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    const input = screen.getByLabelText("Hint after") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(input.value).toBe("2");
    const name = screen.getByLabelText("What the app calls you") as HTMLInputElement;
    expect(name.maxLength).toBe(40);
    fireEvent.change(name, { target: { value: "Ana" } });
    fireEvent.keyDown(name, { key: "Enter" });
    await screen.findByRole("button", { name: "Back to the app's defaults" });
    expect(client.settingsSets).toEqual([{ field: "nickname", value: "Ana" }]);
  });

  it("shows a refusal under its field, and a generic line when there is no message", async () => {
    const client = new FakeClient();
    client.settingsFailure = { ok: false, message: "Too big: expected number to be <=5" };
    await draw(client);
    fireEvent.click(screen.getByRole("button", { name: "Demanding" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Too big: expected number to be <=5");
    client.settingsFailure = { ok: false };
    fireEvent.click(screen.getByRole("switch", { name: "Show worked examples" }));
    expect((await screen.findAllByRole("alert")).map((a) => a.textContent)).toContain("That didn't save. Try again.");
  });

  it("while a task is open: the next-task line, and Pending on waiting fields", async () => {
    const client = new FakeClient();
    client.tasks = { current: { id: "t1", status: "waiting" }, actions: {}, notes: [] };
    await draw(client);
    expect(screen.getByRole("status").textContent).toBe("Changes apply from the next task.");
    act(() => client.emitSettings({ values: { ...defaults, tone: "demanding" }, pending: ["tone"] }));
    expect(screen.getByText("Pending")).toBeTruthy();
    act(() => client.emitTasks({ current: null, actions: {}, notes: [] }));
    act(() => client.emitSettings({ values: { ...defaults, tone: "demanding" }, pending: [] }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText("Pending")).toBeNull();
  });

  it("offers the reset only when something differs from its default", async () => {
    const client = await draw();
    expect(screen.queryByRole("button", { name: "Back to the app's defaults" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Demanding" }));
    fireEvent.click(await screen.findByRole("button", { name: "Back to the app's defaults" }));
    await screen.findByRole("group", { name: "Tone" });
    expect(client.settingsResets).toBe(1);
    expect(screen.getByRole("button", { name: "Patient" }).getAttribute("aria-pressed")).toBe("true");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/ui/test/harness-settings.test.tsx`
Expected: FAIL (`../src/HarnessSettingsTab` does not exist).

- [ ] **Step 3: Implement**

In `packages/i18n/src/locales/en.json`, inside `"settings"`, after `"runningCancel": "Cancel"`, add (with a comma after `"Cancel"`):

```json
    "harness": {
      "nextTask": "Changes apply from the next task.",
      "pending": "Pending",
      "more": "More options",
      "reset": "Back to the app's defaults",
      "failed": "That didn't save. Try again."
    }
```

Append to `packages/ui/src/styles.css`:

```css
/* Settings › the harness's tab (harness-settings spec §4). */
.hh-settings-group { display: grid; gap: 6px; }
.hh-settings-group h3 { margin: 4px 0 0; }
.hh-setting-pending { padding: 0 6px; border: 1px solid var(--hh-line-strong); border-radius: 999px; color: var(--hh-warn); font-size: 12px; }
.hh-setting-control { display: inline-flex; align-items: center; gap: 6px; }
.hh-setting-control input[type="number"] { width: 5em; }
```

Create `packages/ui/src/HarnessSettingsTab.tsx`:

```tsx
import { type KeyboardEvent, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Segmented } from "./chrome";
import type { HarnessClient, SettingFieldView, SettingsState, SettingsView } from "./client";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

interface Group {
  id: string | null;
  label?: string;
  fields: SettingFieldView[];
}

/** The fields with no section first, then each section in manifest order; empty groups are left out. */
function groups(view: SettingsView, fields: SettingFieldView[]): Group[] {
  const known = new Set(view.sections.map((s) => s.id));
  const loose: Group = { id: null, fields: fields.filter((f) => f.section === undefined || !known.has(f.section)) };
  const sectioned = view.sections.map((s): Group => ({ id: s.id, label: s.label, fields: fields.filter((f) => f.section === s.id) }));
  return [loose, ...sectioned].filter((g) => g.fields.length > 0);
}

/**
 * Settings › the harness's own tab (harness-settings spec §4): the core's controls, each change saved at once through
 * the data store. While a task is open, changes the agent reads wait for the next task (D4) and are marked "Pending".
 */
export function HarnessSettingsTab({ client, view }: { client: HarnessClient; view: SettingsView }) {
  const { t } = useTranslation();
  const moreId = useId();
  const [state, setState] = useState<SettingsState | null>(null);
  const [taskOpen, setTaskOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [more, setMore] = useState(false);

  useEffect(() => {
    let live = true;
    const off = client.settings.onChange((s) => {
      if (live) setState(s);
    });
    const offTasks = client.onTasks((v) => {
      if (live) setTaskOpen(v.current !== null);
    });
    client.settings.get().then(
      (s) => {
        if (live) setState((prev) => prev ?? s);
      },
      () => {},
    );
    client.getTasks().then(
      (v) => {
        if (live) setTaskOpen(v.current !== null);
      },
      () => {},
    );
    return () => {
      live = false;
      off();
      offTasks();
    };
  }, [client]);

  if (!state) return <div className="hh-tab" aria-busy="true" />;

  const settle = (key: string, r: Awaited<ReturnType<HarnessClient["settings"]["set"]>>) => {
    if (r.ok) {
      setState(r.state);
      setErrors(({ [key]: _gone, ...rest }) => rest);
    } else setErrors((e) => ({ ...e, [key]: r.message ?? t("settings.harness.failed") }));
  };
  const fail = (key: string) => setErrors((e) => ({ ...e, [key]: t("settings.harness.failed") }));
  const save = (name: string, value: unknown) => {
    if (same(state.values[name], value)) return;
    client.settings.set(name, value).then((r) => settle(name, r), () => fail(name));
  };
  const reset = () => client.settings.reset().then((r) => settle("", r), () => fail(""));

  const changed = view.fields.some((f) => !same(state.values[f.name], f.default));
  const row = (f: SettingFieldView) => (
    <SettingRow
      key={f.name}
      field={f}
      value={Object.hasOwn(state.values, f.name) ? state.values[f.name] : f.default}
      error={errors[f.name]}
      pending={state.pending.includes(f.name)}
      onSave={(v) => save(f.name, v)}
    />
  );
  const drawGroups = (fields: SettingFieldView[]) =>
    groups(view, fields).map((g) => (
      <section key={g.id ?? ""} className="hh-settings-group">
        {g.label && <h3>{g.label}</h3>}
        <div className="hh-rows">{g.fields.map(row)}</div>
      </section>
    ));
  const advanced = view.fields.filter((f) => f.advanced);

  return (
    <div className="hh-tab">
      {taskOpen && (
        <p className="hh-caption" role="status">
          {t("settings.harness.nextTask")}
        </p>
      )}
      {drawGroups(view.fields.filter((f) => !f.advanced))}
      {advanced.length > 0 && (
        <>
          <button type="button" className="hh-link" aria-expanded={more} aria-controls={moreId} onClick={() => setMore((o) => !o)}>
            {t("settings.harness.more")}
          </button>
          {more && (
            <div id={moreId} className="hh-tab">
              {drawGroups(advanced)}
            </div>
          )}
        </>
      )}
      {changed && (
        <div>
          <button type="button" onClick={() => void reset()}>
            {t("settings.harness.reset")}
          </button>
          {errors[""] && (
            <p className="hh-field-error" role="alert">
              {errors[""]}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function SettingRow({
  field,
  value,
  error,
  pending,
  onSave,
}: {
  field: SettingFieldView;
  value: unknown;
  error: string | undefined;
  pending: boolean;
  onSave: (value: unknown) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const helpId = `${id}-help`;
  const errId = `${id}-error`;
  const describedBy = [field.help ? helpId : null, error ? errId : null].filter(Boolean).join(" ") || undefined;
  const aria = { ...(describedBy ? { "aria-describedby": describedBy } : {}), ...(error ? { "aria-invalid": true as const } : {}) };
  let control;
  if (field.control === "segmented") {
    control = <Segmented label={field.label} value={String(value)} options={field.options ?? []} onChange={(v) => onSave(v)} />;
  } else if (field.control === "select") {
    control = (
      <select id={id} value={String(value)} onChange={(e) => onSave(e.target.value)} {...aria}>
        {(field.options ?? []).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  } else if (field.control === "toggle") {
    control = <input id={id} type="checkbox" role="switch" checked={value === true} onChange={(e) => onSave(e.target.checked)} {...aria} />;
  } else {
    control = <DraftInput id={id} field={field} value={value} aria={aria} onSave={onSave} />;
  }
  return (
    <div className="hh-row hh-row-wrap">
      {field.control === "segmented" ? (
        <span className="hh-row-label">{field.label}</span>
      ) : (
        <label className="hh-row-label" htmlFor={id}>
          {field.label}
        </label>
      )}
      {pending && <span className="hh-setting-pending">{t("settings.harness.pending")}</span>}
      <span className="hh-setting-control">
        {control}
        {field.unit && <span className="hh-caption">{field.unit}</span>}
      </span>
      {field.help && (
        <p className="hh-caption hh-row-note" id={helpId}>
          {field.help}
        </p>
      )}
      {error && (
        <p className="hh-field-error hh-row-note" id={errId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** A number or a text: the person types freely; it saves on blur or Enter, so "12" never saves "1" first. */
function DraftInput({
  id,
  field,
  value,
  aria,
  onSave,
}: {
  id: string;
  field: SettingFieldView;
  value: unknown;
  aria: Record<string, unknown>;
  onSave: (value: unknown) => void;
}) {
  const saved = value === undefined || value === null ? "" : String(value);
  const [draft, setDraft] = useState(saved);
  useEffect(() => setDraft(saved), [saved]);
  const number = field.control === "number";
  const commit = () => {
    if (draft === saved) return;
    if (number && draft.trim() === "") {
      setDraft(saved);
      return;
    }
    onSave(number ? Number(draft) : draft);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") commit();
  };
  const bounds = number
    ? { ...(field.min !== undefined ? { min: field.min } : {}), ...(field.max !== undefined ? { max: field.max } : {}) }
    : field.max !== undefined
      ? { maxLength: field.max }
      : {};
  return <input id={id} type={number ? "number" : "text"} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={onKey} {...bounds} {...aria} />;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/ui/test/harness-settings.test.tsx`
Expected: PASS.

Then: `corepack pnpm typecheck`, `corepack pnpm test` and `corepack pnpm app:build`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/ui/src/HarnessSettingsTab.tsx packages/ui/src/styles.css packages/i18n/src/locales/en.json packages/ui/test/harness-settings.test.tsx
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(ui): the harness's Settings tab

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 9: The Settings sheet gets the tab after General

**Files:**
- Modify: `packages/ui/src/SettingsSheet.tsx`
- Test: `packages/ui/test/settings.test.tsx`

- [ ] **Step 1: Write the failing test**

Append inside `describe("SettingsSheet", …)` in `packages/ui/test/settings.test.tsx`:

```tsx
  it("D0: no harness tab when the harness declares no settings", async () => {
    await renderIn("en", <Sheet client={new FakeClient(ready)} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["General", "Engine", "Usage"]);
  });

  it("adds the harness's tab right after General, with its own name", async () => {
    const client = new FakeClient(ready);
    client.state.settings = {
      tab: "How I learn",
      sections: [],
      fields: [{ name: "tone", control: "segmented", label: "Tone", default: "patient", options: [{ value: "patient", label: "Patient" }], agent: true }],
    };
    client.settingsState = { values: { tone: "patient" }, pending: [] };
    await renderIn("en", <Sheet client={client} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["General", "How I learn", "Engine", "Usage"]);
    fireEvent.click(screen.getByRole("tab", { name: "How I learn" }));
    const panel = screen.getByRole("tabpanel", { name: "How I learn" });
    expect(await within(panel).findByRole("group", { name: "Tone" })).toBeTruthy();
  });

  it("before the app is set up, the harness's tab leads to the setup flow", async () => {
    const client = new FakeClient({});
    client.state.settings = { tab: "How I learn", sections: [], fields: [] };
    await renderIn("en", <Sheet client={client} initialTab="harness" />);
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Tone" })).toBeNull();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/ui/test/settings.test.tsx`
Expected: FAIL (no "How I learn" tab; `"harness"` is not a `SettingsTab`).

- [ ] **Step 3: Implement**

In `packages/ui/src/SettingsSheet.tsx`:

1. Add the import:

```ts
import { HarnessSettingsTab } from "./HarnessSettingsTab";
```

2. Replace the `SettingsTab` type and `TABS`:

```ts
export type SettingsTab = "general" | "harness" | "engine" | "models" | "usage";
/** `harness` is the harness's own tab (manifest `settings`), right after General (harness-settings spec §4). */
const TABS: SettingsTab[] = ["general", "harness", "engine", "models", "usage"];
```

3. Replace the `tabs` filter line:

```ts
  // Models only shows when the main process sent its view (every packaged app does); the harness's tab only when it
  // declares settings (harness-settings D0).
  const tabs = TABS.filter((id) => (id !== "models" || state.models !== undefined) && (id !== "harness" || state.settings !== undefined));
```

4. In the tab button, replace `{t(\`settings.tabs.${id}\`)}` with:

```tsx
                {id === "harness" ? state.settings?.tab : t(`settings.tabs.${id}`)}
```

5. In the tab panel, after the `usage` line, add:

```tsx
          {tab === "harness" && configured && state.settings && <HarnessSettingsTab client={client} view={state.settings} />}
```

(The existing `tab !== "general" && !configured && <NotConfigured …/>` line already covers the harness's tab before setup.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/ui/test/settings.test.tsx packages/ui/test/HarnessApp.test.tsx`
Expected: PASS.

Then: `corepack pnpm typecheck`, `corepack pnpm test` and `corepack pnpm app:build`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/ui/src/SettingsSheet.tsx packages/ui/test/settings.test.tsx
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(ui): the harness's tab in the Settings sheet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

## Phase 5 — Authoring tools (spec §3 `check`, §5 "Measuring")

### Task 10: `check` reports settings

**Files:**
- Modify: `packages/cli/src/check.ts`
- Test: `packages/cli/test/check.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/cli/test/check.test.ts`:

```ts
describe("check: settings", () => {
  const AFTER = '  questions: { tier: "light" },';
  const tone = (extra = "") =>
    `tone: { schema: z.enum(["patient", "demanding"]), default: "patient", control: "segmented", label: "Tone", options: { patient: "Patient", demanding: "Demanding" }, agent: "Use a {{value:label}} tone."${extra} }`;
  const withSettings = (fields: string, sections = "") => (d: string) =>
    replaceIn(d, "harness.config.ts", AFTER, `${AFTER}\n  settings: { tab: "How I learn",${sections} fields: { ${fields} } },`);
  const settingsRules = (r: CheckResult) => r.findings.filter((f) => f.rule === "settings-tokens" || f.message.startsWith("settings.")).map((f) => `${f.severity}:${f.rule}:${f.message.split(":")[0]}`);

  it("a valid declaration gives no finding", async () => {
    const r = await checkHarness(await fixture(withSettings(tone())));
    expect(errors(r)).toEqual([]);
    expect(settingsRules(r)).toEqual([]);
  });

  it("schema: a default, an option, a section and a placeholder that don't fit", async () => {
    const r = await checkHarness(
      await fixture(withSettings(`${tone()}, hint: { schema: z.number().min(1), default: 0, section: "nope", control: "number", label: "Hint", agent: "After {{tries}} tries." }`, ' sections: [{ id: "help", label: "Help" }],')),
    );
    expect(r.harness).toBeNull();
    expect(settingsRules(r).sort()).toEqual([
      "error:schema:settings.fields.hint.agent",
      "error:schema:settings.fields.hint.default",
      "error:schema:settings.fields.hint.section",
    ]);
  });

  it("settings-tokens: warns when the sentences make a long section", async () => {
    const long = "Explain every step slowly and check that the person follows before going on, using {{value}} as the level of detail. ".repeat(2).trim();
    const fields = Array.from({ length: 8 }, (_, i) => `f${i}: { schema: z.number(), default: ${i}, control: "number", label: "F${i}", agent: ${JSON.stringify(long)} }`).join(", ");
    const r = await checkHarness(await fixture(withSettings(fields)));
    expect(errors(r)).toEqual([]);
    const found = r.findings.filter((f) => f.rule === "settings-tokens");
    expect(found.map((f) => f.severity)).toEqual(["warning"]);
    expect(found[0].message).toMatch(/^The settings' sentences take about \d+ tokens of AGENTS\.md \(more than 400\)/);
  });
});
```

(The existing "finds nothing at all in the untouched template" test is the D0 regression: it must stay green.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/cli/test/check.test.ts`
Expected: the first two new tests already PASS (the schema refuses through Task 1); `settings-tokens` FAILS (no such rule).

- [ ] **Step 3: Implement**

In `packages/cli/src/check.ts`:

1. Add to the `@humanharness/harness-sdk` import: `SETTINGS_TOKENS_WARN, settingsSentences, settingsValues`. Add a new import:

```ts
import { estimateTokens, settingsLines } from "@humanharness/workspace";
```

2. Add `| "settings-tokens"` to `RuleId`, after `"mock-input"`.

3. In `checkHarness`, after `findings.push(...(await inputFindings(harness)));`, add:

```ts
  findings.push(...settingsFindings(harness));
```

4. After `inputFindings`, add:

```ts
/**
 * Harness settings (harness-settings spec §5 "Measuring"): their section of AGENTS.md is in every session's stable
 * prefix. Measured at its longest, every sentence at the defaults (`onlyWhenChanged` ones included). The structural
 * rules (defaults, options, sections, placeholders) are manifest schema errors, reported as `schema`.
 */
function settingsFindings(h: LoadedHarness): Finding[] {
  if (!h.settings) return [];
  const sentences = settingsSentences(h.settings, settingsValues(h.settings, null), { all: true });
  const tokens = estimateTokens(settingsLines(sentences).join("\n"));
  if (tokens <= SETTINGS_TOKENS_WARN) return [];
  const message = `The settings' sentences take about ${tokens} tokens of AGENTS.md (more than ${SETTINGS_TOKENS_WARN}): keep each one short, or mark the ones that only matter when changed with onlyWhenChanged.`;
  return [warning("settings-tokens", message, MANIFEST)];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/cli/test/check.test.ts`
Expected: PASS (all old tests too: the template declares no settings).

Then: `corepack pnpm typecheck` and `corepack pnpm test`
Expected: both green.

- [ ] **Step 5: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/cli/src/check.ts packages/cli/test/check.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(cli): check measures the settings section

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 11: The `tutor` fixture and `humanharness run --set`

**Files:**
- Create: `packages/fake-agent/fixtures/settings-harness/harness.config.ts`, `…/agent/AGENTS.md`, `…/agent/tasks/practice.md`, `…/agent/tasks/review.md`, `…/ui/App.tsx`
- Modify: `packages/cli/src/run.ts`
- Test: `packages/cli/test/run.test.ts`

- [ ] **Step 1: Create the fixture**

`packages/fake-agent/fixtures/settings-harness/harness.config.ts`:

```ts
// Test fixture for harness settings: a tiny tutor whose person picks a tone, a hint threshold and more.
import { z } from "zod";
import { defineHarness } from "@humanharness/harness-sdk";

export default defineHarness({
  id: "tutor",
  name: "Tutor",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Human Harness Tutor" },
  instructions: "./agent/AGENTS.md",
  permissions: { edit: "none", exec: false, web: false },
  blocks: {},
  actions: {
    practice: { label: "Practice", prompt: "./agent/tasks/practice.md", cost: "light" },
    review: { label: "Review", prompt: "./agent/tasks/review.md", cost: "light" },
  },
  path: ["practice", "review"],
  settings: {
    tab: "How I learn",
    sections: [
      { id: "voice", label: "How the AI talks" },
      { id: "help", label: "Help" },
    ],
    fields: {
      nickname: { schema: z.string().max(40), default: "", control: "text", label: "What the app calls you", help: "Only the app's screens use it." },
      tone: {
        schema: z.enum(["patient", "neutral", "demanding"]),
        default: "patient",
        section: "voice",
        control: "segmented",
        label: "Tone",
        options: { patient: "Patient", neutral: "Neutral", demanding: "Demanding" },
        agent: "Use a {{value:label}} tone.",
      },
      examples: {
        schema: z.boolean(),
        default: true,
        section: "help",
        control: "toggle",
        label: "Show worked examples",
        agent: { text: "Do not show worked examples.", onlyWhenChanged: true },
      },
      hintAfter: {
        schema: z.number().int().min(1).max(5),
        default: 2,
        section: "help",
        control: "number",
        label: "Hint after",
        unit: "tries",
        agent: "Give a hint after {{value}} failed tries, not before.",
        advanced: true,
      },
    },
  },
  author: "Human Harness tests",
});
```

`packages/fake-agent/fixtures/settings-harness/agent/AGENTS.md`:

```markdown
# Tutor

You help the person practise one small idea at a time.
```

`packages/fake-agent/fixtures/settings-harness/agent/tasks/practice.md`:

```markdown
# Task: practice

Ask one short question, then offer the next step with `show_choices`. Answer in {{language}}.

{{notesIndex}}
```

`packages/fake-agent/fixtures/settings-harness/agent/tasks/review.md`:

```markdown
# Task: review

Go over what the notes say was practised. Answer in {{language}}.

{{notesIndex}}
```

`packages/fake-agent/fixtures/settings-harness/ui/App.tsx`:

```tsx
import { type HarnessClient, HarnessApp } from "@humanharness/ui";

// Only the core screens: the Settings tab comes from the manifest, with no UI code.
export default function App({ client }: { client: HarnessClient }) {
  return <HarnessApp client={client} />;
}
```

- [ ] **Step 2: Write the failing test**

In `packages/cli/test/run.test.ts`, add `parseSettings` to the `../src/run` import, and append:

```ts
describe("run --set (harness settings)", () => {
  const tutor = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/settings-harness");
  const tutorScript: ClaudeScript = {
    steps: [...claudeTextLines("Done."), result],
    turns: [
      { match: "save_note", steps: [ui("save_note", { title: "Halves", summary: ["x"], decisions: [], files: [], open: [] }), result] },
      { match: "# Task: practice", steps: [...claudeTextLines("One question."), result] },
    ],
  };

  it("stores the values before the task, and AGENTS.md carries their sentences", { timeout: 60_000 }, async () => {
    const folder = path.join(root, "tutor-set");
    const out = memoryStream();
    await runTask({
      harnessDir: tutor,
      action: "practice",
      engine: "claude",
      folder,
      settings: { tone: "demanding", hintAfter: "4", examples: "true" },
      input: lines("q\n"),
      output: out.stream,
      engineCommand: { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(root, tutorScript) } },
    });
    // `examples: true` is the default: not stored.
    expect(JSON.parse(fs.readFileSync(path.join(folder, ".harness", "data", "_app", "settings.json"), "utf8"))).toEqual({ tone: "demanding", hintAfter: 4 });
    const agents = fs.readFileSync(path.join(folder, "AGENTS.md"), "utf8");
    expect(agents).toContain("### How to work with this person\n\n- Use a Demanding tone.\n- Give a hint after 4 failed tries, not before.\n");
    expect(out.text()).toContain("Settings: tone=demanding, hintAfter=4, examples=true");
  });

  it("D0: without --set nothing is stored, and AGENTS.md has the defaults' sentences", { timeout: 60_000 }, async () => {
    const folder = path.join(root, "tutor-plain");
    await runTask({
      harnessDir: tutor,
      action: "practice",
      engine: "claude",
      folder,
      input: lines("q\n"),
      output: memoryStream().stream,
      engineCommand: { command: fakeClaudeCommand(), env: { HH_FAKE_SCRIPT: writeScript(root, tutorScript) } },
    });
    expect(fs.existsSync(path.join(folder, ".harness", "data"))).toBe(false);
    expect(fs.readFileSync(path.join(folder, "AGENTS.md"), "utf8")).toContain("- Use a Patient tone.");
  });

  it("parseSettings: JSON when the field takes it, else the text; refuses unknown, invalid and settings-less", async () => {
    const { loadHarness } = await import("@humanharness/harness-sdk");
    const h = await loadHarness(path.join(tutor, "harness.config.ts"));
    expect(parseSettings(h.settings, { hintAfter: "3", tone: "neutral", nickname: "42" })).toEqual({ hintAfter: 3, tone: "neutral", nickname: "42" });
    expect(() => parseSettings(h.settings, { nope: "1" })).toThrow(UsageError);
    expect(() => parseSettings(h.settings, { nope: "1" })).toThrow('Unknown setting "nope". Settings: nickname, tone, examples, hintAfter.');
    expect(() => parseSettings(h.settings, { hintAfter: "9" })).toThrow('"9" is not a valid value for the setting "hintAfter".');
    expect(() => parseSettings(h.settings, { toString: "x" })).toThrow(/Unknown setting "toString"/);
    expect(() => parseSettings(undefined, { tone: "x" })).toThrow("This harness declares no settings: drop --set.");
    expect(parseSettings(undefined, {})).toEqual({});
  });

  it("the command line takes --set name=value, repeated", async () => {
    const io = memoryIo(root);
    await expect(main(["run", "practice", "--harness", tutor, "--set", "tone"], io)).resolves.toBe(2);
    expect(io.err()).toContain("--set takes name=value");
  });
});
```

(`memoryIo`, `memoryStream`, `lines`, `main`, `fakeClaudeCommand`, `writeScript`, `claudeTextLines`, `result`, `ui` and `UsageError` are already in scope in this file. If `memoryIo`'s stderr accessor has another name in `packages/cli/test/helpers.ts`, use that name; if `memoryStream()` exposes the written text under another name than `text()`, use that.)

- [ ] **Step 3: Run the test to verify it fails**

Run: `corepack pnpm vitest run packages/cli/test/run.test.ts`
Expected: FAIL (`settings` is not a `RunOptions` key; `parseSettings` is not exported; `--set` is an unknown option).

- [ ] **Step 4: Implement**

In `packages/cli/src/run.ts`:

1. Imports:
   - add `type HarnessSettings, SETTINGS_COLLECTION, dataCollections, sameSetting, settingsSentences, settingsValues` to the `@humanharness/harness-sdk` import;
   - add `APP_SCOPE` to the `@humanharness/workspace` import.

2. In `RunOptions`, after `language?: Language;`, add:

```ts
  /** Harness settings as typed (`--set name=value`): stored as the person's before the task (harness-settings spec). */
  settings?: Record<string, string>;
```

3. After `noticeMessage`, add:

```ts
/**
 * `--set` values checked against the harness's settings. Each text is read as JSON when the field's schema takes it
 * (4, true), else as the text itself (patient).
 */
export function parseSettings(settings: HarnessSettings | undefined, typed: Record<string, string>): Record<string, unknown> {
  const entries = Object.entries(typed);
  if (entries.length === 0) return {};
  if (!settings) throw new UsageError("This harness declares no settings: drop --set.");
  return Object.fromEntries(
    entries.map(([name, text]) => {
      if (!Object.hasOwn(settings.fields, name)) throw new UsageError(`Unknown setting "${name}". Settings: ${Object.keys(settings.fields).join(", ")}.`);
      const schema = settings.fields[name].schema;
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
      for (const candidate of json === undefined ? [text] : [json, text]) {
        const parsed = schema.safeParse(candidate);
        if (parsed.success) return [name, parsed.data];
      }
      throw new UsageError(`"${text}" is not a valid value for the setting "${name}".`);
    }),
  );
}
```

4. In `runTask`, right after `const language: Language = …;`, add:

```ts
  // Checked before the engine or the folder: a typo stops the run with nothing made.
  const chosen = parseSettings(harness.settings, o.settings ?? {});
```

5. Replace `const dataStore = new DataStore(folder, harness.data);` with:

```ts
  const dataStore = new DataStore(folder, dataCollections(harness));
  const person = { who: "person" as const, scope: APP_SCOPE };
  if (harness.settings && Object.keys(chosen).length > 0) {
    const settings = harness.settings;
    const stored = (await dataStore.get(SETTINGS_COLLECTION, undefined, person).catch(() => null)) ?? {};
    const record: Record<string, unknown> = { ...stored };
    for (const [name, value] of Object.entries(chosen)) {
      if (sameSetting(value, settings.fields[name].default)) delete record[name];
      else record[name] = value;
    }
    if (Object.keys(record).length > 0) await dataStore.put(SETTINGS_COLLECTION, record, person);
    else if (Object.keys(stored).length > 0) await dataStore.delete(SETTINGS_COLLECTION, undefined, person);
    out.write(`Settings: ${Object.entries(o.settings ?? {}).map(([n, v]) => `${n}=${v}`).join(", ")}\n`);
  }
```

6. In the `createRuntime({ … })` call, after the `data:` line, add:

```ts
      // The harness's settings, as the app writes them (harness-settings spec §5). Absent without settings (D0).
      ...(harness.settings
        ? { instructionSettings: async () => settingsSentences(harness.settings!, settingsValues(harness.settings!, await dataStore.get(SETTINGS_COLLECTION, undefined, person).catch(() => null))) }
        : {}),
```

7. Update `RUN_USAGE` to:

```ts
const RUN_USAGE =
  "Usage: humanharness run <action> [--engine claude|codex] [--tier light|standard|deep] [--folder <dir>] [--language <tag>] [--set <name>=<value>]... [--harness <dir>] [--record [--force]]";
```

8. In `runCommand`'s `parseCommand` options, add `set: { type: "string", multiple: true },`. After the `language` checks, add:

```ts
  const settings: Record<string, string> = {};
  for (const pair of values.set ?? []) {
    const at = pair.indexOf("=");
    if (at <= 0) throw new UsageError(`--set takes name=value, got "${pair}".`);
    settings[pair.slice(0, at)] = pair.slice(at + 1);
  }
```

and in the `runTask({ … })` call, after the `language` spread, add:

```ts
    ...(Object.keys(settings).length > 0 ? { settings } : {}),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `corepack pnpm vitest run packages/cli/test/run.test.ts packages/cli/test/main.test.ts`
Expected: PASS (every earlier `run` test passes no `settings`: unchanged).

Then: `corepack pnpm typecheck` and `corepack pnpm test`
Expected: both green.

- [ ] **Step 6: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/fake-agent/fixtures/settings-harness packages/cli/src/run.ts packages/cli/test/run.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(cli): run --set and the tutor settings fixture

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

## Phase 6 — Docs and end to end

### Task 12: Docs and the guide

**Files:**
- Create: `docs/architecture/settings.md`
- Modify: `docs/architecture/manifest.md`, `docs/architecture/context.md`, `docs/architecture/data.md`, `docs/architecture/authoring.md`, `docs/architecture/mock-mode.md`, `packages/cli/guide/new-harness.md`
- Test: `packages/cli/test/guide.test.ts` (only if it asserts the guide's text; see Step 3)

- [ ] **Step 1: Write `docs/architecture/settings.md`**

```markdown
# Harness settings

A harness declares the knobs that change how the AI works for this person (a tone, a hint threshold, how much to explain) in its manifest's `settings`. The core draws them in a Settings tab of the harness's own, stores the person's choices in the data store, and tells the agent through plain sentences in `AGENTS.md`. Spec: `docs/superpowers/specs/2026-10-25-harness-settings-design.md`.

## The declaration

`settings: { tab, sections?, fields }` (`packages/harness-sdk/src/settings.ts`). Every text is one English string. Each field has:

- `schema` (zod) and `default`, which must match it;
- `control`: `segmented` or `select` (a `z.enum`), `toggle` (`z.boolean`), `number` (`z.number`, its bounds become the input's) or `text` (`z.string`, its max length too);
- `label`, and optionally `help`, `unit`, `section` (a declared section id) and `advanced` (under "More options");
- `options`: labels of the enum's values (a toggle may label `"true"` and `"false"`);
- `agent`: the sentence for the agent, with `{{value}}` and `{{value:label}}`. `{ text, onlyWhenChanged: true }` leaves it out while the value is the default. Absent or `false`: the field is UI-only.

`modes` is reserved for mode settings, which come with task modes (spec §6).

The structural rules are manifest schema errors: `defineHarness` and `loadHarness` refuse them, and `check` lists them as `schema`. They cover a default that fails its schema, an `options` key that isn't a value, an unknown section, a control whose type doesn't fit, and a placeholder other than the two.

## Where values live

- The reserved `settings` collection (`dataCollections` adds it to the store; it is never in `harness.data`). It is app-wide, one record, and `agent: "none"`: the agent reads sentences, never the JSON.
- The record holds only what the person changed. A change back to the default removes the key, and an empty record removes the file (`.harness/data/_app/settings.json`). `settingsValues` fills the defaults on read, field by field, so a harness update that changes a default reaches everyone who never touched it.
- The person's changes go through `hh:data`'s handler: the store's checks, a refusal while turns are blocked, and a `Data: settings` history commit tagged with the open task. Undoing a task therefore also undoes settings changed during it.
- A harness's own screens read every value with `client.settings.get()`. `client.data` on `settings` works too, but holds only the changed fields.

## How values reach the agent

- `managedSection` writes `### How to work with this person`, one `- <sentence>` per field, after the core rules and before the interface tools. No sentences, no heading.
- The runtime asks for the sentences when it starts (`RuntimeOptions.instructionSettings`). `HarnessRuntime.refreshInstructions()` rewrites `AGENTS.md` later, only when its text changed, through a temp file under `.harness/` and a rename.
- **Never mid-session (D4).** `SettingsController` (`packages/shell/src/main/settings.ts`) marks the settings stale on any write to the collection, from any writer, and after a restore. It then asks `TaskManager.whenNoTask` to rewrite: after the running operation, only when no task is open. `TaskManager` calls `betweenTasks` after a task ends and before a new task's first turn, which applies whatever is still stale.
- While a task is open, the tab says "Changes apply from the next task." and marks every agent field whose value differs from what the current `AGENTS.md` holds as "Pending".

## Measuring

The section is in every session's stable prefix. `check` warns (`settings-tokens`) when every sentence at the defaults, `onlyWhenChanged` ones included, is over `SETTINGS_TOKENS_WARN` (400) tokens.

## Trying values

`humanharness run <action> --set tone=demanding --set hintAfter=4` stores values in the run folder before the task, as the window would. Values are read as JSON when the field takes it, else as text.

## Known gaps

- Mode settings (spec §6) wait for task modes.
- There is no file watcher: a hand edit of `settings.json` reaches `AGENTS.md` at the next runtime start or the next settings change.
- A task that resumes after a folder move starts a new session, which reads the settings as they are then.
- `dataDiff` leaves settings out: they are not a task's output.
- Recordings for mock mode don't vary by settings.
```

- [ ] **Step 2: Update the other docs**

`docs/architecture/manifest.md`:
- In the field table, after the `data` row, add:

```markdown
| `settings` | Optional. Knobs the person sets in a Settings tab of the harness's own; their sentences go into `AGENTS.md` (`docs/architecture/settings.md`) |
```

- In "Checks", after the collection line, add:

```markdown
- Settings: every `default` matches its `schema`, each control has its zod type, `options` keys are values of the schema, `section`s are declared, and agent sentences use only `{{value}}` and `{{value:label}}` (the latter on segmented, select and toggle). `modes` is a reserved setting name.
```

`docs/architecture/context.md`: replace the bullet that starts with "The stable instructions:" with:

```markdown
- The stable instructions: `AGENTS.md` with its managed section. With harness settings, the section has their sentences under "How to work with this person". `AGENTS.md` only changes between tasks, and only when its text changed, so a running session keeps its cached prefix and the next one reads the new text (`docs/architecture/settings.md`).
```

`docs/architecture/data.md`: in "Data", add a bullet:

```markdown
- `settings` is a reserved collection name: a harness with `settings` gets it from the core (app-wide, one record, hidden from the agent). See `docs/architecture/settings.md`.
```

`docs/architecture/authoring.md`:
- In the `check` warnings list, after `input-choice (…)`, add:

```markdown
, and `settings-tokens` (the settings' sentences would take more than 400 tokens of `AGENTS.md`)
```

- In "run", after the paragraph about the prompt, add:

```markdown
`--set name=value` (repeatable) stores harness settings in the run folder before the task, as the window would: each value is read as JSON when the field takes it (`4`, `true`), else as text. An unknown name or a value its schema refuses stops the run before anything starts.
```

`docs/architecture/mock-mode.md`: in "Known gaps", add:

```markdown
- Harness settings work in mock mode (the tab saves, `AGENTS.md` follows), but a recording plays the same whatever the settings.
```

- [ ] **Step 3: Update the guide**

In `packages/cli/guide/new-harness.md`, Phase 4 — Context, after the `data` bullet, add:

```markdown
- which knobs the person sets for themselves (tone, how much to explain, after how many tries a hint comes, which checks to run). Declare them in `settings`: a zod `schema`, a `default`, a `control` (`segmented`, `select`, `toggle`, `number`, `text`), a `label`, and an `agent` sentence in English with `{{value}}` or `{{value:label}}` ("Use a {{value:label}} tone."). The core draws the tab and writes the sentences into the agent's instructions; changes apply from the next task. Leave `agent` out for a setting only the harness's screens use, and use `onlyWhenChanged: true` for sentences that only matter when the person changed the default. Try values with `humanharness run <action> --set name=value`;
```

Run: `corepack pnpm vitest run packages/cli/test/guide.test.ts`
Expected: PASS. If a test pins the guide's exact text or a phase's line count, update that expectation to include the new bullet.

- [ ] **Step 4: Verify**

Run: `corepack pnpm typecheck` and `corepack pnpm test`
Expected: both green.

- [ ] **Step 5: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add docs/architecture packages/cli/guide/new-harness.md
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "docs: harness settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

(Add `packages/cli/test/guide.test.ts` to the `git add` if Step 3 changed it.)

### Task 13: End to end: the tab, the deferral, and D0 on the demo

**Files:**
- Create: `packages/e2e/tests/settings.spec.ts`
- Modify: `packages/e2e/tests/flow.spec.ts`

- [ ] **Step 1: Write the e2e test**

Create `packages/e2e/tests/settings.spec.ts`:

```ts
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { type ClaudeScript, claudeTextLines } from "@humanharness/fake-agent";
import { closeAndClean, launch, makeSandbox, readJsonl, shellDir } from "./helpers";

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/settings-harness");
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
const tutorScript: ClaudeScript = {
  steps: [...claudeTextLines("Listo."), result],
  turns: [
    { match: "save_note", steps: [ui("save_note", { title: "Halves", summary: ["Two halves make a whole"], decisions: [], files: [], open: [] }), ...claudeTextLines("Guardé."), result] },
    { match: "# Task: practice", steps: [...claudeTextLines("Una pregunta corta."), ui("show_choices", { options: [{ label: "Next →", next: true }] }), result] },
    { match: "# Task: review", steps: [...claudeTextLines("Repasemos."), result] },
  ],
};

test("settings save at once; AGENTS.md takes them at the next task, never during one", async () => {
  // A full app build of the fixture before the app starts.
  test.setTimeout(300_000);
  const s = makeSandbox("settings");
  const outDir = path.join(shellDir, "out", "settings");
  // electron-vite directly: `humanharness dev --build` would first run `check`, which a test fixture has no HARNESS.md for.
  const env: NodeJS.ProcessEnv = { ...process.env, HH_HARNESS_DIR: fixture, HH_OUT_DIR: outDir };
  delete env.ELECTRON_RUN_AS_NODE;
  execFileSync(path.join(shellDir, "node_modules", ".bin", "electron-vite"), ["build"], { cwd: shellDir, env, stdio: "inherit" });

  const settingsFile = path.join(s.folder, ".harness", "data", "_app", "settings.json");
  const agents = () => fs.readFileSync(path.join(s.folder, "AGENTS.md"), "utf8");
  const { app, page } = await launch(s, { claude: tutorScript }, path.join(outDir, "main", "index.js"));
  try {
    // Before any task: the tab saves at once; nothing runs, so nothing is pending.
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("tab")).toHaveText(["General", "How I learn", "Engine", "Models", "Usage"]);
    await page.getByRole("tab", { name: "How I learn" }).click();
    const tab = page.getByRole("tabpanel", { name: "How I learn" });
    await tab.getByRole("group", { name: "Tone" }).getByRole("button", { name: "Demanding" }).click();
    await expect.poll(() => (fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, "utf8")) : null)).toEqual({ tone: "demanding" });
    await expect(tab.getByRole("status")).toHaveCount(0);
    await page.getByRole("button", { name: "Done" }).click();

    // The first task's runtime writes AGENTS.md with the current settings.
    await page.getByRole("button", { name: "Start Tutor" }).click();
    await page.getByRole("button", { name: /Practice/ }).first().click();
    await expect(page.getByRole("main").getByText("Una pregunta corta.")).toBeVisible();
    expect(agents()).toContain("### How to work with this person\n\n- Use a Demanding tone.\n- Give a hint after 2 failed tries, not before.\n");
    expect(agents()).not.toContain("worked examples");

    // During the task: the change is saved, marked Pending, and AGENTS.md doesn't move.
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("tab", { name: "How I learn" }).click();
    await expect(tab.getByRole("status")).toHaveText("Changes apply from the next task.");
    await tab.getByRole("button", { name: "More options" }).click();
    const hint = tab.getByLabel("Hint after");
    await hint.fill("4");
    await hint.press("Tab");
    await expect(tab.getByText("Pending")).toBeVisible();
    await expect.poll(() => JSON.parse(fs.readFileSync(settingsFile, "utf8"))).toEqual({ tone: "demanding", hintAfter: 4 });
    expect(agents()).toContain("after 2 failed tries");
    await page.getByRole("button", { name: "Done" }).click();

    // Next: the task closes, AGENTS.md is rewritten, then the next task starts.
    await page.getByRole("button", { name: "Next →" }).click();
    await expect(page.getByRole("main").getByText("Repasemos.")).toBeVisible();
    await expect.poll(agents).toContain("- Give a hint after 4 failed tries, not before.");
    const prompts = readJsonl<{ prompt: string }>(s.claudePrompts).map((p) => p.prompt);
    expect(prompts.some((p) => p.includes("# Task: review"))).toBe(true);

    // After the task: nothing pending.
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("tab", { name: "How I learn" }).click();
    await expect(tab.getByText("Pending")).toHaveCount(0);
  } finally {
    await closeAndClean(app, s);
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
```

Note: once the review task opens, the status line shows again (a task is open). The last check only asserts that the "Pending" mark is gone.

- [ ] **Step 2: Add the D0 checks to the demo's flow**

In `packages/e2e/tests/flow.spec.ts`, in the first test:

1. After `expect(agents).not.toContain("show_annotate");`, add:

```ts
    // Harness settings D0: the demo declares none, so AGENTS.md has no settings section and nothing is stored.
    expect(agents).not.toContain("### How to work with this person");
```

2. Right after `await page.getByRole("button", { name: "Settings" }).click();`, add:

```ts
    await expect(page.getByRole("tab")).toHaveText(["General", "Engine", "Models", "Usage"]);
```

(The existing `.harness/data` check already proves no settings file was made.)

- [ ] **Step 3: Run the e2e suite**

Run: `corepack pnpm e2e`
Expected: every test passes, the new `settings.spec.ts` included.

Then: `corepack pnpm typecheck` and `corepack pnpm test`
Expected: both green.

- [ ] **Step 4: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/e2e/tests/settings.spec.ts packages/e2e/tests/flow.spec.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "test(e2e): harness settings end to end; D0 on the demo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

## Self-review against the spec

| Spec | Where |
|---|---|
| §1 Why: a harness's knobs without its own screen or markers | Tasks 1–9 |
| D1 Declared in the manifest: schema, default, UI hints, agent sentence | Task 1 |
| D2 Stored in the data store, app-wide `single` collection `settings` | Tasks 2, 6, 7 (store collections), 11 (cli store) |
| D2 per profile (each profile's `.harness/`) | `baseOf(c)` in Task 7, unchanged by design |
| D2 schema checks, history and undo, `subscribe` for free | Task 6 (store checks), Task 7 (`personData` commit, `hh:dataChange` still sent) |
| D2 reserved, the agent never changes a setting | Task 2 (`agent: "none"`, a stricter deviation, see Decisions) |
| D3 Plain sentences in the managed section, never raw JSON | Tasks 2 (sentences), 3 (section), 4 (runtime) |
| D4 Applies from the next task; rewrite only when no task runs or right after it closes | Tasks 5 (hooks), 6 (stale/apply), 7 (wiring), 13 (e2e) |
| D5 / §6 Mode settings under the mode's key, with the mode's brief | Deferred with task modes; `modes` reserved (Task 1), documented (Task 12) |
| §3 `schema`, defaults built into the collection | Task 2 (optional fields + defaults on read: deviation) |
| §3 `control`: segmented, select, toggle, number, text | Tasks 1, 8 |
| §3 `help`, `advanced`, `unit`, `options`, `section` | Tasks 1, 2 (view), 8 (drawn) |
| §3 `agent` with `{{value}}`, `{{value:label}}`; no `agent` / `agent: false` is UI-only | Tasks 1, 2 |
| §3 `check`: defaults match, options are enum values, sections exist, placeholders | Task 1 (schema errors), Task 10 (reported by `check`) |
| §3 `check`: i18n parity | Dropped: English-only core (Decisions) |
| §4 A tab after General with the harness's label, only when declared | Task 9 |
| §4 Grouped by section in manifest order; "More options"; reset to defaults | Task 8 |
| §4 Saving at once, as the person; invalid values can't be entered; failures inline | Tasks 6, 8 |
| §4 Running-task line with `role="status"`; "pending" mark until the task closes | Tasks 6 (pending), 8 (line and mark), 13 |
| §5 New heading after the core rules, before the interface tools | Task 3 |
| §5 Fill with stored value or default; `onlyWhenChanged` | Task 2 |
| §5 Rewrite when settings change, deferred while a task is current (`instructionsStale`) | Tasks 5, 6, 7 |
| §5 Watch the `data-change` event for `settings` | Task 7 (`store.onChange` in `dataStoreFor`) |
| §5 Identical content skipped | Task 3 (`refreshInstructions`), Task 4 |
| §5 Measuring: `check` warns above 400 tokens | Task 10 |
| §7 Gap #16 (tone, length, thresholds), Dev autonomy/checks | The mechanism; the student and dev harnesses are out of core scope |
| §8 Slices 1 and 2 | Phases 1–6; slice 3 deferred |
| §9.1 No scope overrides; §9.2 no lock for minors; §9.3 `onlyWhenChanged` default false | Decisions |
| D0 regression tests | Tasks 1, 2, 3, 4, 5, 9, 10 (template), 11, 13 |
| Docs, guide, `check`, mock mode, fixture, e2e | Tasks 10, 11, 12, 13 |
