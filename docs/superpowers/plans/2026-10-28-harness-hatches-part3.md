# Harness hatches, part 3 (H3: engine config per scope) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship delivery slice 5 of the harness hatches spec (§9): a harness that declares `enginePresets: true` lets each scope carry its own engine config in `.harness/engine/<scope>/` (base, instructions, MCP servers, Claude settings, skills, agents, `codex.toml`, action layers). The person approves every change by hash; until then new sessions start without it. Approved config reaches Claude (`--settings`, `--mcp-config`, `--plugin-dir`, `--agents`, and the `global` base) and Codex (`mcpServers`, `CODEX_CONFIG`), always from a snapshot in the app's data folder, never from the live folder. A harness without `enginePresets` is byte for byte today's app.

**Architecture.**

*Manifest.* `enginePresets: true` (needs `scopes`) in `packages/harness-sdk/src/hatches.ts`. The spec names no manifest key; this plan adds the opt-in so D0 holds by construction (Decision 1).

*Reading and cleaning (main, pure where possible)* in `packages/shell/src/main/engine-config/`:
- `toml-lite.ts`: the TOML subset `codex.toml` needs (no dependency is installed; Decision 4).
- `frontmatter.ts`: flat YAML frontmatter for `SKILL.md` and `agents/*.md`.
- `clean.ts`: allowlists for `settings.json`, `mcp.json` and `codex.toml`; refusals name the key.
- `script-refs.ts`: finds files named by hook and server commands inside the folder or a linked folder.
- `read-config.ts`: reads a scope's engine folder (with action layers) into an `EngineConfig`, with every refusal, and the hash over every file plus the referenced scripts.
- `snapshot.ts`: writes the approved config to `<userData>/engine-config/<hash>/` (skills as a plugin folder, `agents.json`, cleaned `settings.json`, `mcp.json`, `codex.json`, `instructions.md`) and reads it back.
- `engine-host.ts`: the per-task decision: approved and unchanged → the snapshot as an `EnginePreset`; else none plus a notice. Pinned per task.

