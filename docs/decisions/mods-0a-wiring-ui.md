# Decisions — mods-0a-wiring-ui

Plan: /Users/marcozanger/.claude/arkimedes/desk/humanharness/mods-0a-wiring-ui/plan.md · approved 2026-11-09 · closed 2026-11-09
Jobs: 1 merged, 2 blocked · Decisions: 6 worker, 1 reviewer, 3 arkimedes

## wiring — merged

- **D1** · The mods host starts inside `app.whenReady`, after `config` exists and before `registerIpc()`. · _worker (Sonnet 5.5)_
  <details><summary>más</summary>

  Why: `config` is only created in `whenReady`, and starting the host before the IPC means the first send already reaches it.
  Rejected: starting it in the `if (loaded)` block, where `config` is still unset.
  See: https://github.com/Human-Harness/humanharness/pull/142 · report `runs/humanharness/mods-0a-wiring-ui/wiring.report.md`
  </details>

- **D2** · Mod usage lines get a new `TurnKind` `"mod"` and are excluded from task and day totals. · _worker (Sonnet 5.5)_
  <details><summary>más</summary>

  Why: reusing `phase: "sidekick"` would count mod turns as Sidekick spend.
  Rejected: writing mod usage as Sidekick lines.
  See: https://github.com/Human-Harness/humanharness/pull/142 · report `runs/humanharness/mods-0a-wiring-ui/wiring.report.md`
  </details>

- **D3** · A mod's notice is shown as a system `Notification`, the same way task attention does, with no new UI. · _worker (Sonnet 5.5)_
  <details><summary>más</summary>

  Why: the window has no plain notice channel today, and the plan says not to add new UI.
  Rejected: adding an `hh:notice` push that nothing in the window draws.
  See: https://github.com/Human-Harness/humanharness/pull/142 · report `runs/humanharness/mods-0a-wiring-ui/wiring.report.md`
  </details>

- **D4** · The integration gate failed once on `packages/cli/test/run-pre.test.ts`; it was judged a load-induced timeout and sent back to the worker, which changed nothing. The gate was green on the next run. · _arkimedes_
  <details><summary>más</summary>

  Why: the test passes alone (6.5 s) and the whole `packages/cli` suite passes. Nothing in `packages/cli` imports code this job changed. The worker could not reproduce the 60 s timeout and took it for a flaky test under load.
  Rejected: changing code to fix the test.
  See: https://github.com/Human-Harness/humanharness/pull/142 · report `runs/humanharness/mods-0a-wiring-ui/wiring.report.md`
  </details>

- **D5** · Review round 1 found that a local folder could take an id the app already has. The fix checks the id three times (review, add, `addLocal`), and counts declared or core mods that failed to resolve as taken. · _reviewer_
  <details><summary>más</summary>

  Why: a taken id must never reach `mods.local` or `on`. Without the checks it could replace an existing mod.
  Rejected: checking only at review time, since the id can be taken between the review and the add.
  See: https://github.com/Human-Harness/humanharness/pull/142 · report `runs/humanharness/mods-0a-wiring-ui/wiring.report.md`
  </details>

## settings-ui — blocked

- **D6** · "mods" is a UI-only tab, with no `data-setting` attribute, and the ⌘K command list filters it out. · _worker (Sonnet 5.5)_
  <details><summary>más</summary>

  Why: `SearchSettingsTab` and `SEARCHABLE_SETTINGS` live in protocol, outside the job's area, and the registry test requires every `data-setting` to be searchable.
  Rejected: editing `protocol/src/views.ts` or making Mods searchable now.
  See: report `runs/humanharness/mods-0a-wiring-ui/settings-ui.report.md`
  </details>

- **D7** · The worker asked whether it could edit `packages/shell/electron.vite.config.ts`, outside its area, to add `"@humanharness/mod-sdk"` to `workspacePackages`. Marco first said he'd tell another agent to fix it, then approved the worker doing it. The change is limited to that one line and must be noted in the PR body and the report. · _arkimedes_
  <details><summary>más</summary>

  Why: without it every built app crashes on start (ERR_MODULE_NOT_FOUND), so the e2e cannot pass. After the first answer the worker waited for a fix that no job owned; Marco then saw that the wiring job's area was `packages/shell/src/**` and docs-gate makes no code changes.
  Rejected: waiting for another agent's fix, because no job owned that file.
  See: report `runs/humanharness/mods-0a-wiring-ui/settings-ui.report.md` (q1, q2)
  </details>

- **D8** · The job was blocked because its gate, `pnpm e2e -- settings-mods-radix`, cannot pass from this worktree. The literal `--` makes playwright run the whole suite, and 79 other specs fail with the worktree under `~/.claude` (probably "protected"). Marco has to choose between changing the gate or setting `HOME` in `helpers.ts`. · _arkimedes_
  <details><summary>más</summary>

  Why: the job's own spec passes 3/3, and vitest and typecheck pass. The run took 33 minutes and exceeded the time for tier T2. The runner's intervene tick gave no usable answer, so it waited and then blocked. The worker did not confirm the cause spec by spec.
  Rejected: changing other specs (outside the job) or setting `HOME` for every spec without approval (a suite-wide change). Options for Marco: (a) gate becomes `pnpm --filter @humanharness/e2e exec playwright test settings-mods-radix` after the shell build, or (b) `HOME` set to the sandbox in `helpers.ts` `baseEnv`.
  See: report `runs/humanharness/mods-0a-wiring-ui/settings-ui.report.md`
  </details>

## docs-gate — blocked

- **D9** · The job was blocked without running because it depends on settings-ui, which is blocked. · _arkimedes_
  <details><summary>más</summary>

  Why: a dependency never merged, so the job has nothing to build on. It has no report.
  Rejected: running it on top of the unmerged branch.
  See: report `runs/humanharness/mods-0a-wiring-ui/docs-gate.report.md` (none)
  </details>

- **D10** · It will need a new run once Marco decides on the settings-ui gate (D8). · _arkimedes_
  <details><summary>más</summary>

  Why: it is blocked only through its dependency, and it makes no code changes.
  Rejected: reordering the plan to drop the dependency.
  See: report `runs/humanharness/mods-0a-wiring-ui/docs-gate.report.md` (none)
  </details>
