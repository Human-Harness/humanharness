# Mods

Spec: `docs/superpowers/specs/2026-11-05-minimal-core-and-mods-design.md` ("§" below). Step 0a is the API (`packages/mod-sdk`), the host in main (`packages/shell/src/main/mods/`) and Settings › Mods. Step 0b1 adds the home folder, the layout and the first core mod, Home. Step 0b2 adds the person's own layer, live reload, the manual, the CLI commands, the escape hatch and the home folder's history (sections below).

## What a mod is

A mod is a folder with a `mod.json` and a built main part that exports `defineMod({...})`. It changes the app's behaviour through hooks and services, and it runs in the main process with the app's own permissions: there is no sandbox. A mod comes from one of three origins:

- **core**: shipped with the app (`core-mods.ts`; `home` in 0b1, step 1 adds `sidekick`). Off unless its default switch says so, a harness declares it or the person turns it on; `home` is on by default.
- **harness**: declared in the harness manifest's `mods` map (`mods.<id>` is the mod's config). The code is a core mod of that id if there is one, else `<harnessModsDir>/<id>`. On by default.
- **local**: a folder the person added in Settings › Mods. Off until the person confirms it.

`resolve.ts` reads `mod.json` for all of them without running code. Problems (bad manifest, id mismatch, duplicate id) are reported per mod, never thrown. A local folder can't take an id that a declared or core mod already has.

## `mod.json`

Validated by `modJsonSchema` (strict: unknown fields are refused).

| Field | Meaning |
|---|---|
| `id` | `^[a-z][a-z0-9-]{0,39}$`. Names the manifest key, the `config.json` entries and `.harness/mods/<id>/`. Must match the id `defineMod` exports. |
| `name` | 1–60 characters, shown in Settings › Mods. |
| `version` | `x.y.z`. |
| `apiVersion` | Must be `1` (`MOD_API_VERSION`). Another version is refused. |
| `requires` | Up to 10 mod ids; a mod can't require itself. A mod loads only after the ones it requires are on, and turning one off turns its dependants off. |
| `history` | Default `false`: the mod's data folder is kept out of the work folder's history. |
| `main` | Built entry, relative to the mod's folder, no `..`, not absolute. Optional: absent means a UI-only mod, with no main part. (0b2 adds bundling `main.ts`.) |
| `ui` | Built ui entry, same path rules. Optional: absent means the mod places no blocks. |

## `defineMod` and `MainCtx`

`defineMod({ id, schema?, main?(ctx), ui?(ctx) })` only types the definition. `schema` is a zod schema; the host parses the harness's `mods.<id>` with it and a failure becomes the mod's problem. `ui` and `UiCtx` are typed only; 0b renders them.

Every registration returns a `Disposer`; the host runs them (newest first) before turning the mod off.

Hooks (`ctx.on`):

- `beforeSend(send)`: called before a message is sent; returns `{kind:"pass"}` or `{kind:"rewrite", text}`. Mods run in turn, each seeing the previous rewrite. A rewrite that is empty or over 20 000 characters is ignored.
- `turnStart(task)`: a turn is about to run.
- `turnEnd(end)`: a turn finished (`ok`, prompt, reply, context use).
- `taskOpen(task)`: a task opened.
- `taskClose(task)`: a task closed.
- `betweenTasks()` (mods 1a): no task runs, between one task and the next; awaited before the next one starts (within the hook limit).
- `phaseMoved({ task, from, to })` (mods 1a): a task's phase moved, by the person, the agent or the app.
- `daily({ day })` (mods 1a): at start and at each local midnight while the app runs (`ModHost.startDaily`); the mod tells a day it already did by `day`.
- `close()` (mods 1a): the app is quitting, before the disposers run.

`beforeSend` may also answer `{kind:"hold", token}` (mods 1a): the send waits until the mod calls `ctx.holds.resolve(token, verdict)` with `pass`, `rewrite` or `cancel`. That wait is the person's, so it counts toward no limit; closing the task, quitting or turning the mod off cancels a held send. `turnEnd` hears only a person's `run` turns (no checkpoint, close or wrap-up turn). In board mode the turn hooks and `phaseMoved` follow only the focused lane (`focusGate`, `board-host.ts`).

