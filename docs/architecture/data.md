# Scopes and harness data

Spec: `docs/superpowers/specs/2026-10-25-scopes-and-data-design.md`.

## Scopes

- A harness that declares `scopes` (a label and a plural) splits the work into scopes the person opens one at a time: a topic, a project. Each scope has its own tasks, notes, notes index, chat, action statuses and data.
- The registry is `.harness/scopes.json` (`ScopeStore` in `packages/workspace/src/scopes.ts`): id, title, creation date, archived. Ids are slugs of the title (`^[a-z0-9][a-z0-9-]{0,63}$`). Writes are atomic and one at a time; a file that isn't JSON is set aside as `scopes.json.corrupt-<time>`.
- Scopes are archived, never deleted. An archived scope can't be opened (`scopeExists` counts it as missing). Archiving the open scope closes its task and the scope first (`hh:scopeArchive`).
- Paths come from one place, `packages/workspace/src/layout.ts`, relative to a base folder. In the shell the base is `baseOf(config)`: the configured folder, or the active profile's folder (`<folder>/<profile>`) in a harness with profiles (`docs/architecture/profiles.md`).
- Where a task runs (`TaskManager.scopeFor`): an action marked `scope: "none"` runs in `_app`, the app-wide folder; any other action needs an open scope; a free question runs in the open scope, or in `_app` when none is open.
- What changes per scope: notes go to `.harness/notes/<scope>/`, the chat to `.harness/chats/<scope>.jsonl`, the action statuses to `tasks.json` → `scopes.<scope>`, usage lines carry `scope`, and the history commits carry a `Scope:` trailer. A task in a scope starts from its scope's notes index plus a short app-wide one.
- Without `scopes` nothing changes (spec D2): notes stay flat, the chat is `chats/main.jsonl`, `tasks.json` and the usage lines get no new fields.
- Migration: when a harness adds `scopes`, the first start moves the flat notes into `notes/main/` and registers `main` ("General"); a folder with only data in `data/main/` is migrated too, so that data stays reachable (`migrateToScopes` in `packages/workspace/src/migrate.ts`). The registry is written last, so it marks the migration done and a crash leaves it to run again. The move never overwrites (a note already in `main` wins): it hard-links, or copies exclusively where the filesystem has no hard links. The window waits for the migration before it asks for the scopes (`scopesSettled` in `packages/shell/src/main/index.ts`). `humanharness run` opens a `run` scope for actions that need one.

## Data

- The manifest's `data` declares collections (`packages/harness-sdk/src/data.ts`): a zod object schema, a `key` (or `single: true`), `scoped`, what the agent may do (`agent`: `write`, `read`, `none`), what goes into the first message (`context`), and optional `rules`.
- `settings` is a reserved collection name: a harness with `settings` gets it from the core (app-wide, one record, hidden from the agent, read field by field). See `docs/architecture/settings.md`.
- The key must be a field declared exactly as `z.string()` or `z.number()`: an enum, literal, optional, nullable or defaulted field is refused. `single: true` with a `key` is accepted, but the key is unused.
- Storage (`DataStore` in `packages/workspace/src/data.ts`): one JSON file per collection and scope, `.harness/data/<scope>/<collection>.json` (`_app` for app-wide ones), records sorted by key, two-space indented. Writes are atomic and one at a time; nothing is cached, so a hand edit is seen at once. A file a hand edit broke is never overwritten: reads skip its invalid records (a duplicate key counts as invalid), writes are refused until it is fixed or restored.
- Records are stored as the schema parses them: zod drops fields the schema doesn't name.
- Every write is checked in this order: permission (the agent writes only `write` collections), schema, key, then the harness's `rules(next, prev, ctx)`. `rules` gets copies and a snapshot of the other collections of the same scope (and the app-wide ones). It must be pure, fast and synchronous: one slower than 100 ms is logged, and an async rule is refused with a message saying rules must be synchronous. A collection whose file is broken appears empty to the rules (and is logged).
- When each record last changed is kept in `.harness/data-meta/` (never in the history); the context uses it for "most recently changed first".
- One `DataStore` serves each base folder (`dataStoreFor` in `packages/shell/src/main/index.ts`), shared by the person's and the agent's writes, so one queue orders them all.
- In a harness with profiles the data folder is under the profile: `<folder>/<profile>/.harness/data`. Every write to the `profile` collection, from any writer, makes the registry copy the record's `name` and `color` as the profile's `title` and `color` (`Profiles.sync`; `docs/architecture/profiles.md`).
- The history tracks `.harness/data/`, so undo covers data. The agent's writes land in its turn's commit. The person's writes (`personDataRequests` in `packages/shell/src/main/data-requests.ts`) run one at a time, each with its own `Data: <collection>` commit under the open task's trailer. A person's write while an agent turn runs also commits the agent's half-done file edits under that "Data: …" commit; undo per task still works.

## How the agent and the harness UI reach it

- The `data` MCP server (`packages/blocks/src/data-server.ts`) starts next to `ui` only when a collection is visible to the agent. Its tools (`data_get`, `data_query`, and for `write` collections `data_put`, `data_patch`, `data_delete`) ask the app over a private request/answer socket (`openRpc` in `packages/blocks/src/bridge.ts`); the app runs them as the agent in the running task's scope (`agentDataRequest` in `packages/shell/src/main/data-requests.ts`).
- The collections (key, scope, permission, fields) are described once, compactly, in `data_query`'s description; the other tools point to it.
- A refusal comes back to the agent as `Refused: <why>`. Any other error is logged and the agent gets a generic message ("Something went wrong with the data"), so no file path leaks. If the app can't be reached the tool says so and tells the agent not to retry in a loop.
- A harness whose id is `ui` or `data` can't have `mcp` entries: its servers are named after its id, and those are the built-in server names.
- A new session's first message gets one table per collection with `context`, after the notes index (`buildDataContext` in `packages/workspace/src/data-context.ts`). Each table stays within its `tokens`: the "… N more" footer is counted in the budget, and the first row is shortened until it fits.
- The harness UI uses `HarnessClient.data` (`get`, `query`, `put`, `patch`, `delete`, `subscribe`), which runs as the person in the open scope (or a registered, unarchived one it names; `_app` always) with the same checks (`subscribe(collection, scope)` hears an app-wide collection whatever scope it is given; the reserved `settings` collection it reads but never writes: it changes through `client.settings.set/reset`), and `dataDiff(taskId)`, which reads a task's record changes from the history (`packages/workspace/src/data-diff.ts`). `dataDiff` skips a collection when its version at the task's start or end is broken, and covers only tasks within the history's recent window (`History.tasks` default depth): an older task has no diff.
- `material.items` (`docs/architecture/material.md`) links fragments of the person's material to the records of a keyed collection the agent can see: the links stage gets the first 200 records of the scope's collection (or the app-wide one) as `key: label`, and a fragment stores the keys it covers. The material registry (`.harness/material/<scope>/sources.json`) is the core's, not a collection: it never shows in the data tools or `HarnessClient.data`.
- A setup step's form writes as the person, app-wide, through `hh:data` (a `Data: <collection>` commit); an interview writes through the agent's data tools. Both need a `single`, unscoped collection, and an interview's needs `agent: "write"` (`docs/architecture/setup.md`).

## Known gaps

- One file per collection is meant for hundreds of records (spec §7.2); measure before using it for thousands.
- A hand edit is noticed on the next read, not as it happens: there is no file watcher.
- Rules can't be stopped when slow; they are only reported.
- The data tools act only on the running task's scope (they take no scope argument), so the agent can't reach another scope's data.
