# Harness tools

Spec: `docs/superpowers/specs/2026-10-28-tools-and-recipes-design.md` ("§" below), §1–§5, §8.1–§8.3, §9, §10, §17. Plan: `docs/superpowers/plans/2026-10-29-tools-slice2-tools.md` (slice 2; "Decision N" and the threat rows "T1"–"T9" below) and `docs/superpowers/plans/2026-10-29-tools-slice3-pre.md` (slice 3: "Pre-steps", "Expects" and "Measuring" below, with their own "slice 3 Decision N" and threat rows "P1"–"P6"). The broker and the key store under it are slice 1's (`docs/architecture/secrets.md`).

## What it is

- A harness may declare **tools**: small typed functions in its own folder, written with `defineTool`. A tool does one deterministic thing (read the CI state of a PR, count the notes of a scope) so the agent passes its judgment as arguments and code applies the rule, at 0 tokens (§1).
- A tool reaches the world **only through `ctx`** (D2): no `fs`, no `child_process`, no network of its own. It may import pure libraries that bundle for a browser.
- Tools run in **one hidden sandboxed window per harness** (D3), the plugins' backend settings, and every call goes through a **registry in main** that checks the arguments and the result and writes a **trace** entry (D4).
- **Each tool declares what it uses** (`uses`: hosts, secrets, commands, collections, files) and its broker grant is built from it (D7). But see "One window, one realm" below: the security boundary is the harness, not the tool.
- **Each tool says whether the agent sees it** (`agent: "call" | "none"`, default `"call"`, D8). `"none"` tools run only from the harness UI (and, from slice 4, job recipes).
- **Three callers** (§5): the harness UI (`client.tools.call`), the agent (the core MCP server `tools`), and the runner (pre-steps from slice 3; job recipes in slice 4).
- A harness without `tools` is today's app, byte for byte (D0, below).

Slice 3 adds pre-steps, `"prepared"` context items, `ctx.inputs`, phase `expects`, the `pre` and `expects-miss` usage rows and `humanharness measure` (below). Not yet: job recipes, `when`, `ctx.requestAi`, `ctx.summary` (slice 4); `tool test` / `tool run`, the guide, a template tool and mock-mode transports (slice 5).

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
- **`check`** builds in memory and never writes: each failing tool is a `tool-build` error; when the build passes, each `toolProblems` line is a `tool-uses` error (file: the tool's path), then each `stepProblems` line a `tool-steps` error (file: `harness.config.ts`; see "Pre-steps").
- **The e2e fixture's `dist/` is committed** (the e2e can't build); `packages/cli/test/fixture-dist.test.ts` rebuilds it in memory and compares (Decision 16).

## Checks

`toolProblems(manifest, toolsJson)` (`tools.ts`, §3.3) gives `{ tool, message }` lines that start with the id. `check` reports them; the app turns tools off on the first one.

