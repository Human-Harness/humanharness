# Replaceable parts

The parts of Human Harness that age fast sit behind seams, so each can be replaced by writing one module and changing config (spec `docs/superpowers/specs/2026-10-29-replaceable-parts-design.md`).

| Part | Seam | Status |
|---|---|---|
| Engines and transports | `EngineAdapter` + registry (`packages/engines/src/registry.ts`) | Done (plan 1) |
| UI/core contract | `@humanharness/protocol` (`packages/protocol`) | Done (plan 2) |
| Model routing | `ModelPolicy` (`packages/policies/src/model.ts`) | Done (plan 3) |
| Context strategy | `ContextPolicy` (`packages/policies/src/context.ts`) | Done (plan 4) |

Rules: dependencies point down only; no `if (kind === "claude-cli")` outside an engine's folder (`packages/engines/test/boundary.test.ts`); policies decide and never execute; interfaces are defined by their inputs and outputs. How to add an engine: `docs/architecture/engines.md`, "Adding an engine".

## Part 2 — protocol (done)

Spec §5, §8, §12. The contract between the UI and the core is the package `@humanharness/protocol` (`packages/protocol`). It is renderer- and preload-safe: no `node:*`, no `electron`, no `react`.

- **Where things live** (`packages/protocol/src/`): `client.ts` the `*Client` interfaces; `views.ts` the view models and every other contract type; `shared.ts` the pure helpers and constants both sides use; `events.ts` the engine events; `data-change.ts` `hearsDataChange`, its own subpath for the preload (`@humanharness/protocol/data-change`); `channels.ts` the IPC channel table (`@humanharness/protocol/channels`). `index.ts` re-exports everything but `channels.ts` (`data-change` also has its own subpath for the preload).
- **What goes there:** what both sides use, and what `shell/src/main` or `shell/src/preload` imports. Helpers only views use stay in `packages/ui/src/client.ts` (`partsOf`, `engineProblem`). That file re-exports the protocol, so views keep importing `./client`.
- **The channel table** (`channels.ts`): `Invoke` maps a channel to its wire function (arguments to result); `Push` maps a channel to its payload. `hh:scopes` is in both: the preload invokes it and main also pushes it.
- **Adding a channel:** one entry in `Invoke` or `Push`; for an invoke, the handler in main through `handle` / `handleFrom` / `handleAll`, and the preload through `invoke`; for a push, main sends through `sendToWindow` / `sendToContents` and the preload listens through `subscribe`. `packages/protocol/test/channels.test.ts` fails until the channel's name appears in the table, in main and in the preload (it does not check that main actually registers or sends it), and fails on any `"hh:…"` literal in main or the preload that is not in the table.
- **Boundary test** (`packages/protocol/test/boundary.test.ts`): `shell/src/main` and `shell/src/preload` do not import `@humanharness/ui`; `ui/src` does not import `runtime`, `engines` or `workspace`; `protocol` imports only types from `engines`, `workspace` and `i18n`, plus the value `@humanharness/workspace/subjects`.

Deviations from the spec:

1. `protocol` imports types from `workspace` and `i18n` and re-exports `@humanharness/workspace/subjects` (§5.4 said `harness-sdk` and `engines` only); moving those types up would make `workspace` import `protocol`.
2. The renderer in `shell/src/renderer` still imports `@humanharness/ui` (it hosts the UI); the rule covers main, preload and the shell's tests.
3. `ui` may import `@humanharness/i18n` (`HarnessApp` builds its i18next instance with it).
4. The shared helpers are whatever main and preload import, which includes `timeAgo`, `addText` and `laterTasks`.
5. Main checks channel names, not argument and result types: its handlers take `unknown` on purpose because renderer input is untrusted. The `Invoke` result types are the preload's declaration and are not checked against what main returns; a follow-up could check each handler's return against `InvokeResult`.
6. The plugin and tool realms' channels (`hh-plugin:rpc`, `hh-tools:rpc`) stay out of the table; they have their own preloads and validation.
7. §12 is decided: `runtime` keeps re-exporting `Transport`, `Event` and the rest of the contract. 55 files import them through `runtime`; moving them is churn with no behaviour change. Revisit if a later plan touches those files anyway.
8. The `ui` tests stay in `ui/test`; they import `../src/client`, which re-exports the protocol.

