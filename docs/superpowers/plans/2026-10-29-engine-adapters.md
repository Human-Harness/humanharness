# Engine Adapters Implementation Plan (replaceable parts, plan 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every engine-specific decision lives in `packages/engines`: a registry of adapters builds each engine's transport and names its CLI, so the four copied `transport.kind === "claude-cli" ? … : …` conditionals (and the branch in `engine-command.ts`) disappear, and a new engine is one folder plus one registry line.

**Architecture:**
- **The transport contract moves down** (`packages/engines/src/contract.ts`): `Event` and its parts, `Session`, `CommonOptions`, `Transport`, `EngineAdapter`. `classifyError` moves with it (`engines/src/classify.ts`). `runtime` re-exports the same names, so no importer of `@humanharness/runtime` changes.
- **The transports move into the engines package:** the shared ACP client to `engines/src/acp/client.ts` (with `TransportOptions` = `CommonOptions` + the four ACP-only fields, and `acpFields`, in `acp/options.ts`), the Claude CLI transport to `engines/src/claude/transport.ts`. Their tests move with them.
- **One folder per engine for its definition** (`claude/`, `codex/`, `opencode/`, plus `listed.ts` for the engines listed only for their legal status). `engines/src/index.ts` assembles `ENGINES` from them; the shared types go to `types.ts`.
- **The registry** (`engines/src/registry.ts`, package subpath `@humanharness/engines/registry`, Node only) maps engine id → `EngineAdapter`. An adapter names the engine's CLI (`command(engine)`), builds its transport (`createTransport(engine, options)`, deriving its own fields from the definition it is given) and declares `capabilities` (`forkSession`, `nativeMemory`: both `false`).
- **Callers ask the registry:** `runtime.ts`, `system.ts`, `system-session.ts`, `shell/src/main/engine-check.ts` call `createTransport`; `runtime.ts` and `shell/src/main/engine-command.ts` call `commandLine`. Nobody outside `engines/src` reads `transport.kind`, and a test enforces it.

**Tech Stack:** TypeScript (tsc 7, `moduleResolution: bundler`), pnpm via corepack, Vitest, Electron 44 + electron-vite 5 (build check), Playwright e2e with the fake agents.

Spec: `docs/superpowers/specs/2026-10-29-replaceable-parts-design.md`, §4 (part 1), D2, D5, D7. "§" and "D" numbers below refer to it.

---

## Deviations from the spec (decided while planning; tell Marco)

