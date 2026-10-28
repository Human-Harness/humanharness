# Tools and recipes — design

Status: approved by Marco, 2026-10-28, after a brainstorming session and a section-by-section review of the written spec. Not in the roadmap yet.

Inspired by ñoqui (github.com/tebys/noqui): typed code tools do the mechanical work, and the AI is called only for steps that need judgment, with the data already prepared. This spec covers tools written by the harness author ("ahead of time"). Tools learned from use ("just in time") are a later spec (§16) that builds on this one.

It builds on scopes and data (`2026-10-25-scopes-and-data-design.md`), task phases (`2026-10-25-task-phases-design.md`), harness setup steps (`2026-10-25-harness-setup-steps-design.md`), the context panel (`2026-10-27-context-panel-design.md`), parallel tasks and jobs (`2026-10-27-parallel-tasks-and-jobs-design.md`) and plugins (`2026-10-27-plugins-design.md`). §14 lists what it changes in them.

## 1. Why

All the code a harness ships today exists for the AI to use. Blocks and the harness's `mcp` servers are called only by the agent; the hatch H2 backend is called only by the UI; jobs are always an AI run. So mechanical work (read a list, filter by date, count, check CI) is done by the AI, turn by turn, every time.

Measured on the demo (`usage.jsonl`, real Claude and Codex turns, 2026-10-14 to 10-26): a turn reads 96k–257k tokens and writes 1.3k–2.8k. About 97–99% of a turn is reading and exploring. ñoqui reports the same pattern: a few cents against $0.09–1.46 for the same request.

Per harness (discovery interviews for dev and student; the rest is Claude's estimate):

- **Dev.** The "Pendiente" panel (PRs, red CI, review comments, Jira changes), the problems panel, the readiness check and git chores are mechanical, and they repeat all day. By Claude's estimate (the frequency is an assumption, the run size comes from the demo's light Codex turn), a light job every 30 minutes for 8 hours, at 150k–230k tokens a run, is 2.5M–3.5M tokens a day that code does for free.
- **Student.** "For today" (due reviews and the next concept whose prerequisites are done), choosing warm-up cards, spaced repetition and the "mastered only with evidence on 2 different days" rule are code. The main gain here is accuracy: models get dates and counts wrong, and that breaks the method.
- **Teacher, writer, cooker (estimate):** counts, indexes and searches. **Thinker:** little.

The gains that are not tokens: fresh panels without a token budget, exact dates and rules, millisecond answers, and light models that stop failing because they no longer explore.

### 1.1 Relation to engine plugins

Engine plugins (Claude Code plugins: MCP servers, hooks, skills) already let code do repeated work. This spec reuses what they share and adds what they cannot do.

| Engine plugin piece | Here | Relation |
|---|---|---|
| MCP server tools the AI calls | tools with `agent: "call"` | The same: served over MCP by the core `tools` server (§5). |
| `SessionStart` hook that adds context | pre-steps (§6) | Close: code prepares data before the AI reads it. |
| Hooks on engine events | tools in general | Same principle: code instead of AI turns. |

What engine plugins cannot do, and the reason this spec exists:

- **Run with no session.** Hooks and MCP tools run only inside an engine session. Tools here run from the UI, from jobs and before a session opens, with no AI at all.
- **Let code decide whether AI runs.** In an engine the AI owns the loop. A recipe runs its AI step only when `when` holds, and only a post-step can ask for another round (§7).
- **Work on every engine.** Human Harness runs Claude, Codex and OpenCode, and never installs anything into an engine's own config.
- **Sandbox each tool.** An engine hook or MCP server runs as a full user process. A tool here reaches only what its `uses` declares and never sees a secret (§4).
- **Show the work to people who are not developers:** the folded trace, Settings › Connections, the `connect` setup step.

## 2. Decisions (approved by Marco, 2026-10-28)

