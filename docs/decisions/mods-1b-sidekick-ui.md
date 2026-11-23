# Decisions — mods-1b-sidekick-ui

Plan: /Users/marcozanger/.claude/arkimedes/approvals/humanharness/mods-1b-sidekick-ui/v2/plan.md · approved 2026-11-23 · closed 2026-11-23
Jobs: 1 merged, 6 blocked · Decisions: 2 worker, 0 reviewer, 3 arkimedes

## mod-calls — merged

- **D1** · `UiCtx.call`/`on` and `ModsIpcDeps.call` are optional in the types. · _worker (Sonnet 5.5)_
  <details><summary>more</summary>

  Why: making them required breaks four files outside this job's area that build these objects by hand. A later job that wires `renderer/main.tsx` should pass `core: [home, …]` to `startModLoader`. After that, the fields can become required.
  Rejected: editing those four files in this job.
  See: https://github.com/Human-Harness/humanharness/pull/223 · report `runs/humanharness/mods-1b-sidekick-ui/mod-calls.report.md`
  </details>

- **D2** · A mod's `ctx.push` without the `hh:` prefix goes only to that mod's own UI, core mods included. `hh:modPush` is not an app push channel. · _worker (Sonnet 5.5)_
  <details><summary>more</summary>

  Why: otherwise a core mod could send a push carrying another mod's id.
  Rejected: a separate method name for core mods.
  See: https://github.com/Human-Harness/humanharness/pull/223 · report `runs/humanharness/mods-1b-sidekick-ui/mod-calls.report.md`
  </details>

- **D3** · In v1 the docs-coverage tests blocked mod-calls. The run did not widen its area into `docs/`. It stopped the job instead, and v2 moved `docs/architecture/contract.md` into mod-calls' area. · _arkimedes_
  <details><summary>more</summary>

  Why: `docs/architecture/mods.md` and `contract.md` belonged to ratchet-e2e's area, and a widen never takes another job's files. Marco's answer to q2 was not to touch `docs/`: list `hh:modCall` and `hh:modPush` in `undocumented.json` and leave the prose to ratchet-e2e (T11). The `contract.md` staleness test stayed red, so Marco answered q3 "ok" and mod-calls ended blocked. v2 changed the plan so the job regenerates `contract.md` with `pnpm docs:gen`. Both channels stay in `undocumented.json` until ratchet-e2e documents them in `mods.md`.
  Rejected: waiting for ratchet-e2e's `docs:gen`, which would leave the job's own gate red. Regenerating `contract.md` without a plan change.
  See: https://github.com/Human-Harness/humanharness/pull/223 · report `runs/humanharness/mods-1b-sidekick-ui/mod-calls.report.md`
  </details>

- **D4** · Marco approved recording the new mod API (`ctx.push`, `UiCtx.call`/`on`) in the v1 copy with `contracts accept`. The change was committed in the job. · _arkimedes_
  <details><summary>more</summary>

  Why: `contract.json` says `frozen: false`, so `accept` only overwrites `packages/mod-sdk/released/hh.v1.d.ts`. PR #216 updated the same files the same way. The permission classifier had blocked the command for the worker and for Euklides.
  Rejected: leaving the contracts test red.
  See: https://github.com/Human-Harness/humanharness/pull/223 · report `runs/humanharness/mods-1b-sidekick-ui/mod-calls.report.md`
  </details>

## ui-slots — blocked

Blocked because mod-calls was blocked in v1; no worker ran and there is no report. No separate decision.

## move-task-ui — blocked

Blocked because ui-slots was blocked; no worker ran and there is no report. No separate decision.

## move-settings-ui — blocked

Blocked because move-task-ui was blocked; no worker ran and there is no report. No separate decision.

## channels-rename — blocked

- **D5** · channels-rename did not start in v2, although mod-calls merged. It is still waiting on move-settings-ui, which is blocked. · _arkimedes_
  <details><summary>more</summary>

  Why: v2 changed the plan only for channels-rename and mod-calls, and only mod-calls was re-run. The chain ui-slots → move-task-ui → move-settings-ui → channels-rename stayed blocked from v1. The plan change that gave mod-calls `contract.md` was also meant to cover channels-rename, which changes `channels.ts` too.
  Rejected: none.
  See: no PR · no report
  </details>

## manifest-key — blocked

Blocked because channels-rename was blocked; no worker ran and there is no report. No separate decision.

## ratchet-e2e — blocked

Blocked because manifest-key was blocked; no worker ran and there is no report. When it runs, it must document `hh:modCall` and `hh:modPush` in `docs/architecture/mods.md`, remove both entries from `undocumented.json`, and rerun `pnpm docs:gen`. No separate decision.