*Runtime.* `TurnScope` (part 1) gains `engine?: EnginePreset`. Claude: one merged `--settings` (part 1's `additionalDirectories` plus the cleaned preset), the preset's servers in `--mcp-config`, `--plugin-dir <snapshot>`, `--agents <snapshot>/agents.json`, and `global` → `--setting-sources user,project` without `--strict-mcp-config`. ACP: servers in `session/new`/`session/load`; on Codex, `codex.json` merged into `CODEX_CONFIG` (allowlist) so a new hash restarts the process as a new profile does today; OpenCode gets servers only.

*Approval.* `.harness/scopes.json` entry gains `engineApproval?: { hash, at }`. `hh:engineConfig` returns the view (everything §5.3 lists, refusals, the current hash, approved or not); `hh:engineApprove(scope, hash)` approves only when `hash` equals the hash computed right then. The scope settings (part 1's `ScopeSettings`) gain an "Engine config" section.

**Tech Stack:** TypeScript, Node `fs`/`crypto`, Zod, React 19, Vitest, Playwright (mock mode).

**Spec:** `docs/superpowers/specs/2026-10-27-harness-hatches-design.md` §5 (5.1–5.4), §2 D2–D4, §6 S1–S2, §7 H3 tests, §9 slice 5. **Base:** part 2's end on `feat/harness-hatches` (which includes origin/master b9529a5: the context panel's `ContextItem` with the reserved kind `"scope-instructions"`, `contextFor` returning `{ text, items }`, `claudeArgs` with `mcpOnly`, the `translate` and `review` MCP servers). **Branch:** `feat/harness-hatches` (continues).

---

## Conventions

As in part 1 (worktree, commands, install nothing, git rules, trailer, en.json only in the `"hatches"` block, hot files additive). Trailer:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv
```

UI strings ship in English (language on demand translates them): the spec's Spanish samples become "Engine config", "Also uses your global Claude config", "On Codex, your own Codex config always applies", "Runs commands on your computer", "Engine config not approved · Review", "Scope instructions".

## D0 is a hard rule

A harness without `enginePresets: true` runs no part-3 code:
- `defineHarness` output has no `enginePresets` key; `.harness/engine/` is neither read, watched, tracked nor created;
- `claudeArgs` is byte-identical (same `--setting-sources project`, `--strict-mcp-config`, `--mcp-config`, one `--settings` only when part 1's folders need it, no `--plugin-dir`, no `--agents`);
- `CODEX_CONFIG`, `session/new` params and the ACP process lifecycle are unchanged;
- the first message, `AGENTS.md`, the context items and the history's tracked paths are unchanged;
- no `engineApproval` key in `scopes.json`, no `<userData>/engine-config/`;
- no `hh:engine*` channel, no "Engine config" section, no notice on tasks.

A scope of an opted-in harness with no `.harness/engine/<scope>/` folder (or an empty one) is also D0 for that scope's sessions: nothing to approve, no notice, args unchanged.

| D0 item | Pinned by |
|---|---|
| Manifest | `packages/harness-sdk/test/hatches.test.ts` "D0: no enginePresets key without it" (Task 1) |
| Claude argv | `packages/runtime/test/hatches-d0.test.ts` (part 1) gains "D0: no engine preset → part 1's argv" and "an empty preset folder changes nothing" (Task 7) |
| ACP | `packages/runtime/test/acp.test.ts` "D0: CODEX_CONFIG and session/new unchanged without a preset" (Task 8) |
| History | `packages/workspace/test/layout.test.ts` "D0: .harness/engine is not kept without enginePresets" (Task 1) |
| First message and items | `packages/shell/test/engine-config/engine-host.test.ts` "D0: no preset, the task's first message and items are unchanged" (Task 9) |
| IPC | `packages/shell/test/hatches-surface.test.ts` "engine channels are registered only under enginePresets" (Task 10) |
| UI | `packages/ui/test/engine-config-ui.test.tsx` "D0: no Engine config section, no notice" (Task 11) |
| E2E | `packages/e2e/tests/history.spec.ts` and `mock.spec.ts` unchanged (Task 12) |

## Threat model (part 3)

The scope's engine folder is written by anyone who can write the person's folder, including the agent. Everything in it can run code (hooks, MCP servers, skills that ask for tools). The approval is the boundary.

| # | Boundary | What enforces it | Test |
|---|---|---|---|
| E1 | Nothing unapproved reaches an engine | `engine-host` passes a preset only when `engineApproval.hash` equals the hash computed now; otherwise none, and a notice | `engine-host.test.ts` "a changed file drops the preset from new sessions" (Task 9) |
| E2 | The hash covers referenced scripts | `script-refs.ts` adds every file a hook command or server command/arg names inside the folder or a linked folder; changing one changes the hash | `read-config.test.ts` "a change to a referenced script changes the hash" (Task 5) |
| E3 | Snapshot, not live folder | engines get only `<userData>/engine-config/<hash>/`; the snapshot is written from the bytes that were hashed (one read), re-hashed on use, and a mismatch is refused | `snapshot.test.ts` "an edit to the live folder after approval is not loaded" (Task 6) |
| E4 | Refused config keys | `settings.json`: only `hooks` and `permissions.{allow,deny,ask}` pass; `env`, `apiKeyHelper`, any key naming auth or a token, `permissions.additionalDirectories`, `permissions.defaultMode`, `defaultMode` are refused or dropped; `codex.toml` allowlist; `mcp.json` env names that look like credentials refused; refused at hash time with the key named | `clean.test.ts` (Task 4) |
| E5 | Manifest permissions always win | preset `allow` rules: edit tools dropped under `permissions.edit: "none"`, path rules outside the folder and its linked folders refused; preset `deny` kept; harness `--disallowedTools` unchanged and always passed | `clean.test.ts`, `claude-cli.test.ts` "manifest denies over a preset allow" (Tasks 4, 7) |
| E6 | Agent definitions can't add hooks, servers or a mode | `agents/*.md` frontmatter `hooks` and `mcpServers` refused (v1, Decision 6); `permissionMode` dropped and shown; skill frontmatter `hooks` refused | `frontmatter.test.ts`, `read-config.test.ts` (Tasks 3, 5) |
| E7 | Never reading `~/.claude` or `~/.codex` | the `global` base only changes flags; the app opens no file outside the person's folder, linked folders and its data folder | source scan in `read-config.test.ts` "never names an engine home" (Task 5) |
| E8 | No symlink escape, no size bombs | the reader `lstat`s every entry, refuses symlinks, caps files at 256 KB, the folder at 2 MB and 200 files, depth 4 | `read-config.test.ts` (Task 5) |
| E9 | Server names can't hijack core servers | preset servers are renamed `scope-<name>`; `<name>` must match `^[a-z0-9][a-z0-9-]{0,39}$`; the result may not equal a core or harness server name (`ui`, `data`, `translate`, `review`, harness ids) | `clean.test.ts` (Task 4) |
| E10 | Approval only of what was shown | `hh:engineApprove(scope, hash)` recomputes and approves only when equal; `scope` looked up with `Object.hasOwn` in the store, length-bounded | `engine-ipc.test.ts` (Task 10) |

## Decisions this plan takes where the spec leaves room

1. **`enginePresets: true` opt-in** in the manifest, requiring `scopes`. Without it the core never reads `.harness/engine/` (D0 by construction).
2. **Pinned per task.** A task records the preset hash it started with (`TaskRecord.engineHash`); later turns of that task use the same snapshot even if a new hash is approved meanwhile (spec "running sessions keep the config they started with"). A task that started without a preset stays without one.
3. **"Scope instructions"** go in the task's first message after the brief, under `## Scope instructions`, with action-layer instructions after the scope's. The context panel lists them as kind `"scope-instructions"` (reserved on master), label "Scope instructions".
4. **No TOML/YAML dependency.** Nothing may be installed: `toml-lite.ts` parses tables, dotted keys, strings (basic and literal), integers, floats, booleans, arrays and inline tables; anything else is a parse error naming the line. Frontmatter is flat `key: value` plus `key: [a, b]` lists and `|` blocks; anything else is refused naming the key.
5. **Settings allowlist:** `hooks` (the Claude hooks shape: event → matchers → `{ type: "command", command, timeout? }`), `permissions.allow`, `permissions.deny`, `permissions.ask`. `defaultMode` and `permissions.defaultMode` are dropped and shown as "ignored". Every other key is refused naming it.
6. **Agent `hooks` and `mcpServers` refused in v1**; `permissionMode` dropped (shown as "ignored"). The spec allows showing them; refusing is simpler and safer, and can be lifted later (Open question 3).
7. **`url` MCP servers refused in v1** (stdio only): the screen would need to explain remote servers and their auth (Open question 4).
8. **Server names** are prefixed `scope-<name>` on every engine (spec §5.2 lets the core prefix to beat Codex's same-name rule).
9. **`codex.toml` allowlist:** `model_reasoning_summary`, `model_verbosity`, `hide_agent_reasoning`, `show_raw_agent_reasoning`, `hooks`, `tools.web_search`, `sandbox_workspace_write.network_access`, `features.*` booleans. `instructions` is refused (scope instructions go through `instructions.md`). Refused by name: `model_provider`, `model_providers`, any key ending `_api_key`, `cli_auth_credentials_store`, `chatgpt_base_url`, `mcp_servers` (use `mcp.json`), `profile`, `profiles`, `model`, `model_reasoning_effort`, `model_auto_compact_token_limit` (the core owns the profile keys). Anything else: refused naming the key.
10. **Base on OpenCode:** instructions and servers only; `settings.json`, skills, agents and `codex.toml` are listed as "not used on OpenCode".
11. **Approval is per scope** (spec §10 Q3): no bulk approval. Action layers are approved with their scope (one hash).
12. **The engine folder is tracked** by the history (spec §5.1) only with `enginePresets`: `layout.ts` adds `.harness/engine/**` to `keep`.
13. **Snapshot cleanup:** snapshots not referenced by any scope's approval nor by a task record younger than 30 days are trashed at start, as part 1's `pruneUnlinked`.
14. **The Codex limit** shows in the section whenever the harness supports Codex (its `engines` list includes `codex`), whatever the active engine: "On Codex, your own Codex config always applies."

## File structure

| File | Change | Responsibility |
|---|---|---|
| `packages/harness-sdk/src/hatches.ts`, `index.ts` | Modify | `enginePresets`, `hasEnginePresets`, `hatchProblems` |
| `packages/workspace/src/layout.ts` | Modify | `engineConfigDir`, keep `.harness/engine/**` when declared |
| `packages/workspace/src/scopes.ts` | Modify | `engineApproval` on the entry, `approveEngine` |
| `packages/shell/src/main/engine-config/toml-lite.ts` | Create | TOML subset |
| `packages/shell/src/main/engine-config/frontmatter.ts` | Create | flat frontmatter |
| `packages/shell/src/main/engine-config/clean.ts` | Create | settings / mcp / codex allowlists |
| `packages/shell/src/main/engine-config/script-refs.ts` | Create | referenced scripts |
| `packages/shell/src/main/engine-config/read-config.ts` | Create | reader, refusals, hash |
| `packages/shell/src/main/engine-config/snapshot.ts` | Create | snapshot write/read/prune |
| `packages/shell/src/main/engine-config/engine-host.ts` | Create | per-task preset, notice, first-message section |
| `packages/shell/src/main/engine-config/engine-ipc.ts` | Create | `hh:engineConfig`, `hh:engineApprove` |
| `packages/runtime/src/transport.ts` | Modify | `EnginePreset` on `TurnScope` |
| `packages/runtime/src/claude-cli.ts` | Modify | preset args |
| `packages/runtime/src/acp.ts` | Modify | preset servers, `CODEX_CONFIG` merge |
| `packages/shell/src/main/task-manager.ts`, `task-store.ts` | Modify | `engineHash` on the task; scope instructions item |
| `packages/shell/src/main/index.ts`, `linked-ipc.ts` | Modify | wiring; `hatchesState.enginePresets` |
| `packages/ui/src/hatches/EngineConfig.tsx`, `EngineNotice.tsx`; `ScopeSettings.tsx`, `ChatView.tsx` | Create/Modify | the section and the notice |
| `packages/ui/src/client.ts`, preload, fake client | Modify | `client.engineConfig` |
| `packages/fake-agent/fixtures/hatches-harness/` | Modify | `enginePresets: true` |
| `packages/e2e/tests/hatches-engine.spec.ts` | Create | e2e |
| docs | Modify | `hatches.md` (H3), `manifest.md`, `engines.md`, `context.md`, `history.md`, `data.md` |

## Overlaps

- **Part 1**: `TurnScope`, `scopeSettingsArgs`, `scopeAccessFor` and `ScopeSettings.tsx` are extended, not replaced. Part 1's single `--settings` becomes the merged one (Task 7) and part 1's goldens stay as they are (no preset).
- **Part 2**: the backend may write the engine folder; it gets no approval path (the window only).
- **Model tiers (`codexConfig`)**: the merged `CODEX_CONFIG` keeps the profile keys the core writes; the preset can't set them (Decision 9). `spawnedConfig` comparison already restarts the process on any change.
- **Context panel (master)**: `ContextItemKind` already has `"scope-instructions"`; `startItems` builds the start list: add the item there.
- **Language on demand (master)**: the `translate` server name is reserved (E9).
- **Doc review (master)**: the `review` server name is reserved (E9).
- **Sidekick `noTools` / language `mcpOnly`** sessions never get a preset (they are not tasks): `claudeArgs` refuses `engine` with either, as part 1 refuses `linked`.
- **Plugins**: unrelated; plugins never write the engine folder through an API.

## Open questions (each with the default this plan takes)

1. Opt-in key name `enginePresets: true` (Decision 1).
2. Pinned per task vs. per turn (Decision 2: per task).
3. Agent `hooks`/`mcpServers` refused in v1 rather than shown (Decision 6).
4. `url` MCP servers refused in v1 (Decision 7).
5. The exact `codex.toml` allowlist (Decision 9) needs Marco's look before release; S1's "to check live" items (a trusted linked folder's `.codex/config.toml`, the TOML → JSON conversion) stay open.
6. Bulk approval for a process import: none (spec §10 Q3).
7. S2's "to check live" items (`--plugin-dir` with `--setting-sources project` and `--strict-mcp-config`, again on `--resume`; agent `tools` against `--disallowedTools`) are checked once in Task 7's manual step, not by tests (no engine runs in tests).

## Standing rules

As in part 1.

## Self-review (done while writing)

- Spec coverage:
  - §5.1 files and history: Tasks 1, 5.
  - §5.2 instructions: Task 9; mcp: Tasks 4, 7, 8; settings: Tasks 4, 7; skills/agents from snapshot: Tasks 3, 6, 7; `codex.toml`: Tasks 2, 4, 8; base on Claude: Task 7; base on Codex and the limit: Tasks 8, 11; action layers: Tasks 5, 9.
  - §5.3 what is shown: Task 11; approving and hash: Tasks 5, 6, 10; referenced scripts: Task 5; on change: Task 9; highlights: Task 11.
  - §5.4 limits: Tasks 4, 7.
  - §7 H3 tests: each named in Tasks 4–12; E2E "approve a preset and see its instructions in the next task": Task 12.
- Types: `EngineConfig`, `EngineRefusal`, `EngineLayer` (Task 5); `EnginePreset` (Task 7); `EngineConfigView` (Task 10); `engineApproval` (Task 6); `engineHash` (Task 9).

---

### Task 0: Base check

- [ ] **Step 1:** `git -C <worktree> branch --show-current` is `feat/harness-hatches`; the last commit is part 2's docs commit; status clean.
- [ ] **Step 2:** `git -C <worktree> grep -n '"scope-instructions"' packages/` finds the `ContextItemKind` member (from the origin/master merge). If missing, stop and report: the base lacks the context panel.
- [ ] **Step 3:** `corepack pnpm typecheck`, `corepack pnpm test` green. Base line in `carry-notes.md`. No commit.

---

### Task 1: `enginePresets` in the manifest; the folder in the layout

**Files:**
- Modify: `packages/harness-sdk/src/hatches.ts`, `packages/harness-sdk/src/index.ts`, `packages/workspace/src/layout.ts`
- Test: `packages/harness-sdk/test/hatches.test.ts` (append), `packages/workspace/test/layout.test.ts` (append)

- [ ] **Step 1: Write the failing tests.**

```ts
describe("enginePresets (hatches spec §5)", () => {
  it("D0: no enginePresets key without it", () => {
    const h = defineHarness(withScopes);
    expect("enginePresets" in h).toBe(false);
    expect(hasEnginePresets(h)).toBe(false);
  });
  it("takes true only", () => {
    expect(defineHarness({ ...withScopes, enginePresets: true }).enginePresets).toBe(true);
    expect(() => defineHarness({ ...withScopes, enginePresets: false as unknown as true })).toThrow();
  });
  it("needs scopes", () => {
    expect(hatchProblems({ ...base, enginePresets: true })).toContain("enginePresets needs scopes");
  });
});
```

```ts
describe("engine config folder", () => {
  it("engineConfigDir is .harness/engine/<scope>", () => {
    expect(engineConfigDir("/w", "intro")).toBe(path.join("/w", ".harness", "engine", "intro"));
  });
  it("refuses a scope id that escapes", () => {
    expect(() => engineConfigDir("/w", "../x")).toThrow();
  });
  it("D0: .harness/engine is not kept without enginePresets", () => {
    expect(historyKeep({ enginePresets: false })).not.toContain(".harness/engine/**");
    expect(historyKeep({ enginePresets: true })).toContain(".harness/engine/**");
  });
});
```

(`historyKeep` is whatever `layout.ts` exports for the tracked paths today; if the keep list is built elsewhere — `appHistoryKeep` — add the option there and test that function. Keep today's call without the option byte-identical.)

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** `hatches.ts`: `enginePresets: z.literal(true).optional()` in the schema (via `index.ts`), `hasEnginePresets = (h) => h.enginePresets === true`, `hatchProblems` adds `"enginePresets needs scopes"`. `layout.ts`: `engineConfigDir(folder, scope)` using the same scope-id check the scopes module uses (`SCOPE_ID` regex), and the keep option.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Typecheck, test, commit.**

```bash
git -C <worktree> add packages/harness-sdk/src/hatches.ts packages/harness-sdk/src/index.ts packages/harness-sdk/test/hatches.test.ts packages/workspace/src/layout.ts packages/workspace/test/layout.test.ts
git -C <worktree> commit -m "feat(sdk): enginePresets opt-in; the scope's engine folder in the layout" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 2: A TOML subset parser [parallel with 3, 4]

**Files:**
- Create: `packages/shell/src/main/engine-config/toml-lite.ts`
- Test: `packages/shell/test/engine-config/toml-lite.test.ts`

- [ ] **Step 1: Write the failing tests.**

```ts
import { describe, expect, it } from "vitest";
import { parseToml } from "../../src/main/engine-config/toml-lite";

describe("parseToml (Decision 4)", () => {
  it("keys, strings, numbers, booleans", () => {
    expect(parseToml('a = "x"\nb = 3\nc = 1.5\nd = true\ne = \'lit\\n\'')).toEqual({ a: "x", b: 3, c: 1.5, d: true, e: "lit\\n" });
  });
  it("basic string escapes", () => {
    expect(parseToml('a = "q\\"t\\n\\u00e9"')).toEqual({ a: 'q"t\né' });
  });
  it("tables and dotted keys", () => {
    expect(parseToml("[features]\nx = true\n[tools]\nweb_search = false\nsandbox_workspace_write.network_access = true")).toEqual({
      features: { x: true },
      tools: { web_search: false, sandbox_workspace_write: { network_access: true } },
    });
  });
  it("arrays (multi-line too) and inline tables", () => {
    expect(parseToml('a = [1, 2,\n 3]\nb = { c = "d", e = [true] }')).toEqual({ a: [1, 2, 3], b: { c: "d", e: [true] } });
  });
  it("arrays of tables", () => {
    expect(parseToml('[[hooks.PreToolUse]]\nmatcher = "Bash"\n[[hooks.PreToolUse]]\nmatcher = "Edit"')).toEqual({
      hooks: { PreToolUse: [{ matcher: "Bash" }, { matcher: "Edit" }] },
    });
  });
  it("comments and blank lines", () => {
    expect(parseToml('# c\n\na = 1 # trailing\nb = "# not a comment"')).toEqual({ a: 1, b: "# not a comment" });
  });
  it.each([
    ["a = 1\na = 2", "line 2: a is defined twice"],
    ["a = 1979-05-27", "line 1: dates are not supported"],
    ['a = """x"""', "line 1: multi-line strings are not supported"],
    ["a =", "line 1"],
    ["[a\nb = 1", "line 1"],
    ["__proto__ = 1", "line 1: __proto__"],
    ['"constructor".x = 1', "line 1: constructor"],
  ])("refuses %j naming the line", (src, message) => {
    expect(() => parseToml(src)).toThrow(message);
  });
  it("builds plain objects with no prototype pollution", () => {
    const out = parseToml("[a]\nb = 1") as Record<string, unknown>;
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).b).toBeUndefined();
  });
  it("refuses input over 256 KB", () => {
    expect(() => parseToml("a = 1\n".repeat(50_000))).toThrow("too large");
  });
});
```

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement** `parseToml(src: string): Record<string, unknown>`: a line-oriented scanner with a small value tokenizer (strings, numbers matching `^[+-]?\d+(\.\d+)?$` with `_` separators allowed, `true`/`false`, `[...]`, `{...}`) that may continue onto following lines for arrays. Keys: bare `[A-Za-z0-9_-]+` or quoted; `__proto__`, `constructor`, `prototype` refused. Objects created with `{}` and assigned through `Object.defineProperty` (or a check before each assignment). Throw `Error("line N: …")`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/shell/src/main/engine-config/toml-lite.ts packages/shell/test/engine-config/toml-lite.test.ts
git -C <worktree> commit -m "feat(shell): a TOML subset parser for codex.toml presets" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 3: Frontmatter for skills and agents [parallel with 2, 4]

**Files:**
- Create: `packages/shell/src/main/engine-config/frontmatter.ts`
- Test: `packages/shell/test/engine-config/frontmatter.test.ts`

- [ ] **Step 1: Write the failing tests.**

```ts
import { agentFromMarkdown, parseFrontmatter, skillFromMarkdown } from "../../src/main/engine-config/frontmatter";

describe("parseFrontmatter (Decision 4)", () => {
  it("flat keys, lists and | blocks; body after", () => {
    const md = "---\nname: rev\ndescription: Reviews\ntools: [Read, Grep]\nnotes: |\n  one\n  two\n---\nBody\n";
    expect(parseFrontmatter(md)).toEqual({ fields: { name: "rev", description: "Reviews", tools: ["Read", "Grep"], notes: "one\ntwo" }, body: "Body\n" });
  });
  it("no frontmatter: empty fields, whole body", () => {
    expect(parseFrontmatter("Just text")).toEqual({ fields: {}, body: "Just text" });
  });
  it.each([["---\na:\n  b: 1\n---\n", "a"], ["---\n__proto__: x\n---\n", "__proto__"], ["---\na: 1\n", "closing ---"]])("refuses %j naming %s", (md, name) => {
    expect(() => parseFrontmatter(md)).toThrow(name);
  });
});

describe("agentFromMarkdown (spec §5.2, E6)", () => {
  it("frontmatter as fields, body as prompt; name from the file when missing", () => {
    expect(agentFromMarkdown("reviewer.md", "---\ndescription: Reviews code\ntools: [Read]\nmodel: sonnet\n---\nYou review.")).toEqual({
      name: "reviewer",
      agent: { description: "Reviews code", tools: ["Read"], model: "sonnet", prompt: "You review." },
      ignored: [],
    });
  });
  it("permissionMode is dropped and reported as ignored", () => {
    expect(agentFromMarkdown("a.md", "---\ndescription: d\npermissionMode: bypassPermissions\n---\np").ignored).toEqual(["permissionMode"]);
  });
  it.each(["hooks", "mcpServers"])("refuses %s (Decision 6)", (key) => {
    expect(() => agentFromMarkdown("a.md", `---\ndescription: d\n${key}: [x]\n---\np`)).toThrow(`agents/a.md: ${key} is not allowed`);
  });
  it("needs a description; the name must be a plain id", () => {
    expect(() => agentFromMarkdown("a.md", "p")).toThrow("description");
    expect(() => agentFromMarkdown("A B.md", "---\ndescription: d\n---\np")).toThrow("name");
  });
});

describe("skillFromMarkdown", () => {
  it("keeps the file as is and reads name and description", () => {
    expect(skillFromMarkdown("fmt", "---\nname: fmt\ndescription: Formats\n---\nDo it")).toEqual({ name: "fmt", description: "Formats" });
  });
  it("refuses hooks in a skill's frontmatter (E6)", () => {
    expect(() => skillFromMarkdown("fmt", "---\ndescription: d\nhooks: [x]\n---\n")).toThrow("skills/fmt/SKILL.md: hooks is not allowed");
  });
});
```

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** Agent fields kept: `description`, `tools`, `disallowedTools`, `model`, `color`, `skills`, `memory`; others refused naming them. Names: `^[a-z0-9][a-z0-9-]{0,39}$`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/shell/src/main/engine-config/frontmatter.ts packages/shell/test/engine-config/frontmatter.test.ts
git -C <worktree> commit -m "feat(shell): read skill and agent frontmatter for engine presets" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 4: The cleaners: settings, servers, codex.toml [parallel with 2, 3]

**Files:**
- Create: `packages/shell/src/main/engine-config/clean.ts`
- Test: `packages/shell/test/engine-config/clean.test.ts`

- [ ] **Step 1: Write the failing tests.**

```ts
import { cleanCodex, cleanMcp, cleanSettings } from "../../src/main/engine-config/clean";

const ctx = { folder: "/w", linked: ["/repo"], edit: "folder" as const, reserved: new Set(["ui", "data", "translate", "review", "harness"]) };

describe("cleanSettings (spec §5.4, E4, E5)", () => {
  it("keeps hooks and permissions allow/deny/ask", () => {
    const s = { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "node ./tools/check.js" }] }] }, permissions: { allow: ["Bash(npm test)"], deny: ["Bash(rm:*)"], ask: [] } };
    expect(cleanSettings(s, ctx)).toEqual({ settings: s, ignored: [] });
  });
  it("drops defaultMode and permissions.defaultMode as ignored", () => {
    expect(cleanSettings({ defaultMode: "bypassPermissions", permissions: { defaultMode: "acceptEdits" } }, ctx)).toEqual({ settings: { permissions: {} }, ignored: ["defaultMode", "permissions.defaultMode"] });
  });
  it.each(["env", "apiKeyHelper", "awsAuthRefresh", "forceLoginMethod", "model", "statusLine", "enabledPlugins"])("refuses %s naming it", (key) => {
    expect(() => cleanSettings({ [key]: "x" }, ctx)).toThrow(`settings.json: ${key} is not allowed`);
  });
  it("refuses permissions.additionalDirectories (folders come from linking)", () => {
    expect(() => cleanSettings({ permissions: { additionalDirectories: ["/etc"] } }, ctx)).toThrow("permissions.additionalDirectories");
  });
  it("permissions.edit none: edit-tool allow rules are dropped as ignored", () => {
    const r = cleanSettings({ permissions: { allow: ["Edit", "Write(./x)", "Read", "Bash(npm test)"] } }, { ...ctx, edit: "none" });
    expect(r.settings.permissions?.allow).toEqual(["Read", "Bash(npm test)"]);
    expect(r.ignored).toEqual(["permissions.allow: Edit", "permissions.allow: Write(./x)"]);
  });
  it("refuses an allow path rule outside the folder and its linked folders", () => {
    expect(() => cleanSettings({ permissions: { allow: ["Edit(//etc/**)"] } }, ctx)).toThrow("outside");
    expect(cleanSettings({ permissions: { allow: ["Edit(//repo/src/**)", "Edit(./docs/**)"] } }, ctx).settings.permissions?.allow).toHaveLength(2);
  });
  it("refuses a hook that is not a command hook", () => {
    expect(() => cleanSettings({ hooks: { Stop: [{ hooks: [{ type: "http", url: "x" }] }] } }, ctx)).toThrow("hooks.Stop");
  });
});

describe("cleanMcp (spec §5.2, E9, Decision 7, 8)", () => {
  it("stdio servers, renamed scope-<name>", () => {
    expect(cleanMcp({ mcpServers: { lint: { command: "node", args: ["./tools/lint.js"], env: { LEVEL: "1" } } } }, ctx)).toEqual([
      { name: "scope-lint", command: "node", args: ["./tools/lint.js"], env: { LEVEL: "1" } },
    ]);
  });
  it.each([
    [{ mcpServers: { x: { url: "https://e" } } }, "url servers are not supported"],
    [{ mcpServers: { "Bad Name": { command: "a" } } }, "Bad Name"],
    [{ mcpServers: { x: { command: "a", env: { GITHUB_TOKEN: "t" } } } }, "GITHUB_TOKEN"],
    [{ mcpServers: { x: { command: "a", env: { OPENAI_API_KEY: "k" } } } }, "OPENAI_API_KEY"],
    [{ mcpServers: { x: { command: "-rf" } } }, "command"],
    [{ other: 1 }, "other"],
  ])("refuses %j", (m, message) => {
    expect(() => cleanMcp(m, ctx)).toThrow(message);
  });
  it("a renamed server can't equal a core or harness server", () => {
    expect(() => cleanMcp({ mcpServers: { x: { command: "a" } } }, { ...ctx, reserved: new Set(["scope-x"]) })).toThrow("scope-x");
  });
});

describe("cleanCodex (spec §5.4, Decision 9)", () => {
  it("passes allowlisted keys", () => {
    expect(cleanCodex({ model_verbosity: "low", features: { web_search_request: true }, tools: { web_search: true } })).toEqual({ model_verbosity: "low", features: { web_search_request: true }, tools: { web_search: true } });
  });
  it.each(["model_provider", "model_providers", "openai_api_key", "azure_api_key", "cli_auth_credentials_store", "chatgpt_base_url", "mcp_servers", "profile", "profiles", "model", "model_reasoning_effort", "model_auto_compact_token_limit", "instructions", "sandbox_mode", "approval_policy"])("refuses %s naming it", (key) => {
    expect(() => cleanCodex({ [key]: "x" })).toThrow(`codex.toml: ${key} is not allowed`);
  });
  it("features takes booleans only", () => {
    expect(() => cleanCodex({ features: { x: "on" } })).toThrow("features.x");
  });
});
```

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** Credential-like env names: `/(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|ACCESS_?KEY|CREDENTIAL|AUTH)/i`. Edit tools: `Edit`, `Write`, `MultiEdit`, `NotebookEdit` (with or without a rule). A path rule `Tool(//abs/...)` resolves to `/abs/...` and must be inside `folder` or a linked folder (`path.relative` not starting with `..`); `Tool(./x)` and `Tool(x)` are relative to the folder and pass. Commands: `command` a non-empty string not starting with `-`; `args` strings. Every refusal is an `Error` whose message starts with the file name and names the key.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/shell/src/main/engine-config/clean.ts packages/shell/test/engine-config/clean.test.ts
git -C <worktree> commit -m "feat(shell): allowlists for preset settings, servers and codex.toml" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 5: Reading a scope's engine folder; the hash and referenced scripts

**Files:**
- Create: `packages/shell/src/main/engine-config/script-refs.ts`, `packages/shell/src/main/engine-config/read-config.ts`
- Test: `packages/shell/test/engine-config/script-refs.test.ts`, `packages/shell/test/engine-config/read-config.test.ts`

- [ ] **Step 1: Write the failing tests.**

`script-refs.test.ts`:
```ts
describe("scriptRefs (spec §5.3, E2)", () => {
  it("finds relative and absolute paths inside the folder or a linked folder that exist as files", async () => {
    // tmp folder w with tools/x.js, linked /repo with bin/y.sh
    // scriptRefs(["node ./tools/x.js --fast", "bash /repo/bin/y.sh", "npx eslint", "node /etc/hosts"], { folder: w, linked: [repo] })
    // → [path.join(w,"tools/x.js"), path.join(repo,"bin/y.sh")] (sorted, unique; /etc/hosts outside → ignored; eslint not a file)
  });
  it("tokenizes quotes: node \"./my tools/x.js\"", async () => {});
  it("ignores a referenced symlink and a directory", async () => {});
});
```

`read-config.test.ts`:
```ts
describe("readEngineConfig (spec §5.1–5.4)", () => {
  it("an absent or empty folder is null (D0 for the scope)", async () => {});
  it("reads base, instructions, mcp, settings, skills, agents, codex and an action layer", async () => {
    // writes each file; expect the EngineConfig fields: base "global", instructions text, servers [scope-lint], settings cleaned,
    // skills [{name:"fmt"}], agents {reviewer:{…}}, codex {...}, actions {"review": {instructions, servers, settings}}
  });
  it("base defaults to isolated; a base other than isolated/global is a refusal", async () => {});
  it("refusals are collected with the file and key, not thrown", async () => {
    // settings.json with env → config.refusals = [{ file: "settings.json", message: "settings.json: env is not allowed" }]
  });
  it("the hash covers every file, action layers included", async () => {
    // hash h1; change actions/review/instructions.md → h2 !== h1; touch mtime only → same hash
  });
  it("a change to a referenced script changes the hash (E2)", async () => {
    // settings hook "node ./tools/check.js"; change tools/check.js → new hash; config.scripts lists it
  });
  it("refuses symlinks, files over 256 KB, more than 200 files, depth over 4 (E8)", async () => {});
  it("unknown files at the top are refused naming them", async () => {});
  it("never names an engine home (E7)", () => {
    // source scan of engine-config/*.ts: no ".claude", ".codex", "homedir("
  });
});
```

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.**

```ts
export interface EngineLayer {
  instructions: string;
  servers: McpServerSpec[];
  settings: CleanSettings | null;
  ignored: string[];
}
export interface EngineConfig extends EngineLayer {
  base: "isolated" | "global";
  skills: { name: string; description: string }[];
  agents: Record<string, ClaudeAgent>;
  codex: Record<string, unknown> | null;
  actions: Record<string, EngineLayer>;
  /** Files outside the engine folder that joined the hash (E2). */
  scripts: string[];
  refusals: { file: string; message: string }[];
  /** sha256 hex over the sorted (relative path, bytes) of every file read plus every script. */
  hash: string;
  /** The bytes that were hashed, so the snapshot writes exactly them (E3). */
  files: Map<string, Buffer>;
}
export async function readEngineConfig(dir: string, o: { folder: string; linked: string[]; edit: "folder" | "none"; reserved: ReadonlySet<string> }): Promise<EngineConfig | null>;
```

Top-level names allowed: `base`, `instructions.md`, `mcp.json`, `settings.json`, `skills/`, `agents/`, `codex.toml`, `actions/`. Action layers take `instructions.md`, `mcp.json`, `settings.json`; their ids must be declared actions (`Object.hasOwn(harness.actions, id)`; passed in as `o.actions`). The hash input: for each file sorted by relative path, `path\0length\0bytes`; scripts as `script:<absolute path>\0…`.

- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/shell/src/main/engine-config/script-refs.ts packages/shell/src/main/engine-config/read-config.ts packages/shell/test/engine-config/script-refs.test.ts packages/shell/test/engine-config/read-config.test.ts
git -C <worktree> commit -m "feat(shell): read a scope's engine config, with refusals, a hash and referenced scripts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 6: Approval on the scope; the snapshot

**Files:**
- Modify: `packages/workspace/src/scopes.ts`
- Create: `packages/shell/src/main/engine-config/snapshot.ts`
- Test: `packages/workspace/test/scopes.test.ts` (append), `packages/shell/test/engine-config/snapshot.test.ts`

- [ ] **Step 1: Write the failing tests.**

```ts
describe("engine approval on the scope (spec §5.3)", () => {
  it("approveEngine stores { hash, at }; D0: no key until then", async () => {});
  it("refuses a hash that isn't 64 hex characters", async () => {});
  it("clearEngineApproval removes the key", async () => {});
});
```

```ts
describe("engine snapshot (spec §5.2, E3)", () => {
  it("writes skills as a plugin folder, agents.json, settings.json, mcp.json, codex.json, instructions.md", async () => {
    // writeSnapshot(userData, config) → <userData>/engine-config/<hash>/skills/fmt/SKILL.md, agents.json = { reviewer: {...} }
  });
  it("an edit to the live folder after approval is not loaded", async () => {
    // read config, write snapshot, then change the live skills/fmt/SKILL.md → snapshot's file is unchanged
  });
  it("loadSnapshot re-hashes and refuses a snapshot whose files changed", async () => {});
  it("writing the same hash twice is a no-op; writes are atomic (temp folder + rename)", async () => {});
  it("pruneSnapshots trashes snapshots not in keep and older than 30 days", async () => {});
});
```

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** `ScopeEntry.engineApproval?: { hash: string; at: string }` (ISO), `approveEngine(id, hash, now)`, `clearEngineApproval(id)`. Snapshot: `<userData>/engine-config/<hash>/` with `source/` (the hashed files, verbatim, so `loadSnapshot` can re-hash) plus the derived files; `loadSnapshot(userData, hash)` returns `{ dir, pluginDir, agentsFile?, settings?, servers, codex?, instructions, actions }` or throws "The approved engine config changed on disk". Scripts are copied into `source/scripts/<sha16 of path>` for the re-hash only; engines run the live script path (the hash check at session start covers it).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/workspace/src/scopes.ts packages/workspace/test/scopes.test.ts packages/shell/src/main/engine-config/snapshot.ts packages/shell/test/engine-config/snapshot.test.ts
git -C <worktree> commit -m "feat: approve a scope's engine config by hash; snapshot it in the app's data folder" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 7: Claude runs with the preset

**Files:**
- Modify: `packages/runtime/src/transport.ts`, `packages/runtime/src/claude-cli.ts`
- Test: `packages/runtime/test/claude-cli.test.ts` (append), `packages/runtime/test/hatches-d0.test.ts` (append)

- [ ] **Step 1: Write the failing tests.**

```ts
const preset: EnginePreset = {
  hash: "a".repeat(64),
  base: "isolated",
  settings: { hooks: { Stop: [{ hooks: [{ type: "command", command: "node ./t.js" }] }] }, permissions: { allow: ["Bash(npm test)"], deny: ["Bash(rm:*)"] } },
  servers: [{ name: "scope-lint", command: "node", args: ["./lint.js"], env: {} }],
  pluginDir: "/u/engine-config/aaa/plugin",
  agentsFile: "/u/engine-config/aaa/agents.json",
};

