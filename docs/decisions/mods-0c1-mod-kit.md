# Decisions — mods-0c1-mod-kit

Plan: /Users/marcozanger/.claude/arkimedes/desk/humanharness/mods-0c1-mod-kit/plan.md · approved 2026-11-13 · closed 2026-11-13
Jobs: 0 merged, 3 blocked · Decisions: 1 worker, 0 reviewer, 6 arkimedes

## mcp-server — blocked

- **D1** · The `run.test.ts` "second Ctrl-C" test, which used `fs.watch`, now polls for its marker file. It sat in the job's area and failed even on the base commit. The other flaky tests, in `packages/shell` and elsewhere, were left alone. · _worker (model not stated in report)_
  <details><summary>more</summary>

  Why: The `fs.watch` version failed when run alone. The polling version passes 3 of 3 runs. Raising limits or weakening the real-watcher test would hide the flakiness instead of removing it.
  Rejected: Raising time limits one test at a time, because each loaded run trips a different heavy test. Weakening the `plugin-dev.test.ts` real-watcher test, because it exists to check the real watcher.
  See: https://github.com/Human-Harness/humanharness/pull/164 · report `runs/humanharness/mods-0c1-mod-kit/mcp-server.report.md`
  </details>

- **D2** · The integration gate was red on the base too, because of load-sensitive `packages/shell` tests (`backend-process` B8, `documents.test.ts`, `plugin-fixture-mode.test.ts`). The job's code was not at fault. Marco approved q2: run the integration gate with `--maxWorkers=4` and queue a master task to make those tests robust. · _arkimedes_
  <details><summary>more</summary>

  Why: Base fix 1 turned 1 failing test into 5, and the files are outside the job's area. Euklides's proposal was to reduce load and fix the tests separately.
  Rejected: Another base-fix job inside this run. It failed again (base fix 2 timed out), and the failures moved to different tests each time.
  See: q1–q3 in the run events · report `runs/humanharness/mods-0c1-mod-kit/mcp-server.report.md`
  </details>

- **D3** · Marco redirected q3 from fixing the base to running only the tests the branch touches. The worker found that `vitest run --changed origin/ark/mods-0c1-mod-kit` runs 17 `packages/cli` files and 323 tests in 105 s. The full suite takes about 8 minutes. Using it as the integration gate would be a runner change, so the worker did not make it. · _arkimedes_
  <details><summary>more</summary>

  Why: Base fix 2 timed out. The 592-worker full run fails on whichever timing test the load hits that time (outside-code at 200.79 ms against a 200 ms limit).
  Rejected: A further base-fix worker. A full-suite rerun.
  See: q3 · report `runs/humanharness/mods-0c1-mod-kit/mcp-server.report.md`
  </details>

- **D4** · The job gate (`vitest run packages/cli`, 42 files) failed in attempts 2–6 on different timing and watcher tests. The load average was about 28–43, the branch stayed at head 80d0a96e, the review was clean, and each failing file passes alone. Marco approved q4: accept head 80d0a96e on the `--changed` gate, or on `--maxWorkers=4`, with no new worker. · _arkimedes_
  <details><summary>more</summary>

  Why: Spend was $18.61 against a $12 budget, and another worker would only hit the same flakes.
  Rejected: More worker attempts. Raising individual test timeouts.
  See: q4 · report `runs/humanharness/mods-0c1-mod-kit/mcp-server.report.md`
  </details>

- **D5** · Marco's acceptance in q4, q5 and q6 was not carried out. The runner started worker attempts 7 and 8 each time, instead of running the `--changed` gate itself. Spend reached $35.33 against the $12 budget, and the full gate failed again each time. The conclusion was that the runner cannot override a job's gate. · _arkimedes_
  <details><summary>more</summary>

  Why: A worker cannot accept a job. Its full-gate failures were load timeouts in files the job does not touch.
  Rejected: Another worker attempt, which the q5 and q6 answers had already ruled out.
  See: q5, q6, q7 · report `runs/humanharness/mods-0c1-mod-kit/mcp-server.report.md`
  </details>

- **D6** · Marco stopped the run at q7 and changed the plan instead. The gate for `mcp-server` and `mod-tools` becomes `corepack pnpm install && corepack pnpm typecheck && corepack pnpm vitest run --changed origin/ark/mods-0c1-mod-kit --maxWorkers=4`. The integration gate gets `--maxWorkers=4`. After that the run resumes: `mcp-server` is checked on head 80d0a96e with no new worker. A master task for the flaky `packages/cli` and `packages/shell` tests is queued. The job is recorded as blocked in this closing state, though its code is finished. · _arkimedes_
  <details><summary>more</summary>

  Why: This was the fallback Marco approved in q6, for the case where the runner cannot override a job's gate.
  Rejected: Continuing with the full-suite gate, and more worker attempts.
  See: https://github.com/Human-Harness/humanharness/pull/164 · q7 · report `runs/humanharness/mods-0c1-mod-kit/mcp-server.report.md`
  </details>

## mod-tools — blocked

No decisions of its own. It never started, because it depends on `mcp-server`, which stopped at q7. It resumes once the plan's gate change and the `mcp-server` acceptance go through.

## manual-e2e — blocked

No decisions of its own. It never started, because it depends on `mod-tools`, which is blocked behind `mcp-server`.