1. **The adapter is not the definition plus methods (§4.2); it is a separate object keyed by engine id, and it receives the definition as an argument.** `runtime/test/runtime.test.ts` ("enforces the engine's minAdapterVersion on ACP engines") passes a *copy* of Codex's definition with a fake command and `minAdapterVersion: "9.0.0"`. An adapter that closed over its own definition would ignore the copy and the test would fail, breaking D2 (no test edits). `EngineDef` stays plain data, exactly as `engines.test.ts` asserts it.
2. **Mock mode needs no registry change (§4.6).** Mock mode does not replace the transport today: `HH_TEST_ENGINES` replaces the engine's *command* with a fake CLI that speaks the same protocol (`fake-claude.ts` for Claude, `fake-acp.ts` for ACP), and `isMockEngine` / `mockEngineText` / `mockModels` only change what Settings shows. That is already engine-agnostic, so it stays as it is.
3. **Codex and OpenCode have no adapter file of their own.** Everything that differs between them (modes, adapter gate, profile method, env) is data in their definitions, so both use the shared ACP adapter. `CODEX_CONFIG` (`codexConfig`) stays in the shared ACP client, which also holds the `config-option` path. Splitting the two profile methods into per-engine code is a real change to the ACP client, not a move, so it waits until a third profile method shows up. `acpFields` survives as an internal of `engines/src/acp/options.ts`: only the ACP adapter calls it (§4.3's "goes away" holds for every caller outside the engines package).

---

## Conventions

- Same as the earlier plans: English everywhere; packages export TS source; extensionless imports; tests in `packages/<name>/test/`; one commit per task; run commands from the repo root (`/Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-engine-adapters` or wherever the worktree is).
- **Behaviour-preserving (D2).** Moved tests change only their import lines (and, where noted, the file they live in). If a test needs any other edit to pass, stop: the move changed behaviour.
- Moves use `git mv` so history follows the file.
- `@humanharness/engines` (".") stays free of Node-only code: the renderer imports its types, and `cli`/`workspace` import its data. Anything that spawns a process (`acp/`, `claude/transport.ts`, `registry.ts`) is reachable only through `@humanharness/engines/registry`.
- Verification commands: `corepack pnpm typecheck` (whole repo) and `corepack pnpm test` (whole suite). A single file: `corepack pnpm vitest run packages/engines/test/registry.test.ts`.

## Files

| File | Change |
|---|---|
| `packages/engines/package.json` | `./registry` export; deps `@agentclientprotocol/sdk`, `@humanharness/blocks`; devDep `@humanharness/fake-agent` |
| `packages/engines/src/contract.ts` | **new**: events (from `runtime/src/events.ts`), `Session`, `CommonOptions`, `Transport`, `Capabilities`, `EngineAdapter` |
| `packages/engines/src/classify.ts` | moved from `runtime/src/classify.ts` |
| `packages/engines/src/types.ts` | **new**: `LegalStatus`, `TransportDef`, `EngineSetup`, `EngineDef`, `Mode` (out of `index.ts`) |
| `packages/engines/src/claude/definition.ts`, `codex/definition.ts`, `opencode/definition.ts`, `listed.ts` | **new**: the `ENGINES` entries, cut from `index.ts` |
| `packages/engines/src/index.ts` | assembles `ENGINES`; exports types, contract, `classifyError` |
| `packages/engines/src/acp/client.ts` | moved from `runtime/src/acp.ts` |
| `packages/engines/src/acp/options.ts` | **new**: `TransportOptions`, `acpFields` (from `runtime/src/transport.ts`) |
| `packages/engines/src/acp/adapter.ts` | **new**: the shared ACP adapter |
| `packages/engines/src/claude/transport.ts` | moved from `runtime/src/claude-cli.ts` |
| `packages/engines/src/claude/adapter.ts` | **new** |
| `packages/engines/src/registry.ts` | **new**: `ADAPTERS`, `createRegistry`, `createTransport`, `commandLine`, transport re-exports |
| `packages/engines/test/{acp,claude-cli,classify}.test.ts` | moved from `runtime/test/` |
| `packages/engines/test/acp-options.test.ts` | **new home** of `runtime.test.ts`'s `describe("acpFields")` |
| `packages/engines/test/registry.test.ts` | **new** |
| `packages/engines/test/boundary.test.ts` | **new**: no `transport.kind` outside `engines/src` |
| `packages/runtime/src/{events,transport,index}.ts` | re-exports only |
| `packages/runtime/src/{runtime,system,system-session}.ts` | use the registry |
| `packages/runtime/test/fake-engine.test.ts` | **new**: §4.7's "register a fake engine" test |
| `packages/runtime/package.json` | drop `@agentclientprotocol/sdk` |
| `packages/shell/src/main/engine-check.ts`, `engine-command.ts` | use the registry |
| `docs/architecture/engines.md`, `turn.md`, `replaceable-parts.md` (new) | new homes of the code |

---

### Task 1: Move the transport contract and `classifyError` to `engines`

**Files:**
- Create: `packages/engines/src/contract.ts`
- Move: `packages/runtime/src/classify.ts` → `packages/engines/src/classify.ts`; `packages/runtime/test/classify.test.ts` → `packages/engines/test/classify.test.ts`
- Modify: `packages/engines/src/index.ts`, `packages/engines/package.json`, `packages/runtime/src/events.ts`, `packages/runtime/src/transport.ts`, `packages/runtime/src/index.ts`, `packages/runtime/src/acp.ts`, `packages/runtime/src/claude-cli.ts`

- [ ] **Step 1: Baseline.** Run `corepack pnpm typecheck && corepack pnpm test`. Expected: both green. Write down the test count Vitest prints (`Tests  N passed`); every later task must end with the same N plus the tests it adds.

- [ ] **Step 2: Add the blocks dependency** (the contract names `McpServerSpec`; `blocks` depends only on `harness-sdk`, so there is no cycle). In `packages/engines/package.json`:

```json
{
  "name": "@humanharness/engines",
  "version": "0.1.0",
  "type": "module",
  "license": "Apache-2.0",
  "exports": { ".": "./src/index.ts", "./assets/*": "./assets/*" },
  "dependencies": {
    "@humanharness/blocks": "workspace:*",
    "@humanharness/harness-sdk": "workspace:*"
  }
}
```

Run `corepack pnpm install`. Expected: lockfile updated, no errors.

- [ ] **Step 3: Create `packages/engines/src/contract.ts`.** Copy the whole body of `packages/runtime/src/events.ts` (from `export type ActivityKind` to the end of `fail`) verbatim to the top of the new file, then append:

```ts
export interface Session {
  id: string;
  /** False until the engine has created the session; then turns resume it. */
  started: boolean;
}

/** What every engine's transport takes (spec §4.3). Engine-only fields are derived by the engine's adapter. */
export interface CommonOptions {
  folder: string;
  session: Session;
  mcp: McpServerSpec[];
  permissions: Permissions;
  /** Folders the agent may read but never change (absolute paths). */
  references?: string[];
  /**
   * Only the MCP servers, no file reading at all (language spec §5): Claude gets no Read, Glob, Grep or TodoWrite,
   * and ACP read and search requests are refused. Off for tasks and material (D0).
   */
  mcpOnly?: boolean;
  /** Claude only: false runs the CLI with `--no-session-persistence` (one-off turns such as the setup test). */
  persistSession?: boolean;
  /** The CLI to run: [binary, ...leading args]. */
  command: string[];
  /** Extra environment for the CLI (tests and dev only; never credentials). */
  env?: Record<string, string>;
  onSessionStarted: (session: Session) => void;
  /** ACP only: the models and efforts the agent offered at session/new (saved for Settings › Modelos). */
  onModels?: (offer: { models: ModelChoice[]; efforts: Effort[] }) => void;
}

export interface Transport {
  /**
   * Runs one turn. Emits events and always finishes with exactly one `done` event before resolving.
   * `profile` is the task's model, effort and context cap (resources spec §5.2); absent: the engine's defaults.
   */
  turn(message: string, emit: (event: Event) => void, signal: AbortSignal, profile?: ModelProfile): Promise<void>;
  /** Ends the current engine session; the next turn starts a new one. Never called during a turn. */
  endSession(): Promise<void>;
  close(): Promise<void>;
}
```

and at the very top of the file:

```ts
import type { McpServerSpec } from "@humanharness/blocks";
import type { Permissions } from "@humanharness/harness-sdk";
import type { Effort, ModelChoice, ModelProfile } from "./models";
```

(`persistSession` and `onModels` stay in the common options as §4.3 lists them; a transport that has no use for one ignores it, as today.)

- [ ] **Step 4: Move `classifyError`.**

```bash
git mv packages/runtime/src/classify.ts packages/engines/src/classify.ts
git mv packages/runtime/test/classify.test.ts packages/engines/test/classify.test.ts
```

In `packages/engines/src/classify.ts` change line 1 to `import type { ErrorCode } from "./contract";`. The test's import `../src/classify` already points at the right file.

- [ ] **Step 5: Export from the engines index.** In `packages/engines/src/index.ts`, after `export * from "./models";` add:

```ts
export * from "./contract";
export { classifyError } from "./classify";
```

- [ ] **Step 6: Turn `runtime/src/events.ts` into a re-export.** Replace the whole file with:

```ts
export { type ActivityKind, type DocumentCard, type EngineError, type ErrorCode, type Event, type LimitWindow, fail } from "@humanharness/engines";
```

- [ ] **Step 7: Rebase `runtime/src/transport.ts` on the contract.** Replace the whole file with:

```ts
import type { EngineDef } from "@humanharness/engines";
import type { CommonOptions } from "@humanharness/engines";
import type { Permissions } from "@humanharness/harness-sdk";

export type { Session, Transport } from "@humanharness/engines";

/** The ACP transport's options: the common ones plus the fields only ACP engines have. */
export interface TransportOptions extends CommonOptions {
  /** ACP only: session mode to set after session/new|load (e.g. "workspace-write"). */
  sessionMode?: string;
  /** ACP only: fail with `outdated-version` if the adapter reports an older agentInfo.version. */
  minAdapterVersion?: string;
  /**
   * ACP only: how a turn's model profile reaches the agent. `codex-config` (default): `CODEX_CONFIG` at spawn, a
   * new process when it changes. `config-option`: `session/set_config_option` on the open session (OpenCode).
   */
  profileMethod?: "codex-config" | "config-option";
  /** ACP only: the engine's fixed environment (registry `transport.env`, OpenCode only), set over the inherited one and `env`. */
  engineEnv?: Record<string, string>;
}
```

followed by the existing `acpFields` function, unchanged (doc comment included). Merge the two `@humanharness/engines` type imports into one line: `import type { CommonOptions, EngineDef } from "@humanharness/engines";`.

- [ ] **Step 8: Fix the runtime's own imports of `./classify`.** In `packages/runtime/src/acp.ts` and `packages/runtime/src/claude-cli.ts` replace `import { classifyError } from "./classify";` with nothing and add `classifyError` to the existing `@humanharness/engines` import of each file, e.g. in `acp.ts`:

```ts
import { type Effort, type ModelChoice, type ModelProfile, classifyError, isCap, isEffort, isModelId } from "@humanharness/engines";
```

In `packages/runtime/src/index.ts` replace `export { classifyError } from "./classify";` with `export { classifyError } from "@humanharness/engines";`.

- [ ] **Step 9: Verify.** `corepack pnpm typecheck && corepack pnpm test`. Expected: green, same N.

- [ ] **Step 10: Commit.**

```bash
git add -A packages/engines packages/runtime pnpm-lock.yaml
git commit -m "refactor(engines): move the transport contract and classifyError down from runtime"
```

---

### Task 2: Move the shared ACP client into `engines/src/acp/`

**Files:**
- Move: `packages/runtime/src/acp.ts` → `packages/engines/src/acp/client.ts`; `packages/runtime/test/acp.test.ts` → `packages/engines/test/acp.test.ts`
- Create: `packages/engines/src/acp/options.ts`, `packages/engines/src/registry.ts` (first version)
- Create: `packages/engines/test/acp-options.test.ts` (moved `describe` block)
- Modify: `packages/engines/package.json`, `packages/runtime/src/transport.ts`, `packages/runtime/src/{runtime,system,system-session,index}.ts`, `packages/runtime/test/runtime.test.ts`, `packages/runtime/package.json`

- [ ] **Step 1: Dependencies and the `./registry` subpath.** `packages/engines/package.json`:

```json
{
  "name": "@humanharness/engines",
  "version": "0.1.0",
  "type": "module",
  "license": "Apache-2.0",
  "exports": { ".": "./src/index.ts", "./registry": "./src/registry.ts", "./assets/*": "./assets/*" },
  "dependencies": {
    "@agentclientprotocol/sdk": "^1.8.0",
    "@humanharness/blocks": "workspace:*",
    "@humanharness/harness-sdk": "workspace:*"
  },
  "devDependencies": {
    "@humanharness/fake-agent": "workspace:*"
  }
}
```

(`fake-agent` does not depend on `engines`, so the dev dependency makes no cycle.) Run `corepack pnpm install`.

- [ ] **Step 2: Move the files.**

```bash
mkdir -p packages/engines/src/acp
git mv packages/runtime/src/acp.ts packages/engines/src/acp/client.ts
git mv packages/runtime/test/acp.test.ts packages/engines/test/acp.test.ts
```

- [ ] **Step 3: Create `packages/engines/src/acp/options.ts`** with the `TransportOptions` interface and `acpFields` exactly as `packages/runtime/src/transport.ts` holds them after Task 1, with these imports:

```ts
import type { Permissions } from "@humanharness/harness-sdk";
import type { CommonOptions } from "../contract";
import type { EngineDef } from "../types";
```

`../types` does not exist until Task 4; for now import `EngineDef` from `".."` instead: `import type { EngineDef } from "..";`. Task 4 fixes the path.

- [ ] **Step 4: Fix `acp/client.ts`'s imports.** Replace its import block's last five lines with:

```ts
import * as acp from "@agentclientprotocol/sdk";
import type { Permissions } from "@humanharness/harness-sdk";
import { classifyError } from "../classify";
import { type ActivityKind, type Event, type Transport, fail } from "../contract";
import { type Effort, type ModelChoice, type ModelProfile, isCap, isEffort, isModelId } from "../models";
import type { TransportOptions } from "./options";
```

(the `node:*` imports above them stay).

- [ ] **Step 5: First version of `packages/engines/src/registry.ts`.**

```ts
export { AcpTransport, codexConfig, decidePermission, isUiTool, offeredModels, type PermissionPolicy } from "./acp/client";
export { type TransportOptions, acpFields } from "./acp/options";
```

- [ ] **Step 6: `runtime/src/transport.ts` becomes a re-export.** Replace the whole file with:

```ts
export type { Session, Transport } from "@humanharness/engines";
export { type TransportOptions, acpFields } from "@humanharness/engines/registry";
```

- [ ] **Step 7: Point the runtime at the moved client.** In `runtime.ts`, `system.ts` and `system-session.ts` replace `import { AcpTransport } from "./acp";` with `import { AcpTransport } from "@humanharness/engines/registry";`. In `packages/runtime/src/index.ts` replace the `./acp` line with:

```ts
export { AcpTransport, codexConfig, decidePermission, isUiTool, offeredModels, type PermissionPolicy } from "@humanharness/engines/registry";
```

- [ ] **Step 8: Fix the moved test's imports.** In `packages/engines/test/acp.test.ts` replace lines 6–9 with:

```ts
import { type ModelProfile, getEngine } from "../src";
import { AcpTransport, type PermissionPolicy, acpExtras, activityDetail, codexConfig, decidePermission, isUiTool, offeredModels, usdCost } from "../src/acp/client";
import type { Event, Session } from "../src/contract";
import { type TransportOptions, acpFields } from "../src/acp/options";
```

- [ ] **Step 9: Move the `acpFields` tests.** Cut the whole `describe("acpFields", …)` block (today `packages/runtime/test/runtime.test.ts:594-611`) out of `runtime.test.ts` and paste it, unchanged, into a new `packages/engines/test/acp-options.test.ts` under:

```ts
import { describe, expect, it } from "vitest";
import { OPENCODE_ENV, getEngine } from "../src";
import { acpFields } from "../src/acp/options";
```

In `runtime.test.ts` change line 13 to `import type { Session } from "../src/transport";`, and drop `OPENCODE_ENV` from line 6 if nothing else in the file uses it (`grep -n OPENCODE_ENV packages/runtime/test/runtime.test.ts`).

- [ ] **Step 10: Drop the ACP SDK from the runtime.** Run `grep -rn "@agentclientprotocol/sdk" packages/runtime/src packages/runtime/test`. Expected: nothing. Remove `"@agentclientprotocol/sdk": "^1.8.0",` from `packages/runtime/package.json` and run `corepack pnpm install`.

- [ ] **Step 11: Verify.** `corepack pnpm typecheck && corepack pnpm test`. Expected: green; N unchanged (tests moved, none added or lost).

- [ ] **Step 12: Commit.**

```bash
git add -A packages/engines packages/runtime pnpm-lock.yaml
git commit -m "refactor(engines): move the shared ACP client into engines/src/acp"
```

---

### Task 3: Move the Claude CLI transport into `engines/src/claude/`

**Files:**
- Move: `packages/runtime/src/claude-cli.ts` → `packages/engines/src/claude/transport.ts`; `packages/runtime/test/claude-cli.test.ts` → `packages/engines/test/claude-cli.test.ts`
- Modify: `packages/engines/src/registry.ts`, `packages/runtime/src/{runtime,system,system-session,index}.ts`, `packages/runtime/test/runtime.test.ts`

- [ ] **Step 1: Move the files.**

```bash
mkdir -p packages/engines/src/claude
git mv packages/runtime/src/claude-cli.ts packages/engines/src/claude/transport.ts
git mv packages/runtime/test/claude-cli.test.ts packages/engines/test/claude-cli.test.ts
```

- [ ] **Step 2: Fix the transport's imports and options type.** Replace its import lines after the `node:*` ones with:

```ts
import type { McpServerSpec } from "@humanharness/blocks";
import type { Permissions } from "@humanharness/harness-sdk";
import { classifyError } from "../classify";
import { type ActivityKind, type CommonOptions, type Event, type Transport, fail } from "../contract";
import { type ModelProfile, isCap, isEffort, isModelId } from "../models";
```

Then replace both uses of `TransportOptions` in the file with `CommonOptions` (the `Pick<TransportOptions, …>` parameter of `claudeArgs` and the constructor). Claude never read the ACP-only fields, so this is a type narrowing only. Check: `grep -n TransportOptions packages/engines/src/claude/transport.ts` prints nothing.

- [ ] **Step 3: Fix the moved test's imports.** In `packages/engines/test/claude-cli.test.ts` replace lines 6–8 with:

```ts
import { ClaudeCliTransport, StreamJsonReader, activityExtras, allowedTools, claudeArgs, disallowedTools, profileArgs, referenceRulePath, referenceSettingsArgs } from "../src/claude/transport";
import type { CommonOptions as TransportOptions, Event, Session } from "../src/contract";
```

(the alias keeps the test body untouched).

- [ ] **Step 4: Export it from the registry module.** Append to `packages/engines/src/registry.ts`:

```ts
export { ClaudeCliTransport, allowedTools, claudeArgs, profileArgs } from "./claude/transport";
```

- [ ] **Step 5: Point the runtime at it.** In `runtime.ts`, `system.ts`, `system-session.ts` replace `import { ClaudeCliTransport } from "./claude-cli";` with an addition to the registry import from Task 2, e.g. `import { AcpTransport, ClaudeCliTransport } from "@humanharness/engines/registry";`. In `packages/runtime/src/index.ts` replace the `./claude-cli` line with:

```ts
export { ClaudeCliTransport, allowedTools, claudeArgs, profileArgs } from "@humanharness/engines/registry";
```

In `packages/runtime/test/runtime.test.ts` change line 10 to `import { ClaudeCliTransport } from "@humanharness/engines/registry";`.

- [ ] **Step 6: Verify.** `corepack pnpm typecheck && corepack pnpm test`. Expected: green, N unchanged. `ls packages/runtime/src` shows `classify`-, `acp`- and `claude-cli`-free: `documents.ts events.ts index.ts runtime.ts system-session.ts system.ts transport.ts`.

- [ ] **Step 7: Commit.**

```bash
git add -A packages/engines packages/runtime
git commit -m "refactor(engines): move the Claude CLI transport into engines/src/claude"
```

---

### Task 4: One folder per engine for its definition

Pure move: `ENGINES` keeps the same entries in the same order, and `engines.test.ts` passes untouched.

**Files:**
- Create: `packages/engines/src/types.ts`, `packages/engines/src/claude/definition.ts`, `packages/engines/src/codex/definition.ts`, `packages/engines/src/opencode/definition.ts`, `packages/engines/src/listed.ts`
- Modify: `packages/engines/src/index.ts`, `packages/engines/src/acp/options.ts`, `packages/engines/src/contract.ts` (no change needed unless it imports from `..`)

Line numbers below are `packages/engines/src/index.ts` as it is on master before Task 1 (Task 1 added two lines after line 3, so add 2 to each when cutting; check with `grep -n 'id: "' packages/engines/src/index.ts`).

- [ ] **Step 1: `packages/engines/src/types.ts`.** Move, verbatim with their doc comments, from `index.ts`: `LegalStatus` (line 5), `TransportDef` (lines 7–26), `EngineSetup` (lines 53–72), `EngineDef` (lines 74–112) and `Mode` (line 255). Add at the top:

```ts
import type { EngineModels } from "./models";
```

- [ ] **Step 2: `packages/engines/src/claude/definition.ts`.**

```ts
import { CLAUDE_MODELS, EFFORTS } from "../models";
import type { EngineDef } from "../types";

export const claude: EngineDef = {
  // the Claude entry: today's index.ts lines 116-140, verbatim
};
```

Paste the object's properties (from `id: "claude",` through `logo: "assets/claude.svg",`) verbatim where the comment is, and delete the comment.

- [ ] **Step 3: `packages/engines/src/codex/definition.ts`.** Same shape: `import type { EngineDef } from "../types";` and `export const codex: EngineDef = { … };` with the Codex entry (lines 143–175) verbatim, its comments included.

- [ ] **Step 4: `packages/engines/src/opencode/definition.ts`.** Move `OPENCODE_PERMISSION` (lines 28–33 with its doc comment) and `OPENCODE_ENV` (lines 35–51 with its doc comment) here verbatim, then `export const opencode: EngineDef = { … };` with the OpenCode entry (lines 178–206) verbatim. Imports: `import type { EngineDef } from "../types";`.

- [ ] **Step 5: `packages/engines/src/listed.ts`.**

```ts
import type { EngineDef } from "./types";

/** Engines listed only for their legal status (pending or excluded): no folder of their own, the plain ACP adapter runs them. */
export const kimi: EngineDef = {
  // lines 209-221 verbatim
};
export const gemini: EngineDef = {
  // lines 224-236 verbatim
};
export const qwen: EngineDef = {
  // lines 239-251 verbatim
};
```

Paste each entry's properties verbatim where its comment is, and delete the comments.

- [ ] **Step 6: Rewrite the top of `packages/engines/src/index.ts`.** Everything from line 1 to the end of `ENGINES` and the `Mode` line becomes:

```ts
import { claude } from "./claude/definition";
import { codex } from "./codex/definition";
import { gemini, kimi, qwen } from "./listed";
import { opencode } from "./opencode/definition";
import type { EngineDef, LegalStatus, Mode } from "./types";

export * from "./models";
export * from "./types";
export * from "./contract";
export { classifyError } from "./classify";
export { OPENCODE_ENV, OPENCODE_PERMISSION } from "./opencode/definition";

export const ENGINES: readonly EngineDef[] = [claude, codex, opencode, kimi, gemini, qwen];
```

`getEngine`, `brandNames`, `availableEngines`, `NOTICE_VERSION`, `parseVersion` and `meetsMinVersion` stay below, unchanged.

- [ ] **Step 7: Point `acp/options.ts` at the types file.** Replace `import type { EngineDef } from "..";` with `import type { EngineDef } from "../types";`. Check nothing under `engines/src` imports from `".."` or `"."`: `grep -rnE 'from "\.\.?"' packages/engines/src` prints nothing.

- [ ] **Step 8: Verify.** `corepack pnpm typecheck && corepack pnpm vitest run packages/engines` then `corepack pnpm test`. Expected: green, N unchanged; `git diff --stat HEAD -- packages/engines/test` is empty.

- [ ] **Step 9: Commit.**

```bash
git add -A packages/engines
git commit -m "refactor(engines): one folder per engine for its definition"
```

---

### Task 5: Adapters and the registry

**Files:**
- Modify: `packages/engines/src/contract.ts`, `packages/engines/src/registry.ts`
- Create: `packages/engines/src/acp/adapter.ts`, `packages/engines/src/claude/adapter.ts`
- Test: `packages/engines/test/registry.test.ts`

- [ ] **Step 1: Write the failing test** `packages/engines/test/registry.test.ts`:

```ts
import os from "node:os";
import { describe, expect, it } from "vitest";
import { ENGINES, type CommonOptions, type EngineDef, getEngine } from "../src";
import { ADAPTERS, AcpTransport, ClaudeCliTransport, type TransportOptions, commandLine, createRegistry, createTransport } from "../src/registry";

const options = (edit: "folder" | "none"): CommonOptions => ({
  folder: os.tmpdir(),
  session: { id: "s", started: false },
  mcp: [],
  permissions: { edit, exec: false, web: false },
  command: ["unused"],
  onSessionStarted: () => {},
});
/** The options an ACP transport was built with (its constructor keeps them). */
const acpOptions = (t: unknown) => (t as { o: TransportOptions }).o;

describe("the engine registry", () => {
  it("has an adapter for every engine, and none can fork or keep memory yet", () => {
    for (const e of ENGINES) {
      expect(ADAPTERS[e.id], e.id).toBeDefined();
      expect(ADAPTERS[e.id].capabilities).toEqual({ forkSession: false, nativeMemory: false });
    }
  });

  it("names each engine's CLI as before", () => {
    expect(commandLine(getEngine("claude"))).toEqual(["claude"]);
    expect(commandLine(getEngine("codex"))).toEqual(["npx", "-y", "@agentclientprotocol/codex-acp@2.2.2"]);
    expect(commandLine(getEngine("opencode"))).toEqual(["opencode", "acp"]);
    expect(commandLine(getEngine("kimi"))).toEqual(["kimi", "acp"]);
  });

  it("builds Claude's CLI transport and the ACP client for the others", () => {
    expect(createTransport(getEngine("claude"), options("folder"))).toBeInstanceOf(ClaudeCliTransport);
    for (const id of ["codex", "opencode", "kimi"]) expect(createTransport(getEngine(id), options("folder"))).toBeInstanceOf(AcpTransport);
  });

  it("derives the ACP fields from the definition it is given and the edit permission", () => {
    expect(acpOptions(createTransport(getEngine("codex"), options("folder")))).toMatchObject({ sessionMode: "workspace-write", minAdapterVersion: "2.2.2" });
    expect(acpOptions(createTransport(getEngine("codex"), options("none")))).toMatchObject({ sessionMode: "read-only" });
    expect(acpOptions(createTransport(getEngine("opencode"), options("none")))).toMatchObject({ sessionMode: "plan", profileMethod: "config-option" });
    // A copy of a definition (tests do this) is read as given, not swapped for the registry's own.
    const codex = getEngine("codex");
    if (codex.transport.kind !== "acp") throw new Error("codex must use ACP");
    const copy: EngineDef = { ...codex, transport: { ...codex.transport, minAdapterVersion: "9.0.0" } };
    expect(acpOptions(createTransport(copy, options("folder"))).minAdapterVersion).toBe("9.0.0");
  });

  it("keeps the caller's options", () => {
    const o = { ...options("folder"), command: ["/bin/fake"], env: { HH_FAKE_X: "1" }, mcpOnly: true };
    expect(acpOptions(createTransport(getEngine("codex"), o))).toMatchObject({ command: ["/bin/fake"], env: { HH_FAKE_X: "1" }, mcpOnly: true });
  });

  it("refuses an engine with no adapter", () => {
    const unknown: EngineDef = { ...getEngine("kimi"), id: "nobody" };
    expect(() => createTransport(unknown, options("none"))).toThrow(/No adapter for engine: nobody/);
    expect(() => commandLine(unknown)).toThrow(/No adapter for engine: nobody/);
  });

  it("takes a new engine with one more line", () => {
    const echo = { ...ADAPTERS.claude, command: () => ["echo-agent"] };
    const registry = createRegistry({ ...ADAPTERS, echo });
    expect(registry.commandLine({ ...getEngine("claude"), id: "echo" })).toEqual(["echo-agent"]);
  });
});
```

- [ ] **Step 2: Run it to see it fail.** `corepack pnpm vitest run packages/engines/test/registry.test.ts`. Expected: FAIL, `ADAPTERS` / `commandLine` / `createRegistry` / `createTransport` are not exported by `../src/registry`.

- [ ] **Step 3: Add the adapter types to `packages/engines/src/contract.ts`.** Add `import type { EngineDef } from "./types";` to its imports and append:

```ts
/** What an engine can do beyond a turn, for policies to ask (spec §7.2). */
export interface Capabilities {
  /** A new session can start as a copy of another (a warm prefix). */
  forkSession: boolean;
  /** The engine keeps its own memory across sessions. */
  nativeMemory: boolean;
}

/**
 * Everything engine-specific the app needs beyond the definition (spec §4.2). It is given the definition rather
 * than holding one, so a test's copy of a definition is read as given.
 */
export interface EngineAdapter {
  capabilities: Capabilities;
  /** The engine's CLI before the app looks it up on PATH: [binary, ...args]. */
  command(engine: EngineDef): string[];
  /** A transport for `engine`; the adapter adds its own fields to the common options. */
  createTransport(engine: EngineDef, options: CommonOptions): Transport;
}
```

- [ ] **Step 4: `packages/engines/src/acp/adapter.ts`.**

```ts
import type { EngineAdapter } from "../contract";
import type { EngineDef, TransportDef } from "../types";
import { AcpTransport } from "./client";
import { acpFields } from "./options";

function acpDef(engine: EngineDef): Extract<TransportDef, { kind: "acp" }> {
  if (engine.transport.kind !== "acp") throw new Error(`Not an ACP engine: ${engine.id}`);
  return engine.transport;
}

/** Any engine that speaks the Agent Client Protocol: everything that differs between them is data in the definition. */
export const acpAdapter: EngineAdapter = {
  capabilities: { forkSession: false, nativeMemory: false },
  command: (engine) => [...acpDef(engine).command],
  createTransport: (engine, options) => new AcpTransport({ ...options, ...acpFields(engine, options.permissions.edit) }),
};
```

- [ ] **Step 5: `packages/engines/src/claude/adapter.ts`.**

```ts
import type { EngineAdapter } from "../contract";
import { ClaudeCliTransport } from "./transport";

/** Claude Code's CLI: one `claude -p` process per turn (docs/architecture/engines.md). */
export const claudeAdapter: EngineAdapter = {
  capabilities: { forkSession: false, nativeMemory: false },
  command: (engine) => {
    if (engine.transport.kind !== "claude-cli") throw new Error(`Not a Claude CLI engine: ${engine.id}`);
    return [engine.transport.binary];
  },
  createTransport: (_engine, options) => new ClaudeCliTransport(options),
};
```

- [ ] **Step 6: The registry.** Replace `packages/engines/src/registry.ts` with:

```ts
import { acpAdapter } from "./acp/adapter";
import { claudeAdapter } from "./claude/adapter";
import type { CommonOptions, EngineAdapter, Transport } from "./contract";
import type { EngineDef } from "./types";

export { AcpTransport, codexConfig, decidePermission, isUiTool, offeredModels, type PermissionPolicy } from "./acp/client";
export { type TransportOptions, acpFields } from "./acp/options";
export { ClaudeCliTransport, allowedTools, claudeArgs, profileArgs } from "./claude/transport";

/** One line per engine. Codex, OpenCode and the engines listed only for their legal status run the ACP adapter. */
export const ADAPTERS: Readonly<Record<string, EngineAdapter>> = {
  claude: claudeAdapter,
  codex: acpAdapter,
  opencode: acpAdapter,
  kimi: acpAdapter,
  gemini: acpAdapter,
  qwen: acpAdapter,
};

export interface Registry {
  adapter(engine: EngineDef): EngineAdapter;
  createTransport(engine: EngineDef, options: CommonOptions): Transport;
  commandLine(engine: EngineDef): string[];
}

/** A registry over `adapters`; the app uses `ADAPTERS`, a test may add its own engine. */
export function createRegistry(adapters: Readonly<Record<string, EngineAdapter>>): Registry {
  const adapter = (engine: EngineDef): EngineAdapter => {
    const found = adapters[engine.id];
    if (!found) throw new Error(`No adapter for engine: ${engine.id}`);
    return found;
  };
  return {
    adapter,
    createTransport: (engine, options) => adapter(engine).createTransport(engine, options),
    commandLine: (engine) => adapter(engine).command(engine),
  };
}

export const registry: Registry = createRegistry(ADAPTERS);
export const createTransport = registry.createTransport;
export const commandLine = registry.commandLine;
```

- [ ] **Step 7: Run the test.** `corepack pnpm vitest run packages/engines/test/registry.test.ts`. Expected: PASS (7 tests). If "derives the ACP fields" fails on `.o`, check `AcpTransport`'s constructor is still `constructor(private readonly o: TransportOptions)` (`acp/client.ts`).

- [ ] **Step 8: Verify and commit.** `corepack pnpm typecheck && corepack pnpm test` (N + 7).

```bash
git add -A packages/engines
git commit -m "feat(engines): engine adapters and the registry"
```

---

### Task 6: The runtime gets its transport from the registry

**Files:**
- Modify: `packages/runtime/src/runtime.ts`, `packages/runtime/src/system.ts`, `packages/runtime/src/system-session.ts`
- Test: `packages/runtime/test/fake-engine.test.ts` (new; §4.7)

- [ ] **Step 1: Write the failing test** `packages/runtime/test/fake-engine.test.ts`. It is §4.7's proof: a whole new engine is an adapter (here a transport that answers in-process) plus one registry line, and a turn runs through `createRuntime`.

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { type EngineAdapter, type EngineDef, type Event, type Transport, getEngine } from "@humanharness/engines";
import { ADAPTERS, createRegistry } from "@humanharness/engines/registry";
import { loadHarness } from "@humanharness/harness-sdk";
import { createRuntime } from "../src/runtime";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-echo-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/notes-harness/harness.config.ts");

// ---- the new engine's folder: a transport and its adapter ----
class EchoTransport implements Transport {
  async turn(message: string, emit: (event: Event) => void): Promise<void> {
    emit({ type: "text", delta: `echo: ${message}` });
    emit({ type: "done", ok: true });
  }
  async endSession(): Promise<void> {}
  async close(): Promise<void> {}
}
const echoAdapter: EngineAdapter = {
  capabilities: { forkSession: false, nativeMemory: false },
  command: () => ["echo-agent"],
  createTransport: () => new EchoTransport(),
};
const echo: EngineDef = { ...getEngine("claude"), id: "echo", name: "Echo" };
// ---- the registry line ----
const registry = createRegistry({ ...ADAPTERS, echo: echoAdapter });

describe("a new engine", () => {
  it("runs a turn through the runtime with one adapter and one registry line", async () => {
    const folder = path.join(fs.mkdtempSync(path.join(root, "t-")), "Work");
    const runtime = await createRuntime({
      harness: await loadHarness(FIXTURE),
      engine: echo,
      folder,
      gitdir: path.join(path.dirname(folder), "history.git"),
      language: "en",
      registry,
    });
    try {
      const events: Event[] = [];
      await runtime.send("hi", (e) => events.push(e)).done;
      expect(events).toContainEqual({ type: "text", delta: "echo: hi" });
      expect(events.at(-1)).toEqual({ type: "done", ok: true });
    } finally {
      await runtime.close();
    }
  });
});
```

- [ ] **Step 2: Run it to see it fail.** `corepack pnpm vitest run packages/runtime/test/fake-engine.test.ts`. Expected: typecheck-level failure in Vitest's output or a runtime failure: `registry` is not a `RuntimeOptions` field, so the runtime builds a `ClaudeCliTransport` and tries to spawn `claude` (or fails with "No adapter" once Step 3 is half done). Either way: FAIL.

- [ ] **Step 3: `runtime.ts` uses the registry.**
  - Imports: replace `import { AcpTransport, ClaudeCliTransport } from "@humanharness/engines/registry";` with `import { type Registry, registry as appRegistry } from "@humanharness/engines/registry";`. Replace the `./transport` import (`import { type Session, type Transport, type TransportOptions, acpFields } from "./transport";`) with `import type { CommonOptions, Session, Transport } from "@humanharness/engines";`. After this step `runtime.ts` no longer imports `./transport`.
  - In `RuntimeOptions`, next to `command?`, add:

```ts
  /** The engine adapters (tests add their own engine); default: the app's registry. */
  registry?: Registry;
```

  - In `buildRuntime`, the options and the transport become:

```ts
    const engines = opts.registry ?? appRegistry;
    const transportOptions: CommonOptions = {
      folder,
      session,
      mcp: [
        // unchanged
      ],
      permissions: harness.permissions,
      references: references.map((r) => r.path),
      command: opts.command ?? engines.commandLine(engine),
      env: opts.env,
      onModels: opts.onModels,
      onSessionStarted: (s) => {
        // unchanged
      },
    };
    const transport: Transport = engines.createTransport(engine, transportOptions);
```

  (the `...acpFields(engine, harness.permissions.edit),` line is gone: the ACP adapter adds it from `transportOptions.permissions.edit`, which is `harness.permissions.edit`.)

- [ ] **Step 4: `system.ts` and `system-session.ts`.** In each:
  - Replace the transport class import with `import { createTransport } from "@humanharness/engines/registry";`, and the `./transport` import with `import type { CommonOptions, Transport } from "@humanharness/engines";`.
  - Type the options `CommonOptions` instead of `TransportOptions`, delete the `...acpFields(o.engine, "none"),` line (permissions are `{ edit: "none", … }` in both, so the adapter derives the same fields).
  - Replace the conditional with `createTransport(o.engine, options)`:
    - `system.ts`: `const transport: Transport = createTransport(o.engine, options);`
    - `system-session.ts`: `transport = createTransport(o.engine, options);`

- [ ] **Step 5: Run the new test and the runtime suite.** `corepack pnpm vitest run packages/runtime`. Expected: all PASS, including "enforces the engine's minAdapterVersion on ACP engines" (the copy of Codex's definition reaches the ACP adapter as given) and the system/system-session tests.

- [ ] **Step 6: No transport choice left in the runtime.** `grep -rnE "transport\.kind|acpFields|new (Acp|ClaudeCli)Transport" packages/runtime/src`. Expected: nothing.

- [ ] **Step 7: Verify and commit.** `corepack pnpm typecheck && corepack pnpm test` (N + 8).

```bash
git add -A packages/runtime
git commit -m "refactor(runtime): get each transport and engine command from the registry"
```

---

### Task 7: The shell asks the registry

**Files:**
- Modify: `packages/shell/src/main/engine-check.ts`, `packages/shell/src/main/engine-command.ts`, `packages/runtime/src/index.ts`, `packages/runtime/src/transport.ts`

- [ ] **Step 1: `engine-check.ts`.** Replace its runtime import block with:

```ts
import type { CommonOptions, EngineDef, EngineError, Event, Transport } from "@humanharness/engines";
import { createTransport } from "@humanharness/engines/registry";
```

(and delete the separate `import type { EngineDef } from "@humanharness/engines";`). In `testPrompt`, type the options `CommonOptions`, delete `...acpFields(engine, "none"),`, and build the transport with `const transport: Transport = createTransport(engine, options);`.

- [ ] **Step 2: `engine-command.ts`.** Add `import { commandLine } from "@humanharness/engines/registry";` and replace the body of `engineCommand` after `const PATH = await loginShellPath(d);` with:

```ts
  const line = commandLine(engine);
  const pkg = line.find((part) => part.replace(/@[^@/]+$/, "") in BUNDLED_ADAPTERS);
  if (pkg) {
    const entry = d.resolveModule(BUNDLED_ADAPTERS[pkg.replace(/@[^@/]+$/, "")]);
    return { command: [d.electronPath, entry], env: { PATH, ELECTRON_RUN_AS_NODE: "1" } };
  }
  const [binaryName, ...args] = line;
  const binary = await resolveBinary(binaryName, PATH, d);
  return binary ? { command: [binary, ...args], env: { PATH } } : null;
```

Same result for every engine: Claude's line is `["claude"]`, which names no bundled adapter, so it resolves `claude` with no args and `{ PATH }`, exactly as the removed branch did.

- [ ] **Step 3: Run the shell's engine tests.** `corepack pnpm vitest run packages/shell/test/engine-check.test.ts packages/shell/test/engine-command.test.ts`. Expected: PASS, untouched.

- [ ] **Step 4: The runtime stops exporting transports.** Nothing outside the engines package builds one now. Check: `grep -rnE "(AcpTransport|ClaudeCliTransport|acpFields|TransportOptions|codexConfig|decidePermission|isUiTool|offeredModels|claudeArgs|profileArgs|allowedTools)\b" packages/*/src packages/*/test --include='*.ts' --include='*.tsx' | grep -v "^packages/engines/"`. Expected: only `packages/runtime/src/index.ts`, `packages/runtime/src/transport.ts` and `packages/runtime/test/runtime.test.ts` (`ClaudeCliTransport`, from `@humanharness/engines/registry` since Task 3). Then:
  - `packages/runtime/src/index.ts`: delete the two lines re-exporting from `@humanharness/engines/registry`.
  - `packages/runtime/src/transport.ts`: becomes `export type { CommonOptions, Session, Transport } from "@humanharness/engines";` (the compatibility re-export of §4.4; whether it stays is plan 2's open question, §12).

- [ ] **Step 5: Verify and commit.** `corepack pnpm typecheck && corepack pnpm test` (N + 8).

```bash
git add -A packages/shell packages/runtime
git commit -m "refactor(shell): test prompt and engine command through the registry"
```

---

### Task 8: Guard against a new transport choice, and the docs

**Files:**
- Test: `packages/engines/test/boundary.test.ts`
- Modify: `docs/architecture/engines.md`, `docs/architecture/turn.md`
- Create: `docs/architecture/replaceable-parts.md`

- [ ] **Step 1: Write the test** `packages/engines/test/boundary.test.ts` (§4.7's grep, kept; plan 3's import-boundary test will absorb it):

```ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packages = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const engineSrc = path.join(packages, "engines", "src");

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === "node_modules" ? [] : sources(p);
    return /\.tsx?$/.test(d.name) ? [p] : [];
  });
}

