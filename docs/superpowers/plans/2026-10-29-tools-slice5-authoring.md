# Tools and recipes, slice 5 (authoring and mock mode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship delivery slice 5 of the tools-and-recipes spec (§15.5, §11, §12): `humanharness tool test <id>` runs a tool against `tools/<id>/fixtures/*.json` (and `check` runs those fixtures); `humanharness tool run <id> --args '{…}'` runs it once against a real folder and prints its trace; `humanharness run` runs tools (pre-steps and the agent's `tools` server) and `run --record` records the agent's tool calls and every broker access; `dev --mock` runs tools for real but answers `ctx.fetch` and `ctx.exec` from the recording ("Not recorded: <target>" otherwise), and answers a recipe's AI step from `mock/steps/<job>.json`; the `/new-harness` guide gets a "Mechanical work" phase and a Lessons section; the template gets one example tool with one fixture. A harness without tools sees no change in any command, recording or mock run.

**Architecture.**

*Shell* (`packages/shell/src/main/tools/tool-cli.ts`, new; package export `@humanharness/shell/tools`): the CLI's way into the very registry, broker and trace the app runs — `ToolRegistry`, `ToolBroker`, `toolFiles`, `runPreSteps`, `preparedSection`, `readToolFixtures`, `recordedToolTransport` — with no Electron and no `node:vm` in its import graph (as `@humanharness/shell/plugins`). `tools/tool-fixture-files.ts` (new): `readToolFixtures(dir, tool, note)` with the plugin fixture files' rules (count and size caps, no links); `tools/recorded-transport.ts` (new): `recordedToolTransport(exchanges)`, slice 1's `fixtureTransport` with "Not recorded: <target>". `tools/tools-host.ts` (slice 2's): in mock mode each tool's transport is its recorded exchanges and its secrets are `fixture-<id>`.

*SDK* (`packages/harness-sdk/src/tool-fixtures.ts`, new): `toolFixtureSchema` — `{ args?, inputs?, scope?, exchanges?, data?, files?, expect: { result } | { error } }`.

