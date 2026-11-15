# Decisions — test-health-under-load

Plan: /Users/marcozanger/.claude/arkimedes/desk/humanharness/test-health-under-load/plan.md · approved 2026-11-13 · closed 2026-11-15
Jobs: 4 merged, 0 blocked · Decisions: 8 worker, 0 reviewer, 0 arkimedes

## process-waits — merged

- **D1** · Left `run.test.ts` untouched. Its second Ctrl-C already waits on the closing turn's marker file, polled every 20 ms, so no fixed sleep remained there. · _worker (tier T1)_
  <details><summary>more</summary>

  Why: nothing in that file waits on a fixed sleep or a timer race, and it passed 5 times under load.
  Rejected: turning the poll into an event, which would need a new hook in the fake agent for no gain.
  See: https://github.com/Human-Harness/humanharness/pull/185 · report `runs/humanharness/test-health-under-load/process-waits.report.md`
  </details>

- **D2** · The fixtures signal readiness with a `ready` line on stderr, read through the existing backend log. · _worker (tier T1)_
  <details><summary>more</summary>

  Why: a stdout message would show up in `events` and break the `events` `toEqual([])` assertion.
  Rejected: a JSON-RPC ready notification.
  See: https://github.com/Human-Harness/humanharness/pull/185 · report `runs/humanharness/test-health-under-load/process-waits.report.md`
  </details>

## watchers — merged

- **D3** · Added no clock seam for the debounces. `vi.useFakeTimers` controls them directly. The watch function is injectable and defaults to `fs.watch`. · _worker (tier T2)_
  <details><summary>more</summary>

  Why: the debounce uses the global `setTimeout`, so fake timers give exact control without changing the API.
  Rejected: an injected clock or timer parameter, which is extra surface for the same result.
  See: https://github.com/Human-Harness/humanharness/pull/184 · report `runs/humanharness/test-health-under-load/watchers.report.md`
  </details>

- **D4** · Removed the 400 ms settle sleep in the real build-swap test and did not replace it with another signal. · _worker (tier T2)_
  <details><summary>more</summary>

  Why: the reload count is already taken as a lower bound before each swap. A late event from an earlier write can only add reloads, never break the check.
  Rejected: a "wait until quiet" helper, which would be a sleep under another name.
  See: https://github.com/Human-Harness/humanharness/pull/184 · report `runs/humanharness/test-health-under-load/watchers.report.md`
  </details>

## timing-limits — merged

- **D5** · `timing.test.ts` lives in `packages/shell/test/support/`, while the helper stays in root `test/support/`. · _worker (tier T1)_
  <details><summary>more</summary>

  Why: the vitest config only includes `packages/*/test/**`, so a test in root `test/support` is never run. The gate's `vitest run test/support` would then exit 1. The vitest config is outside the job's area.
  Rejected: a test in root `test/support`, which is never run. Editing the vitest config, which is excluded.
  See: https://github.com/Human-Harness/humanharness/pull/186 · report `runs/humanharness/test-health-under-load/timing-limits.report.md`
  </details>

- **D6** · The limit rule max(5× old, 1000 ms) was read literally, so 500 → 2500 and 200 → 1000. `expectFast` takes the best of 3 runs and is synchronous only. · _worker (tier T1)_
  <details><summary>more</summary>

  Why: all the sub-1 s limits were on sync code. Running `fn` three times means every wrapped body must be idempotent.
  Rejected: an async overload, which had no use.
  See: https://github.com/Human-Harness/humanharness/pull/186 · report `runs/humanharness/test-health-under-load/timing-limits.report.md`
  </details>

## demo-dist — merged

- **D7** · Made no "writer" fix for the demo plugin's committed `dist`. The job explains instead that no unit test writes it. · _worker (tier T2)_
  <details><summary>more</summary>

  Why: grepping every `buildPlugin`/`checkPlugin`/`recordPlugin` call and comparing dist mtimes across a full test run showed no writer. The byte-identical test already builds into `os.tmpdir()`. The earlier failure was most likely a slow esbuild build under load, but it was not reproduced.
  Rejected: changing the `checkPlugin`/`buildPlugin` defaults, which is CLI src outside the area.
  See: https://github.com/Human-Harness/humanharness/pull/187 · report `runs/humanharness/test-health-under-load/demo-dist.report.md`
  </details>

- **D8** · The guard is a final `it` that compares the dist files and their mtimes with a snapshot taken at file load, not an `afterAll` assertion. · _worker (tier T2)_
  <details><summary>more</summary>

  Why: it shows up as a named test, and vitest runs the tests in a file in order.
  Rejected: an `afterAll` throw, whose failure reports less clearly.
  See: https://github.com/Human-Harness/humanharness/pull/187 · report `runs/humanharness/test-health-under-load/demo-dist.report.md`
  </details>