- "uses.hosts needs permissions.web"; `uses.hosts: "<h>" is not a host pattern`; `uses.hosts: "<h>" is not a public host name` (localhost, a name under it, or an IP literal: a last label that is a number, as "127.1" or "0x7f.1"); "uses.exec needs permissions.exec"; `uses.exec: "<cmd>" is not a bare command name` (and the plugins' other pattern issues); "uses.files: write comes in a later slice; use read"; `uses.data.read|write: "<c>" is not a collection`; `uses.secrets: "<s>" is not declared in secrets`.
- An `agent: "call"` tool's description, trimmed, must be at least 20 characters (`TOOL_DESCRIPTION_MIN`) and not just its id: the agent picks tools by it.
- The manifest and `tools.json` list the same ids: "not built (run humanharness build)", "not a tool of this harness (run humanharness build)". An entry's `file` must be `tools/<id>.js`, so one id never runs another tool's bundle under its grant.
- Pre-steps and `expects` (slice 3): `stepProblems(manifest, toolsJson)` (`steps.ts`) gives "<action>: pre[i]: …" and "<action>: phase <id>: expects …" lines, run beside `toolProblems` (see "Pre-steps").
- A connect step's `test` must name a tool of the harness (`defineHarness`: "\"<id>\" is not a tool of this harness") with no required params ("a connect step's test tool can't have required params").

## The host

`ToolHost` (`packages/shell/src/main/tools/tool-host.ts`) is the only module that touches Electron for tools; what it decides is in `tool-protocol.ts` (pure). It copies the plugin backend host's settings (`docs/architecture/plugins.md`, "The backend window") but is a class, scheme, session and channel of its own.

- **One hidden window per harness** (`show: false`, `skipTaskbar`): `sandbox`, `contextIsolation`, `nodeIntegration`, `nodeIntegrationInSubFrames`, `nodeIntegrationInWorker` and `webviewTag` false, `webSecurity`, `disableDialogs`, `navigateOnDragDrop: false`, devtools only in development. The preload (`resources/tool-preload.cjs`) exposes only `window.hh.rpc`.
- **Its own in-memory session** `hh-tools-<harness-id>`: the scheme handler, a request filter that cancels every URL but this harness's own `hh-tools:` files (`allowToolRequest`), permissions and devices denied, downloads cancelled. Navigation, frame navigation, redirects, webviews and new windows are prevented.
- **The `hh-tools:` scheme** (`TOOL_SCHEME`, `standard` and `secure` only) is registered before ready, only under `hasTools` (with plugins, in the same call as `hh-plugin:`). `hh-tools://<harness-id>/` serves only `_hh/host.html` and `_hh/host.js` (`resources/tool-host.html`, `tool-host.mjs`) and `tools/<TOOL_ID>.js` from `<root>/dist/tools/` (`resolveToolFile`, `readToolFile`): never `tools.json`, a harness's own `dist/_hh/` or a nested path; no link (the `tools/` folder itself included), no hard link, at most 10 MB (`TOOL_FILE_MAX_BYTES`); checked on every request. Every response carries the plugins' CSP (`TOOL_CSP` = `PLUGIN_CSP`), `nosniff` and `no-store`. The harness id is the URL's host: an id over 63 characters can't be served, and tools are off ("Tools are off: Not a harness id the tool host can serve").
- **The page** `hh-tools://<id>/_hh/host.html?tools=a,b` imports each built tool (`runHost` in `tool-host.mjs`), reports `ready` with the tools and their load errors, then loops on `next`. Each command is `{ kind: "call", callId, tool, args, scope, inputs? }` (`inputs` only for a step that has `input`); the script builds a frozen `ctx` whose calls carry the call id, runs `run`, calls `summary` (a throwing one is dropped; the text is cut at 16,000 for main to hide keys in first) and answers `done`. A result the preload can't serialize answers "The result can't be sent: …".
- **The channel** `hh-tools:rpc` (`TOOL_RPC_CHANNEL`; the one `ipc-surface.test.ts` entry Decision 15 allows) answers only the host window's main frame at exactly its host page (`toolOfSender`, `isToolFrame`; T2). `parseToolRpc` refuses a payload over 12 MB (`TOOL_RPC_MAX_BYTES`) or deeper than 40 (`TOOL_RPC_MAX_DEPTH`) unread. At most 32 tool calls waiting or running (`TOOL_CALLS_IN_FLIGHT`, beyond it "Too many tool calls at once") and 64 rpc calls unanswered (`TOOL_RPC_IN_FLIGHT`). An idle `next` answers after 25 s.
- **Call ids**: main makes each call's id (the broker run id) and hands it to the page. A `ctx` call acts for the tool main handed that id to, and only while that call runs in the current page; anything else is "Unknown tool call". A `done` for a call not yet handed out is ignored.
- **Crashes** (Decision 7): `render-process-gone`, `unresponsive` and a failed load count. The calls the dead page held fail with "The tools host stopped (<reason>)"; queued ones wait for the next page. Restart after 1 s, doubling while each crash comes within an hour of the previous, at most 30 s (`TOOL_CRASHES`). The 5th crash within a rolling hour turns tools off until the app restarts: every call answers "Tools are off after repeated crashes" (`TOOLS_OFF`), `AppState.tools.off` says so, and the chat's top shows "Tools are off after repeated crashes. Restart the app to turn them on." (`tools.off`). An app with the shared Attention store (board or single mode) also gets one `action` item with that title (`TOOLS_OFF_ITEM`, origin `{ kind: "tool", id: <harness id> }`, key `off`, no target), raised once in the current base's shared store (`attention` dep of `createToolsHost`; a failed raise is logged). The store lists it only for this harness's id (`registerKnown("tool")`). A later start with tools on resolves it (without making the inbox's key). Plain mode has no shared store (D0, `task-attention.test.ts`): only the top line, plugins or not (the plugins' own inbox store is theirs; see "Known gaps"). Like a job's or a waiting task's item, it is in the store, not in the plugins' inbox list (which shows plugin origins only).
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
| `ctx.inputs` | A step's earlier results named by its `input` (slice 3, "Pre-steps"); `{}` for any other call. The host script deep-freezes it, except a typed array or `DataView` inside it, which can't be frozen and stays as it is; it holds only what the runner itself produced (P3). |
| `ctx.log(level, message)` | To main's log with the tool's id and the level, keys hidden then cut (as plugins), and into the call's trace entry (§4.2): the broker keeps the first 20 lines of a call (`TOOL_BROKER_LIMITS.logs`), one line each, the keys its fetches were filled with hidden and then cut to 16,384 units; the registry hides the stored keys and only then cuts each to 300 code points (`LOG_CHARS`; a line the broker cut loses its tail first, as errors do). |

**A job run's permissions** (jobs J2): a call from a job slot carries `JobLimits` (`jobLimits(harness, job)`: the harness's permissions narrowed by the job's, as its slot's `narrowPermissions`), and the broker refuses before the tool's own grant: with `web: false` every `ctx.fetch` ('The job "<id>" runs with web: false: its tools can't fetch'), with `exec: false` every `ctx.exec` ('The job "<id>" runs with exec: false: its tools can't run commands'), each one recorded as access denied. It fails closed: a run whose job the harness doesn't declare reaches neither. `edit: "none"` narrows only the engine's file edits; data writes are not narrowed by it (as the `data` server's for the job's agent), so `ctx.data` is unchanged. Task and UI calls carry no limits: their reach is the harness's permissions, which `uses` already sits inside.

Refusals (each an answer the host script throws as `ToolRefused`): "<host> is not declared in uses.hosts", `The key "<id>" is not declared in uses.secrets`, "<line> is not declared in uses.exec", "The collection is not declared in uses.data (<call>)", "This tool doesn't declare uses.files", "This tool call has ended". A missing key fails with `missingSecretMessage(label)`: "<label> is not set — Settings › Connections".

**Accesses**: each fetch hop, command, data op ("<op> <collection>", allowed only when the data path answered) and files call reached, and each grant refusal, as `{ kind: "fetch" | "exec" | "data" | "files", target, allowed }`. A target is one line, at most 200 code points, never a header, a body or a key: every key this tool's fetches were filled with is hidden in it first (a redirect's `Location` may echo one). At most 200 accesses a call.

## One window, one realm

All of a harness's tools load in the same page, so they share one JavaScript realm and one `hh.rpc`. A tool can import another tool's bundle, patch shared prototypes, take another tool's queued call or use its call id for `ctx` calls. So the **effective reach of any tool is the union of its harness's tools' `uses`**.

