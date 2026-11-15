# Decisions — release-macos

Plan: /Users/marcozanger/.claude/arkimedes/desk/humanharness/release-macos/plan.md · approved 2026-11-15 · closed 2026-11-15
Jobs: 4 merged, 0 blocked · Decisions: 8 worker, 0 reviewer, 2 arkimedes

## packaged-paths — merged

- **D1** · Shortened two comments in `packages/shell/src/main/index.ts` to bring it back under the 48 KB size cap after the new `harnessDir` constant pushed it over. · _worker (model not stated)_
  <details><summary>more</summary>

  Why: the file went over the cap by 56 bytes.
  Rejected: raising the size baseline (it only goes down); moving code out of index.ts (outside the job's scope).
  See: https://github.com/Human-Harness/humanharness/pull/189 · report `runs/humanharness/release-macos/packaged-paths.report.md`
  </details>

- **D2** · Removed the `__HARNESS_DIR__` mention from the `shellResourcesDir` doc comment so the symbol appears only in its `declare` and the single call. · _worker (model not stated)_
  <details><summary>more</summary>

  Why: the done criterion says it is "read in one place only", and a comment hit would show up in a grep.
  Rejected: leaving the comment in place.
  See: https://github.com/Human-Harness/humanharness/pull/189 · report `runs/humanharness/release-macos/packaged-paths.report.md`
  </details>

## package-cmd — merged

- **D3** · `packageConfig` takes `appDir` (packages/shell), `buildDir` and `outDir`, with no `publish` flag. · _worker (model not stated)_
  <details><summary>more</summary>

  Why: the shell's package.json and its production node_modules make up the app, and publish is an option of `build()`, not of the config.
  Rejected: staging a separate app folder; a `publish` parameter that changes nothing.
  See: https://github.com/Human-Harness/humanharness/pull/190 · report `runs/humanharness/release-macos/package-cmd.report.md`
  </details>

- **D4** · "Signing present" means CSC_LINK plus all three APPLE_API_* variables. With CSC_LINK alone the command warns and builds unsigned (`identity: null`). · _worker (model not stated)_
  <details><summary>more</summary>

  Why: notarization would fail without the API key.
  Rejected: signing without notarizing.
  See: https://github.com/Human-Harness/humanharness/pull/190 · report `runs/humanharness/release-macos/package-cmd.report.md`
  </details>

- **D5** · `mac.x64ArchFiles` lists the per-arch prebuilt packages that pnpm installs for both arches. `--out` defaults to a temp folder and must not be inside the harness folder. · _worker (model not stated)_
  <details><summary>more</summary>

  Why: the universal build fails on identical files without that list. The harness folder is copied into the app, so an out folder inside it would be packaged too.
  Rejected: `asar: false`; an out folder inside the repo.
  See: https://github.com/Human-Harness/humanharness/pull/190 · report `runs/humanharness/release-macos/package-cmd.report.md`
  </details>

## updater — merged

- **D6** · A check that throws synchronously is also caught and logged, not only promise rejections. · _worker (model not stated)_
  <details><summary>more</summary>

  Why: "nothing throws out of it" should hold for any updater implementation.
  Rejected: relying on promise rejection only.
  See: https://github.com/Human-Harness/humanharness/pull/191 · report `runs/humanharness/release-macos/updater.report.md`
  </details>

- **D7** · The first integration gate failed on `packages/cli/test/check.test.ts` (30 s timeout in a 599-file run). The job went back to the worker, which re-ran with no code change and the gate passed. · _arkimedes_
  <details><summary>more</summary>

  Why: the worker found that the test touches nothing in this job and passes alone in about 10 s, so it judged the failure to be load flakiness. The head stayed b27ffb19 across both attempts, and the retry was green on bc8c5238.
  Rejected: none recorded. The flaky timeout itself was not fixed.
  See: https://github.com/Human-Harness/humanharness/pull/191 · report `runs/humanharness/release-macos/updater.report.md`
  </details>

## release-ci — merged

- **D8** · Scripts tests run through a new `scripts/vitest.config.ts`, and the root `test` script runs both configs. · _worker (model not stated)_
  <details><summary>more</summary>

  Why: the root vitest.config.ts only includes package folders and is outside the job's area, so `pnpm test` and CI would skip the scripts tests. The gate's `--changed` run still does not execute them.
  Rejected: editing vitest.config.ts; moving the tests under packages/.
  See: https://github.com/Human-Harness/humanharness/pull/192 · report `runs/humanharness/release-macos/release-ci.report.md`
  </details>

- **D9** · The workflow YAML test loads js-yaml from electron-builder's dependency tree instead of adding a dependency. · _worker (model not stated)_
  <details><summary>more</summary>

  Why: a new dependency would change pnpm-lock.yaml (outside the area) and break `--frozen-lockfile`.
  Rejected: adding `yaml` as a devDependency.
  See: https://github.com/Human-Harness/humanharness/pull/192 · report `runs/humanharness/release-macos/release-ci.report.md`
  </details>

- **D10** · The run waited from 17:42 to 19:45 because its area overlapped the running plan test-health-under-load, whose PR #188 was still open. It started only afterwards, from master @ 99d0a9b4. · _arkimedes_
  <details><summary>more</summary>

  Why: overlapping areas risk conflicts, so the run was held until the other plan's final PR was resolved. An ALERT was raised at 19:39.
  Rejected: none recorded.
  See: https://github.com/Human-Harness/humanharness/pull/188
  </details>
