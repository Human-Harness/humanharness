# Decisions — mods-0c2-harness-kit-2

Plan: /Users/marcozanger/.claude/arkimedes/desk/humanharness/mods-0c2-harness-kit-2/plan.md · approved 2026-11-17 · closed 2026-11-17
Jobs: 2 merged, 0 blocked · Decisions: 5 worker, 0 reviewer, 2 arkimedes

## harness-template — merged

- **D1** · The example card goes in the header of `home`, which became an inner stack with `header: { mod: "example", block: "card" }` around a `home-screen` block. · _worker (Sonnet 5.5)_
  <details><summary>more</summary>

  Why: a block node has no header, and a header on the root stack would also show on `work`.
  Rejected: a header on the root stack; a column with a size the worker would have had to pick.
  See: https://github.com/Human-Harness/humanharness/pull/209 · report `runs/humanharness/mods-0c2-harness-kit-2/harness-template.report.md`
  </details>

- **D2** · The notes on mods and layout live in HARNESS.md → Decisions, not in a new section. · _worker (Sonnet 5.5)_
  <details><summary>more</summary>

  Why: `parseHarnessMd` is outside the job's area, and its tests reject unknown sections.
  Rejected: a new "Mods and layout" section.
  See: https://github.com/Human-Harness/humanharness/pull/209 · report `runs/humanharness/mods-0c2-harness-kit-2/harness-template.report.md`
  </details>

- **D3** · The integration gate failed on `style-guard.test.ts` › "the list only shrinks". Deleting the `.example-card` rules left lines 16–17 of `packages/ui/test/style-guard-offenders.json` stale, and that file was outside the job's area. The job asked whether it could take the file, and Marco answered ok. · _arkimedes_
  <details><summary>more</summary>

  Why: no other job in the run claims `packages/ui`, so widening this job's area was the smallest fix. The worker removed only those two lines and the gate went green.
  Rejected: leaving the file to another job; blocking the job (`:stop`).
  See: https://github.com/Human-Harness/humanharness/pull/209 · report `runs/humanharness/mods-0c2-harness-kit-2/harness-template.report.md`
  </details>

- **D4** · `check` and `run` tests that need the example block now declare it with a `withExampleCard` helper. Test files unrelated to mods mock `kit/check` with a stub that passes a mod folder identical to the template's sample mod without bundling it. · _worker (Sonnet 5.5)_
  <details><summary>more</summary>

  Why: without the stub, the slow mod check made dev, plugin-dev and tool-run time out under the gate. The stub was later dropped from `run.test.ts` because `run` never checks.
  Rejected: running the real mod check in every test file.
  See: https://github.com/Human-Harness/humanharness/pull/209 · report `runs/humanharness/mods-0c2-harness-kit-2/harness-template.report.md`
  </details>

## harness-mode — merged

- **D5** · `TOOL_NAMES` stays the app's seven tools (= `APP_TOOLS`), and the harness tools live in a separate `HARNESS_TOOLS`. · _worker (Sonnet 5.5)_
  <details><summary>more</summary>

  Why: the shell's `manual.test.ts` is outside the area and requires the app manual to name every `TOOL_NAMES` entry, and `harness_init` and `harness_check` are not app tools.
  Rejected: adding them to `TOOL_NAMES`, which breaks that test or needs a manual change outside the area.
  See: https://github.com/Human-Harness/humanharness/pull/210 · report `runs/humanharness/mods-0c2-harness-kit-2/harness-mode.report.md`
  </details>

- **D6** · `harness_init` skips `pnpm install` and `git init` unless `skipInstall: false` is passed, and it spawns its children quietly with stdout ignored. · _worker (Sonnet 5.5)_
  <details><summary>more</summary>

  Why: the brief says the default is to skip, and child output on stdout would corrupt the MCP stdio transport.
  Rejected: inheriting stdio.
  See: https://github.com/Human-Harness/humanharness/pull/210 · report `runs/humanharness/mods-0c2-harness-kit-2/harness-mode.report.md`
  </details>

- **D7** · With no flag, a folder holding `harness.config.ts` counts as harness mode before `.layers.json` in the same folder. The core is the realpath of `node_modules/@humanharness/cli`, else the `link:` in package.json, else `CORE_DIR`. · _worker (Sonnet 5.5)_
  <details><summary>more</summary>

  Why: this follows the brief's "found before any .layers.json", and a project made with `--skip-install` has no node_modules yet.
  Rejected: using `CORE_DIR` only.
  See: https://github.com/Human-Harness/humanharness/pull/210 · report `runs/humanharness/mods-0c2-harness-kit-2/harness-mode.report.md`
  </details>
