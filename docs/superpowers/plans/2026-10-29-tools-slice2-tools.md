# Tools and recipes, slice 2 (tools) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship delivery slice 2 of the tools-and-recipes spec (§15.2): a harness declares `tools` (typed code files written with `defineTool`); `humanharness build` bundles them for a sandbox and writes `dist/tools.json`; the app runs them in one hidden sandboxed window per harness, each call going through a registry in main that checks arguments and results, binds a core-broker `ctx` to the tool's `uses`, and traces every call; the agent reaches `agent: "call"` tools through a core MCP server `tools`; harness UIs call them with `client.tools.call`; a task's chat shows each call as one folded line; `humanharness check` and the app check every rule of §3.3 that slice 2 needs. A harness without `tools` is byte for byte today's app.

**Architecture.**

*SDK* (`packages/harness-sdk/src/tool.ts`, a sub-path with no Node import, so it bundles for the browser): `defineTool({ description, params, returns?, agent?, uses?, timeout?, summary?, run })`, `ToolContext` (the `ctx` type), `ToolRefused`. `packages/harness-sdk/src/tools.ts`: the manifest's `tools` key (`Record<id, "./tools/<file>.ts">`), `TOOL_ID`, `hasTools`, `toolsJsonSchema` (what `dist/tools.json` holds), `toolProblems(manifest, toolsJson)` (§3.3's slice-2 checks). `@humanharness/cli/tool` re-exports `defineTool` and `z`.

*Build* (`packages/cli/src/tool-build.ts`): `humanharness build` bundles each tool file twice with the esbuild that tsx carries (as `plugin build` does): for the sandbox (`platform: "browser"`, ESM, no Node built-ins; an import of one fails naming it) into `dist/tools/<id>.js`, and for Node into a temp module whose default export's metadata becomes `dist/tools.json` (JSON Schemas through the bundle's own zod). `dev` builds first when the harness declares tools; `check` builds in memory.

