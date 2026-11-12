# Mods

Spec: `docs/superpowers/specs/2026-11-05-minimal-core-and-mods-design.md` ("§" below). Step 0a is the API (`packages/mod-sdk`), the host in main (`packages/shell/src/main/mods/`) and Settings › Mods. Step 0b1 adds the home folder, the layout and the first core mod, Home (sections below).

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

Services and fields:

- `id`: the mod's id.
- `config`: the parsed `mods.<id>`; `undefined` without a schema and a declaration.
- `ipc(name, handler)`: a channel the mod's own ui will call (0b wires the ui side).
- `engine.run(tier, prompt, opts?)`: a tool-less session of the mod's own on `light`/`standard`/`deep`, outside the work folder; usage is tagged `mod:<id>`.
- `tasks.running()`: the running task or `null`.
- `notes.titles(scope?)`: note titles.
- `storage.get/set`: app-private JSON (see Data).
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

A core mod is a package under `packages/mods/<id>` with `mod.json`, `README.md` and `src/`. The shell build (`electron.vite.config.ts`) copies those files to `out/core-mods/<id>/`, which is what the home folder's `core/` layer holds. Its ids and default switches are `CORE_MOD_SWITCHES` (`core-mods.ts`: `core-mod-list.ts` plus `home`, on). The renderer entry (`packages/shell/src/renderer/main.tsx`) imports each core mod's package and runs its `ui` before the first render, registering its blocks in the registry the layout draws from. Home (`packages/mods/home`) is the first: the screen the app opens on.

## What 0b2 adds

The user layer (`mods/` and `layouts/` in the home folder, including the `-edited` items), live reload, the manual (`AGENTS.md`/`hh.d.ts`), `check`/`shot`/`status`, the escape hatch, the home folder's history, bundling `main.ts` and wiring `ipc` to the ui side.

## What is still to come

See the spec's §7 order: 0c ("Change this app"), step 1 (`sidekick` as a core mod), steps 2–5 (more features as mods), step 6 (harness code on mods; the plugin runtime is deleted), and steps 7–10 (`material`, `modes`/`phases`, `parallel`, `scopes`).
