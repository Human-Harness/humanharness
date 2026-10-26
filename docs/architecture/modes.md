# Task modes

A mode is a way the AI works inside a task (Socratic, Feynman, worked examples; for a dev harness: plan, implement, review). The manifest declares the modes and which actions accept them; the agent recommends one, the person picks, and the app switches in the same engine session, so the conversation and its cache stay. Spec: `docs/superpowers/specs/2026-10-25-task-modes-design.md`.

A harness that declares no `modes` works exactly as before (D0): the same `tasks.json`, `AGENTS.md`, MCP tools, prompts, chat log, usage lines, notes, window and `run` output.

## The declaration

- `modes` in the manifest, by id. Ids follow the action id pattern (`MODE_ID`, never a dot); `recommend` and `ask` are taken. Each mode has:
  - `label` (≤ 80 characters) and optional `description` (≤ 300, shown in the window's list of modes);
  - `brief`: a file in the harness folder (`agent/modes/<id>.md` by convention), resolved with `resolveInHarness` when the harness loads. It is filled with `{{language}}`; `{{notesIndex}}` is left empty, since the session already has the index;
  - optional `minTier` (`light`, `standard`, `deep`): the minimum tier the mode works well at;
  - optional `recommend` (≤ 400): a hint only the agent reads, to recommend the mode;
  - optional `settings`: fields as in `settings.md`, without `section` (see "Mode settings").
- An action lists its `modes` (declared ids, once each) and may set `defaultMode`: one of them, `"recommend"` (the default when absent) or `"ask"`. `defaultMode` needs `modes`. An action without `modes` works as before.
- A mode no action lists is allowed: a harness may keep one for later.
- Every rule above is a manifest schema error (`defineHarness` and `loadHarness` refuse it; `check` lists it as `schema`). `check` adds `brief-missing` for a mode brief that is missing, unreadable or empty.
- Every text is one English string; labels and hints are put on one line before they reach a prompt.

`packages/harness-sdk/src/modes.ts` has `MODE_ID`, `DEFAULT_MODE_WORDS`, `hasModes` and `defaultModeOf`; `tierBelow` is in `index.ts`.

## How a task starts

| How it starts | First message |
|---|---|
| A mode id (`defaultMode`, a mode the window sends, `run --mode`) | The action's brief, then `## Mode: <label>`, "Work in this mode.", the mode's brief and its settings' sentences (`modeSection`). The task records `mode` and `modes: [<id>]`. |
| `"recommend"` | The action's brief, then `## How to work`: call `show_recommend_mode` before the work, wait for the pick, no `show_choices` in that answer, and the action's modes as `` - `id` (Label): hint `` (`recommendSection`). That message only. The task has no mode until the person picks one. |
| `"ask"` | The window shows "How do you want to work?" with the action's modes before anything is sent (no model call), then starts in the one picked (`SendOptions.mode`). "Not now" sends nothing. |

- An explicit mode wins over `defaultMode`. One the action doesn't list is refused ("Unknown mode") before the open task closes, and so is a start whose mode brief can't be read. A resumed session whose mode brief can't be read resumes without the mode's section (logged).
- `"ask"` can only ask in a start the window makes itself through `client.send` with an action (a topic picked in the window, or "Try again" after one). A `choices` option with `action`, the path's `next: true` or `run` without `--mode` can't ask, so it starts as `"recommend"`.
- A task that starts in a mode whose `minTier` is above the task's tier starts anyway, at its own tier, and records `belowMinTier`. The tier question only comes with a switch (spec §5.3), so `run --tier standard --mode worked` (worked at `deep`) runs at standard.

## Recommending

`recommend_mode` is a core block (`MODE_CORE_BLOCKS` in `core-blocks.ts`), visible, tool `show_recommend_mode`. `allBlocks` offers it only to a harness with modes, so only those get the tool in the `ui` server and in `AGENTS.md`; its name and tool are reserved for every harness.

- Arguments: `{ recommended, reasons (1–3, ≤ 300 each), alternatives? (≤ 2, { mode, why ≤ 300 }) }`. The schema checks only the id pattern.
- The window draws it like `choices` (`RecommendModeBlock.tsx`): "How do we work?", the recommended mode with a "Recommended" badge and its reasons, the alternatives with their `why`, then "See all modes" (the action's modes with their descriptions). Ids the action doesn't list are dropped, and a block whose `recommended` isn't listed draws nothing. A block of an earlier task, or once the conversation moved on, is drawn disabled.
- The agent may also call it mid-task to suggest a switch. Nothing switches until the person picks.

## Switching

The person picks a mode in the block, in the mode bar's "Change mode", or the harness's own UI calls `client.chooseMode(mode, choice?)`. `hh:chooseMode` → `TaskManager.chooseMode` (`mode-ipc.ts`). Like `respond`, it gives `accepted` (a `ModeResult`, as data) before any turn's events, and `done` once the turn ended.

- It waits until no operation or turn runs, then switches; it never cancels a turn. Two picks made during one turn run one after the other.
- Refusals (`ok: false`): `no-task` (no task, or it isn't waiting), `unknown` (the action doesn't list the mode), `tier` (with `required` and `current`, see below). The current mode answers `{ ok: true, switched: "same" }` and nothing runs. Errors that aren't refusals (the app is closing, turns are blocked, an unreadable brief) reject `accepted` with their message.
- `switched: "turn"`: one run turn of the same session (not quiet), after a due checkpoint as for any follow-up. Its message is `modePrompt`: `MODE_PROMPT` ('From now on work in the mode "<label>". Keep everything decided so far in this conversation.'), then, when the task has a checkpoint note, "What is clear so far (the last checkpoint): …" (its summary, at most 5 points of 400 characters, each on one line, joined with "; "), the mode's brief, its settings' sentences and "Then continue with the person in this mode." The agent's answer shows in the chat.
- The chat's user entry for that turn is a system line, "Switched to <label>" (`TurnOptions.modeSwitch` with `display`; the entry has `mode`), never the mode's prompt.
- The task's `mode`, `modes` (appended once, in first-use order) and `belowMinTier` are written only when that turn ends well, so a failed switch can be picked again ("Try again" picks the same mode). A Stop ends it like any stopped operation; a cancelled switch turn ends the task, as a cancelled follow-up does.
- `switched: "quiet"`: the task's session was lost (after "Move folder"). No turn runs; the mode is set and the resumed session's first message carries it.
- The window learns of every switch through `client.onModeSwitch`, whoever started it (its own mode bar and blocks, or the harness's UI), and draws the system line and the turn then. A switch made some other way shows only the saved line after a reload.

## The tier floor

A task's tier is `nearestTier(profile)` (`models.ts`): its own tier, or for a custom profile the highest tier whose model it runs on this engine, else by its effort (low → light, medium → standard, higher → deep). When it can't be told, nothing is below.

A switch to a mode whose `minTier` is above it is refused with `tier` until the person answers the question ("<mode> asks for more power", an `alertdialog`), sent again as `choice.belowTier`:

- "Continue with the current model" (`continue`): the switch turn runs and the task records `belowMinTier: true`. A later switch to a mode that fits clears it.
- "Start a new task with <mode>" (`new-task`, `switched: "new-task"`): the task closes with its normal closing turn (which saves the note the new task starts from; the spec's separate checkpoint would only repeat it), and a new task of the same action, in the same scope, starts in that mode with `resolveProfile`'s `floor` set to the mode's `minTier`. The floor raises a lower tier and never lowers a higher one; a custom profile stays as the person set it and, when it still counts below, the new task records `belowMinTier`. The new task opens under its action's label, with no "Switched to" line.
- "Not now" (Escape): nothing is sent.

The window has `CurrentTaskView.tier` (only for a task whose action has modes) to ask before calling; the main process checks again and refuses with `tier` when the window was stale.

## Mode settings

Harness-settings spec §6. A mode's `settings` use the same field shape and checks as the harness's (`checkSettingFields`), without `section`.

- They are drawn in the harness's Settings tab, so a mode with settings needs the manifest's `settings` (for the tab's name); `settings.fields` may then be empty.
- Key: `<mode>.<field>` (`modeSettingKey`) in `SettingsState.values`, `client.settings.set` and the tab's field names.
- Storage: under `modes.<mode>` of the same `settings` record, only what the person changed; empty objects are pruned. The record is read field by field one level deeper too (`validFields`), so one bad stored value drops only itself.
- The tab draws one section per mode with settings, id `mode:<id>`, labelled with the mode's label; a field's own `advanced` puts it under "More options".
- They reach the agent only in the mode's brief: at the start in that mode, at a switch to it, and in a resumed session (`modeSentences`, `onlyWhenChanged` included). Never in `AGENTS.md`, so they are never marked "Pending"; a change applies the next time the mode starts or is switched to.

## Where it shows

- `tasks.json`: `current.mode`, `current.modes`, `current.belowMinTier` (`task-store.ts`). `TaskStore` takes the manifest's mode ids (`new TaskStore(folder, { modes })`): a mode the manifest no longer declares is dropped when the file is read, and `belowMinTier` goes with a dropped `mode`.
- `usage.jsonl`: `mode` on every line of a task in a mode, its closing and checkpoint turns and compactions included.
- The closing turn: `closePrompt` adds "Also list the modes used (<labels>) and what each was good for, as summary points." The `save_note` schema is unchanged (it is a core tool of every harness); the app writes the ids into the note's front matter, `modes: ["socratic","feynman"]`.
- A resumed session's first message: the action's brief, then the current mode's section.
- The window: a mode bar between the top bar and the chat (`ModeBar` in `ModeList.tsx`): "Mode: <label>" or "No mode chosen yet", "Change mode" (usable while the task waits), and "Running below the level this mode asks for".
- `AppState.modes` gives the window each mode's `label`, `description` and `minTier`, never its brief or hint; `ActionOption` carries the action's `modes` and `defaultMode`.

## Trying it

- `humanharness run <action> --mode <id>` starts in that mode. An id that isn't a mode id, or one the action doesn't list, exits with 2 before the engine or the folder.
- At the prompt, for an action with modes, `m <id>` switches (the prompt line mentions it only then); `m` followed by anything but one mode id is a follow-up. A refused pick, or the current mode, keeps the choices on screen. A run can't change its tier mid-task: a mode that asks for more prints "<label> asks for the <tier> tier; this run is at <tier>. Switching anyway; rerun with --tier <tier> --mode <id> for it." and switches with `continue`. A refusal prints "Not switched (<reason>)" with the action's modes; the current mode prints "Already in <label>".
- The terminal draws `recommend_mode` as "Recommended mode: <id>", its reasons, the alternatives ("Or:") and "Type m <mode> to pick one.", dropping ids the action doesn't list.
- `packages/fake-agent/fixtures/modes-harness` (id `coach`) is the fixture for these tests.

## Known gaps

- Phases (spec §7) wait for task phases: no mode is refused by phase yet.
- Settings › Usage doesn't break costs down by mode; `usage.jsonl` has the field for it.
- `belowMinTier` is set only at a start and at a switch: a later model fallback to a lower tier doesn't update it.
- There is no multi-select settings control, so a mode setting can't be a list (the spec's `z.array(z.enum(...))` example).
- `run --set` covers the harness's own settings only: mode settings use the run folder's stored values or their defaults.
- Under `run --record`, `m <id>` is recorded like a typed follow-up (`*`), even when nothing switched; replay can't tell a switch from any other reply.
- While a task is open, the Settings tab says "Changes apply from the next task." for mode settings too, which apply at the mode's next start or switch.
- After "Start a new task" with a Stop during the closing turn, the window may already show the new task while the old one is still open; the next refresh of the task view corrects it.
- The tier and "ask" dialogs are not modal and trap no focus, like the pre-flight one.

## Where to look

- `packages/harness-sdk/src/modes.ts`, `index.ts` (schema, checks, `tierBelow`), `core-blocks.ts` (`recommend_mode`), `settings.ts` (mode settings).
- `packages/shell/src/main/task-manager.ts` (`startNow`, `chooseMode`, `modeNow`), `task-prompts.ts`, `task-store.ts`, `models.ts` (`nearestTier`, the floor), `mode-ipc.ts`.
- `packages/ui/src/RecommendModeBlock.tsx`, `ModeList.tsx`, `modes.ts`, `ChatView.tsx`.
- `packages/cli/src/run.ts`, `terminal.ts`, `check.ts`.
