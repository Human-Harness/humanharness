# OpenCode Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OpenCode becomes the third engine, with legal status `allowed`. The app installs the unmodified `opencode` CLI and runs it over ACP (`opencode acp`). The person sets up their own provider in OpenCode's own login (an API key or a local model). The app never asks for, stores or reads keys. Models come from what OpenCode offers over ACP. A task's model and effort are set with `session/set_config_option`. Settings › Usage shows what OpenCode reports as cost, in USD. Claude and Codex work exactly as today (D0 below).

**Architecture:**
- **Registry (`packages/engines`).** A new `opencode` entry. `TransportDef` (ACP) gets `profile?: "codex-config" | "config-option"`. `EngineDef` gets `reportsCost?: boolean`. `EngineSetup` gets `inTerminal?: ("login" | "logout")[]` and `providersUrl?: string`. The status format union gets `"opencode-auth-list"`. `isModelId` accepts `provider/model` ids.
- **Runtime (`packages/runtime`).**
  - `acp.ts`: the effort select is found by id `reasoning_effort` or `effort`, or by category `thought_level`. With `profileMethod: "config-option"` the transport sets no `CODEX_CONFIG` and never restarts for a profile. After `session/new` or `session/load` it calls `session/set_config_option` for `model` and the effort. A `config_option_update` refreshes the offer. `usage_update.cost` (USD) becomes a per-turn `costUsd` on the `usage` event (the delta of the session's running total).
  - `transport.ts`: `TransportOptions.profileMethod`, and a helper `acpFields(engine, edit)` that the three places building ACP options share.
- **Shell main (`packages/shell/src/main`).**
  - `engine-status.ts`: `opencode-auth-list` parsing. With no provider listed, a past successful test prompt counts as "set up" (local models).
  - `engine-command.ts`: `~/.opencode/bin` joins the known install folders.
  - `validate.ts`: OpenCode's data and config folders are protected paths.
  - `chat-log.ts`, `usage-log.ts`: `TurnUsage.costUsd`; `UsageSummary.spentUsd` (last 30 days), only when a turn reported a cost.
  - `index.ts`, `install-help.ts`: `EngineOption` carries the new facts; `hh:copySetupCommand` copies `opencode auth login` (or `logout`); `hh:runSetup` refuses a step that runs in Terminal.
- **Window (`packages/ui`).** `EngineOnboarding.tsx`: for an engine whose login runs in Terminal, a "Choose a provider" card (copy the command, open Terminal, check again, or test a local model). The legal notice gets one more line for an engine whose provider the person picks. `EngineTab.tsx`: sign out in Terminal. `UsageTab.tsx`: the 30-day spend row and its caption.
- **Fake agent.** `fake-acp.ts` answers `session/set_config_option` and logs it.
- **Demo and docs.** The demo harness lists `opencode`. The CLI help names it. The core spec gets the new status row, the v1 engine list and rule 1's new folder.

**Tech Stack:** Unchanged: TypeScript, pnpm via corepack, Electron 44 + electron-vite 5, React 19, i18next, zod 4, `@agentclientprotocol/sdk`, Vitest + happy-dom, Playwright with the fake agents. No new dependency.

Spec: `docs/superpowers/specs/2026-10-26-opencode-engine-design.md` (on `origin/master`; source of truth; "§" and "D" numbers below refer to it). It builds on plans 1–8, especially `2026-10-12-03c-resources.md` (tiers, model profiles, fallbacks) and `2026-10-14-03f-setup-flow.md` (onboarding, setup steps).

---

## Conventions

**Code**
- Same as plans 1–8:
  - English everywhere (code, comments, docs, UI strings);
  - packages export TS source;
  - extensionless imports;
  - tests in `packages/<name>/test/`;
  - one commit per task.
- React tests are `*.test.tsx` with `// @vitest-environment happy-dom` on the first line. Find elements by role and visible text.
- `@humanharness/ui` only imports **types** from other packages (`import type`).
- Colours only through `--hh-*` tokens. This plan adds no token.
- UI strings live in `packages/i18n/src/locales/en.json` (English only, plan 5a). The spec's Spanish strings are written here in English.
- Everything that comes from the engine is untrusted data: model ids go through `isModelId`, efforts through `isEffort`, cost through `Number.isFinite` and a `>= 0` check.
- Errors over IPC travel as data, never as thrown errors.

**Commands and git**
- The worktree is `/Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data`. Create branch `feat/opencode` from `feat/material` (plan 8) and implement there: `git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data switch -c feat/opencode feat/material`.
- Run every `corepack pnpm …` command from the worktree root. A single test file: `corepack pnpm vitest run <path>`.
- `<worktree>` in the commands below means that path, written out in full.
- Git: always `git -C <worktree> …`, one simple command per call. Never use bare `git stash`. Never push.
- Every commit message ends with these two lines, with a blank line before them:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01CYnseEAeovyPsFrGYJACy7
  ```
- Every task ends with `corepack pnpm typecheck` and `corepack pnpm test` green before its commit.
  - Tasks that touch the shell's main process, the preload or the UI also run `corepack pnpm app:build`.
  - Task 15 runs `corepack pnpm e2e`.

**Compliance (core spec §5, spec D1), restated for this plan**
- Never read `~/.claude`, `~/.codex`, `~/.gemini`, `~/.config/opencode`, `~/.local/share/opencode` or any account, token or credential file. This holds for the person doing the spike, for the tests and for product code.
- The app runs only OpenCode's own commands: `--version`, `auth list`, `auth login`, `auth logout`, `upgrade` and `acp`. From `auth list` it keeps one fact: whether at least one provider is listed. It never keeps or logs a provider name, a key, an email or a path from that output.
- The app never sets a key in an environment variable, never writes `opencode.json` and never passes `--provider`.
- Login and logout are the person's own, in Terminal. The app copies the command text and opens Terminal. It runs nothing in it.

**D0 is a hard rule (like plans 1–8).** With Claude or Codex as the engine, these stay byte for byte:
- the registry entries of `claude`, `codex`, `kimi`, `gemini` and `qwen` (no new field is set on them);
- Codex's `CODEX_CONFIG`, its process restarts on a profile change, its `session/new` and `session/set_mode` calls, and `offeredModels`' result for Codex's `configOptions`;
- `usage.jsonl` lines (no `costUsd`), `UsageSummary` (no `spentUsd`), `ChatEntry.usage`;
- `EngineOption` (no `reportsCost`, `providersUrl`, `terminalSteps`, `userProvider`), the onboarding cards, the legal notice, Settings › Engine and Settings › Usage;
- `detectEngine`'s answer for `json-logged-in` and `exit-code`;
- the folder rules for every path that is not under OpenCode's own folders.

Tasks 2, 5, 6, 9, 11, 12, 13 and 14 hold the regression tests. Every other change keeps D0 by adding fields only when the engine sets them (conditional spreads), never by changing a default.

## Decisions this plan takes where the spec leaves room

**Registry (§1)**
- `models: { efforts: ["low", "medium", "high"] }`, like Codex, not `[]`. Settings › Models needs an effort list before OpenCode first reports one. The transport sends an effort only when OpenCode offers that exact value, so nothing wrong reaches the engine.
- `reportsCost: true` and `setup.providersUrl: "https://opencode.ai/docs/providers/"` are small additions the spec implies (§2 card link, §4 cost row).
- `setup.inTerminal: ["login", "logout"]`: both are interactive in OpenCode (provider picker). The app copies the command and opens Terminal (§2).
- `minVersion` and the terms and privacy URLs come from the spike (Task 1). Until then the entry uses `"0.0.0"` and the providers page, and Task 1's commit fills them.

**Status (§2)**
- `opencode-auth-list`: ready when the output lists at least one provider (in either the credentials or the environment section).
- No provider listed: `loggedIn` is `false`, unless the engine record has `verifiedAt` (a test prompt worked). Then it is `null` (unknown), which counts as set up. This is how "ready when the first ACP session reports a model" works for a person on local models only: the card's "Test my local model" button runs the existing test prompt.
- A failed or timed-out `auth list` is `null`, as for the other formats.

**Models (§3)**
- `isModelId` accepts up to three `/`-separated parts and `:` (Ollama tags such as `ollama/llama3.2:3b`), up to 128 characters. It still refuses a leading `-`, spaces, `;`, an empty part and `..`.
- The model offer keeps its first 50 models (unchanged). See open question Q3.
- `profileMethod: "config-option"`:
  - no `CODEX_CONFIG` (it is removed from the environment, as today without a profile);
  - no restart when the profile changes;
  - after `session/new` or `session/load` (and before every turn when the profile changed), `session/set_config_option` with `configId: "model"` when the profile names a model, and with the effort option's id when OpenCode offers the profile's effort;
  - a profile without a model after one with a model closes the process and starts a fresh session, so a session never runs on a model the profile did not ask for (resources spec D2);
  - a model that is not in OpenCode's current offer, or a `set_config_option` that fails, is `model-unavailable`. The shell's existing fallback (`nextFallback`) then tries the next tier, and at the end the default model;
  - the session-start check that the running model is the profile's model (`checkModel`) is skipped for this method: the session starts on OpenCode's default and the transport sets the model afterwards. `reportedModel` is the model option's `currentValue`, after the set.
- The context cap (`cap`) is not sent to OpenCode. OpenCode compacts on its own. Settings keeps showing the cap (same as the other engines); see Q4.

**Usage (§4)**
- The transport keeps the session's running cost (`costTotal`) and the total at the last turn's end (`costBaseline`).
  - `session/new`: baseline `0`.
  - `session/load`: baseline unknown. A `usage_update` that arrives while the session loads sets it.
  - At the end of a turn: `costUsd = max(0, total − baseline)` when both are known; then the baseline becomes the total. With an unknown baseline the turn records no cost and only sets the baseline.
  - A `cost` whose `currency` is not `"USD"`, or whose `amount` is not a finite number ≥ 0, is ignored.
- `costUsd` rides on the `usage` event and on `TurnUsage`, so it lands in `usage.jsonl` inside `usage` (as `costUsd`), for task turns and material stages alike.
- `UsageSummary.spentUsd` is the sum of `usage.costUsd` over the last 30 days. It is absent when no line in the log has a `costUsd` (D0). With profiles it covers every profile's lines (one account pays).
- Settings › Usage, when `spentUsd` is present: a row "Spent in the last 30 days" with "US$ 1.23" (two decimals, the shown language's format), and the caption "{{engine}} reports it. With local models it is 0."
- For an engine with `reportsCost`, the plan section's text is "{{engine}} reports what each reply costs, not a plan's limits. Your provider bills you for it." instead of `usage.noLimitsPlan`. No "See plans" link (no `plansUrl`).

**Login and notice (§2, D3)**
- The onboarding's "logged-out" card, for an engine with `terminalSteps.login`, becomes "Choose a provider in OpenCode":
  1. "Open Terminal and paste the command." (buttons: Copy command, Open Terminal)
  2. "Pick a provider and follow the steps. Your key stays in OpenCode."
  3. "Come back and press Check again."
  - plus "Using a local model (Ollama)? Set it up in OpenCode, then test it." with a "Test my local model" button, and a link "OpenCode's guide to providers".
- The legal notice, for an engine with `userProvider`, adds: "You choose the provider in {{engine}}. Its terms and privacy rules apply between you and that provider."
- Settings › Engine, for an engine with `terminalSteps.logout`: "Sign out" copies `opencode auth logout`, opens Terminal and shows "Finish signing out in Terminal, then press Check again."

## Open product questions (each with the default this plan uses)

- **Q1. Sign in in Terminal or inside the app?** Default: Terminal, copy and paste (no command is typed into Terminal for the person). If the spike shows `opencode auth login` works with a pipe (no TTY), a later plan can run it inside the app like Claude's.
- **Q2. Is a person with only local models "ready"?** Default: yes, after one successful test prompt (`verifiedAt`). The card offers "Test my local model".
- **Q3. How many models to list?** OpenRouter offers hundreds. Default: keep the first 50 OpenCode sends, unchanged. A search box in Settings › Models is a later change.
- **Q4. The context cap with OpenCode.** OpenCode has no ACP setting for it. Default: not sent; Settings still shows it; the docs say OpenCode compacts on its own.
- **Q5. Spend: 30 days or the month?** Default: the last 30 days, all profiles together (one account pays).
- **Q6. A non-USD cost.** Default: not recorded and not shown. No currency conversion.
- **Q7. Logout.** Default: in Terminal, like login (`opencode auth logout` asks which provider).
- **Q8. Which tiers get which model.** Default: every tier uses OpenCode's default model; the person assigns models per tier in Settings › Models (spec §3). No suggested mapping.
- **Q9. Demo harness.** Default: the demo lists `opencode` after Claude and Codex. Its "Engines" topic text names OpenCode too.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `packages/engines/src/index.ts` | modify | Types (`profile`, `reportsCost`, `inTerminal`, `providersUrl`, `opencode-auth-list`) and the `opencode` entry |
| `packages/engines/src/models.ts` | modify | `isModelId` accepts `provider/model` |
| `packages/engines/test/engines.test.ts`, `models.test.ts` | modify | Registry and id tests |
| `packages/fake-agent/src/script.ts`, `fake-acp.ts` | modify | `session/set_config_option`, `rejectConfigValues` |
| `packages/runtime/src/acp.ts` | modify | Effort option, profile by config option, `config_option_update`, cost per turn |
| `packages/runtime/src/events.ts` | modify | `usage.costUsd` |
| `packages/runtime/src/transport.ts` | modify | `profileMethod`, `acpFields` |
| `packages/runtime/src/runtime.ts`, `system.ts` | modify | Use `acpFields` |
| `packages/runtime/test/acp.test.ts` | modify | New ACP tests |
| `packages/shell/src/main/engine-check.ts` | modify | Use `acpFields` |
| `packages/shell/src/main/engine-status.ts` | modify | `opencode-auth-list`, `verifiedAt` fallback |
| `packages/shell/src/main/engine-command.ts` | modify | `~/.opencode/bin` |
| `packages/shell/src/main/validate.ts` | modify | OpenCode folders protected |
| `packages/shell/src/main/chat-log.ts` | modify | Copy `costUsd` |
| `packages/shell/src/main/usage-log.ts` | modify | `spentUsd` |
| `packages/shell/src/main/install-help.ts` | modify | `setupCommandText` |
| `packages/shell/src/main/index.ts` | modify | `EngineOption` fields, `hh:copySetupCommand`, refuse Terminal steps |
| `packages/shell/src/preload/index.ts` | modify | `copySetupCommand` |
| `packages/ui/src/client.ts` | modify | `EngineOption`, `TurnUsage`, `UsageSummary`, `HarnessClient.copySetupCommand` |
| `packages/ui/src/EngineOnboarding.tsx` | modify | Provider card, notice line |
| `packages/ui/src/EngineTab.tsx` | modify | Sign out in Terminal |
| `packages/ui/src/UsageTab.tsx` | modify | Spend row, cost text |
| `packages/i18n/src/locales/en.json` | modify | New strings |
| `packages/ui/test/fake-client.ts` | modify | `copySetupCommand` |
| `harnesses/demo/harness.config.ts` | modify | `engines` gets `opencode` |
| `packages/cli/src/main.ts`, `run.ts` | modify | Help text |
| `packages/e2e/tests/helpers.ts`, `opencode.spec.ts` | modify / create | Fake OpenCode, one end-to-end run |
| `docs/superpowers/specs/2026-10-10-humanharness-core-design.md` | modify | Status row, v1 engines, rule 1 |
| `docs/superpowers/specs/2026-10-26-opencode-engine-design.md` | modify | Spike results (§8) |

---

### Task 1: Spike — what the real OpenCode does

This task writes no product code. It answers spec §8 and records the answers in the spec. Later tasks were written from OpenCode's public docs (`https://opencode.ai/docs/acp/`, `https://opencode.ai/docs/cli/`) and the ACP spec. Each assumption below says which task depends on it.

**State when this plan was written (2026-10-27):** `which opencode` found nothing; `opencode --version` failed with "command not found". The spike could not run on the planning machine. Public docs confirm:
- `opencode acp` starts ACP over stdio. Its flags: `--cwd`, `--port`, `--hostname`, `--mdns`, `--mdns-domain`, `--cors`. The app uses none.
- `opencode auth login` (flags `--provider`, `--method`), `opencode auth list` (alias `ls`), `opencode auth logout`, `opencode upgrade [target]`, `opencode --version` (`-v`).
- ACP mode "works the same as in the terminal": built-in tools, MCP servers, `AGENTS.md`, agents and permissions. Unsupported: some slash commands (`/undo`, `/redo`).
- The docs do not show `auth list`'s output, the mode ids, or `usage_update`.

**Assumptions the later tasks make (the spike checks each):**

| # | Assumption | Used by | If wrong |
|---|---|---|---|
| A1 | `curl -fsSL https://opencode.ai/install \| bash` installs to `~/.opencode/bin/opencode` | Tasks 2, 10 | Change `install.command` and `knownBinDirs` |
| A2 | `opencode --version` prints `x.y.z` | Task 2 | `parseVersion` already takes the first `x.y.z` |
| A3 | `auth list` lists each provider on a line starting with `●` (or `○`) and ends with `└  N credentials` / `N environment variables` | Task 9 | Replace the fixtures and `countProviders` |
| A4 | Modes (agents) are `build` and `plan`; `plan` refuses edits | Task 2 | Change `modes` |
| A5 | `session/new` returns `configOptions` with `id: "model"` (values `provider/model`) and an effort select (`id: "effort"`, category `thought_level`) | Tasks 3, 5 | Change `effortOptionId` |
| A6 | `session/set_config_option` takes `{ sessionId, configId, value }` and answers `{ configOptions }` | Task 5 | Change `applyProfile` |
| A7 | `usage_update` carries `cost: { amount, currency: "USD" }`, the session's running total; with Ollama it is `0` or absent | Task 6 | Change `usdCost` |
| A8 | `session/prompt` answers with `usage` (`inputTokens`, `outputTokens`, …) | Task 6 | Cost is only recorded with token usage; see the note in Task 6 |
| A9 | An expired or missing key fails with ACP error `-32000` (`auth_required`) | Task 7 | Add the code to `errorFrom` |
| A10 | OpenCode has no terms or privacy page of its own; the providers page is the right link | Task 2 | Use the pages it has |

**Files:**
- Modify: `docs/superpowers/specs/2026-10-26-opencode-engine-design.md` (add "§8 Spike results" at the end of §8)
- Modify: `packages/engines/src/index.ts` (only after Task 2 exists: fill `minVersion`; see Step 9)

- [ ] **Step 1: Install OpenCode with the official command (only on a machine where Marco agreed to it)**

Run: `curl -fsSL https://opencode.ai/install | bash`
Then: `ls ~/.opencode/bin` and `which opencode`.
Record where the binary is (A1). Do not open or list `~/.config/opencode` or `~/.local/share/opencode`.

- [ ] **Step 2: Version**

Run: `opencode --version`
Record the exact output (A2). The tested version becomes `minVersion`.

- [ ] **Step 3: `auth list` with no provider**

Run: `opencode auth list` on a machine with no provider set up.
Record the output with any path to the home folder replaced by `~` (A3). Save it as `packages/shell/test/fixtures/opencode-auth-list-empty.txt`.

- [ ] **Step 4: `auth list` with a provider**

Marco runs `opencode auth login` himself and picks a provider (OpenRouter, with his own key). The person doing the spike never sees or types the key.
Run: `opencode auth list`
Save the output as `packages/shell/test/fixtures/opencode-auth-list-one.txt`, with the provider name kept and every path replaced by `~`. Then Marco runs `opencode auth logout`.

- [ ] **Step 5: Ollama only**

With Ollama running and set up in `opencode.json` by Marco (the spike does not read that file), run `opencode auth list` again. Record whether Ollama shows up (spec §2 says it does not).

- [ ] **Step 6: ACP session by hand**

In an empty temporary folder, run `opencode acp` and send these JSON lines on stdin, one per line:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{"fs":{"readTextFile":false,"writeTextFile":false},"terminal":false}}}
{"jsonrpc":"2.0","id":2,"method":"session/new","params":{"cwd":"<the temp folder>","mcpServers":[]}}
```

Record from the answers: `agentInfo.version`, `agentCapabilities` (`loadSession`, `sessionCapabilities.close`), `modes` (ids and names: A4), `configOptions` (ids, categories, a few option values: A5).
Then send `session/set_config_option` for `model` and for the effort option (A6), `session/set_mode` with `plan`, and `session/prompt` with "Reply with the single word OK." Record every `session/update` kind, the `usage_update` fields (A7) and the prompt's answer (`usage`, A8).
Ask the `plan` agent to "create a file a.txt with hi" and record whether it refuses (A4).

- [ ] **Step 7: Error for a missing key**

With no provider and no local model, send a `session/prompt`. Record the error code and message (A9).

- [ ] **Step 8: Terms and privacy pages**

Look on `https://opencode.ai` for a terms of service and a privacy page (A10). Record the URLs, or "none".