describe("claudeArgs with an engine preset (spec §5.2)", () => {
  it("D0: no engine preset → part 1's argv", () => {
    expect(claudeArgs({ ...o, scope: { linked: [] } })).toEqual(claudeArgs(o));
  });
  it("an empty preset folder changes nothing", () => {
    // engine undefined (the host passes none for an empty folder) — same as above with linked folders
  });
  it("one --settings: additionalDirectories plus the cleaned preset", () => {
    const args = claudeArgs({ ...o, references: ["/r"], scope: { linked: [{ path: "/l", mode: "read" }], engine: preset } });
    expect(args.filter((a) => a === "--settings")).toHaveLength(1);
    expect(JSON.parse(args[args.indexOf("--settings") + 1])).toEqual({
      hooks: preset.settings!.hooks,
      permissions: { additionalDirectories: ["/r", "/l"], allow: ["Bash(npm test)"], deny: ["Bash(rm:*)"] },
    });
  });
  it("servers join --mcp-config after the core's", () => {
    const cfg = JSON.parse(argAfter(claudeArgs({ ...o, scope: { linked: [], engine: preset } }), "--mcp-config"));
    expect(Object.keys(cfg.mcpServers)).toEqual([...o.mcp.map((s) => s.name), "scope-lint"]);
  });
  it("skills and agents from the snapshot", () => {
    const args = claudeArgs({ ...o, scope: { linked: [], engine: preset } });
    expect(argAfter(args, "--plugin-dir")).toBe(preset.pluginDir);
    expect(argAfter(args, "--agents")).toBe(preset.agentsFile);
  });
  it("isolated keeps --setting-sources project and --strict-mcp-config", () => {});
  it("global flags on Claude: --setting-sources user,project and no --strict-mcp-config", () => {
    const args = claudeArgs({ ...o, scope: { linked: [], engine: { ...preset, base: "global" } } });
    expect(argAfter(args, "--setting-sources")).toBe("user,project");
    expect(args).not.toContain("--strict-mcp-config");
  });
  it("manifest denies over a preset allow: --disallowedTools is the harness's, unchanged", () => {
    const withPreset = claudeArgs({ ...o, permissions: { ...o.permissions, edit: "none" }, scope: { linked: [], engine: preset } });
    const without = claudeArgs({ ...o, permissions: { ...o.permissions, edit: "none" } });
    expect(argAfter(withPreset, "--disallowedTools")).toBe(argAfter(without, "--disallowedTools"));
    expect(argAfter(withPreset, "--permission-mode")).toBe("default");
  });
  it("refuses a preset with noTools or mcpOnly", () => {});
  it("refuses a preset path that reads as a flag", () => {});
});
```

(`argAfter(args, flag)` is a test helper: `args[args.indexOf(flag) + 1]`.)

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** `transport.ts`:

```ts
/** A scope's approved engine config, from its snapshot (hatches spec §5.2). */
export interface EnginePreset {
  hash: string;
  base: "isolated" | "global";
  /** Cleaned settings: hooks and permissions allow/deny/ask only. */
  settings?: { hooks?: Record<string, unknown>; permissions?: { allow?: string[]; deny?: string[]; ask?: string[] } };
  servers: McpServerSpec[];
  /** The snapshot folder laid out as a plugin (skills/<name>/SKILL.md); absent without skills. */
  pluginDir?: string;
  /** agents.json in the snapshot; absent without agents. */
  agentsFile?: string;
  /** Codex: the cleaned codex.toml as JSON. */
  codex?: Record<string, unknown>;
}
```
`TurnScope.engine?: EnginePreset`. `claude-cli.ts`: rename part 1's `scopeSettingsArgs(references, scope)` body into `settingsArgs(references, scope)` returning one `--settings` with `{ ...(settings.hooks ? { hooks } : {}), permissions: { ...(dirs.length ? { additionalDirectories: dirs } : {}), ...allow/deny/ask } }`, or nothing when the object is empty (keep D0: references only → exactly today's JSON, key order unchanged). `--setting-sources` and `--strict-mcp-config` from the base. `--plugin-dir`/`--agents` after `--settings`, before the session flags.

- [ ] **Step 4: Manual check (once, outside tests, optional).** If a real `claude` is available and Marco allows: run the S2 "to check live" items with a tiny prompt in a scratch folder. Never read `~/.claude`. Record results in carry-notes; skip if not allowed.
- [ ] **Step 5: Run.** `corepack pnpm vitest run packages/runtime/test`. Expected: PASS, part 1 and master goldens unchanged.
- [ ] **Step 6: Commit.**

```bash
git -C <worktree> add packages/runtime/src/transport.ts packages/runtime/src/claude-cli.ts packages/runtime/test/claude-cli.test.ts packages/runtime/test/hatches-d0.test.ts
git -C <worktree> commit -m "feat(runtime): Claude runs with a scope's approved engine preset" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 8: Codex and OpenCode run with the preset [parallel with 7]

