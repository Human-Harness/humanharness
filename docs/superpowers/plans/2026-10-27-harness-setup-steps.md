# Harness Setup Steps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A harness may declare `setup`: its own steps that run after the core's "Your folder" and "AI engine" steps and before "All set", in the same setup screen, stepper and footer (plan 3f). There are three kinds of step. A `form` draws fields from a schema: a few fields of a one-record data collection, or some of the harness settings. An `interview` runs one of the harness's actions as a task in a slim chat on the setup screen; the agent writes what it learns to a data collection through its data tools. A `component` is the harness's own React step, which calls `done()` or `skip()`. Every step's result is data (a collection or the settings). A step is required or skippable: a required step not done keeps Home on "Set up", with "One step left: <label>"; a skipped step is remembered and offered again from Settings, never forced. Each step's state is kept in `.harness/setup.json`. Settings lists the steps with their state, lets the person edit a form's fields in place and run any other step again. `check` warns about a component it can't find in `ui/`, an interview without a mock recording, and an interview whose collection has no context. A harness that declares no `setup` works exactly as today (D0 below).

**Architecture:**
- **Contract (harness-sdk).**
  - New `setup.ts`: `SETUP_STEP_ID`, `SETUP_COMPONENT`, `SETUP_STEPS_MAX`, `setupStepSchema` (a union on `kind`), `setupStepsSchema`, `hasSetup`, `interviewCollections` (action → collection) and `setupFormSpec` (the `InputSpec` a form step draws).
  - `index.ts`: the manifest's optional `setup`, and every structural rule of spec §3 `check` in the manifest's `superRefine`.
  - `input.ts`: `InputField.optionLabels` (a settings form shows "Patient", not `patient`).
- **State (shell main).**
  - `workspace/src/layout.ts`: `setupFile(base)` → `<base>/.harness/setup.json` (untracked, like `tasks.json`).
  - New `setup-store.ts`: the file's shape (`steps`, `finishedAt`, `known`), `cleanSetup`, `SetupStore` (atomic save, a broken file set aside), `stepStatuses`, `blockingSteps`, `setupState`.
  - New `setup-steps.ts`: the `SetupSteps` controller (`state`, `values`, `submit`, `complete`, `skip`, `finish`, `acknowledge`) and `setupStepViews` (what the window draws of each step).
- **The interview's task (shell main).** `task-prompts.ts`: `interviewSection(collection)`. `task-manager.ts`: `TaskDeps.interviews`; a task of an interview's action gets that section in its first message.
- **Wiring.** `index.ts`: `AppState.setup`, `ActionOption.setup`, the controller, the `hh:setupStep*` handlers and the `hh:setupSteps` channel. The preload and the client: `client.setupSteps`. `SetupStepProps` for a component step.
- **The window (ui).**
  - `InputForm`: `initial` values, `formId` (the footer submits it), option labels.
  - `Home`: a required step not done is the missing step; `StartView` hides an interview's action.
  - `SetupFlow`: the harness steps in the stepper and the flow, a form step (`SetupStepForm`), Skip, a component step, and "All set" telling the main process that setup finished.
  - `ChatView`'s `slim` view and `SetupInterviewStep`: an interview inside the setup screen.
  - Settings: the harness's tab shows a "Setup" list (`SetupStepsList`), with or without harness settings.
  - `HarnessApp`: `setupSteps` (the harness's components), the steps' state, opening the setup screen at a step.
- **Authoring tools.** `check`: `setup-component`, `setup-mock` and `setup-context` warnings. A new fixture, `packages/fake-agent/fixtures/setup-harness` (id `tutor`), drives the unit and end-to-end tests.

**Tech Stack:**
- Unchanged: TypeScript, pnpm via corepack, Electron 44 + electron-vite 5, React 19, i18next, zod 4, Vitest + happy-dom, and Playwright with the fake agents.
- No new dependency.

Spec: `docs/superpowers/specs/2026-10-25-harness-setup-steps-design.md` (source of truth; "§" and "D" numbers below refer to it). It extends plan 3f (`2026-10-14-03f-setup-flow.md`, spec `2026-10-14-setup-flow-design.md`) and builds on plans 1–5 (`2026-10-25-scopes-and-data.md`, `2026-10-25-input-blocks.md`, `2026-10-26-harness-settings.md`, `2026-10-26-task-modes.md`, `2026-10-26-task-phases.md`). Profiles (`2026-10-25-profiles-design.md`) are plan 7 and are **not** in the code yet: see "Profiles" below.

---

## Conventions

**Code**
- Same as plans 1–5:
  - English everywhere (code, comments, docs, UI strings, manifest texts);
  - packages export TS source;
  - extensionless imports;
  - tests in `packages/<name>/test/`;
  - one commit per task.
- React tests are `*.test.tsx` with `// @vitest-environment happy-dom` on the first line. Find elements by role and visible text.
- `@humanharness/ui` only imports **types** from other packages (`import type`). The UI's own small helpers live in `packages/ui/src/`.
- Colours only through the existing `--hh-*` tokens.
- Every lookup by a name that comes from a person, a harness, the agent or IPC (a step id, a collection, a field, a component name, a stored record key) goes through `Object.hasOwn` or a list's `find`/`includes` first.
- Errors over IPC travel as data where the window needs a reason (`SetupStepResult`), never as thrown errors (Electron flattens thrown errors).
- Names: the engine's install/sign-in already owns `SetupStep`, `SetupResult`, `RunningSetup`, `client.getSetup`, `hh:getSetup`, `hh:runSetup`. Everything new for harness steps says **setup step(s)** in full: `SetupStepView`, `SetupStepsState`, `SetupStepResult`, `SetupStepProps`, `client.setupSteps`, `hh:setupStep…`, `hh:setupSteps`.

**Commands and git**
- The worktree is `/Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data`. Create branch `feat/setup-steps` from `feat/task-phases` (plan 5) and implement there: `git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data switch -c feat/setup-steps feat/task-phases`.
- Run every `corepack pnpm …` command from the worktree root. A single test file: `corepack pnpm vitest run <path>`.
- Git: always `git -C <worktree> …`, one simple command per call. Never use bare `git stash`. Never push.
- Every commit message ends with these two lines, with a blank line before them:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7
  ```
- Every task ends with `corepack pnpm typecheck` and `corepack pnpm test` green before its commit.
  - Tasks that touch the shell's main process, the preload or the UI also run `corepack pnpm app:build`.
  - Task 13 runs `corepack pnpm e2e`.

**Compliance (core spec §5), restated for this plan**
- Never read `~/.claude`, `~/.codex`, `~/.gemini` or any account, token or credential file. A component step that "checks accounts" does it through the harness's own MCP server or client calls (spec §3); the core adds no such check.
- Setup steps touch only the person's folder: `.harness/setup.json`, the data collections the steps write, the settings collection, and the chat, notes and usage of an interview's task.
- A step's labels and form fields are harness data read in the main process. The only harness code that runs is a `component` step's React component, in the window, like a block component.

**D0 is a hard rule (like plans 1–5).** A harness whose manifest has no `setup` must keep, byte for byte:
- `AppState` (no `setup`; no action with `setup: true`);
- the folder (no `.harness/setup.json` is ever written);
- every prompt: no task's first message gets the interview section;
- Home (the same missing card, the same Start/Set up rules), `SetupFlow` (folder → engine → All set, no `client.setupSteps` call), `StartView` (every action is a topic), Settings (the harness's tab only with `settings`, drawn as today);
- `InputForm` for input blocks (no `initial`, no `formId`, options shown as their values when there are no labels);
- `check`'s findings for the untouched template and every existing fixture.

Tasks 1, 2, 3, 4, 5, 6, 7, 8, 10 and 11 hold the regression tests. Every other change keeps D0 by adding fields only when `setup` exists (conditional spreads), never by changing a default.

## Decisions this plan takes where the spec leaves room, or where the code moved

**Manifest (§3), English-only (plan 5a)**
- A step's `label` is one English string (≤ 80). The spec's `{ es, … }` pairs no longer exist in the core. A step may also have a `description` (≤ 300): one line under its heading on the setup screen.
- `setup`: 1 to 8 steps. Every step: `id` (`SETUP_STEP_ID`, lowercase, dashes, ≤ 40), `kind`, `label`, `description?`, `required` (**default `false`**, flagged: the spec's examples always say it).
- `form`: either `collection` + `fields`, or `settings`, never both.
  - `collection` must be a declared collection with `single: true` and `scoped: false`: a setup step runs app-wide and edits one record. Each of `fields` must be a field of its schema the core form can draw (`inputFields` gives it a kind).
  - `settings` lists names of the harness's own settings fields (not mode settings); the harness must declare `settings`.
- `interview`: `action` (a declared action) and `writes` (a declared collection with `single: true`, `scoped: false` and `agent: "write"`).
  - The action is not on the `path` (spec §3 `check`), its `tier` is not `deep` (spec: "its own tier, light or standard"), and in a harness with scopes it has `scope: "none"` (the spec's "`_app` scope"). One action serves at most one interview step.
- `component`: `component` (`SETUP_COMPONENT`, the name the harness registers it under) and an optional `writes` (a declared collection: documentation for the reader and for `check`; the core doesn't enforce what the component writes).
- Every rule above is in the manifest schema's `superRefine`, so `check` reports them as `schema` findings with their paths, as plans 4 and 5 did. `check`'s own setup findings are warnings (see "Authoring tools").

**What "done" means**
- `form`: the person pressed Next and the write went through the same checks as any write (§3): a collection form writes the merged record with `put` through the `hh:data` handler (as the person, app-wide, with its `Data: <collection>` commit); a settings form saves each field through the settings controller. Then the step is `done`.
- `interview`: the step is done when its task is closed **and** the `writes` collection holds a valid record (§3: "passes its schema"; the data store drops records that fail it, so "a valid record exists" is the test). The setup screen's Next closes the interview's open task first (`client.finishTask()`, the core closing turn), then asks the main process to complete the step. A task that closed without a valid record leaves the step not done, with "The app doesn't have what it needs yet" and "Continue the interview".
- `component`: the component's `done()` marks it done; `skip()` skips it (refused for a required step).
- A done step stays done when it is run again (§D6). Skipping a done step changes nothing.

**State (§4 "Where state is kept")**
- `.harness/setup.json`: `{ version: 1, steps: { <id>: { state: "done" | "skipped", at } }, finishedAt?, known? }`. It lives under `baseOf(config)`, the folder plan 7 will turn into the active profile's folder, so per-profile state needs no change here.
- `.harness/` is not tracked by the history: restoring the folder never undoes a step's state (the data a step wrote is tracked and restores as usual).
- `finishedAt` is set the first time the setup screen reaches "All set". `known` is the list of step ids the person has seen (set at "All set" and whenever Settings shows the list).

**Home (§4, §8 Q3)**
- A step **blocks** Home when it is required, not done, and either setup never finished (`finishedAt` absent) or the person has seen it (`known` has it). This is the spec's own answer to Q3: a required step added by a harness update shows as missing in Settings but doesn't block "Start" until the person has opened Settings.
- An app that ran tasks before this feature existed has no `setup.json`: the first read of such a folder (`tasks.json` exists) writes `{ finishedAt: now, known: [] }`, so an update that adds steps never locks an existing person out (same Q3 rule). Flagged (technical).
- Home's card: "One step left: <label of the first blocking step>", after any engine problem (that one is shown first, as today). "Set up <name>" opens the setup screen at that step. Skippable steps never block.
- While the steps' state is still loading, Start is disabled (as while the engine check runs).

**The setup screen (§4 "Stepper", "Cancelar / Atrás")**
- The stepper lists "Your folder", "AI engine", then the harness steps this run goes through. On the first run that is every step not done, in manifest order. From Home it starts at the blocking step and goes through the steps still missing. Skipped steps are not offered again here (only from Settings). Settings' "Do it again"/"Do it now" opens **only** that step, then goes back.
- The order is fixed: harness steps always come after "AI engine" (§4 "Engine first").
- Footer on a harness step: Back (to the previous harness step, or to "AI engine" when the flow came through it; Cancel when the step is the first one opened), Skip (only when not required), Next (form: submits the form; interview: closes its task if open, then completes). A component step has no Next: the component calls `done()`.
- Leaving a form discards unsaved fields. Leaving an interview halfway keeps its open task; coming back shows the same task (the slim chat finds it). After a restart the task is gone (the app interrupts open tasks at start, today's rule), so "Continue the interview" starts a new task; the collection's context brings what was saved.
- "All set" calls `client.setupSteps.finish()` once (only a harness with setup steps).

**The interview (§3 `interview`)**
- Its task is a normal task of its action (`hh:send` with `action`), in the main chat, with its usage, note and history. In a harness with scopes it runs in `_app` (`scope: "none"`).
- The core adds one section to its first message, after the brief (`## Setup interview`): ask one question at a time with `show_choices` or an input block; save what you learn in `<collection>` with the data tools as you go; when the record holds everything its schema asks for, tell the person they can press Next. The harness's brief says the rest.
- Running it again starts a new task; the agent sees the current record through the collection's own `context` (§5). `check` warns when that collection has `context: false`.
- The slim chat is `ChatView` with `slim={{ action }}`: no top bar, no side panel, no history, no topic list; the messages and the composer of that action's task, plus a "Start" ("Continue the interview" once the action ran before) button when no task of it is on screen. Its stepper and mode bar stay (an interview's action may have phases or modes).
- An interview's action is hidden from the topic list (`ActionOption.setup: true`); it is still in Settings › Usage like any action.
- **Spec §8 Q1 (no proposal; simplest default, flagged):** the step shows one caption when its action's cost is `medium` or `heavy` ("This conversation uses some of your AI plan." / "… a good part of your AI plan."). A `heavy` one also gets the chat's existing pre-flight question. Nothing for `light`.

**Settings (§5)**
- The steps are listed in the harness's tab. That tab now shows when the harness has `settings` **or** `setup`; with no `settings` its name is "Setup". The list comes first, then the settings fields as today.
- Each row: the label, the state ("Done", "Skipped", "Not done yet"); a form step gets "Edit" (its fields in place, with Save); any other step gets "Do it again" (done) or "Do it now" (not done), which opens the setup screen at that step only. A skipped step also gets a quiet line: "Skipped. You can do it now."
- Showing the list calls `client.setupSteps.acknowledge()` (the Q3 rule above).

**Authoring tools**
- **Spec §8 Q2 (no proposal; simplest default, flagged):** `check` warns (`setup-mock`, not an error) when `mock/` holds at least one recording and an interview's action has none (`mock/<action>.json`). Mock mode plays an interview like any action; no change there.
- `setup-component` (warning): no `ui/` source uses the component's name as an object key (`AccountsStep:`, `AccountsStep,`, `AccountsStep }`), the same guess `input-form` makes for block components.
- `setup-context` (warning): an interview writes a collection with `context: false`.
- `humanharness run <action>` already runs an interview's action like any other; no setup flow in the terminal (flagged).

**Profiles (D4, §4 "New profile", §5 "tab of the profile", §7 slice 3)** — not in the code yet (plan 7)
- Steps run once per folder; `setup.json` sits under `baseOf(config)`, which plan 7 makes the profile's folder. The core steps already run once per app.
- `SetupStepProps.profile` is `null` until profiles exist.
- "Creating a profile opens the setup screen at its harness steps, with the profile's name in the title" is left to plan 7 (it needs the profile switcher). Plan 7 calls `SetupFlow` with the profile's first step as `startAt`.

## What in the code conflicts with the spec (and how this plan handles it)

| Conflict | Where | Handling |
|---|---|---|
| §3 labels are `{ es, … }` pairs; the core is English-only since plan 5a | `harness-sdk/src/index.ts` (`text`) | Plain English strings (Task 1) |
| D4, §4 "New profile", §5 "profile tab", slice 3 "per profile on creation" | No profiles in the code (plan 7) | One state per `baseOf` folder; `profile: null`; the profile hook is plan 7's (see above) |
| §3 "`action` runs in the `_app` scope" | Only a harness with scopes has `_app` tasks (`scopeFor`) | With scopes, the action must say `scope: "none"`; without scopes it runs as every task does (its collection is app-wide anyway) (Task 1) |
| §3 "done when the record passes its schema" | The data store keeps only valid records; nothing says which record a keyed collection would mean | `writes` is a one-record app-wide collection; done = it has a record (Tasks 1, 3) |
| §4 "Coming back resumes the same session" | `tasks.interrupt()` at every app start ends an open task | True within one run; after a restart "Continue the interview" starts a new task (Task 9) |
| §5 "under the tab of the profile or harness" | The harness's tab exists only with `settings` | The tab shows with `settings` or `setup`; named "Setup" without settings (Task 10) |
| §3 form "fields generated from a schema … enum as radios or select, boolean as a switch" | The core form (`InputForm`, input blocks) draws enums as radios and booleans as a checkbox | Reuse `InputForm` as is (radios, checkbox); settings' option labels via `InputField.optionLabels` (Tasks 1, 6) |
| Names `SetupStep`, `SetupResult`, `RunningSetup`, `getSetup` | `ui/src/client.ts` (engine install/sign-in) | New names say "setup step(s)" in full (all tasks) |
| `SettingsSheet`'s `NotConfigured` calls `onSetup` as a click handler | `onClick={onSetup}` would pass the click event as a step id once `onSetup(step?)` takes one | `onClick={() => onSetup()}` (Task 10) |
| Errors thrown over IPC lose their class | `shell/src/main/index.ts` `handle()` | `SetupStepResult` as data (Tasks 3, 5) |

**Reuse, and why.**
- **Reused:**
  - `InputForm` and `inputFields` (plan 2) for every form step, and `inferSetting` (plan 3) for settings fields;
  - the `hh:data` person handler (`personData`) for a collection form's write: its checks, its turns-blocked refusal and its `Data: <collection>` commit;
  - `SettingsController.set` for a settings form, so its rules (only changes stored, AGENTS.md between tasks) hold;
  - `client.finishTask()` (plan 5) to close an interview's task with the core closing turn;
  - `ChatView` itself for the interview (a prop, not a second chat);
  - the `ui/` source guess of `check`'s `input-form` rule for `setup-component`.
- **Not reused:**
  - `TaskStore` for `setup.json` (different file and shape; same atomic save pattern);
  - `HarnessSettingsTab` inside the setup screen (it saves each change at once; a setup form saves on Next).

## File Structure

```
packages/harness-sdk/src/setup.ts          NEW. Step schema, ids, hasSetup, interviewCollections, setupFormSpec   (Task 1)
packages/harness-sdk/src/index.ts          manifest `setup`, superRefine rules, exports                            (Task 1)
packages/harness-sdk/src/input.ts          InputField.optionLabels                                                 (Task 1)
packages/fake-agent/fixtures/setup-harness/  NEW. The `tutor` fixture (ui/ in Task 13)                             (Task 1)
packages/workspace/src/layout.ts           setupFile                                                               (Task 2)
packages/shell/src/main/setup-store.ts     NEW. setup.json, statuses, blocking steps                               (Task 2)
packages/ui/src/client.ts                  SetupStepStatus, SetupStepsState, SetupStepResult, SetupStepView (2);
                                           AppState.setup, ActionOption.setup, SetupStepProps, client.setupSteps (5)
packages/shell/src/main/setup-steps.ts     NEW. SetupSteps controller (3); setupStepViews (5)                       (Tasks 3, 5)
packages/shell/src/main/task-prompts.ts    interviewSection                                                        (Task 4)
packages/shell/src/main/task-manager.ts    TaskDeps.interviews, the section at start                               (Task 4)
packages/shell/src/main/index.ts           interviews dep (4); appState, controller, IPC (5)                       (Tasks 4, 5)
packages/shell/src/preload/index.ts        client.setupSteps                                                       (Task 5)
packages/ui/test/fake-client.ts            client.setupSteps                                                       (Task 5)
packages/ui/src/input.ts                   draftOf, optionLabel                                                    (Task 6)
packages/ui/src/InputForm.tsx              initial, formId, option labels                                          (Task 6)
packages/ui/src/Home.tsx                   the blocking step                                                       (Task 7)
packages/ui/src/StartView.tsx              hides interview actions                                                 (Task 7)
packages/ui/src/HarnessApp.tsx             steps' state (7); setupAt, setupSteps prop (8)                          (Tasks 7, 8)
packages/ui/src/SetupStepForm.tsx          NEW. A form step's body                                                 (Task 8)
packages/ui/src/SetupFlow.tsx              harness steps, Skip, component, finish (8); interview (9)               (Tasks 8, 9)
packages/ui/src/ChatView.tsx               slim view                                                               (Task 9)
packages/ui/src/SetupInterviewStep.tsx     NEW. The interview's body                                               (Task 9)
packages/ui/src/SetupStepsList.tsx         NEW. Settings' list                                                     (Task 10)
packages/ui/src/SettingsSheet.tsx          the harness tab with setup                                              (Task 10)
packages/ui/src/styles.css                 the slim chat                                                           (Task 9)
packages/i18n/src/locales/en.json          setupSteps.*, settings.tabs.setup                                       (Tasks 7–10)
packages/cli/src/check.ts                  setup-component, setup-mock, setup-context                              (Task 11)
docs/architecture/setup.md                 NEW                                                                     (Task 12)
docs/architecture/{manifest,data,settings,mock-mode,authoring}.md                                                  (Task 12)
packages/cli/guide/new-harness.md          asks about setup steps                                                  (Task 12)
packages/e2e/tests/setup-steps.spec.ts     NEW                                                                     (Task 13)
packages/fake-agent/fixtures/setup-harness/ui/App.tsx  NEW. ReadyStep                                              (Task 13)
```

