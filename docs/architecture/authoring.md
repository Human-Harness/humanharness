# Authoring a harness

A harness lives in its own repository and depends on `@humanharness/cli` only: until the core is published (plan 4b) that dependency is `link:<core>/packages/cli`. The CLI, `humanharness`, is in `packages/cli`.

## Commands

| Command | What it does |
|---|---|
| `init <dir> [--core <path>] [--id <id>] [--skip-install]` | The core checkout must have run `corepack pnpm install` first. Copies `packages/cli/template/` (the id replaces `example-harness`), writes `package.json` with the `link:` dependency and the `check`, `run` and `dev` scripts, appends the first entry of `HARNESS.md`'s decision log, installs the guide, then runs `corepack pnpm install` and `git init` (`--skip-install` links the CLI directly instead; tests use it). |
| `check [--json]` | Loads the manifest with the SDK and reads `HARNESS.md` (`packages/cli/src/check.ts`). Errors exit with 1. |
| `run <action> … [--mode <id>] [--time <minutes>] [--record [--force]]` | One task against a real engine, with the app's own `TaskManager` and `TurnController` (`packages/cli/src/run.ts`), the terminal as the window, and a usage report at the end. `--record` saves the run as `mock/<action>.json` (`--force` overwrites it). |
| `dev [--engine <id>] [--mock [--keep]] [--build <dir>]` | `check`, then the shell's `electron-vite dev` with `HH_HARNESS_DIR` (and `HH_DEV_ENGINE`; `--build` builds into `<dir>` through `HH_OUT_DIR`). When electron-vite can't start, it prints why and exits with 1. `--mock` opens the app with a fake engine replaying `mock/` (see `mock-mode.md`); `--keep` reuses the previous mock session's folders. |

`check`, `run` and `dev` work on the current folder, or on `--harness <dir>`. From the core repository: `corepack pnpm humanharness run manifest --harness harnesses/demo`.

## The template and what a harness imports

The template (`packages/cli/template/`) runs as is: one action (`example`, standard tier, light cost), one custom block (`example_card`), `ui/App.tsx`, strings in `locales/en.json`, and a `HARNESS.md` that already describes it, so `check` reports nothing. A harness imports `@humanharness/cli/sdk` (the SDK, `z` included: one zod for the manifest and the SDK) and `@humanharness/cli/ui` (the UI kit and `useTranslation`). The shell's renderer build dedupes React and i18n and may serve a harness folder outside the repository (`packages/shell/electron.vite.config.ts`).

## The guide

`packages/cli/guide/new-harness.md` is one engine-agnostic playbook: eight phases (task, decisions, flow, context, models, permissions and engines, identity, verify), one question at a time, each phase ending with its `HARNESS.md` section and the code updated together. `init` installs it unchanged as `.claude/skills/new-harness/SKILL.md` (Claude Code) and between markers in `AGENTS.md` (Codex) (`packages/cli/src/guide.ts`).

## HARNESS.md and check

`HARNESS.md` is the harness's living decision log: Task, Decisions, Flow, Context, Models, Permissions and engines, Identity, Open questions, Decision log. `check` reads two things from it (`packages/cli/src/harness-md.ts`): the Flow table (`| Action | Tier | Cost | Purpose |`, one row per action plus `(questions)`) and the permission lines (`- edit: none — reason`, `exec`, `web`, `engines: claude, codex`).

