# Tools and recipes, slice 1 (broker and secrets in the core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship delivery slice 1 of the tools-and-recipes spec (§15.1): the plugin broker's generic part and the plugin secret store become core services that plugins (now) and tools (slice 2) share, with every plugin test unchanged; a harness may declare `secrets`, a `connect` setup step asks for them, and Settings › Connections lists them. A harness that declares no `secrets` and no `connect` step is byte for byte today's app.

**Architecture.**

*The broker.* `packages/shell/src/main/plugin-broker.ts` today holds three things: pure argument checks, a generic run/fetch/exec/data/log engine, and the plugin-only calls (settings, attention, chips, sources). The first two move into the core:
- `packages/shell/src/main/broker/broker-checks.ts` (new): the pure checks and helpers, moved verbatim (`Malformed`, `fail`, `isPlainObject`, `checkBudget`, `checkJson`, `record`, `str`, `dataKey`, `visible`, `onlyKeys`, `withKey`, `query`, `records`, `fetchRequest`, `oneLine`, `Slots`, `BROKER_LIMITS`, `CONTROLS`, `CONTROLS_BUT_NEWLINE`).
- `packages/shell/src/main/broker/broker.ts` (new): `class Broker`, the core engine. It knows nothing about plugins: what a caller may reach comes in a `BrokerGrant` (hosts, secret ids, exec patterns, a collection test, and the refusal texts naming where each is declared). It owns runs (`startRun(key)`, `endRun(id)`, `killAll()`), the per-call budget, the in-flight cap, the fetch/exec slots, `fetch`, `exec`, `data.*`, `log`, and takes extra handlers by name from its owner.
- `packages/shell/src/main/plugin-broker.ts` (same path, smaller): `class PluginBroker`, the plugin adapter. Same constructor (`BrokerDeps`), same methods (`startRun(source)`, `endRun`, `killAll`, `call`), same exports (`BROKER_CALLS`, `BROKER_LIMITS`, `BrokerAnswer`, `BrokerDataOp`, `BrokerDeps`, `PluginAttentionInput`). It builds a `Broker` with a grant from the manifest and adds `settings.get`, `attention.*`, `chip.*` as extra handlers. Every refusal text stays byte-identical.
- `plugin-fetch.ts` and `plugin-exec.ts` keep their paths and names (the core broker imports them; the CLI entry test pins them in `plugin-cli.ts`'s import graph). A rename is a later cleanup (Decision 12).

*The secrets.*
- `packages/shell/src/main/secrets/secret-store.ts` (new): `SecretStore`, moved verbatim from `plugin-secrets.ts`, plus four harness methods (`storedHarness`, `setHarness`, `deleteHarness`, `harnessValues`) over the reserved owner folder `_harness` (no plugin id can start with `_`), and `secretName(owner, id)` for the spec's logical names (`jira`, `plugin.oncall.jira`). Files on disk do not change: `~/.humanharness/<harness-id>/secrets/<plugin>/<id>.bin` for plugins, `…/secrets/_harness/<id>.bin` for the harness (Decision 2).
- `packages/shell/src/main/secrets/safe-storage.ts` (new): `safeStorageCrypto`, moved from `plugin-ipc.ts` (which re-exports it).
- `packages/shell/src/main/plugin-secrets.ts` (same path): one re-export line, so `plugin-secrets.test.ts`, `plugins-fixtures.ts` and every caller keep compiling.
- `packages/shell/src/main/secrets/connections.ts` (new): `ConnectionsController`: the harness's declared secrets, each `{ id, label, help?, set }`; `set`, `delete`; never a value out.
- `packages/shell/src/main/secrets/connections-ipc.ts` (new): `hh:connectionsGet`, `hh:connectionsSet`, `hh:connectionsDelete`, push `hh:connectionsChange`; registered only when the harness declares `secrets`.

*Manifest and setup.* `packages/harness-sdk/src/secrets.ts` (new): `secrets: [{ id, label, help? }]`, `hasSecrets`, `secretProblems`. `setup.ts` gains a fourth step kind `connect` (`{ id, kind: "connect", label, description?, required, secrets: string[] }`). `test?: toolId` waits for slice 2, which adds tools (Decision 4).

*Window.* `client.connections` (preload, fake client), `AppState.connections?: ConnectionsInfo`, `SetupStepView` gains `kind: "connect"` with `secrets`. `packages/ui/src/connections/SecretField.tsx`, `ConnectionsTab.tsx`, `ConnectStep.tsx`. Settings tab `connections` after `plugins`, shown only with `state.connections`.

**Tech Stack:** TypeScript, Node `fs`, Electron `safeStorage` (injected), Zod, React 19, Vitest, Playwright (mock mode).

**Spec:** `docs/superpowers/specs/2026-10-28-tools-and-recipes-design.md` §2 D7, D9; §4.2; §9; §14 (plugins, setup steps); §15 slice 1. **Base:** `feat/harness-hatches` at 836a411 or later (sidekick, plugins parts 1–2, parallel tasks parts 1–3 with jobs, hatches parts 1–3; none on master yet). **Branch:** `feat/tools-core`, created from `feat/harness-hatches` in Task 0. Slice 2 stacks on it (`feat/tools`).

---

## Conventions

**Code.** As every earlier plan:
- English everywhere (code, comments, docs, UI strings in `en.json`);
- packages export TS source; extensionless imports;
- tests in `packages/<name>/test/`; one behaviour per `it`, named after what it pins;
- match the surrounding style and comment density; no reformatting of existing code.

**Commands** (from the worktree root `/Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-sidekick`, never `cd` elsewhere):
- one file: `corepack pnpm vitest run <path>`;
- all: `corepack pnpm typecheck` and `corepack pnpm test`;
- shell main, preload, resources or UI touched: `corepack pnpm app:build`;
- e2e when the task says so: `corepack pnpm --filter @humanharness/e2e exec playwright test <file>` (or `corepack pnpm e2e`).

**Install nothing.** No `pnpm install` of any kind, no `npx` that downloads.

**Git.** `git -C <worktree> …`, one simple command per call. New files: `git -C <worktree> add <new paths>`; then commit with `git -C <worktree> commit --only <every path of the task> -m "<subject>" -m "<trailer>"`. Never push, never a bare `git stash` (the stack is shared: a WIP commit instead), never commit on another branch. Trailer:

```
Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv
```

**i18n.** New strings go in `packages/i18n/src/locales/en.json`, in a new top-level `"connections"` block (created by Task 8); edit nothing outside it.

**Hot files.** Keep edits to `index.ts` (shell main), `plugins.ts`, `setup-steps.ts`, `client.ts`, preload, `SettingsSheet.tsx`, `SetupFlow.tsx` small and additive.

**Security rules (every task).** Never read `~/.claude`, `~/.codex`, `~/.gemini`, `~/.config/opencode`, `~/.local/share/opencode`, `~/.ssh`, `~/.netrc` or any credential, token or account file, in code, tests or checks. Tests never touch the real Keychain (every `SecretStore` in a test gets a fake `SecretCrypto`; the e2e uses the `HH_TEST_FAKE_SECRETS` hook, Task 10), never raise OS notifications or touch the Dock, never reach the network beyond 127.0.0.1. Never run the real `claude`, `codex` or `opencode`.

## Plugin tests are frozen

The move is the intended change, and it must be invisible to plugins. These files must be byte-identical at the end of every task (checked in each task's last step and by the reviewer):

```bash
git -C <worktree> diff --stat feat/harness-hatches -- packages/shell/test/plugin-*.test.ts packages/shell/test/plugins-*.test.ts packages/shell/test/plugins-fixtures.ts packages/cli/test/plugin-*.test.ts packages/harness-sdk/test/plugin*.test.ts packages/harness-sdk/test/define-plugin.test.ts packages/e2e/tests/plugins.spec.ts packages/e2e/tests/plugins-surface.spec.ts
```
Expected: no output. A plugin test that fails after a task is a bug in the task, never a test to edit.

## D0 is a hard rule

A harness that declares no `secrets` (and so no `connect` step) runs no slice-1 code beyond the moved modules, which behave exactly as before:
- `defineHarness` output has no `secrets` key; `setupStepViews` for `form`, `interview` and `component` steps is unchanged;
- no `SecretStore` is built unless the harness takes plugins (as today); no `secrets/_harness/` folder is ever made;
- no `hh:connections*` channel; `AppState` has no `connections` key; no Connections tab;
- the claude argv, AGENTS.md, first messages, history and usage lines are untouched (nothing in this slice reaches the runtime).

| D0 item | Pinned by |
|---|---|
| Manifest | `packages/harness-sdk/test/secrets.test.ts` "D0: no secrets key without it" (Task 4) |
| Setup kinds | `packages/harness-sdk/test/setup.test.ts` existing tests unchanged; `packages/shell/test/setup-steps.test.ts` "D0: views of form, interview and component steps are unchanged by connect" (Task 6) |
| Store and channels | `packages/shell/test/connections-surface.test.ts` "D0: connections channels are registered only under hasSecrets" and "D0: the SecretStore is built only for plugins or secrets" (Task 5) |
| UI | `packages/ui/test/connections-ui.test.tsx` "D0: no Connections tab without state.connections" (Task 8) |
| Runtime and history | `packages/runtime/test/runtime-d0.test.ts`, `packages/runtime/test/hatches-d0.test.ts`, `packages/runtime/test/claude-cli.test.ts` (goldens), `packages/shell/test/hatches-surface.test.ts`, `packages/e2e/tests/history.spec.ts`: byte-identical (`git diff --stat feat/harness-hatches -- <these>` empty, Task 11) |
| Plugins | the frozen list above |

## Threat model (slice 1)

The harness secret store holds the person's API tokens. Plugins' rules B6 and B8 stay as they are; these rows add the harness side.

| # | Boundary | What enforces it | Test |
|---|---|---|---|
| S1 | A value never reaches a renderer | `ConnectionsController.view()` returns `{ id, label, help?, set }` only; IPC answers fixed refusals; `set` returns `{ ok }` or a message that never carries the value | `connections.test.ts` "no value in the view or any answer" (Task 5) |
| S2 | Harness and plugin keys never mix | harness keys live under `_harness/`, which `PLUGIN_ID` can never name; `PluginsController` asks only `values(plugin, ids)`; `harnessValues` never reads a plugin folder | `secret-store.test.ts` "a plugin can't read the harness's keys, nor the other way" (Task 3) |
| S3 | Only declared ids | `ConnectionsController.set/delete` refuse an id the manifest doesn't declare (`Object.hasOwn`-safe lookup with `find`), bounded strings | `connections-ipc.test.ts` "undeclared, too long or non-string ids are refused" (Task 5) |
| S4 | No storage in the clear | the same `available()` gate as plugins; on Linux `basic_text` counts as unavailable | `secret-store.test.ts` "harness keys refuse to store without encryption" (Task 3) |
| S5 | Links and hard links | the store's existing `lstat`/`O_NOFOLLOW`/`nlink` rules apply to `_harness/` | `secret-store.test.ts` "a linked _harness folder reads as no keys and is never written through" (Task 3) |
| S6 | Tests never touch the Keychain | fakes in unit tests; `HH_TEST_FAKE_SECRETS=1` (ignored in a packaged app) in e2e | `test-hooks.test.ts` "fake secrets only when not packaged" (Task 10) |

## Decisions (product questions take the spec's defaults; Marco may change any)

1. **Exact new names and paths.** `broker/broker.ts` (`Broker`, `BrokerGrant`, `CoreBrokerDeps`, `CORE_CALLS`, `BrokerRun`), `broker/broker-checks.ts` (the pure checks, `BROKER_LIMITS`, `Slots`), `secrets/secret-store.ts` (`SecretStore`, `SecretCrypto`, `SecretResult`, `SECRET_MIN`, `SECRET_MAX`, `HARNESS_SECRETS_OWNER = "_harness"`, `secretName`), `secrets/safe-storage.ts` (`safeStorageCrypto`), `secrets/connections.ts` (`ConnectionsController`), `secrets/connections-ipc.ts` (`CONNECTIONS_IPC_CHANNELS`, `registerConnectionsIpc`). `plugin-broker.ts` stays as the plugin adapter (`PluginBroker`, unchanged API); `plugin-secrets.ts` becomes a one-line re-export.
2. **Storage.** The spec says storage does not change and names keys `<id>` / `plugin.<plugin-id>.<id>`. Files stay `<secrets>/<plugin>/<id>.bin` (the plugin tests pin it). Harness keys go in `<secrets>/_harness/<id>.bin`. The spec's names are logical: `secretName("harness", "jira") === "jira"`, `secretName("oncall", "jira") === "plugin.oncall.jira"`, used in logs and, from slice 2, in traces.
3. **`secrets` manifest key.** A list of at most 10 `{ id, label, help? }`; `id` matches `^[a-z][a-z0-9_-]{0,39}$` (the plugin key id pattern), unique; `label` 1–80, `help` 1–200, one English line each, no hidden characters. Strict objects.
4. **`connect` step.** `{ id, kind: "connect", label, description?, required?, secrets: [ids] }`, 1–10 declared ids, each listed once; a secret may appear in several steps. `test?: toolId` and "Test connection" come in slice 2 with tools (the spec's §9 test runs a tool, and there are no tools before slice 2). Until then the schema doesn't know `test` (a `z.object`, so an unknown key is stripped, not refused).
5. **Next on a connect step** is enabled once every listed secret is set; it marks the step done (`SetupSteps.complete`). Skip works as for other steps (not for a required one). A step whose secrets are all set already (from Settings) shows them as set and Next at once.
6. **Settings › Connections.** A tab `connections` after `plugins` and before `jobs`, labelled "Connections", shown only with `state.connections` (the harness declares secrets). One row per declared secret, in manifest order: label, help, "Set" or "Not set", a password field with "Save" (or "Replace" when set) and "Delete" (when set, no confirm, as the plugin detail does). The field clears before the answer arrives. Plugin keys stay in each plugin's detail.
7. **IPC.** `hh:connectionsGet()`, `hh:connectionsSet(id, value)`, `hh:connectionsDelete(id)`, push `hh:connectionsChange`. Only `set` sends a value; only `set: boolean` comes back.
8. **One store.** `index.ts` builds one `SecretStore` when the harness takes plugins (or has dev plugins) **or** declares secrets, and hands the same instance to `PluginsController` and `ConnectionsController`. Without either, none (D0).
9. **Profiles.** Harness keys are per harness, not per profile, like plugin keys today.
10. **e2e without the Keychain.** A test hook `HH_TEST_FAKE_SECRETS=1` (read by `readTestHooks`, ignored when packaged) swaps `safeStorageCrypto(safeStorage)` for a reversible in-memory crypto. Plugins' e2e never set it, so their behaviour is unchanged.
11. **Missing-secret message.** Slice 2's tool broker fails a call naming a missing secret with "<label> is not set — Settings › Connections". This slice ships the text helper `missingSecretMessage(label)` in `connections.ts` so slice 2 only imports it.
12. **`plugin-fetch.ts`, `plugin-exec.ts`** keep their names although the core broker uses them; a rename (with re-export shims) is a later cleanup.

## File structure

| File | Change | Responsibility |
|---|---|---|
| `packages/shell/src/main/broker/broker-checks.ts` | Create | pure argument checks, `Slots`, `BROKER_LIMITS` |
| `packages/shell/src/main/broker/broker.ts` | Create | `Broker`: runs, budget, fetch/exec/data/log, grant-driven |
| `packages/shell/src/main/plugin-broker.ts` | Modify | plugin adapter over `Broker`, same API |
| `packages/shell/src/main/secrets/secret-store.ts` | Create | `SecretStore` (moved) + harness owner |
| `packages/shell/src/main/secrets/safe-storage.ts` | Create | `safeStorageCrypto` (moved) |
| `packages/shell/src/main/plugin-secrets.ts` | Modify | re-export |
| `packages/shell/src/main/plugin-ipc.ts` | Modify | re-export `safeStorageCrypto` |
| `packages/shell/src/main/secrets/connections.ts` | Create | `ConnectionsController`, `missingSecretMessage` |
| `packages/shell/src/main/secrets/connections-ipc.ts` | Create | channels |
| `packages/shell/src/main/setup-steps.ts` | Modify | `connect` view and completion |
| `packages/shell/src/main/test-hooks.ts` | Modify | `HH_TEST_FAKE_SECRETS` |
| `packages/shell/src/main/index.ts` | Modify | one store, controller, channels, `AppState.connections` |
| `packages/shell/src/preload/index.ts` | Modify | `connections` |
| `packages/harness-sdk/src/secrets.ts`, `setup.ts`, `index.ts` | Create/Modify | `secrets`, `connect` |
| `packages/ui/src/client.ts`, `packages/ui/test/fake-client.ts` | Modify | types, fake |
| `packages/ui/src/connections/SecretField.tsx`, `ConnectionsTab.tsx`, `ConnectStep.tsx` | Create | UI |
| `packages/ui/src/SettingsSheet.tsx`, `SetupFlow.tsx`, `SetupStepsList.tsx` | Modify | wiring |
| `packages/i18n/src/locales/en.json` | Modify | `"connections"` block |
| `packages/fake-agent/fixtures/secrets-harness/` | Create | e2e fixture |
| `packages/e2e/tests/connections.spec.ts` | Create | e2e |
| `docs/architecture/secrets.md` (new), `plugins.md`, `setup.md`, `manifest.md` | Create/Modify | docs |

## Overlaps

- **Plugins (parts 1–2):** the broker and store are shared now. `PluginsController` keeps building `PluginBroker` with the same deps; only `index.ts` changes where the store comes from. `plugin-cli.ts` (`@humanharness/shell/plugins`, the CLI's entry) keeps exporting `PluginBroker` and friends from `./plugin-broker`; the new `broker/` files must not import Electron (`plugin-cli-entry.test.ts` walks the graph).
- **Setup steps:** a fourth kind. `setupStepViews`, `SetupSteps.complete`, `SetupFlow` and `SetupStepsList` each get one branch.
- **Jobs (part 3):** untouched. Nothing here assumes what a job is.
- **Hatches:** untouched; `hatches-surface.test.ts` stays byte-identical.
- **Slice 2:** takes `Broker`, `BrokerGrant`, `SecretStore.harnessValues`, `missingSecretMessage`, and adds `test` to `connect`.

## Open questions (each with the default this plan takes)

1. Storage layout for harness keys (Decision 2: `_harness/`).
2. "Test connection" deferred to slice 2 (Decision 4).
3. Next requires every listed secret set (Decision 5).
4. Tab placement after Plugins (Decision 6).

## Self-review (done while writing)

- Spec coverage: §9 store move (Tasks 1–3), `secrets` (Task 4), `connect` (Tasks 4, 6, 9), Settings › Connections (Tasks 5, 7, 8), plugin key namespacing (Task 3 `secretName`), §4.2 broker move (Tasks 1–2), §13 "broker: plugin tests unchanged after the move" (frozen list, every task), "the connect setup step and Settings › Connections" unit tests (Tasks 5, 6, 8, 9), §14 plugins and setup steps (Tasks 2, 3, 6), docs (Task 11).
- Types: `BrokerGrant`, `CoreBrokerDeps`, `BrokerRun` (Task 2); `HARNESS_SECRETS_OWNER`, `secretName` (Task 3); `HarnessSecret`, `SetupConnectStep` (Task 4); `ConnectionView`, `ConnectionsInfo`, `ConnectionResult` (Tasks 5, 7).

---

### Task 0: Branch, plans and base line

**Files:**
- Create: branch `feat/tools-core`
- Create: `docs/superpowers/plans/2026-10-29-tools-slice1-core-broker.md`, `docs/superpowers/plans/2026-10-29-tools-slice2-tools.md`

- [ ] **Step 1: Check the base.**

```bash
git -C <worktree> status --short
git -C <worktree> branch --show-current
git -C <worktree> log --oneline -1
git -C <worktree> merge-base --is-ancestor 836a411 HEAD
git -C <worktree> merge-base --is-ancestor 79cbdb0 HEAD
```
Expected: no status output; `feat/harness-hatches`; both ancestor checks exit 0 (79cbdb0 is the approved tools spec; it is already on this branch through origin/master). Otherwise stop and report.

- [ ] **Step 2: Branch.**

```bash
git -C <worktree> switch -c feat/tools-core
```

- [ ] **Step 3: Plans.** Copy both plans from the scratch folder (`SCRATCH/../plans/`, one level above `s1/`).

```bash
cp SCRATCH/../plans/2026-10-29-tools-slice1-core-broker.md SCRATCH/../plans/2026-10-29-tools-slice2-tools.md <worktree>/docs/superpowers/plans/
git -C <worktree> add docs/superpowers/plans/2026-10-29-tools-slice1-core-broker.md docs/superpowers/plans/2026-10-29-tools-slice2-tools.md
git -C <worktree> commit --only docs/superpowers/plans/2026-10-29-tools-slice1-core-broker.md docs/superpowers/plans/2026-10-29-tools-slice2-tools.md -m "docs: tools and recipes plans, slices 1 and 2" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

- [ ] **Step 4: Base line.** `corepack pnpm typecheck` and `corepack pnpm test` green. Write in `SCRATCH/carry-notes.md`: HEAD SHA, the test count, and the list of plugin test files with `git -C <worktree> hash-object` of each (the frozen list), so later tasks can compare.

---

### Task 1: The broker's pure checks move to `broker/broker-checks.ts`

A move, no behaviour change. `plugin-broker.ts` imports what it used to define.

**Files:**
- Create: `packages/shell/src/main/broker/broker-checks.ts`
- Modify: `packages/shell/src/main/plugin-broker.ts`
- Test: `packages/shell/test/broker/broker-checks.test.ts` (new)

- [ ] **Step 1: Write the failing test.**

```ts
// packages/shell/test/broker/broker-checks.test.ts
import { describe, expect, it } from "vitest";
import { BROKER_LIMITS, Malformed, Slots, checkBudget, checkJson, dataKey, fetchRequest, query } from "../../src/main/broker/broker-checks";

describe("broker checks (tools spec §4.2: the core broker's argument rules)", () => {
  it("a call over the value budget is Malformed, counting a shared reference each time", () => {
    const shared = Array.from({ length: 1000 }, () => 0);
    const big = Array.from({ length: 300 }, () => shared);
    expect(() => checkBudget([big])).toThrow(Malformed);
    expect(() => checkBudget([{ a: 1 }])).not.toThrow();
  });
  it("plain JSON only: no __proto__ key, no non-finite number, bounded depth", () => {
    expect(() => checkJson(JSON.parse('{"__proto__":1}'), "A record")).toThrow("A record has a key that is not allowed");
    expect(() => checkJson({ n: Infinity }, "A record")).toThrow("A record holds a number that is not finite");
    let deep: unknown = 1;
    for (let i = 0; i < BROKER_LIMITS.depth + 1; i++) deep = [deep];
    expect(() => checkJson(deep, "A record")).toThrow("A record is nested too deep");
  });
  it("keys, queries and fetch options keep their shapes", () => {
    expect(dataKey(3)).toBe(3);
    expect(() => dataKey({})).toThrow("A key is text or a number");
    expect(query({ limit: 5000 })).toEqual({ limit: BROKER_LIMITS.queryLimit });
    expect(() => fetchRequest("https://x", { mode: "cors" })).toThrow("fetch's options has an unknown field");
  });
  it("Slots lets n holders in and the rest wait in order", async () => {
    const s = new Slots(1);
    const a = await s.acquire();
    let second = false;
    const b = s.acquire().then((r) => ((second = true), r));
    await Promise.resolve();
    expect(second).toBe(false);
    a();
    (await b)();
    expect(second).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to see it fail.** `corepack pnpm vitest run packages/shell/test/broker/broker-checks.test.ts` → fails: module not found.

- [ ] **Step 3: Move the code.** Cut from `plugin-broker.ts` into `broker/broker-checks.ts`, verbatim (same comments), and export each: `BROKER_LIMITS`, `CONTROLS`, `CONTROLS_BUT_NEWLINE`, `class Malformed`, `fail`, `isPlainObject`, `checkBudget`, `checkJson`, `record`, `str`, `dataKey`, `visible`, `onlyKeys`, `class Slots`, `withKey`, `query`, `records`, `fetchRequest`, `oneLine`. The file header:

```ts
/**
 * The core broker's argument rules (tools spec §4.2; plugins threat model B6, B11), shared by every caller of the
 * broker (plugins, and tools from slice 2): every value a sandboxed caller sends is checked here before any dependency
 * sees it. Pure: no Electron, no file system. A failed check throws `Malformed`, whose message names the problem,
 * never the values.
 */
import type { FetchRequest } from "../plugin-fetch";
```

In `plugin-broker.ts`, replace the moved definitions with one import, and keep `export { BROKER_LIMITS }` (re-export) so `plugin-cli.ts` and `plugins.ts` still import it from `./plugin-broker`:

```ts
import { BROKER_LIMITS, Malformed, Slots, checkBudget, checkJson, dataKey, fail, fetchRequest, isPlainObject, onlyKeys, oneLine, query, record, records, str, visible, withKey } from "./broker/broker-checks";
export { BROKER_LIMITS } from "./broker/broker-checks";
```
(Import exactly the names the remaining code uses; `ATTENTION_KEY`, `SEVERITIES`, `LEVELS`, `ENDED`, `attentionKey`, `severity`, `chipValue`, `logLevel`, `ok` stay in `plugin-broker.ts`: they are the plugin's or move in Task 2.)

- [ ] **Step 4: Run.** The new test passes; `corepack pnpm vitest run packages/shell/test/plugin-broker.test.ts packages/shell/test/plugin-fixture-mode.test.ts packages/shell/test/plugin-cli-entry.test.ts packages/shell/test/plugins-controller.test.ts` all pass unchanged. Then `corepack pnpm typecheck`.

- [ ] **Step 5: Frozen check.** The frozen-list `git diff --stat` (Conventions) prints nothing.

- [ ] **Step 6: Commit.**

```bash
git -C <worktree> add packages/shell/src/main/broker/broker-checks.ts packages/shell/test/broker/broker-checks.test.ts
git -C <worktree> commit --only packages/shell/src/main/broker/broker-checks.ts packages/shell/src/main/plugin-broker.ts packages/shell/test/broker/broker-checks.test.ts -m "refactor(shell): the broker's argument checks move to broker/broker-checks" -m "<trailer>"
```

---

### Task 2: The core `Broker`; `PluginBroker` becomes its plugin adapter

**Files:**
- Create: `packages/shell/src/main/broker/broker.ts`
- Modify: `packages/shell/src/main/plugin-broker.ts`
- Test: `packages/shell/test/broker/broker.test.ts` (new)

The core broker takes what a caller may reach as data. The plugin adapter builds that data from its manifest, with the same refusal texts as today.

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/shell/test/broker/broker.test.ts
import { describe, expect, it } from "vitest";
import { Broker, type BrokerGrant, CORE_CALLS } from "../../src/main/broker/broker";

const grant: BrokerGrant = {
  hosts: ["api.example.com"],
  secrets: ["jira"],
  exec: [{ cmd: "gh", args: ["pr", "checks", "*"] }],
  collection: (name, write) => name === "tickets" && !write,
  refusals: {
    collection: "The collection is not declared in uses.data",
    secret: (id) => `The key "${id}" is not declared in uses.secrets`,
    exec: (line) => `${line} is not declared in uses.exec`,
  },
};
const SECRET = "tok-SECRET-1234";

function core(over: Partial<ConstructorParameters<typeof Broker>[0]> = {}) {
  const seen = { fetches: [] as { url: string; init: RequestInit }[], data: [] as unknown[], logs: [] as unknown[], secretIds: [] as string[][], exec: [] as unknown[] };
  const b = new Broker({
    grant,
    calls: ["fetch", "exec", "data.get", "data.query", "data.put", "log"],
    data: { run: async (op) => (seen.data.push(op), null) },
    secrets: async (ids) => (seen.secretIds.push(ids), { jira: SECRET }),
    log: async (level, message) => void seen.logs.push([level, message]),
    fetch: (async (url: string, init: RequestInit) => (seen.fetches.push({ url, init }), new Response("ok"))) as unknown as typeof fetch,
    exec: { resolve: async () => "/bin/gh", run: async (file, args) => (seen.exec.push({ file, args }), { code: 0, stdout: "out", stderr: "" }), cwd: async () => "/c", env: async () => ({ PATH: "/bin" }) },
    ended: "This call has ended",
    ...over,
  } as never);
  return { b, seen };
}

describe("Broker (tools spec §4.2: the core service)", () => {
  it("CORE_CALLS is the generic surface: fetch, exec, data.*, log", () => {
    expect([...CORE_CALLS].sort()).toEqual(["data.delete", "data.get", "data.patch", "data.put", "data.query", "data.replaceAll", "exec", "fetch", "log"]);
  });
  it("a call outside the caller's `calls` is refused as unknown, even when it is a core call", async () => {
    const { b } = core();
    const run = b.startRun("t");
    expect(await b.call(run.id, "data.delete", ["tickets"])).toMatchObject({ ok: false, refused: expect.stringMatching(/unknown/i) });
  });
  it("a dead run answers the owner's ended text", async () => {
    const { b } = core();
    expect(await b.call("nope", "log", ["info", "x"])).toEqual({ ok: false, refused: "This call has ended" });
  });
  it("fetch: only granted hosts; only granted secrets, named by the grant's refusal", async () => {
    const { b, seen } = core();
    const run = b.startRun("t");
    expect(await b.call(run.id, "fetch", ["https://evil.example.org/x"])).toMatchObject({ ok: false });
    expect(await b.call(run.id, "fetch", ["https://api.example.com/x", { headers: { a: "{{secret:other}}" } }])).toEqual({ ok: false, refused: 'The key "other" is not declared in uses.secrets' });
    expect(seen.secretIds).toEqual([]);
    expect(await b.call(run.id, "fetch", ["https://api.example.com/x", { headers: { a: "{{secret:jira}}" } }])).toMatchObject({ ok: true });
    expect(seen.secretIds).toEqual([["jira"]]);
  });
  it("exec: only granted patterns, refused with the grant's text", async () => {
    const { b, seen } = core();
    const run = b.startRun("t");
    expect(await b.call(run.id, "exec", ["gh", ["repo", "delete", "x"]])).toEqual({ ok: false, refused: "gh repo delete x is not declared in uses.exec" });
    expect(seen.exec).toEqual([]);
    expect(await b.call(run.id, "exec", ["gh", ["pr", "checks", "12"]])).toMatchObject({ ok: true });
  });
  it("data: the grant decides each collection and whether it may be written", async () => {
    const { b, seen } = core();
    const run = b.startRun("t");
    expect(await b.call(run.id, "data.get", ["tickets"])).toEqual({ ok: true, value: null });
    expect(await b.call(run.id, "data.put", ["tickets", { key: "a" }])).toMatchObject({ ok: false, refused: expect.stringContaining("uses.data") });
    expect(await b.call(run.id, "data.get", ["other"])).toMatchObject({ ok: false });
    expect(seen.data).toHaveLength(1);
  });
  it("extra handlers from the owner join the surface under their names", async () => {
    const { b } = core({ calls: ["log", "settings.get"], extra: new Map([["settings.get", { max: 0, fn: async () => ({ ok: true as const, value: { a: 1 } }) }]]) });
    const run = b.startRun("t");
    expect(await b.call(run.id, "settings.get", [])).toEqual({ ok: true, value: { a: 1 } });
  });
  it("transport(key) replaces fetch and the runner after every check (fixture mode)", async () => {
    const fx = (async () => new Response("fixture")) as unknown as typeof fetch;
    const { b, seen } = core({ transport: () => ({ fetch: fx, run: async () => ({ code: 0, stdout: "fx", stderr: "" }) }) });
    const run = b.startRun("t");
    const r = await b.call(run.id, "fetch", ["https://api.example.com/x"]);
    expect(r).toMatchObject({ ok: true, value: { text: "fixture" } });
    expect(seen.fetches).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to see them fail.** `corepack pnpm vitest run packages/shell/test/broker/broker.test.ts` → module not found.

- [ ] **Step 3: Write `broker/broker.ts`.** Move from `plugin-broker.ts` the run bookkeeping, `call`, `refuseMalformed`, `log`, `data`, `limited`, `fetch`, `transportOf`, `exec` into `Broker`, replacing every `this.d.manifest…` read with the grant:

```ts
import { randomUUID } from "node:crypto";
import { type PluginPermissions, execAllowed, secretRefs } from "@humanharness/harness-sdk";

type ExecPattern = PluginPermissions["exec"][number];
import { pluginExec, type runFile } from "../plugin-exec";
import { pluginFetch } from "../plugin-fetch";
import { BROKER_LIMITS, Malformed, Slots, checkBudget, dataKey, fail, fetchRequest, oneLine, query, record, records, str, withKey } from "./broker-checks";

/**
 * The core broker (tools spec §4.2, D7): every `ctx` call of sandboxed code (a plugin's backend; a tool from slice 2)
 * lands here. One Broker per caller identity, built by its owner with what that caller may reach (`BrokerGrant`): the
 * broker never takes an identity or a permission from the call. A refusal is an answer, never a throw.
 */

/** The generic calls. An owner passes the subset its callers get, plus its own handlers (`extra`). */
export const CORE_CALLS: ReadonlySet<string> = new Set(["fetch", "exec", "data.get", "data.query", "data.put", "data.patch", "data.delete", "data.replaceAll", "log"]);

export type BrokerAnswer = { ok: true; value: unknown } | { ok: false; refused: string };

export type BrokerDataOp =
  | { op: "get" | "delete"; collection: string; key?: string | number }
  | { op: "query"; collection: string; query: { where?: Record<string, unknown>; fields?: string[]; limit?: number } }
  | { op: "put"; collection: string; record: Record<string, unknown> }
  | { op: "patch"; collection: string; key?: string | number; patch: Record<string, unknown> }
  | { op: "replaceAll"; collection: string; records: Record<string, unknown>[] };

/** What one caller may reach, and how a refusal names where it would have to be declared. */
export interface BrokerGrant {
  hosts: readonly string[];
  /** Secret ids the caller may name as `{{secret:<id>}}`. Only these are ever asked of `secrets`. */
  secrets: readonly string[];
  exec: readonly ExecPattern[];
  /** May the caller name `collection` (for a write when `write`)? Must be own-property safe (`Object.hasOwn`). */
  collection(name: string, write: boolean): boolean;
  refusals: { collection: string; secret(id: string): string; exec(line: string): string };
}

/** One live run of a caller: what its calls carry. `key` is the owner's (a plugin's source; a tool call's id). */
export interface BrokerRun {
  key: string;
  controller: AbortController;
  writes: number;
}

export type BrokerHandler = (run: BrokerRun, args: unknown[]) => Promise<BrokerAnswer>;

export interface CoreBrokerDeps {
  grant: BrokerGrant;
  /** The calls this caller gets: core ones from CORE_CALLS and the owner's `extra` names. */
  calls: readonly string[];
  extra?: ReadonlyMap<string, { max: number; fn: BrokerHandler }>;
  data: { run(op: BrokerDataOp): Promise<unknown> };
  /** The stored values of `ids`, which are always granted ones. */
  secrets(ids: string[]): Promise<Record<string, string>>;
  /** May reject; the broker swallows it. One line, uncut (the receiver hides keys, then cuts). */
  log(level: "info" | "warn" | "error", message: string): Promise<void>;
  fetch: typeof fetch;
  allowHost?: (hostname: string) => Promise<boolean>;
  exec: { resolve(cmd: string): Promise<string | null>; run: typeof runFile; cwd(): Promise<string>; env(): Promise<Record<string, string>> };
  /** Fixture or mock mode: the transport of a run's key, after every check. */
  transport?(key: string): { fetch: typeof fetch; run: typeof runFile };
  /** What a dead run's call answers ("This sync run has ended" for plugins). */
  ended: string;
}
```

The `Broker` class body is the moved code with these substitutions (keep every comment):
- `this.d.manifest.permissions.hosts` → `this.d.grant.hosts`;
- the undeclared-secret refusal → `this.d.grant.refusals.secret(undeclared)` with `declared = new Set(this.d.grant.secrets)`;
- `this.d.manifest.permissions.exec` → `this.d.grant.exec`; the exec refusal → `this.d.grant.refusals.exec(line)` where `line = [c, ...list].join(" ").slice(0, 200)`;
- the collection check (`collection(v)`) → `if (typeof v !== "string" || !this.d.grant.collection(v, write)) fail(this.d.grant.refusals.collection)`;
- `ENDED` → `this.d.ended`;
- handler table: build the core handlers (`fetch`, `exec`, `data.*`, `log`) as in today's constructor, then `new Map([...core, ...(this.d.extra ?? [])].filter(([name]) => this.d.calls.includes(name)))`. `call` refuses a name not in that map as today ("Unknown call").
- `startRun(key: string)`: no declaration check (the owner checks before calling); returns `{ id, signal }`. `endRun`, `killAll` unchanged.
- `transportOf(run)` → `this.d.transport?.(run.key) ?? { fetch: this.d.fetch, run: this.d.exec.run }`.

- [ ] **Step 4: Make `PluginBroker` the adapter.** In `plugin-broker.ts`, keep `BROKER_CALLS`, `PluginAttentionInput`, `BrokerDeps` (unchanged shape), re-export `BrokerAnswer` and `BrokerDataOp` from `./broker/broker`, and replace the class body:

```ts
export type { BrokerAnswer, BrokerDataOp } from "./broker/broker";

export class PluginBroker {
  private readonly core: Broker;

  constructor(private readonly d: BrokerDeps) {
    const m = d.manifest;
    const extra = new Map<string, { max: number; fn: BrokerHandler }>([
      ["settings.get", { max: 0, fn: async () => ({ ok: true, value: await d.settings() }) }],
      ["attention.raise", { max: 1, fn: async (_run, [item]) => ok(await d.attention.raise(this.attentionItem(item))) }],
      ["attention.resolve", { max: 1, fn: async (_run, [key]) => ok(await d.attention.resolve(attentionKey(key))) }],
      ["chip.set", { max: 2, fn: async (_run, [id, chip]) => ok(d.chips(this.chipId(id), chipValue(chip))) }],
      ["chip.clear", { max: 1, fn: async (_run, [id]) => ok(d.chips(this.chipId(id), null)) }],
    ]);
    this.core = new Broker({
      grant: {
        hosts: m.permissions.hosts,
        secrets: m.permissions.secrets.map((s) => s.id),
        exec: m.permissions.exec,
        // A plugin reads and writes only its own collections (B4): any declared one, either way.
        collection: (name) => Object.hasOwn(m.data, name),
        refusals: {
          collection: "The collection is not declared in plugin.json data",
          secret: (id) => `The key "${id}" is not declared in permissions.secrets`,
          exec: (line) => `${line} is not declared in permissions.exec`,
        },
      },
      calls: [...BROKER_CALLS],
      extra,
      data: d.data,
      secrets: d.secrets,
      log: d.log,
      fetch: d.fetch,
      ...(d.allowHost ? { allowHost: d.allowHost } : {}),
      exec: d.exec,
      ...(d.transport ? { transport: d.transport } : {}),
      ended: ENDED,
    });
  }

  /** A run of a declared source: its id is what every `ctx` call must carry. */
  startRun(source: string): { id: string; signal: AbortSignal } {
    if (!this.d.manifest.sources.some((s) => s.id === source)) throw new Error(`The source ${String(source)} is not declared`);
    return this.core.startRun(source);
  }
  endRun(id: string): { writes: number } {
    return this.core.endRun(id);
  }
  killAll(): void {
    this.core.killAll();
  }
  call(runId: unknown, name: unknown, args: unknown): Promise<BrokerAnswer> {
    return this.core.call(runId, name, args);
  }
  // attentionItem, target, chipId: unchanged (they read this.d.manifest).
}
```
`BrokerDeps.transport?(source)` keeps its name: the core calls it with the run's key, which for plugins is the source id.

- [ ] **Step 5: Run.** `packages/shell/test/broker/broker.test.ts` passes; then every plugin test in the frozen list passes unchanged: `corepack pnpm vitest run packages/shell/test/plugin-broker.test.ts packages/shell/test/plugin-fixture-mode.test.ts packages/shell/test/plugin-cli-entry.test.ts packages/shell/test/plugins-controller.test.ts packages/shell/test/plugin-host.test.ts packages/cli/test/plugin-test.test.ts packages/cli/test/plugin-record.test.ts`. `plugin-cli-entry.test.ts` walks into `broker/broker.ts` and `broker/broker-checks.ts`: neither imports Electron. Then `corepack pnpm typecheck`.

- [ ] **Step 6: Frozen check** (the `git diff --stat` above prints nothing).

- [ ] **Step 7: Commit.**

```bash
git -C <worktree> add packages/shell/src/main/broker/broker.ts packages/shell/test/broker/broker.test.ts
git -C <worktree> commit --only packages/shell/src/main/broker/broker.ts packages/shell/src/main/plugin-broker.ts packages/shell/test/broker/broker.test.ts -m "refactor(shell): the broker becomes a core service; PluginBroker adapts it for plugins" -m "<trailer>"
```

---

### Task 3: The secret store moves to `secrets/`, and gains the harness's keys

**Files:**
- Create: `packages/shell/src/main/secrets/secret-store.ts`, `packages/shell/src/main/secrets/safe-storage.ts`
- Modify: `packages/shell/src/main/plugin-secrets.ts`, `packages/shell/src/main/plugin-ipc.ts`
- Test: `packages/shell/test/secrets/secret-store.test.ts` (new)

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/shell/test/secrets/secret-store.test.ts
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HARNESS_SECRETS_OWNER, SecretStore, secretName } from "../../src/main/secrets/secret-store";

/** Reversible, never the Keychain. */
const crypto = {
  available: () => true,
  encrypt: (t: string) => Buffer.from(`enc:${Buffer.from(t).toString("hex")}`),
  decrypt: (b: Buffer) => Buffer.from(b.toString().slice(4), "hex").toString(),
};
const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "hh-sec-"));

describe("SecretStore: the harness's keys (tools spec §9)", () => {
  it("logical names: <id> for the harness, plugin.<plugin>.<id> for a plugin", () => {
    expect(secretName("harness", "jira")).toBe("jira");
    expect(secretName({ plugin: "oncall" }, "jira")).toBe("plugin.oncall.jira");
  });
  it("stores under _harness/<id>.bin, encrypted, 0600 in a 0700 folder, and reads back", async () => {
    const dir = path.join(await tmp(), "secrets");
    const s = new SecretStore(dir, crypto);
    expect(await s.setHarness("jira", "  tok-123456789  ")).toEqual({ ok: true });
    const file = path.join(dir, HARNESS_SECRETS_OWNER, "jira.bin");
    expect((await fs.readFile(file)).toString()).not.toContain("tok-123456789");
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(path.join(dir, HARNESS_SECRETS_OWNER))).mode & 0o777).toBe(0o700);
    expect(await s.storedHarness()).toEqual(["jira"]);
    expect(await s.harnessValues(["jira", "nope"])).toEqual({ jira: "tok-123456789" });
  });
  it("a plugin can't read the harness's keys, nor the other way", async () => {
    const s = new SecretStore(path.join(await tmp(), "s"), crypto);
    await s.setHarness("jira", "tok-HARNESS-1");
    await s.set("oncall", "jira", "tok-PLUGIN-22");
    expect(await s.values("oncall", ["jira"])).toEqual({ jira: "tok-PLUGIN-22" });
    expect(await s.harnessValues(["jira"])).toEqual({ jira: "tok-HARNESS-1" });
    expect(await s.stored("_harness")).toEqual([]);
    expect(await s.set("_harness", "jira", "tok-PLUGIN-22")).toMatchObject({ ok: false });
  });
  it("harness keys refuse to store without encryption, and create nothing", async () => {
    const root = await tmp();
    const s = new SecretStore(path.join(root, "s"), { ...crypto, available: () => false });
    expect(await s.setHarness("jira", "tok-123456789")).toEqual({ ok: false, message: "This computer can't encrypt keys for this app" });
    expect(await fs.readdir(root)).toEqual([]);
  });
  it("refuses bad ids and values as plugin keys do", async () => {
    const s = new SecretStore(path.join(await tmp(), "s"), crypto);
    for (const id of ["../x", "__proto__", "Jira", "a/b", ""]) expect(await s.setHarness(id, "tok-123456789")).toMatchObject({ ok: false });
    expect(await s.setHarness("jira", "short")).toEqual({ ok: false, message: "A key is at least 8 characters" });
  });
  it("deleteHarness removes one key; D0: nothing is created before the first key", async () => {
    const root = await tmp();
    const s = new SecretStore(path.join(root, "s"), crypto);
    expect(await s.storedHarness()).toEqual([]);
    await s.deleteHarness("jira");
    await expect(fs.access(path.join(root, "s"))).rejects.toThrow();
    await s.setHarness("jira", "tok-123456789");
    await s.deleteHarness("jira");
    expect(await s.storedHarness()).toEqual([]);
  });
  it("a linked _harness folder reads as no keys and is never written through", async () => {
    const root = await tmp();
    const dir = path.join(root, "s");
    await fs.mkdir(dir, { mode: 0o700 });
    const elsewhere = path.join(root, "elsewhere");
    await fs.mkdir(elsewhere);
    await fs.symlink(elsewhere, path.join(dir, HARNESS_SECRETS_OWNER));
    const s = new SecretStore(dir, crypto);
    expect(await s.storedHarness()).toEqual([]);
    expect(await s.setHarness("jira", "tok-123456789")).toMatchObject({ ok: false });
    expect(await fs.readdir(elsewhere)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to see them fail** (module not found).

- [ ] **Step 3: Move and extend.** Move the whole of `plugin-secrets.ts` into `secrets/secret-store.ts` verbatim. Then:
  - `export const HARNESS_SECRETS_OWNER = "_harness";` (comment: "The folder of the harness's own keys (tools spec §9): no plugin id can start with `_`, so it never meets a plugin's folder.");
  - `export type SecretOwner = "harness" | { plugin: string };` and `export const secretName = (owner: SecretOwner, id: string): string => (owner === "harness" ? id : `plugin.${owner.plugin}.${id}`);`
  - rename the private `folder(plugin, create)` to `folderOf(owner: string, create)` whose id check is `owner === HARNESS_SECRETS_OWNER || PLUGIN_ID.test(owner)`; the public plugin methods (`stored`, `set`, `delete`, `deleteAll`, `values`) keep their names and still refuse any `plugin` that fails `PLUGIN_ID` before reaching `folderOf` (so `_harness` is never a plugin);
  - `validIds(plugin, id)` stays for plugins; add `validHarnessId(id) => typeof id === "string" && PLUGIN_LOCAL_ID.test(id)`;
  - the harness methods share the private bodies:

```ts
  /** The ids of the harness's own keys (tools spec §9), sorted. Never their values. */
  storedHarness(): Promise<string[]> {
    return this.storedIn(HARNESS_SECRETS_OWNER);
  }
  setHarness(id: string, value: string): Promise<SecretResult> {
    if (!validHarnessId(id)) return Promise.resolve({ ok: false, message: "This key can't be stored" });
    return this.setIn(HARNESS_SECRETS_OWNER, id, value);
  }
  async deleteHarness(id: string): Promise<void> {
    if (!validHarnessId(id)) return;
    await this.deleteIn(HARNESS_SECRETS_OWNER, id);
  }
  /** The decrypted values of `ids` (slice 2's tool broker only). Missing or unreadable: absent. */
  harnessValues(ids: readonly string[]): Promise<Record<string, string>> {
    return this.valuesIn(HARNESS_SECRETS_OWNER, ids.filter(validHarnessId));
  }
```
  where `storedIn`, `setIn`, `deleteIn`, `valuesIn` are today's `stored`, `set`, `delete`, `values` bodies with `plugin` renamed `owner`, and the public plugin methods call them after the `validIds` check. Log lines keep `[plugins] ${plugin}` for plugin owners and say `[secrets] harness` for the harness owner (so no plugin test's console expectation changes).
  - `plugin-secrets.ts` becomes:

```ts
/** The plugins' keys now live in the core secret store (tools spec §9); this path stays for plugin code and tests. */
export { SECRET_MAX, SECRET_MIN, type SecretCrypto, type SecretResult, SecretStore } from "./secrets/secret-store";
```
  - Move `safeStorageCrypto` (and its comment) from `plugin-ipc.ts` to `secrets/safe-storage.ts` (importing `SecretCrypto` from `./secret-store`); in `plugin-ipc.ts` replace it with `export { safeStorageCrypto } from "./secrets/safe-storage";` and change its `SecretCrypto` import to `./secrets/secret-store` if still used.

- [ ] **Step 4: Run.** The new tests pass; `plugin-secrets.test.ts`, `plugin-ipc.test.ts`, `plugins-controller.test.ts` pass unchanged; `corepack pnpm typecheck`.

- [ ] **Step 5: Frozen check.**

- [ ] **Step 6: Commit.**

```bash
git -C <worktree> add packages/shell/src/main/secrets/secret-store.ts packages/shell/src/main/secrets/safe-storage.ts packages/shell/test/secrets/secret-store.test.ts
git -C <worktree> commit --only packages/shell/src/main/secrets/secret-store.ts packages/shell/src/main/secrets/safe-storage.ts packages/shell/src/main/plugin-secrets.ts packages/shell/src/main/plugin-ipc.ts packages/shell/test/secrets/secret-store.test.ts -m "refactor(shell): the secret store becomes a core service with the harness's own keys" -m "<trailer>"
```

---

### Task 4: `secrets` in the manifest and the `connect` setup step

**Files:**
- Create: `packages/harness-sdk/src/secrets.ts`
- Modify: `packages/harness-sdk/src/setup.ts`, `packages/harness-sdk/src/index.ts`
- Test: `packages/harness-sdk/test/secrets.test.ts` (new), `packages/harness-sdk/test/setup.test.ts` (append)

- [ ] **Step 1: Write the failing tests.** Use the `base` manifest helper the other harness-sdk tests use (copy the minimal manifest from `hatches.test.ts`).

```ts
// packages/harness-sdk/test/secrets.test.ts
import { describe, expect, it } from "vitest";
import { defineHarness, hasSecrets } from "../src";

const base = {
  id: "t", name: "T", core: "^0.1.0", engines: ["claude"], folder: { suggested: "Documents/T" }, instructions: "./AGENTS.md",
  permissions: { edit: "folder" as const, exec: false, web: true }, blocks: {}, author: "x",
};
const jira = { id: "jira", label: "Jira API token", help: "Create one at id.atlassian.com → Security → API tokens." };

describe("secrets (tools spec §9)", () => {
  it("D0: no secrets key without it", () => {
    const h = defineHarness(base);
    expect("secrets" in h).toBe(false);
    expect(hasSecrets(h)).toBe(false);
  });
  it("takes a list of declared keys", () => {
    expect(defineHarness({ ...base, secrets: [jira] }).secrets).toEqual([jira]);
  });
  it("refuses bad ids, duplicates, long labels, unknown fields and more than 10", () => {
    for (const s of [[{ ...jira, id: "Jira" }], [{ ...jira, id: "1jira" }], [jira, jira], [{ ...jira, label: "x".repeat(81) }], [{ ...jira, extra: 1 }], Array.from({ length: 11 }, (_, i) => ({ id: `k${i}`, label: "K" }))]) {
      expect(() => defineHarness({ ...base, secrets: s } as never)).toThrow();
    }
  });
  it("refuses a hidden character or a line break in a label or help", () => {
    expect(() => defineHarness({ ...base, secrets: [{ ...jira, label: "Jira‮" }] })).toThrow();
    expect(() => defineHarness({ ...base, secrets: [{ ...jira, help: "a\nb" }] })).toThrow();
  });
});

describe("the connect setup step (tools spec §9)", () => {
  const connect = { id: "jira", kind: "connect" as const, label: "Connect Jira", secrets: ["jira"] };
  it("names declared secrets", () => {
    const h = defineHarness({ ...base, secrets: [jira], setup: [connect] });
    expect(h.setup?.[0]).toMatchObject({ kind: "connect", secrets: ["jira"], required: false });
  });
  it("refuses an undeclared secret, an empty list and a secret listed twice", () => {
    expect(() => defineHarness({ ...base, secrets: [jira], setup: [{ ...connect, secrets: ["github"] }] })).toThrow(/"github" is not declared in secrets/);
    expect(() => defineHarness({ ...base, secrets: [jira], setup: [{ ...connect, secrets: [] }] })).toThrow();
    expect(() => defineHarness({ ...base, secrets: [jira], setup: [{ ...connect, secrets: ["jira", "jira"] }] })).toThrow(/listed twice/);
  });
  it("a connect step needs secrets in the manifest", () => {
    expect(() => defineHarness({ ...base, setup: [connect] })).toThrow(/declare secrets/);
  });
});
```
(Ids follow the plugin key id pattern `^[a-z][a-z0-9_-]{0,39}$`.)

Append to `setup.test.ts`: "the setup step kinds are form, interview, component and connect" (`setupStepSchema.options.map((o) => o.shape.kind.value).sort()`).

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**

```ts
// packages/harness-sdk/src/secrets.ts
import { z } from "zod";
import { HIDDEN_CHARS, PLUGIN_LOCAL_ID } from "./plugin";

/** The most keys a harness declares (as a plugin's `permissions.secrets`). */
export const SECRETS_MAX = 10;
const HIDDEN = new RegExp(HIDDEN_CHARS.source, "u");
/** One English line the person reads in Settings › Connections: no line break, no hidden character. */
const shown = (max: number) => z.string().min(1).max(max).refine((t) => !/[\r\n]/.test(t) && !HIDDEN.test(t), { message: "One line, without hidden characters" });

/** A key the person pastes for the harness's tools (tools spec §9, D9). Its value never reaches a renderer or a tool. */
export const harnessSecretSchema = z.strictObject({ id: z.string().regex(PLUGIN_LOCAL_ID), label: shown(80), help: shown(200).optional() });
export type HarnessSecret = z.output<typeof harnessSecretSchema>;

export const secretsSchema = z
  .array(harnessSecretSchema)
  .min(1)
  .max(SECRETS_MAX)
  .refine((list) => new Set(list.map((s) => s.id)).size === list.length, { message: "Each secret id is declared once" });

/** The harness declares secrets. False: no Connections tab, no channel, no harness key folder (D0). */
export const hasSecrets = (h: { secrets?: readonly unknown[] }): boolean => (h.secrets?.length ?? 0) > 0;
```

In `setup.ts`, add the fourth member of the union:

```ts
  z.object({
    ...common,
    kind: z.literal("connect"),
    /** The declared secrets this step asks for (tools spec §9). A test tool comes with slice 2. */
    secrets: z.array(z.string().min(1)).min(1).max(10),
  }),
```

In `index.ts`: `export * from "./secrets";`, add `secrets: secretsSchema.optional(),` to `manifestSchema` (after `plugins`/`slots`, with a one-line comment "Keys the person pastes for the harness's tools (tools spec §9). Absent: none (D0)."), and in the setup-steps loop of the `superRefine` add before the component branch:

```ts
    if (s.kind === "connect") {
      if (!m.secrets) return issue(["secrets"], "A connect step asks for the harness's secrets: declare secrets");
      const seen = new Set<string>();
      for (const id of s.secrets) {
        if (seen.has(id)) issue(["secrets"], `"${id}" is listed twice`);
        seen.add(id);
        if (!m.secrets.some((x) => x.id === id)) issue(["secrets"], `"${id}" is not declared in secrets`);
      }
      return;
    }
```
Check every exhaustive `switch`/`if` over `HarnessSetupStep["kind"]` in the repo (`/usr/bin/grep -rn "kind === \"component\"\|s.kind ===" packages/harness-sdk/src packages/shell/src packages/cli/src packages/ui/src`): the ones that would now mishandle `connect` are fixed in Tasks 6 and 9; `typecheck` names any other.

- [ ] **Step 4: Run** the two test files, then `corepack pnpm typecheck` (expect errors only in the places Tasks 6–9 change; if `typecheck` fails here, make the minimal type-only fix — e.g. `setupStepViews` returning `{ ...base, secrets: s.secrets }` for connect — and say so; Task 6 adds its test).

- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/harness-sdk/src/secrets.ts packages/harness-sdk/test/secrets.test.ts
git -C <worktree> commit --only packages/harness-sdk/src/secrets.ts packages/harness-sdk/src/setup.ts packages/harness-sdk/src/index.ts packages/harness-sdk/test/secrets.test.ts packages/harness-sdk/test/setup.test.ts -m "feat(sdk): harness secrets and the connect setup step" -m "<trailer>"
```

---

### Task 5: `ConnectionsController`, its channels, one shared store

**Files:**
- Create: `packages/shell/src/main/secrets/connections.ts`, `packages/shell/src/main/secrets/connections-ipc.ts`
- Modify: `packages/shell/src/main/index.ts`
- Test: `packages/shell/test/secrets/connections.test.ts`, `packages/shell/test/secrets/connections-ipc.test.ts`, `packages/shell/test/connections-surface.test.ts` (new)

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/shell/test/secrets/connections.test.ts
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConnectionsController, missingSecretMessage } from "../../src/main/secrets/connections";
import { SecretStore } from "../../src/main/secrets/secret-store";

const crypto = { available: () => true, encrypt: (t: string) => Buffer.from(`enc:${Buffer.from(t).toString("hex")}`), decrypt: (b: Buffer) => Buffer.from(b.toString().slice(4), "hex").toString() };
const secrets = [{ id: "jira", label: "Jira API token", help: "Create one at id.atlassian.com." }, { id: "gh", label: "GitHub token" }];
async function ctl() {
  const store = new SecretStore(path.join(await fs.mkdtemp(path.join(os.tmpdir(), "hh-conn-")), "s"), crypto);
  const changes: unknown[] = [];
  return { c: new ConnectionsController({ secrets, store, changed: (v) => changes.push(v) }), store, changes };
}

describe("ConnectionsController (tools spec §9: Settings › Connections)", () => {
  it("lists every declared secret in manifest order, not set", async () => {
    const { c } = await ctl();
    expect(await c.view()).toEqual({ connections: [{ id: "jira", label: "Jira API token", help: "Create one at id.atlassian.com.", set: false }, { id: "gh", label: "GitHub token", set: false }] });
  });
  it("set and delete change only the state, push the view, and no value in the view or any answer", async () => {
    const { c, changes } = await ctl();
    const r = await c.set("jira", "tok-SECRET-123456");
    expect(r).toEqual({ ok: true });
    const view = await c.view();
    expect(view.connections[0].set).toBe(true);
    expect(JSON.stringify([view, r, changes])).not.toContain("tok-SECRET-123456");
    await c.delete("jira");
    expect((await c.view()).connections[0].set).toBe(false);
    expect(changes).toHaveLength(2);
  });
  it("an undeclared id is refused and stores nothing", async () => {
    const { c, store } = await ctl();
    expect(await c.set("other", "tok-123456789")).toEqual({ ok: false, message: "This harness declares no such key" });
    expect(await store.storedHarness()).toEqual([]);
  });
  it("a store refusal comes back as its message (short, multi-line, no encryption)", async () => {
    const { c } = await ctl();
    expect(await c.set("jira", "short")).toEqual({ ok: false, message: "A key is at least 8 characters" });
  });
  it("allSet tells whether every listed id is stored", async () => {
    const { c } = await ctl();
    await c.set("jira", "tok-123456789");
    expect(await c.allSet(["jira"])).toBe(true);
    expect(await c.allSet(["jira", "gh"])).toBe(false);
  });
  it("missingSecretMessage names the label and where to set it", () => {
    expect(missingSecretMessage("Jira API token")).toBe("Jira API token is not set — Settings › Connections");
  });
});
```

```ts
// packages/shell/test/secrets/connections-ipc.test.ts — registerConnectionsIpc with a recording `handle`
// "registers exactly CONNECTIONS_IPC_CHANNELS"
// "undeclared, too long or non-string ids are refused": hh:connectionsSet(42, "x"), ("a".repeat(41), "tok-123456789"), ("jira", 42), ("jira", "x".repeat(8193 * 4 + 1)) → { ok: false, message: "Invalid request" } and the controller is never called
// "a controller that rejects answers a fixed refusal": set rejects → { ok: false, message: "Something went wrong" }; get rejects → null
```
(Write these three as full `it`s in the style of `plugin-ipc.test.ts`: a `handle` double that stores the functions, a controller double that records calls.)

```ts
// packages/shell/test/connections-surface.test.ts
// "D0: connections channels are registered only under hasSecrets": index.ts contains exactly one
//   `registerConnectionsIpc(` call, inside `if (hasSecrets(harness))`; no other main file names "hh:connections".
// "D0: the SecretStore is built only for plugins or secrets": index.ts has exactly one `new SecretStore(`; it is
//   reached only through `secretStore()`, whose body starts with
//   `if (!pluginsAccepted(harness) && (hooks.pluginDirs?.length ?? 0) === 0 && !hasSecrets(harness)) return null;`
```
(Use the `group()` and `count()` helpers of `hatches-surface.test.ts`, copied, not imported — that file is frozen.)

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement `connections.ts`.**

```ts
import type { HarnessSecret } from "@humanharness/harness-sdk";
import type { ConnectionResult, ConnectionsView } from "@humanharness/ui/client";
import type { SecretStore } from "./secret-store";

/** What a tool's call says when a key it needs isn't stored (tools spec §9, §10). Used by slice 2's tool broker. */
export const missingSecretMessage = (label: string): string => `${label} is not set — Settings › Connections`;

export interface ConnectionsDeps {
  /** The manifest's `secrets`. */
  secrets: readonly HarnessSecret[];
  store: Pick<SecretStore, "storedHarness" | "setHarness" | "deleteHarness">;
  /** Tells the window (hh:connectionsChange). */
  changed(view: ConnectionsView): void;
  log?(message: string, err?: unknown): void;
}

/**
 * Settings › Connections and the connect step in main (tools spec §9). Values go in through `set` and never come
 * out: the view says only whether each declared key is stored (S1). Only declared ids are touched (S3).
 */
export class ConnectionsController {
  constructor(private readonly d: ConnectionsDeps) {}

  async view(): Promise<ConnectionsView> {
    const stored = new Set(await this.d.store.storedHarness().catch(() => [] as string[]));
    return { connections: this.d.secrets.map((s) => ({ id: s.id, label: s.label, ...(s.help ? { help: s.help } : {}), set: stored.has(s.id) })) };
  }

  async set(id: string, value: string): Promise<ConnectionResult> {
    if (!this.declared(id)) return { ok: false, message: "This harness declares no such key" };
    const out = await this.d.store.setHarness(id, value).catch((err: unknown) => {
      this.log("Could not store a key", err);
      return { ok: false as const, message: "This key can't be stored" };
    });
    if (out.ok) await this.push();
    return out;
  }

  async delete(id: string): Promise<ConnectionResult> {
    if (!this.declared(id)) return { ok: false, message: "This harness declares no such key" };
    await this.d.store.deleteHarness(id);
    await this.push();
    return { ok: true };
  }

  /** Every id in `ids` is stored (a connect step's Next). */
  async allSet(ids: readonly string[]): Promise<boolean> {
    const stored = new Set(await this.d.store.storedHarness().catch(() => [] as string[]));
    return ids.every((id) => stored.has(id));
  }

  private declared(id: unknown): id is string {
    return typeof id === "string" && this.d.secrets.some((s) => s.id === id);
  }
  private async push(): Promise<void> {
    try {
      this.d.changed(await this.view());
    } catch (err) {
      this.log("Could not send the connections to the window", err);
    }
  }
  private log(message: string, err?: unknown): void {
    (this.d.log ?? console.error)(message, err);
  }
}
```
Never pass the error object of a failed `setHarness` to the log with the value in scope beyond what `SecretStore` already logs (it never logs values).

- [ ] **Step 4: Implement `connections-ipc.ts`** in the shape of `plugin-ipc.ts`:

```ts
export const CONNECTIONS_IPC_CHANNELS = ["hh:connectionsGet", "hh:connectionsSet", "hh:connectionsDelete"] as const;
const ID = /^[a-z][a-z0-9_-]{0,39}$/;
const VALUE_MAX = 8192 * 4;
/** Registered only when the harness declares secrets (D0), through index.ts's handle(), which answers only the app's page. */
export function registerConnectionsIpc(handle: Handle, ctl: Pick<ConnectionsController, "view" | "set" | "delete">): void {
  handle("hh:connectionsGet", () => ctl.view().catch(() => null));
  handle("hh:connectionsSet", (id: unknown, value: unknown) =>
    typeof id !== "string" || !ID.test(id) || typeof value !== "string" || value.length > VALUE_MAX ? INVALID : ctl.set(id, value).catch(() => WRONG));
  handle("hh:connectionsDelete", (id: unknown) => (typeof id !== "string" || !ID.test(id) ? INVALID : ctl.delete(id).catch(() => WRONG)));
}
```
with `INVALID = { ok: false, message: "Invalid request" }`, `WRONG = { ok: false, message: "Something went wrong" }`.

- [ ] **Step 5: Wire `index.ts`** (small, additive):
  - a lazily built shared store:

```ts
let secretStore_: SecretStore | null | undefined;
/** The one key store (tools spec §9, Decision 8): for plugins or the harness's secrets; none otherwise (D0). */
function secretStore(): SecretStore | null {
  if (!pluginsAccepted(harness) && (hooks.pluginDirs?.length ?? 0) === 0 && !hasSecrets(harness)) return null;
  secretStore_ ??= new SecretStore(path.join(hooks.sharedDir ?? sharedConfigDir(), harness.id, "secrets"), secretCrypto());
  return secretStore_;
}
```
    where `secretCrypto()` returns `safeStorageCrypto(safeStorage)` (Task 10 adds the test hook). Replace `new SecretStore(path.join(appDir, "secrets"), safeStorageCrypto(safeStorage))` in the plugins block with `secrets: secretStore()!` (non-null there by construction; keep a comment). `appDir` is the same folder.
  - after the plugins block: `if (hasSecrets(harness)) registerConnectionsIpc(handle, connections());` with `connections()` building one `ConnectionsController({ secrets: harness.secrets!, store: secretStore()!, changed: (v) => send("hh:connectionsChange", v) })` once;
  - `AppState.connections`: in the function that builds `AppState`, add `...(hasSecrets(harness) ? { connections: { count: harness.secrets!.length } } : {})`.

- [ ] **Step 6: Run** the three test files, `ipc-surface.test.ts` (unchanged: the channels go through `handle()`), `hatches-surface.test.ts` (unchanged), `corepack pnpm typecheck`, `corepack pnpm app:build`.

- [ ] **Step 7: Frozen check, then commit.**

```bash
git -C <worktree> add packages/shell/src/main/secrets/connections.ts packages/shell/src/main/secrets/connections-ipc.ts packages/shell/test/secrets/connections.test.ts packages/shell/test/secrets/connections-ipc.test.ts packages/shell/test/connections-surface.test.ts
git -C <worktree> commit --only packages/shell/src/main/secrets/connections.ts packages/shell/src/main/secrets/connections-ipc.ts packages/shell/src/main/index.ts packages/shell/test/secrets/connections.test.ts packages/shell/test/secrets/connections-ipc.test.ts packages/shell/test/connections-surface.test.ts -m "feat(shell): Settings › Connections in main, over one shared key store" -m "<trailer>"
```
(`client.ts` types come in Task 7; until then import the view types from a local `type` in `connections.ts` and switch to `@humanharness/ui/client` in Task 7 — or do Task 7's type additions first and say so in the report.)

---

### Task 6: The `connect` step in main

**Files:**
- Modify: `packages/shell/src/main/setup-steps.ts`, `packages/shell/src/main/index.ts` (one dep)
- Test: `packages/shell/test/setup-steps.test.ts` (append)

- [ ] **Step 1: Write the failing tests** (append; reuse the file's fixtures and `deps()` helper):

```ts
describe("SetupSteps: a connect step (tools spec §9)", () => {
  const connect = { id: "jira", kind: "connect" as const, label: "Connect Jira", required: false, secrets: ["jira"] };
  it("its view carries the secrets' ids, labels and help, never a value", () => {
    const views = setupStepViews({ setup: [connect], actions: {}, data: {}, secrets: [{ id: "jira", label: "Jira API token", help: "Paste it." }] });
    expect(views).toEqual([{ id: "jira", kind: "connect", label: "Connect Jira", required: false, secrets: [{ id: "jira", label: "Jira API token", help: "Paste it." }] }]);
  });
  it("complete refuses while a listed secret is not set, then marks it done", async () => {
    let set = false;
    const s = new SetupSteps(deps({ steps: [connect], secretsSet: async () => set }));
    expect(await s.complete("jira")).toEqual({ ok: false, reason: "incomplete" });
    set = true;
    expect(await s.complete("jira")).toMatchObject({ ok: true });
  });
  it("D0: views of form, interview and component steps are unchanged by connect", () => {
    // the exact expectation of the existing setupStepViews test, re-run against a harness with no secrets
  });
});
```
(Fill the D0 test with the same input and expected array as the existing `setupStepViews` test in this file; it must not change.)

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.** `SetupStepsDeps` gains `secretsSet?(ids: readonly string[]): Promise<boolean>`. In `complete`:

```ts
      if (step.kind === "connect" && !(await (this.d.secretsSet?.(step.secrets) ?? Promise.resolve(false)).catch(() => false))) return { ok: false, reason: "incomplete" };
```
`setupStepViews` takes `secrets?: readonly HarnessSecret[]` on its argument and adds a branch:

```ts
    if (s.kind === "connect") return { ...base, secrets: s.secrets.flatMap((id) => (h.secrets ?? []).filter((x) => x.id === id).map((x) => ({ id: x.id, label: x.label, ...(x.help ? { help: x.help } : {}) }))) };
```
In `index.ts`, where `SetupSteps` is built, pass `secretsSet: (ids) => connections().allSet(ids)` only when `hasSecrets(harness)` (a manifest with a connect step always has secrets).

- [ ] **Step 4: Run, typecheck, frozen check, commit.**

```bash
git -C <worktree> commit --only packages/shell/src/main/setup-steps.ts packages/shell/src/main/index.ts packages/shell/test/setup-steps.test.ts -m "feat(shell): the connect setup step is done once its secrets are set" -m "<trailer>"
```

---

### Task 7: Client types, preload and fake client

**Files:**
- Modify: `packages/ui/src/client.ts`, `packages/shell/src/preload/index.ts`, `packages/ui/test/fake-client.ts`
- Test: `packages/ui/test/connections-client.test.ts` (new)

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, it } from "vitest";
import { FakeClient } from "./fake-client";

describe("client.connections (tools spec §9)", () => {
  it("the fake keeps state without values: set, then the view says set", async () => {
    const c = new FakeClient(/* the constructor's existing options */);
    c.connectionsDeclared = [{ id: "jira", label: "Jira API token" }];
    expect(await c.connections.set("jira", "tok-123456789")).toEqual({ ok: true });
    expect(await c.connections.get()).toEqual({ connections: [{ id: "jira", label: "Jira API token", set: true }] });
    expect(JSON.stringify(await c.connections.get())).not.toContain("tok-");
  });
});
```
(`FakeClient` is a class: add a public `connectionsDeclared: { id; label; help? }[]` field (default `[]`) and an in-memory set of stored ids; adapt to its constructor and say so.)

- [ ] **Step 2: Run to see it fail.**

- [ ] **Step 3: Implement.** In `client.ts`:

```ts
/** A harness secret as Settings › Connections shows it (tools spec §9): never its value. */
export interface ConnectionView {
  id: string;
  label: string;
  help?: string;
  set: boolean;
}
export interface ConnectionsView {
  connections: ConnectionView[];
}
export type ConnectionResult = { ok: true } | { ok: false; message: string };
/** The harness declares secrets (tools spec §9). Absent from AppState without (D0). */
export interface ConnectionsInfo {
  count: number;
}
/** Settings › Connections (tools spec §9). Only with `state.connections`: a main without secrets registers none (D0). */
export interface ConnectionsClient {
  get(): Promise<ConnectionsView | null>;
  /** Stores a key (at most 8,192 characters once trimmed); its value never comes back. */
  set(id: string, value: string): Promise<ConnectionResult>;
  delete(id: string): Promise<ConnectionResult>;
  onChange(listener: (view: ConnectionsView) => void): () => void;
}
```
`AppState` gains `connections?: ConnectionsInfo;` (comment: "The harness declares secrets (tools spec §9). Absent: none (D0)."); `HarnessClient` gains `connections: ConnectionsClient;`. `SetupStepView.kind` becomes `"form" | "interview" | "component" | "connect"` and gains `secrets?: { id: string; label: string; help?: string }[];` ("connect: the keys it asks for"). Preload: `connections: { get: () => ipcRenderer.invoke("hh:connectionsGet"), set: (id, value) => ipcRenderer.invoke("hh:connectionsSet", id, value), delete: (id) => ipcRenderer.invoke("hh:connectionsDelete", id), onChange: (l) => subscribe<ConnectionsView>("hh:connectionsChange", l) }`. Fake client: an in-memory set of ids.

If Task 5 used local types in `connections.ts`, switch it to these now.

- [ ] **Step 4: Run, typecheck, `corepack pnpm app:build`, commit.**

```bash
git -C <worktree> add packages/ui/test/connections-client.test.ts
git -C <worktree> commit --only packages/ui/src/client.ts packages/shell/src/preload/index.ts packages/ui/test/fake-client.ts packages/ui/test/connections-client.test.ts packages/shell/src/main/secrets/connections.ts -m "feat(ui): client.connections" -m "<trailer>"
```

---

### Task 8: Settings › Connections

**Files:**
- Create: `packages/ui/src/connections/SecretField.tsx`, `packages/ui/src/connections/ConnectionsTab.tsx`
- Modify: `packages/ui/src/SettingsSheet.tsx`, `packages/i18n/src/locales/en.json`
- Test: `packages/ui/test/connections-ui.test.tsx` (new)

- [ ] **Step 1: Write the failing tests** (Testing Library, as `jobs-ui.test.tsx`):

```tsx
describe("Settings › Connections (tools spec §9)", () => {
  it("D0: no Connections tab without state.connections", () => {
    // render SettingsSheet with a state that has no `connections`: no tab named "Connections"
  });
  it("lists each declared secret with its help and state", async () => {
    // fake with jira (set) and gh (not set): rows "Jira API token" · "Set", "GitHub token" · "Not set"; help text shown
  });
  it("Save sends the value once and clears the field before the answer", async () => {
    // type "tok-123456789", click Save: client.connections.set called with ("gh", "tok-123456789"); the input is empty
    // while the promise is pending; afterwards the row says "Set" and the button reads "Replace"
  });
  it("a refusal shows its message; Delete makes the row Not set", async () => { /* … */ });
  it("never renders a value: the input is type=password and empty after save", async () => { /* … */ });
});
```
Write each body in full with `screen.getByRole`/`findByText` assertions.

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**
  - `en.json`, new top-level block:

```json
"connections": {
  "tab": "Connections",
  "intro": "Keys this app uses to reach your services. They are stored encrypted on this computer and never shown again.",
  "set": "Set",
  "notSet": "Not set",
  "paste": "Paste the key",
  "save": "Save",
  "replace": "Replace",
  "delete": "Delete",
  "failed": "That didn't save.",
  "stepNext": "Paste each key to go on."
}
```
  - `SecretField.tsx`: one row: label (`<bdi dir="auto">`), help (caption), state text, `<input type="password" autoComplete="off" spellCheck={false}>`, Save/Replace and Delete buttons; on Save it copies the value, clears the input, then awaits `set`. Props: `{ connection: ConnectionView; onSave(value): Promise<ConnectionResult>; onDelete(): Promise<ConnectionResult> }`.
  - `ConnectionsTab.tsx`: `client.connections.get()` on mount, `onChange` subscription, one `SecretField` per row, an alert line for the last refusal.
  - `SettingsSheet.tsx`: `SettingsTab` adds `"connections"`; `TABS` gets it after `"plugins"`; filter `(id !== "connections" || state.connections !== undefined)`; label `t("connections.tab")`; panel `{tab === "connections" && configured && state.connections && <ConnectionsTab client={client} />}`.

- [ ] **Step 4: Run, typecheck, app:build, commit.**

```bash
git -C <worktree> add packages/ui/src/connections/SecretField.tsx packages/ui/src/connections/ConnectionsTab.tsx packages/ui/test/connections-ui.test.tsx
git -C <worktree> commit --only packages/ui/src/connections/SecretField.tsx packages/ui/src/connections/ConnectionsTab.tsx packages/ui/src/SettingsSheet.tsx packages/i18n/src/locales/en.json packages/ui/test/connections-ui.test.tsx -m "feat(ui): Settings › Connections" -m "<trailer>"
```

---

### Task 9: The connect step on the setup screen

**Files:**
- Create: `packages/ui/src/connections/ConnectStep.tsx`
- Modify: `packages/ui/src/SetupFlow.tsx`, `packages/ui/src/SetupStepsList.tsx`
- Test: `packages/ui/test/setup-connect.test.tsx` (new)

- [ ] **Step 1: Write the failing tests.**

```tsx
describe("the connect step (tools spec §9)", () => {
  it("shows each secret's label, help and field; Next is disabled until every one is set", async () => { /* … */ });
  it("Next calls setupSteps.complete(id) and moves on", async () => { /* … */ });
  it("Skip works for an optional step and is absent for a required one", async () => { /* … */ });
  it("a step whose keys are already set shows them as set and Next enabled", async () => { /* … */ });
  it("Settings' list of setup steps shows a connect step with its state and an Open that goes to Connections", async () => { /* … */ });
});
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.** `ConnectStep` reuses `SecretField` for the step's `secrets` (filtered from `client.connections.get()`), tells its parent `onReady(allSet)`. `SetupFlow`: `{current.kind === "connect" && <ConnectStep client={client} step={current} onReady={setConnectReady} />}` and in the footer `{current.kind === "connect" && <button className="hh-primary" disabled={waiting || !connectReady} onClick={() => complete(current.id)}>{t("setupFlow.next")}</button>}`; a caption `t("connections.stepNext")` while not ready. `SetupStepsList`: a connect row's action opens Settings › Connections (`onTab("connections")`).

- [ ] **Step 4: Run, typecheck, app:build, commit.**

```bash
git -C <worktree> add packages/ui/src/connections/ConnectStep.tsx packages/ui/test/setup-connect.test.tsx
git -C <worktree> commit --only packages/ui/src/connections/ConnectStep.tsx packages/ui/src/SetupFlow.tsx packages/ui/src/SetupStepsList.tsx packages/ui/test/setup-connect.test.tsx -m "feat(ui): the connect setup step" -m "<trailer>"
```

---

### Task 10: Fake secrets for tests, a fixture, and the e2e

**Files:**
- Modify: `packages/shell/src/main/test-hooks.ts`, `packages/shell/src/main/index.ts` (`secretCrypto()`)
- Create: `packages/shell/src/main/secrets/test-crypto.ts`
- Create: `packages/fake-agent/fixtures/secrets-harness/` (manifest, `AGENTS.md`, one action brief), `packages/e2e/tests/connections.spec.ts`
- Test: `packages/shell/test/test-hooks.test.ts` (append), `packages/shell/test/secrets/test-crypto.test.ts` (new)

- [ ] **Step 1: Write the failing tests.**

```ts
// test-hooks.test.ts (append)
it("fake secrets only when not packaged", () => {
  expect(readTestHooks({ HH_TEST_FAKE_SECRETS: "1" }, false).fakeSecrets).toBe(true);
  expect(readTestHooks({ HH_TEST_FAKE_SECRETS: "1" }, true).fakeSecrets).toBeUndefined();
  expect(readTestHooks({ HH_TEST_FAKE_SECRETS: "yes" }, false).fakeSecrets).toBeUndefined();
});
```
(`readTestHooks(env, packaged)`; check how it returns early for a packaged app and follow that.)

```ts
// test-crypto.test.ts
it("testCrypto round-trips, never stores the plaintext, and is available", () => {
  const c = testCrypto();
  const b = c.encrypt("tok-123456789");
  expect(b.toString()).not.toContain("tok-123456789");
  expect(c.decrypt(b)).toBe("tok-123456789");
  expect(c.available()).toBe(true);
});
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.** `testCrypto()` (hex with a fixed prefix, like the unit tests' fake). `readTestHooks` sets `hooks.fakeSecrets = true` for exactly `"1"` when not packaged. `secretCrypto()` in `index.ts`: `hooks.fakeSecrets ? testCrypto() : safeStorageCrypto(safeStorage)`.

- [ ] **Step 4: Fixture.** `packages/fake-agent/fixtures/secrets-harness/harness.config.ts` (copy `setup-harness`'s shape): id `secrets`, `secrets: [{ id: "jira", label: "Jira API token", help: "Create one at id.atlassian.com → Security → API tokens." }]`, `setup: [{ id: "jira", kind: "connect", label: "Connect Jira", secrets: ["jira"] }]`, one action. No plugin, no tools.

- [ ] **Step 5: e2e** `connections.spec.ts`, using the helpers of `setup-steps.spec.ts`, with `HH_TEST_FAKE_SECRETS=1` and mock mode:
  - "the connect step asks for the key, then Next": through the setup screen, the step shows "Jira API token", Next disabled; paste `tok-e2e-123456789`, Save; Next enabled; Next → Home.
  - "Settings › Connections shows it set, and Delete makes it Not set": open Settings › Connections, "Set"; Delete; "Not set".
  - "no value on screen": `page.content()` never contains `tok-e2e-123456789` after save.

Run: `corepack pnpm app:build` then `corepack pnpm --filter @humanharness/e2e exec playwright test tests/connections.spec.ts tests/setup-steps.spec.ts tests/plugins.spec.ts tests/history.spec.ts`.

- [ ] **Step 6: Frozen check, commit.**

```bash
git -C <worktree> add packages/shell/src/main/secrets/test-crypto.ts packages/shell/test/secrets/test-crypto.test.ts packages/fake-agent/fixtures/secrets-harness packages/e2e/tests/connections.spec.ts
git -C <worktree> commit --only packages/shell/src/main/test-hooks.ts packages/shell/src/main/index.ts packages/shell/src/main/secrets/test-crypto.ts packages/shell/test/test-hooks.test.ts packages/shell/test/secrets/test-crypto.test.ts packages/fake-agent/fixtures/secrets-harness packages/e2e/tests/connections.spec.ts -m "test(e2e): connect step and Settings › Connections, with fake secrets" -m "<trailer>"
```

---

### Task 11: Docs and the full run

**Files:**
- Create: `docs/architecture/secrets.md`
- Modify: `docs/architecture/plugins.md` ("The broker", "Where things live" keys row, "Where to look"), `docs/architecture/setup.md` (the connect kind), `docs/architecture/manifest.md` (`secrets`)

- [ ] **Step 1: `secrets.md`.** Sections: what it is (spec §9, D9); the core broker (`broker/broker.ts`, `BrokerGrant`, who builds one: `PluginBroker` now, tools in slice 2; `CORE_CALLS`; the checks file); the store (paths, `_harness/`, logical names, `harnessValues` only for slice 2's broker); `secrets` and the `connect` step; Settings › Connections and the channels; the test hook; D0 table (the pins above); threat rows S1–S6; known gaps (no "Test connection" until slice 2; plugin-fetch/plugin-exec names; no per-profile keys).
- [ ] **Step 2: `plugins.md`.** "The broker": `PluginBroker` is the plugin adapter over the core `Broker` (link `secrets.md`); the behaviour paragraph stays. "Keys": the store is the core's (`secrets/secret-store.ts`), plugin keys unchanged on disk. "Where to look": the new files.
- [ ] **Step 3: `setup.md`** and **`manifest.md`**: the fourth kind; `secrets` with its limits.
- [ ] **Step 4: Full run.** `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm app:build`, `corepack pnpm e2e`. Then the D0 and frozen checks:

```bash
git -C <worktree> diff --stat feat/harness-hatches -- packages/runtime/test/runtime-d0.test.ts packages/runtime/test/hatches-d0.test.ts packages/runtime/test/claude-cli.test.ts packages/shell/test/hatches-surface.test.ts packages/e2e/tests/history.spec.ts
```
plus the frozen-list command. Both print nothing.

- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add docs/architecture/secrets.md
git -C <worktree> commit --only docs/architecture/secrets.md docs/architecture/plugins.md docs/architecture/setup.md docs/architecture/manifest.md -m "docs: the core broker and secrets, the connect step, Settings › Connections" -m "<trailer>"
```

---

## Parallel execution

Tasks 1 → 2 → 3 are sequential (the same files). Task 4 (sdk) may run beside 1–3. Task 5 needs 3 and 4; 6 needs 4 and 5; 7 needs 5; 8 and 9 need 7 (8 before 9: `SecretField`); 10 needs 5–9; 11 last.