**Files:**
- Modify: `packages/runtime/src/acp.ts`, `packages/fake-agent/src/fake-acp.ts` (log `CODEX_CONFIG` and the `mcpServers` names)
- Test: `packages/runtime/test/acp.test.ts` (append)

- [ ] **Step 1: Write the failing tests.**

```ts
describe("ACP with an engine preset (spec §5.2)", () => {
  it("D0: CODEX_CONFIG and session/new unchanged without a preset", async () => {});
  it("preset servers join mcpServers on session/new and session/load", async () => {
    // fake-acp log: session/new mcpServers names = [...core, "scope-lint"]
  });
  it("codex.toml merged into CODEX_CONFIG with the profile's keys", async () => {
    // profile + preset.codex { model_verbosity: "low" } → env CODEX_CONFIG = {"model_reasoning_effort":…, "model_auto_compact_token_limit":…, "model_verbosity":"low"}
  });
  it("a new hash restarts the process with a fresh session", async () => {
    // turn 1 preset hash A, turn 2 hash B → two spawns; second session id new
  });
  it("a preset key that collides with a profile key is refused (last guard)", async () => {});
  it("OpenCode: servers only; codex ignored", async () => {
    // engine "opencode": CODEX_CONFIG never set from the preset
  });
});
```

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** `mcpServers()` appends `scope?.engine?.servers` (passed per turn: keep the last turn's scope on the instance, as part 1's linked dirs). `codexConfig(profile, extra?)`: `{ ...extra, ...profileKeys }` after checking no key of `extra` is a profile key; only when the adapter is Codex (`this.o.engine === "codex"` or the existing flag that marks the Codex adapter). The existing `config !== this.spawnedConfig` comparison then restarts on a new hash.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/runtime/src/acp.ts packages/fake-agent/src/fake-acp.ts packages/runtime/test/acp.test.ts
git -C <worktree> commit -m "feat(runtime): Codex and OpenCode get a scope's preset servers; codex.toml into CODEX_CONFIG" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 9: The host: which preset a task gets; scope instructions

