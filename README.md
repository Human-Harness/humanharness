# Human Harness

Open-source framework for building **harnesses**: installable desktop apps that put a purpose-built interface and workflow on top of an AI agent.

Each user brings **their own AI subscription** through the provider's official CLI, which the app installs and configures. No developer API keys, no terminals, no Node or git in sight: harnesses are made for non-technical people.

> **Status:** early development. The Node foundations (plan 1), the desktop app (plans 2a and 2b), the flow and context management (plans 3 and 3c) and the authoring CLI and guide (plan 4a) are in place: harnesses run their actions as tasks with one engine session each, keep notes in the user's folder and start every session from them. The demo harness is an architecture explainer for developers. Design: [`docs/superpowers/specs/`](docs/superpowers/specs/). Roadmap: [`docs/superpowers/plans/`](docs/superpowers/plans/).

## How it works

- **One harness = configuration + agentic flow + its own UI.** Engine, onboarding, files, history, languages, updates and packaging live in the core.
- **Engine-agnostic.** Harnesses talk to the core runtime, which picks the transport for each CLI: the unmodified official `claude` binary for Claude, [ACP](https://agentclientprotocol.com) for the rest (Codex today).
- **An engine is supported only if its terms allow it.** Working technically is not enough.
- **Users own their data.** It lives in a visible folder they choose, with an invisible local history to undo what the agent did. Nothing leaves their machine except toward the AI provider they picked. No telemetry.
- **Usage awareness.** The app shows where the user stands on their plan's limits before running heavy workflows.

## Stack

Electron · TypeScript · React · pnpm workspaces · MCP servers for harness tools and UI blocks · isomorphic-git for local history. macOS first, then Windows and Linux. The app ships in English; the AI thinks in English and answers in the person's language, and (plan 5b) the screens are translated into that language on their own engine.

## Repository layout

```
packages/
  harness-sdk/   defineHarness(), defineBlock() and public types
  engines/       engine registry with legal status
  workspace/     user folder, managed AGENTS.md, local history
  blocks/        `ui` MCP server for blocks + bridge to the runtime
  runtime/       claude-cli and ACP transports, turn orchestration
  fake-agent/    scripted fake agents for tests
  i18n/          core strings (es, en) and the harness namespace
  ui/            React kit: Home, Settings, onboarding, chat, blocks, usage
  shell/         the Electron app (main, preload, renderer)
  cli/           `humanharness`: init, check, run, dev; the harness template and the /new-harness guide
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

Run one task of a harness against a real engine you are signed in to (the report shows tokens per phase, the peak context and the cost hint):

    corepack pnpm humanharness run manifest --harness harnesses/demo --engine claude

Open the demo harness as a desktop app (macOS):

    corepack pnpm app:dev

## Create a harness

A harness lives in its own repository. Create one from the template and let the guide shape it:

    corepack pnpm humanharness init ~/code/my-harness
    cd ~/code/my-harness

Then open Claude Code or Codex in that folder and run `/new-harness`. The guide asks one question at a time about the task, the decisions the person makes, the flow, what each task keeps as a note, the models, the permissions and the identity; it records each decision in `HARNESS.md` and writes the code. Along the way:

    corepack pnpm check                          # validate the harness (HARNESS.md included)
    corepack pnpm run run <action> --engine claude   # run one task in the terminal, with a usage report
    corepack pnpm dev                            # open the app with this harness

`run` uses an engine only after its legal notice was accepted in the app on this computer: open the app once with `corepack pnpm dev` and set the engine up there first. In `run`, Ctrl-C stops the running turn, and at the prompt closes the task like `q`.

How it works: [`docs/architecture/authoring.md`](docs/architecture/authoring.md). The demo, [`harnesses/demo`](harnesses/demo), is a complete example to read, not a starting point.

You are responsible for what your harness does with the AI and for the engines you offer: each user brings their own account under their provider's terms.

## License

[Apache-2.0](LICENSE)
