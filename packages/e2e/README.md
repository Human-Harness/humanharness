# End-to-end tests

Playwright drives the built desktop app (the demo harness) against the scripted fake agents in `packages/fake-agent`. No real engine, account or network is used.

    corepack pnpm e2e

The script builds the shell first. The app reads three development-only variables (a packaged app ignores them; see `packages/shell/src/main/test-hooks.ts`): `HH_TEST_USER_DATA` (its config folder), `HH_TEST_SHARED_DIR` (instead of `~/.humanharness`) and `HH_TEST_ENGINES` (the fake agents to run, which only receive `HH_FAKE_*` variables). Every test fakes both of the demo's engines, so not even a status check reaches a real CLI.

Each test works in `packages/e2e/.tmp/` (git-ignored), inside the repository: the app refuses folders under `/var` and `/private`, where macOS keeps the system's temporary files. On Linux CI, run it under `xvfb-run`.