- **D1. Two specs.** This spec covers tools and recipes (measuring, the contract, the host, recipes, secrets, authoring). Tools learned from use (JIT) come later, after this is built and measured.
- **D2. A tool reaches the world only through `ctx`.** No `fs`, no `child_process`, no network of its own. It may import pure libraries that bundle for a browser. The same tool can later run unchanged wherever a JIT tool runs, the manifest's `permissions` hold for real, and tests can fake `ctx` whole.
- **D3. Tools run in a sandbox,** the plugins' sandboxed host. There is one host for every tool, so there is no trusted/untrusted split, and the hatches spec (H2) does not change.
- **D4. Every call is visible.** The registry in the main process traces every call. A task's chat shows each call as one folded line ("Read 12 Jira tickets · 0.3 s · 0 tokens") that unfolds to its arguments, result and broker accesses. Errors are always unfolded. Job runs show the same lines in their inbox record.
- **D5. Actions get pre-steps only.** Tools run before the session opens, and their results go into the first message. During the session the AI calls tools through MCP: the AI passes its judgment as arguments, and the tool applies the rule. A phase may declare the tools it `expects`; a phase that ends without them is counted, so post-steps can be decided later with numbers.
- **D6. Jobs get recipes:** tool steps, then at most one AI step that runs only when a condition holds, then a post-step tool. The post-step may ask for another AI round. Code decides when more AI is needed, never the AI. A run has at most 3 AI steps, and each one counts against the job's `dailyTokens`.
- **D7. Each tool declares what it uses** (`uses`: hosts, secrets, commands, collections, files). The broker enforces it per tool, so a bug in one tool reaches only what that tool declared.
- **D8. Each tool declares whether the agent sees it** (`agent: "call" | "none"`, default `"call"`). Tools with effects outside the folder (moving a Jira ticket, commenting on a PR) should be `"none"`: only a button or a declared job runs them. A future "driving modes" setting (eco / hybrid / sport) may override this default (§16).
- **D9. Secrets are a core service.** The plugins' secret store and broker move into the core and serve tools and plugins alike. This reverses the dev harness's 2026-10-20 rule "only agents touch Jira, the app holds no token": the dev harness gets a Jira token through `secrets`.
- **D10. Every identifier is English:** tool ids, action ids, step names, field names, examples.

## 3. Manifest

```ts
tools: {
  "due-today": "./tools/due-today.ts",
  "warmup-cards": "./tools/warmup-cards.ts",
  "jira-sync": "./tools/jira-sync.ts",
  "open-prs": "./tools/open-prs.ts",
  "pr-ci": "./tools/pr-ci.ts",
  "apply-triage": "./tools/apply-triage.ts",
  "apply-evidence": "./tools/apply-evidence.ts",
},

secrets: [
  { id: "jira", label: "Jira API token", help: "Create one at id.atlassian.com → Security → API tokens." },
],

actions: {
  study: {
    label: "Study",
    prompt: "./agent/tasks/study.md",
    tier: "standard",
    pre: [
      { tool: "due-today", as: "today" },
      { tool: "warmup-cards", args: { n: 3 }, input: ["today"], as: "warmup" },
    ],
    preTokens: 4000,                      // cap on the prepared data in the first message; default 4000
    phases: [
      { id: "warmup", label: "Warm-up" },
      { id: "main", label: "Main" },
      { id: "close", label: "Close", brief: "./agent/phases/close.md", expects: ["apply-evidence"] },
    ],
  },
},

jobs: {
  sync: {
    label: "Sync Jira and CI",
    on: { start: true, manual: true, every: "15m" },
    dailyTokens: 50_000,
    maxAi: 3,                              // default 1 when a recipe has an AI step; never above 3
    onLimit: "triage-ci",                  // optional: action offered when the AI cap is reached (§7.3)
    steps: [
      { tool: "jira-sync" },
      { tool: "open-prs", as: "prs" },
      { tool: "pr-ci", forEach: "prs", as: "ci" },
      { ai: "./jobs/classify-ci.md", input: ["ci"], when: { from: "ci", where: { failed: true } },
        output: CiTriage /* a zod schema */, tier: "light", as: "triage" },
      { tool: "apply-triage", input: ["triage"] },
    ],
  },
},
```

### 3.1 A tool file

```ts
// tools/pr-ci.ts
import { defineTool, z } from "@humanharness/cli/tool";

export default defineTool({
  description: "CI status of one pull request: each check with its state and, for failed ones, the last useful log lines.",
  params: z.object({ repo: z.string(), number: z.number().int() }),
  returns: z.object({ repo: z.string(), number: z.number(), failed: z.boolean(),
                      checks: z.array(z.object({ name: z.string(), state: z.string(), log: z.string().optional() })) }),
  agent: "call",
  uses: { exec: [{ cmd: "gh", args: ["pr", "checks", "*"] }, { cmd: "gh", args: ["run", "view", "*"] }] },
  run: async ({ repo, number }, ctx) => { /* … */ },
});
```

