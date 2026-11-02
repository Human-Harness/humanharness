# Subagent policy, slice 1 — Measure (D4)

> Parent plan: `2026-11-02-subagent-policy.md` (fact 4, decision D4, Phase 2 slice 1). TDD: each task starts from its failing test.

**Goal:** Record the tokens subagents use as their own `usage.jsonl` lines (`phase: "subagent"`, model, tokens) and show "Subagents: about N tokens" in Settings › Usage. Nothing else changes.

**Hypothesis to check (fact 4):** `result.usage` counts the main thread only; `result.modelUsage` (per model) includes the subagents. So the subagent share of a model's row is `modelUsage[model] − result.usage` (main thread), and every other model's row is all subagent. The transport has no fixture of a real CLI result with a subagent; the check is the spike's measured numbers (`docs/spikes/2026-11-02-subagents.md` S3) plus unit fixtures shaped like them. Not provable per line from the stream (spike cross-check).

## Tasks

1. **Contract.** `packages/engines/src/contract.ts`: optional `subagents: SubagentUsage[]` on the `usage` event (a new event type would break the UI reducer's exhaustive switch). Starts from the test in task 2 not compiling (typecheck red).
2. **Transport parses `modelUsage`.** Failing test in `packages/engines/test/claude-cli.test.ts`: a `result` with `usage` (main) and `modelUsage` (opus bigger than usage, plus a sonnet row) emits one `usage` event whose counts are `result.usage` unchanged and whose `subagents` holds the opus difference and the whole sonnet row. Also: no `modelUsage` or equal to `usage` emits none; no `usage` emits none; differences below zero clamp to zero.
3. **Usage log record.** Failing test in `packages/shell/test/usage-log.test.ts`: `subagentRecord(...)` returns `{at, engine, task, scope, ..., phase: "subagent", model, ok: true, usage}`; `usageRecord` output for a task turn is byte-identical to before; `summarizeUsage` gives `subagents` (absent when none), and a subagent line after a task turn does not break that task's measured share or per-scope/task averages; `profilesUsage` keeps the active profile's `subagents`.
4. **Turn controller writes them.** Failing test in `packages/shell/test/turn-controller.test.ts`: the `usage` event's `subagents` reach `recordUsage` as a 4th argument (also on a held attempt) and never the chat entry. Wire `packages/shell/src/main/index.ts` to append the lines after the turn's own line.
5. **Protocol + UI.** `UsageSummary.subagents?: number` in `packages/protocol/src/views.ts`. Failing test in `packages/ui/test/usage-tab.test.tsx`: "Subagents: about 12,000 tokens" shows when `subagents > 0`, nothing otherwise. Copy `usage.subagents` in `packages/i18n/src/locales/en.json`.
6. **Docs.** Document the `subagent` phase in the architecture doc that describes usage.jsonl (`docs/architecture/engines.md`).

## Gate

`test` + `typecheck` of `packages/engines`, `packages/shell`, `packages/ui`.
