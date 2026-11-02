# Subagents in harness sessions — evaluation and implementation plan

> **For agentic workers:** Phase 0 is a spike: no product code. Phase 2 only starts after Marco closes the decision gate; each slice then gets its own TDD plan (superpowers:writing-plans) and runs with superpowers:subagent-driven-development.

**Goal:** Know what Claude's built-in subagents (`Task` / `Agent`) cost inside a harness task today, then make their use an explicit, cheap and measured choice instead of an accident.

**Why now:** Marco's own Claude Code baseline (W44, `~/.claude/coach/weekly/improvement-plan.md`) showed subagents as 79% of the cost, 96% of them on Opus, and one session carrying ~224k tokens of subagent handbacks. Harness sessions are the same `claude` binary, so the same failure is possible for every person who uses a harness, and they can't see it or turn it off.

---

## What the core already covers (no work needed)

| Problem in the W44 baseline | Already in humanharness |
|---|---|
| One orchestrator session for a whole plan | One engine session per task; a note when it closes; the next task starts from the notes index (`docs/architecture/context.md`) |
| No alarm before compaction | Checkpoint `save_note` at 80% of the cap (`CHECKPOINT_AT`, `packages/policies/src/context.ts`) |
| Big model by default | Tier per task, light/standard/deep → haiku/sonnet/opus (`DEFAULT_TIERS`, `packages/engines/src/models.ts:94`); jobs default to light |
| Bloated handbacks from background work | `job_result`: one line, ≤300 code points (`docs/architecture/jobs.md`) |
| No measurement | `usage.jsonl` per turn, with kind, tier, model and compactions |

## What is not covered (facts, from the code)

1. **Subagents are allowed in every normal task and job slot.** `Task` and `Agent` are denied only in MCP-only sessions (`MCP_ONLY_DENIED`, `packages/engines/src/claude/transport.ts:24`); a test pins that a normal session does not deny them (`packages/engines/test/claude-cli.test.ts:570`).
2. **They run on the task's model.** Claude starts with `--setting-sources project` (`transport.ts:232`), so a user-level `CLAUDE_CODE_SUBAGENT_MODEL` never applies; a built-in subagent inherits the parent's model → Opus in a `deep` task.
3. **Their handback is unbounded.** Whatever the subagent returns enters the task's context as a tool result.
4. **Their tokens are probably not recorded.** The parser drops every line with a `parent_tool_use_id` (`transport.ts:336`), and the `usage` event comes from `result.usage` (`transport.ts:400`). Hypothesis to verify: `result.usage` counts the main thread only, while `total_cost_usd` (kept as `costEquivalentUsd`) includes subagents — so tokens and cost disagree and Settings › Usage understates heavy tasks.
5. **Exception that must keep working:** engine presets can pass their own agents (`--agents engine.agentsFile`, `transport.ts:240`; `docs/architecture/hatches.md`). A preset that ships agents expects the `Task` tool.

---

## Phase 0 — Spike: measure before deciding

Output: `docs/spikes/2026-11-0X-subagents.md`, with the commands used so every number can be reproduced. Keep real engine calls under ~10, small prompts.

- [x] **S1 · Does a harness task spawn one at all, unprompted?** Run 3 actions of `harnesses/demo` at `standard` and `deep` with `humanharness run` and count `Task`/`Agent` tool uses in the raw stream-json (capture it by running `claude` with the exact `claudeArgs(...)` output, or a temporary tap on the transport in the spike branch only). Record: count per action, subagent type, prompt that triggered it.
- [x] **S2 · Forced case.** One `deep` task whose message asks to "use a subagent to map packages/". Record:
  - whether `Agent` runs with no permission prompt under `--permission-mode acceptEdits` and `default` in `-p`;
  - the subagent's model (from its own `system/init` line or `result.modelUsage`);
  - the size of the `tool_result` it hands back (characters ÷ 4);
  - the task's context before and after (`context` events).