**Files:**
- Create: `packages/shell/src/main/engine-config/engine-host.ts`
- Modify: `packages/shell/src/main/task-manager.ts` (`TaskDeps.enginePreset`, the first message, `startItems`), `packages/shell/src/main/task-store.ts` (`engineHash`), `packages/shell/src/main/scope-access.ts` (part 1: add `engine` to the `TurnScope` it builds)
- Test: `packages/shell/test/engine-config/engine-host.test.ts`, `packages/shell/test/task-manager.test.ts` (append)

- [ ] **Step 1: Write the failing tests.**

```ts
describe("EngineHost (spec §5.2, §5.3, E1)", () => {
  it("D0: no preset, the task's first message and items are unchanged", async () => {});
  it("approved and unchanged: the snapshot's preset, the scope instructions, and the hash to pin", async () => {
    // presetFor("intro", undefined) → { preset: {hash, …}, instructions: "## Scope instructions\n\n…", notice: null }
  });
  it("a changed file drops the preset from new sessions and gives the notice", async () => {
    // approve, then edit instructions.md → { preset: null, instructions: "", notice: "unapproved" }
  });
  it("a change to a referenced script drops it too", async () => {});
  it("never approved but has files: notice unapproved", async () => {});
  it("refusals: notice refused, preset null", async () => {});
  it("action layer: its instructions after the scope's, its servers and settings on top (action key wins)", async () => {});
  it("pinned per task: a later turn of the same task reuses the pinned snapshot after a new approval", async () => {
    // presetForTask(task with engineHash A) after approving B → hash A
  });
});
```

