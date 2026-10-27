# Harness setup steps

A harness can add its own steps to the setup screen, after the folder and the engine: a form, a short interview with the AI, or a React component of its own. Each step leaves its result where the app already keeps things (a data record or the settings), so the app reads it like anything else. Spec: `docs/superpowers/specs/2026-10-25-harness-setup-steps-design.md`. A harness without `setup` works exactly as before: no `.harness/setup.json`, no interview section, the same screens.

## Declaring them

`setup` in the manifest is a list of 1 to 8 steps, in order (`packages/harness-sdk/src/setup.ts`). Every step has an `id` (lowercase letters, digits and dashes, unique), a `label`, an optional `description` (one line under the heading) and `required` (default `false`).

- `form`: `collection` + `fields` (a collection that is `single` and not scoped; every field one the core form can draw), or `settings` (names of harness settings; the harness needs `settings`). Not both. The core form draws the fields from their schemas; settings keep their option labels.
- `interview`: `action` and `writes`. The action is not in `path`, not at tier `deep`, runs app-wide (`scope: "none"` when the harness has scopes) and backs one interview only. `writes` is a collection that is `single`, not scoped, and `agent: "write"`. The action runs as a task on the setup screen, in a slim chat.
- `component`: `component`, the name the harness passes to `HarnessApp setupSteps={{ … }}`, and an optional `writes` (a declared collection, for the reader). It gets `{ client, profile, done, skip }`; `profile` is the active profile (`ProfileView`) in a harness with profiles, `null` without them.

These rules are schema errors in the manifest. `check` adds three warnings (`packages/cli/src/check.ts`):

- `setup-component`: a component step whose name doesn't appear in `ui/`. Until it is passed, the setup screen says the step can't be shown. A skippable step still offers Skip; a required one is a dead end (only Back or Cancel), and Home keeps waiting for it.
- `setup-mock`: an interview's action has no recording (`mock/<action>.json`). It warns only when `mock/` already holds at least one recording: a harness that doesn't use mock mode gets no warning.
- `setup-context`: an interview's collection has no `context`, so running the interview again can't see what the first run saved.

## State

`.harness/setup.json` (`{ version: 1, steps: { <id>: { state, at } }, finishedAt?, known? }`, `packages/shell/src/main/setup-store.ts`) holds each step's state: `done` or `skipped`. A step with no entry is missing. In a harness with profiles the file is the active profile's (`<folder>/<profile>/.harness/setup.json`): each person goes through the steps once, and a new profile's steps start missing. The file is written atomically (temp file and rename) and is untracked, like `tasks.json`.

- The first read in a folder saves the file. The main process reads it as soon as the config is valid (the save that completes it, a folder change, the app's start), before any task can start (`recordSetup`), and the setup screen reads the steps again after the engine is saved. A fresh folder gets an empty one at once, so its first task (often the interview's, which writes `tasks.json`) doesn't later make it look like an older folder. A folder that ran tasks before plan 6 (its `tasks.json` exists, no `setup.json`) is saved as finished, with no steps known.
- A file that isn't JSON is set aside as `setup.json.corrupt-<time>` and read as none. A file with the wrong shape reads as empty.
- A file that is there but can't be read (a permission or disk error, a failed set-aside) is never written over: reads show it as empty, and every write (submit, complete, skip, finish) is refused with `not-ready`. `not-ready` also covers an app that isn't set up or is closing, and a save that failed.
- Reads and writes in the main process (`SetupSteps` in `packages/shell/src/main/setup-steps.ts`) run one at a time.

A step's state is only what `setup.json` says. A form is marked done once its fields are saved, and an interview once its task is closed and its collection has a record. Deleting that record later doesn't make the step missing again: Settings offers to do it again.

A required step that is missing blocks Start on Home ("One step left: <label>"), unless the step is new to a folder that already finished setup: `known` lists the steps the person has seen ("All set", or the Settings list), and a step a harness update adds doesn't block. When the window can't read the steps' state, nothing blocks: a failed read never locks the person out (the main process fails open the same way).

## The screens

- The setup screen goes folder, engine, then each step not done or skipped, then "All set". In a harness with profiles a core step comes after the engine, "Who's using it" (below). Opened from Home ("Set up" with a missing step), it starts at that step: earlier missing steps are left out of that run. A skippable step has Skip; a required one doesn't.
- A form's Next saves through the same checks as any write (`hh:data` as the person, app-wide, with a `Data: <collection>` commit; settings through the settings controller, one field at a time, so a failure can leave the earlier fields saved). A form over a collection may ask for only some of its fields; the record's other fields stay, and a field the form asks for but sends no value for (an optional field cleared) is cleared. When the merged record fails the schema, nothing is saved and Next says so.
- An interview's body shows its cost when the action isn't `light`, then a slim chat: no side panel, no topics, no composer until the interview's task runs. Start (or "Continue the interview" when the action has run before) starts a new task of the action. The slim chat shows only that task: another open task is not shown, and a choice or input that would start another action is refused.
- An interview's Next waits while a turn runs, then closes the task with the usual closing turn and checks the record. "Incomplete" says the app doesn't have what it needs yet and offers to continue, which starts a new task (the interview section is only in a task's first message). A task started on the setup screen resumes only while the app stays open: an app start interrupts open tasks.
- A component step draws the harness's component; it calls `done()` or `skip()`.
- Profiles (`docs/architecture/profiles.md`): the "Who's using it" step ("Who's using <name>?") shows when no profile is active, and whenever the person presses "Add <label>" (the switcher), which opens the setup screen at that step (the folder and engine steps are done; Cancel goes back). It draws the `profiles.fields` form; Next creates the profile and makes it active, and the steps after it are that profile's own (its `setup.json`), then "All set". The privacy note shows on it while the second profile is created. Once a profile is active the title is "Set up <name> for <profile>". Home with no active profile says "One step left: add a <label>", and "Set up" opens this step.
- Settings shows the steps first on the harness's tab, under "Setup", with their state (Done, Skipped, Not done yet). The tab is named "Setup" when the harness has no settings. Edit opens a form step's fields in place; Do it again (or Do it now, for a step not done) opens the setup screen at that step alone, and its end (or Cancel) reopens Settings on the tab it came from. Showing the list acknowledges the steps (adds them to `known`).

## What the agent sees

An interview's first message is the action's brief, then a core section (`interviewSection` in `packages/shell/src/main/task-prompts.ts`): ask one question at a time, save to the collection with the data tools as you go, and say when Next is fine. An interview action is not offered as a topic on Start.

`humanharness run <action>` wires the same section (`packages/cli/src/run.ts`), so a run of an interview's action in the terminal sees what the app's task sees.

## Tests

- `packages/harness-sdk/test/setup.test.ts`: the schema and its rules. `packages/cli/test/check.test.ts`: the `setup-*` warnings. `packages/cli/test/run.test.ts`: the interview section in a terminal run.
- `packages/shell/test/setup-store.test.ts`, `setup-steps.test.ts` and `task-manager-setup.test.ts`: the file, the controller and the interview section.
- `packages/ui/test/setup-home.test.tsx`, `setup-flow.test.tsx`, `setup-interview.test.tsx` and `setup-settings.test.tsx`: Home, the setup screen, the slim chat and the Settings list.
- `packages/fake-agent/fixtures/setup-harness` (id `tutor`) has a step of each kind.

## Known gaps

- `humanharness run` doesn't run the setup screen. An interview's action runs like any action, with the same interview section as in the app.
- Labels are English only, like every manifest string; the app translates them on demand.