*Main* (`packages/shell/src/main/tools/`):
- `tool-protocol.ts` (pure): the `hh-tools:` scheme's file rules, the frame and sender checks, the rpc parser, all mirrored from `plugin-protocol.ts` with tool names.
- `tool-host.ts`: the only file that touches Electron for tools: one hidden window per harness (`sandbox`, `contextIsolation`, no Node, own in-memory session, CSP `default-src 'none'; script-src 'self'`), `hh-tools://<harness-id>/` serving only `dist/tools/` and the core's `_hh/` files, channel `hh-tools:rpc`, crash restart with backoff and the 5-in-an-hour cut-off.
- `tool-broker.ts`: one core `Broker` (slice 1) per tool, its `BrokerGrant` built from the tool's `uses`; `ctx.files.read/list` and `ctx.scope`; data through the person-side data path with `who: "tool"`.
- `tool-registry.ts`: per call: params check (JSON Schema → zod with the plugins' allowlisted `jsonSchemaToZod`), send to the host with a fresh run of the tool's broker, result check against `returns`, timeout (30 s default, `timeout` up to 120 s), one trace entry.
- `tool-trace.ts`: entries `{ at, tool, caller, task?, job?, run?, phase?, args, resultSummary, ms, ok, error?, accesses }` in `.harness/trace/<task>.jsonl`, `.harness/trace/jobs/<run>.jsonl` or `.harness/trace/ui/<day>.jsonl`; 2 KB cuts; secret values redacted; 30-day prune at start.
- `tools-host.ts`: `createToolsHost(...)` built in `index.ts` only when `hasTools(harness)`: the registry, the host, the rpc server the `tools` MCP server calls, `hh:toolsCall`, `hh:toolsTrace`, `AppState.tools`.

*Blocks* (`packages/blocks/src/tools-server.ts`, `tools-server-bin.ts`, `toolsServerSpec` in `launch.ts`): the core MCP server `tools` serves the `agent: "call"` tools under their ids, input schemas from `tools.json`, and asks the app over its rpc. `createWorkspace` adds it to a slot (task or prompt job) only when the harness has an `agent: "call"` tool.

*Window*: `client.tools` (`call`, `trace`), runtime event `{ type: "tool-call"; call: ToolCallView }`, `ChatEntry.tools?`, `ToolCallLine.tsx` (folded; errors unfolded). Connect steps gain `test?: toolId` and Settings › Connections a "Test" (slice 1 Decision 4).

**Tech Stack:** TypeScript, esbuild (through tsx, no install), Zod 4 (`z.toJSONSchema`), `@modelcontextprotocol/sdk`, Electron (`BrowserWindow`, `protocol`, `session`, `ipcMain`), React 19, Vitest, Playwright (mock mode).

**Spec:** `docs/superpowers/specs/2026-10-28-tools-and-recipes-design.md` §1.1, §2 D2–D4, D7, D8, D10; §3 (3.1–3.3); §4; §5; §8.1–8.3; §9 (test); §10; §13 (unit and e2e rows for slice 2); §14; §15 slice 2; §17. **Base:** slice 1's end on `feat/tools-core`. **Branch:** `feat/tools`, created from `feat/tools-core` in Task 0.

---

## Conventions

As slice 1:
- worktree `/Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-sidekick`, never `cd` elsewhere;
- commands: one file `corepack pnpm vitest run <path>`; all `corepack pnpm typecheck` and `corepack pnpm test`; shell main, preload, resources or UI touched: `corepack pnpm app:build`; e2e `corepack pnpm --filter @humanharness/e2e exec playwright test <file>` (or `corepack pnpm e2e`);
- install nothing (no `pnpm install` of any kind, no `npx` that downloads; esbuild comes through tsx as `plugin build` uses it);
- git: `git -C <worktree> …`, one command per call; `git add` new files, then `git commit --only <every path of the task> -m … -m "<trailer>"`; never push, never a bare `git stash`, never commit on another branch;
- English everywhere; tests in `packages/<name>/test/`; one behaviour per `it`;
- en.json: only a new top-level `"tools"` block, and the slice-1 `"connections"` block in Task 10;
- hot files (`index.ts`, `workspace.ts`, `events.ts`, `client.ts`, preload, `state.ts`, `ChatView.tsx`, `chat-log.ts`, `data.ts`, `history.ts`) changed small and additive.

Trailer:

```
Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv
```

**Security rules (every task).** Never read `~/.claude`, `~/.codex`, `~/.gemini`, `~/.config/opencode`, `~/.local/share/opencode`, `~/.ssh`, `~/.netrc` or any credential, token or account file. Tests never touch the real Keychain (fake `SecretCrypto`, `HH_TEST_FAKE_SECRETS=1` in e2e), never raise OS notifications or touch the Dock, never reach the network beyond 127.0.0.1 (every `fetch` a tool makes in a test goes to a fake or a 127.0.0.1 server — and a tool's `hosts` refuse `localhost` and IP literals, so unit tests use a fake `fetch` dep, and the e2e fixture tool uses no network). Never run the real `claude`, `codex` or `opencode` (e2e uses mock mode and fake-claude scripts).

**Plugin tests stay frozen** (slice 1's list), and so do the D0 files below.

## D0 is a hard rule

A harness without `tools` runs no slice-2 code:
- `defineHarness` output has no `tools` key; `humanharness check` and `dev` behave as before (no build, no `dist/` written);
- no `hh-tools` scheme registered, no hidden window, no `hh-tools:rpc` handler, no `hh:tools*` channel, no `AppState.tools`, no `.harness/trace/`;
- a slot's MCP list, Claude's `--mcp-config`, `--allowedTools`, `CODEX_CONFIG` and `session/new` are unchanged (no `tools` server);
- no `tool-call` event, `ChatEntry` has no `tools` key, chats render as before;
- data writes carry `who` as before; commit messages without a tool are as before;
- a harness with tools but no `agent: "call"` tool also gets no `tools` server.

| D0 item | Pinned by |
|---|---|
| Manifest | `packages/harness-sdk/test/tools.test.ts` "D0: no tools key without it" (Task 1) |
| CLI | `packages/cli/test/tool-build.test.ts` "D0: check and dev write nothing for a harness without tools" (Task 2) |
| Slot servers | `packages/runtime/test/workspace-tools.test.ts` "D0: no tools, the slot's MCP list is unchanged" and "tools without agent: call add no server" (Task 8) |
| Claude argv / ACP | `packages/runtime/test/claude-cli.test.ts` goldens, `hatches-d0.test.ts`, `runtime-d0.test.ts`: byte-identical (Task 13) |
| Main surface | `packages/shell/test/tools-surface.test.ts` "D0: tools channels, scheme and host exist only under hasTools" (Task 9) |
| IPC scan | `packages/shell/test/ipc-surface.test.ts` gains exactly one allowed entry, `tool-host.ts:"hh-tools:rpc"` (Task 6; Decision 15) |
| Data and history | `packages/workspace/test/data-tool.test.ts` "D0: who stays agent/person/app without a tool" and `history-trailer` "D0: withTrailer without tool writes what it wrote" (Task 5) |
| Chat | `packages/ui/test/tool-call-ui.test.tsx` "D0: an entry without tools renders as before" (Task 11) |
| E2E | `packages/e2e/tests/history.spec.ts` unchanged; `hatches-surface.test.ts` unchanged (Task 13) |

## Threat model (slice 2)

Tool code is the harness author's, but it handles outside data and runs beside the person's folder; the spec sandboxes it (D2, D3) so a bug in one tool reaches only what it declared (D7).

| # | Boundary | What enforces it | Test |
|---|---|---|---|
| T1 | No Node in tool code | `sandbox: true`, `contextIsolation`, no Node in frames/workers, own session, request filter allowing only `hh-tools://<harness-id>/`; the build refuses Node built-ins | `tool-build.test.ts` "a Node built-in fails the build naming it"; e2e probe in the fixture tool: `typeof require/process === "undefined"` (Task 12) |
| T2 | Identity from the sender, never the call | `toolOfSender`: the webContents id of the one tool window and its main frame at `hh-tools://<id>/_hh/host.html`; the tool of a `ctx` call is the call id's, set by main | `tool-protocol.test.ts` "a frame at another URL or another window is not the host" (Task 6) |
| T3 | Only declared reach (D7) | one `BrokerGrant` per tool from `uses`: hosts, secrets, exec patterns, collections (read/write), files; anything else answers `ToolRefused` | `tool-broker.test.ts` one test per `uses` row (Task 4) |
| T4 | Secrets never reach a tool or a trace | only `{{secret:<id>}}` in a declared fetch's headers/body (core broker); trace args/results/errors pass `hideSecrets` with the tool's stored values before the 2 KB cut | `tool-registry.test.ts` "a secret echoed back is redacted in the trace and the result's error" (Task 7) |
| T5 | Bad data never half-passes | params checked before `run`; result checked against `returns`; a mismatch is the tool's error | `tool-registry.test.ts` (Task 7) |
| T6 | Main stays up | rpc payload ≤ 12 MB and depth ≤ 40 refused unread; ≤ 32 calls in flight; per-call timeout; crash backoff; 5 crashes/hour → off | `tool-protocol.test.ts`, `tool-host.test.ts` (Task 6) |
| T7 | `agent: "none"` tools never reach the agent | the `tools` MCP server lists only `agent: "call"` tools; the rpc refuses an `agent: "none"` id from the agent caller | `tools-server.test.ts`, `tools-host.test.ts` "the agent can't call an agent: none tool" (Tasks 8, 9) |
| T8 | Files stay in the folder and its references | `ctx.files` resolves under the base or a reference root, `lstat` every level, no links out, ≤ 1 MB per read, ≤ 1000 entries per list | `tool-files.test.ts` (Task 4) |
| T9 | The renderer can't forge a caller | `hh:toolsCall` always traces `caller: "ui"` and takes no task or scope from the page except the open scope main already knows | `tools-ipc.test.ts` (Task 9) |

## Decisions (product questions take the spec's defaults; Marco may change any)

1. **Tool ids** follow the action-id pattern `^[a-z][a-z0-9_-]{0,63}$` and may not equal an action, job, block tool name, core block tool name or a core MCP server name (`ui`, `data`, `translate`, `review`, `material`, `tools`).
2. **`humanharness build`** is a new command (the spec says "the CLI build"; there is no harness build today). It writes `<harness>/dist/tools/<id>.js` and `<harness>/dist/tools.json`, replacing `dist/tools*` only on success. `dev` runs it before opening the app when `tools` is declared; `check` builds in memory and never writes.
3. **The app reads `<harness root>/dist/tools.json` at start.** Missing or invalid: tools are off (each call fails "Tools are not built: run humanharness build") and main logs why once. No staleness check against the sources in slice 2; packaging `dist/` into a shipped app is plan 4b's.
4. **`params` and `returns` use the plugins' JSON Schema allowlist** (`jsonSchemaToZod`): the build refuses anything outside it, naming the path.
5. **`ctx` in slice 2:** `fetch`, `exec`, `data.get/query/put/patch/delete`, `files.read/list`, `scope`, `log`. `inputs`, `requestAi` and `summary` come with pre-steps and recipes (slices 3–4). `uses.files: "write"` is refused by the checks ("files: write comes in a later slice"): spec §17 leaves it open; the default waits for a harness that needs it.
6. **`exec` for tools** runs as plugins' does: bare name through the login `PATH`, no shell, minimal env, cwd an empty `<userData>/tool-exec/<harness-id>/`, 30 s, 10 MB.
7. **The host** starts with the app (when tools are declared and built) and stays warm (spec §4.1; §17's memory measure is recorded in the docs, Task 13). Restart backoff 1 s, 2 s, 4 s … capped at 30 s. After 5 crashes in an hour tools are off until restart: every call fails "Tools are off after repeated crashes", `AppState.tools.off = true`, and when the app has an Attention store (plugins or board mode) an `action` item "Tools are off after repeated crashes. Restart the app to turn them on." is raised; otherwise the chat's top shows that line (Task 11).
8. **Trace files.** Per task `.harness/trace/<task-id>.jsonl`; per job run `.harness/trace/jobs/<run-id>.jsonl` (whatever the job is: today a `prompt` job's agent calls; later a `steps` job's steps); UI calls with no task `.harness/trace/ui/<YYYY-MM-DD>.jsonl`. Entries older than 30 days pruned at start. The history never tracks `.harness/trace/` (it is under `.harness/`, not in the keep list).
9. **The `tools` server joins every engine session that runs with the harness's own servers**: task slots and job slots alike (a `prompt` job's agent may call `agent: "call"` tools; nothing here assumes a job is an AI run). Never Sidekick, translate, review-only or system sessions. A call from a job slot traces `caller: "agent"`, `job: <job id>`, `run: <run id>`.
10. **The folded line** reads `<tool id> · <resultSummary> · <seconds> s · 0 tokens` ("pr-ci · 12 items · 0.3 s · 0 tokens"); an error line `<tool id> failed · <message>` and is unfolded; a refused access shows "access denied" in its unfolded accesses.
11. **Job inbox lines** (D4's "Job runs show the same lines in their inbox record") wait for slice 4, where recipes make job runs mostly tool steps; slice 2 writes the per-run trace and `client.tools.trace(runId)` returns it.
12. **`timeout`** in a tool file is in seconds, 1–120 (spec: "up to 120 s").
13. **Connect step `test`** and Settings › Connections "Test" come here (slice 1 Decision 4): `test?: toolId` names a tool with no required params; "Test connection" calls it with `{}` as `caller: "ui"`, shows "Works" or the error, and keeps `{ at, ok, message? }` per secret in `~/.humanharness/<harness-id>/connections.json` (no value, 0600).
14. **`client.tools.call` from the UI** runs in the open scope (or none) and with no task; it works before a task opens (Home's "for today").
15. **`ipc-surface.test.ts`** gains one allowed entry `tool-host.ts:"hh-tools:rpc"`: the tool host needs its own channel, as the plugin host has.
16. **The e2e fixture's `dist/`** is committed (the e2e can't build); a unit test rebuilds it in memory and compares, so it never goes stale.
17. **Context panel:** agent tool calls already show as `kind: "tool"` reads labelled `tools · <id>` (the server's name); no new kind in slice 2 (`"prepared"` is slice 3's).
18. **`ToolRefused`** is the name a refused `ctx` call throws in a tool (the spec's), as `PluginRefused` is for plugins.

## File structure

| File | Change | Responsibility |
|---|---|---|
| `packages/harness-sdk/src/tool.ts` | Create | `defineTool`, `ToolContext`, `ToolDefinition` (browser-safe) |
| `packages/harness-sdk/src/tools.ts`, `index.ts`, `package.json` (`./tool`) | Create/Modify | manifest key, ids, `toolsJsonSchema`, `toolProblems` |
| `packages/harness-sdk/src/data.ts` | Modify | `DataWho` gains `"tool"`; `RulesContext.tool?` |
| `packages/cli/src/tool.ts`, `package.json` (`./tool`) | Create/Modify | re-export for authors |
| `packages/cli/src/tool-build.ts`, `build.ts`, `main.ts`, `dev.ts`, `check.ts` | Create/Modify | build, command, dev/check hooks |
| `packages/cli/src/plugin-build.ts` | Modify | export `toolchain`, `common`, `bundleError` (additive) |
| `packages/workspace/src/data.ts`, `history.ts` | Modify | `who: "tool"`, `Tool:` trailer |
| `packages/shell/src/main/tools/tool-protocol.ts`, `tool-host.ts` | Create | sandbox host |
| `packages/shell/resources/tool-host.html`, `tool-host.mjs`, `tool-preload.cjs` | Create | host page, script, preload |
| `packages/shell/src/main/tools/tool-broker.ts`, `tool-files.ts` | Create | per-tool `ctx` |
| `packages/shell/src/main/tools/tool-registry.ts`, `tool-trace.ts`, `tools-json.ts` | Create | registry, trace, reading `tools.json` |
| `packages/shell/src/main/tools/tools-host.ts`, `tools-ipc.ts` | Create | wiring, channels |
| `packages/shell/src/main/index.ts`, `test-hooks.ts` | Modify | gated wiring |
| `packages/shell/electron.vite.config.ts` | Modify | `tools-server` entry |
| `packages/blocks/src/tools-server.ts`, `tools-server-bin.ts`, `launch.ts`, `index.ts` | Create/Modify | MCP server |
| `packages/runtime/src/workspace.ts`, `events.ts` | Modify | slot server; `tool-call` event |
| `packages/ui/src/client.ts`, `state.ts`, `ChatView.tsx`, `tools/ToolCallLine.tsx`; preload; fake client | Create/Modify | client and chat |
| `packages/shell/src/main/secrets/connections*.ts`, `packages/ui/src/connections/*` | Modify | Test |
| `packages/fake-agent/fixtures/tools-harness/` | Create | e2e fixture |
| `packages/e2e/tests/tools.spec.ts` | Create | e2e |
| `docs/architecture/tools.md` (new), `secrets.md`, `plugins.md`, `manifest.md`, `data.md`, `history.md`, `jobs.md`, `authoring.md` | Create/Modify | docs |

## Overlaps

- **Slice 1:** `Broker`, `BrokerGrant`, `SecretStore.harnessValues`, `missingSecretMessage`, `ConnectionsController`, the connect step.
- **Plugins:** the tool host copies the plugin host's settings but is a separate class, scheme, session and channel. `plugin-build.ts` gains exports only.
- **Jobs (part 3, built):** job slots get the `tools` server like task slots (Decision 9); the runner is untouched. Slice 4 adds `steps` beside `prompt`.
- **Data (scopes and data spec):** `who: "tool"` (§8.3). `rules` see it; a rule that compares `who === "agent"` is unaffected.
- **History:** a `Tool:` trailer (§8.3); `parseCommitMessage` reads it; the file timeline shows the tool's id as the author.
- **Context panel:** unchanged (Decision 17).
- **Hatches:** unchanged; `hatches-surface.test.ts` frozen.

## Open questions (each with the default this plan takes)

1. Host memory with tools warm (spec §17): warm by default; measured in Task 13 (`process.getProcessMemoryInfo` of the tool window, written in `tools.md`).
2. `files: "write"` (§17): refused in slice 2 (Decision 5).
3. Inbox lines for job runs (Decision 11): slice 4.
4. Folded line wording (Decision 10).

## Self-review (done while writing)

- Spec coverage (slice 2 list): `defineTool` (Task 1); build and `tools.json` (Task 2); checks §3.3 (Tasks 1, 3); host §4.1 (Task 6); broker §4.2 for tools (Task 4); `who: "tool"` and `Tool:` §8.3 (Task 5); registry §4.3 and trace §8.1 (Task 7); `tools` MCP server §5 (Task 8); `client.tools` §5 (Task 9); folded trace §8.2 (Task 11); errors §10 (Tasks 4, 6, 7); connect `test` §9 (Task 10); §13 unit rows for build, checks, registry, broker; e2e "refused access shown unfolded" and "folded trace in a chat" (Task 12).
- Not in slice 2 (later slices): pre-steps, `"prepared"`, `expects`, usage rows (3); recipes, `when`, `step_output`, `requestAi`, `summary` (4); `tool test`/`tool run`, guide, template tool, recorded broker accesses (5).
- Types: `ToolDefinition`, `ToolContext` (Task 1); `ToolsJson`, `ToolMeta` (Task 1); `ToolGrant` built in Task 4; `ToolCall`, `ToolCaller`, `TraceEntry` (Task 7); `ToolCallView` (Task 9, used in 11).

---

### Task 0: Branch and plan

**Files:** branch `feat/tools`; `docs/superpowers/plans/2026-10-29-tools-slice2-tools.md` (already committed by slice 1's Task 0: check it is identical to `SCRATCH/../plans/…-slice2-tools.md`; if it differs, copy and commit).

- [ ] **Step 1:** `git -C <worktree> status --short` empty; `git -C <worktree> branch --show-current` is `feat/tools-core`; its last commit is slice 1's docs commit.
- [ ] **Step 2:** `git -C <worktree> switch -c feat/tools`.
- [ ] **Step 3:** `cmp SCRATCH/../plans/2026-10-29-tools-slice2-tools.md <worktree>/docs/superpowers/plans/2026-10-29-tools-slice2-tools.md`. When it differs: `cp` it, then `git -C <worktree> commit --only docs/superpowers/plans/2026-10-29-tools-slice2-tools.md -m "docs: tools slice 2 plan, as approved" -m "<trailer>"`.
- [ ] **Step 4:** `corepack pnpm typecheck`, `corepack pnpm test` green; base line (HEAD, test count) in `carry-notes.md`. Confirm slice 1's names exist: `Broker`, `BrokerGrant` in `packages/shell/src/main/broker/broker.ts`; `harnessValues` in `secrets/secret-store.ts`; `missingSecretMessage` in `secrets/connections.ts`. If any is missing or named otherwise, note the real names in `carry-notes.md` and use them.

---

### Task 1: `defineTool`, the `tools` key and `tools.json`'s schema

**Files:**
- Create: `packages/harness-sdk/src/tool.ts`, `packages/harness-sdk/src/tools.ts`, `packages/cli/src/tool.ts`
- Modify: `packages/harness-sdk/src/index.ts`, `packages/harness-sdk/package.json` (exports `"./tool": "./src/tool.ts"`), `packages/cli/package.json` (exports `"./tool": "./src/tool.ts"`)
- Test: `packages/harness-sdk/test/tools.test.ts` (new)

- [ ] **Step 1: Write the failing tests.**

```ts
import { describe, expect, it } from "vitest";
import { defineHarness, hasTools, toolsJsonSchema } from "../src";
import { defineTool, z } from "../src/tool";

const base = {
  id: "t", name: "T", core: "^0.1.0", engines: ["claude"], folder: { suggested: "Documents/T" }, instructions: "./AGENTS.md",
  permissions: { edit: "folder" as const, exec: true, web: true }, blocks: {}, author: "x",
  actions: { study: { label: "Study", prompt: "./prompts/study.md", cost: "light" as const } },
};

describe("tools in the manifest (tools spec §3)", () => {
  it("D0: no tools key without it", () => {
    const h = defineHarness(base);
    expect("tools" in h).toBe(false);
    expect(hasTools(h)).toBe(false);
  });
  it("maps ids to relative .ts/.js files", () => {
    expect(defineHarness({ ...base, tools: { "due-today": "./tools/due-today.ts" } }).tools).toEqual({ "due-today": "./tools/due-today.ts" });
  });
  it("refuses a bad id, an absolute path and an id that clashes with an action, a job or a core server", () => {
    expect(() => defineHarness({ ...base, tools: { "Due": "./tools/a.ts" } })).toThrow();
    expect(() => defineHarness({ ...base, tools: { a: "/abs/a.ts" } })).toThrow();
    expect(() => defineHarness({ ...base, tools: { study: "./tools/a.ts" } })).toThrow(/clashes with an action/);
    expect(() => defineHarness({ ...base, tools: { data: "./tools/a.ts" } })).toThrow(/core MCP server/);
  });
});

describe("defineTool (tools spec §3.1)", () => {
  it("defaults agent to call and keeps the definition", () => {
    const t = defineTool({ description: "Counts the notes in the folder by month.", params: z.object({}), run: async () => 1 });
    expect(t.agent).toBe("call");
    expect(t.uses).toEqual({});
  });
  it("refuses a timeout outside 1–120 seconds", () => {
    expect(() => defineTool({ description: "x".repeat(30), params: z.object({}), timeout: 121, run: async () => 1 })).toThrow();
  });
});

describe("tools.json (tools spec §3.2)", () => {
  it("accepts one entry per tool with JSON Schemas and refuses unknown keys", () => {
    const ok = { version: 1, tools: { "due-today": { description: "Reviews due today and the next concept.", agent: "call", uses: { data: { read: ["cards"] } }, params: { type: "object", properties: {} }, returns: { type: "array", items: { type: "object", properties: {} } }, timeout: 30, file: "tools/due-today.js" } } };
    expect(toolsJsonSchema.parse(ok).tools["due-today"].agent).toBe("call");
    expect(() => toolsJsonSchema.parse({ ...ok, extra: 1 })).toThrow();
  });
});
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement `tool.ts`** (no Node import: the tool bundle includes it):

```ts
// No Node imports: every tool's sandbox bundle includes this file (tools spec D2).
import { z } from "zod";
export { z };

/** What a refused `ctx` call throws (tools spec §4.2): `name` is "ToolRefused", `message` the reason. */
export interface ToolRefusedError extends Error {
  name: "ToolRefused";
}

export interface ToolUses {
  /** Host patterns (as a plugin's `permissions.hosts`): needs the harness's `web`. */
  hosts?: string[];
  /** Ids of the harness's `secrets`, named as `{{secret:<id>}}` in a fetch's headers or body. */
  secrets?: string[];
  /** Command patterns (as a plugin's `permissions.exec`): needs the harness's `exec`. */
  exec?: { cmd: string; args: string[] }[];
  /** The harness's collections this tool reads and writes. */
  data?: { read?: string[]; write?: string[] };
  /** `"read"`: the person's folder and its references (`"write"` comes in a later slice). */
  files?: "read" | "write";
}

export interface ToolResponse {
  url: string;
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  text(): string;
  json(): unknown;
}

/** The only way a tool reaches the world (tools spec D2, §4.2). Each call is checked against the tool's `uses`. */
export interface ToolContext {
  fetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<ToolResponse>;
  exec(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }>;
  data: {
    get(collection: string, key?: string | number): Promise<Record<string, unknown> | null>;
    query(collection: string, q?: { where?: Record<string, unknown>; fields?: string[]; limit?: number }): Promise<{ records: Record<string, unknown>[]; total: number }>;
    put(collection: string, record: Record<string, unknown>): Promise<void>;
    patch(collection: string, key: string | number | undefined, patch: Record<string, unknown>): Promise<void>;
    delete(collection: string, key?: string | number): Promise<void>;
  };
  files: { read(path: string): Promise<string>; list(dir: string, glob?: string): Promise<string[]> };
  /** The scope of the calling task or job run, or null. */
  scope: string | null;
  log(level: "info" | "warn" | "error", message: string): void;
}

export interface ToolDefinition<P extends z.ZodObject = z.ZodObject, R extends z.ZodType = z.ZodType> {
  description: string;
  params: P;
  returns?: R;
  agent: "call" | "none";
  uses: ToolUses;
  /** Seconds, 1–120; default 30. */
  timeout?: number;
  /** One line for the trace; default a generic one ("12 items"). */
  summary?(result: z.output<R>): string;
  run(args: z.output<P>, ctx: ToolContext): Promise<z.output<R>>;
}

type ToolInput<P extends z.ZodObject, R extends z.ZodType> = Omit<ToolDefinition<P, R>, "agent" | "uses"> & { agent?: "call" | "none"; uses?: ToolUses };

/** A tool file's default export (tools spec §3.1). `humanharness build` reads it; the app never imports it. */
export function defineTool<P extends z.ZodObject, R extends z.ZodType = z.ZodType>(d: ToolInput<P, R>): ToolDefinition<P, R> {
  if (d.timeout !== undefined && (!Number.isInteger(d.timeout) || d.timeout < 1 || d.timeout > 120)) throw new Error("timeout is a whole number of seconds from 1 to 120");
  return { ...d, agent: d.agent ?? "call", uses: d.uses ?? {} };
}
```

`tools.ts`: `TOOL_ID = /^[a-z][a-z0-9_-]{0,63}$/`; `toolsSchema = z.record(z.string().regex(TOOL_ID), z.string().regex(/^\.\/[^:]*\.(ts|mts|js|mjs)$/))` with a refine "at most 50 tools"; `hasTools = (h) => !!h.tools && Object.keys(h.tools).length > 0`; `CORE_SERVER_NAMES = ["ui", "data", "translate", "review", "material", "tools"]`; `toolsJsonSchema` (strict):

```ts
const usesJson = z.strictObject({
  hosts: z.array(z.string()).max(20).optional(),
  secrets: z.array(z.string()).max(10).optional(),
  exec: z.array(z.strictObject({ cmd: z.string(), args: z.array(z.string()) })).max(10).optional(),
  data: z.strictObject({ read: z.array(z.string()).optional(), write: z.array(z.string()).optional() }).optional(),
  files: z.enum(["read", "write"]).optional(),
});
export const toolMetaSchema = z.strictObject({
  description: z.string().min(1).max(1000),
  agent: z.enum(["call", "none"]),
  uses: usesJson,
  params: z.record(z.string(), z.unknown()),
  returns: z.record(z.string(), z.unknown()).optional(),
  timeout: z.int().min(1).max(120),
  /** Relative to dist/: `tools/<id>.js`. */
  file: z.string().regex(/^tools\/[a-z][a-z0-9_-]{0,63}\.js$/),
});
export const toolsJsonSchema = z.strictObject({ version: z.literal(1), tools: z.record(z.string().regex(TOOL_ID), toolMetaSchema) });
export type ToolsJson = z.output<typeof toolsJsonSchema>;
export type ToolMeta = z.output<typeof toolMetaSchema>;
```
In `index.ts`: `export * from "./tools";`, `tools: toolsSchema.optional()` in the manifest (comment "Typed code the AI, the UI and the runner call (tools spec §3). Absent: none (D0)."), and in `superRefine`, for each id: clash with `m.actions`, `m.jobs`, any block's tool name (`tools` map already built there), `CORE_SERVER_NAMES` ("is a core MCP server name"). `loadHarness`: `for (const f of Object.values(loaded.tools ?? {})) resolveInHarness(loaded, f);`. `packages/cli/src/tool.ts`: `export { defineTool, z, type ToolContext, type ToolDefinition } from "@humanharness/harness-sdk/tool";`.

- [ ] **Step 4: Run, typecheck, commit.**

```bash
git -C <worktree> add packages/harness-sdk/src/tool.ts packages/harness-sdk/src/tools.ts packages/cli/src/tool.ts packages/harness-sdk/test/tools.test.ts
git -C <worktree> commit --only packages/harness-sdk/src/tool.ts packages/harness-sdk/src/tools.ts packages/harness-sdk/src/index.ts packages/harness-sdk/package.json packages/cli/src/tool.ts packages/cli/package.json packages/harness-sdk/test/tools.test.ts -m "feat(sdk): defineTool, the tools key and tools.json" -m "<trailer>"
```

---

### Task 2: `humanharness build`: bundles and `tools.json`

**Files:**
- Create: `packages/cli/src/tool-build.ts`, `packages/cli/src/build.ts`
- Modify: `packages/cli/src/plugin-build.ts` (export `toolchain`, `common`, `bundleError`, `writeDist`; no behaviour change), `packages/cli/src/main.ts` (command `build`, USAGE line), `packages/cli/src/dev.ts` (build first when tools), `packages/cli/src/check.ts` (in-memory build, Task 3 adds the rules)
- Test: `packages/cli/test/tool-build.test.ts` (new)

- [ ] **Step 1: Write the failing tests.** Each builds a temp harness folder (manifest + `tools/*.ts`) with the helpers in `packages/cli/test/helpers.ts`.

```ts
describe("humanharness build (tools spec §3.2)", () => {
  it("writes dist/tools/<id>.js and dist/tools.json with JSON Schemas, description, agent, uses and timeout", async () => {
    // tool count-notes: params z.object({ month: z.string().optional() }), returns z.array(z.object({ path: z.string() })),
    // uses { files: "read" }. After buildTools(dir): tools.json parses with toolsJsonSchema; params.properties.month.type
    // is "string"; returns.type "array"; timeout 30; file "tools/count-notes.js"; the .js exists.
  });
  it("a Node built-in fails the build naming it", async () => {
    // tools/bad.ts imports "node:fs" → CliError whose message contains "node:fs" and "tools/bad.ts"; dist/ is not written
  });
  it("a bare built-in name (fs, child_process) fails too", async () => { /* import "child_process" */ });
  it("a schema outside the allowlist fails naming the tool and path", async () => {
    // params with z.string().regex(/x/) → "count-notes: params.properties.x: …" (the allowlist refuses pattern)
  });
  it("a default export that is not defineTool(...) fails naming the file", async () => { /* export default 42 */ });
  it("the sandbox bundle has no import of anything but its own code", async () => {
    // the emitted .js contains no `import(` of a bare specifier and no `require(`
  });
  it("replaces dist/tools* only on success; other files in dist/ stay", async () => { /* … */ });
  it("D0: check and dev write nothing for a harness without tools", async () => {
    // run checkCommand on a harness without tools: no dist/ folder appears; devCommandLine with a stubbed launcher: no build
  });
});
```
Write each body in full.

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement `tool-build.ts`.**
  - `buildTools(dir, o: { write: boolean })`: `loadHarness` the manifest (it already validates `tools` paths); for each id, two esbuild builds with `common(t, dir, files)` where `files` aliases `@humanharness/cli/tool` and `@humanharness/harness-sdk/tool` to `packages/harness-sdk/src/tool.ts`, and `zod` to the CLI's zod:
    - sandbox: `platform: "browser"`, `format: "esm"`, `target: "chrome130"`, `outfile: "<id>.js"`, plus a resolve plugin `refuseNode` that fails any `node:*` or any name in `module.builtinModules` with `` `${importer}: imports ${name}, which a tool can't use: tools reach the world only through ctx` ``;
    - metadata: `platform: "node"`, a stdin entry like `configJson`'s that imports the tool file and `toolMeta` (below), run from a temp `.mjs` (removed in `finally`).
  - `toolMeta(def)` lives in the SDK's `tools.ts` (pure, used by the build only): checks `def` has `description`, `params instanceof z.ZodObject`, `run` a function; returns `{ description, agent, uses, params: z.toJSONSchema(params, { io: "input" }), returns?: z.toJSONSchema(returns), timeout: def.timeout ?? 30 }`; each schema passes `jsonSchemaToZod` (the plugins' allowlist) or throws `` `${id}: params: ${reason}` ``. Use the same `tidyJsonSchema` the plugins use (export it from `plugin.ts` if needed, additive).
  - `write`: files `tools/<id>.js` and `tools.json` (`{ version: 1, tools }`, keys sorted, 2-space JSON plus newline) into `<dir>/dist/` by building a temp `dist/.tools-<tag>/` and renaming `tools/` and `tools.json` into place (a failure leaves the previous ones).
  - `build.ts`: `buildCommand(args, io)`: `--harness <dir>` like `check`; prints `Built N tools into dist/` or the errors; exit 1 on error. A harness without tools prints "This harness declares no tools." and writes nothing.
  - `main.ts`: `build: buildCommand`; USAGE line `"  build [--harness <dir>]                  Bundle the harness's tools into dist/ (tools.json)"`.
  - `dev.ts`: when `hasTools(harness)`, `await buildTools(dir, { write: true })` before launching; a build error stops `dev` with the error.
  - `check.ts`: when `hasTools`, `buildTools(dir, { write: false })` and report a failure as rule `tool-build` (error). Task 3 adds the other rules.

- [ ] **Step 4: Run** the new test and every `packages/cli/test/plugin-*.test.ts` (unchanged), `check.test.ts`, `dev.test.ts`, `main.test.ts` (USAGE: update only if it pins the full text; say so). Typecheck.

- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/cli/src/tool-build.ts packages/cli/src/build.ts packages/cli/test/tool-build.test.ts
git -C <worktree> commit --only packages/cli/src/tool-build.ts packages/cli/src/build.ts packages/cli/src/plugin-build.ts packages/cli/src/main.ts packages/cli/src/dev.ts packages/cli/src/check.ts packages/harness-sdk/src/tools.ts packages/harness-sdk/src/plugin.ts packages/cli/test/tool-build.test.ts -m "feat(cli): humanharness build bundles tools for the sandbox and writes tools.json" -m "<trailer>"
```

---

### Task 3: The checks of §3.3 that slice 2 needs

**Files:**
- Modify: `packages/harness-sdk/src/tools.ts` (`toolProblems`), `packages/cli/src/check.ts`
- Test: `packages/harness-sdk/test/tool-problems.test.ts` (new), `packages/cli/test/check.test.ts` (append)

- [ ] **Step 1: Write the failing tests** (one per rule, each with the exact message):

```ts
describe("toolProblems (tools spec §3.3)", () => {
  it("hosts need permissions.web", () => expect(msgs({ web: false }, { hosts: ["api.x.com"] })).toContain('due-today: uses.hosts needs permissions.web'));
  it("exec needs permissions.exec", () => expect(msgs({ exec: false }, { exec: [{ cmd: "gh", args: ["*"] }] })).toContain("due-today: uses.exec needs permissions.exec"));
  it("files: read is fine; files: write is refused for now", () => expect(msgs({}, { files: "write" })).toContain("due-today: uses.files: write comes in a later slice; use read"));
  it("data names collections that exist; write ones too", () => expect(msgs({}, { data: { write: ["nope"] } })).toContain('due-today: uses.data.write: "nope" is not a collection'));
  it("secrets name declared secrets", () => expect(msgs({}, { secrets: ["jira"] })).toContain('due-today: uses.secrets: "jira" is not declared in secrets'));
  it("hosts and exec use the plugin patterns (HOST_PATTERN, bare cmd, * last)", () => expect(msgs({ web: true }, { hosts: ["https://x.com"] })).toContain("due-today: uses.hosts: \"https://x.com\" is not a host pattern"));
  it("an agent: call tool has a description of at least 20 characters that is not its id", () => {
    expect(msgs({}, {}, { description: "due-today" })).toContain("due-today: an agent: call tool needs a description of at least 20 characters that says what it does");
  });
  it("the manifest and tools.json list the same ids", () => { /* a tool in the manifest, missing from tools.json → "due-today: not built (run humanharness build)"; and the reverse */ });
});
```
(The connect-step `test` rule is Task 10's. `msgs(perms, uses, meta?)` is a local helper building a manifest and a one-tool `ToolsJson`, returning `toolProblems(...).map((p) => p.message)`.)

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement** `toolProblems(m, json): { tool: string; message: string }[]` with exactly those messages (reuse `HOST_PATTERN` and the exec-pattern checks the plugin schema uses; import, don't copy). `check.ts`: rule `tool-uses` (error) for each problem, after `tool-build`. Main also runs `toolProblems` when it reads `tools.json` (Task 7's `readToolsJson`): any problem turns tools off with the first message logged.

- [ ] **Step 4: Run, typecheck, commit.**

```bash
git -C <worktree> add packages/harness-sdk/test/tool-problems.test.ts
git -C <worktree> commit --only packages/harness-sdk/src/tools.ts packages/cli/src/check.ts packages/harness-sdk/test/tool-problems.test.ts packages/cli/test/check.test.ts -m "feat(sdk): tool checks — uses inside permissions, declared secrets and collections, descriptions" -m "<trailer>"
```

---

### Task 4: The tool broker and `ctx.files`

**Files:**
- Create: `packages/shell/src/main/tools/tool-broker.ts`, `packages/shell/src/main/tools/tool-files.ts`
- Test: `packages/shell/test/tools/tool-broker.test.ts`, `packages/shell/test/tools/tool-files.test.ts` (new)

- [ ] **Step 1: Write the failing tests.**

```ts
// tool-broker.test.ts
describe("ToolBroker: one core broker per tool, bound to its uses (tools spec §4.2, D7)", () => {
  it("TOOL_CALLS is fetch, exec, data.get/query/put/patch/delete, files.read, files.list, log", () => { /* sorted equality */ });
  it("fetch: a host outside uses.hosts is refused with ToolRefused-style text naming uses.hosts", async () => { /* … */ });
  it("fetch: {{secret:jira}} is filled only when uses.secrets names it; another id is refused before the store is read", async () => { /* store double records asked ids */ });
  it("a missing secret fails with '<label> is not set — Settings › Connections'", async () => { /* harnessValues returns {} */ });
  it("exec: only uses.exec patterns; cwd is <userData>/tool-exec/<harness-id>/", async () => { /* … */ });
  it("data: reads only uses.data.read ∪ write; writes only uses.data.write; each goes out with who: tool and the tool's id", async () => {
    // data dep records { op, who, tool }: put on a read-only collection refused; get on it allowed
  });
  it("files: refused without uses.files; read and list allowed with read", async () => { /* … */ });
  it("a run carries the caller's scope; ctx.scope is that scope or null", async () => { /* startCall({ scope: "intro" }) → answer of the "scope" call */ });
  it("every allowed and refused access is recorded for the trace", async () => {
    // accesses(): [{ kind: "fetch", target: "https://api.x.com/a", allowed: true }, { kind: "exec", target: "gh repo delete x", allowed: false }]
  });
});
```

```ts
// tool-files.test.ts
describe("ctx.files (tools spec §4.2; T8)", () => {
  it("read returns a file's text under the folder, at most 1 MB", async () => { /* … */ });
  it("refuses .., an absolute path, a link out of the folder and a hard link", async () => { /* … */ });
  it("reads under a reference root by its id prefix (refs/<id>/...)", async () => { /* … */ });
  it("list returns relative paths, sorted, at most 1000, with an optional glob (*, **)", async () => { /* … */ });
  it("never lists .harness/ or .git/", async () => { /* … */ });
});
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**
  - `tool-files.ts`: `toolFiles({ base, references }: { base: string; references: { id: string; path: string }[] })` → `{ read(rel): Promise<string>; list(dir, glob?): Promise<string[]> }`. Paths: `refs/<id>/…` reach a reference; anything else is relative to the base. Each level `lstat`ed, links refused, files opened `O_NOFOLLOW | O_NONBLOCK`, `nlink > 1` refused, `.harness` and `.git` refused at any depth. Glob: `*` within a segment, `**` across segments, built without `RegExp` from the pattern text (a small matcher over segments).
  - `tool-broker.ts`:

```ts
/** The calls a tool's ctx makes (tools spec §4.2, slice 2: no inputs, requestAi or summary yet). */
export const TOOL_CALLS: readonly string[] = ["fetch", "exec", "data.get", "data.query", "data.put", "data.patch", "data.delete", "files.read", "files.list", "scope", "log"];

export interface ToolBrokerDeps {
  harnessId: string;
  tool: string;
  meta: ToolMeta;
  /** The manifest's secrets: their labels for the missing-key message. */
  secrets: readonly HarnessSecret[];
  store: Pick<SecretStore, "harnessValues">;
  /** The person-side data path, as tool (`who: "tool"`, `tool`), in the call's scope. */
  data(op: BrokerDataOp, ctx: { scope: string | null; tool: string }): Promise<unknown>;
  files(scope: string | null): Promise<ReturnType<typeof toolFiles>>;
  fetch: typeof fetch;
  exec: CoreBrokerDeps["exec"];
  log(level: "info" | "warn" | "error", message: string): Promise<void>;
  transport?(key: string): { fetch: typeof fetch; run: typeof runFile };
}

/** One tool's broker: a core Broker whose grant is the tool's `uses` (D7). One run per call (`startCall`). */
export class ToolBroker {
  readonly core: Broker;
  private readonly calls = new Map<string, { scope: string | null; accesses: TraceAccess[] }>();
  constructor(private readonly d: ToolBrokerDeps) { /* build grant + extra handlers below */ }
  startCall(scope: string | null): { id: string; signal: AbortSignal };
  endCall(id: string): { accesses: TraceAccess[] };
  call(id: unknown, name: unknown, args: unknown): Promise<BrokerAnswer>;
}
```
  The grant: `hosts: uses.hosts ?? []`, `secrets: uses.secrets ?? []`, `exec: uses.exec ?? []`, `collection: (n, write) => (write ? (uses.data?.write ?? []).includes(n) : [...(uses.data?.read ?? []), ...(uses.data?.write ?? [])].includes(n))`, refusals naming `uses.data`, `uses.secrets`, `uses.exec`. The `secrets` dep: `async (ids) => { const v = await store.harnessValues(ids); const missing = ids.find((id) => !Object.hasOwn(v, id)); if (missing) throw new Error(missingSecretMessage(label(missing))); return v; }` (the core broker turns the throw into a refusal with that text). `extra` handlers: `files.read`, `files.list` (refused "This tool doesn't declare uses.files" without it), `scope` (answers the run's scope). Accesses are recorded by wrapping `fetch`, `exec`, `data`, `files` deps and by reading each refusal: `{ kind, target, allowed }`, target cut to 200 characters, never a header or body.

- [ ] **Step 4: Run, typecheck, commit.**

```bash
git -C <worktree> add packages/shell/src/main/tools/tool-broker.ts packages/shell/src/main/tools/tool-files.ts packages/shell/test/tools/tool-broker.test.ts packages/shell/test/tools/tool-files.test.ts
git -C <worktree> commit --only packages/shell/src/main/tools/tool-broker.ts packages/shell/src/main/tools/tool-files.ts packages/shell/test/tools/tool-broker.test.ts packages/shell/test/tools/tool-files.test.ts -m "feat(shell): the tool broker — a core broker per tool, bound to its uses" -m "<trailer>"
```

---

### Task 5: `who: "tool"` in data and a `Tool:` trailer in history

**Files:**
- Modify: `packages/harness-sdk/src/data.ts` (`DataWho`, `RulesContext.tool?`), `packages/workspace/src/data.ts` (`DataContext.tool?`, passes it to rules and change events), `packages/workspace/src/history.ts` (`HistoryTrailer.tool?`, `withTrailer`, `parseCommitMessage`), `packages/shell/src/main/data-requests.ts` (a `toolDataRequest` beside `personDataRequests`), file timeline author
- Test: `packages/workspace/test/data-tool.test.ts` (new), `packages/workspace/test/history.test.ts` (append), `packages/shell/test/data-requests.test.ts` (append)

- [ ] **Step 1: Write the failing tests.**

```ts
describe("who: tool (tools spec §8.3)", () => {
  it("a tool's write reaches rules with who: tool and its id", async () => { /* rules spy sees { who: "tool", tool: "apply-triage" } */ });
  it("a collection with agent: none is still writable by a tool that declares it", async () => { /* agent rules don't apply to tool */ });
  it("D0: who stays agent/person/app without a tool", async () => { /* existing write paths: no `tool` key in RulesContext or DataChange */ });
});
describe("Tool: trailer", () => {
  it("withTrailer writes Tool: after the task's lines", () => expect(withTrailer("Data: put cards", { task: "t1", tool: "apply-triage" })).toBe("Data: put cards\n\nTask: t1\nTool: apply-triage"));
  it("a tool write with no task carries Tool: alone", () => expect(withTrailer("Data: put cards", { task: null, tool: "due-today" } as never)).toBe("Data: put cards\n\nTool: due-today"));
  it("parseCommitMessage reads it back", () => { /* … */ });
  it("D0: withTrailer without tool writes what it wrote", () => { /* the existing expectations, re-asserted */ });
});
```
(Match `HistoryTrailer`'s real shape — `task` may be required; if so, add `toolOnly` handling as the code suggests and say so.)

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.** `DataWho = "agent" | "person" | "app" | "tool"`; `DataContext.tool?: string` (only with `who: "tool"`); `RulesContext.tool?: string`. The agent-only checks (`who === "agent"`) stay as they are. `toolDataRequest(d, op, { scope, tool })` runs the op through the same store and commit path as the person's write with `who: "tool"`, its commit message trailer `{ task: <calling task or null>, tool }`. File timeline: an entry whose commit has `Tool:` shows the tool's id as the author.

- [ ] **Step 4: Run** the new tests, `runtime-d0.test.ts`, `history.spec` is e2e (Task 13), typecheck.

- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/workspace/test/data-tool.test.ts
git -C <worktree> commit --only packages/harness-sdk/src/data.ts packages/workspace/src/data.ts packages/workspace/src/history.ts packages/shell/src/main/data-requests.ts packages/workspace/test/data-tool.test.ts packages/workspace/test/history.test.ts packages/shell/test/data-requests.test.ts -m "feat(workspace): who: tool in data and a Tool: trailer in history" -m "<trailer>"
```
(Add the file-timeline file to `--only` if touched.)

---

### Task 6: The tool host (sandboxed window, `hh-tools:` scheme, `hh-tools:rpc`)

**Files:**
- Create: `packages/shell/src/main/tools/tool-protocol.ts`, `packages/shell/src/main/tools/tool-host.ts`, `packages/shell/resources/tool-host.html`, `packages/shell/resources/tool-host.mjs`, `packages/shell/resources/tool-preload.cjs`
- Modify: `packages/shell/test/ipc-surface.test.ts` (one allowed entry; Decision 15)
- Test: `packages/shell/test/tools/tool-protocol.test.ts`, `packages/shell/test/tools/tool-host-script.test.ts`, `packages/shell/test/tools/tool-host.test.ts` (new)

- [ ] **Step 1: Write the failing tests.**

```ts
// tool-protocol.test.ts — mirror plugin-protocol.test.ts's cases with tool names:
// "serves only hh-tools://<harness-id>/tools/<id>.js and the core's _hh/ files"
// "refuses another host, .., a dot segment, an encoded slash, a link, a hard link, a non-.js file under tools/"
// "every response carries TOOL_CSP, nosniff, no-store"
// "allowToolRequest lets only its own hh-tools URLs through"
// "a frame at another URL or another window is not the host" (toolOfSender, isToolFrame)
// "parseToolRpc: ready { tools: string[] , errors }, next, done { callId, ok, value | error }, ctx { callId, name, args ≤ 8 }; a payload over 12 MB or deeper than 40 is refused unread"
```
```ts
// tool-host-script.test.ts — load resources/tool-host.mjs in a vm-free way as plugin-host-script.test.ts does:
// "imports every dist tool, reports ready with the ids that loaded and each load error"
// "a call runs run(args, ctx) and answers done with the value and summary(result) when the tool has one"
// "calls run concurrently: a slow call doesn't hold the next"
// "a refused ctx call throws an Error named ToolRefused"
// "a thrown error answers done { ok: false, error } cut to 16,000 characters"
```
```ts
// tool-host.test.ts — with a fake electron (BrowserWindow, session, protocol, ipcMain doubles), as plugin-host.test.ts:
// "start opens one hidden sandboxed window with the plugin settings (sandbox, contextIsolation, no node, no webview)"
// "registers hh-tools:rpc once, only at start (D0)"
// "a crash restarts with backoff 1 s, 2 s, 4 s … ≤ 30 s"
// "the 5th crash within an hour turns tools off: off() is reported once and every call answers 'Tools are off after repeated crashes'"
// "a call times out after the tool's timeout and the host is not restarted for it"
// "≤ 32 calls in flight; the 33rd is refused 'Too many tool calls at once'"
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**
  - `tool-protocol.ts`: `TOOL_SCHEME = { scheme: "hh-tools", privileges: { standard: true, secure: true } }`, `TOOL_CSP` (same text as `PLUGIN_CSP`), `toolHostUrl(id)`, `resolveToolFile(url, { id, dist, core })` serving `_hh/host.html`, `_hh/host.js` from `core` and `tools/<id>.js` from `<dist>/tools/` with the same per-segment rules, realpath, regular file, `nlink === 1`, ≤ 10 MB, `O_NOFOLLOW` then device/inode compare as `readPluginFile`; `allowToolRequest`, `isToolFrame`, `toolOfSender`, `parseToolRpc` (shapes above; `TOOL_RPC_MAX_BYTES = 12 MiB`, depth 40). Reuse `plugin-protocol.ts`'s internal helpers by exporting them there (additive exports only) rather than copying, where they are generic.
  - `resources/tool-host.mjs`: like `plugin-host.mjs`: `ready` after `import()` of each `../tools/<id>.js` named in the host page's query (main passes the built ids), then a loop that takes `next` and runs each `{ kind: "call", callId, tool, args, scope }` without awaiting it before the next `next`; `ctx` as `ToolContext` (`files.read/list`, `scope` from the command, `log` fire-and-forget); refusals throw `ToolRefused`.
  - `tool-preload.cjs`: `contextBridge.exposeInMainWorld("hh", { rpc: (method, args) => ipcRenderer.invoke("hh-tools:rpc", method, JSON.stringify(args ?? null)) })`.
  - `tool-host.ts`: `ToolHost` with `start({ harnessId, dist, ids, channel })`, `stop()`, `onCrash`, `off`. Window options copied from `PluginBackendHost.start` (show false, sandbox, contextIsolation, no node in frames/workers, no webview, webSecurity, disableDialogs, devTools only in dev). Session `session.fromPartition("hh-tools-<harness-id>")` set up once (handler, request filter, permissions denied, downloads cancelled, navigation guards).
  - `ipc-surface.test.ts`: the expected list becomes `["index.ts:channel", 'plugin-host.ts:"hh-plugin:rpc"', 'tools/tool-host.ts:"hh-tools:rpc"']` and `ipcMain` may be named in `tools/tool-host.ts` too. No other change to that file.

- [ ] **Step 4: Run, typecheck, `corepack pnpm app:build`, commit.**

```bash
git -C <worktree> add packages/shell/src/main/tools/tool-protocol.ts packages/shell/src/main/tools/tool-host.ts packages/shell/resources/tool-host.html packages/shell/resources/tool-host.mjs packages/shell/resources/tool-preload.cjs packages/shell/test/tools/tool-protocol.test.ts packages/shell/test/tools/tool-host-script.test.ts packages/shell/test/tools/tool-host.test.ts
git -C <worktree> commit --only packages/shell/src/main/tools/tool-protocol.ts packages/shell/src/main/tools/tool-host.ts packages/shell/src/main/plugin-protocol.ts packages/shell/resources/tool-host.html packages/shell/resources/tool-host.mjs packages/shell/resources/tool-preload.cjs packages/shell/test/ipc-surface.test.ts packages/shell/test/tools/tool-protocol.test.ts packages/shell/test/tools/tool-host-script.test.ts packages/shell/test/tools/tool-host.test.ts -m "feat(shell): the tool host — one sandboxed window per harness" -m "<trailer>"
```

---

### Task 7: The registry, `tools.json` in main, and the trace

**Files:**
- Create: `packages/shell/src/main/tools/tools-json.ts`, `packages/shell/src/main/tools/tool-registry.ts`, `packages/shell/src/main/tools/tool-trace.ts`
- Test: `packages/shell/test/tools/tools-json.test.ts`, `packages/shell/test/tools/tool-registry.test.ts`, `packages/shell/test/tools/tool-trace.test.ts` (new)

- [ ] **Step 1: Write the failing tests.**

```ts
// tools-json.test.ts
// "reads dist/tools.json (≤ 1 MB, no link, O_NOFOLLOW), parses it and runs toolProblems: tools on"
// "missing: off with 'Tools are not built: run humanharness build'"
// "a problem: off with its message"; "a tool in the manifest missing from tools.json: off"
```
```ts
// tool-registry.test.ts — host double answering by tool id; trace double recording entries
describe("ToolRegistry (tools spec §4.3)", () => {
  it("invalid arguments: the tool does not run; the caller gets the validation error", async () => { /* host.calls === 0 */ });
  it("a result that does not match returns fails with the first mismatch", async () => { /* … */ });
  it("times out after 30 s by default and after the tool's timeout when set", async () => { /* vi.useFakeTimers */ });
  it("an unknown id or an agent: none tool from the agent caller is refused", async () => { /* T7 */ });
  it("writes one trace entry per call: caller, task/job/run, args, resultSummary, ms, ok, accesses", async () => { /* … */ });
  it("a secret echoed back is redacted in the trace and the result's error", async () => {
    // broker store gives "tok-SECRET-1234"; the host answers error "bad token tok-SECRET-1234" → error and trace hold "[redacted]"
  });
  it("args and results are cut at 2 KB per entry in the trace, never in the answer", async () => { /* … */ });
  it("resultSummary: the tool's summary(), else '12 items' / 'object with 4 keys' / 'text, 40 characters'", async () => { /* … */ });
  it("off: every call answers the off reason", async () => { /* … */ });
});
```
```ts
// tool-trace.test.ts
// "a task's entries go to .harness/trace/<task>.jsonl; a job run's to jobs/<run>.jsonl; a UI call's to ui/<day>.jsonl"
// "read(task|run) returns the entries, newest last, skipping a torn last line"
// "prune removes entries older than 30 days at start (whole files by mtime, lines by `at`)"
// "no links under .harness/trace (no-links rules): a linked trace folder is refused and nothing is written through it"
// "ids that aren't task/run ids are refused (no path from a caller)"
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**

```ts
// tool-registry.ts
export type ToolCaller = "ui" | "agent" | "pre" | "job";
export interface ToolCall {
  tool: string;
  args: unknown;
  caller: ToolCaller;
  scope: string | null;
  task?: string;
  job?: string;
  run?: string;
  phase?: string;
}
export type ToolAnswer = { ok: true; result: unknown } | { ok: false; error: string };

export interface ToolRegistryDeps {
  json(): Promise<{ on: true; tools: ToolsJson["tools"] } | { on: false; reason: string }>;
  host: { call(c: { callId: string; tool: string; args: unknown; scope: string | null }, timeoutMs: number): Promise<{ ok: true; value: unknown; summary?: string } | { ok: false; error: string }>; off(): string | null };
  broker(tool: string): ToolBroker;
  trace: Pick<ToolTrace, "append">;
  /** The tool's stored secret values, to hide in errors and the trace (T4). */
  secretValues(tool: string): Promise<string[]>;
  /** A call ended: the chat's folded line (Task 11). */
  called?(entry: TraceEntry): void;
  now?(): Date;
}

export class ToolRegistry {
  async call(c: ToolCall): Promise<ToolAnswer> {
    // 1. json on? tool known (Object.hasOwn)? agent caller and meta.agent === "none" → refused
    // 2. params: jsonSchemaToZod(meta.params).safeParse(c.args) → first issue as "path: message"
    // 3. broker.startCall(scope); host.call({ callId: run.id, … }, (meta.timeout) * 1000); broker.endCall → accesses
    // 4. returns: when meta.returns, safeParse the value → mismatch is the tool's error
    // 5. hide secrets (hideSecrets from plugin-fixtures) in error; trace.append(entry) with 2 KB cuts; called?.(entry)
  }
}
```
`TraceEntry` is §8.1's shape plus `run?`. Cuts: `JSON.stringify(x)`, cut by code points at 2048, a cut value stored as `{ cut: true, text }`. `tool-trace.ts` writes with the no-links helpers in `packages/workspace/src/no-links.ts` (append via read-modify-write is not needed: open with `O_APPEND | O_NOFOLLOW` after an `lstat` chain check).

- [ ] **Step 4: Run, typecheck, commit.**

```bash
git -C <worktree> add packages/shell/src/main/tools/tools-json.ts packages/shell/src/main/tools/tool-registry.ts packages/shell/src/main/tools/tool-trace.ts packages/shell/test/tools/tools-json.test.ts packages/shell/test/tools/tool-registry.test.ts packages/shell/test/tools/tool-trace.test.ts
git -C <worktree> commit --only packages/shell/src/main/tools/tools-json.ts packages/shell/src/main/tools/tool-registry.ts packages/shell/src/main/tools/tool-trace.ts packages/shell/test/tools/tools-json.test.ts packages/shell/test/tools/tool-registry.test.ts packages/shell/test/tools/tool-trace.test.ts -m "feat(shell): the tool registry and its trace" -m "<trailer>"
```

---

### Task 8: The `tools` MCP server and the slot

**Files:**
- Create: `packages/blocks/src/tools-server.ts`, `packages/blocks/src/tools-server-bin.ts`
- Modify: `packages/blocks/src/launch.ts` (`toolsServerSpec`), `packages/blocks/src/index.ts`, `packages/runtime/src/workspace.ts` (`WorkspaceOptions.tools?`), `packages/shell/electron.vite.config.ts` (`"tools-server"` entry)
- Test: `packages/blocks/test/tools-server.test.ts`, `packages/runtime/test/workspace-tools.test.ts` (new)

- [ ] **Step 1: Write the failing tests.**

```ts
// tools-server.test.ts — an in-process MCP client over a linked transport, rpc double
// "lists only agent: call tools, named by their ids, with params as the input schema and the description"
// "a call goes to the rpc as { tool, args } and the result comes back as JSON text"
// "an rpc refusal comes back as isError with the message"
// "reads the catalogue file with caps (≤ 512 KB, ≤ 50 tools, each checked); a broken file gives no tools, logged"
```
```ts
// workspace-tools.test.ts — createWorkspace with fake engine, as the existing workspace tests do
// "D0: no tools, the slot's MCP list is unchanged" (deep-equal the mcp list of a harness without tools to the list
//   built before this task — record it with the same harness and options)
// "tools without agent: call add no server"
// "a task slot and a job slot get the tools server; its rpc carries the slot's ref"
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**
  - `tools-server.ts`: `createToolsServer(catalogue: string, rpc)`: reads `HH_TOOLS` (a JSON file the app writes per workspace: `[{ name, description, inputSchema }]`), registers each with the MCP SDK's low-level request handlers (`ListToolsRequestSchema`, `CallToolRequestSchema` from `@modelcontextprotocol/sdk/types.js`, already a dependency) so the JSON Schema passes as is; a call → `callRpc(rpc, { tool: name, args })`; the answer `{ ok, result | error }` → `content: [{ type: "text", text: JSON.stringify(result) }]` or `isError: true` with the error text.
  - `toolsServerSpec({ catalogue, rpc, launcher, entry? })` named `"tools"`, env `HH_TOOLS`, `HH_RPC`, `HH_RPC_TOKEN`.
  - `workspace.ts`: `WorkspaceOptions.tools?: { catalogue: string; request(r: unknown, ref: SlotRef): Promise<unknown>; entry?: string }`. In `openSlotNow`, `if (opts.tools) toolsRpc = await openRpc((r) => opts.tools!.request(r, ref));` (opened and closed like `materialRpc`), and add `...(toolsRpc ? [toolsServerSpec({ catalogue: opts.tools.catalogue, rpc: toolsRpc, launcher, entry: opts.tools.entry })] : [])` right after the data server. Index.ts passes `tools` only when the harness has an `agent: "call"` tool (Task 9). `allowedTools` already adds `mcp__tools`.

- [ ] **Step 4: Run** the new tests and `claude-cli.test.ts`, `hatches-d0.test.ts`, `runtime-d0.test.ts` (unchanged, green); typecheck; `corepack pnpm app:build` (the new entry builds `out/main/tools-server.js`).

- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/blocks/src/tools-server.ts packages/blocks/src/tools-server-bin.ts packages/blocks/test/tools-server.test.ts packages/runtime/test/workspace-tools.test.ts
git -C <worktree> commit --only packages/blocks/src/tools-server.ts packages/blocks/src/tools-server-bin.ts packages/blocks/src/launch.ts packages/blocks/src/index.ts packages/runtime/src/workspace.ts packages/shell/electron.vite.config.ts packages/blocks/test/tools-server.test.ts packages/runtime/test/workspace-tools.test.ts -m "feat(blocks): the core tools MCP server, added to slots only with agent tools" -m "<trailer>"
```

---

### Task 9: Wiring in main: `createToolsHost`, `client.tools`, `AppState.tools`

**Files:**
- Create: `packages/shell/src/main/tools/tools-host.ts`, `packages/shell/src/main/tools/tools-ipc.ts`
- Modify: `packages/shell/src/main/index.ts`, `packages/shell/src/preload/index.ts`, `packages/ui/src/client.ts`, `packages/ui/test/fake-client.ts`
- Test: `packages/shell/test/tools/tools-host.test.ts`, `packages/shell/test/tools/tools-ipc.test.ts`, `packages/shell/test/tools-surface.test.ts` (new)

- [ ] **Step 1: Write the failing tests.**

```ts
// tools-host.test.ts
// "an agent request from a task slot calls the registry as agent with the task id, scope and phase"
// "an agent request from a job slot calls it as agent with job and run, whatever the job is"
// "the agent can't call an agent: none tool" (T7)
// "the catalogue file lists only agent: call tools, written once per workspace in <userData>/tools-catalogue/"
// "start prunes the trace and starts the host; stop stops it"
```
```ts
// tools-ipc.test.ts
// "registers exactly hh:toolsCall and hh:toolsTrace"
// "hh:toolsCall traces caller ui with the open scope and no task; a bad id or args over 1 MB answer Invalid request" (T9)
// "hh:toolsTrace takes a task or run id (UUID-shaped) and refuses anything else"
```
```ts
// tools-surface.test.ts
// "D0: tools channels, scheme and host exist only under hasTools": index.ts registers TOOL_SCHEME, builds
//   createToolsHost and calls registerToolsIpc only inside `if (hasTools(harness))` blocks; no other main file names
//   "hh:tools" or "hh-tools"; AppState.tools only under hasTools
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**
  - `client.ts`:

```ts
/** One call as the chat's folded line shows it (tools spec §8.2). */
export interface ToolCallView {
  tool: string;
  caller: "ui" | "agent" | "pre" | "job";
  ok: boolean;
  ms: number;
  summary: string;
  error?: string;
  /** Cut at 2 KB each. */
  args: string;
  result?: string;
  accesses: { kind: "fetch" | "exec" | "data" | "files"; target: string; allowed: boolean }[];
  at: string;
}
export type ToolCallResult = { ok: true; result: unknown } | { ok: false; error: string };
/** The harness's tools (tools spec §5). Only with `state.tools`; without, every call rejects (D0). */
export interface ToolsClient {
  call(id: string, args?: unknown): Promise<ToolCallResult>;
  /** A task's or a job run's calls, oldest first. */
  trace(id: string): Promise<ToolCallView[]>;
}
/** The harness declares tools. Absent without (D0). `off`: built but off (not built, a problem, or crashes). */
export interface ToolsInfo {
  ids: string[];
  off?: string;
}
```
`AppState.tools?: ToolsInfo`; `HarnessClient.tools: ToolsClient`; `Event` gains `{ type: "tool-call"; call: ToolCallView }` in `packages/runtime/src/events.ts` (used in Task 11).
  - `tools-host.ts`: `createToolsHost({ harness, base, references, userData, store, data, exec, fetch, electron, resources, scopeOf, emitToTask })` returns `{ start, stop, registry, workspaceOptions(): WorkspaceOptions["tools"] | undefined, info(): ToolsInfo }`. The slot ref → caller: a `job:<run>` key → `{ caller: "agent", job, run }` from the jobs host's `runningOf(key)`; else the running task of that slot with its scope and phase. `called` → `emitToTask(task, { type: "tool-call", call: view })` when the call has a task.
  - `index.ts` (additive): before ready, `if (hasTools(harness)) protocol.registerSchemesAsPrivileged([TOOL_SCHEME])` — merged into the existing `registerSchemesAsPrivileged` call when plugins also register (Electron takes one call: build the list, call once; keep the plugins-only path byte-identical when there are no tools); after ready, `if (hasTools(harness)) { toolsHost = createToolsHost(...); registerToolsIpc(handle, toolsHost); }`; `createWorkspace(... , ...(toolsHost?.workspaceOptions() ? { tools: toolsHost.workspaceOptions() } : {}))`; `AppState`: `...(toolsHost ? { tools: toolsHost.info() } : {})`.

- [ ] **Step 4: Run, typecheck, app:build, commit.**

```bash
git -C <worktree> add packages/shell/src/main/tools/tools-host.ts packages/shell/src/main/tools/tools-ipc.ts packages/shell/test/tools/tools-host.test.ts packages/shell/test/tools/tools-ipc.test.ts packages/shell/test/tools-surface.test.ts
git -C <worktree> commit --only packages/shell/src/main/tools/tools-host.ts packages/shell/src/main/tools/tools-ipc.ts packages/shell/src/main/index.ts packages/shell/src/preload/index.ts packages/ui/src/client.ts packages/ui/test/fake-client.ts packages/runtime/src/events.ts packages/shell/test/tools/tools-host.test.ts packages/shell/test/tools/tools-ipc.test.ts packages/shell/test/tools-surface.test.ts -m "feat(shell): tools in the app — host, registry, client.tools, only with tools" -m "<trailer>"
```

---

### Task 10: "Test connection" (connect `test`, Settings › Connections)

**Files:**
- Modify: `packages/harness-sdk/src/setup.ts`, `packages/harness-sdk/src/index.ts` (rule), `packages/harness-sdk/src/tools.ts` (`toolProblems` rule), `packages/shell/src/main/secrets/connections.ts`, `connections-ipc.ts`, `packages/ui/src/client.ts`, preload, fake client, `packages/ui/src/connections/SecretField.tsx`, `ConnectionsTab.tsx`, `ConnectStep.tsx`, `packages/i18n/src/locales/en.json` (`"connections"` block only)
- Test: `packages/harness-sdk/test/secrets.test.ts` (append), `packages/shell/test/secrets/connections.test.ts` (append), `packages/ui/test/connections-ui.test.tsx` (append)

- [ ] **Step 1: Write the failing tests.**
  - sdk: "a connect step's test names a declared tool" (`test: "nope"` → `"nope" is not a tool of this harness`); "its tool takes no required params" (checked in `toolProblems` with `tools.json`: `"jira-check": a connect step's test tool can't have required params`).
  - main: "test runs the tool as ui with {} and keeps { at, ok, message? } per secret in connections.json (0600), never a value"; "a secret's test state shows in the view as lastTest"; "D0: without a test tool there is no Test and no connections.json".
  - ui: "Test shows Works or the error under the row"; "no Test button when no connect step names a test for that secret".

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.** `connect` gains `test: z.string().min(1).optional()`. `ConnectionView` gains `test?: true` and `lastTest?: { at: string; ok: boolean; message?: string }`. `ConnectionsController.test(id)` finds the connect step naming `id` with a `test`, calls `registry.call({ tool, args: {}, caller: "ui", scope: null })`, writes `connections.json` atomically (0600, ≤ 64 KB, `{ tests: { [id]: { at, ok, message? } } }`, messages ≤ 300 characters with the stored values hidden), pushes the view. Channel `hh:connectionsTest(id)` (registered with the others; refuses without a test). en.json: `"test": "Test connection"`, `"works": "Works"`, `"testFailed": "Didn't work: {{message}}"`.

- [ ] **Step 4: Run, typecheck, app:build, commit.**

```bash
git -C <worktree> commit --only packages/harness-sdk/src/setup.ts packages/harness-sdk/src/index.ts packages/harness-sdk/src/tools.ts packages/shell/src/main/secrets/connections.ts packages/shell/src/main/secrets/connections-ipc.ts packages/shell/src/main/index.ts packages/ui/src/client.ts packages/shell/src/preload/index.ts packages/ui/test/fake-client.ts packages/ui/src/connections/SecretField.tsx packages/ui/src/connections/ConnectionsTab.tsx packages/ui/src/connections/ConnectStep.tsx packages/i18n/src/locales/en.json packages/harness-sdk/test/secrets.test.ts packages/shell/test/secrets/connections.test.ts packages/ui/test/connections-ui.test.tsx -m "feat: Test connection runs the connect step's tool" -m "<trailer>"
```

---

### Task 11: The folded trace in a task's chat

**Files:**
- Create: `packages/ui/src/tools/ToolCallLine.tsx`
- Modify: `packages/ui/src/client.ts` (`ChatEntry.tools?`), `packages/ui/src/state.ts` (reducer), `packages/ui/src/ChatView.tsx` (draw), `packages/shell/src/main/chat-log.ts` (save `tools` on the entry), `packages/i18n/src/locales/en.json` (`"tools"` block)
- Test: `packages/ui/test/tool-call-ui.test.tsx`, `packages/ui/test/state.test.ts` (append), `packages/shell/test/chat-log.test.ts` (append)

- [ ] **Step 1: Write the failing tests.**

```tsx
describe("tool calls in a chat (tools spec §8.2)", () => {
  it("D0: an entry without tools renders as before", () => { /* snapshot of a plain assistant entry: no tool line */ });
  it("a call shows as one folded line: id · summary · 0.3 s · 0 tokens", () => { /* … */ });
  it("unfolding shows arguments, result and accesses", async () => { /* click the line's button (aria-expanded) */ });
  it("an error is always unfolded and says '<id> failed · <message>'", () => { /* … */ });
  it("a refused access reads 'access denied' with its target", () => { /* … */ });
  it("Tools off: the chat's top line says so when state.tools.off is the crash reason", () => { /* … */ });
});
```
`state.test.ts`: "a tool-call event during a turn lands on the live turn and is saved on its entry"; "outside a turn it is a line of its own". `chat-log.test.ts`: "an entry's tools are saved and read back; an old log without them reads as before".

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.** `ChatEntry.tools?: ToolCallView[]` (comment: "Assistant entries: the tool calls during the turn (tools spec §8.2). Absent: none."); `LiveTurn.tools?`; reducer case `"tool-call"` appends to `live.tools` (or adds an assistant entry with empty text and `tools: [call]` when no turn is live); `done` copies `live.tools` onto the entry. `ToolCallLine`: a `<button aria-expanded>` row with the line text, the details in a `<dl>` (`<pre>` for args/result, `dir="auto"`), errors open by default and styled as the error card's line. en.json `"tools"` block: `"line": "{{tool}} · {{summary}} · {{seconds}} s · 0 tokens"`, `"failed": "{{tool}} failed · {{message}}"`, `"accessDenied": "access denied"`, `"args": "Arguments"`, `"result": "Result"`, `"accesses": "Accesses"`, `"off": "Tools are off after repeated crashes. Restart the app to turn them on."`.

- [ ] **Step 4: Run, typecheck, app:build, commit.**

```bash
git -C <worktree> add packages/ui/src/tools/ToolCallLine.tsx packages/ui/test/tool-call-ui.test.tsx
git -C <worktree> commit --only packages/ui/src/tools/ToolCallLine.tsx packages/ui/src/client.ts packages/ui/src/state.ts packages/ui/src/ChatView.tsx packages/shell/src/main/chat-log.ts packages/i18n/src/locales/en.json packages/ui/test/tool-call-ui.test.tsx packages/ui/test/state.test.ts packages/shell/test/chat-log.test.ts -m "feat(ui): tool calls as folded lines in a task's chat" -m "<trailer>"
```

---

### Task 12: Fixture harness and e2e

**Files:**
- Create: `packages/fake-agent/fixtures/tools-harness/` (manifest with `tools`, `secrets`, a connect step with `test`; `tools/count-notes.ts` (`uses: { files: "read" }`, returns the notes count by folder), `tools/peek-folder.ts` (`agent: "call"`, `uses: {}`, calls `ctx.files.read("notes.md")` → refused, so the call fails with "access denied" in its accesses), `tools/probe.ts` (`agent: "call"`, `uses: {}`, returns `{ require: typeof require, process: typeof process }`), `tools/hidden.ts` (`agent: "none"`), `tools/check-key.ts` (`agent: "none"`, `uses: { secrets: ["demo"], hosts: ["api.example.invalid"] }`, fetches `https://api.example.invalid/me` with `{{secret:demo}}`: the e2e only presses Test without a key, which fails before any request with the missing-key message), `secrets: [{ id: "demo", label: "Demo key" }]`, a connect step `{ id: "demo", kind: "connect", label: "Connect demo", secrets: ["demo"], test: "check-key" }`, `dist/` built and committed, and a fake-claude script whose turn calls `{ mcp: { server: "tools", tool: "count-notes", args: {} } }`, then `peek-folder`, then `probe`)
- Create: `packages/e2e/tests/tools.spec.ts`, `packages/cli/test/fixture-dist.test.ts`

- [ ] **Step 1: Build the fixture's dist** with `node packages/cli/bin/humanharness.js build --harness packages/fake-agent/fixtures/tools-harness` (the repo's own CLI; nothing installed). Write `fixture-dist.test.ts`: "the tools fixture's dist matches a fresh build" (in-memory build, byte compare).
- [ ] **Step 2: e2e** with mock mode, `HH_TEST_FAKE_SECRETS=1`, the fixture's fake-claude script:
  - "an agent call shows as a folded line in the chat, and unfolds to its arguments, result and accesses";
  - "a refused access shows unfolded" (the `peek-folder` line is open without a click and reads "access denied" with target `notes.md`);
  - "the sandbox has no Node" (unfolding `probe` shows `"require":"undefined"` and `"process":"undefined"`);
  - "an agent: none tool is not offered to the agent" (the `tools` server's list, read through the trace of a fake-claude step that calls `hidden`, answers an error "hidden is not available to the agent");
  - "Test connection without a key says 'Demo key is not set — Settings › Connections'";
  - "D0: a harness without tools has no hh-tools handler" (`isProtocolHandled("hh-tools")` false in the plugins' D0 fixture, as `plugins-surface.spec.ts` checks `hh-plugin`).
- [ ] **Step 3: Run** `corepack pnpm app:build`, then the spec, plus `history.spec.ts`, `plugins.spec.ts`, `jobs.spec.ts`, `connections.spec.ts`.
- [ ] **Step 4: Commit.**

```bash
git -C <worktree> add packages/fake-agent/fixtures/tools-harness packages/e2e/tests/tools.spec.ts packages/cli/test/fixture-dist.test.ts
git -C <worktree> commit --only packages/fake-agent/fixtures/tools-harness packages/e2e/tests/tools.spec.ts packages/cli/test/fixture-dist.test.ts -m "test(e2e): tools — folded trace, refused access, sandbox, Test connection" -m "<trailer>"
```

---

### Task 13: Docs, memory measure and the full run

**Files:**
- Create: `docs/architecture/tools.md`
- Modify: `docs/architecture/secrets.md` (Test), `plugins.md` (one line: the tool host mirrors the backend window), `manifest.md` (`tools`), `data.md` (`who: "tool"`), `history.md` (`Tool:`), `jobs.md` (a job run's trace; the `tools` server on job slots; "a job is `prompt` or, from slice 4, `steps`"), `authoring.md` (`humanharness build`), `context.md` (tool reads labelled `tools · <id>`)

- [ ] **Step 1: `tools.md`**: what it is (spec §1–2), the manifest and a tool file, build and `tools.json`, checks, the host (settings, scheme, channel, crash rule), the broker per tool (`ctx` table with slice-2 rows), the registry, the trace (files, entry shape, cuts, prune), the three callers, the `tools` server, `client.tools`, the chat line, D0 table, threat rows T1–T9, Decisions, known gaps (no staleness check; no packaging of `dist/`; `allowHost` not wired, as plugins; job inbox lines in slice 4; `files: write` later), where to look.
- [ ] **Step 2: Memory.** In the e2e (or a manual dev run with mock mode), read `process.getProcessMemoryInfo()` of the tool window after start and after 20 calls; write both numbers in `tools.md` ("Open question §17").
- [ ] **Step 3: Full run.** `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm app:build`, `corepack pnpm e2e`. D0 and frozen checks:

```bash
git -C <worktree> diff --stat feat/tools-core -- packages/runtime/test/runtime-d0.test.ts packages/runtime/test/hatches-d0.test.ts packages/runtime/test/claude-cli.test.ts packages/shell/test/hatches-surface.test.ts packages/e2e/tests/history.spec.ts
git -C <worktree> diff --stat feat/harness-hatches -- packages/shell/test/plugin-*.test.ts packages/shell/test/plugins-*.test.ts packages/shell/test/plugins-fixtures.ts packages/cli/test/plugin-*.test.ts packages/harness-sdk/test/plugin*.test.ts packages/harness-sdk/test/define-plugin.test.ts packages/e2e/tests/plugins.spec.ts packages/e2e/tests/plugins-surface.spec.ts
```
Both print nothing.

- [ ] **Step 4: Commit.**

```bash
git -C <worktree> add docs/architecture/tools.md
git -C <worktree> commit --only docs/architecture/tools.md docs/architecture/secrets.md docs/architecture/plugins.md docs/architecture/manifest.md docs/architecture/data.md docs/architecture/history.md docs/architecture/jobs.md docs/architecture/authoring.md docs/architecture/context.md -m "docs: tools — build, host, broker, registry, trace, the tools server" -m "<trailer>"
```

---

## Parallel execution

1 → 2 → 3 (sdk then cli). 4 needs 1; 5 is independent of 2–4; 6 is independent of 2–5; 7 needs 3, 4, 6; 8 needs 1; 9 needs 5, 7, 8; 10 needs 9; 11 needs 9; 12 needs 9–11; 13 last.
