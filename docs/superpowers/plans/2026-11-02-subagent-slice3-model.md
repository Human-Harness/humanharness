# Subagent policy, slice 3 — Model (D2)

> Parent plan: `2026-11-02-subagent-policy.md` (decision D2, Phase 2 slice 3). TDD: each task starts from its failing test.

**Goal:** when subagents are allowed on Claude, they run one tier below the task: deep → standard's model (sonnet), standard → light's (haiku), light → light's (haiku). The `ModelPolicy` chooses it, the transport passes it through `--agents`, and the task's profile in `tasks.json` records it.

## Spike (open questions a and b), Claude Code 2.1.316, 2026-11-02

n=1 per condition, `claude -p --model sonnet --allowedTools Task,Agent`, prompt "use the Agent tool with subagent_type general-purpose to answer 2+2".

- **(a) Can `--agents` override the built-in `general-purpose`? Yes.** With `--agents '{"general-purpose":{"description","prompt","model":"haiku"}}'` the spawned `general-purpose` ran on haiku (`modelUsage` had `claude-haiku-5-5` next to the sonnet row). Caveat: the definition replaces the built-in's own prompt, so ours must carry a generic one. `--agents` also accepts a file path under `-p`.
- **(b) Does the parent's prompt cache survive? Yes, when the flag is stable.** Two runs with the same `--agents`: the second read 34 312 tokens from the parent's cache and wrote 4 763 (first run: 28 538 read, 10 536 written). Adding or removing `--agents` changes the tool descriptions (the Agent tool lists the types), so the first turn after a change writes a new prefix (run without `--agents`: 23 042 written). The definition is fixed per task (D2), so it never changes mid-task. The haiku subagent has its own cache, never the parent's.
- **Extra finding: two `--agents` flags do not merge, the last wins.** `--agents '{"zed":…}' --agents file` left `zed` unknown. A scope preset that ships `agentsFile` already emits `--agents <file>`, so we cannot add ours next to it.

## Decisions that follow

- The inline `--agents` is emitted only when subagents are allowed (`permissions.subagents ?? preset has agentsFile`) **and** the preset has no `agentsFile`. A preset that ships agents owns its definitions (and their `model`); merging would mean reading the file in the transport. Known gap, noted in `engines.md`.
- Only `general-purpose` is overridden: it is the type that otherwise inherits the task's model. `Explore` is already haiku; `Plan` is left alone.
- `ModelProfile.subagentModel?: string` (set by `pick` and `fallback` of the default policy, only when the engine's tier table names a model) is the record. It is set whether or not subagents are allowed, because the profile is resolved before the permissions are known; the transport applies it only when allowed.
- `ModelPolicy.subagentModel(profile, models)`: `tierBelow`-style, light stays light; a `custom` profile counts as light's model (nothing is below a custom choice we can trust); an engine without a model in its table gives `undefined`.
- Codex/OpenCode parity is slice 5.

## Tasks

1. **Policy.** Failing tests in `packages/policies/test/model.test.ts`: `subagentModel` per tier on claude (deep → sonnet, standard → haiku, light → haiku), through the user's table, custom → light's model, codex → undefined; `pick` and `fallback` carry `subagentModel` on the profile (absent for codex).
2. **Profile record.** `ModelProfile.subagentModel` (`packages/engines/src/models.ts`) and `cleanProfile` (`packages/shell/src/main/models.ts`) keep a valid one and drop one that reads as a flag. Test in `packages/shell/test/task-store.test.ts`.
3. **Transport.** Failing tests in `packages/engines/test/claude-cli.test.ts`: allowed + `subagentModel` → `--agents` JSON with `general-purpose` and that `model`; denied (default, `subagents: false`) → no `--agents`; preset with `agentsFile` → only the file; no `subagentModel` → no `--agents`; a model that reads as a flag throws.
4. **Docs.** `docs/architecture/engines.md`: the Claude line and a short D2 paragraph with the spike answers and the known gap.

## Gate

`test` + `typecheck` of `packages/policies`, `packages/engines`, `packages/shell` (and `packages/runtime` if a golden argv changes).
