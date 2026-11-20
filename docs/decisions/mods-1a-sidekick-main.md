# Decisions — mods-1a-sidekick-main

Plan: /Users/marcozanger/.claude/arkimedes/approvals/humanharness/mods-1a-sidekick-main/v1/plan.md · approved 2026-11-18 · closed 2026-11-19
Jobs: 2 merged, 2 blocked · Decisions: 5 worker, 0 reviewer, 3 arkimedes

## mod-api — merged

- **D1** · Marco widened the job's area to `packages/shell/scripts/hh.d.ts`. The worker regenerated it with `hh-dts` and committed only that file. · _arkimedes_
  <details><summary>more</summary>

  Why: the mod-sdk type changes T1 requires made the generated file stale, so `manual.test.ts` ("hh.d.ts is what the script generates") was the only red test in the gate. The regeneration changed +101/-2 lines, all script output, which is more than the small-fix rule allows. Widening was not open to the runner, so Marco had to grant it (q1, answered ok).
  Rejected: editing the file by hand; leaving the gate red.
  See: https://github.com/Human-Harness/humanharness/pull/214 · report `runs/humanharness/mods-1a-sidekick-main/mod-api.report.md`
  </details>

- **D2** · Core mods' main reads zod and mod-sdk from `globalThis.__hhMainModules`, inlined as a shim, not from shim files. · _worker (T2)_
  <details><summary>more</summary>

  Why: the shim files live in userData and only exist at runtime.
  Rejected: resolving them at build time to a path inside the app.
  See: https://github.com/Human-Harness/humanharness/pull/214 · report `runs/humanharness/mods-1a-sidekick-main/mod-api.report.md`
  </details>

- **D3** · The bundler moved to a new `@humanharness/mod-sdk/build` export with no relative imports, and `./bundle` re-exports it. · _worker (T2)_
  <details><summary>more</summary>

  Why: the shell's build config loads mod-sdk's TS source with Node, which cannot resolve the extensionless `./index`.
  Rejected: a cross-package relative import in the shell.
  See: https://github.com/Human-Harness/humanharness/pull/214 · report `runs/humanharness/mods-1a-sidekick-main/mod-api.report.md`
  </details>

- **D4** · The "built app contains a core mod's main" test runs `buildCoreMods` on a fixture core mod and loads it through `ModHost`. · _worker (T2)_
  <details><summary>more</summary>

  Why: no core mod has a main yet, and `packages/mods/**` is outside the area.
  Rejected: a test-only core mod in the real build.
  See: https://github.com/Human-Harness/humanharness/pull/214 · report `runs/humanharness/mods-1a-sidekick-main/mod-api.report.md`
  </details>

## core-seams — merged

- **D5** · `sourceTagKey` now lives in `linked-ipc.ts`, with a re-export left in `sidekick-import.ts`. · _worker (T2)_
  <details><summary>more</summary>

  Why: `linked-ipc.ts` is the only core file in the area that uses it, and the area doesn't allow a new file under `shell/src/main`.
  Rejected: a new `source-tag-key.ts` or editing `app-lifecycle.ts` (both outside the area).
  See: https://github.com/Human-Harness/humanharness/pull/215 · report `runs/humanharness/mods-1a-sidekick-main/core-seams.report.md`
  </details>

## move-main — blocked

- **D6** · The worker found the merged mod API cannot carry the Sidekick controller behind a `ctx → SidekickDeps` adapter, and asked whether to widen its area. · _arkimedes_
  <details><summary>more</summary>

  Why: `ctx` has no push to the window, no multi-turn engine sessions (model and engine id), no harness phases or name, no `sidekick` config key, no uiLanguage, dailyInput, file picker or source-tag key, and no writes as the person. Fixing this means changing `packages/mod-sdk` and `shell/src/main/mods/host.ts`, which are in mod-api's area, so a widen was not possible.
  Rejected: widening move-main's area (not possible); adding the bridge inside move-main.
  See: report `runs/humanharness/mods-1a-sidekick-main/move-main.report.md`
  </details>

- **D7** · Marco answered ok to Euklides's proposal, so move-main was stopped and ended blocked. The plan must gain a `mod-bridge` job before move-main reruns. · _arkimedes_
  <details><summary>more</summary>

  Why: `mod-bridge` (area `packages/mod-sdk/**` and `packages/shell/src/main/mods/**`) would add a core-only `ctx.push(channel, value)` and a core-only `ctx.app` service with what `SidekickDeps` needs. move-main would then rerun with `after: [mod-bridge]`, keeping the worker's plan of re-export shims at the old paths. Harness and local mods would get neither.
  Rejected: another job adding only `ctx.push` plus a separate app bridge (the worker's alternative).
  See: report `runs/humanharness/mods-1a-sidekick-main/move-main.report.md`
  </details>

## remove-seams — blocked

- **D8** · The job was never started because it depends on move-main, which is blocked. · _arkimedes_
  <details><summary>more</summary>

  Why: remove-seams builds on the mod API that move-main would have completed, so it follows the same fix.
  Rejected: running it against the incomplete mod API.
  See: report `runs/humanharness/mods-1a-sidekick-main/remove-seams.report.md`
  </details>
