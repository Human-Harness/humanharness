# Harness settings

A harness declares the knobs that change how the AI works for this person (a tone, a hint threshold, how much to explain) in its manifest's `settings`. The core draws them in a Settings tab of the harness's own, stores the person's choices in the data store, and tells the agent through plain sentences in `AGENTS.md`. Spec: `docs/superpowers/specs/2026-10-25-harness-settings-design.md`.

## The declaration

`settings: { tab, sections?, fields }` (`packages/harness-sdk/src/settings.ts`). Every text is one English string. `sections` is a list of `{ id, label }`; fields with no `section` are drawn first, outside any section. Each field has:

- `schema` (zod) and `default`, which must match it. The default goes in `default`, never on the schema: a schema that takes `undefined` (`.default()`, `.optional()`) is refused;
- `control`: `segmented` or `select` (a `z.enum`), `toggle` (`z.boolean`), `number` (`z.number`, its bounds become the input's) or `text` (`z.string`, its max length too);
- `label`, and optionally `help`, `unit`, `section` (a declared section id) and `advanced` (under "More options");
- `options`: labels of the enum's values (a toggle may label `"true"` and `"false"`). A value with no label shows as itself;
- `agent`: the sentence for the agent. `{ text, onlyWhenChanged: true }` leaves it out while the value is the default. Absent or `false`: the field is UI-only, and the agent never sees it.

Field names are camelCase (`hintAfter`). `modes` is reserved: the record keeps mode settings under it (see "Mode settings").

### Agent sentences

A template has two placeholders:

- `{{value}}`: the value itself; a boolean reads `on` or `off`.
- `{{value:label}}`: the value's label from `options`, inserted as written, so `"Use a {{value:label}} tone."` with the label `Patient` gives "Use a Patient tone.". Write the template with `{{value}}` when the sentence needs the lowercase value. Only on `segmented`, `select` and `toggle`.

Spaces are allowed around the placeholder's content (`{{ value:label }}`), not around the colon. A filled sentence has its whitespace folded to single spaces: one sentence is one line of `AGENTS.md`.

### Checks

The structural rules are manifest schema errors: `defineHarness` and `loadHarness` refuse them, and `check` lists them as `schema`. They cover:

- at least one field, of the harness's own or of a mode's (the manifest checks it, since `settings.fields` may be empty when a mode has settings);
- a missing default or one that fails its schema, and a schema that takes `undefined`;
- a control whose type doesn't fit;
- `options` on a control without labels (only `segmented`, `select` and `toggle` have them), and an `options` key that isn't a value;
- a `section` that isn't declared, and section ids that aren't unique;
- a placeholder other than the two, and `{{value:label}}` on a control without labels;
- a `text` field whose sentence uses `{{value}}` or `{{value:label}}` with no `.max(n)` on its schema (any length would reach `AGENTS.md`);
- the reserved name.

## Where values live

- The reserved `settings` collection (`settingsCollection`; `dataCollections` adds it to the store, and it is never in `harness.data`). It is app-wide, one record, and `agent: "none"`: the agent reads sentences, never the JSON, and a harness with settings but no data gets no `data` MCP server.
- The record holds only what the person changed. A change back to the default removes the key, and an empty record removes the file (`.harness/data/_app/settings.json`). `settingsValues` fills the defaults on read, so a harness update that changes a default reaches everyone who never touched it.
- The record is read field by field (`validFields` in `packages/workspace/src/data.ts`): a stored value its field no longer takes (a hand edit, or a harness update that narrowed the field) is dropped and its default applies; the other fields keep their values, and later changes still save. Mode settings under `modes.<mode>` are read the same way, one level deeper. Only a file that isn't a JSON object is `broken-file`, which reads as the defaults and refuses writes until it is fixed or restored.
- `SettingsController` writes the person's changes through the person's data handler (`personDataRequests`, the one behind `hh:data`): the store's checks, a refusal while turns are blocked (a restore, a folder move, an engine change), and a `Data: settings` history commit tagged with the open task. Undoing a task therefore also undoes settings changed during it, so `dataDiff` lists such a change in that task's diff, under collection `settings`, scope `_app`.

## The window

- The tab comes right after General and is labelled with `settings.tab`; a harness without `settings` has no such tab. Before the app is set up it shows the "set up first" card, like Engine, Models and Usage.
- Segmented, select and switch save on change; number and text inputs save on blur or Enter. A value the store refuses shows its message under the field.
- "More options" holds the `advanced` fields. "Back to the app's defaults" deletes the stored record, resetting every field of the tab; it shows only when some value differs from its default.
- `SettingsController` (`packages/shell/src/main/settings.ts`) answers the window over IPC: `hh:settingsGet` (values and pending fields), `hh:settingsSet`, `hh:settingsReset`, and the push event `hh:settings` on every change. Results travel as data (`SettingsResult`), never as thrown errors.
- A harness's own screens use `HarnessClient.settings` (`get`, `set`, `reset`, `onChange`). `get()` gives every field's value, defaults included. `client.data` can read `settings` (it holds only the changed fields) but not write it: `hh:data` refuses a put, patch or delete on `settings` with "Settings change through client.settings" (`harnessUiDataRequests`), so every change keeps the controller's rules.

## How values reach the agent

- `managedSection` writes `### How to work with this person`, one `- <sentence>` per field in manifest order, after the core rules and before the interface tools. No sentences, no heading.
- The runtime asks for the sentences when it starts (`RuntimeOptions.instructionSettings`). `HarnessRuntime.refreshInstructions()` rewrites `AGENTS.md` later, only when its text changed, through a temp file under `.harness/` and a rename, so no session or commit reads half a file.
- **Never mid-session (D4).** `SettingsController` marks the settings stale on any write to the collection, from any writer, and after a restore (`hh:restore`, `hh:restoreTask`). It then asks `TaskManager.whenNoTask` to rewrite: after the running operation, only when no task is open. `TaskManager` calls `betweenTasks` after a task ends and before a new task's first turn, which applies whatever is still stale. Both run on the task manager's queue, which also creates runtimes, so a rewrite never races a new runtime's first write.
- While a task is open, the tab says "Changes apply from the next task." and marks as "Pending" every agent field whose value differs from what the current `AGENTS.md` holds. UI-only fields are never pending: the harness's screens read them at once.

## Mode settings

Task modes (`docs/architecture/modes.md`, spec §6) may declare their own `settings`: the same field shape and checks (`checkSettingFields`), except that `section` is refused, since they are grouped by their mode.

- A mode with settings needs the manifest's `settings`: its tab draws them. `settingsView` appends one section per mode with settings, id `mode:<id>`, labelled with the mode's label; a field's own `advanced` puts it under "More options", still grouped by mode.
- Their key is `<mode>.<field>` (`modeSettingKey`; field names and mode ids never contain a dot) in `SettingsState.values`, `client.settings.set` and the tab's field names (`SettingFieldView.name`, with `mode`). `settingRef` finds a field by either kind of key.
- They are stored under `modes.<mode>` of the same record, only what the person changed (`withSetting` prunes an empty mode and an empty `modes`), and go through the same controller, history commit and undo.
- They never reach `AGENTS.md`. `modeSentences` fills them (`onlyWhenChanged` included) into the mode's brief when a task starts in that mode, at a switch to it and in a resumed session, so a change is never "Pending": it applies the next time that mode starts or is switched to.
- `settings-tokens` doesn't count them: they are not in the stable prefix.

## Measuring

The section is in every session's stable prefix. `check` warns (`settings-tokens`) when the section, with every sentence at the defaults (`onlyWhenChanged` ones included), is over `SETTINGS_TOKENS_WARN` (400) tokens.

## Trying values

`humanharness run <action> --set tone=demanding --set hintAfter=4` (repeatable) stores values in the run folder before the task, as the window would, and prints `Settings: tone=demanding, hintAfter=4`. Each value is checked as the typed text first, then as JSON (`4`, `true`). An unknown name, a value its schema refuses, or `--set` on a harness without settings stops the run (exit 2) before the engine or the folder.

## Known gaps

- `run --set` covers the harness's own fields only: mode settings use the run folder's stored values or their defaults.
- While a task is open the tab says "Changes apply from the next task." for mode settings too, which apply at that mode's next start or switch.
- There is no multi-select control, so no setting (of the harness or of a mode) can be a list.
- There is no file watcher: a hand edit of `settings.json` reaches `AGENTS.md` at the next runtime start or the next settings change.
- A task that goes on in a new session reads the settings as they are then. That happens after "Move folder", which keeps the open task (`resumeFromNotes`): the new folder's runtime writes `AGENTS.md` with the current settings. A restart never carries a task over: at startup the app ends a task left open (`TaskManager.interrupt`), and so does choosing another folder.
- Recordings for mock mode don't vary by settings.
