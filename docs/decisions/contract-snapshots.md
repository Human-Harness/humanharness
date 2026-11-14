# Decisions — contract-snapshots

Plan: /Users/marcozanger/.claude/arkimedes/desk/humanharness/contract-snapshots/plan.md · approved 2026-11-14 · closed 2026-11-13
Jobs: 0 merged, 2 blocked · Decisions: 3 worker, 0 reviewer, 4 arkimedes

## types-check — blocked

- **D1** · A failed type assertion is recognised by where tsc reports it (an assertion line of `check.ts`, at the column of its first type argument), not by the error code TS2344. Every other diagnostic still throws. · _worker (T2)_
  <details><summary>more</summary>

  Why: tsc 7.0.2 reports the elaborated error (for example TS2741) instead of TS2344.
  Rejected: a list of assignability codes, because it is brittle.
  See: https://github.com/Human-Harness/humanharness/pull/168 · report `runs/humanharness/contract-snapshots/types-check.report.md`
  </details>

- **D2** · The temp folder sits under `packages/shell/node_modules/.cache/`, with a symlink `node_modules/@radix-ui/themes` pointing to ui's copy. tsc also runs with `--noUncheckedSideEffectImports false`, as in `hh-dts.ts`. · _worker (T2)_
  <details><summary>more</summary>

  Why: no folder under packages/ resolves zod and radix together. The real ui sources also get loaded, and their CSS imports have no declarations.
  Rejected: renaming the current copy as well, which the plan does not ask for.
  See: https://github.com/Human-Harness/humanharness/pull/168 · report `runs/humanharness/contract-snapshots/types-check.report.md`
  </details>

- **D3** · `contracts.ts` imports `./hh-dts.ts` with `// @ts-expect-error TS5097`. · _worker (T2)_
  <details><summary>more</summary>

  Why: plain `node` needs the `.ts` extension, but the root tsconfig (outside this job's area) does not allow it.
  Rejected: changing `tsconfig.json`, which is outside the area.
  See: https://github.com/Human-Harness/humanharness/pull/168 · report `runs/humanharness/contract-snapshots/types-check.report.md`
  </details>

- **D4** · The red integration gate was judged flaky on master and not caused by the job. Marco accepted types-check on its green job gate and chose a narrower gate for the rest of the run: `corepack pnpm typecheck && corepack pnpm vitest run --changed origin/master --maxWorkers=4`. · _arkimedes_
  <details><summary>more</summary>

  Why: the full gate failed on `user-layer.test.ts` (watcher never fired). Marco saw it fail 1 of 4 runs alone on master after #163. The job gate was green and the review CLEAN.
  Rejected: re-running the full red gate with a new worker.
  See: https://github.com/Human-Harness/humanharness/pull/168 · report `runs/humanharness/contract-snapshots/types-check.report.md`
  </details>

- **D5** · The runner could not change the gate mid-run, so the q2 answer (stop, edit `integration_gate` in the plan, resume) was handed to a new worker. That worker could not open the plan folder and changed nothing. The full gate ran again and failed on another timing test (`outside-code.test.ts`, 394 ms and later 252 ms against a 200 ms limit). · _arkimedes_
  <details><summary>more</summary>

  Why: the plan still said `integration_gate: corepack pnpm typecheck && corepack pnpm test` at line 427.
  Rejected: nothing else was tried. The job was left waiting for an answer.
  See: report `runs/humanharness/contract-snapshots/types-check.report.md`
  </details>

- **D6** · Marco answered q3 with `stop`. types-check was blocked with no merge, although its work was green at head 3fcdb885 and PR #168 was open. · _arkimedes_
  <details><summary>more</summary>

  Why: the gate change never took effect and the full gate stayed red on flaky tests. The plan was also edited and approved again (4a06b1e3) while the question was open.
  Rejected: integrating at the current head without the gate change, because the runner has no way to do that.
  See: https://github.com/Human-Harness/humanharness/pull/168
  </details>

## modjson-and-release — blocked

- **D7** · The job never started. It was blocked because the job it depends on, types-check, was blocked. · _arkimedes_
  <details><summary>more</summary>

  Why: it waited on types-check from the first stall, and no report exists.
  Rejected: running it without its dependency.
  See: no PR · no report
  </details>