Services and fields:

- `id`: the mod's id.
- `config`: the parsed `mods.<id>`; `undefined` without a schema and a declaration.
- `ipc(name, handler)`: a channel the mod's own ui will call (0b wires the ui side).
- `engine.run(tier, prompt, opts?)`: a tool-less session of the mod's own on `light`/`standard`/`deep`, outside the work folder; usage is tagged `mod:<id>`.
- `tasks.running()`: the running task or `null`.
- `notes.titles(scope?)`: note titles.
- `storage.get/set`: app-private JSON (see Data).
- `holds.resolve(token, verdict)` (mods 1a): ends a send this mod held; false when there is no such held send.
- `stores.open(name, collection)` (mods 1a): a collection of the mod's own in the work folder, one `DataStore` per base (`ModStoreRegistry`, `services.ts`). `name` is the mod's id or starts with `<id>-`; `collection` is declared as a harness declares one. `readAll()` reads every record app-wide; `write(requests)` checks every request, runs them as the app and makes one `Data: <name>` commit. The person's own writes to that collection (the app's data path) reach the same store; the harness UI's `client.data` never does.
- `usage.record(kind, entry)` and `usage.summary({ task?, day? })` (mods 1a): the mod's own turns in the base's `usage.jsonl` (`phase: "mod"`, `process: "mod:<id>"`; Sidekick keeps its old `sidekick` tags), and its tokens for the week, a task or a day.
- `focus.set(taskId, on)` (mods 1a): the mod holds a task in focus while it waits on the person there; cleared when the mod goes off.
- `dataDir()`: the mod's folder in the work folder, or `null` before setup.
- `notify(text)`: a notice in the window.
- `provide(service)` and `mods.get(id)`: expose a value to other mods; `get` returns it only while that mod is on.
- `log(...)`: console output prefixed `[mod <id>]`.

Timeouts (`host.ts`): `beforeSend` has **6 s in total** (`BEFORE_SEND_MS`) across all mods; when the budget is spent the remaining mods are skipped and the text goes out. Every other hook, `main()`, the import of the module and each `ipc` handler get **5 s** each (`HOOK_MS`). A throw, a rejection or a timeout is a failure; the host never lets it throw into the app.

## On and off

`isModOn(id, origin, config)` (`config.ts`):

1. If `config.json` › `mods.failed[id]` exists: off.
2. Else if `mods.on[id]` is a boolean: that.
3. Else on only when the origin is `harness`.

A mod that is wanted but can't start (import error, wrong id, config rejected by its schema, a required mod not on) stays off with a `problem` shown in Settings › Mods. Turning a mod on from Settings clears its failure and its problem and retries.

Three strikes: every failed hook call adds a strike, a success resets the count to zero. The third failure in a row disposes the mod, saves the reason in `config.json` › `mods.failed[id]` (cut to 300 characters), shows a notice ("… was turned off after failing three times in a row") and redraws Settings. It stays off across restarts until the person turns it on.

## Local mods

Adding a local mod mirrors Settings › Plugins: the renderer never sends a path. Main opens the folder dialog (`hh:modReviewLocal`), validates `mod.json`, refuses a taken id and returns a review (id, name, version, folder) with a one-time token. The review shows a warning that the mod's code runs inside the app; only after the person confirms does the renderer send the token back (`hh:modAddLocal`). Main checks the token, checks the id again, saves the folder in `config.json` › `mods.local` and turns it on. Removing is by id, only for local mods (`hh:modRemoveLocal`).

## Data

- `storage`: `<userData>/<harnessId>/app/storage/<id>.json`, one JSON object per mod, writes queued and atomic (temp file + rename). Outside the work folder.
- `engine` sessions run in `<userData>/<harnessId>/app/sessions/<id>`.
- `dataDir()`: `<workFolder>/.harness/mods/<id>/`, created on first call, so it travels with the work folder.
- History: `modHistoryIgnores` adds `.harness/mods/<id>/` to the history's ignore list for every mod whose `history` is `false` (the default).