| Field | Meaning |
|---|---|
| `description` | Read by the agent (MCP) and shown in the trace. Required. |
| `params` | zod object. Arguments are checked before `run`. |
| `returns` | zod schema of the result. Optional, but required when another step uses it as `forEach` or `input` (§6). |
| `agent` | `"call"` (default): served to the agent through MCP. `"none"`: only the UI and the runner call it. |
| `uses` | What the broker lets this tool reach: `hosts`, `secrets`, `exec`, `data: { read?, write? }`, `files: "read" \| "write"`. Anything else is refused. |
| `run(args, ctx)` | Returns a value that matches `returns`. Throws to fail. |

### 3.2 Build

- Tool ids follow the action-id pattern and do not clash with action, job, block or core MCP tool names.
- The CLI build bundles each tool file for the sandbox (browser target, no Node built-ins), as it bundles plugin backends. It also writes `dist/tools.json`: per tool, its `description`, `agent`, `uses`, and JSON Schema versions of `params` and `returns`. The main process reads `tools.json` and never imports tool code.
- A tool file that imports a Node built-in fails the build with the import's name.

### 3.3 Checks (`loadHarness` / `humanharness check`)

- Every `uses` sits inside the harness's `permissions`. `hosts` needs `web`, `exec` needs `exec`, `files: "write"` needs `edit: "folder"`, `data.write` names collections that exist, and `secrets` names declared secrets.
- `pre` and `steps` name existing tools. `forEach` and `input` name an earlier step's `as` whose tool declares `returns`. For `forEach` the result is an array, and the fields that fill the tool's required params exist in its items.
- A `when` uses the grammar of §7.2 and names an earlier `as`.
- `maxAi` is between 1 and 3, and `onLimit` names an existing action. A job has either `prompt` (an AI job, as today) or `steps`, never both.
- `expects` names existing tools with `agent: "call"`.
- An `agent: "call"` tool has a description of at least 20 characters that is not just its id.

## 4. Runtime

### 4.1 The host

- One hidden sandboxed window per harness runs every tool, with the plugin backend settings (plugins spec §4.1): `sandbox: true`, `nodeIntegration: false`, `contextIsolation: true`, CSP `default-src 'none'; script-src 'self'`, served from `hh-tools://<harness-id>/` with only `dist/tools/`.
- It starts with the app and stays warm. Calls run concurrently.
- A crashed host restarts with backoff. After 5 crashes in an hour, tools are off until the app restarts: the inbox gets an `action` item, and every call fails with "Tools are off after repeated crashes".

### 4.2 The broker (`ctx`)

The plugin broker (`packages/shell/src/main/plugin-broker.ts`) moves into a core service shared by plugins and tools. Each caller gets a `ctx` bound to its own declaration: a plugin's `permissions`, or a tool's `uses`.

| Call | Rule for tools |
|---|---|
| `ctx.fetch(url, init)` | As plugins: only declared `hosts`, `{{secret:<id>}}` substituted for declared `secrets`, substituted values redacted, 30 s, 10 MB. |
| `ctx.exec(cmd, args)` | As plugins: declared patterns only, no shell, 30 s, 10 MB. |
| `ctx.data` | `get`, `query`, `put`, `patch`, `delete` on the harness's collections in `uses.data`. Writes go through the data RPC server with `who: "tool"` and the tool's name (§8.3). Plugin data stays separate. |
| `ctx.files` | `read(path)`, `list(dir, glob?)`, `write(path, text)` inside the person's folder and its reference folders. Writes only with `uses.files: "write"`, never in references, and each write lands in the history. |
| `ctx.scope` | The scope of the calling task or job run, or `null`. |
| `ctx.inputs` | The results named by the step's `input` (§6, §7). |
| `ctx.requestAi(input)` | Only in a job's post-step (§7.3). |
| `ctx.summary(text)` | Sets the job run's summary line (§7.4). |
| `ctx.log(level, message)` | Goes into the trace. |

A refused call throws `ToolRefused` with the reason. The trace records it as "access denied".

### 4.3 The registry

The registry lives in the main process (`packages/shell/src/main/tool-registry.ts`). For each call it:

1. checks the arguments against `params` (JSON Schema from `tools.json`);
2. sends the call to the host with the caller's `ctx` binding;
3. checks the result against `returns`. A mismatch is the tool's error, never half-good data;
4. writes one trace entry (§8.1).

Each call has a 30 s timeout, configurable per tool up to 120 s with `timeout` in the tool file.

## 5. Three callers