---

## Phase 1 — Contract (spec §7 slice 1, manifest part)

### Task 1: The manifest declares setup steps

**Files:**
- Create: `packages/harness-sdk/src/setup.ts`, `packages/fake-agent/fixtures/setup-harness/harness.config.ts`, `packages/fake-agent/fixtures/setup-harness/agent/AGENTS.md`, `packages/fake-agent/fixtures/setup-harness/agent/tasks/conocerte.md`, `packages/fake-agent/fixtures/setup-harness/agent/tasks/practice.md`
- Modify: `packages/harness-sdk/src/index.ts`, `packages/harness-sdk/src/input.ts`
- Test: `packages/harness-sdk/test/setup.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/harness-sdk/test/setup.test.ts`:

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type HarnessInput, SETUP_STEP_ID, defineHarness, hasSetup, interviewCollections, loadHarness, setupFormSpec, settingsSchema, z } from "../src";

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/setup-harness/harness.config.ts");

const profile = { scoped: false, single: true, schema: z.object({ name: z.string().min(1).max(40), goal: z.string().max(200), age: z.number().int().min(5).max(99).optional() }), agent: "write" as const };
const settings = {
  tab: "How I learn",
  fields: {
    tone: { schema: z.enum(["patient", "demanding"]), default: "patient", control: "segmented" as const, label: "Tone", options: { patient: "Patient", demanding: "Demanding" } },
    hintAfter: { schema: z.number().int().min(1).max(5), default: 2, control: "number" as const, label: "Hint after" },
  },
};
const base: HarnessInput = {
  id: "tutor",
  name: "Tutor",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Tutor" },
  instructions: "./AGENTS.md",
  permissions: { edit: "none", exec: false, web: false },
  blocks: {},
  actions: {
    conocerte: { label: "Get to know you", prompt: "tasks/conocerte.md", cost: "medium", tier: "light" },
    practice: { label: "Practice", prompt: "tasks/practice.md", cost: "light" },
  },
  path: ["practice"],
  data: { profile },
  settings,
  author: "t",
};
const steps = [
  { id: "conocerte", kind: "interview" as const, label: "Get to know you", action: "conocerte", writes: "profile", required: true },
  { id: "estilo", kind: "form" as const, label: "How the AI talks", settings: ["tone", "hintAfter"] },
  { id: "goal", kind: "form" as const, label: "Your goal", collection: "profile", fields: ["goal", "age"] },
  { id: "ready", kind: "component" as const, label: "Ready check", component: "ReadyStep" },
];

/** Every issue of a manifest, as `path: message`; [] when it parses. */
function issues(input: HarnessInput): string[] {
  try {
    defineHarness(input);
    return [];
  } catch (e) {
    return (e as { issues: { path: PropertyKey[]; message: string }[] }).issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`);
  }
}

describe("setup steps in the manifest (setup-steps spec §3)", () => {
  it("D0: a manifest without setup has no setup and no interview actions", () => {
    const h = defineHarness(base);
    expect(h).not.toHaveProperty("setup");
    expect(hasSetup(h)).toBe(false);
    expect(interviewCollections(h)).toEqual({});
  });

  it("takes the three kinds; required defaults to false; an interview's action maps to its collection", () => {
    const h = defineHarness({ ...base, setup: steps });
    expect(h.setup?.map((s) => [s.id, s.kind, s.required])).toEqual([
      ["conocerte", "interview", true],
      ["estilo", "form", false],
      ["goal", "form", false],
      ["ready", "component", false],
    ]);
    expect(hasSetup(h)).toBe(true);
    expect(interviewCollections(h)).toEqual({ conocerte: "profile" });
  });

  it("step ids: the pattern, once each, at most eight steps", () => {
    expect(SETUP_STEP_ID.test("get-to-know")).toBe(true);
    expect(SETUP_STEP_ID.test("Get")).toBe(false);
    expect(issues({ ...base, setup: [steps[3], { ...steps[3], label: "Again" }] })).toEqual(['setup.1.id: Step "ready" is declared twice']);
    const many = Array.from({ length: 9 }, (_, i) => ({ ...steps[3], id: `s${i}` }));
    expect(issues({ ...base, setup: many })[0]).toMatch(/^setup: /);
    expect(issues({ ...base, setup: [] })[0]).toMatch(/^setup: /);
  });

  it("form: a collection with fields, or settings, never both or neither", () => {
    const form = { id: "f", kind: "form" as const, label: "F" };
    expect(issues({ ...base, setup: [form] })).toEqual(["setup.0: A form takes its fields from a collection (collection and fields) or from the settings (settings), not both"]);
    expect(issues({ ...base, setup: [{ ...form, collection: "profile", fields: ["goal"], settings: ["tone"] }] })).toEqual([
      "setup.0: A form takes its fields from a collection (collection and fields) or from the settings (settings), not both",
    ]);
    expect(issues({ ...base, setup: [{ ...form, collection: "profile" }] })).toEqual(["setup.0: A form over a collection names the collection and its fields"]);
  });

  it("form over a collection: declared, one app-wide record, known and drawable fields", () => {
    const form = { id: "f", kind: "form" as const, label: "F" };
    const data = {
      profile,
      notes: { scoped: false, key: "id", schema: z.object({ id: z.string() }), agent: "write" as const },
      topic: { scoped: true, single: true, schema: z.object({ name: z.string() }), agent: "write" as const },
      deep: { scoped: false, single: true, schema: z.object({ where: z.object({ city: z.string() }) }), agent: "write" as const },
    };
    expect(issues({ ...base, data, setup: [{ ...form, collection: "gone", fields: ["x"] }] })).toEqual(['setup.0.collection: Collection "gone" is not declared in data']);
    for (const name of ["notes", "topic"]) {
      expect(issues({ ...base, data, setup: [{ ...form, collection: name, fields: ["id"] }] })[0]).toBe(
        `setup.0.collection: A setup step keeps one app-wide record: "${name}" needs single: true and scoped: false`,
      );
    }
    expect(issues({ ...base, data, setup: [{ ...form, collection: "profile", fields: ["goal", "nope"] }] })).toEqual(['setup.0.fields: "nope" is not a field of "profile"']);
    expect(issues({ ...base, data, setup: [{ ...form, collection: "deep", fields: ["where"] }] })).toEqual(['setup.0.fields: The setup form can\'t draw "where"']);
  });

  it("form over settings: the harness declares them, and each name is one of its fields", () => {
    const form = { id: "f", kind: "form" as const, label: "F", settings: ["tone", "volume"] };
    expect(issues({ ...base, setup: [form] })).toEqual(['setup.0.settings: "volume" is not a setting']);
    const { settings: _s, ...noSettings } = base;
    expect(issues({ ...noSettings, setup: [{ ...form, settings: ["tone"] }] })).toEqual(["setup.0.settings: Only a harness with settings can ask for them in a form"]);
  });

  it("interview: a known action off the path, light or standard, app-wide, once; it writes a one-record collection the agent may write", () => {
    const interview = steps[0];
    expect(issues({ ...base, setup: [{ ...interview, action: "gone" }] })).toEqual(['setup.0.action: Unknown action "gone"']);
    expect(issues({ ...base, path: ["conocerte", "practice"], setup: [interview] })).toEqual(['setup.0.action: "conocerte" runs as a setup step: it can\'t be in the path']);
    const deep = { ...base.actions!, conocerte: { ...base.actions!.conocerte, tier: "deep" as const } };
    expect(issues({ ...base, actions: deep, setup: [interview] })).toEqual(["setup.0.action: An interview runs at tier light or standard"]);
    expect(issues({ ...base, scopes: { label: "topic", plural: "topics" }, setup: [interview] })).toEqual(['setup.0.action: An interview runs app-wide: set scope: "none" on "conocerte"']);
    expect(issues({ ...base, setup: [interview, { ...interview, id: "again" }] })).toEqual(['setup.1.action: "conocerte" already runs the interview "conocerte"']);
    const readOnly = { profile: { ...profile, agent: "read" as const } };
    expect(issues({ ...base, data: readOnly, setup: [interview] })).toEqual(['setup.0.writes: The agent writes "profile" during the interview: give it agent: "write"']);
  });

  it("component: a registrable name, and a declared collection when it says what it writes", () => {
    const component = steps[3];
    expect(issues({ ...base, setup: [{ ...component, component: "ready step" }] })[0]).toMatch(/^setup\.0\.component: /);
    expect(issues({ ...base, setup: [{ ...component, writes: "accounts" }] })).toEqual(['setup.0.writes: Collection "accounts" is not declared in data']);
  });

  it("setupFormSpec: a collection's fields as the input form draws them; settings with their labels and option labels", () => {
    const h = defineHarness({ ...base, setup: steps });
    const [, estilo, goal] = h.setup!;
    if (estilo.kind !== "form" || goal.kind !== "form") throw new Error("expected forms");
    expect(setupFormSpec(goal, h)).toEqual({
      fields: [
        { name: "goal", kind: "text", label: "Goal", optional: false, max: 200 },
        { name: "age", kind: "number", label: "Age", optional: true, min: 5, max: 99 },
      ],
    });
    expect(setupFormSpec(estilo, { data: {}, settings: settingsSchema.parse(settings) })).toEqual({
      fields: [
        { name: "tone", kind: "choice", label: "Tone", optional: false, options: ["patient", "demanding"], optionLabels: { patient: "Patient", demanding: "Demanding" } },
        { name: "hintAfter", kind: "number", label: "Hint after", optional: false, min: 1, max: 5 },
      ],
    });
  });

  it("the setup-harness fixture loads", async () => {
    const h = await loadHarness(fixture);
    expect(h.setup?.map((s) => s.id)).toEqual(["conocerte", "estilo", "goal", "ready"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm vitest run packages/harness-sdk/test/setup.test.ts`
Expected: FAIL (no `SETUP_STEP_ID`, `hasSetup`, `interviewCollections`, `setupFormSpec` exports; no fixture).

- [ ] **Step 3: `InputField.optionLabels`**

In `packages/harness-sdk/src/input.ts`, in `InputField` after `optionsFrom`, add:

```ts
  /** A choice's labels by value (a setup form over settings, setup-steps spec §3); a value with none shows as itself. */
  optionLabels?: Record<string, string>;
```

- [ ] **Step 4: `setup.ts`**

Create `packages/harness-sdk/src/setup.ts`:

```ts
import { z } from "zod";
import type { Collection } from "./data";
import { type InputField, type InputSpec, inputFields } from "./input";
import { type HarnessSettings, inferSetting } from "./settings";

/** A setup step's id (setup-steps spec §3): it keys `.harness/setup.json`. */
export const SETUP_STEP_ID = /^[a-z][a-z0-9-]{0,39}$/;
/** A component step's name: the key the harness registers its component under (`setupSteps: { AccountsStep }`). */
export const SETUP_COMPONENT = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
/** The most steps a harness may add to the setup screen. */
export const SETUP_STEPS_MAX = 8;

const text = z.string().min(1);
const common = {
  id: z.string().regex(SETUP_STEP_ID),
  label: text.max(80),
  /** One line under the step's heading. */
  description: text.max(300).optional(),
  /** A required step not done keeps Home on "Set up" (D5); otherwise the person may skip it. */
  required: z.boolean().default(false),
};

/** One harness setup step (spec §3). The structural rules that need the whole manifest are in its superRefine. */
export const setupStepSchema = z.discriminatedUnion("kind", [
  z.object({
    ...common,
    kind: z.literal("form"),
    /** A one-record app-wide collection, and the fields of it the form asks for. */
    collection: z.string().min(1).optional(),
    fields: z.array(z.string().min(1)).min(1).optional(),
    /** Or: names of the harness's settings fields. */
    settings: z.array(z.string().min(1)).min(1).optional(),
  }),
  z.object({
    ...common,
    kind: z.literal("interview"),
    /** The action whose task runs the conversation. */
    action: z.string().min(1),
    /** The one-record collection the agent fills; the step is done once it holds a valid record. */
    writes: z.string().min(1),
  }),
  z.object({
    ...common,
    kind: z.literal("component"),
    component: z.string().regex(SETUP_COMPONENT),
    /** What the component writes, for the reader and `check`. */
    writes: z.string().min(1).optional(),
  }),
]);
export type HarnessSetupStep = z.output<typeof setupStepSchema>;
export type SetupFormStep = Extract<HarnessSetupStep, { kind: "form" }>;

export const setupStepsSchema = z.array(setupStepSchema).min(1).max(SETUP_STEPS_MAX);

/** The harness declares setup steps. False: everything stays as before (D0). */
export const hasSetup = (h: { setup?: readonly unknown[] }): boolean => (h.setup?.length ?? 0) > 0;

/** Each interview step's action and the collection it writes ({} without interviews). */
export function interviewCollections(h: { setup?: readonly HarnessSetupStep[] }): Record<string, string> {
  return Object.fromEntries((h.setup ?? []).flatMap((s) => (s.kind === "interview" ? [[s.action, s.writes]] : [])));
}

/**
 * The form a `form` step draws (spec §3): the collection's chosen fields as the input-block form infers them, or the
 * settings' fields with their labels and option labels. Unknown names are left out (the manifest refuses them).
 */
export function setupFormSpec(step: SetupFormStep, h: { data: Record<string, Collection>; settings?: HarnessSettings }): InputSpec {
  if (step.settings) {
    const fields = h.settings?.fields ?? {};
    return {
      fields: step.settings
        .filter((name) => Object.hasOwn(fields, name))
        .map((name): InputField => {
          const f = fields[name];
          return { ...inferSetting(f.schema), name, label: f.label, optional: false, ...(f.options ? { optionLabels: { ...f.options } } : {}) };
        }),
    };
  }
  const c = step.collection !== undefined && Object.hasOwn(h.data, step.collection) ? h.data[step.collection] : undefined;
  const shape = (c?.schema.shape ?? {}) as Record<string, z.ZodType>;
  const picked = Object.fromEntries((step.fields ?? []).filter((f) => Object.hasOwn(shape, f)).map((f) => [f, shape[f]]));
  return { fields: inputFields({ input: z.object(picked), schema: z.object({}) }) };
}
```

- [ ] **Step 5: The manifest field and its rules**

In `packages/harness-sdk/src/index.ts`:

1. Add the import `import { type HarnessSetupStep, setupFormSpec, setupStepsSchema } from "./setup";` and the re-export `export * from "./setup";` next to `export * from "./phases";`.
2. In `manifestSchema`, after `modes`, add:

```ts
  /** The harness's own steps on the setup screen, after the engine (setup-steps spec). Absent: none (D0). */
  setup: setupStepsSchema.optional(),
```

3. At the end of the `superRefine` callback (after the "A Settings tab needs something to draw" check), add:

```ts
  // Setup steps (setup-steps spec §3).
  const stepIds = new Set<string>();
  const interviewed = new Map<string, string>();
  (m.setup ?? []).forEach((s: HarnessSetupStep, i) => {
    const issue = (p: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path: ["setup", i, ...p], message });
    if (stepIds.has(s.id)) issue(["id"], `Step "${s.id}" is declared twice`);
    stepIds.add(s.id);
    /** A collection a step keeps its one app-wide record in; undefined (and an issue) when it can't. */
    const oneRecord = (name: string, field: string) => {
      if (!Object.hasOwn(m.data, name)) return void issue([field], `Collection "${name}" is not declared in data`);
      const c = m.data[name];
      if (!c.single || c.scoped) return void issue([field], `A setup step keeps one app-wide record: "${name}" needs single: true and scoped: false`);
      return c;
    };
    if (s.kind === "form") {
      const fromData = s.collection !== undefined || s.fields !== undefined;
      if (fromData === (s.settings !== undefined)) return issue([], "A form takes its fields from a collection (collection and fields) or from the settings (settings), not both");
      if (s.settings) {
        if (!m.settings) return issue(["settings"], "Only a harness with settings can ask for them in a form");
        for (const name of s.settings) if (!Object.hasOwn(m.settings.fields, name)) issue(["settings"], `"${name}" is not a setting`);
        return;
      }
      if (s.collection === undefined || s.fields === undefined) return issue([], "A form over a collection names the collection and its fields");
      const c = oneRecord(s.collection, "collection");
      if (!c) return;
      for (const f of s.fields) if (!Object.hasOwn(c.schema.shape, f)) issue(["fields"], `"${f}" is not a field of "${s.collection}"`);
      for (const f of setupFormSpec(s, m).fields) if (f.kind === null) issue(["fields"], `The setup form can't draw "${f.name}"`);
      return;
    }
    if (s.kind === "interview") {
      if (!Object.hasOwn(m.actions, s.action)) issue(["action"], `Unknown action "${s.action}"`);
      else {
        const a = m.actions[s.action];
        if ((m.path ?? []).includes(s.action)) issue(["action"], `"${s.action}" runs as a setup step: it can't be in the path`);
        if (a.tier === "deep") issue(["action"], "An interview runs at tier light or standard");
        if (m.scopes && a.scope !== "none") issue(["action"], `An interview runs app-wide: set scope: "none" on "${s.action}"`);
        const other = interviewed.get(s.action);
        if (other !== undefined) issue(["action"], `"${s.action}" already runs the interview "${other}"`);
        else interviewed.set(s.action, s.id);
      }
      const c = oneRecord(s.writes, "writes");
      if (c && c.agent !== "write") issue(["writes"], `The agent writes "${s.writes}" during the interview: give it agent: "write"`);
      return;
    }
    if (s.writes !== undefined && !Object.hasOwn(m.data, s.writes)) issue(["writes"], `Collection "${s.writes}" is not declared in data`);
  });
```

`c.schema.shape` is the zod object's shape (the collection schema is a `ZodObject`). The `void issue(...)` form returns `undefined` from `oneRecord` after adding the issue.

- [ ] **Step 6: The fixture**

Create `packages/fake-agent/fixtures/setup-harness/harness.config.ts`:

```ts
// Test fixture for setup steps: a tiny tutor that interviews the person, asks for a tone and a goal, and runs a check of its own.
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
    conocerte: { label: "Get to know you", prompt: "./agent/tasks/conocerte.md", cost: "medium", tier: "light" },
    practice: { label: "Practice", prompt: "./agent/tasks/practice.md", cost: "light" },
  },
  path: ["practice"],
  data: {
    profile: {
      scoped: false,
      single: true,
      schema: z.object({ name: z.string().min(1).max(40), goal: z.string().min(1).max(200) }),
      agent: "write",
      context: { fields: "all", tokens: 200 },
    },
  },
  settings: {
    tab: "How I learn",
    fields: {
      tone: {
        schema: z.enum(["patient", "demanding"]),
        default: "patient",
        control: "segmented",
        label: "Tone",
        options: { patient: "Patient", demanding: "Demanding" },
        agent: "Use a {{value:label}} tone.",
      },
    },
  },
  setup: [
    {
      id: "conocerte",
      kind: "interview",
      label: "Get to know you",
      description: "A short chat so the app knows who you are and what you want.",
      action: "conocerte",
      writes: "profile",
      required: true,
    },
    { id: "estilo", kind: "form", label: "How the AI talks", settings: ["tone"] },
    { id: "goal", kind: "form", label: "Your goal", collection: "profile", fields: ["goal"] },
    { id: "ready", kind: "component", label: "Ready check", component: "ReadyStep" },
  ],
  author: "Human Harness tests",
});
```

Create `packages/fake-agent/fixtures/setup-harness/agent/AGENTS.md`:

```md
# Tutor

You help the person practise one small idea at a time.
```

Create `packages/fake-agent/fixtures/setup-harness/agent/tasks/conocerte.md`:

```md
# Task: conocerte

Get to know the person: their name and what they want to learn. Answer in {{language}}.

{{notesIndex}}
```

Create `packages/fake-agent/fixtures/setup-harness/agent/tasks/practice.md`:

```md
# Task: practice

Ask one short question. Answer in {{language}}.

{{notesIndex}}
```

- [ ] **Step 7: Run the tests**

Run: `corepack pnpm vitest run packages/harness-sdk/test/setup.test.ts`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS (D0: every existing manifest test unchanged).

- [ ] **Step 8: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/harness-sdk packages/fake-agent/fixtures/setup-harness
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(sdk): the manifest declares setup steps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

## Phase 2 — State and the main process (spec §7 slices 1–2)

### Task 2: `.harness/setup.json`: statuses and the steps that block Home

**Files:**
- Create: `packages/shell/src/main/setup-store.ts`
- Modify: `packages/workspace/src/layout.ts`, `packages/ui/src/client.ts`
- Test: `packages/shell/test/setup-store.test.ts` (new), `packages/workspace/test/layout.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/workspace/test/layout.test.ts`, add (import `setupFile` with the others):

```ts
  it("setup.json sits under .harness/, next to tasks.json (setup-steps spec §4)", () => {
    expect(setupFile("/f")).toBe(path.join("/f", ".harness", "setup.json"));
  });