describe("engine boundary (replaceable parts D7)", () => {
  it("reads transport.kind only inside engines/src", () => {
    const offenders = fs
      .readdirSync(packages)
      .map((name) => path.join(packages, name, "src"))
      .filter((src) => fs.existsSync(src) && src !== engineSrc)
      .flatMap(sources)
      .filter((file) => fs.readFileSync(file, "utf8").includes("transport.kind"))
      .map((file) => path.relative(packages, file));
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it.** `corepack pnpm vitest run packages/engines/test/boundary.test.ts`. Expected: PASS. Prove it can fail: temporarily add `// transport.kind` to `packages/runtime/src/runtime.ts`, rerun (FAIL listing `runtime/src/runtime.ts`), then remove the line.

- [ ] **Step 3: `docs/architecture/engines.md`.**
  - Line 7: `packages/engines/src/index.ts` describes each engine → "Each engine's definition lives in its own folder (`packages/engines/src/claude/definition.ts`, `codex/`, `opencode/`; the engines listed only for their legal status in `listed.ts`), and `packages/engines/src/index.ts` collects them in `ENGINES`. A definition holds …" (rest of the sentence unchanged).
  - Line 11: `packages/runtime/src/claude-cli.ts` → `packages/engines/src/claude/transport.ts`.
  - Lines 15–17: `acp.ts` / `packages/runtime/src/acp.ts` → `packages/engines/src/acp/client.ts`. Replace line 17's last sentence ("Any new place that builds ACP transport options spreads `acpFields` …") with: "Callers never build engine-specific options: they pass `CommonOptions` to `createTransport` (`packages/engines/src/registry.ts`), and the ACP adapter adds the mode, the adapter gate, the profile method and the fixed env from the definition (`acpFields`, `packages/engines/src/acp/options.ts`)."
  - Line 18: "reaches the process through `acpFields` → `TransportOptions.engineEnv`" → "reaches the process through the ACP adapter (`acpFields` → `TransportOptions.engineEnv`)".
  - Add a section at the end:

```markdown
## Adding an engine

An engine is a definition plus an adapter (`packages/engines/src/contract.ts`, `EngineAdapter`): the adapter names the CLI (`command`), builds the transport from `CommonOptions` (`createTransport`) and declares its `capabilities`. A new engine is a folder under `packages/engines/src/<id>/` (its definition, and its transport and adapter if it speaks neither ACP nor Claude's CLI), one entry in `ENGINES` and one line in `ADAPTERS` (`registry.ts`). Nothing outside `packages/engines/src` reads `transport.kind` (`packages/engines/test/boundary.test.ts`). The runtime and the shell get a transport from `createTransport(engine, options)` and the CLI from `commandLine(engine)`, through `@humanharness/engines/registry` (Node only; the package root stays safe for the window).

Mock mode does not go through the registry: `HH_TEST_ENGINES` replaces an engine's command with a fake CLI that speaks the same protocol (`packages/fake-agent`), so the engine's own adapter and transport still run.
```

- [ ] **Step 4: `docs/architecture/turn.md` line 9.** `packages/runtime/src/events.ts` → `packages/engines/src/contract.ts` (re-exported by `@humanharness/runtime`).

- [ ] **Step 5: `docs/architecture/replaceable-parts.md`.**

```markdown
# Replaceable parts

The parts of Human Harness that age fast sit behind seams, so each can be replaced by writing one module and changing config (spec `docs/superpowers/specs/2026-10-29-replaceable-parts-design.md`).

| Part | Seam | Status |
|---|---|---|
| Engines and transports | `EngineAdapter` + registry (`packages/engines/src/registry.ts`) | Done (plan 1) |
| UI/core contract | `@humanharness/protocol` | Plan 2 |
| Model routing | `ModelPolicy` | Plan 3 |
| Context strategy | `ContextPolicy` | Plan 4 |

Rules: dependencies point down only; no `if (kind === "claude-cli")` outside an engine's folder (`packages/engines/test/boundary.test.ts`); policies decide and never execute; interfaces are defined by their inputs and outputs. How to add an engine: `docs/architecture/engines.md`, "Adding an engine".
```

- [ ] **Step 6: Commit.**

```bash
git add packages/engines/test/boundary.test.ts docs/architecture
git commit -m "test(engines): guard the engine boundary; docs for the new homes"
```

---

### Task 9: Full verification

- [ ] **Step 1:** `corepack pnpm typecheck`. Expected: no errors.
- [ ] **Step 2:** `corepack pnpm test`. Expected: green, N + 9 tests (registry 7, fake engine 1, boundary 1).
- [ ] **Step 3: Tests untouched except imports.** `git diff master --stat -M -- 'packages/*/test'` lists only the moved files, `runtime.test.ts`, and the three new tests. `git diff master -M -- 'packages/*/test' | grep -E '^[-+]' | grep -vE '^(\+\+\+|---)' | grep -vE '^[-+]import|^[-+]\s*$'` shows only the `describe("acpFields")` block leaving `runtime.test.ts` and arriving in `acp-options.test.ts`, plus the new test files.
- [ ] **Step 4: §4.7 grep.** `grep -rn "transport.kind" packages/*/src | grep -v "^packages/engines/src/"`. Expected: nothing.
- [ ] **Step 5: The app builds.** `corepack pnpm app:build`. Expected: build succeeds (main bundles `@humanharness/engines/registry`; `@agentclientprotocol/sdk` resolves from the engines package).
- [ ] **Step 6: e2e.** `corepack pnpm e2e`. Expected: all specs pass (they run the real transports against the fake CLIs in mock mode: Claude, Codex and OpenCode paths).
- [ ] **Step 7: Mock run, by hand.** `corepack pnpm start-demo`; start a task, send a message, see an answer. Close the app.
- [ ] **Step 8:** Push the branch and open the PR ("refactor: engine adapters (replaceable parts, plan 1)"), listing the three deviations from the top of this plan.