- [x] **S3 · What the usage line misses.** For S2's turn: `result.usage` vs `result.modelUsage` (per model) vs `total_cost_usd`. Confirm or refute fact 4, with numbers.
- [x] **S4 · Model override.** Same as S2 with `CLAUDE_CODE_SUBAGENT_MODEL=sonnet` in the process env (not settings): does the subagent switch model? Does the parent's cache stay valid?
- [x] **S5 · Codex and OpenCode.** Codex's ACP init advertises `sessionCapabilities.subagents` (`docs/spikes/2026-10-10-transports.md`). Note only: does an ACP turn surface subagent usage or tool calls? No implementation in this plan.

**Done when** the spike doc answers S1–S5 with numbers and ends with an estimate: share of a heavy task's real cost that is subagents, and tokens a handback adds.

---

## Decision gate (Marco, after the spike)

Each decision has a recommendation; the spike can overturn it.

- **D1 · Default.** *Recommended:* deny `Task` and `Agent` in task and job slots, unless the manifest opts in with `permissions.subagents: true`, or the scope's engine preset ships `agentsFile`. Reason: a task is one topic for a non-technical person; the notes already carry memory across tasks. This is a deliberate D0 break (every harness's `--disallowedTools` changes), so it needs its own line in the spec. *Alternative:* allow, but always cap model and handback (D2 + D3). If S1 shows zero unprompted spawns, the cheapest move is deny-by-default and nothing else.
- **D2 · Model when allowed.** *Recommended:* one tier below the task (deep → sonnet, standard → haiku, light → haiku), chosen by the `ModelPolicy` (new `subagentModel` in its pick) and passed as `CLAUDE_CODE_SUBAGENT_MODEL` in the process env. Fixed per task like the rest of the profile.
- **D3 · Handback contract when allowed.** *Recommended:* a `### Subagents` part in the managed section of `AGENTS.md`: ask subagents for a ≤5-line answer (status, what changed, one-line issues) and to put details in the files they edit, never in the reply. Prompt-only: no report files in the person's folder.
- **D4 · Measurement.** *Recommended, whatever D1 says:* record subagent usage from `result.modelUsage` as its own lines (`phase: "subagent"`, model, tokens), split out in Settings › Usage like background jobs ("Subagents: about N tokens"). Presets with agents keep it measurable.
- **D5 · Fit with "driving modes"** (queue item 2026-10-28: eco/hybrid/sport). *Recommended:* ship D1's flag now; driving modes later maps eco → deny, sport → allow.

---

## Phase 2 — Implementation slices (after the gate)

One PR each, in this order. Each gets its own TDD plan before code.

| # | Slice | Area | Waits for |
|---|---|---|---|
| 1 | **Measure** (D4): parse `result.modelUsage`, emit subagent usage, write `phase: "subagent"` lines, usage tab caption | `packages/engines/src/claude/transport.ts`, `contract.ts`, `packages/shell/src/main/usage-log.ts`, `packages/ui` usage view | `worktree-ui-tweaks` merged (touches `packages/ui`, `packages/shell`) |
| 2 | **Permission** (D1): `permissions.subagents` in the manifest schema, `disallowedTools` denies by default, preset with `agentsFile` exempt, `narrowPermissions` for jobs, `check` message | `packages/harness-sdk`, `packages/engines/src/claude/transport.ts`, docs `manifest.md`, `engines.md` | slice 1; the warm-prefix work if it has reached `claudeArgs` by then |
| 3 | **Model** (D2): `subagentModel` in `ModelPolicy`, env on the Claude process, recorded on the task profile | `packages/policies/src/model.ts`, transport env, `tasks.json` profile | slice 2 |
| 4 | **Contract** (D3): `### Subagents` in the managed `AGENTS.md` section, only when allowed | `packages/workspace` (managed section) | slice 2 |
| 5 | Codex/OpenCode parity | — | listed as a known gap in `engines.md` |

Collisions to watch: `transport.ts` is also where the warm-prefix spike's outcome (`--fork-session`) would land; `packages/ui` and `packages/shell` are in flight on `worktree-ui-tweaks`.

## How we'll know it worked

- `usage.jsonl` on a `deep` demo task: subagent tokens visible (slice 1), then zero by default (slice 2), then on sonnet with a small handback when a harness opts in (slices 3–4).
- The tokens in Settings › Usage and `costEquivalentUsd` agree within a few percent on tasks with subagents.