```

Create `packages/shell/test/setup-store.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type SetupFile, SetupStore, blockingSteps, cleanSetup, emptySetup, setupState, stepStatuses } from "../src/main/setup-store";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-setup-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const tmp = () => fs.mkdtempSync(path.join(root, "f-"));

const AT = "2026-10-27T10:00:00.000Z";
const steps = [
  { id: "conocerte", required: true },
  { id: "estilo", required: false },
  { id: "cuentas", required: true },
];
const ids = steps.map((s) => s.id);

describe("SetupStore", () => {
  it("reads null when there is no file; saves atomically and reads back", async () => {
    const folder = tmp();
    const store = new SetupStore(folder, ids);
    expect(await store.load()).toBeNull();
    const file: SetupFile = { version: 1, steps: { conocerte: { state: "done", at: AT } }, finishedAt: AT, known: ["conocerte"] };
    await store.save(file);
    expect(await store.load()).toEqual(file);
    expect(fs.readdirSync(path.join(folder, ".harness"))).toEqual(["setup.json"]);
  });

  it("sets a file that isn't JSON aside and reads null", async () => {
    const folder = tmp();
    fs.mkdirSync(path.join(folder, ".harness"));
    fs.writeFileSync(path.join(folder, ".harness", "setup.json"), "{");
    expect(await new SetupStore(folder, ids).load()).toBeNull();
    expect(fs.readdirSync(path.join(folder, ".harness")).some((f) => f.startsWith("setup.json.corrupt-"))).toBe(true);
  });

  it("keeps only the manifest's steps, known states and real dates", () => {
    const raw = {
      version: 1,
      steps: { conocerte: { state: "done", at: AT }, estilo: { state: "maybe", at: AT }, cuentas: { state: "skipped", at: "soon" }, gone: { state: "done", at: AT } },
      finishedAt: "never",
      known: ["conocerte", "gone", 3],
    };
    expect(cleanSetup(raw, ids)).toEqual({ version: 1, steps: { conocerte: { state: "done", at: AT } }, known: ["conocerte"] });
    expect(cleanSetup(null, ids)).toEqual(emptySetup());
    expect(cleanSetup({ steps: { constructor: { state: "done", at: AT } } }, ids)).toEqual(emptySetup());
  });
});

describe("statuses and blocking steps (spec §4, D5, §8 Q3)", () => {
  it("first run: every step is missing and every required one blocks, in manifest order", () => {
    expect(stepStatuses(emptySetup(), steps)).toEqual({ conocerte: "missing", estilo: "missing", cuentas: "missing" });
    expect(blockingSteps(emptySetup(), steps)).toEqual(["conocerte", "cuentas"]);
  });

  it("a done step never blocks; a skipped one is remembered; a skippable one never blocks", () => {
    const file: SetupFile = { version: 1, steps: { conocerte: { state: "done", at: AT }, estilo: { state: "skipped", at: AT } } };
    expect(stepStatuses(file, steps)).toEqual({ conocerte: "done", estilo: "skipped", cuentas: "missing" });
    expect(blockingSteps(file, steps)).toEqual(["cuentas"]);
  });

  it("after setup finished, a required step the person hasn't seen yet doesn't block; once seen, it does", () => {
    const finished: SetupFile = { version: 1, steps: { conocerte: { state: "done", at: AT } }, finishedAt: AT, known: ["conocerte", "estilo"] };
    expect(blockingSteps(finished, steps)).toEqual([]);
    expect(blockingSteps({ ...finished, known: ids }, steps)).toEqual(["cuentas"]);
  });

  it("a required step stored as skipped (it became required in an update) still blocks once seen", () => {
    const file: SetupFile = { version: 1, steps: { cuentas: { state: "skipped", at: AT } } };
    expect(blockingSteps(file, steps)).toEqual(["conocerte", "cuentas"]);
  });

  it("setupState is both", () => {
    expect(setupState(emptySetup(), steps)).toEqual({ steps: { conocerte: "missing", estilo: "missing", cuentas: "missing" }, blocking: ["conocerte", "cuentas"] });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `corepack pnpm vitest run packages/shell/test/setup-store.test.ts packages/workspace/test/layout.test.ts`
Expected: FAIL (no `setup-store` module; no `setupFile`).

- [ ] **Step 3: The path**

In `packages/workspace/src/layout.ts`, after `usageFile`, add:

```ts
/** The harness's setup steps' state (setup-steps spec §4). Under `.harness/`, so the history never tracks it. */
export const setupFile = (base: string): string => path.join(base, ".harness", "setup.json");
```

- [ ] **Step 4: The window's types**

In `packages/ui/src/client.ts`, after `SettingsResult`, add:

```ts
/** A harness setup step's state (setup-steps spec §4): done, skipped, or not done yet. */
export type SetupStepStatus = "done" | "skipped" | "missing";

/** The harness's setup steps now: each one's status, and the required ones that keep Home on "Set up" (manifest order). */
export interface SetupStepsState {
  steps: Record<string, SetupStepStatus>;
  blocking: string[];
}

/**
 * How a step's submit, completion or skip went: the new state, or why not. `unknown`: no such step (or the wrong call for
 * its kind); `not-ready`: the app isn't set up or is closing; `open`: the interview's task is still open; `incomplete`:
 * its collection holds no valid record; `required`: a required step can't be skipped; `invalid`: the form's fields were
 * refused (`errors`, by field; "" for the whole form).
 */
export type SetupStepResult =
  | { ok: true; state: SetupStepsState }
  | { ok: false; reason: "unknown" | "not-ready" | "open" | "incomplete" | "required" | "invalid"; errors?: InputIssue[] };
```

(`InputIssue` is already imported as a type in this file.)

- [ ] **Step 5: The store**

Create `packages/shell/src/main/setup-store.ts`:

```ts
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { SetupStepStatus, SetupStepsState } from "@humanharness/ui/client";
import { setupFile } from "@humanharness/workspace";

/** What a person did with a step. Absent: not done yet. */
export type StepMark = "done" | "skipped";

/** `.harness/setup.json` (setup-steps spec §4). */
export interface SetupFile {
  version: 1;
  steps: Record<string, { state: StepMark; at: string }>;
  /** The setup screen reached "All set" (or the folder ran tasks before these steps existed). */
  finishedAt?: string;
  /** The step ids the person has seen: after setup finished, only these can block Home (spec §8 Q3). */
  known?: string[];
}

export const emptySetup = (): SetupFile => ({ version: 1, steps: {} });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isDate = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));

/** Only what the app understands: the manifest's steps (`ids`), known states, real dates. */
export function cleanSetup(raw: unknown, ids: readonly string[]): SetupFile {
  const out = emptySetup();
  if (!isRecord(raw)) return out;
  const steps = isRecord(raw.steps) ? raw.steps : {};
  for (const id of ids) {
    if (!Object.hasOwn(steps, id) || !isRecord(steps[id])) continue;
    const s = steps[id] as Record<string, unknown>;
    if ((s.state === "done" || s.state === "skipped") && isDate(s.at)) out.steps[id] = { state: s.state, at: s.at };
  }
  if (isDate(raw.finishedAt)) out.finishedAt = raw.finishedAt;
  if (Array.isArray(raw.known)) {
    const known = raw.known;
    out.known = ids.filter((id) => known.includes(id));
  }
  return out;
}

/** Each step's status, by id. */
export function stepStatuses(file: SetupFile, steps: readonly { id: string }[]): Record<string, SetupStepStatus> {
  return Object.fromEntries(steps.map((s) => [s.id, Object.hasOwn(file.steps, s.id) ? file.steps[s.id].state : "missing"]));
}

/**
 * The required steps not done that keep Home on "Set up" (D5), in manifest order. After setup finished, a step counts only
 * once the person has seen it (spec §8 Q3: a step an update adds doesn't lock anyone out).
 */
export function blockingSteps(file: SetupFile, steps: readonly { id: string; required: boolean }[]): string[] {
  const seen = (id: string) => file.finishedAt === undefined || (file.known ?? []).includes(id);
  const done = (id: string) => Object.hasOwn(file.steps, id) && file.steps[id].state === "done";
  return steps.filter((s) => s.required && !done(s.id) && seen(s.id)).map((s) => s.id);
}

export function setupState(file: SetupFile, steps: readonly { id: string; required: boolean }[]): SetupStepsState {
  return { steps: stepStatuses(file, steps), blocking: blockingSteps(file, steps) };
}

/** One folder's `setup.json`. */
export class SetupStore {
  private readonly file: string;

  constructor(base: string, private readonly ids: readonly string[]) {
    this.file = setupFile(base);
  }

  /** Null when there is no file. One that isn't JSON is set aside as `setup.json.corrupt-<time>` and reads as none. */
  async load(): Promise<SetupFile | null> {
    let text: string;
    try {
      text = await fs.readFile(this.file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
    try {
      return cleanSetup(JSON.parse(text), this.ids);
    } catch {
      await fs.rename(this.file, `${this.file}.corrupt-${Date.now()}`);
      return null;
    }
  }

  /** Atomic: temp file + rename. */
  async save(file: SetupFile): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, `${JSON.stringify(file, null, 2)}\n`);
      await fs.rename(tmp, this.file);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
  }
}
```

- [ ] **Step 6: Run the tests**

Run: `corepack pnpm vitest run packages/shell/test/setup-store.test.ts packages/workspace/test/layout.test.ts`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/workspace/src/layout.ts packages/workspace/test/layout.test.ts packages/shell/src/main/setup-store.ts packages/shell/test/setup-store.test.ts packages/ui/src/client.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(shell): setup.json keeps each setup step's state

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 3: The setup steps controller: forms, interviews, components, skip, finish

**Files:**
- Create: `packages/shell/src/main/setup-steps.ts`
- Test: `packages/shell/test/setup-steps.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/shell/test/setup-steps.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type HarnessSetupStep, defineHarness, z } from "@humanharness/harness-sdk";
import type { SettingsResult, SetupStepsState } from "@humanharness/ui/client";
import { APP_SCOPE, DataStore, runDataRequest } from "@humanharness/workspace";
import { SetupSteps } from "../src/main/setup-steps";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-steps-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const NOW = "2026-10-27T10:00:00.000Z";
const harness = defineHarness({
  id: "tutor",
  name: "Tutor",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Tutor" },
  instructions: "./AGENTS.md",
  permissions: { edit: "none", exec: false, web: false },
  blocks: {},
  actions: { conocerte: { label: "Get to know you", prompt: "t.md", cost: "light" } },
  data: { profile: { scoped: false, single: true, schema: z.object({ name: z.string().min(1), goal: z.string().min(3) }), agent: "write" } },
  settings: { tab: "How I learn", fields: { tone: { schema: z.enum(["patient", "demanding"]), default: "patient", control: "segmented", label: "Tone" } } },
  setup: [
    { id: "conocerte", kind: "interview", label: "Get to know you", action: "conocerte", writes: "profile", required: true },
    { id: "estilo", kind: "form", label: "How the AI talks", settings: ["tone"] },
    { id: "goal", kind: "form", label: "Your goal", collection: "profile", fields: ["goal"] },
    { id: "ready", kind: "component", label: "Ready check", component: "ReadyStep", required: true },
  ],
  author: "t",
});

function setup(opts: { steps?: HarnessSetupStep[]; base?: string | null; ranBefore?: boolean; settingFails?: boolean } = {}) {
  const folder = opts.base === null ? null : (opts.base ?? fs.mkdtempSync(path.join(root, "f-")));
  const store = folder ? new DataStore(folder, harness.data) : null;
  const pushed: SetupStepsState[] = [];
  const settingSets: { field: string; value: unknown }[] = [];
  const values: Record<string, unknown> = { tone: "patient" };
  let open: string | undefined;
  let quitting = false;
  const ctl = new SetupSteps({
    steps: opts.steps ?? harness.setup!,
    data: harness.data,
    settings: harness.settings,
    base: async () => folder,
    store: async () => store,
    write: (request) => runDataRequest(store!, request, { who: "person", scope: APP_SCOPE }),
    setSetting: async (field, value): Promise<SettingsResult> => {
      if (opts.settingFails) return { ok: false, message: "Not now" };
      settingSets.push({ field, value });
      values[field] = value;
      return { ok: true, state: { values, pending: [] } };
    },
    settingValues: async () => values,
    openAction: async () => open,
    ranBefore: async () => opts.ranBefore ?? false,
    quitting: () => quitting,
    changed: (s) => void pushed.push(s),
    now: () => new Date(NOW),
  });
  const file = () => (folder ? JSON.parse(fs.readFileSync(path.join(folder, ".harness", "setup.json"), "utf8")) : null);
  return { ctl, store, folder, pushed, settingSets, file, setOpen: (a?: string) => (open = a), quit: () => (quitting = true) };
}

const person = { who: "person" as const, scope: APP_SCOPE };

describe("SetupSteps: state", () => {
  it("a fresh folder: every step missing, the required ones blocking; nothing is written by a read", async () => {
    const t = setup();
    expect(await t.ctl.state()).toEqual({ steps: { conocerte: "missing", estilo: "missing", goal: "missing", ready: "missing" }, blocking: ["conocerte", "ready"] });
    expect(fs.existsSync(path.join(t.folder!, ".harness", "setup.json"))).toBe(false);
  });

  it("before the app is set up: all missing, and every change is refused", async () => {
    const t = setup({ base: null });
    expect((await t.ctl.state()).steps.conocerte).toBe("missing");
    expect(await t.ctl.complete("ready")).toEqual({ ok: false, reason: "not-ready" });
  });

  it("a folder that ran tasks before these steps existed counts as set up, with no step seen yet (spec §8 Q3)", async () => {
    const t = setup({ ranBefore: true });
    expect((await t.ctl.state()).blocking).toEqual([]);
    expect(t.file()).toEqual({ version: 1, steps: {}, finishedAt: NOW, known: [] });
  });
});

describe("SetupSteps: a form", () => {
  it("over a collection: shows the stored fields, merges the answer into the record through the person's write, and is done", async () => {
    const t = setup();
    expect(await t.ctl.values("goal")).toEqual({});
    await t.store!.put("profile", { name: "Sofi", goal: "Pass" }, person);
    expect(await t.ctl.values("goal")).toEqual({ goal: "Pass" });
    const r = await t.ctl.submit("goal", { goal: "Pass maths", name: "Hacked" });
    expect(r).toEqual({ ok: true, state: expect.objectContaining({ steps: expect.objectContaining({ goal: "done" }) }) });
    expect(await t.store!.get("profile", undefined, person)).toEqual({ name: "Sofi", goal: "Pass maths" });
    expect(t.file().steps.goal).toEqual({ state: "done", at: NOW });
    expect(t.pushed.at(-1)?.steps.goal).toBe("done");
  });

  it("over a collection: a field the schema refuses comes back by field; a record the store refuses as a whole", async () => {
    const t = setup();
    expect(await t.ctl.submit("goal", { goal: "no" })).toEqual({ ok: false, reason: "invalid", errors: [{ path: "goal", message: expect.any(String) }] });
    // No name yet: the merged record fails the collection's schema.
    const whole = await t.ctl.submit("goal", { goal: "Pass maths" });
    expect(whole).toEqual({ ok: false, reason: "invalid", errors: [{ path: "", message: expect.any(String) }] });
    expect(fs.existsSync(path.join(t.folder!, ".harness", "setup.json"))).toBe(false);
    expect(await t.ctl.submit("goal", "goal")).toEqual({ ok: false, reason: "invalid", errors: [{ path: "", message: "Expected the form's fields" }] });
  });

  it("over settings: shows their values, saves each through the settings controller, and is done", async () => {
    const t = setup();
    expect(await t.ctl.values("estilo")).toEqual({ tone: "patient" });
    expect((await t.ctl.submit("estilo", { tone: "demanding" })).ok).toBe(true);
    expect(t.settingSets).toEqual([{ field: "tone", value: "demanding" }]);
    const failing = setup({ settingFails: true });
    expect(await failing.ctl.submit("estilo", { tone: "demanding" })).toEqual({ ok: false, reason: "invalid", errors: [{ path: "tone", message: "Not now" }] });
  });

  it("complete is not how a form ends", async () => {
    expect(await setup().ctl.complete("goal")).toEqual({ ok: false, reason: "unknown" });
  });
});

describe("SetupSteps: an interview (spec §3: the task closed and the record passes its schema)", () => {
  it("is refused while its task is open, and with no record; done once both hold", async () => {
    const t = setup();
    t.setOpen("conocerte");
    expect(await t.ctl.complete("conocerte")).toEqual({ ok: false, reason: "open" });
    t.setOpen(undefined);
    expect(await t.ctl.complete("conocerte")).toEqual({ ok: false, reason: "incomplete" });
    await t.store!.put("profile", { name: "Sofi", goal: "Pass maths" }, person);
    const r = await t.ctl.complete("conocerte");
    expect(r.ok && r.state.blocking).toEqual(["ready"]);
  });

  it("another task being open doesn't matter", async () => {
    const t = setup();
    await t.store!.put("profile", { name: "Sofi", goal: "Pass maths" }, person);
    t.setOpen("practice");
    expect((await t.ctl.complete("conocerte")).ok).toBe(true);
  });
});

describe("SetupSteps: components, skip, unknown ids", () => {
  it("a component's done marks it done", async () => {
    const t = setup();
    expect((await t.ctl.complete("ready")).ok).toBe(true);
    expect(t.file().steps.ready.state).toBe("done");
  });

  it("skip: refused for a required step; remembered for a skippable one; a done step stays done", async () => {
    const t = setup();
    expect(await t.ctl.skip("conocerte")).toEqual({ ok: false, reason: "required" });
    expect((await t.ctl.skip("estilo")).ok).toBe(true);
    expect(t.file().steps.estilo.state).toBe("skipped");
    await t.ctl.submit("estilo", { tone: "demanding" });
    expect((await t.ctl.skip("estilo")).ok).toBe(true);
    expect(t.file().steps.estilo.state).toBe("done");
  });

  it("refuses ids it doesn't know, of any type, and everything while quitting", async () => {
    const t = setup();
    for (const id of ["gone", "constructor", 3, null]) {
      expect(await t.ctl.complete(id)).toEqual({ ok: false, reason: "unknown" });
      expect(await t.ctl.skip(id)).toEqual({ ok: false, reason: "unknown" });
      expect(await t.ctl.submit(id, {})).toEqual({ ok: false, reason: "unknown" });
      expect(await t.ctl.values(id)).toEqual({});
    }
    t.quit();
    expect(await t.ctl.complete("ready")).toEqual({ ok: false, reason: "not-ready" });
  });
});

describe("SetupSteps: finish and acknowledge (spec §8 Q3)", () => {
  it("All set records the time and the steps seen; a step an update adds doesn't block until Settings shows it", async () => {
    const t = setup();
    await t.store!.put("profile", { name: "Sofi", goal: "Pass maths" }, person);
    await t.ctl.complete("conocerte");
    await t.ctl.complete("ready");
    await t.ctl.finish();
    expect(t.file()).toMatchObject({ finishedAt: NOW, known: ["conocerte", "estilo", "goal", "ready"] });
    // The harness updates: a new required step.
    const extra: HarnessSetupStep = { id: "cuentas", kind: "component", label: "Accounts", component: "AccountsStep", required: true };
    const later = setup({ base: t.folder, steps: [...harness.setup!, extra] });
    expect(await later.ctl.state()).toMatchObject({ steps: { cuentas: "missing" }, blocking: [] });
    expect((await later.ctl.acknowledge()).blocking).toEqual(["cuentas"]);
    expect(later.file().known).toEqual(["conocerte", "estilo", "goal", "ready", "cuentas"]);
  });

  it("finish keeps the first time; acknowledge with nothing new writes nothing", async () => {
    const t = setup();
    await t.ctl.finish();
    const first = fs.statSync(path.join(t.folder!, ".harness", "setup.json")).mtimeMs;
    await t.ctl.acknowledge();
    expect(fs.statSync(path.join(t.folder!, ".harness", "setup.json")).mtimeMs).toBe(first);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm vitest run packages/shell/test/setup-steps.test.ts`
Expected: FAIL (no `setup-steps` module).

- [ ] **Step 3: The controller**

Create `packages/shell/src/main/setup-steps.ts`:

```ts
import type { Collection, HarnessSettings, HarnessSetupStep, z } from "@humanharness/harness-sdk";
import type { InputIssue, SettingsResult, SetupStepResult, SetupStepsState } from "@humanharness/ui/client";
import { APP_SCOPE, type DataContext, DataError, type DataRequest, type DataStore } from "@humanharness/workspace";
import { DataUnavailable } from "./data-requests";
import { type SetupFile, SetupStore, type StepMark, emptySetup, setupState } from "./setup-store";

/** The person, app-wide: setup steps belong to no scope (setup-steps spec §3). */
const PERSON: DataContext = { who: "person", scope: APP_SCOPE };

export interface SetupStepsDeps {
  /** The manifest's `setup`. */
  steps: readonly HarnessSetupStep[];
  /** The manifest's collections. */
  data: Record<string, Collection>;
  settings?: HarnessSettings;
  /** The folder `.harness/` is under (`baseOf`, the profile's folder from plan 7); null before the app is set up. */
  base(): Promise<string | null>;
  /** That folder's data store. */
  store(): Promise<DataStore | null>;
  /** Writes as the person, app-wide: `hh:data`'s handler, with its checks, its refusals and its `Data:` commit. */
  write(request: DataRequest): Promise<unknown>;
  /** SettingsController.set: one field, with its rules. Absent without settings. */
  setSetting?(field: string, value: unknown): Promise<SettingsResult>;
  /** SettingsController.values. */
  settingValues?(): Promise<Record<string, unknown>>;
  /** The open task's action, if a task is open. */
  openAction(): Promise<string | undefined>;
  /** The folder ran tasks before (`tasks.json` exists). */
  ranBefore(base: string): Promise<boolean>;
  quitting(): boolean;
  /** Tells the window. */
  changed(state: SetupStepsState): void;
  now?(): Date;
  log?(message: string, err?: unknown): void;
}

const invalid = (errors: InputIssue[]): SetupStepResult => ({ ok: false, reason: "invalid", errors });
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The harness's setup steps in the main process (setup-steps spec §3–§5). State lives in `.harness/setup.json`; what a
 * step produces lives in data or settings (D3). Every change runs one at a time and tells the window.
 */
export class SetupSteps {
  private writes: Promise<unknown> = Promise.resolve();
  private readonly ids: string[];

  constructor(private readonly d: SetupStepsDeps) {
    this.ids = d.steps.map((s) => s.id);
  }

  async state(): Promise<SetupStepsState> {
    const base = await this.d.base().catch(() => null);
    return setupState(base ? await this.read(base) : emptySetup(), this.d.steps);
  }

  /** A form step's current values: the record's fields it asks for, or the settings' values. {} for anything else. */
  async values(id: unknown): Promise<Record<string, unknown>> {
    const step = this.find(id);
    if (step?.kind !== "form") return {};
    if (step.settings) {
      const all = (await this.d.settingValues?.().catch(() => null)) ?? {};
      return Object.fromEntries(step.settings.filter((n) => Object.hasOwn(all, n)).map((n) => [n, all[n]]));
    }
    const store = await this.d.store().catch(() => null);
    const record = store && step.collection ? await store.get(step.collection, undefined, PERSON).catch(() => null) : null;
    return record ? Object.fromEntries((step.fields ?? []).filter((f) => Object.hasOwn(record, f)).map((f) => [f, record[f]])) : {};
  }

  /** A form's Next (spec §3 `form`): the same checks as any write, then the step is done. */
  submit(id: unknown, value: unknown): Promise<SetupStepResult> {
    return this.serial(async () => {
      const step = this.find(id);
      if (step?.kind !== "form") return { ok: false, reason: "unknown" };
      const base = await this.ready();
      if (!base) return { ok: false, reason: "not-ready" };
      if (!isRecord(value)) return invalid([{ path: "", message: "Expected the form's fields" }]);
      const errors = step.settings ? await this.saveSettings(step.settings, value) : await this.saveRecord(step, value);
      if (errors.length > 0) return invalid(errors);
      return this.mark(base, step.id, "done");
    });
  }

  /** An interview's or a component's end. An interview needs its task closed and a valid record (spec §3). */
  complete(id: unknown): Promise<SetupStepResult> {
    return this.serial(async () => {
      const step = this.find(id);
      if (!step || step.kind === "form") return { ok: false, reason: "unknown" };
      const base = await this.ready();
      if (!base) return { ok: false, reason: "not-ready" };
      if (step.kind === "interview") {
        if ((await this.d.openAction().catch(() => undefined)) === step.action) return { ok: false, reason: "open" };
        if (!(await this.hasRecord(step.writes))) return { ok: false, reason: "incomplete" };
      }
      return this.mark(base, step.id, "done");
    });
  }

  /** Remembered, offered again from Settings (D5). A done step stays done. */
  skip(id: unknown): Promise<SetupStepResult> {
    return this.serial(async () => {
      const step = this.find(id);
      if (!step) return { ok: false, reason: "unknown" };
      if (step.required) return { ok: false, reason: "required" };
      const base = await this.ready();
      if (!base) return { ok: false, reason: "not-ready" };
      const file = await this.read(base);
      if (Object.hasOwn(file.steps, step.id) && file.steps[step.id].state === "done") return { ok: true, state: setupState(file, this.d.steps) };
      return this.mark(base, step.id, "skipped");
    });
  }

  /** The setup screen reached "All set": the first time is kept, and every step now counts as seen. */
  finish(): Promise<SetupStepsState> {
    return this.serial(() => this.see(true));
  }

  /** Settings showed the list: steps added by an update count from now on (spec §8 Q3). */
  acknowledge(): Promise<SetupStepsState> {
    return this.serial(() => this.see(false));
  }

  private async see(finishing: boolean): Promise<SetupStepsState> {
    const base = await this.ready();
    if (!base) return this.state();
    const file = await this.read(base);
    const known = file.known ?? [];
    if ((!finishing || file.finishedAt) && this.ids.every((id) => known.includes(id))) return setupState(file, this.d.steps);
    const next: SetupFile = { ...file, ...(file.finishedAt || !finishing ? {} : { finishedAt: this.nowIso() }), known: [...this.ids] };
    await this.save(base, next);
    return this.push(next);
  }

  private find(id: unknown): HarnessSetupStep | undefined {
    return typeof id === "string" ? this.d.steps.find((s) => s.id === id) : undefined;
  }

  private async ready(): Promise<string | null> {
    if (this.d.quitting()) return null;
    return this.d.base().catch(() => null);
  }

  /** The folder's file; a folder with no file that ran tasks before counts as set up before these steps existed. */
  private async read(base: string): Promise<SetupFile> {
    const stored = await new SetupStore(base, this.ids).load().catch((err: unknown) => {
      this.log("Could not read setup.json", err);
      return null;
    });
    if (stored) return stored;
    if (!(await this.d.ranBefore(base).catch(() => false))) return emptySetup();
    const file: SetupFile = { ...emptySetup(), finishedAt: this.nowIso(), known: [] };
    await this.save(base, file).catch((err: unknown) => this.log("Could not write setup.json", err));
    return file;
  }

  private async mark(base: string, id: string, state: StepMark): Promise<SetupStepResult> {
    const file = await this.read(base);
    const next: SetupFile = { ...file, steps: { ...file.steps, [id]: { state, at: this.nowIso() } } };
    await this.save(base, next);
    return { ok: true, state: this.push(next) };
  }

  private save(base: string, file: SetupFile): Promise<void> {
    return new SetupStore(base, this.ids).save(file);
  }

  private push(file: SetupFile): SetupStepsState {
    const state = setupState(file, this.d.steps);
    try {
      this.d.changed(state);
    } catch (err) {
      this.log("Could not send the setup steps to the window", err);
    }
    return state;
  }

  private async hasRecord(collection: string): Promise<boolean> {
    const store = await this.d.store().catch(() => null);
    if (!store) return false;
    return store.readAll(collection, APP_SCOPE).then(
      (r) => r.records.length > 0,
      () => false,
    );
  }

  /** Each settings field through the settings controller; the first refusal stops the rest. */
  private async saveSettings(names: string[], value: Record<string, unknown>): Promise<InputIssue[]> {
    if (!this.d.setSetting) return [{ path: "", message: "This harness has no settings" }];
    for (const name of names) {
      if (!Object.hasOwn(value, name)) continue;
      const r = await this.d.setSetting(name, value[name]);
      if (!r.ok) return [{ path: name, message: r.message ?? "That didn't save" }];
    }
    return [];
  }

  /** The step's fields, each checked against its schema, merged into the record and written as the person with `put`. */
  private async saveRecord(step: Extract<HarnessSetupStep, { kind: "form" }>, value: Record<string, unknown>): Promise<InputIssue[]> {
    const collection = step.collection!;
    const shape = this.d.data[collection].schema.shape as Record<string, z.ZodType>;
    const picked: Record<string, unknown> = {};
    const errors: InputIssue[] = [];
    for (const f of step.fields ?? []) {
      if (!Object.hasOwn(value, f) || !Object.hasOwn(shape, f)) continue;
      const parsed = shape[f].safeParse(value[f]);
      if (parsed.success) picked[f] = parsed.data;
      else errors.push({ path: f, message: parsed.error.issues.map((i) => i.message).join("; ") });
    }
    if (errors.length > 0) return errors;
    const store = await this.d.store().catch(() => null);
    const before = (store ? await store.get(collection, undefined, PERSON).catch(() => null) : null) ?? {};
    try {
      await this.d.write({ op: "put", collection, record: { ...before, ...picked } });
      return [];
    } catch (err) {
      if (err instanceof DataError || err instanceof DataUnavailable) return [{ path: "", message: err.message }];
      this.log("Could not save the setup form", err);
      return [{ path: "", message: "Something went wrong with the data" }];
    }
  }

  private nowIso(): string {
    return (this.d.now?.() ?? new Date()).toISOString();
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

`step.collection!` and `this.d.data[collection]` are safe: the manifest refuses a form whose collection isn't declared (Task 1).

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run packages/shell/test/setup-steps.test.ts`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/shell/src/main/setup-steps.ts packages/shell/test/setup-steps.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(shell): the setup steps controller

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 4: An interview's first message carries the core's section

**Files:**
- Modify: `packages/shell/src/main/task-prompts.ts`, `packages/shell/src/main/task-manager.ts`, `packages/shell/src/main/index.ts`
- Test: `packages/shell/test/task-manager-setup.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/shell/test/task-manager-setup.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Event } from "@humanharness/runtime";
import { TaskManager } from "../src/main/task-manager";
import { interviewSection } from "../src/main/task-prompts";
import { type TasksFile, emptyTasks } from "../src/main/task-store";
import type { TurnOptions } from "../src/main/turn-controller";

const ok: Event = { type: "done", ok: true };

/** A task manager over memory: `conocerte` is an interview step's action when `interviews` says so. */
function setup(interviews?: Record<string, string>) {
  let state: TasksFile = emptyTasks();
  const turns: { message: string; options: TurnOptions }[] = [];
  let n = 0;
  const manager = new TaskManager({
    store: {
      load: async () => structuredClone(state),
      save: async (s) => {
        state = structuredClone(s);
      },
    },
    turns: {
      isBusy: () => false,
      cancel: () => {},
      send: async (message, options) => {
        turns.push({ message, options });
        options.onEvent?.(ok);
      },
    },
    actions: { conocerte: { label: "Get to know you" }, practice: { label: "Practice" } },
    path: ["practice"],
    readPrompt: async (action) => `# Task: ${action}\n\n{{notesIndex}}`,
    language: async () => "en",
    engine: async () => "claude",
    notes: async () => [],
    writeNote: async () => {},
    endSession: async () => {},
    changed: () => {},
    ...(interviews ? { interviews } : {}),
    now: () => new Date("2026-10-27T10:00:00.000Z"),
    newId: () => `t${++n}`,
  });
  return { manager, turns };
}

describe("an interview step's task (setup-steps spec §3 `interview`)", () => {
  it("the section says: one question at a time, save to the collection as you go, then Next", () => {
    expect(interviewSection("profile")).toBe(
      [
        "## Setup interview",
        "This task is a setup step: get to know the person before they use the app. Ask one question at a time, with `show_choices` or an input block when one fits.",
        "Save what you learn in the `profile` collection with the data tools as you go (data_put the first time, then data_patch).",
        "When the record holds everything its schema asks for, tell the person they can press Next.",
      ].join("\n"),
    );
  });

  it("its first message is the brief, then the section", async () => {
    const t = setup({ conocerte: "profile" });
    await t.manager.start("conocerte");
    expect(t.turns[0].message).toBe(`# Task: conocerte\n\n${interviewSection("profile")}`);
  });

  it("D0: any other action, and every action of a harness without interviews, starts as before", async () => {
    const t = setup({ conocerte: "profile" });
    await t.manager.start("practice");
    expect(t.turns[0].message).toBe("# Task: practice");
    const plain = setup();
    await plain.manager.start("conocerte");
    expect(plain.turns[0].message).toBe("# Task: conocerte");
  });
});
```

The `TaskDeps` field names above follow `packages/shell/test/task-manager.test.ts`; if a required dep was added since, copy it from that file's `setup()` helper.

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm vitest run packages/shell/test/task-manager-setup.test.ts`
Expected: FAIL (no `interviewSection` export).

- [ ] **Step 3: The section**

In `packages/shell/src/main/task-prompts.ts`, at the end, add:

```ts
/** The core's part of an interview step's first message, after the brief (setup-steps spec §3 `interview`). */
export function interviewSection(collection: string): string {
  return [
    "## Setup interview",
    "This task is a setup step: get to know the person before they use the app. Ask one question at a time, with `show_choices` or an input block when one fits.",
    `Save what you learn in the \`${collection}\` collection with the data tools as you go (data_put the first time, then data_patch).`,
    "When the record holds everything its schema asks for, tell the person they can press Next.",
  ].join("\n");
}
```

- [ ] **Step 4: The task manager**

In `packages/shell/src/main/task-manager.ts`:

1. Import `interviewSection` with the other `./task-prompts` imports.
2. In `TaskDeps`, after `minuteMs`, add:

```ts
  /** Each interview step's action and the collection it writes (setup-steps spec §3). Absent or empty: none (D0). */
  interviews?: Record<string, string>;
