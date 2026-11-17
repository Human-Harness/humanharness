# example-harness

A [Human Harness](https://github.com/Human-Harness) harness. Its decisions live in [`HARNESS.md`](HARNESS.md). To shape it, open Claude Code or Codex in this folder and run `/new-harness`.

The harness is composed of mods: its blocks live in `mods/<id>/` (the sample is `mods/example/`, a UI-only mod) and `layouts/main.json` says where they go. The manifest turns each mod on in its `mods` map.

    corepack pnpm check                         # validate the harness
    corepack pnpm dev                           # open the app with this harness (accept the engine's notice once here)
    corepack pnpm run run example               # run one task in the terminal (the engine's CLI must be signed in)