This is a decision (Task 6 review, per D3 "one host for every tool"), and a deviation from the wording of spec §2 D7 ("a bug in one tool reaches only what that tool declared"), §4.1 and threat row T3 ("each tool reaches only its `uses`"): the per-tool grant holds against a **mistake** in a tool, not against a **hostile** tool of the same harness. The tools share an author, a folder and a build. The security boundary is the harness: its tools, together, never reach more than their declared `uses`, and those stay inside the harness's `permissions`. Per-tool `uses` keeps catching mistakes and keeps each trace entry honest about what that call touched. Any screen that shows a harness's reach (a future consent screen) shows the union, never one tool's. The hardening, one window per tool (up to 50 renderers), is open for Marco.

## The registry

`ToolRegistry` (`tools/tool-registry.ts`, §4.3) runs every call, from any caller (`ToolCall`: `tool`, `args`, `caller`, `scope`, `task?`, `job?`, `run?`, `phase?`, `limits?`, `inputs?`):

1. Tools off (`tools.json` missing, invalid or with a problem; see "Reading tools.json") → its reason. The host off after crashes → `TOOLS_OFF`. An unknown id, or an `agent: "none"` tool from the agent caller → `Unknown tool "<id>"` ("Unknown tool" when the id isn't id-shaped). **These calls never reach a tool and are not traced**; every later failure is.
2. `args` (undefined is `{}`) against `params` through `jsonSchemaToZod` (cached per schema): the first issue as "path: message", and the tool does not run. The host gets the **parsed** value: a key `params` doesn't name never reaches `run`.
3. The host runs it under a fresh run of the tool's broker, with the tool's timeout (30 s default, up to 120 s) raced against the registry's own timer: "<tool> took longer than <s> s". `endCall` always runs; a broker or host throw answers "Something went wrong running the tool" (logged).
4. The result against `returns`: "The result doesn't match returns: <path: message>". A key `returns` doesn't name fails too: never half-good data (T5).
5. One trace entry, then `called(entry)` (the chat line). A trace that can't be written is logged and never fails the call.

**Secrets** (T4): the tool's stored values (`secretValues(tool)`, its `uses.secrets` read from the store) are hidden with `hideSecrets` in the answer's error and result (every string and key, deep), the summary, the trace's args and result, the `ctx.log` lines of the trace, and the access targets again. **Hide, then cut, everywhere**: a text is hidden first and cut after, so a key across a cut never leaves its start behind. An error is cut to 4096 code points ("The tool failed; its error can't be shown" when hiding empties it), a summary to 200, a trace value at 2 KB (at most 64 KB of it looked at), an access target at 200, a trace log line at 300 (one the broker cut at 16,384 loses its tail first), and a "Test connection" message at 300 (`connections.ts`). A text that arrived at the host's 16,000 cap also loses its last `6 × bytes + 16` units, the longest form a key can take.

**Slice 3 additions.** `inputs` over 8 MB (`INPUTS_MAX_BYTES`) or not JSON fail the call before the host ("The inputs can't be sent"), traced; the trace entry never carries them. `meta(id)` answers a tool's `tools.json` entry (null while off, or for an unknown id). `note({ tool, caller, task?, job?, run?, phase?, text })` writes a trace entry that is a line of text, not a call (a cut, an expects miss): the text has controls and line separators turned into spaces, then the SDK's hidden characters removed (`HIDDEN_CHARS`: zero-width, bidi controls, BOM, variation selectors, tags…), and is cut to 200 code points (`NOTE_CHARS`, P6); a failing write is logged, never thrown. It reaches the chat through `called`, as a call does.

**`resultSummary`**: the tool's `summary` (hidden, ≤ 200), else a generic one (`genericSummary`): "12 items", "1 item", "object with 4 keys", "text, 40 characters", a number or boolean as text, "nothing"; "failed" on an error.

## Reading `tools.json`

`readToolsJson(root, manifest, log)` (`tools/tools-json.ts`, Decision 3) reads `<harness root>/dist/tools.json` once at start: through `readNoLinks` (no link, not hard-linked), ≤ 1 MB, valid JSON of `toolsJsonSchema`, at most 50 tools. Any failure: tools off with "Tools are not built: run humanharness build" (`NOT_BUILT`) and the why logged once ("Tools are off: …", one line). A `toolProblems` line turns tools off with that line as the reason; without one, the first `stepProblems` line does (slice 3). There is no staleness check against the sources (Known gaps).

## The trace

`ToolTrace` (`tools/tool-trace.ts`, §8.1, Decision 8): one JSON line per call.

| Caller | File |
|---|---|
| A task's call | `.harness/trace/<task-id>.jsonl` |
| A job run's call (whatever the job runs) | `.harness/trace/jobs/<run-id>.jsonl` |
| A UI call with no task | `.harness/trace/ui/<YYYY-MM-DD>.jsonl` (the entry's UTC day) |

- **Entry** (`TraceEntry`): `{ at, tool, caller, task?, job?, run?, phase?, args, result?, resultSummary, ms, ok, error?, accesses, logs?, note? }`. `logs` (`{ level, message }[]`) is there only when the tool logged; `note` only on a note entry (`read` drops one that isn't a string of at most 200 code points). `caller` is `"ui" | "agent" | "pre" | "job"` (`ToolCaller`; slice 2 makes `ui` and `agent`, slice 3 `pre`). `args` and `result` are the value, or `{ cut: true, text }` past 2 KB (`TRACE_CUT`), keys hidden before the cut.
- **Files**: the id must pass `isTaskId` ("Not a task or run id"), never a path from a caller. Folders below the base walked with `lstat`; files opened `O_APPEND | O_NOFOLLOW`, 0600, not hard-linked. A torn last line gets a newline before the next entry. A file stops at 16 MB (`TRACE_FILE_MAX_BYTES`): later entries are dropped, logged once. `read(id)` reads the task file, then the jobs file, skipping lines that don't parse.
- **Prune** (`prune()`): each base once per run, before its trace is first used: the base current at start, and one reached later by a profile or folder switch. Files untouched for 30 days (`TRACE_DAYS`) removed, older lines dropped; never throws, creates nothing, skips (and logs) a linked folder.
- Nothing is created until a call is traced. The history never tracks `.harness/trace/` (it is under `.harness/`, not in the keep list).

## The three callers

`createToolsHost` (`tools/tools-host.ts`) is built in `index.ts` only under `hasTools(harness)`. `start()` (once, memoised, after the window is created) reads `tools.json`, starts the host (its throw turns tools off with "Tools are off: <message>"), writes the catalogue, prunes the current base's trace and tells the window (`hh:toolsChange`).

- **The agent** (`caller: "agent"`), through the `tools` MCP server. The caller comes from the asking slot, never the request: a task slot gives `task`, its `scope` and its `phase` (`slotTask`: board mode, the lane's task manager; otherwise the open task; `slotTaskOf` drops a trailer of another task); a job slot gives `job` and `run` (`jobs-host.ts` `runOf`), whatever the job runs, and the job's narrowed permissions (above). No task or run: "No task is running in this session". A malformed request: "Invalid request". The agent reads only the registry's answers (its own texts, or the tool's error with keys hidden) or "Something went wrong running the tool": never a path, stack or key (T4).
- **The harness UI** (`caller: "ui"`): `hh:toolsCall` runs in the scope main has open (or none), with no task (Decision 14), and works before a task opens. The page names a tool and its arguments, never a caller, task or scope (T9).
- **The runner** (`caller: "pre"`): an action's pre-steps when a task starts ("Pre-steps" below). `"job"` recipes: slice 4.

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

A call with a `task` emits a runtime event `{ type: "tool-call", call: ToolCallView }` (`packages/runtime/src/events.ts`) to that task's chat. `ToolCallView`: `{ tool, caller, ok, ms, summary, error?, args, result?, accesses, logs?, note?, at }`, args and result as text cut at 2 KB. A view with `note` is drawn as a plain line of text (`hh-tool-note`), not a call; `cleanToolCalls` keeps a saved `note` when it is a string. A `caller: "pre"` call never comes this way: it rides on the first turn ("Pre-steps").

- During the task's turn it is saved on the reply (`TurnRecorder`, `TurnController.addToTurn`): `ChatEntry.tools` on the assistant entry, there after a reload. A call outside any turn is shown, not saved. Board mode routes it to the task's lane.
- `ToolCallLine` (`packages/ui/src/tools/ToolCallLine.tsx`, Decision 10, §8.2): a folded button "<tool id> · <resultSummary> · <seconds> s · 0 tokens" ("pr-ci · 12 items · 0.3 s · 0 tokens"), seconds with one decimal, that unfolds to Arguments, Result, Accesses (a refused one ends " · access denied") and Log (the tool's `ctx.log` lines as "<level>: <message>", when it logged; `toolCallView` and `cleanToolCalls` keep only well-formed lines, at most 20 of 300). A failed call reads "<tool id> failed · <message>" and starts unfolded. The lines sit above the assistant entry's message. A tool-only entry is never "the reply" (`isToolLine`): choices and Try again stay on the real last reply. A saved entry's `tools` is read unchecked from the chat log, so `cleanToolCalls` drops malformed items.
- Strings: the `tools` block of `en.json` (`line`, `failed`, `accessDenied`, `args`, `result`, `accesses`, `logs`, `off`; slice 3: `contextPrepared`, `prepared_one`/`prepared_other`, `prepareFailed`).
- **Tools off after crashes**: when `state.tools.off` is exactly `TOOLS_OFF_CRASHES`, the chat's top shows `tools.off` in a `role="status"` line (not for "not built" or a problem).

## "Test connection"

A connect step may name `test: <toolId>` (slice 1 Decision 4, here Decision 13; `docs/architecture/secrets.md`). The setup step and Settings › Connections then show "Test connection" for each key that step lists. Main runs the tool with `{}` as `caller: "ui"` and no scope, shows "Works" or "Didn't work: <message>", and keeps `{ at, ok, message? }` per key in `~/.humanharness/<harness-id>/connections.json` (no value; 0600, temp and rename, ≤ 64 KB, no link). The message has every stored key hidden again, then is cut to 300 code points. Replacing or deleting a key forgets its last test; a test whose key changed while it ran keeps nothing ("The key changed during the test: test again"). `hh:connectionsTest` is registered only when some step names a test.

## Pre-steps

Slice 3 (spec §6, §6.5, §8.2, §10). An action may run tool calls when the person presses Start, before its session opens. Their results go into the first message, so the agent starts with what code could find at 0 tokens instead of spending turns finding it. From the e2e fixture `toolbox`:

```ts
study: {
  label: "Study",
  prompt: "./agent/tasks/study.md",
  cost: "light",
  pre: [
    { tool: "due-today", as: "today" },
    { tool: "pick-two", input: ["today"], as: "warmup" },
  ],
  phases: [
    { id: "main", label: "Main", brief: "./agent/phases/main.md", auto: true },
    { id: "close", label: "Close", brief: "./agent/phases/close.md", close: true, expects: ["count-notes"] },
  ],
},
```

### The keys

- `pre` (`preSchema`, `packages/harness-sdk/src/steps.ts`): 1 to 10 steps (`PRE_STEPS_MAX`), each a strict object (a typo'd key is refused): `tool` (a tool of the harness), `args?` (fixed arguments), `input?` (1 to 10 earlier `as` names, passed as `ctx.inputs`), `forEach?` (an earlier `as` whose array the step runs over), `as?` (the result's name, `TOOL_ID` pattern, unique within the action) and `required?` (`true` only: the task doesn't start when this step fails). `toolStepSchema` is the same step without `required`; slice 4's job recipes reuse it.
- `preTokens`: an integer 500–20,000 (`PRE_TOKENS_MIN`, `PRE_TOKENS_MAX`), the cap on the prepared section; default 4000 (`PRE_TOKENS_DEFAULT`). Only with `pre` ("preTokens needs pre").
- A pre-step may use an `agent: "none"` tool: only the agent caller is refused those.
- `hasPre(h)` is the D0 switch.

**Checks.** `defineHarness` (`preProblems`, in the manifest's `superRefine`): each step's tool is declared, each `as` once, `input` and `forEach` name an earlier step's `as`, `expects` names declared tools. A harness without `tools` can't declare either. `stepProblems(manifest, toolsJson)` checks what needs `tools.json`: a result read through `input` or `forEach` comes from a tool that declares `returns`; a `forEach` result is an array whose items carry every required param of the step's tool that `args` doesn't give; `expects` names `agent: "call"` tools. `check` reports each line as a `tool-steps` error on `harness.config.ts`, after the `tool-uses` findings and only when the in-memory build passed. The app runs it after `toolProblems` when it reads `tools.json`: the first line turns tools off (`toolProblems`' reason wins when both have one). A step whose tool `tools.json` lacks adds no line: `toolProblems` already says "not built".

### The runner

`runPreSteps({ registry, steps, task, scope, phase? })` (`packages/shell/src/main/tools/pre-steps.ts`) runs the steps in order through the registry, each call `{ caller: "pre", task, scope, phase?, tool, args, inputs? }`. `runToolStep` runs one step; it assumes nothing about who runs it (slice 4 reuses it for job steps).

- `input`: `ctx.inputs` holds exactly the named earlier results (P3). A call without `input` sends no `inputs` key; the host script gives the tool `{}`.
- `forEach`: once per item of the named array, at most 100 items (`FOR_EACH_MAX`; more fails the step "forEach over N items; at most 100"), 4 calls at a time, each with its tool's timeout, results in item order. A call's params are the item's fields named like the tool's `params.properties`, then `args` over them. A value that isn't an array fails the step ("<as> is not a list"). One failed item fails the step with that item's error, and no new call starts after it; a call that throws also stops new calls (the calls already running end on their own).
- **A failed step** is a result, not a throw: its message is the registry's, keys already hidden (P5). The next steps still run; one whose `input` or `forEach` names the failed result is skipped with `"<as>" is not available: <tool> failed`.
- **A `required` step** that fails stops the run there (`requiredFailure`).
- Each step's time and the whole run's are measured (`ms`).

### Where it runs

`TaskManager.begin` (`task-manager.ts`) calls `TaskDeps.prepare` right after taking the new task's id, before anything is written, only for an action that declares `pre`, and never for a resumed task, a free question, a review or a plugin's task. `prepare` is the tools host's (`tools-host.ts`):

- The whole run goes inside the tools host's per-call trailer, with the task's own trailer (task, action, scope with scopes, first phase), so a pre-step's data write commits as the task's, plus `Tool: <id>`. The calls get the task's scope as is (`_app` and `main` included), as its agent calls do. A task with phases passes its first part's id as `phase`.
- Then `preparedSection` builds the section (below), each cut becomes a `note` trace entry (caller `pre`), and one `pre` row goes to `usage.jsonl` ("Measuring").
- A throw anywhere in `prepare` is logged ("Could not run the pre-steps") and refuses the start with the fixed text `PREPARE_FAILED` ("the pre-steps could not run"), never the thrown message.
- **Stop while preparing** (slice 3 Decision 7): the running step ends (each call has its timeout; nothing is aborted inside the sandbox), then nothing starts.
- **A refused start** (a `required` failure, or the throw above): no task is written and no engine runs. The chat shows the error card `prepare-failed` (`ErrorCode` in `runtime/src/events.ts`): "Couldn't prepare this task: <tool> failed: <message>" (`tools.prepareFailed`) with "Try again", which sends the start again (a new task id, the steps run again). The trace keeps the refused start's calls under an id that never reaches `tasks.json`; pruning by age removes them.
- **A resumed task** (after "Move folder") runs no pre-step and gets no prepared data (slice 3 Decision 6).
- **`humanharness run`** has no tool host yet: it prints "Pre-steps are not run in the terminal yet." once before the task starts, and the first message goes without the section (slice 3 Decision 18).

### `## Prepared data`

`preparedSection(results, { descriptions, preTokens })` (`tools/prepared-section.ts`) gives `{ text, items, cuts, tokens }`:

````text
## Prepared data

Code prepared this before the task started. It is exact: use it as given, and call the tool again only when you need fresher data.

### today · due-today
Lists the items due today.
```json
[{"id":"a","title":"…"}]
```
(cut: 12 of 40 items)
````

- One block per step, in order, separated by a blank line: `### <as> · <tool>` (`### <tool>` for a step without `as`), the tool's description on one line, the result as compact JSON in a `json` fence one backtick longer than its longest backtick run (`fenceFor`, P1), and `(cut: N of M items)` (`keys` for an object, `characters` for a string) when cut. A failed step's block is its header and `<tool> failed: <message>`. Every one-line text (description, failure, the header's ids) has controls and line separators turned into spaces and hidden characters removed, and is cut to 200 characters.
- **Placement** (slice 3 Decision 1): a context part right after the data tables and before the pins and the material (`contextFor`; `docs/architecture/context.md`). An answer with no text and no items adds no part.
- **Cuts** (Decision 3, P2): sizes are characters ÷ 4, rounded up. While the section is over `preTokens`, the largest result left is cut to the most items, keys or characters that still fit; one that can't fit even empty becomes `(cut: too large)`, as does a number, boolean or null that doesn't fit. Should headers and lines alone still be over, the last blocks lose their line and JSON, then the last blocks go. So the cap always holds; a section where not even the title fits is "" with no items. Each cut is reported (`<as>: cut: 12 of 40 items`) and written as a trace note after the calls, even when nothing is left of the section.
- **Items**: one `ContextItem` of kind `prepared` per block kept, id `prepared:<as>` (or `prepared:<tool>`), with its block's token estimate. Ids are unique: a key used again gets `prepared:<key>#<n>`, its nth use, from 2 (two steps without `as` on one tool, or an `as` equal to another step's tool); labels stay "Prepared · <key>". Items come only with text. The panel lists each as "Prepared · <as>" (`tools.contextPrepared`) in "At the start", a repeat as "<as> #2". The panel takes the name from an id of exactly that shape (`<as>` a tool id, `#<n>` 1 to 9999), else the item's label. A prepared item never shows an open link, its notes list or "Exclude", whatever `tasks.json` holds.
- `tokens` is the whole section's size, the `pre` row's `preparedTokens` (0 for a refused start).

### The chat group

Pre calls never stream into the chat: `called` diverts every `caller: "pre"` entry (calls and cut notes) into the start's own list, which `prepare` answers as `views`. The first turn shows them first (`TurnOptions.prepared`): `TurnController` adds each as a `tool-call` event to the turn's recorder and emits it (or holds it with a held first attempt, so a model-unavailable attempt shows none and its retry carries them again), right after the turn's `finish` is set up: before the cancelled check and `ensureRuntime`, so a first turn whose engine never starts (not installed, Stop before the send) still shows and saves the group before its error, and no other call comes before them. They are saved on the reply (`ChatEntry.tools`, before the agent's own calls).

`ToolCallLines` folds an entry's leading `caller: "pre"` calls into `PreparedGroup` (`packages/ui/src/tools/PreparedGroup.tsx`): one button "Prepared N items · S s · 0 tokens" (`tools.prepared_one`/`_other`; N counts the distinct tools of the calls that aren't notes, so a forEach counts once; S sums their times), unfolding to each call's `ToolCallLine`, notes included. It starts unfolded when a call failed, also one that arrives after it was drawn, until the person folds or unfolds it. A leading run of only notes (no call) draws as plain lines, with no group. An entry without pre calls draws as in slice 2. The window keeps a saved call's `note` only when it is a string of at most 200 code points (`cleanToolCalls`, as the trace's `read`); a longer one is dropped, the call kept.

## Expects

A phase may declare `expects`: 1 to 10 tools the agent should call in that part (spec §6.1). Each must be a declared `agent: "call"` tool. `hasExpects(h)` is the D0 switch.

- **When** (slice 3 Decision 11): when the task leaves a part (any move: the agent, the person, an approval, the time box) and when it closes: after the closing turn, or when it finishes with its note already saved. A cancelled or unfinished close, or a Stop before it, checks nothing. A move that sends a phase brief waits for the check at most 2 s (`EXPECTS_CHECK_MS`) before the brief, so a miss line is its own line before the brief; a move without a brief doesn't wait. A close waits as long before the task ends, so the task is still current and the miss line reaches the chat. A failing check is logged ("The expects check failed") and stops nothing.
- **What counts** (`expectsMisses`, `tools/expects.ts`): a trace entry with the task's id and that part's id, whatever its caller, failed calls included; notes don't count. Each expected tool is missed at most once per check, in the declared order. A part entered again is checked again against every call made in it.
- **A miss** (`phaseEnded` in `tools-host.ts`, ids only): one `expects-miss` row in `usage.jsonl`, then a trace note "Expected <tool> in <part label>: not called" (caller `agent`), which reaches the chat as a line through the same path as an agent's call. Nothing else happens.

## Measuring

`usage.jsonl` gets two tool rows (slice 3 Decision 10, spec §8.4). They aren't turns: `TOOL_ROW_KINDS` (`pre`, `recipe` for slice 4, `expects-miss`) are left out of `summarizeUsage`, so they never make a task unmeasured and add no tokens.

- `{ at, engine, kind: "pre", action, task, scope?, steps, ms, preparedTokens, ok }`: one per start that ran pre-steps; `ok` when no step failed; `steps` is the declared count. A refused start writes one too, with `preparedTokens` 0 since no section was sent (its task never gets a run line).
- `{ at, engine, kind: "expects-miss", action, task, scope?, taskPhase, tool, ok: true }`: one per miss. The spec's `phase` is written `taskPhase`, the field every phased row uses; `phase` is the turn kind in this file.
- Both carry ids and numbers only, never a step's message. `scope` only in a harness with scopes.

**`humanharness measure [--folder <dir>]`** (`packages/cli/src/measure.ts`, `measurePre` in `usage-log.ts`) reads only `<folder>/.harness/usage.jsonl` and prints, per action, the tasks without and with pre-steps and the average first-turn tokens of each, plus the average prepared tokens and pre time:

```text
study
  without pre-steps: 2 tasks, first turn ≈ 12,400 tokens
  with pre-steps:    3 tasks, first turn ≈ 10,900 tokens; prepared ≈ 850 tokens in 0.4 s
```

- A task's **first turn** is its first line with the task's id and an action, turn kind `run` (or none) and no `kind`. Its tokens are input + cache read + cache write (output left out). A task "with" pre-steps has a `pre` row.
- A first turn whose engine reported neither usage nor limits writes no line, so the task's next `run` line is taken as its first turn. A first turn with no `usage` leaves the task out. Free questions are left out; refused starts are too (no run line).
- Tasks from `humanharness run` always count as "without": `run` runs no pre-steps and writes no `pre` row.
- Without `--folder` it needs the current folder to hold `.harness/`. A missing log, or nothing measurable: "No usage recorded in <folder> yet." (exit 0). A side with no tasks reads "no tasks yet".

### The first measurement (method)

Marco runs it by hand, with a real engine; no test does. It needs a harness whose actions declare `pre`: the plan's choice was the demo's topics with a `list-sources` pre-step, but that work (slice 3 Task 13) is parked and the demo has no tools today ("Known gaps").

1. Build the app from slice 2's end (`feat/tools`, no pre-steps) and run each topic once in a fresh folder.
2. Build this slice and run each topic once more in another fresh folder, with the same engine and tier.
3. `humanharness measure --folder <folder>` on each folder, and fill in the table.

| Action | First turn without | First turn with | Prepared tokens | Pre time |
|---|---|---|---|---|
| Pending: Marco's run | | | | |

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

**Slice 3.** A harness whose actions declare no `pre` and whose phases declare no `expects` runs no slice-3 code: `defineHarness` gives no `pre`, `preTokens` or `expects` key; `TaskDeps.prepare` and `TaskDeps.phaseEnded` are absent (`index.ts` gives them only when the tools host exists and `hasPre` / `hasExpects`); every first message, `start` list, chat entry, usage line and trace file is as in slice 2; no `prepared` item and no `pre` or `expects-miss` row is ever written; an agent or UI call reaches the chat as before. `ContextItemKind` and `task-store`'s kinds gain `prepared` for everyone; old files read as before.

| D0 item (slice 3) | Pinned by |
|---|---|
| Manifest | `packages/harness-sdk/test/pre-steps.test.ts` "D0: no pre, preTokens or expects without them" |
| `check` | `packages/cli/test/check-pre.test.ts` "D0: no tool-steps finding without pre" |
| First message and start items | `packages/shell/test/task-manager-pre.test.ts` "D0: without prepare the first message and start are byte-identical" |
| Moves | `packages/shell/test/task-manager-expects.test.ts` "D0: without phaseEnded nothing changes (the move's calls and writes are as before)" |
| Turn entries | `packages/shell/test/turn-controller-pre.test.ts` "D0: a turn without prepared emits what it emitted" |
| Usage | `packages/shell/test/usage-pre.test.ts` "D0: a log without pre or expects rows summarises as before"; `usage-log.test.ts` unchanged |
| Wiring | `packages/shell/test/tools-pre-surface.test.ts` "D0: prepare and phaseEnded are passed only under hasTools and hasPre/hasExpects" |
| Store | `packages/shell/test/task-store-prepared.test.ts` "D0: a file without prepared items reads as before" |
| Chat | `packages/ui/test/prepared-ui.test.tsx` "D0: an entry without pre calls renders as before" |
| `run` | `packages/cli/test/run-pre.test.ts` "D0: an action without pre prints nothing new" |
| Slice 2's pins | `runtime-d0`, `hatches-d0`, `claude-cli` goldens, `hatches-surface`, `history.spec`, `task-manager.test.ts`, `tools.test.ts`, `tool-registry.test.ts`, `tool-call-ui.test.tsx`: unchanged |

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

**Slice 3** (pre-steps run the harness's own tools with the sandbox and broker above; what is new is tool data reaching the first message and the trace):

| # | Boundary | What enforces it | Test |
|---|---|---|---|
| P1 | A result can't break out of its block in the first message | compact JSON in a fence one backtick longer than its longest run (`fenceFor`); header and line are one line each, controls and hidden characters removed, ≤ 200 characters | `prepared-section.test.ts` "a result holding ``` and a heading stays inside its fence" |
| P2 | The prepared data never exceeds its cap | `preTokens` (default 4000, at most 20,000); largest first, then lines, then whole blocks | `prepared-section.test.ts` "never exceeds preTokens, even when the headers alone don't fit" |
| P3 | `inputs` are only earlier results | exactly the named `as` values the runner made; deep-frozen in the host (a typed array or `DataView` left unfrozen); ≤ 8 MB | `pre-steps.test.ts` "inputs hold only the named results"; `tool-host-script-inputs.test.ts`; `tool-inputs.test.ts` |
| P4 | `forEach` can't fan out without bound | ≤ 100 items, 4 at a time, each call with its timeout | `pre-steps.test.ts` "forEach over more than 100 items fails the step", "forEach runs at most 4 calls at a time and keeps the item order" |
| P5 | Secrets never reach the first message | a step's error is the registry's, keys hidden (T4); a `prepare` throw shows a fixed text; usage rows carry ids and numbers only | `pre-steps.test.ts` "a failed step's message is the registry's redacted text"; `tools-host-pre.test.ts` |
| P6 | A trace note is bounded data | one line, ≤ 200 code points, the SDK's hidden characters removed, tool id checked; `read` and the window (`cleanToolCalls`) drop a longer one | `tool-note.test.ts`, `ui/test/tool-call-note.test.ts` |

Also: **no private network** (every fetch hop, `isPublicHost` plus the localhost/IP guard: `tool-broker.test.ts` "fetch: localhost, IP literals and hosts that resolve to a private address are refused, on every hop").

## Decisions

The plan's Decisions 1–18 hold as written, with these notes:

- **Decision 7**: the Attention `action` item is raised as above in board and single mode (not in plain mode with plugins: "Known gaps"); every app also keeps the chat's top line.
- **Decision 11**: job inbox lines wait for slice 4; slice 2 writes each run's trace and `client.tools.trace(runId)` returns it.
- **Shared realm** (Task 6 review): "One window, one realm" above.

Slice 3's Decisions 1–18 hold as written, with these notes:

- **Decision 4**: a `prepare` that throws refuses the start with "Couldn't prepare this task: the pre-steps could not run." (not a start without data).
- **Decision 8**: the group's N counts distinct tools, not `as` names.
- **Decision 11**: a close also checks when the task finishes with its note already saved, and after a closing turn that failed without being cancelled; a part entered again is checked again (one miss row per exit).
- **Decision 15–16** (the demo's `list-sources`): parked; the demo has no tools ("Known gaps").

## Known gaps

- **No staleness check**: the app runs whatever `dist/` holds; `dev` rebuilds, but a tool file edited after a build isn't noticed until the next one.
- **No packaging of `dist/`** into a shipped app: plan 4b.
- **Packaging the host's files**: a packaged app looks for `tool-host.html`, `tool-host.mjs` and `tool-preload.cjs` under `process.resourcesPath`; plan 4b's packager must ship them there (until then a packaged app's tools are off, "Tools are off: the tool host's files are missing").
- **The Decision 7 item in plain mode with plugins**: plain mode's plugins keep their own inbox store (a parallel-spec D0 pin), so the tools' item is raised only in board and single mode; a plain-mode app shows only the chat's top line. Open for Marco. And no inbox list shows a `tool` item yet (the plugins' list shows plugin origins only, as for job and task items).
- **Job inbox lines** (D4): slice 4.
- **`files: "write"`**: refused until a harness needs it (§17).
- **Isolation between tools** is per harness, not per tool (above).
- **The demo has no pre-steps**: slice 3 Task 13 (`list-sources` on its topics) is parked. With tools, the demo's hidden tool window and its `pre` rows break e2e specs that use it as the tools-free harness (some of them frozen); Marco decides how. Until then the first measurement has no harness to run on.
- **`run` runs no pre-steps** until slice 5 brings a tool host to the CLI.
- **The panel's "First turn"** counts every API call of the first turn, tool calls included, as before (`docs/architecture/context.md`).
- **`linked-folders` items** are missing from `task-store`'s kinds (so dropped on read): a slice-2-era bug, noted, not fixed here.
- **A forEach step's lines** come in finish order, not item order (its result is in item order).

## Where to look

- `packages/harness-sdk/src/tool.ts` (`defineTool`, `ToolContext`, `ToolUses`, `ToolDefinition`), `tools.ts` (`TOOL_ID`, `TOOLS_MAX`, `CORE_SERVER_NAMES`, `toolsSchema`, `hasTools`, `toolsJsonSchema`, `toolMeta`, `toolProblems`), `index.ts` (the clash checks, `setup[].test`). `packages/cli/src/tool.ts`: the author's import.
- `packages/harness-sdk/src/steps.ts` (slice 3: `toolStepSchema`, `preStepSchema`, `PRE_TOKENS_*`, `PRE_STEPS_MAX`, `hasPre`, `hasExpects`, `preProblems`, `stepProblems`).
- `packages/cli/src/tool-build.ts`, `build.ts`, `dev.ts`, `check.ts` (`tool-build`, `tool-uses`, `tool-steps`), `measure.ts`, `run.ts` (the notice).
- Slice 3 in main: `tools/pre-steps.ts`, `prepared-section.ts`, `expects.ts`, `tools-host.ts` (`prepare`, `phaseEnded`), `task-manager.ts` (`TaskDeps.prepare`, `phaseEnded`, `PrepareAnswer`, `EXPECTS_CHECK_MS`), `turn-controller.ts` (`TurnOptions.prepared`), `usage-log.ts` (`preRecord`, `expectsMissRecord`, `TOOL_ROW_KINDS`, `measurePre`); in the window `tools/PreparedGroup.tsx`, `ErrorCard.tsx`, `ContextPanel.tsx`.
- `packages/shell/src/main/tools/`: `tool-protocol.ts`, `tool-host.ts`, `tool-broker.ts`, `tool-files.ts`, `tool-registry.ts`, `tool-trace.ts`, `tools-json.ts`, `tools-host.ts`, `tools-ipc.ts`. `packages/shell/resources/tool-host.html`, `tool-host.mjs`, `tool-preload.cjs`. `shell-resources.ts` (`shellResourcesDir`). `data-requests.ts` (`toolDataRequests`, `dataWriteQueue`), `secrets/connections.ts` (`connectTests`, Test), `index.ts` (the wiring under `hasTools`).
- `packages/blocks/src/tools-server.ts`, `tools-server-bin.ts`, `launch.ts` (`toolsServerSpec`); `packages/runtime/src/workspace.ts` (`RuntimeOptions.tools`), `events.ts` (`tool-call`, `ToolCallView`).
- `packages/workspace/src/data.ts` (`who: "tool"`), `history.ts` (`Tool:`, `CommitTrailer`).
- `packages/ui/src/tools/ToolCallLine.tsx`, `state.ts` (`tool-call`, `isToolLine`), `ChatView.tsx`, `client.ts` (`ToolsClient`, `ToolsInfo`, `TOOLS_OFF_CRASHES`), `connections/` (Test connection).
- Tests: `packages/harness-sdk/test/tools.test.ts`, `tool-problems.test.ts`; `packages/cli/test/tool-build.test.ts`, `fixture-dist.test.ts`; `packages/shell/test/tools/`, `tools-surface.test.ts`; `packages/blocks/test/tools-server.test.ts`; `packages/runtime/test/workspace-tools.test.ts`; `packages/workspace/test/data-tool.test.ts`; `packages/ui/test/tool-call-ui.test.tsx`. E2E: `packages/e2e/tests/tool-host.spec.ts` (a bare Electron main with a hostile tool), `tools.spec.ts` (the fixture `packages/fake-agent/fixtures/tools-harness`, id `toolbox`), `tools-pre.spec.ts` (slice 3: first message, folded group, panel items, refused start and Try again, an expects miss).