## Part 3 — ModelPolicy (done)

Spec §6, §8. Which model, effort and context cap a call runs on is decided by a `ModelPolicy` in the package `@humanharness/policies` (`packages/policies`). It depends on `engines` and `harness-sdk` only and imports no `node:*`, `fs` or `child_process` itself.

- **Where things live** (`packages/policies/src/`): `model.ts` has `ModelPolicy` (`pick`, `fallback`), `PickInput`, `DefaultModelPolicy` (id `"default"`) and the decision functions that used to live in `shell/src/main/models.ts` (`resolveProfile`, `nextFallback`, `firstOffered`, `offered`, `fitEffort`, `tierSpec`, `taskKey`, `QUESTIONS`). `registry.ts` has `DEFAULT_POLICY`, `modelPolicy(id)`, `isModelPolicyId` and `isContextPolicyId`. `index.ts` re-exports them.
- **What stayed in the shell** (`packages/shell/src/main/models.ts`): it re-exports the moved functions and keeps the cleaning and display helpers (`cleanModels`, `cleanProfile`, `pinnedBudget`, `nearestTier`, `engineOffer`), `manifestTier` (it reads the harness manifest, which is an input to the decision) and `offeredEffort`.
- **Choosing a policy:** `config.json` → `policies: { model?, context? }`, cleaned by `cleanPolicies` in `packages/shell/src/main/config.ts`. An unknown id runs the default and is logged once per id. Only `"default"` ships for both kinds; others are registered (Part 4).
- **Per task:** a task reads its ids once when it starts and keeps only the non-default ones on `CurrentTask.policies`, saved in `tasks.json` (`cleanTaskPolicies` checks the shape only). Every pick and fallback for the task passes them, so a resumed task reuses them and a change in `config.json` never reaches a task in flight. Material, translation, the Sidekick and jobs are not tasks: they pick with `config.json`'s ids at call time, through `modelPolicy(id).pick` with the engine's saved offer.
- **usage.jsonl:** `modelPolicy` and `contextPolicy` are written only when not `"default"` (a line without the field ran the default), on task turn lines (through the turn controller's meta) and on compaction lines.
- **CLI:** `humanharness run` uses `DefaultModelPolicy` directly; it reads neither `models` nor `policies` from `config.json`.
- **Boundary test** (`packages/protocol/test/boundary.test.ts`) now enforces the arrows of §8 for `harness-sdk`, `engines`, `policies`, `runtime`, `protocol`, `ui` and `shell` (any subpath, type-only imports included; only `shell/src/renderer` may import `ui`), and a second test fails when a named exception no longer matches a real import. Also: `policies/src` imports no `node:*`, `fs` or `child_process`, and imports `engines` only through its root (`./registry` re-exports the transports, so it counts as transport code); no file outside `engines/src` reads `transport.kind` or compares a `.kind` with `"claude-cli"` or `"acp"`. Named exceptions: `engines` imports the type `McpServerSpec` from `blocks` (`engines/src/contract.ts`, `engines/src/claude/transport.ts`).

Deviations from the spec:

1. `PickInput` has an optional `tier`: a fixed tier that skips the person's task choice and the manifest. The Sidekick's own tier and its routing turn's light one need it; without it they would bypass the policy. It also has an optional `offer` (the engine's saved models and efforts) for `firstOffered` and `fitEffort`.
2. Default ids are not written: a task's `policies` and the usage fields exist only for a non-default id, because "absent" already means "default" (§8) and writing them would change every saved task and usage line.
3. `policies.context` was read, cleaned and kept per task before anything used it; plan 4 (Part 4) implements it.
4. The CLI's `run` does not read `policies`.
5. `manifestTier` stays in the shell.
6. The boundary test's purity rule for `policies` is about direct imports: the `engines` and `harness-sdk` roots use `node:path` themselves.

## Part 4 — ContextPolicy (done)