*CLI* (`packages/cli/src/`):
- `tool-host-node.ts` (new): `nodeToolHost(root)` — the registry's `host` for the terminal: each built tool (`dist/tools/<id>.js`) evaluated in a fresh `vm` context with `plugin-run.ts`'s globals and P12 note, `ctx` forwarding to the broker; and `cliTools(o)`, a registry over it with a chosen transport, secrets, data and files.
- `tool-test.ts` (new): `humanharness tool test [<id>]` and `toolFixtureFindings` for `check` (rule `tool-fixture`).
- `tool-run.ts` (new): `humanharness tool run <id> --args '{…}' [--folder <dir>] [--scope <id>] [--yes]`, keys asked hidden in the terminal, real `fetch` (public hosts only) and `runFile`, the trace printed.
- `tool.ts` (new): the `tool` subcommand dispatcher; `main.ts`: `tool` in `COMMANDS` and `USAGE`, `exitsWhenDone` for `tool test`/`tool run`.
- `run.ts`, `record.ts`: tools in a terminal run (pre-steps, the agent's `tools` server); `--record` adds each turn's agent tool calls to the recording and each broker access to `mock/tools/<tool>/<NNN>.json` with keys replaced.
- `check.ts`: rules `tool-fixture` and `mock-step`.
- `guide/new-harness.md`, `harness-md.ts`, `template/`: the phase, the lessons, the section, the example tool.

*Fake agent* (`packages/fake-agent/src/`): `mock.ts` — a turn's optional `tools: [{ tool, args }]`; `stepRecordingSchema` for `mock/steps/<job>.json`. `mock-claude.ts` — replays a turn's tool calls on the `tools` MCP server before its blocks; answers a step turn from `mock/steps/<job>.json` when it exists (slice 4's empty turn otherwise).

**Tech Stack:** TypeScript, Node `vm` (CLI only, as `plugin test`), Zod 4, MCP SDK, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-28-tools-and-recipes-design.md` §11, §12, §13 (e2e "a mock-mode run answering from a recording"), §15 slice 5; §3.3 (fixtures in `check`); §9 (secrets). **Base:** slice 4's end on `feat/tools-recipes`. **Branch:** `feat/tools-authoring`, created from `feat/tools-recipes` in Task 0.

---

## Conventions

As slices 1–4:
- worktree `/Users/marcozanger/Documents/workspace/humanharness/.claude/worktrees/plan-sidekick`, never `cd` elsewhere;
- commands: one file `corepack pnpm vitest run <path>`; all `corepack pnpm typecheck` and `corepack pnpm test`; shell main, preload, resources or UI touched: `corepack pnpm app:build`; e2e `corepack pnpm --filter @humanharness/e2e exec playwright test <file>` (or `corepack pnpm e2e`);
- install nothing (no `pnpm install` of any kind, no `npx` that downloads);
- git: `git -C <worktree> …`, one command per call; `git add` new files, then `git commit --only <every path of the task> -m … -m "<trailer>"`; never push, never a bare `git stash`, never commit on another branch;
- English everywhere; tests in `packages/<name>/test/`; one behaviour per `it`;
- no en.json change in this slice (CLI text is English in the CLI's own files, as today);
- hot files (`run.ts`, `record.ts`, `check.ts`, `main.ts`, `mock.ts`, `mock-claude.ts`, `tools-host.ts`, `index.ts`) changed small and additive.

Trailer:

```
Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Hd26nmhtaxFi1aSdd94xcv
```

**Security rules (every task).** Never read `~/.claude`, `~/.codex`, `~/.gemini`, `~/.config/opencode`, `~/.local/share/opencode`, `~/.ssh`, `~/.netrc` or any credential, token or account file. Tests never touch the real Keychain (fake `SecretCrypto`, `HH_TEST_FAKE_SECRETS=1` in e2e), never raise OS notifications or touch the Dock, never reach the network beyond 127.0.0.1 (`tool run` and `run --record` are tested with an injected transport, never a real one). Never run the real `claude`, `codex` or `opencode` (e2e uses mock mode and fake-claude). `tool run` against a real service is Marco's to try by hand.

## Frozen files

Byte-identical at the end of every task (each task's last step runs both commands; both print nothing):

```bash
git -C <worktree> diff --stat feat/harness-hatches -- packages/shell/test/plugin-*.test.ts packages/shell/test/plugins-*.test.ts packages/shell/test/plugins-fixtures.ts packages/cli/test/plugin-*.test.ts packages/harness-sdk/test/plugin*.test.ts packages/harness-sdk/test/define-plugin.test.ts packages/e2e/tests/plugins.spec.ts packages/e2e/tests/plugins-surface.spec.ts packages/shell/test/jobs/ packages/harness-sdk/test/jobs.test.ts packages/blocks/test/ui-server-job.test.ts packages/ui/test/jobs-ui.test.tsx packages/e2e/tests/jobs.spec.ts packages/shell/src/main/jobs/job-runner.ts packages/shell/src/main/jobs/job-prompt.ts packages/shell/src/main/jobs/job-log.ts packages/fake-agent/test/mock.test.ts packages/fake-agent/test/mock-replay.test.ts packages/fake-agent/test/mock-claude.test.ts packages/e2e/tests/mock.spec.ts packages/cli/test/record.test.ts packages/cli/test/run.test.ts
git -C <worktree> diff --stat feat/tools-recipes -- packages/runtime/test/runtime-d0.test.ts packages/runtime/test/hatches-d0.test.ts packages/runtime/test/claude-cli.test.ts packages/shell/test/hatches-surface.test.ts packages/e2e/tests/history.spec.ts packages/shell/test/usage-log.test.ts packages/shell/test/tools/tool-registry.test.ts packages/shell/test/tools/pre-steps.test.ts packages/harness-sdk/test/tools.test.ts packages/harness-sdk/test/recipes.test.ts packages/shell/test/jobs-recipes/ packages/e2e/tests/tools-pre.spec.ts packages/e2e/tests/recipes.spec.ts
```

(Task 0 checks that `record.test.ts` and `run.test.ts` are today's names for the CLI's `run` and `--record` tests; if they differ, it writes the real names in `carry-notes.md` and later tasks use those.) This slice's tests go in new files. Two existing tests change on purpose and are named in their tasks: `packages/cli/test/guide.test.ts` (the phase list, Task 11) and slice 3's `packages/cli/test/run-pre.test.ts` (the `run` notice, Task 8).

## D0 is a hard rule

A harness that declares no `tools` sees no change:
- `humanharness tool …` refuses with "This harness declares no tools." (exit 1); every other command's output, files and exit codes are as before;
- `check` runs no fixture and no `mock-step` rule; its findings are as before;
- `run` and `run --record` start no tool host, write no `mock/tools/`, and a recording has no `tools` key;
- a recording without `tools` parses, replays and is written exactly as before; `mock/steps/` is read only for a step turn (slice 4: only recipes have one);
- `dev --mock` starts no tool transport; plugins' fixture mode is unchanged.

| D0 item | Pinned by |
|---|---|
| CLI | `packages/cli/test/tool-cli.test.ts` "D0: tool refuses without tools; USAGE lists tool once" (Task 4) |
| check | `packages/cli/test/check-tool-fixtures.test.ts` "D0: no tools, no fixture findings" (Task 5) |
| Recording format | `packages/fake-agent/test/mock-tools.test.ts` "D0: a recording without tools parses as before" (Task 7); `mock.test.ts` frozen |
| run / record | `packages/cli/test/run-tools.test.ts` "D0: a harness without tools starts no tool host" (Task 8); `packages/cli/test/record-tools.test.ts` "D0: a recording of a harness without tools has no tools key and no mock/tools" (Task 9); `run.test.ts`, `record.test.ts` frozen |
| Mock mode | `packages/shell/test/tools/tools-mock.test.ts` "D0: without mock the transport is the real one" (Task 10); `mock.spec.ts` frozen |
| Shell entry | `packages/shell/test/tool-cli-entry.test.ts` (Task 1) |

## Threat model (slice 5)

The CLI runs tool code in its own Node process, and recordings carry service replies into the repository.

| # | Boundary | What enforces it | Test |
|---|---|---|---|
| A1 | The person knows tool code isn't sandboxed in the terminal | `tool test`, `tool run`, `run` with tools print P12's note for tools once, before any tool code runs; each tool still gets only `ctx` (no `fetch`, `process`, `require`, `Buffer` globals), as `plugin test` | `tool-host-node.test.ts` (Task 2) |
| A2 | Fixtures and recordings never reach the network or a process | `tool test`, `check` and `dev --mock` use only recorded exchanges; an unmatched access fails "Not recorded: <target>" | `tool-test.test.ts` (Task 4), `tools-mock.test.ts` (Task 10) |
| A3 | No key is written into a recording | `run --record` and recorded exchanges go through `stripSecrets` (P11): every key form replaced by `{{secret:<id>}}`; a key that still shows aborts the write and names the file | `record-tools.test.ts` (Task 9) |
| A4 | Fixture and recording files are hostile input | the plugin fixture files' caps (`FIXTURE_FILES`, `FIXTURE_BYTES`), no links, strict schemas; `files` paths inside the temp folder (`folderRelative`); `data` keys looked up with `Object.hasOwn` | `tool-fixture-files.test.ts`, `tool-fixtures.test.ts` (Tasks 3, 7) |
| A5 | `tool run` reaches only public hosts and declared commands | the tool's `uses` (slice 2's broker), `isPublicHost` before each fetch (as `plugin record`), keys only from the hidden prompt, never from the app's store or a file | `tool-run.test.ts` (Task 6) |
| A6 | `tool run` doesn't write by surprise | a tool whose `uses` writes (`data.write`, `files: "write"`) runs only with `--yes` | `tool-run.test.ts` (Task 6) |
| A7 | Mock mode never reads the key store | in mock mode every tool secret is `fixture-<id>` | `tools-mock.test.ts` (Task 10) |

## Decisions (product questions take the spec's defaults; Marco may change any)

1. **Fixture files** live at `tools/<id>/fixtures/*.json`, one case per file: `{ args?, inputs?, scope?, exchanges?: <plugin fixture exchanges>[], data?: { <collection>: record[] }, files?: { <path>: text }, expect: { result } | { error } }`. `args` defaults to `{}`, `scope` to `null`.
2. **Pass or fail.** `expect.result`: the tool's result deep-equals it (after `returns`). `expect.error`: the call fails and its message contains that text.
3. **What a fixture run reaches.** Keys are `fixture-<id>` (as `plugin test`); `ctx.fetch`/`ctx.exec` answer only from `exchanges`; `ctx.data` is an in-memory store seeded from `data` (writes reported, nothing saved); `ctx.files` is a temp folder written from `files` (no reference folders), removed after.
4. **`check` runs fixtures** when a tool has any: each failing case is a `tool-fixture` error ("Tool "<id>": fixtures/<file>: <why>"). A harness whose tools don't build reports the build problem only.
5. **`tool run`** asks each key the tool declares in `uses.secrets` with hidden input (as `plugin record`). The spec says "with the secrets already set"; the CLI can't read the app's encrypted store (Electron `safeStorage`), so it asks instead. The folder is `--folder <dir>` or `run`'s default; the scope `--scope <id>` or none. A tool that writes (`uses.data.write` or `files: "write"`) needs `--yes`.
6. **`tool run`'s network:** real `fetch` to public hosts only (`isPublicHost`), real commands through `runFile`; the trace is printed, not saved.
7. **P12 for tools:** "Note: tool code runs in this Node process, not in the app's sandbox. Run only tools you trust." printed once per command.
8. **Where recorded accesses go:** `mock/tools/<tool>/<NNN>.json`, one exchange per file in the plugin fixture format (`fixtureSchema`), so the same reader serves `plugin test`, `tool test` and mock mode. The spec says "in the recording format"; one file per exchange, per tool, keeps recordings of different actions from fighting over them. `run --record` appends after the highest number; it never rewrites an existing file.
9. **Recorded tool calls:** a turn's optional `tools: [{ tool, args }]` (at most 20) holds the agent's calls in that turn, in order. Pre-step calls are not recorded: in `dev --mock` they run for real at the start.
10. **`dev --mock`:** tools run for real; `ctx.fetch`/`ctx.exec` answer from `mock/tools/<tool>/`; an access with no match fails "Not recorded: GET https://…" (or "Not recorded: gh pr checks 12"); keys are `fixture-<id>`; data and files are the mock session's.
11. **AI steps in mock mode:** `mock/steps/<job>.json` = `{ version: 1, job, output, request? }`: a step turn without `### request` in its data answers `output`, a request round answers `request ?? output`. `check` validates both against the job's AI step `output` (rule `mock-step`). Without the file, slice 4's empty turn (the run fails). Not in the spec; the smallest way to try a recipe with no AI.
12. **`run` with tools** builds the tools in memory as `check` does, refuses on a build problem, runs pre-steps before the first message (slice 3's runner and section; slice 3's "Pre-steps are not run in the terminal yet." notice goes), serves the `tools` MCP server to the engine and prints each call as one line ("tool due-today · 0.3 s · ok").
13. **The guide phase** is "Mechanical work", Phase 4, between Flow and Context; the guide has nine phases. It fills a new HARNESS.md section "Mechanical work" (a table: Moment · Code or AI · Tool or step · Why), added to `HARNESS_SECTIONS` after "Flow" and to the template's HARNESS.md.
14. **Lessons** is a `## Lessons` section of the guide (not a phase), with the spec's four lessons plus "test every tool with a fixture before wiring it", kept current like the rest of the guide.
15. **The template's tool** is `word-count` (`params { path }`, `returns { words }`, `uses: { files: "read" }`, `agent: "call"`), with `tools/word-count/fixtures/basic.json`; no action uses it yet (the guide's phase says how).

## Assumptions about slices 1–4 (they are plans, not code)

Task 0 checks each one and writes the real name in `carry-notes.md` when it differs; later tasks use the real one.

- Slice 1: `fixtureTransport`, `stripSecrets`, `hideSecrets` in `@humanharness/harness-sdk/plugin-fixtures` (today's); `SecretStore.harnessValues`; `missingSecretMessage`.
- Slice 2: `ToolRegistry`, `ToolRegistryDeps` (`json`, `host`, `broker`, `trace`, `secretValues`, `called?`, `now?`), `ToolBroker`/`ToolBrokerDeps` (with `transport?(key)`), `toolFiles`, `ToolTrace`, the tool host's call protocol and the bundle format of `dist/tools/<id>.js` (what `resources/tool-host.mjs` evaluates), `humanharness build`'s in-memory build function, `toolsServerSpec` and how `WorkspaceOptions.tools` reaches a runtime (`createRuntime`'s options), `createToolsHost`'s deps.
- Slice 3: `runPreSteps`, `preparedSection`, `TaskDeps.prepare`, the `run` notice of Decision 18 and its test.
- Slice 4: `STEP_OUTPUT_TOOL`, `aiStepOf`, the step turn branch in `mock-claude.ts`, `ToolContext.summary`/`requestAi` (the Node host must offer both).
- Today: `@humanharness/shell/plugins` (`plugin-cli.ts`), `readPluginFixtures`, `isPublicHost`, `runFile`, `hiddenReader` and `P12_NOTE` in `packages/cli/src/plugin-*.ts`, `Recorder` in `record.ts`, `recordingSchema` in `fake-agent/src/mock.ts`, `launchMock` in `packages/e2e/tests/helpers.ts`.

## File structure

| File | Change | Responsibility |
|---|---|---|
| `packages/shell/src/main/tools/tool-cli.ts`, `shell/package.json` | Create/Modify | `@humanharness/shell/tools` |
| `packages/shell/src/main/tools/tool-fixture-files.ts`, `recorded-transport.ts` | Create | fixture reader, recorded transport |
| `packages/shell/src/main/plugin-fixture-files.ts` | Modify (additive export) | the shared file rules |
| `packages/shell/src/main/tools/tools-host.ts`, `index.ts` | Modify | mock-mode transport and secrets |
| `packages/harness-sdk/src/tool-fixtures.ts`, `package.json` | Create/Modify | `toolFixtureSchema` (Node-free) |
| `packages/cli/src/tool-host-node.ts`, `tool-test.ts`, `tool-run.ts`, `tool.ts` | Create | the CLI side |
| `packages/cli/src/main.ts`, `check.ts`, `run.ts`, `record.ts` | Modify | commands, rules, terminal runs, recording |
| `packages/fake-agent/src/mock.ts`, `mock-claude.ts`, `mock-replay.ts` | Modify | `tools` in turns, step recordings |
| `packages/cli/guide/new-harness.md`, `packages/cli/src/harness-md.ts`, `packages/cli/test/guide.test.ts` | Modify | phase, lessons, section |
| `packages/cli/template/` (`harness.config.ts`, `HARNESS.md`, `tools/word-count.ts`, `tools/word-count/fixtures/basic.json`) | Modify/Create | example tool |
| `packages/fake-agent/fixtures/mock-tools-harness/`, `packages/e2e/tests/tools-mock.spec.ts` | Create | e2e |
| `docs/architecture/tools.md`, `authoring.md`, `mock-mode.md`, `jobs.md` | Modify | docs |

## Overlaps

- **Plugins:** `tool test` mirrors `plugin test` and shares its fixture file rules and transport; `plugin-fixture-files.ts` gains one additive export; plugin behaviour and tests unchanged.
- **Slices 2–4:** registry, broker and trace are reused unchanged through `@humanharness/shell/tools`; the app's tools host gains a mock-mode transport.
- **Mock mode (3e):** recordings gain an optional `tools` key; `mock/` gains `tools/` and `steps/` folders, which `loadRecordings` never reads (it reads `mock/*.json`).
- **Guide and template:** a phase and a section added; the guide's phase numbers after Flow move by one.

## Open questions (each with the default this plan takes)

1. Where recorded accesses live (Decision 8) and AI steps in mock (Decision 11).
2. `tool run` asks for keys instead of reading the app's (Decision 5).
3. The phase's name and place, and its HARNESS.md section (Decision 13).

## Self-review (done while writing)

- Spec coverage (slice 5 list): `tool test` (Tasks 2–4), fixtures in `check` (Task 5), `tool run` (Task 6), recorded accesses (Tasks 7, 9), mock mode (Task 10), the guide phase and lessons (Task 11), the template tool (Task 12), §13 e2e "a mock-mode run answering from a recording" (Task 13), docs (Task 14). `run` with tools (Task 8) is needed for `--record` to record anything.
- Types: `toolFixtureSchema` (Task 3); `nodeToolHost`, `cliTools` (Task 2); `readToolFixtures`, `recordedToolTransport` (Tasks 3, 10); `MockTurn.tools`, `stepRecordingSchema` (Task 7).

---

### Task 0: Branch, plan and base line

**Files:** branch `feat/tools-authoring`; `docs/superpowers/plans/2026-10-29-tools-slice5-authoring.md`.

- [ ] **Step 1: Check the base.**

```bash
git -C <worktree> status --short
git -C <worktree> branch --show-current
git -C <worktree> log --oneline -1
```
Expected: no status output; `feat/tools-recipes`; the last commit is slice 4's docs commit ("docs: job recipes — steps, the AI step, rounds and known gaps" or what slice 4 actually wrote). Otherwise stop and report.

- [ ] **Step 2: Branch.** `git -C <worktree> switch -c feat/tools-authoring`.

- [ ] **Step 3: Plan.**

```bash
cp SCRATCH/../plans/2026-10-29-tools-slice5-authoring.md <worktree>/docs/superpowers/plans/
git -C <worktree> add docs/superpowers/plans/2026-10-29-tools-slice5-authoring.md
git -C <worktree> commit --only docs/superpowers/plans/2026-10-29-tools-slice5-authoring.md -m "docs: tools slice 5 plan (authoring and mock mode)" -m "<trailer>"
```

- [ ] **Step 4: Base line and earlier names.** `corepack pnpm typecheck`, `corepack pnpm test` green. In `SCRATCH/carry-notes.md` write HEAD, the test count, and for each name in context.md's "Assumptions about slices 1–4" either "as planned" or the real name and file (`/usr/bin/grep -rn` over `packages/`). Note in particular:
  - the bundle format of `dist/tools/<id>.js` and how `resources/tool-host.mjs` evaluates it and builds `ctx` (Task 2 mirrors it in Node);
  - the in-memory build function `check` uses for tools (Tasks 5, 8);
  - how `WorkspaceOptions.tools` reaches `createRuntime` (Task 8);
  - slice 3's `run` notice and `packages/cli/test/run-pre.test.ts`, which pins it (Task 8 removes the notice);
  - the CLI tests that cover `run` and `--record` today (context.md freezes `run.test.ts` and `record.test.ts`; write the real names if they differ).
  Run both frozen-list commands from context.md: both print nothing.

---

### Task 1: `@humanharness/shell/tools`, the CLI's entry into the registry

**Files:**
- Create: `packages/shell/src/main/tools/tool-cli.ts`
- Modify: `packages/shell/package.json` (exports `"./tools": "./src/main/tools/tool-cli.ts"`)
- Test: `packages/shell/test/tool-cli-entry.test.ts` (new; the same walk as `plugin-cli-entry.test.ts`, which stays as it is)

- [ ] **Step 1: Write the failing test.**

```ts
describe("@humanharness/shell/tools: the CLI's entry into the registry (A1)", () => {
  it("loads without Electron and exports the registry's parts", async () => {
    const mod = await import("../src/main/tools/tool-cli");
    for (const name of ["ToolRegistry", "ToolBroker", "ToolTrace", "toolFiles", "runPreSteps", "preparedSection"]) expect(typeof (mod as Record<string, unknown>)[name]).toBe("function");
  });
  it("no file of its import graph inside the shell imports electron or node:vm", async () => {
    // plugin-cli-entry.test.ts's importsOf and walk, from tools/tool-cli.ts; also refuse /^(node:)?vm$/
  });
});
```

- [ ] **Step 2: Run to see it fail.**

- [ ] **Step 3: Implement** `tool-cli.ts`:

```ts
/**
 * `@humanharness/shell/tools`: the CLI's way into the very registry, broker and trace the app runs (`humanharness tool
 * test`, `tool run`, `run`), so a tool is checked the same way on the author's machine. Nothing here imports Electron or
 * node:vm (a test pins the whole import graph); the CLI brings its own host (tool-host-node.ts).
 */
export { ToolRegistry, type ToolAnswer, type ToolCall, type ToolCaller, type ToolRegistryDeps } from "./tool-registry";
export { ToolBroker, type ToolBrokerDeps, TOOL_CALLS } from "./tool-broker";
export { ToolTrace, type TraceEntry } from "./tool-trace";
export { toolFiles } from "./tool-files";
export { runPreSteps, runToolStep, type StepRegistry } from "./pre-steps";
export { preparedSection } from "./prepared-section";
```
(Names as Task 0 found them. If one of these files imports Electron, don't move code: stop and report which import, since the walk would fail.)

- [ ] **Step 4: Run** the new test and `plugin-cli-entry.test.ts` (frozen); typecheck; both frozen-list commands.

- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/shell/src/main/tools/tool-cli.ts packages/shell/test/tool-cli-entry.test.ts
git -C <worktree> commit --only packages/shell/src/main/tools/tool-cli.ts packages/shell/package.json packages/shell/test/tool-cli-entry.test.ts -m "feat(shell): @humanharness/shell/tools for the CLI" -m "<trailer>"
```

---

### Task 2: The terminal's tool host (`nodeToolHost`) and `cliTools`

**Files:**
- Create: `packages/cli/src/tool-host-node.ts`
- Test: `packages/cli/test/tool-host-node.test.ts` (new); fixture `packages/cli/test/fixtures/tools-mini/` (a tiny harness with three tools — `echo` (returns its args), `fetcher` (`uses.hosts: ["api.example.test"]`, `uses.secrets: ["api"]`, fetches `https://api.example.test/x` with `{{secret:api}}` in a header), `escape` (tries `globalThis.process`, `require`, `fetch`, `Buffer`) — and a committed `dist/`, built with slice 2's build command; plus a freshness test in the same file)

- [ ] **Step 1: Write the failing tests.**

```ts
import { cliTools, nodeToolHost, TOOL_P12_NOTE } from "../src/tool-host-node";

describe("the terminal's tool host (tools spec §11, A1)", () => {
  it("runs a built tool and answers through the real registry", async () => {
    // cliTools({ root: MINI, transport: none, secrets: async () => ({}), data: memory(), folder: tmp }) → registry.call({ tool: "echo", args: { a: 1 }, caller: "ui", scope: null }) → { ok: true, result: { a: 1 } }
  });
  it("params are checked before the tool runs", async () => { /* echo declares params { a: number }; args { a: "x" } → ok false, message names a */ });
  it("the tool's ctx.fetch goes through the broker: a declared host with the key substituted, through the given transport", async () => {
    // transport.fetch records the request → header holds "k-123" (the secret given), the trace entry hides it
  });
  it("an undeclared host is refused as in the app", async () => { /* … "access denied" access in the trace */ });
  it("the tool sees no process, require, fetch or Buffer global", async () => { /* escape returns { process: "undefined", require: "undefined", fetch: "undefined", Buffer: "undefined" } */ });
  it("ctx.summary and ctx.requestAi exist (slice 4) and requestAi is refused outside a post call", async () => { /* … */ });
  it("a tool that runs past its timeout fails", async () => { /* … */ });
  it("the committed dist is fresh", async () => { /* rebuild tools-mini in memory and compare */ });
  it("TOOL_P12_NOTE is the note printed before tool code runs", () => {
    expect(TOOL_P12_NOTE).toBe("Note: tool code runs in this Node process, not in the app's sandbox. Run only tools you trust.");
  });
});
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**

```ts
/** A1: printed once per command, before any tool code runs. */
export const TOOL_P12_NOTE = "Note: tool code runs in this Node process, not in the app's sandbox. Run only tools you trust.";

/**
 * The registry's host in the terminal (`tool test`, `tool run`, `run`): each built tool (`dist/tools/<id>.js`) evaluated
 * once in a fresh `vm` context holding only `plugin-run.ts`'s globals, its `ctx` forwarding every call to the broker
 * with the call id. Not a sandbox (P12): run only tools you trust.
 */
export function nodeToolHost(root: string): ToolRegistryDeps["host"] & { close(): void };

export interface CliToolsOptions {
  root: string;
  /** fetch and exec of every tool: fixtures, a recording, or the real ones (`tool run`). */
  transport(tool: string): { fetch: typeof fetch; run: typeof runFile };
  secrets(ids: string[]): Promise<Record<string, string>>;
  /** The data path (`ctx.data`): an in-memory store for fixtures, the folder's store for `tool run` and `run`. */
  data: ToolBrokerDeps["data"];
  /** The folder `ctx.files` reaches, and its reference folders. */
  folder: { base: string; references: { id: string; path: string }[] };
  /** Trace entries: kept in memory for printing; `run` may also write them where the app does. */
  onTrace?(e: TraceEntry): void;
  now?: () => Date;
}

/** A registry over the terminal's host: the app's registry, broker and trace (A1), with the caller's transport and keys. */
export function cliTools(o: CliToolsOptions): { registry: ToolRegistry; entries: TraceEntry[]; close(): void };
```
Write both in full:
- `nodeToolHost`: read `dist/tools.json` (slice 2's reader from `@humanharness/shell/tools` if exported, else parse it and check with slice 2's schema); per call, load the tool's bundle once (cache by id) and evaluate it exactly as `resources/tool-host.mjs` does (Task 0's note), in a `vm.createContext` with the same globals `plugin-run.ts` gives a backend (read it: `setTimeout`, `clearTimeout`, `URL`, `TextEncoder`, `TextDecoder`, `console` routed to the trace log …) and nothing else; `ctx` methods call the broker with the call id (`broker.call(callId, name, args)`), and a refusal rejects with `ToolRefused`. The host's `call(c, timeoutMs)` runs the tool's `run(args, ctx)` with `ctx.inputs` frozen (slice 3) and a timer; `off()` returns null.
- `cliTools`: `new ToolRegistry({ json, host: nodeToolHost(root), broker: (tool) => new ToolBroker({ …, transport: () => o.transport(tool) }), trace: { append: async (e) => { entries.push(e); o.onTrace?.(e); } }, secretValues: async (tool) => Object.values(await o.secrets(meta.uses.secrets ?? [])), … })`. Keys never come from anywhere but `o.secrets`.

- [ ] **Step 4: Run, typecheck, both frozen-list commands, commit.**

```bash
git -C <worktree> add packages/cli/src/tool-host-node.ts packages/cli/test/tool-host-node.test.ts packages/cli/test/fixtures/tools-mini
git -C <worktree> commit --only packages/cli/src/tool-host-node.ts packages/cli/test/tool-host-node.test.ts packages/cli/test/fixtures/tools-mini -m "feat(cli): run built tools in the terminal through the app's registry" -m "<trailer>"
```
(If `.gitignore` ignores the fixture's `dist/`, add an exception line next to slice 2's and commit `.gitignore` too.)

---

### Task 3: The tool fixture format and its reader

**Files:**
- Create: `packages/harness-sdk/src/tool-fixtures.ts` (export `"./tool-fixtures"` in `packages/harness-sdk/package.json`, Node-free), `packages/shell/src/main/tools/tool-fixture-files.ts`
- Modify: `packages/shell/src/main/plugin-fixture-files.ts` (one additive export: the file-walking helper `readFixtureFiles(dir, parse, log)` that `readPluginFixtures` already does inside; `readPluginFixtures` calls it, unchanged in behaviour), `packages/shell/src/main/tools/tool-cli.ts` (export `readToolFixtures`)
- Test: `packages/harness-sdk/test/tool-fixtures.test.ts` (new), `packages/shell/test/tools/tool-fixture-files.test.ts` (new)

- [ ] **Step 1: Write the failing tests.**

```ts
// tool-fixtures.test.ts
describe("toolFixtureSchema (tools spec §11, Decision 1)", () => {
  it("takes args, inputs, scope, exchanges, data, files and expect.result", () => { /* parses; args default {} ; scope default null */ });
  it("takes expect.error instead of expect.result", () => { /* … */ });
  it("refuses both or neither of result and error", () => { /* … */ });
  it("refuses an unknown key (strict)", () => { /* … */ });
  it("refuses a files path outside the folder (absolute, .., .harness/, .git/)", () => { /* folderRelative rules */ });
  it("refuses a data collection name that isn't an id, and __proto__", () => { /* … */ });
  it("exchanges use the plugin fixture exchange schema", () => { /* a bad method → refused */ });
});
```
```ts
// tool-fixture-files.test.ts
describe("readToolFixtures (A4)", () => {
  it("reads tools/<id>/fixtures/*.json in name order, each with its file name", async () => { /* [{ file: "a.json", fixture }, …] */ });
  it("skips (with a note) a file that doesn't parse, a link, and anything over the caps", async () => { /* FIXTURE_FILES, FIXTURE_BYTES */ });
  it("a missing fixtures folder is no fixtures", async () => { /* [] */ });
  it("the plugin reader is unchanged", async () => { /* plugin-fixture tests stay green: run them */ });
});
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**

```ts
// tool-fixtures.ts
import { z } from "zod";
import { fixtureSchema } from "./plugin-fixtures";
import { TOOL_ID } from "./tools";

const ID = /^[a-z][a-z0-9_-]{0,63}$/;
/** A path inside the fixture's temp folder: relative, no `..`, not in `.harness/` or `.git/`. */
const filePath = z.string().min(1).max(512).refine(
  (p) => !p.startsWith("/") && !p.startsWith("\\") && !/^[A-Za-z]:/.test(p) && !p.split(/[\\/]/).some((s) => s === ".." ) && ![".harness", ".git"].includes(p.split(/[\\/]/)[0]),
  "must be a relative path inside the folder, outside .harness/ and .git/",
);
const noProto = (r: Record<string, unknown>) => !Object.hasOwn(r, "__proto__");

/** One case of `humanharness tool test` (tools spec §11, Decision 1): `tools/<id>/fixtures/<name>.json`. */
export const toolFixtureSchema = z.strictObject({
  args: z.record(z.string(), z.unknown()).default({}),
  inputs: z.record(z.string().regex(TOOL_ID), z.unknown()).optional(),
  scope: z.string().regex(ID).nullable().default(null),
  exchanges: z.array(fixtureSchema).max(200).optional(),
  data: z.record(z.string().regex(ID), z.array(z.record(z.string(), z.unknown())).max(1000)).refine(noProto).optional(),
  files: z.record(filePath, z.string().max(1024 * 1024)).refine(noProto).optional(),
  expect: z.union([z.strictObject({ result: z.unknown() }), z.strictObject({ error: z.string().min(1).max(500) })]),
});
export type ToolFixture = z.output<typeof toolFixtureSchema>;
```
(`fixtureSchema` lives in `plugin-fixtures.ts`, which imports `node:buffer`; if importing it here would pull Node into the SDK's main entry, keep `tool-fixtures.ts` a separate Node-only entry like `plugin-fixtures`, and say so.) Check `{ result: undefined }` parses as a result case: `z.unknown()` accepts it, but `strictObject` needs the key present — test both.

`tool-fixture-files.ts`: `readToolFixtures(root: string, tool: string, log): Promise<{ file: string; fixture: ToolFixture }[]>` — `path.join(root, "tools", tool, "fixtures")` through `readFixtureFiles` with `toolFixtureSchema.parse` (the tool id checked against `TOOL_ID` first).

- [ ] **Step 4: Run** the new tests and every plugin fixture test (frozen, green); typecheck; both frozen-list commands.

- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/harness-sdk/src/tool-fixtures.ts packages/shell/src/main/tools/tool-fixture-files.ts packages/harness-sdk/test/tool-fixtures.test.ts packages/shell/test/tools/tool-fixture-files.test.ts
git -C <worktree> commit --only packages/harness-sdk/src/tool-fixtures.ts packages/harness-sdk/package.json packages/shell/src/main/tools/tool-fixture-files.ts packages/shell/src/main/plugin-fixture-files.ts packages/shell/src/main/tools/tool-cli.ts packages/harness-sdk/test/tool-fixtures.test.ts packages/shell/test/tools/tool-fixture-files.test.ts -m "feat(sdk): tool fixtures — the format and its reader" -m "<trailer>"
```

---

### Task 4: `humanharness tool test`

**Files:**
- Create: `packages/cli/src/tool-test.ts`, `packages/cli/src/tool.ts`
- Modify: `packages/cli/src/main.ts` (`tool` in `COMMANDS`, a `USAGE` line, `exitsWhenDone` for `tool test` and `tool run`)
- Test: `packages/cli/test/tool-test.test.ts` (new), `packages/cli/test/tool-cli.test.ts` (new); fixtures added to `packages/cli/test/fixtures/tools-mini/tools/<id>/fixtures/` (Task 2's harness)

- [ ] **Step 1: Write the failing tests.**

```ts
// tool-test.test.ts
describe("humanharness tool test (tools spec §11)", () => {
  it("runs each fixture of a tool and passes on an equal result", async () => { /* echo/fixtures/basic.json → report ok */ });
  it("fails a fixture whose result differs, showing both", async () => { /* "expected {…} got {…}" */ });
  it("expect.error passes when the call fails with that text", async () => { /* … */ });
  it("fetch and exec answer only from the fixture's exchanges; an unmatched one fails", async () => { /* fetcher without exchanges → "No fixture for GET https://api.example.test/x" */ });
  it("keys are fixture-<id>: the exchange matched with the key substituted, nothing real asked", async () => { /* … */ });
  it("data is seeded from the fixture and writes are reported, not saved", async () => { /* a writer tool → report lists 1 write to notes */ });
  it("files are written to a temp folder that is removed after", async () => { /* … */ });
  it("inputs reach ctx.inputs", async () => { /* … */ });
  it("with no id, every tool with fixtures runs; a tool without fixtures is listed as such", async () => { /* … */ });
  it("an unknown id is a usage error naming the tools", async () => { /* … */ });
  it("prints the P12 note for tools once, before any tool runs", async () => { /* … */ });
  it("exit code 1 when any fixture fails", async () => { /* … */ });
});
```
```ts
// tool-cli.test.ts
describe("the tool command", () => {
  it("D0: tool refuses without tools; USAGE lists tool once", async () => {
    // a harness without tools: main(["tool", "test"]) → exit 1, stderr "This harness declares no tools.\n"; USAGE contains "  tool <command>" once
  });
  it("tool --help lists test and run", async () => { /* … */ });
  it("exitsWhenDone is true for tool test and tool run", () => { /* … */ });
});
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**
  - `tool-test.ts`: `testTools(root, o: { tool?: string; out }) : Promise<ToolTestReport[]>`: load the harness (`loadHarness`) and require `hasTools` ("This harness declares no tools."); build in memory (Task 0's build function; a build problem is a `CliError` with its text); for each tool (or the one named), `readToolFixtures`; per fixture: a temp folder (`fs.mkdtemp` in `os.tmpdir()`) written from `files` (each path through `path.join` and checked to stay inside), an in-memory data store (a `Map` per collection seeded from `data`; `put`/`patch`/`delete` recorded as writes; `get`/`query` answered from it; keyed by each collection's key from the manifest), `cliTools({ root, transport: () => fixtureTransport(f.exchanges ?? []), secrets: fixtureSecrets, data, folder: { base: tmp, references: [] } })`, then `registry.call({ tool, args: f.args, caller: "ui", scope: f.scope, ...(f.inputs ? { inputs: f.inputs } : {}) })`; compare (Decision 2, deep equality on JSON); remove the temp folder in `finally`. `fixtureSecrets` is `plugin-test.ts`'s (import it; don't copy).
  - `formatToolReports(reports)`: per tool `"<id>: <n> fixtures, <k> failed"`, per failing case `"  <file>: <why>"`, then the trace lines of each failing case (tool, ms, ok, accesses, error), and a last line `"<n> fixtures passed."` or `"<k> of <n> fixtures failed."`.
  - `tool.ts`: `toolCommand(args, io)` dispatching `test [<id>] [--harness <dir>]` and (Task 6) `run`; `--help` prints `TOOL_USAGE`.
  - `main.ts`: `tool: toolCommand`; USAGE line `"  tool <command>                           Test and run the harness's tools (humanharness tool --help)"`; `exitsWhenDone`: `|| (argv[0] === "tool" && (argv[1] === "test" || argv[1] === "run"))`. If `main.test.ts` pins `USAGE` byte for byte, update only that expectation and say so.

- [ ] **Step 4: Run** the new tests, `main.test.ts`, `plugin-test.test.ts` (frozen); typecheck; both frozen-list commands.

- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/cli/src/tool-test.ts packages/cli/src/tool.ts packages/cli/test/tool-test.test.ts packages/cli/test/tool-cli.test.ts packages/cli/test/fixtures/tools-mini
git -C <worktree> commit --only packages/cli/src/tool-test.ts packages/cli/src/tool.ts packages/cli/src/main.ts packages/cli/test/tool-test.test.ts packages/cli/test/tool-cli.test.ts packages/cli/test/fixtures/tools-mini -m "feat(cli): humanharness tool test runs a tool on its fixtures" -m "<trailer>"
```
(Add `packages/cli/test/main.test.ts` to `--only` if you changed it.)

---

### Task 5: `check` runs tool fixtures

**Files:**
- Modify: `packages/cli/src/check.ts` (rule `tool-fixture`, after slice 3–4's `tool-steps`), `packages/cli/src/tool-test.ts` (export `toolFixtureFindings`)
- Test: `packages/cli/test/check-tool-fixtures.test.ts` (new)

- [ ] **Step 1: Write the failing tests.**

```ts
describe("check runs tool fixtures (tools spec §11, Decision 4)", () => {
  it("D0: no tools, no fixture findings", async () => { /* a harness without tools: check's findings deep-equal those of a copy run before this task (record them from check.test.ts's helper harness) */ });
  it("a passing fixture adds nothing", async () => { /* … */ });
  it("a failing fixture is a tool-fixture error naming the tool and the file", async () => {
    // 'Tool "echo": fixtures/bad.json: expected {"a":1}, got {"a":2}' ; file "tools/echo/fixtures/bad.json"
  });
  it("a fixture file that doesn't parse is a tool-fixture error", async () => { /* … */ });
  it("a harness whose tools don't build reports only the build problem", async () => { /* no tool-fixture finding */ });
  it("check prints the P12 note for tools only when it runs a fixture", async () => { /* … */ });
});
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.** `toolFixtureFindings(root, harness, json)` reuses `testTools`'s per-fixture runner and maps each failure (and each skipped file's note) to `error("tool-fixture", …, "tools/<id>/fixtures/<file>")`. In `check.ts`, only when `hasTools(harness)` and the in-memory build succeeded and at least one `tools/<id>/fixtures/` folder exists.

- [ ] **Step 4: Run** the new test, `check.test.ts`, `check-pre.test.ts`, `check-recipes.test.ts`; typecheck; both frozen-list commands.

- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/cli/test/check-tool-fixtures.test.ts
git -C <worktree> commit --only packages/cli/src/check.ts packages/cli/src/tool-test.ts packages/cli/test/check-tool-fixtures.test.ts -m "feat(cli): check runs each tool's fixtures" -m "<trailer>"
```

---

### Task 6: `humanharness tool run`

**Files:**
- Create: `packages/cli/src/tool-run.ts`
- Modify: `packages/cli/src/tool.ts` (`run` subcommand)
- Test: `packages/cli/test/tool-run.test.ts` (new)

- [ ] **Step 1: Write the failing tests.** Every test injects the transport, the key reader and `allowHost` (`ToolRunDeps`); nothing reaches the network.

```ts
describe("humanharness tool run (tools spec §11, A5, A6)", () => {
  it("runs the tool once with --args and prints its result and trace", async () => {
    // echo --args '{"a":1}' → stdout has the result JSON and "echo · <ms> ms · ok"
  });
  it("--args that aren't a JSON object are a usage error", async () => { /* '[1]', 'x' */ });
  it("asks each key the tool declares, hidden, and only those", async () => { /* fetcher → readSecret called once for "api" with its label */ });
  it("refuses to ask keys without a terminal", async () => { /* isTTY false → CliError "tool run asks for keys in a terminal" */ });
  it("a host that isn't public is refused before any request", async () => { /* allowHost false → the call fails, the transport never called */ });
  it("the printed trace hides the key", async () => { /* … */ });
  it("a tool that writes needs --yes", async () => {
    // a writer tool without --yes → CliError "This tool writes to <folder>. Add --yes to run it for real."; with --yes it runs
  });
  it("--folder and --scope reach ctx.files and ctx.scope", async () => { /* … */ });
  it("prints the P12 note for tools first", async () => { /* … */ });
  it("exit 1 when the call fails", async () => { /* … */ });
});
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**

```ts
export interface ToolRunDeps {
  /** Real fetch and runFile (the defaults); tests inject their own. */
  transport: { fetch: typeof fetch; run: typeof runFile };
  /** Asks a key with the typed characters hidden (plugin-record's `hiddenReader`). */
  readSecret(label: string): Promise<string>;
  /** A host resolves only to public addresses (plugin-record's `isPublicHost`). */
  allowHost(hostname: string): Promise<boolean>;
  isTTY: boolean;
}
export async function runToolOnce(root: string, o: { tool: string; args: Record<string, unknown>; folder?: string; scope?: string; yes?: boolean; out: Writable }, d: ToolRunDeps): Promise<number>;
```
- The harness loaded and built in memory, as `tool test`. The tool's `uses` read from the build's `tools.json`: writes (`uses.data.write` non-empty or `uses.files === "write"`) without `--yes` → the `CliError` above.
- Keys: for each `uses.secrets` id, `readSecret(<the manifest secret's label>)`, once; kept in memory only.
- Transport: `fetch` wrapped so each request's host goes through `allowHost` first (refused → `throw new Error("Not a public host: <host>")`, which the broker records as a failed access); `run` as given.
- Folder: `--folder` (resolved, must exist) or `run`'s default folder (`run.ts`'s rule; Task 0's note); the data path is the folder's own store, the same one `run` opens (`who: "tool"`), scoped to `--scope` when given.
- Print the P12 note, then the result (`JSON.stringify(result, null, 2)`) or the error, then the trace lines (one per entry: tool, ms, ok, each access `fetch GET https://… allowed`).
- `tool.ts`: `run <id> --args '<json>' [--folder <dir>] [--scope <id>] [--yes] [--harness <dir>]`; the real deps: `transport: { fetch, run: runFile }`, `readSecret: hiddenReader(stdin, stdout)`, `allowHost: isPublicHost`, `isTTY: !!stdin.isTTY`.

- [ ] **Step 4: Run, typecheck, both frozen-list commands, commit.**

```bash
git -C <worktree> add packages/cli/src/tool-run.ts packages/cli/test/tool-run.test.ts
git -C <worktree> commit --only packages/cli/src/tool-run.ts packages/cli/src/tool.ts packages/cli/test/tool-run.test.ts -m "feat(cli): humanharness tool run runs a tool once against a folder" -m "<trailer>"
```

---

### Task 7: The recording format: tool calls in turns, step recordings, and their checks

**Files:**
- Modify: `packages/fake-agent/src/mock.ts` (`mockTurnSchema.tools`, `stepRecordingSchema`, `loadStepRecording`), `packages/cli/src/check.ts` (rule `mock-step`; a turn's `tools` naming no `agent: "call"` tool is a `mock-*` error, the rule `mock` findings already use)
- Test: `packages/fake-agent/test/mock-tools.test.ts` (new), `packages/cli/test/check-mock-tools.test.ts` (new)

- [ ] **Step 1: Write the failing tests.**

```ts
// mock-tools.test.ts
describe("tools in recordings (tools spec §12, Decisions 9, 11)", () => {
  it("D0: a recording without tools parses as before", () => {
    // the demo's recordings (harnesses/demo/mock/*.json) parse to the same value as before this task (no tools key)
  });
  it("a turn's tools: up to 20 { tool, args } calls, in order", () => { /* … */ });
  it("refuses a tool call with a bad id or args that aren't an object", () => { /* … */ });
  it("loadRecordings ignores mock/tools/ and mock/steps/ (only mock/*.json)", () => { /* … */ });
  it("stepRecordingSchema: { version: 1, job, output, request? }", () => { /* … strict */ });
  it("loadStepRecording reads mock/steps/<job>.json; missing → null; a bad file → a problem", () => { /* … */ });
});
```
```ts
// check-mock-tools.test.ts
// "a turn's tools naming no agent: call tool is a mock-recording error" (use the rule name today's mock checks use)
// "mock-step: a step recording for no recipe with an AI step is an error"
// "mock-step: output and request are checked against the job's AI step output"
// "D0: a harness without tools or recipes gets no new mock finding"
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement** in `mock.ts`:

```ts
const toolCallSchema = z.strictObject({ tool: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/), args: z.record(z.string(), z.unknown()) });

// in mockTurnSchema, after `reads`:
  /**
   * The agent's tool calls this turn (tools spec §12), made on the `tools` MCP server before the turn's blocks. Optional,
   * not defaulted: a recording without them parses (and is written by `--record`) exactly as before.
   */
  tools: z.array(toolCallSchema).max(20).optional(),

/** A recipe's AI step in mock mode (Decision 11): `mock/steps/<job>.json`. */
export const stepRecordingSchema = z.strictObject({
  version: z.literal(1),
  job: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  /** step_output's input for a first round. */
  output: z.record(z.string(), z.unknown()),
  /** step_output's input for a round a post-step asked for; `output` when absent. */
  request: z.record(z.string(), z.unknown()).optional(),
});
export type StepRecording = z.infer<typeof stepRecordingSchema>;

/** `mock/steps/<job>.json`, or null when there is none; a file that doesn't parse throws with its problem. */
export function loadStepRecording(dir: string, job: string): StepRecording | null;
```
`loadStepRecording` checks `job` against the id pattern before joining the path, and that the file's `job` equals it.
`check.ts`: for each `mock/steps/*.json`: parse; the job must be a recipe with an AI step (`aiStepOf`); `output` and `request` must pass `step.output.safeParse` (first problem as "path: message") → `mock-step` errors. For each recording turn's `tools`: each id a tool of the harness with `agent: "call"` (from the in-memory build) → otherwise a mock error with today's mock rule name.

- [ ] **Step 4: Run** the new tests, the frozen `mock.test.ts`, `mock-replay.test.ts`, `check.test.ts`; typecheck; both frozen-list commands.

- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/fake-agent/test/mock-tools.test.ts packages/cli/test/check-mock-tools.test.ts
git -C <worktree> commit --only packages/fake-agent/src/mock.ts packages/cli/src/check.ts packages/fake-agent/test/mock-tools.test.ts packages/cli/test/check-mock-tools.test.ts -m "feat(mock): tool calls in recordings and AI step recordings" -m "<trailer>"
```

---

### Task 8: Tools in `humanharness run`

**Files:**
- Modify: `packages/cli/src/run.ts` (a tool host for a harness with tools: pre-steps before the first message, the agent's `tools` server, one line per call; slice 3's notice removed), `packages/cli/test/run-pre.test.ts` (slice 3 Task 14's test of the notice: its one `it` changes to "runs the pre-steps and prints no notice")
- Test: `packages/cli/test/run-tools.test.ts` (new; `run.test.ts` frozen)

- [ ] **Step 1: Write the failing tests.** `runTask` with fake-claude scripts, as `run.test.ts` drives it (read it; don't change it), on `packages/cli/test/fixtures/tools-mini` extended with an action `study` whose `pre` is `[{ tool: "echo", args: { a: 1 }, as: "one" }]`.

```ts
describe("tools in a terminal run (tools spec §6, §12)", () => {
  it("D0: a harness without tools starts no tool host", async () => { /* the notes fixture: no P12 tools note, no tools MCP server in the engine's config, output as before */ });
  it("runs the pre-steps and puts ## Prepared data in the first message", async () => { /* fake-claude records its prompt: it contains "## Prepared data" and "### one · echo" */ });
  it("a required pre-step that fails stops the run with its message", async () => { /* … exit 1, "Couldn't prepare this task: …" */ });
  it("serves the tools MCP server: the agent's call runs and prints one line", async () => {
    // fake-claude step { mcp: { server: "tools", tool: "echo", args: { a: 2 } } } → stdout "tool echo · <n> ms · ok"
  });
  it("writes the pre usage row and the trace as the app does", async () => { /* .harness/usage.jsonl has a pre row; .harness/trace/<task>.jsonl exists */ });
  it("prints the P12 note for tools once", async () => { /* … */ });
  it("a build problem stops the run before the engine starts", async () => { /* … */ });
});
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement** in `run.ts`, only inside `if (hasTools(harness))` blocks:
  - build in memory (Task 0's function); a problem → `CliError` with its text;
  - print `TOOL_P12_NOTE`;
  - `cliTools({ root, transport: () => ({ fetch: publicOnlyFetch, run: runFile }), secrets: <ask hidden, once per id, as tool run>, data: <the run's data store as tool>, folder: { base: folder, references }, onTrace: (e) => { out.write(line(e)); void trace.append(e); } })` where `trace` is a `ToolTrace` on the run's folder (as the app writes it);
  - `TaskDeps.prepare` (slice 3) built from `runPreSteps` and `preparedSection` exactly as slice 3's `tools-host.ts` `prepare` builds it (call that function if it is exported; otherwise export it there, additively, and call it here);
  - the agent's `tools` server: pass `tools` to the runtime as slice 2's index.ts passes it (Task 0's note), its `request` answering `registry.call({ …, caller: "agent", task, scope, phase })`;
  - remove slice 3's "Pre-steps are not run in the terminal yet." line and change its test's one assertion.

- [ ] **Step 4: Run** the new test, `run.test.ts` (frozen), `run-pre.test.ts` (changed), `runtime-d0.test.ts`; typecheck; both frozen-list commands.

- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/cli/test/run-tools.test.ts
git -C <worktree> commit --only packages/cli/src/run.ts packages/cli/test/run-tools.test.ts packages/cli/test/fixtures/tools-mini packages/cli/test/run-pre.test.ts -m "feat(cli): tools in humanharness run — pre-steps and the tools server" -m "<trailer>"
```
(Add `packages/shell/src/main/tools/tools-host.ts` and `tool-cli.ts` if you exported `prepare`'s builder.)

---

### Task 9: `run --record` records tool calls and broker accesses

**Files:**
- Modify: `packages/cli/src/record.ts` (`Recorder.toolCall`, a turn's `tools`), `packages/cli/src/run.ts` (feed the recorder; record each access's reply; write `mock/tools/<tool>/<NNN>.json`)
- Test: `packages/cli/test/record-tools.test.ts` (new; `record.test.ts` frozen)

- [ ] **Step 1: Write the failing tests.** `runTask` with `record: true`, fake-claude scripts and an injected transport whose `fetch` answers from a table (no network).

```ts
describe("run --record with tools (tools spec §12, A3)", () => {
  it("D0: a recording of a harness without tools has no tools key and no mock/tools", async () => { /* … */ });
  it("a turn's agent tool calls are recorded in order under tools", async () => { /* mock/study.json turns[0].tools === [{ tool: "echo", args: { a: 2 } }] */ });
  it("pre-step calls are not recorded", async () => { /* … */ });
  it("each fetch and exec with its reply is written to mock/tools/<tool>/NNN.json in the plugin fixture format", async () => {
    // fetcher's GET → mock/tools/fetcher/001.json parses with fixtureSchema; status, headers, text as answered
  });
  it("keys are replaced by {{secret:<id>}} in every written exchange", async () => { /* the header holds {{secret:api}}, the file never holds k-123 */ });
  it("a key that still shows aborts the write and names the file", async () => { /* a reply echoing the key base64-encoded → "Not recorded: … holds a key" and no file */ });
  it("numbers continue after the highest existing file and never overwrite one", async () => { /* 001 exists → 002 */ });
});
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**
  - `record.ts`: `Recorder.toolCall(tool: string, args: Record<string, unknown>)` adds to the current turn's `tools` (created on the first call; at most 20, later ones skipped with a warning line); a turn without calls keeps no `tools` key (D0).
  - `run.ts` (inside the tools blocks of Task 8): the agent server's `request` calls `recorder?.toolCall(tool, args)` for `caller: "agent"` only; the transport given to `cliTools` is wrapped so each completed `fetch`/`exec` pushes `{ tool, exchange }` (the request and the reply's status, headers and text, as `plugin-record.ts`'s `recordingTransport` builds them; read it and reuse its builder if it is exported, else mirror it); at the end, with the run's keys, each exchange goes through `stripSecrets`; a `leaked` result skips that file with "Not recorded: mock/tools/<tool>/<NNN>.json holds a key"; the rest are written atomically (temp file + rename) as `mock/tools/<tool>/<NNN>.json`, three digits, after the highest existing number.
  - The closing message gains, when any exchange was written: "Tool replies were recorded in mock/tools/: review them before committing them."

- [ ] **Step 4: Run** the new test and `record.test.ts`, `plugin-record.test.ts` (frozen); typecheck; both frozen-list commands.

- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/cli/test/record-tools.test.ts
git -C <worktree> commit --only packages/cli/src/record.ts packages/cli/src/run.ts packages/cli/test/record-tools.test.ts -m "feat(cli): run --record records tool calls and their replies" -m "<trailer>"
```

---

### Task 10: `dev --mock` answers tools from the recording

**Files:**
- Create: `packages/shell/src/main/tools/recorded-transport.ts`
- Modify: `packages/shell/src/main/tools/tools-host.ts` (`mock?: { dir: string }`: each tool's transport from `mock/tools/<tool>/`, secrets `fixture-<id>`), `packages/shell/src/main/index.ts` (pass `mock: { dir: path.join(harness.root, "mock", "tools") }` when `hooks.mock`), `packages/shell/src/main/tools/tool-cli.ts` (export `recordedToolTransport`), `packages/fake-agent/src/mock-claude.ts` (a turn's `tools` calls; a step turn from `mock/steps/<job>.json`), `packages/fake-agent/src/mock-replay.ts` (the played turn carries `tools`)
- Test: `packages/shell/test/tools/tools-mock.test.ts` (new), `packages/fake-agent/test/mock-claude-tools.test.ts` (new)

- [ ] **Step 1: Write the failing tests.**

```ts
// tools-mock.test.ts
describe("tools in mock mode (tools spec §12, A2, A7)", () => {
  it("D0: without mock the transport is the real one", async () => { /* createToolsHost without mock: the broker's transport dep is absent (slice 2's default) */ });
  it("ctx.fetch answers from mock/tools/<tool>/ and the tool runs for real", async () => { /* … */ });
  it("an access with no recording fails 'Not recorded: GET https://…'", async () => { /* … and the trace shows it unfolded (ok false) */ });
  it("an exec with no recording fails 'Not recorded: gh pr checks 12'", async () => { /* … */ });
  it("keys are fixture-<id>; the key store is never read", async () => { /* store.harnessValues never called */ });
  it("each tool reads only its own folder: tool a can't answer from b's recordings", async () => { /* … */ });
});
```
```ts
// mock-claude-tools.test.ts — runMockTurn with an mcpServers that has a ui and a tools server (a fake MCP server script, as the other mock-claude tests use for ui)
// "a turn's tools are called on the tools server in order, before its blocks"
// "a tools call the server refuses fails the turn with its message" (as a refused block does today)
// "a turn without tools calls nothing on the tools server" (D0)
// "a step turn answers step_output with output from mock/steps/<job>.json, and request for a round whose prompt has ### request"
// "a step turn without a step recording plays nothing (slice 4)"
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.**
  - `recorded-transport.ts`:

```ts
import { type FixtureExchange, fixtureTransport } from "@humanharness/harness-sdk/plugin-fixtures";

/** "No fixture for X" from the fixture transport, as mock mode says it (tools spec §12). */
const NO_FIXTURE = "No fixture for ";

/** A tool's recorded exchanges as its fetch and exec in mock mode: an unmatched access fails "Not recorded: <target>" (A2). */
export function recordedToolTransport(exchanges: FixtureExchange[]): { fetch: typeof fetch; run: typeof runFile } {
  const t = fixtureTransport(exchanges);
  const rename = (err: unknown): never => {
    if (err instanceof Error && err.message.startsWith(NO_FIXTURE)) throw new Error(`Not recorded: ${err.message.slice(NO_FIXTURE.length)}`);
    throw err;
  };
  return {
    fetch: ((input: string | URL | Request, init?: RequestInit) => t.fetch(input, init).catch(rename)) as typeof fetch,
    run: ((file, args, o) => t.run(file, args, o).catch(rename)) as typeof runFile,
  };
}
```
  - `tools-host.ts`: with `mock`, the broker's `transport(tool)` is `recordedToolTransport(await readToolExchanges(mock.dir, tool, log))` (read once per tool per start, `readPluginFixtures(mock.dir, tool, log)`: one exchange per file, the same reader as plugins), and the `secrets` dep answers `fixture-<id>` for each id without touching the store.
  - `mock-replay.ts`: the played turn (`play`) carries `tools: turn.tools ?? []`.
  - `mock-claude.ts`: before `for (const b of play.blocks)`, `for (const c of play.tools) await callOn("tools", c.tool, c.args)` (the same helper as `call`, on `mcpServers.tools`; a missing `tools` server with calls to make fails the turn "the app configured no tools MCP server"). The step branch from slice 4 becomes: `const job = mcpServers.ui.env.HH_STEP; const rec = loadStepRecording(env.dir, job)` (catching a bad file into an error result); with a recording, call `step_output` on the `ui` server with `prompt.includes("\n### request\n") ? rec.request ?? rec.output : rec.output`, then the success result; without one, slice 4's empty turn.

- [ ] **Step 4: Run** the new tests, the frozen `mock-claude.test.ts`, `mock-replay.test.ts`, `mock.spec.ts`; typecheck; `corepack pnpm app:build`; both frozen-list commands.

- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/shell/src/main/tools/recorded-transport.ts packages/shell/test/tools/tools-mock.test.ts packages/fake-agent/test/mock-claude-tools.test.ts
git -C <worktree> commit --only packages/shell/src/main/tools/recorded-transport.ts packages/shell/src/main/tools/tools-host.ts packages/shell/src/main/index.ts packages/shell/src/main/tools/tool-cli.ts packages/fake-agent/src/mock-claude.ts packages/fake-agent/src/mock-replay.ts packages/shell/test/tools/tools-mock.test.ts packages/fake-agent/test/mock-claude-tools.test.ts -m "feat(mock): tools answer from the recording in dev --mock" -m "<trailer>"
```

---

### Task 11: The guide's "Mechanical work" phase and its Lessons

**Files:**
- Modify: `packages/cli/guide/new-harness.md` (a Phase 4 "Mechanical work"; phases after it renumbered; a `## Lessons` section before the Verify phase), `packages/cli/src/harness-md.ts` (`HARNESS_SECTIONS` gains "Mechanical work" after "Flow"), `packages/cli/template/HARNESS.md` (the section), `packages/cli/test/guide.test.ts` (the `PHASES` list only)
- Test: `packages/cli/test/guide-tools.test.ts` (new)

- [ ] **Step 1: Write the failing tests.**

```ts
describe("the guide's tools phase (tools spec §11)", () => {
  it("has Mechanical work as Phase 4, between Flow and Context", () => { /* phases(guide)[3] → { n: 4, name: "Mechanical work" } */ });
  it("the phase fills HARNESS.md → Mechanical work", () => { /* "Fills: HARNESS.md → Mechanical work" */ });
  it("it walks moment by moment: key moment, code or AI, impact", () => { /* the body names each */ });
  it("it proposes tools, pre-steps and job recipes and points at tool test", () => { /* "pre", "steps", "humanharness tool test" */ });
  it("has a Lessons section with the spec's lessons", () => {
    // "English ids", "`returns`", "no date or counting logic in prompts", "one tool per mechanical job", "fixture"
  });
  it("the template's HARNESS.md has the section, and parses with no unknown section", () => { /* parseHarnessMd(template).sections.has("Mechanical work") */ });
});
```
`guide.test.ts`: change `PHASES` to `["Task", "Decisions", "Flow", "Mechanical work", "Context", "Models", "Permissions and engines", "Identity", "Verify"]` and the test's name "runs the eight phases in order" → "runs the nine phases in order". No other line changes.

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Write the phase** (after Phase 3 — Flow; renumber Context → 5, Models → 6, Permissions and engines → 7, Identity → 8, Verify → 9; fix any "Phase N" reference in the text):

```markdown
## Phase 4 — Mechanical work

Fills: HARNESS.md → Mechanical work

Go through the flow moment by moment with the person. For each key moment, ask what happens there and sort it:

- **Code** when the answer is fixed by the data: what is due today, which tickets changed, a count, a date, a list of files. Code is exact, instant and free.
- **AI** when it takes judgment: what a student got wrong, which CI failure matters, how to word a reply.

For each moment write a row: the moment, code or AI, the tool or step, and why it matters (time, tokens, mistakes avoided). Then propose:

- **tools** for the code parts (`tools/<id>.ts`, `defineTool`): a `description` the agent can act on, `params`, `returns` when another step reads the result, `agent: "none"` for anything with effects outside the folder (moving a ticket, commenting on a PR), and `uses` with only what it reaches;
- **pre-steps** (`pre` on an action) for what a task always needs at its start: their results go into the first message, so the AI doesn't spend turns finding them;
- **`expects`** on a phase when the AI should call a tool there (a phase that ends without it is counted);
- **job recipes** (`steps` on a job) for background work that is mostly mechanical: tool steps, at most one AI step with a `when`, then a post-step that applies the AI's judgment.

Write one fixture per tool (`tools/<id>/fixtures/<case>.json`) and run `humanharness tool test <id>` before wiring it; `humanharness tool run <id> --args '{…}'` tries it once on a real folder. See `<core>/docs/architecture/tools.md`.
```
And before Phase 9:

```markdown
## Lessons

Mistakes already seen. Read them before writing tools; add one when a harness teaches a new one.

- Ids are English: tool ids, step names (`as`), fields, examples.
- Give a tool `returns` whenever a step reads its result (`input`, `forEach`, `when`): `check` refuses the step otherwise.
- No date or counting logic in prompts when a tool can do it: "what is due today" is a tool, not a paragraph in a brief.
- One tool per mechanical job, not one tool that does everything: small tools are easier to test, trace and reuse.
- Test every tool with a fixture before wiring it into a step.
```
  - `harness-md.ts`: `HARNESS_SECTIONS = ["Task", "Decisions", "Flow", "Mechanical work", "Context", …]`.
  - `template/HARNESS.md`, after Flow:

```markdown
## Mechanical work

| Moment | Code or AI | Tool or step | Why |
|---|---|---|---|
```

- [ ] **Step 4: Run** the new test, `guide.test.ts`, `harness-md.test.ts`, `template.test.ts`, `check.test.ts`; typecheck; both frozen-list commands.

- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/cli/test/guide-tools.test.ts
git -C <worktree> commit --only packages/cli/guide/new-harness.md packages/cli/src/harness-md.ts packages/cli/template/HARNESS.md packages/cli/test/guide.test.ts packages/cli/test/guide-tools.test.ts -m "docs(guide): the Mechanical work phase and the lessons" -m "<trailer>"
```

---

### Task 12: The template's example tool

**Files:**
- Create: `packages/cli/template/tools/word-count.ts`, `packages/cli/template/tools/word-count/fixtures/basic.json`
- Modify: `packages/cli/template/harness.config.ts` (`tools: { "word-count": "./tools/word-count.ts" }`), `packages/cli/template/HARNESS.md` (one row in Mechanical work), `tsconfig.json` (only if `packages/cli/template/tools` must be included for typecheck, next to `packages/cli/template/*.ts`)
- Test: `packages/cli/test/template-tool.test.ts` (new)

- [ ] **Step 1: Write the failing tests.**

```ts
describe("the template's example tool (tools spec §11)", () => {
  it("a harness made with init has word-count and its fixture", async () => { /* init into a temp dir (--skip-install) → files exist */ });
  it("check on a fresh init passes, running the fixture", async () => { /* no error; no tool-fixture finding */ });
  it("tool test word-count passes", async () => { /* … */ });
});
```

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Write the tool.**

```ts
// tools/word-count.ts
import { defineTool, z } from "@humanharness/cli/tool";

