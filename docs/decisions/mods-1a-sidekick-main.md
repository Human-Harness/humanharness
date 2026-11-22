# Decisions — mods-1a-sidekick-main

Plan: /Users/marcozanger/.claude/arkimedes/approvals/humanharness/mods-1a-sidekick-main/v4/plan.md · approved 2026-11-21 · closed 2026-11-22
Jobs: 4 merged, 1 blocked · Decisions: 8 worker, 0 reviewer, 7 arkimedes

## mod-api — merged

- **D1** · Regenerated `packages/shell/scripts/hh.d.ts` with `hh-dts`, a file outside the job's area. Marco granted it (q1). · _arkimedes_
  <details><summary>more</summary>

  Why: the type changes the plan requires (hold verdict, `ctx.holds`, `ctx.stores`, `ctx.usage`, `ctx.focus`, new hooks) made the generated file stale. `manual.test.ts` was the only red test, and the regeneration was +101/-2 lines of script output, over the small-fix limit.
  Rejected: editing the file by hand; leaving the gate red.
  See: https://github.com/Human-Harness/humanharness/pull/214 · report `runs/humanharness/mods-1a-sidekick-main/mod-api.report.md`
  </details>

- **D2** · Core mods' main reads zod and mod-sdk from `globalThis.__hhMainModules`, inlined as a shim. · _worker (sonnet)_
  <details><summary>more</summary>

  Why: the shim files live in userData and only exist at runtime, so they cannot be resolved at build time.
  Rejected: resolving them at build time to a path inside the app.
  See: https://github.com/Human-Harness/humanharness/pull/214 · report `runs/humanharness/mods-1a-sidekick-main/mod-api.report.md`
  </details>

## core-seams — merged

- **D3** · A tagged usage line writes its `kind` as both `phase` and `process`, so `phase`, `moment` and `process` now accept any string. · _worker (sonnet)_
  <details><summary>more</summary>

  Why: Sidekick's lines (`phase` and `process` both "sidekick") stay byte-identical while the kind becomes generic.
  Rejected: a new field, which would change what the log looks like.
  See: https://github.com/Human-Harness/humanharness/pull/215 · report `runs/humanharness/mods-1a-sidekick-main/core-seams.report.md`
  </details>

- **D4** · `sourceTagKey` moved into `linked-ipc.ts`, with a re-export left in `sidekick-import.ts`. · _worker (sonnet)_
  <details><summary>more</summary>

  Why: `linked-ipc.ts` is the only in-area core file that uses it, and the area does not allow a new file under `shell/src/main`.
  Rejected: a new `source-tag-key.ts`; editing `app-lifecycle.ts` (both outside the area).
  See: https://github.com/Human-Harness/humanharness/pull/215 · report `runs/humanharness/mods-1a-sidekick-main/core-seams.report.md`
  </details>

## mod-bridge — blocked

- **D5** · Marco stopped move-main (q2) and a new job, mod-bridge, was added before it. It adds a core-only `ctx.push` and `ctx.app`. mod-bridge itself then ended blocked (q3–q5). · _arkimedes_
  <details><summary>more</summary>

  Why: the Sidekick controller could not stay unchanged behind a `ctx → SidekickDeps` adapter. The mod API had no window push, multi-turn sessions or app services, and adding them meant changing mod-sdk and `host.ts`, which are in mod-api's area, so a widen was impossible. mod-bridge's work reached master as PR #217 (2d2d35ab) after the integration branch was deleted and recreated. Every worker attempt then ended "DONE without any change", because the runner needs a non-empty diff, so it was stopped.
  Rejected: widening move-main to mod-sdk and `host.ts`; closing the run and starting a fresh one for move-main from master.
  See: PR #217 · no report (job ended blocked)
  </details>

## move-main — merged

- **D6** · Granted `pnpm-lock.yaml` to move-main (q6). · _arkimedes_
  <details><summary>more</summary>

  Why: the change only adds the importer entry for the new `packages/mods/sidekick` package, and all of its dependencies are already resolved, so no new package is downloaded. A frozen install fails without it. Lockfiles are reserved (R5), so only Marco could grant it.
  Rejected: dropping the lockfile change, which breaks the frozen install.
  See: https://github.com/Human-Harness/humanharness/pull/219 · report `runs/humanharness/mods-1a-sidekick-main/move-main.report.md`
  </details>

- **D7** · `beforeSend` is registered in the Sidekick mod but never holds. · _worker (sonnet)_
  <details><summary>more</summary>

  Why: the window still reviews through `hh:sidekickReview`, so a hold would review twice.
  Rejected: a hold that runs `review()` before the UI moves.
  See: https://github.com/Human-Harness/humanharness/pull/219 · report `runs/humanharness/mods-1a-sidekick-main/move-main.report.md`
  </details>

