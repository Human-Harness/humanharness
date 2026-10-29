# Replaceable parts — design

Status: design approved by Marco section by section, 2026-10-29, in a brainstorming session. The written spec is pending his review. Not in the roadmap yet.

AI moves fast, so parts of Human Harness will age quickly: how it talks to engines, how it picks models, how it manages context. This spec opens four seams so those parts can be replaced by writing one new module and changing config, without touching the app around them. It changes structure only: after each part, the app behaves exactly as before.

Visual map of the result: https://claude.ai/artifact/DYDKXCKJy6gwxCwJfBPLtH

## 1. Why

What ages fast and what does not:

| Ages fast (must be replaceable) | Stable (not worth abstracting) |
|---|---|
| Engines and their transports (CLI → ACP → native APIs) | The decision UI (cards, choices, reviews) |
| The context strategy (notes, checkpoints, warm prefix, native memory) | Workspace data, history, file timeline |
| Model routing (tiers per process, later "driving modes") | The harness contract (`harness-sdk`, the manifest) |
| Material converters, translation | The task flow (start, choose, finish) |

The code today makes the fast-aging parts expensive to replace (checked on master, 2026-10-29):

- **Engine choice is copied in four places:** `engine.transport.kind === "claude-cli" ? new ClaudeCliTransport(…) : new AcpTransport(…)` in `runtime/src/runtime.ts:195`, `runtime/src/system.ts:69`, `runtime/src/system-session.ts:93` and `shell/src/main/engine-check.ts:44`, plus a branch in `shell/src/main/engine-command.ts:72`. An engine is also split across two packages: its definition in `engines/src/index.ts`, its transport in `runtime/src`.
- **`TransportOptions` grows with each engine:** fields marked "ACP only" and "Claude only" (`sessionMode`, `minAdapterVersion`, `profileMethod`, `engineEnv`), filled by `acpFields()`.
- **The UI/core contract lives in the UI:** `ui/src/client.ts` (1,263 lines) holds the client interfaces, the view models and helpers, and `shell/src/main` imports it in 34 places. The UI imports types from `runtime`, `engines` and `workspace` (`ui/src/client.ts:1,19`). The preload uses about 90 IPC channel names as loose strings.
- **Context decisions are buried in the task flow:** `shell/src/main/task-manager.ts` (2,310 lines) mixes the flow with time boxes, modes, phases, reviews, checkpoints (`CHECKPOINT_AT`, `needsCheckpoint`), the compaction heuristic, and the first message's parts and budgets (`APP_INDEX_TOKENS`, `INDEX_NOTES_MAX`).

## 2. Decisions (approved by Marco, 2026-10-29)

- **D1. Option B: open only the volatile seams.** Not "extract a seam when we replace something" (cheap now, each replacement pays the full cost later), and not "everything is a plugin with dependency injection" (weeks of work, heavy indirection, overlaps the plugins spec).
- **D2. Behaviour-preserving refactors, one part per plan.** Each plan moves code behind an interface and the existing tests stay green without edits, except import paths. No new features ride along: the proof that a refactor worked is that nothing changed.
- **D3. ContextPolicy owns decisions, not mechanisms.** It decides what a new session starts with and how much of each part, when to checkpoint, and how a session continues. Notes, `save_note` and the notes index stay harness services: notes are a pillar of the product and the UI shows them.
- **D4. Policies are chosen in config, with no UI yet.** Each policy has an id; `config.json` may name one, otherwise the default runs. The visible selector comes with the driving modes spec.
- **D5. One folder per engine** inside `engines`, holding its definition, its transport, its own options and its check. Not one package per engine: there are no third-party engines today.
- **D6. `protocol` holds types and a typed IPC channel table,** not only types, so a renamed or mistyped channel fails at compile time.
- **D7. Dependencies point down only.** No `if (kind === "claude-cli")` outside an engine's folder. Policies decide and never execute. Interfaces are defined by their inputs and outputs, not by today's mechanism.
- **D8. Order: 1 → 2 → 3 → 4.** Part 4 waits until `feat/tools-pre` is merged, since both touch `task-manager.ts`.