The demo declares no mods, so `.harness/mods/` is not created for it.

## The home folder and its layers

The app's home folder is `<userData>/<harnessId>/app/` (`appHome` in `services.ts`); `storage/` and `sessions/` live there too. On every start, before the mod host resolves the mods, `writeLayers` (`home-folder.ts`) rewrites two read-only layers from the app's own sources:

- `core/mods/<id>/`: each core mod's built copy (`CORE_MODS`), and `core/layouts/main.json`: the default layout, written from the copy built into the app.
- `harness/mods/<id>/` and `harness/layouts/*.json`: the harness's declared mods that have a `mods/<id>/` folder (ids that are core mods are left out) and its `layouts/*.json`.

`.layers.json` in the home folder records, per path under it, the sha256 of what the app wrote last time. A file under `core/` or `harness/` that differs from that record, or that the app never wrote, is the person's edit: its mod folder moves aside to `mods/<id>-edited` (a layout to `layouts/<name>-edited.json`; any other stray file to the same path without the layer, `-edited` before its extension; `-2`, `-3`… when the name is taken), the original comes back, and one notice says so per moved item. Files the layers no longer hold are deleted and empty folders pruned. Writes are atomic and the record is written last. A failure is logged and never stops the app. The `-edited` folders and the user layer that reads them are 0b2.

## The layout

A layout file is one tree of nodes (`layoutSchema` in `packages/mod-sdk/src/layout.ts`, strict: unknown fields are refused). Node types:

- `row` and `column`: `children`, laid out along one axis.
- `stack`: `children` plus an optional `header` (block content).
- `block`: `content`, either `{ "mod": "<id>", "block": "<name>", "props"?: {...} }` or `{ "core": "task" }`, the core's task view.

Every node may have `id` (lowercase letters, digits and `-`, at most 40), `size` (`{ "px": n }` or `{ "weight": n }`), `min`, `max` and `hidden`. The whole-layout rules, each with its own message:

1. The root must be a `stack`.
2. Ids are unique.
3. At most 8 levels deep (the root is level 1) and at most 64 nodes.
4. The root has a child with id `home` and a child with id `work`.
5. Exactly one `{ "core": "task" }` block in the layout, and it is inside the `work` child.

The shown layout comes from `shownLayout` (`layout.ts`), which the renderer asks through `hh:layout`: `harness/layouts/main.json`, else `core/layouts/main.json`, else the copy built into the app (`default-layout.json`). A file that doesn't parse or break a rule gets `<file>.error` beside it (one problem per line) and the next one is used; a valid file deletes its stale `.error`. The problems of the files passed over come back with the layout and its source. The default layout is a stack of `home` (the Home mod's `home` block) and `work` (the task view).

## UI-only mods

`main` in `mod.json` is optional. A mod with only `ui` has no main part: it is on or off like any mod, and the host loads no code for it. Its `ui` entry is typed by `defineMod`'s `ui(ctx)`, which registers named blocks the layout places with `{ mod, block }`. While the mod is off, the layout draws "Mod <name> is off" in the block's place.

## Core mods as packages

A core mod is a package under `packages/mods/<id>` with `mod.json`, `README.md` and `src/`. The shell build (`electron.vite.config.ts`) copies those files to `out/core-mods/<id>/`, which is what the home folder's `core/` layer holds. Its ids and default switches are `CORE_MOD_SWITCHES` (`core-mods.ts`: `core-mod-list.ts` plus `home`, on). The renderer entry (`packages/shell/src/renderer/main.tsx`) imports each core mod's package and runs its `ui` before the first render, registering its blocks in the registry the layout draws from. Home (`packages/mods/home`) is the first: the screen the app opens on. Sidekick (`packages/mods/sidekick`, `docs/architecture/sidekick.md`) is the second, main side only: the shell's main imports none of it.