- [ ] **Step 9: Write the results into the spec and fix the plan's assumptions**

Add to the spec, at the end of §8, a "Spike results (YYYY-MM-DD, OpenCode x.y.z)" list: one line per item 1–5 of §8 and per assumption A1–A10, each "confirmed" or what differs. When an assumption is wrong, change the task it names before running that task (the "If wrong" column says what).

- [ ] **Step 10: Commit**

```bash
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data add docs/superpowers/specs/2026-10-26-opencode-engine-design.md packages/shell/test/fixtures
git -C /Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-scopes-data commit -m "docs(opencode): spike results"
```

**If the spike cannot run** (no machine where installing OpenCode is fine, or no provider key): skip Steps 1–8. Write in the spec "Spike not run; the plan's assumptions A1–A10 stand". Create the two fixture files from Task 9's inline text. Keep `minVersion: "0.0.0"` and mark it with a comment `// set from the spike before release`. Tasks 2–16 then run against the fake agent only. The manual check in spec §7 ("Real") becomes a release gate, not a plan step.

---

### Task 2: Registry — new fields and the OpenCode entry

**Files:**
- Modify: `packages/engines/src/index.ts`
- Test: `packages/engines/test/engines.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/engines/test/engines.test.ts`, replace the test "allows only Claude and Codex in v1" with these, inside `describe("ENGINES")`:

```ts
  it("allows Claude, Codex and OpenCode", () => {
    expect(ENGINES.filter((e) => e.status === "allowed").map((e) => e.id).sort()).toEqual(["claude", "codex", "opencode"]);
  });

  it("runs the unmodified OpenCode over ACP and sets its profile by config option", () => {
    const e = getEngine("opencode");
    expect(e.transport).toEqual({ kind: "acp", command: ["opencode", "acp"], modes: { edit: "build", readOnly: "plan" }, profile: "config-option" });
    expect(e.detect.binary).toBe("opencode");
    expect(e.reportsLimits).toBe(false);
    expect(e.reportsCost).toBe(true);
    expect(e.plansUrl).toBeUndefined();
    expect(e.setup).toMatchObject({
      install: { command: "curl -fsSL https://opencode.ai/install | bash", docsUrl: "https://opencode.ai/docs/" },
      login: ["auth", "login"],
      status: { args: ["auth", "list"], format: "opencode-auth-list" },
      update: ["upgrade"],
      logout: ["auth", "logout"],
      inTerminal: ["login", "logout"],
      providersUrl: "https://opencode.ai/docs/providers/",
    });
    expect(e.dataLocation).toBe("Depends on the provider you set up in OpenCode");
    expect(e.brands ?? []).toEqual([]);
  });

  it("keeps the other engines as they were (D0)", () => {
    for (const id of ["claude", "codex", "kimi", "gemini", "qwen"]) {
      const e = getEngine(id);
      expect(e.reportsCost).toBeUndefined();
      expect(e.setup?.inTerminal).toBeUndefined();
      expect(e.setup?.providersUrl).toBeUndefined();
      if (e.transport.kind === "acp") expect(e.transport.profile).toBeUndefined();
    }
  });
```

In `describe("availableEngines")`, add:

```ts
  it("offers OpenCode in distribution builds", () => {
    expect(availableEngines(["claude", "codex", "opencode"], "distribution").map((e) => e.id)).toEqual(["claude", "codex", "opencode"]);
  });
```

Also add to `describe("ENGINES")`:

```ts
  it("names OpenCode among the brands a harness may not use", () => {
    expect(brandNames()).toContain("OpenCode");
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `corepack pnpm vitest run packages/engines/test/engines.test.ts`
Expected: FAIL ("Unknown engine: opencode", and the allowed list lacks `opencode`).

- [ ] **Step 3: Add the fields**

In `packages/engines/src/index.ts`, change the ACP branch of `TransportDef`:

```ts
  | {
      kind: "acp";
      command: string[];
      /** Session modes to set right after session/new|load, by harness edit permission. */
      modes?: { edit: string; readOnly: string };
      /** Lowest adapter version (agentInfo.version at initialize) the harness accepts. */
      minAdapterVersion?: string;
      /**
       * How a task's model profile reaches the agent: `codex-config` (default) through `CODEX_CONFIG` at spawn,
       * `config-option` through `session/set_config_option` on the open session (OpenCode).
       */
      profile?: "codex-config" | "config-option";
    };
```

In `EngineSetup`, change `status` and add two fields after `logout`:

```ts
  /** CLI args for the login status check, and how to read its result. */
  status: { args: string[]; format: "json-logged-in" | "exit-code" | "opencode-auth-list" };