## 3. Result

```
harness-sdk ← protocol ← ui
                 ↑
               shell ──→ policies ──→ engines (registry + adapters + shared ACP client)
                 │                        ↑
                 └──→ runtime (turn loop) ┘
               services: workspace · material · blocks · i18n
```

| Package | Owns | Must not know |
|---|---|---|
| `harness-sdk` | The harness contract | Anything else |
| `protocol` (new) | Client interfaces, view models, events, IPC channel table, shared pure helpers | Electron, React, how the core works |
| `ui` | React views | The core's packages (only `protocol` and `harness-sdk`) |
| `shell` | Electron main: the task flow, time boxes, reviews, scopes, IPC handlers | Which engine runs; context and model rules |
| `policies` (new) | Model and context decisions | I/O, engines' internals |
| `engines` | Engine adapters, the registry, the transport contract | The UI, the task flow |
| `runtime` | The turn loop, system sessions, documents, classify | Which engine runs |

## 4. Part 1 — Engine adapters

### 4.1 Layout

```
packages/engines/src/
  contract.ts      Transport, Event, CommonOptions, EngineAdapter
  registry.ts      adapters by id · createTransport(id, options) · mock mode
  acp/             the shared ACP client (today runtime/src/acp.ts)
  claude/          definition + ClaudeCliTransport + claudeArgs/profileArgs + check
  codex/           definition + its ACP options (CODEX_CONFIG, minimum adapter version)
  opencode/        definition + OPENCODE_ENV / OPENCODE_PERMISSION + config-option
  models.ts        unchanged (tiers per engine)
```

### 4.2 The adapter

`EngineAdapter` is today's `EngineDef` (legal facts, setup, detection, models: unchanged) plus:

- `createTransport(options: CommonOptions): Transport`.
- `capabilities: { forkSession: boolean; nativeMemory: boolean }`. Both `false` for every engine now. They are declared so later policies can ask for them (§7.2).
- Whatever engine-specific branch the shell has today (`engine-command.ts:72`) becomes a method or field of the adapter.

### 4.3 `CommonOptions`

Only what holds for every engine: folder, session, MCP servers, permissions, references, `mcpOnly`, `persistSession`, command, env, `onSessionStarted`, `onModels`. Each adapter derives its own fields from its own definition (the ACP session mode from the edit permission, the minimum version, the profile method, the fixed env). `acpFields()` goes away.

### 4.4 The contract moves down

Today the transport emits `Event`, which lives in `runtime`, and `runtime` imports `engines`. Adapters in `engines` would import `runtime`: a cycle. So `Transport` and `Event` move to `engines/src/contract.ts`. `runtime` re-exports them for compatibility during the move; `protocol` re-exports `Event` for the UI (§5).

### 4.5 Runtime

`runtime` keeps the turn loop, system sessions, documents and classify, and gets a transport from `registry.createTransport`. The four copied conditionals go away.

### 4.6 Mock mode

Mock mode fakes real engine ids today (`isMockEngine`, `mockEngineText`, `mockModels` in `shell/src/main/index.ts`). The registry keeps that behaviour: in mock mode, `createTransport` returns `fake-agent`'s transport with the faked engine's definition. Nothing outside the registry changes.

### 4.7 Done when

- A test registers a fake engine by adding one folder's worth of code and one registry line, and runs a turn through `runtime`.
- `grep` finds `transport.kind` only inside `engines/src`.
- The suite and the e2e tests pass with no test edits beyond import paths.

## 5. Part 2 — `protocol`

### 5.1 The cut

`ui/src/client.ts` mixes three things. The rule: what both sides use goes to `protocol`; what only the UI uses stays in `ui`.