**A core mod's ctx** (`CoreMainCtx`, `@humanharness/mod-sdk/core`) adds `ctx.app`, the app's parts (`mods/core-app.ts`, built once in `app-lifecycle.ts`: phases and briefs, setup, the open task, engines and profiles, session folders and briefs from `mods/core-sessions.ts`, `EngineSession`, the daily input and more), and `ctx.push(channel, value)` on an app push channel. Only a core mod may handle an app channel (`hh:…`) with `ctx.ipc`; the core registers those names once with Electron (`MOD_APP_CHANNELS`, `mods/app-channels.ts`) and hands each call to the mod host, which refuses it when no mod handles it.

**The core-mod import rule** (`bundleMod` with `core: true`, `packages/mod-sdk/src/build.ts`): a core mod's main may import its own files, the shared imports, `node:` builtins and the packages its `package.json` declares. Core `@humanharness/*` packages are bundled in; npm packages stay outside, found beside the app; another mod (`@humanharness/mod-*`) never. The core never imports a core mod: what it needs goes through hooks, `ctx` and channels.

## The user layer (0b2)

Beside the read-only `core/` and `harness/`, the home folder holds the person's layer, which the app never rewrites:

- `mods/<id>/`: mods written by hand (or cloned, or moved aside as `-edited`). `userModFolders` lists every folder there with a `mod.json`. In this layer `mod.json`'s `main` and `ui` name **source** files (`.ts`, `.tsx`, `.js`); the app bundles them itself.
- `layouts/<name>.json`: the person's layouts. A name is `LAYOUT_NAME` (`layout.ts`): letters, digits, `_` and `-`, at most 64, no leading dot.
- `settings.json`: `homeSettingsSchema`, `{ "layout"?: "<name>" }`; unknown keys are kept. `pickLayout` writes it (atomically) from Settings › Mods › Layout; `null` removes the key.

The shown layout (`shownLayout`): the picked name in `layouts/`, then in `harness/layouts/`; else `harness/layouts/main.json`, else `core/layouts/main.json`, else the built-in copy. A pick that isn't found is a problem of its own; the files passed over come back as problems in the view.

**Consent.** A mod in `mods/` is a local mod: listed off in Settings › Mods, marked "Local". `userConsent` (`user-layer.ts`): its first turn-on goes through the same review and token as Add from folder (`hh:modReviewLocal` with the id; main checks the id against its own folder, never a path from the window). Accepting records the id in `config.json` › `mods.trusted`, sets `mods.on[id]` and clears `mods.failed[id]`; a trusted mod turns on and off with its switch after that.

**Allowed imports.** `SHARED_IMPORTS` (`packages/mod-sdk/src/bundle.ts`): `react`, `react/jsx-runtime`, `@humanharness/mod-sdk`, `@humanharness/ui` and `zod`, plus the mod's own files inside its folder; anything else is refused by `bundleMod`. The main part gets the app's own copies through small ESM shims (`writeMainShims`, in `mod-build/.shared/`) that re-export `globalThis.__hhMainModules`; `react` and `@humanharness/ui` resolve to a shim that throws, because they are the window's.

**`mod-build/`.** `<userData>/<harnessId>/mod-build/<id>/` (`modBuildRoot`), beside the home folder, not in it: `ModBuilds.build` bundles `main.mjs` and `ui.js` there (a part the mod dropped leaves no stale file), and `last-good/` holds the last build that ran.

## Live reload, last good and `.error`

`watchUserLayer` watches `mods/` (recursive) and syncs a mod folder once its files have been quiet for 300 ms (`USER_DEBOUNCE_MS`, per folder); `watchLayouts` does the same for `layouts/` and `settings.json` and sends `hh:layoutChanged` with the new view. A `.error` (the app's) or `.tmp` (an atomic write's) file is never a change.

`UserLayer.sync` (one sync per folder at a time):

- `mod.json` gone: the mod is removed from the host.
- `mod.json` doesn't parse: `mod.json.error` beside it; a running mod keeps its version, a new one is listed as a problem.
- The id changed: the old mod goes, the new one comes in off. An id another mod already has: `mod.json.error` says so.
- Otherwise a known mod is reloaded (its disposers run, the new build runs) and a new one is added, off.

