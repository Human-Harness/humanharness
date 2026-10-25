# Authoring a harness

A harness lives in its own repository and depends on `@humanharness/cli` only: until the core is published (plan 4b) that dependency is `link:<core>/packages/cli`. The CLI, `humanharness`, is in `packages/cli`.

## Commands

| Command | What it does |
|---|---|
| `init <dir> [--core <path>] [--id <id>] [--skip-install]` | The core checkout must have run `corepack pnpm install` first. Copies `packages/cli/template/` (the id replaces `example-harness`), writes `package.json` with the `link:` dependency and the `check`, `run` and `dev` scripts, appends the first entry of `HARNESS.md`'s decision log, installs the guide, then runs `corepack pnpm install` and `git init` (`--skip-install` links the CLI directly instead; tests use it). |
| `check [--json]` | Loads the manifest with the SDK and reads `HARNESS.md` (`packages/cli/src/check.ts`). Errors exit with 1. |
| `run <action> … [--record [--force]]` | One task against a real engine, with the app's own `TaskManager` and `TurnController` (`packages/cli/src/run.ts`), the terminal as the window, and a usage report at the end. `--record` saves the run as `mock/<action>.json` (`--force` overwrites it). |
| `dev [--engine <id>] [--mock [--keep]] [--build <dir>]` | `check`, then the shell's `electron-vite dev` with `HH_HARNESS_DIR` (and `HH_DEV_ENGINE`; `--build` builds into `<dir>` through `HH_OUT_DIR`). When electron-vite can't start, it prints why and exits with 1. `--mock` opens the app with a fake engine replaying `mock/` (see `mock-mode.md`); `--keep` reuses the previous mock session's folders. |

`check`, `run` and `dev` work on the current folder, or on `--harness <dir>`. From the core repository: `corepack pnpm humanharness run manifest --harness harnesses/demo`.

## The template and what a harness imports

The template (`packages/cli/template/`) runs as is: one action (`example`, standard tier, light cost), one custom block (`example_card`), `ui/App.tsx`, strings in `locales/en.json`, and a `HARNESS.md` that already describes it, so `check` reports nothing. A harness imports `@humanharness/cli/sdk` (the SDK, `z` included: one zod for the manifest and the SDK) and `@humanharness/cli/ui` (the UI kit and `useTranslation`). The shell's renderer build dedupes React and i18n and may serve a harness folder outside the repository (`packages/shell/electron.vite.config.ts`).

## The guide

`packages/cli/guide/new-harness.md` is one engine-agnostic playbook: eight phases (task, decisions, flow, context, models, permissions and engines, identity, verify), one question at a time, each phase ending with its `HARNESS.md` section and the code updated together. `init` installs it unchanged as `.claude/skills/new-harness/SKILL.md` (Claude Code) and between markers in `AGENTS.md` (Codex) (`packages/cli/src/guide.ts`).

## HARNESS.md and check

`HARNESS.md` is the harness's living decision log: Task, Decisions, Flow, Context, Models, Permissions and engines, Identity, Open questions, Decision log. `check` reads two things from it (`packages/cli/src/harness-md.ts`): the Flow table (`| Action | Tier | Cost | Purpose |`, one row per action plus `(questions)`) and the permission lines (`- edit: none — reason`, `exec`, `web`, `engines: claude, codex`).

- Errors: `schema` (each zod issue), `i18n` (`locales/en.json`: missing, invalid JSON or not an object; other locale files are a warning; every `t("key")` in `ui/` must exist in it), `brief-missing`, `brand` (`brandNames()` in `packages/engines`), `engine-not-allowed` (excluded, unknown, or pending outside development), `harness-md-missing`, `harness-md-mismatch`, and for `mock/*.json` recordings `mock-schema`, `mock-action`, `mock-match`, `mock-next`, `mock-choice`.
- Warnings, one per pillar plus resources: `pillar-decisions`, `pillar-flow`, `pillar-context`, `tier-cost`, `permissions-wide`, `open-questions`.

## run

Before anything else, `run` checks the engine as the app does before a first turn (`readyEngine`): its legal notice must already be accepted in `~/.humanharness/engines.json`, the file every Human Harness app on the computer shares. `run` never shows or accepts the notice itself; when it is missing, it stops (before running the engine's CLI) and asks the developer to accept it once in the app (`humanharness dev`). Then the engine's official CLI must be installed, current and signed in, or `run` stops with the app's own message. Only then does it make the work folder (a new `hh-run-<id>-*` folder under the OS temp dir unless `--folder` is given) and print it.

At the prompt, a number picks a choice, any other line is a follow-up and `q` closes the task (the closing turn, which asks for the note). Ctrl-C:

- during a turn cancels it, as the app's Stop does (a cancelled first, follow-up or closing turn ends the task without a note);
- at the prompt closes the task like `q`;
- at the prompt after a close that was stopped before its turn began leaves without closing (the next `run` in that folder ends the task as unfinished).

Every way out closes the engine's runtime and prints the report; the Ctrl-C listener is removed at the end.

When the task closes, `run` prints the note's path if the closing turn wrote it. A checkpoint writes the same file, so `run` counts writes rather than comparing paths: when only the checkpoint wrote a note, it says that the checkpoint's note stands; when neither did, "No note was saved."

## run's report

Per phase (`run`, `follow-up`, `checkpoint`, `close`): turns, input, output, cache read and cache write tokens; the tier, model (asked and reported), effort and cap; the peak context against the cap; and the verdict, "used about N tokens (input+output, uncached)" with the total cache reads and writes printed next to it (not added), then the action's cost hint. The same lines go to `<folder>/.harness/usage.jsonl`, as in the app.

## Compliance

The CLI never reads `~/.claude`, `~/.codex` or `~/.gemini` and never handles credentials: `run` reads only the shared `~/.humanharness/engines.json` (for the notice), checks the engine only through its official CLI (`detectEngine`, as the app does) and stops with the app's own message when it isn't installed, current or signed in.