`task-manager.test.ts`:
```ts
  it("instructions in the first message: after the brief, under Scope instructions", async () => {});
  it("lists Scope instructions in the context items with kind scope-instructions", async () => {});
  it("records engineHash on the task when a preset was used; none without", async () => {});
```

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.**

```ts
export type EngineNotice = "unapproved" | "refused" | null;
export class EngineHost {
  constructor(d: { folder: () => string; userData: string; harness: Harness; scopes: ScopeStore; linked: (scope: string) => string[]; engine: () => EngineId });
  /** For a new task. */
  presetFor(scope: string, action: string | undefined): Promise<{ preset: EnginePreset | null; instructions: string; notice: EngineNotice; hash?: string }>;
  /** For a later turn: the pinned hash's snapshot, or none. */
  presetForTask(task: { scope: string; action?: string; engineHash?: string }): Promise<EnginePreset | null>;
  view(scope: string): Promise<EngineConfigView>; // Task 10
}
```
`TaskDeps.enginePreset?` is set only with `enginePresets` (D0). The first message gets `\n\n## Scope instructions\n\n<text>` appended after the brief part, before the notes indexes (match where `contextFor`'s text goes today and place it right after the brief). `startItems` adds `{ id: "scope-instructions", kind: "scope-instructions", label: "Scope instructions", tokens }`. A notice is surfaced on the task view (`TaskView.engineNotice?`).

- [ ] **Step 4: Run.** Expected: PASS; master's context-panel tests unchanged.
- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/shell/src/main/engine-config/engine-host.ts packages/shell/src/main/task-manager.ts packages/shell/src/main/task-store.ts packages/shell/src/main/scope-access.ts packages/shell/test/engine-config/engine-host.test.ts packages/shell/test/task-manager.test.ts
git -C <worktree> commit -m "feat(shell): tasks get their scope's approved engine preset, pinned per task" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 10: IPC: view and approve

**Files:**
- Create: `packages/shell/src/main/engine-config/engine-ipc.ts`
- Modify: `packages/shell/src/main/index.ts`, `packages/shell/src/main/linked-ipc.ts` (`hatchesState.enginePresets`), preload, `packages/ui/src/client.ts`, fake client
- Test: `packages/shell/test/engine-config/engine-ipc.test.ts`, `packages/shell/test/hatches-surface.test.ts` (append)

- [ ] **Step 1: Write the failing tests.**

```ts
describe("engine IPC (E10)", () => {
  it("hh:engineConfig(scope) returns the view: base, codexLimit, hooks, servers, instructions, skills, agents (ignored keys), codex keys, actions, scripts, refusals, hash, approved", async () => {});
  it("runs-commands items come first (hooks and servers)", async () => {});
  it("hh:engineApprove approves only when the hash equals the one computed now", async () => {
    // approve(scope, staleHash) → { ok: false, reason: "changed" }; approve(scope, current) → ok and scopes.json has engineApproval
  });
  it("refuses an unknown scope (Object.hasOwn), an id over 64 chars, a non-hex hash, and a config with refusals", async () => {});
  it("approving notifies the window (engine config changed)", async () => {});
});
```

`hatches-surface.test.ts`: `registerEngineIpc` only inside `if (hasEnginePresets(harness))`; `hatchesState` gains `enginePresets: true` only then.

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.**

```ts
export interface EngineConfigView {
  scope: string;
  base: "isolated" | "global";
  /** Decision 14: the harness supports Codex. */
  codexLimit: boolean;
  runsCommands: { kind: "hook" | "server"; label: string; command: string; args: string[]; layer: string }[];
  instructions: { layer: string; text: string }[];
  skills: string[];
  agents: { name: string; description: string; ignored: string[] }[];
  codexKeys: string[];
  ignored: string[];
  scripts: string[];
  refusals: { file: string; message: string }[];
  hash: string;
  approved: boolean;
  approvedAt?: string;
}
```
`client.engineConfig = { get(scope), approve(scope, hash), onChanged(cb) }`. Also watch: after any history save or outside change that touches `.harness/engine/**`, push `hh:engineConfigChanged` (reuse the existing outside-change signal in `index.ts`).

- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/shell/src/main/engine-config/engine-ipc.ts packages/shell/src/main/index.ts packages/shell/src/main/linked-ipc.ts packages/shell/src/preload/index.ts packages/ui/src/client.ts packages/ui/test/fake-client.ts packages/shell/test/engine-config/engine-ipc.test.ts packages/shell/test/hatches-surface.test.ts
git -C <worktree> commit -m "feat(shell): view and approve a scope's engine config from the window" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 11: The Engine config section and the notice

**Files:**
- Create: `packages/ui/src/hatches/EngineConfig.tsx`, `packages/ui/src/hatches/EngineNotice.tsx`
- Modify: `packages/ui/src/hatches/ScopeSettings.tsx` (part 1), `packages/ui/src/ChatView.tsx` (the notice under the task header), en.json `"hatches"`
- Test: `packages/ui/test/engine-config-ui.test.tsx`

- [ ] **Step 1: Write the failing tests.**

```tsx
describe("Engine config (spec §5.3)", () => {
  it("D0: no Engine config section, no notice", () => {});
  it("runs-commands items first, marked Runs commands on your computer", () => {});
  it("global base in plain words: Also uses your global Claude config", () => {});
  it("the Codex limit shown on the approval screen when codexLimit", () => {
    // "On Codex, your own Codex config always applies."
  });
  it("lists instructions (rendered), skills, agents with their ignored keys, codex keys, scripts and each action layer", () => {});
  it("refusals disable Approve and name each key", () => {});
  it("Approve sends the shown hash; a 'changed' answer reloads the view", async () => {});
  it("the task notice: Engine config not approved · Review opens the section for that scope", async () => {});
});
```

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** Strings in en.json `"hatches"`: `engineConfig`, `engineRunsCommands`, `engineBaseGlobal` ("Also uses your global Claude config"), `engineBaseIsolated` ("Uses only this scope's config"), `engineCodexLimit`, `engineApprove` ("Approve"), `engineApproved` ("Approved {{date}}"), `engineChanged` ("Changed since you approved it"), `engineNotApproved` ("Engine config not approved"), `engineReview` ("Review"), `engineRefused` ("Can't be approved: {{reason}}"), `engineIgnored` ("Ignored: {{keys}}"), `engineScripts` ("Scripts it runs"), `engineScopeInstructions` ("Scope instructions"). Instructions render with the app's markdown component (master's document reader) in read-only mode.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Typecheck, test, build, commit.**