```

```ts
  /**
   * Steps that are interactive in the CLI (a provider picker): the app copies the command and opens Terminal,
   * and the person runs it there. Never run by the app.
   */
  inTerminal?: ("login" | "logout")[];
  /** The CLI's own guide to choosing a provider, for an engine whose provider the person sets up. */
  providersUrl?: string;
```

In `EngineDef`, after `reportsLimits`:

```ts
  /** Whether the engine reports what each turn cost in USD (OpenCode). Absent: it does not. */
  reportsCost?: boolean;
```

- [ ] **Step 4: Add the entry**

In `ENGINES`, after the `codex` entry and before `kimi`:

```ts
  {
    id: "opencode",
    name: "OpenCode",
    provider: "OpenCode",
    status: "allowed",
    statusSource: "https://opencode.ai/docs/acp (2026-10-26)",
    requires: "An account or API key with a provider you set up in OpenCode, or a local model (Ollama)",
    dataLocation: "Depends on the provider you set up in OpenCode",
    trainsOnData: "Depends on the provider you set up in OpenCode",
    // OpenCode has no terms page of its own for the service: the provider's terms apply (spike, A10).
    termsUrl: "https://opencode.ai/docs/providers/",
    privacyUrl: "https://opencode.ai/docs/providers/",
    // The tested version (spike, Task 1).
    detect: { binary: "opencode", versionArgs: ["--version"], minVersion: "0.0.0" },
    transport: { kind: "acp", command: ["opencode", "acp"], modes: { edit: "build", readOnly: "plan" }, profile: "config-option" },
    // The models come from OpenCode at session start; these efforts are what Settings offers until it does.
    models: { efforts: ["low", "medium", "high"] },
    reportsLimits: false,
    reportsCost: true,
    setup: {
      install: { command: "curl -fsSL https://opencode.ai/install | bash", docsUrl: "https://opencode.ai/docs/" },
      login: ["auth", "login"],
      status: { args: ["auth", "list"], format: "opencode-auth-list" },
      update: ["upgrade"],
      logout: ["auth", "logout"],
      inTerminal: ["login", "logout"],
      providersUrl: "https://opencode.ai/docs/providers/",
    },
    logo: "assets/opencode.svg",
  },
```

- [ ] **Step 5: Add the placeholder logo**

Create `packages/engines/assets/opencode.svg` (a placeholder, like the others; the official logo comes with the brand check before distribution):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect x="4" y="4" width="32" height="32" rx="6" fill="none" stroke="currentColor" stroke-width="3"/><rect x="13" y="13" width="14" height="14" fill="currentColor"/></svg>
```

- [ ] **Step 6: Handle the new status format where the compiler asks**

`parseLoggedIn` in `packages/shell/src/main/engine-status.ts` takes the format. It still compiles (the new value falls through to the exit code). Task 9 gives it its own parsing. Run `corepack pnpm typecheck` and fix only real type errors (for example an exhaustive `switch` over the format elsewhere).

- [ ] **Step 7: Run the tests**

Run: `corepack pnpm vitest run packages/engines/test/engines.test.ts`
Expected: PASS.
Run: `corepack pnpm typecheck` and `corepack pnpm test`. Expected: green. If a test elsewhere lists the allowed engines (`grep -rn "\"claude\", \"codex\"\]" packages/*/test`), add `"opencode"` only where the test is about the registry, not about a harness's own `engines` list.

- [ ] **Step 8: Commit**

```bash
git -C <worktree> add packages/engines
git -C <worktree> commit -m "feat(engines): OpenCode in the registry, allowed, profile by config option"
```

---

### Task 3: Model ids with a provider

**Files:**
- Modify: `packages/engines/src/models.ts:60-65`
- Test: `packages/engines/test/models.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/engines/test/models.test.ts`, replace the `isModelId` test's two loops with:

```ts
    for (const id of ["opus", "gpt-5.5", "claude-opus-4-1[1m]", "o3_mini", "anthropic/claude-sonnet-4-5", "ollama/llama3.2:3b", "openrouter/meta-llama/llama-3.3-70b"]) {
      expect(isModelId(id)).toBe(true);
    }
    for (const id of ["-rf", "--model", "a b", "", "x".repeat(129), "a;b", "/a", "a/", "a//b", "a/../b", "..", "a/b/c/d", 7]) {
      expect(isModelId(id)).toBe(false);
    }
```

- [ ] **Step 2: Run it to see it fail**

Run: `corepack pnpm vitest run packages/engines/test/models.test.ts`
Expected: FAIL on `anthropic/claude-sonnet-4-5`.

- [ ] **Step 3: Change the check**

Replace the `MODEL_ID` constant and `isModelId` in `packages/engines/src/models.ts`:

```ts
/** One part of a model id: letters, digits and `._:[]-`. */
const MODEL_PART = /^[A-Za-z0-9._:\[\]-]+$/;

/**
 * A model id safe to put on a command line, in CODEX_CONFIG or in an ACP request: never a flag. OpenCode names
 * models `provider/model` (OpenRouter adds one more part), so up to three `/`-separated parts.
 */
export function isModelId(v: unknown): v is string {
  if (typeof v !== "string" || v.length === 0 || v.length > 128 || v.startsWith("-")) return false;
  const parts = v.split("/");
  return parts.length <= 3 && parts.every((p) => p !== "" && p !== "." && p !== ".." && MODEL_PART.test(p));
}
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run packages/engines/test/models.test.ts`
Expected: PASS. Then `corepack pnpm typecheck` and `corepack pnpm test`: green. (`cleanSpec`, `cleanProfile` and `engineOffer` in the shell already call `isModelId`, so they accept OpenCode's ids now; Claude's and Codex's ids are unchanged.)

- [ ] **Step 5: Commit**

```bash
git -C <worktree> add packages/engines
git -C <worktree> commit -m "feat(engines): model ids may name their provider (provider/model)"
```

---

### Task 4: Fake agent answers `session/set_config_option`

**Files:**
- Modify: `packages/fake-agent/src/script.ts` (`AcpScript`)
- Modify: `packages/fake-agent/src/fake-acp.ts`
- Test: `packages/runtime/test/acp.test.ts` (Task 5 uses it; this task adds one smoke test)

- [ ] **Step 1: Write the failing test**

In `packages/runtime/test/acp.test.ts`, add at the end:

```ts
describe("fake agent: session/set_config_option", () => {
  it("logs the request and refuses the values the script lists", async () => {
    const { log } = setup({ turns: [[{ stop: "end_turn" }]], configOptions: [], rejectConfigValues: ["bad/model"] });
    const t = transport!;
    await run(t);
    // The transport keeps its connection open after the turn; reach it to send the request by hand.
    const conn = (t as unknown as { conn: { agent: { request: (m: string, p: unknown) => Promise<unknown> } } }).conn;
    const sessionId = "fake-acp-session";
    await expect(conn.agent.request("session/set_config_option", { sessionId, configId: "model", value: "ok/model" })).resolves.toEqual({ configOptions: [] });
    await expect(conn.agent.request("session/set_config_option", { sessionId, configId: "model", value: "bad/model" })).rejects.toThrow();
    expect(log().filter((l) => l.method === "session/set_config_option").map((l) => l.params.value)).toEqual(["ok/model", "bad/model"]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `corepack pnpm vitest run packages/runtime/test/acp.test.ts -t "set_config_option"`
Expected: FAIL (type error on `rejectConfigValues`, then "Method not found").

- [ ] **Step 3: Extend the script type**

In `packages/fake-agent/src/script.ts`, in `AcpScript` after `currentModelId`:

```ts
  /** `session/set_config_option` fails (invalid params) for these values. */
  rejectConfigValues?: string[];
```

- [ ] **Step 4: Answer the request**

In `packages/fake-agent/src/fake-acp.ts`, after the `session/set_mode` handler:

```ts
  .onRequest("session/set_config_option" as never, ((ctx: { params: { value?: unknown } }) => {
    log("session/set_config_option", ctx.params);
    if (typeof ctx.params.value === "string" && script.rejectConfigValues?.includes(ctx.params.value)) {
      throw new acp.RequestError(-32602, `Unknown value: ${ctx.params.value}`);
    }
    return { configOptions: script.configOptions ?? [] };
  }) as never)
```

(The casts are there because the SDK may type its method names. If `"session/set_config_option"` is in the SDK's method list, drop them.)

- [ ] **Step 5: Run the test**

Run: `corepack pnpm vitest run packages/runtime/test/acp.test.ts -t "set_config_option"`
Expected: PASS. Then `corepack pnpm typecheck` and `corepack pnpm test`: green.

- [ ] **Step 6: Commit**

```bash
git -C <worktree> add packages/fake-agent packages/runtime/test/acp.test.ts
git -C <worktree> commit -m "test(fake-agent): answer session/set_config_option"
```

---

### Task 5: ACP — the effort option and the profile by config option

**Files:**
- Modify: `packages/runtime/src/transport.ts` (`TransportOptions.profileMethod`)
- Modify: `packages/runtime/src/acp.ts`
- Test: `packages/runtime/test/acp.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/runtime/test/acp.test.ts`, change `setup`'s `extra` type to:

```ts
  extra: { minAdapterVersion?: string; references?: string[]; onModels?: TransportOptions["onModels"]; profileMethod?: TransportOptions["profileMethod"] } = {},
```

Add these tests at the end of the file:

```ts
const OPENCODE_OPTIONS = [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "anthropic/claude-sonnet-4-5",
    options: [
      { value: "anthropic/claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
      { value: "ollama/llama3.2:3b", name: "Llama 3.2" },
    ],
  },
  { id: "effort", name: "Effort", category: "thought_level", type: "select", currentValue: "medium", options: [{ value: "low" }, { value: "medium" }, { value: "high" }] },
];
const openProfile = (o: Partial<ModelProfile> = {}): ModelProfile => ({ engine: "opencode", tier: "standard", model: "ollama/llama3.2:3b", effort: "high", cap: 200_000, ...o });

describe("offeredModels: OpenCode", () => {
  it("reads provider/model ids and the effort select by id or thought_level category", () => {
    expect(offeredModels(OPENCODE_OPTIONS)).toEqual({
      models: [
        { id: "anthropic/claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
        { id: "ollama/llama3.2:3b", name: "Llama 3.2" },
      ],
      efforts: ["low", "medium", "high"],
    });
  });

  it("reads Codex's options as before (D0)", () => {
    const codex = [
      { id: "model", type: "select", currentValue: "gpt-5.5", options: [{ value: "gpt-5.5", name: "GPT-5.5" }] },
      { id: "reasoning_effort", type: "select", currentValue: "medium", options: [{ value: "low" }, { value: "medium" }] },
    ];
    expect(offeredModels(codex)).toEqual({ models: [{ id: "gpt-5.5", name: "GPT-5.5" }], efforts: ["low", "medium"] });
  });
});

describe("AcpTransport: profile by config option (OpenCode)", () => {
  it("sets the model and the effort after session/new, never CODEX_CONFIG", async () => {
    const { transport: t, log } = setup({ configOptions: OPENCODE_OPTIONS, turns: [[{ stop: "end_turn" }]] }, undefined, { profileMethod: "config-option" });
    const events = await run(t, "hi", undefined, openProfile());
    expect(events.at(-1)).toEqual({ type: "done", ok: true });
    expect(log().find((l) => l.method === "env")?.params.CODEX_CONFIG).toBeNull();
    const sets = log().filter((l) => l.method === "session/set_config_option").map((l) => [l.params.configId, l.params.value]);
    expect(sets).toEqual([["model", "ollama/llama3.2:3b"], ["effort", "high"]]);
    const order = log().map((l) => l.method);
    expect(order.indexOf("session/set_config_option")).toBeGreaterThan(order.indexOf("session/new"));
    expect(order.indexOf("session/set_config_option")).toBeLessThan(order.indexOf("session/prompt"));
  });

  it("keeps the process and the session when the next turn's profile changes; sets only what changed", async () => {
    const { transport: t, log } = setup({ configOptions: OPENCODE_OPTIONS, turns: [[{ stop: "end_turn" }], [{ stop: "end_turn" }]] }, undefined, {
      profileMethod: "config-option",
    });
    await run(t, "one", undefined, openProfile());
    await run(t, "two", undefined, openProfile({ effort: "low" }));
    expect(log().filter((l) => l.method === "initialize")).toHaveLength(1);
    expect(log().filter((l) => l.method === "session/new")).toHaveLength(1);
    const sets = log().filter((l) => l.method === "session/set_config_option").map((l) => [l.params.configId, l.params.value]);
    expect(sets).toEqual([["model", "ollama/llama3.2:3b"], ["effort", "high"], ["effort", "low"]]);
  });

  it("sends no effort OpenCode does not offer, and no model for the default profile", async () => {
    const { transport: t, log } = setup({ configOptions: OPENCODE_OPTIONS, turns: [[{ stop: "end_turn" }]] }, undefined, { profileMethod: "config-option" });
    await run(t, "hi", undefined, openProfile({ model: undefined, effort: "max" }));
    expect(log().filter((l) => l.method === "session/set_config_option")).toEqual([]);
  });

  it("fails with model-unavailable when the model is not offered, without sending it", async () => {
    const { transport: t, log } = setup({ configOptions: OPENCODE_OPTIONS, turns: [[{ stop: "end_turn" }]] }, undefined, { profileMethod: "config-option" });
    const events = await run(t, "hi", undefined, openProfile({ model: "openai/gpt-9" }));
    expect(events.at(-1)).toMatchObject({ type: "done", ok: false, error: { code: "model-unavailable" } });
    expect(log().filter((l) => l.method === "session/set_config_option")).toEqual([]);
    expect(log().filter((l) => l.method === "session/prompt")).toEqual([]);
  });

  it("fails with model-unavailable when OpenCode refuses the model", async () => {
    const { transport: t } = setup(
      { configOptions: OPENCODE_OPTIONS, rejectConfigValues: ["ollama/llama3.2:3b"], turns: [[{ stop: "end_turn" }]] },
      undefined,
      { profileMethod: "config-option" },
    );
    const events = await run(t, "hi", undefined, openProfile());
    expect(events.at(-1)).toMatchObject({ type: "done", ok: false, error: { code: "model-unavailable" } });
  });

  it("starts a fresh session when a profile without a model follows one with a model", async () => {
    const { transport: t, log } = setup({ configOptions: OPENCODE_OPTIONS, turns: [[{ stop: "end_turn" }], [{ stop: "end_turn" }]] }, undefined, {
      profileMethod: "config-option",
    });
    await run(t, "one", undefined, openProfile());
    await run(t, "two", undefined, openProfile({ model: undefined }));
    expect(log().filter((l) => l.method === "session/new")).toHaveLength(2);
  });

  it("refreshes the offer from config_option_update: a removed model is unavailable on the next turn", async () => {
    const onlySonnet = [{ ...OPENCODE_OPTIONS[0], options: [OPENCODE_OPTIONS[0].options[0]] }, OPENCODE_OPTIONS[1]];
    const offers: unknown[] = [];
    const { transport: t } = setup(
      {
        configOptions: OPENCODE_OPTIONS,
        turns: [[{ update: { sessionUpdate: "config_option_update", configOptions: onlySonnet } }, { stop: "end_turn" }], [{ stop: "end_turn" }]],
      },
      undefined,
      { profileMethod: "config-option", onModels: (o) => offers.push(o) },
    );
    expect((await run(t, "one", undefined, openProfile())).at(-1)).toEqual({ type: "done", ok: true });
    expect(offers.at(-1)).toEqual({ models: [{ id: "anthropic/claude-sonnet-4-5", name: "Claude Sonnet 4.5" }], efforts: ["low", "medium", "high"] });
    const second = await run(t, "two", undefined, openProfile({ effort: "low" }));
    expect(second.at(-1)).toMatchObject({ type: "done", ok: false, error: { code: "model-unavailable" } });
  });

  it("reports the model it set as the turn's model", async () => {
    const { transport: t } = setup(
      { configOptions: OPENCODE_OPTIONS, usage: { inputTokens: 5, outputTokens: 2 }, turns: [[{ stop: "end_turn" }]] },
      undefined,
      { profileMethod: "config-option" },
    );
    const events = await run(t, "hi", undefined, openProfile());
    expect(events.find((e) => e.type === "usage")).toMatchObject({ model: "ollama/llama3.2:3b" });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/runtime/test/acp.test.ts -t "OpenCode"`
Expected: FAIL (the effort select is not found; `CODEX_CONFIG` is set; no `set_config_option`).

- [ ] **Step 3: Add the option to the transport**

In `packages/runtime/src/transport.ts`, in `TransportOptions` after `minAdapterVersion`:

```ts
  /**
   * ACP only: how a turn's model profile reaches the agent. `codex-config` (default): `CODEX_CONFIG` at spawn, a
   * new process when it changes. `config-option`: `session/set_config_option` on the open session (OpenCode).
   */
  profileMethod?: "codex-config" | "config-option";
```

- [ ] **Step 4: Find the effort select by id or category**

In `packages/runtime/src/acp.ts`, add after `selectOptions`:

```ts
/** The id of the effort select: Codex's `reasoning_effort`, OpenCode's `effort` (category `thought_level`). */
function effortOptionId(configOptions: unknown[]): string | undefined {
  const option = configOptions.find(
    (o): o is { id: string } =>
      typeof o === "object" &&
      o !== null &&
      typeof (o as { id?: unknown }).id === "string" &&
      (["reasoning_effort", "effort"].includes((o as { id: string }).id) || (o as { category?: unknown }).category === "thought_level"),
  );
  return option?.id;
}

/** The current value of a select config option (`currentValue`), when it is a safe model id. */
function currentModel(configOptions: unknown): string | undefined {
  if (!Array.isArray(configOptions)) return undefined;
  const option = configOptions.find((o) => typeof o === "object" && o !== null && (o as { id?: unknown }).id === "model") as { currentValue?: unknown } | undefined;
  return isModelId(option?.currentValue) ? option.currentValue : undefined;
}
```

In `offeredModels`, replace the `efforts` line:

```ts
  const effortId = effortOptionId(configOptions);
  const efforts = (effortId ? (selectOptions(configOptions, effortId) ?? []) : []).map((o) => o.value).filter(isEffort);
```

- [ ] **Step 5: Keep the offer and apply the profile**

In `AcpTransport`, add fields after `sawCompaction`:

```ts
  /** config-option: what the agent offers now (from session/new|load and config_option_update). */
  private offer: { models: string[]; efforts: string[]; effortId?: string } | undefined;
  /** config-option: the model and effort already set on the open session. */
  private applied: { model?: string; effort?: string } = {};
```

Add a getter and change `reportModels` so it keeps the offer:

```ts
  private get byConfigOption(): boolean {
    return this.o.profileMethod === "config-option";
  }

  private reportModels(configOptions: unknown): void {
    if (Array.isArray(configOptions)) {
      const offer = offeredModels(configOptions);
      const effortId = effortOptionId(configOptions);
      this.offer = {
        models: offer?.models.map((m) => m.id) ?? [],
        efforts: offer?.efforts ?? [],
        ...(effortId ? { effortId } : {}),
      };
    }
    const offer = offeredModels(configOptions);
    if (!offer) return;
    try {
      this.o.onModels?.(offer);
    } catch (err) {
      console.error("Could not record the engine's models", err);
    }
  }
```

In `openSession`, replace both `this.checkModel(…)` calls with a call to a new method `this.sessionModel(…)`, passing the `configOptions` too:

```ts
        this.sessionModel(loaded?.configOptions, loaded?.models?.currentModelId);
```

```ts
      this.sessionModel(created.configOptions, created.models?.currentModelId);
```

And on a fresh `session/new` or `session/load`, clear what was applied (first line of `openSession`):

```ts
    this.applied = {};
```

Add:

```ts
  /** The model the new session runs: Codex's is checked against the profile; OpenCode's is set afterwards. */
  private sessionModel(configOptions: unknown, currentModelId: unknown): void {
    if (this.byConfigOption) this.reportedModel = currentModel(configOptions);
    else this.checkModel(currentModelId);
  }

  /** OpenCode (spec §3): sets the profile's model and effort on the open session; only what changed. */
  private async applyProfile(): Promise<void> {
    const p = this.profile;
    if (!this.byConfigOption || !p) return;
    const agent = this.conn!.agent;
    const sessionId = this.sessionId!;
    // Checked on every turn: a config_option_update may have removed the model since it was set.
    if (p.model !== undefined && (!isModelId(p.model) || (this.offer && !this.offer.models.includes(p.model)))) {
      throw new ModelUnavailableError(`The agent does not offer ${String(p.model)}`);
    }
    if (p.model !== undefined && p.model !== this.applied.model) {
      let res: { configOptions?: unknown };
      try {
        res = (await agent.request("session/set_config_option" as never, { sessionId, configId: "model", value: p.model } as never)) as typeof res;
      } catch (e) {
        throw new ModelUnavailableError(`The agent refused ${p.model}: ${e instanceof Error ? e.message : String(e)}`);
      }
      this.applied.model = p.model;
      this.reportedModel = p.model;
      if (res?.configOptions) this.reportModels(res.configOptions);
    }
    const effortId = this.offer?.effortId;
    if (effortId && this.offer!.efforts.includes(p.effort) && p.effort !== this.applied.effort) {
      await agent.request("session/set_config_option" as never, { sessionId, configId: effortId, value: p.effort } as never);
      this.applied.effort = p.effort;
    }
  }
```

In `reset()`, add `this.offer = undefined;` and `this.applied = {};`.

- [ ] **Step 6: Use it in `turn`**

In `turn`, replace the block from `let config` down to `this.profile = profile;` with:

```ts
    let config: string | undefined;
    try {
      config = profile && !this.byConfigOption ? codexConfig(profile) : undefined;
    } catch (err) {
      // No ErrorCode fits a profile the core built wrong (it is not the plan's model, nor the user's
      // quota): agent-crashed is the generic "this turn could not run" card. The shell cleans every profile
      // first, so this is a last guard that should never show.
      emit(fail("agent-crashed", err instanceof Error ? err.message : String(err)));
      return;
    }
    // CODEX_CONFIG is read when the agent starts: a task on another profile needs a new process,
    // and a fresh session, so a saved one never resumes under another model (spec D2).
    if (this.spawned && config !== this.spawnedConfig) {
      await this.close();
      this.o.session = { id: randomUUID(), started: false };
    }
    // config-option: a session can't go back to the default model, so a profile without one starts afresh (D2).
    if (this.byConfigOption && this.applied.model !== undefined && profile?.model === undefined) {
      await this.close();
      this.o.session = { id: randomUUID(), started: false };
    }
    this.profile = profile;
```

Then replace the connect block:

```ts
    try {
      if (!this.conn || !this.sessionId) {
        if (!this.conn) await this.connect(config);
        await this.openSession();
      }
      await this.applyProfile();
    } catch (e) {
      const event = errorFrom(e, this.stderrTail);
      await this.close();
      emit(event);
      return;
    }
```

- [ ] **Step 7: Handle `config_option_update`**

In `onUpdate`, before `const emit = this.emit;`:

```ts
    // The offer changes with or without a turn running (OpenCode sends it when the provider's models change).
    if (u.sessionUpdate === "config_option_update") {
      this.reportModels(u.configOptions);
      return;
    }
```

- [ ] **Step 8: Run the tests**

Run: `corepack pnpm vitest run packages/runtime/test/acp.test.ts`
Expected: PASS, the existing Codex tests included (D0: `CODEX_CONFIG`, restarts and `checkModel` are unchanged for `codex-config`).
Then `corepack pnpm typecheck` and `corepack pnpm test`: green.

- [ ] **Step 9: Commit**

```bash
git -C <worktree> add packages/runtime
git -C <worktree> commit -m "feat(runtime): OpenCode's model and effort through session/set_config_option"
```

---

### Task 6: ACP — the cost of each turn

**Files:**
- Modify: `packages/runtime/src/events.ts` (the `usage` event)
- Modify: `packages/runtime/src/acp.ts`
- Test: `packages/runtime/test/acp.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/runtime/test/acp.test.ts`:

```ts
const costUpdate = (amount: number, currency = "USD") => ({ update: { sessionUpdate: "usage_update", used: 1000, size: 200_000, cost: { amount, currency } } });
const usageOf = (events: Event[]) => events.find((e): e is Extract<Event, { type: "usage" }> => e.type === "usage");

describe("usdCost", () => {
  it("takes a finite, non-negative USD amount only", () => {
    expect(usdCost({ amount: 0.25, currency: "USD" })).toBe(0.25);
    expect(usdCost({ amount: 0, currency: "USD" })).toBe(0);
    expect(usdCost({ amount: 1, currency: "EUR" })).toBeUndefined();
    expect(usdCost({ amount: -1, currency: "USD" })).toBeUndefined();
    expect(usdCost({ amount: Number.NaN, currency: "USD" })).toBeUndefined();
    expect(usdCost({ amount: "1", currency: "USD" })).toBeUndefined();
    expect(usdCost(undefined)).toBeUndefined();
  });
});

describe("AcpTransport: cost per turn", () => {
  const usage = { inputTokens: 10, outputTokens: 5 };

  it("records the first turn's total and each later turn's increase", async () => {
    const { transport: t } = setup({ usage, turns: [[costUpdate(0.02)], [costUpdate(0.02), costUpdate(0.05)]] });
    expect(usageOf(await run(t, "one"))?.costUsd).toBeCloseTo(0.02);
    expect(usageOf(await run(t, "two"))?.costUsd).toBeCloseTo(0.03);
  });

  it("records 0 for a local model", async () => {
    const { transport: t } = setup({ usage, turns: [[costUpdate(0)]] });
    expect(usageOf(await run(t))?.costUsd).toBe(0);
  });

  it("records no cost when the agent sends none, or another currency (D0 for Codex)", async () => {
    const { transport: t } = setup({ usage, turns: [[{ update: { sessionUpdate: "usage_update", used: 10, size: 100 } }], [costUpdate(1, "EUR")]] });
    expect(usageOf(await run(t, "one"))).not.toHaveProperty("costUsd");
    expect(usageOf(await run(t, "two"))).not.toHaveProperty("costUsd");
  });

  it("after loading a session, the first turn only sets the baseline", async () => {
    const { transport: t } = setup({ loadSession: true, usage, turns: [[costUpdate(0.5)], [costUpdate(0.8)]] }, { id: "saved", started: true });
    expect(usageOf(await run(t, "one"))).not.toHaveProperty("costUsd");
    expect(usageOf(await run(t, "two"))?.costUsd).toBeCloseTo(0.3);
  });

  it("a new session starts from zero again", async () => {
    const { transport: t } = setup({ usage, closeSession: true, turns: [[costUpdate(0.4)], [costUpdate(0.1)]] });
    await run(t, "one");
    await t.endSession();
    expect(usageOf(await run(t, "two"))?.costUsd).toBeCloseTo(0.1);
  });
});
```

Add `usdCost` to the import from `../src/acp`.

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/runtime/test/acp.test.ts -t "cost"`
Expected: FAIL ("usdCost is not exported").

- [ ] **Step 3: Add the field to the event**

In `packages/runtime/src/events.ts`, in the `usage` event after `costEquivalentUsd`:

```ts
      /** Real money the provider charged for this turn, in USD (OpenCode). Absent when the engine reports no cost. */
      costUsd?: number;
```

- [ ] **Step 4: Track the cost**

In `packages/runtime/src/acp.ts`, add after `errorFrom`:

```ts
/** A `usage_update` cost in USD: a finite amount ≥ 0 in "USD", else undefined (spec §4: other currencies are not recorded). */
export function usdCost(cost: unknown): number | undefined {
  const c = cost as { amount?: unknown; currency?: unknown } | null | undefined;
  return c && c.currency === "USD" && typeof c.amount === "number" && Number.isFinite(c.amount) && c.amount >= 0 ? c.amount : undefined;
}
```

In `AcpTransport`, add fields:

```ts
  /** The session's running cost in USD as the agent last reported it, and that total at the last turn's end. */
  private costTotal: number | undefined;
  private costBaseline: number | undefined;
```

In `openSession`'s load branch, add `this.costTotal = undefined; this.costBaseline = undefined;` just above the `try` that sends `session/load` (a `usage_update` may arrive while it loads). Right after `this.sessionId = this.o.session.id;`, add:

```ts
        // A total the agent reported while the session loaded is where this run starts counting.
        this.costBaseline = this.costTotal;
```

In the `session/new` branch, right after `this.sessionId = created.sessionId;`:

```ts
      this.costTotal = undefined;
      this.costBaseline = 0;
```

In `onUpdate`, before `const emit = this.emit;` (next to the `config_option_update` case):

```ts
    if (u.sessionUpdate === "usage_update") {
      const usd = usdCost(u.cost);
      if (usd !== undefined) this.costTotal = usd;
    }
```

Add a method:

```ts
  /** This turn's cost: the rise of the running total since the last turn; undefined when either end is unknown. */
  private turnCost(): number | undefined {
    const total = this.costTotal;
    if (total === undefined) return undefined;
    const base = this.costBaseline;
    this.costBaseline = total;
    return base === undefined ? undefined : Math.max(0, total - base);
  }
```

In `turn`, replace the `if (res.usage) { emit({ … }) }` block with:

```ts
      const costUsd = this.turnCost();
      if (res.usage) {
        emit({
          type: "usage",
          inputTokens: res.usage.inputTokens ?? 0,
          outputTokens: res.usage.outputTokens ?? 0,
          cacheReadTokens: res.usage.cachedReadTokens ?? 0,
          cacheWriteTokens: res.usage.cachedWriteTokens ?? 0,
          ...(this.reportedModel ? { model: this.reportedModel } : {}),
          ...(costUsd !== undefined ? { costUsd } : {}),
        });
      }
```

Note (A8): a cost is recorded only with token usage. If the spike shows OpenCode's prompt answer has no `usage`, change this block to emit the `usage` event whenever `res.usage` **or** `costUsd` is there, with zero tokens in the second case, and add a test for it.

In `reset()`, add `this.costTotal = undefined; this.costBaseline = undefined;`.

- [ ] **Step 5: Run the tests**

Run: `corepack pnpm vitest run packages/runtime/test/acp.test.ts`
Expected: PASS. Then `corepack pnpm typecheck` and `corepack pnpm test`: green.

- [ ] **Step 6: Commit**

```bash
git -C <worktree> add packages/runtime
git -C <worktree> commit -m "feat(runtime): each ACP turn's cost in USD from usage_update"
```

---

### Task 7: ACP — `auth_required` asks to sign in again

The transport already maps ACP error `-32000` (`auth_required`) to `session-expired`. This task pins that for OpenCode with a test (spec §2, A9).

**Files:**
- Test: `packages/runtime/test/acp.test.ts`

- [ ] **Step 1: Write the test**

```ts
describe("AcpTransport: auth_required (OpenCode)", () => {
  it("maps -32000 on a prompt to session-expired and closes the process", async () => {
    const { transport: t, log } = setup({ turns: [[{ error: { code: -32000, message: "Authentication required" } }], [{ stop: "end_turn" }]] }, undefined, {
      profileMethod: "config-option",
    });
    const events = await run(t);
    expect(events.at(-1)).toMatchObject({ type: "done", ok: false, error: { code: "session-expired" } });
    await run(t);
    expect(log().filter((l) => l.method === "initialize")).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it**

Run: `corepack pnpm vitest run packages/runtime/test/acp.test.ts -t "auth_required"`
Expected: PASS. If the spike (A9) found another code, it FAILS: add that code next to `-32000` in `errorFrom`, then run again.

- [ ] **Step 3: Commit**

```bash
git -C <worktree> add packages/runtime
git -C <worktree> commit -m "test(runtime): OpenCode's auth_required asks to sign in again"
```

---

### Task 8: One place for an engine's ACP options

Three places build ACP options: `runtime.ts`, `system.ts` and the shell's `engine-check.ts`. Each must now pass `profileMethod`.

**Files:**
- Modify: `packages/runtime/src/transport.ts`
- Modify: `packages/runtime/src/index.ts` (export)
- Modify: `packages/runtime/src/runtime.ts:151-155`
- Modify: `packages/runtime/src/system.ts:63-64`
- Modify: `packages/shell/src/main/engine-check.ts`
- Test: `packages/runtime/test/runtime.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/runtime/test/runtime.test.ts`:

```ts
import { getEngine } from "@humanharness/engines";
import { acpFields } from "../src/transport";

describe("acpFields", () => {
  it("gives OpenCode its modes and the config-option profile", () => {
    expect(acpFields(getEngine("opencode"), "folder")).toEqual({ sessionMode: "build", minAdapterVersion: undefined, profileMethod: "config-option" });
    expect(acpFields(getEngine("opencode"), "none")).toEqual({ sessionMode: "plan", minAdapterVersion: undefined, profileMethod: "config-option" });
  });

  it("gives Codex what it had, and Claude nothing (D0)", () => {
    expect(acpFields(getEngine("codex"), "folder")).toEqual({ sessionMode: "workspace-write", minAdapterVersion: "2.2.2", profileMethod: undefined });
    expect(acpFields(getEngine("claude"), "folder")).toEqual({ sessionMode: undefined, minAdapterVersion: undefined, profileMethod: undefined });
  });
});
```

(Merge the imports with the file's existing ones.)

- [ ] **Step 2: Run it to see it fail**

Run: `corepack pnpm vitest run packages/runtime/test/runtime.test.ts -t "acpFields"`
Expected: FAIL ("acpFields is not exported").

- [ ] **Step 3: Write the helper**

In `packages/runtime/src/transport.ts`, change the engines import to `import type { Effort, EngineDef, ModelChoice, ModelProfile } from "@humanharness/engines";` and add:

```ts
/** The ACP fields of an engine's transport options: the mode for the harness's edit permission, the adapter gate, the profile method. */
export function acpFields(
  engine: EngineDef,
  edit: "folder" | "none",
): Pick<TransportOptions, "sessionMode" | "minAdapterVersion" | "profileMethod"> {
  const t = engine.transport;
  if (t.kind !== "acp") return { sessionMode: undefined, minAdapterVersion: undefined, profileMethod: undefined };
  return { sessionMode: t.modes?.[edit === "folder" ? "edit" : "readOnly"], minAdapterVersion: t.minAdapterVersion, profileMethod: t.profile };
}
```

Export it from `packages/runtime/src/index.ts` (next to the `transport` exports: `export { acpFields } from "./transport";` if the file exports by name, otherwise it is already covered by `export *`).

- [ ] **Step 4: Use it in the three places**

`packages/runtime/src/runtime.ts`: replace the `sessionMode:` and `minAdapterVersion:` entries with:

```ts
      ...acpFields(engine, harness.permissions.edit),
```

`packages/runtime/src/system.ts`: replace its two lines with:

```ts
    ...acpFields(o.engine, "none"),
```

`packages/shell/src/main/engine-check.ts`: import `acpFields` from `@humanharness/runtime` and replace its two lines with:

```ts
    ...acpFields(engine, "none"),
```

(If `harness.permissions.edit` has another type than `"folder" | "none"`, widen `acpFields`' parameter to that type.)

- [ ] **Step 5: Run the tests**

Run: `corepack pnpm vitest run packages/runtime packages/shell/test/engine-check.test.ts`
Expected: PASS. Then `corepack pnpm typecheck`, `corepack pnpm test` and `corepack pnpm app:build`: green.

- [ ] **Step 6: Commit**

```bash
git -C <worktree> add packages/runtime packages/shell/src/main/engine-check.ts
git -C <worktree> commit -m "refactor(runtime): one place for an engine's ACP options, with the profile method"
```

---

### Task 9: Status — `opencode auth list`

**Files:**
- Create: `packages/shell/test/fixtures/opencode-auth-list-empty.txt`, `opencode-auth-list-one.txt` (from the spike; inline text below if it did not run)
- Modify: `packages/shell/src/main/engine-status.ts`
- Test: `packages/shell/test/engine-status.test.ts`

- [ ] **Step 1: The fixtures**

If Task 1 saved them, use those. Otherwise create them with this text (the assumed format, A3).

`opencode-auth-list-empty.txt`:

```
┌  Credentials ~/.local/share/opencode/auth.json
│
└  0 credentials
```

`opencode-auth-list-one.txt`:

```
┌  Credentials ~/.local/share/opencode/auth.json
│
●  OpenRouter api
│
└  1 credentials

┌  Environment
│
●  Anthropic ANTHROPIC_API_KEY
│
└  1 environment variable
```

- [ ] **Step 2: Write the failing tests**

Add to `packages/shell/test/engine-status.test.ts`:

```ts
const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");

describe("countProviders (opencode-auth-list)", () => {
  it("counts the listed providers, in both sections", () => {
    expect(countProviders(fixture("opencode-auth-list-one.txt"))).toBe(2);
    expect(countProviders(fixture("opencode-auth-list-empty.txt"))).toBe(0);
  });

  it("ignores colours and unknown lines", () => {
    expect(countProviders("\u001b[32m●\u001b[0m  OpenRouter api\n")).toBe(1);
    expect(countProviders("something else\n")).toBe(0);
  });
});

describe("parseLoggedIn: opencode-auth-list", () => {
  it("is signed in with a provider, signed out without one or on a failure", () => {
    expect(parseLoggedIn("opencode-auth-list", { stdout: fixture("opencode-auth-list-one.txt"), code: 0 })).toBe(true);
    expect(parseLoggedIn("opencode-auth-list", { stdout: fixture("opencode-auth-list-empty.txt"), code: 0 })).toBe(false);
    expect(parseLoggedIn("opencode-auth-list", { stdout: fixture("opencode-auth-list-one.txt"), code: 1 })).toBe(false);
  });
});

describe("detectEngine: OpenCode", () => {
  const opencode = getEngine("opencode");
  const opencodeDeps = (list: string) =>
    deps({ "--version": { stdout: "1.2.3\n", code: 0 }, "auth list": { stdout: list, code: 0 } }, { isExecutable: async (p) => p === "/Users/me/.opencode/bin/opencode" });

  it("is ready with a provider", async () => {
    const { d } = opencodeDeps(fixture("opencode-auth-list-one.txt"));
    expect(await detectEngine(opencode, d, store())).toMatchObject({ installed: true, loggedIn: true });
  });

  it("asks to choose a provider when none is listed and no test prompt worked", async () => {
    const { d } = opencodeDeps(fixture("opencode-auth-list-empty.txt"));
    expect(await detectEngine(opencode, d, store())).toMatchObject({ installed: true, loggedIn: false, verified: false });
  });

  it("counts a past test prompt as set up (local models only)", async () => {
    const s = store();
    await s.update("opencode", { verifiedAt: "2026-10-27T10:00:00.000Z" });
    const { d } = opencodeDeps(fixture("opencode-auth-list-empty.txt"));
    expect(await detectEngine(opencode, d, s)).toMatchObject({ installed: true, loggedIn: null, verified: true });
  });

  it("keeps Claude's and Codex's answers as they were (D0)", async () => {
    const s = store();
    await s.update("claude", { verifiedAt: "2026-10-27T10:00:00.000Z" });
    const { d } = deps({ "--version": { stdout: "2.1.296 (Claude Code)", code: 0 }, "auth status --json": { stdout: signedOut, code: 1 } });
    expect(await detectEngine(getEngine("claude"), d, s)).toMatchObject({ loggedIn: false, verified: false });
  });
});
```

Add `countProviders` to the import from `../src/main/engine-status`. Note the fixture deps: `isExecutable` answers for `~/.opencode/bin` — Task 10 adds that folder. Until then, write `"/Users/me/.local/bin/opencode"` here and change it in Task 10.

- [ ] **Step 3: Run them to see them fail**

Run: `corepack pnpm vitest run packages/shell/test/engine-status.test.ts`
Expected: FAIL ("countProviders is not exported").

- [ ] **Step 4: Implement**

In `packages/shell/src/main/engine-status.ts`, add:

```ts
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
/** A provider line of `opencode auth list`: a bullet, then a name. */
const PROVIDER_LINE = /^[●○]\s+\S/;

/**
 * How many providers `opencode auth list` lists (credentials and environment). Only the count is read: names,
 * paths and keys in the output are never kept or logged (compliance rule 1).
 */
export function countProviders(stdout: string): number {
  return stdout.split(/\r?\n/).filter((line) => PROVIDER_LINE.test(line.replace(ANSI, "").trim())).length;
}
```

In `parseLoggedIn`, before the `json-logged-in` branch:

```ts
  if (format === "opencode-auth-list") return out.code === 0 && countProviders(out.stdout) > 0;
```

In `detectEngine`, replace the `loggedIn = …` line inside `if (engine.setup && !outdated)`:

```ts
    loggedIn = s.timedOut || s.spawnError ? null : parseLoggedIn(engine.setup.status.format, s);
    // OpenCode with local models only lists no provider: a test prompt that worked says it is set up (spec §2).
    if (loggedIn === false && engine.setup.status.format === "opencode-auth-list" && record.verifiedAt) loggedIn = null;
```

- [ ] **Step 5: Run the tests**

Run: `corepack pnpm vitest run packages/shell/test/engine-status.test.ts`
Expected: PASS. Then `corepack pnpm typecheck`, `corepack pnpm test` and `corepack pnpm app:build`: green.

- [ ] **Step 6: Commit**

```bash
git -C <worktree> add packages/shell
git -C <worktree> commit -m "feat(shell): OpenCode's status from auth list; a working local model counts"
```

---

### Task 10: Where OpenCode lives, and folders the app never uses

**Files:**
- Modify: `packages/shell/src/main/engine-command.ts` (`knownBinDirs`)
- Modify: `packages/shell/src/main/validate.ts` (`PROTECTED`)
- Modify: `packages/shell/src/main/references.ts` (doc comment only)
- Test: `packages/shell/test/engine-command.test.ts`, `validate.test.ts`, `engine-status.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/shell/test/engine-command.test.ts`:

```ts
describe("knownBinDirs", () => {
  it("includes OpenCode's install folder after the others", () => {
    expect(knownBinDirs("/Users/me")).toEqual(["/Users/me/.local/bin", "/opt/homebrew/bin", "/usr/local/bin", "/Users/me/.opencode/bin"]);
  });
});
```

In `packages/shell/test/validate.test.ts` (use the file's existing `folderProblem` import and home):

```ts
  it("never uses OpenCode's own folders, or a folder above them", () => {
    const home = "/Users/me";
    for (const f of ["/Users/me/.local/share/opencode", "/Users/me/.local/share/opencode/x", "/Users/me/.config/opencode", "/Users/me/.opencode", "/Users/me/.local"]) {
      expect(folderProblem(f, home)).toBe("protected");
    }
  });
```

(If `folderProblem` already refuses `~/.local` for another reason, keep that line; the point is that it is refused.)

In `engine-status.test.ts`, change the Task 9 `isExecutable` path back to `"/Users/me/.opencode/bin/opencode"`.

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/shell/test/engine-command.test.ts packages/shell/test/validate.test.ts packages/shell/test/engine-status.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`engine-command.ts`:

```ts
/** Folders official installers use, searched after PATH: a fresh install may not be on the login PATH yet. */
export const knownBinDirs = (home: string): string[] => [
  path.join(home, ".local/bin"),
  "/opt/homebrew/bin",
  "/usr/local/bin",
  // OpenCode's installer (spike A1).
  path.join(home, ".opencode/bin"),
];
```

`validate.ts`:

```ts
/** Folders holding CLI credentials and app data: never inside or above them. Path checks only, never read. */
const PROTECTED = [".claude", ".codex", ".gemini", ".config/opencode", ".local/share/opencode", ".opencode", "Library"];
```

`references.ts`: in `referenceAllowed`'s comment, add `~/.opencode, ~/.local/share/opencode` to the list of examples. (Dot-folders were already refused; no code change.)

- [ ] **Step 4: Run the tests**

Same command as Step 2. Expected: PASS. Then `corepack pnpm typecheck`, `corepack pnpm test` and `corepack pnpm app:build`: green.

- [ ] **Step 5: Commit**

```bash
git -C <worktree> add packages/shell
git -C <worktree> commit -m "feat(shell): find OpenCode in its install folder; its folders are never the harness folder"
```

---

### Task 11: Cost in the usage log and the summary

**Files:**
- Modify: `packages/ui/src/client.ts` (`TurnUsage`, `UsageSummary`)
- Modify: `packages/shell/src/main/chat-log.ts:150-157`
- Modify: `packages/ui/src/state.ts` (the live `usage` case)
- Modify: `packages/shell/src/main/usage-log.ts`
- Test: `packages/shell/test/chat-log.test.ts`, `packages/shell/test/usage-log.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/shell/test/usage-log.test.ts`:

```ts
describe("summarizeUsage: spentUsd", () => {
  const now = new Date("2026-10-27T12:00:00.000Z");
  const line = (at: string, costUsd?: number): UsageRecord => ({
    at,
    engine: "opencode",
    ok: true,
    usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, ...(costUsd !== undefined ? { costUsd } : {}) },
  });

  it("adds up the cost of the last 30 days", () => {
    const s = summarizeUsage([line("2026-09-01T00:00:00.000Z", 5), line("2026-10-20T00:00:00.000Z", 0.25), line("2026-10-27T11:00:00.000Z", 0.5)], undefined, now);
    expect(s.spentUsd).toBeCloseTo(0.75);
  });

  it("is 0 for local models, and absent when no line has a cost (D0)", () => {
    expect(summarizeUsage([line("2026-10-27T11:00:00.000Z", 0)], undefined, now).spentUsd).toBe(0);
    expect(summarizeUsage([line("2026-10-27T11:00:00.000Z")], undefined, now)).not.toHaveProperty("spentUsd");
  });

  it("counts every profile's spending (one account pays)", () => {
    const s = profilesUsage({ ana: [line("2026-10-27T10:00:00.000Z", 0.1)], ben: [line("2026-10-27T11:00:00.000Z", 0.2)] }, "ana", undefined, now);
    expect(s.spentUsd).toBeCloseTo(0.3);
  });
});
```

In `packages/shell/test/chat-log.test.ts` (use the file's existing way to build a turn and `finish` it):

```ts
  it("keeps the turn's cost in its usage, only when the engine reported one", () => {
    const r = new TurnRecorder(new Set());
    r.add({ type: "usage", inputTokens: 3, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.004 });
    expect(r.finish({ type: "done", ok: true }).usage).toEqual({ inputTokens: 3, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.004 });
    const plain = new TurnRecorder(new Set());
    plain.add({ type: "usage", inputTokens: 3, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 });
    expect(plain.finish({ type: "done", ok: true }).usage).not.toHaveProperty("costUsd");
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/shell/test/usage-log.test.ts packages/shell/test/chat-log.test.ts`
Expected: FAIL.

- [ ] **Step 3: Types**

In `packages/ui/src/client.ts`:

```ts
export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** What the provider charged for the turn, in USD (OpenCode). Absent when the engine reports no cost. */
  costUsd?: number;
}
```

In `UsageSummary`, after `material`:

```ts
  /** USD the engine reported over the last 30 days (OpenCode; every profile's turns). Absent when no turn reported a cost. */
  spentUsd?: number;
```

- [ ] **Step 4: Keep the cost in the chat entry**

In `packages/shell/src/main/chat-log.ts`, the `usage` branch:

```ts
    else if (e.type === "usage") {
      this.usage = {
        inputTokens: e.inputTokens,
        outputTokens: e.outputTokens,
        cacheReadTokens: e.cacheReadTokens,
        cacheWriteTokens: e.cacheWriteTokens,
        ...(e.costUsd !== undefined ? { costUsd: e.costUsd } : {}),
      };
    }
```

Do the same spread in `packages/ui/src/state.ts`'s `case "usage":`.

Check the material stage (`packages/shell/src/main/material-stage.ts`): if it builds `TurnUsage` from the `usage` event by hand, add the same spread there, so a stage's cost reaches `usage.jsonl` too.

- [ ] **Step 5: Add up the spending**

In `packages/shell/src/main/usage-log.ts`, add:

```ts
/** The spending window of Settings › Usage (spec §4). */
export const SPENT_DAYS = 30;

/** USD spent in the last SPENT_DAYS days; undefined when no line has a cost (D0: Claude and Codex never do). */
function spentUsd(records: UsageRecord[], now: Date): number | undefined {
  const withCost = records.filter((r) => typeof r.usage?.costUsd === "number");
  if (withCost.length === 0) return undefined;
  const since = now.getTime() - SPENT_DAYS * 86_400_000;
  return withCost.filter((r) => Date.parse(r.at) >= since).reduce((sum, r) => sum + r.usage!.costUsd!, 0);
}
```

In `summarizeUsage`'s return, after the `material` spread:

```ts
    ...(() => {
      const spent = spentUsd(all, now);
      return spent !== undefined ? { spentUsd: spent } : {};
    })(),
```

(Or compute `const spent = spentUsd(all, now);` above the `return` and spread `...(spent !== undefined ? { spentUsd: spent } : {})`; prefer that.)

`profilesUsage` already spreads the merged summary, so `spentUsd` covers every profile. Check that its destructuring does not drop it.

- [ ] **Step 6: Run the tests**

Run: `corepack pnpm vitest run packages/shell/test/usage-log.test.ts packages/shell/test/chat-log.test.ts packages/ui/test/state.test.ts`
Expected: PASS. Then `corepack pnpm typecheck`, `corepack pnpm test` and `corepack pnpm app:build`: green.

- [ ] **Step 7: Commit**

```bash
git -C <worktree> add packages/shell packages/ui
git -C <worktree> commit -m "feat(usage): record each turn's cost and add up the last 30 days"
```

---

### Task 12: Settings › Usage shows the spending

**Files:**
- Modify: `packages/ui/src/client.ts` (`EngineOption.reportsCost`)
- Modify: `packages/ui/src/UsageTab.tsx`
- Modify: `packages/i18n/src/locales/en.json` (`usage.spent`, `usage.spentCaption`, `usage.noLimitsCost`)
- Test: `packages/ui/test/usage-tab.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `packages/ui/test/usage-tab.test.tsx`:

```ts
function opencode(): FakeClient {
  const client = new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo", engineId: "opencode" });
  client.state.engines = [{ ...client.state.engines[0], id: "opencode", name: "OpenCode", provider: "OpenCode", reportsLimits: false, reportsCost: true, plansUrl: undefined }];
  client.state.actions = ACTIONS;
  return client;
}

describe("UsageTab: OpenCode", () => {
  it("says the engine reports cost, and shows the last 30 days' spending", async () => {
    const client = opencode();
    client.usage = { limits: null, estimates: {}, tokens: {}, spentUsd: 1.234 };
    await renderIn("en", <UsageTab client={client} state={client.state} />);
    await screen.findByText("Spent in the last 30 days");
    expect(screen.getByText("US$ 1.23")).toBeTruthy();
    expect(screen.getByText("OpenCode reports it. With local models it is 0.")).toBeTruthy();
    expect(screen.getByText("OpenCode reports what each reply costs, not a plan's limits. Your provider bills you for it.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /plans/ })).toBeNull();
  });

  it("shows US$ 0.00 for local models", async () => {
    const client = opencode();
    client.usage = { limits: null, estimates: {}, tokens: {}, spentUsd: 0 };
    await renderIn("en", <UsageTab client={client} state={client.state} />);
    expect(await screen.findByText("US$ 0.00")).toBeTruthy();
  });

  it("shows no spending row without spentUsd (D0)", async () => {
    const client = codex();
    client.usage = { limits: null, estimates: {}, tokens: {} };
    await renderIn("en", <UsageTab client={client} state={client.state} />);
    await screen.findByText(/Codex doesn't tell the app how much you have left/);
    expect(screen.queryByText("Spent in the last 30 days")).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/ui/test/usage-tab.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Strings**

In `packages/i18n/src/locales/en.json`, inside `"usage"`:

```json
    "spent": "Spent in the last 30 days",
    "spentAmount": "US$ {{amount}}",
    "spentCaption": "{{engine}} reports it. With local models it is 0.",
    "noLimitsCost": "{{engine}} reports what each reply costs, not a plan's limits. Your provider bills you for it.",
```

- [ ] **Step 4: The field and the row**

`packages/ui/src/client.ts`, in `EngineOption` after `reportsLimits`:

```ts
  /** The engine reports each turn's cost in USD (OpenCode). Absent for the others. */
  reportsCost?: boolean;
```

`packages/ui/src/UsageTab.tsx`, in `PlanSection`, before the `!engine.reportsLimits` line:

```tsx
  if (engine.reportsCost) return <p className="hh-caption">{t("usage.noLimitsCost", { engine: engine.name })}</p>;
```

In `UsageTab`, after the material caption:

```tsx
      {/* OpenCode spec §4: real money, as the engine reported it (only when a turn reported a cost). */}
      {usage?.spentUsd !== undefined && engine && (
        <>
          <div className="hh-rows">
            <div className="hh-row">
              <span>{t("usage.spent")}</span>
              <span>
                {t("usage.spentAmount", {
                  amount: usage.spentUsd.toLocaleString(shownLanguage(i18n), { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                })}
              </span>
            </div>
          </div>
          <p className="hh-caption">{t("usage.spentCaption", { engine: engine.name })}</p>
        </>
      )}
```

`useTranslation()` in `UsageTab` must return `i18n` too: `const { t, i18n } = useTranslation();` (it already does).

- [ ] **Step 5: Run the tests**

Run: `corepack pnpm vitest run packages/ui/test/usage-tab.test.tsx`
Expected: PASS. Then `corepack pnpm typecheck`, `corepack pnpm test` and `corepack pnpm app:build`: green.

- [ ] **Step 6: Commit**

```bash
git -C <worktree> add packages/ui packages/i18n
git -C <worktree> commit -m "feat(ui): Settings › Usage shows what OpenCode reports as spent"
```

---

### Task 13: Main process — what the window learns, and Terminal steps

**Files:**
- Modify: `packages/ui/src/client.ts` (`EngineOption`, `HarnessClient`)
- Modify: `packages/shell/src/main/install-help.ts`
- Modify: `packages/shell/src/main/index.ts` (engine options ~line 326; `hh:runSetup` ~line 1335; new `hh:copySetupCommand`)
- Modify: `packages/shell/src/preload/index.ts`
- Modify: `packages/ui/test/fake-client.ts`
- Test: `packages/shell/test/install-help.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/shell/test/install-help.test.ts`:

```ts
import { getEngine } from "@humanharness/engines";
import { engineOptionExtras, setupCommandText } from "../src/main/install-help";

describe("setupCommandText", () => {
  it("is the plain command the person pastes in Terminal", () => {
    expect(setupCommandText(getEngine("opencode"), "login")).toBe("opencode auth login");
    expect(setupCommandText(getEngine("opencode"), "logout")).toBe("opencode auth logout");
  });

  it("refuses a step the engine runs itself", () => {
    expect(() => setupCommandText(getEngine("claude"), "login")).toThrow();
    expect(() => setupCommandText(getEngine("opencode"), "update" as never)).toThrow();
  });
});

describe("engineOptionExtras", () => {
  it("gives the window OpenCode's facts", () => {
    expect(engineOptionExtras(getEngine("opencode"))).toEqual({
      reportsCost: true,
      userProvider: true,
      providersUrl: "https://opencode.ai/docs/providers/",
      terminalSteps: { login: "opencode auth login", logout: "opencode auth logout" },
    });
  });

  it("adds nothing for Claude or Codex (D0)", () => {
    expect(engineOptionExtras(getEngine("claude"))).toEqual({});
    expect(engineOptionExtras(getEngine("codex"))).toEqual({});
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/shell/test/install-help.test.ts`
Expected: FAIL.

- [ ] **Step 3: Types for the window**

`packages/ui/src/client.ts`, in `EngineOption` after `reportsCost`:

```ts
  /** The person picks the provider inside the engine (OpenCode): the notice says its terms are theirs. */
  userProvider?: boolean;
  /** The engine's guide to choosing a provider. */
  providersUrl?: string;
  /** Steps the person runs in Terminal, with the command to paste. */
  terminalSteps?: { login?: string; logout?: string };
```

In `HarnessClient`, after `copyInstallCommand`:

```ts
  /** Copies the command for a step the person runs in Terminal (`terminalSteps`). */
  copySetupCommand(engineId: string, step: "login" | "logout"): Promise<void>;
```

- [ ] **Step 4: The helpers**

`packages/shell/src/main/install-help.ts`:

```ts
import type { EngineOption } from "@humanharness/ui/client";

/** The command for a step the person runs in Terminal: the binary's name and the step's args, never a path. */
export function setupCommandText(engine: EngineDef, step: "login" | "logout"): string {
  const setup = engine.setup;
  if (!setup?.inTerminal?.includes(step)) throw new Error(`${engine.id} runs ${step} itself`);
  return [engine.detect.binary, ...setup[step]].join(" ");
}

/** What the window learns beyond the common fields; empty for engines without these facts (D0). */
export function engineOptionExtras(engine: EngineDef): Pick<EngineOption, "reportsCost" | "userProvider" | "providersUrl" | "terminalSteps"> {
  const setup = engine.setup;
  const steps = Object.fromEntries((setup?.inTerminal ?? []).map((s) => [s, setupCommandText(engine, s)]));
  return {
    ...(engine.reportsCost ? { reportsCost: true } : {}),
    ...(setup?.providersUrl ? { userProvider: true, providersUrl: setup.providersUrl } : {}),
    ...(Object.keys(steps).length ? { terminalSteps: steps } : {}),
  };
}
```

`install-help.ts` is in the main process; it may import the UI's **types** (`import type`).

- [ ] **Step 5: Wire it in `index.ts`**

In the real engine branch of `engines: …` (after `...(e.plansUrl ? …)`):

```ts
          ...engineOptionExtras(e),
```

In `hh:runSetup`, right after `if (!SETUP_STEPS.includes(step)) throw …`:

```ts
    // A step the person runs in Terminal (OpenCode's provider picker) is never run by the app.
    if ((step === "login" || step === "logout") && engine.setup?.inTerminal?.includes(step)) return { ok: false };
```

Next to `hh:copyInstallCommand`:

```ts
  handle("hh:copySetupCommand", (engineId: string, step: unknown) => {
    if (step !== "login" && step !== "logout") throw new Error("Unknown setup step");
    clipboard.writeText(setupCommandText(engineFor(engineId), step));
  });
```

Import `engineOptionExtras` and `setupCommandText` from `./install-help`.

`packages/shell/src/preload/index.ts`, after `copyInstallCommand`:

```ts
  copySetupCommand: (engineId: string, step: "login" | "logout") => ipcRenderer.invoke("hh:copySetupCommand", engineId, step),
```

`packages/ui/test/fake-client.ts`, after `copyInstallCommand`:

```ts
  /** Commands copied for Terminal steps, as "engine:step". */
  setupCopied: string[] = [];
  async copySetupCommand(engineId: string, step: "login" | "logout") {
    if (this.copyError) throw this.copyError;
    this.setupCopied.push(`${engineId}:${step}`);
  }
```

(The field goes with the other fields at the top of the class.)

- [ ] **Step 6: Run the tests**

Run: `corepack pnpm vitest run packages/shell/test/install-help.test.ts`
Expected: PASS. Then `corepack pnpm typecheck`, `corepack pnpm test` and `corepack pnpm app:build`: green.

- [ ] **Step 7: Commit**

```bash
git -C <worktree> add packages/shell packages/ui
git -C <worktree> commit -m "feat(shell): OpenCode's facts for the window; its login and logout are copied for Terminal"
```

---

### Task 14: Window — choose a provider, the notice line, sign out in Terminal

**Files:**
- Modify: `packages/ui/src/EngineOnboarding.tsx`
- Modify: `packages/ui/src/EngineTab.tsx:86-94, 180-186`
- Modify: `packages/i18n/src/locales/en.json` (`engine.*`)
- Test: `packages/ui/test/engine-tab.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `packages/ui/test/engine-tab.test.tsx`:

```ts
const addOpenCode = (client: FakeClient) => {
  client.state.engines = [
    ...client.state.engines,
    {
      ...client.state.engines[0],
      id: "opencode",
      name: "OpenCode",
      provider: "OpenCode",
      requires: "An account or API key with a provider you set up in OpenCode, or a local model (Ollama)",
      reportsLimits: false,
      reportsCost: true,
      userProvider: true,
      providersUrl: "https://opencode.ai/docs/providers/",
      terminalSteps: { login: "opencode auth login", logout: "opencode auth logout" },
    },
  ];
};

describe("EngineTab: OpenCode", () => {
  it("says in the notice that the provider's terms are the person's", async () => {
    const client = withFolder();
    addOpenCode(client);
    client.statusFor.opencode = { ...client.status, engineId: "opencode", noticeAccepted: false };
    await renderIn("en", <Tab client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: /OpenCode/ }));
    await screen.findByRole("heading", { name: "Before using OpenCode" });
    expect(screen.getByText("You choose the provider in OpenCode. Its terms and privacy rules apply between you and that provider.")).toBeTruthy();
  });

  it("asks to choose a provider in Terminal, never runs the login itself", async () => {
    const client = withFolder();
    addOpenCode(client);
    client.statusFor.opencode = { ...client.status, engineId: "opencode", loggedIn: false, verified: false };
    await renderIn("en", <Tab client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: /OpenCode/ }));
    await screen.findByRole("heading", { name: "Choose a provider in OpenCode" });
    expect(screen.getByText("opencode auth login")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy command" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Terminal" }));
    await waitFor(() => expect(client.setupCopied).toEqual(["opencode:login"]));
    expect(client.terminalOpened).toBe(1);
    expect(client.setupRuns).toEqual([]);
    expect(screen.getByRole("link", { name: "OpenCode's guide to providers" }).getAttribute("href")).toBe("https://opencode.ai/docs/providers/");
  });

  it("tests a local model from the same card", async () => {
    const client = withFolder();
    addOpenCode(client);
    client.statusFor.opencode = { ...client.status, engineId: "opencode", loggedIn: false, verified: false };
    await renderIn("en", <Tab client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: /OpenCode/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Test my local model" }));
    await waitFor(() => expect(client.tested).toEqual(["opencode"]));
  });

  it("signs out in Terminal", async () => {
    const client = withFolder();
    addOpenCode(client);
    client.statusFor.opencode = { ...client.status, engineId: "opencode" };
    await renderIn("en", <Tab client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: /OpenCode/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    await screen.findByText("Finish signing out in Terminal, then press Check again.");
    expect(client.setupCopied).toEqual(["opencode:logout"]);
    expect(client.terminalOpened).toBe(1);
    expect(client.setupRuns).toEqual([]);
  });
});
```

The existing tests for Claude and Codex stay as they are (D0).

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run packages/ui/test/engine-tab.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Strings**

In `packages/i18n/src/locales/en.json`, inside `"engine"`:

```json
    "noticeUserProvider": "You choose the provider in {{engine}}. Its terms and privacy rules apply between you and that provider.",
    "providerTitle": "Choose a provider in {{engine}}",
    "providerText": "{{engine}} works with the provider you pick: an API key you have, or a model on this computer. You set it up in {{engine}} itself; the app never sees your key.",
    "providerStep1": "Open Terminal and paste the command.",
    "providerStep2": "Pick a provider and follow the steps. Your key stays in {{engine}}.",
    "providerStep3": "Come back and press \"Check again\".",
    "providerRecheck": "Check again",
    "providerLocal": "Using a local model (Ollama)? Set it up in {{engine}}, then test it.",
    "providerLocalTest": "Test my local model",
    "providerDocs": "{{engine}}'s guide to providers",
    "signOutTerminal": "Finish signing out in Terminal, then press Check again.",
```

- [ ] **Step 4: The notice line**

In `EngineOnboarding.tsx`, in the `problem === "notice"` body, after the `noticeAccount` paragraph:

```tsx
        {engine.userProvider && <p>{t("engine.noticeUserProvider", v)}</p>}
```

- [ ] **Step 5: The provider card**

In `EngineOnboarding.tsx`, add after `copyCommand`:

```tsx
  const copySetup = async (step: "login" | "logout") => {
    try {
      await client.copySetupCommand(engine.id, step);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  };
```

Replace the `problem === "logged-out"` branch with:

```tsx
  } else if (problem === "logged-out" && engine.terminalSteps?.login) {
    // OpenCode (spec §2): the person picks a provider in OpenCode's own login, in Terminal. The app runs nothing there.
    body = (
      <>
        <h3>{t("engine.providerTitle", v)}</h3>
        <p>{t("engine.providerText", v)}</p>
        <code>{engine.terminalSteps.login}</code>
        <ol aria-label={t("engine.providerTitle", v)}>
          <li>{t("engine.providerStep1")}</li>
          <li>{t("engine.providerStep2", v)}</li>
          <li>{t("engine.providerStep3")}</li>
        </ol>
        <p>
          <button className="hh-primary" onClick={() => void copySetup("login")}>
            {t("engine.copyCommand")}
          </button>{" "}
          <button onClick={() => void client.openTerminal().catch(() => {})}>{t("engine.openTerminal")}</button>{" "}
          <button disabled={busy !== null || rechecking} onClick={() => void recheck()}>
            {t("engine.providerRecheck")}
          </button>{" "}
          {copy === "copied" && <span role="status">{t("engine.copied")}</span>}
        </p>
        {copy === "failed" && (
          <p className="hh-save-error" role="alert">
            {t("engine.copyFailed")}
          </p>
        )}
        <p>
          {t("engine.providerLocal", v)}{" "}
          <button disabled={busy !== null} onClick={() => void runTest()}>
            {t("engine.providerLocalTest")}
          </button>
        </p>
        {engine.providersUrl && <p>{link(engine.providersUrl, t("engine.providerDocs", v))}</p>}
      </>
    );
  } else if (problem === "logged-out") {
```

(The rest of the old `logged-out` branch stays as it is, now under this `else if`.)

After a successful "Test my local model", `runTest` calls `refresh()`; Task 9 makes the status `loggedIn: null`, so the card goes away.

In the "untested" branch, the "sign in again" button calls `runStep("login")`. For an engine with `terminalSteps.login`, show the provider card's copy button instead:

```tsx
            {failed === "step" && (status.loggedIn === null || testError?.code === "session-expired") &&
              (engine.terminalSteps?.login ? (
                <button onClick={() => void copySetup("login").then(() => client.openTerminal().catch(() => {}))}>{t("errors.fix.session-expired", v)}</button>
              ) : (
                <button onClick={() => void runStep("login")}>{t("errors.fix.session-expired", v)}</button>
              ))}
```

- [ ] **Step 6: Sign out in Terminal**

In `EngineTab.tsx`, add a state `const [signOutHint, setSignOutHint] = useState(false);` and change `signOut`:

```tsx
  const signOut = async () => {
    if (!selected) return;
    const target = state.engines.find((e) => e.id === selected);
    // OpenCode (spec §2): the person signs out in Terminal; the app copies the command and opens it.
    if (target?.terminalSteps?.logout) {
      setFailed(false);
      try {
        await client.copySetupCommand(selected, "logout");
        await client.openTerminal();
        setSignOutHint(true);
      } catch {
        setFailed(true);
      }
      return;
    }
    setBusy("logout");
    setFailed(false);
    const result = await client.runSetup(selected, "logout").catch(() => ({ ok: false }));
    setBusy(null);
    await refresh(selected);
    if (!result.ok) setFailed(true);
  };
```

Under the "ready" row (after the closing `</div>` of the first `.hh-row`), add:

```tsx
                {signOutHint && (
                  <div className="hh-row">
                    <span role="status">{t("engine.signOutTerminal")}</span>
                    <button onClick={() => void refresh(engine.id).then(() => setSignOutHint(false))}>{t("engine.providerRecheck")}</button>
                  </div>
                )}
```

Reset `signOutHint` to `false` when `selected` changes (in the effect that already runs on `selected`, or a new `useEffect(() => setSignOutHint(false), [selected])`).

- [ ] **Step 7: Run the tests**

Run: `corepack pnpm vitest run packages/ui/test/engine-tab.test.tsx packages/ui/test/setup-flow.test.tsx packages/ui/test/home.test.tsx`
Expected: PASS. Then `corepack pnpm typecheck`, `corepack pnpm test` and `corepack pnpm app:build`: green.

- [ ] **Step 8: Commit**

```bash
git -C <worktree> add packages/ui packages/i18n
git -C <worktree> commit -m "feat(ui): choose a provider in OpenCode, test a local model, sign out in Terminal"
```

---

### Task 15: The demo offers OpenCode; one end-to-end run

**Files:**
- Modify: `harnesses/demo/harness.config.ts:43,54`
- Modify: `packages/cli/src/main.ts:16`, `packages/cli/src/run.ts:632`
- Modify: `packages/e2e/tests/helpers.ts`
- Create: `packages/e2e/tests/opencode.spec.ts`

- [ ] **Step 1: The demo and the CLI help**

`harnesses/demo/harness.config.ts`:

```ts
  engines: ["claude", "codex", "opencode"],
```

and the "engines" topic's description:

```ts
    engines: topic("engines", "Engines", "How Claude, Codex or OpenCode is detected, installed and connected without the app handling keys."),
```

`packages/cli/src/main.ts` and `packages/cli/src/run.ts`: change `[--engine claude|codex]` to `[--engine claude|codex|opencode]` in both usage strings.

Run `corepack pnpm vitest run harnesses/demo packages/cli` and update any test that pins those strings or the demo's `engines`.

- [ ] **Step 2: Fake OpenCode in every end-to-end launch**

The demo now lists OpenCode, so every launch must fake it too (no status check may reach a real CLI). In `packages/e2e/tests/helpers.ts`:
- `Sandbox` gets `opencodeLog: string` ("fake-acp appends every request it gets as OpenCode here"), set to `path.join(root, "opencode-log.jsonl")` in `makeFreshSandbox`;
- `makeSandbox` writes `engines: { claude: ready, codex: ready, opencode: ready }`;
- `launch`'s `scripts` type becomes `{ claude: ClaudeScript; codex?: AcpScript; opencode?: AcpScript }` and `engines` gets:

```ts
    opencode: { command: fakeAcpCommand(), env: { HH_FAKE_SCRIPT: writeScript(s.root, scripts.opencode ?? idleCodex), HH_FAKE_LOG: s.opencodeLog } },
```

- [ ] **Step 3: Write the end-to-end test**

`packages/e2e/tests/opencode.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { closeAndClean, launch, makeSandbox, readJsonl } from "./helpers";
import { claudeTextLines } from "@humanharness/fake-agent";

const OPTIONS = [
  { id: "model", type: "select", currentValue: "ollama/llama3.2:3b", options: [{ value: "ollama/llama3.2:3b", name: "Llama 3.2" }] },
  { id: "effort", category: "thought_level", type: "select", currentValue: "medium", options: [{ value: "low" }, { value: "medium" }, { value: "high" }] },
];
const text = (t: string) => ({ update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: t } } });
const cost = (amount: number) => ({ update: { sessionUpdate: "usage_update", used: 1200, size: 128_000, cost: { amount, currency: "USD" } } });

test("OpenCode answers a question, gets its effort by config option, and Settings › Usage shows the spending", async () => {
  const s = makeSandbox("opencode", { engineId: "opencode" });
  const { app, page } = await launch(s, {
    claude: { steps: claudeTextLines("unused") },
    opencode: { configOptions: OPTIONS, usage: { inputTokens: 900, outputTokens: 40 }, turns: [[text("Se guarda en .harness/chats."), cost(0.0123)]] },
  });
  try {
    await page.getByRole("button", { name: "Start Demo" }).click();
    await page.getByPlaceholder("Or ask something…").fill("¿Dónde se guarda la conversación?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("main").getByText("Se guarda en .harness/chats.")).toBeVisible();

    const log = readJsonl<{ method: string; params: Record<string, unknown> }>(s.opencodeLog);
    // No CODEX_CONFIG for OpenCode; a free question is light: effort "low", OpenCode's default model.
    expect(log.find((l) => l.method === "env")?.params.CODEX_CONFIG).toBeNull();
    expect(log.filter((l) => l.method === "session/set_config_option").map((l) => [l.params.configId, l.params.value])).toEqual([["effort", "low"]]);
    expect(log.find((l) => l.method === "session/set_mode")?.params.modeId).toBe("build");

    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("tab", { name: "Usage" }).click();
    await expect(page.getByText("Spent in the last 30 days")).toBeVisible();
    await expect(page.getByText("US$ 0.01")).toBeVisible();
  } finally {
    await closeAndClean(app, s);
  }
});
```

Notes for the implementer:
- Check the demo's `permissions.edit`. If it is `"none"`, the mode is `plan`; change the assertion.
- If the start screen in `flow.spec.ts` needs another click before the question box shows, copy those clicks.
- `makeSandbox` saves `language: "es"`; the buttons' names here are the English ones `flow.spec.ts` uses (plan 5a).

- [ ] **Step 4: Run it**

Run: `corepack pnpm app:build` then `corepack pnpm e2e`
Expected: every spec passes, the new one included.

- [ ] **Step 5: Commit**

```bash
git -C <worktree> add harnesses/demo packages/cli packages/e2e
git -C <worktree> commit -m "feat(demo): offer OpenCode; an end-to-end run with cost and config options"
```

---

### Task 16: Docs — the core spec and the spec's status

**Files:**
- Modify: `docs/superpowers/specs/2026-10-10-humanharness-core-design.md:110-127`
- Modify: `docs/superpowers/specs/2026-10-26-opencode-engine-design.md` (header status)
- Modify: `README.md` (only if it lists the engines)

- [ ] **Step 1: The engine status table**

After the Codex row (line ~112), add:

```markdown
| OpenCode | `opencode acp`, user's own provider set up in OpenCode | **allowed** | MIT, unmodified; ACP documented by OpenCode. Provider terms are the user's; the notice says so. Claude Pro/Max does not work through it (Anthropic forbids it); an Anthropic API key does |
```

- [ ] **Step 2: v1 engines and rule 1**

Change `**v1 engines:** Claude and Codex.` to `**v1 engines:** Claude, Codex and OpenCode. A harness manifest's \`engines\` may include \`"opencode"\`; the demo does.`

Change rule 1 to: `1. Never read, copy, forward or refresh tokens. Never read \`~/.claude\`, \`~/.codex\`, \`~/.gemini\`, \`~/.config/opencode\` or \`~/.local/share/opencode\`.`

- [ ] **Step 3: The spec's status and known limits**

In the OpenCode spec's header: `Status: approved design; implemented by plan 2026-10-27-opencode-engine.md.` At the end of §4 keep the line about child sessions. Add one line to §3: "The context cap is not sent to OpenCode; it compacts on its own (plan Q4)."

- [ ] **Step 4: README**

`grep -n "Codex" README.md`. Where the README lists the engines, add OpenCode with one sentence: "OpenCode (any provider you set up in it, or a local model)".

- [ ] **Step 5: Run everything once more**

Run: `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm app:build`.
Expected: green.

- [ ] **Step 6: Commit**

```bash
git -C <worktree> add docs README.md
git -C <worktree> commit -m "docs: OpenCode as the third engine in the core spec"
```

---

## Self-review against the spec

| Spec | Task |
|---|---|
| D1 app installs, user configures; no keys | 2 (install, `inTerminal`), 9 (only the count), 10 (protected folders), 13–14 (Terminal) |
| D2 `allowed` | 2, 16 |
| D3 generic notice | 2 (texts), 13 (`userProvider`), 14 (notice line) |
| D4 models from OpenCode | 3, 5 |
| D5 cost, not windows | 6, 11, 12 |
| §1 registry | 2 (+ `reportsCost`, `providersUrl`, efforts default: Decisions) |
| §2 install, login, status, ACP auth, logout | 2, 7, 9, 10, 13, 14 |
| §3 models, efforts, `set_config_option`, `profile` field, tiers, `model-unavailable` | 3, 5, 8 |
| §4 usage, cost delta, `costUsd`, tokens, Settings row, child sessions | 6, 11, 12, 16 |
| §5 permissions, modes, MCP, one prompt at a time | unchanged code; 2 (modes), 15 (mode asserted) |
| §6 core spec changes, demo | 15, 16 |
| §7 testing: unit, fake agent, real (manual) | 2–14 (unit), 4–7 (fake agent), 15 (e2e), 1 (real) |
| §8 spike | 1 |