- To `protocol`: `HarnessClient`, `ContextClient`, `LanguageClient`, `MaterialClient`, the view models (`AppConfig`, `TaskView`, `ModeView`, `PhaseView`, `ContextItem`…), and pure helpers the shell uses (`isConfigured`, `cleanReaderPrefs`, `engineProblem`, `TEXT_SIZES`…). The exact list is whatever `shell/src/main` and `shell/src/preload` import from `@humanharness/ui/client` today.
- Stays in `ui`: helpers only views use (`timeAgo`, `addText`, `partsOf`, `laterTasks`…).

### 5.2 Layout

```
packages/protocol/src/
  client.ts     client interfaces
  views.ts      view models
  events.ts     re-exports Event from engines, plus the UI's own events
  channels.ts   the typed IPC channel table
  shared.ts     pure helpers both sides use
```

### 5.3 The channel table

Two type maps: `Invoke` (channel → arguments → result, the `ipcRenderer.invoke("hh:…")` calls) and `Push` (channel → payload, the `ipcRenderer.on` events). Two thin wrappers use them: `invoke(channel, …args)` in the preload and `handle(channel, fn)` in main. Channel names do not change.

A test checks that every channel in the table has a handler in main and is exposed by the preload, and that no channel is used outside the table.

### 5.4 Dependencies

`protocol` depends on `harness-sdk` and on `engines` types only (`import type`). `ui` and `shell` depend on `protocol`. `shell` no longer depends on `ui`.

### 5.5 Done when

- `shell/` has no import of `@humanharness/ui`.
- `ui/src` imports nothing from `runtime`, `engines` or `workspace`; the types it needs from them (`ModelSpec`, `Effort`, `Event`…) come re-exported by `protocol`.
- The import-boundary test (§8) enforces both.

## 6. Part 3 — ModelPolicy

```ts
interface ModelPolicy {
  id: string;
  pick(input: { engine: string; action?: string; manifestTier?: Tier; models: ModelsConfig; floor?: Tier;
                offer?: { models: ModelChoice[]; efforts: Effort[] } }): ModelProfile;
  fallback(profile: ModelProfile, models: ModelsConfig, tried: readonly string[]): ModelProfile | null;
}
```