- **D8** · The integration gate on `5a9114ac` was red only on timeouts in CLI tests unrelated to Sidekick. These tests are flaky under load and green when run alone. They are `packages/cli/test/plugin-test.test.ts` (beforeAll `buildPlugin`, "Hook timed out in 60000ms") and, on the earlier run, `check.test.ts` ("finds no error in the untouched template", 30 s timeout). · _arkimedes_
  <details><summary>more</summary>

  Why: the worker retried. `check.test.ts` takes 2.2 s alone and a full `vitest run --maxWorkers=4` passed (620 files, 9382 tests). No code in the job touches these tests, and the files are outside its area.
  Rejected: changing the CLI tests inside this job.
  See: https://github.com/Human-Harness/humanharness/pull/219 · report `runs/humanharness/mods-1a-sidekick-main/move-main.report.md`
  </details>

## remove-seams — merged

- **D9** · `onRefresh` is a core-only hook on `CoreMainCtx`. `ModHost.refresh()` fires it on a profile arrival and after a restore, and Sidekick wires it to `ctl.refresh()`. Marco approved it (q14). · _worker (sonnet)_
  <details><summary>more</summary>

  Why: review found that Sidekick no longer refreshed after a profile switch or an undo. A core-only hook leaves the public contract and `hh.d.ts` unchanged.
  Rejected: a public `ctx.on.refresh` hook; reloading the mod, which does not send its state to the window.
  See: https://github.com/Human-Harness/humanharness/pull/220 · report `runs/humanharness/mods-1a-sidekick-main/remove-seams.report.md`
  </details>

- **D10** · The turn's `kind` goes only to core mods, through the host. The public `TurnEndInfo` is unchanged. · _worker (sonnet)_
  <details><summary>more</summary>

  Why: Sidekick's mod already reads `kind`, and this avoids a contract change.
  Rejected: adding `kind` to the public `TurnEndInfo`.
  See: https://github.com/Human-Harness/humanharness/pull/220 · report `runs/humanharness/mods-1a-sidekick-main/remove-seams.report.md`
  </details>

- **D11** · The 8 out-of-area files (`mod-sdk` `build.ts` and `bundle.test.ts`, Sidekick `controller.ts`, `turns.ts`, `controller.test.ts`, `core.ts`, `main.ts`, `main.test.ts`) were landed on the integration branch as fix(base) commits, a759ad41 and e7149b53. Marco applied both by hand. · _arkimedes_
  <details><summary>more</summary>

  Why: the runner refuses to widen a job into the areas of merged jobs, so these files had to go in as base fixes. The fix workers changed nothing on three attempts (q11, q12 and the earlier fix for q15), so Marco landed the commits himself. The job's `onRefresh` was made optional (`ctx.onRefresh?.(…)`) because no host on the base provides it yet. The job then merged the base back (9ff506e2).
  Rejected: widening remove-seams into the merged jobs' areas (refused by the runner); releasing the merged jobs' areas in the runner.
  See: https://github.com/Human-Harness/humanharness/pull/220 · report `runs/humanharness/mods-1a-sidekick-main/remove-seams.report.md`
  </details>

- **D12** · Marco raised the budget at each overrun (q13, q16, q18) so the job could finish, instead of stopping it. The job ended at 9 worker attempts, $143.92 of the run's $143 budget, against $18 for the job. · _arkimedes_
  <details><summary>more</summary>

  Why: the review kept returning new findings. Round 1 found 3, and round 2 found 3 more, which were fixed in attempt 9 and then review came back CLEAN. The first two findings were real regressions, so Marco chose to finish. Euklides had proposed stopping at q18 and finishing PR #220 by hand.
  Rejected: stopping the run and finishing PR #220 by hand.
  See: https://github.com/Human-Harness/humanharness/pull/220 · report `runs/humanharness/mods-1a-sidekick-main/remove-seams.report.md`
  </details>

- **D13** · With no mod handling one of the 26 forwarded `hh:sidekick*` channels, the call is refused instead of returning a typed default. · _worker (sonnet)_
  <details><summary>more</summary>

  Why: the UI gates on `state.sidekick` and catches errors.
  Rejected: per-channel defaults in core.
  See: https://github.com/Human-Harness/humanharness/pull/220 · report `runs/humanharness/mods-1a-sidekick-main/remove-seams.report.md`
  </details>

- **D14** · Only core mods' stores go into the shared `ModStoreRegistry`. Any other mod gets a registry of its own with each ctx. · _worker (sonnet)_
  <details><summary>more</summary>

  Why: review round 2 found that a user mod named like a harness collection could take that collection's requests, and a reload kept the old collection.
  Rejected: one shared registry for all mods.
  See: https://github.com/Human-Harness/humanharness/pull/220 · report `runs/humanharness/mods-1a-sidekick-main/remove-seams.report.md`
  </details>

- **D15** · Marco's q8 approval of the `build.ts` fix (bundle npm imports reached through a bundled `@humanharness/*` package) was made on the job branch, then moved to the base as part of a759ad41. · _arkimedes_
  <details><summary>more</summary>

  Why: without it the Sidekick core mod did not load. `core()` kept every npm import external, so Node could not resolve isomorphic-git, diff, remark and unified from `out/core-mods/sidekick/main.js`. The shell used to build Sidekick itself and hid the bug. The Sidekick e2e specs went green with it.
  Rejected: leaving it unfixed, which breaks the Sidekick e2e specs.
  See: https://github.com/Human-Harness/humanharness/pull/220 · report `runs/humanharness/mods-1a-sidekick-main/remove-seams.report.md`
  </details>
