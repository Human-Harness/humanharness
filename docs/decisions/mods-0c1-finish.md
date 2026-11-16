# Decisions — mods-0c1-finish

Plan: /Users/marcozanger/.claude/arkimedes/desk/humanharness/mods-0c1-finish/plan.md · approved 2026-11-16 · closed 2026-11-16
Jobs: 2 merged, 0 blocked · Decisions: 6 worker, 0 reviewer, 0 arkimedes

## mod-tools — merged

- **D1** · `mod_new` validates ids with the mod-sdk's `MOD_ID` (at most 40 chars) instead of the brief's `{0,47}`. · _worker (Sonnet 5.5)_
  <details><summary>more</summary>

  Why: a 41–48 char id would be created and then fail `mod.json`'s schema and `mod_check`.
  Rejected: the brief's regex as written.
  See: https://github.com/Human-Harness/humanharness/pull/206 · report `runs/humanharness/mods-0c1-finish/mod-tools.report.md`
  </details>

- **D2** · A mod's `description` comes from `mod.json` if present, otherwise from the README's first paragraph. `mod_new` writes it into the README. · _worker (Sonnet 5.5)_
  <details><summary>more</summary>

  Why: `modJsonSchema` is strict and has no `description` (nor blocks/hooks/settings), so a mod.json carrying one would fail `mod_check`.
  Rejected: adding fields to mod.json.
  See: https://github.com/Human-Harness/humanharness/pull/206 · report `runs/humanharness/mods-0c1-finish/mod-tools.report.md`
  </details>

- **D3** · zod is imported from `@humanharness/harness-sdk/tool` rather than added to the CLI. The catalog test copies the real `hh.d.ts` into its temp home instead of keeping a fixture. · _worker (Sonnet 5.5)_
  <details><summary>more</summary>

  Why: a CLI `zod` dependency would change the root lockfile, which is outside the job's area. A fixture `hh.d.ts` would be typechecked as the real packages' ambient modules.
  Rejected: a CLI `zod` dependency; a fixture copy of `hh.d.ts`.
  See: https://github.com/Human-Harness/humanharness/pull/206 · report `runs/humanharness/mods-0c1-finish/mod-tools.report.md`
  </details>

## manual-e2e — merged

- **D4** · `TOOL_NAMES` moved into a new import-free file `packages/cli/src/mcp/tool-names.ts`. `server.ts` re-exports it and the shell test imports it by relative path. · _worker (Sonnet 5.5)_
  <details><summary>more</summary>

  Why: the test uses the server's own constant, as the plan asked, without pulling the MCP SDK and the kit into a shell test.
  Rejected: importing `server.ts` directly (drags in the CLI's whole dependency graph); a copy of the list (the plan forbids it).
  See: https://github.com/Human-Harness/humanharness/pull/207 · report `runs/humanharness/mods-0c1-finish/manual-e2e.report.md`
  </details>

- **D5** · The e2e drops `setViewportSize` and compares the `shot` PNG with the window's content size × the display's scale factor. · _worker (Sonnet 5.5)_
  <details><summary>more</summary>

  Why: viewport emulation renders 1280×900 inside an 1100×720 window, so "the window's size" would not hold.
  Rejected: comparing with the emulated viewport.
  See: https://github.com/Human-Harness/humanharness/pull/207 · report `runs/humanharness/mods-0c1-finish/manual-e2e.report.md`
  </details>

- **D6** · The minimal-core spec amendment also removes "Change this app" from the §3.1 core table and §6 Security, beyond the lines the plan listed. The §5.6 number is kept (no renumbering). · _worker (Sonnet 5.5)_
  <details><summary>more</summary>

  Why: the plan's goal is that the spec stops promising the action, and D1 of the spec refers to §5.6.
  Rejected: leaving a stray mention; renumbering the sections.
  See: https://github.com/Human-Harness/humanharness/pull/207 · report `runs/humanharness/mods-0c1-finish/manual-e2e.report.md`
  </details>
