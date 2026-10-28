# Authoring a harness

A harness lives in its own repository and depends on `@humanharness/cli` only: until the core is published (plan 4b) that dependency is `link:<core>/packages/cli`. The CLI, `humanharness`, is in `packages/cli`.

## Commands

| Command | What it does |
|---|---|
| `init <dir> [--core <path>] [--id <id>] [--skip-install]` | The core checkout must have run `corepack pnpm install` first. Copies `packages/cli/template/` (the id replaces `example-harness`), writes `package.json` with the `link:` dependency and the `check`, `run` and `dev` scripts, appends the first entry of `HARNESS.md`'s decision log, installs the guide, then runs `corepack pnpm install` and `git init` (`--skip-install` links the CLI directly instead; tests use it). |
| `check [--json]` | Loads the manifest with the SDK and reads `HARNESS.md` (`packages/cli/src/check.ts`). Errors exit with 1. |
| `run <action> … [--mode <id>] [--time <minutes>] [--record [--force]]` | One task against a real engine, with the app's own `TaskManager` and `TurnController` (`packages/cli/src/run.ts`), the terminal as the window, and a usage report at the end. `--record` saves the run as `mock/<action>.json` (`--force` overwrites it). |
| `dev [--engine <id>] [--mock [--keep]] [--build <dir>]` | `check`, then the shell's `electron-vite dev` with `HH_HARNESS_DIR` (and `HH_DEV_ENGINE`; `--build` builds into `<dir>` through `HH_OUT_DIR`). When electron-vite can't start, it prints why and exits with 1. `--mock` opens the app with a fake engine replaying `mock/` (see `mock-mode.md`); `--keep` reuses the previous mock session's folders. |
| `plugin <command>` | The plugin authoring tools: `init`, `build`, `check`, `record`, `test`, `dev` (see Plugins below). |

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

### Profiles

Declare `profiles: { label, fields }` when several people use one install on one computer and each one's work should stay apart (a family, a classroom): each gets a folder of their own inside the app's folder, with their own tasks, notes, data, settings, setup steps and history (`docs/architecture/profiles.md`). It needs a `profile` collection (`single: true`, `scoped: false`, a `name` string); its `context` is how the agent learns who it talks to. It is not a security feature: there is no password, and anyone who uses the computer can open any profile. Adding `profiles` to a harness people already use has no migration yet: their earlier files stay at the folder's root, unread. `check` reports the rules as `schema` findings; `run` works on one folder and reads no registry.

## run's report

Per phase (`run`, `follow-up`, `checkpoint`, `close`; a phase change turn and the wrap-up count as follow-ups here, while `usage.jsonl` keeps their own kinds): turns, input, output, cache read and cache write tokens; the tier, model (asked and reported), effort and cap; the peak context against the cap; and the verdict, "used about N tokens (input+output, uncached)" with the total cache reads and writes printed next to it (not added), then the action's cost hint. The same lines go to `<folder>/.harness/usage.jsonl`, as in the app.

## Plugins

A plugin (`docs/architecture/plugins.md`) is authored in a folder of its own, inside a harness (`<harness>/plugins/<id>/`) or anywhere else, with `humanharness plugin <command>` (`packages/cli/src/plugin*.ts`). Every command but `init` works on the plugin in the current folder, or on `--plugin <dir>`. A plugin folder needs no `node_modules`: `build` resolves `@humanharness/plugin-ui`, `@humanharness/harness-sdk` (and its `/plugin-backend` sub-path), React and zod to the CLI's own copies.

The folder:

- `plugin.config.ts`: `export default definePlugin({ … })`, with `import { definePlugin, z } from "@humanharness/harness-sdk"`. It is `plugin.json` with zod where `plugin.json` has JSON Schemas (`data[].schema`, `settings.fields[].schema`, `actions[].vars`); `pluginJson` turns them into allowlisted JSON Schema (`z.toJSONSchema`, draft 2020-12) and checks the result as the app's loader does, so a `.regex()` or a transform fails the build. A field with a default is listed as required in the JSON Schema.
- `backend.ts`: `definePluginBackend({ sources })` from `@humanharness/harness-sdk/plugin-backend` only.
- `panels/<id>.tsx`, one per declared panel, default-exporting a React component built with `@humanharness/plugin-ui`, plus any `.css` it imports; `src/` for shared code; `assets/` for `.svg` and `.png` files.
- `fixtures/<source>/001.json…`: one recorded exchange per file (the format is in `plugins.md`, "Fixture mode").
- `PLUGIN.md`: the plugin's living doc. Sections `## Purpose`, `## Sources` (a table `| Source | Brings | TTL |`, TTL as `300`, `300 s`, `5 min`, `6 h` or `1 d`), `## Rules`, `## Panels`, `## Actions`, `## Permissions` and `## Decision log`. Permission bullets read `- Host: <pattern> — <reason>`, `- Runs: <cmd> <args…> — <reason>`, `- Key: <id> — <reason>` and `- Tasks — <reason>` (`plugin-md.ts`, on `harness-md.ts`'s section and table helpers).
- `dist/`: what the app loads. `build` writes it; commit it with the sources (the root `.gitignore` keeps `harnesses/*/plugins/*/dist/`).

