# On this day

The demo harness's bundled plugin (`on-this-day`): today's events from Wikimedia's public "On this day" feed in a panel, a chip and the Attention inbox, with an "Explain" action that prepares a question. Its decisions live in [`PLUGIN.md`](PLUGIN.md). It starts off: turn it on in Settings › Plugins.

    humanharness plugin build                               # rebuild dist/ after changing a source (commit both)
    humanharness plugin check                               # build, then check the manifest, the code, the fixtures and PLUGIN.md
    humanharness plugin test --now 2026-10-27T12:00:00      # run the source on its fixture (no network)
    humanharness plugin dev --harness ../..                 # open the demo with this plugin, on its fixture

- `plugin.config.ts`: the manifest.
- `backend.ts`: the `events` source.
- `panels/events.tsx` and `panels/events.css`: the panel.
- `fixtures/events/001.json`: a hand-made exchange with 25 synthetic events (1901–1925), for any date.
- `dist/`: what the app loads. `harnesses/demo/test/on-this-day.test.ts` fails when it differs from a fresh build.
