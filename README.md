# Human Harness

Open-source framework for building **harnesses**: installable desktop apps that put a purpose-built interface and workflow on top of an AI agent.

Each user brings **their own AI subscription** through the provider's official CLI, which the app installs and configures. No developer API keys, no terminals, no Node or git in sight: harnesses are made for non-technical people.

> **Status:** early development. The Node foundations (plan 1), the desktop app (plans 2a and 2b) and the flow and context management (plan 3) are in place: harnesses run their actions as tasks with one engine session each, keep notes in the user's folder and start every session from them. The demo harness is an architecture explainer for developers. Design: [`docs/superpowers/specs/`](docs/superpowers/specs/). Roadmap: [`docs/superpowers/plans/`](docs/superpowers/plans/).

## How it works

- **One harness = configuration + agentic flow + its own UI.** Engine, onboarding, files, history, languages, updates and packaging live in the core.
- **Engine-agnostic.** Harnesses talk to the core runtime, which picks the transport for each CLI: the unmodified official `claude` binary for Claude, [ACP](https://agentclientprotocol.com) for the rest (Codex today).
- **An engine is supported only if its terms allow it.** Working technically is not enough.
- **Users own their data.** It lives in a visible folder they choose, with an invisible local history to undo what the agent did. Nothing leaves their machine except toward the AI provider they picked. No telemetry.
- **Usage awareness.** The app shows where the user stands on their plan's limits before running heavy workflows.

## Stack

Electron · TypeScript · React · pnpm workspaces · MCP servers for harness tools and UI blocks · isomorphic-git for local history. macOS first, then Windows and Linux. Spanish and English from v1.

## Repository layout

```
packages/
  harness-sdk/   defineHarness(), defineBlock() and public types
  engines/       engine registry with legal status
  workspace/     user folder, managed AGENTS.md, local history
  blocks/        `ui` MCP server for blocks + bridge to the runtime
  runtime/       claude-cli and ACP transports, turn orchestration, `hh-dev`
  fake-agent/    scripted fake agents for tests
  i18n/          core strings (es, en) and the harness namespace
  ui/            React kit: Home, Settings, onboarding, chat, blocks, usage
  shell/         the Electron app (main, preload, renderer)
harnesses/
  demo/          architecture explainer (development only)
docs/            specs, plans and spikes
docs/architecture/  short curated docs the explainer starts from
```

Planned: `harnesses/socrates`, `tooling/`.

## Development

Requires Node ≥ 22 and pnpm (via corepack).

    corepack pnpm install
    corepack pnpm test
    corepack pnpm typecheck

Run one harness turn against a real engine you are logged in to:

    corepack pnpm hh-dev --harness harnesses/demo/harness.config.ts --folder /tmp/hh-demo --engine claude "In two sentences, what is a harness?"

Open the demo harness as a desktop app (macOS):

    corepack pnpm app:dev

## Create a harness

A harness is a folder with a manifest, instructions for the AI, its own UI and its strings. Start from [`harnesses/demo`](harnesses/demo) (its README explains each file):

1. Copy `harnesses/demo` to `harnesses/<your-id>` and change `name` in its `package.json`.
2. Edit `harness.config.ts`:
   - `id`, `name`, `tagline`, `languages`, `author`, and optionally `logo` (shown on Home), `donate` (a Support link in Settings → About) and `repo` (your source repository; kept in the manifest, the app doesn't show it yet).
   - `engines`: the engines you tested with. Users only see the ones whose terms allow this use (see §5 of the core spec, [`docs/superpowers/specs/2026-10-10-humanharness-core-design.md`](docs/superpowers/specs/2026-10-10-humanharness-core-design.md)).
   - `folder.suggested` and `folder.seed`: where the user's work lives and what is copied there the first time.
   - `permissions`: `edit: "folder"` or `"none"`, `exec`, `web`.
   - `blocks`: one `defineBlock({ description, visible, schema, example })` per piece of UI the AI can show (`visible: true`) or update silently (`visible: false`).
   - `actions`: the tasks your harness offers, each with a `label`, an optional `description`, a `prompt` (a brief in your harness folder; `{{language}}` and `{{notesIndex}}` are filled in) and a `cost` of `light`, `medium` or `heavy`. Heavy ones may ask the user first when their plan is close to its limit. Each task runs in its own engine session and ends with a note in `.harness/notes/`.
   - `path` (optional): the order of the guided path shown in the side panel.
   - `folder.references` (optional): folders the AI may read but never change.
3. Write `agent/AGENTS.md`: what the AI does and when it calls each block's tool (`show_<block>` / `update_<block>`). Every harness also has two core tools: `show_choices`, which ends each answer with ways to continue, and `save_note`, which the app asks for when a task closes.
4. Write `ui/App.tsx`: mount `HarnessApp` with a component per visible block, your locales and, for the work screen's start view, `startView` (keys of your strings for its title, intro, frequent questions and the line under the composer). State-only blocks and a right-hand panel (`stateBlocks`, `renderSide`) are still available.
5. Add `locales/es.json` and `locales/en.json` with every key in each language.
6. Run it: `corepack pnpm install`, then `HH_HARNESS_DIR="$PWD/harnesses/<your-id>" corepack pnpm app:dev` (an absolute path: the app resolves it from `packages/shell`).

You are responsible for what your harness does with the AI and for the engines you offer: each user brings their own account under their provider's terms.

## License

[Apache-2.0](LICENSE)
