# Decisions — file-size-ratchet

Plan: /Users/marcozanger/.claude/arkimedes/desk/humanharness/file-size-ratchet/plan.md · approved 2026-11-15 · closed 2026-11-14
Jobs: 6 merged, 0 blocked · Decisions: 9 worker, 0 reviewer, 3 arkimedes

## ratchet — merged

- **D1** · The integration gate failed twice for reasons outside the job. First it failed in `user-layer.test.ts` (a file-watch timeout while the machine slept). Then it failed on one flaky `usage-tab.test.tsx` assertion. Both times the job was retried with no code change and merged once the gate was green. · _arkimedes_
  <details><summary>more</summary>

  Why: The same test failed on `ark/file-size-ratchet` without the job. `user-layer.test.ts` and `packages/protocol` passed on rerun. `usage-tab.test.tsx` passed alone (25 tests) and is a file the job does not touch. Marco's answer to q1 was to change no code, run the tests again and let the integration gate run again.
  Rejected: Fixing the tests inside this job, since both failures were environmental.
  See: https://github.com/Human-Harness/humanharness/pull/172 · report `runs/humanharness/file-size-ratchet/ratchet.report.md`
  </details>

## ipc-split — merged

- **D2** · The backend block (`if (hasBackend(harness)) { … registerBackendIpc … }`) and `void pruneEngineConfig()` stay in `registerIpc`, as on master. Review round 1 had moved them out, and round 2 reverted that. · _worker (T2)_
  <details><summary>more</summary>

  Why: The two review rounds conflicted. `hatches-surface` pins `registerBackendIpc` and `BackendProcess.start` inside that block, and source-reading test assertions may change only in file names.
  Rejected: The `startBackendSupervisor` helper (commit 352f3697), which weakened that assertion and moved the prune.
  See: https://github.com/Human-Harness/humanharness/pull/173 · report `runs/humanharness/file-size-ratchet/ipc-split.report.md`
  </details>

- **D3** · One-line `handle("hh:x", () => existing())` calls, the inbox/jobs handle lines and the existing `register*Ipc(handle, deps)` calls stay in index.ts. Done-when "only handle calls and their deps objects" is therefore met except for the backend block. The worker left it as an open question whether the `hatches-surface` assertion may change. · _worker (T2)_
  <details><summary>more</summary>

  Why: They already are handle calls with deps objects. The ipc-surface, preload, hatches and connections tests pin their text in index.ts.
  Rejected: Moving them and rewriting those tests' file names, which is more churn for no gain against the done-when.
  See: https://github.com/Human-Harness/humanharness/pull/173 · report `runs/humanharness/file-size-ratchet/ipc-split.report.md`
  </details>

## deps-state — merged

- **D4** · `lastAppState` stays in index.ts, and `appState` writes it through a `setLastAppState` dep. · _worker (T2)_
  <details><summary>more</summary>

  Why: `profilesIpc` also reads it, so `appState` is not its only user. The brief moves it only if `appState` is its only user.
  Rejected: Returning `{ appState, lastAppState }` from `createAppState`, which would change the "returns the same appState function" shape.
  See: https://github.com/Human-Harness/humanharness/pull/174 · report `runs/humanharness/file-size-ratchet/deps-state.report.md`
  </details>

- **D5** · Inside `appState` and `backupView`, `harness` is read once (`const harness = d.harness()`) instead of on every use. · _worker (T2)_
  <details><summary>more</summary>

  Why: It is assigned only once at startup, so behaviour is unchanged, and it keeps TypeScript's narrowing on `harness.documents` and `harness.profiles`.
  Rejected: `d.harness()` at every use, which needs non-null assertions.
  See: https://github.com/Human-Harness/humanharness/pull/174 · report `runs/humanharness/file-size-ratchet/deps-state.report.md`
  </details>

## service-builders — merged

- **D6** · `engineIpcDeps` went into `engine-config/engine-ipc.ts`, next to `EngineIpcDeps` and `registerEngineIpc`. · _worker (T2)_
  <details><summary>more</summary>

  Why: It sits next to the channels it serves, and the file has room (16 KB).
  Rejected: `engine-switch.ts`, which is unrelated chat-archiving code, and a new top-level `engine-ipc.ts`.
  See: https://github.com/Human-Harness/humanharness/pull/175 · report `runs/humanharness/file-size-ratchet/service-builders.report.md`
  </details>

