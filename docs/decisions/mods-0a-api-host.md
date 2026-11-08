# Decisions — mods-0a-api-host

Plan: /Users/marcozanger/.claude/arkimedes/desk/humanharness/mods-0a-api-host/plan.md · approved 2026-11-08 · closed 2026-11-08
Jobs: 1 merged, 3 blocked · Decisions: 5 worker, 0 reviewer, 2 arkimedes

## mod-sdk — merged

- **D1** · T1 and T2 were committed together in one commit instead of two. · _worker (Sonnet 5.5)_
  <details><summary>más</summary>

  Why: the files were written in one pass and the gate was run once on the full package.
  Rejected: two separate commits, since nothing needs them separate.
  See: https://github.com/Human-Harness/humanharness/pull/138 · report `runs/humanharness/mods-0a-api-host/mod-sdk.report.md`
  </details>

## host — blocked

- **D2** · `taskOpened` is called after the task is saved as current and after the Stop check, wrapped in try/catch, instead of right after `this.begun = true` as the brief says. · _worker (Sonnet 5.5)_
  <details><summary>más</summary>

  Why: the test requires the task to be current when the hook runs, and a task stopped before it opens would otherwise reach mods with an open and no close.
  Rejected: the brief's exact line, which runs before `current` is written.
  See: https://github.com/Human-Harness/humanharness/pull/139 · report `runs/humanharness/mods-0a-api-host/host.report.md`
  </details>

- **D3** · harness-sdk keeps its own copy of the mod id regex (`MANIFEST_MOD_ID`), and a test checks it equals mod-sdk's `MOD_ID`. mod-sdk is only a devDependency. · _worker (Sonnet 5.5)_
  <details><summary>más</summary>

  Why: the replaceable-parts §3 boundary test lets harness-sdk/src import no other package, and that test is outside this job's area.
  Rejected: adding an exception to the boundary test, or making mod-sdk import from harness-sdk (both outside the area).
  See: https://github.com/Human-Harness/humanharness/pull/139 · report `runs/humanharness/mods-0a-api-host/host.report.md`
  </details>

- **D4** · `ModHost.start` does not retry a mod that already has a problem, and `set(id, true)` refuses when a required mod is off. · _worker (Sonnet 5.5)_
  <details><summary>más</summary>

  Why: this avoids importing the same failing mod again and again, and a mod never starts without what it requires.
  Rejected: the brief's loop, which tried a failing mod again on every pass.
  See: https://github.com/Human-Harness/humanharness/pull/139 · report `runs/humanharness/mods-0a-api-host/host.report.md`
  </details>

- **D5** · The integration gate failed on the first attempt, so the job went back to the worker. The worker's fix was to rename ModHost's internal `ipc` map to `channels` (for the `ipc-surface` test) and apply D3 (for the `boundary` test). The job gate and review were clean on the second attempt. The integration gate failed again and the job was blocked. · _arkimedes_
  <details><summary>más</summary>

  Why: the job's own gate and review were green both times, but the integration gate failed twice (exit 1). The worker reported that `git merge origin/ark/mods-0a-api-host` was already up to date and that its full suite passed locally (571 files, no failures), so the cause of the second failure is not explained in the report.
  Rejected: a third attempt, since the run stops after two integration failures.
  See: https://github.com/Human-Harness/humanharness/pull/139 · report `runs/humanharness/mods-0a-api-host/host.report.md`
  </details>

## wiring — blocked

- **D6** · Blocked without running because it depends on `host`, which is blocked. The open issue from `host` falls to this job: `ConfigStore.load` must call `cleanModsConfig`, and turning a failed mod back on must also clear `failed` in `config.json`. · _arkimedes_
  <details><summary>más</summary>

  Why: the dependency was not merged, so the job could not start.
  Rejected: running the job on top of an unmerged `host`.
  See: report `runs/humanharness/mods-0a-api-host/wiring.report.md` (none was written)
  </details>

## settings-ui — blocked

- **D7** · Blocked without running because it depends on a blocked job (the alert names no specific job). · _arkimedes_
  <details><summary>más</summary>

  Why: the dependency chain was not merged, so the job could not start.
  Rejected: running the job without its dependency.
  See: report `runs/humanharness/mods-0a-api-host/settings-ui.report.md` (none was written)
  </details>

## docs-gate — blocked

No decisions: blocked without running because a job it depends on is blocked, and no report was written.