| Command | What it does |
|---|---|
| `init <dir> [--harness <id>] [--name <name>]` | Creates the plugin in a new or empty folder from `packages/cli/plugin-template/` (one source `items` on `api.example.com` with one fixture, a collection, a panel `main`, a chip `count`, an action `summarize`, `PLUGIN.md`, `tsconfig.json`, `README.md`, `.gitignore`). The folder's name is the id; `--harness` defaults to `"*"`, `--name` to one made from the id and refuses brand names. `__ID__`, `__NAME__` and `__HARNESS__` are filled in one pass. A bad `--harness` or `--name` is refused before anything is written; files are written with `wx` and nothing is ever deleted. It appends the first Decision log entry and installs the guide. It doesn't build. A fresh `init` passes `build`, `check` and `test`. |
| `build [--out <dir>]` | `dist/` from the sources (below). Prints the files written. |
| `check [--json] [--harness <dir>] [--no-build]` | Builds (unless `--no-build`), then checks the built `dist/`, the sources and `PLUGIN.md` (below). Exit 1 on any error. `--harness` adds the slot check against that harness's manifest. |
| `record <source> [--yes] [--no-build]` | One real sync of `<source>`, written as its fixtures (below). |
| `test [--source <id>] [--now <iso>] [--json]` | Runs every source (or one) of the built plugin once on its fixtures, with settings at their defaults and each key as `fixture-<id>`. `--now` fixes the date the backend sees. Prints per source the records written by collection (count and the first 3 keys), the attention items, the chips and the log lines. It reads `dist/` and doesn't build. Fixtures are read with the app's own reader (`readPluginFixtures` from `@humanharness/shell/plugins`: same caps, no links or hard links); a skipped file is a `warn:` line in that source's log. Exit 1 when a source fails. |
| `dev --harness <dir> [--live] [--mock]` | Checks (and so builds) the plugin against the harness, then opens it with the harness's `dev`, with the plugin as a dev plugin (`HH_PLUGIN_DIRS`, on, no review) and, unless `--live`, `HH_PLUGIN_FIXTURES=1`. It replaces every inherited `HH_PLUGIN_*`. A check error opens nothing (exit 1). It watches the plugin folder (recursive, ignoring `dist/`, its swap folders, `fixtures/`, `node_modules` and dot-folders) and rebuilds 300 ms after the last change, one build at a time with at most one queued; a failed build keeps the last good `dist/`, and the app reloads the plugin when `dist/` changes. `--live` uses the network and the keys stored in Settings › Plugins and says which hosts it will reach; `--mock` opens the harness in mock mode; the two don't go together. `--harness` is required, and a plugin path holding the path delimiter is refused. |

A bare `humanharness plugin` prints the usage and exits with 2, as does an unknown command.

### build

`buildPlugin` (`plugin-build.ts`) runs esbuild, resolved through the copy `tsx` brings (no direct dependency yet: open question), in memory:

- `plugin.json` from `plugin.config.ts`, bundled for Node into a temp `.mjs` (removed after) and imported: the config runs in the CLI's process (every command that builds, P12 below; the app never runs it).
- `backend.js`: ESM. Each `panels/<id>.tsx` → `panel-<id>.js`, a classic-script IIFE that mounts the default export, `panel-<id>.css` and `panel-<id>.html`. A panel imports only code and `.css`. Top-level await is refused in both ("<file>:<line>: top-level await is not allowed: do the work inside a function").
- `assets/`: flat, `.svg` and `.png` only, names of 1–64 letters, digits, `_` or `-`; checked with `lstat`.
- Output is location-independent and deterministic: `NODE_ENV` is `"production"`, `minifyWhitespace` drops path comments, the plugin's own files load as `hh-plugin:<path from the plugin folder>`, and an import outside both the plugin folder and the toolchain is refused, so no machine path (or user name) ends up in a bundle. Two builds give the same bytes.
- The result is written to `<out>.tmp-<hex>` and swapped in through `<out>.old-<hex>`, so a failed build leaves the old `dist/` as it was. `--out` may not be the plugin folder or a folder holding it, and a non-empty folder without a `plugin.json` (not a previous build) is refused.

### check

`checkPlugin` (`plugin-check.ts`) reports findings as `severity rule file:line message`, or as JSON with `--json`. The source scans read `backend.ts`, `panels/**` and `src/**` (`.ts`, `.tsx`, `.js`) with fixed regexes; a URL built from parts isn't seen, and the broker stays the real enforcement.