```

3. Add this private method next to `phasesOf`:

```ts
  /** The core's section for a task of an interview step's action, or none (setup-steps D0). */
  private interviewOf(action: string): string[] {
    const interviews = this.d.interviews;
    return interviews && Object.hasOwn(interviews, action) ? [interviewSection(interviews[action])] : [];
  }
```

4. In `startNow`, in the message builder passed to `this.begin(...)`, change

```ts
        return [fillPrompt(template, { language, notesIndex }), ...(section ? [section] : []), ...parts, ...box].join("\n\n");
```

to

```ts
        return [fillPrompt(template, { language, notesIndex }), ...this.interviewOf(action), ...(section ? [section] : []), ...parts, ...box].join("\n\n");
```

A resumed session's first message (`resumeMessageFor`) is unchanged: the section is in the session already.

- [ ] **Step 5: The app passes the interviews**

In `packages/shell/src/main/index.ts`, add `interviewCollections` to the `@humanharness/harness-sdk` import, and in the `new TaskManager({ … })` object, after `minuteMs`, add:

```ts
  // A getter, because the harness is loaded after this object is built. Undefined without interview steps (setup-steps D0).
  get interviews() {
    const map = interviewCollections(harness);
    return Object.keys(map).length > 0 ? map : undefined;
  },
```

- [ ] **Step 6: Run the tests**

Run: `corepack pnpm vitest run packages/shell/test/task-manager-setup.test.ts`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm app:build`
Expected: PASS (D0: every task-manager test unchanged).

- [ ] **Step 7: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/shell/src/main/task-prompts.ts packages/shell/src/main/task-manager.ts packages/shell/src/main/index.ts packages/shell/test/task-manager-setup.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(shell): an interview step's task starts with the core's section

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 5: Wiring: the app state, IPC, the preload and the client

**Files:**
- Modify: `packages/shell/src/main/setup-steps.ts`, `packages/shell/src/main/index.ts`, `packages/shell/src/preload/index.ts`, `packages/ui/src/client.ts`, `packages/ui/test/fake-client.ts`
- Test: `packages/shell/test/setup-steps.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/shell/test/setup-steps.test.ts`, import `setupStepViews` with `SetupSteps` and add:

```ts
describe("setupStepViews", () => {
  it("what the window draws: a form's fields, an interview's action and cost, a component's name; never a brief", () => {
    const views = setupStepViews(harness);
    expect(views.map((v) => [v.id, v.kind, v.label, v.required])).toEqual([
      ["conocerte", "interview", "Get to know you", true],
      ["estilo", "form", "How the AI talks", false],
      ["goal", "form", "Your goal", false],
      ["ready", "component", "Ready check", true],
    ]);
    expect(views[0]).toEqual({ id: "conocerte", kind: "interview", label: "Get to know you", required: true, action: "conocerte", cost: "light" });
    const [, estilo] = harness.setup!;
    expect(views[1].form).toEqual(setupFormSpec(estilo as SetupFormStep, harness));
    expect(views[1].form?.fields.map((f) => [f.name, f.kind])).toEqual([["tone", "choice"]]);
    // `goal` is z.string().min(3) with no max: a long text field.
    expect(views[2].form?.fields.map((f) => [f.name, f.kind, f.min])).toEqual([["goal", "longText", 3]]);
    expect(views[3]).toEqual({ id: "ready", kind: "component", label: "Ready check", required: true, component: "ReadyStep" });
    expect(setupStepViews({ actions: {}, data: {} })).toEqual([]);
  });
});
```

`harness` is the file's own manifest (Task 3). Add `setupFormSpec` and `type SetupFormStep` to its `@humanharness/harness-sdk` import.

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm vitest run packages/shell/test/setup-steps.test.ts`
Expected: FAIL (no `setupStepViews` export).

- [ ] **Step 3: The client's types and calls**

In `packages/ui/src/client.ts`:

1. In `ActionOption`, after `timeBox`, add:

```ts
  /** An interview step's action (setup-steps spec §3): no topic card; the setup screen and Settings start it. Absent otherwise (D0). */
  setup?: true;
```

2. In `AppState`, after `modes`, add:

```ts
  /** The harness's setup steps, in order (setup-steps spec). Absent: none (D0). */
  setup?: SetupStepView[];
```

3. After `SetupStepResult` (Task 2), add:

```ts
/** A harness setup step as the window draws it (setup-steps spec §3): never an action's brief. */
export interface SetupStepView {
  id: string;
  kind: "form" | "interview" | "component";
  label: string;
  /** One line under the step's heading. */
  description?: string;
  required: boolean;
  /** form: the fields the core form draws. */
  form?: InputSpec;
  /** interview: the action its task runs, and that action's cost hint. */
  action?: string;
  cost?: ActionCost;
  /** component: the name the harness registers its component under. */
  component?: string;
}

/** What a harness's own setup step component gets (setup-steps spec §3 `component`). */
export interface SetupStepProps {
  client: HarnessClient;
  /** The profile the step runs for: null until profiles exist (profiles spec, plan 7). */
  profile: null;
  /** The step is done: the app marks it and moves on. */
  done(): void;
  /** Skip it; refused (the screen says so) for a required step. */
  skip(): void;
}
```

4. In `HarnessClient`, after `settings`, add:

```ts
  /** The harness's setup steps (setup-steps spec). A harness with none answers no steps and refuses every change. */
  setupSteps: {
    get(): Promise<SetupStepsState>;
    /** A form step's current values: the record's fields it asks for, or the settings' values. */
    values(id: string): Promise<Record<string, unknown>>;
    /** A form step's Next: saved through the same checks as any write. Refusals come back as data. */
    submit(id: string, value: Record<string, unknown>): Promise<SetupStepResult>;
    /** An interview's end (its task closed, its record valid) or a component's `done()`. */
    complete(id: string): Promise<SetupStepResult>;
    skip(id: string): Promise<SetupStepResult>;
    /** The setup screen reached "All set". */
    finish(): Promise<SetupStepsState>;
    /** Settings showed the list: steps a harness update added count from now on. */
    acknowledge(): Promise<SetupStepsState>;
    onChange(listener: (state: SetupStepsState) => void): () => void;
  };