Spec §7, §8. What a new session starts with, when the context is saved, and how work goes on after a session ends is decided by a `ContextPolicy` in `@humanharness/policies`, next to `ModelPolicy`.

- **The interface** (`packages/policies/src/context.ts`): `start(task)` returns a `StartPlan`, the parts of a new session's first message after the brief, in order, each with an optional token budget (`StartPart`: `instructions`, `notes`, `app-notes`, `data`, `prepared`, `pins`, `material`, `linked`); `beforeFollowUp(state)` answers `"go"` or `"checkpoint"` from `{ used?, cap?, checkpointed }`; `continuity(event)` answers how the work goes on after `"task-end"`, `"move"` or `"resume"`. It decides only: no I/O.
- **`DefaultContextPolicy`** (id `"default"`) is today's rules. `CHECKPOINT_AT` is 0.8 of the cap, once per compaction. `APP_INDEX_TOKENS` is 500 for the app-wide notes. The material budget is the manifest's `budget.indexTokens`, passed in as `materialIndexTokens`. The parts keep their old order. Continuity has one value, `"new-session-from-notes"`.
- **Registry** (`registry.ts`): `contextPolicy(id)` (an unknown id gives the default), `registerModelPolicy` and `registerContextPolicy`. Each returns an unregister function; a duplicate id throws. A registered policy is selectable from `config.json` like a built-in one. Only tests register today.
- **What the task's policy decides** (fixed per task through `CurrentTask.policies`, Part 3): the checkpoint at all six follow-up points (`needsCheckpoint` in `task-manager.ts` asks `beforeFollowUp`); the first message's parts, order and budgets for a new task and for a resume (`contextFor`, `startItems`); and continuity at task end, folder move and resume (`continuity`, switch over its single value). Pre-steps still run when a plan omits `prepared` (they are harness work, D3); only their result stays out of the message.
- **Compaction detection moved to the engines** (`packages/engines/src/context-drop.ts`): `ContextDrop` (`COMPACTED_DROP` 0.5, a reading below half of the previous one) is used by the Claude and ACP adapters. The Claude transport emits `{ type: "compaction" }` right before the context event; the ACP adapter dedups per turn, so a turn never gets two. It resets on every new session and is seeded with `CommonOptions.lastContextUsed` / `SlotOptions.lastContextUsed`; board mode passes a lane's stored `context.used` when it resumes the session. OpenCode keeps detection through the ACP adapter. The shell's `track()` only reacts to a compaction event.
- **usage.jsonl** records the id of the policy that actually ran (`modelPolicy(id).id`, `contextPolicy(id).id`), only when not `"default"`. An id nobody registered ran the default and logs nothing.
- **Boundary test:** `task-manager.ts` (comments stripped) defines no `CHECKPOINT_AT`, `APP_INDEX_TOKENS` or `COMPACTED_DROP` (re-exports are allowed) and compares no numeric literal with a cap.

Deviations from the spec:

1. The registry has `register*` functions, not only a fixed map; §7.3's "a test registers a policy" needs one.
2. `StartPlan` also orders the scope's instructions, the pre-step results and the linked folders, since all three are parts of today's first message.
3. `APP_INDEX_TOKENS` left `notes-index.ts`: `notesIndexParts` takes the budget as an argument. A job run's first message passes `DefaultContextPolicy`'s value, since jobs have no task policy.
4. `INDEX_NOTES_MAX`, `READS_MAX` and `START_ITEMS_MAX` stay in `context-record.ts`: they cap what the context panel records, not what the engine gets.
5. Compaction detection is seeded across transport restarts, as the shell's check always was (it compared with the `used` in `tasks.json`). Single mode never resumes a stored session and needs no seed.
6. Plan 3's known limit is fixed: usage records the policy that ran, so an unregistered stored id logs nothing. Plan 3's usage test registers `"eco"` and `"lean"` in `beforeEach`; its assertions are unchanged.
7. Approved D2 exception: the `task-manager.test.ts` test "a reported compaction allows the next checkpoint and is logged" now feeds a compaction event instead of a falling context; its assertions are unchanged. A new test checks that a drop with no event records none.
