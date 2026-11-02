# Subagent policy, slice 2 — Permission (D1)

> Parent plan: `2026-11-02-subagent-policy.md` (fact 1, decision D1, Phase 2 slice 2). TDD: each task starts from its failing test.

**Goal:** `Task` and `Agent` are in the Claude session's `--disallowedTools` by default, in task and job slots. They are allowed only when the manifest sets `permissions.subagents: true` or the scope's engine preset ships `agentsFile`. This is the deliberate D0 break written in the hatches spec §5.4 (every harness's `--disallowedTools` changes).

**Decisions that follow from D1:**

- `permissions.subagents` is optional, so a manifest without it parses to the same object as before.
- A job may narrow it (`permissions.subagents: false`), never widen it, like `edit`, `exec` and `web`. An AI step's slot is always narrowed to no subagents.
- The preset exemption lives in `claudeArgs` (it is the one place that sees both the permissions and the preset); `disallowedTools` takes a final `subagents` argument that defaults to `permissions.subagents === true`.
- The manifest "check message" is the schema's: `permissions.subagents` must be a boolean, and a job asking for it without the harness's is refused with "A job's permissions can only narrow the harness's". `humanharness check` (packages/cli) already reports `defineHarness` errors, so it needs no change.
- Codex/OpenCode parity is slice 5 and stays a known gap in `engines.md`.

## Tasks

1. **Schema.** Failing tests in `packages/harness-sdk/test/harness.test.ts`: `permissions.subagents: true` parses and is kept; absent stays absent (parsed object unchanged); a non-boolean is refused with a message naming `permissions.subagents`.
2. **Narrowing.** Failing tests in `packages/harness-sdk/test/parallel.test.ts`: `narrowPermissions` keeps `subagents` only when the base has it and the override does not turn it off; an override can't turn it on; the result has no `subagents` key when the base has none. In `packages/harness-sdk/test/jobs.test.ts`: a job with `permissions.subagents: true` under a harness without it is refused; `false` is accepted.
3. **Transport default-deny.** Update the test in `packages/engines/test/claude-cli.test.ts` that pinned "a normal session does not deny `Task`/`Agent`" and the exact `disallowedTools` lists: `Task` and `Agent` are denied by default (once each, also in an MCP-only session). New tests: `permissions.subagents: true` leaves them out; `claudeArgs` with a preset that ships `agentsFile` leaves them out; a preset without `agentsFile` still denies them; a manifest without the opt-in plus a preset's `allow: ["Task"]` still denies them (the harness wins).
4. **Runtime.** `narrowPermissions` already feeds job and step slots in `packages/runtime/src/workspace.ts`; a test in `packages/runtime` is only added if the existing ones fail.
5. **Docs.** `docs/architecture/manifest.md` (the `permissions` row and the checks list) and `docs/architecture/engines.md` (the Claude line and the preset line).

## Gate

`test` + `typecheck` of `packages/engines`, `packages/harness-sdk` and any package whose tests fail from the new default (`packages/runtime`).