/** An example tool: replace it with your own (the guide's Mechanical work phase). */
export default defineTool({
  description: "Counts the words of a text file in the person's folder. Use it instead of counting by hand.",
  params: z.object({ path: z.string().min(1) }),
  returns: z.object({ path: z.string(), words: z.number().int() }),
  agent: "call",
  uses: { files: "read" },
  run: async ({ path }, ctx) => {
    const text = await ctx.files.read(path);
    const words = text.split(/\s+/).filter(Boolean).length;
    return { path, words };
  },
});
```
```json
{ "args": { "path": "notes/a.md" }, "files": { "notes/a.md": "one two  three\nfour" }, "expect": { "result": { "path": "notes/a.md", "words": 4 } } }
```
(`@humanharness/cli/tool` is slice 2's import for tools in a harness repo; Task 0's note has the real one.) `HARNESS.md` row: `| (example) counting words | Code | word-count | the agent doesn't spend a turn counting |`.

- [ ] **Step 4: Run** the new test, `init.test.ts`, `template.test.ts`, `check.test.ts`; typecheck; `corepack pnpm --filter @humanharness/e2e exec playwright test template.spec.ts` (the template's e2e still opens and runs its example task); both frozen-list commands.

- [ ] **Step 5: Commit.**

```bash
git -C <worktree> add packages/cli/template/tools packages/cli/test/template-tool.test.ts
git -C <worktree> commit --only packages/cli/template/tools packages/cli/template/harness.config.ts packages/cli/template/HARNESS.md packages/cli/test/template-tool.test.ts -m "feat(template): an example tool with a fixture" -m "<trailer>"
```
(Add `tsconfig.json`, `template.test.ts` or `init.test.ts` to `--only` only if one pinned the template's file list and had to change; say which and why.)

---

### Task 13: Fixture harness and the mock-mode e2e

**Files:**
- Create: `packages/fake-agent/fixtures/mock-tools-harness/` (`harness.config.ts`, `AGENTS.md`, `agent/tasks/forecast.md`, `tools/weather.ts`, `mock/forecast.json`, `mock/tools/weather/001.json`, `HARNESS.md`), `packages/e2e/tests/tools-mock.spec.ts`

- [ ] **Step 1: The fixture.** id `mock-tools`, permissions `{ edit: "folder", exec: false, web: true }`, one action `forecast` (brief starts "Forecast task:"), `secrets: [{ id: "weather", label: "Weather API key" }]`, one tool `weather` (`params { city }`, `returns { city, sky }`, `agent: "call"`, `uses: { hosts: ["api.weather.test"], secrets: ["weather"] }`, `run`: `ctx.fetch(\`https://api.weather.test/v1/\${city}\`, { headers: { authorization: "Bearer {{secret:weather}}" } })` and returns its JSON), and a pre-step `[{ tool: "weather", args: { city: "lima" }, as: "today" }]` on `forecast`. `mock/tools/weather/001.json`: a `GET https://api.weather.test/v1/lima` exchange answering `{"city":"lima","sky":"clear"}`. `mock/forecast.json`: match "Forecast task:", one turn with `tools: [{ tool: "weather", args: { city: "lima" } }, { tool: "weather", args: { city: "oslo" } }]`, text "Lima is clear.", and `show_choices`.

- [ ] **Step 2: The e2e** (`tools-mock.spec.ts`), built like `template.spec.ts` (`humanharness dev --build <out>` on the fixture, `test.setTimeout(300_000)`), launched with `launchMock(s, <fixture>/mock, <out>/main/index.js)`:
  - "a mock-mode run answers a tool from the recording": Start the fixture, start Forecast → the chat shows the prepared group "Prepared 1 item" and, unfolded, the result `clear`; the agent's first `weather` line is ok; "Lima is clear." shows.
  - "an access with no recording fails 'Not recorded'": the second call's line (oslo) is unfolded with "Not recorded: GET https://api.weather.test/v1/oslo".
  - "no key is asked or read": no Connections prompt appears, and the fixture's secret store folder in the sandbox's userData stays empty.

- [ ] **Step 3: Run** `tools-mock.spec.ts`, `mock.spec.ts` (frozen), `template.spec.ts`; `corepack pnpm app:build`; both frozen-list commands.

- [ ] **Step 4: Commit.**

```bash
git -C <worktree> add packages/fake-agent/fixtures/mock-tools-harness packages/e2e/tests/tools-mock.spec.ts
git -C <worktree> commit --only packages/fake-agent/fixtures/mock-tools-harness packages/e2e/tests/tools-mock.spec.ts -m "test(e2e): a mock-mode run answering tools from a recording" -m "<trailer>"
```

---

### Task 14: Docs and the full run

**Files:**
- Modify: `docs/architecture/tools.md` ("Authoring": `tool test`, fixtures and `check`, `tool run`, P12 for tools; "Mock mode"), `docs/architecture/mock-mode.md` (a turn's `tools`, `mock/tools/<tool>/`, `mock/steps/<job>.json`, "Not recorded", keys as `fixture-<id>`), `docs/architecture/authoring.md` (the guide's new phase and the Lessons), `docs/architecture/jobs.md` (the mock-mode gap from slice 4 closed by `mock/steps/`)

- [ ] **Step 1: Write the docs.** Each change names its Decision when it departs from the spec's words (Decisions 5, 8, 11) so Marco can find them. In `tools.md`, a D0 table for this slice (context.md's). Remove slice 4's "in mock mode an AI step has no recording" line from `jobs.md`'s known gaps and say what replaced it.
- [ ] **Step 2: Full run.** `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm app:build`, `corepack pnpm e2e` — all green. Both frozen-list commands print nothing. In `SCRATCH/carry-notes.md`: test and e2e counts, and what is left of the spec (JIT tools, driving modes and post-steps in actions are out of scope, §16).
- [ ] **Step 3: Commit.**

```bash
git -C <worktree> commit --only docs/architecture/tools.md docs/architecture/mock-mode.md docs/architecture/authoring.md docs/architecture/jobs.md -m "docs: tool authoring and tools in mock mode" -m "<trailer>"
```

---

## Parallel execution

0 first. 1 → 2. 3 is independent of 1–2 (SDK schema and reader). 4 needs 2, 3. 5 needs 4. 6 needs 2. 7 is independent of 1–6. 8 needs 2. 9 needs 7, 8. 10 needs 3, 7. 11 is independent of 1–10. 12 needs 4 (its fixture runs in `check`). 13 needs 10. 14 last. Fifteen tasks (0–14).
