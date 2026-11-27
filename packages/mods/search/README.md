# Search

Global search: the index of the folder's files, chats, tasks, actions and searchable data, and the two calls the palette
makes (`hh:search`, `hh:searchOpen`). The full design is in `docs/architecture/search.md`; the palette (⌘K) is still in
`packages/ui` and moves here in the next step.

Search is a core mod: it ships with the app and is on by default. This is its main side:

- `src/service.ts` is the lazy service (one live index per base, the worker's batches applied here); `store.ts`, `walk.ts`,
  `read.ts`, `build.ts`, `views.ts`, `data-sources.ts` and `ipc.ts` are its parts. `worker.ts` is the build's worker thread
  (the core-mod build emits it as `worker.js`, beside `main.js`).
- `main.ts` builds the service from `ctx.app.search` (what it reads of the app: the user data folder, scopes, references,
  tasks, the data store) and hears the core's events: `dataChanged`, `restored`, `baseGone` and `close`.
- The two calls are answered under their existing app channel names (`ctx.handle`), and the index's status goes out on
  `hh:searchStatus`. With the mod off the calls answer a refusal (`not-ready`).
- `packages/search` stays the index library; this mod depends on it.
