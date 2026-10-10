# Human Harness

Open-source framework for building **harnesses**: installable desktop apps that put a purpose-built interface and workflow on top of an AI agent.

Each user brings **their own AI subscription** through the provider's official CLI, which the app installs and configures. No developer API keys, no terminals, no Node or git in sight: harnesses are made for non-technical people.

> **Status:** early design. Nothing to install yet. The core design spec lives in [`docs/superpowers/specs/`](docs/superpowers/specs/).

## How it works

- **One harness = configuration + agentic flow + its own UI.** Engine, onboarding, files, history, languages, updates and packaging live in the core.
- **Engine-agnostic.** Harnesses talk to the core's engine layer, which speaks [ACP](https://agentclientprotocol.com) to the underlying agent CLI.
- **An engine is supported only if its terms allow it.** Working technically is not enough.
- **Users own their data.** It lives in a visible folder they choose. Nothing leaves their machine except toward the AI provider they picked. No telemetry.

## Planned stack

Electron · TypeScript · React · pnpm workspaces · MCP servers for harness tools and UI blocks · isomorphic-git for local history. macOS first, then Windows and Linux. Spanish and English from v1.

## Repository layout (planned)

```
packages/    core: engines, motor (ACP client), workspace, blocks, ui, shell, harness-sdk…
harnesses/   socrates — reference harness
tooling/     build, check, create-harness
docs/        specs and plans
```

## License

[Apache-2.0](LICENSE)
