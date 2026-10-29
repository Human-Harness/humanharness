# Harness tools

Spec: `docs/superpowers/specs/2026-10-28-tools-and-recipes-design.md` ("§" below), §1–§5, §8.1–§8.3, §9, §10, §17. Plan: `docs/superpowers/plans/2026-10-29-tools-slice2-tools.md` (slice 2; "Decision N" and the threat rows "T1"–"T9" below). The broker and the key store under it are slice 1's (`docs/architecture/secrets.md`).

## What it is

- A harness may declare **tools**: small typed functions in its own folder, written with `defineTool`. A tool does one deterministic thing (read the CI state of a PR, count the notes of a scope) so the agent passes its judgment as arguments and code applies the rule, at 0 tokens (§1).
- A tool reaches the world **only through `ctx`** (D2): no `fs`, no `child_process`, no network of its own. It may import pure libraries that bundle for a browser.
- Tools run in **one hidden sandboxed window per harness** (D3), the plugins' backend settings, and every call goes through a **registry in main** that checks the arguments and the result and writes a **trace** entry (D4).
- **Each tool declares what it uses** (`uses`: hosts, secrets, commands, collections, files) and its broker grant is built from it (D7). But see "One window, one realm" below: the security boundary is the harness, not the tool.
- **Each tool says whether the agent sees it** (`agent: "call" | "none"`, default `"call"`, D8). `"none"` tools run only from the harness UI (and, from slice 4, job recipes).
- **Three callers** (§5): the harness UI (`client.tools.call`), the agent (the core MCP server `tools`), and in later slices the runner (pre-steps, job recipes).
- A harness without `tools` is today's app, byte for byte (D0, below).

Not in slice 2: pre-steps and `"prepared"` context items, phase `expects`, usage rows (slice 3); job recipes, `when`, `ctx.inputs`, `ctx.requestAi`, `ctx.summary` (slice 4); `tool test` / `tool run`, the guide, a template tool and mock-mode transports (slice 5).

## The manifest and a tool file

```ts
// harness.config.ts
tools: {
  "count-notes": "./tools/count-notes.ts",
  "pr-ci": "./tools/pr-ci.ts",
},
```

`tools` (`toolsSchema`, `packages/harness-sdk/src/tools.ts`) maps a tool id to a `./` path of a `.ts`, `.mts`, `.js` or `.mjs` file. At most 50 (`TOOLS_MAX`). An id follows the action id pattern `^[a-z][a-z0-9_-]{0,63}$` (`TOOL_ID`, Decision 1) and can't be an action id, a job id, a block tool name (the harness's, the core's, the review tools, `job_result`) or a core MCP server name (`CORE_SERVER_NAMES`: `ui`, `data`, `translate`, `review`, `material`, `tools`): "Tool id "<id>" clashes with an action id" (… "with a job id", "with a block tool name"), "\"<id>\" is a core MCP server name: use another tool id". `loadHarness` resolves each file with `resolveInHarness` (a path out of the folder is refused). A harness that declares tools can't have the id `tools` with its own `mcp` servers (they are named after the id and would shadow the core `tools` server): "\"tools\" is a built-in MCP server name and the harness's MCP servers are named after its id: use another id"; `material` likewise for a harness with `material`. `hasTools(h)` is the D0 switch.

A tool file default-exports `defineTool` from `@humanharness/cli/tool` (or `@humanharness/harness-sdk/tool`; both re-export `z`). That module has no Node import, so it bundles for the sandbox.

```ts
import { defineTool, z } from "@humanharness/cli/tool";

export default defineTool({
  description: "Counts the notes of the open scope that mention a word",
  params: z.object({ word: z.string().min(1) }),
  returns: z.object({ count: z.number() }),
  agent: "call",
  uses: { files: "read" },
  timeout: 10,
  summary: (r) => `${r.count} notes`,
  async run({ word }, ctx) {
    const paths = await ctx.files.list("notes", "**/*.md");
    let count = 0;
    for (const p of paths) if ((await ctx.files.read(p)).includes(word)) count++;
    return { count };
  },
});
```