- **UI:** `client.tools.call(id, args)` → `{ ok, result } | { ok: false, error }`. It works without an open task, so Home can show "for today" without a session. Calls from the UI trace with `caller: "ui"`.
- **Agent:** a core MCP server `tools` (`packages/blocks/src/tools-server.ts`, built like the `data` server) serves the `agent: "call"` tools. Their MCP names are the tool ids, and their input schemas come from `params`. Calls trace with `caller: "agent"` and the task id. They show in the context panel as `kind: "tool"` entries, as agent tool use does today.
- **Runner:** pre-steps (§6) and job recipes (§7). Calls trace with `caller: "pre"` or `caller: "job"`.

## 6. Pre-steps in actions

1. When the person presses Start, the runner runs the action's `pre` steps in order, before the engine session opens. A resumed task does not run them again.
2. A step is `{ tool, args?, input?, forEach?, as?, required? }`:
   - `input: [names]` passes earlier results to the tool as `ctx.inputs`;
   - `forEach: name` runs the tool once per item of an earlier array result, filling params from the item's fields of the same name (`args` overrides them). The step's result is the array of results, in order;
   - `as` names the result for later steps and for the first message.
3. The results go into the session's first message, under a section `## Prepared data`: one block per `as`, compact JSON, with the tool's description as a one-line header. If they exceed `preTokens`, the runner cuts the largest results first, marks each cut with "(cut: N of M items)", and the trace says so.
4. Each result is a start item in the context panel, with a new kind `"prepared"`, its label and its token estimate.
5. **A failed step** shows unfolded in the trace. The task still starts, and the prepared data says `due-today failed: <message>`, so the agent can call the tool again (if `agent: "call"`) or go on without it. With `required: true`, the task does not start: the start view shows the error and "Retry".

### 6.1 `expects` in phases

When a phase with `expects` ends (`set_phase` moves on, or the task closes), the registry checks the task's trace for a call to each expected tool made in that phase. Each miss is written to `usage.jsonl` as `{ kind: "expects-miss", action, phase, tool, task }` and shows in the trace as "Expected apply-evidence in Close: not called". Nothing else happens. These counts are the data for deciding on post-steps (§16).

## 7. Job recipes

### 7.1 Steps

A job with `steps` runs them in order, as a task of kind `job` (parallel tasks spec §8), with the same triggers, scope, dedupe, caps, inbox and `jobs.jsonl` record.

- **Tool step:** `{ tool, args?, input?, forEach?, as? }`, as in §6.
- **AI step:** `{ ai: briefPath, input: [names], output: zodSchema, when?, tier?, as? }`, at most one per recipe.
  - It is one-shot: a fresh engine session with `edit: none`, `web: none`, no harness MCP servers and no `tools` server. Its first message is the brief, plus the named inputs under `## Data`.
  - It ends by calling the core block `step_output`, whose input schema is `output`. The core takes the block's value as the step's result and ends the session.
  - If the agent ends without a valid `step_output`, the core retries once with the validation error in a new message. A second failure ends the run as `failed`.
  - `tier` defaults to `"light"`.
- **Post-step:** a tool step after the AI step, usually with `input` naming the AI step's `as`.

### 7.2 `when`

`when` is data, not code, so `check` can validate it:

- `{ from: name }`: the result exists and is not empty (array with items, object with keys, non-empty string);
- `{ from: name, where: { field: value, … } }`: the result is an array with at least one item whose fields equal those values.

If `when` is false, the AI step and every step after it are skipped. The run ends `ok`.

### 7.3 Another AI round

A post-step may call `ctx.requestAi(input)` once. When it returns, the runner runs the AI step again with that input in place of the original `input`, then the post-step again with the new result. The cap is the job's `maxAi` (default 1, core cap 3). A request beyond the cap ends the run as `needs-you`, with the summary "Stopped after N AI steps" plus the post-step's last `ctx.summary`. If the job declares `onLimit: actionId`, the inbox item offers that action, as `job_result.action` does today.

### 7.4 The result

Every recipe run ends in the existing `job_result` shape (`ok` / `needs-you` / `failed`, summary, optional action), written by the runner:

- a thrown tool error or a refused access → `failed`, with the step and the message;
- the cap on AI rounds → `needs-you` (§7.3);
- otherwise `ok`, with the last `ctx.summary(text)`, or else a summary built from the trace ("4 steps · 3 tickets changed · CI green").

`dailyTokens` counts only the AI steps' tokens. A run that ran no AI step costs 0 against it. An `every` job with no AI step needs no `dailyTokens`.