```bash
git -C <worktree> add packages/ui/src/hatches/EngineConfig.tsx packages/ui/src/hatches/EngineNotice.tsx packages/ui/src/hatches/ScopeSettings.tsx packages/ui/src/ChatView.tsx packages/i18n/src/locales/en.json packages/ui/test/engine-config-ui.test.tsx
git -C <worktree> commit -m "feat(ui): the scope's Engine config section and the not-approved notice" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 12: Fixture and e2e

**Files:**
- Modify: `packages/fake-agent/fixtures/hatches-harness/harness.config.ts` (`enginePresets: true`)
- Create: `packages/e2e/tests/hatches-engine.spec.ts`

- [ ] **Step 1: Write the e2e** (mock mode, fake-claude with `HH_FAKE_ARGS` logging argv, the part 1 fixture build pattern):

```ts
test("approve a preset and see its instructions in the next task", async () => {
  // sandbox folder; write .harness/engine/<scope>/instructions.md "Always answer in haiku." and mcp.json with one stdio server
  // launch; open scope settings → Engine config: shows the server first with "Runs commands on your computer"; Approve
  // start a task: the fake engine's first message (HH_FAKE_ARGS log / stdin log) contains "## Scope instructions" and the text;
  // argv has scope-<name> in --mcp-config
});