- `description` (required), `params` (a `z.object`), `returns?` (absent: the result is unchecked), `agent?` (default `"call"`), `uses?` (default `{}`), `timeout?` (whole seconds 1–120, default 30; Decision 12; `defineTool` throws otherwise), `summary?(result)` (one line for the trace), `run(args, ctx)`.
- `uses` (`ToolUses`): `hosts` (host patterns as a plugin's `permissions.hosts`; needs `permissions.web`), `secrets` (ids of the harness's `secrets`), `exec` (`{ cmd, args }` patterns as a plugin's; needs `permissions.exec`), `data: { read?, write? }` (collections), `files: "read"`. `files: "write"` is refused by the checks in slice 2 (Decision 5, §17).
- A refused `ctx` call throws an `Error` named `ToolRefused` (`ToolRefusedError`, Decision 18) with the reason.

## Build and `tools.json`

`humanharness build [--harness <dir>]` (`packages/cli/src/build.ts`, `tool-build.ts`; Decision 2) bundles each tool file twice with the esbuild tsx carries (as `plugin build` does; `toolchain`, `common`, `bundleError`, `writeDist` are exported from `plugin-build.ts`):

- **For the sandbox**: `platform: "browser"`, ESM, `chrome130`, one file `dist/tools/<id>.js` with zod bundled in (about 530 KB a tool). Any Node built-in (`node:*` or a `module.builtinModules` name) fails the build: "tools/x.ts:1: imports node:fs, which a tool can't use: tools reach the world only through ctx" (T1).
- **For Node**, into a temp `.mjs` that is removed after: its default export goes through `toolMeta(id, def)`, which writes the entry with the bundle's own zod. `params` is `z.toJSONSchema` with `io: "input"`, `returns` the output form, both tidied and checked against the plugins' JSON Schema allowlist (Decision 4); a refusal names the tool and the deepest path: "count-notes: params.properties.x: \"pattern\" is not supported in plugin schemas".

`dist/tools.json` (`toolsJsonSchema`): `{ version: 1, tools: { <id>: { description, agent, uses, params, returns?, timeout, file: "tools/<id>.js" } } }`, ids sorted, two-space indented. The schema caps the record at 50 tools and every `uses` value at the manifest's limits (hosts 20 × 260 characters, secret ids 10 × 40, commands 10 × 64 with 20 tokens × 200, collections 50 × 40 per list), so a huge value never reaches a message. Every tool is tried; any failure (`ToolBuildError`, one problem per tool) writes nothing. On success `dist/tools.json` is written to a temp file first, then `dist/tools/` is swapped in (temp folder and rename), then the temp file is renamed over `dist/tools.json`, so a failed write never pairs new bundles with an old `tools.json`; the rest of `dist/` stays. A harness without tools: "This harness declares no tools.", nothing written.

- **`dev`** builds (writes) before opening the app when the harness declares tools; a build error prints it and exits 1.
- **`check`** builds in memory and never writes: each failing tool is a `tool-build` error; when the build passes, each `toolProblems` line is a `tool-uses` error (file: the tool's path).
- **The e2e fixture's `dist/` is committed** (the e2e can't build); `packages/cli/test/fixture-dist.test.ts` rebuilds it in memory and compares (Decision 16).

## Checks

`toolProblems(manifest, toolsJson)` (`tools.ts`, §3.3) gives `{ tool, message }` lines that start with the id. `check` reports them; the app turns tools off on the first one.

- "uses.hosts needs permissions.web"; `uses.hosts: "<h>" is not a host pattern`; `uses.hosts: "<h>" is not a public host name` (localhost, a name under it, or an IP literal: a last label that is a number, as "127.1" or "0x7f.1"); "uses.exec needs permissions.exec"; `uses.exec: "<cmd>" is not a bare command name` (and the plugins' other pattern issues); "uses.files: write comes in a later slice; use read"; `uses.data.read|write: "<c>" is not a collection`; `uses.secrets: "<s>" is not declared in secrets`.
- An `agent: "call"` tool's description, trimmed, must be at least 20 characters (`TOOL_DESCRIPTION_MIN`) and not just its id: the agent picks tools by it.
- The manifest and `tools.json` list the same ids: "not built (run humanharness build)", "not a tool of this harness (run humanharness build)". An entry's `file` must be `tools/<id>.js`, so one id never runs another tool's bundle under its grant.
- A connect step's `test` must name a tool of the harness (`defineHarness`: "\"<id>\" is not a tool of this harness") with no required params ("a connect step's test tool can't have required params").

## The host

`ToolHost` (`packages/shell/src/main/tools/tool-host.ts`) is the only module that touches Electron for tools; what it decides is in `tool-protocol.ts` (pure). It copies the plugin backend host's settings (`docs/architecture/plugins.md`, "The backend window") but is a class, scheme, session and channel of its own.

- **One hidden window per harness** (`show: false`, `skipTaskbar`): `sandbox`, `contextIsolation`, `nodeIntegration`, `nodeIntegrationInSubFrames`, `nodeIntegrationInWorker` and `webviewTag` false, `webSecurity`, `disableDialogs`, `navigateOnDragDrop: false`, devtools only in development. The preload (`resources/tool-preload.cjs`) exposes only `window.hh.rpc`.
- **Its own in-memory session** `hh-tools-<harness-id>`: the scheme handler, a request filter that cancels every URL but this harness's own `hh-tools:` files (`allowToolRequest`), permissions and devices denied, downloads cancelled. Navigation, frame navigation, redirects, webviews and new windows are prevented.
- **The `hh-tools:` scheme** (`TOOL_SCHEME`, `standard` and `secure` only) is registered before ready, only under `hasTools` (with plugins, in the same call as `hh-plugin:`). `hh-tools://<harness-id>/` serves only `_hh/host.html` and `_hh/host.js` (`resources/tool-host.html`, `tool-host.mjs`) and `tools/<TOOL_ID>.js` from `<root>/dist/tools/` (`resolveToolFile`, `readToolFile`): never `tools.json`, a harness's own `dist/_hh/` or a nested path; no link (the `tools/` folder itself included), no hard link, at most 10 MB (`TOOL_FILE_MAX_BYTES`); checked on every request. Every response carries the plugins' CSP (`TOOL_CSP` = `PLUGIN_CSP`), `nosniff` and `no-store`. The harness id is the URL's host: an id over 63 characters can't be served, and tools are off ("Tools are off: Not a harness id the tool host can serve").
- **The page** `hh-tools://<id>/_hh/host.html?tools=a,b` imports each built tool (`runHost` in `tool-host.mjs`), reports `ready` with the tools and their load errors, then loops on `next`. Each command is `{ kind: "call", callId, tool, args, scope }`; the script builds a frozen `ctx` whose calls carry the call id, runs `run`, calls `summary` (a throwing one is dropped; the text is cut at 16,000 for main to hide keys in first) and answers `done`. A result the preload can't serialize answers "The result can't be sent: …".
- **The channel** `hh-tools:rpc` (`TOOL_RPC_CHANNEL`; the one `ipc-surface.test.ts` entry Decision 15 allows) answers only the host window's main frame at exactly its host page (`toolOfSender`, `isToolFrame`; T2). `parseToolRpc` refuses a payload over 12 MB (`TOOL_RPC_MAX_BYTES`) or deeper than 40 (`TOOL_RPC_MAX_DEPTH`) unread. At most 32 tool calls waiting or running (`TOOL_CALLS_IN_FLIGHT`, beyond it "Too many tool calls at once") and 64 rpc calls unanswered (`TOOL_RPC_IN_FLIGHT`). An idle `next` answers after 25 s.
- **Call ids**: main makes each call's id (the broker run id) and hands it to the page. A `ctx` call acts for the tool main handed that id to, and only while that call runs in the current page; anything else is "Unknown tool call". A `done` for a call not yet handed out is ignored.
- **Crashes** (Decision 7): `render-process-gone`, `unresponsive` and a failed load count. The calls the dead page held fail with "The tools host stopped (<reason>)"; queued ones wait for the next page. Restart after 1 s, doubling while each crash comes within an hour of the previous, at most 30 s (`TOOL_CRASHES`). The 5th crash within a rolling hour turns tools off until the app restarts: every call answers "Tools are off after repeated crashes" (`TOOLS_OFF`), `AppState.tools.off` says so, and the chat's top shows "Tools are off after repeated crashes. Restart the app to turn them on." (`tools.off`).
- A call's own timeout ("<tool> took longer than <s> s") does not restart the host. Other answers: `No tool "<id>" is built`, "<tool> did not load: <Name: msg>" (logged once), "Tools stopped" after stop.
- **Warm**: the host starts with the app (when tools are declared and built) and stays up (§4.1). Memory: below.
- **Its files** (`resources/tool-host.html`, `tool-host.mjs`, `tool-preload.cjs`, `TOOL_HOST_FILES`) are found through `shellResourcesDir` (`packages/shell/src/main/shell-resources.ts`), never relative to the built main (a build into `HH_OUT_DIR` puts main elsewhere): in a development build, the absolute `packages/shell/resources` the build wrote in as `__SHELL_RESOURCES__` (`electron.vite.config.ts`); in a packaged app, `process.resourcesPath`, where plan 4b's packager must put these three files. The plugin backend host and the dev Dock icon use the same resolver. `start` checks the three files first and throws "the tool host's files are missing" (`TOOL_HOST_FILES_MISSING`, the missing paths logged): tools are off with "Tools are off: the tool host's files are missing", never a silent timeout per call.

## The broker per tool

`ToolBroker` (`tools/tool-broker.ts`, §4.2, D7) wraps one core `Broker` per tool; its `BrokerGrant` comes from the tool's `uses` and nothing else. Each call is one run (`startCall(scope)` → `{ id }`, `endCall(id)` → `{ accesses }`); the host's `ctx` calls name that run id, which main made.

| Call | Rule for tools (slice 2) |
|---|---|
| `ctx.fetch(url, init)` | Only `uses.hosts`, on every hop; `{{secret:<id>}}` in headers or body filled only for `uses.secrets` (ids deduped, capped at 10), the store read at every fetch. `localhost`, `*.localhost` and IP literals are refused before the resolver ("<host> is not a public host name"); every hop's name must resolve to public addresses (`allowHost` = `isPublicHost`, wired in `index.ts`: "<host> resolves to a private address"). A redirect to an undeclared host: "Refused a redirect to an undeclared host". 30 s, 10 MB, as plugins. |
| `ctx.exec(cmd, args)` | Only `uses.exec` patterns; bare name through the login `PATH`, no shell; env only `PATH`, `HOME`, `LANG` and `TERM=dumb` (`toolExecEnv`); cwd an empty `<userData>/tool-exec/<harness-id>/` (0700); 30 s, 10 MB (Decision 6). |
| `ctx.data.get/query/put/patch/delete` | Reads `uses.data.read` ∪ `write`, writes `uses.data.write`. Through the person-side data path as the tool (`toolDataRequests`: `who: "tool"`, `tool: <id>`) in the call's scope, in the one write queue the person's writes use (`dataWriteQueue`). Never `settings` writes ("A tool can't change settings"), never the Sidekick store; an unknown or archived scope is "Unknown scope". A tool may read `agent: "none"` collections: its grant is the only limit. |
| `ctx.files.read(path)`, `list(dir, glob?)` | Only with `uses.files`. The base folder, and `refs/<id>/…` for a reference folder (`toolFiles`, `tool-files.ts`): `lstat` at every level, no link or hard link (skipped in lists, refused in reads), `.harness` and `.git` refused or skipped at any depth in any case, ≤ 1 MB a read, ≤ 1000 entries a list (sorted, in the form `read` takes); `*` stays within a segment and `**` spans them. An fs error never shows the disk path. |
| `ctx.scope` | The calling task's or job run's scope, or null. |
| `ctx.log(level, message)` | To main's log with the tool's id and the level, keys hidden then cut (as plugins). Not in the trace: see "Known gaps". |

Refusals (each an answer the host script throws as `ToolRefused`): "<host> is not declared in uses.hosts", `The key "<id>" is not declared in uses.secrets`, "<line> is not declared in uses.exec", "The collection is not declared in uses.data (<call>)", "This tool doesn't declare uses.files", "This tool call has ended". A missing key fails with `missingSecretMessage(label)`: "<label> is not set — Settings › Connections".

**Accesses**: each fetch hop, command, data op ("<op> <collection>", allowed only when the data path answered) and files call reached, and each grant refusal, as `{ kind: "fetch" | "exec" | "data" | "files", target, allowed }`. A target is one line, at most 200 code points, never a header, a body or a key: every key this tool's fetches were filled with is hidden in it first (a redirect's `Location` may echo one). At most 200 accesses a call.

## One window, one realm

All of a harness's tools load in the same page, so they share one JavaScript realm and one `hh.rpc`. A tool can import another tool's bundle, patch shared prototypes, take another tool's queued call or use its call id for `ctx` calls. So the **effective reach of any tool is the union of its harness's tools' `uses`**.

This is a decision (Task 6 review, per D3 "one host for every tool"), and a deviation from the wording of spec §2 D7 ("a bug in one tool reaches only what that tool declared"), §4.1 and threat row T3 ("each tool reaches only its `uses`"): the per-tool grant holds against a **mistake** in a tool, not against a **hostile** tool of the same harness. The tools share an author, a folder and a build. The security boundary is the harness: its tools, together, never reach more than their declared `uses`, and those stay inside the harness's `permissions`. Per-tool `uses` keeps catching mistakes and keeps each trace entry honest about what that call touched. Any screen that shows a harness's reach (a future consent screen) shows the union, never one tool's. The hardening, one window per tool (up to 50 renderers), is open for Marco.

## The registry

`ToolRegistry` (`tools/tool-registry.ts`, §4.3) runs every call, from any caller (`ToolCall`: `tool`, `args`, `caller`, `scope`, `task?`, `job?`, `run?`, `phase?`):

1. Tools off (`tools.json` missing, invalid or with a problem; see "Reading tools.json") → its reason. The host off after crashes → `TOOLS_OFF`. An unknown id, or an `agent: "none"` tool from the agent caller → `Unknown tool "<id>"` ("Unknown tool" when the id isn't id-shaped). **These calls never reach a tool and are not traced**; every later failure is.
2. `args` (undefined is `{}`) against `params` through `jsonSchemaToZod` (cached per schema): the first issue as "path: message", and the tool does not run. The host gets the **parsed** value: a key `params` doesn't name never reaches `run`.
3. The host runs it under a fresh run of the tool's broker, with the tool's timeout (30 s default, up to 120 s) raced against the registry's own timer: "<tool> took longer than <s> s". `endCall` always runs; a broker or host throw answers "Something went wrong running the tool" (logged).
4. The result against `returns`: "The result doesn't match returns: <path: message>". A key `returns` doesn't name fails too: never half-good data (T5).
5. One trace entry, then `called(entry)` (the chat line). A trace that can't be written is logged and never fails the call.

**Secrets** (T4): the tool's stored values (`secretValues(tool)`, its `uses.secrets` read from the store) are hidden with `hideSecrets` in the answer's error and result (every string and key, deep), the summary, the trace's args and result, and the access targets again. **Hide, then cut, everywhere**: a text is hidden first and cut after, so a key across a cut never leaves its start behind. An error is cut to 4096 code points ("The tool failed; its error can't be shown" when hiding empties it), a summary to 200, a trace value at 2 KB (at most 64 KB of it looked at), an access target at 200, and a "Test connection" message at 300 (`connections.ts`). A text that arrived at the host's 16,000 cap also loses its last `6 × bytes + 16` units, the longest form a key can take.

**`resultSummary`**: the tool's `summary` (hidden, ≤ 200), else a generic one (`genericSummary`): "12 items", "1 item", "object with 4 keys", "text, 40 characters", a number or boolean as text, "nothing"; "failed" on an error.

## Reading `tools.json`

`readToolsJson(root, manifest, log)` (`tools/tools-json.ts`, Decision 3) reads `<harness root>/dist/tools.json` once at start: through `readNoLinks` (no link, not hard-linked), ≤ 1 MB, valid JSON of `toolsJsonSchema`, at most 50 tools. Any failure: tools off with "Tools are not built: run humanharness build" (`NOT_BUILT`) and the why logged once ("Tools are off: …", one line). A `toolProblems` line turns tools off with that line as the reason. There is no staleness check against the sources (Known gaps).

## The trace

`ToolTrace` (`tools/tool-trace.ts`, §8.1, Decision 8): one JSON line per call.

| Caller | File |
|---|---|
| A task's call | `.harness/trace/<task-id>.jsonl` |
| A job run's call (whatever the job runs) | `.harness/trace/jobs/<run-id>.jsonl` |
| A UI call with no task | `.harness/trace/ui/<YYYY-MM-DD>.jsonl` (the entry's UTC day) |

- **Entry** (`TraceEntry`): `{ at, tool, caller, task?, job?, run?, phase?, args, result?, resultSummary, ms, ok, error?, accesses }`. `caller` is `"ui" | "agent" | "pre" | "job"` (`ToolCaller`; slice 2 makes `ui` and `agent`). `args` and `result` are the value, or `{ cut: true, text }` past 2 KB (`TRACE_CUT`), keys hidden before the cut.
- **Files**: the id must pass `isTaskId` ("Not a task or run id"), never a path from a caller. Folders below the base walked with `lstat`; files opened `O_APPEND | O_NOFOLLOW`, 0600, not hard-linked. A torn last line gets a newline before the next entry. A file stops at 16 MB (`TRACE_FILE_MAX_BYTES`): later entries are dropped, logged once. `read(id)` reads the task file, then the jobs file, skipping lines that don't parse.
- **Prune** (`prune()`): each base once per run, before its trace is first used: the base current at start, and one reached later by a profile or folder switch. Files untouched for 30 days (`TRACE_DAYS`) removed, older lines dropped; never throws, creates nothing, skips (and logs) a linked folder.
- Nothing is created until a call is traced. The history never tracks `.harness/trace/` (it is under `.harness/`, not in the keep list).

## The three callers

`createToolsHost` (`tools/tools-host.ts`) is built in `index.ts` only under `hasTools(harness)`. `start()` (once, memoised, after the window is created) reads `tools.json`, starts the host (its throw turns tools off with "Tools are off: <message>"), writes the catalogue, prunes the current base's trace and tells the window (`hh:toolsChange`).

- **The agent** (`caller: "agent"`), through the `tools` MCP server. The caller comes from the asking slot, never the request: a task slot gives `task`, its `scope` and its `phase` (`slotTask`: board mode, the lane's task manager; otherwise the open task; `slotTaskOf` drops a trailer of another task); a job slot gives `job` and `run` (`jobs-host.ts` `runOf`), whatever the job runs. No task or run: "No task is running in this session". A malformed request: "Invalid request". The agent reads only the registry's answers (its own texts, or the tool's error with keys hidden) or "Something went wrong running the tool": never a path, stack or key (T4).
- **The harness UI** (`caller: "ui"`): `hh:toolsCall` runs in the scope main has open (or none), with no task (Decision 14), and works before a task opens. The page names a tool and its arguments, never a caller, task or scope (T9).
- **The runner** (`"pre"`, `"job"`): slices 3 and 4.

**Data writes** (§8.3): a tool's write is committed as the person's are ("Data: <collection>"), with the calling task's trailer plus `Tool: <id>` (a job run's: the run's trailer, `jobRunTrailer`); a UI call's with `Tool: <id>` alone. The trailer follows each call through `AsyncLocalStorage`, kept per broker run id, so two calls at once each commit under their own.

## The `tools` server

`createToolsServer(catalogue, rpc)` (`packages/blocks/src/tools-server.ts`, bin `tools-server-bin.ts` with `HH_TOOLS`, `HH_RPC`, `HH_RPC_TOKEN`; `toolsServerSpec` in `launch.ts`, built as `out/main/tools-server.js`) serves the `agent: "call"` tools under their ids, with `params` as the input schema (§5, T7).

- **The catalogue**: `<userData>/tools-catalogue/<harness-id>.json` (0600, temp and rename), written at start: a JSON list of `{ name, description, inputSchema }` for `agent: "call"` tools only. Tools off or none for the agent: no file (one an earlier start left is removed) and no server. The server reads it with caps (≤ 512 KB, ≤ 50 tools, each entry exactly those three keys, a tool id, a description of 1–1000 characters, an object schema): a broken file gives no tools ("The tools catalogue was ignored: …"), a bad entry is dropped.
- **A call**: an unknown name is an error that never reaches the app (`No tool "<name>"`). Otherwise `{ tool, args }` (args default `{}`) over the slot's rpc, 180 s timeout (`TOOLS_CALL_TIMEOUT_MS`, longer than any tool's 120 s; then "The app did not answer in time; the tool may still have run."). Success: the result as JSON text. A refusal: the app's message as is.
- **Which sessions** (Decision 9): every engine session that runs with the harness's own servers, task slots and job slots alike (a `prompt` job's agent may call `agent: "call"` tools); never Sidekick, translate, review-only or system sessions. `createWorkspace` adds it right after `data`, only when the harness has tools and a catalogue (`RuntimeOptions.tools`), and Claude's `--allowedTools` gains `mcp__tools`.
- **The context panel** shows the agent's calls as `kind: "tool"` reads labelled `tools · <id>` (the server's name, Decision 17; `docs/architecture/context.md`).

## `client.tools`

`ToolsClient` (`packages/ui/src/client.ts`; preload; `registerToolsIpc` in `tools/tools-ipc.ts` through `index.ts`'s `handle()`, so only the app's page):

| Channel | Sends | Answers |
|---|---|---|
| `hh:toolsCall` | `id`, `args` | `{ ok: true, result }` or `{ ok: false, error }`; a bad id or args that aren't JSON or are over 1 MB (`TOOLS_IPC_ARGS_MAX_BYTES`): "Invalid request"; a throw: "Something went wrong running the tool" |
| `hh:toolsTrace` | a task id or a job run id (`isTaskId`) | `ToolCallView[]`, oldest first; anything else `[]` |
| `hh:toolsChange` (push, `TOOLS_CHANGE_CHANNEL`) | — | `ToolsInfo` `{ ids, off? }`, after start and when the host goes off |

`AppState.tools` (`ToolsInfo`) is there only for a harness with tools: its ids, and `off` (why every call fails: not built, a problem, or crashes). Without, `client.tools` exists but every call rejects.

## The chat line

A call with a `task` emits a runtime event `{ type: "tool-call", call: ToolCallView }` (`packages/runtime/src/events.ts`) to that task's chat. `ToolCallView`: `{ tool, caller, ok, ms, summary, error?, args, result?, accesses, at }`, args and result as text cut at 2 KB.

- During the task's turn it is saved on the reply (`TurnRecorder`, `TurnController.addToTurn`): `ChatEntry.tools` on the assistant entry, there after a reload. A call outside any turn is shown, not saved. Board mode routes it to the task's lane.
- `ToolCallLine` (`packages/ui/src/tools/ToolCallLine.tsx`, Decision 10, §8.2): a folded button "<tool id> · <resultSummary> · <seconds> s · 0 tokens" ("pr-ci · 12 items · 0.3 s · 0 tokens"), seconds with one decimal, that unfolds to Arguments, Result and Accesses (a refused one ends " · access denied"). A failed call reads "<tool id> failed · <message>" and starts unfolded. The lines sit above the assistant entry's message. A tool-only entry is never "the reply" (`isToolLine`): choices and Try again stay on the real last reply. A saved entry's `tools` is read unchecked from the chat log, so `cleanToolCalls` drops malformed items.
- Strings: the `tools` block of `en.json` (`line`, `failed`, `accessDenied`, `args`, `result`, `accesses`, `off`).
- **Tools off after crashes**: when `state.tools.off` is exactly `TOOLS_OFF_CRASHES`, the chat's top shows `tools.off` in a `role="status"` line (not for "not built" or a problem).

## "Test connection"

A connect step may name `test: <toolId>` (slice 1 Decision 4, here Decision 13; `docs/architecture/secrets.md`). The setup step and Settings › Connections then show "Test connection" for each key that step lists. Main runs the tool with `{}` as `caller: "ui"` and no scope, shows "Works" or "Didn't work: <message>", and keeps `{ at, ok, message? }` per key in `~/.humanharness/<harness-id>/connections.json` (no value; 0600, temp and rename, ≤ 64 KB, no link). The message has every stored key hidden again, then is cut to 300 code points. Replacing or deleting a key forgets its last test; a test whose key changed while it ran keeps nothing ("The key changed during the test: test again"). `hh:connectionsTest` is registered only when some step names a test.

## Memory

Spec §17 asks what the warm host costs. Measured 2026-10-29 on macOS (Apple silicon), a development build of the e2e fixture `toolbox` (5 tools, each bundle about 530 KB with zod inside) with fake engines, in a throwaway Playwright script. Main can't call `process.getProcessMemoryInfo()` for another process, so the number is `app.getAppMetrics()`'s working set for the tool window's renderer (matched by `webContents.getOSProcessId()`):

| When | Tool window (working set) |
|---|---|
| After start, idle 5 s, no call yet | 143,904 KB (about 141 MB) |
| After 20 UI calls (`count-notes` and `probe`, all ok), idle 3 s | 145,600 KB (about 142 MB) |

For scale, the app's own page renderer was about 148 MB at the same moments. 20 calls add under 2 MB: the cost is the warm renderer itself, about one more app window. The default stays warm (Decision 7); a host that starts on first call and closes after idle time (§17's fallback) is the option if this proves too much on small machines.

## D0

A harness without `tools` runs no slice-2 code: `defineHarness` gives no `tools` key; `check` and `dev` don't build and write no `dist/`; no `hh-tools` scheme, window, `hh-tools:rpc` handler, `hh:tools*` channel, `AppState.tools` or `.harness/trace/`; a slot's MCP list, Claude's `--mcp-config` and `--allowedTools`, `CODEX_CONFIG` and `session/new` unchanged; no `tool-call` event and no `ChatEntry.tools`; data `who` and commit messages as before. A harness with tools but no `agent: "call"` tool gets no `tools` server.

| D0 item | Pinned by |
|---|---|
| Manifest | `packages/harness-sdk/test/tools.test.ts` "D0: no tools key without it" |
| CLI | `packages/cli/test/tool-build.test.ts` "D0: check and dev write nothing for a harness without tools" |
| Slot servers | `packages/runtime/test/workspace-tools.test.ts` "D0: no tools, the slot's MCP list is unchanged", "D0: a tools option for a harness without tools adds no server", "tools without agent: call add no server"; `packages/shell/test/tools/tools-host.test.ts` "no agent: call tool, or tools not built: no tools server and no catalogue" |
| Claude argv / ACP | `packages/runtime/test/claude-cli.test.ts` goldens, `hatches-d0.test.ts`, `runtime-d0.test.ts`: byte-identical |
| Main surface | `packages/shell/test/tools-surface.test.ts` "D0: tools channels, scheme and host exist only under hasTools"; `packages/shell/test/tools/tool-host.test.ts` "D0: building the host registers nothing — …" |
| IPC scan | `packages/shell/test/ipc-surface.test.ts`: exactly one new entry, `tool-host.ts:"hh-tools:rpc"` (Decision 15) |
| Data and history | `packages/workspace/test/data-tool.test.ts` "D0: who stays agent/person/app without a tool"; `history-trailers.test.ts` "D0: withTrailer without tool writes what it wrote" |
| Chat | `packages/ui/test/tool-call-ui.test.tsx` "D0: an entry without tools renders as before" |
| Connections | `packages/shell/test/secrets/connections.test.ts` "D0: without a test tool there is no Test and no connections.json"; `connections-ipc.test.ts` "D0: registered only when a connect step names a test" |
| E2E and hatches | `packages/e2e/tests/history.spec.ts` and `packages/shell/test/hatches-surface.test.ts`: byte-identical |

## Threat model

Tool code is the harness author's, but it handles outside data and runs beside the person's folder.

| # | Boundary | What enforces it | Test |
|---|---|---|---|
| T1 | No Node in tool code | `sandbox`, `contextIsolation`, no Node in frames or workers, own session, the request filter, the CSP; the build refuses Node built-ins | `packages/cli/test/tool-build.test.ts` "a Node built-in fails the build naming it"; `packages/e2e/tests/tool-host.spec.ts` (a hostile probe tool: `require`, `process`, `import()` of other URLs, `eval`, fetch, XHR, sockets, workers, frames, navigation all blocked); the fixture's `probe` tool in `tools.spec.ts` |
| T2 | Identity from the sender, never the call | `toolOfSender`/`isToolFrame`: the one host window's main frame at its host page; a `ctx` call's tool is its call id's, made by main | `tool-protocol.test.ts` "a frame at another URL or another window is not the host"; `tool-host.test.ts` T2 tests |
| T3 | Only declared reach (D7) | one `BrokerGrant` per tool from `uses`; anything else is `ToolRefused`. **Per harness, not per tool**: tools share one realm, so the boundary is the union of the harness's `uses` ("One window, one realm") | `tool-broker.test.ts`, one test per `uses` row |
| T4 | Secrets never reach a tool or a trace | only `{{secret:<id>}}` in a declared fetch; values hidden in errors, results, summaries, trace values and access targets, before every cut | `tool-registry.test.ts` "a secret echoed back is redacted in the trace and the result's error", the cut tests; `tool-broker.test.ts` "a key a redirect echoes in its Location never reaches the accesses" |
| T5 | Bad data never half-passes | params checked before `run`, the parsed value passed; the result checked against `returns`, extra keys refused | `tool-registry.test.ts` |
| T6 | Main stays up | rpc ≤ 12 MB and depth ≤ 40 refused unread; ≤ 32 calls and ≤ 64 rpc in flight; per-call timeout; crash backoff; 5 crashes an hour → off | `tool-protocol.test.ts`, `tool-host.test.ts` |
| T7 | `agent: "none"` tools never reach the agent | the catalogue lists only `agent: "call"`; the registry refuses an `agent: "none"` id from the agent | `packages/blocks/test/tools-server.test.ts`, `tools-host.test.ts` "the agent can't call an agent: none tool (T7)" |
| T8 | Files stay in the folder and its references | `toolFiles`: lstat every level, no links, no `.harness`/`.git`, ≤ 1 MB, ≤ 1000 entries | `tool-files.test.ts` |
| T9 | The renderer can't forge a caller | `hh:toolsCall` always runs as `ui` in main's open scope with no task | `tools-ipc.test.ts` |

Also: **no private network** (every fetch hop, `isPublicHost` plus the localhost/IP guard: `tool-broker.test.ts` "fetch: localhost, IP literals and hosts that resolve to a private address are refused, on every hop").

## Decisions

The plan's Decisions 1–18 hold as written, with these notes:

- **Decision 7**: the Attention `action` item ("Tools are off after repeated crashes. Restart the app to turn them on.") for an app with an Attention store is **not done**: every app shows the chat's top line instead. Open for Marco.
- **Decision 11**: job inbox lines wait for slice 4; slice 2 writes each run's trace and `client.tools.trace(runId)` returns it.
- **Shared realm** (Task 6 review): "One window, one realm" above.

## Known gaps

- **No staleness check**: the app runs whatever `dist/` holds; `dev` rebuilds, but a tool file edited after a build isn't noticed until the next one.
- **No packaging of `dist/`** into a shipped app: plan 4b.
- **Packaging the host's files**: a packaged app looks for `tool-host.html`, `tool-host.mjs` and `tool-preload.cjs` under `process.resourcesPath`; plan 4b's packager must ship them there (until then a packaged app's tools are off, "Tools are off: the tool host's files are missing").
- **`ctx.log` is not in the trace** (spec §4.2 says it is): it goes to main's log, keys hidden. A `logs` field in `TraceEntry` is open for Marco.
- **The Attention item of Decision 7** is not raised (above).
- **Job inbox lines** (D4): slice 4.
- **`files: "write"`**: refused until a harness needs it (§17).
- **Isolation between tools** is per harness, not per tool (above).

## Where to look

- `packages/harness-sdk/src/tool.ts` (`defineTool`, `ToolContext`, `ToolUses`, `ToolDefinition`), `tools.ts` (`TOOL_ID`, `TOOLS_MAX`, `CORE_SERVER_NAMES`, `toolsSchema`, `hasTools`, `toolsJsonSchema`, `toolMeta`, `toolProblems`), `index.ts` (the clash checks, `setup[].test`). `packages/cli/src/tool.ts`: the author's import.
- `packages/cli/src/tool-build.ts`, `build.ts`, `dev.ts`, `check.ts` (`tool-build`, `tool-uses`).
- `packages/shell/src/main/tools/`: `tool-protocol.ts`, `tool-host.ts`, `tool-broker.ts`, `tool-files.ts`, `tool-registry.ts`, `tool-trace.ts`, `tools-json.ts`, `tools-host.ts`, `tools-ipc.ts`. `packages/shell/resources/tool-host.html`, `tool-host.mjs`, `tool-preload.cjs`. `shell-resources.ts` (`shellResourcesDir`). `data-requests.ts` (`toolDataRequests`, `dataWriteQueue`), `secrets/connections.ts` (`connectTests`, Test), `index.ts` (the wiring under `hasTools`).
- `packages/blocks/src/tools-server.ts`, `tools-server-bin.ts`, `launch.ts` (`toolsServerSpec`); `packages/runtime/src/workspace.ts` (`RuntimeOptions.tools`), `events.ts` (`tool-call`, `ToolCallView`).
- `packages/workspace/src/data.ts` (`who: "tool"`), `history.ts` (`Tool:`, `CommitTrailer`).
- `packages/ui/src/tools/ToolCallLine.tsx`, `state.ts` (`tool-call`, `isToolLine`), `ChatView.tsx`, `client.ts` (`ToolsClient`, `ToolsInfo`, `TOOLS_OFF_CRASHES`), `connections/` (Test connection).
- Tests: `packages/harness-sdk/test/tools.test.ts`, `tool-problems.test.ts`; `packages/cli/test/tool-build.test.ts`, `fixture-dist.test.ts`; `packages/shell/test/tools/`, `tools-surface.test.ts`; `packages/blocks/test/tools-server.test.ts`; `packages/runtime/test/workspace-tools.test.ts`; `packages/workspace/test/data-tool.test.ts`; `packages/ui/test/tool-call-ui.test.tsx`. E2E: `packages/e2e/tests/tool-host.spec.ts` (a bare Electron main with a hostile tool), `tools.spec.ts` (the fixture `packages/fake-agent/fixtures/tools-harness`, id `toolbox`).