- Errors: `schema` (`dist/plugin.json` missing, not JSON or refused by the loader's checks; a failed build), `api-version`, `host-undeclared` (a literal `https?://host[:port]` the declared hosts don't cover; `www.w3.org`, the SVG namespace, is skipped), `exec-undeclared` (`exec("cmd")`), `secret-undeclared` (`{{secret:<id>}}`), `slot-unknown` (with `--harness`: a panel or chip naming a slot the harness doesn't have with that kind; the message says where it will go instead), `fixtures-missing` (a source with no fixture), `plugin-md-mismatch` (`PLUGIN.md` missing, no Sources table, Sources ids or TTLs that differ from the manifest, or permission bullets that aren't exactly the declared hosts, commands, keys and tasks), `prompt-placeholder` (a `{{name}}` that isn't a declared var, or a required var without a default that the prompt never uses), `brand` (the plugin's name names a provider or model, as a whole word: `findBrand`, the harness check's rule).
- Warnings: `exec-wide` (`args: ["*"]`), `exec-writes` (a method other than GET or HEAD, or a writing verb such as `post`, `delete`, `merge`), `hosts-wildcard`, `sync-heavy` (a TTL under 60 s), `host-local` (`localhost`, a name under it, or an IP literal, declared or in a URL, IPv6 included: the broker refuses them), `http-url` (an `http://` URL: the broker fetches https only).
- `hosts-wildcard` can't fire today: the schema already refuses `*.<one label>`, so `check` reports that as `schema` (see `plugins.md`, Known gaps).

### record

`record <source>` builds (unless `--no-build`), then runs one real sync of that source with the live network (global `fetch`, commands found on `PATH` only, never a path), the shell's own broker (`@humanharness/shell/plugins`, with its public-address host check) and a temp data folder.

- With declared keys it refuses to run outside a terminal. It asks each key the backend names, and any other the broker asks for during the run, with the input hidden, and holds them for that run only.
- Before writing, every exchange goes through `stripSecrets`: each key's raw, URL-encoded, form, base64 and JSON-escaped forms become `{{secret:<id>}}`; a Basic `user:key` credential is stripped whole; `set-cookie` is never recorded and oversized headers are dropped. An exchange that still holds a key in a form `holdsSecret` decodes means nothing is written and exit 1. Responses are capped at 10 MB.
- No requests: nothing written, exit 0. More than 200 exchanges (the app's per-source cap): nothing written, exit 1. Old fixtures of that source are deleted first, after asking (`--yes` doesn't ask; "n" writes nothing, exit 1). Files are `fixtures/<source>/001.json`…, created exclusively.
- What it prints (failures, log lines, a leaking URL) passes `hideSecrets` first. It ends by asking to read the fixtures before committing them: hex, double-encoded, compressed, split or case-changed keys aren't seen.

### Plugin code on the author's machine (P12)

Every command that builds runs the plugin's `plugin.config.ts` in the author's Node process: `build`, `check` (unless `--no-build`), `record` (unless `--no-build`), `dev`'s first check and every `dev` rebuild. `test` and `record` also run the bundled backend, through `esbuild.transform` into an IIFE in a `vm` context with a few host-realm globals and part 1's broker. **Node's `vm` is not a sandbox**: a host-realm value leads back to `process`, so the code can do anything the author's user can, and under `record` it can read the keys typed in the terminal.

- The note ("Note: plugin code runs in this Node process, not in the app's sandbox. Run only plugins you trust.") comes before any plugin code runs: from `test` (on stderr with `--json`), from `record` before its build (a plugin that asks for keys then adds that it can read them, before the first prompt), from `check` when it builds (on stderr with `--json`; none with `--no-build`) and from `dev` before its first check, adding that every rebuild runs `plugin.config.ts` too. `build` prints no note: it is the command that runs the config by name.
- A source's synchronous part runs under the run limit (2 minutes), so an endless loop before its first `await` is stopped; one that starts after an `await` can't be stopped in this process (`plugins.md`, Known gaps).
- `test` and `record` end the process once they have printed (`exitsWhenDone` in `main.ts`), so a timer or request the plugin left behind doesn't keep the command alive.

In the app, plugin code only ever runs in the sandboxed backend window and panel frames.

### The guide

`packages/cli/guide/new-plugin.md` is the `/new-plugin` playbook in the spec's 7 phases, one question at a time, each ending with its `PLUGIN.md` section and the code updated together. `init` installs it in the plugin folder, unchanged, as `.claude/skills/new-plugin/SKILL.md` (Claude Code) and between `<!-- humanharness:plugin-guide:start -->` and `<!-- humanharness:plugin-guide:end -->` in `AGENTS.md` (Codex) (`pluginSkillFile`, `pluginAgentsFile`, `pluginGuideSection` in `guide.ts`); the harness guide's functions are unchanged. Its Verify phase runs `record`, then `check` and `test`. The agent never runs `record` with a key and never asks for one: the developer runs it in their own terminal. Fixtures written by hand, when the service isn't reachable yet, leave Verify open with a Decision log item until `record` runs.

The demo's `harnesses/demo/plugins/on-this-day/` is a complete example: one source with a hand-made fixture of 25 synthetic events, a panel, a chip, round-anniversary attention items that open the panel on the event, and an "Explain this event" action (light tier, app-wide).

## Compliance

The CLI never reads `~/.claude`, `~/.codex` or `~/.gemini` and never handles credentials: `run` reads only the shared `~/.humanharness/engines.json` (for the notice), checks the engine only through its official CLI (`detectEngine`, as the app does) and stops with the app's own message when it isn't installed, current or signed in.
