# Mods

Spec: `docs/superpowers/specs/2026-11-05-minimal-core-and-mods-design.md` ("§" below). This is step 0a: the API (`packages/mod-sdk`), the host in main (`packages/shell/src/main/mods/`) and Settings › Mods. No feature moves into a mod yet.

## What a mod is

A mod is a folder with a `mod.json` and a built main part that exports `defineMod({...})`. It changes the app's behaviour through hooks and services, and it runs in the main process with the app's own permissions: there is no sandbox. A mod comes from one of three origins:

- **core**: shipped with the app (`core-mods.ts`; empty in 0a, step 1 adds `sidekick`). Off unless a harness declares it or the person turns it on.
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
| `main` | Built entry, relative to the mod's folder, no `..`, not absolute. Default `main.js`. (0b adds bundling `main.ts`.) |

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

The demo declares no mods, so neither the app home nor `.harness/mods/` is created for it.

## What 0a doesn't have yet

See the spec's §7 order. Still to come: 0b (the home folder and layers, the layout, live reload, `AGENTS.md`/`hh.d.ts`, `check`/`shot`/`status`, bundling `main.ts`, wiring the ui side and `ipc`), 0c ("Change this app"), step 1 (`sidekick` as the first core mod), steps 2–5 (more features as mods), step 6 (harness code on mods; the plugin runtime is deleted), and steps 7–10 (`material`, `modes`/`phases`, `parallel`, `scopes`). No feature runs as a mod in 0a; `CORE_MODS` is empty.
