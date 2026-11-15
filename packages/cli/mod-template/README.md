# __TITLE__

__DESCRIPTION__

## Files

- `mod.json`: the id, name and version, and the source of each part (`main`, `ui`).
- `main.ts`: runs in the app (node): hooks, ipc, storage. Gets a `MainCtx`.
- `ui.tsx`: runs in the window: registers the block `__BLOCK__`. Gets a `UiCtx`.

`../../hh.d.ts` has the types of both; `../../AGENTS.md` is the manual.

## Imports

A mod may import only __IMPORTS__, and its own files inside this folder. Anything else is refused when the app
bundles it. `main` gets `zod` and `@humanharness/mod-sdk`; `react` and `@humanharness/ui` are for `ui` only.

## Show it

Place the block in a layout (`layouts/<name>.json`):

```json
{ "type": "block", "content": { "mod": "__ID__", "block": "__BLOCK__" } }
```

Check it with `humanharness mod check mods/__ID__`. A new mod is off: the person turns it on in Settings › Mods.
