# Decisions — demo-no-sidekick

Plan: /Users/marcozanger/.claude/arkimedes/desk/humanharness/demo-no-sidekick/plan.md · approved 2026-11-12 · closed 2026-11-12
Jobs: 0 merged, 1 blocked · Decisions: 2 worker, 0 reviewer, 2 arkimedes

## demo-drop — blocked

- **D1** · `sidekick.spec.ts` now runs against the sidekick-harness fixture (built once in `beforeAll`, "Start Planner") instead of the demo, so the spec no longer depends on the demo manifest having a `sidekick` key. · _worker (Sonnet)_
  <details><summary>more</summary>

  Why: the plan removes the `sidekick` block from the demo config, so the spec needs a harness that still declares Sidekick. No script changes were needed. After Marco's stop, this work is kept as is.
  Rejected: none recorded.
  See: no PR · report `runs/humanharness/demo-no-sidekick/demo-drop.report.md`
  </details>

- **D2** · The worker reverted its own `flow.spec.ts` edit and left the demo tab list with "Sidekick" in it, instead of keeping a red test or editing core `visibleTabs`. · _worker (Sonnet)_
  <details><summary>more</summary>

  Why: after dropping the manifest key the demo still shows the Sidekick tab, because core shows it whenever `state.sidekick !== undefined` (`packages/ui/src/settings-tabs.ts`). The plan's "no tab list contains Sidekick" criterion can't be met inside this job's area, and a core edit is outside it and conflicts with "Sidekick untouched".
  Rejected: keeping the `flow.spec.ts` edit with a failing test; changing core `visibleTabs` inside this job.
  See: no PR · report `runs/humanharness/demo-no-sidekick/demo-drop.report.md`
  </details>

- **D3** · The job was blocked at question q1. The worker asked whether to make a small core change so Sidekick hides when the manifest has no `sidekick` key, or to relax the plan's goal. Marco chose the core change and stopped the job to correct the plan. · _arkimedes_
  <details><summary>more</summary>

  Why: the core shows the Sidekick tab, the top-bar toggle and the panel in every harness. Dropping the key from the demo manifest therefore hides nothing.
  Rejected: relaxing the demo tab criterion until Sidekick becomes a mod.
  See: no PR · report `runs/humanharness/demo-no-sidekick/demo-drop.report.md`
  </details>

- **D4** · Marco's correction to the plan: add a job before `demo-drop` in the core, covering `packages/ui` and the shell main. Without a `sidekick` key in the manifest, the main must not send `state.sidekick`. The job comes with a unit test, and `settings-harness` and any other fixtures that expect Sidekick must be checked so they carry the key. `demo-drop` is then re-run unchanged. · _arkimedes_
  <details><summary>more</summary>

  Why: this makes the plan's goal reachable without weakening its acceptance check. The work `demo-drop` already did (clean config, `sidekick.spec` against sidekick-harness, green) is kept.
  Rejected: changing the demo criterion; making the core change inside `demo-drop`, which is outside its area.
  See: no PR · report `runs/humanharness/demo-no-sidekick/demo-drop.report.md`
  </details>
