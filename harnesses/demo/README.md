# Demo harness

The smallest harness: the core's tests use it, and it shows every piece a harness provides. Run it as a desktop app from the repository root:

    corepack pnpm app:dev

## Files

| File | What it is |
|---|---|
| `harness.config.ts` | The manifest (`defineHarness`): id, name, tagline, languages, engines it was tested with, suggested folder and seed, instructions, permissions, blocks, actions, author. Loaded from plain Node, so it holds no React. |
| `agent/AGENTS.md` | Instructions for the AI. On every start the core adds a managed section (response language, environment rules, how to use each block) and the file each engine expects (`CLAUDE.md` for Claude). |
| `agent/seed/` | Copied into the user's folder the first time. |
| `ui/App.tsx` | The harness UI: mounts the kit's `HarnessApp` with its block components, the names of its state-only blocks, the side panel and its translations. The side panel's button starts the `tidy` action, which is declared `heavy`, so the app may ask before running it. |
| `ui/NoteCard.tsx` | The React component for the `note` block (`show_note`). Each visible block in the manifest has a component registered under the same name. |
| `locales/es.json`, `locales/en.json` | The harness's own strings, read with `useTranslation("harness")`. Every language in the manifest needs every key. |
| `package.json` | Its dependencies (the SDK, the UI kit, React, zod). |

## Blocks

- `note` (visible): the agent calls `show_note` with `{ title, body }`; the chat renders `NoteCard`.
- `progress` (state only): the agent calls `update_progress` with `{ percent }`; the side panel shows it and the chat log keeps it, so it is back after a restart.

## Actions

- `tidy` (`heavy`): started from the side panel. Each turn it starts is tagged in `.harness/usage.jsonl`, which is how the app learns what it usually costs.
