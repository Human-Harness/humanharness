# example-harness

A [Human Harness](https://github.com/Human-Harness) harness. Its decisions live in [`HARNESS.md`](HARNESS.md). To shape it, open Claude Code or Codex in this folder and run `/new-harness`.

    corepack pnpm check                         # validate the harness
    corepack pnpm dev                           # open the app with this harness (accept the engine's notice once here)
    corepack pnpm run run example               # run one task in the terminal (the engine's CLI must be signed in)
