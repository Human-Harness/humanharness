# Human Harness

Open-source framework for building **harnesses**: installable desktop apps that put a purpose-built interface and workflow on top of an AI agent.

Each user brings **their own AI subscription** through the provider's official CLI, which the app installs and configures. No developer API keys, no terminals, no Node or git in sight: harnesses are made for non-technical people.

> **Status:** early development. The Node foundations (plan 1) are in place: a harness can run full turns against Claude and Codex from the terminal. The desktop app is next. Design: [`docs/superpowers/specs/`](docs/superpowers/specs/). Roadmap: [`docs/superpowers/plans/`](docs/superpowers/plans/).

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
harnesses/
  demo/          minimal harness used by the tests
docs/            specs, plans and spikes
```

Planned: `shell` (Electron), `ui` (React kit), `i18n`, `harnesses/socrates`, `tooling/`.

## Development

Requires Node ≥ 22 and pnpm (via corepack).

    corepack pnpm install
    corepack pnpm test
    corepack pnpm typecheck

Run one harness turn against a real engine you are logged in to:

    corepack pnpm hh-dev --harness harnesses/demo/harness.config.ts --folder /tmp/hh-demo --engine claude "Make a note titled Groceries"

## License

[Apache-2.0](LICENSE)