When a build or the new `main` fails, `ModBuilds.fail` writes `<file>.error` (the source file's name, say `ui.tsx.error`) with the reason and copies `last-good/` back, so the host and the window keep the last good version. When a version builds and runs, `ModBuilds.keep` makes it the new `last-good/` and deletes every `.error` in the mod's folder. After a reload main sends `hh:modReloaded` (`{ id, version }`) and the window imports the ui again and remounts the mod's blocks. Layouts follow the same rule through `shownLayout` (`layouts/<name>.json.error`).

## `hh-mod://`

`MOD_SCHEME` (`mod-scheme.ts`), registered as privileged before "ready" (standard, secure, CORS-enabled; no CSP bypass). `serveModUi` answers only `hh-mod://<id>/ui.js`, with at most the query `?v=<version>` (the window's cache buster after `hh:modReloaded`), and only for a mod that is on, isn't a core mod (the core's ui ships with the window) and has a `ui`. A user-layer mod is served from `mod-build/<id>/ui.js`, another local mod from its folder's `ui` file. Everything else is 404; responses are `no-store`.

## `AGENTS.md` and `hh.d.ts`

`manualFiles()` (`manual.ts`) gives the two files written into the home folder on every start, outside the layers' edit check:

- `AGENTS.md` (`agentsMd()`): the folder's manual for a person or any agent: the layers, layouts and their rules, mods and `mod.json`, the allowed imports, consent, live reload and `.error`, the commands, the escape hatch and undo. Its numbers come from the code (`LAYOUT_MAX_DEPTH`, `LAYOUT_MAX_NODES`, `MOD_API_VERSION`, `SHARED_IMPORTS`).
- `hh.d.ts`: the mod API's types, imported by main as text from `packages/shell/scripts/hh.d.ts`. `scripts/hh-dts.ts` generates it from `@humanharness/mod-sdk`'s index and the block API of `@humanharness/ui`, each emitted file as an ambient module under `<package>/_internal/`.

To regenerate `hh.d.ts` after a change to the mod API: `corepack pnpm --filter @humanharness/shell hh-dts`. `packages/shell/test/manual.test.ts` fails while the checked-in file is stale, and checks that `AGENTS.md` names every exported name of `hh.d.ts`.

## The contract

A mod written today must keep working after an update, unless `MOD_API_VERSION` says it won't. The frozen copy of the contract lives in `packages/mod-sdk/released/`, and `packages/shell/test/contracts.test.ts` compares today's contract with it. The folder holds five kinds of files, written only by `accept` (except `roles.json`, see below):

- `contract.json`: `{ "apiVersion": 1, "frozen": false }`.
- `hh.v1.d.ts`: a copy of `packages/shell/scripts/hh.d.ts`.
- `mod-json.v1.schema.json`: `modJsonSchema` as JSON Schema (zod's input side).
- `mod-json.v1.examples/*.json`: five valid `mod.json` files (minimal, `ui`, `requires`, `clonedFrom`, `history`). They are frozen inputs: `accept` never rewrites them.
- `roles.json`: the role of each exported type. It is the one file edited by hand.

The check gives one of three results, with the names behind it: **same**, **additive** (safe for existing mods) or **breaking**. A removed name, a removed `mod.json` property, a newly required one or a frozen example that no longer parses is breaking; a new name or a new optional property is additive. Exported types are compared by who fills them:

| Role | Who fills it | Rule | Example |
|---|---|---|---|
| `host` | The host hands it to the mod | members may be added | `MainCtx` |
| `mod` | The mod writes it | new members must be optional | `SendVerdict` |
| `both` | Both | may not change | `Tier` |

A new exported type needs a line in `roles.json` (`"host"`, `"mod"` or `"both"`); without it the check fails and names the file.

`corepack pnpm --filter @humanharness/shell contracts check` prints the result (exit 1 unless same). `corepack pnpm --filter @humanharness/shell contracts accept` rewrites the `vN` files, so every contract change shows up as a diff of `released/` in its PR. While `frozen` is `false`, `accept` also takes a breaking change (with a warning). Once `frozen` is `true`, `accept` refuses a breaking change, writes nothing and asks to bump `MOD_API_VERSION` in `packages/mod-sdk/src/mod-json.ts`; after the bump it writes `hh.v<N>.d.ts`, `mod-json.v<N>.schema.json` and the examples copied with `apiVersion: N`, sets `apiVersion: N`, and leaves the older files as history.

**Release checklist, step 1: set `frozen: true` in `packages/mod-sdk/released/contract.json` in a one-line PR (Marco's decision).**

Known limits: the protocol types are not compared; generics are not compared at their constraints; literal constants are compared by type, not by value; names of `@humanharness/ui` are compared without `Strict`, so a method parameter there is checked bivariantly.

## The control channel

`startControl` (`control.ts`): while the app runs, an HTTP server on 127.0.0.1 at a random port. It writes `<home>/.control.json` (`{ port, token, pid }`, mode 0600) and removes it on quit, only if the file still holds its own token. Every request needs `Authorization: Bearer <token>` (401 otherwise); bodies are JSON objects of at most 64 KB.

- `GET /status`: `ControlStatus`, the mods as Settings › Mods lists them, the folders that couldn't be read, and the layout shown (name, source, problems).
- `POST /shot`: the window as a PNG, at `body.path` (an absolute path) or `<home>/shots/<time>.png`; answers `{ path }`, 409 without a window.

## The CLI commands

`packages/cli` (`app-commands.ts`, `mod-command.ts`). Each works on the home folder from `--home <dir>`, else the nearest folder from the current one up that holds `.layers.json` (`findHome`).

- `humanharness mod check <folder>`: checks a mod without the app: `mod.json`, the bundle of each part, `main` against a fake `ctx`, each block rendered once. One line per check; exit 1 on any failure.
- `humanharness mod clone <id> [as]`: copies `core/mods/<id>` or `harness/mods/<id>` to `mods/<as>`, with source entries, the new id and `clonedFrom`; refuses an existing folder.
- `humanharness layout clone <name> [as]`: copies `harness/layouts/<name>.json` or `core/layouts/<name>.json` to `layouts/<as>.json`; refuses an existing file.
- `humanharness status` and `humanharness shot [file.png]`: through the control channel; they need the app running.
- `humanharness dev --safe`: opens the app with `HH_SAFE=1` (see the escape hatch).

## The escape hatch

`safe.ts`. `isEscapeHatch` matches ⌘⌥⇧Esc on macOS and Ctrl+Alt+Shift+Esc elsewhere (a key-down of `Escape`, exactly those modifiers). It is the first check in the window's `before-input-event`, before any other shortcut, and can't be rebound. `safeAtStart` is true for a `--safe` argument or `HH_SAFE=1`.

`enterSafeMode`:

1. `pickLayout(home, null)`: the `layout` key leaves `settings.json`, so the harness's `main` (else the core's) shows.
2. Every local mod (each folder of `config.json` › `mods.local` and of the user layer) whose `mod.json` reads is set `mods.on[id] = false`. Core and harness mods, `mods.trusted` and other keys are left as they are.

At start this runs before the host starts (and before the home history's first commit, so the change can be undone). From the key, main then restarts the host and sends `hh:layoutChanged`. Either way it sends `hh:safeModeEntered`, and `hh:safeMode` answers whether safe mode was entered since start; the window shows `SafeNotice` (`packages/ui/src/mods/SafeNotice.tsx`): "Safe mode: your mods are off and the harness's layout is shown. Turn them back on in Settings › Mods.", until closed.

## The home history and undo

`HomeHistory` (`home-history.ts`): a `History` (`@humanharness/workspace`, isomorphic-git) over the home folder, its gitdir outside it at `historyDir(userData, home)` (`<userData>/history/<sha256(home), 16 hex>`). It tracks only `mods/`, `layouts/` and `settings.json` (`tracksHomePath`); never `.error`, `.tmp` or `.DS_Store` files, nor anything else in the folder (`storage/`, `sessions/`, `core/`, `harness/`, `.control.json`, `.layers.json`, the manual, `shots/`). isomorphic-git's status walk doesn't read the gitdir's `info/exclude`, so the ignore list is built from the folder for each operation.

- `init` at start, after `writeLayers` and the safe-mode check: makes the history and commits what changed while the app was closed (a first commit even when nothing did).
- `watch`: a tracked change is committed once the folder has been quiet for 1 s (`HOME_QUIET_MS`), with the message `Change to the app: <paths>`, at most three named and then `and N more`.
- `undo` (`hh:homeUndo`): commits pending edits first, then restores the commit before the last one as a new commit, `Undo: <last message>`; with one commit it does nothing. An undo is itself a change, so a second undo brings the first state back. The folder's watchers then reload what it changed.
- `hh:homeHistory` answers the last commit's `{ message, at }` or null; `hh:homeHistoryChanged` sends it after every commit.

Settings › Mods ends with a "Changes" card: the row "Undo the last change to the app", its hint the last change's message and time, and an Undo button, disabled when there is none.

## `humanharness mcp`

The kit for outside agents (step 0c1; the spec's in-app "Change this app" action was dropped). `packages/cli/src/mcp/`:
an MCP server (`@modelcontextprotocol/sdk`'s `McpServer`) over stdio, so an agent the person already uses (Claude Code,
Codex, any MCP client) can learn what the app is made of, make or clone a mod, check it and see it running.

- **Modes** (`mode.ts`, `findMode`): `{ mode: "app", home }` or `{ mode: "harness", dir, core }`. `--home <dir>` is
  app mode, `--harness <dir>` harness mode (the folder may be new or empty, for `harness_init`); both together are a
  usage error. Without either, the nearest folder from the current one up that has `harness.config.ts` (harness mode)
  or `.layers.json` (app mode), whichever comes first; outside both the error names both flags. In harness mode `core`
  is the checkout the project's `@humanharness/cli` link points to (`node_modules/@humanharness/cli`, else the `link:`
  in `package.json`), else the one the running CLI belongs to (`paths.ts` `CORE_DIR`): `coreOf` in
  `kit/harness-project.ts`.
- **Connecting** (`config-snippet.ts`): `humanharness mcp --config claude` prints the `claude mcp add humanharness --
  <node> <bin> mcp [--home <dir> | --harness <dir>]` command, `--config codex` the `[mcp_servers.humanharness]` TOML
  block. Both run this node with the bin's absolute path (`BIN_PATH`), shell-quoted where a path has a space.
- **Serving** (`server.ts`, `mcpCommand`): `createServer(mode)` registers the mode's tools and connects a
  `StdioServerTransport` on the command's stdin and stdout; the server ends when stdin ends.

**Tools per mode** (`tool-names.ts`): app mode registers `APP_TOOLS` (the seven below, also exported as `TOOL_NAMES`,
which the shell's `manual.test.ts` reads), harness mode `HARNESS_TOOLS`: `catalog`, `mod_new`, `mod_check`,
`mod_clone`, `layout_clone`, `harness_init`, `harness_check`. `status` and `shot` need the running app, so harness
mode has none.

### App mode

The tools, in the order `APP_TOOLS` lists them. Each answers its data as JSON text, or the kit's
`CliError` message with `isError` (an app that isn't running reads "The app isn't running: open it and try again"):

| Tool | Kit function | Needs the app |
|---|---|---|
| `status` (read-only) | `appStatus` | Yes, through the control channel |
| `catalog` (read-only) | `catalog`: every mod of the three layers with its blocks, hooks, settings, on/off state from `config.json` and any `.error`; the layouts and which one shows; the names `hh.d.ts` types | No |
| `mod_new` | `newMod`: `mods/<id>/` from `packages/cli/mod-template` (`mod.json`, `main.ts`, `ui.tsx` with one block, default `main`, and a README); refuses a core or harness mod's id | No |
| `mod_check` (read-only) | `checkMod` | No |
| `mod_clone` | `cloneMod` | No |
| `layout_clone` | `cloneLayout` | No |
| `shot` (read-only) | `appShot`, then the saved PNG read back: an `image` content (base64 PNG) and the path as text | Yes |

The read-only tools carry `readOnlyHint`. The descriptions of `mod_new` and `mod_clone` tell the agent a new mod or
clone starts off and that turning it on is the person's step in Settings › Mods; `layout_clone`'s, to ask before
changing the person's pick in `settings.json`.

### Harness mode

The same kit over a harness project (step 0c2), for a developer or an agent composing a harness from mods (the
/new-harness guide's Compose phase). The kit functions take a `KitRoot`: the home folder (a string), or
`{ harness, core }`. New mods and clones land in the project's `mods/<id>`, layout clones in its `layouts/<as>.json`;
the source of a clone is `<core>/packages/mods/<id>`, of a layout clone the core's default layout
(`<core>/packages/shell/src/main/mods/default-layout.json`, the only core layout: `main`).

| Tool | Kit function |
|---|---|
| `catalog` (read-only) | `harnessCatalog(dir, core)`: the core's mods (blocks, hooks, settings, README summary, `declared`), the core's layout, the project's own `mods/` and `layouts/` (with why a layout won't load), and the ids `harness.config.ts` → `mods` declares. Without a project: `{ project: false, next }`, pointing at `harness_init` |
| `mod_new` | `newMod`: refuses a core mod's id and an existing folder |
| `mod_check` (read-only) | `checkMod`, with the folder relative to the project |
| `mod_clone` | `cloneMod`: a core mod, with `clonedFrom` |
| `layout_clone` | `cloneLayout`: the core's `main` |
| `harness_init` | `initHarness` into the mode's folder, which must be empty or new (`mcp/harness-tools.ts`). It skips `pnpm install` and `git init` unless `skipInstall: false` (then their output stays off stdout, the transport); it answers the files made and the next step |
| `harness_check` (read-only) | `checkHarness`, as `humanharness check` runs it, fixtures included: `{ ok, errors, warnings, notes }` |

No tool writes `harness.config.ts`: the descriptions of `mod_new` and `mod_clone` tell the agent that a mod is off
until it adds `<id>: {}` to the manifest's `mods` itself, and to declare a clone instead of its original.
`mcp-harness-tools.test.ts` drives harness mode through an in-process client: `harness_init` into an empty folder, then
`harness_check` clean.

**The kit** (`packages/cli/src/kit/`) holds the data functions the CLI and the server share: each takes the home
folder (or a `KitRoot`), returns data, and throws a `CliError` with the message to show. The CLI commands
(`app-commands.ts`, `mod-command.ts`) print what they return; the server answers it as JSON. `catalog` and `newMod`
have no CLI command yet.

**Adding a tool:** write the data function in `kit/` (exported from `kit/index.ts`) with its tests; add the name to
`APP_TOOLS` or `HARNESS_TOOLS`; add its entry to `appTools()` or `harnessTools()` in `server.ts` (a description for
the agent, a zod `inputSchema`, `readOnly` when it changes nothing, `run` through `answer`). An app tool goes in the
"Working with an agent" table and loop of `AGENTS.md` (`packages/shell/src/main/mods/manual.ts`): `manual.test.ts`
fails while one is missing there. A harness tool goes in the guide's Compose phase: `guide.test.ts` fails while one is
missing there. `mcp-tools.test.ts` checks the app list and each tool through an in-process client; the e2e
`mod-kit.spec.ts` drives the real server over stdio against the running app.

## What is still to come

See the spec's §7 order: the rest of step 1 (1a moved Sidekick's main side; its UI and channels follow), steps 2–5 (more features as mods), step 6 (harness code on mods; the plugin runtime is deleted), and steps 7–10 (`material`, `modes`/`phases`, `parallel`, `scopes`). Step 0c (0c1 the mod kit, 0c2 the harness kit) is done.
