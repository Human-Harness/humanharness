# Decisions — mods-0b2-user-layer

Plan: /Users/marcozanger/.claude/arkimedes/desk/humanharness/mods-0b2-user-layer/plan.md · approved 2026-11-12 · closed 2026-11-12
Jobs: 5 merged, 0 blocked · Decisions: 10 worker, 0 reviewer, 3 arkimedes

## user-layer — merged

- **D1** · A user mod's review reuses the existing `hh:modReviewLocal` channel with an optional id (no id still opens the folder dialog). A reload reaches the window through `hh:modsChanged`. · _worker (T2)_
  <details><summary>more</summary>

  Why: packages/protocol (the channel table) and the preload are outside the job's area, and the protocol test rejects channels that main names but the table lacks.
  Rejected: new channels `hh:modReviewUser` / `hh:modReloaded` with casts (fail the integration gate); hiding them from the scanner (defeats the guard).
  See: https://github.com/Human-Harness/humanharness/pull/158 · report `runs/humanharness/mods-0b2-user-layer/user-layer.report.md`
  </details>

- **D2** · A user mod's main part gets shared modules through generated `.mjs` shims over the app's in-memory modules. React and ui throw in main. · _worker (T2)_
  <details><summary>more</summary>

  Why: the shell can't depend on zod directly, and mods must share the app's own copies, packaged or not.
  Rejected: externals pointing at node_modules paths (break when packaged).
  See: https://github.com/Human-Harness/humanharness/pull/158 · report `runs/humanharness/mods-0b2-user-layer/user-layer.report.md`
  </details>

## mod-ui — merged

- **D3** · `esbuild` and `zod` were added to the shell's `dependencies`, and `electron.vite.config.ts` was left unchanged. This differs from the approved q1 proposal, which changed the config. · _worker (T2)_
  <details><summary>more</summary>

  Why: electron-vite already leaves dependencies out of the main bundle, so one change fixes both the build and runtime resolution.
  Rejected: an `externalizeDeps.include` entry in the config, which would still fail at runtime without the dependency.
  See: https://github.com/Human-Harness/humanharness/pull/159 · report `runs/humanharness/mods-0b2-user-layer/mod-ui.report.md`
  </details>

- **D4** · `hh-mod:` is registered with `corsEnabled: true` and answers `access-control-allow-origin: *`. This goes beyond the `?v=` change in q1. · _worker (T2)_
  <details><summary>more</summary>

  Why: Chromium blocks the window's `import()` from file:// as cross-origin, and the e2e needed it. The handler lives only on the app window's session and serves only on, non-core mods.
  Rejected: `bypassCSP`; serving the window from a custom scheme. Limiting the origin to file:// / null stays open if `*` is unwanted.
  See: https://github.com/Human-Harness/humanharness/pull/159 · report `runs/humanharness/mods-0b2-user-layer/mod-ui.report.md`
  </details>

- **D5** · mod-ui's area was widened to five main-side files (shell package.json, main/index.ts, host.ts, mod-scheme.ts + test, pnpm-lock.yaml). The job then blocked three times because the runner still checked the original area. Marco's q3 answer had the worker merge the same files from the integration branch, so they dropped out of the job diff. · _arkimedes_
  <details><summary>more</summary>

  Why: the gate was green, but the area check failed on every attempt, so another attempt could not clear it. The five files were already on origin/ark/mods-0b2-user-layer with identical content.
  Rejected: another attempt with the same area (would block the same way); limiting CORS to file:// / null in an over-budget attempt (Marco accepted `*`).
  See: https://github.com/Human-Harness/humanharness/pull/159 · report `runs/humanharness/mods-0b2-user-layer/mod-ui.report.md`
  </details>

## layouts — merged

- **D6** · `LayoutView` carries `picked?` (the name in `settings.json`) in addition to the briefed `source`, `name` and `choices`. · _worker (T2)_
  <details><summary>more</summary>

  Why: the picker has to show the person's pick even when it fell back to another layout.
  Rejected: showing `name`, which would hide a broken pick behind the fallback.
  See: https://github.com/Human-Harness/humanharness/pull/160 · report `runs/humanharness/mods-0b2-user-layer/layouts.report.md`
  </details>