- `DefaultModelPolicy` gathers `resolveProfile`, `firstOffered`, `fitEffort` and `nextFallback` from `shell/src/main/models.ts`, with the same rules (the tier floor, deep → standard → light → the engine's default).
- Config cleaning and display helpers (`cleanModels`, `cleanSpec`, `cleanProfile`, `nearestTier`, `engineOffer`, `pinnedBudget`) stay in the shell: they are not decisions.
- Done when the shell calls only the policy to pick and fall back, and the model tests pass unchanged against `DefaultModelPolicy`.

## 7. Part 4 — ContextPolicy

### 7.1 The interface

Three decision points. Each union starts with today's values only; a new variant adds its value.

```ts
interface ContextPolicy {
  id: string;
  /** What a new session's first message carries after the brief, in order, and each part's token budget. */
  start(task: TaskStart): StartPlan;
  /** Before a follow-up turn (a phase change and a wrap-up included). */
  beforeFollowUp(state: TurnState): "go" | "checkpoint";
  /** How the work goes on after a task ends, a folder move, or a resume. */
  continuity(event: "task-end" | "move" | "resume"): "new-session-from-notes";
}
```

- **`start`** returns the parts (notes index, app-wide notes, data tables, material, pins) in today's order with today's budgets. The constants in `task-manager.ts` (`APP_INDEX_TOKENS`, `INDEX_NOTES_MAX`, the ~1,500-token index limit) and the material `budget.indexTokens` become `DefaultContextPolicy`'s parameters. Building each part stays with `workspace` and `material` (D3). The task manager runs the plan.
- **`beforeFollowUp`** replaces `needsCheckpoint` (80% of the cap, `CHECKPOINT_AT`, once per compaction).
- **`continuity`** always answers `"new-session-from-notes"` today.

### 7.2 Compaction moves to the adapters

Detecting a compaction is the engine's job; deciding what to do is the policy's. Codex already reports compactions. Claude's heuristic ("the context fell by more than half", `task-manager.ts`) moves into the Claude adapter, which then emits the same `compaction` event. `usage.jsonl` keeps its `kind: "compaction"` lines.

### 7.3 Done when

- `task-manager.ts` holds no context thresholds or budgets.
- A test registers a policy that checkpoints at 50% and, with no shell edits, the checkpoint runs at 50%.
- The suite passes unchanged.

## 8. Shared rules

- **Choosing a policy:** `config.json` → `policies: { model?: string; context?: string }`. An unknown id runs the default and is logged once. No UI (D4).
- **Fixed per task:** the policy ids are stored with the task in `tasks.json` when it starts and do not change until it ends, like the model profile, so the engine's prompt cache stays valid. A task saved before this spec runs the defaults.
- **Measuring:** each `usage.jsonl` line adds `modelPolicy` and `contextPolicy`, so variants can be compared on real turns.
- **Import-boundary test:** one test reads every package's imports and fails on: `ui` importing a core package; anything outside `engines/src` reading `transport.kind`; an import against §3's diagram (allowed: `protocol` → `harness-sdk`, `engines` types; `ui` → `protocol`, `harness-sdk`; `shell` → everything but `ui`; `policies` → `engines`, `harness-sdk`; `runtime` → `engines` and the services; `engines` → `harness-sdk`); `policies` importing `node:fs`, `child_process` or an engine transport.
- **Docs:** `docs/architecture/engines.md`, `context.md` and `turn.md` get the new homes of the code; a new `docs/architecture/replaceable-parts.md` holds §3's map and the rules above.

## 9. Delivery

Four plans, one PR each, stopping between plans:

| Plan | Part | Size (estimate) | Depends on |
|---|---|---|---|
| 1 | Engine adapters (§4) | 1–2 days | — |
| 2 | `protocol` (§5) | 3–5 days | plan 1 (`Event` in `engines`) |
| 3 | ModelPolicy (§6), `policies` package, config, `usage.jsonl` fields, boundary test | 2–3 days | plan 1 |
| 4 | ContextPolicy (§7) | 1–2 weeks | plan 3; `feat/tools-pre` merged |

## 10. Relation to other specs

- **OpenCode engine** (`2026-10-26-opencode-engine-design.md`): its `profileMethod`, env and permission config move into `engines/src/opencode/`; behaviour unchanged.
- **Tools and recipes** (`2026-10-28-tools-and-recipes-design.md`): D8's `agent` default is the natural home of a later `ToolPolicy` (§11). Nothing changes in that spec now.
- **Plugins** (`2026-10-27-plugins-design.md`): plugins are harness-level extensions run in a sandbox; the seams here are core-level and compiled in. They do not overlap.
- **Context panel** (`2026-10-27-context-panel-design.md`): reads the start items the task manager builds from the policy's plan; its view does not change.

## 11. Out of scope (later specs)

- **Variants:** warm prefix (`"fork-from-base"`, needs `forkSession`), native engine memory, and the "infinite context" paper. Each is a new policy behind §7's interface.
- **Driving modes** (eco / hybrid / sport): a user setting that picks a combination of policies, with the selector UI.
- **`ToolPolicy`:** which tools and recipes the agent may call.
- **New engines** (Kimi, a direct API): each is a new folder under `engines/src` once part 1 is done.
- **Separating material converters and translation engines:** they age fast too, but `material` is already isolated; revisit when one needs replacing.

## 12. Open questions

- Whether `runtime` keeps re-exporting `Transport` and `Event` after plan 2, or every import moves to `engines` and `protocol`. Decide in plan 2 by counting the imports.