## 8. Visibility and measuring

### 8.1 The trace

- One entry per call: `{ at, tool, caller, task?, job?, phase?, args, resultSummary, ms, ok, error?, accesses: [{ kind: "fetch" | "exec" | "data" | "files", target, allowed }] }`.
- Secrets never reach the trace. `args` and results are cut at 2 KB per entry. `resultSummary` is the tool's `summary` hook if it has one (`summary(result) => string`), otherwise a generic one ("12 items", "object with 4 keys").
- Entries are stored per task in `.harness/trace/<task-id>.jsonl` and per job run in `.harness/trace/jobs/<run-id>.jsonl`. Entries older than 30 days are pruned at start.
- `client.tools.trace(taskId | runId)` returns them for harness UIs.

### 8.2 In the app

- **A task's chat:** the pre-steps show as one folded group above the first agent message ("Prepared 2 items · 0.4 s · 0 tokens"). Agent calls show as folded lines in place. Unfolding shows arguments, result and accesses, and errors are always unfolded. These are structured system lines, like the conflict notices of parallel tasks.
- **A job run in the inbox:** the same lines under the run's summary.

### 8.3 History and data

A write through `ctx.data` or `ctx.files` is tracked by the history like any other write. Its commit carries `Tool: <id>`, and the file timeline shows the author as the tool's id. In the data store, `who` gains the value `"tool"` with the tool's id, and `rules` see it in `ctx`.

### 8.4 `usage.jsonl`

- Each pre-step group writes `{ kind: "pre", action, task, steps, ms, preparedTokens }`.
- Each recipe run writes `{ kind: "recipe", job, run, toolSteps, aiSteps, ms }`. Its AI steps write their usual turn rows, tagged with the run.
- `expects-miss` rows (§6.1).

These rows are the baseline for every savings claim. Nothing is promised without them.

## 9. Secrets and connections

- The plugins' secret store (`packages/shell/src/main/plugin-secrets.ts`) moves into a core service. Storage does not change: Electron `safeStorage` in `~/.humanharness/<harness-id>/secrets/`. Harness secrets are stored as `<id>`, plugin secrets as `plugin.<plugin-id>.<id>`.
- **Setup:** a new setup-step kind `connect`, `{ id, kind: "connect", label, secrets: ["jira"], test?: toolId }`, is drawn by the core. It shows each secret's label and help, a paste field and "Test connection". The test runs the named tool once and shows its result or error. The step can be skipped; a tool that needs a missing secret fails with "Jira API token is not set — Settings › Connections".
- **Settings › Connections:** every harness secret with its state (set, missing, last test), and Paste, Replace, Delete and Test. A value is never shown again. Plugin keys stay in each plugin's detail, as today.
- Tools see a secret only as `{{secret:<id>}}` in `ctx.fetch`, and only if `uses.secrets` names it.

## 10. Errors and limits

