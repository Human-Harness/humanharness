# End-to-end tests

Playwright drives the built desktop app (the demo harness) against the scripted fake agents in `packages/fake-agent`. No real engine, account or network is used.

    corepack pnpm e2e

The script builds the shell first. The app reads three development-only variables (a packaged app ignores them; see `packages/shell/src/main/test-hooks.ts`): `HH_TEST_USER_DATA` (its config folder), `HH_TEST_SHARED_DIR` (instead of `~/.humanharness`) and `HH_TEST_ENGINES` (the fake agents to run, which only receive `HH_FAKE_*` variables). Every test fakes both of the demo's engines, so not even a status check reaches a real CLI.

Each test works in `packages/e2e/.tmp/` (git-ignored), inside the repository: the app refuses folders under `/var` and `/private`, where macOS keeps the system's temporary files. On Linux CI, run it under `xvfb-run`.

`template.spec.ts` covers plan 4a's authoring path: it creates a harness with `humanharness init --skip-install` inside its sandbox, builds the app with `humanharness dev --build packages/shell/out/template` (git-ignored, removed at the end), launches that build and runs the template's example task with the fake Claude.

`phases.spec.ts` and `parallel.spec.ts` run harnesses other than the demo: each builds its fixture from `packages/fake-agent/fixtures/` (`phases-harness`, `parallel-harness`) into `packages/shell/out/<name>` with `electron-vite build` directly (`humanharness dev --build` would first run `check`, and a fixture has no HARNESS.md), then launches that build. `parallel.spec.ts` builds once for its serial tests and removes the build at the end; its fake Claude scenarios (`parallel`, `slow`) are in the fixture's `fake-script.json`.

## Manual run against the real engines

`real/` holds one test that drives the built app against a real engine: the demo's first topic, its blocks, the next step and the saved note. It is a manual check, never part of CI, and `corepack pnpm e2e` doesn't pick it up (`playwright.config.ts` only reads `tests/`).

It uses the real CLIs as they are signed in on this computer, so every run spends usage from your own subscription. Only the app's own state is redirected: `HH_TEST_USER_DATA` and `HH_TEST_SHARED_DIR` point inside the output folder, and `HH_TEST_ENGINES` is not set.

- `HH_REAL_OUT` (required): the folder for what the run leaves behind: screenshots, the answers' text, the choices offered, the console log, and a copy of the user's folder's `.harness` (notes included). The test stops with a clear message when it is missing.
- `HH_REAL_ENGINE`: `claude` (default) or `codex`.
- `HH_REAL_TIER`: `light`, `standard` or `deep`. The first topic runs at that level (written to the app's `config.json` as `models.tasks.manifest`), and the test checks the first `usage.jsonl` line: its `tier`, its `effort` and the model the engine reported (`reportedModel`: Claude's family name, or any model on Codex). It is saved as `<engine>-<tier>-usage.json`. A plan without that level's model falls back a level and the check fails, saying which level ran.

The test creates a temporary user's folder, `~/Documents/hh-real-test-<engine>-<time>` (it must sit outside the repository and outside `/private`), and removes it at the end, after copying its `.harness` out.

    HH_REAL_OUT=$HOME/hh-real-out HH_REAL_ENGINE=codex corepack pnpm --filter @humanharness/e2e real
    HH_REAL_OUT=$HOME/hh-real-out HH_REAL_TIER=light corepack pnpm --filter @humanharness/e2e real

The script builds the shell first, like `corepack pnpm e2e`.