- Errors: `schema` (each zod issue), `i18n` (`locales/en.json`: missing, invalid JSON or not an object; other locale files are a warning; every `t("key")` in `ui/` must exist in it), `brief-missing` (an action's brief, or a mode's that is missing, unreadable or empty, right after the actions'; then a phase's brief that is missing or empty, named by action and phase; a phase without a brief is fine, it only changes the state), `brand` (`brandNames()` in `packages/engines`), `engine-not-allowed` (excluded, unknown, or pending outside development), `harness-md-missing`, `harness-md-mismatch`, and for `mock/*.json` recordings `mock-schema`, `mock-action`, `mock-match`, `mock-next`, `mock-choice`, `mock-input`.
- Warnings:
  - one per pillar plus resources: `pillar-decisions`, `pillar-flow`, `pillar-context`, `tier-cost`, `permissions-wide`, `open-questions`;
  - for input blocks: `input-hidden` (an input block that isn't visible), `input-form` (a field the core form can't draw, with no component in `ui/`) and `input-choice`. `input-choice` is a choice whose options can't come from the shown data (`inputUi.<field>.optionsFrom` names no list of strings or string enums, or `kind: "choice"` has no options, and the form draws it as text), or `inputUi.<field>.kind` on a field that isn't a string, where it is ignored;
  - for settings: `settings-tokens` (the settings' sentences, at their defaults, would take more than 400 tokens of `AGENTS.md`);
  - for setup steps: `setup-component` (a component step not found in `ui/`), `setup-mock` (an interview's action without a recording, once `mock/` has any) and `setup-context` (an interview's collection without `context`).

## run

Before anything else, `run` checks the engine as the app does before a first turn (`readyEngine`): its legal notice must already be accepted in `~/.humanharness/engines.json`, the file every Human Harness app on the computer shares. `run` never shows or accepts the notice itself; when it is missing, it stops (before running the engine's CLI) and asks the developer to accept it once in the app (`humanharness dev`). Then the engine's official CLI must be installed, current and signed in, or `run` stops with the app's own message. Only then does it make the work folder (a new `hh-run-<id>-*` folder under the OS temp dir unless `--folder` is given) and print it.

At the prompt, a number picks a choice, `a` answers the pending input block (one prompt per field: a choice by number, `pairs` until an empty line, "Skip?" first for a skippable block; a refused answer prints its errors and the prompt comes back), `m <id>` switches modes and `>phase <id>` moves to another part (see below), any other line is a follow-up and `q` closes the task (the closing turn, which asks for the note). Ctrl-C:

- during a turn cancels it, as the app's Stop does (a cancelled first, follow-up or closing turn ends the task without a note);
- while an answer's fields are asked drops that answer ("Answer dropped."); the question stays open and `a` asks it again;
- at the prompt closes the task like `q`;
- at the prompt after a close that was stopped before its turn began leaves without closing (the next `run` in that folder ends the task as unfinished).

Every way out closes the engine's runtime and prints the report; the Ctrl-C listener is removed at the end.

When the task closes, `run` prints the note's path if the closing turn wrote it. A checkpoint writes the same file, so `run` counts writes rather than comparing paths: when only the checkpoint wrote a note, it says that the checkpoint's note stands; when neither did, "No note was saved."

### Modes

`--mode <id>` starts the task in that mode, its brief after the action's; an id that isn't a mode id, or one the action doesn't list, stops the run with exit 2 before the engine or the folder. Without it the task starts as the action's `defaultMode` says, and `"ask"` starts as `"recommend"`, since the terminal can't ask first.

For an action with modes, the prompt line adds `m <mode> to switch mode`, and `m` followed by one mode id is a mode pick (`chooseMode`); any other line, `m tell me more` included, is a follow-up. A refused pick, or the current mode, keeps the choices on screen. A run keeps its tier to the end: a mode that asks for a higher one prints "<label> asks for the <tier> tier; this run is at <tier>. Switching anyway; rerun with --tier <tier> --mode <id> for it." and switches below it. A refusal prints "Not switched (<reason>)" with the action's modes, and the current mode prints "Already in <label>". A starting mode's `minTier` doesn't raise the run's tier either: pass `--tier` for it.

The terminal draws `recommend_mode` as "Recommended mode: <id>", its reasons, the alternatives under "Or:" and "Type m <mode> to pick one.", dropping ids the action doesn't list. Mode settings use the run folder's stored values or their defaults; `--set` doesn't reach them. See `docs/architecture/modes.md`.

### Phases and the time box

`--time <minutes>` starts the task with a time box of that length; one the action doesn't offer stops the run with exit 2 before the engine or the folder. Without it the task takes the action's `default` (none when it is `null`). The minutes are real ones: only the app's test hook and `dev --mock` make them short.

For an action with phases, the prompt line adds `>phase <id> to change part`, and `>phase` followed by one phase id moves the task (`setPhase`); any other line is a follow-up. A refusal prints "Not moved (<reason>)" with the action's parts, the current part "Already in that part.", and `>phase` to the current close part is its Finish: it closes the task like `q`. The terminal prints `— <label> —` before a phase change turn and "Time is almost up" before the wrap-up. After a turn whose agent asked to move without `auto`, it prints the proposal once: "The AI proposes to move to <label>: <reason>. Type >phase <id> to go there.", or, for the close part's own id, "The AI says this part is done: <reason> Type q to finish." The `set_phase` call itself never prints. See `docs/architecture/phases.md`.

### Settings

`--set name=value` (repeatable) stores harness settings in the run folder before the task, as the window would, and `run` prints them (`Settings: name=value, …`). Each value is checked as the typed text first, then as JSON (`4`, `true`). An unknown name, a value its schema refuses, or `--set` on a harness without settings stops the run with exit 2 before the engine or the folder. The run folder is throwaway, so these values are stored without a history commit of their own. Without `--set`, `run` is unchanged. See `docs/architecture/settings.md`.

### Setup steps

`setup` adds the harness's own steps to the setup screen (`docs/architecture/setup.md`): a `form` for a few fields of a one-record collection or some settings, an `interview` when the answers need a conversation (an action whose task fills a one-record collection through the data tools), and a `component` for anything else (the harness's own React step, passed to `HarnessApp setupSteps`). `check` warns with `setup-component`, `setup-mock` (only once `mock/` has recordings) and `setup-context`. `run` skips setup steps, but an interview's action runs as in the app, with the core's interview section in its task's first message.

## run's report

Per phase (`run`, `follow-up`, `checkpoint`, `close`; a phase change turn and the wrap-up count as follow-ups here, while `usage.jsonl` keeps their own kinds): turns, input, output, cache read and cache write tokens; the tier, model (asked and reported), effort and cap; the peak context against the cap; and the verdict, "used about N tokens (input+output, uncached)" with the total cache reads and writes printed next to it (not added), then the action's cost hint. The same lines go to `<folder>/.harness/usage.jsonl`, as in the app.

## Compliance

The CLI never reads `~/.claude`, `~/.codex` or `~/.gemini` and never handles credentials: `run` reads only the shared `~/.humanharness/engines.json` (for the notice), checks the engine only through its official CLI (`detectEngine`, as the app does) and stops with the app's own message when it isn't installed, current or signed in.