| Case | Behavior |
|---|---|
| Invalid arguments | The tool does not run. The caller gets the validation error. |
| Result does not match `returns` | The call fails, with the first mismatch. |
| Timeout | The call fails after 30 s (or the tool's `timeout`, up to 120 s). |
| Refused access | `ToolRefused` in the tool, and "access denied" in the trace. |
| Failed pre-step | The task starts with the error in the prepared data, unless `required` is set (§6). |
| Failed job step | The run ends `failed`. Periodic runs keep their schedule; the inbox shows the failure. |
| Missing secret | The call fails with a message naming the secret and Settings › Connections. |
| Host crash | Restart with backoff; after 5 crashes in an hour, tools are off (§4.1). |
| AI step output invalid twice | The run ends `failed` (§7.1). |

## 11. Authoring

- **`humanharness tool test <id>`** runs a tool against `tools/<id>/fixtures/*.json`: args, faked `fetch` and `exec` replies, starting data and files, and the expected result. It reuses the fixture reader of `humanharness plugin test`. Fixtures are part of `check` when they exist.
- **`humanharness tool run <id> --args '{…}'`** runs a tool against the real folder (with the secrets already set) and prints its trace.
- **The `/new-harness` guide** gets a phase between "flow" and "context": *what mechanical work repeats?* It goes moment by moment (key moment → code or AI → impact), proposes tools, pre-steps and job recipes, and records the decisions in `HARNESS.md`.
- **Lessons in the guide.** A section of mistakes already seen, kept current like ñoqui's: English ids; `returns` whenever a step feeds `forEach`; no date or counting logic in prompts when a tool can do it; one tool per mechanical job, not a tool that does everything.
- **The template** gets one example tool with one fixture.

## 12. Mock mode

- `run --record` also records each tool call and each broker access (`fetch`, `exec`) with its reply, in the recording format.
- In `dev --mock`, tools run for real (they are code and cost nothing), but `ctx.fetch` and `ctx.exec` answer from the recording. A harness that talks to Jira can be tried with no network and no token.
- A broker access that is not in the recording fails with "Not recorded: <target>", so tests never reach the network by accident.

## 13. Tests

- **Unit:**
  - build: Node built-ins refused, `tools.json` emitted;
  - checks of §3.3, one test each;
  - registry: argument and result validation, timeout, trace entries, secret redaction;
  - broker: each `uses` rule for tools, plus the existing plugin tests unchanged after the move;
  - runner: order, `input`, `forEach`, `preTokens` cuts, failed and `required` pre-steps, `when` forms, `step_output` retry, `requestAi` up to `maxAi`, the result mapping of §7.4;
  - `expects` misses;
  - the `connect` setup step and Settings › Connections.
- **E2E (fixture harness):**
  - a pre-step whose result shows in the first message and the context panel;
  - a job recipe with a conditional AI step, a post-step and one extra round;
  - a refused access shown unfolded;
  - the folded trace in a chat;
  - a mock-mode run answering from a recording.
- **Demo:** a real tool, `list-sources`, lists the reference repository's files by package with a one-line role from each README. Today the agent explores those by hand. It becomes a pre-step of the demo's topics and gives the first measurement (§8.4).

## 14. Changes to other specs

- **Parallel tasks and jobs (§3, §8):** a job declares `prompt` or `steps`. Recipes follow this spec's §7. Its part 3 (jobs) is built on this spec.
- **Plugins (§4.2, §7):** the broker and the secret store become core services, with no change in plugin behavior. Plugin key ids are namespaced as in §9.
- **Harness setup steps (§2, §3):** a fourth step kind, `connect` (§9).
- **Context panel:** a start-item kind `"prepared"` (§6).
- **Scopes and data:** `who` gains `"tool"` (§8.3).
- **Task phases:** a phase may declare `expects` (§6.1).
- **Discovery (dev):** the Jira rule is reversed: the app holds a Jira token through `secrets` (D9). The discovery doc is updated on its branch.
- **Unchanged:** harness hatches (H2 stays a UI backend), the harness `mcp` servers, blocks.

## 15. Delivery slices

Each slice merges on its own.

1. **Broker and secrets in the core.** Move the broker and the secret store out of plugins with plugin tests unchanged. Add `secrets`, the `connect` setup step and Settings › Connections. Needs plugins on master.
2. **Tools.** `defineTool`, the build and `tools.json`, the host, the registry and trace, the `tools` MCP server, `client.tools`, the folded trace in chats, and the checks.
3. **Pre-steps.** `pre`, `## Prepared data`, the `"prepared"` context item, `expects`, the `usage.jsonl` rows, the demo's `list-sources`, and the first measurement.
4. **Job recipes.** `steps`, `when`, `step_output`, post-steps and `requestAi`, and the result mapping. Built as part 3 of parallel tasks and jobs, so jobs are never built as "always AI" only.
5. **Authoring and mock mode.** `tool test`, `tool run`, the guide phase and its lessons, the template tool, and recorded broker accesses.

Coordination: the line-B session must not plan part 3 of parallel tasks and jobs before this spec is approved.

## 16. Out of scope

- **Tools learned from use (JIT):** detecting repeated call sequences in the trace, a prepared task that writes the tool, testing it against recordings in the sandbox, and plain-language approval. A later spec, after slices 1–3 are built and measured.
- **Driving modes** (eco / hybrid / sport): one setting that trades token spend for AI power across tiers, recipes, the tools the agent may call (overriding `agent`) and job frequency. Its own spec; it is in the queue.
- **Post-steps in actions:** decided when `expects-miss` counts are in.
- **Several AI steps in a recipe, merging AI steps, pipelines across sessions:** only when a real case needs them.
- **The agent calling tools with effects outside the folder after asking the person:** an extension of D8, noted for later.
- **Full Node in a tool** (`node: true`): only when a case cannot be done through `ctx`.

## 17. Open questions

- The host's memory with several tools warm. Measure in slice 2. If it costs too much, start the host on first call and close it after idle time.
- Whether `files: "write"` is needed in slice 2, or can wait for a first harness that writes files from a tool.
