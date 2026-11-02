# Subagent policy, slice 4: handback contract (D3) TDD plan

Parent plan: `2026-11-02-subagent-policy.md` (D3, slice 4). Slice 2 (permission) is merged.

**Goal.** The managed section of `AGENTS.md` gets a `### Subagents` part with a handback contract of at most five lines, only when subagents are allowed for the task. Prompt-only: no report files in the person's folder.

**Where it lives.** The managed section is built by `managedSection` in `packages/workspace/src/instructions.ts` (the run plan names `packages/workspace`; that is right). `packages/runtime/src/workspace.ts` calls it on start and on every refresh.

## Design

- `managedSection`, `InstructionsText` and `agentsText` gain `subagents?: boolean`. Absent or false: the section is byte for byte today's (D0).
- The part sits after the Material part and before "Writing for the reader", via `subagentLines(allowed)` (exported like `writingLines`).
- Text (English, 4 lines under the heading and one intro):
  - `### Subagents`
  - intro: "You may hand work to subagents. Ask each one for the contract below, and keep their replies out of your context."
  - Answer in at most five lines: a status (`done`, `partial` or `blocked`), what changed, and one line per issue.
  - Put details in the files you edit, never in the reply.
  - Do not write report files for the handback; the reply is the whole report.
- Allowed, in the runtime: `harness.permissions.subagents` when set (an explicit `false` wins over a preset), otherwise whether the scope's preset ships `agentsFile`. The preset is per scope and resolved in the shell, so the runtime asks through a new optional `RuntimeOptions.instructionSubagents?: () => Promise<boolean>` (same shape as `instructionLinked`), asked at start and on every refresh. Absent: only the manifest decides. Shell wiring is out of this slice's scope.

## Tasks

1. **Test first (workspace).** In `packages/workspace/test/instructions.test.ts`:
   - without `subagents`, and with `subagents: false`, the section has no `### Subagents` and equals the plain section;
   - with `subagents: true`, it has the `### Subagents` part with the exact lines, at most five lines of contract after the heading, and it comes before the closing marker;
   - `writeInstructions` and `refreshInstructions` pass the option through (AGENTS.md has the part; refresh adds and removes it).
2. **Implement** `subagentLines` and the option in `instructions.ts`. Run the tests.
3. **Test first (runtime).** In `packages/runtime/test/workspace.test.ts`: manifest `permissions.subagents: true` gives the part; absent gives none; `instructionSubagents` returning true gives it; manifest `false` with `instructionSubagents` true gives none.
4. **Implement** the runtime wiring and the `RuntimeOptions` field.
5. **Docs.** `docs/architecture/context.md` (the managed section paragraph) and `docs/architecture/blocks.md` pointer if fitting; mark slice 4 in the parent plan.
6. **Gate.** `pnpm --filter @humanharness/workspace test`, `pnpm --filter @humanharness/runtime test`, `pnpm typecheck`.