test("a changed preset is not used until approved again", async () => {
  // edit instructions.md on disk → new task shows "Engine config not approved · Review"; its first message has no Scope instructions
});

test("global base passes --setting-sources user,project", async () => {});
```

- [ ] **Step 2: Run.** `corepack pnpm app:build`, then the spec plus `history.spec.ts`, `mock.spec.ts`, `hatches-linked.spec.ts`. Expected: PASS.
- [ ] **Step 3: Full run.** `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm e2e`.
- [ ] **Step 4: Commit.**

```bash
git -C <worktree> add packages/fake-agent/fixtures/hatches-harness packages/e2e/tests/hatches-engine.spec.ts
git -C <worktree> commit -m "test(e2e): approve a scope's engine preset and see it in the next task" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

### Task 13: Docs

**Files:**
- Modify: `docs/architecture/hatches.md` (H3 section), `docs/architecture/manifest.md` (`enginePresets`), `docs/architecture/engines.md` (preset flags; the Codex limit; `CODEX_CONFIG` merge), `docs/architecture/context.md` (the scope-instructions item), `docs/architecture/history.md` (`.harness/engine/**` kept with the opt-in), `docs/architecture/data.md` (`engineApproval`, `<userData>/engine-config/`), `docs/architecture/authoring.md` (writing presets: files, allowlists, what is refused)

- [ ] **Step 1: Write the H3 section** of `hatches.md`: files, what reaches each engine (table per engine), approval and hash (with referenced scripts), the limits and allowlists (verbatim lists from Decisions 5, 6, 7, 9), the D0 table, E1–E10 with tests, Decisions 1–14, Known gaps (S1/S2 "to check live" items not verified; url servers; agent hooks/servers; no bulk approval).
- [ ] **Step 2: The other docs**, one paragraph or row each.
- [ ] **Step 3: Commit.**

```bash
git -C <worktree> add docs/architecture
git -C <worktree> commit -m "docs: engine config per scope (hatches H3)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv"
```

---

## Parallel execution

| Wave | Tasks | Notes |
|---|---|---|
| A | 1, 2, 3, 4 | four separate files; 4 needs no parser |
| B | 5, then 6 | 5 uses 2–4; 6 uses 5's `EngineConfig` |
| C | 7, 8 | runtime; disjoint files (claude-cli.ts / acp.ts); both import `EnginePreset` from 7's transport.ts change: land 7's `transport.ts` hunk first |
| D | 9, then 10, then 11 | |
| E | 12, then 13 | |
