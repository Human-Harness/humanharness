# __NAME__

A [Human Harness](https://github.com/Human-Harness) plugin (`__ID__`). Its decisions live in [`PLUGIN.md`](PLUGIN.md). To shape it, open Claude Code or Codex in this folder and run `/new-plugin`.

    humanharness plugin build                            # build dist/: what the app loads
    humanharness plugin check                            # build, then check the manifest, the code, the fixtures and PLUGIN.md
    humanharness plugin test                             # run every source on its fixtures (no network, no keys)
    humanharness plugin record <source>                  # one real sync of a source, written as its fixtures
    humanharness plugin dev --harness <harness folder>   # open a harness with this plugin, on its fixtures

- `plugin.config.ts`: the manifest (sources, data, panels, chips, actions, permissions).
- `backend.ts`: the sources, run by the app in a sandbox, through its broker.
- `panels/<id>.tsx`: the panels, built with `@humanharness/plugin-ui`.
- `fixtures/<source>/`: recorded exchanges, for `test`, `dev` and the app's mock mode.
- `dist/`: what `build` writes and the app loads. Commit it with the sources.

There is nothing to install: `humanharness plugin build` uses the CLI's own copies of the SDK, plugin-ui and React.