```

- [ ] **Step 4: `setupStepViews`**

In `packages/shell/src/main/setup-steps.ts`, make sure the SDK import also brings `type ActionCost`, `type Collection`, `type HarnessSettings`, `type HarnessSetupStep` and `setupFormSpec`, add `SetupStepView` to the `@humanharness/ui/client` type import, and add at the end of the file:

```ts
/** What the window draws of each setup step (spec §3), in order: a form's fields, an interview's action and cost, a component's name. */
export function setupStepViews(h: {
  setup?: readonly HarnessSetupStep[];
  actions: Record<string, { cost: ActionCost }>;
  data: Record<string, Collection>;
  settings?: HarnessSettings;
}): SetupStepView[] {
  return (h.setup ?? []).map((s): SetupStepView => {
    const base = { id: s.id, kind: s.kind, label: s.label, required: s.required, ...(s.description ? { description: s.description } : {}) };
    if (s.kind === "form") return { ...base, form: setupFormSpec(s, h) };
    if (s.kind === "interview") return { ...base, action: s.action, cost: h.actions[s.action].cost };
    return { ...base, component: s.component };
  });
}
```

(The manifest guarantees an interview's action exists, Task 1.)

- [ ] **Step 5: The main process**

In `packages/shell/src/main/index.ts`:

1. Imports: `tasksFile` from `@humanharness/workspace`; `SetupStepResult`, `SetupStepsState` types from `@humanharness/ui/client`; `import { SetupSteps, setupStepViews } from "./setup-steps";`.
2. Next to `let settingsCtl: SettingsController | null = null;`, add:

```ts
/** The harness's setup steps (setup-steps spec); null without any (D0). */
let setupCtl: SetupSteps | null = null;
const NO_SETUP_STEPS: SetupStepsState = { steps: {}, blocking: [] };
const NO_SETUP_STEP: SetupStepResult = { ok: false, reason: "unknown" };
```

3. In `appState()`, after `const inputs = …`, add `const interviews = interviewCollections(harness);`. In each action's object, after the `timeBox` spread, add:

```ts
          // An interview step's action is no topic (setup-steps spec §3): the setup screen and Settings start it.
          ...(Object.hasOwn(interviews, id) ? { setup: true as const } : {}),
```

and in the returned object, after the `modes` spread, add:

```ts
    // Only a harness with setup steps sends them (setup-steps D0).
    ...(harness.setup ? { setup: setupStepViews(harness) } : {}),
```

4. In `registerIpc()`, after the `hh:settingsReset` handler, add:

```ts
  // The harness's setup steps (setup-steps spec §4, §5). Without any, nothing to read and every change refused (D0).
  handle("hh:setupStepsGet", () => (setupCtl ? setupCtl.state() : NO_SETUP_STEPS));
  handle("hh:setupStepValues", (id: unknown) => (setupCtl ? setupCtl.values(id) : {}));
  handle("hh:setupStepSubmit", (id: unknown, value: unknown) => (setupCtl ? setupCtl.submit(id, value) : NO_SETUP_STEP));
  handle("hh:setupStepComplete", (id: unknown) => (setupCtl ? setupCtl.complete(id) : NO_SETUP_STEP));
  handle("hh:setupStepSkip", (id: unknown) => (setupCtl ? setupCtl.skip(id) : NO_SETUP_STEP));
  handle("hh:setupStepsFinish", () => (setupCtl ? setupCtl.finish() : NO_SETUP_STEPS));
  handle("hh:setupStepsAcknowledge", () => (setupCtl ? setupCtl.acknowledge() : NO_SETUP_STEPS));
```

5. In the `if (loaded) { … }` block, after the `if (harness.settings) { settingsCtl = … }` block, add (the deps are the ones Task 3's `SetupStepsDeps` declares):

```ts
  if (harness.setup) {
    const settings = settingsCtl;
    setupCtl = new SetupSteps({
      steps: harness.setup,
      data: harness.data,
      ...(harness.settings ? { settings: harness.settings } : {}),
      base: async () => {
        const c = await validConfig();
        return c ? baseOf(c) : null;
      },
      store: async () => {
        const c = await validConfig();
        return c ? dataStoreFor(baseOf(c)) : null;
      },
      // As the person, app-wide: the store's checks, turns-blocked refusals and a `Data: <collection>` commit.
      write: (request) => personData(request, { scope: APP_SCOPE }),
      ...(settings ? { setSetting: (field: string, value: unknown) => settings.set(field, value), settingValues: () => settings.values() } : {}),
      openAction: async () => (await tasks.runningTask())?.action,
      ranBefore: (base) => fs.access(tasksFile(base)).then(() => true, () => false),
      quitting: () => quitting,
      changed: (state) => sendToWindow("hh:setupSteps", state),
    });
  }
```

- [ ] **Step 6: The preload and the fake client**

In `packages/shell/src/preload/index.ts`, add `SetupStepsState` to the type import and, after `settings: { … },`:

```ts
  setupSteps: {
    get: () => ipcRenderer.invoke("hh:setupStepsGet"),
    values: (id) => ipcRenderer.invoke("hh:setupStepValues", id),
    submit: (id, value) => ipcRenderer.invoke("hh:setupStepSubmit", id, value),
    complete: (id) => ipcRenderer.invoke("hh:setupStepComplete", id),
    skip: (id) => ipcRenderer.invoke("hh:setupStepSkip", id),
    finish: () => ipcRenderer.invoke("hh:setupStepsFinish"),
    acknowledge: () => ipcRenderer.invoke("hh:setupStepsAcknowledge"),
    onChange: (listener) => subscribe<SetupStepsState>("hh:setupSteps", listener),
  },
```

In `packages/ui/test/fake-client.ts`, add `SetupStepResult` and `SetupStepsState` to the type import and, after the `settings = { … };` member:

```ts
  /** What setupSteps.get answers; submit, complete and skip change it. */
  setupState: SetupStepsState = { steps: {}, blocking: [] };
  /** What setupSteps.values answers, by step id. */
  setupValues: Record<string, Record<string, unknown>> = {};
  /** Calls to setupSteps, in order: "get", "submit:<id>", "complete:<id>", "skip:<id>", "finish", "acknowledge". */
  setupCalls: string[] = [];
  /** What submit was sent, by step id. */
  setupSubmits: Record<string, Record<string, unknown>> = {};
  /** When set, submit, complete and skip answer it instead. */
  setupFailure: SetupStepResult | null = null;
  private setupStepListeners = new Set<(s: SetupStepsState) => void>();
  /** The main process sent the steps' state. */
  emitSetupSteps(state: SetupStepsState) {
    this.setupState = state;
    for (const l of this.setupStepListeners) l(state);
  }
  private markStep(id: string, status: "done" | "skipped"): SetupStepResult {
    if (this.setupFailure) return this.setupFailure;
    const blocking = status === "done" ? this.setupState.blocking.filter((b) => b !== id) : this.setupState.blocking;
    this.emitSetupSteps({ steps: { ...this.setupState.steps, [id]: status }, blocking });
    return { ok: true, state: this.setupState };
  }
  setupSteps = {
    get: async () => {
      this.setupCalls.push("get");
      return this.setupState;
    },
    values: async (id: string) => this.setupValues[id] ?? {},
    submit: async (id: string, value: Record<string, unknown>) => {
      this.setupCalls.push(`submit:${id}`);
      this.setupSubmits[id] = value;
      return this.markStep(id, "done");
    },
    complete: async (id: string) => {
      this.setupCalls.push(`complete:${id}`);
      return this.markStep(id, "done");
    },
    skip: async (id: string) => {
      this.setupCalls.push(`skip:${id}`);
      return this.markStep(id, "skipped");
    },
    finish: async () => {
      this.setupCalls.push("finish");
      return this.setupState;
    },
    acknowledge: async () => {
      this.setupCalls.push("acknowledge");
      return this.setupState;
    },
    onChange: (listener: (s: SetupStepsState) => void) => {
      this.setupStepListeners.add(listener);
      return () => void this.setupStepListeners.delete(listener);
    },
  };
```

- [ ] **Step 7: Run the tests**

Run: `corepack pnpm vitest run packages/shell/test/setup-steps.test.ts`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm app:build`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/shell/src packages/shell/test/setup-steps.test.ts packages/ui/src/client.ts packages/ui/test/fake-client.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(shell): setup steps reach the window: app state, IPC and client.setupSteps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

## Phase 3 — The window (spec §7 slices 1–3)

### Task 6: The input form takes saved values, an outside submit button and option labels

**Files:**
- Modify: `packages/ui/src/input.ts`, `packages/ui/src/InputForm.tsx`
- Test: `packages/ui/test/input-form.test.tsx`

- [ ] **Step 1: Write the failing test**

In `packages/ui/test/input-form.test.tsx`, add:

```tsx
describe("InputForm for a setup step (setup-steps spec §3 `form`)", () => {
  const spec: InputSpec = {
    fields: [
      { name: "goal", kind: "text", label: "Goal", optional: false, max: 200 },
      { name: "age", kind: "number", label: "Age", optional: true, min: 5, max: 99 },
      { name: "tone", kind: "choice", label: "Tone", optional: false, options: ["patient", "demanding"], optionLabels: { patient: "Patient", demanding: "Demanding" } },
      { name: "examples", kind: "boolean", label: "Show examples", optional: false },
    ],
  };

  it("starts from saved values and shows the options' labels, sending the values", async () => {
    const submit = vi.fn();
    await renderIn(
      "en",
      <InputForm spec={spec} data={null} initial={{ goal: "Pass", age: 12, tone: "demanding", examples: true }} disabled={false} sending={false} errors={[]} submit={submit} />,
    );
    expect((screen.getByLabelText("Goal") as HTMLInputElement).value).toBe("Pass");
    expect((screen.getByLabelText(/^Age/) as HTMLInputElement).value).toBe("12");
    expect((screen.getByRole("radio", { name: "Demanding" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "Show examples" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Patient" }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(submit).toHaveBeenCalledWith({ goal: "Pass", age: 12, tone: "patient", examples: true });
  });

  it("with a formId it draws no buttons of its own: a button outside submits it", async () => {
    const submit = vi.fn();
    await renderIn(
      "en",
      <>
        <InputForm spec={spec} data={null} formId="setup-form" initial={{ goal: "Pass", tone: "patient" }} disabled={false} sending={false} errors={[]} submit={submit} />
        <button type="submit" form="setup-form">
          Next
        </button>
      </>,
    );
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(submit).toHaveBeenCalledWith({ goal: "Pass", tone: "patient", examples: false });
  });
});
```

(`optionLabels` on `InputField` comes from Task 1. If happy-dom doesn't submit a form from a `form=` button outside it, fire `submit` on `document.getElementById("setup-form")` instead.)

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm vitest run packages/ui/test/input-form.test.tsx`
Expected: FAIL (the form ignores `initial`, shows `demanding`, and draws its Send button with `formId`).

- [ ] **Step 3: The helpers**

In `packages/ui/src/input.ts`, after `emptyDraft`, add:

```ts
/** A draft holding saved `values` (a setup form's record or settings): what the form starts from. */
export function draftOf(spec: InputSpec, values: Record<string, unknown>): Draft {
  const draft = emptyDraft(spec);
  for (const f of spec.fields) {
    if (!Object.hasOwn(values, f.name)) continue;
    const v = values[f.name];
    if (f.kind === "number" && typeof v === "number") draft[f.name] = String(v);
    else if (f.kind === "boolean" && typeof v === "boolean") draft[f.name] = v;
    else if ((f.kind === "text" || f.kind === "longText" || f.kind === "choice") && typeof v === "string") draft[f.name] = v;
    else if (f.kind === "multiChoice" && Array.isArray(v)) draft[f.name] = v.filter((x) => typeof x === "string");
    else if (f.kind === "pairs" && Array.isArray(v) && v.length > 0) draft[f.name] = v.map((row) => ({ ...(row as Record<string, string>) }));
  }
  return draft;
}

/** An option's label (a settings form's "Patient"), else the option itself. */
export const optionLabel = (field: InputField, option: string): string =>
  field.optionLabels && Object.hasOwn(field.optionLabels, option) ? field.optionLabels[option] : option;
```

- [ ] **Step 4: The form**

In `packages/ui/src/InputForm.tsx`:

1. Import `draftOf` and `optionLabel` from `./input` with the others.
2. In `InputFormProps`, after `blockId`, add:

```ts
  /** Saved values to start from (a setup form, setup-steps spec §3). A kept draft wins. */
  initial?: Record<string, unknown>;
  /** The form's id: a button elsewhere (the setup screen's footer) submits it, so the form draws no buttons of its own. */
  formId?: string;
```

3. Take `initial` and `formId` in the destructured props, and change the draft's initial state to:

```ts
  const [draft, setDraft] = useState<Draft>(() => (blockId ? drafts.get(blockId) : undefined) ?? (initial ? draftOf(spec, initial) : emptyDraft(spec)));
```

4. Change `<form className="hh-input-form" onSubmit={onSubmit} noValidate>` to `<form id={formId} className="hh-input-form" onSubmit={onSubmit} noValidate>`, and wrap the `<div className="hh-input-actions">…</div>` in `{!formId && ( … )}`.
5. In `Field`, in the `choice` and `multiChoice` branches, change the option's text `{o}` to `{optionLabel(field, o)}` (the `value` stays `o`).

- [ ] **Step 5: Run the tests**

Run: `corepack pnpm vitest run packages/ui/test/input-form.test.tsx packages/ui/test/input-parity.test.ts`
Expected: PASS (D0: the input blocks' tests unchanged).

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/ui/src/input.ts packages/ui/src/InputForm.tsx packages/ui/test/input-form.test.tsx
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(ui): the input form starts from saved values, with option labels and an outside submit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 7: Home waits for a required step; topics leave out interviews

**Files:**
- Modify: `packages/ui/src/Home.tsx`, `packages/ui/src/StartView.tsx`, `packages/ui/src/HarnessApp.tsx`
- Test: `packages/ui/test/setup-home.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/ui/test/setup-home.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HarnessApp } from "../src";
import type { SetupStepView, SetupStepsState } from "../src/client";
import { Home } from "../src/Home";
import { StartView } from "../src/StartView";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const configured = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };
const STEPS: SetupStepView[] = [
  { id: "conocerte", kind: "interview", label: "Get to know you", required: true, action: "conocerte", cost: "light" },
  { id: "estilo", kind: "form", label: "How the AI talks", required: false, form: { fields: [] } },
];

function withSteps(client: FakeClient) {
  client.state = { ...client.state, setup: STEPS, actions: { conocerte: { label: "Get to know you", cost: "light", setup: true }, practice: { label: "Practice", cost: "light" } } };
  return client;
}

async function home(client: FakeClient, steps: SetupStepsState | null) {
  const onStart = vi.fn();
  const onSetup = vi.fn();
  await renderIn(
    "en",
    <Home state={client.state} client={client} onChange={() => {}} status={client.status} limits={null} steps={steps} onStart={onStart} onSetup={onSetup} onSettings={() => {}} onEngine={() => {}} />,
  );
  return { onStart, onSetup };
}

