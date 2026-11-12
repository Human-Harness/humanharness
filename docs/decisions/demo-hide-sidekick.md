# Decisions — demo-hide-sidekick

Plan: /Users/marcozanger/.claude/arkimedes/desk/humanharness/demo-hide-sidekick/plan.md · approved 2026-11-12 · closed 2026-11-12
Jobs: 2 merged, 0 blocked · Decisions: 4 worker, 0 reviewer, 1 arkimedes

## sidekick-optional — merged

- **D1** · The Sidekick controller is built only when the manifest has a `sidekick` key, and is null otherwise, instead of being built "off" and gated at each entry point. · _worker (T1)_
  <details><summary>more</summary>

  Why: every hook and the IPC already accept a null controller, so tips, the daily card and turns never start for a harness without the key.
  Rejected: keeping the controller and gating each entry point (more places to miss).
  See: https://github.com/Human-Harness/humanharness/pull/148 · report `runs/humanharness/demo-hide-sidekick/sidekick-optional.report.md`
  </details>

- **D2** · The first job gate went red on `packages/ui/test/inbox.test.tsx:431` (focus on `<body>`). Euklides retried the worker, which judged it a load flake. The retry gate went green with no code change. · _arkimedes_
  <details><summary>more</summary>

  Why: the test is outside the job's area (the job changes nothing in `packages/ui`), and the worker's own runs were green. Alone, `inbox.test.tsx` passed 3/3. The full vitest run passed twice (6634 passed).
  Rejected: fixing or skipping the test inside this job.
  See: https://github.com/Human-Harness/humanharness/pull/148 · report `runs/humanharness/demo-hide-sidekick/sidekick-optional.report.md`
  </details>

## demo-drop — merged

- **D3** · The sidekick e2e spec now opens the Report task in the fixture before each test's prompt. · _worker (T1)_
  <details><summary>more</summary>

  Why: Planner has no free composer before a task, so opening a task is the only way to reach the composer.
  Rejected: changing the fixture (out of the job's area).
  See: https://github.com/Human-Harness/humanharness/pull/149 · report `runs/humanharness/demo-hide-sidekick/demo-drop.report.md`
  </details>

- **D4** · The "after" usage assertion now expects two lines (opening turn plus the sent prompt), and the "Listo." counts are 2. · _worker (T1)_
  <details><summary>more</summary>

  Why: starting a task in the fixture adds one reply.
  Rejected: dropping the assertions.
  See: https://github.com/Human-Harness/humanharness/pull/149 · report `runs/humanharness/demo-hide-sidekick/demo-drop.report.md`
  </details>

- **D5** · The sidekick e2e spec moved to the sidekick-harness fixture, built once in `beforeAll`, because the demo no longer has a `sidekick` block. · _worker (T1)_
  <details><summary>more</summary>

  Why: the demo config's `sidekick` block was removed, so the spec needs a harness that still declares one.
  Rejected: keeping the spec on the demo harness.
  See: https://github.com/Human-Harness/humanharness/pull/149 · report `runs/humanharness/demo-hide-sidekick/demo-drop.report.md`
  </details>
