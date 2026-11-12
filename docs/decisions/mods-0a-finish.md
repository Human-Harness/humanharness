# Decisions — humanharness/mods-0a-finish

Plan: /Users/marcozanger/.claude/arkimedes/desk/humanharness/mods-0a-finish/plan.md · approved 2026-11-12 · closed 2026-11-12
Jobs: 3 merged, 0 blocked · Decisions: 3 worker, 0 reviewer, 0 arkimedes

## e2e-ready — merged

- **D1** · Only the e2e specs that run the app get the sandbox HOME and USERPROFILE. Specs that only run `electron-vite build`, or that spawn a second instance (the flow.spec single-instance check), keep the real env. · _worker (Sonnet 5.5)_
  <details><summary>more</summary>

  Why: The brief says builds keep the real env. The second instance only needs the same userData.
  Rejected: Forcing HOME on those specs too.
  See: https://github.com/Human-Harness/humanharness/pull/144 · report `runs/humanharness/mods-0a-finish/e2e-ready.report.md`
  </details>

## settings-ui — merged

- **D2** · The Settings › Mods tab was cherry-picked from the old branch with its UI choices unchanged. These include the `mods.line` and `mods.error` copy, a ghost Remove button for local mods only, non-mod folders shown as rows with a red "Couldn't start" line, the Add problem shown as main's raw text in a red Callout, and the review heading at size 5. · _worker (Sonnet 5.5)_
  <details><summary>more</summary>

  Why: Impeccable made these decisions on the old branch. The worker carried them over and checked the local badge and warning against T11–T12.
  Rejected: Redesigning the tab on the new master. No alternatives were reported.
  See: https://github.com/Human-Harness/humanharness/pull/145 · report `runs/humanharness/mods-0a-finish/settings-ui.report.md`
  </details>

## docs-gate — merged

- **D3** · The local-mod warning in docs/architecture/mods.md is described by meaning ("the mod's code runs inside the app") and not quoted. · _worker (Sonnet 5.5)_
  <details><summary>more</summary>

  Why: The string lives in the UI i18n catalogue, which the worker could not locate in the area.
  Rejected: Quoting a guessed string.
  See: https://github.com/Human-Harness/humanharness/pull/146 · report `runs/humanharness/mods-0a-finish/docs-gate.report.md`
  </details>
