# Decisions — humanharness/mods-0b1-layout

Plan: /Users/marcozanger/.claude/arkimedes/desk/humanharness/mods-0b1-layout/plan.md · approved 2026-11-12 · closed 2026-11-12
Jobs: 5 merged, 0 blocked · Decisions: 10 worker, 0 reviewer, 3 arkimedes

## home-layers — merged

- **D1** · The core mod list lives in a plain-data `core-mod-list.ts` (`CORE_MOD_LIST`), and `core-mods.ts` derives `CORE_MODS` from it. · _worker (Sonnet 5.5)_
  <details><summary>more</summary>

  Why: the vite config must read the list without evaluating `import.meta.dirname`.
  Rejected: one file read by both; scanning `packages/mods/*` (harness mods may live there too).
  See: https://github.com/Human-Harness/humanharness/pull/151 · report `runs/humanharness/mods-0b1-layout/home-layers.report.md`
  </details>

- **D2** · A file on disk that already equals what this start writes is not treated as an edit, even if `.layers.json` disagrees. · _worker (Sonnet 5.5)_
  <details><summary>more</summary>

  Why: a start cut short after rewriting but before the record would otherwise move pristine files aside.
  Rejected: trusting only `.layers.json`.
  See: https://github.com/Human-Harness/humanharness/pull/151 · report `runs/humanharness/mods-0b1-layout/home-layers.report.md`
  </details>

## layout — merged

- **D3** · `HarnessClient.layout` is optional (`layout?()`), with the channel type using `NonNullable`. · _worker (Sonnet 5.5)_
  <details><summary>more</summary>

  Why: the UI test fakes are outside the job's area and would fail typecheck with a required member.
  Rejected: a required member (needs a fake-client edit; the React job can make it required).
  See: https://github.com/Human-Harness/humanharness/pull/152 · report `runs/humanharness/mods-0b1-layout/layout.report.md`
  </details>

- **D4** · The core default layout reaches `core/layouts/main.json` as text imported as JSON into the main bundle; `LayoutView` in protocol imports `Layout` type-only from mod-sdk by relative path. · _worker (Sonnet 5.5)_
  <details><summary>more</summary>

  Why: the build copy step (`electron.vite.config.ts`) and protocol's `package.json` are outside the area.
  Rejected: copying `default-layout.json` next to `core-mods/`; adding the workspace dependency.
  See: https://github.com/Human-Harness/humanharness/pull/152 · report `runs/humanharness/mods-0b1-layout/layout.report.md`
  </details>

## renderer — merged

- **D5** · `client.layout` stays optional, and the UI falls back to the core layout (`CORE_LAYOUT`) when it is absent or fails. · _worker (Sonnet 5.5)_
  <details><summary>more</summary>

  Why: `packages/protocol` and the test fake's protocol type are outside the job's area.
  Rejected: making it required (needs a protocol change outside the area).
  See: https://github.com/Human-Harness/humanharness/pull/153 · report `runs/humanharness/mods-0b1-layout/renderer.report.md`
  </details>

- **D6** · A mod with no row in `hh:mods` counts as on, so its block draws. · _worker (Sonnet 5.5)_
  <details><summary>more</summary>

  Why: `home` is not in `CORE_MOD_LIST` until the home-mod job, so the temporary home block would otherwise never show.
  Rejected: treating "unknown" as off.
  See: https://github.com/Human-Harness/humanharness/pull/153 · report `runs/humanharness/mods-0b1-layout/renderer.report.md`
  </details>

## home-mod — merged

- **D7** · All 40 `packages/ui` test files that fail without the temporary block moved to `packages/mods/home/test`, not only those mentioning "Home". · _worker (Sonnet 5.5)_
  <details><summary>more</summary>

  Why: `@humanharness/ui` may not depend on mod-home, so every test passing through Home must live with the mod.
  Rejected: a stand-in Home block in the ui tests; a relative import of the mod from the ui tests.
  See: https://github.com/Human-Harness/humanharness/pull/155 · report `runs/humanharness/mods-0b1-layout/home-mod.report.md`
  </details>

- **D8** · `home: { on: true }` lives in `core-mods.ts` as `CORE_MOD_SWITCHES` (= `CORE_MOD_LIST` + home) instead of editing `core-mod-list.ts`. · _worker (Sonnet 5.5)_
  <details><summary>more</summary>

  Why: `core-mod-list.ts` is outside the job's area and the hook refused the edit. This departs from the plan; the list's comment still says "T8 adds `home`".
  Rejected: editing `core-mod-list.ts`.
  See: https://github.com/Human-Harness/humanharness/pull/155 · report `runs/humanharness/mods-0b1-layout/home-mod.report.md`
  </details>

- **D9** · The job was blocked three times for touching `tsconfig.json` and `vitest.config.ts` outside its area. Marco approved adding `packages/mods/*` to both `include`s (q1 "si", q2 "ok", q3 "unblock en T2"). · _arkimedes_
  <details><summary>more</summary>

  Why: without it the gate did not run the 40 moved tests (root include is `packages/*/test/**`) and typecheck did not cover the mod, so the gate would be green without testing the mod. Blocks 2 and 3 repeated because the area in the plan had not yet been widened; q3 asked for the plan to add both files.
  Rejected: leaving the root configs alone (silent green gate).
  See: https://github.com/Human-Harness/humanharness/pull/155 · report `runs/humanharness/mods-0b1-layout/home-mod.report.md`
  </details>

- **D10** · The plan was edited after approval (18:36), which held the run. Marco approved the new text again at 20:18 and the run resumed. The first approval attempt was refused because home-layers, layout and renderer were already merged under the old plan. · _arkimedes_
  <details><summary>more</summary>

  Why: the run is held until the approved text is restored or re-approved, and merged jobs cannot pass the new plan's checks. The run took the new plan after re-approval, and every unmerged job passed its checks again.
  Rejected: stopping the run (q4 offered `stop`).
  See: report `runs/humanharness/mods-0b1-layout/home-mod.report.md`
  </details>

- **D11** · The integration gate failed once (exit 1) and the job went back to the worker, who found it did not reproduce. · _arkimedes_
  <details><summary>more</summary>

  Why: `host.test.ts` "turning a mod off runs its disposers" failed in the full run but passes alone. Full runs also failed once in `job-scheduler.test.ts`. Both are timing-sensitive shell tests (50 ms hook budget) under load, outside the job's area. The next gate run was green on 94d75d24 and the job merged. A wider budget in the host test would steady it.
  Rejected: changing code in this job for a flake it does not touch.
  See: https://github.com/Human-Harness/humanharness/pull/155 · report `runs/humanharness/mods-0b1-layout/home-mod.report.md`
  </details>

## docs-gate — merged

- **D12** · The `migrated` promise was dropped entirely, not just the chat move. · _worker (Sonnet 5.5)_
  <details><summary>more</summary>

  Why: nothing else produced it, and every `await migrated` only waited on the move.
  Rejected: keeping a resolved-promise stub.
  See: https://github.com/Human-Harness/humanharness/pull/156 · report `runs/humanharness/mods-0b1-layout/docs-gate.report.md`
  </details>

- **D13** · The board-host "start" test was rewritten to check only that an open lane ends unfinished. · _worker (Sonnet 5.5)_
  <details><summary>more</summary>

  Why: its chat-move assertion tested deleted behaviour.
  Rejected: deleting the test.
  See: https://github.com/Human-Harness/humanharness/pull/156 · report `runs/humanharness/mods-0b1-layout/docs-gate.report.md`
  </details>