- **D7** · `user-mod.spec` runs on the shell's default demo build, not the `user-mod-harness` fixture. The fixture is now unused, and deleting it is outside this job's area. · _worker (T2)_
  <details><summary>more</summary>

  Why: the brief drops the fixture-harness trick, and it saves an extra electron-vite build.
  Rejected: keeping the fixture, whose `main.json` places hello itself.
  See: https://github.com/Human-Harness/humanharness/pull/160 · report `runs/humanharness/mods-0b2-user-layer/layouts.report.md`
  </details>

## manual-cli — merged

- **D8** · `hh.d.ts` lives at `packages/shell/scripts/hh.d.ts` (imported with `?raw`), not under `src/main/mods/` as the brief says. · _worker (T2)_
  <details><summary>more</summary>

  Why: an ambient `declare module "@humanharness/mod-sdk"` inside any tsconfig include overrides the real package repo-wide and broke typecheck.
  Rejected: the brief's path under src.
  See: https://github.com/Human-Harness/humanharness/pull/161 · report `runs/humanharness/mods-0b2-user-layer/manual-cli.report.md`
  </details>

- **D9** · `mod check` renders blocks with a runtime esbuild bundle and reuses the shell's `writeMainShims` through a new export, `@humanharness/shell/mod-shims`. · _worker (T2)_
  <details><summary>more</summary>

  Why: plain node can't import @humanharness/ui because of its CSS imports.
  Rejected: a copy of the shims in the CLI.
  See: https://github.com/Human-Harness/humanharness/pull/161 · report `runs/humanharness/mods-0b2-user-layer/manual-cli.report.md`
  </details>

- **D10** · The integration gate failed repeatedly on load-related test timeouts. Marco approved extra spend ($5 for q4, $3 for q5) for test-only fixes: longer timeouts in `user-layer`, `mod-command` and `guide-tools`, and a wider quiet window in the `documents.test.ts` DocumentWatchers test. The job ended at about $27 of its $15 budget. · _arkimedes_
  <details><summary>more</summary>

  Why: the review was CLEAN and the job's own work passed the full gate. The failures were existing flaky tests under load, not the job's code.
  Rejected: stopping the job; changing src; raising `testTimeout` globally (outside the area).
  See: https://github.com/Human-Harness/humanharness/pull/161 · report `runs/humanharness/mods-0b2-user-layer/manual-cli.report.md`
  </details>

- **D11** · The run went over its $72 budget ($74.39) and paused with nothing new starting. Marco answered `raise 40`, which let the manual-cli worker finish and safety-history run. · _arkimedes_
  <details><summary>more</summary>

  Why: manual-cli was already close to merging and safety-history was still queued.
  Rejected: `stop`, which would have ended the run with two jobs unmerged.
  See: report `runs/humanharness/mods-0b2-user-layer/manual-cli.report.md`
  </details>

## safety-history — merged

- **D12** · The home history's ignore list is rebuilt from the folder on every operation. · _worker (T2)_
  <details><summary>more</summary>

  Why: isomorphic-git's statusMatrix never reads `<gitdir>/info/exclude`, so `.control.json` and `.error` files were tracked otherwise.
  Rejected: an info/exclude file; changing `@humanharness/workspace` (outside the area).
  See: https://github.com/Human-Harness/humanharness/pull/162 · report `runs/humanharness/mods-0b2-user-layer/safety-history.report.md`
  </details>

- **D13** · The safe-mode notice shows inside the window (`hh:safeMode` pulled on mount plus the `hh:safeModeEntered` push). The e2e presses the escape hatch with `webContents.sendInputEvent`. · _worker (T2)_
  <details><summary>more</summary>

  Why: e2e can check and screenshot an in-window notice, and `sendInputEvent` goes through Electron's real input path. A key Playwright sends over CDP never reaches `before-input-event`.
  Rejected: an OS notification or the mods' `notify` (untestable, short-lived); calling safe mode through IPC (skips the key check).
  See: https://github.com/Human-Harness/humanharness/pull/162 · report `runs/humanharness/mods-0b2-user-layer/safety-history.report.md`
  </details>