- **D7** · The job also moved `buildMaterialJobs`, `buildSingleJobs` and `buildTaskAttention`, which the brief does not name. Electron calls (dialogs, Notification, `shell.trashItem`, window focus) stay in index.ts and reach the new modules as deps. · _worker (T2)_
  <details><summary>more</summary>

  Why: The done-when says no `build*` builder may stay in index.ts. Passing Electron calls as deps keeps the moved modules testable without Electron.
  Rejected: Leaving those builders in index.ts, and importing electron in the new modules.
  See: https://github.com/Human-Harness/humanharness/pull/175 · report `runs/humanharness/file-size-ratchet/service-builders.report.md`
  </details>

## lifecycle — merged

- **D8** · One `lifecycle` deps object in `index.ts`, built from getters and setters over index's state, feeds both `onLoaded` and `onPrimary`. Its type is `typeof lifecycle`. · _worker (T2)_
  <details><summary>more</summary>

  Why: There are about 110 dependencies. Inferring the type keeps it exact, and the moved code stays almost unchanged.
  Rejected: A hand-written interface (around 250 lines of types to keep in sync by hand).
  See: https://github.com/Human-Harness/humanharness/pull/176 · report `runs/humanharness/file-size-ratchet/lifecycle.report.md`
  </details>

- **D9** · The e2e failures on `modes.spec.ts:40` and `review.spec.ts:285` were treated as pre-existing. Both fail the same way on base `baa141a9`, so the job was not held for them. Marco accepted 64d31d03 as done (q2, q3). After that the job's budget ran out ($16.35 of $12) and its resumed attempts kept ending FAILED on the gate hook. · _arkimedes_
  <details><summary>more</summary>

  Why: The specs are outside the job's area. The refactor was complete, committed, and green on typecheck and the shell and protocol vitest runs. `plugins-surface.spec.ts:141` and `sidekick.spec.ts:70` were also flaky under load. No retry could turn the full e2e step green.
  Rejected: Another worker attempt or a separate fix job first. Neither could pass the gate within the job's budget and area.
  See: https://github.com/Human-Harness/humanharness/pull/176 · report `runs/humanharness/file-size-ratchet/lifecycle.report.md`
  </details>

- **D10** · The plan was edited twice after approval, and Marco re-approved each time. First the gate skipped the four failing or flaky specs with `--grep-invert` via `pnpm e2e`. Then the e2e step became `corepack pnpm --filter @humanharness/shell build && cd packages/e2e && npx playwright test --grep-invert "modes\.spec|review\.spec|sidekick\.spec|plugins-surface\.spec"`. The job then re-ran only its gate on 64d31d03, with no worker work, and merged. · _arkimedes_
  <details><summary>more</summary>

  Why: The first edit did not work, because the root `pnpm e2e` script runs `build && playwright test` and drops the arguments. Run directly in `packages/e2e`, the filter lists 147 of 161 tests and leaves the four specs out. The gate is in the plan and outside the job's area, so only a plan change could fix it. The first re-approval was also refused for a while (an area overlap with the running plan `mods-0c1-mod-kit`) and only went through on 2026-11-15 00:31.
  Rejected: Overriding the gate for this job (the runner cannot), a first job that fixes the four specs on the integration branch, and more worker attempts.
  See: https://github.com/Human-Harness/humanharness/pull/176 · report `runs/humanharness/file-size-ratchet/lifecycle.report.md`
  </details>

## runtime-cut — merged

- **D11** · The job went beyond the listed groups: it also moved the IPC registration (`app-ipc.ts`), the engine-change helpers (`engine-change.ts`) and the backend wiring (`backend/backend-wiring.ts`). `index.ts` ended at 49,096 bytes against a 49,152 cap, so the next addition to it must move something out first. · _worker (T2)_
  <details><summary>more</summary>

  Why: The listed groups left index.ts at about 56 KB, still over the cap.
  Rejected: Splitting task-manager, sidekick or plugins (excluded from the plan), and squeezing index.ts by reformatting.
  See: https://github.com/Human-Harness/humanharness/pull/177 · report `runs/humanharness/file-size-ratchet/runtime-cut.report.md`
  </details>

- **D12** · Modules built after the main entry's `lifecycle` object take `LifecycleDeps` or a `() => lifecycle` getter, instead of long per-module dep lists. · _worker (T2)_
  <details><summary>more</summary>

  Why: The entry already exports that type for `app-lifecycle.ts`. A getter keeps the start-up order (no TDZ), and lifecycle's getters keep mutable state live.
  Rejected: Duplicating about 40 getters into per-module deps interfaces, which would have grown index.ts.
  See: https://github.com/Human-Harness/humanharness/pull/177 · report `runs/humanharness/file-size-ratchet/runtime-cut.report.md`
  </details>
