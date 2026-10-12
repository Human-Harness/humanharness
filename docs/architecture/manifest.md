# The manifest

A harness is a folder whose `harness.config.ts` default-exports `defineHarness({...})` from `@humanharness/harness-sdk`. `defineHarness` validates the object with zod and fills the defaults; `loadHarness` imports it from plain Node (so the manifest holds no React), records the harness folder as `root` and checks every action's brief.

## What each field does

| Field | What the core does with it |
|---|---|
| `id`, `name`, `tagline`, `logo` | The app's name and data folder, the Home screen |
| `author`, `donate` | Settings → About |
| `languages` | Languages the interface and the agent may use (`es`, `en`) |
| `engines` | Engines the harness was tested with; `availableEngines` in `packages/engines` keeps the ones whose legal status allows it |
| `folder.suggested`, `folder.seed` | Where the person's work lives; the seed is copied there when the folder is empty (`prepareFolder`) |
| `folder.references` | Folders the agent may read but never change; `"app-source"` is the repository the app runs from, in development only |
| `instructions` | The base `AGENTS.md`; the core appends a managed section (`writeInstructions`) |
| `permissions` | `edit` (`folder` or `none`), `exec`, `web`: turned into Claude's allowed and denied tools and into Codex's permission answers |
| `blocks` | `defineBlock({ description, visible, schema, example })`: one MCP tool per block, served by the `ui` server |
| `actions` | Tasks: `label`, optional `description`, `prompt` (the brief that opens the task's session) and `cost` (`light`, `medium`, `heavy`) |
| `path` | The optional guided order of action ids (the "Recorrido") |
| `mcp` | Extra MCP servers (files in the harness folder) the agent gets next to `ui` |

The harness's screen is `ui/App.tsx`: the shell build (`packages/shell/electron.vite.config.ts`) bundles it from the harness folder.

## Checks

- Block and action names follow fixed patterns. `choices` and `save_note` are reserved: every harness gets them as core blocks (`allBlocks`).
- Every id in `path` must be an action, once; reference ids are unique.
- A block's `example` must match its `schema`.
- `resolveInHarness` refuses any path that leaves the harness folder: every action's prompt (checked by `loadHarness`), and the instructions, seed, logo and MCP servers when they are used.

## Where to look

- `packages/harness-sdk/src/index.ts`: the schema, `defineHarness`, `loadHarness`, `resolveInHarness`.
- `packages/harness-sdk/src/block.ts` and `core-blocks.ts`: blocks and the core blocks.
- `harnesses/demo/harness.config.ts`: a complete manifest.