describe("Home with setup steps (setup-steps spec §4)", () => {
  it("a required step not done: says which, and Set up opens the setup screen at it", async () => {
    const client = withSteps(new FakeClient(configured));
    const { onSetup, onStart } = await home(client, { steps: { conocerte: "missing", estilo: "missing" }, blocking: ["conocerte"] });
    expect(screen.getByText("One step left: Get to know you")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start Demo" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Set up Demo" }));
    expect(onSetup).toHaveBeenCalledWith("conocerte");
    expect(onStart).not.toHaveBeenCalled();
  });

  it("a skippable step never blocks Start", async () => {
    const client = withSteps(new FakeClient(configured));
    const { onStart } = await home(client, { steps: { conocerte: "done", estilo: "missing" }, blocking: [] });
    fireEvent.click(screen.getByRole("button", { name: "Start Demo" }));
    expect(onStart).toHaveBeenCalledOnce();
    expect(screen.queryByText(/One step left/)).toBeNull();
  });

  it("while the steps' state loads, Start waits", async () => {
    const client = withSteps(new FakeClient(configured));
    await home(client, null);
    expect((screen.getByRole("button", { name: "Start Demo" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("an engine problem comes first", async () => {
    const client = withSteps(new FakeClient(configured));
    client.status = { ...client.status, loggedIn: false };
    const { onSetup } = await home(client, { steps: {}, blocking: ["conocerte"] });
    expect(screen.queryByText("One step left: Get to know you")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Set up Demo" }));
    expect(onSetup).toHaveBeenCalledWith(undefined);
  });

  it("HarnessApp reads the steps' state and follows its changes", async () => {
    const client = withSteps(new FakeClient(configured));
    client.setupState = { steps: { conocerte: "missing" }, blocking: ["conocerte"] };
    render(<HarnessApp client={client} />);
    expect(await screen.findByText("One step left: Get to know you")).toBeTruthy();
    client.emitSetupSteps({ steps: { conocerte: "done" }, blocking: [] });
    await waitFor(() => expect(screen.queryByText("One step left: Get to know you")).toBeNull());
  });

  it("D0: a harness without setup steps never asks for them", async () => {
    const client = new FakeClient(configured);
    render(<HarnessApp client={client} />);
    await screen.findByRole("button", { name: "Start Demo" });
    expect(client.setupCalls).toEqual([]);
  });
});

describe("StartView", () => {
  it("leaves an interview step's action out of the topics", async () => {
    const client = withSteps(new FakeClient(configured));
    await renderIn("en", <StartView state={client.state} tasks={{ current: null, actions: {}, notes: [] }} notice={null} disabled={false} onStart={() => {}} onAsk={() => {}} />);
    expect(screen.getByRole("button", { name: /Practice/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Get to know you/ })).toBeNull();
  });
});
```

(`render` without `renderIn` for `HarnessApp`, as `flow.test.tsx` does: the app builds its own i18n. Home's other props — `status`, `limits`, `onEngine` — are copied from `packages/ui/test/home.test.tsx`; use that file's names if they differ. The "engine problem" case assumes `home.test.tsx`'s way of making the engine not ready; reuse it.)

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm vitest run packages/ui/test/setup-home.test.tsx`
Expected: FAIL (Home has no `steps`; StartView lists every action).

- [ ] **Step 3: Home**

In `packages/ui/src/Home.tsx`:

1. Add `type SetupStepsState` to the `./client` import.
2. Add the prop (in the destructuring and the type), and change `onSetup`'s type:

```ts
  /** The harness's setup steps' state (setup-steps spec §4); null while it loads. Unused without setup steps. */
  steps?: SetupStepsState | null;
  /** Something is missing: the setup flow, at this harness step when it is one. */
  onSetup: (step?: string) => void;
```

3. Replace

```ts
  const configured = isConfigured(state.config);
  const ready = configured && connected === true;
  const checking = configured && connected === null;
```

with

```ts
  const configured = isConfigured(state.config);
  // Setup steps (setup-steps spec §4): a required one not done keeps Home on "Set up"; while their state loads, Start waits.
  const stepsKnown = state.setup === undefined || steps != null;
  const blocking = configured && state.setup ? (steps?.blocking ?? []) : [];
  const ready = configured && connected === true && stepsKnown && blocking.length === 0;
  const checking = configured && (connected === null || (connected === true && !stepsKnown));
  const stepLabel = (id: string) => state.setup?.find((s) => s.id === id)?.label ?? id;
```

4. After the `{configured && missingStep && ( … )}` section, add:

```tsx
        {configured && !missingStep && blocking.length > 0 && (
          <section className="hh-missing">
            <p>{t("home.missing.one", { step: stepLabel(blocking[0]) })}</p>
          </section>
        )}
```

5. Change the Set up button's `onClick={onSetup}` to:

```tsx
onClick={() => onSetup(!missingStep && blocking.length > 0 ? blocking[0] : undefined)}
```

- [ ] **Step 4: StartView**

In `packages/ui/src/StartView.tsx`, change

```ts
  const ids = [...path, ...Object.keys(state.actions).filter((id) => !path.includes(id))];
```

to

```ts
  // An interview step's action is no topic (setup-steps spec §3).
  const ids = [...path, ...Object.keys(state.actions).filter((id) => !path.includes(id) && !state.actions[id].setup)];
```

- [ ] **Step 5: HarnessApp reads the steps**

In `packages/ui/src/HarnessApp.tsx`:

1. Add `type SetupStepsState` to the `./client` import.
2. After the `limits` state, add:

```ts
  /** The harness's setup steps' state (setup-steps spec §4): Home waits for it before it offers Start. */
  const [steps, setSteps] = useState<SetupStepsState | null>(null);
```

3. After the `openScope` effect, add:

```ts
  const hasSetupSteps = Boolean(state?.setup);
  const folder = state?.config.folder;
  // Read again when the folder changes (its own setup.json) and on every screen change (the setup screen moved it on).
  useEffect(() => {
    if (!hasSetupSteps) return;
    let live = true;
    let seen = false;
    const off = client.setupSteps.onChange((s) => {
      seen = true;
      if (live) setSteps(s);
    });
    client.setupSteps.get().then(
      (s) => {
        if (live && !seen) setSteps(s);
      },
      // Unknown: nothing blocks (a failed read must never lock the person out).
      () => {
        if (live && !seen) setSteps({ steps: {}, blocking: [] });
      },
    );
    return () => {
      live = false;
      off();
    };
  }, [client, hasSetupSteps, folder, screen]);
```

4. Pass `steps={steps}` to `<Home … />`.

- [ ] **Step 6: Run the tests**

Run: `corepack pnpm vitest run packages/ui/test/setup-home.test.tsx packages/ui/test/home.test.tsx packages/ui/test/flow.test.tsx`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm app:build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/ui/src/Home.tsx packages/ui/src/StartView.tsx packages/ui/src/HarnessApp.tsx packages/ui/test/setup-home.test.tsx
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(ui): Home waits for a required setup step; interviews are no topics

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 8: The setup screen goes through the harness's steps: forms, Skip, components, All set

**Files:**
- Create: `packages/ui/src/SetupStepForm.tsx`
- Modify: `packages/ui/src/SetupFlow.tsx`, `packages/ui/src/HarnessApp.tsx`, `packages/i18n/src/locales/en.json`
- Test: `packages/ui/test/setup-flow.test.tsx`

- [ ] **Step 1: Write the failing test**

In `packages/ui/test/setup-flow.test.tsx`, extend `Flow` so it passes the new props through:

```tsx
function Flow({
  client,
  onCancel = () => {},
  onStart = () => {},
  ...rest
}: { client: FakeClient; onCancel?: () => void; onStart?: () => void } & Partial<Pick<SetupFlowProps, "startAt" | "only" | "components">>) {
  const [state, setState] = useState<AppState>(client.state);
  return <SetupFlow client={client} state={state} onChange={setState} onCancel={onCancel} onStart={onStart} {...rest} />;
}
```

(import `type SetupFlowProps` from `../src/SetupFlow`; `next()` and `steps()` are the file's existing helpers for the footer's Next button and the stepper's items), and add:

```tsx
const STEPS: SetupStepView[] = [
  {
    id: "estilo",
    kind: "form",
    label: "How the AI talks",
    description: "Pick how it sounds.",
    required: false,
    form: { fields: [{ name: "tone", kind: "choice", label: "Tone", optional: false, options: ["patient", "demanding"], optionLabels: { patient: "Patient", demanding: "Demanding" } }] },
  },
  { id: "ready", kind: "component", label: "Ready check", required: true, component: "ReadyStep" },
];
const ReadyStep = ({ done }: SetupStepProps) => (
  <button type="button" onClick={done}>
    All good
  </button>
);
const withSteps = (client: FakeClient) => {
  client.state = { ...client.state, setup: STEPS };
  client.setupState = { steps: { estilo: "missing", ready: "missing" }, blocking: ["ready"] };
  client.setupValues = { estilo: { tone: "patient" } };
  return client;
};

describe("SetupFlow: the harness's own steps (setup-steps spec §4)", () => {
  it("after the engine: each step not done, in order, in the stepper; a form, a component, then All set", async () => {
    const client = withSteps(new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo" }));
    await renderIn("en", <Flow client={client} components={{ ReadyStep }} />);
    await waitFor(() => expect(next().disabled).toBe(false));
    expect(steps().map((li) => li.textContent)).toEqual(["1Your folder", "2AI engine", "3How the AI talks", "4Ready check"]);
    fireEvent.click(next());
    const form = await screen.findByRole("heading", { name: "How the AI talks" });
    expect(document.activeElement).toBe(form);
    expect(screen.getByText("Pick how it sounds.")).toBeTruthy();
    expect(steps()[2].getAttribute("aria-current")).toBe("step");
    fireEvent.click(await screen.findByRole("radio", { name: "Demanding" }));
    fireEvent.click(next());
    await screen.findByRole("heading", { name: "Ready check" });
    expect(client.setupSubmits.estilo).toEqual({ tone: "demanding" });
    // Required: no Skip; a component step has no Next of its own.
    expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByRole("heading", { name: "How the AI talks" });
    fireEvent.click(await screen.findByRole("radio", { name: "Demanding" }));
    fireEvent.click(next());
    fireEvent.click(await screen.findByRole("button", { name: "All good" }));
    await screen.findByRole("heading", { name: "All set" });
    await waitFor(() => expect(client.setupCalls).toContain("finish"));
    expect(client.setupCalls.filter((c) => c.startsWith("complete:"))).toEqual(["complete:ready"]);
  });

  it("Skip on a skippable step; the steps done or skipped before are not offered again", async () => {
    const client = withSteps(new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo", engineId: "claude" }));
    await renderIn("en", <Flow client={client} components={{ ReadyStep }} />);
    await waitFor(() => expect(next().disabled).toBe(false));
    fireEvent.click(next());
    await screen.findByRole("heading", { name: "How the AI talks" });
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await screen.findByRole("heading", { name: "Ready check" });
    expect(client.setupCalls).toContain("skip:estilo");
    cleanup();
    client.setupState = { steps: { estilo: "skipped", ready: "missing" }, blocking: ["ready"] };
    await renderIn("en", <Flow client={client} components={{ ReadyStep }} />);
    await waitFor(() => expect(steps().map((li) => li.textContent)).toEqual(["1AI engine", "2Ready check"]));
  });

  it("from Home: opens at the step, the core steps marked done; its Back is Cancel", async () => {
    const client = withSteps(new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo", engineId: "claude" }));
    const onCancel = vi.fn();
    await renderIn("en", <Flow client={client} startAt="ready" onCancel={onCancel} components={{ ReadyStep }} />);
    await screen.findByRole("heading", { name: "Ready check" });
    expect(steps()[0].querySelector("svg")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("only one step (Settings' Do it again): its end goes back, with no All set", async () => {
    const client = withSteps(new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo", engineId: "claude" }));
    client.setupState = { steps: { estilo: "done", ready: "done" }, blocking: [] };
    const onCancel = vi.fn();
    await renderIn("en", <Flow client={client} startAt="ready" only onCancel={onCancel} components={{ ReadyStep }} />);
    expect(steps().map((li) => li.textContent)).toEqual(["1Ready check"]);
    fireEvent.click(await screen.findByRole("button", { name: "All good" }));
    await waitFor(() => expect(onCancel).toHaveBeenCalledOnce());
    expect(client.setupCalls).not.toContain("finish");
  });

  it("a refused form shows why and stays; a component the harness didn't register says so", async () => {
    const client = withSteps(new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo", engineId: "claude" }));
    client.setupFailure = { ok: false, reason: "invalid", errors: [{ path: "", message: "Not now" }] };
    await renderIn("en", <Flow client={client} startAt="estilo" />);
    await screen.findByRole("radio", { name: "Patient" });
    fireEvent.click(next());
    expect(await screen.findByText("Not now")).toBeTruthy();
    client.setupFailure = null;
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(await screen.findByText("This step can't be shown. Skip it, or update the app.")).toBeTruthy();
  });

  it("D0: without setup steps the flow never asks for them", async () => {
    const client = new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo" });
    await renderIn("en", <Flow client={client} />);
    await waitFor(() => expect(next().disabled).toBe(false));
    fireEvent.click(next());
    await screen.findByRole("heading", { name: "All set" });
    expect(client.setupCalls).toEqual([]);
  });
});
```

Add `SetupStepProps`, `SetupStepView` to the `../src/client` type import. The stepper texts follow the current `setupFlow.stepFolder` / `setupFlow.stepEngine` strings; with a saved folder today's flow lists only the engine (it starts there), so check `steps()`' existing expectations in the file and match them.

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm vitest run packages/ui/test/setup-flow.test.tsx`
Expected: FAIL (no `SetupFlowProps`; the flow goes from the engine to All set).

- [ ] **Step 3: Strings**

In `packages/i18n/src/locales/en.json`, add a top-level `setupSteps` object after `setupFlow`:

```json
  "setupSteps": {
    "skip": "Skip",
    "failed": "That didn't go through. Try again.",
    "incomplete": "The app doesn't have what it needs yet. Continue the interview to finish it.",
    "missingComponent": "This step can't be shown. Skip it, or update the app."
  },
```

- [ ] **Step 4: A form step's body**

Create `packages/ui/src/SetupStepForm.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient, InputIssue, SetupStepView, SetupStepsState } from "./client";
import { InputForm } from "./InputForm";

/**
 * A `form` step (setup-steps spec §3): the core form over the step's fields, starting from their saved values. Its
 * submit saves through the main process (the same checks as any write); a refusal shows by field. With `formId` the
 * setup screen's footer submits it; without, it has its own button (`submitLabel`, Settings' Save).
 */
export function SetupStepForm({
  client,
  step,
  formId,
  submitLabel,
  onDone,
}: {
  client: HarnessClient;
  step: SetupStepView;
  formId?: string;
  submitLabel?: string;
  onDone: (state: SetupStepsState) => void;
}) {
  const { t } = useTranslation();
  const [initial, setInitial] = useState<Record<string, unknown> | null>(null);
  const [errors, setErrors] = useState<InputIssue[]>([]);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let live = true;
    client.setupSteps.values(step.id).then(
      (v) => {
        if (live) setInitial(v);
      },
      () => {
        if (live) setInitial({});
      },
    );
    return () => {
      live = false;
    };
  }, [client, step.id]);

  if (!step.form || initial === null) return <div aria-busy="true" />;
  const failed: InputIssue[] = [{ path: "", message: t("setupSteps.failed") }];
  const submit = (value: Record<string, unknown>) => {
    setSending(true);
    setErrors([]);
    client.setupSteps
      .submit(step.id, value)
      .then(
        (r) => {
          if (r.ok) onDone(r.state);
          else setErrors(r.errors && r.errors.length > 0 ? r.errors : failed);
        },
        () => setErrors(failed),
      )
      .finally(() => setSending(false));
  };
  return (
    <InputForm
      spec={submitLabel ? { ...step.form, submitLabel } : step.form}
      data={null}
      initial={initial}
      {...(formId ? { formId } : {})}
      disabled={false}
      sending={sending}
      errors={errors}
      submit={submit}
    />
  );
}
```

(`InputIssue` is the error type `InputForm`'s `errors` prop already takes; use its name from `client.ts`. `SetupStepResult.errors` from Task 2 has the same shape.)

- [ ] **Step 5: The flow**

Replace `packages/ui/src/SetupFlow.tsx` with:

```tsx
import { type ComponentType, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckIcon, TopBar } from "./chrome";
import { type AppState, type HarnessClient, type SetupStepProps, type SetupStepView, isConfigured } from "./client";
import { EngineTab } from "./EngineTab";
import { FolderStep } from "./FolderStep";
import { systemLanguage } from "./language";
import { SetupStepForm } from "./SetupStepForm";

/** A core step, or a harness step by id (setup-steps spec §4). */
type Step = "folder" | "engine" | "done" | `step:${string}`;
const stepOf = (id: string): Step => `step:${id}`;
type Outcome = { ok: true } | { ok: false; reason?: string };

export interface SetupFlowProps {
  client: HarnessClient;
  state: AppState;
  onChange: (state: AppState) => void;
  /** Back to Home; what was saved stays saved. */
  onCancel: () => void;
  /** "Start <name>" on the last step: the work screen. */
  onStart: () => void;
  /** A harness step to open at (Home's missing step); the core steps are done. */
  startAt?: string;
  /** Only `startAt` (Settings' "Do it again"); its end goes back (`onCancel`). */
  only?: boolean;
  /** The harness's own step components (`component` steps), by the name the manifest gives. */
  components?: Record<string, ComponentType<SetupStepProps>>;
}

/**
 * First-time setup, a screen of its own (spec 2026-10-14 §2): the folder, the engine, the harness's own steps
 * (setup-steps spec §4), then "All set".
 */
export function SetupFlow({ client, state, onChange, onCancel, onStart, startAt, only = false, components = {} }: SetupFlowProps) {
  const { t } = useTranslation();
  const name = state.harness.name;
  const harnessSteps = state.setup ?? [];
  // A saved folder can't be changed here (it moves from Settings › General): the flow starts at the engine.
  const [withFolder] = useState(!state.config.folder);
  /** Opened at a harness step (Home, Settings): the core steps are done, and its first step's Back is Cancel. */
  const [entered] = useState(Boolean(startAt && isConfigured(state.config) && harnessSteps.some((s) => s.id === startAt)));
  const [step, setStep] = useState<Step>(entered && startAt ? stepOf(startAt) : withFolder ? "folder" : "engine");
  /** The harness steps this run goes through, in manifest order; null while their state loads. */
  const [queue, setQueue] = useState<string[] | null>(harnessSteps.length === 0 ? [] : only && entered && startAt ? [startAt] : null);
  const [selection, setSelection] = useState<{ engineId: string; ready: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  /** A harness step's skip or completion is on its way. */
  const [busy, setBusy] = useState(false);
  const [stepError, setStepError] = useState<"failed" | "incomplete" | null>(null);
  const headingId = useId();
  const folderFormId = useId();
  const stepFormId = useId();
  const heading = useRef<HTMLHeadingElement>(null);

  // A new step takes focus to its heading, so a screen reader starts reading there; an old refusal goes.
  useEffect(() => {
    heading.current?.focus();
    setStepError(null);
  }, [step]);

  // The steps not done yet (and the one opened at); skipped ones are offered again from Settings, never here.
  useEffect(() => {
    if (queue !== null) return;
    let live = true;
    const all = harnessSteps.map((s) => s.id);
    client.setupSteps.get().then(
      (s) => {
        if (live) setQueue(all.filter((id) => id === startAt || (Object.hasOwn(s.steps, id) ? s.steps[id] : "missing") === "missing"));
      },
      () => {
        if (live) setQueue(all);
      },
    );
    return () => {
      live = false;
    };
  }, [client]);

  // "All set": the steps seen so far count from now on (spec §8 Q3).
  useEffect(() => {
    if (step === "done" && harnessSteps.length > 0) client.setupSteps.finish().catch(() => {});
  }, [step]);

  const current: SetupStepView | undefined = step.startsWith("step:") ? harnessSteps.find((s) => stepOf(s.id) === step) : undefined;
  /** After harness step `id`: the next one, else All set (or back, for a single step). */
  const after = (id: string) => {
    const q = queue ?? [];
    const following = q[q.indexOf(id) + 1];
    if (following !== undefined) setStep(stepOf(following));
    else if (only) onCancel();
    else setStep("done");
  };
  /** Back from harness step `id`: the previous one, or the engine when the flow came through it; null: Cancel. */
  const backFrom = (id: string): Step | null => {
    const q = queue ?? [];
    const i = q.indexOf(id);
    if (i > 0) return stepOf(q[i - 1]);
    return entered ? null : "engine";
  };
  const settle = async (id: string, run: () => Promise<Outcome>) => {
    setBusy(true);
    setStepError(null);
    try {
      const r = await run();
      if (r.ok) after(id);
      else setStepError(r.reason === "incomplete" ? "incomplete" : "failed");
    } catch {
      setStepError("failed");
    } finally {
      setBusy(false);
    }
  };
  const skip = (id: string) => void settle(id, () => client.setupSteps.skip(id));
  const complete = (id: string) => void settle(id, () => client.setupSteps.complete(id));

  const next = async () => {
    if (!selection?.ready) return;
    setSaveError(false);
    // A saved folder and engine with no usable language would never count as set up: write the system's here.
    const patch = {
      ...(selection.engineId !== state.config.engineId ? { engineId: selection.engineId } : {}),
      ...(state.config.language ? {} : { language: systemLanguage() }),
    };
    if (Object.keys(patch).length > 0) {
      setSaving(true);
      try {
        onChange(await client.saveConfig(patch));
      } catch {
        setSaveError(true);
        return;
      } finally {
        setSaving(false);
      }
    }
    setStep(queue && queue.length > 0 ? stepOf(queue[0]) : "done");
  };

  if (step === "done") {
    const engine = state.engines.find((e) => e.id === state.config.engineId);
    return (
      <div className="hh-setup">
        <TopBar title={t("setupFlow.title", { name })} mock={state.mock} />
        <main className="hh-setup-body done">
          <section className="hh-setup-step hh-setup-done" aria-labelledby={headingId}>
            <span className="hh-setup-done-mark" aria-hidden="true">
              <CheckIcon />
            </span>
            <h2 id={headingId} ref={heading} tabIndex={-1}>
              {t("setupFlow.readyTitle")}
            </h2>
            <div className="hh-rows">
              <div className="hh-row">
                <span className="hh-row-label">{t("setupFlow.readyFolder")}</span>
                <code>
                  <bdi dir="ltr">{state.config.folder}</bdi>
                </code>
              </div>
              <div className="hh-row">
                <span className="hh-row-label">{t("setupFlow.readyEngine")}</span>
                <span>{engine ? (engine.mock ? `${engine.name} · ${t("mock.modelName")}` : engine.name) : state.config.engineId}</span>
              </div>
            </div>
            <p className="hh-caption">{t("setupFlow.readyHint")}</p>
            <button className="hh-primary hh-start" onClick={onStart}>
              {t("home.start", { name })}
            </button>
          </section>
        </main>
      </div>
    );
  }

  // The core steps as today (the folder only when the flow asks for it), then the harness steps of this run.
  const core: { id: Step; label: string }[] = [
    ...(withFolder ? [{ id: "folder" as Step, label: t("setupFlow.stepFolder") }] : []),
    { id: "engine", label: t("setupFlow.stepEngine") },
  ];
  const own = (queue ?? []).flatMap((id) => harnessSteps.filter((s) => s.id === id).map((s) => ({ id: stepOf(s.id), label: s.label })));
  const steps = only && current ? own.filter((s) => s.id === step) : [...core, ...own];
  const at = steps.findIndex((s) => s.id === step);
  const back = current ? backFrom(current.id) : null;
  const waiting = busy || queue === null;

  return (
    <div className="hh-setup">
      <TopBar title={t("setupFlow.title", { name })} mock={state.mock} />
      <ol className="hh-setup-steps" aria-label={t("setupFlow.stepsLabel")}>
        {steps.map((s, i) => (
          <li key={s.id} aria-current={i === at ? "step" : undefined}>
            <span className={i < at ? "hh-step-mark done" : "hh-step-mark"}>{i < at ? <CheckIcon /> : i + 1}</span>
            {s.label}
          </li>
        ))}
      </ol>
      <main className="hh-setup-body">
        {current ? (
          <section key={current.id} className="hh-setup-step" aria-labelledby={headingId}>
            <h2 id={headingId} ref={heading} tabIndex={-1}>
              {current.label}
            </h2>
            {current.description && <p className="hh-setup-intro">{current.description}</p>}
            {current.kind === "form" && <SetupStepForm client={client} step={current} formId={stepFormId} onDone={() => after(current.id)} />}
            {current.kind === "component" && (
              <ComponentStep client={client} step={current} components={components} done={() => complete(current.id)} skip={() => skip(current.id)} />
            )}
            {stepError && (
              <p className="hh-save-error" role="alert">
                {t(stepError === "incomplete" ? "setupSteps.incomplete" : "setupSteps.failed")}
              </p>
            )}
          </section>
        ) : step === "folder" ? (
          <section className="hh-setup-step" aria-labelledby={headingId}>
            <h2 id={headingId} ref={heading} tabIndex={-1}>
              {t("setupFlow.folderHeading")}
            </h2>
            <p className="hh-setup-intro">{t("setupFlow.folderIntro", { name })}</p>
            <FolderStep
              client={client}
              state={state}
              formId={folderFormId}
              onSaved={(s) => {
                onChange(s);
                if (s.config.folder) setStep("engine");
              }}
            />
          </section>
        ) : (
          <section className="hh-setup-step" aria-labelledby={headingId}>
            <h2 id={headingId} ref={heading} tabIndex={-1}>
              {t("setupFlow.engineHeading", { name })}
            </h2>
            {/* A mock app has no plan or account to bring: only the test-mode caption. */}
            <p className="hh-setup-intro">{state.mock ? t("mock.only") : t("setupFlow.engineIntro", { name })}</p>
            <EngineTab client={client} state={state} onChange={onChange} setup onSelection={(engineId, ready) => setSelection({ engineId, ready })} />
            {saveError && (
              <p className="hh-save-error" role="alert">
                {t("setupFlow.saveError")}
              </p>
            )}
          </section>
        )}
      </main>
      <footer className="hh-setup-footer">
        {current ? (
          <>
            {back ? (
              <button disabled={busy} onClick={() => setStep(back)}>
                {t("setupFlow.back")}
              </button>
            ) : (
              <button disabled={busy} onClick={onCancel}>
                {t("setupFlow.cancel")}
              </button>
            )}
            {!current.required && (
              <button disabled={waiting} onClick={() => skip(current.id)}>
                {t("setupSteps.skip")}
              </button>
            )}
            {/* A form's Next submits it from here, like the folder step's; a component step ends itself (done()). */}
            {current.kind === "form" && (
              <button type="submit" form={stepFormId} className="hh-primary" disabled={waiting}>
                {t("setupFlow.next")}
              </button>
            )}
          </>
        ) : (
          <>
            {/* Not while the engine is being saved: its answer would move the flow on from wherever it went. */}
            {step === "engine" && withFolder ? (
              <button disabled={saving} onClick={() => setStep("folder")}>
                {t("setupFlow.back")}
              </button>
            ) : (
              <button disabled={saving} onClick={onCancel}>
                {t("setupFlow.cancel")}
              </button>
            )}
            {/* The folder step's Next submits its form from here, so it sits where the engine step's does. */}
            {step === "folder" && (
              <button type="submit" form={folderFormId} className="hh-primary">
                {t("setupFlow.next")}
              </button>
            )}
            {step === "engine" && (
              <button className="hh-primary" disabled={!selection?.ready || saving || queue === null} onClick={() => void next()}>
                {t("setupFlow.next")}
              </button>
            )}
          </>
        )}
      </footer>
    </div>
  );
}

/** A `component` step: the harness's own React step, or a line saying it can't be shown (setup-steps spec §3). */
function ComponentStep({
  client,
  step,
  components,
  done,
  skip,
}: {
  client: HarnessClient;
  step: SetupStepView;
  components: Record<string, ComponentType<SetupStepProps>>;
  done: () => void;
  skip: () => void;
}) {
  const { t } = useTranslation();
  const name = step.component ?? "";
  const Component = Object.hasOwn(components, name) ? components[name] : undefined;
  if (!Component) return <p className="hh-caption">{t("setupSteps.missingComponent")}</p>;
  return <Component client={client} profile={null} done={done} skip={skip} />;
}
```

The folder, engine and All set parts are today's code, unchanged except: the engine's Next goes to the first harness step and waits for the queue. Before replacing the file, diff its current text against the core parts above and keep whatever plan 5 or later changed in them (class names, strings, the stepper's list).

- [ ] **Step 6: HarnessApp opens the screen at a step**

In `packages/ui/src/HarnessApp.tsx`:

1. Add `type SetupStepProps` to the `./client` import and `type ComponentType` to the `react` import.
2. In `HarnessAppProps`, add:

```ts
  /** The harness's own setup step components (`component` steps, setup-steps spec §3), by the name the manifest gives. */
  setupSteps?: Record<string, ComponentType<SetupStepProps>>;
```

and take `setupSteps = {}` in `HarnessApp`'s destructured props.
3. After the `steps` state (Task 7), add:

```ts
  /** Where the setup screen opens: a harness step (Home's missing one), alone with `only` (Settings' "Do it again"). */
  const [setupAt, setSetupAt] = useState<{ step?: string; only?: boolean }>({});
  const openSetup = (at: { step?: string; only?: boolean }) => {
    setSetupAt(at);
    setScreen("setup");
  };
```

4. Render `SetupFlow` as:

```tsx
          <SetupFlow
            key={`${setupAt.step ?? ""}:${setupAt.only ? "only" : ""}`}
            client={client}
            state={state}
            onChange={setState}
            onCancel={() => leaveSetup("home")}
            onStart={() => leaveSetup("work")}
            {...(setupAt.step ? { startAt: setupAt.step } : {})}
            only={setupAt.only === true}
            components={setupSteps}
          />
```

(`leaveSetup` is whatever the file calls today on the flow's cancel and start; keep it.)

5. Home: `onSetup={(step) => openSetup(step ? { step } : {})}`. SettingsSheet: `onSetup={(step?: string) => { setSettings(null); openSetup(step ? { step, only: true } : {}); }}` (keep the way the sheet closes today; the sheet passes a step from Task 10 on).

- [ ] **Step 7: Run the tests**

Run: `corepack pnpm vitest run packages/ui/test/setup-flow.test.tsx packages/ui/test/HarnessApp.test.tsx`
Expected: PASS (D0: the earlier SetupFlow tests unchanged).

Run: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm app:build`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/ui/src/SetupStepForm.tsx packages/ui/src/SetupFlow.tsx packages/ui/src/HarnessApp.tsx packages/i18n/src/locales/en.json packages/ui/test/setup-flow.test.tsx
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(ui): the setup screen goes through the harness's steps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 9: An interview on the setup screen: the slim chat and its Next

**Files:**
- Create: `packages/ui/src/SetupInterviewStep.tsx`
- Modify: `packages/ui/src/ChatView.tsx`, `packages/ui/src/SetupFlow.tsx`, `packages/ui/src/HarnessApp.tsx`, `packages/ui/src/styles.css`, `packages/i18n/src/locales/en.json`
- Test: `packages/ui/test/setup-interview.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/ui/test/setup-interview.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { ActionCost, AppState, SetupStepView } from "../src/client";
import { SetupFlow } from "../src/SetupFlow";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const configured = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };

function interviewClient(cost: ActionCost = "medium") {
  const client = new FakeClient(configured);
  const step: SetupStepView = { id: "conocerte", kind: "interview", label: "Get to know you", required: true, action: "conocerte", cost };
  client.state = { ...client.state, setup: [step], actions: { conocerte: { label: "Get to know you", cost, setup: true } } };
  client.setupState = { steps: { conocerte: "missing" }, blocking: ["conocerte"] };
  return client;
}

function Flow({ client }: { client: FakeClient }) {
  const [state, setState] = useState<AppState>(client.state);
  return <SetupFlow client={client} state={state} onChange={setState} onCancel={() => {}} onStart={() => {}} startAt="conocerte" />;
}

describe("an interview step (setup-steps spec §3 `interview`)", () => {
  it("a slim chat: no top bar of its own, no topics; Start sends the action; the cost caption when it isn't light", async () => {
    const client = interviewClient();
    await renderIn("en", <Flow client={client} />);
    await screen.findByRole("heading", { name: "Get to know you" });
    expect(screen.getByText("This conversation uses some of your AI plan.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "History" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    await waitFor(() => expect(client.sent).toEqual(["Get to know you"]));
    expect(client.sentOptions[0]).toEqual({ action: "conocerte" });
  });

  it("no caption for a light interview", async () => {
    await renderIn("en", <Flow client={interviewClient("light")} />);
    await screen.findByRole("button", { name: "Start" });
    expect(screen.queryByText(/uses .* of your AI plan/)).toBeNull();
  });

  it("Next closes the open interview first, then completes the step", async () => {
    const client = interviewClient();
    client.tasks = { current: { id: "t1", action: "conocerte", status: "waiting" }, actions: {}, notes: [] };
    await renderIn("en", <Flow client={client} />);
    await screen.findByRole("heading", { name: "Get to know you" });
    const next = await screen.findByRole("button", { name: "Next" });
    await waitFor(() => expect((next as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(next);
    await screen.findByRole("heading", { name: "All set" });
    expect(client.taskCalls).toEqual(["finish"]);
    expect(client.setupCalls).toContain("complete:conocerte");
  });

  it("a closed interview with no valid record: says so, and offers to continue", async () => {
    const client = interviewClient();
    client.tasks = { current: null, actions: { conocerte: "unsaved" }, notes: [] };
    client.setupFailure = { ok: false, reason: "incomplete" };
    await renderIn("en", <Flow client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "Next" }));
    expect(await screen.findByText("The app doesn't have what it needs yet. Continue the interview to finish it.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue the interview" })).toBeTruthy();
    expect(client.taskCalls).toEqual([]);
  });
});
```

`client.sent`, `client.sentOptions`, `client.tasks` and `client.taskCalls` are `FakeClient`'s names for what `send` got, what `getTasks` answers and the `finishTask` calls (plan 5 added the last); if a name differs, use the file's. The task's `status` value and the `actions` map value follow `TaskView` in `client.ts`.

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm vitest run packages/ui/test/setup-interview.test.tsx`
Expected: FAIL (an interview step draws nothing and has no Next).

- [ ] **Step 3: Strings and style**

In `packages/i18n/src/locales/en.json`, add to `setupSteps`:

```json
    "startInterview": "Start",
    "continueInterview": "Continue the interview",
    "costMedium": "This conversation uses some of your AI plan.",
    "costHeavy": "This conversation uses a good part of your AI plan."
```

In `packages/ui/src/styles.css`, after the `.hh-app` rule, add:

```css
/* An interview inside the setup screen (setup-steps spec §3): the chat only, in the step's column. */
.hh-app.hh-app-slim { grid-template-rows: minmax(0, 1fr); height: min(60vh, 520px); border: 1px solid var(--hh-line); border-radius: 10px; }
.hh-slim-start { display: grid; place-items: center; padding: 24px; }
```

- [ ] **Step 4: ChatView's slim view**

In `packages/ui/src/ChatView.tsx`:

1. Add the prop (destructured and typed):

```ts
  /**
   * An interview on the setup screen (setup-steps spec §3): only this action's task, with no top bar, side panel,
   * history or topics. A button starts it (or continues it) when it isn't on screen.
   */
  slim?: { action: string };
```

2. In the "Flow mode, once the conversation and the tasks are known" placement effect, change

```ts
    const id = tasks.current?.id;
    if (!id) return;
```

to

```ts
    const id = tasks.current?.id;
    // Slim: only the interview's own task is shown.
    if (!id || (slim && tasks.current?.action !== slim.action)) return;
```

3. Before the `return (`, add:

```ts
  // One `main` per page: the setup screen has its own.
  const Main = slim ? "div" : "main";
  /** Slim: the interview's task isn't the open one (not started, closed, or another task is open). */
  const slimStart = slim !== undefined && loaded && tasksLoaded && !chat.live && tasks.current?.action !== slim.action;
```

(`loaded`, `tasksLoaded` and `chat.live` are the names the component already uses for "the chat is read", "the tasks are read" and "a turn is running"; use the file's names.)

4. In the JSX:
   - the root: `<div className={slim ? "hh-app hh-app-slim" : "hh-app"}>`;
   - wrap the whole `<TopBar …>…</TopBar>` in `{!slim && ( … )}`;
   - `{flow && (<FlowSide … />)}` becomes `{flow && !slim && (<FlowSide … />)}`;
   - `<main className="hh-main">` / `</main>` become `<Main className="hh-main">` / `</Main>`;
   - `{showStart && (<StartView … />)}` becomes `{showStart && !slim && (<StartView … />)}`, and right after it add:

```tsx
            {slim && slimStart && (
              <div className="hh-slim-start">
                <button type="button" className="hh-primary" disabled={blocked()} onClick={() => startTopic(slim.action)}>
                  {t(Object.hasOwn(tasks.actions, slim.action) ? "setupSteps.continueInterview" : "setupSteps.startInterview")}
                </button>
              </div>
            )}
```

   - the "back to topics" button's condition `{flow && since !== null && !tasks.current && !chat.live && (` becomes `{flow && !slim && since !== null && !tasks.current && !chat.live && (`;
   - `{renderSide && (` becomes `{renderSide && !slim && (`.

`startTopic` is the existing `(id) => void send(labelOf(id), { action: id })`, so a `heavy` interview still gets the pre-flight question. `blocked()` is the existing "can't send now" check; use the file's name.

- [ ] **Step 5: The interview's body**

Create `packages/ui/src/SetupInterviewStep.tsx`:

```tsx
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { ChatView } from "./ChatView";
import type { AppState, HarnessClient, SetupStepView } from "./client";
import type { BlockProps } from "./Message";

/** An `interview` step's body (setup-steps spec §3): its cost when it isn't light, then its task's chat, slim. */
export function SetupInterviewStep({
  client,
  state,
  step,
  blocks,
  stateBlocks,
}: {
  client: HarnessClient;
  state: AppState;
  step: SetupStepView;
  blocks: Record<string, ComponentType<BlockProps>>;
  stateBlocks: string[];
}) {
  const { t } = useTranslation();
  return (
    <>
      {(step.cost === "medium" || step.cost === "heavy") && <p className="hh-caption">{t(step.cost === "heavy" ? "setupSteps.costHeavy" : "setupSteps.costMedium")}</p>}
      <ChatView client={client} state={state} components={blocks} stateBlocks={stateBlocks} slim={{ action: step.action ?? "" }} />
    </>
  );
}
```

(Pass ChatView whatever other required props `HarnessApp` passes it today, with no-op callbacks for the screen changes the slim view never shows.)

- [ ] **Step 6: The flow's interview**

In `packages/ui/src/SetupFlow.tsx`:

1. Imports: add `type TaskView` to the `./client` import, `import type { BlockProps } from "./Message";` and `import { SetupInterviewStep } from "./SetupInterviewStep";`.
2. In `SetupFlowProps`, add:

```ts
  /** The harness's block components and state-only blocks, for an interview's chat. */
  blocks?: Record<string, ComponentType<BlockProps>>;
  stateBlocks?: string[];
```

and take `blocks = {}, stateBlocks = []` in the destructuring.
3. After the `stepError` state, add:

```ts
  const hasInterview = harnessSteps.some((s) => s.kind === "interview");
  /** The open task, for an interview's Next (it closes the interview's task first). */
  const [tasks, setTasks] = useState<TaskView | null>(null);
  useEffect(() => {
    if (!hasInterview) return;
    let live = true;
    let seen = false;
    const off = client.onTasks((v) => {
      seen = true;
      if (live) setTasks(v);
    });
    client.getTasks().then(
      (v) => {
        if (live && !seen) setTasks(v);
      },
      () => {},
    );
    return () => {
      live = false;
      off();
    };
  }, [client, hasInterview]);
```

4. After `complete`, add:

```ts
  /** An interview's Next (spec §3): its open task closes with the core closing turn, then the step completes. */
  const finishInterview = (s: SetupStepView) =>
    void settle(s.id, async () => {
      if (tasks?.current?.action === s.action && !(await client.finishTask())) return { ok: false };
      return client.setupSteps.complete(s.id);
    });
```

(`client.finishTask()` is plan 5's; it answers whether the task closed.)

5. In the step's section, after the component line, add:

```tsx
            {current.kind === "interview" && <SetupInterviewStep client={client} state={state} step={current} blocks={blocks} stateBlocks={stateBlocks} />}
```

6. In the footer's harness-step part, after the form's Next, add:

```tsx
            {current.kind === "interview" && (
              <button
                className="hh-primary"
                disabled={waiting || (tasks?.current?.action === current.action && tasks.current.status !== "waiting")}
                onClick={() => finishInterview(current)}
              >
                {t("setupFlow.next")}
              </button>
            )}
```

- [ ] **Step 7: HarnessApp passes the blocks**

In `packages/ui/src/HarnessApp.tsx`, add `blocks={blocks}` and `stateBlocks={stateBlocks}` to `<SetupFlow … />` (the names HarnessApp already uses for the harness's block components and state-only blocks).

- [ ] **Step 8: Run the tests**

Run: `corepack pnpm vitest run packages/ui/test/setup-interview.test.tsx packages/ui/test/setup-flow.test.tsx packages/ui/test/flow.test.tsx packages/ui/test/styles.test.ts`
Expected: PASS (D0: the work screen's chat unchanged).

Run: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm app:build`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/ui/src packages/i18n/src/locales/en.json packages/ui/test/setup-interview.test.tsx
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(ui): an interview runs on the setup screen in a slim chat

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 10: Settings lists the steps: Edit a form, Do it again, Do it now

**Files:**
- Create: `packages/ui/src/SetupStepsList.tsx`
- Modify: `packages/ui/src/SettingsSheet.tsx`, `packages/i18n/src/locales/en.json`
- Test: `packages/ui/test/setup-settings.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/ui/test/setup-settings.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SetupStepView } from "../src/client";
import { SettingsSheet } from "../src/SettingsSheet";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const configured = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };
const STEPS: SetupStepView[] = [
  { id: "conocerte", kind: "interview", label: "Get to know you", required: true, action: "conocerte", cost: "light" },
  { id: "goal", kind: "form", label: "Your goal", required: false, form: { fields: [{ name: "goal", kind: "text", label: "Goal", optional: false, max: 200 }] } },
  { id: "ready", kind: "component", label: "Ready check", required: false, component: "ReadyStep" },
];

async function sheet(client: FakeClient) {
  const onSetup = vi.fn();
  await renderIn(
    "en",
    <SettingsSheet client={client} state={client.state} tab="harness" onTab={() => {}} onChange={() => {}} onClose={() => {}} onSetup={onSetup} />,
  );
  return onSetup;
}

function withSteps() {
  const client = new FakeClient(configured);
  client.state = { ...client.state, setup: STEPS };
  client.setupState = { steps: { conocerte: "done", goal: "done", ready: "skipped" }, blocking: [] };
  client.setupValues = { goal: { goal: "Pass maths" } };
  return client;
}

describe("Settings › Setup (setup-steps spec §5)", () => {
  it("a harness with steps and no settings gets a Setup tab; showing it acknowledges the steps", async () => {
    const client = withSteps();
    await sheet(client);
    expect(screen.getByRole("tab", { name: "Setup" })).toBeTruthy();
    await waitFor(() => expect(client.setupCalls).toContain("acknowledge"));
  });

  it("each step with its status; interviews and components run again from the setup screen", async () => {
    const client = withSteps();
    const onSetup = await sheet(client);
    const row = (label: string) => screen.getByRole("listitem", { name: label });
    await waitFor(() => expect(within(row("Get to know you")).getByText("Done")).toBeTruthy());
    expect(within(row("Ready check")).getByText("Skipped. You can do it now.")).toBeTruthy();
    fireEvent.click(within(row("Get to know you")).getByRole("button", { name: "Do it again" }));
    expect(onSetup).toHaveBeenCalledWith("conocerte");
    fireEvent.click(within(row("Ready check")).getByRole("button", { name: "Do it now" }));
    expect(onSetup).toHaveBeenCalledWith("ready");
  });

  it("a form step edits in place, from its saved values", async () => {
    const client = withSteps();
    await sheet(client);
    const row = await screen.findByRole("listitem", { name: "Your goal" });
    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));
    const goal = (await within(row).findByLabelText("Goal")) as HTMLInputElement;
    expect(goal.value).toBe("Pass maths");
    fireEvent.change(goal, { target: { value: "Pass maths in June" } });
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));
    expect(await within(row).findByText("Saved")).toBeTruthy();
    expect(client.setupSubmits.goal).toEqual({ goal: "Pass maths in June" });
  });

  it("not set up yet: the tab leads to the setup flow, with no step", async () => {
    const client = new FakeClient({ language: "en" });
    client.state = { ...client.state, setup: STEPS };
    const onSetup = await sheet(client);
    fireEvent.click(screen.getByRole("button", { name: /^Set up / }));
    expect(onSetup).toHaveBeenCalledWith();
  });

  it("D0: without settings or steps there is no harness tab", async () => {
    await sheet(new FakeClient(configured));
    expect(screen.queryByRole("tab", { name: "Setup" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm vitest run packages/ui/test/setup-settings.test.tsx`
Expected: FAIL (no harness tab without settings; no steps list).

- [ ] **Step 3: Strings**

In `packages/i18n/src/locales/en.json`, add to `setupSteps`:

```json
    "listTitle": "Setup",
    "status": { "done": "Done", "skipped": "Skipped. You can do it now.", "missing": "Not done yet" },
    "redo": "Do it again",
    "doNow": "Do it now",
    "edit": "Edit",
    "save": "Save",
    "saved": "Saved"
```

and to `settings.tabs`: `"setup": "Setup"`.

- [ ] **Step 4: The list**

Create `packages/ui/src/SetupStepsList.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient, SetupStepStatus, SetupStepView, SetupStepsState } from "./client";
import { SetupStepForm } from "./SetupStepForm";

/**
 * Settings' list of the harness's setup steps (setup-steps spec §5): each with its status. A form edits in place;
 * an interview or a component runs again on the setup screen (`onRun`). Showing it acknowledges the steps, so the
 * ones a harness update added count from now on (spec §8 Q3).
 */
export function SetupStepsList({ client, steps, onRun }: { client: HarnessClient; steps: SetupStepView[]; onRun: (id: string) => void }) {
  const { t } = useTranslation();
  const [state, setState] = useState<SetupStepsState | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const off = client.setupSteps.onChange((s) => {
      if (live) setState(s);
    });
    client.setupSteps.acknowledge().then(
      (s) => {
        if (live) setState(s);
      },
      () => {},
    );
    return () => {
      live = false;
      off();
    };
  }, [client]);

  const status = (id: string): SetupStepStatus => (state && Object.hasOwn(state.steps, id) ? state.steps[id] : "missing");
  return (
    <section className="hh-setup-list" aria-labelledby="hh-setup-list-title">
      <h3 id="hh-setup-list-title">{t("setupSteps.listTitle")}</h3>
      <ul className="hh-rows">
        {steps.map((s) => {
          const st = status(s.id);
          const labelId = `hh-setup-step-${s.id}`;
          return (
            <li key={s.id} className="hh-row" aria-labelledby={labelId}>
              <span id={labelId} className="hh-row-label">
                {s.label}
              </span>
              <span className="hh-caption">{t(`setupSteps.status.${st}`)}</span>
              {s.kind === "form" ? (
                editing === s.id ? (
                  <SetupStepForm
                    client={client}
                    step={s}
                    submitLabel={t("setupSteps.save")}
                    onDone={(next) => {
                      setState(next);
                      setEditing(null);
                      setSaved(s.id);
                    }}
                  />
                ) : (
                  <button
                    onClick={() => {
                      setSaved(null);
                      setEditing(s.id);
                    }}
                  >
                    {t("setupSteps.edit")}
                  </button>
                )
              ) : (
                <button onClick={() => onRun(s.id)}>{t(st === "done" ? "setupSteps.redo" : "setupSteps.doNow")}</button>
              )}
              {saved === s.id && <span role="status">{t("setupSteps.saved")}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

(`SetupStepStatus` is Task 2's `"done" | "skipped" | "missing"`. A `li` takes its accessible name from `aria-labelledby`, so the test finds a row by the step's label.)

- [ ] **Step 5: The sheet**

In `packages/ui/src/SettingsSheet.tsx`:

1. Import `SetupStepsList` from `./SetupStepsList`.
2. Change `onSetup`'s type (props and `NotConfigured`) to `(step?: string) => void`, with the doc line "Opens the setup flow; at a harness step when one is given (the Setup list's Do it again / Do it now)."
3. In `NotConfigured`, change `onClick={onSetup}` to `onClick={() => onSetup()}` (the click event must not arrive as a step id).
4. The tab filter: change `(id !== "harness" || state.settings !== undefined)` to `(id !== "harness" || state.settings !== undefined || state.setup !== undefined)`, and the comment above it to say the harness's tab shows when the harness declares settings or setup steps (harness-settings D0, setup-steps D0).
5. The tab's label: `{id === "harness" ? (state.settings?.tab ?? t("settings.tabs.setup")) : t(`settings.tabs.${id}`)}`.
6. Replace the harness panel line with:

```tsx
          {tab === "harness" && configured && (
            <>
              {state.settings && <HarnessSettingsTab client={client} view={state.settings} />}
              {state.setup && <SetupStepsList client={client} steps={state.setup} onRun={(id) => onSetup(id)} />}
            </>
          )}
```

`HarnessApp` already opens the setup screen with `{ step, only: true }` when the sheet passes a step (Task 8, Step 6).

- [ ] **Step 6: Run the tests**

Run: `corepack pnpm vitest run packages/ui/test/setup-settings.test.tsx packages/ui/test/settings.test.tsx packages/ui/test/harness-settings.test.tsx`
Expected: PASS (D0: the existing tabs and their tests unchanged).

Run: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm app:build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/ui/src/SetupStepsList.tsx packages/ui/src/SettingsSheet.tsx packages/i18n/src/locales/en.json packages/ui/test/setup-settings.test.tsx
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(ui): Settings lists the setup steps: edit a form, run a step again

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

---

## Phase 4 — Authoring, docs and the whole flow (spec §6, §7 slice 4)

### Task 11: `check` warns about setup steps it can't verify by schema

**Files:**
- Modify: `packages/cli/src/check.ts`
- Test: `packages/cli/test/check.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/cli/test/check.test.ts`, add:

```ts
describe("check: setup steps (setup-steps spec §6)", () => {
  const setupRules = (r: CheckResult) => r.findings.filter((f) => f.rule.startsWith("setup-")).map((f) => `${f.severity}:${f.rule}`);
  const withSetup = (context: string) => (d: string) =>
    replaceIn(
      d,
      "harness.config.ts",
      "  // Free questions",
      [
        `  data: { profile: { scoped: false, single: true, schema: z.object({ name: z.string().min(1).max(40) }), agent: "write"${context} } },`,
        "  setup: [",
        '    { id: "intro", kind: "interview", label: "Get to know you", action: "example", writes: "profile" },',
        '    { id: "ready", kind: "component", label: "Ready check", component: "ReadyStep" },',
        "  ],",
        "  // Free questions",
      ].join("\n"),
    );

  it("D0: the template has no setup findings", async () => {
    expect(setupRules(await checkHarness(await fixture()))).toEqual([]);
  });

  it("warns: a component not registered in ui/, an interview with no recording, a collection the agent can't see", async () => {
    const r = await checkHarness(await fixture(withSetup("")));
    expect(errors(r)).toEqual([]);
    expect(setupRules(r)).toEqual(["warning:setup-component", "warning:setup-mock", "warning:setup-context"]);
    expect(r.findings.find((f) => f.rule === "setup-component")?.message).toContain('"ReadyStep"');
  });

  it("a registered component and a collection with context clear their warnings", async () => {
    const dir = await fixture((d) => {
      withSetup(', context: { fields: "all", tokens: 100 }')(d);
      fs.appendFileSync(path.join(d, "ui", "App.tsx"), "\nexport const setupStepComponents = { ReadyStep: () => null };\n");
    });
    expect(setupRules(await checkHarness(dir))).toEqual(["warning:setup-mock"]);
  });
});
```

(If the appended line breaks the template's typecheck-free `check`, put it in a new `ui/setup-steps.tsx` instead: the scan reads every source file under `ui/`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm vitest run packages/cli/test/check.test.ts`
Expected: FAIL (no `setup-*` findings).

- [ ] **Step 3: The rules**

In `packages/cli/src/check.ts`:

1. Add to `RuleId`, after `"settings-tokens"`:

```ts
  | "setup-component"
  | "setup-mock"
  | "setup-context"
```

2. In `checkHarness`, after `findings.push(...settingsFindings(harness));`, add `findings.push(...(await setupFindings(harness)));`.
3. After `settingsFindings`, add:

```ts
/**
 * Setup steps (setup-steps spec §6): what the manifest's schema can't see. A component step needs the harness's
 * component in ui/; an interview needs a recording for mock mode, and a collection the agent sees when it runs again.
 */
async function setupFindings(h: LoadedHarness): Promise<Finding[]> {
  if (!h.setup) return [];
  const out: Finding[] = [];
  const components = h.setup.flatMap((s) => (s.kind === "component" ? [s] : []));
  if (components.length > 0) {
    let uiDir: string | null = null;
    try {
      uiDir = resolveInHarness(h, h.ui ?? "ui");
    } catch {
      // reported by i18nFindings
    }
    const texts = uiDir ? await Promise.all((await sourceFiles(uiDir)).map((f) => fs.readFile(f, "utf8"))) : [];
    for (const s of components) {
      const key = new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(s.component)}\\s*[:,}]`);
      if (!texts.some((t) => key.test(t))) {
        const message = `Step "${s.id}": no component "${s.component}" in ui/. Pass it to HarnessApp (setupSteps={{ ${s.component} }}); until then the setup screen says the step can't be shown.`;
        out.push(warning("setup-component", message, MANIFEST));
      }
    }
  }
  for (const s of h.setup) {
    if (s.kind !== "interview") continue;
    if (!(await exists(path.join(h.root, MOCK_DIR, `${s.action}.json`)))) {
      out.push(warning("setup-mock", `Step "${s.id}": its action "${s.action}" has no recording (${MOCK_DIR}/${s.action}.json), so mock mode can't play the interview.`, MANIFEST));
    }
    const c = Object.hasOwn(h.data, s.writes) ? h.data[s.writes] : undefined;
    if (c && !c.context) {
      out.push(warning("setup-context", `Step "${s.id}": collection "${s.writes}" has no context, so a second run of the interview can't see what the first one saved. Give it context: { fields: "all", tokens: … }.`, MANIFEST));
    }
  }
  return out;
}
```

The warnings come out in the order of the test: every component first, then each interview's `setup-mock` and `setup-context`.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run packages/cli/test/check.test.ts`
Expected: PASS.

Run: `corepack pnpm typecheck && corepack pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/cli/src/check.ts packages/cli/test/check.test.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "feat(cli): check warns about setup steps: components, recordings, context

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 12: Docs

**Files:**
- Create: `docs/architecture/setup.md`
- Modify: `docs/architecture/manifest.md`, `docs/architecture/data.md`, `docs/architecture/settings.md`, `docs/architecture/mock-mode.md`, `docs/architecture/authoring.md`, `packages/cli/guide/new-harness.md`

- [ ] **Step 1: The architecture page**

Create `docs/architecture/setup.md`:

```md
# Harness setup steps

A harness can add its own steps to the setup screen, after the folder and the engine: a form, a short interview with the AI, or a React component of its own. Each step leaves its result where the app already keeps things (a data record or the settings), so the app reads it like anything else. Spec: `docs/superpowers/specs/2026-10-25-harness-setup-steps-design.md`.

## Declaring them

`setup` in the manifest is a list of 1 to 8 steps, in order. Every step has an `id` (lowercase letters, digits and dashes, unique), a `label`, an optional `description` (one line under the heading) and `required` (default `false`).

- `form`: `collection` + `fields` (a collection that is `single` and not scoped), or `settings` (names of harness settings). The core form draws the fields from their schemas; settings keep their option labels.
- `interview`: `action` (an action off the path, not `deep`) and `writes` (a collection that is `single`, not scoped, and `agent: "write"`). The action runs as a task on the setup screen, in a slim chat.
- `component`: `component`, the name the harness passes to `HarnessApp setupSteps={{ … }}`. It gets `{ client, profile, done, skip }`; `profile` is `null` until profiles exist.

`check` errors are schema errors in the manifest. `check` warns when a component isn't in `ui/` (`setup-component`), an interview's action has no recording (`setup-mock`) and an interview's collection has no `context` (`setup-context`).

## State

`.harness/setup.json` (`{ version: 1, steps: { <id>: { state, at } }, finishedAt?, known? }`) holds each step's state: `done` or `skipped`. A step with no entry is missing. The file is written atomically; a corrupt one is set aside and read as empty.

A form or interview step counts as done only while its result is there: a form over a collection needs the record, an interview needs a valid record. Deleting the record makes the step missing again.

A required step that is missing blocks Start on Home ("One step left: <label>"), unless the step is new to a folder that already finished setup: `known` lists the steps the person has seen ("All set", or the Settings list), and a step a harness update adds doesn't block. A folder that ran tasks before plan 6 (its `tasks.json` exists) counts as finished, with no steps known.

## The screens

- The setup screen goes folder, engine, then each step not done or skipped, then "All set". Opened from Home it starts at the missing step. A skippable step has Skip; a required one doesn't.
- A form's Next saves through the same checks as any write (`hh:data` as the person, app-wide, with a `Data: <collection>` commit; settings through the settings controller).
- An interview's Next closes its task with the usual closing turn, then checks the record. "Incomplete" says so and offers to continue. A task started on the setup screen resumes only while the app stays open: an app start interrupts open tasks.
- Settings shows the steps under the harness's tab (named "Setup" when the harness has no settings): Edit for a form, Do it again or Do it now for the others (the setup screen, that step only).

## What the agent sees

An interview's first message is the action's brief, then a core section: ask one question at a time, save to the collection with the data tools as you go, and say when Next is fine. An interview action is not offered as a topic.

## Known gaps

- Profiles (plan 7): every step is app-wide for now. `SetupStepProps.profile` is `null`.
- `humanharness run` doesn't run setup steps.
- Labels are English only, like every manifest string; the app translates them on demand.
```

- [ ] **Step 2: The other pages**

- `docs/architecture/manifest.md`, under "What each field does", add a line: "`setup` (optional): the harness's own setup steps, a form, an interview or a component; see `setup.md`." Under "Checks", add the three `setup-*` warnings.
- `docs/architecture/data.md`, under "How the agent and the harness UI reach it", add: "A setup step's form writes as the person, app-wide, through `hh:data`; an interview writes through the agent's data tools. Both need a `single`, unscoped collection (`setup.md`)."
- `docs/architecture/settings.md`, under "The window", add: "A `form` setup step can show some settings on the setup screen; it saves them through the same controller. The harness's tab also shows the setup steps list, and is named Setup when a harness has steps but no settings."
- `docs/architecture/mock-mode.md`, under "check rules", add `setup-mock`: "an interview step's action needs a recording, or mock mode can't play the interview."
- `docs/architecture/authoring.md`, after "### Settings", add "### Setup steps": what each kind is for (a form for a few fields, an interview when the answers need a conversation, a component for anything else), the `check` warnings, and that `run` skips them.
- `packages/cli/guide/new-harness.md`: in the phase that writes the manifest, add a question to the person: "Does the app need to know something before the first task? If so, which of: a short form, a short interview, a screen of your own." Then the matching `setup` entry, with a recording for an interview.

- [ ] **Step 3: Check the docs build nothing broke**

Run: `corepack pnpm test`
Expected: PASS (`packages/cli/test` reads the guide; nothing else depends on the docs).

- [ ] **Step 4: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add docs/architecture packages/cli/guide/new-harness.md
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "docs: harness setup steps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

### Task 13: End to end: a tutor's setup, from Home to the first topic

**Files:**
- Create: `packages/fake-agent/fixtures/setup-harness/ui/App.tsx`, `packages/e2e/tests/setup-steps.spec.ts`

- [ ] **Step 1: The fixture's UI**

Create `packages/fake-agent/fixtures/setup-harness/ui/App.tsx`:

```tsx
import { type HarnessClient, type SetupStepProps, HarnessApp } from "@humanharness/ui";

/** The fixture's own setup step: one button that ends it. */
function ReadyStep({ done }: SetupStepProps) {
  return (
    <button type="button" onClick={done}>
      All good
    </button>
  );
}

export default function App({ client }: { client: HarnessClient }) {
  return <HarnessApp client={client} setupSteps={{ ReadyStep }} />;
}
```

(`@humanharness/ui` re-exports every type of `client.ts`, `SetupStepProps` included.)

- [ ] **Step 2: Write the test**

Create `packages/e2e/tests/setup-steps.spec.ts`:

```ts
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ElectronApplication, expect, test } from "@playwright/test";
import { type ClaudeScript, claudeTextLines } from "@humanharness/fake-agent";
import { closeAndClean, launch, makeSandbox, shellDir } from "./helpers";

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/setup-harness");
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
const data = (tool: string, args: Record<string, unknown>) => ({ mcp: { server: "data", tool, args } });
const script: ClaudeScript = {
  steps: [...claudeTextLines("Listo."), result],
  turns: [
    { match: "save_note", steps: [ui("save_note", { title: "About Sofi", summary: ["Wants to pass maths"], decisions: [], files: [], open: [] }), ...claudeTextLines("Guardé."), result] },
    {
      match: "# Task: conocerte",
      steps: [
        ...claudeTextLines("Hola, ¿cómo te llamás y qué querés aprender?"),
        data("data_put", { collection: "profile", record: { name: "Sofi", goal: "Pass maths" } }),
        ...claudeTextLines("Listo, ya podés tocar Next."),
        result,
      ],
    },
    { match: "# Task: practice", steps: [...claudeTextLines("Una pregunta corta."), result] },
  ],
};

test("a harness's setup steps: Home waits for the interview, then forms, a component and All set", async () => {
  test.setTimeout(300_000);
  const s = makeSandbox("setup-steps");
  const outDir = path.join(shellDir, "out", "setup-steps");
  const env: NodeJS.ProcessEnv = { ...process.env, HH_HARNESS_DIR: fixture, HH_OUT_DIR: outDir };
  delete env.ELECTRON_RUN_AS_NODE;
  const harnessDir = path.join(s.folder, ".harness");
  const json = (file: string) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null);
  let app: ElectronApplication | undefined;
  try {
    execFileSync(path.join(shellDir, "node_modules", ".bin", "electron-vite"), ["build"], { cwd: shellDir, env, stdio: "inherit" });
    const launched = await launch(s, { claude: script }, path.join(outDir, "main", "index.js"));
    app = launched.app;
    const page = launched.page;

    // Home: the folder and engine are set, but the required interview isn't done.
    await expect(page.getByText("One step left: Get to know you")).toBeVisible();
    await expect(page.getByRole("button", { name: "Start Tutor" })).toHaveCount(0);
    await page.getByRole("button", { name: "Set up Tutor" }).click();

    // The setup screen opens at the interview, with the harness's steps after the engine.
    await expect(page.getByRole("heading", { name: "Get to know you" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Steps" }).getByRole("listitem")).toHaveText([/AI engine/, /Get to know you/, /How the AI talks/, /Your goal/, /Ready check/]);
    await expect(page.getByText("This conversation uses some of your AI plan.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Skip" })).toHaveCount(0);
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByText("Listo, ya podés tocar Next.")).toBeVisible();
    await expect.poll(() => json(path.join(harnessDir, "data", "_app", "profile.json"))).toMatchObject({ name: "Sofi", goal: "Pass maths" });

    // Next closes the interview's task (its note) and marks the step.
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("heading", { name: "How the AI talks" })).toBeVisible();
    await page.getByRole("button", { name: "Skip" }).click();

    // A form over the record starts from what the interview saved.
    await expect(page.getByRole("heading", { name: "Your goal" })).toBeVisible();
    const goal = page.getByLabel("Goal");
    await expect(goal).toHaveValue("Pass maths");
    await goal.fill("Pass maths in June");
    await page.getByRole("button", { name: "Next" }).click();

    // The harness's own component ends its step.
    await expect(page.getByRole("heading", { name: "Ready check" })).toBeVisible();
    await page.getByRole("button", { name: "All good" }).click();
    await expect(page.getByRole("heading", { name: "All set" })).toBeVisible();
    await expect
      .poll(() => json(path.join(harnessDir, "setup.json"))?.steps)
      .toMatchObject({ conocerte: { state: "done" }, estilo: { state: "skipped" }, goal: { state: "done" }, ready: { state: "done" } });
    expect(json(path.join(harnessDir, "setup.json")).finishedAt).toEqual(expect.any(String));
    expect(json(path.join(harnessDir, "data", "_app", "profile.json"))).toMatchObject({ name: "Sofi", goal: "Pass maths in June" });

    // The work screen: the interview is no topic.
    await page.getByRole("button", { name: "Start Tutor" }).click();
    await expect(page.getByRole("button", { name: /Practice/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Get to know you/ })).toHaveCount(0);

    // Settings › How I learn lists the steps with their statuses.
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("tab", { name: "How I learn" }).click();
    const list = page.getByRole("tabpanel");
    await expect(list.getByRole("listitem", { name: "Get to know you" })).toContainText("Done");
    await expect(list.getByRole("listitem", { name: "How the AI talks" })).toContainText("Skipped. You can do it now.");
  } finally {
    if (app) await closeAndClean(app, s);
    else fs.rmSync(s.root, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
```

The paths of `profile.json` and the `finally` block follow `settings.spec.ts` (the app-wide store is `.harness/data/_app/`; copy the cleanup that spec uses if it differs). The fake turn for `save_note` must come first: the closing turn's message names `save_note`, and the interview's brief doesn't.

- [ ] **Step 3: Run it**

Run: `corepack pnpm app:build && corepack pnpm --filter @humanharness/e2e exec playwright test tests/setup-steps.spec.ts`
Expected: PASS.

D0: run the specs this plan's window changes touch:

Run: `corepack pnpm --filter @humanharness/e2e exec playwright test tests/flow.spec.ts tests/settings.spec.ts tests/modes.spec.ts tests/phases.spec.ts tests/input.spec.ts`
Expected: PASS, unchanged.

- [ ] **Step 4: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add packages/fake-agent/fixtures/setup-harness/ui packages/e2e/tests/setup-steps.spec.ts
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "test(e2e): a tutor's setup steps from Home to the first topic

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7"
```

- [ ] **Step 5: The whole suite**

Run: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm app:build && corepack pnpm e2e`
Expected: PASS. Stop here: the next plan (profiles) starts in its own branch.

---

## Self-review

**Spec coverage**

| Spec section | Task |
| --- | --- |
| §1 Goal, D0 (a harness without `setup` is unchanged) | D0 test in every task |
| §2 Where results live (data or settings, never a new store) | 3, 5 |
| §3 `form` (collection or settings, core form, saved values, option labels) | 1, 3, 6, 8 |
| §3 `interview` (an action, a collection, the slim chat, Next closes the task, incomplete) | 1, 3, 4, 9 |
| §3 `component` (`done`, `skip`, `profile: null`) | 1, 5, 8, 13 |
| §3 `required`, Skip | 1, 3, 8 |
| §4 Home blocks on a required step; the setup screen opens at it; All set | 2, 7, 8 |
| §5 Settings: statuses, Edit, Do it again / Do it now | 10 |
| §6 `check` (schema rules as errors; component, mock, context as warnings) | 1, 11 |
| §7 Slices 1–4 | Phases 1–4 |
| §8 Q1 (cost caption), Q2 (`setup-mock` severity), Q3 (new steps don't block a finished folder) | 9, 11, 2–3 |
| Profiles | Deferred to plan 7 (`baseOf` and `profile: null` are the hooks) |

**Names used across tasks:** `setupStepsSchema`, `HarnessSetupStep`, `SetupFormStep`, `setupFormSpec`, `interviewCollections`, `hasSetup` (Task 1); `setupFile`, `SetupStore`, `SetupStepStatus`, `SetupStepsState`, `SetupStepResult` (Task 2); `SetupSteps`, `SetupStepsDeps` (Task 3); `interviewSection`, `TaskDeps.interviews` (Task 4); `setupStepViews`, `SetupStepView`, `SetupStepProps`, `ActionOption.setup`, `AppState.setup`, `client.setupSteps`, the `hh:setupStep*` channels (Task 5); `draftOf`, `optionLabel`, `InputForm` `initial` / `formId` (Task 6); `Home` `steps` / `onSetup(step?)` (Task 7); `SetupFlowProps` `startAt` / `only` / `components`, `SetupStepForm`, `HarnessApp` `setupSteps` (Task 8); `ChatView` `slim`, `SetupInterviewStep`, `SetupFlowProps` `blocks` / `stateBlocks` (Task 9); `SetupStepsList` (Task 10); `setup-component`, `setup-mock`, `setup-context` (Task 11).

**Placeholders:** none. Where a step depends on a name the code may have changed since this plan was written (a fake client field, a test helper), it says which file holds the right name.
